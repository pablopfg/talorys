# Changelog

Todas as mudanças relevantes do Axis (antes Talorys) ficam registradas aqui, no formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e são iguais às do pacote instalador (`create-talorys`). Cada pull request descreve sua mudança em "Não lançado", nos grupos Adicionado, Alterado, Corrigido, Segurança e Atualização; a release transforma essa seção na versão nova. Veja [docs/releases.md](docs/releases.md).

## Não lançado

### Adicionado

- **Workflows: rotinas do n8n rodando na Cloudflare.** Um menu novo, **Workflows**, roda rotinas com os Workflows da Cloudflare (plano gratuito): cada execução tem etapas que tentam de novo sozinhas e continuam depois de um reinício. Cada workflow tem chave liga/desliga, agendamento, **Executar agora** e histórico. O primeiro:
  - **Monitor de sites**: confere até 10 endereços (padrão a cada 15 minutos) e avisa com prioridade alta quando um site cai (depois de duas execuções seguidas com falha) e quando volta.
  - Só a sessão do dono gerencia os workflows (tokens de acesso recebem 403); ligar ou trocar endereços pede a senha recente; só endereços `https://` públicos, conferidos no DNS antes de cada requisição. O deploy cria o Workflow `<nome do Worker>-workflow` sozinho, sem segredo novo. Veja [docs/workflows.md](docs/workflows.md) e a etapa 26 do [guia de instalação](docs/instalacao-cloudflare.md#26-workflows-rotinas-que-estavam-no-n8n).

- **Limites de armazenamento e lixeira.** Cada tipo de dado tem um limite (10.000 memórias, 20.000 tarefas, 5.000 notas, 1.000 projetos, 5.000 conversas, 200.000 mensagens do chat e 500 automações), além de 4 GiB para o banco inteiro, o que mantém o Axis bem dentro do plano gratuito da Cloudflare. No limite, o item novo é recusado com uma mensagem clara e nada é apagado para abrir espaço. **Configurações → Privacidade** mostra o uso de cada tipo e avisa a partir de 80%. Tarefas, notas e memórias excluídas vão para a **lixeira** por 30 dias (as arquivadas ficam um ano), de onde podem ser restauradas ou excluídas de vez. Veja [docs/security.md](docs/security.md#limites-de-armazenamento-e-lixeira).

- **Limpeza automática e compactação de memórias.** Toda semana, as tarefas concluídas há mais de 90 dias vão para o arquivo, as notas vazias vão para a lixeira e as mensagens do chat com mais de 6 meses que o resumo da conversa já cobre são removidas. O relatório também aponta as notas paradas há 6 meses, só como sugestão. A cada 15 dias (ou antes, perto do limite), as memórias repetidas que o agente salvou são combinadas, mantendo a mais recente. Tarefas abertas e memórias que você escreveu, editou ou importou nunca são tocadas, a primeira execução espera 7 dias com um aviso, tudo o que sai pode ser restaurado da lixeira e um aviso resume cada execução. Não usa IA. A chave fica em **Configurações → Privacidade**. Veja [docs/security.md](docs/security.md#limpeza-automática).

### Alterado

- **Novo nome e nova identidade: Axis.** O Talorys passa a se chamar **Axis**, "Inteligente, integrado e autônomo", com a identidade visual Prisma: um X em íris e ciano com um losango branco no centro, no logo, no favicon e nos ícones do app instalado (inclusive o ícone adaptável do Android). As cores seguem as escalas Radix nos temas claro e escuro: íris para botões e item ativo do menu, ciano para o que o agente executou e cinza-azulado como base. Títulos usam a Funnel Display e o texto, a Funnel Sans, servidas pelo próprio app (cerca de 35 KB, sem Google Fonts). Interface em pt-BR, inglês e coreano, prompt do agente, notificações, e-mails, Telegram, mensagens de erro, instalador, README e documentação usam o nome novo. Os nomes técnicos (`create-talorys`, `@talorys/*`, `TalorysAgent`, tabelas `tal_*`, variáveis `TALORYS_*`, cookies) continuam os mesmos, então nada muda no deploy nem nos dados. Quem nunca trocou o nome do agente passa a vê-lo como Axis; um nome escolhido pelo dono é mantido. Eventos externos com "Talorys" no nome da origem continuam aparecendo como "remote", como os que usam "Axis".

### Removido

- **Site de apresentação.** A pasta `site/` (a página de divulgação herdada do projeto original) e o workflow **Pages** do GitHub saem do repositório: o Axis usa só a própria interface, publicada no Worker da Cloudflare. O logo do README passa a ser o ícone do app.

### Segurança

- **Armazenamento limitado e exclusões recuperáveis.** Um token de escrita vazado ou importações repetidas não conseguem mais fazer o banco crescer sem limite, e o que um token exclui pode ser restaurado da lixeira pelo dono. Os tokens têm um espaço próprio na lixeira; quando ele acaba, a exclusão por token é recusada, então um token nunca empurra para fora da lixeira o que apagou. Uma importação que passaria de um limite é desfeita inteira. Uma memória criada ou editada por token usa no máximo metade do limite diário de embeddings, como as buscas por token; ela é salva do mesmo jeito e indexada depois. Apagar todas as memórias também apaga as que estavam na lixeira.

### Atualização

- **Lixeira.** A migração 29 roda sozinha depois do deploy e cria a tabela `tal_trash`. Não há segredo nem variável nova.

- **Limpeza automática.** A migração 30 roda sozinha e anota até onde cada resumo de conversa cobre as mensagens; resumos anteriores a ela nunca levam mensagens. A limpeza começa ligada, mas a primeira execução espera 7 dias depois do deploy, com um aviso. Para desligar, use a chave em **Configurações → Privacidade**.

- **Workflows.** A migração 28 roda sozinha depois do deploy e cria as tabelas `tal_workflows` e `tal_workflow_runs`. O deploy passa a criar um Workflow da Cloudflare, `<nome do Worker>-workflow` (binding `TALORYS_WORKFLOW`, classe `TalorysWorkflow`), com o mesmo token de antes; não há segredo nem variável nova, e todos os workflows começam desligados. Incluído no plano gratuito do Workers. Quem instalou pelo `create-talorys` ganha o mesmo binding no próximo `update`.

## 1.1.0 — 2026-10-29

### Adicionado

- **Modelos da Anthropic e da OpenAI, com modelo principal e fallback.** ⚠️ **Gera cobrança** na sua conta da Anthropic ou da OpenAI. Em **Configurações → IA → Modelo**, escolha o modelo principal do chat (Workers AI, Anthropic ou OpenAI) e um fallback, que responde quando o principal falha antes de responder: fora do ar, ocupado, sem crédito, chave recusada ou teto do dia atingido. Depois que o principal começa a responder, não há troca, para nunca responder nem rodar uma ferramenta duas vezes. Só modelos com preço conhecido podem ser escolhidos (Claude Opus, Sonnet e Haiku 5.5; GPT-6.1 Sol, GPT-6 Sol, Luna e Astra), e um teto novo, **IA paga por dia (US$)** (padrão US$ 2, máximo US$ 50), é conferido antes de cada chamada e de cada passo. As chaves ficam só como segredos do Worker (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), nunca no app, nos backups ou nos logs; chamadas pagas não são repetidas automaticamente. Ligar um modelo pago, trocá-lo ou aumentar o teto pede a senha recente, e essas escolhas não vêm na importação de backup. O padrão continua sendo o Workers AI, sem custo extra. Veja [docs/modelos-de-ia.md](docs/modelos-de-ia.md).

- **Instalador privado no GitHub Packages.** A cada versão nova, o workflow **Release** publica o instalador da tag como `@pablopfg/create-talorys`, privado no GitHub Packages, depois de montar e testar o pacote renomeado num job sem token de escrita; outro job, no ambiente protegido `packages` e sem rodar código do projeto, o publica com o token da própria execução. Os comandos que o instalador, o app e o Worker sugerem passam a apontar para o pacote do fork. O repositório mantém o nome do original; a troca de nome acontece só na publicação. Instalação com um token `read:packages` só na sua máquina. Veja [docs/releases.md](docs/releases.md#instalador-no-github-packages).

- **Rotinas do dia com a agenda.**
  - **Resumo do dia com a agenda.** O resumo do dia passa a listar os compromissos de hoje das agendas abertas.
  - **Aviso antes do primeiro evento.** Em **Configurações → Integrações → Google Agenda**, cada agenda aberta ganha um aviso N minutos antes do primeiro evento do dia, com o seu texto (por exemplo, "ligar o ar-condicionado"). O aviso sai uma vez por dia, segue o evento se ele mudar de horário e ignora eventos de dia inteiro.
  - **Condição de agenda nas automações.** Uma automação pode **Só rodar em dias com eventos** numa agenda aberta. Sem eventos, a execução é pulada; se o Google não responder, ela roda assim mesmo.
  - **Novos modelos de rotina de IA.** **Briefing da manhã** (todo dia às 07:00), **Fechamento do dia** (segunda a sexta às 19:00) e **Fechamento de sábado** (13:00, só com eventos na agenda escolhida).
  - Veja [docs/google-calendar.md](docs/google-calendar.md#rotinas-do-dia-com-a-agenda).

- **Google Agenda.** Conecte uma conta Google em **Configurações → Integrações → Google Agenda** e escolha, agenda por agenda, o que o agente pode fazer: nada (padrão), **Só leitura** ou **Ler e propor alterações**. O agente lista e busca eventos (também nas rotinas agendadas) e, só no chat, propõe criar, mover, renomear ou excluir eventos, cada um com cartão de aprovação. Os convidados nunca recebem e-mail, e uma alteração feita no Google depois da proposta prevalece. Alterar só é oferecido onde o próprio Google deixa a conta editar, então uma agenda de trabalho compartilhada como leitura fica protegida pelo Google. O texto dos convites é tratado como dado não confiável. Conectar e abrir uma agenda pedem a senha recente, conectar gera alerta de segurança, os tokens ficam cifrados com `MCP_CREDENTIAL_KEY` e fora dos backups, e desconectar revoga o acesso. Precisa de um cliente OAuth gratuito do Google Cloud (segredos `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`): passo a passo na etapa 25 do [guia de instalação](docs/instalacao-cloudflare.md#25-google-agenda). Veja [docs/google-calendar.md](docs/google-calendar.md).

- **Passkeys na verificação em duas etapas.** Com a verificação em duas etapas ligada, **Configurações → Segurança → Passkeys** adiciona passkeys (Face ID, Touch ID, Windows Hello, Android, gerenciador de senhas ou chave de segurança). No login, depois da senha, **Usar uma passkey** substitui o código do app. O app autenticador e os códigos de recuperação continuam valendo, e desligar a verificação em duas etapas remove as passkeys. Só a chave pública fica guardada; cada pedido vale uma vez, só para o endereço do próprio Talorys, então uma página falsa que repasse o pedido é recusada, assim como uma chave copiada. Adicionar ou remover pede a senha recente, aparece na atividade de acesso e gera alerta de segurança. Até 10 passkeys. A passkey pertence ao domínio onde foi criada: crie depois de passar para o seu domínio. Veja [docs/security.md](docs/security.md#verificação-em-duas-etapas).

- **Guia completo de instalação na Cloudflare.** O novo [docs/instalacao-cloudflare.md](docs/instalacao-cloudflare.md) leva do zero até o ar, etapa por etapa e só pelo navegador: conta e domínio, HTTPS, subdomínio `workers.dev`, token de API, GitHub (Actions, rulesets, secret scanning, CodeQL, Dependabot, ambientes `production` e `smoke`), primeiro deploy, segredos do Worker (incluindo `PASSWORD_PEPPER` e `OWNER_EMAIL`, que não estavam no guia de deploy), Access, Turnstile, Email Routing com o aviso sobre os registros MX, push (com as chaves VAPID geradas no próprio navegador), Telegram, n8n, MCP, primeira release, conferência final, rotina e problemas comuns.

- **Central de avisos.** Todo aviso do Talorys (lembretes, resumos, rotinas, alertas de sistema e de segurança) agora tem prioridade (baixa, normal, alta ou crítica) e categoria, e passa por uma central que decide por onde ele sai do app. Em **Configurações → Avisos** (aba nova, que também passa a abrigar as notificações push) você escolhe quais categorias vão para o push, limita quantas mensagens cada canal manda por hora e por dia (padrão 6 e 30) e vê as 100 entregas mais recentes, com o motivo de cada aviso que não saiu. Avisos de prioridade baixa ficam só no app; lembretes, alertas de segurança e avisos críticos nunca são segurados pelos limites; segurança e críticos saem sempre por todos os canais (não dá para desligar); e repetições do mesmo aviso são descartadas. A prioridade de cada notificação pode ser corrigida na própria central. Veja [docs/alerts.md](docs/alerts.md).

- **Avisos no Telegram.** Um bot do Telegram, vinculado em **Configurações → Avisos → Telegram** com um código de uso único, passa a ser um canal da central de avisos. Os avisos vão para o seu grupo (um tópico por categoria quando o grupo tem tópicos e o bot é administrador) ou para o chat privado com o bot. Por padrão o Telegram é discreto (título, categoria e prioridade, sem o texto); ligue **Texto completo** nas categorias que quiser ler lá. Avisos de prioridade baixa e normal chegam sem som. Avisos de prioridade alta e crítica trazem os botões **Feito** e **Adiar 1 h**, e todos trazem **Abrir o Talorys**. O bot só obedece à conta que vinculou o chat. Veja [docs/alerts.md](docs/alerts.md#telegram).

- **Conversa pelo Telegram.** O chat privado com o bot agora conversa com o Talorys, com as mesmas memórias, ferramentas e limites do chat do app, numa conversa que também aparece no app (`/new` começa outra). Ações que pedem aprovação e planos de tarefas continuam sendo confirmados só no app: a resposta traz o botão **Abrir no Talorys**. A conversa liga e desliga em Configurações → Avisos → Telegram (ligar de novo pede a senha). Veja [docs/alerts.md](docs/alerts.md#conversar-pelo-chat-privado).

- **Mensagens de voz no Telegram.** Com a conversa pelo Telegram ligada, grave um áudio (ou envie um arquivo de áudio) de até 5 minutos no chat privado com o bot: o Talorys transcreve com o mesmo Whisper da entrada por voz do app, mostra o texto que entendeu e responde como se você tivesse escrito. Usa o mesmo teto diário de 60 minutos de áudio do app, e o áudio não é guardado. Veja [docs/alerts.md](docs/alerts.md#mensagens-de-voz).

- **Lembretes insistentes.** Avisos de prioridade Alta ou Crítica que você não confirmou saem de novo depois de 15 minutos e, pelo push e pelo chat privado do bot, depois de 1 hora; sem confirmação, ficam marcados como "Não confirmado". Feito, Adiar 1 h, Silenciar este aviso (Telegram, push ou central), abrir o aviso no app ou responder no chat do bot encerram a insistência. As automações ganham **Prioridade do aviso** (Baixa, Normal ou Alta); um lembrete Alta é um lembrete insistente, e o agente cria um quando você pede "até eu confirmar". As notificações push de avisos insistentes trazem os botões Feito, Adiar e Silenciar. Alertas de segurança também insistem e só param pelo Telegram (botão ou mensagem no chat do bot): nada feito dentro do app os cala. Veja [docs/alerts.md](docs/alerts.md#insistência).

- **Prioridade que aprende.** O Talorys ajusta sozinho a prioridade de cada tipo de aviso (cada rotina, resumo ou lembrete recorrente, os lembretes avulsos, cada tipo de aviso do sistema) pelo que você faz com ele: correções, rapidez para ler ou tocar em Feito, adiamentos, silenciamentos, avisos deixados sem ler por 24 horas e tarefas concluídas logo depois do aviso, sem gastar IA. Muda no máximo um nível por semana e no máximo dois níveis no total. Regras fixas: segurança é sempre Crítica, eventos externos nunca passam de Alta, lembretes nunca caem para Baixa e um aviso que pediu Alta ou Crítica sai como pediu. Todo aviso diz por que tem aquela prioridade e pode ser corrigido na central (**Corrigir**) ou no Telegram (**Corrigir prioridade**). Em **Configurações → Avisos → O que o Talorys aprendeu** você vê cada tipo, fixa numa prioridade ou zera. No chat, o agente escolhe a prioridade dos lembretes guiado pelas suas últimas 20 correções. Veja [docs/alerts.md](docs/alerts.md#prioridade-que-aprende).

- **Vigias e resumo do dia.** A cada 15 minutos, sem IA, o Talorys confere prazos (tarefa vence em 24 horas, na próxima hora, atrasada, parada há uma semana), rotinas que falharam duas vezes seguidas, servidores MCP que perderam o login ou estão com erro, o orçamento de IA em 80% e 100%, aparelhos de push que pararam de receber, backup sem exportar há 30 dias e versões novas, e só avisa quando há algo a fazer. Tarefa atrasada avisa uma vez por dia, depois do horário do resumo (nunca de madrugada), Alta (insiste) só no primeiro dia; cada rodada gera até 5 avisos de tarefa e no máximo 20 por dia. O **resumo do dia** chega às 07:30 (ajustável) com atrasadas, o que vence e o que está agendado hoje e os avisos de prioridade baixa que ficaram no app; às sextas, conta o que a prioridade aprendeu na semana. Sem nada para contar, nada é enviado. Ambos ligam e desligam em Configurações → Avisos. Veja [docs/alerts.md](docs/alerts.md#vigias-e-resumo-do-dia).

- **Alertas de segurança fora da banda e avisos por e-mail.** Troca de senha, acesso remoto ligado, token de acesso criado, chat ou grupo do Telegram vinculado ou desvinculado, conversa no Telegram ligada, aparelho novo ou removido no push, servidor MCP adicionado, atividade de acesso apagada e backup exportado ou importado passam a gerar alertas de segurança: sempre críticos, enviados por todos os canais mesmo para quem está dentro do app, e insistentes até a confirmação pelo Telegram. O **e-mail** vira um canal da central, pelo Cloudflare Email Routing (gratuito para o seu endereço verificado): recebe sempre os alertas de segurança e os críticos, e as outras categorias que você ligar; só a primeira tentativa vai por e-mail, no máximo 10 por dia (4 reservados para segurança e críticos), discreto como o Telegram e só em texto simples. O e-mail de teste pede a senha recente e sai no máximo 2 vezes por dia. Em **Configurações → Avisos → E-mail** aparecem o destino mascarado e o botão **Enviar e-mail de teste**. Variáveis novas: `TALORYS_ALERT_EMAIL_FROM` (GitHub) ou `ALERT_EMAIL_FROM` + binding `send_email`, e o segredo opcional `ALERT_EMAIL_TO`. ⚠️ Ligar o Email Routing troca os registros MX do domínio; use um subdomínio se o domínio já recebe e-mail em outro lugar. Veja [docs/alerts.md](docs/alerts.md#alertas-de-segurança-fora-da-banda-e-e-mail).

- **Sentinelas com IA.** Rotinas de IA ganham o interruptor **Só me avisar quando algo precisar de mim**: quando a IA não encontra nada que precise de você, a execução termina em silêncio (fica só no histórico da rotina) em vez de mandar "tudo certo". Em **Automações → Nova → Rotina de IA**, dois modelos prontos preenchem o formulário: **Checagem da manhã** (todo dia às 07:00, só o que precisa de você hoje) e **Revisão da semana** (sextas às 17:00). O agente também propõe rotinas assim quando você pede no chat "só me avise se…". Veja [docs/alerts.md](docs/alerts.md#sentinelas-com-ia).

- **Verificação contra robôs nos logins arriscados.** Com o Cloudflare Turnstile configurado (gratuito), a tela de login mostra a verificação "não sou um robô" só quando o login parece arriscado: a rede errou a senha nos últimos 15 minutos, ou há muitas falhas vindas de várias redes e a rede não é uma das suas. No uso normal, o login continua só com a senha. A verificação é conferida antes de a senha ser testada, então um robô sem ela não gasta tentativas nem processamento, e cada recusa aparece na atividade de acesso como "Verificação contra robôs não aprovada". Veja [docs/security.md](docs/security.md#verificação-contra-robôs-turnstile).

- **Eventos do n8n e de outras automações.** Um token de acesso remoto com o escopo novo **events** envia avisos para `POST /api/remote/events`: cada evento vira um aviso na categoria Eventos, com título, corpo, prioridade (baixa, normal ou alta; nunca crítica), origem, tipo e um id para descartar repetições em 24 horas. No máximo 60 eventos por hora e 100 por dia, corpo de até 2 KB, título sempre com a origem e links não clicáveis em nenhum canal. Para não abafar os seus avisos, eventos usam só metade do limite de cada canal e no máximo 3 insistem ao mesmo tempo. O token **events** não lê nem altera nenhum dado, e só ele envia eventos. A prioridade aprende por origem e tipo. O guia mostra o nó HTTP Request do n8n e o Service Token do Cloudflare Access. Veja [docs/alerts.md](docs/alerts.md#eventos-do-n8n-e-de-outras-automações).

- **Esqueci a senha, por e-mail.** Com os avisos por e-mail configurados, a tela de login ganha **Esqueceu a senha?**: um link de uso único, válido por 30 minutos, chega ao seu endereço verificado. Com a verificação em duas etapas ligada, a senha nova também pede o código do app autenticador ou um código de recuperação. Trocar a senha pelo link encerra todas as sessões e os tokens de acesso e gera o alerta de segurança "Senha redefinida por e-mail". O pedido exige o seu e-mail e sempre responde do mesmo jeito (ninguém descobre se acertou o endereço), com no máximo 3 pedidos por rede a cada 15 minutos e 3 e-mails por dia, e com o Turnstile ligado todo pedido passa pela verificação contra robôs. Veja [docs/security.md](docs/security.md#recuperação-de-senha-por-e-mail).

### Alterado

- **Documentação toda em português.** Os guias em `docs/` que ainda estavam em inglês (arquitetura, proteção das branches, deploy, desenvolvimento, Google Agenda, servidores MCP, histórico de memória, acesso remoto, segurança, busca semântica, solução de problemas e o relatório da avaliação semântica), o `SECURITY.md` e o `CONTRIBUTING.md` foram traduzidos para pt-BR, com os caminhos de menu iguais aos da interface. Os nomes dos arquivos não mudaram; os links para seções foram atualizados para os títulos novos. O script `scripts/semantic-eval.mjs` passa a gerar o relatório em português.

- **Guia do cliente OAuth do Google.** A etapa 25 do [guia de instalação](docs/instalacao-cloudflare.md#25-google-agenda) explica como o cliente OAuth funciona, avisa que o URI de redirecionamento tem de ser idêntico ao endereço aberto no navegador e ganha uma tabela com os erros mais comuns da conexão e como resolver cada um.

- Cadastrar um aparelho novo no push passa a pedir a senha digitada há pouco (um login recente conta; a renovação do mesmo navegador não pede).

- **Push em no máximo 3 aparelhos, e aparelhos parados saem sozinhos.** O push passa a aceitar no máximo 3 aparelhos cadastrados (antes eram 10). Por segurança, um aparelho que fica 7 dias ou mais sem abrir o Talorys com login é removido do push automaticamente (a checagem roda a cada 15 minutos, mesmo com os vigias desligados): o registro de atividade guarda a remoção e chega o aviso "Aparelho removido do push por inatividade" pelos canais que restam. Abrir o app conta como uso (o navegador avisa o servidor no máximo uma vez por hora). Cada aparelho mostra o último acesso em **Configurações → Avisos → Notificações push**. Para receber de novo, abra o Talorys no aparelho e ligue o push outra vez. Veja [docs/alerts.md](docs/alerts.md#aparelhos-do-push).

- Quando o navegador renova sozinho a inscrição do push, o aparelho continua no mesmo lugar, sem pedir a senha (antes o novo cadastro era recusado e o aparelho sumia da lista).

- Apagar um alerta de segurança da central passa a pedir a senha digitada há pouco, e os 200 alertas de segurança mais recentes ficam guardados à parte dos outros avisos (que continuam nos 500 mais recentes).

- O site do projeto no GitHub Pages fica desligado por enquanto: o workflow *Pages* só roda à mão, pela aba Actions, e o README não leva mais ao site do Talorys original. Um merge na `main` não falha mais por o Pages não estar ativado.

- Alertas de segurança não podem mais ter a prioridade baixada: são sempre críticos (antes dava para mudar o selo na central, embora continuassem insistindo).

- O histórico de entregas fala em "aparelho ou chat" nos motivos de não envio, porque vale também para o Telegram.

- Alertas de segurança (login novo, verificação em duas etapas, muitas tentativas de login, código de recuperação usado) passam a ser avisos críticos, e o aviso de rotina de IA pulada por falta de orçamento sai no máximo uma vez por rotina por dia.

### Segurança

- **MCP mais fechado.** Com `TALORYS_MCP_ALLOWED_ORIGINS`, o Talorys só se conecta aos servidores da lista, como o seu n8n. Os que já estavam adicionados também param se saírem da lista. Ligar o "Executar sem perguntar" agora pede a senha. Mesmo ligado, a chamada vira um cartão de aprovação quando a conversa já trouxe o resultado de outro servidor MCP (neste turno ou em um anterior), quando os argumentos passam de 1.000 caracteres ou quando as chamadas do turno já enviaram 4.000 caracteres juntas. Religar uma ferramenta assim depois que o servidor mudou a definição também pede a senha. Com a lista, o servidor de login (OAuth) também precisa estar nela. Nas automações agendadas, onde ninguém pode aprovar, essa chamada é recusada. Veja [docs/mcp.md](docs/mcp.md).

Auditoria de segurança completa de 29/10 (skill de auditoria e skills oficiais da Cloudflare). Nenhum achado crítico, alto ou médio; os sete de severidade baixa foram corrigidos:

- **Links de golpe nos avisos fora do app.** O Telegram e os clientes de e-mail transformam em link qualquer endereço, mesmo entre crases. Agora todo título e texto de aviso enviado por Telegram ou e-mail chega com `hxxps://`, `tg[:]`, `www[.]` e `sub[.]exemplo[.]com` (todos os pontos do endereço); só o botão **Abrir o Talorys** e o link do rodapé do e-mail continuam clicáveis. Antes, lembretes, resumos de tarefas e respostas de rotinas de IA podiam levar um link clicável (a mensagem de um resumo de tarefas nem passava pelo filtro).
- **Códigos de duas etapas digitados para confirmar a identidade não contavam como errados.** Com uma sessão roubada, dava para tentar códigos do autenticador em **Confirmar senha**, ao desligar a verificação em duas etapas ou ao gerar códigos de recuperação sem acionar a pausa de 15 minutos nem o alerta "Códigos de login errados". Agora esses códigos seguem as mesmas proteções do login.
- **Remover o único aparelho do push avisava ninguém.** O alerta "Aparelho removido do push" agora sai antes da remoção, então o próprio aparelho recebe o aviso.
- **Reconectar o Telegram religava a conversa sem alerta.** Agora gera o mesmo alerta de segurança "Conversa no Telegram ligada" que a chave em Configurações.
- **Trocar o endereço de um servidor MCP mantinha a confiança nas ferramentas.** Apontar um servidor para outro endereço (mesmo só outro caminho no mesmo host, onde um gateway pode trocar de cliente pelo caminho) agora conta como adicionar um: pede a senha digitada há pouco, gera o alerta de segurança, apaga a credencial guardada e desliga todas as ferramentas, que voltam a pedir aprovação e saem das rotinas. Adicionar um servidor MCP também passa a pedir a senha digitada há pouco.
- **O nome do agente entra no topo de todo prompt.** Mudar o nome agora pede a senha digitada há pouco, um backup não altera mais o nome e ele entra sempre numa linha só.
- **Eventos de automações podiam se passar pelo Talorys.** Um evento cuja origem contém `Talorys` ou o nome do agente (como `Talorys-Security`) aparece como `remote`, e endereços sem `http` (como `www.` ou `exemplo.com/login`) também são desarmados.
- Reforços: a checagem de origem dos PRs para a `main` recusa branches de forks com o nome `develop` ou `hotfix/*`, a interface codifica os ids que vêm da URL antes de chamar a API, e o desarme de links corta o texto antes, para não ficar lento com textos enormes.

### Atualização

- A recuperação de senha por e-mail não pede migração nem segredo novo: aparece sozinha na tela de login quando os avisos por e-mail estão configurados e o deploy tem `TALORYS_CUSTOM_DOMAIN` ou `TALORYS_PUBLIC_URL` (o link usa só esse endereço).

- A migração 24 roda sozinha depois do deploy e acrescenta o interruptor de sentinela às automações; as rotinas de IA que já existem continuam avisando sempre.

- A migração 23 roda sozinha depois do deploy e passa os tokens de acesso remoto para uma tabela nova que aceita o escopo `events` (a antiga fica vazia, como `tal_remote_tokens_v8`); os tokens existentes continuam valendo, com o mesmo escopo e validade.

- A migração 22 roda sozinha na primeira requisição depois do deploy: acrescenta o último acesso (`last_seen_at`) aos aparelhos do push, com a hora da migração para os que já existem, então nenhum é removido no dia da atualização. Quem já tinha mais de 3 aparelhos não perde nenhum na hora: os que ficarem 7 dias sem abrir o Talorys saem sozinhos, e um aparelho novo só entra quando houver vaga.

- A migração 19 do banco roda sozinha na primeira requisição depois do deploy: acrescenta prioridade, categoria e chave de repetição às notificações (as antigas ficam como Normal / Sistema) e cria a tabela `tal_alert_deliveries`. Para os avisos no Telegram, um segredo novo e opcional, `TELEGRAM_BOT_TOKEN` (token do bot criado no @BotFather); sem ele o canal aparece como não configurado e nada mais muda. Quem usa o Cloudflare Access precisa de uma regra *Bypass* para o caminho `api/telegram/webhook` (veja [docs/alerts.md](docs/alerts.md#configurar-o-telegram)). Preferências de avisos salvas antes do Telegram ganham o Telegram ligado nas categorias que já saíam do app. A conversa pelo chat do Telegram é ligada ao conectar o bot; um vínculo feito antes dela fica com a conversa desligada até você ligar em Configurações → Avisos → Telegram. A migração 20 roda sozinha e acrescenta o estado da insistência às notificações e a prioridade às automações (as existentes ficam como Normal). A migração 21 roda sozinha, acrescenta perfil, motivo da prioridade e sinal às notificações e cria as tabelas `tal_alert_profiles` e `tal_alert_corrections`; começa vazia, então nenhuma prioridade muda até você usar os avisos. Os vigias e o resumo do dia não pedem migração: o agendamento de 15 minutos é criado sozinho, e as preferências salvas antes ganham o resumo às 07:30 e os vigias ligados. Os alertas de segurança fora da banda não pedem migração. O e-mail é opcional: ⚠️ ligar o Cloudflare Email Routing troca os registros MX do domínio (use um subdomínio se o domínio já recebe e-mail em outro lugar); depois, crie a variável `TALORYS_ALERT_EMAIL_FROM` no ambiente `production` do GitHub (ou acrescente `send_email` e `ALERT_EMAIL_FROM` ao `wrangler.jsonc`) e, se o destino não for o `OWNER_EMAIL`, o segredo `ALERT_EMAIL_TO`. Enviar só para o seu endereço verificado é gratuito em todos os planos. Veja [docs/alerts.md](docs/alerts.md#configurar-o-e-mail). A verificação contra robôs é opcional e não pede migração: crie um widget no painel da Cloudflare (Turnstile), a variável `TALORYS_TURNSTILE_SITE_KEY` no ambiente `production` do GitHub (ou `TURNSTILE_SITE_KEY` no `wrangler.jsonc`) e o segredo `TURNSTILE_SECRET_KEY` no Worker; sem os dois, o login funciona como antes. Veja [docs/deploy-github-actions.md](docs/deploy-github-actions.md#7-recomendado-verificação-contra-robôs-turnstile).

## 1.0.0 — 2026-10-29

### Adicionado

- **Verificação em duas etapas.** Em Configurações → Segurança, ative um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password, Aegis e outros) lendo um QR code: depois disso, o login pede a senha e um código de 6 dígitos. Você recebe 10 códigos de recuperação, mostrados uma única vez, para entrar se perder o celular; dá para gerar novos quando acabarem. Enquanto a verificação estiver desligada, um lembrete aparece nas telas do app (pode ser adiado por 3 dias, nunca para sempre). A confirmação de ações sensíveis também aceita um código do app no lugar da senha. Veja [docs/security.md](docs/security.md#verificação-em-duas-etapas).

- **Atividade de acesso.** Configurações → Segurança mostra cada login, tentativa que falhou, bloqueio, saída e troca de senha, com IP, país, região, cidade, provedor e navegador, um resumo das últimas 24 horas e filtro só de falhas. Os detalhes ficam 90 dias (ajustável de 30 a 180) e depois viram só contagens diárias por país, guardadas por um ano. Dá para exportar em CSV ou apagar tudo. Ver os detalhes, exportar, apagar e mudar o prazo pedem a senha, e uma enxurrada de tentativas bloqueadas não apaga o registro dos seus logins nem gasta gravações à toa. A localização vem só da Cloudflare, nunca do navegador, e senhas e e-mails digitados nunca são guardados. Veja [docs/security.md](docs/security.md#atividade-de-acesso).

- **Domínio próprio no instalador.** `npx create-talorys@latest update --domain talorys.exemplo.com` passa a usar o seu domínio para tudo (verificação, `status`, `doctor`) e fecha os endereços `*.pages.dev`. Depois de uma mudança de endereço, os aparelhos inscritos no endereço antigo saem da lista de push quando você abre as Configurações no novo, para reativar lá. No deploy pelo GitHub, a variável opcional `TALORYS_VAPID_SUBJECT` define o contato enviado aos serviços de push. Veja [docs/deployment.md](docs/deployment.md).

- **Planejamento de tarefas com IA.** Peça ao Talorys para planejar um objetivo ("Me ajude a preparar a viagem ao Japão") e ele propõe um plano num cartão do chat: tarefas com prioridade, prazos opcionais (os sugeridos aparecem marcados como sugestão) e um projeto existente ou novo, também opcional. Você pode editar títulos, descrições, prioridades e datas, remover tarefas ou trocar o projeto, e depois confirmar ou cancelar. Nada é criado antes da confirmação; confirmar cria todas as tarefas (e o projeto novo) numa única transação, uma vez só, mesmo com o botão apertado duas vezes ou em duas abas. Os planos expiram em 24 horas, sobrevivem a recarregar a página e editar ou confirmar não gasta pedidos de IA.

- **Deploy automático pelo GitHub.** Cada merge na `main` testa e publica na Cloudflare, pelo GitHub Actions, o Worker único (interface + API), atrás do ambiente protegido `production`, e confere o `/api/health` no fim. O token da Cloudflare nunca chega aos PRs nem ao job de build, e os segredos do Worker ficam fora do GitHub. Veja [docs/deploy-github-actions.md](docs/deploy-github-actions.md).

- **Servidores MCP remotos.** Conecte servidores MCP remotos (Streamable HTTP, sem autenticação, com token bearer ou com login OAuth, PKCE e registro dinâmico de cliente) em Configurações → Integrações e escolha quais ferramentas deles o Talorys pode usar no chat. As ferramentas começam desligadas; cada uma ligada pede sua aprovação a cada chamada (o padrão) ou executa sem perguntar. As chamadas dividem os limites de ferramentas do chat e enviam ao servidor só os argumentos da chamada. Os tokens ficam cifrados. Veja [docs/mcp.md](docs/mcp.md).

- **Português do Brasil, agora o idioma padrão.** Todas as telas, notificações, resumos, mensagens de push e erros da API estão traduzidos. Instalações novas começam em Português (Brasil); escolha outro idioma em Configurações → Idioma ou defina a variável `TALORYS_DEFAULT_LANGUAGE` do Worker. Com "Padrão do navegador", navegadores em qualquer variante do português também recebem pt-BR, e idiomas não suportados caem no padrão. O CI falha quando um texto novo não tem tradução.

- **Entrada por voz no chat.** Toque no microfone ao lado da caixa de mensagem, fale (até 1 minuto) e toque em ✓: o áudio é transcrito pelo Whisper (`@cf/openai/whisper-large-v3-turbo`) no Workers AI da sua conta e o texto aparece na caixa para você revisar antes de enviar. O áudio não é guardado, a transcrição usa o idioma do app e não conta no limite diário de pedidos de IA: ela tem um teto próprio de 60 minutos de áudio por dia (cerca de 2.800 neurons, por volta de 28% da cota gratuita diária). O uso aparece em Configurações → IA. O `Permissions-Policy` agora permite o microfone só para o próprio site. O README mostra o microfone no chat ([docs/screenshots/voice.png](docs/screenshots/voice.png)).

- **Ferramentas MCP nas rotinas agendadas.** Uma ferramenta configurada para executar sem perguntar também pode ser liberada para as rotinas de IA agendadas (Configurações → Integrações → *Usar também em automações agendadas*). Vem desligado, e ferramentas que pedem aprovação nunca são usadas pelas rotinas.

- **Instruções personalizadas do agente.** Em Configurações → IA, um campo de até 2.000 caracteres diz ao assistente como falar com você (tom, formato, contexto). As instruções valem no chat e nas rotinas agendadas e entram no prompt logo abaixo das regras de segurança, que sempre prevalecem: não dão novas permissões nem dispensam aprovações. Definir ou trocar o texto pede a senha digitada há pouco (limpar não pede), e um backup importado nunca altera esse campo.

### Alterado

- **README redesenhado e em português.** Cabeçalho com selos e links rápidos, sumário, funcionalidades em tabelas, diagrama da arquitetura, avisos destacados e seções longas recolhíveis. Os caminhos de menu usam os nomes da interface em pt-BR, como Configurações → IA (#4, #9).

- Os limites diários de IA agora viram à meia-noite do seu fuso horário, e não à meia-noite UTC (21h em Brasília). As ferramentas usadas numa resposta que falhou também passam a contar no uso do dia.
- A verificação de atualizações começa desligada em instalações novas. Ligue em Configurações → Sobre.
- **Node.js 26 (LTS ativo) no desenvolvimento, no CI e no deploy.** A versão fica em `.nvmrc` (`nvm use`) e todos os workflows a leem de lá. As actions `checkout`, `setup-node` e as do GitHub Pages foram atualizadas para versões que rodam no Node.js 24 do runner, já que o Node.js 20 das actions saiu de suporte.

### Corrigido

- O aviso de sessão encerrada por inatividade não é mais trocado pelo aviso genérico quando outro pedido recebe 401 durante a saída.

### Segurança

- **Segundo fator protegido.** O segredo do app autenticador fica cifrado (AES-256-GCM, chave derivada do `SESSION_SECRET`) e nunca entra no backup; os códigos de recuperação ficam só como hash e valem uma vez. Cada código do app vale uma vez, o login em duas etapas expira em 5 minutos e aceita 5 códigos errados (também com pedidos em paralelo), depois de 10 códigos errados em 15 minutos só as redes onde você já entrou podem tentar, e a senha certa continua contando como falha no limite de tentativas até o código ser confirmado. Três códigos errados seguidos, o uso de um código de recuperação e ligar ou desligar a verificação geram um aviso; ligar ou desligar também encerra as outras sessões. O `reset-password` pelo terminal desliga a verificação em duas etapas, para quem perdeu o celular e os códigos.
- **HTTPS em tudo, sem depender da configuração da zona.** No deploy pelo GitHub (Worker único), o Worker passa a rodar antes de todo arquivo da interface: uma página pedida por `http://` é movida para `https://` (301), um envio por HTTP (como um login) ou uma chamada à API com credencial é recusado em vez de redirecionado, e a interface ganha os mesmos portões da API: só responde no domínio configurado (404 no `*.workers.dev` e em qualquer outro host), passa pelo Cloudflare Access quando ele está ligado e sai sempre com HSTS e os cabeçalhos de segurança. Depois de cada deploy com domínio próprio, o workflow confere que `http://` redireciona e que o `workers.dev` e as URLs de preview estão desligados (pela API da Cloudflare e de fora). Veja [docs/deploy-github-actions.md](docs/deploy-github-actions.md).
- **Senhas fortes, sempre.** Senhas novas precisam de 15 caracteres, e palavras comuns (como "senha" ou "flamengo", também escritas com @ ou 0), sequências como 1234 ou qwerty, repetições, o seu e-mail e o nome do agente não contam para esse mínimo. A senha nova também é conferida no Have I Been Pwned por k-anonimato (só 5 caracteres de um hash saem do servidor); se a conferência não responder, a troca é recusada. Quem entrar com uma senha que não segue essas regras só consegue trocá-la antes de usar o resto do app.
- **E-mail e senha no login (opcional).** Com o segredo `OWNER_EMAIL`, a tela de login pede também o e-mail. O servidor confere os dois sempre, no mesmo tempo, e responde só "E-mail ou senha incorretos.", sem dizer qual errou.
- **Pepper na senha.** O hash da senha passa a usar um segundo segredo, `PASSWORD_PEPPER`, guardado fora do banco: um vazamento do banco não basta para testar senhas.
- **3 tentativas por rede.** O login bloqueia uma rede depois de 3 erros em 15 minutos (antes eram 5).
- **Aviso de login em dispositivo ou país novo.** Um cookie de dispositivo (`__Host-talorys_device`, 180 dias, guardado só como HMAC) reconhece os navegadores que você já usou. Um login de um navegador ou país novo gera uma notificação com texto genérico, que não revela nada na tela bloqueada. O cookie nunca autentica nem dispensa senha. Antes, o aviso era por rede nova, o que disparava a cada troca de Wi-Fi ou 4G.
- **A sessão termina sozinha.** Depois de 30 minutos sem uso, 5 minutos sem nenhuma aba aberta ou 6 horas no total, o servidor encerra a sessão. O navegador avisa 2 minutos antes, com a opção de continuar, sai de todas as abas ao mesmo tempo e o cookie some ao fechar o navegador. Os tempos podem ser ajustados em Configurações → Segurança; aumentar qualquer um deles pede a senha de novo. Antes, a sessão durava até 30 dias. Veja [docs/security.md](docs/security.md).
- **Cloudflare Access opcional, conferido dentro do Worker.** Com `TALORYS_ACCESS_TEAM_DOMAIN` e `TALORYS_ACCESS_AUD`, toda requisição precisa do token assinado pelo Access para a sua aplicação. Um endereço fora do Access (como um `*.workers.dev` esquecido) não serve de atalho. Só o health check anônimo fica aberto, para o deploy se conferir. Veja o passo 6 de [docs/deploy-github-actions.md](docs/deploy-github-actions.md).
- **A API responde só no seu endereço.** Com `TALORYS_ALLOWED_HOSTS`, preenchida pelo deploy do GitHub com o domínio próprio, qualquer outro host recebe 404.
- **Um ataque de senha vindo de muitas redes não bloqueia mais você.** Antes, 25 falhas em 15 minutos travavam o login de qualquer rede nova. Agora, cada rede desconhecida tem uma tentativa por janela (nenhuma, depois de 100 falhas, para que muitos endereços não comprem mais palpites), as suas redes recentes seguem normais, e você recebe uma notificação quando isso começa.
- HSTS por 2 anos, incluindo subdomínios (`max-age=63072000; includeSubDomains`).
- O agente não agenda mais uma rotina de IA sozinho: ele propõe a rotina num cartão de aprovação com o prompt e o horário completos, e nada roda até você aprovar. Uma instrução escondida numa nota, memória ou resultado de ferramenta não consegue criar uma rotina que roda sem você.
- Memórias e o resumo da conversa chegam à IA marcados como dados, uma memória por linha, para que um texto guardado não se passe por regra.
- Trocar a descrição de uma tarefa que já tem descrição agora pede aprovação, como reescrever uma nota. O agente conclui no máximo 3 tarefas por mensagem e para de acrescentar texto numa nota ao chegar a 50.000 caracteres.
- O agente não repete um agendamento mais de uma vez por hora, e no máximo 50 automações podem ficar ativas ao mesmo tempo.
- Notificações de uma rotina sempre trazem o nome da rotina, e os links nelas não são clicáveis.
- Nenhum link numa notificação é clicável, em qualquer formato do Markdown: link com colchetes aninhados, link por referência, endereço `//site`, e-mail e também lembretes e resumos de tarefas, que antes passavam direto. O endereço aparece como código ao lado do texto.
- Variações da tag de fim dos blocos de dados no prompt (com espaços, caracteres de largura total ou entidades HTML) também são neutralizadas, para que uma memória ou o resumo não feche o bloco e se passe por regra.
- Um backup com data no futuro ou ilegível não substitui mais suas edições locais: a data vira a hora da importação. A importação aceita arquivos de até 10 MB e tem um limite de registros por tipo.
- Os logs de erro da IA e do chat guardam só o nome e o código do erro, nunca o texto da mensagem.
- Um backup importado não consegue mais se passar pelo dono: as mensagens de usuário restauradas são mostradas ao modelo como conversa passada, não como instruções.
- Ferramentas MCP que mudaram no servidor continuam desligadas até você ligá-las de novo. Mudar só a política ("perguntar" ou "rodar sem perguntar") não conta mais como revisão.
- O Worker descarta os headers internos `x-agents-*` do Agents SDK enviados pelo navegador. Antes, um valor malformado devolvia um stack trace sem precisar de login.
- O instalador recusa um `talorys.json` que aponte para um Worker ou projeto Pages que o Talorys não criou, não repassa mais a senha do dono aos processos filhos e redige credenciais também em erros inesperados.
- O `zod` foi atualizado para 4.6.7 (GHSA-mrhx-c7xc-m3w5, consumo excessivo de memória na validação).
- O deploy de Worker único desativa as URLs de preview das versões antigas.
- Fora do ambiente de desenvolvimento, a API recusa HTTP sem criptografia, sempre usa o cookie `__Host-` com `Secure` e recusa pedidos sem o IP do cliente (`CF-Connecting-IP`), que antes caíam todos no mesmo limite de tentativas.
- Entrar encerra a sessão que o navegador já tinha, e trocar a senha encerra todas as sessões e tokens, inclusive a atual, e abre uma sessão nova neste navegador.
- Sem login, o `/api/health` responde só se está tudo certo (`ok`); versão, esquema e configuração ficam para o dono. O instalador continua conferindo a saúde do deploy.
- As respostas da API trazem CSP `default-src 'none'`, `X-Frame-Options: DENY` e HSTS.
- Inscrições de push só são aceitas com chaves do tamanho exato do padrão (65 e 16 bytes).
- Exportar ou importar um backup, ligar o acesso remoto e criar um token de acesso pedem sua senha de novo quando o login tem mais de 15 minutos. Um cookie de sessão roubado sozinho não leva seus dados nem abre uma porta dos fundos. Desligar o acesso remoto e revogar tokens nunca pedem.
- Todas as dependências agora têm versão exata em todos os `package.json`, e o `.npmrc` grava versões exatas (`save-exact`). Um teste falha se aparecer uma faixa como `^1.2.3`. O instalador publicado leva um `npm-shrinkwrap.json`, então o `npx create-talorys` instala exatamente a árvore testada, com hashes de integridade.
- O Wrangler foi para 4.153.0 e o `@cloudflare/vitest-plugin` para 1.4.8, o que corrige alertas do `undici` (bypass de validação TLS, envenenamento de cache e negação de serviço). O `vitest` foi para 4.1.12 (GHSA-qxg6-89mg-rqv8), e `body-parser`, `qs`, `fast-uri` e `ip-address` foram atualizados no lockfile. O `npm audit` não acusa mais nenhuma vulnerabilidade, e o deploy agora bloqueia alertas altos, e não só críticos.
- Os tokens de acesso remoto agora valem por 90 dias, e as Configurações mostram a data. Tokens criados antes desta versão ganham 90 dias a partir da atualização.
- Duas expressões regulares podiam travar o app por segundos: o filtro de links das notificações (um texto com muitos `[](` sem fechar levava 7 s de CPU, agora 13 ms) e os `pattern` do esquema de uma ferramenta MCP, que o Talorys compilava e rodava a cada chamada. O Talorys não roda mais as expressões regulares do servidor MCP; o próprio servidor continua validando a entrada.
- Lembretes e automações que o agente cria guardam os links do texto como texto não clicável, e o resumo de tarefas também mostra os títulos assim. Antes, um texto injetado podia criar um lembrete de hora em hora com um link de phishing clicável.
- Uma ferramenta MCP que você troca para "perguntar antes" ou tira das automações agendadas deixa de rodar sozinha na mesma hora, mesmo numa resposta ou rotina que já estava em andamento.
- Respostas de um servidor MCP têm prazo de 35 segundos. Antes, um servidor podia manter a conexão aberta indefinidamente depois de responder.
- Endereços MCP recusam também IPv6 fora do unicast global (como `::127.0.0.1` e Teredo) e nomes privados terminados em ponto (`localhost.`).
- O resultado de uma chamada MCP aprovada e as tarefas, notas e lembretes que a busca por significado traz entram na IA dentro de blocos de dados, como as memórias.
- `update_task` não conclui mais tarefas: o agente usa `complete_task`, que tem o limite de 3 por mensagem e registra a atividade.
- A importação de backup não acrescenta mais mensagens a uma conversa que você já tinha nem renomeia essa conversa; descarta datas de vencimento ilegíveis (que quebravam a tela de Tarefas e o resumo diário); corta memórias em 2.000 caracteres, como a API; e ignora servidores MCP cujo id não seja UUID. Mensagens restauradas de qualquer papel continuam marcadas como importadas também no resumo da conversa.
- A busca por significado feita com um token de acesso usa no máximo metade do limite diário de embeddings, então um script ou token vazado não desliga a busca por significado do seu chat.
- Se o Durable Object falhar ao iniciar, a API responde com o erro genérico em JSON, nunca com o stack trace do Agents SDK.

### Incompatível

- **O instalador e o projeto exigem Node.js 24 ou mais novo.** O Node.js 22 entrou em manutenção e perde o suporte em abril de 2027. Quem roda `npx create-talorys` com uma versão anterior recebe a mensagem pedindo para atualizar; instale o LTS atual em https://nodejs.org.

### Atualização

- A migração 18 cria a tabela `tal_mfa_challenges`, para o login em duas etapas. Não há segredo novo, e a verificação começa desligada: ative em Configurações → Segurança. A interface ganha a dependência `qrcode-generator` (MIT, sem dependências) para desenhar o QR code no navegador.
- A migração 17 cria as tabelas `tal_auth_events`, `tal_auth_daily` e `tal_known_devices`. Não há segredo novo. O primeiro login depois da atualização marca o navegador como conhecido, sem aviso.
- Instalações novas usam o fuso horário America/Sao_Paulo quando o instalador não consegue detectar o da máquina, e a sessão passa a durar 30 minutos sem uso e 6 horas no máximo. Quem já ajustou esses tempos em Configurações mantém os seus.
- Se a sua senha atual tiver menos de 15 caracteres ou for previsível, o próximo login leva direto à troca de senha. `npx create-talorys@latest reset-password` também grava a senha nova junto com o `PASSWORD_PEPPER`.
- A migração 14 adiciona `confirmed_at` em `tal_sessions` e `expires_at` em `tal_remote_tokens`. Sessões abertas antes dela pedem a senha na primeira ação sensível. O download do backup em Configurações agora é um botão: scripts que baixavam `GET /api/export` com o cookie precisam de um login recente.
- A migração 16 adiciona `transcription_seconds` em `tal_usage_daily`, para o teto diário da entrada por voz. Nenhum segredo novo; a transcrição usa o binding `AI` que já existe.
- A migração 13 adiciona a coluna `scheduled` em `tal_mcp_tools`; as ferramentas existentes ficam fora das rotinas agendadas.
- A migração 12 cria as tabelas `tal_mcp_servers` e `tal_mcp_tools` e a coluna `result` nas ações pendentes. `npx create-talorys@latest update` adiciona o segredo novo `MCP_CREDENTIAL_KEY`; sem ele, só dá para adicionar servidores MCP sem autenticação. Os backups levam nomes e URLs dos servidores MCP (nunca tokens), e os servidores importados chegam desligados.
- A migração 11 cria a tabela `tal_task_plan_drafts`. Os dados existentes não mudam. Rascunhos de plano não entram nos backups, e os cartões de plano de conversas importadas são descartados, como os de aprovação.

## Histórico do Talorys original (até a versão 0.1.7)

## 0.1.7 — 2026-10-19

### Added

- Personal access tokens, so external tools and other AI assistants can use your Talorys (#60)
- Notifications are delivered as Web Push (#28)
- Chat finds tasks, notes and automations by meaning, not only by exact words (#50, #53)
- Automations can be edited after they are created (#52)
- Better automation scheduling and a run history (#63)
- Memory conflicts can be decided with Clef; without Clef they go to review (#22, #41)
- Token provenance tracking and model-specific estimates of AI consumption (#30)
- A project website on GitHub Pages, linked from the README, and an Install with Appflare button (#23, #47, #48)

### Fixed

- Automation runs no longer overlap or get stuck (#65)
- Rescheduling an automation to a time that has passed is rejected (#56)
- Reminder and AI automation messages stay required when editing (#55)
- Weekly schedules are described without repeated weekdays (#54)
- Impossible dates in offset timestamps are rejected (#66)
- A task is resolved by its exact title before partial matches (#59)
- Notes searches keep the project filter (#67)
- Truncated conversation titles and reminder names no longer split an emoji (#68)
- Project names stay visible in the Projects dialog (#49)
- The layout stays steady when a text field takes focus on a phone (#38)
- Follow-ups from the release audit for push and automations (#72)

### Security

- Installer error details redact bearer tokens and quoted values (#57)
- A malformed session cookie is treated as signed out (#58)
- Request bodies stop being read as soon as they pass the size limit (#40)
- The owner can still sign in during a distributed attack; IPv6 addresses are grouped by /64 (#39)
- Notification clicks stay on the app's own origin (#36)

### Upgrading

- A `.dev.vars` created before push existed gets Web Push keys added automatically (#37)
