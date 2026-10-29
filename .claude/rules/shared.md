---
paths:
  - "packages/shared/**"
---

# Pacote compartilhado (`packages/shared`)

- É importado pelo Worker, pela Pages Function, pelo navegador e pelo
  instalador. Só código que roda nos quatro: nada de `node:*`, DOM ou bindings
  da Cloudflare.
- Nada de segredo aqui: este código vai para o bundle do navegador.
- Mudança num schema Zod muda o contrato entre web e agente: atualize os dois
  lados e os testes no mesmo PR.
- Exporte por `src/index.ts`. Constantes de produto ficam em `constants.ts`;
  não duplique valores no app.
- Testes: `npm run test:shared`.
