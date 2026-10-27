import { z } from 'zod';

const RespostaSchema = z.object({
  conversaId: z.string().nullable(),
  tipo: z.enum(['resposta', 'recusa']),
  resposta: z.string(),
  fontes: z.array(
    z.object({
      numero: z.number(),
      documento: z.string(),
      caminho: z.string(),
      citada: z.boolean(),
    }),
  ),
});

const ErroSchema = z.object({ codigo: z.string().optional(), erro: z.string().optional() });

export type RespostaChat = z.infer<typeof RespostaSchema>;
export type Fonte = RespostaChat['fontes'][number];

/** Tudo que pode dar errado, em tipos que a tela sabe tratar (nada de "erro genérico"). */
export type ErroChat =
  | { tipo: 'muitas_requisicoes'; esperaSeg: number }
  | { tipo: 'conversa_cheia' }
  | { tipo: 'limite_diario' }
  | { tipo: 'conversa_nao_encontrada' }
  | { tipo: 'pedido_invalido'; mensagem: string }
  | { tipo: 'rede' }
  | { tipo: 'servidor' };

export type ResultadoChat = { ok: true; dados: RespostaChat } | { ok: false; erro: ErroChat };

export type EnviarPergunta = (
  pergunta: string,
  conversaId?: string | null,
) => Promise<ResultadoChat>;

type Opcoes = { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

const ESPERA_PADRAO_SEG = 60;

/** Cliente da API. Nunca lança: devolve `{ ok: false, erro }`, e a tela decide o que mostrar. */
export function criarCliente({
  baseUrl = '',
  fetchImpl,
  timeoutMs = 30_000,
}: Opcoes = {}): EnviarPergunta {
  return async (pergunta, conversaId) => {
    // Chamar `fetch` solto (e não como método de um objeto) evita "Illegal invocation" no navegador.
    const chamar = fetchImpl ?? fetch;
    let resposta: Response;
    try {
      resposta = await chamar(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversaId ? { pergunta, conversaId } : { pergunta }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, erro: { tipo: 'rede' } };
    }

    const json: unknown = await resposta.json().catch(() => null);

    if (resposta.ok) {
      const dados = RespostaSchema.safeParse(json);
      return dados.success
        ? { ok: true, dados: dados.data }
        : { ok: false, erro: { tipo: 'servidor' } };
    }

    const erro = ErroSchema.safeParse(json);
    const codigo = erro.success ? erro.data.codigo : undefined;
    const mensagem = erro.success ? erro.data.erro : undefined;

    if (resposta.status === 429 && codigo === 'conversa_cheia') {
      return { ok: false, erro: { tipo: 'conversa_cheia' } };
    }
    if (resposta.status === 429) {
      const espera = Number(resposta.headers.get('Retry-After'));
      const esperaSeg = Number.isFinite(espera) && espera > 0 ? espera : ESPERA_PADRAO_SEG;
      return { ok: false, erro: { tipo: 'muitas_requisicoes', esperaSeg } };
    }
    if (resposta.status === 503 && codigo === 'limite_diario') {
      return { ok: false, erro: { tipo: 'limite_diario' } };
    }
    if (resposta.status === 404) {
      return { ok: false, erro: { tipo: 'conversa_nao_encontrada' } };
    }
    if (resposta.status === 400 || resposta.status === 413) {
      return {
        ok: false,
        erro: { tipo: 'pedido_invalido', mensagem: mensagem ?? 'Pedido inválido' },
      };
    }
    return { ok: false, erro: { tipo: 'servidor' } };
  };
}

export const perguntar: EnviarPergunta = criarCliente({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
});
