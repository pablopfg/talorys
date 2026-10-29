---
name: verificar
description: Roda typecheck, lint e os testes certos para as mudanças atuais do Talorys e resume as falhas. Use antes de dizer que uma tarefa está pronta e antes de abrir PR.
---

# Verificar as mudanças

1. Veja o que mudou: `git status --short` e `git diff --stat origin/develop...HEAD`.
2. Rode `npm run typecheck` e `npm run lint`. Se falhar, corrija antes de
   seguir.
3. Rode os testes da área tocada:

   | Mudou | Rode |
   | --- | --- |
   | `apps/agent/**` | `npm test -w @talorys/agent` (um arquivo: `-- test/<nome>.test.ts`) |
   | `apps/web/**` | `npm test -w @talorys/web` |
   | `packages/shared/**` | `npm run test:shared`, `npm test -w @talorys/web` e `npm test -w @talorys/agent` |
   | `packages/create-talorys/**` | `npm test -w create-talorys` e `npm run test:pack` |
   | `scripts/deploy/**` | `npm run test:deploy` |
   | `scripts/release*` | `npm run test:release` |
   | Interface, rotas ou sessão | `npm run test:e2e` |

4. Antes de abrir PR, rode a suíte completa: `npm test` e `npm run test:e2e`.
5. Relate o resultado com os comandos que rodaram e o que falhou. Nunca diga
   que passou sem ter rodado nesta sessão; se algo não pôde rodar (por
   exemplo, falta o navegador do Playwright), diga isso.

Se `node_modules` não existir, rode `npm ci` antes.
