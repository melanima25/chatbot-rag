import { serve } from '@hono/node-server';
import { createApp } from './app';
import { combinar, criarLimitador } from './chat/limitador';
import { criarRepositorio } from './chat/repositorio';
import { createDb } from './db/client';
import { parseEnv } from './env';
import { criarProvedor } from './rag/embeddings';
import { criarLlm } from './rag/llm';
import { responder } from './rag/responder';

const env = parseEnv();
const { db } = createDb(env.DATABASE_URL);
const embeddings = criarProvedor(env);
const llm = criarLlm(env);

const app = createApp({
  repositorio: criarRepositorio(db),
  limitador: combinar(
    criarLimitador({ max: env.LIMITE_POR_MINUTO, janelaMs: 60_000 }),
    criarLimitador({ max: env.LIMITE_POR_HORA, janelaMs: 3_600_000 }),
  ),
  limites: {
    perguntasPorConversa: env.LIMITE_PERGUNTAS_CONVERSA,
    tokensPorDia: env.ORCAMENTO_TOKENS_DIA,
  },
  ipHeader: env.IP_HEADER,
  corsOrigens: env.CORS_ORIGENS,
  responder: (pergunta) =>
    responder(db, embeddings, llm, pergunta, {
      k: env.TOP_K,
      similaridadeMinima: env.SIMILARIDADE_MINIMA,
      margemContexto: env.MARGEM_CONTEXTO,
      maxTokens: env.MAX_TOKENS_RESPOSTA,
    }),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API em http://localhost:${info.port}`);
});
