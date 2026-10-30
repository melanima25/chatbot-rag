import { describe, expect, it } from 'vitest';
import { ambienteDoWorker, type WorkerBindings } from './worker';

const base = (extra: Record<string, unknown> = {}): WorkerBindings => ({
  AI: { run: () => Promise.resolve({}) },
  HYPERDRIVE: { connectionString: 'postgres://u:p@abc.hyperdrive.local:5432/db' },
  ...extra,
});

describe('ambienteDoWorker', () => {
  it('usa a conexão do Hyperdrive e os padrões quando não há variáveis', () => {
    const env = ambienteDoWorker(base());
    expect(env.DATABASE_URL).toBe('postgres://u:p@abc.hyperdrive.local:5432/db');
    expect(env.SIMILARIDADE_MINIMA).toBe(0.45);
    expect(env.MARGEM_CONTEXTO).toBe(0.08);
  });

  it('lê as variáveis de texto do wrangler.jsonc', () => {
    const env = ambienteDoWorker(base({ IP_HEADER: 'cf-connecting-ip', LIMITE_POR_MINUTO: '5' }));
    expect(env.IP_HEADER).toBe('cf-connecting-ip');
    expect(env.LIMITE_POR_MINUTO).toBe(5);
  });

  it('não deixa uma variável DATABASE_URL solta sobrepor o Hyperdrive', () => {
    const env = ambienteDoWorker(base({ DATABASE_URL: 'postgres://outro:x@host/db' }));
    expect(env.DATABASE_URL).toContain('hyperdrive.local');
  });

  it('não exige token da Cloudflare (o modelo vem pelo binding)', () => {
    expect(() => ambienteDoWorker(base({ LLM_PROVIDER: 'workers-ai' }))).not.toThrow();
  });

  it('falha cedo, sem valores, quando uma variável é inválida', () => {
    expect(() => ambienteDoWorker(base({ TOP_K: '99' }))).toThrow(/TOP_K/);
  });
});
