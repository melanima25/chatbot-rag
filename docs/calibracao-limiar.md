# Calibração do limite de similaridade (24/10/2026)

O chatbot só usa trechos cuja similaridade (cosseno, de 0 a 1) com a pergunta seja **igual ou maior que o limite**. Se nenhum trecho passa, ele recusa sem chamar o modelo de texto: não gasta cota e não tem como inventar.

**Limite provisório: 0,55** (variável `SIMILARIDADE_MINIMA`). Calibrado com 8 perguntas, uma única medição, usando o modelo de embeddings real (`@cf/baai/bge-m3`) e os 14 textos fictícios da base. É um ponto de partida: os evals da S18 (20 a 30 perguntas) vão confirmar ou ajustar.

## Medição

Maior similaridade encontrada para cada pergunta, e qual documento ficou em primeiro:

| Pergunta                                     | A base responde?      | Maior similaridade | Primeiro lugar                      |
| -------------------------------------------- | --------------------- | ------------------ | ----------------------------------- |
| Quanto custa polir um SUV?                   | sim                   | 0,685              | Serviços e preços                   |
| Até que horas vocês ficam abertos no sábado? | sim                   | 0,673              | Horário de funcionamento            |
| Como faço para cancelar meu horário?         | sim                   | 0,672              | Cancelamento e remarcação           |
| Dá pra pagar com cartão parcelado?           | sim                   | 0,630              | Formas de pagamento                 |
| Vocês aceitam caminhão?                      | sim                   | 0,613              | Veículos atendidos e restrições     |
| Vocês trocam o óleo do carro?                | não                   | 0,486              | Cuidados depois do serviço (errado) |
| Vocês fazem funilaria?                       | sim (diz que não faz) | 0,430              | Veículos atendidos e restrições     |
| Qual a capital da França?                    | não                   | 0,295              | Horário de funcionamento (errado)   |

## O que os números mostram

- As cinco perguntas que a base responde ficaram entre **0,613 e 0,685**, com o documento certo em primeiro lugar.
- As perguntas fora do assunto ficaram em **0,486** (óleo) e **0,295** (capital da França).
- Existe uma folga entre 0,486 e 0,613. O limite de 0,55 fica no meio dela.

## Limitações conhecidas

- **Amostra pequena.** Com 8 perguntas, uma pergunta nova pode cair no meio da folga. Por isso o valor é provisório.
- **"Vocês fazem funilaria?"** (0,430) seria recusada, embora o texto "Veículos atendidos e restrições" diga que o negócio não faz funilaria. O resultado é seguro (o chatbot oferece falar com um atendente), mas não é o ideal. Se os evals mostrarem muitos casos assim, as opções são baixar o limite e confiar mais na segunda barreira (abaixo), ou escrever o texto da base de forma mais direta.
- A pontuação depende do modelo de embeddings: **trocar de modelo exige recalibrar**.

## Segunda barreira

Mesmo acima do limite, o modelo de texto é instruído a responder `NAO_ENCONTREI` quando os trechos não trazem a resposta. Nesse caso o chatbot também recusa, e o marcador nunca aparece para o cliente. Exemplo esperado: "Vocês trocam o óleo?" (0,486) já é barrada pelo limite; uma pergunta parecida com 0,60 passaria pelo limite e dependeria desta segunda barreira. A eficácia dessa segunda barreira com o modelo real **ainda não foi medida** (S18).

## Como repetir a medição

```powershell
$perguntas = @("pergunta 1", "pergunta 2")
foreach ($p in $perguntas) { "`n=== $p"; npm run buscar -- $p 2>&1 | Select-String '^\[' }
```
