// Builds the app for Vercel in its Build Output format: the web app as static files and the API
// as one bundled Node function at /api. Vercel runs this after building the web app (vercel.json);
// to try it locally:
//   npm --prefix web run build && node server/scripts/vercel-build.mjs
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, '.vercel/output');
const fn = join(out, 'functions/api.func');

rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'web/dist'), join(out, 'static'), { recursive: true });

mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [join(root, 'server/src/vercel.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // pg's optional native driver isn't installed.
  external: ['pg-native'],
  // Bundled CommonJS packages (Express, pg) still require() Node's built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
json(join(fn, '.vc-config.json'), { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 });
json(join(out, 'config.json'), {
  version: 3,
  routes: [
    // The function sees the original path, which Express routes on.
    { src: '^/api(/.*)?$', dest: '/api' },
    { handle: 'filesystem' },
    { src: '^/judges/?$', dest: '/judges/index.html' },
    // Everything else is the single-page app.
    { src: '^/.*$', dest: '/index.html' },
  ],
});
console.log(`Wrote ${out}`);
