# Modelos de IA: principal e fallback

O chat, as rotinas agendadas e o Telegram usam o **modelo principal** escolhido
em **Configurações → IA → Modelo**. Quando ele falha antes de responder, o
**fallback** responde no lugar.

| Provedor | Custo | Onde configurar |
| --- | --- | --- |
| Workers AI (padrão) | Plano gratuito da Cloudflare, dentro dos limites diários do Axis | Nada a fazer: usa o binding `AI` do Worker |
| Anthropic | **Pago**, cobrado pela Anthropic na sua conta | Segredo `ANTHROPIC_API_KEY` no Worker |
| OpenAI | **Pago**, cobrado pela OpenAI na sua conta | Segredo `OPENAI_API_KEY` no Worker |

> ⚠️ **Anthropic e OpenAI geram cobrança.** O Axis limita o gasto estimado
> por dia (padrão US$ 2, máximo US$ 50) em **Configurações → IA → Limites de geração e
> execução → IA paga por dia (US$)**. A estimativa usa a contagem de tokens que o provedor
> devolve e o preço de tabela; a fatura de verdade é a do provedor. Configure
> também um limite de gasto no painel da Anthropic ou da OpenAI.

## Modelos disponíveis

Só modelos com preço conhecido podem ser escolhidos, para que o teto em US$
sempre valha. Preços de tabela em US$ por milhão de tokens, conferidos em
29/10/2026:

| Modelo | Entrada | Entrada em cache | Saída |
| --- | --- | --- | --- |
| Claude Opus 5.5 | 4,00 | 0,20 | 20,00 |
| Claude Sonnet 5.5 | 2,00 | 0,20 | 10,00 |
| Claude Haiku 5.5 | 0,10 | 0,01 | 0,50 |
| GPT-6.1 Sol | 2,00 | 0,10 | 10,00 |
| GPT-6 Sol | 2,00 | 0,20 | 10,00 |
| GPT-6 Luna | 0,10 | 0,01 | 0,50 |
| GPT-6 Astra | 10,00 | 1,00 | 50,00 |

## Ligar um modelo pago

1. Crie a chave de API no painel do provedor ([Anthropic](https://console.anthropic.com/)
   ou [OpenAI](https://platform.openai.com/)) e defina lá um limite de gasto mensal.
2. Grave a chave como segredo do Worker, pelo painel da Cloudflare
   (**Workers & Pages → talorys → Settings → Variables and Secrets → Add →
   Secret**) ou pelo terminal:

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY --name talorys
   npx wrangler secret put OPENAI_API_KEY --name talorys
   ```

   A chave fica só na Cloudflare: nunca no GitHub, no navegador, nos backups ou
   nos logs. O app só sabe se ela existe.
3. Em **Configurações → IA → Modelo**, escolha o **Modelo principal do chat**,
   o **Fallback** e o modelo de cada provedor. Um provedor sem chave aparece
   como "sem chave" e não pode ser escolhido.

Escolher um modelo pago (como principal ou fallback), trocar o modelo pago ou
aumentar o teto em US$ pede a senha digitada há pouco e fica registrado na
atividade. Voltar para o Workers AI ou baixar o teto não pede. Essas escolhas
não vêm junto ao importar um backup.

## Quando o fallback responde

O fallback entra quando o modelo principal falha **antes de mostrar qualquer
texto ou chamar uma ferramenta**:

- o provedor está fora do ar ou ocupado;
- a conta está sem crédito ou a chave foi recusada;
- o modelo não está disponível;
- o teto em US$ do dia foi atingido.

Ele não entra quando você cancela a resposta, nem depois que o modelo principal
já começou a responder: responder duas vezes, ou rodar uma ferramenta duas
vezes, seria pior que o erro. A chamada ao fallback conta no limite diário de
pedidos de IA, e o que a chamada que falhou consumiu também é contado.

Sem fallback (**Nenhum**), a falha aparece no chat com o botão de tentar de
novo. Uma sugestão segura é usar um modelo pago como principal e o Workers AI
como fallback.

## Limites e custo

- O teto em US$ é conferido antes de cada chamada e antes de cada passo de uma
  resposta com ferramentas, então uma resposta longa para assim que o teto é
  atingido. Uma chamada em andamento conta pelo custo máximo dela até o uso
  real ser registrado, então conversas ao mesmo tempo (app, Telegram, rotinas)
  não passam juntas do teto.
- Com um modelo pago ligado, trocar o fuso horário pede a senha recente: o dia
  do teto segue o seu fuso.
- Os limites de pedidos e de tokens do Axis continuam valendo para todos os
  provedores.
- O gasto estimado aparece em **Configurações → IA → Uso**.
- As chamadas pagas não são repetidas automaticamente: cada nova tentativa
  seria outra cobrança.
