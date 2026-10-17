import type { NextFunction, Request, Response } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import { config } from './config';
import { db, HttpError } from './db';

export interface AppUser {
  sub: string;
  email: string | null;
  role: 'patient' | 'clinician';
  patientId: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AppUser;
  }
}

const DEV_USER: AppUser = { sub: 'dev', email: null, role: 'clinician', patientId: config.demoPatientId };

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

const cache = new Map<string, AppUser>();

async function resolveUser(req: Request): Promise<AppUser> {
  const sub = req.auth?.payload.sub;
  if (!sub) throw new HttpError(401, 'Token has no subject');
  const cached = cache.get(sub);
  if (cached) return cached;

  const existing = await db().query('select auth0_sub, email, role, patient_id from app_users where auth0_sub = $1', [sub]);
  let user: AppUser;
  if (existing.rows[0]) {
    const r = existing.rows[0];
    user = { sub, email: r.email, role: r.role, patientId: r.patient_id };
  } else {
    // First sign-in: access tokens carry no email, so ask Auth0 who this is.
    const info = await fetch(`https://${config.auth0!.domain}/userinfo`, { headers: { Authorization: req.headers.authorization ?? '' } });
    const email = info.ok ? (((await info.json()) as { email?: string }).email ?? null) : null;
    const clinician = !!email && config.clinicianEmails.includes(email.toLowerCase());
    // Hackathon shortcut: every new patient account is linked to the demo patient.
    user = { sub, email, role: clinician ? 'clinician' : 'patient', patientId: config.demoPatientId };
    await db().query('insert into app_users (auth0_sub, email, role, patient_id) values ($1, $2, $3, $4) on conflict (auth0_sub) do nothing', [
      sub,
      email,
      user.role,
      user.patientId,
    ]);
  }
  cache.set(sub, user);
  return user;
}

export function assertCanSee(user: AppUser, patientId: string) {
  if (user.role === 'clinician') return;
  if (user.patientId !== patientId) throw new HttpError(403, 'You can only see your own records');
}

export function assertClinician(user: AppUser) {
  if (user.role !== 'clinician') throw new HttpError(403, 'Clinicians only');
}
