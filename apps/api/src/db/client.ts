/** Único arquivo que conhece o driver do Postgres. */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/** `max`: conexões do pool. No Worker uso 1 por pedido (o Hyperdrive é quem mantém o pool de verdade). */
export function createDb(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max });
  const db: Db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export { schema };
