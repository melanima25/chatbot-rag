import type { Db } from '../db/client';
import type { EmbeddingProvider } from '../rag/embeddings';
import type { LlmProvider } from '../rag/llm';
import { responder, type OpcoesResponder } from '../rag/responder';
import { avaliarCaso, type ResultadoCaso, type Tentativa } from './avaliar';
import type { CasoEval } from './casos';

type Entrada = {
  db: Db;
  embeddings: EmbeddingProvider;
  llm: LlmProvider;
  casos: CasoEval[];
  opcoes: Partial<OpcoesResponder>;
  /** Quantas vezes repetir cada pergunta (o modelo varia: repetir mostra os casos instáveis). */
  repeticoes?: number;
  aoTerminarCaso?: (r: ResultadoCaso) => void;
};

/**
 * Roda cada caso no mesmo `responder` que a API usa. Um por vez, para não estourar o limite do
 * provedor. Se uma chamada falha, o caso registra o erro e a avaliação segue.
 */
export async function rodarEval({
  db,
  embeddings,
  llm,
  casos,
  opcoes,
  repeticoes = 1,
  aoTerminarCaso,
}: Entrada): Promise<ResultadoCaso[]> {
  const resultados: ResultadoCaso[] = [];
  for (const caso of casos) {
    const tentativas: Tentativa[] = [];
    for (let i = 0; i < repeticoes; i++) {
      try {
        const resultado = await responder(db, embeddings, llm, caso.pergunta, opcoes);
        tentativas.push({ resultado, veredito: avaliarCaso(caso, resultado) });
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        tentativas.push({
          resultado: null,
          veredito: {
            ok: false,
            falhas: [`erro na chamada: ${motivo}`],
            fonteRecuperada: null,
            fonteCitada: null,
          },
        });
      }
    }
    const rc = { caso, tentativas };
    resultados.push(rc);
    aoTerminarCaso?.(rc);
  }
  return resultados;
}
