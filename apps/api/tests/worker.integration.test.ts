import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ingerir } from '../src/rag/ingest';
import { FakeEmbeddingProvider } from '../src/rag/embeddings';
import { reiniciarLimitador, tratar, type WorkerBindings } from '../src/worker';
import { bancoLimpo, databaseUrl, PASTA_BASE } from './helpers';

const conexao = await bancoLimpo();
afterAll(() => conexao.close());

/** `env.AI` de mentira: embeddings por hash e um texto fixo; conta as chamadas. */
function criarAi() {
  const fake = new FakeEmbeddingProvider();
  const chamadas: string[] = [];
  return {
    chamadas,
    ai: {
      async run(modelo: string, entrada: Record<string, unknown>) {
        chamadas.push(modelo);
        if (modelo === '@cf/baai/bge-m3') {
          return { data: await fake.embed(entrada.text as string[]) };
        }
        return {
          response: 'Aceitamos Pix e cartão. [1]',
          usage: { prompt_tokens: 600, completion_tokens: 30 },
        };
      },
    },
  };
}

const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined) };
const pedido = (corpo: unknown) =>
  new Request('https://exemplo.test/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify(corpo),
  });

beforeEach(async () => {
  reiniciarLimitador();
  await conexao.db.execute(sql`TRUNCATE conversa RESTART IDENTITY CASCADE`);
  await ingerir(conexao.db, new FakeEmbeddingProvider(), PASTA_BASE);
});

function bindings(ai: ReturnType<typeof criarAi>['ai'], extra: Record<string, unknown> = {}) {
  return {
    AI: ai,
    HYPERDRIVE: { connectionString: databaseUrl() },
    IP_HEADER: 'cf-connecting-ip',
    // Os embeddings de mentira pontuam baixo (só contam palavras iguais): limite baixo nos testes.
    SIMILARIDADE_MINIMA: '0.05',
    ...extra,
  } satisfies WorkerBindings;
}

describe('Worker de ponta a ponta (banco real, IA de mentira)', () => {
  it('responde uma pergunta da base e registra a conversa', async () => {
    const { ai } = criarAi();
    const r = await tratar(pedido({ pergunta: 'Vocês aceitam Pix?' }), bindings(ai), ctx);
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { tipo: string; conversaId: string | null };
    expect(corpo.tipo).toBe('resposta');
    expect(corpo.conversaId).toBeTruthy();
    const linhas = await conexao.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM mensagem`,
    );
    expect(linhas.rows[0]?.total).toBeGreaterThan(0);
  });

  it('recusa sem chamar o modelo de texto quando nada na base se parece', async () => {
    const { ai, chamadas } = criarAi();
    const r = await tratar(pedido({ pergunta: 'zzz qqq xxx' }), bindings(ai), ctx);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { tipo: string }).tipo).toBe('recusa');
    expect(chamadas.filter((m) => m !== '@cf/baai/bge-m3')).toHaveLength(0);
  });

  it('aplica o limite por minuto usando o cabeçalho de IP configurado', async () => {
    const { ai } = criarAi();
    const b = bindings(ai, { LIMITE_POR_MINUTO: '2' });
    expect((await tratar(pedido({ pergunta: 'Vocês aceitam Pix?' }), b, ctx)).status).toBe(200);
    expect((await tratar(pedido({ pergunta: 'Vocês aceitam Pix?' }), b, ctx)).status).toBe(200);
    const terceira = await tratar(pedido({ pergunta: 'Vocês aceitam Pix?' }), b, ctx);
    expect(terceira.status).toBe(429);
    expect(terceira.headers.get('Retry-After')).toBeTruthy();
  });

  it('o health responde sem tocar no modelo', async () => {
    const { ai, chamadas } = criarAi();
    const r = await tratar(new Request('https://exemplo.test/api/health'), bindings(ai), ctx);
    expect(await r.json()).toEqual({ status: 'ok' });
    expect(chamadas).toHaveLength(0);
  });
});
