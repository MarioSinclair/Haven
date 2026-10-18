import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError } from './db';
import { api } from './routes';

/** The API on its own: index.ts serves it locally, vercel.ts runs it as one Vercel function. */
export const app = express();
app.use(express.json({ limit: '10mb' })); // a 10-minute band trace at 20 Hz is ~0.5 MB
app.use('/api', api);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : ((err as { status?: number }).status ?? 500);
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});
