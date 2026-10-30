import type { Db } from '../db/client';
import { buscarTrechos } from './busca';
import type { EmbeddingProvider } from './embeddings';
import type { LlmProvider } from './llm';
import {
  extrairCitacoes,
  FRASE_RECUSA,
  MARCADOR_SEM_RESPOSTA,
  montarMensagens,
  type TrechoContexto,
} from './prompt';

export type FonteResposta = {
  numero: number;
  documento: string;
  caminho: string;
  ordem: number;
  similaridade: number;
  /** A resposta do modelo citou esta fonte com [n]. */
  citada: boolean;
};

export type MotivoRecusa = 'sem_trechos_relevantes' | 'modelo_sem_resposta';

export type Resultado = {
  tipo: 'resposta' | 'recusa';
  texto: string;
  fontes: FonteResposta[];
  motivoRecusa?: MotivoRecusa;
  /** Preenchido só quando o modelo foi chamado e informou o uso. */
  uso?: { tokensEntrada?: number; tokensSaida?: number };
};

export type OpcoesResponder = {
  k: number;
  similaridadeMinima: number;
  /**
   * Só entram no contexto os trechos a no máximo esta distância (em pontos de similaridade) do melhor.
   * O limite decide SE responde; a margem decide QUANTO contexto vai para o modelo. Trechos fracos no
   * contexto confundem o modelo pequeno. 1 = desligado (qualquer trecho acima do limite entra). Padrão 0,08: ver docs/adr/0003.
   */
  margemContexto: number;
  maxTokens: number;
};

export const OPCOES_PADRAO: OpcoesResponder = {
  k: 4,
  similaridadeMinima: 0.45,
  maxTokens: 300,
  margemContexto: 0.08,
};

/** Função que o resto do sistema usa; as rotas só conhecem esta assinatura. */
export type ResponderFn = (pergunta: string) => Promise<Resultado>;

/**
 * Duas barreiras contra resposta inventada:
 *  1) similaridade: se nenhum trecho passa do mínimo, recusa SEM chamar o modelo (de graça);
 *  2) instrução: se o modelo achar que os trechos não respondem, ele devolve o marcador e
 *     recusamos do mesmo jeito.
 */
export async function responder(
  db: Db,
  embeddings: EmbeddingProvider,
  llm: LlmProvider,
  pergunta: string,
  opcoes: Partial<OpcoesResponder> = {},
): Promise<Resultado> {
  const { k, similaridadeMinima, maxTokens, margemContexto } = { ...OPCOES_PADRAO, ...opcoes };

  const candidatos = await buscarTrechos(db, embeddings, pergunta, k);
  const melhor = candidatos[0]?.similaridade ?? 0;
  const relevantes = candidatos.filter(
    (c) => c.similaridade >= similaridadeMinima && c.similaridade >= melhor - margemContexto,
  );
  if (relevantes.length === 0) {
    return {
      tipo: 'recusa',
      texto: FRASE_RECUSA,
      fontes: [],
      motivoRecusa: 'sem_trechos_relevantes',
    };
  }

  const contexto: TrechoContexto[] = relevantes.map((r, i) => ({
    numero: i + 1,
    titulo: r.documentoTitulo,
    texto: r.texto,
  }));
  const saida = await llm.gerar(montarMensagens(pergunta, contexto), { maxTokens });
  const uso = { tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida };

  if (saida.texto.includes(MARCADOR_SEM_RESPOSTA)) {
    return {
      tipo: 'recusa',
      texto: FRASE_RECUSA,
      fontes: [],
      motivoRecusa: 'modelo_sem_resposta',
      uso,
    };
  }

  const citadas = new Set(extrairCitacoes(saida.texto, relevantes.length));
  const fontes: FonteResposta[] = relevantes.map((r, i) => ({
    numero: i + 1,
    documento: r.documentoTitulo,
    caminho: r.documentoCaminho,
    ordem: r.ordem,
    similaridade: r.similaridade,
    citada: citadas.has(i + 1),
  }));
  return { tipo: 'resposta', texto: saida.texto, fontes, uso };
}
