import { alternativasDeFonte, fonteAtendida, fontesEsperadas, type CasoEval } from './casos';

export type Candidato = { caminho: string; similaridade: number };
export type CasoComCandidatos = { caso: CasoEval; candidatos: Candidato[] };

export type LinhaLimiar = {
  limiar: number;
  /** Casos de "resposta" em que o melhor trecho ficou abaixo do limiar: o chatbot recusaria sem precisar. */
  falsasRecusas: number;
  /** Casos de "recusa" em que o melhor trecho passou do limiar: o modelo seria chamado (e pode inventar). */
  vazamentos: number;
  /** Passou do limiar, mas o documento certo ficou de fora do contexto (abaixo do limiar ou além do TOP_K). */
  fonteForaDoContexto: number;
  respostasEsperadas: number;
  recusasEsperadas: number;
};

/**
 * Simula, SEM chamar o modelo de texto, o que cada limite de similaridade faria com os casos.
 * `k` é o TOP_K: só os `k` primeiros candidatos entram no contexto, como na resposta de verdade.
 * `margem` é a `MARGEM_CONTEXTO` (1 = desligada): só entram trechos a essa distância do melhor.
 */
export function tabelaLimiar(
  casos: CasoComCandidatos[],
  limiares: number[],
  k: number,
  margem = 1,
): LinhaLimiar[] {
  return limiares.map((limiar) => {
    const linha: LinhaLimiar = {
      limiar,
      falsasRecusas: 0,
      vazamentos: 0,
      fonteForaDoContexto: 0,
      respostasEsperadas: 0,
      recusasEsperadas: 0,
    };
    for (const { caso, candidatos } of casos) {
      const melhor = candidatos[0]?.similaridade ?? 0;
      const passa = melhor >= limiar;
      if (caso.esperado === 'resposta') {
        linha.respostasEsperadas++;
        if (!passa) {
          linha.falsasRecusas++;
          continue;
        }
        const contexto = candidatos
          .slice(0, k)
          .filter((c) => c.similaridade >= limiar && c.similaridade >= melhor - margem)
          .map((c) => c.caminho);
        const fontes = fontesEsperadas(caso);
        if (!fontes.every((f) => fonteAtendida(f, contexto))) {
          linha.fonteForaDoContexto++;
        }
      } else if (caso.esperado === 'recusa') {
        linha.recusasEsperadas++;
        if (passa) linha.vazamentos++;
      }
    }
    return linha;
  });
}

/**
 * Posição (1 = melhor) e pontuação do documento esperado entre os candidatos; `null` se não apareceu.
 * Com alternativas ("a.md|b.md"), vale a que aparece melhor colocada.
 */
export function posicaoDaFonte(
  candidatos: Candidato[],
  fonte: string,
): { posicao: number; similaridade: number } | null {
  const alternativas = alternativasDeFonte(fonte);
  const i = candidatos.findIndex((c) => alternativas.includes(c.caminho));
  const c = candidatos[i];
  return c ? { posicao: i + 1, similaridade: c.similaridade } : null;
}
