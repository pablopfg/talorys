---
paths:
  - "apps/agent/src/db/**"
  - "apps/agent/src/semantic/migrations.ts"
---

# Migrations do Durable Object

O banco é o SQLite do Durable Object `TalorysAgent`. As migrations rodam sob
demanda no primeiro uso depois de cada deploy, cada uma numa transação junto
com o aumento de versão.

- **Só acréscimo.** Nunca edite, reordene, renumere ou apague uma entrada
  existente de `MIGRATIONS` (`apps/agent/src/db/migrations.ts`) ou de
  `SEMANTIC_MIGRATIONS` (`apps/agent/src/semantic/migrations.ts`, trilha
  própria em `tal_semantic_schema`). Instalações em produção já aplicaram
  essas versões.
- A próxima versão é a última + 1. Confira o número lendo o fim do array; não
  confie em memória nem em outro PR aberto. Se dois PRs criarem a mesma versão,
  quem mescla depois renumera a própria.
- Dê `name` curto e um comentário em inglês explicando o porquê de cada
  tabela/coluna, como nas entradas vizinhas.
- Tabelas novas têm o prefixo `tal_` e nunca tocam nas tabelas `cf_agents_*`
  do Agents SDK. Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
- `ALTER TABLE ... ADD COLUMN` precisa de `DEFAULT` quando `NOT NULL`, para
  as linhas existentes.
- Nunca apague dados do dono. Para aposentar algo, deixe a coluna/tabela sem
  uso; limpeza destrutiva só com decisão explícita do dono.
- Decida e documente se a tabela nova entra no backup
  (`apps/agent/src/services/backup.ts`). Credenciais e tokens nunca entram.
- Dados sensíveis (tokens OAuth, credenciais) ficam cifrados (AES-GCM, ver
  `mcp/credentials.ts` e `calendar/service.ts`).
- Acrescente teste que aplica a migration num banco já na versão anterior.
- Registre no `CHANGELOG.md`, grupo `### Atualização`, que a versão aplica a
  migration N automaticamente.
- Atualize a seção "Modelo de dados" de `docs/architecture.md`.
