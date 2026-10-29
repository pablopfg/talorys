---
paths:
  - "apps/agent/wrangler*.jsonc"
  - "apps/web/wrangler.jsonc"
  - "apps/web/functions/**"
  - "apps/agent/src/workflows/**"
  - "apps/agent/src/semantic/**"
  - "apps/agent/src/index.ts"
---

# Cloudflare

- **Plano gratuito.** Hoje o projeto usa: Workers, Durable Objects (SQLite),
  Pages + Pages Function, Workers AI, Workflows (só para o menu Workflows),
  Email Routing (binding `send_email`, avisos por e-mail), Turnstile e,
  recomendado na instalação, Cloudflare Access. KV, D1, R2, Vectorize,
  Queues, Hyperdrive, Browser Rendering, Workers Paid e afins **não** estão em
  uso. Qualquer um deles exige
  aprovação explícita do dono antes de implementar e ⚠️ no PR e no changelog.
- Antes de usar ou revisar uma API da Cloudflare, consulte a skill do plugin
  `cloudflare` (`workers-best-practices`, `durable-objects`, `agents-sdk`,
  `wrangler`) ou a documentação oficial. Não confie na memória: as APIs
  mudam.
- Respeite `compatibility_date` e as flags já configuradas; não suba a data
  sem motivo e sem rodar a suíte inteira.
- Um único Durable Object (`personal-agent`) guarda tudo. Não crie outra
  instância nem outro namespace sem decisão do dono.
- Segredos só como Worker secrets (`wrangler secret put`), nunca em `vars`.
- A Pages Function só repassa `/api/*` ao Worker pelo service binding,
  preservando a requisição original. Não acrescente lógica de negócio nela.
- Workers AI: modelo padrão em `DEFAULT_MODEL` (`packages/shared`). Raciocínio
  desligado para economizar Neurons. Toda chamada é contada antes e medida.
