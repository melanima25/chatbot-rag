import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('API', () => {
  it('GET /api/health responde ok', async () => {
    const res = await createApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rota inexistente devolve 404 em JSON', async () => {
    const res = await createApp().request('/api/nada');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ erro: 'Rota não encontrada' });
  });
});
