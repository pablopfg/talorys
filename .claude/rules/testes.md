---
paths:
  - "apps/*/test/**"
  - "packages/*/test/**"
  - "tests/**"
  - "playwright.config.ts"
---

# Testes

- Vitest em todos os workspaces; o agente roda dentro do workerd com IA
  simulada e bindings de teste definidos em `apps/agent/vitest.config.ts`.
- E2E com Playwright em `tests/e2e`: um worker, servidor próprio
  (`scripts/e2e-server.mjs`), navegador em inglês. Testes de celular levam a
  tag `@mobile`.
- Nenhum teste chega à rede: use os fakes existentes (`google-fixture.ts`,
  `mcp-fixture.ts`, `TelegramClient.fetcher`, HIBP desligado).
- Use `freshIp()` para não esbarrar nos limites de login entre testes.
- Nunca use `.skip`, `.only` (no commit), `retries` ou timeout maior para
  esconder uma falha. Teste instável é bug: encontre a corrida.
- Correção de bug vem com teste que falhava antes.
- Achado de segurança corrigido ganha teste com o nome do achado quando houver
  ID (ex.: `agent-injection.test.ts`).
