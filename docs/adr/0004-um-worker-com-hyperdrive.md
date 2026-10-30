# ADR 0004: um Worker só, com Hyperdrive para o Neon

Data: 30/10/2026. Situação: aceita.

## Contexto

A demonstração pública precisa servir a página de chat e a API, chamar o Workers AI sem guardar token em lugar nenhum e falar com o Postgres (Neon, com pgvector). O projeto roda no Node em desenvolvimento (`apps/api/src/index.ts`).

## Decisões

**1. Um Worker serve tudo.** A página (`apps/web`, gerada pelo Vite) vai como _static assets_ do Wrangler e o Worker só recebe `/api/*` (`run_worker_first`). Resultado: uma URL, sem CORS e um único deploy (`npm run deploy`). A alternativa (página no Pages e API em Worker) teria duas URLs, `CORS_ORIGENS` para manter e mais uma peça que pode quebrar.

**2. O modelo é chamado pelo binding `env.AI`**, sem token (ADR 0001). Duas classes novas (`BindingEmbeddingProvider`, `BindingLlmProvider`) implementam as mesmas interfaces de antes, então `responder`, rota e limites **não mudaram**. O formato do resultado é lido pela mesma função nas duas formas de chamar (REST e binding).

**3. O banco entra por Hyperdrive**, criado com cache desligado (`--caching-disabled`). Motivo: o Hyperdrive guarda em cache o resultado de consultas de leitura; o teto diário de tokens e a contagem de perguntas da conversa precisam sempre do valor atual. O Hyperdrive mantém o pool até o Neon; no Worker abro **uma conexão por pedido** (`max: 1`) e fecho depois da resposta, com `ctx.waitUntil`.

**4. A configuração do Worker sai dos mesmos nomes de variável do Node** (`ambienteDoWorker` chama o mesmo `parseEnv`), só que a conexão vem do Hyperdrive e o token não é exigido. Uma variável solta `DATABASE_URL` não sobrepõe o Hyperdrive.

**5. `IP_HEADER=cf-connecting-ip` fica no `wrangler.jsonc`.** Atrás da Cloudflare o cliente não consegue forjar esse cabeçalho; é o caso em que confiar nele é seguro (ver ADR 0002).

## Consequências

- Continua valendo o que o ADR 0002 diz: o limite por IP é por instância. O teto diário (do banco) é o que segura o custo.
- O código do Worker é testado em Node, com o banco real e um `env.AI` de mentira (`tests/worker.integration.test.ts`). O que esses testes **não** cobrem é o ambiente real da Cloudflare (Hyperdrive de verdade, binding de verdade): por isso o README tem uma lista de conferência para depois do deploy.
- `pg` no Worker exige a flag `nodejs_compat`.
- Migrations e ingestão continuam rodando do computador (`npm run db:migrate`, `npm run ingest`), direto no Neon.
