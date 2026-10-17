import { baselineSourceFor } from '../../web/src/lib/baseline';
import type { SessionPayload } from '../../web/src/lib/apiTypes';
import type { AffectedSide } from '../../web/src/lib/types';
import { db, HttpError, transaction } from './db';

/** Writes a finished session, its band trace and any new baselines in one transaction. */
export async function saveSession(patientId: string, payload: SessionPayload): Promise<{ sessionId: string }> {
  const { result, bandTrace } = payload;
  if (!result?.sets) throw new HttpError(400, 'Missing session result');
  const patient = (await db().query('select affected_side, surgery_date from patients where id = $1', [patientId])).rows[0];
  if (!patient) throw new HttpError(404, `No patient ${patientId}`);

  return transaction(async (c) => {
    const sessionId = (
      await c.query('insert into sessions (patient_id, kind, phase, started_at, ended_at) values ($1, $2, $3, $4, $5) returning id', [
        patientId,
        result.kind,
        result.phase,
        result.startedAt,
        result.endedAt,
      ])
    ).rows[0].id as string;

    for (const s of result.sets) {
      const setId = (
        await c.query(
          'insert into sets (session_id, exercise_id, side, set_index, ceiling_deg, reps_target, pain) values ($1, $2, $3, $4, $5, $6, $7) returning id',
          [sessionId, s.exerciseId, s.side, s.setIndex, s.ceilingDeg, s.repsTarget, s.pain],
        )
      ).rows[0].id as string;
      if (!s.reps.length) continue;
      // One round trip per set: unnest parallel arrays instead of one insert per rep.
      await c.query(
        `insert into reps (set_id, patient_id, exercise_id, side, kind, performed_at, rep_index, peak_deg, duration_ms, source,
                           over_ceiling, shoulder_hike, trunk_lean, elbow_bend, imu_peak_deg)
         select $1, $2, $3, $4, $5, r.performed_at, r.rep_index, r.peak_deg, r.duration_ms, r.source::angle_source,
                r.over_ceiling, r.shoulder_hike, r.trunk_lean, r.elbow_bend, r.imu_peak_deg
           from unnest($6::timestamptz[], $7::smallint[], $8::real[], $9::int[], $10::text[], $11::bool[], $12::bool[], $13::bool[], $14::bool[], $15::real[])
             as r(performed_at, rep_index, peak_deg, duration_ms, source, over_ceiling, shoulder_hike, trunk_lean, elbow_bend, imu_peak_deg)`,
        [
          setId,
          patientId,
          s.exerciseId,
          s.side,
          s.kind,
          s.reps.map((r) => r.endedAt),
          s.reps.map((r) => r.index),
          s.reps.map((r) => r.peakDeg),
          s.reps.map((r) => r.durationMs),
          s.reps.map((r) => r.source),
          s.reps.map((r) => r.overCeiling),
          s.reps.map((r) => r.shoulderHike),
          s.reps.map((r) => r.trunkLean),
          s.reps.map((r) => r.elbowBend),
          s.reps.map((r) => r.imuPeakDeg),
        ],
      );
    }

    if (result.symptoms) {
      await c.query('insert into symptom_logs (session_id, arm_heaviness, armpit_cord, note) values ($1, $2, $3, $4)', [
        sessionId,
        result.symptoms.armHeaviness,
        result.symptoms.armpitCord,
        result.symptoms.note || null,
      ]);
    }

    if (bandTrace?.length) {
      await c.query(
        `insert into band_samples (patient_id, session_id, t, elevation_deg, rate_dps)
         select $1, $2, to_timestamp(b.t / 1000.0), b.deg, b.rate from unnest($3::float8[], $4::real[], $5::real[]) as b(t, deg, rate)`,
        [patientId, sessionId, bandTrace.map((p) => p.t), bandTrace.map((p) => p.deg), bandTrace.map((p) => p.rate)],
      );
    }

    // Range checks become baselines; a patient's first session on an arm becomes its starting point.
    const surgery = patient.surgery_date ? new Date(`${patient.surgery_date}T00:00:00`) : null;
    const best = new Map<string, { exerciseId: string; side: 'left' | 'right'; peak: number }>();
    for (const s of result.sets) {
      if (!s.reps.length) continue;
      const peak = Math.max(...s.reps.map((r) => r.peakDeg));
      const key = `${s.exerciseId}:${s.side}`;
      if ((best.get(key)?.peak ?? -Infinity) < peak) best.set(key, { exerciseId: s.exerciseId, side: s.side, peak });
    }
    for (const b of best.values()) {
      const source = baselineSourceFor(new Date(result.startedAt), surgery, b.side, patient.affected_side as AffectedSide);
      if (result.kind === 'exercise') {
        if (source !== 'first_session') continue;
        const existing = await c.query(
          `select 1 from baselines where patient_id = $1 and exercise_id = $2 and side = $3 and source = 'first_session' limit 1`,
          [patientId, b.exerciseId, b.side],
        );
        if (existing.rowCount) continue;
      }
      await c.query('insert into baselines (patient_id, exercise_id, side, source, peak_deg, measured_at) values ($1, $2, $3, $4, $5, $6)', [
        patientId,
        b.exerciseId,
        b.side,
        source,
        b.peak,
        result.startedAt,
      ]);
    }

    return { sessionId };
  });
}

export async function saveDailyUse(patientId: string, records: { minuteStart: string; maxElevationDeg: number; raisesOver90: number; activeSeconds: number }[]) {
  if (!records.length) return 0;
  await db().query(
    `insert into daily_use (patient_id, bucket_start, bucket_minutes, max_elev_deg, raises_over_90, active_minutes)
     select $1, r.bucket_start, 1, r.max_elev, r.raises, r.active_s / 60.0
       from unnest($2::timestamptz[], $3::real[], $4::smallint[], $5::real[]) as r(bucket_start, max_elev, raises, active_s)
     on conflict (patient_id, bucket_start, bucket_minutes) do update
       set max_elev_deg = excluded.max_elev_deg, raises_over_90 = excluded.raises_over_90, active_minutes = excluded.active_minutes`,
    [patientId, records.map((r) => r.minuteStart), records.map((r) => r.maxElevationDeg), records.map((r) => r.raisesOver90), records.map((r) => r.activeSeconds)],
  );
  return records.length;
}
