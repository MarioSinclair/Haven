const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  databaseUrl: env.DATABASE_URL ?? '',
  auth0: env.AUTH0_DOMAIN && env.AUTH0_AUDIENCE ? { domain: env.AUTH0_DOMAIN, audience: env.AUTH0_AUDIENCE } : null,
  clinicianEmails: (env.CLINICIAN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-3.8-flash' } : null,
  demoPatientId: env.DEMO_PATIENT_ID || '00000000-0000-4000-8000-000000000001',
  /** Dates are bucketed in the patient's local day. One timezone is enough for the demo. */
  timezone: 'America/New_York',
};

/**
 * Connection options for a Postgres URL. Tiger Cloud's URLs say sslmode=require, and its
 * certificates come from Timescale's own CA, which Node doesn't trust. node-postgres reads
 * `require` as verify-full and refuses to connect, so give it the meaning psql gives it:
 * encrypted, certificate not checked.
 */
export function pgOptions(url: string): { connectionString: string; ssl?: { rejectUnauthorized: false } } {
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    if (mode !== 'require' && mode !== 'prefer') return { connectionString: url };
    u.searchParams.delete('sslmode');
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
  } catch {
    return { connectionString: url };
  }
}
