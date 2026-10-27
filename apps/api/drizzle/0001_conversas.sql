CREATE TABLE "conversa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensagem" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversa_id" uuid NOT NULL,
	"papel" text NOT NULL,
	"texto" text NOT NULL,
	"tipo" text,
	"motivo_recusa" text,
	"tokens_entrada" integer,
	"tokens_saida" integer,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_conversa_id_conversa_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mensagem_conversa_idx" ON "mensagem" USING btree ("conversa_id");--> statement-breakpoint
CREATE INDEX "mensagem_criada_em_idx" ON "mensagem" USING btree ("criada_em");