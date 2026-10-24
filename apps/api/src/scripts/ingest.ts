import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDb } from '../db/client';
import { parseEnv } from '../env';
import { criarProvedor } from '../rag/embeddings';
import { ingerir } from '../rag/ingest';

const PASTA_PADRAO = fileURLToPath(new URL('../../../../base-conhecimento', import.meta.url));

const env = parseEnv();
const provedor = criarProvedor(env);
const pasta = process.argv[2] ? resolve(process.argv[2]) : PASTA_PADRAO;
const { db, close } = createDb(env.DATABASE_URL);

try {
  console.log(`Ingerindo ${pasta} com o modelo ${provedor.modelo}...`);
  const r = await ingerir(db, provedor, pasta);
  console.log(
    `Novos: ${r.novos.length} | atualizados: ${r.atualizados.length} | ` +
      `inalterados: ${r.inalterados.length} | removidos: ${r.removidos.length} | ` +
      `trechos gravados: ${r.trechosGravados}`,
  );
} finally {
  await close();
}
