// Applies db/migrations in order (skipping ones already applied), then optionally loads the seed.
//   npm run db:setup            # migrations only
//   npm run db:setup -- --seed  # migrations + demo patient
// 002_timescale.sql only runs where the timescaledb extension is available (Tiger Cloud).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '../../db');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL in server/.env first');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const applied = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  const timescale = (await client.query(`select 1 from pg_available_extensions where name = 'timescaledb'`)).rowCount! > 0;

  for (const file of readdirSync(join(dbDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    if (file.includes('timescale') && !timescale) {
      console.log(`skip ${file} (no timescaledb on this server)`);
      continue;
    }
    console.log(`apply ${file}`);
    await client.query(readFileSync(join(dbDir, 'migrations', file), 'utf8'));
    await client.query('insert into schema_migrations (name) values ($1)', [file]);
  }

  if (process.argv.includes('--seed')) {
    console.log('load seed.sql');
    await client.query(readFileSync(join(dbDir, 'seed.sql'), 'utf8'));
    const counts = (
      await client.query('select (select count(*) from sessions) as sessions, (select count(*) from reps) as reps, (select count(*) from band_samples) as band_samples')
    ).rows[0];
    console.log(`seeded: ${counts.sessions} sessions, ${counts.reps} reps, ${counts.band_samples} band samples`);
  }
} finally {
  await client.end();
}
