# Armadilhas conhecidas

Erros que agentes já cometeram ou que são fáceis de cometer neste
repositório. Leia antes de mudar algo na área.

## Ambiente e ferramentas

- O **formatador do Biome está desligado** (`biome.json`). Não rode Prettier
  nem `biome format` no repositório inteiro: reformatar arquivos gera diffs
  enormes. Só `npm run lint`.
- `.npmrc` tem `legacy-peer-deps=true` e `save-exact=true`. Instale
  dependência com versão exata e confira o `package-lock.json`.
- `allowScripts` em `package.json` desliga scripts de instalação de `esbuild`,
  `workerd` e `core-js-pure`. Não "conserte" isso.
- Os testes do agente rodam dentro do workerd e são lentos: durante o
  trabalho, rode só o arquivo relevante
  (`npm test -w @talorys/agent -- test/<nome>.test.ts`); a suíte inteira no
  fim.
- Os testes do instalador exigem **Node.js 24+** (`checkNodeVersion`). Num
  ambiente com Node 22 eles falham todos com "Node.js 24.0 or newer is
  required": não é bug do código, troque de Node (`nvm use`).
- `npm run test:e2e` precisa do Chromium do Playwright. No CI ele é instalado
  com `npx playwright install --with-deps chromium`.

## Idiomas

- O app abre em **pt-BR**, mas os testes do agente e o e2e rodam em **inglês**
  (`TALORYS_DEFAULT_LANGUAGE=en`, `talorys.language=en` no Playwright). Um teste
  que procura texto em português está errado; um texto novo sem tradução
  quebra a cobertura de i18n.
- Texto do servidor é gravado em inglês e traduzido na exibição. Não grave
  texto já traduzido no banco.

## Banco e migrations

- PRs em paralelo podem criar a **mesma versão de migration**. Ao trazer a
  `develop`, confira se a sua versão ainda é a última + 1 e renumere a sua
  (nunca a que já foi mesclada).
- Tabelas de busca semântica têm trilha própria (`SEMANTIC_MIGRATIONS`) e só
  existem depois que o recurso é ligado.

## Documentação desatualizada ou herdada

- `docs/architecture.md` ("Escolhas para o plano gratuito") ainda diz "sem
  Workflows"; hoje o menu Workflows usa Cloudflare Workflows. Confie no
  código (`apps/agent/wrangler.jsonc`, `src/env.ts`).
- `GITHUB_URL` em `packages/shared/src/constants.ts` e a verificação de
  atualizações apontam para o projeto original. Não mude sem decisão do
  dono.
- O projeto é um fork: grupos do changelog em inglês (`Added`, `Fixed`…) vêm
  do original e ainda são aceitos, mas entradas novas usam os grupos em
  pt-BR.

## Git e PRs

- O título do PR vira a mensagem do squash: precisa passar em
  `node scripts/release.mjs check-title`.
- O check de changelog compara com a base: a entrada tem de estar em
  `## Não lançado`, não numa versão já lançada.
- Nunca abra PR para a `main` a partir de uma branch de trabalho.
