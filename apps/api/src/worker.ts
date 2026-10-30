/**
 * Entrada do Cloudflare Worker (deploy). Faz o mesmo que `index.ts` faz no Node, trocando:
 *  - o servidor HTTP pelo `fetch` do Worker;
 *  - o token do Workers AI pelo binding `env.AI`;
 *  - o banco direto pelo Hyperdrive (`env.HYPERDRIVE`), que mantém o pool até o Neon.
 * A página (`apps/web`) é servida pelos "static assets" do Wrangler; o Worker só recebe `/api/*`
 * (ver `run_worker_first` em wrangler.jsonc).
 */
import { createApp } from './app';
import { combinar, criarLimitador, type Limitador } from './chat/limitador';
import { criarRepositorio } from './chat/repositorio';
import { createDb } from './db/client';
import { parseEnv, type Env } from './env';
import { responder } from './rag/responder';
import {
  BindingEmbeddingProvider,
  BindingLlmProvider,
  type AiBinding,
} from './rag/workers-ai-binding';

export type WorkerBindings = {
  AI: AiBinding;
  HYPERDRIVE: { connectionString: string };
  /** Variáveis de texto do wrangler.jsonc ("vars") e segredos. Todas opcionais: há padrões. */
  [variavel: string]: unknown;
};

export type ContextoExecucao = { waitUntil(promessa: Promise<unknown>): void };

/**
 * Monta a configuração a partir dos bindings. Os provedores aqui são os do binding, não os do
 * `parseEnv`; por isso pedimos "fake" a ele (que só exige token para "workers-ai") e ignoramos
 * esses dois campos.
 */
export function ambienteDoWorker(bindings: WorkerBindings): Env {
  const texto: Record<string, string | undefined> = {};
  for (const [chave, valor] of Object.entries(bindings)) {
    if (typeof valor === 'string') texto[chave] = valor;
  }
  return parseEnv({
    ...texto,
    DATABASE_URL: bindings.HYPERDRIVE.connectionString,
    EMBEDDING_PROVIDER: 'fake',
    LLM_PROVIDER: 'fake',
  });
}

/** O limitador vive na memória da instância (isolate): vale por instância, não no mundo todo. */
let limitador: Limitador | undefined;

/** Só para os testes: começa de novo a contagem de pedidos por IP. */
export function reiniciarLimitador(): void {
  limitador = undefined;
}

export async function tratar(
  request: Request,
  bindings: WorkerBindings,
  ctx: ContextoExecucao,
): Promise<Response> {
  const env = ambienteDoWorker(bindings);
  limitador ??= combinar(
    criarLimitador({ max: env.LIMITE_POR_MINUTO, janelaMs: 60_000 }),
    criarLimitador({ max: env.LIMITE_POR_HORA, janelaMs: 3_600_000 }),
  );

  // Uma conexão por pedido, fechada depois da resposta. O Hyperdrive reaproveita as de verdade.
  const { db, close } = createDb(env.DATABASE_URL, 1);

  const embeddings = new BindingEmbeddingProvider(bindings.AI);
  const llm = new BindingLlmProvider(bindings.AI, env.LLM_MODEL);

  const app = createApp({
    repositorio: criarRepositorio(db),
    limitador,
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
  try {
    return await app.fetch(request, bindings, ctx as never);
  } finally {
    // Só fecha depois da resposta pronta (fechar antes derrubaria as consultas do próprio pedido).
    ctx.waitUntil(close().catch(() => undefined));
  }
}

export default {
  fetch: (request: Request, env: WorkerBindings, ctx: ContextoExecucao) =>
    tratar(request, env, ctx),
};
