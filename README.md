# Chatbot RAG: atendimento que responde só com base nos documentos

> **Projeto de demonstração em construção (semana 17 de 19).** O negócio, os preços e os textos são **fictícios** ("Lava Jato Exemplo"). Não há dados reais.

Um chatbot de atendimento para um negócio pequeno: ele busca nos documentos do negócio os trechos que respondem à pergunta, responde **só com base neles**, cita a fonte e, quando não encontra, diz que não sabe e oferece falar com uma pessoa.

## Onde o projeto está

| Etapa | O que entrega                                                                                         | Situação                                             |
| ----- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| S15   | Base de conhecimento, banco com pgvector, divisão em trechos, ingestão, busca por similaridade        | **pronta**                                           |
| S16   | Resposta com fontes, recusa quando a busca não acha nada parecido, rota `POST /api/chat`              | **pronta** (testada com o modelo de texto real)      |
| S17a  | Limites de uso (por IP, por conversa, teto diário de tokens), conversas guardadas, medição de uso     | **pronta no código**                                 |
| S17b  | Página de chat em React que usa a API                                                                 | **pronta no código**                                 |
| S18   | Avaliação automática (evals): 48 perguntas com a fonte esperada, `npm run eval`, calibração do limite | **ferramenta pronta; falta medir com o modelo real** |
| S19   | Deploy, demonstração pública, README final                                                            | a fazer                                              |

Há uma **página de chat** (`apps/web`) e também dá para ingerir os textos, buscar e **perguntar pela linha de comando ou pela API**. A demonstração pública vem na S19.

## Como rodar

Precisa de Node 22 ou mais novo e Docker.

```bash
docker compose up -d db          # Postgres 16 com pgvector
cp .env.example .env             # no Windows: copy .env.example .env
npm ci
npm run db:migrate               # cria as tabelas e a extensão vector
npm run ingest                   # lê base-conhecimento/*.md e grava os trechos
npm run buscar -- "Vocês aceitam cheque?"
npm run perguntar -- "Vocês aceitam cheque?"
```

Por padrão usa embeddings **de mentira** (locais, sem conta e sem custo): eles só acham textos com palavras em comum e servem para testar o encanamento. Para usar o modelo real do Cloudflare Workers AI, veja a seção abaixo.

### Subir a API e a página de chat

Em dois terminais:

```bash
npm run dev       # API em http://localhost:3000
npm run dev:web   # página em http://localhost:5173 (o Vite repassa /api para a API)
```

Só a API, pelo `curl`:

```bash
npm run dev
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"pergunta":"Vocês aceitam cheque?"}'
```

A resposta traz `conversaId`, `tipo` (`resposta` ou `recusa`), o texto e as fontes. Com os provedores de mentira o texto é fixo; para respostas de verdade veja abaixo.

Para continuar a mesma conversa, mande o `conversaId` de volta: `{"pergunta":"...","conversaId":"..."}`. Cada pergunta é respondida sozinha (o chatbot não usa o histórico como contexto); a conversa existe para guardar e medir.

### Limites de uso

A demonstração pública gasta de uma cota gratuita, então a API se protege em camadas (padrões no `.env.example`):

| Limite                                   | Padrão                     | Resposta ao estourar           |
| ---------------------------------------- | -------------------------- | ------------------------------ |
| Pedidos por IP                           | 8 por minuto e 60 por hora | `429` com `Retry-After`        |
| Perguntas por conversa                   | 20                         | `429`, código `conversa_cheia` |
| Tokens por dia (global, desde 00:00 UTC) | 1,2 milhão                 | `503`, código `limite_diario`  |

Cada resposta do modelo grava os **tokens reais** na tabela `mensagem`; `npm run uso` mostra por dia as respostas, as recusas, os tokens e uma estimativa de neurons contra a cota gratuita. Não se guarda IP nem dado pessoal: só o texto das perguntas (até 500 caracteres) e o uso.

### Modelos reais (Cloudflare Workers AI)

1. No painel da Cloudflare, crie um **API Token** com **somente** a permissão "Workers AI" e anote o Account ID.
2. No `.env`: `EMBEDDING_PROVIDER=workers-ai`, `LLM_PROVIDER=workers-ai`, `CLOUDFLARE_ACCOUNT_ID=...` e `CLOUDFLARE_API_TOKEN=...`. O `.env` está no `.gitignore`: nunca vá para o Git.
3. `npm run ingest` de novo. Como o modelo mudou, os documentos são reingeridos sozinhos.
4. O modelo de texto é `LLM_MODEL` (padrão `@cf/meta/llama-3.1-8b-instruct-fp8-fast`); trocar é só mudar a variável.

### Avaliação (evals)

`evals/perguntas.json` tem 48 perguntas, cada uma com o resultado esperado **de acordo com a base** (não com o que o chatbot respondeu): o texto que a resposta deve conter, o documento que deve ser recuperado, e as perguntas fora da base que devem ser recusadas. Inclui variações da mesma pergunta, perguntas sem acento e tentativas de injeção.

```bash
npm run eval                          # roda todos os casos no mesmo código que a API usa
npm run eval -- --repeticoes=3        # repete cada pergunta: mostra os casos em que o modelo varia
npm run eval -- --id=9,14             # só alguns casos
npm run eval -- --salvar=evals/resultados/2026-10-28.json
npm run eval -- --calibrar            # sem chamar o modelo de texto: o que cada limite de similaridade faria
```

O relatório separa o que importa: perguntas que a base cobre e o chatbot recusou sem precisar, perguntas **fora** da base que ele respondeu (o erro mais grave: é inventar), se o documento certo foi recuperado e se foi citado, e o gasto em neurons. Falhas já conhecidas ficam marcadas no próprio caso (`falhaConhecida`) e não contam como regressão; se uma delas passar a funcionar, o relatório avisa. O comando termina com erro se aparecer falha nova. Não roda no CI porque usa o modelo real (que tem cota); o CI testa a lógica da avaliação com provedores de mentira.

### Testes

```bash
npm test                  # unitários (sem banco)
npm run test:integration  # com Postgres+pgvector (use um banco de TESTE: ele é apagado)
```

O CI do GitHub roda tudo isso a cada push, com o provedor de mentira, **sem chamar nenhuma API**.

## Decisões técnicas

- **pgvector no Postgres** em vez de um banco vetorial à parte: um banco só, e a busca é SQL (`ORDER BY embedding <=> vetor`) com índice HNSW.
- **Cloudflare Workers AI para tudo**, sem chave de API em produção: ver [ADR 0001](docs/adr/0001-workers-ai-sem-chave-de-api.md) e [custos](docs/custos.md).
- **Duas barreiras contra resposta inventada**: abaixo do limite de similaridade (0,45, medido com 48 perguntas, ver [ADR 0003](docs/adr/0003-limite-e-margem-de-contexto.md) e [docs/calibracao-limiar.md](docs/calibracao-limiar.md)) o chatbot recusa sem chamar o modelo; acima dele, o modelo é instruído a responder só com os trechos (os mais próximos do melhor, margem de 0,08) e a devolver um marcador quando não souber, que também vira recusa.
- **A pergunta do cliente é dado, não instrução**: fica separada das regras (papel `user`, dentro de um bloco delimitado) e o cliente não consegue fechar o bloco.
- **Página de chat sem biblioteca de interface**: React + TypeScript e CSS puro, com tema claro/escuro, foco e leitor de tela (`role="log"`, `aria-live`). O texto do modelo é renderizado como texto, nunca como HTML. Cada erro da API (limite por IP com contagem regressiva, conversa cheia, limite diário, rede, servidor) tem tratamento próprio, e a pergunta digitada volta ao campo quando o envio falha. A lógica fica em um hook (`useChat`) testado separado da tela.
- **Limites na memória e sem streaming**: ver [ADR 0002](docs/adr/0002-limites-na-memoria-e-sem-streaming.md).
- **Tudo atrás de uma interface** (`EmbeddingProvider`): o CI e os testes usam um provedor de mentira determinístico; trocar para um modelo pago é uma classe nova.
- **Ingestão idempotente**: cada arquivo tem um hash; se o conteúdo e o modelo são os mesmos, é pulado. Arquivo removido da pasta sai do banco.
- **Divisão em trechos testada**: respeita parágrafos, nunca corta palavra ao meio, mantém título junto do texto e repete o final do trecho anterior (começando numa linha ou frase inteira, nunca num fragmento) para não perder contexto.

## Como usei IA

O código foi escrito com ajuda do Claude (assistente de IA), e eu revisei, executei os testes e decidi as escolhas de arquitetura e custo. Os textos da base de conhecimento foram gerados por IA e revisados por mim; todos os dados são fictícios.

## Estrutura

```
base-conhecimento/    textos fictícios do Lava Jato Exemplo (Markdown)
apps/api/src/rag/     chunk.ts (divisão), embeddings.ts, ingest.ts, busca.ts,
                      prompt.ts, llm.ts, responder.ts (resposta com fontes e recusa)
apps/api/src/chat/    limitador por IP, repositório de conversas, leitura do IP
apps/web/src/         página de chat (App.tsx, useChat.ts, api.ts) e testes
apps/api/src/db/      schema (documento, trecho, conversa, mensagem) e migrations
apps/api/tests/       testes de integração (Postgres + pgvector reais)
docs/                 decisões (ADR), custos e calibração do limite
```
