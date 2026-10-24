import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIM } from './constantes';
import { FakeEmbeddingProvider, tokenizar, WorkersAiEmbeddingProvider } from './embeddings';

const cosseno = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

describe('tokenizar', () => {
  it('ignora acento, maiúscula, pontuação e palavras comuns', () => {
    expect(tokenizar('Qual o HORÁRIO de funcionamento, aos sábados?')).toEqual([
      'horario',
      'funcionamento',
      'sabado',
    ]);
  });
});

describe('FakeEmbeddingProvider', () => {
  const p = new FakeEmbeddingProvider();

  it('devolve vetores de 1024 posições com norma 1', async () => {
    const [v] = await p.embed(['aceitam cheque?']);
    expect(v).toHaveLength(EMBEDDING_DIM);
    expect(Math.sqrt((v ?? []).reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
  });

  it('é determinístico', async () => {
    expect(await p.embed(['pix e dinheiro'])).toEqual(await p.embed(['pix e dinheiro']));
  });

  it('textos com palavras em comum ficam mais parecidos que textos sem relação', async () => {
    const [a, b, c] = await p.embed([
      'Aceitamos Pix, dinheiro e cartão',
      'Quais as formas de pagamento: pix, dinheiro?',
      'Vitrificação de pintura leva o dia todo',
    ]);
    expect(cosseno(a ?? [], b ?? [])).toBeGreaterThan(cosseno(a ?? [], c ?? []));
  });

  it('texto sem palavras úteis não gera NaN', async () => {
    const [v] = await p.embed(['de a o']);
    expect(v?.every(Number.isFinite)).toBe(true);
  });
});

function respostaOk(n: number) {
  return new Response(
    JSON.stringify({
      success: true,
      result: { data: Array.from({ length: n }, () => new Array(EMBEDDING_DIM).fill(0.1)) },
    }),
    { status: 200 },
  );
}

describe('WorkersAiEmbeddingProvider', () => {
  const base = { accountId: 'conta123', apiToken: 'segredo-do-token' };

  it('manda token no cabeçalho, divide em lotes e junta os resultados na ordem', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const { text } = JSON.parse(String(init?.body)) as { text: string[] };
      return Promise.resolve(respostaOk(text.length));
    });
    const p = new WorkersAiEmbeddingProvider({ ...base, tamanhoLote: 2, fetchImpl });
    const vetores = await p.embed(['a', 'b', 'c', 'd', 'e']);

    expect(vetores).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://api.cloudflare.com/client/v4/accounts/conta123/ai/run/@cf/baai/bge-m3',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer segredo-do-token');
  });

  it('erro da API vira mensagem clara, sem vazar o token', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ success: false, errors: [{ message: 'Authentication error' }] }),
          {
            status: 403,
          },
        ),
      ),
    );
    const p = new WorkersAiEmbeddingProvider({ ...base, fetchImpl });
    const erro = await p.embed(['x']).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toContain('HTTP 403');
    expect((erro as Error).message).toContain('Authentication error');
    expect((erro as Error).message).not.toContain('segredo-do-token');
  });

  it('recusa resposta com quantidade ou dimensão erradas', async () => {
    const poucos = new WorkersAiEmbeddingProvider({
      ...base,
      fetchImpl: () => Promise.resolve(respostaOk(1)),
    });
    await expect(poucos.embed(['a', 'b'])).rejects.toThrow('1 vetores para 2 textos');

    const dimErrada = new WorkersAiEmbeddingProvider({
      ...base,
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, result: { data: [[0.1, 0.2]] } })),
        ),
    });
    await expect(dimErrada.embed(['a'])).rejects.toThrow('2 dimensões');
  });

  it('resposta que não é JSON também vira erro claro', async () => {
    const p = new WorkersAiEmbeddingProvider({
      ...base,
      fetchImpl: () => Promise.resolve(new Response('<html>502</html>', { status: 502 })),
    });
    await expect(p.embed(['a'])).rejects.toThrow('HTTP 502');
  });
});
