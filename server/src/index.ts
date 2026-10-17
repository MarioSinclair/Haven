import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { HttpError } from './db';
import { api } from './routes';

const app = express();
app.use(express.json({ limit: '10mb' })); // a 10-minute band trace at 20 Hz is ~0.5 MB
app.use('/api', api);

// In production the server also serves the built web app, so one deploy covers the domain.
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : ((err as { status?: number }).status ?? 500);
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`API on http://localhost:${config.port}/api`);
  console.log(`  database: ${config.databaseUrl ? 'configured' : 'NOT SET (DATABASE_URL)'}`);
  console.log(`  auth0:    ${config.auth0 ? config.auth0.domain : 'off (dev mode: every request is the demo clinician)'}`);
  console.log(`  gemini:   ${config.gemini ? config.gemini.model : 'off (GEMINI_API_KEY not set)'}`);
});
