---
name: auditoria-seguranca
description: Auditoria de segurança independente obrigatória ao terminar qualquer ajuste no Talorys - revisa o diff, aplica correções e testa tudo de novo. Use depois de implementar e antes de abrir ou mesclar o PR.
---

# Auditoria de segurança ao fim de cada ajuste

Regra do projeto: nenhum ajuste está pronto antes desta auditoria.

1. **Contexto.** Leia as seções de `docs/security.md` ligadas ao que mudou e
   `git diff origin/develop...HEAD`.
2. **Revisão independente.** Peça ao subagente `auditor-seguranca` que audite
   o diff. Ele não conhece a sua implementação: passe só o escopo (branch e
   áreas), não as suas conclusões.
3. **Cloudflare.** Se a mudança tocar Workers, Durable Objects, Workflows,
   Workers AI, wrangler ou a Pages Function, peça também ao
   `revisor-cloudflare`. Use as skills do plugin `cloudflare`
   (`workers-best-practices`, `durable-objects`, `agents-sdk`) para conferir
   padrões e limites.
4. **Varredura rápida** (você mesmo):
   - `git diff origin/develop...HEAD | grep -nEi "(api[_-]?key|secret|token|password|senha|bearer)\s*[:=]"` → nenhum valor real.
   - Nada de domínio próprio, e-mail ou ID real em arquivos versionados.
   - `npm audit --omit=dev` → avalie vulnerabilidades altas/críticas novas.
5. **Corrija** cada achado confirmado, com teste que falhava antes.
6. **Teste tudo:** `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run test:e2e` (use a skill `verificar`).
7. **Registre** no PR, na seção "Como foi testado": o que foi auditado, os
   achados e as correções (ou "nenhum achado", com o que foi coberto).
   Correção de vulnerabilidade entra no changelog em `### Segurança`.
