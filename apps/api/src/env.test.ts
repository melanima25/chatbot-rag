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

  it('rejeita provedor desconhecido', () => {
    expect(() => parseEnv({ ...base, EMBEDDING_PROVIDER: 'outro' })).toThrow();
  });
});
