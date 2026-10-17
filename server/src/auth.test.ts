import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetUsers, requireUser, type AppUser } from './auth';

const DEMO = 'demo-patient';

vi.mock('./config', () => ({
  config: { auth0: { domain: 'tenant.example', audience: 'https://haven-api' }, clinicianEmails: ['pt@clinic.example'], demoPatientId: 'demo-patient' },
}));

// Checking the token's signature is Auth0's job; here the test names the subject.
vi.mock('express-oauth2-jwt-bearer', () => ({
  auth: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: req.headers['x-sub'] } } as Request['auth'];
    next();
  },
}));

// A stand-in for the two tables sign-in reads and writes.
const { tables, query } = vi.hoisted(() => {
  const tables = { appUsers: new Map<string, { email: string | null; role: string }>(), patients: new Map<string, string>() };
  const query = async (sql: string, params: unknown[]) => {
    if (sql.startsWith('select email, role from app_users')) {
      const row = tables.appUsers.get(params[0] as string);
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith('select id from patients')) {
      const id = tables.patients.get((params[0] as string).toLowerCase());
      return { rows: id ? [{ id }] : [] };
    }
    if (sql.startsWith('insert into app_users')) {
      tables.appUsers.set(params[0] as string, { email: params[1] as string | null, role: params[2] as string });
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { tables, query };
});
vi.mock('./db', async (importOriginal) => ({ ...(await importOriginal<typeof import('./db')>()), db: () => ({ query }) }));

/** What Auth0's /userinfo says about the signed-in person. */
function auth0Says(info: { email?: string; email_verified?: boolean }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => info })));
}

async function signIn(sub: string): Promise<AppUser> {
  const req = { headers: { 'x-sub': sub, authorization: 'Bearer token' } } as unknown as Request;
  await new Promise<void>((resolve, reject) => requireUser(req, {} as Response, (err?: unknown) => (err ? reject(err) : resolve())));
  return req.user!;
}

beforeEach(() => {
  tables.appUsers.clear();
  tables.patients.clear();
  forgetUsers();
});

describe('sign-in', () => {
  it('makes a verified address in CLINICIAN_EMAILS a clinician', async () => {
    auth0Says({ email: 'PT@clinic.example', email_verified: true });
    expect(await signIn('auth0|pt')).toMatchObject({ role: 'clinician', patientId: null, readOnly: false });
  });

  it("links a patient to the record a clinician added for their email, with write access", async () => {
    tables.patients.set('ana@example.com', 'ana-record');
    auth0Says({ email: 'Ana@Example.com', email_verified: true });
    expect(await signIn('auth0|ana')).toMatchObject({ role: 'patient', patientId: 'ana-record', readOnly: false });
  });

  it('shows anyone else the demo patient, read-only', async () => {
    auth0Says({ email: 'stranger@example.com', email_verified: true });
    expect(await signIn('auth0|stranger')).toMatchObject({ role: 'patient', patientId: DEMO, readOnly: true });
  });

  it("ignores an unverified address, even a clinician's or a patient's", async () => {
    tables.patients.set('ana@example.com', 'ana-record');
    auth0Says({ email: 'pt@clinic.example', email_verified: false });
    expect(await signIn('auth0|fake-pt')).toMatchObject({ role: 'patient', patientId: DEMO, readOnly: true });
    auth0Says({ email: 'ana@example.com', email_verified: false });
    expect(await signIn('auth0|fake-ana')).toMatchObject({ role: 'patient', patientId: DEMO, readOnly: true });
  });

  it('links the record once a clinician adds it and the user cache is cleared', async () => {
    auth0Says({ email: 'ben@example.com', email_verified: true });
    expect(await signIn('auth0|ben')).toMatchObject({ patientId: DEMO, readOnly: true });

    tables.patients.set('ben@example.com', 'ben-record');
    forgetUsers(); // what saving a patient's email does
    expect(await signIn('auth0|ben')).toMatchObject({ patientId: 'ben-record', readOnly: false });
  });
});
