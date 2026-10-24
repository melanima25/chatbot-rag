import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '../db/client';
import {
  dividirEmTrechos,
  estimarTokens,
  lerMarkdown,
  normalizarQuebras,
  type OpcoesDivisao,
} from './chunk';
import type { EmbeddingProvider } from './embeddings';

export type Relatorio = {
  novos: string[];
  atualizados: string[];
  inalterados: string[];
  removidos: string[];
  /** Trechos gravados nesta execução (não conta os dos arquivos inalterados). */
  trechosGravados: number;
};

/**
 * Lê os .md da pasta, divide em trechos, gera embeddings e grava no Postgres.
 * Idempotente: arquivo com o mesmo conteúdo (e o mesmo modelo de embedding) é pulado.
 * Arquivo que sumiu da pasta é removido do banco (os trechos vão junto, por cascata).
 */
export async function ingerir(
  db: Db,
  provedor: EmbeddingProvider,
  pasta: string,
  opcoes: OpcoesDivisao = {},
): Promise<Relatorio> {
  const nomes = (await readdir(pasta)).filter((n) => n.toLowerCase().endsWith('.md')).sort();
  const existentes = new Map(
    (await db.select().from(schema.documento)).map((d) => [d.caminho, d] as const),
  );
  const relatorio: Relatorio = {
    novos: [],
    atualizados: [],
    inalterados: [],
    removidos: [],
    trechosGravados: 0,
  };

  for (const nome of nomes) {
    const bruto = normalizarQuebras(await readFile(join(pasta, nome), 'utf8'));
    const hash = createHash('sha256').update(bruto).digest('hex');
    const antes = existentes.get(nome);
    if (antes && antes.hashConteudo === hash && antes.modeloEmbedding === provedor.modelo) {
      relatorio.inalterados.push(nome);
      continue;
    }

    const { titulo, corpo } = lerMarkdown(bruto, nome);
    const textos = dividirEmTrechos(corpo, opcoes);
    // o título entra no texto que vira vetor: ajuda a achar "pagamento" mesmo num trecho que não repete a palavra
    const vetores = textos.length
      ? await provedor.embed(textos.map((t) => `${titulo}\n\n${t}`))
      : [];
    if (vetores.length !== textos.length) {
      throw new Error(`${nome}: ${vetores.length} vetores para ${textos.length} trechos`);
    }

    // rede já foi; a transação só mexe no banco
    await db.transaction(async (tx) => {
      const valores = {
        caminho: nome,
        titulo,
        hashConteudo: hash,
        modeloEmbedding: provedor.modelo,
        ingeridoEm: new Date(),
      };
      const [doc] = await tx
        .insert(schema.documento)
        .values(valores)
        .onConflictDoUpdate({ target: schema.documento.caminho, set: valores })
        .returning({ id: schema.documento.id });
      if (!doc) throw new Error(`${nome}: falha ao gravar o documento`);
      await tx.delete(schema.trecho).where(eq(schema.trecho.documentoId, doc.id));
      if (textos.length) {
        await tx.insert(schema.trecho).values(
          textos.map((texto, ordem) => ({
            documentoId: doc.id,
            ordem,
            texto,
            tokens: estimarTokens(texto),
            embedding: vetores[ordem] ?? [],
          })),
        );
      }
    });
    (antes ? relatorio.atualizados : relatorio.novos).push(nome);
    relatorio.trechosGravados += textos.length;
  }

  const sumiram = [...existentes.keys()].filter((c) => !nomes.includes(c));
  if (sumiram.length) {
    await db.delete(schema.documento).where(inArray(schema.documento.caminho, sumiram));
    relatorio.removidos.push(...sumiram);
  }
  return relatorio;
}
