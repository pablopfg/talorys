---
paths:
  - "apps/agent/src/**"
  - "apps/agent/wrangler*.jsonc"
---

# Worker do agente (`apps/agent`)

- Entrada: `src/index.ts` → `getAgentByName(env.TalorysAgent, "personal-agent")`.
  O nome da instância é fixo no servidor; nunca deixe o cliente escolher.
- API Hono em `src/api/app.ts`. A ordem dos middlewares importa:
  `securityHeaders` → `requireHttps` → webhook do Telegram → `remoteAuth` →
  `csrfProtection` → `requireSession` → rotas. Rota nova entra depois deles;
  uma rota pública exige justificativa e teste próprio.
- Rotas que mudam estado exigem o cabeçalho CSRF (`x-talorys-request`) e
  sessão. Ações sensíveis (senha, 2FA, nome do agente, chaves) exigem
  reautenticação recente (step-up).
- Bindings e variáveis estão tipados em `src/env.ts`. Variável nova: declare
  ali com comentário, documente em `docs/` e, se for segredo, só como Worker
  secret (nunca em `wrangler.jsonc`).
- Use `AppError`/`NotFoundError`/`ValidationError` de `src/api/errors.ts`.
  Nunca devolva stack trace, segredo ou detalhe interno ao cliente.
- Todo dado externo passa por Zod. Limite tamanho de corpo, de listas e de
  strings.
- Datas: armazene em ISO UTC; converta pelo fuso do dono
  (`services/time.ts`). O fuso padrão é `America/Sao_Paulo`.
- Toda chamada de modelo é contada no orçamento diário **antes** de ser feita
  e medida mesmo quando falha (ver "Abstração do provedor de IA" em
  `docs/architecture.md`). Modelos pagos (Anthropic/OpenAI) respeitam o teto
  diário em US$; nunca troque sozinho para um modelo pago.
- Testes rodam dentro do workerd (`@cloudflare/vitest-plugin`), com IA
  simulada e sem rede. Use os helpers de `test/helpers.ts` (`client`,
  `loggedIn`, `inAgent`, `freshIp`, `readSse`). Serviços externos (Google,
  Telegram, HIBP, e-mail) têm fakes; nenhum teste pode chegar à rede.
