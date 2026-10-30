# ADR 0003: limite de similaridade 0,45 com margem de contexto de 0,08

Data: 29/10/2026. Situação: aceita, com a ressalva do último parágrafo.

## Contexto

O chatbot tem duas barreiras contra resposta inventada: o limite de similaridade (sem trecho relevante, recusa sem chamar o modelo) e a instrução ao modelo para devolver um marcador quando as fontes não respondem. O limite inicial (0,55) foi calibrado com 8 perguntas. A avaliação automática (`npm run eval`, 48 casos, 3 repetições) mostrou que ele recusava perguntas que a base responde.

## Medições (modelo real, ver `docs/calibracao-limiar.md`)

| Configuração                 | Passaram     | Cobertas certas | Recusou sem precisar | Fonte certa recuperada |
| ---------------------------- | ------------ | --------------- | -------------------- | ---------------------- |
| limite 0,55, sem margem      | 39 de 48     | 78%             | 12 de 96             | 84%                    |
| limite 0,50, sem margem      | 42 de 48     | 85%             | 7 de 96              | 93%                    |
| limite 0,50, margem 0,08     | 42 de 48     | 88%             | 6 de 96              | 94%                    |
| **limite 0,45, margem 0,08** | **44 de 48** | **92%**         | **0 de 96**          | **100%**               |

Em todas, as 24 execuções de perguntas fora da base foram recusadas, sem nenhuma resposta indevida.

## Decisão

1. **O limite decide SE responde; a margem decide QUANTO contexto vai ao modelo.** Só entram no contexto os trechos acima do limite e a no máximo 0,08 de distância do melhor. Baixar o limite sozinho jogava trechos fracos no contexto e o modelo pequeno errava contas simples; com a margem, o contexto fica enxuto (cerca de 19% menos tokens que sem margem).
2. **Limite 0,45**, porque corrige as recusas indevidas e, nas amostras, nenhuma pergunta fora da base passa por ele.

## Consequências e riscos

- Perguntas do ramo que a base não cobre passam a chegar ao modelo mais vezes (custo um pouco maior, cerca de 5% da cota diária por rodada de avaliação) e dependem da segunda barreira, o marcador. Nos casos medidos, ela funcionou.
- **A folga é pequena:** a pergunta fora da base de maior pontuação (uma piada) marca 0,445, a 0,005 do limite. O limite foi escolhido com poucos pontos fora da base; perguntas novas podem passar por ele. Por isso o conjunto de avaliação inclui perguntas do ramo cuja resposta o modelo poderia dar de cabeça, e a avaliação deve ser repetida a cada mudança de limite, de base ou de modelo.
- Os números dependem do modelo de embeddings e da base atuais: trocar qualquer um exige refazer a calibração (`npm run eval -- --calibrar`).
