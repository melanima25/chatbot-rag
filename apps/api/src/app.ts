import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { obterIp } from './chat/ip';
import type { Limitador } from './chat/limitador';
import type { Repositorio } from './chat/repositorio';
import type { ResponderFn } from './rag/responder';

export type AppDeps = {
  responder: ResponderFn;
  repositorio: Repositorio;
  limitador: Limitador;
  limites: { perguntasPorConversa: number; tokensPorDia: number };
  /** Cabeçalho do IP real quando há proxy de confiança. */
  ipHeader?: string;
  /** Origens liberadas por CORS; vazio = só a mesma origem. */
  corsOrigens?: string[];
};

const ChatBodySchema = z.object({
  pergunta: z.string().trim().min(2, 'Escreva sua pergunta').max(500, 'Pergunta longa demais'),
  conversaId: z.uuid('Conversa inválida').optional(),
});

export function createApp(deps: AppDeps) {
  const app = new Hono();

  if (deps.corsOrigens?.length) {
    app.use('/api/*', cors({ origin: deps.corsOrigens, allowMethods: ['GET', 'POST', 'OPTIONS'] }));
  }
  app.use(
    '/api/*',
    bodyLimit({ maxSize: 10_000, onError: (c) => c.json({ erro: 'Corpo grande demais' }, 413) }),
  );

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.post('/api/chat', async (c) => {
    // 1) Limite por IP vem primeiro: antes de qualquer trabalho (banco, embedding, modelo).
    const limite = deps.limitador.tentar(obterIp(c, deps.ipHeader));
    if (!limite.permitido) {
      c.header('Retry-After', String(limite.reiniciaEmSeg));
      return c.json(
        {
          codigo: 'muitas_requisicoes',
          erro: `Muitas perguntas em pouco tempo. Tente de novo em ${limite.reiniciaEmSeg} segundos.`,
        },
        429,
      );
    }

    const corpo = ChatBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) {
      return c.json({ erro: corpo.error.issues[0]?.message ?? 'Pedido inválido' }, 400);
    }
    const { pergunta, conversaId } = corpo.data;

    // 2) Teto global do dia (protege a cota gratuita do Workers AI).
    if ((await deps.repositorio.tokensDeHoje()) >= deps.limites.tokensPorDia) {
      return c.json(
        { codigo: 'limite_diario', erro: 'A demonstração atingiu o limite de hoje. Volte amanhã.' },
        503,
      );
    }

    // 3) Teto por conversa.
    if (conversaId) {
      const feitas = await deps.repositorio.perguntasDaConversa(conversaId);
      if (feitas === null) return c.json({ erro: 'Conversa não encontrada' }, 404);
      if (feitas >= deps.limites.perguntasPorConversa) {
        return c.json(
          {
            codigo: 'conversa_cheia',
            erro: `Esta conversa chegou ao limite de ${deps.limites.perguntasPorConversa} perguntas. Comece uma nova.`,
          },
          429,
        );
      }
    }

    const r = await deps.responder(pergunta);

    // Guardar é secundário: se falhar, o cliente ainda recebe a resposta (que já foi paga).
    let idDaConversa: string | null = null;
    try {
      idDaConversa = await deps.repositorio.registrarTroca({ conversaId, pergunta, resultado: r });
    } catch (err) {
      console.error('Falha ao registrar a conversa', err);
    }

    return c.json({
      conversaId: idDaConversa,
      tipo: r.tipo,
      resposta: r.texto,
      fontes: r.fontes.map(({ numero, documento, caminho, citada }) => ({
        numero,
        documento,
        caminho,
        citada,
      })),
    });
  });

  app.notFound((c) => c.json({ erro: 'Rota não encontrada' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ erro: 'Erro interno' }, 500);
  });
  return app;
}
