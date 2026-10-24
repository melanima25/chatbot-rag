import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { parseEnv } from '../env';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}

// Executa apenas quando chamado diretamente (npm run db:migrate)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = parseEnv();
  await runMigrations(env.DATABASE_URL);
  console.log('Migrations aplicadas.');
}
