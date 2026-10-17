import { createClient } from '@supabase/supabase-js';
import { baselineSourceFor } from './baseline';
import type { DailyRecord } from './band/protocol';
import { DEFAULT_PROTOCOL, type Prescription } from './protocol';
import type { SessionResult } from './session/engine';
import type { AffectedSide, ExerciseId, Phase } from './types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const PATIENT_ID = import.meta.env.VITE_PATIENT_ID || '00000000-0000-4000-8000-000000000001';

export interface PatientProfile {
  /** null when running offline. */
  id: string | null;
  displayName: string;
  affectedSide: AffectedSide;
  surgeryType: string | null;
  surgeryDate: string | null;
  currentPhase: Phase;
}

export type ProtocolByPhase = Record<Phase, Prescription[]>;

export const OFFLINE_PATIENT: PatientProfile = {
  id: null,
  displayName: 'Demo patient (offline)',
  affectedSide: 'left',
  surgeryType: null,
  surgeryDate: null,
  currentPhase: 1,
};

export const defaultProtocolByPhase = (): ProtocolByPhase => ({
  1: DEFAULT_PROTOCOL[1].prescriptions,
  2: DEFAULT_PROTOCOL[2].prescriptions,
  3: DEFAULT_PROTOCOL[3].prescriptions,
});

export async function loadPatient(): Promise<{ patient: PatientProfile; protocol: ProtocolByPhase; error?: string }> {
  if (!supabase) return { patient: OFFLINE_PATIENT, protocol: defaultProtocolByPhase() };

  const [patientRes, rxRes] = await Promise.all([
    supabase.from('patients').select('*').eq('id', PATIENT_ID).maybeSingle(),
    supabase.from('prescriptions').select('*').eq('patient_id', PATIENT_ID),
  ]);
  if (patientRes.error || !patientRes.data) {
    return { patient: OFFLINE_PATIENT, protocol: defaultProtocolByPhase(), error: patientRes.error?.message ?? `No patient ${PATIENT_ID}` };
  }
  const row = patientRes.data;
  const protocol = defaultProtocolByPhase();
  // A phase the clinician has configured replaces the defaults for that phase entirely.
  for (const phase of [1, 2, 3] as Phase[]) {
    const rows = (rxRes.data ?? []).filter((r) => r.phase === phase);
    if (rows.length) {
      protocol[phase] = rows.map((r) => ({
        exerciseId: r.exercise_id as ExerciseId,
        ceilingDeg: r.ceiling_deg,
        goalDeg: r.goal_deg,
        reps: r.reps_target,
        sets: r.sets_target,
      }));
    }
  }
  return {
    patient: {
      id: row.id,
      displayName: row.display_name,
      affectedSide: row.affected_side,
      surgeryType: row.surgery_type,
      surgeryDate: row.surgery_date,
      currentPhase: row.current_phase,
    },
    protocol,
    error: rxRes.error?.message,
  };
}

/**
 * Writes one session. supabase-js has no transactions, so this inserts parent rows first;
 * a failure part-way leaves a session with missing children rather than orphans.
 */
export async function saveSession(result: SessionResult, patient: PatientProfile): Promise<void> {
  if (!supabase || !patient.id) throw new Error('Supabase is not configured');
  const sessionId = crypto.randomUUID();

  const check = (res: { error: { message: string } | null }) => {
    if (res.error) throw new Error(res.error.message);
  };

  check(
    await supabase.from('sessions').insert({
      id: sessionId,
      patient_id: patient.id,
      kind: result.kind,
      phase: result.phase,
      started_at: result.startedAt.toISOString(),
      ended_at: result.endedAt.toISOString(),
    }),
  );

  const sets = result.sets.map((s) => ({ id: crypto.randomUUID(), result: s }));
  if (sets.length) {
    check(
      await supabase.from('sets').insert(
        sets.map(({ id, result: s }) => ({
          id,
          session_id: sessionId,
          exercise_id: s.exerciseId,
          side: s.side,
          set_index: s.setIndex,
          ceiling_deg: s.ceilingDeg,
          reps_target: s.repsTarget,
          pain: s.pain,
        })),
      ),
    );
    const reps = sets.flatMap(({ id, result: s }) =>
      s.reps.map((r) => ({
        set_id: id,
        rep_index: r.index,
        peak_deg: r.peakDeg,
        duration_ms: r.durationMs,
        source: r.source,
        over_ceiling: r.overCeiling,
        shoulder_hike: r.shoulderHike,
        trunk_lean: r.trunkLean,
        elbow_bend: r.elbowBend,
        imu_peak_deg: r.imuPeakDeg,
      })),
    );
    if (reps.length) check(await supabase.from('reps').insert(reps));
  }

  if (result.symptoms) {
    check(
      await supabase.from('symptom_logs').insert({
        session_id: sessionId,
        arm_heaviness: result.symptoms.armHeaviness,
        armpit_cord: result.symptoms.armpitCord,
        note: result.symptoms.note || null,
      }),
    );
  }

  await saveBaselines(result, patient);
}

/** Range checks become baselines; a patient's first session on an arm becomes its starting point. */
async function saveBaselines(result: SessionResult, patient: PatientProfile) {
  const surgery = patient.surgeryDate ? new Date(patient.surgeryDate) : null;
  const best = new Map<string, { exerciseId: ExerciseId; side: 'left' | 'right'; peak: number }>();
  for (const s of result.sets) {
    const peak = Math.max(...s.reps.map((r) => r.peakDeg));
    if (!Number.isFinite(peak)) continue;
    const key = `${s.exerciseId}:${s.side}`;
    if ((best.get(key)?.peak ?? -Infinity) < peak) best.set(key, { exerciseId: s.exerciseId, side: s.side, peak });
  }

  const rows = [];
  for (const b of best.values()) {
    const source = baselineSourceFor(result.startedAt, surgery, b.side, patient.affectedSide);
    if (result.kind === 'exercise') {
      if (source !== 'first_session') continue;
      const existing = await supabase!
        .from('baselines')
        .select('id', { count: 'exact', head: true })
        .eq('patient_id', patient.id!)
        .eq('exercise_id', b.exerciseId)
        .eq('side', b.side)
        .eq('source', 'first_session');
      if ((existing.count ?? 0) > 0) continue;
    }
    rows.push({ patient_id: patient.id, exercise_id: b.exerciseId, side: b.side, source, peak_deg: b.peak, measured_at: result.startedAt.toISOString() });
  }
  if (rows.length) {
    const res = await supabase!.from('baselines').insert(rows);
    if (res.error) throw new Error(res.error.message);
  }
}

export async function uploadDailyUse(records: DailyRecord[], patientId: string): Promise<number> {
  if (!supabase) throw new Error('Supabase is not configured');
  if (!records.length) return 0;
  const res = await supabase.from('daily_use').upsert(
    records.map((r) => ({
      patient_id: patientId,
      bucket_start: r.minuteStart.toISOString(),
      bucket_minutes: 1,
      max_elev_deg: r.maxElevationDeg,
      raises_over_90: r.raisesOver90,
      active_minutes: r.activeSeconds / 60,
    })),
  );
  if (res.error) throw new Error(res.error.message);
  return records.length;
}
