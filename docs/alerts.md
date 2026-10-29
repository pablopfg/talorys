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
| **E-mail** | O seu e-mail, pelo Cloudflare Email Routing (opcional). Recebe sempre os alertas de segurança e os críticos; veja [E-mail](#e-mail) |

Este documento é atualizado a cada entrega do plano "Talorys proativo".

## Onde configurar

**Configurações → Avisos** tem quatro blocos:

| Bloco | O que faz |
| --- | --- |
| Notificações push | Liga o push neste aparelho, lista os aparelhos cadastrados (no máximo 3, com o último acesso de cada um) e envia um teste. Veja [Aparelhos do push](#aparelhos-do-push). |
| Telegram | Conecta o bot, vincula o chat privado e o grupo, envia um teste e desvincula. Veja [Telegram](#telegram). |
| Para onde vão os avisos | Para cada categoria, um interruptor por canal e o interruptor **Texto completo** (para o Telegram e o e-mail). Desligado, a categoria fica só no app. Também mostra o destino do e-mail com o botão de teste e define os limites por canal. |
| Entregas recentes | As últimas 100 tentativas de envio, com categoria, canal, prioridade, situação e o motivo quando o aviso não saiu. |

## Prioridades

| Prioridade | Sai do app? | Conta no limite do canal? | Usada por padrão em |
| --- | --- | --- | --- |
| Baixa | Não, fica só no app | — | Automações marcadas como **Baixa** e tipos de aviso que o Talorys [aprendeu](#prioridade-que-aprende) a deixar mais baixos |
| Normal | Sim, nos canais da categoria | Sim | Lembretes, resumos, rotinas, avisos de sistema |
| Alta | Sim, e **insiste** até você confirmar (veja [Insistência](#insistência)) | Sim (as novas tentativas, não) | Lembretes e automações marcados como **Alta** (lembretes insistentes) |
| Crítica | Sim, **por todos os canais**, mesmo com a categoria desligada, e **insiste** | **Não**: nunca é segurada e não gasta o limite dos outros | Alertas de segurança |

Você pode **corrigir a prioridade de qualquer notificação** na própria central (o seletor
**Corrigir** embaixo de cada aviso) ou no Telegram (botão **Corrigir prioridade**). O
Talorys aprende com essas correções e com o que você faz com os avisos; veja
[Prioridade que aprende](#prioridade-que-aprende). Alertas de segurança são sempre
críticos: a correção não aparece neles e a API recusa baixá-los.

## Prioridade que aprende

O Talorys ajusta sozinho a prioridade de cada **tipo de aviso** a partir do seu uso, sem
gastar nenhuma chamada de IA. Funciona em três camadas, da mais barata para a mais cara:

1. **Regras fixas**, que nada muda:
   - alertas de segurança são sempre **Críticos** e nunca aprendem;
   - eventos externos (categoria Eventos) nunca passam de **Alta**;
   - um lembrete nunca aprende a ficar **Baixa** (ele ficaria só no app e você não seria
     avisado na hora que pediu);
   - o aprendizado só mexe em avisos que pediram Baixa ou Normal: um aviso que pediu
     **Alta** (insistente) ou **Crítica** sai como pediu, e o aprendizado nunca cria um
     aviso Crítico.
2. **Perfil aprendido.** Cada aviso pertence a um perfil:
   - um por automação (cada resumo, rotina ou lembrete recorrente aprende sozinho);
   - um para todos os **lembretes avulsos** (os únicos, como "me lembre às 15h");
   - um por tipo de aviso do sistema (por exemplo, todos os "tarefa atrasada");
   - um por categoria para o resto.

   Cada aviso dá **um sinal** ao seu perfil, o primeiro que acontecer:

   | O que você fez | Sinal |
   | --- | --- |
   | Leu ou tocou em Feito em até 15 minutos | forte para cima (+0,7) |
   | Leu entre 15 minutos e 4 horas | leve para cima (+0,1) |
   | Leu só depois de 4 horas | para baixo (−0,3) |
   | Adiou | leve para cima (+0,2) |
   | Silenciou | para baixo (−0,6) |
   | Deixou sem ler por 24 horas | forte para baixo (−0,8) |
   | Concluiu a tarefa do aviso em até 1 hora (avisos dos vigias de tarefa) | forte para cima (+0,8) |

   Corrigir a prioridade é o sinal mais forte (+1 ou −1, com peso dobrado) e vale além do
   sinal do aviso. Os sinais formam uma média móvel; quando ela passa de **0,5** (ou de
   **−0,5**) com pelo menos 3 sinais, o perfil sobe (ou desce) **um nível**. Uma correção
   sua basta para mover o perfil na hora; mudar de novo a prioridade do mesmo aviso só
   atualiza a correção (voltar à original a desfaz), sem ensinar duas vezes. "Marcar todas
   como lidas" não conta como sinal, e um aviso Baixa deixado sem ler também não (ele nem
   saiu do app). Fixar um lembrete em Baixa é permitido: é escolha sua.
3. **O agente escolhe no mesmo turno.** Quando você pede um lembrete no chat (app ou
   Telegram), o agente escolhe a prioridade dele (Baixa, Normal ou Alta) guiado pelas suas
   **20 últimas correções de lembretes** (dos últimos 90 dias), que vão no contexto como
   dados. Não há chamada de IA extra.

**Travas**

- No máximo **um nível por semana** em cada perfil, e no máximo **2 níveis** de distância
  do que os avisos pedem.
- Depois de mudar, a média e a contagem de sinais recomeçam do zero: a próxima mudança
  precisa de pelo menos 3 sinais novos (ou de uma correção sua).
- Todo aviso mostra **por que tem essa prioridade** quando não é simplesmente a que ele
  pediu ("Mais alta que o normal: aprendido com o que você faz com estes avisos", "A
  prioridade que você fixou", "Regra fixa", "Você alterou esta prioridade"). No Telegram,
  a explicação vai no rodapé do aviso.
- Em **Configurações → Avisos → O que o Talorys aprendeu** ficam os perfis que já têm
  sinais ou mudaram, com o efeito atual ("1 nível acima", "Fixada em Baixa"), quantos
  sinais desde a última mudança e quando mudou. Para cada um:
  - **Fixar** numa prioridade (Baixa, Normal ou Alta): o perfil para de aprender e todo
    aviso dele sai nessa prioridade (as regras fixas continuam valendo);
  - **Aprender sozinho** volta a aprender a partir de onde está;
  - **Zerar** esquece tudo o que o perfil aprendeu, inclusive as correções.
- Cada mudança de nível fica no **Registro de atividade** ("Prioridade aprendida: …"), e o
  [resumo do dia](#vigias-e-resumo-do-dia) de sexta-feira conta o que mudou na semana.
- O aprendizado não entra no backup: depois de restaurar, o Talorys aprende de novo.

**No Telegram:** todo aviso, menos os de segurança, traz o botão **Corrigir prioridade**.
Ele troca os botões por **Baixa**, **Normal** e **Alta** (a atual com ✓) e **Voltar**.
Escolher uma corrige o aviso, ensina o perfil e devolve os botões do aviso (um aviso que
virou Alta ganha Feito, Adiar e Silenciar). Só a sua conta do Telegram consegue usar os
botões.

## Categorias

| Categoria | Exemplos |
| --- | --- |
| Lembretes | Lembretes criados por você ou pelo agente |
| Resumos | Resumo agendado de tarefas |
| Rotinas | Resultado de rotinas de IA (inclusive a ferramenta `notify_owner`) |
| Tarefas | Prazos e tarefas atrasadas (vigias) |
| Sistema | Rotina pulada por falta de orçamento de IA e outros avisos do próprio Talorys |
| Segurança | Login de aparelho ou país novo, verificação em duas etapas ligada ou desligada, muitas tentativas de login, código de recuperação usado |
| Eventos | Eventos enviados pelas suas automações (n8n, scripts, monitores). Veja [Eventos do n8n e de outras automações](#eventos-do-n8n-e-de-outras-automações) |

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

**Alertas de segurança só param pelo Telegram.** Login novo, troca de senha, verificação
em duas etapas ligada ou desligada, muitas tentativas de login, código de recuperação
usado, acesso remoto ligado, token criado, Telegram vinculado, conversa no Telegram ligada
e backup exportado ou importado são alertas críticos e também insistem (veja
[Alertas de segurança fora da banda](#alertas-de-segurança-fora-da-banda-e-e-mail)). Para eles, nada feito **dentro do app** encerra a
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
  confirmar**". O agente cria um lembrete insistente quando você pede ou quando as suas
  correções mostram que lembretes parecidos devem ser Alta, e só lembretes únicos; um
  lembrete recorrente insistente é criado no app.
- A prioridade **Crítica** fica reservada para os alertas de segurança.

## Vigias e resumo do dia

A cada **15 minutos** o Talorys roda os vigias: checagens sem IA (custo zero) que só
geram um aviso quando algo precisa de você. Um vigia que não encontrou nada não manda
"tudo certo". A chave de repetição de cada aviso impede que o mesmo aviso saia de novo.

| Vigia | Quando avisa | Prioridade | Repete |
| --- | --- | --- | --- |
| Tarefa vence em 24 horas | Tarefa aberta com prazo nas próximas 24 h | Normal | Uma vez |
| Tarefa vence na próxima hora | Prazo em até 60 min | Normal | Uma vez |
| Tarefa atrasada | Prazo passou há até 7 dias | **Alta** (insiste) no primeiro dia, Normal depois | 1 vez por dia, só depois do horário do resumo (nunca de madrugada); depois de 7 dias só aparece no resumo |
| Tarefa parada | Em andamento sem mudança há 7 dias | Normal | A cada 7 dias |
| Rotina falhando | As 2 últimas execuções de uma automação ligada deram erro | Normal | 1 vez por dia |
| Servidor MCP precisa de atenção | Servidor ligado que perdeu o login ou está com erro | Normal | 1 vez por dia |
| Orçamento de IA quase no fim / esgotado | 80% / 100% dos pedidos de IA do dia | Normal / **Alta** | 1 vez por dia |
| Notificações push não estão chegando | Todo aparelho inscrito falhou 3 vezes seguidas | Normal | 1 vez por semana |
| Aparelho removido do push por inatividade | Um aparelho ficou 7 dias sem abrir o Talorys e foi removido (roda mesmo com os vigias desligados) | Normal | 1 vez por aparelho removido |
| Hora de fazer um backup | Nenhuma exportação há 30 dias (contando do primeiro dia do vigia, se nunca houve) | Baixa | A cada 30 dias |
| Atualização disponível | Versão nova publicada (só com a checagem de atualização ligada em Configurações) | Baixa | Uma vez por versão |

- Cada rodada gera **no máximo 5 avisos de tarefa** e, em 24 horas, no máximo **20**,
  nesta ordem: o que vence na próxima hora, as atrasadas mais recentes, o que vence em 24
  horas e por fim as tarefas paradas. O resto sai nas rodadas seguintes ou só no resumo.
- O "dia" de uma tarefa atrasada começa no horário do resumo (07:30 por padrão), mesmo com o
  resumo desligado.
- A prioridade de cada tipo também **aprende** (veja [Prioridade que aprende](#prioridade-que-aprende)):
  se você ignora "Tarefa parada", ele baixa; concluir a tarefa até 1 hora depois do aviso
  conta como sinal de que valeu a pena. Dá para fixar cada tipo em Configurações → Avisos.
- Títulos de tarefas, rotinas e servidores entram no texto do aviso sem links clicáveis.
- A checagem de atualização chama o npm uma vez por dia, junto com o resumo, e só se
  estiver ligada em Configurações.

**Resumo do dia** (padrão ligado, às **07:30** no seu fuso horário): um aviso da categoria
Resumos com

- tarefas atrasadas;
- tarefas que vencem hoje;
- os compromissos de hoje nas agendas do Google abertas (veja [google-calendar.md](google-calendar.md#daily-routines-with-the-calendar));
- o que está agendado para hoje (lembretes e automações ligadas);
- os avisos de prioridade baixa das últimas 24 horas que ficaram no app sem ler;
- às **sextas-feiras**, o que a prioridade aprendeu na semana.

Cada seção lista até 10 itens. Sem nada para contar, o resumo não sai. Ele sai uma vez por
dia, até 3 horas depois do horário (se o Worker estava ocupado ou você acabou de mudar o
horário), inclusive para um horário perto da meia-noite; depois disso espera o dia
seguinte. A data do último backup exportado fica guardada à parte, para o vigia de backup
não depender do registro de atividade. No Telegram, o resumo segue o modo discreto
da categoria **Resumos**: ligue **Texto completo** nela para ler o resumo inteiro no grupo.

Em **Configurações → Avisos**: **Resumo do dia** (horário e liga/desliga) e **Vigias**
(liga/desliga todos). O resumo de tarefas antigo (automação do tipo "Resumo de tarefas")
continua existindo para quem quiser outro horário ou outra frequência.

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

## Alertas de segurança fora da banda e e-mail

Alguém que entrou na sua sessão (um cookie roubado, um computador destravado) não pode
esconder de você o que fez. Por isso as mudanças que abrem uma porta para os seus dados
geram um **alerta de segurança**: sempre **Crítico**, enviado por **todos os canais**
(push, Telegram e e-mail) mesmo que a pessoa esteja dentro do app, e insistente até você
confirmar **pelo Telegram**.

| O que aconteceu | Título do alerta |
| --- | --- |
| Login de aparelho ou país novo | Novo login |
| Senha trocada | Senha alterada |
| Verificação em duas etapas ligada ou desligada | Verificação em duas etapas ativada / desativada |
| Muitas tentativas de login, código de recuperação usado | (já existiam) |
| Acesso remoto ligado | Acesso remoto ativado |
| Token de acesso criado | Token de acesso criado |
| Chat ou grupo do Telegram vinculado | Telegram vinculado / Grupo do Telegram vinculado |
| Telegram desvinculado | Telegram desvinculado |
| Conversa pelo Telegram ligada | Conversa no Telegram ligada |
| Aparelho novo no push (pede a senha recente) ou aparelho removido | Novo aparelho no push / Aparelho removido do push |
| Servidor MCP adicionado ou apontado para outro endereço | Servidor MCP adicionado |
| Atividade de acesso apagada | Atividade de acesso apagada |
| Backup exportado ou importado | Backup exportado / Backup importado |

O texto diz só o que aconteceu e o que fazer se não foi você; nunca de onde veio, nem o
nome do token, nem dados do backup, porque pode aparecer na tela bloqueada. Os detalhes
ficam em Configurações → Segurança.

**Regras que protegem o registro:**

- **Apagar um alerta de segurança pede a senha digitada há pouco**, mesmo depois de
  confirmado. Enquanto ele ainda insiste, apagar continua recusado (só o Telegram o cala).
- A central guarda os **200 alertas de segurança mais recentes à parte** dos outros avisos
  (que ficam nos 500 mais recentes): uma enxurrada de avisos de rotina não empurra um alerta
  de segurança para fora.
- Ligar o acesso remoto de novo quando ele já está ligado, ligar a conversa já ligada ou o
  mesmo navegador renovar a inscrição do push não gera alerta (nada mudou). Desligar o
  acesso remoto ou a conversa não gera alerta; desvincular o Telegram e remover um aparelho
  do push geram, porque fecham um caminho por onde os avisos chegariam.
- **Remover um aparelho do push avisa antes de remover**, então o próprio aparelho recebe o
  alerta: remover o único aparelho não deixa você sem aviso.
- **Conectar o Telegram de novo** com a conversa desligada religa a conversa e gera o mesmo
  alerta "Conversa no Telegram ligada" que a chave em Configurações.
- **Cadastrar um aparelho novo no push pede a senha digitada há pouco** (um login recente
  conta). Sem isso, alguém com a sua sessão poderia cadastrar o próprio navegador e passar a
  receber todos os seus avisos.

### E-mail

O e-mail é o canal de último recurso: chega mesmo sem o Telegram e sem o push. Ele usa o
**Cloudflare Email Routing** e o binding `send_email` do Worker, sem serviço de terceiros e
sem chave de API.

- **Recebe sempre** os alertas de segurança e os críticos. As outras categorias só vão por
  e-mail se você ligar a chave **E-mail** delas em **Para onde vão os avisos**.
- **Só a primeira tentativa** vai por e-mail; as tentativas 2 e 3 de um aviso insistente
  saem pelo push e pelo Telegram. Um aviso que só conseguiu sair por e-mail não insiste.
- **No máximo 10 e-mails a cada 24 horas**, contando os que falharam. Os **4 últimos são
  reservados** para alertas de segurança e críticos: o e-mail de teste e as categorias que
  você ligou usam no máximo 6. Assim ninguém consegue gastar o limite antes de fazer algo
  grave. O e-mail que esgota uma parte do limite avisa ("os outros avisos param de ir por
  e-mail hoje" ou "este é o último aviso por e-mail de hoje"). Passou disso, a entrega
  aparece como *limite do canal atingido* e o aviso continua no app, no push e no Telegram.
- O **e-mail de teste** pede a senha digitada há pouco e sai no máximo **2 vezes por dia**.
- O e-mail é discreto como o Telegram: sem **Texto completo** na categoria, leva o título,
  a categoria, a prioridade e "Abra o Talorys para ler". Todo alerta de segurança termina
  com "O Talorys nunca pede sua senha ou códigos por e-mail", para você reconhecer golpes
  que imitam esses avisos.
- O assunto é `Talorys: <título>`, no idioma do app, sem quebras de linha.
- Só texto simples, sem HTML, sem links rastreados e sem anexos. O link no fim é o
  endereço do app (o primeiro de `TALORYS_ALLOWED_HOSTS`), quando existe. Endereços no
  título e no texto (de lembretes, rotinas ou eventos) chegam desarmados (`hxxps://`,
  `exemplo[.]com`), no e-mail e no Telegram, para nenhum aviso trazer um link de golpe.
- O e-mail também traz o link de **Esqueceu a senha?** da tela de login (no máximo 3 por
  dia, contados como alertas de segurança no limite acima). Veja
  [security.md](security.md#password-recovery-by-e-mail).
- Em **Configurações → Avisos → E-mail** aparece o destino mascarado (`d•••@exemplo.com.br`),
  quantos e-mails saíram hoje e o botão **Enviar e-mail de teste**.

**Custo:** gratuito. A Cloudflare cobra pelo envio só para destinatários quaisquer (Email
Sending, plano Workers Paid). Enviar para um endereço **verificado** no Email Routing da sua
conta é gratuito em todos os planos, e o Talorys só envia para o seu endereço verificado.

### Configurar o e-mail

⚠️ **Ligar o Email Routing troca os registros MX do domínio.** Se o domínio já recebe
e-mail em outro lugar (Google Workspace, Microsoft 365, Zoho, a hospedagem), ligar o Email
Routing nele **para a entrega desses e-mails**. Nesse caso use um subdomínio que não
recebe e-mail (por exemplo `avisos.exemplo.com.br`) ou um domínio só para isso.

1. No painel da Cloudflare, abra o domínio e vá em **Email → Email Routing**. Toque em
   **Enable Email Routing** e aceite os registros MX e SPF que ela propõe (para um
   subdomínio, escolha o subdomínio).
2. Em **Destination addresses**, adicione o seu e-mail pessoal e clique no link de
   verificação que a Cloudflare manda. Sem a verificação nada é entregue.
3. Escolha o remetente, um endereço do domínio do passo 1, por exemplo
   `talorys@exemplo.com.br`. Ele não precisa existir como caixa de entrada.
4. Diga ao Worker quem é o destinatário, como segredo (nunca no repositório):

   ```bash
   npx wrangler secret put ALERT_EMAIL_TO --name <worker>   # o e-mail verificado no passo 2
   ```

   Se você já usa `OWNER_EMAIL` (login com e-mail) e quer receber no mesmo endereço, pode
   pular este passo: sem `ALERT_EMAIL_TO`, os avisos vão para o `OWNER_EMAIL`.
5. Adicione o binding e o remetente:
   - **Deploy pelo GitHub Actions:** crie a variável `TALORYS_ALERT_EMAIL_FROM` no ambiente
     `production` (Settings → Environments → production → Variables) com o remetente do
     passo 3. O deploy acrescenta `send_email` (só esse remetente pode enviar) e
     `ALERT_EMAIL_FROM`. Rode o deploy.
   - **Deploy manual (instalador ou `wrangler deploy`):** acrescente ao `wrangler.jsonc`
     do Worker e faça o deploy:

     ```jsonc
     "send_email": [{ "name": "SEND_EMAIL", "allowed_sender_addresses": ["talorys@exemplo.com.br"] }],
     "vars": { "ALERT_EMAIL_FROM": "talorys@exemplo.com.br" }
     ```

     (Junte `ALERT_EMAIL_FROM` às `vars` que já existirem.)
6. Abra **Configurações → Avisos → E-mail** e toque em **Enviar e-mail de teste**. Se não
   chegar, olhe a pasta de spam e o histórico de entregas.

**Problemas comuns:** *canal não configurado* = falta o binding, o remetente ou o
destinatário, ou algum deles não é um endereço simples (sem nome nem `<>`). *Falhou* =
a Cloudflare recusou: o destino não foi verificado (`E_RECIPIENT_NOT_ALLOWED`), o remetente
não é do domínio com Email Routing (`E_SENDER_NOT_VERIFIED`), ou o Email Routing está
desligado. Os logs do Worker mostram só o código do erro, nunca os endereços.

Para desligar, apague a variável `TALORYS_ALERT_EMAIL_FROM` (ou o bloco `send_email`) e
faça o deploy; o segredo `ALERT_EMAIL_TO` pode ser apagado com `wrangler secret delete`.

## Sentinelas com IA

Uma **sentinela** é uma rotina de IA que só fala quando há algo a fazer. Em vez de mandar
"tudo certo" todo dia, ela olha suas tarefas, lembretes e notas e só cria um aviso quando
algo precisa de você; quando não há nada, a execução termina em silêncio (aparece no
histórico da rotina como "Nada precisava da sua atenção", não nos avisos).

### Como criar

1. Abra **Automações → Nova** e escolha **Rotina de IA**.
2. Em **Começar de:**, toque num modelo (ou escreva o seu pedido):

   | Modelo | Quando | O que faz |
   | --- | --- | --- |
   | Checagem da manhã | Todo dia às 07:00 | Diz só o que precisa de você hoje: o que vence ou está atrasado, o que está travado e o que preparar |
   | Revisão da semana | Sextas às 17:00 | Aponta tarefas sem andamento, atrasadas e o que vence na semana seguinte e precisa de preparo agora |

3. Confira o interruptor **Só me avisar quando algo precisar de mim** (o modelo já liga) e
   ajuste nome, pedido, horário e prioridade como quiser. Toque em **Criar**.

Também dá para pedir no chat ("todo dia de manhã, olhe minhas tarefas e só me avise se algo
precisar de mim"): o agente propõe a rotina já como sentinela e você aprova no app, como toda
rotina de IA.

### Como funciona

- Na execução, a IA recebe a regra: se nada precisa de você, responder exatamente `NOTHING`
  e não chamar `notify_owner`. A resposta é comparada sem maiúsculas, espaços, pontuação ou
  Markdown (`Nothing.` e `**NADA**` também contam); resposta vazia também é silêncio.
- Qualquer outra resposta vira um aviso na categoria **Rotinas**, com a prioridade da rotina,
  passando pela central como os outros (rotas, limites, insistência). Links ficam não
  clicáveis, como em toda resposta da IA.
- Cada execução gasta pedidos de IA do orçamento diário de rotinas
  (**Configurações → IA**), com ou sem aviso; ao atingir o limite, a rotina é pulada com o
  aviso de sempre. Uma ou duas sentinelas por dia cabem com folga no plano gratuito.
- O interruptor só existe em rotinas de IA (lembretes e resumos de tarefas sempre avisam) e
  pode ser ligado ou desligado depois, em **Editar**. Backups guardam o interruptor; uma
  rotina importada chega pausada, como sempre.
- Rotinas de IA criadas antes desta versão continuam avisando sempre (o interruptor começa
  desligado).

## Eventos do n8n e de outras automações

Um fluxo do n8n (ou qualquer script ou monitor) pode mandar um aviso para o Talorys: o
backup falhou, o site caiu, o pagamento entrou. Cada evento vira um aviso na categoria
**Eventos**, passa pela central como os outros (rotas, limites, insistência, prioridade que
aprende) e aparece no app.

### Regras

- **Token próprio.** O evento é enviado com um token de acesso remoto de escopo **events**.
  Esse token só faz uma coisa: `POST /api/remote/events`. Não lê nem altera tarefas, notas,
  memórias ou qualquer outro dado (qualquer outra rota responde 403). E só um token
  **events** envia eventos: tokens `read` e `write` e a sua sessão no app recebem 403.
- **No máximo 60 eventos por hora e 100 em 24 horas** (todos os tokens somados). Passando
  disso, a resposta é 429 com `Retry-After`. Um evento repetido também conta, para que um
  fluxo em loop não envie para sempre.
- **Seus avisos têm prioridade.** Eventos usam só a primeira metade do limite de cada canal
  (com os padrões, 3 por hora e 15 por dia no push e no Telegram); o resto fica no app e a
  outra metade continua livre para lembretes, rotinas, tarefas e sistema. No máximo 3
  eventos insistem ao mesmo tempo; os demais de prioridade Alta saem uma vez só.
- **Nunca crítico.** A prioridade pode ser `low`, `normal` (padrão) ou `high`; `critical` é
  recusado (400), e a prioridade que aprende nunca leva um evento acima de Alta.
- **Repetição.** Com `id`, o mesmo `source` + `id` dentro de 24 horas é descartado (resposta
  200 com `duplicate: true`).
- **Texto desarmado.** O título começa pela origem (`n8n: Backup falhou`), para que um evento
  não se passe por um aviso do próprio Talorys (uma origem que contém `Talorys` ou o nome do
  agente, como `Talorys-Security`, aparece como `remote`), e fica numa linha só (até 120 caracteres enviados); corpo até
  1.000. Links viram texto não clicável em todos os canais: `https://exemplo.com/x` vira
  `` `hxxps://exemplo[.]com/x` ``, e `www.` e domínios soltos também perdem o ponto (o Telegram
  e os clientes de e-mail não transformam isso em link). O corpo inteiro da requisição tem no
  máximo 2 KB.
- **Prioridade que aprende por origem e tipo.** Cada par `source` + `kind` (por exemplo
  `n8n · backup-falhou`) é um perfil em **O que o Talorys aprendeu**, até 50 pares; depois
  disso, os pares novos dividem o perfil **Outros eventos**, para não apagar o que os seus
  outros avisos aprenderam.

### Corpo da requisição

| Campo | Obrigatório | Formato | Para quê |
| --- | --- | --- | --- |
| `title` | sim | Texto, 1 a 120 caracteres | Título do aviso |
| `body` | não | Texto, até 1.000 caracteres | Detalhes (no Telegram e no e-mail só com **Texto completo** ligado em Eventos) |
| `priority` | não | `low`, `normal` ou `high` | Padrão `normal` |
| `source` | não | Até 40 caracteres: letras, números, `.`, `-`, `_` | Quem enviou, por exemplo `n8n`. Padrão `remote` |
| `kind` | não | Igual a `source` | Tipo do evento, por exemplo `backup-falhou`. Padrão `event` |
| `id` | não | Até 100 caracteres: letras, números, `.`, `:`, `-`, `_` | Identificador do evento no sistema de origem, para descartar repetições |

Respostas: **201** `{ event: { id, priority }, duplicate: false }`; **200**
`{ event: null, duplicate: true }`; **400** campo inválido; **403** token sem escopo
`events`; **429** limite por hora (cabeçalho `Retry-After`); **401** token inválido,
revogado, vencido ou acesso remoto desligado.

### Configurar no n8n

1. No Talorys, abra **Configurações → Segurança → Acesso remoto**, ligue o acesso remoto
   (pede a senha recente), escreva um nome como `n8n`, escolha o escopo **events** e toque
   em **Gerar token**. Copie o token na hora: ele não aparece de novo. Criar o token gera o
   alerta de segurança "Token de acesso criado".
2. No n8n, crie uma credencial **Header Auth** com nome `Authorization` e valor
   `Bearer tal_...` (o token copiado).
3. No fluxo, acrescente um nó **HTTP Request**:
   - **Method:** `POST`
   - **URL:** `https://talorys.exemplo.com.br/api/remote/events`
   - **Authentication:** *Generic Credential Type* → *Header Auth* → a credencial do passo 2.
   - **Send Body:** ligado, **Body Content Type:** *JSON*, **Specify Body:** *Using JSON*:

     ```json
     {
       "title": "Backup do servidor falhou",
       "body": "{{ $json.error }}",
       "priority": "high",
       "source": "n8n",
       "kind": "backup-falhou",
       "id": "{{ $execution.id }}"
     }
     ```

   - Em **Options → Retry On Fail**, use no máximo 3 tentativas; o `id` garante que uma
     nova tentativa do mesmo evento não gere aviso repetido.
4. Execute o nó uma vez: a resposta deve ser 201 e o aviso aparece na central.
5. Para conferir pelo terminal:

   ```bash
   curl -X POST https://talorys.exemplo.com.br/api/remote/events \
     -H "Authorization: Bearer tal_..." \
     -H "Content-Type: application/json" \
     -d '{"title":"Teste do n8n","source":"n8n","kind":"teste"}'
   ```

**Com Cloudflare Access na frente** (veja
[deploy-github-actions.md](deploy-github-actions.md#6-recomendado-cloudflare-access-na-frente)):
crie um *Service Token* em **Access → Service Auth** só para o n8n, acrescente à aplicação
uma política *Service Auth* que inclua esse token e, no nó **HTTP Request**, em **Send
Headers**, mande também `CF-Access-Client-Id` e `CF-Access-Client-Secret`. Guarde os dois
como credencial do n8n, nunca dentro do fluxo.

**Se o token vazar:** revogue-o em **Acesso remoto** (ou desligue o acesso remoto). Quem
tiver o token só consegue mandar até 60 avisos por hora (100 por dia), nunca críticos,
sempre com a origem no título e sem links clicáveis, e não lê nada.
Tokens vencem em 90 dias: crie outro e troque a credencial no n8n antes disso.

## O que o histórico de entregas mostra

| Situação | Motivo | Significado |
| --- | --- | --- |
| Enviando | — | O envio ainda está em andamento em segundo plano. Se não houver resposta em 5 minutos (por exemplo, o Worker reiniciou no meio), passa para *Falhou* e deixa de contar no limite |
| Enviado | — | Pelo menos um aparelho (push) ou o chat/grupo (Telegram) recebeu, ou a Cloudflare aceitou o e-mail |
| Falhou | nenhum aparelho ou chat foi alcançado | Todos os envios falharam: aparelhos fora do ar, inscrições expiradas, bot removido do grupo ou bloqueado |
| Não enviado | prioridade baixa fica só no app | Aviso de prioridade baixa |
| Não enviado | limite do canal atingido | O canal já mandou o máximo da hora ou do dia (no e-mail, os 10 do dia, valendo até para segurança) |
| Não enviado | canal não configurado | O deploy não tem as chaves VAPID (push), o segredo `TELEGRAM_BOT_TOKEN` (Telegram) ou o binding `SEND_EMAIL` com remetente e destinatário (e-mail) |
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
| `SEND_EMAIL` | Binding `send_email` do Worker | Para o e-mail | Envio pelo Cloudflare Email Routing; no deploy pelo GitHub, criado a partir de `TALORYS_ALERT_EMAIL_FROM` |
| `ALERT_EMAIL_FROM` | Variável do Worker | Para o e-mail | Remetente, num domínio com Email Routing; no deploy pelo GitHub, `TALORYS_ALERT_EMAIL_FROM` (variável do ambiente `production`) |
| `ALERT_EMAIL_TO` | Segredo do Worker | Não | Seu e-mail verificado no Email Routing; sem ele, usa o `OWNER_EMAIL` |

Sem as chaves VAPID, sem o token do Telegram ou sem o e-mail, tudo funciona e aquele canal
aparece no histórico como *canal não configurado*. O seu endereço de e-mail fica só em
segredo do Worker, nunca no repositório. O ID do chat, do grupo e da sua conta do Telegram
ficam só no banco do Talorys, nunca no repositório nem em variáveis.

## Instalação e configuração

Nada a instalar no banco: a migração 19 roda sozinha na primeira requisição depois do
deploy. Ela acrescenta prioridade, categoria e chave de repetição às notificações (as
antigas ficam como Normal / Sistema) e cria a tabela `tal_alert_deliveries`. Quem já tinha
salvo as preferências antes do Telegram existir ganha o Telegram ligado em toda categoria
que já saía do app; as que estavam só no app continuam só no app. A migração 20 acrescenta às
notificações o estado da insistência (`escalation`, `attempts`, `next_attempt_at`) e às
automações a prioridade (`priority`); as automações existentes ficam como Normal, então
nada passa a insistir sozinho. Os vigias e o resumo do dia não pedem migração nem variável: o agendamento de 15 minutos é
criado sozinho na primeira requisição depois do deploy, e as preferências salvas antes
ganham o resumo às 07:30 e os vigias ligados. A migração 21 acrescenta às notificações o perfil
(`profile`), o motivo da prioridade (`priority_reason`) e o sinal dado (`signal`), e cria
as tabelas `tal_alert_profiles` (o que cada perfil aprendeu) e `tal_alert_corrections` (as
100 correções mais recentes). Começa vazia: nada muda de prioridade até você usar os
avisos. Não há variável nova. A migração 24 acrescenta `sentinel` a `tal_automations` (desligado nas rotinas que já
existem). A migração 23 passa os tokens para uma tabela
`tal_remote_tokens` nova, que aceita o escopo `events`, mantendo todos eles; a antiga fica
vazia como `tal_remote_tokens_v8` (as migrações nunca apagam tabelas). A migração 22 acrescenta `last_seen_at` a
`tal_push_subscriptions`, com a hora da migração nos aparelhos que já existem. Os alertas de segurança novos e o canal de e-mail não pedem
migração; o e-mail é opcional e segue [Configurar o e-mail](#configurar-o-e-mail).

Para o Telegram, siga [Configurar o Telegram](#configurar-o-telegram). Para o push,
depois do deploy:

1. Abra **Configurações → Avisos** e ligue o push neste aparelho (no iPhone, primeiro
   adicione o Talorys à Tela de Início).
2. Em **Para onde vão os avisos**, desligue as categorias que você não quer receber fora
   do app.
3. Ajuste os limites se precisar e toque em **Salvar**.
4. Use **Enviar teste** para conferir o aparelho.

## Aparelhos do push

- **No máximo 3 aparelhos** recebem push. Com 3 cadastrados, ligar o push num quarto
  responde "No máximo 3 dispositivos podem receber notificações. Remova um primeiro.":
  remova um na lista de **Configurações → Avisos → Notificações push**.
- **Aparelho parado sai sozinho.** Por segurança, um aparelho que fica **7 dias ou mais sem
  abrir o Talorys com login** é removido do push, para que um celular perdido ou esquecido
  pare de receber os seus avisos. A checagem roda a cada 15 minutos, mesmo com os vigias
  desligados. Cada remoção fica no registro de atividade e gera o aviso "Aparelho removido do
  push por inatividade" pelos canais que restam (outros aparelhos, Telegram, e-mail se ligado
  para Sistema, e a central).
- **O que conta como acesso:** abrir o Talorys com login naquele navegador. O app avisa o
  servidor ao abrir e depois no máximo uma vez por hora enquanto fica aberto
  (`POST /api/push/seen`). Ligar ou renovar o push também conta. Receber notificações, não.
- Na prática: **abra o Talorys em cada aparelho pelo menos a cada 7 dias** para continuar
  recebendo push nele. Para voltar a receber num aparelho removido, abra o Talorys nele e
  ligue o push de novo (pede a senha recente, como todo aparelho novo, e gera o alerta "Novo
  aparelho no push").
- Se todos os aparelhos saírem de uma vez e o Telegram e o e-mail não estiverem ligados, o
  aviso da remoção fica só na central do app.
- Instalações que já tinham mais de 3 aparelhos antes desta versão não perdem nenhum na
  hora (o cartão mostra, por exemplo, "5 de 3"): os parados saem sozinhos depois de 7 dias, e
  um aparelho novo só entra quando houver vaga.
- Quando o navegador troca a inscrição sozinho (chaves renovadas ou inscrição expirada), o
  service worker envia a nova com o endpoint antigo em `replaces`: o mesmo aparelho continua
  no lugar, sem pedir senha e sem alerta, e o último acesso não muda.
- Os limites ficam em `packages/shared/src/push.ts` (`MAX_PUSH_DEVICES = 3` e
  `PUSH_INACTIVE_DAYS = 7`). Não há variável de ambiente para mudá-los.

## API

Todas as rotas, menos o webhook do Telegram, exigem a sessão do dono e o cabeçalho
`x-talorys-request`. Tokens de acesso remoto **não** alcançam nenhuma delas.

| Método e rota | Corpo | Resposta |
| --- | --- | --- |
| `GET /api/alerts` | — | `{ preferences, deliveries, channels, email: { to, sentToday } }`; `channels` tem `push`, `telegram` e `email`; `email.to` é o destino mascarado ou `null` sem e-mail |
| `POST /api/alerts/email/test` | — | Envia o e-mail de teste; `{ sent, overview }`; pede a senha recente (403 `REAUTH_REQUIRED`); 503 `NOT_CONFIGURED` sem e-mail; 429 depois de 2 testes no dia ou sem espaço no limite |
| `POST /api/push/subscriptions` | Inscrição do navegador, com `replaces` opcional (endpoint antigo) | Com `replaces` de um aparelho cadastrado, troca o endpoint e as chaves dele (sem senha, sem alerta). Um aparelho novo pede a senha recente e gera o alerta "Novo aparelho no push"; a renovação do mesmo navegador não. 400 com 3 aparelhos já cadastrados |
| `POST /api/remote/events` | Evento (veja [Eventos do n8n](#eventos-do-n8n-e-de-outras-automações)), até 2 KB | Só com token de escopo `events` (`Authorization: Bearer`); 201, 200 repetido, 400, 403, 429 |
| `POST /api/push/seen` | `{ endpoint }` (até 4 KB) | `{ known }`: marca o último acesso do aparelho com esse endpoint; `known: false` quando ele não está mais cadastrado (o interruptor do navegador volta a mostrar desligado) |
| `GET /api/push` | — | `{ available, public_key, devices, max_devices: 3, inactive_days: 7 }`; cada aparelho traz `last_seen_at` |
| `DELETE /api/notifications/:id` | — | Alerta de segurança pede a senha recente (403 `REAUTH_REQUIRED`); 409 enquanto ainda insiste |
| `PUT /api/alerts/preferences` | `{ routes: { <categoria>: ["push", "telegram", "email"] }, limits: { perHour, perDay }, fullText: [<categoria>...], digest: { enabled, time: "HH:MM" }, watchers }` (todas as categorias, até 8 KB; `fullText`, `digest` e `watchers` opcionais, padrão vazio, `{ enabled: true, time: "07:30" }` e `true`) | `{ preferences }`; 400 se inválido |
| `PATCH /api/notifications/:id` | `{ priority: "low" \| "normal" \| "high" \| "critical" }` | `{ notification }` com `priority_reason: "corrected"`; o perfil do aviso aprende com a correção; 400 para baixar um alerta de segurança; 404 se não existir |
| `GET /api/notifications` | — | Cada notificação traz `priority`, `category`, `escalation` (`null`, `"active"`, `"acknowledged"`, `"muted"` ou `"unacknowledged"`), `attempts`, `next_attempt_at`, `profile` (chave do perfil; `null` em segurança) e `priority_reason` (`"default"`, `"rule"`, `"raised"`, `"lowered"`, `"pinned"`, `"corrected"` ou `null` nos avisos de antes) |
| `POST /api/notifications/read` | `{ id? }` | Ler um aviso conta como sinal (rapidez); sem `id` marca todos, sem sinal |
| `GET /api/alerts/profiles` | — | `{ profiles: [{ id, key, category, label, shift, pinned, score, samples, changed_at, last_change, updated_at }] }` (só os que têm sinais, mudaram ou foram fixados) |
| `PUT /api/alerts/profiles/:id` | `{ pinned: "low" \| "normal" \| "high" \| null }` | `{ profile }`; `null` volta a aprender; `"critical"` é recusado (400); 404 se não existir |
| `DELETE /api/alerts/profiles/:id` | — | Zera o perfil e apaga as correções dele; `{ profile }`; 404 se não existir |
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
- Os vigias e o resumo do dia ficam em `apps/agent/src/alerts/watchers.ts`
  (`runWatchers()`, chamado pelo cron `*/15 * * * *` de `TalorysAgent.watch`, agendado no
  `onStart`; agendamentos cron do Agents SDK não duplicam). As constantes ficam em `WATCH`
  (`packages/shared/src/alerts.ts`). Um vigia novo deve ser determinístico, usar uma chave
  de repetição e só chamar `raise()` quando houver algo a fazer.
- A prioridade que aprende fica em `apps/agent/src/alerts/learning.ts` (`AlertLearning`):
  `profileKey()` monta o perfil, `decide()` aplica regras, fixação e o nível aprendido no
  `raise()`, e `observe()`, `read()`, `corrected()`, `taskCompleted()` e `sweepIgnored()`
  recebem os sinais. As constantes (`LEARNING`, `PRIORITY_REASONS`) ficam em
  `packages/shared/src/alerts.ts`. Um aviso sobre uma tarefa deve usar a chave de repetição
  `task-<tipo>:<id da tarefa>` para que concluir a tarefa conte como sinal. Lembretes
  únicos passam `profileKind: "once"` para aprender juntos.
- Os alertas de segurança fora da banda ficam em `apps/agent/src/alerts/security.ts`
  (`SECURITY_EVENTS` e `raiseSecurityAlert()`, que nunca lança erro). Uma mudança nova que
  abra acesso aos dados deve chamar `raiseSecurityAlert()` depois de feita, com título e
  texto em inglês traduzidos no catálogo. O canal de e-mail fica em
  `apps/agent/src/alerts/email.ts` (`EmailAlerts`: endereço simples obrigatório, assunto
  sem quebra de linha, teto de `EMAIL_ALERTS.perDay` contado na chave `alerts.email.sent`
  antes de enviar, com `reserved` vagas só para segurança e críticos e `testsPerDay` testes). Um canal com `firstTryOnly` só recebe a primeira tentativa e não conta
  para a insistência; um canal com `full()` segura até os alertas de segurança.
- O bot fica em `apps/agent/src/telegram/`: `client.ts` (chamadas à Bot API, sem seguir
  redirecionamentos, com tempo limite de 10 s; o erro nunca leva o token), `service.ts`
  (vinculação, envio, tópicos, botões, conversa), `format.ts` (Markdown para o HTML do
  Telegram e divisão de respostas longas) e `routes.ts` (webhook e rotas do dono). O estado
  fica nas configurações, chaves `telegram.link` e `telegram.code`.
- Testes: `apps/agent/test/alerts.test.ts` (regras, preferências, API),
  `apps/agent/test/escalation.test.ts` (escada, confirmação, respostas, push com botões),
  `apps/agent/test/learning.test.ts` (regras fixas, perfis, sinais, travas, fixar e zerar,
  API, correções no contexto do agente), `apps/agent/test/watchers.test.ts` (cada vigia,
  limite por rodada, resumo do dia com fuso, tradução e agendamento),
  `apps/agent/test/telegram.test.ts` (Bot API falsa: vinculação, envio, tópicos, botões,
  webhook, Access), `apps/agent/test/email.test.ts` (e-mail com binding falso, teto diário,
  só a primeira tentativa, alertas de segurança novos, apagar com senha, retenção) e `tests/e2e/alerts.spec.ts` (tela).
