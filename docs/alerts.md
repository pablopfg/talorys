# Central de avisos

A central de avisos decide **como** o Talorys fala com você quando algo precisa da sua
atenção: qual a prioridade do aviso, por quais canais ele sai do app e quantas mensagens
cada canal pode mandar. Tudo o que o Talorys avisa (lembretes, resumos, rotinas de IA,
alertas de segurança e de sistema) passa por ela.

O app sempre recebe todos os avisos, na central de notificações (o sino no topo). Os
canais são os caminhos **fora** do app:

| Canal | Para onde vai |
| --- | --- |
| **Push** | Notificações do sistema no celular e no computador |
| **Telegram** | O seu grupo de avisos no Telegram (ou o chat privado com o bot, enquanto nenhum grupo estiver vinculado) |

O e-mail entra nesta mesma central numa próxima entrega, sem mudar o que está descrito aqui.

Este documento é atualizado a cada entrega do plano "Talorys proativo".

## Onde configurar

**Configurações → Avisos** tem quatro blocos:

| Bloco | O que faz |
| --- | --- |
| Notificações push | Liga o push neste aparelho, lista os aparelhos cadastrados e envia um teste. |
| Telegram | Conecta o bot, vincula o chat privado e o grupo, envia um teste e desvincula. Veja [Telegram](#telegram). |
| Para onde vão os avisos | Para cada categoria, um interruptor por canal e o interruptor **Texto completo** (só para o Telegram). Desligado, a categoria fica só no app. Também define os limites por canal. |
| Entregas recentes | As últimas 100 tentativas de envio, com categoria, canal, prioridade, situação e o motivo quando o aviso não saiu. |

## Prioridades

| Prioridade | Sai do app? | Conta no limite do canal? | Usada por padrão em |
| --- | --- | --- | --- |
| Baixa | Não, fica só no app | — | (reservada para vigias e resumos futuros) |
| Normal | Sim, nos canais da categoria | Sim | Lembretes, resumos, rotinas, avisos de sistema |
| Alta | Sim | Sim | (lembretes insistentes, numa próxima entrega) |
| Crítica | Sim, **por todos os canais**, mesmo com a categoria desligada | **Não**: nunca é segurada e não gasta o limite dos outros | Alertas de segurança |

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

Os padrões: todas as categorias ligadas no Push e no Telegram, com o Telegram discreto
(sem o texto completo) em todas.

A categoria **Segurança** não pode ser desligada: alertas de segurança e qualquer aviso
crítico sempre saem por todos os canais disponíveis, ignorando os interruptores. Assim,
alguém que entre na sua sessão não consegue calar os avisos sobre o que fizer em seguida.

## Regras anti-spam

1. **Repetições descartadas.** Um aviso pode ter uma chave (por exemplo
   `routine-budget:<id da rotina>`). Enquanto a chave estiver no tempo de espera, o mesmo
   aviso não é criado de novo. O padrão é 6 horas; o aviso de rotina pulada por orçamento
   usa 20 horas, ou seja, no máximo um por rotina por dia.
2. **Limite por canal.** Cada canal manda no máximo **6 mensagens por hora e 30 por dia**
   (janelas móveis), ajustável de 1 a 60 por hora e de 1 a 500 por dia. Acima do limite o
   aviso fica só no app e aparece em "Entregas recentes" como *limite do canal atingido*.
   **Lembretes**, alertas de **segurança** e avisos **críticos** não contam no limite e
   sempre saem: você agendou o lembrete para aquele momento, e uma rotina movimentada não
   pode tirar o lugar dele.
3. **Prioridade baixa fica no app.** Aparece no histórico como *prioridade baixa fica só
   no app*.
4. **Sem horário silencioso.** Por decisão do dono, tudo sai na hora; o volume é
   controlado pela prioridade e pelos limites.

## Telegram

O bot do Telegram é o canal principal fora do app. Nesta entrega ele **envia** avisos e
entende os **botões** embaixo deles; conversar com o Talorys pelo chat e mandar áudio
chegam nas próximas entregas.

### Como funciona

- **Grupo de avisos.** Quando um grupo está vinculado, todo aviso vai para ele. Sem grupo,
  vai para o chat privado com o bot.
- **Discreto por padrão.** No Telegram, cada aviso mostra o ícone da prioridade, o título,
  a categoria e a prioridade; o texto fica no app ("Abra o Talorys para ler."). Ligue
  **Texto completo** nas categorias que você quer ler direto no Telegram. Atenção: com o
  padrão, um lembrete aparece no grupo só com o nome dele; para ver a mensagem do
  lembrete no grupo, ligue **Texto completo** em **Lembretes**.
- **Som.** Avisos de prioridade baixa e normal chegam em silêncio; alta e crítica tocam.
- **Botões.** Todo aviso tem **Abrir o Talorys**. Avisos de prioridade alta e crítica
  também têm **Feito** (marca como lido no app) e **Adiar 1 h** (cria um lembrete único
  para daqui a uma hora, com o mesmo título e texto, e marca o aviso como lido). Depois de
  tocar, os botões somem da mensagem.
- **Tópicos.** Se o grupo tiver **tópicos** ligados e o bot for **administrador** com a
  permissão *Gerenciar tópicos*, o Talorys cria um tópico por categoria (Lembretes,
  Rotinas, Segurança…) na primeira vez que precisar. Sem a permissão, tudo vai para o
  tópico geral. Se você apagar um tópico, o aviso vai para o geral e o tópico é criado de
  novo no próximo aviso daquela categoria.
- **Só você.** O bot só obedece à conta do Telegram que vinculou o chat privado. Outra
  pessoa no grupo pode ver os avisos, mas os botões respondem "Só o dono pode usar estes
  botões." e mensagens de outras contas são ignoradas.
- **Segurança e críticos** também saem pelo Telegram mesmo com a categoria desligada,
  como em todos os canais.

### Configurar o Telegram

1. **Crie o bot.** No Telegram, abra [@BotFather](https://t.me/BotFather), envie
   `/newbot`, escolha um nome e um usuário terminado em `bot`. Ele responde com o
   **token** (`123456789:AA...`). Guarde no gerenciador de senhas: quem tem o token
   controla o bot.
2. **Opcional, recomendado:** no @BotFather, `/setjoingroups` → *Disable* depois de
   vincular o seu grupo, para ninguém mais adicionar o bot a outros grupos (a vinculação
   já exige o código e a sua conta, mas assim o bot nem entra).
3. **Grave o token como segredo do Worker** (nunca no repositório nem no GitHub):

   ```bash
   # Deploy pelo GitHub (Worker "talorys"):
   npx wrangler secret put TELEGRAM_BOT_TOKEN --name talorys
   # Deploy pelo instalador, dentro de apps/agent (some -c wrangler.standalone.jsonc
   # no deploy de um Worker só):
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   ```

   O segredo vale na hora, sem novo deploy.
4. **Cloudflare Access (só se você usa).** O Telegram não passa pelo Access, então crie
   mais uma aplicação no Zero Trust, como a do health check:
   - **Application domain:** o seu domínio, com o caminho `api/telegram/webhook`.
   - **Policy:** *Bypass*, incluindo **Everyone**.
   O Talorys continua exigindo o cabeçalho secreto do Telegram nessa rota (veja
   [Segurança do Telegram](#segurança-do-telegram)); sem ele a resposta é 403.
5. **Conecte.** Em **Configurações → Avisos → Telegram**, toque em **Conectar** (pode
   pedir a senha de novo). O Talorys registra o webhook do bot neste endereço e mostra
   um código de 8 caracteres, válido por 10 minutos.
6. **Vincule o chat.** Toque em **Abrir o chat com o bot** e depois em **Iniciar**. O bot
   responde que está vinculado e o cartão mostra *Chat privado: Vinculado*.
7. **Vincule o grupo.** Crie um grupo (por exemplo "Talorys · avisos"), de preferência
   com **tópicos** ligados. Volte ao cartão e toque em **Adicionar o bot a um grupo**,
   escolha o grupo e confirme. O bot avisa "Este grupo agora recebe os avisos do
   Talorys." Para tópicos por categoria, torne o bot administrador com *Gerenciar
   tópicos*.
8. **Teste.** Toque em **Enviar teste**. A mensagem chega no grupo (ou no chat, sem
   grupo).
9. Em **Para onde vão os avisos**, ajuste as categorias e o **Texto completo**.

Se o código expirar antes de você terminar, toque em **Reconectar** para gerar outro. O
mesmo botão serve depois de trocar de endereço (domínio) ou de `SESSION_SECRET`.

**Desvincular** apaga o chat, o grupo e o webhook do lado do Talorys. O token continua
no Worker; para desligar o bot de vez, apague o segredo
(`npx wrangler secret delete TELEGRAM_BOT_TOKEN`) ou revogue o token no @BotFather
(`/revoke`).

### Segurança do Telegram

- O Telegram entrega as mensagens do bot em `POST /api/telegram/webhook`. Essa rota não
  tem sessão: ela só aceita pedidos com o cabeçalho `X-Telegram-Bot-Api-Secret-Token`
  certo, comparado em tempo constante. O valor é derivado do `SESSION_SECRET` (HMAC), então
  não há segredo extra para guardar; trocar o `SESSION_SECRET` exige tocar em
  **Reconectar**.
- Com o Cloudflare Access ligado, a rota só fica livre do token do Access quando traz esse
  cabeçalho certo e nenhum cookie ou `Authorization`.
- A rota responde 200 na hora (o trabalho segue em segundo plano), aceita no máximo 64 KB
  e ignora atualizações repetidas, então o Telegram não reenvia nada em loop.
- O código de vinculação vale 10 minutos, é guardado só como hash e deixa de valer quando
  o grupo é vinculado. A primeira conta que vincula o chat privado vira a dona; outra conta
  com o mesmo código não toma o lugar.
- Tokens de acesso remoto não alcançam nenhuma rota `/api/telegram`.
- O histórico de entregas guarda só metadados; o texto vai ao Telegram apenas nas
  categorias com **Texto completo**.
- Custos: a Bot API do Telegram é gratuita, e cada aviso ou toque num botão é uma
  requisição ao Worker, dentro do plano gratuito da Cloudflare.

## O que o histórico de entregas mostra

| Situação | Motivo | Significado |
| --- | --- | --- |
| Enviando | — | O envio ainda está em andamento em segundo plano. Se não houver resposta em 5 minutos (por exemplo, o Worker reiniciou no meio), passa para *Falhou* e deixa de contar no limite |
| Enviado | — | Pelo menos um aparelho (push) ou o chat/grupo (Telegram) recebeu |
| Falhou | nenhum aparelho ou chat foi alcançado | Todos os envios falharam: aparelhos fora do ar, inscrições expiradas, bot removido do grupo ou bloqueado |
| Não enviado | prioridade baixa fica só no app | Aviso de prioridade baixa |
| Não enviado | limite do canal atingido | O canal já mandou o máximo da hora ou do dia |
| Não enviado | canal não configurado | O deploy não tem as chaves VAPID (push) ou o segredo `TELEGRAM_BOT_TOKEN` (Telegram) |
| Não enviado | nenhum aparelho ou chat vinculado | Ninguém ligou o push neste app, ou o chat do Telegram ainda não foi vinculado |

O histórico guarda só metadados (título, categoria, canal, prioridade, situação), nunca o
texto do aviso. Cada linha fica **90 dias**, com teto de 2.000 linhas.

## Variáveis e segredos

| Nome | Tipo | Obrigatório | Para que serve |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Segredo do Worker | Para o Telegram | Token do bot criado no @BotFather |
| `SESSION_SECRET` | Segredo do Worker | Sim (já existia) | Também gera o segredo do webhook do Telegram |
| `VAPID_PUBLIC_KEY` | Segredo do Worker | Para o Push | Chave pública do Web Push (o instalador gera) |
| `VAPID_PRIVATE_KEY` | Segredo do Worker | Para o Push | Chave privada do Web Push (o instalador gera) |
| `VAPID_SUBJECT` | Variável do Worker | Não | Contato enviado aos serviços de push; no deploy pelo GitHub, `TALORYS_VAPID_SUBJECT` |

Sem as chaves VAPID ou sem o token do Telegram, tudo funciona e aquele canal aparece no
histórico como *canal não configurado*. O ID do chat, do grupo e da sua conta do Telegram
ficam só no banco do Talorys, nunca no repositório nem em variáveis.

## Instalação e configuração

Nada a instalar no banco: a migração 19 roda sozinha na primeira requisição depois do
deploy. Ela acrescenta prioridade, categoria e chave de repetição às notificações (as
antigas ficam como Normal / Sistema) e cria a tabela `tal_alert_deliveries`. Quem já tinha
salvo as preferências antes do Telegram existir ganha o Telegram ligado em toda categoria
que já saía do app; as que estavam só no app continuam só no app.

Para o Telegram, siga [Configurar o Telegram](#configurar-o-telegram). Para o push,
depois do deploy:

1. Abra **Configurações → Avisos** e ligue o push neste aparelho (no iPhone, primeiro
   adicione o Talorys à Tela de Início).
2. Em **Para onde vão os avisos**, desligue as categorias que você não quer receber fora
   do app.
3. Ajuste os limites se precisar e toque em **Salvar**.
4. Use **Enviar teste** para conferir o aparelho.

## API

Todas as rotas, menos o webhook do Telegram, exigem a sessão do dono e o cabeçalho
`x-talorys-request`. Tokens de acesso remoto **não** alcançam nenhuma delas.

| Método e rota | Corpo | Resposta |
| --- | --- | --- |
| `GET /api/alerts` | — | `{ preferences, deliveries, channels }` |
| `PUT /api/alerts/preferences` | `{ routes: { <categoria>: ["push", "telegram"] }, limits: { perHour, perDay }, fullText: [<categoria>...] }` (todas as categorias, até 8 KB; `fullText` opcional, padrão vazio) | `{ preferences }`; 400 se inválido |
| `PATCH /api/notifications/:id` | `{ priority: "low" \| "normal" \| "high" \| "critical" }` | `{ notification }`; 404 se não existir |
| `GET /api/notifications` | — | Agora cada notificação traz `priority` e `category` |
| `GET /api/telegram` | — | `{ status: { configured, bot, chat, group, topics, linked_at } }` |
| `POST /api/telegram/connect` | — | Registra o webhook e devolve `{ code, expires_at, chat_link, group_link, status }`; pede a senha recente; 503 sem token ou com o Telegram fora do ar |
| `POST /api/telegram/test` | — | `{ sent, status }`; 503 sem chat vinculado |
| `DELETE /api/telegram` | — | Desvincula; `{ status }`; pede a senha recente |
| `POST /api/telegram/webhook` | Atualização do Telegram | Só para o Telegram: sem sessão, exige o cabeçalho secreto; sempre `{ ok: true }` |

## Para quem mexe no código

- Todo aviso nasce em `AlertService.raise()` (`apps/agent/src/alerts/service.ts`). Não
  chame `NotificationRepository.create()` direto: o aviso ficaria fora das regras e dos
  canais.
- Um canal é um `AlertChannelAdapter` (`apps/agent/src/alerts/channels.ts`): diz se pode
  enviar (`unavailable()`) e envia em segundo plano, informando quantos destinos alcançou.
  Um canal que falha ou lança erro nunca impede os outros nem o trabalho que gerou o aviso.
- Os tipos compartilhados (prioridades, categorias, canais, preferências, estado do
  Telegram) ficam em `packages/shared/src/alerts.ts`.
- O bot fica em `apps/agent/src/telegram/`: `client.ts` (chamadas à Bot API, sem seguir
  redirecionamentos, com tempo limite de 10 s; o erro nunca leva o token), `service.ts`
  (vinculação, envio, tópicos, botões) e `routes.ts` (webhook e rotas do dono). O estado
  fica nas configurações, chaves `telegram.link` e `telegram.code`.
- Testes: `apps/agent/test/alerts.test.ts` (regras, preferências, API),
  `apps/agent/test/telegram.test.ts` (Bot API falsa: vinculação, envio, tópicos, botões,
  webhook, Access) e `tests/e2e/alerts.spec.ts` (tela).
