import { z } from 'zod';
import type { Env } from '../env';

export type Mensagem = { papel: 'system' | 'user' | 'assistant'; conteudo: string };

export type RespostaLlm = {
  texto: string;
  /** Só vêm preenchidos quando o provedor informa. */
  tokensEntrada?: number;
  tokensSaida?: number;
};

/** Qualquer coisa que gere texto a partir de mensagens. Os testes usam um provedor de mentira. */
export interface LlmProvider {
  readonly modelo: string;
  gerar(mensagens: Mensagem[], opcoes: { maxTokens: number }): Promise<RespostaLlm>;
}

/**
 * Provedor de mentira: não entende nada, só devolve um texto fixo que cita a fonte [1].
 * Serve para testar o encanamento (busca -> prompt -> resposta) sem rede e sem custo.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly modelo = 'fake-llm';

  gerar(): Promise<RespostaLlm> {
    return Promise.resolve({
      texto: 'Resposta de teste (provedor de mentira), com base na primeira fonte. [1]',
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Cloudflare Workers AI (modelo de texto real), pela API REST. No Worker (deploy) será o binding.
// O formato da resposta varia entre modelos: aceitamos `response` (texto) e o formato estilo
// OpenAI (`choices[0].message.content`).
// ---------------------------------------------------------------------------------------------

const ResultadoSchema = z.object({
  response: z.string().nullish(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullish() }).nullish() }))
    .nullish(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullish(),
});

const RespostaSchema = z.object({
  success: z.boolean(),
  result: ResultadoSchema.nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

/** Transforma o `result` do Workers AI (REST ou binding) numa resposta; erra se vier sem texto. */
export function resultadoParaResposta(resultado: unknown): RespostaLlm {
  const r = ResultadoSchema.safeParse(resultado);
  const texto = r.success ? (r.data.response ?? r.data.choices?.[0]?.message?.content) : undefined;
  if (!r.success || typeof texto !== 'string' || !texto.trim()) {
    throw new Error('Workers AI não devolveu texto de resposta (formato inesperado)');
  }
  return {
    texto: texto.trim(),
    tokensEntrada: r.data.usage?.prompt_tokens,
    tokensSaida: r.data.usage?.completion_tokens,
  };
}

export type OpcoesLlmWorkersAi = {
  accountId: string;
  apiToken: string;
  modelo: string;
  fetchImpl?: typeof fetch;
};

export class WorkersAiLlmProvider implements LlmProvider {
  readonly modelo: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opcoes: OpcoesLlmWorkersAi) {
    this.modelo = opcoes.modelo;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
  }

  async gerar(mensagens: Mensagem[], { maxTokens }: { maxTokens: number }): Promise<RespostaLlm> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.opcoes.accountId}/ai/run/${this.modelo}`;
    const resposta = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opcoes.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: mensagens.map((m) => ({ role: m.papel, content: m.conteudo })),
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });
    const json: unknown = await resposta.json().catch(() => null);
    const corpo = RespostaSchema.safeParse(json);
    if (!resposta.ok || !corpo.success || !corpo.data.success || !corpo.data.result) {
      const motivo = corpo.success ? corpo.data.errors?.[0]?.message : undefined;
      throw new Error(
        `Workers AI recusou o pedido (HTTP ${resposta.status})${motivo ? `: ${motivo}` : ''}`,
      );
    }
    return resultadoParaResposta(corpo.data.result);
  }
}

export function criarLlm(
  env: Pick<Env, 'LLM_PROVIDER' | 'LLM_MODEL' | 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_API_TOKEN'>,
): LlmProvider {
  if (env.LLM_PROVIDER === 'workers-ai') {
    return new WorkersAiLlmProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
      apiToken: env.CLOUDFLARE_API_TOKEN ?? '',
      modelo: env.LLM_MODEL,
    });
  }
  return new FakeLlmProvider();
}
