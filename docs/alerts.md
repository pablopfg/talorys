# Central de avisos

A central de avisos decide **como** o Talorys fala com você quando algo precisa da sua
atenção: qual a prioridade do aviso, por quais canais ele sai do app e quantas mensagens
cada canal pode mandar. Tudo o que o Talorys avisa (lembretes, resumos, rotinas de IA,
alertas de segurança e de sistema) passa por ela.

O app sempre recebe todos os avisos, na central de notificações (o sino no topo). Os
canais são os caminhos **fora** do app. Hoje existe o canal **Push** (notificações do
sistema no celular e no computador); os próximos canais (Telegram e e-mail) entram
nesta mesma central, sem mudar o que está descrito aqui.

Este documento é atualizado a cada entrega do plano "Talorys proativo".

## Onde configurar

**Configurações → Avisos** tem três blocos:

| Bloco | O que faz |
| --- | --- |
| Notificações push | Liga o push neste aparelho, lista os aparelhos cadastrados e envia um teste. |
| Para onde vão os avisos | Para cada categoria, um interruptor por canal. Desligado, a categoria fica só no app. Também define os limites por canal. |
| Entregas recentes | As últimas 100 tentativas de envio, com categoria, canal, prioridade, situação e o motivo quando o aviso não saiu. |

## Prioridades

| Prioridade | Sai do app? | Conta no limite do canal? | Usada por padrão em |
| --- | --- | --- | --- |
| Baixa | Não, fica só no app | — | (reservada para vigias e resumos futuros) |
| Normal | Sim, nos canais da categoria | Sim | Lembretes, resumos, rotinas, avisos de sistema |
| Alta | Sim | Sim | (lembretes insistentes, numa próxima entrega) |
| Crítica | Sim, sempre | **Não**: nunca é segurada e não gasta o limite dos outros | Alertas de segurança |

Você pode **mudar a prioridade de qualquer notificação** na própria central (o seletor
embaixo de cada aviso). Essas correções são a base do aprendizado de prioridade, que
chega numa próxima entrega.

## Categorias

| Categoria | Exemplos |
| --- | --- |
| Lembretes | Lembretes criados por você ou pelo agente |
| Resumos | Resumo agendado de tarefas |
| Rotinas | Resultado de rotinas de IA (inclusive a ferramenta `notify_owner`) |
| Tarefas | Prazos e tarefas atrasadas (vigias, numa próxima entrega) |
| Sistema | Rotina pulada por falta de orçamento de IA e outros avisos do próprio Talorys |
| Segurança | Login de aparelho ou país novo, verificação em duas etapas ligada ou desligada, muitas tentativas de login, código de recuperação usado |
| Eventos | Eventos enviados pelas suas automações (numa próxima entrega) |

Os padrões: todas as categorias ligadas no Push.

## Regras anti-spam

1. **Repetições descartadas.** Um aviso pode ter uma chave (por exemplo
   `routine-budget:<id da rotina>`). Enquanto a chave estiver no tempo de espera, o mesmo
   aviso não é criado de novo. O padrão é 6 horas; o aviso de rotina pulada por orçamento
   usa 20 horas, ou seja, no máximo um por rotina por dia.
2. **Limite por canal.** Cada canal manda no máximo **6 mensagens por hora e 30 por dia**
   (janelas móveis), ajustável de 1 a 60 por hora e de 1 a 500 por dia. Acima do limite o
   aviso fica só no app e aparece em "Entregas recentes" como *limite do canal atingido*.
   Avisos críticos não contam e sempre saem.
3. **Prioridade baixa fica no app.** Aparece no histórico como *prioridade baixa fica só
   no app*.
4. **Sem horário silencioso.** Por decisão do dono, tudo sai na hora; o volume é
   controlado pela prioridade e pelos limites.

## O que o histórico de entregas mostra

| Situação | Motivo | Significado |
| --- | --- | --- |
| Enviando | — | O envio ainda está em andamento em segundo plano |
| Enviado | — | Pelo menos um aparelho recebeu |
| Falhou | nenhum aparelho foi alcançado | Todos os envios falharam (aparelhos fora do ar ou inscrições expiradas) |
| Não enviado | prioridade baixa fica só no app | Aviso de prioridade baixa |
| Não enviado | limite do canal atingido | O canal já mandou o máximo da hora ou do dia |
| Não enviado | canal não configurado | O deploy não tem as chaves VAPID do push |
| Não enviado | nenhum aparelho cadastrado | Ninguém ligou o push em Configurações → Avisos |

O histórico guarda só metadados (título, categoria, canal, prioridade, situação), nunca o
texto do aviso. Cada linha fica **90 dias**, com teto de 2.000 linhas.

## Variáveis e segredos

Esta entrega não cria variáveis novas. O canal Push continua usando as mesmas de antes:

| Nome | Tipo | Obrigatório | Para que serve |
| --- | --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Segredo do Worker | Para o Push | Chave pública do Web Push (o instalador gera) |
| `VAPID_PRIVATE_KEY` | Segredo do Worker | Para o Push | Chave privada do Web Push (o instalador gera) |
| `VAPID_SUBJECT` | Variável do Worker | Não | Contato enviado aos serviços de push; no deploy pelo GitHub, `TALORYS_VAPID_SUBJECT` |

Sem as chaves VAPID, tudo funciona e os avisos ficam só no app.

## Instalação e configuração

Nada a instalar: a migração 19 do banco roda sozinha na primeira requisição depois do
deploy. Ela acrescenta prioridade, categoria e chave de repetição às notificações (as
antigas ficam como Normal / Sistema) e cria a tabela `tal_alert_deliveries`.

Depois do deploy:

1. Abra **Configurações → Avisos** e ligue o push neste aparelho (no iPhone, primeiro
   adicione o Talorys à Tela de Início).
2. Em **Para onde vão os avisos**, desligue as categorias que você não quer receber fora
   do app.
3. Ajuste os limites se precisar e toque em **Salvar**.
4. Use **Enviar teste** para conferir o aparelho.

## API

Todas as rotas exigem a sessão do dono e o cabeçalho `x-talorys-request`. Tokens de acesso
remoto **não** alcançam nenhuma delas.

| Método e rota | Corpo | Resposta |
| --- | --- | --- |
| `GET /api/alerts` | — | `{ preferences, deliveries, channels }` |
| `PUT /api/alerts/preferences` | `{ routes: { <categoria>: ["push"] }, limits: { perHour, perDay } }` (todas as categorias, até 8 KB) | `{ preferences }`; 400 se inválido |
| `PATCH /api/notifications/:id` | `{ priority: "low" \| "normal" \| "high" \| "critical" }` | `{ notification }`; 404 se não existir |
| `GET /api/notifications` | — | Agora cada notificação traz `priority` e `category` |

## Para quem mexe no código

- Todo aviso nasce em `AlertService.raise()` (`apps/agent/src/alerts/service.ts`). Não
  chame `NotificationRepository.create()` direto: o aviso ficaria fora das regras e dos
  canais.
- Um canal é um `AlertChannelAdapter` (`apps/agent/src/alerts/channels.ts`): diz se pode
  enviar (`unavailable()`) e envia em segundo plano, informando quantos destinos alcançou.
  Um canal que falha ou lança erro nunca impede os outros nem o trabalho que gerou o aviso.
- Os tipos compartilhados (prioridades, categorias, canais, preferências) ficam em
  `packages/shared/src/alerts.ts`.
- Testes: `apps/agent/test/alerts.test.ts` (regras, preferências, API) e
  `tests/e2e/alerts.spec.ts` (tela).
