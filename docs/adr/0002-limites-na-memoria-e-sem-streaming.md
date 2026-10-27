# ADR 0002: limites de uso na memória e resposta sem streaming

Data: 25/10/2026. Situação: aceita.

## Contexto

A demonstração será pública e gasta de uma cota gratuita (10.000 neurons por dia no Workers AI). Alguém pode, de propósito ou por acidente, esgotá-la. O plano da S17 também previa resposta em streaming.

## Decisões

**1. Limite por IP na memória do servidor.** Janela deslizante (8 por minuto e 60 por hora), sem banco e sem dependência nova. O IP só é lido para este fim e **não é gravado**. O cabeçalho do IP real (`cf-connecting-ip`) só é usado se for configurado em `IP_HEADER`, porque um cabeçalho qualquer pode ser forjado pelo cliente.

**2. A proteção que de fato segura o custo é o teto diário global de tokens**, calculado a partir da tabela `mensagem` (uso real informado pelo provedor). O limite por IP reduz abuso e ruído, mas não é a barreira final.

**3. Sem streaming.** As respostas têm cerca de 35 tokens e levam cerca de um segundo. Streaming daria pouco ganho e complicaria a barreira de recusa: o marcador `NAO_ENCONTREI` só pode ser reconhecido depois de ler o começo da resposta, então o texto teria de ser retido, e a implementação teria de ser refeita no Worker com o binding. O widget mostra um indicador de "digitando".

## Consequências

- Na versão em Workers (S19) cada instância tem a sua própria memória, então o limite por IP vale **por instância**, não globalmente. É aceitável para uma demonstração porque o teto diário continua global. Se for preciso um limite por IP exato, a alternativa é o recurso de rate limiting da própria Cloudflare.
- Reiniciar o servidor zera os contadores por IP.
- O teto diário é conferido antes de cada resposta e não é uma trava atômica: pedidos simultâneos podem passar um pouco do teto. Por isso o padrão (1,2 milhão de tokens) fica em cerca de dois terços da cota gratuita.
- Se o gasto passar do pago por engano, o dano é limitado: a conta só cobra acima da cota, a US$ 0,011 por 1.000 neurons.
