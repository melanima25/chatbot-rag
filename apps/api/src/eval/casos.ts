import { z } from 'zod';

const CasoSchema = z
  .object({
    id: z.number().int().positive(),
    pergunta: z.string().min(2),
    /**
     * "resposta": a base cobre e o chatbot deve responder.
     * "recusa": está fora do que a base cobre; responder seria inventar.
     * "recusa_ou_resposta": a base responde só "não fazemos isso"; recusar e responder "não" são aceitáveis.
     */
    esperado: z.enum(['resposta', 'recusa', 'recusa_ou_resposta']),
    /**
     * Documento(s) da base que respondem. Com uma lista, TODOS devem ter sido recuperados. Dentro de um
     * item, "a.md|b.md" aceita qualquer um dos dois (quando dois documentos respondem a mesma coisa).
     */
    fonte: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
    /** Cada item é obrigatório; use "a|b" para aceitar qualquer das variações. Sem acento e sem maiúscula. */
    deveConter: z.array(z.string().min(1)).optional(),
    naoDeveConter: z.array(z.string().min(1)).optional(),
    /** Falha já conhecida (motivo). A falha deixa de contar como regressão e passa a ser relatada à parte. */
    falhaConhecida: z.string().optional(),
    /** `true` quando um humano conferiu a pergunta e o resultado esperado contra a base. */
    revisado: z.boolean().optional(),
    observacao: z.string().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fontes = fontesEsperadas(c);
    if (c.esperado === 'resposta') {
      if (fontes.length === 0) {
        ctx.addIssue({ code: 'custom', message: `caso ${c.id}: "resposta" exige "fonte"` });
      }
      if (!c.deveConter?.length) {
        ctx.addIssue({ code: 'custom', message: `caso ${c.id}: "resposta" exige "deveConter"` });
      }
    }
    if (c.esperado !== 'resposta' && fontes.length > 0) {
      ctx.addIssue({ code: 'custom', message: `caso ${c.id}: só "resposta" tem "fonte"` });
    }
  });

export const ArquivoEvalSchema = z
  .object({ descricao: z.string().optional(), casos: z.array(CasoSchema).min(1) })
  .superRefine((a, ctx) => {
    const vistos = new Set<number>();
    for (const c of a.casos) {
      if (vistos.has(c.id)) ctx.addIssue({ code: 'custom', message: `id repetido: ${c.id}` });
      vistos.add(c.id);
    }
  });

export type CasoEval = z.infer<typeof CasoSchema>;

export function fontesEsperadas(c: Pick<CasoEval, 'fonte'>): string[] {
  if (!c.fonte) return [];
  return Array.isArray(c.fonte) ? c.fonte : [c.fonte];
}

/** Lê e valida o arquivo de casos; a mensagem de erro aponta o caso com problema. */
export function lerCasos(json: unknown): CasoEval[] {
  const r = ArquivoEvalSchema.safeParse(json);
  if (!r.success) {
    const problemas = r.error.issues
      .map((i) => `- ${i.path.join('.') || 'arquivo'}: ${i.message}`)
      .join('\n');
    throw new Error(`Arquivo de avaliação inválido:\n${problemas}`);
  }
  return r.data.casos;
}

/** Os documentos aceitos para um item de `fonte` ("a.md|b.md" = qualquer um dos dois). */
export function alternativasDeFonte(item: string): string[] {
  return item.split('|').map((x) => x.trim());
}

/** Alguma das alternativas do item aparece entre os documentos recuperados? */
export function fonteAtendida(item: string, recuperados: string[]): boolean {
  return alternativasDeFonte(item).some((f) => recuperados.includes(f));
}
