import pg from 'pg';
import { config, pgOptions } from './config';

// Return dates as YYYY-MM-DD strings instead of shifting them through the server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// Aggregates like count() and sum() come back as bigint/numeric strings; the values here are small.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

// A database that's down or asleep fails requests after 5 s instead of hanging them.
export const pool = config.databaseUrl ? new pg.Pool({ ...pgOptions(config.databaseUrl), max: 5, connectionTimeoutMillis: 5_000 }) : null;

export function db(): pg.Pool {
  if (!pool) throw new HttpError(503, 'DATABASE_URL is not set');
  return pool;
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
