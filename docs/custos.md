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

**Medido em 30/10/2026** (56 perguntas × 3, modelo real): ≈ 708 tokens por pergunta (cerca de 680 de entrada e 28 de saída) e **≈ 3,8 neurons por pergunta**, bem abaixo da suposição acima. Dentro da cota gratuita de 10.000 neurons/dia cabem, na média medida, cerca de 2.600 perguntas por dia; o teto diário configurado (1,2 milhão de tokens) corta em cerca de 1.700. Os números vêm do uso informado pelo próprio provedor (`npm run uso`), com os preços de 17/10/2026; não são fatura.

### Pontos que ficaram em aberto

- O que acontece exatamente ao estourar a cota gratuita (esperado: erro, sem cobrança, no plano Free). **Não verificado.**
- Resolvidos: o modelo de texto é o `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (S16/S18) e o campo `text` do bge-m3 funciona (confirmado em 24/10/2026, tanto pela API REST quanto pelo binding no Worker).

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

## Medido em 25/10/2026 (primeira rodada com o modelo de texto real)

Modelo de texto: `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (padrão do projeto). Quatro perguntas respondidas, uso informado pela API:

| Pergunta               | Tokens de entrada | Tokens de saída | Neurons | US$      |
| ---------------------- | ----------------- | --------------- | ------- | -------- |
| Horário no sábado      | 415               | 23              | 2,5     | 0,000028 |
| Cartão parcelado       | 538               | 48              | 3,9     | 0,000043 |
| Polir um SUV           | 811               | 27              | 4,3     | 0,000047 |
| Vitrificação de pickup | 818               | 38              | 4,7     | 0,000051 |

- **Média: 646 tokens de entrada e 34 de saída, cerca de 3,8 neurons por resposta.** A estimativa anterior (19 neurons) tinha como premissa 2.000 tokens de entrada e 300 de saída, e estava muito acima.
- Com a média, a cota gratuita de 10.000 neurons por dia cobre perto de **2.600 respostas por dia**; com a pior da amostra (4,7 neurons), perto de 2.100.
- Em dólar: cerca de **US$ 0,04 a cada 1.000 respostas** (se fosse pago).
- Pergunta recusada pelo limite de similaridade **não chama o modelo de texto**: custa só o embedding da pergunta (centésimos de neuron).

Limitações: amostra de 4 perguntas; os neurons foram calculados com os preços da página de preços de 17/10/2026, não lidos de uma fatura; perguntas que juntam mais trechos terão entrada maior. A medição em volume vem na S17 (tabela `mensagem`).

## Medição contínua (S17)

A partir da S17, cada resposta do modelo grava os tokens reais em `mensagem`. `npm run uso` resume por dia (UTC) as respostas, as recusas, os tokens e uma estimativa de neurons contra a cota de 10.000 por dia, usando os preços acima. Esse número é uma conta, não uma fatura: confira no painel da Cloudflare.
