import { describe, expect, it, vi } from 'vitest';
import { criarCliente } from './api';

const ID = '3f2b8c1e-5d4a-4e7b-9a10-2c6f8e1d7b90';
const ok = {
  conversaId: ID,
  tipo: 'resposta',
  resposta: 'Aceitamos Pix. [1]',
  fontes: [{ numero: 1, documento: 'Formas de pagamento', caminho: '08.md', citada: true }],
};

function resposta(corpo: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function cliente(r: Response | Error) {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    r instanceof Error ? Promise.reject(r) : Promise.resolve(r),
  );
  return { enviar: criarCliente({ baseUrl: 'http://api.teste', fetchImpl }), fetchImpl };
}

describe('cliente da API', () => {
  it('envia a pergunta e devolve a resposta validada', async () => {
    const { enviar, fetchImpl } = cliente(resposta(ok));
    const r = await enviar('Aceitam Pix?');

    expect(r).toEqual({ ok: true, dados: ok });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://api.teste/api/chat');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ pergunta: 'Aceitam Pix?' });
  });

  it('manda o conversaId só quando existe', async () => {
    const { enviar, fetchImpl } = cliente(resposta(ok));
    await enviar('Aceitam Pix?', ID);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      pergunta: 'Aceitam Pix?',
      conversaId: ID,
    });
  });

  it('aceita conversaId nulo na resposta (servidor não conseguiu guardar a conversa)', async () => {
    const { enviar } = cliente(resposta({ ...ok, conversaId: null }));
    const r = await enviar('Aceitam Pix?');
    expect(r.ok && r.dados.conversaId).toBeNull();
  });

  it('429 de taxa: devolve a espera do cabeçalho Retry-After', async () => {
    const { enviar } = cliente(
      resposta({ codigo: 'muitas_requisicoes', erro: 'x' }, 429, { 'Retry-After': '42' }),
    );
    expect(await enviar('oi')).toEqual({
      ok: false,
      erro: { tipo: 'muitas_requisicoes', esperaSeg: 42 },
    });
  });

  it('429 sem Retry-After válido: espera padrão de 60 s', async () => {
    const { enviar } = cliente(resposta({ codigo: 'muitas_requisicoes' }, 429));
    expect(await enviar('oi')).toEqual({
      ok: false,
      erro: { tipo: 'muitas_requisicoes', esperaSeg: 60 },
    });
  });

  it('429 com código conversa_cheia não é confundido com limite de taxa', async () => {
    const { enviar } = cliente(resposta({ codigo: 'conversa_cheia' }, 429, { 'Retry-After': '5' }));
    expect(await enviar('oi')).toEqual({ ok: false, erro: { tipo: 'conversa_cheia' } });
  });

  it('503 limite_diario', async () => {
    const { enviar } = cliente(resposta({ codigo: 'limite_diario' }, 503));
    expect(await enviar('oi')).toEqual({ ok: false, erro: { tipo: 'limite_diario' } });
  });

  it('404 vira conversa_nao_encontrada', async () => {
    const { enviar } = cliente(resposta({ erro: 'Conversa não encontrada' }, 404));
    expect(await enviar('oi', ID)).toEqual({
      ok: false,
      erro: { tipo: 'conversa_nao_encontrada' },
    });
  });

  it('400 repassa a mensagem do servidor', async () => {
    const { enviar } = cliente(resposta({ erro: 'Pergunta longa demais' }, 400));
    expect(await enviar('oi')).toEqual({
      ok: false,
      erro: { tipo: 'pedido_invalido', mensagem: 'Pergunta longa demais' },
    });
  });

  it('500, e 503 sem o código esperado, viram erro de servidor', async () => {
    expect(await cliente(resposta({ erro: 'Erro interno' }, 500)).enviar('oi')).toEqual({
      ok: false,
      erro: { tipo: 'servidor' },
    });
    expect(await cliente(resposta('<html>bad gateway</html>', 503)).enviar('oi')).toEqual({
      ok: false,
      erro: { tipo: 'servidor' },
    });
  });

  it('resposta 200 fora do formato esperado vira erro de servidor, não quebra a tela', async () => {
    const { enviar } = cliente(resposta({ resposta: 123 }));
    expect(await enviar('oi')).toEqual({ ok: false, erro: { tipo: 'servidor' } });
  });

  it('falha de rede vira erro "rede" (nunca lança)', async () => {
    const { enviar } = cliente(new TypeError('Failed to fetch'));
    expect(await enviar('oi')).toEqual({ ok: false, erro: { tipo: 'rede' } });
  });
});
