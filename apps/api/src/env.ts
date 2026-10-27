import { z } from 'zod';

const EnvSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL é obrigatória')
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL deve começar com postgres://'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** "fake": embeddings locais de mentira (testes e primeiro contato). "workers-ai": reais. */
    EMBEDDING_PROVIDER: z.enum(['fake', 'workers-ai']).default('fake'),
    /** "fake": respostas de teste, sem rede. "workers-ai": modelo de texto real. */
    LLM_PROVIDER: z.enum(['fake', 'workers-ai']).default('fake'),
    /** Modelo de texto do Workers AI. Trocar é só mudar esta variável. */
    LLM_MODEL: z.string().min(1).default('@cf/meta/llama-3.1-8b-instruct-fp8-fast'),
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_API_TOKEN: z.string().optional(),
    /** Abaixo desta similaridade (0 a 1) o trecho não conta, e se nenhum passar o chatbot recusa. */
    SIMILARIDADE_MINIMA: z.coerce.number().min(0).max(1).default(0.55),
    /** Quantos trechos entram no contexto da resposta. */
    TOP_K: z.coerce.number().int().min(1).max(10).default(4),
    /** Teto de tokens da resposta (controle de custo). */
    MAX_TOKENS_RESPOSTA: z.coerce.number().int().min(50).max(1000).default(300),
    /** Pedidos por IP por minuto e por hora (limite na memória do servidor). */
    LIMITE_POR_MINUTO: z.coerce.number().int().min(1).max(100).default(8),
    LIMITE_POR_HORA: z.coerce.number().int().min(1).max(1000).default(60),
    /** Perguntas por conversa; evita uma conversa eterna usada como túnel. */
    LIMITE_PERGUNTAS_CONVERSA: z.coerce.number().int().min(1).max(200).default(20),
    /**
     * Teto global de tokens (entrada + saída) por dia UTC. O padrão fica em ~2/3 da cota grátis
     * de 10.000 neurons/dia (≈ 1,8 milhão de tokens na média medida) para sobrar margem.
     */
    ORCAMENTO_TOKENS_DIA: z.coerce.number().int().min(1000).default(1_200_000),
    /** Cabeçalho com o IP real, se houver proxy de confiança (ex.: cf-connecting-ip). */
    IP_HEADER: z.string().min(1).optional(),
    /** Origens autorizadas a chamar a API pelo navegador (CORS), separadas por vírgula. */
    CORS_ORIGENS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z.string().refine((o) => {
            try {
              return new URL(o).origin === o;
            } catch {
              return false;
            }
          }, 'cada origem deve ser só esquema + domínio, ex.: https://exemplo.com (sem barra no fim)'),
        ),
      ),
  })
  .superRefine((env, ctx) => {
    if (env.EMBEDDING_PROVIDER !== 'workers-ai' && env.LLM_PROVIDER !== 'workers-ai') return;
    const motivo = env.EMBEDDING_PROVIDER === 'workers-ai' ? 'EMBEDDING_PROVIDER' : 'LLM_PROVIDER';
    for (const campo of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'] as const) {
      if (!env[campo]) {
        ctx.addIssue({
          code: 'custom',
          path: [campo],
          message: `${campo} é obrigatória quando ${motivo}=workers-ai`,
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Valida variáveis de ambiente; falha cedo com mensagem legível (sem imprimir valores). */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problemas = result.error.issues
      .map((i) => `- ${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${problemas}`);
  }
  return result.data;
}
