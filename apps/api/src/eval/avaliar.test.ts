import { describe, expect, it } from 'vitest';
import type { Resultado } from '../rag/responder';
import {
  avaliarCaso,
  estadoDoCaso,
  normalizar,
  resumir,
  type ResultadoCaso,
  type Tentativa,
} from './avaliar';
import type { CasoEval } from './casos';

const fonte = (caminho: string, citada = true) => ({
  numero: 1,
  documento: 'Doc',
  caminho,
  ordem: 0,
  similaridade: 0.7,
  citada,
});
const resposta = (texto: string, fontes = [fonte('04.md')], uso?: Resultado['uso']): Resultado => ({
  tipo: 'resposta',
  texto,
  fontes,
  uso,
});
const recusa = (motivoRecusa: Resultado['motivoRecusa'] = 'sem_trechos_relevantes'): Resultado => ({
  tipo: 'recusa',
  texto: 'Não encontrei.',
  fontes: [],
  motivoRecusa,
});
const caso = (extra: Partial<CasoEval> = {}): CasoEval => ({
  id: 1,
  pergunta: 'Quanto custa polir um SUV?',
  esperado: 'resposta',
  fonte: '04.md',
  deveConter: ['320', '400'],
  ...extra,
});

describe('normalizar', () => {
  it('tira acento e maiúscula', () => {
    expect(normalizar('NÃO Aceitamos Cartão')).toBe('nao aceitamos cartao');
  });
});

describe('avaliarCaso', () => {
  it('resposta certa, com a fonte recuperada e citada', () => {
    const v = avaliarCaso(caso(), resposta('SUV compacto R$ 320 e SUV grande R$ 400. [1]'));
    expect(v).toEqual({ ok: true, falhas: [], fonteRecuperada: true, fonteCitada: true });
  });

  it('acha o texto esperado sem se importar com acento ou maiúscula', () => {
    const c = caso({ deveConter: ['não aceit'], fonte: '04.md' });
    expect(avaliarCaso(c, resposta('NAO ACEITAMOS cheque.')).ok).toBe(true);
  });

  it('"a|b" aceita qualquer uma das variações', () => {
    const c = caso({ deveConter: ['dia todo|dia inteiro'] });
    expect(avaliarCaso(c, resposta('Fica o dia inteiro.')).ok).toBe(true);
    expect(avaliarCaso(c, resposta('Fica um tempo.')).falhas).toContain(
      'faltou "dia todo|dia inteiro"',
    );
  });

  it('faltou um dos valores: falha dizendo qual', () => {
    const v = avaliarCaso(caso(), resposta('Custa R$ 320. [1]'));
    expect(v.ok).toBe(false);
    expect(v.falhas).toEqual(['faltou "400"']);
  });

  it('conteúdo proibido faz falhar', () => {
    const c = caso({ deveConter: ['320'], naoDeveConter: ['de graça'] });
    const v = avaliarCaso(c, resposta('Custa R$ 320, mas pode ser de graça. [1]'));
    expect(v.falhas).toEqual(['não devia conter "de graça"']);
  });

  it('recusar pergunta que a base cobre é falha (e não repete a da fonte)', () => {
    const v = avaliarCaso(caso(), recusa());
    expect(v.ok).toBe(false);
    expect(v.falhas).toEqual(['recusou sem precisar (sem_trechos_relevantes)']);
    expect(v.fonteRecuperada).toBe(false);
  });

  it('resposta certa mas sem a fonte esperada: falha, e a taxa de fonte registra', () => {
    const v = avaliarCaso(caso(), resposta('R$ 320 e R$ 400.', [fonte('05.md')]));
    expect(v.ok).toBe(false);
    expect(v.falhas).toEqual(['fonte não recuperada: 04.md']);
    expect(v.fonteRecuperada).toBe(false);
  });

  it('fonte recuperada mas não citada: passa, e a taxa de citação registra', () => {
    const v = avaliarCaso(caso(), resposta('R$ 320 e R$ 400.', [fonte('04.md', false)]));
    expect(v.ok).toBe(true);
    expect(v.fonteRecuperada).toBe(true);
    expect(v.fonteCitada).toBe(false);
  });

  it('vários documentos esperados: todos precisam ter sido recuperados', () => {
    const c = caso({ fonte: ['04.md', '05.md'], deveConter: ['320'] });
    expect(avaliarCaso(c, resposta('R$ 320', [fonte('04.md')])).fonteRecuperada).toBe(false);
    expect(
      avaliarCaso(c, resposta('R$ 320', [fonte('04.md'), fonte('05.md')])).fonteRecuperada,
    ).toBe(true);
  });

  it('fonte com alternativas "a|b": qualquer uma recuperada basta, e a falha cita as duas', () => {
    const c = caso({ fonte: '04.md|16.md', deveConter: ['320'] });
    expect(avaliarCaso(c, resposta('R$ 320', [fonte('16.md')])).fonteRecuperada).toBe(true);
    const v = avaliarCaso(c, resposta('R$ 320', [fonte('05.md')]));
    expect(v.falhas).toEqual(['fonte não recuperada: 04.md ou 16.md']);
  });

  it('"recusa": recusar passa; responder é o erro grave', () => {
    const c = caso({ esperado: 'recusa', fonte: null, deveConter: undefined });
    expect(avaliarCaso(c, recusa()).ok).toBe(true);
    expect(avaliarCaso(c, resposta('A capital é Paris.', [])).falhas).toEqual([
      'respondeu em vez de recusar',
    ]);
  });

  it('"recusa_ou_resposta": recusar passa; responder "não" passa; dizer que faz, não', () => {
    const c = caso({
      esperado: 'recusa_ou_resposta',
      fonte: null,
      deveConter: undefined,
      naoDeveConter: ['sim, fazemos'],
    });
    expect(avaliarCaso(c, recusa()).ok).toBe(true);
    expect(avaliarCaso(c, resposta('Não fazemos mecânica.', [])).ok).toBe(true);
    expect(avaliarCaso(c, resposta('Sim, fazemos troca de óleo.', [])).ok).toBe(false);
  });
});

const tentativa = (ok: boolean): Tentativa => ({
  resultado: ok ? resposta('ok') : recusa(),
  veredito: { ok, falhas: ok ? [] : ['x'], fonteRecuperada: null, fonteCitada: null },
});

describe('estadoDoCaso', () => {
  it('passou, falhou ou instável conforme as repetições', () => {
    const rc = (...oks: boolean[]): ResultadoCaso => ({
      caso: caso(),
      tentativas: oks.map(tentativa),
    });
    expect(estadoDoCaso(rc(true, true))).toBe('passou');
    expect(estadoDoCaso(rc(false, false))).toBe('falhou');
    expect(estadoDoCaso(rc(true, false))).toBe('instavel');
  });
});

describe('resumir', () => {
  const montar = (c: CasoEval, r: Resultado): ResultadoCaso => ({
    caso: c,
    tentativas: [{ resultado: r, veredito: avaliarCaso(c, r) }],
  });

  it('separa falhas novas de falhas conhecidas, e acusa conhecida que passou', () => {
    const resultados = [
      montar(caso({ id: 1 }), resposta('R$ 320 e R$ 400')), // passa
      montar(caso({ id: 2 }), recusa()), // falha nova
      montar(caso({ id: 3, falhaConhecida: 'sim' }), recusa()), // falha conhecida
      montar(caso({ id: 4, falhaConhecida: 'sim' }), resposta('R$ 320 e R$ 400')), // conhecida que passa
    ];
    const r = resumir(resultados);
    expect(r.passaram).toBe(2);
    expect(r.falhasNovas).toEqual([2]);
    expect(r.falhasConhecidas).toEqual([3]);
    expect(r.conhecidasQuePassam).toEqual([4]);
  });

  it('conta respostas esperadas, recusas esperadas, respostas indevidas e falsas recusas', () => {
    const fora = caso({ id: 9, esperado: 'recusa', fonte: null, deveConter: undefined });
    const r = resumir([
      montar(caso({ id: 1 }), resposta('R$ 320 e R$ 400')),
      montar(caso({ id: 2 }), recusa()),
      montar(fora, recusa()),
      montar({ ...fora, id: 10 }, resposta('Paris', [])),
    ]);
    expect(r.respostasEsperadas).toEqual({ total: 2, certas: 1, falsasRecusas: 1 });
    expect(r.recusasEsperadas).toEqual({ total: 2, certas: 1, respostasIndevidas: 1 });
  });

  it('taxas de fonte recuperada e citada, e soma de tokens e neurons', () => {
    const r = resumir([
      montar(
        caso({ id: 1 }),
        resposta('R$ 320 e R$ 400', [fonte('04.md')], { tokensEntrada: 600, tokensSaida: 40 }),
      ),
      montar(
        caso({ id: 2 }),
        resposta('R$ 320 e R$ 400', [fonte('04.md', false)], {
          tokensEntrada: 800,
          tokensSaida: 60,
        }),
      ),
    ]);
    expect(r.fonte).toEqual({ total: 2, recuperada: 2, citada: 1 });
    expect(r.tokensEntrada).toBe(1400);
    expect(r.tokensSaida).toBe(100);
    expect(r.neurons).toBeCloseTo((1400 / 1e6) * 4119 + (100 / 1e6) * 34868, 6);
  });

  it('chamada que falhou conta no estado do caso, mas não nas taxas', () => {
    const rc: ResultadoCaso = {
      caso: caso({ id: 1 }),
      tentativas: [
        {
          resultado: null,
          veredito: {
            ok: false,
            falhas: ['erro na chamada: x'],
            fonteRecuperada: null,
            fonteCitada: null,
          },
        },
      ],
    };
    const r = resumir([rc]);
    expect(r.falhasNovas).toEqual([1]);
    expect(r.respostasEsperadas.total).toBe(0);
  });
});
