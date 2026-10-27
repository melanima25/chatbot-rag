import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app';
import type { Limitador } from './chat/limitador';
import type { Repositorio } from './chat/repositorio';
import type { Resultado } from './rag/responder';

const ID = '3f2b8c1e-5d4a-4e7b-9a10-2c6f8e1d7b90';

const limitadorLivre: Limitador = { tentar: () => ({ permitido: true, reiniciaEmSeg: 0 }) };

function repositorioFalso(extra: Partial<Repositorio> = {}): Repositorio {
  return {
    perguntasDaConversa: vi.fn().mockResolvedValue(0),
    tokensDeHoje: vi.fn().mockResolvedValue(0),
    registrarTroca: vi.fn().mockResolvedValue(ID),
    ...extra,
  };
}

/** App com tudo de mentira; cada teste sobrescreve só o que quer provar. */
function montar(extra: Partial<AppDeps> = {}) {
  return createApp({
    responder: vi.fn(),
    repositorio: repositorioFalso(),
    limitador: limitadorLivre,
    limites: { perguntasPorConversa: 3, tokensPorDia: 1000 },
    ...extra,
  });
}

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

const post = (
  app: ReturnType<typeof createApp>,
  corpo: unknown,
  headers: Record<string, string> = {},
) =>
  app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });

describe('API', () => {
  it('GET /api/health responde ok', async () => {
    const res = await montar().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rota inexistente devolve 404 em JSON', async () => {
    const res = await montar().request('/api/nada');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ erro: 'Rota não encontrada' });
  });
});

describe('POST /api/chat', () => {
  it('devolve a resposta com as fontes (sem expor a similaridade interna)', async () => {
    const responder = vi.fn().mockResolvedValue(resposta);
    const res = await post(montar({ responder }), { pergunta: '  Aceitam Pix?  ' });

    expect(res.status).toBe(200);
    expect(responder).toHaveBeenCalledWith('Aceitam Pix?'); // com trim
    expect(await res.json()).toEqual({
      conversaId: ID,
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
    const res = await post(montar({ responder }), { pergunta: 'Qual a capital da França?' });
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
    const res = await post(montar({ responder }), corpo);
    expect(res.status).toBe(400);
    expect(responder).not.toHaveBeenCalled();
  });

  it('corpo gigante dá 413', async () => {
    const responder = vi.fn();
    const res = await post(montar({ responder }), { pergunta: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(responder).not.toHaveBeenCalled();
  });

  it('erro interno vira 500 genérico, sem vazar a causa', async () => {
    const responder = vi.fn().mockRejectedValue(new Error('segredo-interno do provedor'));
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(montar({ responder }), { pergunta: 'Aceitam Pix?' });
    silencio.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('segredo-interno');
  });
});

describe('limites e conversa', () => {
  it('limite por IP: 429 com Retry-After, e nada é consultado nem chamado', async () => {
    const responder = vi.fn();
    const repositorio = repositorioFalso();
    const limitador: Limitador = { tentar: () => ({ permitido: false, reiniciaEmSeg: 42 }) };
    const res = await post(montar({ responder, repositorio, limitador }), {
      pergunta: 'Aceitam Pix?',
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(((await res.json()) as { codigo: string }).codigo).toBe('muitas_requisicoes');
    expect(responder).not.toHaveBeenCalled();
    expect(repositorio.tokensDeHoje).not.toHaveBeenCalled();
  });

  it('o limite conta pedidos inválidos também (vem antes da validação)', async () => {
    const tentar = vi.fn().mockReturnValue({ permitido: true, reiniciaEmSeg: 0 });
    await post(montar({ limitador: { tentar } }), {});
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it('usa o cabeçalho de IP só quando ele foi configurado como confiável', async () => {
    const tentar = vi.fn().mockReturnValue({ permitido: true, reiniciaEmSeg: 0 });
    const responder = vi.fn().mockResolvedValue(resposta);
    const cab = { 'cf-connecting-ip': '203.0.113.7' };

    await post(
      montar({ responder, limitador: { tentar }, ipHeader: 'cf-connecting-ip' }),
      { pergunta: 'Aceitam Pix?' },
      cab,
    );
    expect(tentar).toHaveBeenLastCalledWith('203.0.113.7');

    // Sem configurar, um cabeçalho forjado pelo cliente é ignorado.
    await post(montar({ responder, limitador: { tentar } }), { pergunta: 'Aceitam Pix?' }, cab);
    expect(tentar).toHaveBeenLastCalledWith('desconhecido');
  });

  it('teto diário de tokens: 503 e o modelo não é chamado', async () => {
    const responder = vi.fn();
    const repositorio = repositorioFalso({ tokensDeHoje: vi.fn().mockResolvedValue(1000) });
    const res = await post(montar({ responder, repositorio }), { pergunta: 'Aceitam Pix?' });

    expect(res.status).toBe(503);
    expect(((await res.json()) as { codigo: string }).codigo).toBe('limite_diario');
    expect(responder).not.toHaveBeenCalled();
  });

  it('abaixo do teto diário, responde normalmente', async () => {
    const responder = vi.fn().mockResolvedValue(resposta);
    const repositorio = repositorioFalso({ tokensDeHoje: vi.fn().mockResolvedValue(999) });
    const res = await post(montar({ responder, repositorio }), { pergunta: 'Aceitam Pix?' });
    expect(res.status).toBe(200);
  });

  it('conversa nova: registra a troca sem conversaId e devolve o id criado', async () => {
    const responder = vi.fn().mockResolvedValue(resposta);
    const repositorio = repositorioFalso();
    const res = await post(montar({ responder, repositorio }), { pergunta: 'Aceitam Pix?' });

    expect(repositorio.perguntasDaConversa).not.toHaveBeenCalled();
    expect(repositorio.registrarTroca).toHaveBeenCalledWith({
      conversaId: undefined,
      pergunta: 'Aceitam Pix?',
      resultado: resposta,
    });
    expect(((await res.json()) as { conversaId: string }).conversaId).toBe(ID);
  });

  it('conversa existente: confere o limite e registra na mesma conversa', async () => {
    const responder = vi.fn().mockResolvedValue(resposta);
    const repositorio = repositorioFalso({ perguntasDaConversa: vi.fn().mockResolvedValue(2) });
    const res = await post(montar({ responder, repositorio }), {
      pergunta: 'Aceitam Pix?',
      conversaId: ID,
    });
    expect(res.status).toBe(200);
    expect(repositorio.registrarTroca).toHaveBeenCalledWith(
      expect.objectContaining({ conversaId: ID }),
    );
  });

  it('conversa que não existe: 404, sem chamar o modelo', async () => {
    const responder = vi.fn();
    const repositorio = repositorioFalso({ perguntasDaConversa: vi.fn().mockResolvedValue(null) });
    const res = await post(montar({ responder, repositorio }), {
      pergunta: 'Aceitam Pix?',
      conversaId: ID,
    });
    expect(res.status).toBe(404);
    expect(responder).not.toHaveBeenCalled();
  });

  it('conversa cheia: 429 com código próprio, sem chamar o modelo', async () => {
    const responder = vi.fn();
    const repositorio = repositorioFalso({ perguntasDaConversa: vi.fn().mockResolvedValue(3) });
    const res = await post(montar({ responder, repositorio }), {
      pergunta: 'Aceitam Pix?',
      conversaId: ID,
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { codigo: string }).codigo).toBe('conversa_cheia');
    expect(responder).not.toHaveBeenCalled();
  });

  it('conversaId que não é UUID dá 400', async () => {
    const res = await post(montar(), { pergunta: 'Aceitam Pix?', conversaId: 'abc' });
    expect(res.status).toBe(400);
  });

  it('se guardar a conversa falha, o cliente ainda recebe a resposta (com conversaId nulo)', async () => {
    const responder = vi.fn().mockResolvedValue(resposta);
    const repositorio = repositorioFalso({
      registrarTroca: vi.fn().mockRejectedValue(new Error('banco fora')),
    });
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(montar({ responder, repositorio }), { pergunta: 'Aceitam Pix?' });
    silencio.mockRestore();

    expect(res.status).toBe(200);
    const json = (await res.json()) as { conversaId: unknown; resposta: string };
    expect(json.conversaId).toBeNull();
    expect(json.resposta).toContain('Pix');
  });
});

describe('CORS', () => {
  it('libera só as origens configuradas', async () => {
    const app = montar({ corsOrigens: ['https://demo.exemplo.com'] });
    const ok = await app.request('/api/health', {
      headers: { Origin: 'https://demo.exemplo.com' },
    });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://demo.exemplo.com');
    const nao = await app.request('/api/health', { headers: { Origin: 'https://malicioso.com' } });
    expect(nao.headers.get('Access-Control-Allow-Origin')).not.toBe('https://malicioso.com');
  });

  it('o preflight (OPTIONS) não gasta o limite por IP', async () => {
    const tentar = vi.fn().mockReturnValue({ permitido: true, reiniciaEmSeg: 0 });
    const app = montar({ corsOrigens: ['https://demo.exemplo.com'], limitador: { tentar } });
    const res = await app.request('/api/chat', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://demo.exemplo.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(tentar).not.toHaveBeenCalled();
  });
});
