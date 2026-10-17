import type { BandTrace, SystemStats } from '../../web/src/lib/apiTypes';
import { config } from './config';
import { db } from './db';

const TRACE_HZ = 2;

/** The most recent exercise session's band stream, max-pooled to 2 Hz so peaks survive. */
export async function loadBandTrace(patientId: string): Promise<BandTrace | null> {
  const session = (
    await db().query(
      `select id, started_at from sessions s
        where patient_id = $1 and kind = 'exercise' and exists (select 1 from band_samples b where b.session_id = s.id)
        order by started_at desc limit 1`,
      [patientId],
    )
  ).rows[0];
  if (!session) return null;

  const rows = (
    await db().query(
      `select floor(extract(epoch from (t - $2::timestamptz)) * $3) / $3 as s, max(elevation_deg) as deg, count(*) as n
         from band_samples where session_id = $1 group by 1 order by 1`,
      [session.id, session.started_at, TRACE_HZ],
    )
  ).rows;

  return {
    sessionId: session.id,
    startedAt: new Date(session.started_at).toISOString(),
    rawSamples: rows.reduce((sum, r) => sum + r.n, 0),
    hz: TRACE_HZ,
    points: rows.map((r) => ({ s: r.s, deg: Math.round(r.deg * 10) / 10 })),
  };
}

const TABLES = ['band_samples', 'reps', 'daily_use', 'sessions', 'sets'];

/** Row counts everywhere; chunk and columnstore numbers where TimescaleDB is installed. */
export async function systemStats(): Promise<SystemStats> {
  const q = db();
  const ext = (await q.query(`select extversion from pg_extension where extname = 'timescaledb'`)).rows[0];
  const host = safeHost(config.databaseUrl);
  const onTiger = /timescale|tigerdata|tsdb/.test(host);
  const pgVersion = ((await q.query('show server_version')).rows[0].server_version as string).split(' ')[0];

  const hyper = new Map<string, number>();
  const caggs: string[] = [];
  if (ext) {
    for (const r of (await q.query('select hypertable_name, num_chunks from timescaledb_information.hypertables')).rows) hyper.set(r.hypertable_name, r.num_chunks);
    for (const r of (await q.query('select view_name from timescaledb_information.continuous_aggregates order by view_name')).rows) caggs.push(r.view_name);
  }

  const tables = [];
  for (const name of TABLES) {
    const rows = (await q.query(`select count(*) as n from ${name}`)).rows[0].n as number;
    let compressedChunks: number | null = null;
    let beforeBytes: number | null = null;
    let afterBytes: number | null = null;
    if (hyper.has(name)) {
      // Renamed from hypertable_compression_stats in TimescaleDB 2.18; try both.
      for (const fn of ['hypertable_columnstore_stats', 'hypertable_compression_stats']) {
        const res = await q.query(`select * from ${fn}($1)`, [name]).catch(() => null);
        const r = res?.rows[0];
        if (!r) continue;
        compressedChunks = r.number_compressed_chunks ?? null;
        beforeBytes = r.before_compression_total_bytes ?? null;
        afterBytes = r.after_compression_total_bytes ?? null;
        break;
      }
    }
    tables.push({ name, rows, hypertable: hyper.has(name), chunks: hyper.get(name) ?? null, compressedChunks, beforeBytes, afterBytes });
  }

  return {
    engine: ext ? `${onTiger ? 'Tiger Cloud · ' : ''}TimescaleDB ${ext.extversion} · Postgres ${pgVersion}` : `Postgres ${pgVersion}`,
    timescale: !!ext,
    tables,
    continuousAggregates: caggs,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
