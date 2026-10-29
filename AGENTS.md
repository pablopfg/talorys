# Guia para agentes de código

Este arquivo é a fonte única de instruções para agentes de IA (Claude Code,
Codex, Cursor, Copilot e outros) que trabalham neste repositório. O
[CLAUDE.md](CLAUDE.md) importa este arquivo. Leia tudo antes da primeira
mudança; as regras por área ficam em [`.claude/rules/`](.claude/rules/).

> **Nome do produto.** O código ainda se chama Talorys (pacotes `@talorys/*`,
> tabelas `tal_`, variáveis `TALORYS_*`, cookies `talorys_*`). Um rebrand para
> **Axis** está planejado e acontece em PRs próprios. Não renomeie
> identificadores, tabelas, variáveis de ambiente, cookies nem chaves de
> armazenamento por conta própria: isso quebra instalações existentes e exige
> migração e compatibilidade.

## O que é o projeto

Assistente pessoal de IA **de um único usuário e auto-hospedado**, que roda na
conta Cloudflare do dono e precisa caber no **plano gratuito**. Monorepo npm
com workspaces:

| Pasta | O que é | Roda em |
| --- | --- | --- |
| `apps/agent` | Worker do agente: API Hono + Durable Object `TalorysAgent` (Agents SDK) com SQLite | Workers + Durable Objects |
| `apps/web` | Interface React 19 + Vite + Tailwind + TanStack Query + React Router | Pages (estático) |
| `apps/web/functions` | Proxy `/api/*` para o Worker por service binding | Pages Function |
| `packages/shared` | Schemas Zod, constantes, recorrência, criptografia, catálogo de textos do servidor | Empacotado em todos |
| `packages/create-talorys` | Instalador de linha de comando | Máquina do dono (Node.js) |
| `tests/e2e` | Testes de interface com Playwright | Local/CI |
| `scripts/` | Dev, release, deploy, screenshots | Local/CI |

Documentação de referência (pt-BR): [docs/architecture.md](docs/architecture.md),
[docs/security.md](docs/security.md), [docs/development.md](docs/development.md),
[docs/releases.md](docs/releases.md), [docs/branch-protection.md](docs/branch-protection.md).
Decisões já tomadas pelo dono do projeto ficam em
[.claude/memoria/decisoes.md](.claude/memoria/decisoes.md); erros comuns de
agentes, em [.claude/memoria/armadilhas.md](.claude/memoria/armadilhas.md).

## Comandos

Node.js 26 (`.nvmrc`); o mínimo aceito é 24. Instale com `npm ci`.

| Comando | Para quê |
| --- | --- |
| `npm run dev` | Agente (8787) + Pages Function (8788) + Vite (5173), IA simulada |
| `npm run typecheck` | TypeScript em todos os workspaces |
| `npm run lint` | Biome (só lint; o formatador está desligado) |
| `npm test` | shared + agente (dentro do workerd) + web + instalador |
| `npm test -w @talorys/agent -- test/<arquivo>.test.ts` | Um arquivo de teste do agente |
| `npm run test:e2e` | Playwright (sobe o próprio servidor) |
| `npm run test:pack` | Empacota e roda o instalador fora do monorepo |
| `npm run build` | Build da web, bundle do Worker e do instalador |

Antes de declarar qualquer tarefa pronta: `npm run typecheck`, `npm run lint`
e os testes da área tocada. Antes de abrir PR: a suíte completa
(`npm test` e `npm run test:e2e`). Nunca diga que algo passou sem ter rodado.

## Regras invioláveis

1. **Plano gratuito.** Nenhum serviço pago da Cloudflare ligado
   automaticamente e nenhuma troca automática para modelo pago. Um recurso novo
   da Cloudflare (KV, D1, R2, Vectorize, Queues, Workers Paid, etc.) só entra
   com aprovação explícita do dono, e tudo que pode sair do plano gratuito é
   marcado com ⚠️ no PR e no changelog.
2. **Segredos.** Tokens, chaves e bindings de IA/armazenamento nunca chegam ao
   código do navegador nem ao repositório. Segredos são Worker secrets; nada de
   domínio próprio, e-mail, IDs do Telegram ou dados pessoais em arquivos
   versionados (o repositório é **público**). Use `exemplo.com.br` em exemplos.
3. **Ferramentas do agente.** Sem shell, execução de código, HTTP arbitrário,
   credenciais ou deploy. Toda ferramenta nova tem schema Zod, permissão
   (`read` | `write` | `destructive`), limite por turno e aprovação do dono
   para ações destrutivas. Veja [.claude/rules/ferramentas.md](.claude/rules/ferramentas.md).
4. **Migrations só de acréscimo.** Nunca edite nem reordene uma entrada de
   `MIGRATIONS` em `apps/agent/src/db/migrations.ts`; acrescente a próxima
   versão. Nunca apague dados do dono. Veja [.claude/rules/migrations.md](.claude/rules/migrations.md).
5. **Idiomas.** pt-BR é o idioma padrão. Todo texto de interface novo vai para
   `en.ts` **e** `pt-BR.ts`; todo texto gerado no servidor vai para o catálogo
   de `packages/shared/src/server-text.ts`. O CI falha se faltar tradução. Veja
   [.claude/rules/i18n.md](.claude/rules/i18n.md).
6. **Sem telemetria.** Nenhuma chamada a serviços operados pelos
   desenvolvedores, nenhum analytics.
7. **Instalador idempotente.** Rodar de novo nunca exclui dados do usuário.
8. **Não enfraqueça a segurança para um teste passar.** Nunca pule, desligue
   ou coloque em quarentena um teste; corrija a causa.

## Convenções de código

- TypeScript estrito, ESM. Identificadores, comentários e mensagens de teste
  no código ficam **em inglês**, como no resto do repositório. Documentação,
  changelog, PRs e commits ficam em **pt-BR**.
- Siga o estilo do arquivo vizinho: densidade de comentários, nomes, forma dos
  testes. Comentários explicam o porquê, não o quê.
- Valide toda entrada externa com Zod (schemas compartilhados em
  `packages/shared/src/schemas.ts` e vizinhos).
- Erros da API usam `AppError` e subclasses de `apps/agent/src/api/errors.ts`,
  com mensagem em inglês presente no catálogo de textos do servidor.
- Dependências são fixadas com versão exata (`save-exact=true`). Não adicione
  dependência sem necessidade clara; prefira o que já existe no projeto.
- Não invente APIs: antes de usar uma função, tipo, rota ou variável de
  ambiente, encontre a definição no código (`apps/agent/src/env.ts` lista
  todos os bindings e variáveis). Para APIs da Cloudflare, consulte a
  documentação oficial ou a skill `cloudflare` em vez da memória.

## Fluxo de trabalho no Git

- Branch de trabalho a partir da `develop`; PR **sempre para a `develop`**. A
  `main` só recebe releases vindas da `develop`, e quem mescla na `main` é o
  dono.
- Título do PR em Conventional Commits, prefixo em inglês e o resto em pt-BR:
  `feat(chat): …`, `fix(auth): …`. Tipos aceitos: `feat`, `fix`, `perf`,
  `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `style`,
  `security`, `i18n`.
- Toda mudança visível ao usuário ganha uma entrada em `## Não lançado` no
  `CHANGELOG.md`, no grupo certo (`Adicionado`, `Alterado`, `Corrigido`,
  `Segurança`, `Atualização`…), citando o PR. Mudanças internas (testes, CI,
  docs de desenvolvimento) usam o rótulo `sem-changelog`.
- Preencha o modelo de PR (`.github/pull_request_template.md`).
- Um PR por entrega, focado. Conflito com a branch de destino: traga a
  `develop`, resolva preservando os dois lados e rode typecheck, lint e testes
  de novo.
- Ao terminar qualquer ajuste, rode a auditoria de segurança
  (skill `auditoria-seguranca`) e corrija o que ela achar antes de dar por
  concluído.

## Como evitar erros

- Leia o código antes de mudar; confirme nomes com busca, não com palpite.
- Mudou comportamento: atualize ou acrescente testes e a doc em `docs/`.
- Mexeu em texto: rode `npm test -w @talorys/web` (cobertura de i18n).
- Mexeu em rota, autenticação, sessão, ferramenta, MCP, push, Telegram ou
  e-mail: leia a seção correspondente de [docs/security.md](docs/security.md)
  antes e rode os testes de segurança do agente.
- Dúvida de produto (o que o usuário deve ver, custo, escopo): pergunte ao dono
  em vez de decidir sozinho.
