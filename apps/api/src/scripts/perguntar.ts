import { createDb } from '../db/client';
import { parseEnv } from '../env';
import { criarProvedor } from '../rag/embeddings';
import { criarLlm } from '../rag/llm';
import { responder } from '../rag/responder';

const pergunta = process.argv.slice(2).join(' ').trim();
if (!pergunta) {
  console.error('Uso: npm run perguntar -- "sua pergunta"');
  process.exit(1);
}

const env = parseEnv();
const { db, close } = createDb(env.DATABASE_URL);
try {
  const r = await responder(db, criarProvedor(env), criarLlm(env), pergunta, {
    k: env.TOP_K,
    similaridadeMinima: env.SIMILARIDADE_MINIMA,
    margemContexto: env.MARGEM_CONTEXTO,
    maxTokens: env.MAX_TOKENS_RESPOSTA,
  });
  console.log(`\n[${r.tipo.toUpperCase()}${r.motivoRecusa ? `: ${r.motivoRecusa}` : ''}]`);
  console.log(r.texto);
  if (r.fontes.length) {
    console.log('\nFontes:');
    for (const f of r.fontes) {
      console.log(
        `  [${f.numero}]${f.citada ? '*' : ' '} ${f.documento} (${f.caminho}) similaridade ${f.similaridade.toFixed(3)}`,
      );
    }
    console.log('  (* = citada na resposta)');
  }
  if (r.uso?.tokensEntrada !== undefined) {
    console.log(
      `\nTokens: ${r.uso.tokensEntrada} de entrada, ${r.uso.tokensSaida ?? '?'} de saída`,
    );
  }
} finally {
  await close();
}
