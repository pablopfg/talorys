# Proteção das branches

`main` e `develop` são protegidas por rulesets do GitHub guardados em JSON em
[`.github/rulesets/`](../.github/rulesets). Os arquivos são a fonte da verdade;
o GitHub não os lê sozinho, então eles precisam ser aplicados uma vez (e de novo
depois de cada mudança).

## Fluxo de trabalho

- O trabalho acontece em branches de funcionalidade que abrem pull requests
  para a `develop`.
- As releases são pull requests da `develop` para a `main`. Correções urgentes
  podem vir de uma branch `hotfix/*`.
- Depois que um `hotfix/*` entra na `main`, abra um pull request da `main` para
  a `develop`, para que a `develop` também receba a correção.

## Regras

| Regra | `main` | `develop` |
| --- | --- | --- |
| Não pode ser excluída | sim | sim |
| Sem force push | sim | sim |
| Mudanças só por pull request | sim | sim |
| As conversas da revisão precisam estar resolvidas | sim | sim |
| O job `test` do CI precisa passar | sim | sim |
| A origem precisa ser `develop` ou `hotfix/*` (verificação `source-branch`) | sim | não |

Nenhuma revisão aprovando é exigida, porque um único mantenedor não consegue
aprovar o próprio pull request. Os administradores do repositório podem ignorar
as regras, mas só ao fazer merge de um pull request, nunca com push direto.

Nenhuma das branches precisa estar atualizada com a base antes do merge. Trazer
a `main` para a `develop` a partir de um pull request de release (o botão
**Update branch**) seria um push direto na `develop`, que as regras dela
bloqueiam; então, na `main`, essa exigência deixaria travadas todas as releases
depois da primeira.

O [`.github/CODEOWNERS`](../.github/CODEOWNERS) pede uma revisão do dono em
todo pull request.

## Aplicar os rulesets

Com a [GitHub CLI](https://cli.github.com/) autenticada como administrador do
repositório:

```bash
scripts/apply-rulesets.sh            # repositório atual
scripts/apply-rulesets.sh dono/repo  # outro repositório
```

O script cria cada ruleset, ou atualiza o que tem o mesmo nome.

Sem a CLI: **Settings → Rules → Rulesets → New ruleset → Import a ruleset**, e
escolha cada arquivo JSON.

Rulesets em repositórios privados exigem um plano pago do GitHub; em
repositórios públicos são gratuitos.

## CI

O workflow de CI roda uma vez para cada commit enviado a um pull request, e não
de novo quando o pull request recebe o merge: pelas regras acima, `main` e
`develop` só mudam por pull request, então uma execução depois do merge
repetiria testes em código já testado. Cada execução testa o pull request
mesclado na base como ela estava quando o commit foi enviado. Um commit novo
cancela a execução que ainda estiver rodando para o mesmo pull request.

Lint, typecheck, build e o teste do pacote rodam num job; os testes unitários (a
suíte do agente dividida em três) e os testes no navegador rodam em jobs
paralelos. O job `test` só passa quando todos eles passam, e é a única
verificação que as regras exigem.

## Um pull request espera para sempre pelo `test`

A verificação obrigatória `test` só existe depois que o workflow de CI rodou no
último commit do pull request. Um pull request aberto enquanto o Actions estava
desligado, ou antes de o workflow existir na branch dele, nunca recebe essa
execução. Inicie uma em **Actions → CI → Run workflow** na branch do pull
request, ou traga a `develop` para a branch (o botão **Update branch**) para que
um commit novo dispare o CI.
