CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "documento" (
	"id" serial PRIMARY KEY NOT NULL,
	"caminho" text NOT NULL,
	"titulo" text NOT NULL,
	"hash_conteudo" text NOT NULL,
	"modelo_embedding" text NOT NULL,
	"ingerido_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documento_caminho_unique" UNIQUE("caminho")
);
--> statement-breakpoint
CREATE TABLE "trecho" (
	"id" serial PRIMARY KEY NOT NULL,
	"documento_id" integer NOT NULL,
	"ordem" integer NOT NULL,
	"texto" text NOT NULL,
	"tokens" integer NOT NULL,
	"embedding" vector(1024) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trecho" ADD CONSTRAINT "trecho_documento_id_documento_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trecho_documento_ordem_uq" ON "trecho" USING btree ("documento_id","ordem");--> statement-breakpoint
CREATE INDEX "trecho_embedding_hnsw_idx" ON "trecho" USING hnsw ("embedding" vector_cosine_ops);