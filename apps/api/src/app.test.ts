import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import type { Resultado } from './rag/responder';

const resposta: Resultado = {
  tipo: 'resposta',
  texto: 'Aceitamos Pix e dinheiro. [1]',
  fontes: [
    {
      numero: 1,
      documento: 'Formas de pagamento',
      caminho: '08-formas-de-pagamento.md',
      ordem: 0,
      similaridade: 0.63,
      citada: true,
    },
  ],
};

const post = (app: ReturnType<typeof createApp>, corpo: unknown) =>
  app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });

describe('API', () => {
  it('GET /api/health responde ok', async () => {
    const res = await createApp({ responder: vi.fn() }).request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rota inexistente devolve 404 em JSON', async () => {
    const res = await createApp({ responder: vi.fn() }).request('/api/nada');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ erro: 'Rota não encontrada' });
  });
});

describe('POST /api/chat', () => {
  it('devolve a resposta com as fontes (sem expor a similaridade interna)', async () => {
    const responder = vi.fn().mockResolvedValue(resposta);
    const res = await post(createApp({ responder }), { pergunta: '  Aceitam Pix?  ' });

    expect(res.status).toBe(200);
    expect(responder).toHaveBeenCalledWith('Aceitam Pix?'); // com trim
    expect(await res.json()).toEqual({
      tipo: 'resposta',
      resposta: 'Aceitamos Pix e dinheiro. [1]',
      fontes: [
        {
          numero: 1,
          documento: 'Formas de pagamento',
          caminho: '08-formas-de-pagamento.md',
          citada: true,
        },
      ],
    });
  });

  it('recusa também é 200, com tipo "recusa" e sem fontes', async () => {
    const responder = vi.fn().mockResolvedValue({
      tipo: 'recusa',
      texto: 'Não encontrei.',
      fontes: [],
      motivoRecusa: 'sem_trechos_relevantes',
    } satisfies Resultado);
    const res = await post(createApp({ responder }), { pergunta: 'Qual a capital da França?' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tipo: string; fontes: unknown[] };
    expect(json.tipo).toBe('recusa');
    expect(json.fontes).toEqual([]);
  });

  it.each([
    ['sem corpo JSON', 'isto não é json'],
    ['sem o campo pergunta', {}],
    ['pergunta vazia', { pergunta: '   ' }],
    ['pergunta de 1 letra', { pergunta: 'a' }],
    ['pergunta que não é texto', { pergunta: 123 }],
    ['pergunta com mais de 500 caracteres', { pergunta: 'x'.repeat(501) }],
  ])('pedido inválido (%s) dá 400 e não chama o modelo', async (_nome, corpo) => {
    const responder = vi.fn();
    const res = await post(createApp({ responder }), corpo);
    expect(res.status).toBe(400);
    expect(responder).not.toHaveBeenCalled();
  });

  it('corpo gigante dá 413', async () => {
    const responder = vi.fn();
    const res = await post(createApp({ responder }), { pergunta: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(responder).not.toHaveBeenCalled();
  });

  it('erro interno vira 500 genérico, sem vazar a causa', async () => {
    const responder = vi.fn().mockRejectedValue(new Error('segredo-interno do provedor'));
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(createApp({ responder }), { pergunta: 'Aceitam Pix?' });
    silencio.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('segredo-interno');
  });
});
