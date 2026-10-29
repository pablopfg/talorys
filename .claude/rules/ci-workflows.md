---
paths:
  - ".github/**"
  - "scripts/release*.mjs"
---

# GitHub Actions, rulesets e releases

- Ações fixadas por SHA completo com o comentário da versão
  (`uses: actions/checkout@<sha> # v7.0.1`). Nunca por tag solta.
- `permissions:` mínimas no topo de cada workflow; amplie só no job que
  precisa. `persist-credentials: false` no checkout.
- Nunca interpole texto controlado por terceiros (título de PR, nome de
  branch, corpo de issue) direto em `run:`; passe por `env:`.
- Nada de `pull_request_target` com checkout do código do PR.
- Segredos de deploy vivem nos ambientes `production`/`smoke`, nunca em jobs
  de pull request.
- O único check exigido pelas regras de branch é `test` (agrega os outros
  jobs). Mudou nome de job: confira `.github/rulesets/*.json`.
- Releases: veja `docs/releases.md`. Versão, tag e notas são feitas pelos
  workflows; não edite `TALORYS_VERSION` nem crie tags à mão.
- Teste o script de release com `npm run test:release`.
