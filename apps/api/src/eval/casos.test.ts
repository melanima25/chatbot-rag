import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { alternativasDeFonte, fonteAtendida, fontesEsperadas, lerCasos } from './casos';

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));
const arquivo = JSON.parse(readFileSync(`${RAIZ}evals/perguntas.json`, 'utf-8')) as unknown;

describe('evals/perguntas.json (o arquivo de verdade)', () => {
  const casos = lerCasos(arquivo);

  it('tem pelo menos 30 casos, com ids únicos', () => {
    expect(casos.length).toBeGreaterThanOrEqual(30);
    expect(new Set(casos.map((c) => c.id)).size).toBe(casos.length);
  });

  it('toda fonte esperada existe na base de conhecimento (sem erro de digitação no nome)', () => {
    const existentes = new Set(readdirSync(`${RAIZ}base-conhecimento`));
    for (const c of casos) {
      for (const item of fontesEsperadas(c)) {
        for (const f of alternativasDeFonte(item)) {
          expect(existentes.has(f), `caso ${c.id}: ${f} não existe na base`).toBe(true);
        }
      }
    }
  });

  it('cobre os três tipos de expectativa e tem casos de variação (sem acento, curtos)', () => {
    const tipos = new Set(casos.map((c) => c.esperado));
    expect(tipos).toEqual(new Set(['resposta', 'recusa', 'recusa_ou_resposta']));
    expect(casos.filter((c) => c.esperado === 'recusa').length).toBeGreaterThanOrEqual(4);
  });

  it('as falhas conhecidas explicam o motivo', () => {
    for (const c of casos.filter((x) => x.falhaConhecida !== undefined)) {
      expect(c.falhaConhecida?.length, `caso ${c.id}`).toBeGreaterThan(20);
    }
  });
});

describe('lerCasos', () => {
  const base = {
    id: 1,
    pergunta: 'Qual o horário?',
    esperado: 'resposta',
    fonte: '02.md',
    deveConter: ['8h'],
  };

  it('aceita um caso válido', () => {
    expect(lerCasos({ casos: [base] })).toHaveLength(1);
  });

  it.each([
    ['id repetido', { casos: [base, base] }, 'id repetido'],
    ['"resposta" sem fonte', { casos: [{ ...base, fonte: undefined }] }, 'exige "fonte"'],
    ['"resposta" sem deveConter', { casos: [{ ...base, deveConter: [] }] }, 'exige "deveConter"'],
    [
      '"recusa" com fonte',
      { casos: [{ ...base, esperado: 'recusa' }] },
      'só "resposta" tem "fonte"',
    ],
    ['campo com erro de digitação', { casos: [{ ...base, deveConte: ['x'] }] }, 'deveConte'],
    ['expectativa desconhecida', { casos: [{ ...base, esperado: 'talvez' }] }, 'esperado'],
    ['lista vazia', { casos: [] }, 'casos'],
  ])('rejeita %s', (_nome, entrada, trecho) => {
    expect(() => lerCasos(entrada)).toThrow(trecho);
  });
});

describe('fonteAtendida', () => {
  it('um documento exato, ou qualquer uma das alternativas "a.md|b.md"', () => {
    expect(fonteAtendida('a.md', ['a.md', 'b.md'])).toBe(true);
    expect(fonteAtendida('a.md', ['b.md'])).toBe(false);
    expect(fonteAtendida('a.md|c.md', ['c.md'])).toBe(true);
    expect(fonteAtendida('a.md|c.md', ['b.md'])).toBe(false);
  });
});
