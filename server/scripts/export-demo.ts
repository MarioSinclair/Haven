// Saves the demo patient's dashboard data into the web app, so the judges page has something
// to show even when the server is unreachable. Re-run after reseeding or moving to Tiger:
//   npm run export-demo
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DemoBundle } from '../../web/src/lib/apiTypes';
import { config } from '../src/config';
import { pool } from '../src/db';
import { loadProgress } from '../src/progress';
import { latestReport } from '../src/report';
import { loadBandTrace, systemStats } from '../src/telemetry';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../web/src/fixtures/demo.json');
const id = config.demoPatientId;
const bundle: DemoBundle = {
  progress: await loadProgress(id),
  bandTrace: await loadBandTrace(id),
  system: await systemStats(),
  report: await latestReport(id),
};
writeFileSync(out, JSON.stringify(bundle));
console.log(`wrote ${out} (${bundle.progress.flags.length} flags, ${bundle.bandTrace?.points.length ?? 0} trace points, report: ${bundle.report ? 'yes' : 'none'})`);
await pool?.end();
