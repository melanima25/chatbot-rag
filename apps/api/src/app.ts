import { Hono } from 'hono';

/** S15: só a verificação de saúde. A rota de chat chega na S16. */
export function createApp() {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.notFound((c) => c.json({ erro: 'Rota não encontrada' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ erro: 'Erro interno' }, 500);
  });
  return app;
}
