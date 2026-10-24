import { count, sql } from 'drizzle-orm';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../src/db/client';
import { buscarTrechos } from '../src/rag/busca';
import { FakeEmbeddingProvider, type EmbeddingProvider } from '../src/rag/embeddings';
import { ingerir } from '../src/rag/ingest';
import { bancoLimpo, PASTA_BASE } from './helpers';

const conexao = await bancoLimpo();
const { db } = conexao;
const fake = new FakeEmbeddingProvider();
const pastas: string[] = [];

async function pastaTemporaria(arquivos: Record<string, string>) {
  const pasta = await mkdtemp(join(tmpdir(), 'base-'));
  pastas.push(pasta);
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    await writeFile(join(pasta, nome), conteudo);
  }
  return pasta;
}

const contar = async (tabela: typeof schema.documento | typeof schema.trecho) => {
  const [r] = await db.select({ n: count() }).from(tabela);
  return r?.n ?? 0;
};

beforeEach(async () => {
  await db.execute(sql`TRUNCATE documento RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await conexao.close();
  await Promise.all(pastas.map((p) => rm(p, { recursive: true, force: true })));
});

describe('esquema do banco', () => {
  it('tem a extensão vector, a coluna vector(1024) e o índice HNSW', async () => {
    const ext = await db.execute(sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rows).toHaveLength(1);

    const col = await db.execute(
      sql`SELECT format_type(atttypid, atttypmod) AS tipo FROM pg_attribute
          WHERE attrelid = 'trecho'::regclass AND attname = 'embedding'`,
    );
    expect(col.rows[0]).toEqual({ tipo: 'vector(1024)' });

    const idx = await db.execute(
      sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'trecho_embedding_hnsw_idx'`,
    );
    expect(String(idx.rows[0]?.indexdef)).toContain('USING hnsw');
  });
});

describe('ingestão da base de conhecimento real', () => {
  it('grava todos os arquivos, com vetores de 1024 posições', async () => {
    const arquivos = (await readdir(PASTA_BASE)).filter((n) => n.endsWith('.md'));
    const r = await ingerir(db, fake, PASTA_BASE);

    expect(r.novos).toHaveLength(arquivos.length);
    expect(await contar(schema.documento)).toBe(arquivos.length);
    expect(r.trechosGravados).toBeGreaterThanOrEqual(arquivos.length);
    expect(await contar(schema.trecho)).toBe(r.trechosGravados);

    const dims = await db.execute(sql`SELECT DISTINCT vector_dims(embedding) AS d FROM trecho`);
    expect(dims.rows).toEqual([{ d: 1024 }]);
  });

  it('rodar de novo não muda nada (idempotente)', async () => {
    await ingerir(db, fake, PASTA_BASE);
    const antesDocs = await contar(schema.documento);
    const antesTrechos = await contar(schema.trecho);

    const r = await ingerir(db, fake, PASTA_BASE);
    expect(r.novos).toEqual([]);
    expect(r.atualizados).toEqual([]);
    expect(r.removidos).toEqual([]);
    expect(r.inalterados).toHaveLength(antesDocs);
    expect(r.trechosGravados).toBe(0);
    expect(await contar(schema.trecho)).toBe(antesTrechos);
  });
});

describe('mudanças na pasta', () => {
  it('arquivo alterado troca os trechos antigos pelos novos, sem duplicar', async () => {
    const pasta = await pastaTemporaria({
      'a.md': '# A\n\nAbrimos às 8h.',
      'b.md': '# B\n\nAceitamos Pix.',
    });
    await ingerir(db, fake, pasta);

    await writeFile(join(pasta, 'a.md'), '# A\n\nAgora abrimos às 9h.');
    const r = await ingerir(db, fake, pasta);

    expect(r.atualizados).toEqual(['a.md']);
    expect(r.inalterados).toEqual(['b.md']);
    expect(await contar(schema.documento)).toBe(2);
    const textos = (await db.select({ t: schema.trecho.texto }).from(schema.trecho)).map(
      (x) => x.t,
    );
    expect(textos.some((t) => t.includes('9h'))).toBe(true);
    expect(textos.some((t) => t.includes('8h'))).toBe(false);
  });

  it('arquivo que sumiu da pasta é removido, com os trechos', async () => {
    const pasta = await pastaTemporaria({ 'a.md': '# A\n\ntexto a', 'b.md': '# B\n\ntexto b' });
    await ingerir(db, fake, pasta);
    await rm(join(pasta, 'b.md'));

    const r = await ingerir(db, fake, pasta);
    expect(r.removidos).toEqual(['b.md']);
    expect(await contar(schema.documento)).toBe(1);
    expect(await contar(schema.trecho)).toBe(1);
  });

  it('mesmo conteúdo com quebras de linha do Windows (CRLF) não conta como mudança', async () => {
    const pasta = await pastaTemporaria({ 'a.md': '# A\n\nlinha 1\n\nlinha 2\n' });
    await ingerir(db, fake, pasta);
    await writeFile(join(pasta, 'a.md'), '# A\r\n\r\nlinha 1\r\n\r\nlinha 2\r\n');
    expect((await ingerir(db, fake, pasta)).inalterados).toEqual(['a.md']);
  });

  it('trocar o modelo de embedding obriga a reingerir tudo', async () => {
    const pasta = await pastaTemporaria({ 'a.md': '# A\n\ntexto' });
    await ingerir(db, fake, pasta);

    const outro: EmbeddingProvider = {
      modelo: 'outro-modelo',
      dimensoes: 1024,
      embed: (t) => fake.embed(t),
    };
    const r = await ingerir(db, outro, pasta);
    expect(r.atualizados).toEqual(['a.md']);
    const [doc] = await db.select().from(schema.documento);
    expect(doc?.modeloEmbedding).toBe('outro-modelo');
  });

  it('se o provedor falha, nada fica gravado pela metade', async () => {
    const pasta = await pastaTemporaria({ 'a.md': '# A\n\ntexto' });
    const quebrado: EmbeddingProvider = {
      modelo: 'quebrado',
      dimensoes: 1024,
      embed: () => Promise.reject(new Error('API fora do ar')),
    };
    await expect(ingerir(db, quebrado, pasta)).rejects.toThrow('API fora do ar');
    expect(await contar(schema.documento)).toBe(0);
    expect(await contar(schema.trecho)).toBe(0);
  });

  it('arquivo vazio vira documento sem trechos', async () => {
    const pasta = await pastaTemporaria({ 'vazio.md': '---\ntitulo: Vazio\n---\n' });
    const r = await ingerir(db, fake, pasta);
    expect(r.novos).toEqual(['vazio.md']);
    expect(await contar(schema.trecho)).toBe(0);
  });
});

describe('busca por similaridade (pgvector)', () => {
  // Provedor de mentira: só acha o que tem palavras em comum. Aqui só provamos o encanamento
  // (ingestão -> pgvector -> ordenação); a qualidade com o modelo real é medida nos evals (S18).
  const casos: Array<[string, string]> = [
    ['Qual o horário de funcionamento aos sábados?', '02-horario-de-funcionamento.md'],
    ['Vocês aceitam cheque?', '08-formas-de-pagamento.md'],
    ['Posso levar um caminhão ou ônibus?', '12-veiculos-atendidos.md'],
    ['Como funciona o cartão fidelidade?', '10-pacotes-e-fidelidade.md'],
    ['Tem estacionamento e Wi-Fi para esperar?', '03-localizacao-e-estacionamento.md'],
    ['Em quanto tempo posso cancelar sem custo?', '07-cancelamento-e-remarcacao.md'],
  ];

  it.each(casos)('"%s" encontra %s no primeiro lugar', async (pergunta, esperado) => {
    await ingerir(db, fake, PASTA_BASE);
    const [primeiro] = await buscarTrechos(db, fake, pergunta, 3);
    expect(primeiro?.documentoCaminho).toBe(esperado);
  });

  it('devolve no máximo k resultados, do mais parecido para o menos', async () => {
    await ingerir(db, fake, PASTA_BASE);
    const r = await buscarTrechos(db, fake, 'preço da lavagem completa', 3);
    expect(r).toHaveLength(3);
    expect(r[0]!.similaridade).toBeGreaterThanOrEqual(r[1]!.similaridade);
    expect(r[1]!.similaridade).toBeGreaterThanOrEqual(r[2]!.similaridade);
  });

  it('com o banco vazio devolve lista vazia', async () => {
    expect(await buscarTrechos(db, fake, 'qualquer coisa')).toEqual([]);
  });
});
