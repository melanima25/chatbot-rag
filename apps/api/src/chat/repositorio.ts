import { and, count, eq, gte, sql } from 'drizzle-orm';
import { schema, type Db } from '../db/client';
import type { Resultado } from '../rag/responder';

/** O que a rota precisa guardar e consultar. Os testes da rota usam uma versão de mentira. */
export type Repositorio = {
  /** Quantas perguntas a conversa já tem; `null` se ela não existe. */
  perguntasDaConversa(conversaId: string): Promise<number | null>;
  /** Tokens (entrada + saída) gastos desde 00:00 UTC, a hora em que a cota grátis zera. */
  tokensDeHoje(): Promise<number>;
  /** Guarda a pergunta e a resposta. Sem `conversaId`, cria a conversa. Devolve o id. */
  registrarTroca(dados: {
    conversaId?: string;
    pergunta: string;
    resultado: Resultado;
  }): Promise<string>;
};

const INICIO_DO_DIA_UTC = sql`(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

export function criarRepositorio(db: Db): Repositorio {
  return {
    async perguntasDaConversa(conversaId) {
      const [existe] = await db
        .select({ id: schema.conversa.id })
        .from(schema.conversa)
        .where(eq(schema.conversa.id, conversaId));
      if (!existe) return null;
      const [linha] = await db
        .select({ n: count() })
        .from(schema.mensagem)
        .where(
          and(eq(schema.mensagem.conversaId, conversaId), eq(schema.mensagem.papel, 'cliente')),
        );
      return linha?.n ?? 0;
    },

    async tokensDeHoje() {
      const [linha] = await db
        .select({
          total: sql<string>`coalesce(sum(coalesce(${schema.mensagem.tokensEntrada}, 0) + coalesce(${schema.mensagem.tokensSaida}, 0)), 0)`,
        })
        .from(schema.mensagem)
        .where(gte(schema.mensagem.criadaEm, INICIO_DO_DIA_UTC));
      return Number(linha?.total ?? 0);
    },

    async registrarTroca({ conversaId, pergunta, resultado }) {
      return db.transaction(async (tx) => {
        let id = conversaId;
        if (!id) {
          const [nova] = await tx
            .insert(schema.conversa)
            .values({})
            .returning({ id: schema.conversa.id });
          if (!nova) throw new Error('Não foi possível criar a conversa');
          id = nova.id;
        }
        await tx.insert(schema.mensagem).values([
          { conversaId: id, papel: 'cliente', texto: pergunta },
          {
            conversaId: id,
            papel: 'assistente',
            texto: resultado.texto,
            tipo: resultado.tipo,
            motivoRecusa: resultado.motivoRecusa ?? null,
            tokensEntrada: resultado.uso?.tokensEntrada ?? null,
            tokensSaida: resultado.uso?.tokensSaida ?? null,
          },
        ]);
        return id;
      });
    },
  };
}
