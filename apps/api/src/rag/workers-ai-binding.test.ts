import { describe, expect, it, vi } from 'vitest';
import { BindingEmbeddingProvider, BindingLlmProvider } from './workers-ai-binding';

const vetor = (n = 1024) => new Array<number>(n).fill(0.1);

describe('BindingEmbeddingProvider', () => {
  it('manda os textos e devolve os vetores', async () => {
    const run = vi.fn().mockResolvedValue({ shape: [2, 1024], data: [vetor(), vetor()] });
    const r = await new BindingEmbeddingProvider({ run }).embed(['a', 'b']);
    expect(r).toHaveLength(2);
    expect(run).toHaveBeenCalledWith('@cf/baai/bge-m3', { text: ['a', 'b'] });
  });

  it('recusa formato inesperado', async () => {
    const run = vi.fn().mockResolvedValue({ data: 'nada' });
    await expect(new BindingEmbeddingProvider({ run }).embed(['a'])).rejects.toThrow(/formato/);
  });

  it('recusa quantidade de vetores diferente da de textos', async () => {
    const run = vi.fn().mockResolvedValue({ data: [vetor()] });
    await expect(new BindingEmbeddingProvider({ run }).embed(['a', 'b'])).rejects.toThrow(
      /1 vetores para 2 textos/,
    );
  });

  it('recusa vetor com dimensão errada', async () => {
    const run = vi.fn().mockResolvedValue({ data: [vetor(768)] });
    await expect(new BindingEmbeddingProvider({ run }).embed(['a'])).rejects.toThrow(/768/);
  });
});

describe('BindingLlmProvider', () => {
  const mensagens = [
    { papel: 'system' as const, conteudo: 'regras' },
    { papel: 'user' as const, conteudo: 'pergunta' },
  ];

  it('traduz as mensagens e lê texto e uso', async () => {
    const run = vi.fn().mockResolvedValue({
      response: '  Aceitamos Pix. [1] ',
      usage: { prompt_tokens: 600, completion_tokens: 30 },
    });
    const llm = new BindingLlmProvider({ run }, '@cf/meta/modelo');
    const r = await llm.gerar(mensagens, { maxTokens: 300 });
    expect(r).toEqual({ texto: 'Aceitamos Pix. [1]', tokensEntrada: 600, tokensSaida: 30 });
    expect(run).toHaveBeenCalledWith('@cf/meta/modelo', {
      messages: [
        { role: 'system', content: 'regras' },
        { role: 'user', content: 'pergunta' },
      ],
      max_tokens: 300,
      temperature: 0.2,
    });
  });

  it('aceita o formato estilo OpenAI (choices)', async () => {
    const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Oi' } }] });
    const r = await new BindingLlmProvider({ run }, 'm').gerar(mensagens, { maxTokens: 50 });
    expect(r.texto).toBe('Oi');
  });

  it('falha quando não vem texto', async () => {
    const run = vi.fn().mockResolvedValue({ response: '   ' });
    await expect(
      new BindingLlmProvider({ run }, 'm').gerar(mensagens, { maxTokens: 50 }),
    ).rejects.toThrow(/formato inesperado/);
  });

  it('deixa passar o erro do binding', async () => {
    const run = vi.fn().mockRejectedValue(new Error('cota estourada'));
    await expect(
      new BindingLlmProvider({ run }, 'm').gerar(mensagens, { maxTokens: 50 }),
    ).rejects.toThrow('cota estourada');
  });
});
