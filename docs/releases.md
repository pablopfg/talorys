# Versões, changelog e releases

O Talorys usa [SemVer](https://semver.org/lang/pt-BR/). A versão é a do pacote
instalador (`packages/create-talorys/package.json`), repetida em
`TALORYS_VERSION` (`packages/shared/src/constants.ts`). O
[CHANGELOG.md](../CHANGELOG.md) segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e cada GitHub
Release usa a seção da sua versão como notas.

Tudo é feito por [`scripts/release.mjs`](../scripts/release.mjs), que só usa
recursos do Node.js (sem dependências), e por três workflows.

## Fluxo

```text
feature/* ──PR──▶ develop ──(Prepare release)──▶ release/vX.Y.Z ──PR──▶ develop ──PR──▶ main ──▶ tag vX.Y.Z + GitHub Release
```

1. **Cada pull request para a `develop`** descreve a mudança em
   `## Não lançado`, no grupo certo:

   | Grupo | Quando usar | Versão |
   | --- | --- | --- |
   | `### Incompatível` | Quebra algo para quem já usa (exige ação manual, remove recurso) | major |
   | `### Adicionado` | Recurso novo | minor |
   | `### Alterado` | Mudança de comportamento compatível | minor |
   | `### Removido` | Recurso retirado | minor |
   | `### Corrigido` | Correção de bug | patch |
   | `### Segurança` | Correção de vulnerabilidade (cite o ID do achado, ex.: AGT-01) | patch |
   | `### Atualização` | O que fazer ao atualizar: migrações, segredos novos | patch |

   Cite o PR (`(#12)`) e marque com ⚠️ o que pode sair do plano gratuito da
   Cloudflare. Os grupos em inglês herdados do Talorys original (`Added`,
   `Fixed`, `Security`, `Upgrading`…) também são aceitos.

2. **Preparar a release:** em **Actions → Prepare release → Run workflow**,
   na branch `develop`, escolha `auto` (ou `patch`, `minor`, `major`) ou
   digite a versão exata. O workflow:
   - roda os testes do script de release;
   - transforma `Não lançado` em `## X.Y.Z — AAAA-MM-DD`, abre uma
     `Não lançado` vazia e remove grupos sem entradas;
   - atualiza a versão no instalador, em `TALORYS_VERSION` e no
     `package-lock.json`;
   - envia a branch `release/vX.Y.Z`, abre o PR para a `develop` com as notas
     da versão e inicia a CI nele.

   Para a **primeira versão do fork**, digite `1.0.0` em *version*.

3. **Revise e mescle** o PR da release na `develop`, e depois a `develop` na
   `main` (o único caminho permitido pelas regras das branches).

4. **Publicação automática:** o workflow **Release** roda a cada push na
   `main`. Se a versão do instalador ainda não tem tag, ele cria a tag
   `vX.Y.Z` no commit da `main` e o GitHub Release com a seção do
   changelog. Versões com sufixo (`1.1.0-rc.1`) saem como *pre-release*.
   Rodar de novo não duplica nada.

### Sem GitHub Actions

```bash
npm run release:prepare -- auto          # ou patch, minor, major, 1.0.0
git switch -c release/vX.Y.Z && git commit -am "chore(release): vX.Y.Z"
```

Depois, abra o PR para a `develop` como qualquer outro.

## Checagens em todo pull request

O workflow **PR checks** roda em segundos, sem `npm ci`:

| Job | O que confere |
| --- | --- |
| `pr-title` | O título segue o [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/): `feat(chat): …`, `fix: …`, `docs: …`, `ci: …`, `chore(release): …`. Um `!` (`feat!: …`) indica mudança incompatível. No *squash merge*, o título vira a mensagem do commit. |
| `changelog` | Só em PRs para a `develop`: a seção `Não lançado` mudou e tem entradas. Pule com o rótulo **`sem-changelog`** quando a mudança não afeta quem usa o Talorys (testes, CI, documentação interna). PRs do Dependabot são pulados. |
| `release-script` | Os testes de `scripts/release.mjs`. |

Para torná-las obrigatórias, acrescente `pr-title` e `changelog` em
`required_status_checks` nos arquivos de [`.github/rulesets/`](../.github/rulesets)
e aplique as regras de novo (veja [branch-protection.md](branch-protection.md)).

## Segurança dos workflows

O repositório é público, então os workflows seguem estas regras:

- **Permissões mínimas:** `permissions: {}` no topo e, em cada job, só o que
  ele usa. Só *Prepare release* (`contents`, `pull-requests` e `actions` de
  escrita) e *Release* (`contents: write`) escrevem algo, e os dois só rodam
  na `develop` e na `main`, respectivamente, nunca em código de um PR.
- **Nenhum segredo:** apenas o `GITHUB_TOKEN` temporário de cada execução.
  Nenhum token pessoal, nem da Cloudflare ou do npm.
- **Actions fixadas por SHA** do commit, com a versão em comentário. O
  [Dependabot](../.github/dependabot.yml) abre um PR semanal para a `develop`
  com as atualizações.
- **`persist-credentials: false`** em todo checkout: o token não fica salvo
  no `.git` para os passos seguintes.
- **Sem injeção de comandos:** textos vindos do PR (como o título) chegam aos
  scripts por variável de ambiente, nunca interpolados no shell.
- **`pull_request`, nunca `pull_request_target`:** PRs de forks rodam sem
  acesso de escrita e sem segredos.
- **Tags protegidas:** [`.github/rulesets/tags.json`](../.github/rulesets/tags.json)
  impede criar, mover ou apagar tags `v*`, exceto pelo GitHub Actions e por
  administradores. É aplicado junto com as outras regras.

## Configuração única no GitHub

1. **Settings → Actions → General → Workflow permissions:** deixe *Read
   repository contents* como padrão (os workflows pedem o resto) e marque
   **Allow GitHub Actions to create and approve pull requests**, para o
   *Prepare release* abrir o PR. Sem essa opção, a branch é enviada e o log
   mostra o link para você abrir o PR à mão.
2. **Crie o rótulo** `sem-changelog` em **Issues → Labels**, se ele ainda
   não existir.
3. **Aplique as regras** de `.github/rulesets/`, incluindo a das tags.
4. Em **Settings → General → Pull Requests**, deixe o *Squash merging* com a
   mensagem padrão **Pull request title**, e use **Squash and merge** nos PRs
   de funcionalidade: o título em Conventional Commits vira o commit. Para
   `develop → main`, use **Create a merge commit**, que preserva o histórico.

## Por que não release-please ou changesets

As duas ferramentas geram o changelog sozinhas, a partir dos commits ou de
arquivos separados. Aqui o changelog é escrito à mão, em português, com os
grupos que o projeto já usa (incluindo `Atualização`, com instruções de
migração), e a versão sai do próprio changelog. Um script pequeno, testado e
sem dependências faz exatamente isso, sem adicionar uma action de terceiros
com permissão de escrita.
