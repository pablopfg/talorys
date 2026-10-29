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
| Alta | Sim, e **insiste** até você confirmar (veja [Insistência](#insistência)) | Sim (as novas tentativas, não) | Lembretes e automações marcados como **Alta** (lembretes insistentes) |
| Crítica | Sim, **por todos os canais**, mesmo com a categoria desligada, e **insiste** | **Não**: nunca é segurada e não gasta o limite dos outros | Alertas de segurança |

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

## Insistência

Um aviso de prioridade **Alta** ou **Crítica** que você não confirmou é enviado de novo,
numa escada de 3 tentativas contadas a partir do primeiro envio:

| Tentativa | Quando | Por onde |
| --- | --- | --- |
| 1 | Na hora | Os canais da categoria (todos, se for crítico) |
| 2 | 15 minutos depois | Os mesmos canais, com som. No push o título ganha "(2/3)"; no Telegram, o rodapé diz "Tentativa 2 de 3, ainda sem confirmação" |
| 3 | 1 hora depois | Os mesmos canais, mas no Telegram vai para o **chat privado** com o bot em vez do grupo; "(3/3)" |
| — | 1 h 15 min depois | Se ainda ninguém confirmou, o aviso fica marcado como **Não confirmado** na central e no registro de atividade |

**O que confirma** (qualquer um encerra a escada, menos nos alertas de segurança, veja abaixo):

- tocar em **Feito** ou **Adiar 1 h** no Telegram ou na notificação push;
- tocar em **Silenciar este aviso** (para de insistir, mas o aviso continua não lido no
  app) no Telegram, no push ou no botão **Silenciar** da central;
- abrir o aviso no app (marcar como lido, ou **Marcar todas como lidas**);
- escrever qualquer coisa no chat privado do bot (vale para todos os avisos insistindo);
- baixar a prioridade do aviso para Normal ou Baixa na central, ou apagá-lo.

**Alertas de segurança só param pelo Telegram.** Login novo, verificação em duas etapas
ligada ou desligada, muitas tentativas de login e código de recuperação usado são
alertas críticos e também insistem. Para eles, nada feito **dentro do app** encerra a
escada: abrir, marcar como lido, baixar a prioridade, silenciar e apagar não param as
tentativas (silenciar e apagar são recusados enquanto ele insiste). Só **Feito**,
**Adiar** ou **Silenciar** no Telegram, ou uma mensagem sua no chat privado do bot,
confirmam. Assim, alguém que entrou na sua sessão não consegue calar o aviso sobre o que
acabou de fazer. As notificações push desses alertas ficam na tela, mas sem botões. Sem o
Telegram configurado, eles insistem pelo push nas 3 tentativas e depois ficam como **Não
confirmado**. Isso vale também para as suas próprias ações: depois de ligar a verificação
em duas etapas, por exemplo, confirme o aviso no Telegram para ele parar.

**Detalhes:**

- Só insiste um aviso que saiu do app: com a categoria desligada em todos os canais, ou
  sem nenhum aparelho e chat disponíveis, não há por onde insistir.
- No máximo **20 avisos insistem ao mesmo tempo** (os de segurança não entram na conta).
  Passou disso, o aviso novo sai uma vez só, como os outros.
- As novas tentativas **não são seguradas** pelos limites por canal (você pediu para ser
  lembrado até confirmar), mas aparecem nas "Entregas recentes" com "(2/3)" e "(3/3)".
- **Adiar 1 h** de um aviso insistente cria um lembrete único também insistente: ele volta
  daqui a uma hora e começa a escada de novo.
- Cada tentativa é um alarme do Durable Object. Se o Worker reiniciar e um alarme se
  perder, o Talorys retoma na próxima vez que acordar, um passo de cada vez (nunca dispara
  várias tentativas de uma vez).
- No push, os botões aparecem nos navegadores que mostram ações em notificações. O
  Chrome e o Edge mostram 2 (**Feito** e **Adiar 1 h**; **Silenciar** fica no Telegram e
  na central); o Safari e o iPhone não mostram botões, então lá o toque abre o app. O aviso insistente fica na tela
  até você agir. Se a sessão no navegador tiver expirado, o botão abre o app para você
  confirmar lá.

**Como criar um lembrete insistente:**

- No app: **Automações → Novo**, escolha **Prioridade do aviso: Alta**. A lista mostra o
  selo **Insistente**. Vale também para resumos e rotinas.
- No chat (app ou Telegram): peça "me lembre às 15h de tomar o remédio **até eu
  confirmar**". O agente só cria um lembrete insistente quando você pede, e só lembretes
  únicos; um lembrete recorrente insistente é criado no app.
- A prioridade **Crítica** fica reservada para os alertas de segurança.

## Telegram

O bot do Telegram é o canal principal fora do app. Ele **envia** avisos, entende os
**botões** embaixo deles e, no chat privado, **conversa** com o Talorys como o chat do app.
Mandar áudio chega na próxima entrega.

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
  também têm **Feito** (marca como lido no app), **Adiar 1 h** (cria um lembrete único
  para daqui a uma hora, com o mesmo título e texto, e marca o aviso como lido) e
  **Silenciar este aviso** (para a [insistência](#insistência) sem marcar como lido). Depois de
  tocar, os botões somem da mensagem; um segundo toque responde "Este aviso já foi
  tratado." O lembrete do **Adiar** só leva o texto do aviso quando a categoria original
  pode mostrar o texto completo no Telegram (ou é um lembrete); senão ele diz que o texto
  está na central de notificações.
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

### Conversar pelo chat privado

Tudo o que você escreve ao bot no chat privado vai para o agente, como no chat do app:

- **Mesmo agente.** Ele usa as mesmas memórias, ferramentas, instruções e limites diários
  de IA do app. Cada mensagem conta um pedido de IA, como no app.
- **Mesma conversa.** A conversa do Telegram é uma conversa comum do app (aparece na lista
  do chat), e as mensagens seguintes continuam nela. `/new` começa uma conversa nova; se
  você apagar a conversa no app, a próxima mensagem começa outra. O cartão do Telegram tem
  o link **Abrir a conversa**.
- **Confirmações só no app.** Ações que pedem aprovação (apagar uma tarefa, ferramentas MCP
  que perguntam antes) e planos de tarefas **nunca** são confirmados pelo Telegram. A
  resposta avisa "Algo aqui precisa da sua confirmação" com o botão **Abrir no Talorys**.
  Assim, quem tomar a sua conta do Telegram não consegue apagar nada.
- **Uma de cada vez.** Enquanto o Talorys responde, uma nova mensagem recebe "O Talorys
  ainda está respondendo sua última mensagem". Uma resposta que passa de 3 minutos é
  interrompida e chega com o aviso "O Talorys demorou demais para responder"; se você
  tocar em **Parar** no app, o que já foi escrito chega com "A resposta foi interrompida".
  O bot mostra "digitando…" no primeiro minuto.
- **Formatação.** Negrito, itálico, código e listas aparecem formatados; links ficam como
  texto (sem prévia), para não esconder o endereço. Respostas longas são divididas em
  várias mensagens.
- **Comandos:** `/new` (conversa nova) e `/help` (o que o bot faz).
- **Mensagens de voz.** Grave um áudio no chat privado (ou envie um arquivo de áudio) e o
  Talorys transcreve com o mesmo Whisper da entrada por voz do app. Ele mostra o texto que
  entendeu (🎙️ …) e responde como se você tivesse escrito. Detalhes em
  [Mensagens de voz](#mensagens-de-voz).
- **Liga e desliga** em **Configurações → Avisos → Telegram → Conversar com o Talorys pelo
  chat**. Ela é ligada ao tocar em **Conectar** (que já pede a senha); quem vinculou o bot
  antes desta versão encontra a conversa desligada e liga quando quiser. Ligar pede a senha.
  Desligado, o bot só envia avisos.

### Mensagens de voz

- **Até 5 minutos e 5 MB** por mensagem. Uma mensagem maior recebe "Esta mensagem de voz é
  longa demais" antes de qualquer download, e um arquivo que passa de 5 MB durante o
  download é interrompido na hora.
- **Mesmo limite do app.** A voz pelo Telegram divide com a entrada por voz do app o teto de
  **60 minutos de áudio por dia** (`TRANSCRIPTION_LIMITS.maxSecondsPerDay`). Uma mensagem
  que passaria do teto é recusada com "O Talorys atingiu o limite diário de 60 minutos de
  entrada por voz", e uma mais curta ainda cabe. Conta a maior duração entre a que o
  Telegram informa e a que o modelo mede; um arquivo de áudio sem duração tem a duração
  estimada pelo tamanho (cerca de 4 KB por segundo, até 5 minutos), já conferida contra o
  teto antes da transcrição.
- **Uma de cada vez.** Enquanto um áudio é transcrito ou respondido, outra mensagem recebe
  "O Talorys ainda está respondendo sua última mensagem". Uma transcrição já em andamento
  no app também faz o Telegram esperar ("Uma gravação já está sendo transcrita").
- **Idioma.** O reconhecimento usa o idioma das Configurações (português, inglês ou coreano).
- **Privacidade.** O áudio é baixado do Telegram, vai só para o Workers AI e nunca é
  guardado. Fica gravado só o texto, na conversa, como uma mensagem escrita.
- **Custo.** Cada minuto de áudio gasta cerca de 46,6 Neurons do Workers AI (60 minutos ≈
  2.800 Neurons, dentro dos 10.000 diários gratuitos). Áudio sem nenhuma palavra recebe
  "O Talorys não entendeu nenhuma palavra" e não vira mensagem para o agente.
- **Desligado.** Com a conversa desligada, o bot nem baixa o áudio.

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
  e ignora atualizações repetidas (guarda os últimos 100 ids), então o Telegram não reenvia
  nada em loop.
- Mensagens de outras pessoas não gravam nada no banco. Se alguém adicionar o bot a outro
  grupo, o bot sai dele na primeira mensagem que receber de lá.
- O código de vinculação vale 10 minutos, é guardado só como hash e deixa de valer quando
  o grupo é vinculado. A primeira conta que vincula o chat privado vira a dona; outra conta
  com o mesmo código não toma o lugar.
- Tokens de acesso remoto não alcançam nenhuma rota `/api/telegram`.
- **A sua conta do Telegram passa a falar com o agente.** Proteja-a com a verificação em
  duas etapas do Telegram (Configurações → Privacidade e Segurança → Verificação em duas
  etapas). Mesmo assim, aprovações e planos só são confirmados no app, e você pode desligar
  a conversa a qualquer momento.
- Os áudios são baixados só de `api.telegram.org`, sem seguir redirecionamentos, com
  caminho de arquivo conferido, tempo máximo de 30 segundos e leitura cortada em 5 MB.
  Só mensagens de voz da sua conta, no chat privado vinculado, são baixadas.
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
que já saía do app; as que estavam só no app continuam só no app. A migração 20 acrescenta às
notificações o estado da insistência (`escalation`, `attempts`, `next_attempt_at`) e às
automações a prioridade (`priority`); as automações existentes ficam como Normal, então
nada passa a insistir sozinho.

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
| `GET /api/notifications` | — | Cada notificação traz `priority`, `category`, `escalation` (`null`, `"active"`, `"acknowledged"`, `"muted"` ou `"unacknowledged"`), `attempts` e `next_attempt_at` |
| `POST /api/notifications/:id/action` | `{ action: "done" \| "snooze" \| "mute" }` | `{ result: "done" \| "snoozed" \| "muted" \| "already", notification, unread }`; 404 se não existir. Usada pelos botões do push |
| `POST/PATCH /api/automations` | Campo novo `priority: "low" \| "normal" \| "high"` (padrão `"normal"`) | `"critical"` é recusado (400) |
| `GET /api/telegram` | — | `{ status: { configured, bot, chat, group, topics, linked_at, conversation, conversation_id } }` |
| `POST /api/telegram/connect` | — | Registra o webhook e devolve `{ code, expires_at, chat_link, group_link, status }`; pede a senha recente; 503 sem token ou com o Telegram fora do ar |
| `POST /api/telegram/test` | — | `{ sent, status }`; 503 sem chat vinculado |
| `PATCH /api/telegram` | `{ conversation: true \| false }` | Liga ou desliga a conversa no chat privado; `{ status }`; ligar pede a senha recente |
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
  Telegram, `ESCALATION`, ações) ficam em `packages/shared/src/alerts.ts`.
- A insistência: `AlertService.raise()` marca o aviso como `active` e agenda o alarme
  (`TalorysAgent.escalateAlert`); `AlertService.escalate()` envia a próxima tentativa ou
  marca `unacknowledged`, e não faz nada se o aviso já foi lido, silenciado, apagado ou
  rebaixado. `AlertService.respond()` trata Feito, Adiar e Silenciar para o Telegram, o
  push (`apps/web/public/sw.js`) e a central. `reconcile()` roda no `onStart`.
- O bot fica em `apps/agent/src/telegram/`: `client.ts` (chamadas à Bot API, sem seguir
  redirecionamentos, com tempo limite de 10 s; o erro nunca leva o token), `service.ts`
  (vinculação, envio, tópicos, botões, conversa), `format.ts` (Markdown para o HTML do
  Telegram e divisão de respostas longas) e `routes.ts` (webhook e rotas do dono). O estado
  fica nas configurações, chaves `telegram.link` e `telegram.code`.
- Testes: `apps/agent/test/alerts.test.ts` (regras, preferências, API),
  `apps/agent/test/escalation.test.ts` (escada, confirmação, respostas, push com botões),
  `apps/agent/test/telegram.test.ts` (Bot API falsa: vinculação, envio, tópicos, botões,
  webhook, Access) e `tests/e2e/alerts.spec.ts` (tela).
