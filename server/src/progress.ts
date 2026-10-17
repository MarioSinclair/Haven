import type { ExerciseProgress, PatientBundle, PatientSummary, PlanStamp, Progress, ProtocolByPhase } from '../../web/src/lib/apiTypes';
import { resolveReference } from '../../web/src/lib/baseline';
import { computeFlags, daysBetween, type RomDay, type Severity } from '../../web/src/lib/flags';
import { affectedSides, DEFAULT_PROTOCOL, GENERAL_GOAL_DEG, measuresRange } from '../../web/src/lib/protocol';
import type { ExerciseId, Phase, Side } from '../../web/src/lib/types';
import { config } from './config';
import { db, HttpError } from './db';

export async function loadPatient(patientId: string): Promise<PatientBundle> {
  const [p, rx, bl] = await Promise.all([
    db().query('select * from patients where id = $1', [patientId]),
    db().query('select * from prescriptions where patient_id = $1 order by phase, exercise_id', [patientId]),
    db().query('select exercise_id, side, source, peak_deg, measured_at from baselines where patient_id = $1', [patientId]),
  ]);
  const row = p.rows[0];
  if (!row) throw new HttpError(404, `No patient ${patientId}`);

  const protocol: ProtocolByPhase = { 1: DEFAULT_PROTOCOL[1].prescriptions, 2: DEFAULT_PROTOCOL[2].prescriptions, 3: DEFAULT_PROTOCOL[3].prescriptions };
  const planSaved: Record<Phase, PlanStamp | null> = { 1: null, 2: null, 3: null };
  for (const phase of [1, 2, 3] as Phase[]) {
    const rows = rx.rows.filter((r) => r.phase === phase);
    if (rows.length) {
      protocol[phase] = rows.map((r) => ({ exerciseId: r.exercise_id, ceilingDeg: r.ceiling_deg, goalDeg: r.goal_deg, reps: r.reps_target, sets: r.sets_target }));
      const last = rows.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
      planSaved[phase] = { setBy: last.set_by, updatedAt: new Date(last.updated_at).toISOString() };
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
      email: row.email,
      planNote: row.plan_note,
      reminderMinutes: row.reminder_minutes ?? 0,
    },
    protocol,
    baselines: bl.rows.map((r) => ({ exerciseId: r.exercise_id, side: r.side, source: r.source, peakDeg: r.peak_deg, measuredAt: new Date(r.measured_at).toISOString() })),
    planSaved,
  };
}

/** One row of the clinician's patient list, from the same progress and flags the dashboard shows. */
export async function summarizePatient(patientId: string): Promise<PatientSummary> {
  const { asOf, patient, protocol, exercises, sessions, flags } = await loadProgress(patientId);
  const counts: Record<Severity, number> = { urgent: 0, warn: 0, info: 0 };
  for (const f of flags) counts[f.severity]++;

  // The first planned exercise with data on the surgery side, else any exercise with data there.
  const sides = affectedSides(patient.affectedSide);
  const tracked = exercises.filter((e) => sides.includes(e.side) && e.days.length);
  const lead = protocol[patient.currentPhase].map((p) => tracked.find((e) => e.exerciseId === p.exerciseId)).find((e) => e) ?? tracked[0];
  const latest = lead?.days[lead.days.length - 1];

  return {
    patient,
    lastSessionDay: sessions[sessions.length - 1]?.day ?? null,
    sessionsLast7Days: sessions.filter((s) => daysBetween(s.day, asOf) < 7).length,
    flags: counts,
    headline:
      lead && latest
        ? { exerciseId: lead.exerciseId, side: lead.side, latestDeg: latest.bestPeakDeg, referenceDeg: lead.reference.deg, reference: lead.reference.source }
        : null,
  };
}

/** Everything the dashboard, the rules and the report need, read from the rollups. */
export async function loadProgress(patientId: string, asOf?: string): Promise<Progress> {
  const tz = config.timezone;
  const { patient, protocol, baselines } = await loadPatient(patientId);
  const asOfDay = asOf ?? (await db().query(`select to_char((now() at time zone $1)::date, 'YYYY-MM-DD') as d`, [tz])).rows[0].d;

  const [rom, sessions, use] = await Promise.all([
    db().query(
      `select to_char(day at time zone $2, 'YYYY-MM-DD') as day, exercise_id, side, best_peak_deg, reps,
              reps_over_ceiling, reps_with_compensation, camera_band_gap_deg
         from rom_daily where patient_id = $1 order by day`,
      [patientId, tz],
    ),
    db().query(
      `select to_char(started_at at time zone $2, 'YYYY-MM-DD') as day, phase, max_pain,
              coalesce(arm_heaviness, false) as arm_heaviness, coalesce(armpit_cord, false) as armpit_cord, notes
         from session_summary where patient_id = $1 and kind = 'exercise' order by started_at`,
      [patientId, tz],
    ),
    db().query(
      `select to_char(day at time zone $2, 'YYYY-MM-DD') as day, active_minutes, raises_over_90, max_elev_deg
         from daily_use_daily where patient_id = $1 order by day`,
      [patientId, tz],
    ),
  ]);

  // Shoulder rolls and other moves that don't measure range stay out of range charts and flags.
  const romRows = rom.rows.filter((r) => measuresRange(r.exercise_id));
  const romDays: RomDay[] = romRows.map((r) => ({
    day: r.day,
    exerciseId: r.exercise_id,
    side: r.side,
    bestPeakDeg: r.best_peak_deg,
    reps: r.reps,
    repsOverCeiling: r.reps_over_ceiling,
    repsWithCompensation: r.reps_with_compensation,
  }));
  const sessionDays = sessions.rows.map((r) => ({ day: r.day, phase: r.phase, maxPain: r.max_pain, armHeaviness: r.arm_heaviness, armpitCord: r.armpit_cord, notes: r.notes }));
  const useDays = use.rows.map((r) => ({ day: r.day, activeMinutes: r.active_minutes, raisesOver90: r.raises_over_90, maxElevDeg: r.max_elev_deg }));

  const limitByPhase: Record<number, number | null> = {};
  for (const phase of [1, 2, 3] as Phase[]) {
    const ceilings = protocol[phase].map((p) => p.ceilingDeg).filter((c): c is number => c !== null);
    limitByPhase[phase] = ceilings.length ? Math.min(...ceilings) : null;
  }

  const groups = new Map<string, typeof romRows>();
  for (const r of romRows) groups.set(`${r.exercise_id}:${r.side}`, [...(groups.get(`${r.exercise_id}:${r.side}`) ?? []), r]);
  const exercises: ExerciseProgress[] = [...groups.values()].map((rows) => {
    const exerciseId = rows[0].exercise_id as ExerciseId;
    const side = rows[0].side as Side;
    const goal = protocol[patient.currentPhase].find((p) => p.exerciseId === exerciseId)?.goalDeg ?? null;
    const start = baselines.find((b) => b.exerciseId === exerciseId && b.side === side && b.source === 'first_session');
    return {
      exerciseId,
      side,
      reference: resolveReference(baselines, exerciseId, side, patient.affectedSide, GENERAL_GOAL_DEG, goal),
      startDeg: start?.peakDeg ?? null,
      days: rows.map((r) => ({
        day: r.day,
        bestPeakDeg: r.best_peak_deg,
        reps: r.reps,
        repsOverCeiling: r.reps_over_ceiling,
        repsWithCompensation: r.reps_with_compensation,
        cameraBandGapDeg: r.camera_band_gap_deg,
      })),
    };
  });

  return {
    asOf: asOfDay,
    patient,
    protocol,
    exercises,
    sessions: sessionDays,
    dailyUse: useDays,
    flags: computeFlags({ asOf: asOfDay, rom: romDays, sessions: sessionDays, dailyUse: useDays, limitByPhase }),
  };
}
