# ADR 0001: Cloudflare Workers AI para embeddings e respostas

- Status: aceita (17/10/2026)
- Decisão de: Breno, depois de comparar custos (ver [docs/custos.md](../custos.md))

## Contexto

O chatbot precisa de dois modelos: um de **embeddings** (transforma texto em vetor para a busca) e um de **linguagem** (escreve a resposta com base nos trechos encontrados). Este é um projeto de demonstração, sem receita: o objetivo é ser funcional e barato, não ter a melhor resposta possível.

Opções consideradas:

1. Claude Haiku 5.5 (respostas) + Voyage (embeddings): melhor qualidade, mas duas contas, duas chaves e gasto em dólar.
2. **Cloudflare Workers AI para tudo.**
3. Claude Sonnet 5.5 + Voyage: respostas melhores, custo cerca de 20 vezes maior.

## Decisão

Opção 2. O site, a API e o banco já estão na Cloudflare, e o Workers AI tem uma cota diária gratuita.

- **Embeddings:** `@cf/baai/bge-m3` (multilíngue, 1024 dimensões).
- **Respostas (decidido na S16):** um modelo de texto do catálogo do Workers AI. O catálogo mudou desde o levantamento de preços, então o modelo exato será escolhido e medido nos evals, não presumido.

## Consequências

- **Sem chave de API em produção.** Dentro do Worker o modelo é chamado pelo binding `env.AI`, sem segredo nenhum no código ou no deploy. Só o `npm run ingest` feito do computador do desenvolvedor usa um token (com permissão apenas de Workers AI), que fica no `.env` local.
- Tudo atrás da interface `EmbeddingProvider`: trocar de fornecedor (ou usar o provedor de mentira nos testes e no CI) não mexe no resto do código. **Quando o projeto tiver verba, a troca para um modelo pago é uma classe nova, não uma reescrita.**
- Modelos pequenos erram mais. Por isso o projeto tem recusa por limiar de similaridade e evals (S18) que **medem** o resultado, em vez de afirmar que funciona.
- O modelo de embedding fica gravado em cada documento. Trocar de modelo obriga a reingerir (a ingestão detecta sozinha).
- Cota gratuita é diária e compartilhada com o resto da conta. Na S17 entram limite de requisições por IP e teto de tokens por resposta.
