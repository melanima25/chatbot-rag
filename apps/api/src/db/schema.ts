import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIM } from '../rag/constantes';

/** Um arquivo Markdown da base de conhecimento. */
export const documento = pgTable('documento', {
  id: serial('id').primaryKey(),
  /** Nome do arquivo dentro da pasta da base (único). */
  caminho: text('caminho').notNull().unique(),
  titulo: text('titulo').notNull(),
  /** SHA-256 do conteúdo: se não mudou (e o modelo é o mesmo), a ingestão pula o arquivo. */
  hashConteudo: text('hash_conteudo').notNull(),
  /** Modelo que gerou os embeddings; trocar de modelo obriga a reingerir. */
  modeloEmbedding: text('modelo_embedding').notNull(),
  ingeridoEm: timestamp('ingerido_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Um pedaço de um documento, com o vetor usado na busca por similaridade. */
export const trecho = pgTable(
  'trecho',
  {
    id: serial('id').primaryKey(),
    documentoId: integer('documento_id')
      .notNull()
      .references(() => documento.id, { onDelete: 'cascade' }),
    ordem: integer('ordem').notNull(),
    texto: text('texto').notNull(),
    /** Estimativa (caracteres / 4), não a contagem real do tokenizador. */
    tokens: integer('tokens').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
  },
  (t) => [
    uniqueIndex('trecho_documento_ordem_uq').on(t.documentoId, t.ordem),
    index('trecho_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);
