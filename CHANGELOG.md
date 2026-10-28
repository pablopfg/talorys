# Changelog

Todas as mudanças relevantes do Talorys ficam registradas aqui, no formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e são iguais às do pacote instalador (`create-talorys`). Cada pull request descreve sua mudança em "Não lançado", nos grupos Adicionado, Alterado, Corrigido, Segurança e Atualização; a release transforma essa seção na versão nova. Veja [docs/releases.md](docs/releases.md).

## Não lançado

### Added

- **AI task planning.** Ask Talorys to plan a goal ("Help me prepare for my trip to Japan") and it proposes a structured plan as a card in chat: tasks with priorities, optional due dates (suggested dates are marked as suggestions) and an optional existing or new project. You can edit titles, descriptions, priorities and dates, remove tasks or change the project, then confirm or cancel. Nothing is created until you confirm; confirming creates every task (and the new project) in one transaction, at most once, even if the button is pressed twice or in two tabs. Plans expire after 24 hours, survive reloads, and use no extra AI requests for editing or confirming.

- **Remote MCP servers.** Connect remote MCP servers (Streamable HTTP, with no authentication, a bearer token, or OAuth sign-in with PKCE and dynamic client registration) in Settings → Integrations and choose which of their tools Talorys may use in chat. Tools start off; each enabled tool either asks for your approval on every call (the default) or runs without asking. Calls share the chat's tool limits, are never made by scheduled routines, and send only the call's arguments to the server. Tokens are stored encrypted. See [docs/mcp.md](docs/mcp.md).

- **Brazilian Portuguese, now the default language.** Every screen, notification, digest, push message and API error is translated. New installations start in Português (Brasil); pick another language in Settings → Language, or set the `TALORYS_DEFAULT_LANGUAGE` Worker variable. With "Browser default", browsers set to any Portuguese variant get it too, and unsupported browser languages fall back to the default. CI fails when new text has no translation.

### Alterado

- **README redesenhado e em português.** Cabeçalho com selos e links rápidos, sumário, funcionalidades em tabelas, diagrama da arquitetura, avisos destacados e seções longas recolhíveis. Os caminhos de menu usam os nomes da interface em pt-BR, como Configurações → IA (#4, #9).

### Segurança

- O agente não agenda mais uma rotina de IA sozinho: ele propõe a rotina num cartão de aprovação com o prompt e o horário completos, e nada roda até você aprovar. Uma instrução escondida numa nota, memória ou resultado de ferramenta não consegue criar uma rotina que roda sem você.
- Memórias e o resumo da conversa chegam à IA marcados como dados, uma memória por linha, para que um texto guardado não se passe por regra.
- Trocar a descrição de uma tarefa que já tem descrição agora pede aprovação, como reescrever uma nota. O agente conclui no máximo 3 tarefas por mensagem e para de acrescentar texto numa nota ao chegar a 50.000 caracteres.
- O agente não repete um agendamento mais de uma vez por hora, e no máximo 50 automações podem ficar ativas ao mesmo tempo.
- Notificações de uma rotina sempre trazem o nome da rotina, e os links nelas não são clicáveis.

### Upgrading

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
