# Changelog

Todas as mudanças relevantes do Talorys ficam registradas aqui, no formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e são iguais às do pacote instalador (`create-talorys`). Cada pull request descreve sua mudança em "Não lançado", nos grupos Adicionado, Alterado, Corrigido, Segurança e Atualização; a release transforma essa seção na versão nova. Veja [docs/releases.md](docs/releases.md).

## Não lançado

### Adicionado

- **Central de avisos.** Todo aviso do Talorys (lembretes, resumos, rotinas, alertas de sistema e de segurança) agora tem prioridade (baixa, normal, alta ou crítica) e categoria, e passa por uma central que decide por onde ele sai do app. Em **Configurações → Avisos** (aba nova, que também passa a abrigar as notificações push) você escolhe quais categorias vão para o push, limita quantas mensagens cada canal manda por hora e por dia (padrão 6 e 30) e vê as 100 entregas mais recentes, com o motivo de cada aviso que não saiu. Avisos de prioridade baixa ficam só no app; lembretes, alertas de segurança e avisos críticos nunca são segurados pelos limites; segurança e críticos saem sempre por todos os canais (não dá para desligar); e repetições do mesmo aviso são descartadas. A prioridade de cada notificação pode ser corrigida na própria central. Veja [docs/alerts.md](docs/alerts.md).

- **Avisos no Telegram.** Um bot do Telegram, vinculado em **Configurações → Avisos → Telegram** com um código de uso único, passa a ser um canal da central de avisos. Os avisos vão para o seu grupo (um tópico por categoria quando o grupo tem tópicos e o bot é administrador) ou para o chat privado com o bot. Por padrão o Telegram é discreto (título, categoria e prioridade, sem o texto); ligue **Texto completo** nas categorias que quiser ler lá. Avisos de prioridade baixa e normal chegam sem som. Avisos de prioridade alta e crítica trazem os botões **Feito** e **Adiar 1 h**, e todos trazem **Abrir o Talorys**. O bot só obedece à conta que vinculou o chat. Veja [docs/alerts.md](docs/alerts.md#telegram).

- **Conversa pelo Telegram.** O chat privado com o bot agora conversa com o Talorys, com as mesmas memórias, ferramentas e limites do chat do app, numa conversa que também aparece no app (`/new` começa outra). Ações que pedem aprovação e planos de tarefas continuam sendo confirmados só no app: a resposta traz o botão **Abrir no Talorys**. A conversa liga e desliga em Configurações → Avisos → Telegram (ligar de novo pede a senha). Veja [docs/alerts.md](docs/alerts.md#conversar-pelo-chat-privado).

- **Mensagens de voz no Telegram.** Com a conversa pelo Telegram ligada, grave um áudio (ou envie um arquivo de áudio) de até 5 minutos no chat privado com o bot: o Talorys transcreve com o mesmo Whisper da entrada por voz do app, mostra o texto que entendeu e responde como se você tivesse escrito. Usa o mesmo teto diário de 60 minutos de áudio do app, e o áudio não é guardado. Veja [docs/alerts.md](docs/alerts.md#mensagens-de-voz).

- **Lembretes insistentes.** Avisos de prioridade Alta ou Crítica que você não confirmou saem de novo depois de 15 minutos e, pelo push e pelo chat privado do bot, depois de 1 hora; sem confirmação, ficam marcados como "Não confirmado". Feito, Adiar 1 h, Silenciar este aviso (Telegram, push ou central), abrir o aviso no app ou responder no chat do bot encerram a insistência. As automações ganham **Prioridade do aviso** (Baixa, Normal ou Alta); um lembrete Alta é um lembrete insistente, e o agente cria um quando você pede "até eu confirmar". As notificações push de avisos insistentes trazem os botões Feito, Adiar e Silenciar. Alertas de segurança também insistem e só param pelo Telegram (botão ou mensagem no chat do bot): nada feito dentro do app os cala. Veja [docs/alerts.md](docs/alerts.md#insistência).

- **Prioridade que aprende.** O Talorys ajusta sozinho a prioridade de cada tipo de aviso (cada rotina, resumo ou lembrete recorrente, os lembretes avulsos, cada tipo de aviso do sistema) pelo que você faz com ele: correções, rapidez para ler ou tocar em Feito, adiamentos, silenciamentos, avisos deixados sem ler por 24 horas e tarefas concluídas logo depois do aviso, sem gastar IA. Muda no máximo um nível por semana e no máximo dois níveis no total. Regras fixas: segurança é sempre Crítica, eventos externos nunca passam de Alta, lembretes nunca caem para Baixa e um aviso que pediu Alta ou Crítica sai como pediu. Todo aviso diz por que tem aquela prioridade e pode ser corrigido na central (**Corrigir**) ou no Telegram (**Corrigir prioridade**). Em **Configurações → Avisos → O que o Talorys aprendeu** você vê cada tipo, fixa numa prioridade ou zera. No chat, o agente escolhe a prioridade dos lembretes guiado pelas suas últimas 20 correções. Veja [docs/alerts.md](docs/alerts.md#prioridade-que-aprende).

### Alterado

- Alertas de segurança não podem mais ter a prioridade baixada: são sempre críticos (antes dava para mudar o selo na central, embora continuassem insistindo).

- O histórico de entregas fala em "aparelho ou chat" nos motivos de não envio, porque vale também para o Telegram.

- Alertas de segurança (login novo, verificação em duas etapas, muitas tentativas de login, código de recuperação usado) passam a ser avisos críticos, e o aviso de rotina de IA pulada por falta de orçamento sai no máximo uma vez por rotina por dia.

### Atualização

- A migração 19 do banco roda sozinha na primeira requisição depois do deploy: acrescenta prioridade, categoria e chave de repetição às notificações (as antigas ficam como Normal / Sistema) e cria a tabela `tal_alert_deliveries`. Para os avisos no Telegram, um segredo novo e opcional, `TELEGRAM_BOT_TOKEN` (token do bot criado no @BotFather); sem ele o canal aparece como não configurado e nada mais muda. Quem usa o Cloudflare Access precisa de uma regra *Bypass* para o caminho `api/telegram/webhook` (veja [docs/alerts.md](docs/alerts.md#configurar-o-telegram)). Preferências de avisos salvas antes do Telegram ganham o Telegram ligado nas categorias que já saíam do app. A conversa pelo chat do Telegram é ligada ao conectar o bot; um vínculo feito antes dela fica com a conversa desligada até você ligar em Configurações → Avisos → Telegram. A migração 20 roda sozinha e acrescenta o estado da insistência às notificações e a prioridade às automações (as existentes ficam como Normal). A migração 21 roda sozinha, acrescenta perfil, motivo da prioridade e sinal às notificações e cria as tabelas `tal_alert_profiles` e `tal_alert_corrections`; começa vazia, então nenhuma prioridade muda até você usar os avisos.

## 1.0.0 — 2026-10-29

### Adicionado

- **Verificação em duas etapas.** Em Configurações → Segurança, ative um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password, Aegis e outros) lendo um QR code: depois disso, o login pede a senha e um código de 6 dígitos. Você recebe 10 códigos de recuperação, mostrados uma única vez, para entrar se perder o celular; dá para gerar novos quando acabarem. Enquanto a verificação estiver desligada, um lembrete aparece nas telas do app (pode ser adiado por 3 dias, nunca para sempre). A confirmação de ações sensíveis também aceita um código do app no lugar da senha. Veja [docs/security.md](docs/security.md#two-step-sign-in).

- **Atividade de acesso.** Configurações → Segurança mostra cada login, tentativa que falhou, bloqueio, saída e troca de senha, com IP, país, região, cidade, provedor e navegador, um resumo das últimas 24 horas e filtro só de falhas. Os detalhes ficam 90 dias (ajustável de 30 a 180) e depois viram só contagens diárias por país, guardadas por um ano. Dá para exportar em CSV ou apagar tudo. Ver os detalhes, exportar, apagar e mudar o prazo pedem a senha, e uma enxurrada de tentativas bloqueadas não apaga o registro dos seus logins nem gasta gravações à toa. A localização vem só da Cloudflare, nunca do navegador, e senhas e e-mails digitados nunca são guardados. Veja [docs/security.md](docs/security.md#sign-in-activity).

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
