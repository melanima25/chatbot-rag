import { describe, expect, it, vi } from 'vitest';
import { FakeLlmProvider, WorkersAiLlmProvider } from './llm';

const base = { accountId: 'conta123', apiToken: 'segredo-do-token', modelo: '@cf/meta/modelo-x' };
const mensagens = [
  { papel: 'system' as const, conteudo: 'regras' },
  { papel: 'user' as const, conteudo: 'pergunta' },
];

const ok = (result: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ success: true, result }), { status: 200 }));

describe('FakeLlmProvider', () => {
  it('devolve um texto fixo que cita a fonte [1]', async () => {
    const r = await new FakeLlmProvider().gerar();
    expect(r.texto).toContain('[1]');
  });
});

describe('WorkersAiLlmProvider', () => {
  it('manda mensagens, teto de tokens e token no cabeçalho; devolve o texto e o uso', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      ok({
        response: '  Aceitamos Pix. [1]  ',
        usage: { prompt_tokens: 120, completion_tokens: 9 },
      }),
    );
    const r = await new WorkersAiLlmProvider({ ...base, fetchImpl }).gerar(mensagens, {
      maxTokens: 300,
    });

    expect(r).toEqual({ texto: 'Aceitamos Pix. [1]', tokensEntrada: 120, tokensSaida: 9 });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://api.cloudflare.com/client/v4/accounts/conta123/ai/run/@cf/meta/modelo-x',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer segredo-do-token');
    const corpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(corpo.max_tokens).toBe(300);
    expect(corpo.messages).toEqual([
      { role: 'system', content: 'regras' },
      { role: 'user', content: 'pergunta' },
    ]);
  });

  it('aceita também o formato estilo OpenAI (choices)', async () => {
    const fetchImpl = () => ok({ choices: [{ message: { content: 'Texto do modelo' } }] });
    const r = await new WorkersAiLlmProvider({ ...base, fetchImpl }).gerar(mensagens, {
      maxTokens: 50,
    });
    expect(r.texto).toBe('Texto do modelo');
    expect(r.tokensEntrada).toBeUndefined();
  });

  it('erro da API vira mensagem clara, sem vazar o token', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, errors: [{ message: 'No such model' }] }), {
          status: 400,
        }),
      );
    const erro = await new WorkersAiLlmProvider({ ...base, fetchImpl })
      .gerar(mensagens, { maxTokens: 50 })
      .catch((e: Error) => e);
    expect((erro as Error).message).toContain('HTTP 400');
    expect((erro as Error).message).toContain('No such model');
    expect((erro as Error).message).not.toContain('segredo-do-token');
  });

  it('resposta sem texto é erro, não resposta vazia', async () => {
    const fetchImpl = () => ok({ response: '   ' });
    await expect(
      new WorkersAiLlmProvider({ ...base, fetchImpl }).gerar(mensagens, { maxTokens: 50 }),
    ).rejects.toThrow('formato inesperado');
  });

  it('resposta que não é JSON vira erro claro', async () => {
    const fetchImpl = () => Promise.resolve(new Response('<html>502</html>', { status: 502 }));
    await expect(
      new WorkersAiLlmProvider({ ...base, fetchImpl }).gerar(mensagens, { maxTokens: 50 }),
    ).rejects.toThrow('HTTP 502');
  });
});
