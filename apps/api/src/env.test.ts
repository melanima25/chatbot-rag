import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('usa padrões seguros: provedor de mentira e porta 3000', () => {
    const env = parseEnv(base);
    expect(env.EMBEDDING_PROVIDER).toBe('fake');
    expect(env.PORT).toBe(3000);
  });

  it('exige DATABASE_URL com postgres://', () => {
    expect(() => parseEnv({})).toThrow('DATABASE_URL');
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow('postgres://');
  });

  it('workers-ai exige conta e token, e a mensagem não imprime valores', () => {
    expect(() => parseEnv({ ...base, EMBEDDING_PROVIDER: 'workers-ai' })).toThrow(
      'CLOUDFLARE_ACCOUNT_ID',
    );
    const ok = parseEnv({
      ...base,
      EMBEDDING_PROVIDER: 'workers-ai',
      CLOUDFLARE_ACCOUNT_ID: 'abc',
      CLOUDFLARE_API_TOKEN: 'tok',
    });
    expect(ok.EMBEDDING_PROVIDER).toBe('workers-ai');
    try {
      parseEnv({ ...base, EMBEDDING_PROVIDER: 'workers-ai', CLOUDFLARE_ACCOUNT_ID: 'abc' });
    } catch (e) {
      expect(String(e)).not.toContain('abc');
    }
  });

  it('usa os padrões de calibração: limite 0.55, 4 trechos, 300 tokens, modelo fixo', () => {
    const env = parseEnv(base);
    expect(env.SIMILARIDADE_MINIMA).toBe(0.55);
    expect(env.TOP_K).toBe(4);
    expect(env.MAX_TOKENS_RESPOSTA).toBe(300);
    expect(env.LLM_PROVIDER).toBe('fake');
    expect(env.LLM_MODEL).toBe('@cf/meta/llama-3.1-8b-instruct-fp8-fast');
  });

  it('LLM_PROVIDER=workers-ai também exige conta e token', () => {
    expect(() => parseEnv({ ...base, LLM_PROVIDER: 'workers-ai' })).toThrow('LLM_PROVIDER');
  });

  it('rejeita limites fora da faixa', () => {
    expect(() => parseEnv({ ...base, SIMILARIDADE_MINIMA: '1.5' })).toThrow();
    expect(() => parseEnv({ ...base, TOP_K: '0' })).toThrow();
    expect(() => parseEnv({ ...base, MAX_TOKENS_RESPOSTA: '99999' })).toThrow();
  });

  it('rejeita provedor desconhecido', () => {
    expect(() => parseEnv({ ...base, EMBEDDING_PROVIDER: 'outro' })).toThrow();
  });
});
