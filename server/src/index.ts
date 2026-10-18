import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './app';
import { config } from './config';

// In production the server also serves the built web app, so one deploy covers the domain.
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

// Dev mode makes every request the demo clinician, which is only safe on your own machine.
if (!config.auth0 && (process.env.NODE_ENV === 'production' || existsSync(webDist))) {
  console.error('Refusing to start in production without Auth0: set AUTH0_DOMAIN and AUTH0_AUDIENCE. (Delete web/dist to run locally in dev mode.)');
  process.exit(1);
}

if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.listen(config.port, () => {
  console.log(`API on http://localhost:${config.port}/api`);
  console.log(`  database: ${config.databaseUrl ? 'configured' : 'NOT SET (DATABASE_URL)'}`);
  console.log(`  auth0:    ${config.auth0 ? config.auth0.domain : 'off (dev mode: every request is the demo clinician)'}`);
  console.log(`  gemini:   ${config.gemini ? config.gemini.model : 'off (GEMINI_API_KEY not set)'}`);
});
