import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

export const PASTA_BASE = fileURLToPath(new URL('../../../base-conhecimento', import.meta.url));

export const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (banco de TESTE: ele é apagado a cada teste)');
  return url;
};

/** Aplica as migrations e devolve um banco limpo. */
export async function bancoLimpo() {
  await runMigrations(databaseUrl());
  const conexao = createDb(databaseUrl());
  await conexao.db.execute(sql`TRUNCATE documento RESTART IDENTITY CASCADE`);
  return conexao;
}
