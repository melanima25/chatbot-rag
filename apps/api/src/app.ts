import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ResponderFn } from './rag/responder';

export type AppDeps = {
  responder: ResponderFn;
};

const ChatBodySchema = z.object({
  pergunta: z.string().trim().min(2, 'Escreva sua pergunta').max(500, 'Pergunta longa demais'),
});

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use(
    '/api/*',
    bodyLimit({ maxSize: 10_000, onError: (c) => c.json({ erro: 'Corpo grande demais' }, 413) }),
  );

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.post('/api/chat', async (c) => {
    const corpo = ChatBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) {
      return c.json({ erro: corpo.error.issues[0]?.message ?? 'Pedido inválido' }, 400);
    }
    const r = await deps.responder(corpo.data.pergunta);
    return c.json({
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
