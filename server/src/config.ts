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
