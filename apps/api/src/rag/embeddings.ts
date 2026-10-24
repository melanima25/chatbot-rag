import { z } from 'zod';
import type { Env } from '../env';
import { EMBEDDING_DIM } from './constantes';

/** Qualquer coisa que transforme textos em vetores. Os testes usam o provedor de mentira. */
export interface EmbeddingProvider {
  /** Identifica o modelo; é gravado no banco para saber quando é preciso reingerir. */
  readonly modelo: string;
  readonly dimensoes: number;
  embed(textos: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------------------------
// Provedor de mentira: determinístico, local, sem rede e sem custo.
// Conta palavras (sem acento, sem palavras comuns) e espalha cada uma em 1024 posições por hash.
// Textos com palavras em comum ficam parecidos: dá para testar a busca de ponta a ponta.
// NÃO entende sentido (não sabe que "preço" e "valor" são parecidos); isso é papel do modelo real.
// ---------------------------------------------------------------------------------------------

const PALAVRAS_COMUNS = new Set(
  (
    'a o as os de da do das dos e em na no nas nos um uma para por com que se ao aos ou qual quais ' +
    'como posso tem voces sao seu sua meu minha eu voce quanto quando onde esta ha foi ser mais ' +
    'menos ate apos sem sobre pelo pela pelos pelas'
  ).split(' '),
);

export function tokenizar(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 1 && !PALAVRAS_COMUNS.has(p))
    .map((p) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p));
}

/** FNV-1a de 32 bits. */
function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelo = 'fake-hash-1024';
  readonly dimensoes = EMBEDDING_DIM;

  embed(textos: string[]): Promise<number[][]> {
    return Promise.resolve(textos.map((t) => this.vetor(t)));
  }

  private vetor(texto: string): number[] {
    const v = new Array<number>(this.dimensoes).fill(0);
    for (const palavra of tokenizar(texto)) {
      const h = fnv1a(palavra);
      const sinal = (h >>> 31) & 1 ? -1 : 1;
      v[h % this.dimensoes] = (v[h % this.dimensoes] ?? 0) + sinal;
    }
    const norma = Math.sqrt(v.reduce((soma, x) => soma + x * x, 0));
    if (norma === 0) {
      v[0] = 1; // texto sem palavras úteis: vetor fixo, para a distância nunca virar NaN
      return v;
    }
    return v.map((x) => x / norma);
  }
}

// ---------------------------------------------------------------------------------------------
// Cloudflare Workers AI (modelo real), chamado pela API REST. Usado pelo `npm run ingest`.
// Dentro do Worker (S16) a chamada será pelo binding `env.AI`, sem token nenhum.
// ---------------------------------------------------------------------------------------------

const RespostaSchema = z.object({
  success: z.boolean(),
  result: z.object({ data: z.array(z.array(z.number())) }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type OpcoesWorkersAi = {
  accountId: string;
  apiToken: string;
  /** Quantos textos por chamada. */
  tamanhoLote?: number;
  /** Injetável nos testes. */
  fetchImpl?: typeof fetch;
};

export class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  readonly modelo = '@cf/baai/bge-m3';
  readonly dimensoes = EMBEDDING_DIM;
  private readonly tamanhoLote: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opcoes: OpcoesWorkersAi) {
    this.tamanhoLote = opcoes.tamanhoLote ?? 20;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
  }

  async embed(textos: string[]): Promise<number[][]> {
    const saida: number[][] = [];
    for (let i = 0; i < textos.length; i += this.tamanhoLote) {
      saida.push(...(await this.chamar(textos.slice(i, i + this.tamanhoLote))));
    }
    return saida;
  }

  private async chamar(lote: string[]): Promise<number[][]> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.opcoes.accountId}/ai/run/${this.modelo}`;
    const resposta = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opcoes.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: lote }),
    });
    const json: unknown = await resposta.json().catch(() => null);
    const corpo = RespostaSchema.safeParse(json);
    if (!resposta.ok || !corpo.success || !corpo.data.success || !corpo.data.result) {
      const motivo = corpo.success ? corpo.data.errors?.[0]?.message : undefined;
      throw new Error(
        `Workers AI recusou o pedido (HTTP ${resposta.status})${motivo ? `: ${motivo}` : ''}`,
      );
    }
    const vetores = corpo.data.result.data;
    if (vetores.length !== lote.length) {
      throw new Error(`Workers AI devolveu ${vetores.length} vetores para ${lote.length} textos`);
    }
    for (const v of vetores) {
      if (v.length !== this.dimensoes) {
        throw new Error(`Vetor com ${v.length} dimensões; o esperado é ${this.dimensoes}`);
      }
    }
    return vetores;
  }
}

export function criarProvedor(
  env: Pick<Env, 'EMBEDDING_PROVIDER' | 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_API_TOKEN'>,
): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === 'workers-ai') {
    return new WorkersAiEmbeddingProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
      apiToken: env.CLOUDFLARE_API_TOKEN ?? '',
    });
  }
  return new FakeEmbeddingProvider();
}
