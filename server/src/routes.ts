import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PatientSummary, SessionPayload } from '../../web/src/lib/apiTypes';
import { parsePatientInput, parsePrescriptions, type PatientInput } from '../../web/src/lib/carePlan';
import { assertCanSee, assertClinician, forgetUsers, requireUser } from './auth';
import { config } from './config';
import { db, HttpError, pool, transaction } from './db';
import { loadPatient, loadProgress, summarizePatient } from './progress';
import { generateReport, latestReport } from './report';
import { loadBandTrace, systemStats } from './telemetry';
import { saveDailyUse, saveSession } from './sessions';

export const api = Router();

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).then((body) => res.json(body), next);

api.get(
  '/health',
  h(async () => ({
    ok: true,
    database: pool ? await pool.query('select 1').then(() => true, () => false) : false,
    timescale: pool ? await pool.query(`select 1 from pg_extension where extname = 'timescaledb'`).then((r) => !!r.rowCount, () => false) : false,
    auth: config.auth0 ? { domain: config.auth0.domain, audience: config.auth0.audience } : null,
    gemini: !!config.gemini,
  })),
);

// Public and read-only: the simulated demo patient, so the judges page works from a bare link.
api.get(
  '/demo',
  h(async () => {
    const id = config.demoPatientId;
    // One after another: it's a handful of small queries, and it keeps connection use flat.
    const progress = await loadProgress(id);
    const bandTrace = await loadBandTrace(id);
    const system = await systemStats();
    const report = await latestReport(id);
    // This endpoint is public: never send the sign-in address a clinician may have added.
    return { progress: { ...progress, patient: { ...progress.patient, email: null } }, bandTrace, system, report };
  }),
);

api.use(requireUser);

api.get('/system', h(async () => systemStats()));

api.get('/me', h(async (req) => req.user));

// Clinicians see every patient (one clinic); a patient sees only themselves.
api.get(
  '/patients',
  h(async (req) => {
    const user = req.user!;
    const ids =
      user.role === 'clinician'
        ? (await db().query('select id from patients order by display_name')).rows.map((r) => r.id as string)
        : user.patientId
          ? [user.patientId]
          : [];
    // One patient at a time keeps connection use flat; a clinic list is small.
    const list: PatientSummary[] = [];
    for (const id of ids) list.push(await summarizePatient(id));
    return list;
  }),
);

api.post(
  '/patients',
  h(async (req) => {
    assertClinician(req.user!);
    const p = patientInput(req.body);
    const id = await withEmailCheck(async () => {
      const r = await db().query(
        `insert into patients (display_name, affected_side, surgery_type, surgery_date, current_phase, email, plan_note, reminder_minutes)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [p.displayName, p.affectedSide, p.surgeryType, p.surgeryDate, p.currentPhase, p.email, p.planNote, p.reminderMinutes],
      );
      return r.rows[0].id as string;
    });
    return loadPatient(id);
  }),
);

api.put(
  '/patients/:id',
  h(async (req) => {
    assertClinician(req.user!);
    const p = patientInput(req.body);
    const updated = await withEmailCheck(() =>
      db().query(
        `update patients set display_name = $2, affected_side = $3, surgery_type = $4, surgery_date = $5, current_phase = $6, email = $7, plan_note = $8,
                             reminder_minutes = $9
         where id = $1`,
        [param(req), p.displayName, p.affectedSide, p.surgeryType, p.surgeryDate, p.currentPhase, p.email, p.planNote, p.reminderMinutes],
      ),
    );
    if (!updated.rowCount) throw new HttpError(404, `No patient ${param(req)}`);
    return loadPatient(param(req));
  }),
);

api.get(
  '/patients/:id',
  h(async (req) => {
    assertCanSee(req.user!, param(req));
    return loadPatient(param(req));
  }),
);

api.put(
  '/patients/:id/phase',
  h(async (req) => {
    assertClinician(req.user!);
    const phase = Number(req.body?.phase);
    if (![1, 2, 3].includes(phase)) throw new HttpError(400, 'phase must be 1, 2 or 3');
    await db().query('update patients set current_phase = $2 where id = $1', [param(req), phase]);
    return { phase };
  }),
);

api.put(
  '/patients/:id/prescriptions/:phase',
  h(async (req) => {
    assertClinician(req.user!);
    const phase = Number(req.params.phase);
    if (![1, 2, 3].includes(phase)) throw new HttpError(400, 'phase must be 1, 2 or 3');
    const rx = badRequestOnThrow(() => parsePrescriptions(req.body?.prescriptions));
    await transaction(async (c) => {
      await c.query('delete from prescriptions where patient_id = $1 and phase = $2', [param(req), phase]);
      for (const p of rx) {
        await c.query(
          `insert into prescriptions (patient_id, phase, exercise_id, ceiling_deg, goal_deg, reps_target, sets_target, set_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [param(req), phase, p.exerciseId, p.ceilingDeg, p.goalDeg, p.reps, p.sets, req.user!.email ?? 'clinician'],
        );
      }
    });
    return { saved: rx.length };
  }),
);

api.post(
  '/patients/:id/sessions',
  h(async (req) => {
    assertCanSee(req.user!, param(req));
    return saveSession(param(req), req.body as SessionPayload);
  }),
);

api.post(
  '/patients/:id/daily-use',
  h(async (req) => {
    assertCanSee(req.user!, param(req));
    return { saved: await saveDailyUse(param(req), req.body?.records ?? []) };
  }),
);

api.get(
  '/patients/:id/progress',
  h(async (req) => {
    assertCanSee(req.user!, param(req));
    return loadProgress(param(req), typeof req.query.asOf === 'string' ? req.query.asOf : undefined);
  }),
);

api.get(
  '/patients/:id/band-trace',
  h(async (req) => {
    assertCanSee(req.user!, param(req));
    return { trace: await loadBandTrace(param(req)) };
  }),
);

api.get(
  '/patients/:id/reports/latest',
  h(async (req) => {
    assertCanSee(req.user!, param(req));
    return { report: await latestReport(param(req)) };
  }),
);

api.post(
  '/patients/:id/reports',
  h(async (req) => {
    assertCanSee(req.user!, param(req));
    return { report: await generateReport(param(req)) };
  }),
);

function patientInput(body: unknown): PatientInput {
  return badRequestOnThrow(() => parsePatientInput(body));
}

function badRequestOnThrow<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
}

/** Two records with one sign-in address would make the login ambiguous; the unique index stops it. */
async function withEmailCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    forgetUsers();
    return result;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'Another patient already signs in with that email.');
    throw err;
  }
}

function param(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Bad patient id');
  return id;
}
