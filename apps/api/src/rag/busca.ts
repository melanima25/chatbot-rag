import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '../db/client';
import type { EmbeddingProvider } from './embeddings';

export type ResultadoBusca = {
  texto: string;
  documentoTitulo: string;
  documentoCaminho: string;
  ordem: number;
  /** 1 = idêntico; perto de 0 = nada a ver (similaridade de cosseno). */
  similaridade: number;
};

/** Os `k` trechos mais parecidos com a pergunta (busca por cosseno no pgvector). */
export async function buscarTrechos(
  db: Db,
  provedor: EmbeddingProvider,
  pergunta: string,
  k = 4,
): Promise<ResultadoBusca[]> {
  const [vetor] = await provedor.embed([pergunta]);
  if (!vetor) throw new Error('O provedor não devolveu vetor para a pergunta');

  const similaridade = sql<number>`1 - (${cosineDistance(schema.trecho.embedding, vetor)})`;
  const linhas = await db
    .select({
      texto: schema.trecho.texto,
      documentoTitulo: schema.documento.titulo,
      documentoCaminho: schema.documento.caminho,
      ordem: schema.trecho.ordem,
      similaridade,
    })
    .from(schema.trecho)
    .innerJoin(schema.documento, eq(schema.documento.id, schema.trecho.documentoId))
    .orderBy(desc(similaridade))
    .limit(k);
  return linhas.map((l) => ({ ...l, similaridade: Number(l.similaridade) }));
}
