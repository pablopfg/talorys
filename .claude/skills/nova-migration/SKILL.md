---
name: nova-migration
description: Passo a passo para acrescentar uma migration ao SQLite do Durable Object do Axis sem quebrar instalações existentes. Use sempre que precisar de tabela, coluna ou índice novo.
---

# Nova migration

Leia `.claude/rules/migrations.md` primeiro.

1. Abra `apps/agent/src/db/migrations.ts` e leia a **última** entrada de
   `MIGRATIONS`. A sua versão é a última + 1. (Para a busca semântica, a trilha
   é `SEMANTIC_MIGRATIONS` em `apps/agent/src/semantic/migrations.ts`.)
2. Acrescente a entrada no fim do array:

   ```ts
   {
     version: N,
     name: "short name",
     statements: [
       // Why this table/column exists, in English.
       `CREATE TABLE IF NOT EXISTS tal_exemplo (...)`,
     ],
   },
   ```

   Use `after(db)` só para mover dados que SQL puro não consegue.
3. Nunca altere entradas anteriores. Colunas `NOT NULL` novas levam
   `DEFAULT`.
4. Atualize o repositório em `apps/agent/src/db/repositories/` (ou o serviço
   da área) e os tipos em `packages/shared` se o dado chegar à API.
5. Decida se o dado entra no backup (`services/backup.ts`); segredos nunca.
6. Testes: aplicar a migration a partir da versão anterior, ler e gravar pelo
   repositório, e, se entrar no backup, exportar e importar.
7. Docs e changelog: "Modelo de dados" em `docs/architecture.md` e uma linha
   em `### Atualização` ("aplica a migration N automaticamente").
8. Rode `npm test -w @talorys/agent`.
