# Changelog

Todas as mudanças relevantes do Talorys ficam registradas aqui, no formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e são iguais às do pacote instalador (`create-talorys`). Cada pull request descreve sua mudança em "Não lançado", nos grupos Adicionado, Alterado, Corrigido, Segurança e Atualização; a release transforma essa seção na versão nova. Veja [docs/releases.md](docs/releases.md).

## Não lançado

### Added

- **AI task planning.** Ask Talorys to plan a goal ("Help me prepare for my trip to Japan") and it proposes a structured plan as a card in chat: tasks with priorities, optional due dates (suggested dates are marked as suggestions) and an optional existing or new project. You can edit titles, descriptions, priorities and dates, remove tasks or change the project, then confirm or cancel. Nothing is created until you confirm; confirming creates every task (and the new project) in one transaction, at most once, even if the button is pressed twice or in two tabs. Plans expire after 24 hours, survive reloads, and use no extra AI requests for editing or confirming.

- **Deploy automático pelo GitHub.** Cada merge na `main` testa e publica na Cloudflare, pelo GitHub Actions, o Worker único (interface + API), atrás do ambiente protegido `production`, e confere o `/api/health` no fim. O token da Cloudflare nunca chega aos PRs nem ao job de build, e os segredos do Worker ficam fora do GitHub. Veja [docs/deploy-github-actions.md](docs/deploy-github-actions.md).

- **Remote MCP servers.** Connect remote MCP servers (Streamable HTTP, with no authentication, a bearer token, or OAuth sign-in with PKCE and dynamic client registration) in Settings → Integrations and choose which of their tools Talorys may use in chat. Tools start off; each enabled tool either asks for your approval on every call (the default) or runs without asking. Calls share the chat's tool limits, are never made by scheduled routines, and send only the call's arguments to the server. Tokens are stored encrypted. See [docs/mcp.md](docs/mcp.md).

- **Brazilian Portuguese, now the default language.** Every screen, notification, digest, push message and API error is translated. New installations start in Português (Brasil); pick another language in Settings → Language, or set the `TALORYS_DEFAULT_LANGUAGE` Worker variable. With "Browser default", browsers set to any Portuguese variant get it too, and unsupported browser languages fall back to the default. CI fails when new text has no translation.

- **Ferramentas MCP nas rotinas agendadas.** Uma ferramenta configurada para executar sem perguntar também pode ser liberada para as rotinas de IA agendadas (Configurações → Integrações → *Usar também em automações agendadas*). Vem desligado, e ferramentas que pedem aprovação nunca são usadas pelas rotinas.

### Alterado

- **README redesenhado e em português.** Cabeçalho com selos e links rápidos, sumário, funcionalidades em tabelas, diagrama da arquitetura, avisos destacados e seções longas recolhíveis. Os caminhos de menu usam os nomes da interface em pt-BR, como Configurações → IA (#4, #9).

- Os limites diários de IA agora viram à meia-noite do seu fuso horário, e não à meia-noite UTC (21h em Brasília). As ferramentas usadas numa resposta que falhou também passam a contar no uso do dia.
- A verificação de atualizações começa desligada em instalações novas. Ligue em Configurações → Sobre.

### Segurança

- **Cloudflare Access opcional, conferido dentro do Worker.** Com `TALORYS_ACCESS_TEAM_DOMAIN` e `TALORYS_ACCESS_AUD`, toda requisição precisa do token assinado pelo Access para a sua aplicação. Um endereço fora do Access (como um `*.workers.dev` esquecido) não serve de atalho. Só o health check anônimo fica aberto, para o deploy se conferir. Veja o passo 6 de [docs/deploy-github-actions.md](docs/deploy-github-actions.md).
- **A API responde só no seu endereço.** Com `TALORYS_ALLOWED_HOSTS`, preenchida pelo deploy do GitHub com o domínio próprio, qualquer outro host recebe 404.
- **Um ataque de senha vindo de muitas redes não bloqueia mais você.** Antes, 25 falhas em 15 minutos travavam o login de qualquer rede nova. Agora, cada rede desconhecida tem uma tentativa por janela, as suas redes recentes seguem normais, e você recebe uma notificação quando isso começa.
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

### Upgrading

- A migração 14 adiciona `confirmed_at` em `tal_sessions` e `expires_at` em `tal_remote_tokens`. Sessões abertas antes dela pedem a senha na primeira ação sensível. O download do backup em Configurações agora é um botão: scripts que baixavam `GET /api/export` com o cookie precisam de um login recente.
- Migration 13 adds a `scheduled` column on `tal_mcp_tools`; existing tools stay out of scheduled routines.
- Migration 12 adds the `tal_mcp_servers` and `tal_mcp_tools` tables and a `result` column on pending actions. `npx create-talorys@latest update` adds the new `MCP_CREDENTIAL_KEY` secret; without it, only MCP servers without authentication can be added. Backups include MCP server names and URLs (never tokens); imported servers arrive turned off.
- Migration 11 adds the `tal_task_plan_drafts` table. Existing data is untouched. Plan drafts are not included in backups, and plan cards in imported conversations are dropped, like approval cards.

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
