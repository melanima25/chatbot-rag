import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolverCaminho } from './caminho';

describe('resolverCaminho', () => {
  it('caminho relativo parte da pasta onde o comando foi digitado (INIT_CWD), não da do script', () => {
    const raiz = resolve('/projeto');
    expect(resolverCaminho('evals/x.json', { INIT_CWD: raiz }, resolve('/projeto/apps/api'))).toBe(
      resolve(raiz, 'evals/x.json'),
    );
  });

  it('sem INIT_CWD (rodando o script direto), usa a pasta atual', () => {
    expect(resolverCaminho('x.json', {}, resolve('/aqui'))).toBe(resolve('/aqui', 'x.json'));
  });

  it('caminho absoluto fica como está', () => {
    const abs = resolve('/outro/lugar/x.json');
    expect(resolverCaminho(abs, { INIT_CWD: resolve('/projeto') })).toBe(abs);
  });
});
