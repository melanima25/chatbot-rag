import { serve } from '@hono/node-server';
import { createApp } from './app';
import { parseEnv } from './env';

const env = parseEnv();
serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`API em http://localhost:${info.port}`);
});
