import type { NextFunction, Request, Response } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import { config } from './config';
import { db, HttpError } from './db';

export interface AppUser {
  sub: string;
  email: string | null;
  role: 'patient' | 'clinician';
  patientId: string | null;
  /** Signed in with no record of their own, so they see the demo patient but can't add to it. */
  readOnly: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AppUser;
  }
}

const DEV_USER: AppUser = { sub: 'dev', email: null, role: 'clinician', patientId: null, readOnly: false };

const verifyJwt = config.auth0 ? auth({ issuerBaseURL: `https://${config.auth0.domain}/`, audience: config.auth0.audience }) : null;

/**
 * Verifies the Auth0 access token and maps the identity to a role. Without Auth0 configured,
 * every request acts as the demo clinician so the app still runs locally.
 */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!verifyJwt) {
    req.user = DEV_USER;
    return next();
  }
  verifyJwt(req, res, (err?: unknown) => {
    if (err) return next(err);
    resolveUser(req)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch(next);
  });
}

/** Users without a verified email yet are looked up again after this long. */
const RECHECK_MS = 60_000;
const cache = new Map<string, { user: AppUser; until: number }>();

/** Call after a patient's email changes, so their next request picks up the new link. */
export function forgetUsers() {
  cache.clear();
}

async function resolveUser(req: Request): Promise<AppUser> {
  const sub = req.auth?.payload.sub;
  if (!sub) throw new HttpError(401, 'Token has no subject');
  const cached = cache.get(sub);
  if (cached && cached.until > Date.now()) return cached.user;

  const row = (await db().query('select email, role from app_users where auth0_sub = $1', [sub])).rows[0];
  // Access tokens carry no email, so ask Auth0 who this is until we have a verified address.
  const email: string | null = row?.email ?? (await verifiedEmail(req));
  // CLINICIAN_EMAILS is re-read on every sign-in, so adding someone later still takes effect.
  const clinician = row?.role === 'clinician' || (!!email && config.clinicianEmails.includes(email.toLowerCase()));
  // A patient lands on the record a clinician added for their email. Hackathon fallback:
  // anyone else sees the demo patient, read-only, so the public demo record stays clean.
  const record = !clinician && email ? (await db().query('select id from patients where lower(email) = lower($1)', [email])).rows[0] : undefined;
  const user: AppUser = {
    sub,
    email,
    role: clinician ? 'clinician' : 'patient',
    patientId: clinician ? null : (record?.id ?? config.demoPatientId),
    readOnly: !clinician && !record,
  };

  await db().query(
    `insert into app_users (auth0_sub, email, role, patient_id) values ($1, $2, $3, $4)
     on conflict (auth0_sub) do update set email = excluded.email, role = excluded.role, patient_id = excluded.patient_id`,
    [sub, email, user.role, user.patientId],
  );
  cache.set(sub, { user, until: email ? Infinity : Date.now() + RECHECK_MS });
  return user;
}

/**
 * The email decides both the role and the patient record, and anyone can sign up with someone
 * else's address, so only an address Auth0 has verified counts.
 */
async function verifiedEmail(req: Request): Promise<string | null> {
  const info = await fetch(`https://${config.auth0!.domain}/userinfo`, { headers: { Authorization: req.headers.authorization ?? '' } });
  if (!info.ok) return null;
  const { email, email_verified } = (await info.json()) as { email?: string; email_verified?: boolean };
  return email && email_verified ? email : null;
}

export function assertCanSee(user: AppUser, patientId: string) {
  if (user.role === 'clinician') return;
  if (user.patientId !== patientId) throw new HttpError(403, 'You can only see your own records');
}

export function assertCanChange(user: AppUser, patientId: string) {
  assertCanSee(user, patientId);
  if (user.readOnly) throw new HttpError(403, 'This is the demo patient, so nothing is saved. Ask your physical therapist to add your email.');
}

export function assertClinician(user: AppUser) {
  if (user.role !== 'clinician') throw new HttpError(403, 'Clinicians only');
}
