import { createDb } from '../db/client';
import { parseEnv } from '../env';
import { buscarTrechos } from '../rag/busca';
import { criarProvedor } from '../rag/embeddings';

const pergunta = process.argv.slice(2).join(' ').trim();
if (!pergunta) {
  console.error('Uso: npm run buscar -- "sua pergunta"');
  process.exit(1);
}

const env = parseEnv();
const { db, close } = createDb(env.DATABASE_URL);
try {
  const resultados = await buscarTrechos(db, criarProvedor(env), pergunta, 4);
  for (const r of resultados) {
    console.log(`\n[${r.similaridade.toFixed(3)}] ${r.documentoTitulo} (${r.documentoCaminho})`);
    console.log(r.texto);
  }
} finally {
  await close();
}
