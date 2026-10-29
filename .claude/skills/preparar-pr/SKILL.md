---
name: preparar-pr
description: Prepara o pull request do Axis para a develop - título em Conventional Commits, entrada no CHANGELOG, descrição em pt-BR pelo modelo do repositório. Use quando o trabalho estiver pronto para PR.
disable-model-invocation: true
---

# Preparar o PR

1. Confirme que a branch parte da `develop` atualizada
   (`git fetch origin develop && git merge-base --is-ancestor origin/develop HEAD`).
   Se não, traga a `develop` e resolva conflitos preservando os dois lados.
2. Rode a skill `verificar` (suíte completa) e a `auditoria-seguranca`.
3. **Título:** `<tipo>(escopo opcional): descrição em pt-BR`, minúscula
   depois dos dois-pontos, sem ponto final. Tipos: `feat`, `fix`, `perf`,
   `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `style`,
   `security`, `i18n`. `!` depois do tipo marca mudança incompatível. Confira
   com `node scripts/release.mjs check-title "<título>"`.
4. **Changelog:** mudança visível ao usuário → entrada em `## Não lançado` do
   `CHANGELOG.md`, no grupo certo, terminando com `(#N)` depois que o PR
   existir. Migration ou segredo novo → também em `### Atualização`. Pode sair
   do plano gratuito → ⚠️. Mudança só interna → rótulo `sem-changelog`.
5. **Descrição:** siga `.github/pull_request_template.md` ("O que muda",
   "Como foi testado", "Checklist"), em pt-BR, dizendo o porquê, o que foi
   testado e o resultado da auditoria.
6. **Commits:** mensagens em pt-BR, com o mesmo prefixo Conventional Commits.
7. Abra o PR **para a `develop`**, nunca para a `main`.
