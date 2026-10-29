---
paths:
  - "packages/create-talorys/**"
  - "scripts/deploy/**"
---

# Instalador e deploy

- O instalador roda na máquina do dono com Node.js 24+. Precisa ser
  **idempotente**: rodar de novo detecta o que já existe e nunca exclui dados.
- Segredos gerados (hash de senha, `SESSION_SECRET`, VAPID, `MCP_CREDENTIAL_KEY`)
  vão como Worker secrets; nunca para arquivos versionados nem para logs.
- `templates/` é gerado no build e ignorado pelo Git.
- Mudou o instalador: rode `npm test -w create-talorys` e `npm run test:pack`.
- `scripts/deploy/render-wrangler-config.mjs` monta a configuração do deploy
  pelo GitHub Actions a partir de variáveis do ambiente `production`. O
  domínio próprio do dono só existe nessas variáveis; nunca o escreva no
  repositório. Teste com `npm run test:deploy`.
