# Deploy automático pelo GitHub

Cada merge na `main` publica o Talorys na Cloudflare pelo GitHub Actions
(`.github/workflows/deploy.yml`). O que vai ao ar é o **Worker único**
(`apps/agent/wrangler.standalone.jsonc`): o mesmo Worker serve a interface e a
API, sem projeto Pages e sem `*.pages.dev`.

```
PR → develop ──(CI)──► merge ──► PR develop → main ──(CI)──► merge
                                                              │
                                   ┌──────────────────────────┘
                                   ▼
             build (sem segredos)          deploy (ambiente production)
   lint · typecheck · testes · audit  ─►  wrangler deploy · /api/health
   build da UI · dry run do bundle
```

## Modelo de segurança

O repositório é público, então o desenho parte do princípio de que qualquer
pessoa lê o código, os workflows e os logs.

| Risco | Proteção |
| --- | --- |
| Token da Cloudflare vazar por um PR (inclusive de fork) | O token fica **só** no ambiente `production`, que aceita apenas a branch `main`. PRs rodam só o job `build`, que não tem segredo nenhum. Não há `pull_request_target`. |
| Dependência maliciosa roubar o token | O job que instala e roda o código do projeto (`build`) não tem segredo. O job `deploy` instala com `npm ci --ignore-scripts` (nenhum script de instalação roda ao lado do token) e não usa cache do npm. |
| Action de terceiros alterada | Todas as actions são oficiais (`actions/*`) e fixadas pelo SHA completo do commit. |
| Workflow com permissão demais | `permissions: contents: read` no workflow inteiro e `persist-credentials: false` no checkout. |
| Segredo do app no GitHub | `OWNER_PASSWORD`, `SESSION_SECRET`, chaves VAPID e `MCP_CREDENTIAL_KEY` **nunca** entram no GitHub. São gravados uma vez com `wrangler secret put` e o deploy os preserva. |
| Dados em log público | O health check imprime só o código HTTP; o corpo (que descreve a configuração) não aparece. O ID da conta é segredo e sai mascarado. |
| Deploy sem revisão | Opcional: o ambiente `production` pode exigir a sua aprovação antes de cada deploy. |
| Token com poder demais | Token de **conta**, só com as permissões abaixo, só na sua conta e na sua zona, com validade. |

### Por que GitHub Actions e não Workers Builds

O handoff de 24/10 preferia o **Workers Builds** (deploy da própria Cloudflare
ligado ao repositório), porque nenhum token fica no GitHub. As duas opções são
válidas; este repositório usa o Actions porque:

- o deploy só acontece depois de lint, typecheck, testes, audit e dry run do bundle;
- dá para exigir aprovação manual por ambiente e ver o histórico em *Deployments*;
- o build roda separado do segredo, e o segredo fica restrito à `main`.

Se preferir o Workers Builds, desative este workflow (Actions → Deploy →
*Disable workflow*) e siga a seção 16.2 do handoff. Não use os dois ao mesmo
tempo.

## Configuração (uma vez)

### 1. Criar o token na Cloudflare

1. Painel da Cloudflare → **Manage account → Account API tokens → Create Token**
   (token da conta, não do usuário).
2. Use o modelo **Edit Cloudflare Workers** e deixe só o necessário:
   - **Account → Workers Scripts → Edit**
   - **Account → Account Settings → Read**
   - **Zone → Workers Routes → Edit** (só se for usar domínio próprio)
   - remova KV, R2, Tail e o que mais não for usado.
3. **Account Resources:** só a sua conta. **Zone Resources:** só a zona do
   domínio (por exemplo `pablofreitasnutri.com.br`).
4. **TTL:** defina uma data de expiração (por exemplo 6 a 12 meses) e anote
   para renovar.
   Se o primeiro deploy com domínio falhar por permissão na zona, acrescente
   **Zone → DNS → Edit** (só nessa zona), ou ligue o domínio uma vez pelo
   painel (Worker → Settings → Domains & Routes).
5. Copie o token. Ele aparece uma vez só; não cole em nenhum outro lugar.

O **Account ID** fica na página inicial da conta (Workers & Pages → lateral direita).

### 2. Criar o ambiente `production` no GitHub

Repositório → **Settings → Environments → New environment** → `production`.

- **Deployment branches and tags:** *Selected branches and tags* → adicione só `main`.
- **Required reviewers** (recomendado): `pablopfg`. Cada deploy espera você
  clicar em *Approve*. Deixe *Prevent self-review* desligado, senão você não
  consegue aprovar o próprio deploy.
- **Environment secrets:**
  - `CLOUDFLARE_API_TOKEN`: o token do passo 1.
  - `CLOUDFLARE_ACCOUNT_ID`: o ID da conta.
- **Environment variables:**

| Variável | Obrigatória | Exemplo | Para quê |
| --- | --- | --- | --- |
| `TALORYS_WORKER_NAME` | sim | `talorys` | Nome do Worker. Os dados ficam no Durable Object desse Worker: se já existe uma instalação feita pelo instalador (`talorys-<id>-agent`), use esse nome para manter os dados. |
| `TALORYS_CUSTOM_DOMAIN` | recomendada | `assistente.pablofreitasnutri.com.br` | Domínio próprio. Com ele, `*.workers.dev` e as URLs de preview ficam desligados. |
| `TALORYS_PUBLIC_URL` | sem domínio | `https://talorys.<sub>.workers.dev` | Só para o health check quando ainda não há domínio. |
| `TALORYS_DEFAULT_TIMEZONE` | não | `America/Sao_Paulo` | Fuso padrão do agente. |
| `TALORYS_AGENT_NAME` | não | `Iris` | Nome padrão do agente. |

> **Não crie esses segredos no nível do repositório** (Settings → Secrets →
> Actions → *Repository secrets*). No nível do repositório, qualquer workflow,
> de qualquer branch, consegue lê-los. No ambiente, só o job de deploy na `main`.

### 3. Gravar os segredos do Worker (no seu computador)

Uma vez, antes do primeiro deploy, com o Wrangler logado na sua conta
(`npx wrangler login`). O primeiro comando cria o Worker vazio se ainda não
existir. Troque `talorys` pelo valor de `TALORYS_WORKER_NAME`.

```bash
cd apps/agent
npx wrangler secret put SESSION_SECRET --name talorys     # 32+ caracteres aleatórios
npx wrangler secret put OWNER_PASSWORD --name talorys     # ou OWNER_PASSWORD_HASH
npx wrangler secret put MCP_CREDENTIAL_KEY --name talorys # opcional
npx wrangler secret put VAPID_PUBLIC_KEY --name talorys   # opcional (push)
npx wrangler secret put VAPID_PRIVATE_KEY --name talorys  # opcional (push)
```

Para gerar um valor aleatório: `openssl rand -base64 48`. Digite os valores
quando o Wrangler pedir; não os passe na linha de comando (ficariam no
histórico do shell).

### 4. Proteger a `main`

As regras de branch (`.github/rulesets/`, veja [branch-protection.md](branch-protection.md)) exigem PR e CI verde para mesclar na `main`. Com
elas, **o merge é o portão**: nada vai ao ar sem passar pela revisão e pelos
testes. Se ainda não aplicou as regras, rode
`scripts/apply-rulesets.sh`.

### 5. Primeiro deploy

Actions → **Deploy** → *Run workflow* → branch `main`. Ou mescle um PR de
`develop` para `main`. Se o ambiente exigir aprovação, aprove em
*Review deployments*.

## Rotina

- **Deploy:** automático a cada merge na `main`.
- **Acompanhar:** aba **Actions** (cada execução) e **Deployments** (histórico do ambiente).
- **Falhou no health check:** o código novo já está no ar, mas não respondeu
  200. Em geral é segredo faltando (`SESSION_SECRET` com menos de 32
  caracteres ou senha ausente). Corrija o segredo ou faça rollback.
- **Rollback:** painel da Cloudflare → Worker → **Deployments** → versão
  anterior → *Rollback*, ou `npx wrangler rollback --name talorys`. Vale só
  para código: migrações do banco do Durable Object não voltam. Antes de
  mesclar um PR com migração, baixe o backup em Configurações → Privacidade.
- **Trocar o token:** crie o novo, atualize o segredo do ambiente e só então
  revogue o antigo na Cloudflare.
- **Suspeita de vazamento:** revogue o token na Cloudflare imediatamente
  (Account API tokens → *Roll* ou *Delete*); depois crie outro.

## Limites do plano gratuito

- **GitHub Actions:** repositório público não consome minutos da franquia.
- **Cloudflare:** um deploy não conta como requisição. O health check faz uma
  requisição ao Worker e uma leitura no Durable Object por deploy.

## Checklist de segurança ao mexer no workflow

- Nunca usar `pull_request_target` nem `workflow_run` com código do PR.
- Nunca dar `environment: production` a um job que roda em PR.
- Nunca imprimir segredos, `env` inteiro ou o corpo do `/api/health`.
- Fixar actions novas pelo SHA completo, com a versão em comentário.
- Manter `permissions` no mínimo (`contents: read`).
