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
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_API_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMBEDDING_PROVIDER !== 'workers-ai') return;
    for (const campo of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'] as const) {
      if (!env[campo]) {
        ctx.addIssue({
          code: 'custom',
          path: [campo],
          message: `${campo} é obrigatória quando EMBEDDING_PROVIDER=workers-ai`,
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
