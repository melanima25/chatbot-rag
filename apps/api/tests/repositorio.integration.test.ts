import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { criarRepositorio } from '../src/chat/repositorio';
import { schema } from '../src/db/client';
import type { Resultado } from '../src/rag/responder';
import { bancoLimpo } from './helpers';

const conexao = await bancoLimpo();
const { db } = conexao;
const repo = criarRepositorio(db);

afterAll(() => conexao.close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE conversa RESTART IDENTITY CASCADE`);
});

const resposta: Resultado = {
  tipo: 'resposta',
  texto: 'Aceitamos Pix. [1]',
  fontes: [],
  uso: { tokensEntrada: 600, tokensSaida: 40 },
};
const recusa: Resultado = {
  tipo: 'recusa',
  texto: 'Não encontrei.',
  fontes: [],
  motivoRecusa: 'sem_trechos_relevantes',
};

describe('repositório de conversas', () => {
  it('sem conversaId cria a conversa e guarda pergunta e resposta, com os tokens reais', async () => {
    const id = await repo.registrarTroca({ pergunta: 'Aceitam Pix?', resultado: resposta });

    const msgs = await db.select().from(schema.mensagem).orderBy(schema.mensagem.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ conversaId: id, papel: 'cliente', texto: 'Aceitam Pix?' });
    expect(msgs[0]?.tokensEntrada).toBeNull();
    expect(msgs[1]).toMatchObject({
      papel: 'assistente',
      tipo: 'resposta',
      tokensEntrada: 600,
      tokensSaida: 40,
    });
  });

  it('com conversaId continua a mesma conversa e conta só as perguntas do cliente', async () => {
    const id = await repo.registrarTroca({ pergunta: 'Aceitam Pix?', resultado: resposta });
    const mesmo = await repo.registrarTroca({
      conversaId: id,
      pergunta: 'Capital da França?',
      resultado: recusa,
    });

    expect(mesmo).toBe(id);
    expect(await repo.perguntasDaConversa(id)).toBe(2);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM conversa`)).rows as [
      { n: number },
    ];
    expect(n).toBe(1);
  });

  it('recusa guarda o motivo e nenhum token', async () => {
    await repo.registrarTroca({ pergunta: 'Capital da França?', resultado: recusa });
    const [assistente] = await db
      .select()
      .from(schema.mensagem)
      .where(sql`papel = 'assistente'`);
    expect(assistente).toMatchObject({
      tipo: 'recusa',
      motivoRecusa: 'sem_trechos_relevantes',
      tokensEntrada: null,
      tokensSaida: null,
    });
  });

  it('conversa inexistente devolve null; com UUID válido porém desconhecido também', async () => {
    expect(await repo.perguntasDaConversa('3f2b8c1e-5d4a-4e7b-9a10-2c6f8e1d7b90')).toBeNull();
  });

  it('tokens de hoje soma entrada + saída das mensagens de hoje e ignora as de ontem', async () => {
    expect(await repo.tokensDeHoje()).toBe(0);
    await repo.registrarTroca({ pergunta: 'a?', resultado: resposta });
    await repo.registrarTroca({ pergunta: 'b?', resultado: recusa }); // sem tokens
    expect(await repo.tokensDeHoje()).toBe(640);

    await db.execute(
      sql`UPDATE mensagem SET criada_em = criada_em - interval '2 days' WHERE tokens_entrada IS NOT NULL`,
    );
    expect(await repo.tokensDeHoje()).toBe(0);
  });

  it('apagar a conversa apaga as mensagens (cascata)', async () => {
    await repo.registrarTroca({ pergunta: 'a?', resultado: resposta });
    await db.execute(sql`DELETE FROM conversa`);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM mensagem`)).rows as [
      { n: number },
    ];
    expect(n).toBe(0);
  });
});
