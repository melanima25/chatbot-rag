# Custos e limites (levantamento de 17/10/2026)

Fontes oficiais consultadas em 17/10/2026. Preços mudam: confira as páginas antes de decidir algo que dependa de dinheiro.

## Escolhido: Cloudflare Workers AI

- Plano Workers Free: **10.000 neurons por dia sem custo** (zera às 00:00 UTC). Acima disso, no plano pago, US$ 0,011 por 1.000 neurons.
- Embeddings `@cf/baai/bge-m3`: US$ 0,012 por 1 milhão de tokens de entrada (1.075 neurons por milhão).
- Texto (exemplo de modelo pequeno da página de preços, `llama-3.1-8b-instruct-fp8-fast`): 4.119 neurons por milhão de tokens de entrada e 34.868 por milhão de saída.

### Estimativa por mensagem (suposição, não medição)

Premissa: 2.000 tokens de entrada (trechos + instruções + pergunta) e 300 de saída.

- Entrada: 2.000 / 1.000.000 × 4.119 ≈ 8,2 neurons.
- Saída: 300 / 1.000.000 × 34.868 ≈ 10,5 neurons.
- **Total ≈ 19 neurons por mensagem**, o que daria algo como **500 mensagens por dia** dentro da cota gratuita.

Isso é uma ordem de grandeza. Os tokens reais serão medidos e registrados na tabela `mensagem` (S17), e o número final do README virá dessa medição.

### Pontos a confirmar antes do deploy (S19)

- O que acontece exatamente ao estourar a cota gratuita (esperado: erro, sem cobrança, no plano Free). **Não verificado.**
- Qual modelo de texto do catálogo atual será usado (S16).
- A página do bge-m3 mostra exemplos com o campo `text` e uma tabela de parâmetros com `contexts`. O provedor deste repositório usa `text`; o primeiro `npm run ingest` com `EMBEDDING_PROVIDER=workers-ai` confirma.

## Alternativas descartadas por enquanto

| Opção                           | Preço por 1 milhão de tokens      | Observação                                                |
| ------------------------------- | --------------------------------- | --------------------------------------------------------- |
| Claude Haiku 5.5                | US$ 0,10 entrada / US$ 0,50 saída | cerca de US$ 0,35 a cada 1.000 mensagens (mesma premissa) |
| Claude Sonnet 5.5               | US$ 2 entrada / US$ 10 saída      | cerca de US$ 7 a cada 1.000 mensagens                     |
| Voyage `voyage-4-lite`          | US$ 0,02                          | 200 milhões de tokens grátis                              |
| OpenAI `text-embedding-3-small` | US$ 0,02                          |                                                           |

## Banco

Neon, plano Free: pgvector incluído, 1 GB por projeto, 100 horas de computação por mês. Os 14 textos da base geram 16 trechos: uma fração minúscula do limite.

## Fontes

- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://platform.claude.com/docs/en/about-claude/pricing
- https://docs.voyageai.com/pricing
- https://developers.openai.com/api/docs/models/text-embedding-3-small
- https://neon.com/pricing
