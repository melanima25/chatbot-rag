/** Único arquivo que conhece o driver do Postgres. */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db: Db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export { schema };
