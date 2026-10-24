# Chatbot RAG: atendimento que responde só com base nos documentos

> **Projeto de demonstração em construção (semana 15 de 19).** O negócio, os preços e os textos são **fictícios** ("Lava Jato Exemplo"). Não há dados reais.

Um chatbot de atendimento para um negócio pequeno: ele busca nos documentos do negócio os trechos que respondem à pergunta, responde **só com base neles**, cita a fonte e, quando não encontra, diz que não sabe e oferece falar com uma pessoa.

## Onde o projeto está

| Etapa | O que entrega                                                                                  | Situação   |
| ----- | ---------------------------------------------------------------------------------------------- | ---------- |
| S15   | Base de conhecimento, banco com pgvector, divisão em trechos, ingestão, busca por similaridade | **pronta** |
| S16   | Resposta com fontes, recusa quando a busca não acha nada parecido                              | a fazer    |
| S17   | Widget de chat em React, resposta em streaming, limites de uso                                 | a fazer    |
| S18   | Avaliação automática (evals) com perguntas e fontes esperadas                                  | a fazer    |
| S19   | Deploy, demonstração pública, README final                                                     | a fazer    |

Ainda **não há chat**: hoje dá para ingerir os textos e fazer a busca pela linha de comando.

## Como rodar

Precisa de Node 22 ou mais novo e Docker.

```bash
docker compose up -d db          # Postgres 16 com pgvector
cp .env.example .env             # no Windows: copy .env.example .env
npm ci
npm run db:migrate               # cria as tabelas e a extensão vector
npm run ingest                   # lê base-conhecimento/*.md e grava os trechos
npm run buscar -- "Vocês aceitam cheque?"
```

Por padrão usa embeddings **de mentira** (locais, sem conta e sem custo): eles só acham textos com palavras em comum e servem para testar o encanamento. Para usar o modelo real do Cloudflare Workers AI, veja a seção abaixo.

### Embeddings reais (Cloudflare Workers AI)

1. No painel da Cloudflare, crie um **API Token** com **somente** a permissão "Workers AI" e anote o Account ID.
2. No `.env`: `EMBEDDING_PROVIDER=workers-ai`, `CLOUDFLARE_ACCOUNT_ID=...` e `CLOUDFLARE_API_TOKEN=...`. O `.env` está no `.gitignore`: nunca vá para o Git.
3. `npm run ingest` de novo. Como o modelo mudou, os documentos são reingeridos sozinhos.

### Testes

```bash
npm test                  # unitários (sem banco)
npm run test:integration  # com Postgres+pgvector (use um banco de TESTE: ele é apagado)
```

O CI do GitHub roda tudo isso a cada push, com o provedor de mentira, **sem chamar nenhuma API**.

## Decisões técnicas

- **pgvector no Postgres** em vez de um banco vetorial à parte: um banco só, e a busca é SQL (`ORDER BY embedding <=> vetor`) com índice HNSW.
- **Cloudflare Workers AI para tudo**, sem chave de API em produção: ver [ADR 0001](docs/adr/0001-workers-ai-sem-chave-de-api.md) e [custos](docs/custos.md).
- **Tudo atrás de uma interface** (`EmbeddingProvider`): o CI e os testes usam um provedor de mentira determinístico; trocar para um modelo pago é uma classe nova.
- **Ingestão idempotente**: cada arquivo tem um hash; se o conteúdo e o modelo são os mesmos, é pulado. Arquivo removido da pasta sai do banco.
- **Divisão em trechos testada**: respeita parágrafos, nunca corta palavra ao meio, mantém título junto do texto e repete um pedaço do trecho anterior para não perder contexto.

## Como usei IA

O código foi escrito com ajuda do Claude (assistente de IA), e eu revisei, executei os testes e decidi as escolhas de arquitetura e custo. Os textos da base de conhecimento foram gerados por IA e revisados por mim; todos os dados são fictícios.

## Estrutura

```
base-conhecimento/    textos fictícios do Lava Jato Exemplo (Markdown)
apps/api/src/rag/     chunk.ts (divisão), embeddings.ts, ingest.ts, busca.ts
apps/api/src/db/      schema (documento, trecho) e migrations
apps/api/tests/       testes de integração (Postgres + pgvector reais)
docs/                 decisões (ADR) e custos
```
