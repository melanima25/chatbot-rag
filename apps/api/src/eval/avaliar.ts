import type { Resultado } from '../rag/responder';
import { neuronsDe } from '../custo';
import { alternativasDeFonte, fonteAtendida, fontesEsperadas, type CasoEval } from './casos';

/** Minúsculas e sem acento, para comparar texto sem se importar com "Não" / "nao". */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function contem(textoNormalizado: string, item: string): boolean {
  return item.split('|').some((alt) => textoNormalizado.includes(normalizar(alt.trim())));
}

export type Veredito = {
  ok: boolean;
  falhas: string[];
  /** Só em casos de "resposta" com fonte esperada. */
  fonteRecuperada: boolean | null;
  fonteCitada: boolean | null;
};

/** Confere UMA resposta do chatbot contra o que o caso espera. */
export function avaliarCaso(caso: CasoEval, r: Resultado): Veredito {
  const falhas: string[] = [];
  const fontes = fontesEsperadas(caso);

  if (caso.esperado === 'resposta' && r.tipo === 'recusa') {
    falhas.push(`recusou sem precisar (${r.motivoRecusa ?? 'sem motivo'})`);
  }
  if (caso.esperado === 'recusa' && r.tipo === 'resposta') {
    falhas.push('respondeu em vez de recusar');
  }

  if (r.tipo === 'resposta') {
    const texto = normalizar(r.texto);
    for (const item of caso.deveConter ?? []) {
      if (!contem(texto, item)) falhas.push(`faltou "${item}"`);
    }
    for (const item of caso.naoDeveConter ?? []) {
      if (contem(texto, item)) falhas.push(`não devia conter "${item}"`);
    }
  }

  let fonteRecuperada: boolean | null = null;
  let fonteCitada: boolean | null = null;
  if (caso.esperado === 'resposta' && fontes.length > 0) {
    const recuperados = r.fontes.map((x) => x.caminho);
    const citados = r.fontes.filter((x) => x.citada).map((x) => x.caminho);
    fonteRecuperada = fontes.every((f) => fonteAtendida(f, recuperados));
    fonteCitada = fontes.every((f) => fonteAtendida(f, citados));
    // Se já recusou, a falha principal é a recusa; não repete a da fonte.
    if (!fonteRecuperada && r.tipo === 'resposta') {
      const faltaram = fontes.filter((f) => !fonteAtendida(f, recuperados));
      falhas.push(
        `fonte não recuperada: ${faltaram.map((f) => alternativasDeFonte(f).join(' ou ')).join(', ')}`,
      );
    }
  }
  return { ok: falhas.length === 0, falhas, fonteRecuperada, fonteCitada };
}

/** `resultado` é nulo quando a chamada falhou (rede, cota): o veredito explica. */
export type Tentativa = { veredito: Veredito; resultado: Resultado | null };
export type ResultadoCaso = { caso: CasoEval; tentativas: Tentativa[] };

export type EstadoCaso = 'passou' | 'falhou' | 'instavel';

/** passou = todas as tentativas ok; falhou = nenhuma; instável = misturou (o modelo varia). */
export function estadoDoCaso(rc: ResultadoCaso): EstadoCaso {
  const oks = rc.tentativas.filter((t) => t.veredito.ok).length;
  if (oks === rc.tentativas.length) return 'passou';
  return oks === 0 ? 'falhou' : 'instavel';
}

export type Resumo = {
  total: number;
  revisados: number;
  passaram: number;
  instaveis: number;
  /** Falhas que NÃO estavam marcadas como conhecidas: são as regressões. */
  falhasNovas: number[];
  /** Falhas já conhecidas e que continuam. */
  falhasConhecidas: number[];
  /** Casos marcados como falha conhecida que agora passam: dá para tirar a marca. */
  conhecidasQuePassam: number[];
  /** Perguntas que a base cobre e o chatbot recusou (ou errou). */
  respostasEsperadas: { total: number; certas: number; falsasRecusas: number };
  /** Perguntas fora da base: responder aqui é inventar (o erro mais grave). */
  recusasEsperadas: { total: number; certas: number; respostasIndevidas: number };
  /** Entre os casos de "resposta" com fonte (por tentativa). */
  fonte: { total: number; recuperada: number; citada: number };
  tokensEntrada: number;
  tokensSaida: number;
  neurons: number;
};

export function resumir(resultados: ResultadoCaso[]): Resumo {
  const r: Resumo = {
    total: resultados.length,
    revisados: resultados.filter((x) => x.caso.revisado).length,
    passaram: 0,
    instaveis: 0,
    falhasNovas: [],
    falhasConhecidas: [],
    conhecidasQuePassam: [],
    respostasEsperadas: { total: 0, certas: 0, falsasRecusas: 0 },
    recusasEsperadas: { total: 0, certas: 0, respostasIndevidas: 0 },
    fonte: { total: 0, recuperada: 0, citada: 0 },
    tokensEntrada: 0,
    tokensSaida: 0,
    neurons: 0,
  };

  for (const rc of resultados) {
    const estado = estadoDoCaso(rc);
    const conhecida = Boolean(rc.caso.falhaConhecida);
    if (estado === 'passou') {
      r.passaram++;
      if (conhecida) r.conhecidasQuePassam.push(rc.caso.id);
    } else {
      if (estado === 'instavel') r.instaveis++;
      (conhecida ? r.falhasConhecidas : r.falhasNovas).push(rc.caso.id);
    }

    for (const t of rc.tentativas) {
      if (!t.resultado) continue; // chamada que falhou não entra nas taxas, só no estado do caso
      const { tipo, uso } = t.resultado;
      r.tokensEntrada += uso?.tokensEntrada ?? 0;
      r.tokensSaida += uso?.tokensSaida ?? 0;

      if (rc.caso.esperado === 'resposta') {
        r.respostasEsperadas.total++;
        if (t.veredito.ok) r.respostasEsperadas.certas++;
        if (tipo === 'recusa') r.respostasEsperadas.falsasRecusas++;
        if (t.veredito.fonteRecuperada !== null) {
          r.fonte.total++;
          if (t.veredito.fonteRecuperada) r.fonte.recuperada++;
          if (t.veredito.fonteCitada) r.fonte.citada++;
        }
      } else if (rc.caso.esperado === 'recusa') {
        r.recusasEsperadas.total++;
        if (t.veredito.ok) r.recusasEsperadas.certas++;
        if (tipo === 'resposta') r.recusasEsperadas.respostasIndevidas++;
      }
    }
  }
  r.neurons = neuronsDe(r.tokensEntrada, r.tokensSaida);
  return r;
}
