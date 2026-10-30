/**
 * Workers AI pelo binding `env.AI`: o jeito de chamar o modelo de dentro de um Worker.
 * Sem token e sem pedido HTTP manual; a Cloudflare autentica pelo próprio Worker.
 * Os provedores só dependem de `AiBinding` (uma função `run`), então os testes passam um de mentira.
 */
import { z } from 'zod';
import { EMBEDDING_DIM } from './constantes';
import type { EmbeddingProvider } from './embeddings';
import { resultadoParaResposta, type LlmProvider, type Mensagem, type RespostaLlm } from './llm';

/** O mínimo que usamos do binding `env.AI`. */
export type AiBinding = {
  run(modelo: string, entrada: Record<string, unknown>): Promise<unknown>;
};

const ResultadoEmbeddingSchema = z.object({ data: z.array(z.array(z.number())) });

export class BindingEmbeddingProvider implements EmbeddingProvider {
  readonly modelo = '@cf/baai/bge-m3';
  readonly dimensoes = EMBEDDING_DIM;

  constructor(private readonly ai: AiBinding) {}

  async embed(textos: string[]): Promise<number[][]> {
    const bruto = await this.ai.run(this.modelo, { text: textos });
    const resultado = ResultadoEmbeddingSchema.safeParse(bruto);
    if (!resultado.success) throw new Error('Workers AI devolveu embeddings em formato inesperado');
    const vetores = resultado.data.data;
    if (vetores.length !== textos.length) {
      throw new Error(`Workers AI devolveu ${vetores.length} vetores para ${textos.length} textos`);
    }
    for (const v of vetores) {
      if (v.length !== this.dimensoes) {
        throw new Error(`Vetor com ${v.length} dimensões; o esperado é ${this.dimensoes}`);
      }
    }
    return vetores;
  }
}

export class BindingLlmProvider implements LlmProvider {
  constructor(
    private readonly ai: AiBinding,
    readonly modelo: string,
  ) {}

  async gerar(mensagens: Mensagem[], { maxTokens }: { maxTokens: number }): Promise<RespostaLlm> {
    const bruto = await this.ai.run(this.modelo, {
      messages: mensagens.map((m) => ({ role: m.papel, content: m.conteudo })),
      max_tokens: maxTokens,
      temperature: 0.2,
    });
    return resultadoParaResposta(bruto);
  }
}
