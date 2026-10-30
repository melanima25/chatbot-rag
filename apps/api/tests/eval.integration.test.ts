import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { estadoDoCaso, resumir } from '../src/eval/avaliar';
import type { CasoEval } from '../src/eval/casos';
import { rodarEval } from '../src/eval/rodar';
import { FakeEmbeddingProvider } from '../src/rag/embeddings';
import { ingerir } from '../src/rag/ingest';
import type { LlmProvider } from '../src/rag/llm';
import { bancoLimpo, PASTA_BASE } from './helpers';

const conexao = await bancoLimpo();
const { db } = conexao;
const embeddings = new FakeEmbeddingProvider();
// Limite baixo porque o provedor de mentira dá pontuações baixas (ver responder.integration.test.ts).
const opcoes = { similaridadeMinima: 0.05, k: 3, maxTokens: 100 };

beforeAll(async () => {
  await db.execute(sql`TRUNCATE documento RESTART IDENTITY CASCADE`);
  await ingerir(db, embeddings, PASTA_BASE);
});
afterAll(() => conexao.close());

const llmFixo = (texto: string): LlmProvider => ({
  modelo: 'stub',
  gerar: vi.fn().mockResolvedValue({ texto, tokensEntrada: 100, tokensSaida: 10 }),
});

const cheque: CasoEval = {
  id: 1,
  pergunta: 'Vocês aceitam cheque?',
  esperado: 'resposta',
  fonte: '08-formas-de-pagamento.md',
  deveConter: ['não aceit'],
};
const foraDaBase: CasoEval = { id: 2, pergunta: 'Qual a capital da França?', esperado: 'recusa' };

describe('rodarEval', () => {
  it('roda cada caso no responder de verdade e avalia: acerto, recusa correta e resumo', async () => {
    const llm = llmFixo('Não aceitamos cheque. [1]');
    const terminados: number[] = [];
    const resultados = await rodarEval({
      db,
      embeddings,
      llm,
      casos: [cheque, foraDaBase],
      opcoes,
      aoTerminarCaso: (rc) => terminados.push(rc.caso.id),
    });

    expect(terminados).toEqual([1, 2]);
    expect(resultados.map(estadoDoCaso)).toEqual(['passou', 'passou']);
    // a pergunta fora da base foi barrada pelo limite, sem chamar o modelo
    expect(llm.gerar).toHaveBeenCalledTimes(1);

    const r = resumir(resultados);
    expect(r.respostasEsperadas).toEqual({ total: 1, certas: 1, falsasRecusas: 0 });
    expect(r.recusasEsperadas).toEqual({ total: 1, certas: 1, respostasIndevidas: 0 });
    expect(r.fonte).toEqual({ total: 1, recuperada: 1, citada: 1 });
    expect(r.tokensEntrada).toBe(100);
  });

  it('repete cada pergunta e detecta o caso instável', async () => {
    const respostas = ['Não aceitamos cheque. [1]', 'Aceitamos cheque. [1]'];
    const llm: LlmProvider = {
      modelo: 'stub',
      gerar: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ texto: respostas.shift() ?? 'Não aceitamos cheque. [1]' }),
        ),
    };
    const [rc] = await rodarEval({ db, embeddings, llm, casos: [cheque], opcoes, repeticoes: 2 });
    expect(rc?.tentativas).toHaveLength(2);
    expect(rc && estadoDoCaso(rc)).toBe('instavel');
  });

  it('resposta indevida a uma pergunta fora da base é o erro grave e aparece no resumo', async () => {
    // limite 0 deixa tudo passar; o modelo "inventa"
    const resultados = await rodarEval({
      db,
      embeddings,
      llm: llmFixo('A capital da França é Paris. [1]'),
      casos: [foraDaBase],
      opcoes: { ...opcoes, similaridadeMinima: 0 },
    });
    const r = resumir(resultados);
    expect(r.recusasEsperadas.respostasIndevidas).toBe(1);
    expect(r.falhasNovas).toEqual([2]);
  });

  it('chamada que falha não derruba a avaliação: vira falha do caso e o próximo roda', async () => {
    let n = 0;
    const llm: LlmProvider = {
      modelo: 'stub',
      gerar: vi
        .fn()
        .mockImplementation(() =>
          ++n === 1
            ? Promise.reject(new Error('cota estourada'))
            : Promise.resolve({ texto: 'Não aceitamos cheque. [1]' }),
        ),
    };
    const resultados = await rodarEval({
      db,
      embeddings,
      llm,
      casos: [cheque, { ...cheque, id: 3 }],
      opcoes,
    });
    expect(resultados[0]?.tentativas[0]?.veredito.falhas[0]).toContain('cota estourada');
    expect(resultados[0]?.tentativas[0]?.resultado).toBeNull();
    expect(resultados.map(estadoDoCaso)).toEqual(['falhou', 'passou']);
  });
});
