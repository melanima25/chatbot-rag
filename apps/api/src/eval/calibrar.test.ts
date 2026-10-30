import { describe, expect, it } from 'vitest';
import { posicaoDaFonte, tabelaLimiar, type CasoComCandidatos } from './calibrar';
import type { CasoEval } from './casos';

const dentro = (id: number, fonte: string): CasoEval => ({
  id,
  pergunta: 'p',
  esperado: 'resposta',
  fonte,
  deveConter: ['x'],
});
const fora = (id: number): CasoEval => ({ id, pergunta: 'p', esperado: 'recusa' });
const cand = (...pares: Array<[string, number]>) =>
  pares.map(([caminho, similaridade]) => ({ caminho, similaridade }));

const casos: CasoComCandidatos[] = [
  { caso: dentro(1, 'a.md'), candidatos: cand(['a.md', 0.7], ['b.md', 0.5]) },
  { caso: dentro(2, 'c.md'), candidatos: cand(['b.md', 0.62], ['c.md', 0.517]) },
  { caso: dentro(3, 'd.md'), candidatos: cand(['d.md', 0.43]) },
  { caso: fora(4), candidatos: cand(['a.md', 0.486]) },
  { caso: fora(5), candidatos: cand(['a.md', 0.295]) },
];

describe('tabelaLimiar', () => {
  it('conta falsas recusas, vazamentos e documento certo fora do contexto por limite', () => {
    const [l55, l50, l40] = tabelaLimiar(casos, [0.55, 0.5, 0.4], 4);

    // 0,55: o caso 3 (0,43) é falsa recusa; no 2 o documento certo (0,517) fica fora do contexto
    expect(l55).toMatchObject({
      limiar: 0.55,
      falsasRecusas: 1,
      fonteForaDoContexto: 1,
      vazamentos: 0,
    });
    // 0,50: o 2 passa a ter o documento no contexto, mas a pergunta sobre óleo-like (0,486) ainda não vaza
    expect(l50).toMatchObject({ falsasRecusas: 1, fonteForaDoContexto: 0, vazamentos: 0 });
    // 0,40: ninguém é falsa recusa, mas o caso fora da base (0,486) vaza
    expect(l40).toMatchObject({ falsasRecusas: 0, fonteForaDoContexto: 0, vazamentos: 1 });
  });

  it('totais por tipo de caso; "recusa_ou_resposta" não entra na conta', () => {
    const neutro: CasoComCandidatos = {
      caso: { id: 6, pergunta: 'p', esperado: 'recusa_ou_resposta' },
      candidatos: cand(['a.md', 0.9]),
    };
    const [l] = tabelaLimiar([...casos, neutro], [0.55], 4);
    expect(l?.respostasEsperadas).toBe(3);
    expect(l?.recusasEsperadas).toBe(2);
    expect(l?.vazamentos).toBe(0);
  });

  it('só os k primeiros candidatos entram no contexto', () => {
    const c: CasoComCandidatos[] = [
      {
        caso: dentro(1, 'z.md'),
        candidatos: cand(['a.md', 0.9], ['b.md', 0.8], ['z.md', 0.7]),
      },
    ];
    expect(tabelaLimiar(c, [0.5], 3)[0]?.fonteForaDoContexto).toBe(0);
    expect(tabelaLimiar(c, [0.5], 2)[0]?.fonteForaDoContexto).toBe(1);
  });

  it('sem nenhum candidato, nada passa por limite algum', () => {
    const [l] = tabelaLimiar([{ caso: dentro(1, 'a.md'), candidatos: [] }], [0.1], 4);
    expect(l?.falsasRecusas).toBe(1);
  });
});

describe('margem de contexto', () => {
  it('a margem tira do contexto o trecho distante do melhor, e o documento certo pode ficar de fora', () => {
    const c: CasoComCandidatos[] = [
      { caso: dentro(1, 'b.md'), candidatos: cand(['a.md', 0.8], ['b.md', 0.6]) },
    ];
    expect(tabelaLimiar(c, [0.5], 4)[0]?.fonteForaDoContexto).toBe(0); // sem margem
    expect(tabelaLimiar(c, [0.5], 4, 0.1)[0]?.fonteForaDoContexto).toBe(1); // 0,6 < 0,8 - 0,1
    expect(tabelaLimiar(c, [0.5], 4, 0.25)[0]?.fonteForaDoContexto).toBe(0);
  });
});

describe('posicaoDaFonte', () => {
  it('devolve posição (1 = melhor) e pontuação, ou null se não apareceu', () => {
    const c = cand(['a.md', 0.7], ['b.md', 0.5]);
    expect(posicaoDaFonte(c, 'b.md')).toEqual({ posicao: 2, similaridade: 0.5 });
    expect(posicaoDaFonte(c, 'x.md')).toBeNull();
    // com alternativas, vale a que aparece melhor colocada
    expect(posicaoDaFonte(c, 'x.md|b.md')).toEqual({ posicao: 2, similaridade: 0.5 });
    expect(posicaoDaFonte(c, 'b.md|a.md')).toEqual({ posicao: 1, similaridade: 0.7 });
  });
});
