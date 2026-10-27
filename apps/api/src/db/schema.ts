import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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

/**
 * Uma conversa do widget. Não guarda IP nem nenhum dado de quem perguntou: só o id (aleatório)
 * e a data. O limite por IP vive na memória do servidor e some junto com ele.
 */
export const conversa = pgTable('conversa', {
  id: uuid('id').primaryKey().defaultRandom(),
  criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Uma mensagem da conversa: a pergunta do cliente ou a resposta (ou recusa) do chatbot. */
export const mensagem = pgTable(
  'mensagem',
  {
    id: serial('id').primaryKey(),
    conversaId: uuid('conversa_id')
      .notNull()
      .references(() => conversa.id, { onDelete: 'cascade' }),
    papel: text('papel', { enum: ['cliente', 'assistente'] }).notNull(),
    texto: text('texto').notNull(),
    /** Só nas mensagens do assistente. */
    tipo: text('tipo', { enum: ['resposta', 'recusa'] }),
    motivoRecusa: text('motivo_recusa', {
      enum: ['sem_trechos_relevantes', 'modelo_sem_resposta'],
    }),
    /** Uso real informado pelo provedor; nulo quando o modelo de texto não foi chamado. */
    tokensEntrada: integer('tokens_entrada'),
    tokensSaida: integer('tokens_saida'),
    criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mensagem_conversa_idx').on(t.conversaId),
    index('mensagem_criada_em_idx').on(t.criadaEm),
  ],
);
