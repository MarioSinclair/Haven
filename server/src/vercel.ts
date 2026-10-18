import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from './app';
import { config } from './config';

/**
 * The API as one Vercel function (bundled by scripts/vercel-build.mjs). Without Auth0 every
 * request would be the demo clinician, so a deploy missing its keys answers nothing instead.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (!config.auth0) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Sign-in is not set up on this deploy: set AUTH0_DOMAIN and AUTH0_AUDIENCE.' }));
    return;
  }
  app(req, res);
}
