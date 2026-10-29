# Instalação completa na Cloudflare, passo a passo

Este guia leva o Talorys do zero até o ar, com todos os recursos ligados, na
sua conta da Cloudflare e no seu repositório do GitHub. Ele junta, na ordem
certa, o que está espalhado nos outros documentos, e aponta para eles quando
você quiser os detalhes.

Tudo é feito **no navegador**, nos painéis da Cloudflare, do GitHub e do
próprio Talorys. Não é preciso instalar nada no computador. Onde existe um
atalho pelo terminal, ele aparece num bloco recolhido *Alternativa pelo
terminal*.

> **Use os seus dados, nunca os deste guia.** Os exemplos usam
> `exemplo.com.br`, `assistente.exemplo.com.br` e `voce@exemplo.com.br`.
> Troque pelos seus. O repositório é público: o seu domínio, o seu e-mail e
> qualquer segredo vão **só** nos painéis (variáveis do GitHub e segredos do
> Worker), nunca em arquivos do repositório, issues ou PRs.

## Sumário

- [Como o Talorys roda na Cloudflare](#como-o-talorys-roda-na-cloudflare)
- [Antes de começar](#antes-de-começar)
- **Parte 1 — Cloudflare: conta e domínio**
  - [1. Criar e proteger a conta da Cloudflare](#1-criar-e-proteger-a-conta-da-cloudflare)
  - [2. Adicionar o domínio](#2-adicionar-o-domínio)
  - [3. Forçar HTTPS no domínio](#3-forçar-https-no-domínio)
  - [4. Registrar o subdomínio workers.dev da conta](#4-registrar-o-subdomínio-workersdev-da-conta)
  - [5. O que não precisa criar (D1, KV, R2…)](#5-o-que-não-precisa-criar-d1-kv-r2)
  - [6. Criar o token de API do deploy](#6-criar-o-token-de-api-do-deploy)
- **Parte 2 — GitHub: repositório, regras e ambientes**
  - [7. Proteger a conta e preparar o repositório](#7-proteger-a-conta-e-preparar-o-repositório)
  - [8. Configurar o GitHub Actions](#8-configurar-o-github-actions)
  - [9. Ligar as proteções de código (secret scanning, CodeQL, Dependabot)](#9-ligar-as-proteções-de-código-secret-scanning-codeql-dependabot)
  - [10. Aplicar as regras das branches e das tags (rulesets)](#10-aplicar-as-regras-das-branches-e-das-tags-rulesets)
  - [11. Criar o ambiente `production`](#11-criar-o-ambiente-production)
  - [12. (Opcional) Criar o ambiente `smoke`](#12-opcional-criar-o-ambiente-smoke)
- **Parte 3 — Primeiro deploy**
  - [13. Gerar e guardar os segredos](#13-gerar-e-guardar-os-segredos)
  - [14. Rodar o primeiro deploy](#14-rodar-o-primeiro-deploy)
  - [15. Gravar os segredos do Worker](#15-gravar-os-segredos-do-worker)
  - [16. Rodar o deploy de novo e entrar](#16-rodar-o-deploy-de-novo-e-entrar)
  - [17. Proteger o acesso dentro do app](#17-proteger-o-acesso-dentro-do-app)
- **Parte 4 — Recursos opcionais (recomendados)**
  - [18. Cloudflare Access na frente](#18-cloudflare-access-na-frente)
  - [19. Verificação contra robôs (Turnstile)](#19-verificação-contra-robôs-turnstile)
  - [20. Avisos e recuperação de senha por e-mail (Email Routing)](#20-avisos-e-recuperação-de-senha-por-e-mail-email-routing)
  - [21. Notificações push](#21-notificações-push)
  - [22. Telegram](#22-telegram)
  - [23. n8n e outras automações (eventos e acesso remoto)](#23-n8n-e-outras-automações-eventos-e-acesso-remoto)
  - [24. Servidores MCP](#24-servidores-mcp)
- **Parte 5 — Versões e conferência**
  - [25. Publicar a primeira release](#25-publicar-a-primeira-release)
  - [26. Conferência final](#26-conferência-final)
- [Rotina de manutenção](#rotina-de-manutenção)
- [Problemas comuns](#problemas-comuns)
- [Referência: variáveis e segredos](#referência-variáveis-e-segredos)

## Como o Talorys roda na Cloudflare

```
navegador / Telegram / n8n
          │  https://assistente.exemplo.com.br
          ▼
 ┌─────────────────────────── Cloudflare ───────────────────────────┐
 │ zona exemplo.com.br: Always Use HTTPS, TLS 1.2+, (Access)        │
 │          │                                                        │
 │          ▼                                                        │
 │ Worker "talorys" ── interface (assets) + API                      │
 │   ├─ Durable Object com SQLite: todos os dados e os agendamentos  │
 │   ├─ Workers AI: chat, memória e voz                              │
 │   ├─ send_email (opcional): avisos e recuperação por e-mail       │
 │   └─ segredos do Worker: senha, sessão, pepper, chaves…           │
 └───────────────────────────────────────────────────────────────────┘
          ▲
          │ deploy a cada merge na main (GitHub Actions, ambiente production)
 repositório no GitHub (develop → main)
```

- **Um Worker só** serve a interface e a API (`apps/agent/wrangler.standalone.jsonc`).
  Não há projeto Pages nem endereço `*.pages.dev`.
- **Todos os dados** ficam num Durable Object com SQLite dentro desse Worker.
- **O deploy** é feito pelo GitHub Actions a cada merge na `main`
  (`.github/workflows/deploy.yml`). O token da Cloudflare fica só no ambiente
  `production` do GitHub. Os segredos do app ficam só no Worker.

| Serviço | Para quê | Plano gratuito |
| --- | --- | :---: |
| Workers | Interface e API | ✅ 100 mil requisições/dia |
| Durable Objects (SQLite) | Dados e agendamentos | ✅ |
| Workers AI | Modelo do chat, embeddings e transcrição de voz | ✅ 10 mil Neurons/dia |
| Email Routing (opcional) | Avisos e recuperação de senha por e-mail para o **seu** endereço verificado | ✅ |
| Turnstile (opcional) | Verificação contra robôs nos logins arriscados | ✅ |
| Zero Trust / Access (opcional) | Pedir o seu e-mail antes de abrir o Talorys | ✅ até 50 usuários |
| GitHub Actions | CI e deploy | ✅ repositório público não gasta minutos |

## Antes de começar

Separe:

- [ ] Um **e-mail** que você usa e protege bem (ele vira o dono da conta da
      Cloudflare e, se quiser, o e-mail de login do Talorys).
- [ ] Um **domínio** seu (por exemplo `exemplo.com.br`), registrado em
      qualquer lugar (Registro.br, Cloudflare Registrar, etc.). É recomendado,
      não obrigatório: sem domínio, o Talorys fica em
      `https://talorys.<sua-conta>.workers.dev` e alguns recursos (Access,
      recuperação de senha por e-mail, Email Routing) ficam de fora.
- [ ] Um **gerenciador de senhas** (Bitwarden, 1Password, o do navegador).
      Todos os segredos deste guia são gerados e guardados nele.
- [ ] Um **app autenticador** no celular (Google Authenticator, Aegis,
      1Password, Authy) para a verificação em duas etapas.
- [ ] A conta do **GitHub** dona do repositório do Talorys (ou do seu fork),
      com permissão de administrador nele.
- [ ] Cerca de **1 hora** para a primeira vez. Siga as etapas na ordem: várias
      dependem da anterior.

Escolha agora, e anote no gerenciador de senhas:

| Escolha | Exemplo | Observação |
| --- | --- | --- |
| Endereço do Talorys | `assistente.exemplo.com.br` | Use um **subdomínio**, não o domínio puro: o app manda HSTS com `includeSubDomains`. |
| Nome do Worker | `talorys` | Minúsculas, números e hífen. Se já existe uma instalação feita pelo instalador (`talorys-<id>-agent`), use esse nome para manter os dados. |
| Remetente dos e-mails (opcional) | `talorys@exemplo.com.br` | Não precisa ser uma caixa de entrada real. |
| Fuso horário | `America/Sao_Paulo` | |

---

## Parte 1 — Cloudflare: conta e domínio

### 1. Criar e proteger a conta da Cloudflare

1. Acesse <https://dash.cloudflare.com/sign-up> e crie a conta com o seu e-mail.
   O plano **Free** basta.
2. Confirme o e-mail pelo link que a Cloudflare enviar.
3. Ligue a verificação em duas etapas da conta: ícone do perfil (canto
   superior direito) → **Profile → Authentication → Two-Factor
   Authentication** → configure o app autenticador e guarde os códigos de
   recuperação no gerenciador de senhas. Quem entra nesta conta controla todos
   os seus dados no Talorys.
4. Anote o **Account ID**: na página inicial da conta, em **Workers & Pages**,
   ele aparece na lateral direita (também fica na URL do painel:
   `dash.cloudflare.com/<account-id>/...`). Ele vai virar um segredo do GitHub
   na etapa 11.

### 2. Adicionar o domínio

Pule esta etapa se não for usar domínio próprio.

1. Painel → **Websites** (ou **Account Home**) → **Add a domain** (*Onboard a
   domain*).
2. Digite o domínio raiz (`exemplo.com.br`), deixe **Quick scan for DNS
   records** ligado e continue.
3. Escolha o plano **Free**.
4. Revise os registros DNS importados. **Não apague** registros `MX`, `TXT`
   (SPF, DKIM, DMARC) nem os de outros serviços que o domínio já usa.
5. A Cloudflare mostra **dois nameservers** (por exemplo
   `ana.ns.cloudflare.com` e `bob.ns.cloudflare.com`). No site onde o domínio
   foi registrado (no Registro.br: **Domínios → o domínio → Alterar
   servidores DNS**), troque os nameservers atuais por esses dois.
   Desligue o DNSSEC no registrador antes, se estiver ligado (você o religa
   pela Cloudflare depois, em **DNS → Settings → DNSSEC**).
6. Volte à Cloudflare e clique em **Check nameservers**. A ativação leva de
   alguns minutos a 24 horas. O domínio fica **Active** quando terminar, e a
   Cloudflare avisa por e-mail.

> Não crie registro DNS para `assistente.exemplo.com.br`. O deploy liga o
> subdomínio ao Worker sozinho (*Custom Domain*) e cria o registro e o
> certificado.

### 3. Forçar HTTPS no domínio

O Worker já recusa HTTP e manda HSTS, mas estas opções da zona agem antes de a
requisição chegar a ele. Painel → o domínio → **SSL/TLS**:

| Onde | Opção | Valor |
| --- | --- | --- |
| **Overview** | Encryption mode | **Full (strict)** |
| **Edge Certificates** | Always Use HTTPS | **Ligado** |
| **Edge Certificates** | Minimum TLS Version | **TLS 1.2** |
| **Edge Certificates** | TLS 1.3 | **Ligado** |
| **Edge Certificates** | Automatic HTTPS Rewrites | **Ligado** |

**Não** ligue o HSTS da zona com *includeSubDomains* ou *Preload* se algum
outro subdomínio do domínio ainda usa HTTP. O HSTS do Talorys já vale para o
endereço dele.

Detalhes do que o Worker faz com HTTP: [deploy-github-actions.md](deploy-github-actions.md#2-forçar-https-no-domínio-próprio).

### 4. Registrar o subdomínio workers.dev da conta

Toda conta precisa de um subdomínio `*.workers.dev` antes do primeiro Worker,
mesmo quem vai usar domínio próprio.

1. Painel → **Workers & Pages**.
2. Se a Cloudflare pedir, escolha o subdomínio da conta (por exemplo
   `minhaconta`, que dá `*.minhaconta.workers.dev`) e confirme. Se a página já
   mostra **Subdomain** na lateral direita, ele já existe.

Com domínio próprio, o deploy **desliga** o endereço
`talorys.minhaconta.workers.dev` e as URLs de preview do Worker e confere isso
pela API a cada deploy. Sem domínio, é por esse endereço que você vai acessar o
Talorys. Detalhes: [E o endereço `*.workers.dev`?](deploy-github-actions.md#e-o-endereço-workersdev).

> **Não ligue os Workers traces** (Worker → Settings → Observability →
> Traces). Os logs já vêm ligados pelo `observability` do Wrangler; os traces
> podem sair do plano gratuito.

### 5. O que não precisa criar (D1, KV, R2…)

O Talorys **não usa** D1, KV, R2, Vectorize, Queues, Workflows, Pages nem Hyperdrive.
Tudo fica no Durable Object, que o primeiro deploy cria sozinho, junto com a
migração do banco. O Workers AI também não precisa ser ativado: ele já vem
com a conta.

Não crie esses recursos "por garantia": eles não seriam usados e alguns podem
gerar cobrança.

### 6. Criar o token de API do deploy

1. Painel → **Manage account → Account API tokens → Create Token** (token
   **da conta**, não *User API Tokens*).
2. Clique em **Use template** ao lado de **Edit Cloudflare Workers** e deixe só:

   | Tipo | Permissão | Nível |
   | --- | --- | --- |
   | Account | Workers Scripts | Edit |
   | Account | Account Settings | Read |
   | Zone | Workers Routes | Edit *(só com domínio próprio)* |

   Remova as outras linhas do modelo (Workers KV Storage, Workers R2 Storage,
   Workers Tail, Cloudflare Pages, User Details, Memberships…).
3. **Account Resources:** *Include* → a sua conta.
4. **Zone Resources:** *Include → Specific zone* → `exemplo.com.br`. Sem
   domínio, *Include → All zones from an account* não é necessário: remova a
   permissão de zona.
5. **Client IP Address Filtering:** deixe vazio (o GitHub Actions usa IPs
   variáveis).
6. **TTL:** defina uma data de fim (6 a 12 meses) e anote no gerenciador de
   senhas a data para renovar.
7. **Continue to summary → Create Token.** Copie o token para o gerenciador de
   senhas. Ele aparece uma vez só.

Se o primeiro deploy com domínio falhar por falta de permissão na zona,
acrescente **Zone → DNS → Edit** (só nessa zona) ao token.

---

## Parte 2 — GitHub: repositório, regras e ambientes

### 7. Proteger a conta e preparar o repositório

1. Ligue a verificação em duas etapas do GitHub (**Settings → Password and
   authentication → Two-factor authentication**), de preferência com uma
   *passkey* ou chave de segurança.
2. Abra o repositório (o seu fork, se for o caso). Ele tem as branches
   `develop` (desenvolvimento) e `main` (o que está no ar).
3. **Settings → General**:
   - **Default branch:** `develop`.
   - **Pull Requests:** marque **Allow squash merging** com *Default commit
     message* = **Pull request title**; deixe **Allow merge commits** ligado
     (usado em `develop → main`); marque **Automatically delete head
     branches**.
4. **Issues → Labels → New label:** crie `sem-changelog` (para PRs que não
     mudam nada para quem usa, como testes e CI).

### 8. Configurar o GitHub Actions

**Settings → Actions → General**:

1. **Actions permissions:** *Allow all actions and reusable workflows* (todas
   as actions do projeto são fixadas por SHA). Quem quiser restringir pode
   escolher *Allow `<conta>`, and select non-`<conta>`, actions* e permitir
   `actions/*`.
2. **Approval for running fork pull request workflows from contributors:**
   *Require approval for all external contributors*.
3. **Workflow permissions:** **Read repository contents and packages
   permissions** e marque **Allow GitHub Actions to create and approve pull
   requests** (o *Prepare release* abre o PR da versão).
4. Clique em **Save** em cada bloco.

Na aba **Actions**, se aparecer *Workflows aren't being run on this forked
repository*, clique em **I understand my workflows, go ahead and enable them**.

### 9. Ligar as proteções de código (secret scanning, CodeQL, Dependabot)

**Settings → Advanced Security** (em contas antigas, *Code security*). Num
repositório público tudo abaixo é gratuito:

| Opção | Valor | Para quê |
| --- | --- | --- |
| Private vulnerability reporting | **Enable** | Recebe relatos de falhas sem issue pública ([SECURITY.md](../SECURITY.md)). |
| Dependency graph | **Enable** | Base para os alertas abaixo. |
| Dependabot alerts | **Enable** | Avisa de dependência vulnerável. |
| Dependabot security updates | **Enable** | Abre PR com a correção. As atualizações de rotina já vêm do `.github/dependabot.yml`. |
| Grouped security updates | **Enable** | Um PR por grupo, em vez de vários. |
| Code scanning → CodeQL analysis | **Set up → Default** → idiomas *JavaScript/TypeScript* e *GitHub Actions* → **Enable CodeQL** | Análise estática de cada PR. |
| Secret Protection (Secret scanning) | **Enable** | Detecta token ou chave que entrar no código. |
| Push protection | **Enable** | Bloqueia o push que traz um segredo. |

Se o CodeQL apontar algo, o alerta aparece em **Security → Code scanning**.

### 10. Aplicar as regras das branches e das tags (rulesets)

As regras ficam em `.github/rulesets/` e precisam ser importadas uma vez (e de
novo a cada mudança nesses arquivos):

1. Baixe os três arquivos do repositório para o computador: abra
   `.github/rulesets/develop.json` no GitHub → botão **Download raw file**.
   Repita para `main.json` e `tags.json`.
2. **Settings → Rules → Rulesets → New ruleset → Import a ruleset** →
   escolha `develop.json` → **Create**.
3. Repita para `main.json` e `tags.json`.
4. Confira que as três regras aparecem como **Active**.

O que elas fazem (detalhes em [branch-protection.md](branch-protection.md)):
`main` e `develop` só mudam por PR com a CI `test` verde e as conversas
resolvidas; a `main` só aceita PR vindo da `develop` ou de `hotfix/*`; tags
`v*` só são criadas pelo GitHub Actions ou por administradores.

<details>
<summary>Alternativa pelo terminal</summary>

Com o [GitHub CLI](https://cli.github.com/) logado como administrador:

```bash
scripts/apply-rulesets.sh
```

</details>

### 11. Criar o ambiente `production`

O token da Cloudflare fica **só** aqui. **Settings → Environments → New
environment** → nome `production` → **Configure environment**:

1. **Required reviewers:** marque e adicione o seu usuário. Cada deploy espera
   você clicar em *Approve*. Deixe **Prevent self-review** desmarcado (senão
   você não aprova o próprio deploy). **Save protection rules**.
2. **Deployment branches and tags:** *Selected branches and tags* → **Add
   deployment branch or tag rule** → `main`.
3. **Environment secrets → Add environment secret:**

   | Nome | Valor |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | O token da etapa 6 |
   | `CLOUDFLARE_ACCOUNT_ID` | O Account ID da etapa 1 |

4. **Environment variables → Add environment variable:**

   | Nome | Obrigatória | Exemplo |
   | --- | --- | --- |
   | `TALORYS_WORKER_NAME` | **sim** | `talorys` |
   | `TALORYS_CUSTOM_DOMAIN` | com domínio | `assistente.exemplo.com.br` (sem `https://`) |
   | `TALORYS_PUBLIC_URL` | sem domínio | `https://talorys.minhaconta.workers.dev` |
   | `TALORYS_DEFAULT_TIMEZONE` | não | `America/Sao_Paulo` |
   | `TALORYS_AGENT_NAME` | não | `Iris` |

   Use **ou** `TALORYS_CUSTOM_DOMAIN` **ou** `TALORYS_PUBLIC_URL`. Com um dos
   dois, o Talorys responde só nesse endereço (qualquer outro recebe 404) e o
   deploy confere a saúde do app depois de publicar. As outras variáveis
   (Access, Turnstile, e-mail, push) entram nas etapas da Parte 4.

> **Nunca** crie esses segredos em **Settings → Secrets and variables →
> Actions → Repository secrets**. No nível do repositório, qualquer workflow de
> qualquer branch consegue lê-los; no ambiente, só o job de deploy da `main`.

Modelo de segurança do deploy: [deploy-github-actions.md](deploy-github-actions.md#modelo-de-segurança).

### 12. (Opcional) Criar o ambiente `smoke`

Só para quem quer rodar o teste de fumaça numa conta real (Actions → CI → *Run
workflow* → marcar *smoke*). Ele instala uma cópia do Talorys pelo instalador e
o log, público, mostra o nome e o e-mail da conta. Use uma **conta da
Cloudflare separada**, só para testes.

1. **Settings → Environments → New environment** → `smoke`.
2. **Required reviewers:** o seu usuário.
3. **Environment secrets:** `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`
   da conta de testes. O token precisa de *Workers Scripts: Edit*,
   *Cloudflare Pages: Edit*, *Workers AI: Read* e *Account Settings: Read*.

Sem o ambiente, o teste simplesmente não roda.

---

## Parte 3 — Primeiro deploy

### 13. Gerar e guardar os segredos

Gere cada valor no gerenciador de senhas (gerador de senha, só letras e
números, o tamanho indicado) e salve com o nome da tabela.

| Segredo | Tamanho | Obrigatório | Para quê |
| --- | --- | --- | --- |
| `OWNER_PASSWORD` | 20+ | **sim** | A senha de entrada no Talorys. Precisa ter 16+ caracteres, ou 10+ misturando maiúsculas, minúsculas, números e símbolos, sem palavras comuns. Uma senha fraca conta como "não configurada". |
| `SESSION_SECRET` | 48+ | **sim** | Chave das sessões, da verificação em duas etapas e do webhook do Telegram. Ninguém digita. |
| `PASSWORD_PEPPER` | 48+ | recomendado | Misturado ao hash de toda senha criada no app: um vazamento do banco não basta para adivinhar a senha. |
| `MCP_CREDENTIAL_KEY` | 48+ | para MCP | Criptografa os tokens dos servidores MCP. |
| `OWNER_EMAIL` | — | recomendado | O seu e-mail. Com ele, o login pede e-mail **e** senha, e os avisos e a recuperação por e-mail vão para ele. |

> **Grave o `PASSWORD_PEPPER` e o `SESSION_SECRET` antes do primeiro login e
> não troque depois.** Com o `OWNER_PASSWORD` (o caso deste guia), trocar
> qualquer um dos dois encerra todas as sessões e tokens, desfaz a senha trocada
> pelo app (volta a valer o `OWNER_PASSWORD`) e desliga a verificação em duas
> etapas. Trocar o `SESSION_SECRET` também invalida o vínculo do Telegram (toque
> em **Reconectar**) e os códigos do autenticador.

<details>
<summary>Gerar um valor aleatório sem gerenciador de senhas</summary>

Abra uma aba nova em branco (`about:blank`), aperte **F12** → **Console**, cole e
aperte Enter. O valor é gerado no seu navegador e não sai dele:

```js
(() => { const b = new Uint8Array(48); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, ""); })()
```

Ou no terminal: `openssl rand -base64 48`.

</details>

### 14. Rodar o primeiro deploy

O Worker só passa a existir no primeiro deploy, e só responde depois de
receber os segredos. Por isso o primeiro deploy **termina vermelho de
propósito** no passo *Health check*.

1. Se a `main` ainda não tem o código da `develop`: **Pull requests → New pull
   request** → *base* `main`, *compare* `develop` → **Create pull request**.
   Espere a CI ficar verde e clique em **Merge pull request** (*Create a merge
   commit*).
   Se a `main` já está atualizada: **Actions → Deploy → Run workflow** →
   branch `main` → **Run workflow**.
2. Abra a execução em **Actions → Deploy**. Quando o job `deploy` mostrar
   *Waiting for review*, clique em **Review deployments** → marque
   `production` → **Approve and deploy**.
3. O job publica o Worker e fica vermelho em *Health check* com `HTTP 503`.
   É o esperado agora. Se falhar **antes** (em *Render the deploy config* ou
   *Deploy to Cloudflare*), veja [Problemas comuns](#problemas-comuns).

### 15. Gravar os segredos do Worker

Painel da Cloudflare → **Workers & Pages** → o Worker `talorys` (o nome de
`TALORYS_WORKER_NAME`) → **Settings → Variables and Secrets → + Add**. Para
cada segredo:

1. **Type:** **Secret** (nunca *Text*: texto fica visível no painel e é
   apagado no próximo deploy).
2. **Variable name:** o nome exato da tabela da etapa 13.
3. **Value:** cole do gerenciador de senhas.
4. Clique em **Deploy** (ou **Save and deploy**).

Grave pelo menos `OWNER_PASSWORD`, `SESSION_SECRET` e `PASSWORD_PEPPER`. Pode
gravar também `OWNER_EMAIL` e `MCP_CREDENTIAL_KEY` agora. Os segredos dos
recursos da Parte 4 entram nas etapas deles.

Os segredos valem na hora, ficam guardados criptografados no Worker, os
próximos deploys os preservam e eles nunca passam pelo GitHub.

<details>
<summary>Alternativa pelo terminal (Wrangler)</summary>

Com `npx wrangler login` feito na sua conta, dentro de `apps/agent`:

```bash
npx wrangler secret put OWNER_PASSWORD --name talorys
npx wrangler secret put SESSION_SECRET --name talorys
npx wrangler secret put PASSWORD_PEPPER --name talorys
npx wrangler secret put OWNER_EMAIL --name talorys
npx wrangler secret put MCP_CREDENTIAL_KEY --name talorys
```

Digite o valor quando o Wrangler pedir; não o passe na linha de comando (ele
ficaria no histórico do shell).

</details>

### 16. Rodar o deploy de novo e entrar

1. GitHub → **Actions** → a execução do Deploy que falhou → **Re-run jobs →
   Re-run failed jobs** → aprove de novo. Agora o *Health check* responde
   `HTTP 200` e, com domínio, *Check HTTPS and the workers.dev address* fica
   verde.
2. Abra `https://assistente.exemplo.com.br` (ou o endereço `workers.dev`).
   O primeiro acesso ao domínio pode levar alguns minutos enquanto o
   certificado é emitido.
3. Entre com o e-mail (se gravou `OWNER_EMAIL`) e a senha.
4. Em **Configurações → Sobre**, confira a versão publicada (`1.x.y+<commit>`).

### 17. Proteger o acesso dentro do app

Em **Configurações → Segurança**:

1. **Verificação em duas etapas → Ativar.** Leia o QR code com o app
   autenticador, digite o código e guarde os **10 códigos de recuperação** no
   gerenciador de senhas (eles aparecem uma vez só).
2. Confira os tempos de sessão (padrão: 30 minutos sem uso, 6 horas no total).
3. Veja a **Atividade de acesso**: o seu login deve ser a única linha.

Em **Configurações → Privacidade**, baixe um primeiro **backup** e guarde num
lugar seguro. Repita antes de cada atualização com migração de banco.

---

## Parte 4 — Recursos opcionais (recomendados)

Cada recurso é independente: pule o que não quiser. Todos seguem o mesmo
padrão: o que é **público** vira variável do ambiente `production` no GitHub;
o que é **secreto** vira segredo do Worker na Cloudflare. Depois de criar ou
mudar uma variável do GitHub, rode **Actions → Deploy → Run workflow** na
`main`. Um segredo do Worker vale na hora, sem deploy.

### 18. Cloudflare Access na frente

O Access pede o seu e-mail e um código enviado a ele antes de a página do
Talorys abrir. Quem não for você nem chega à tela de login. Precisa de domínio
próprio.

1. Painel → **Zero Trust**. No primeiro acesso, escolha o nome da equipe (o
   endereço fica `<equipe>.cloudflareaccess.com`) e o plano **Free**. A
   Cloudflare pode pedir um meio de pagamento, mas não cobra no Free.
2. **Access → Applications → Add an application → Self-hosted**:
   - **Application name:** `Talorys`.
   - **Session Duration:** `12 hours`.
   - **Application domain:** `assistente.exemplo.com.br`, sem caminho.
   - **Policy:** nome `Dono`, **Action** *Allow*, **Include → Emails** = o seu
     e-mail.
   - **Login methods:** *One-time PIN* basta.
   - Salve.
3. Crie uma **segunda aplicação**, só para o health check do deploy:
   **Application domain** = o mesmo domínio com **path** `api/health`;
   **Policy** *Bypass*, **Include → Everyone**. Sem cookie nem token, essa rota
   responde só `{"ok": true}`.
4. Se for usar o Telegram (etapa 22), crie uma **terceira aplicação** igual à
   segunda, com o path `api/telegram/webhook`. O Talorys continua exigindo o
   cabeçalho secreto do Telegram nessa rota.
5. Na primeira aplicação, aba **Overview** (ou *Basic information*), copie a
   **Application Audience (AUD) Tag**.
6. Abra o endereço numa janela anônima e confira que o Access pede o e-mail.
   **Só depois disso** crie, no ambiente `production` do GitHub, as variáveis:

   | Nome | Exemplo |
   | --- | --- |
   | `TALORYS_ACCESS_TEAM_DOMAIN` | `minhaequipe.cloudflareaccess.com` |
   | `TALORYS_ACCESS_AUD` | os 64 caracteres da AUD Tag |

7. Rode o Deploy. A partir daí, o Talorys confere a assinatura do Access em
   cada requisição.

Com as variáveis e sem o Access funcionando, toda requisição recebe 403. Para
desligar, apague as duas variáveis e rode o Deploy. Integrações (n8n, scripts)
passam pelo Access com um *Service Token* (etapa 23). Detalhes:
[deploy-github-actions.md](deploy-github-actions.md#6-recomendado-cloudflare-access-na-frente).

### 19. Verificação contra robôs (Turnstile)

O Talorys mostra o "não sou um robô" da Cloudflare só quando um login parece
arriscado (a rede errou a senha há pouco, ou há um ataque vindo de várias
redes) e em todo pedido de recuperação de senha.

1. Painel → **Turnstile → Add widget**:
   - **Widget name:** `Talorys`.
   - **Hostname Management → Add hostnames:** `assistente.exemplo.com.br`
     (ou `talorys.minhaconta.workers.dev`), sem `https://`.
   - **Widget Mode:** *Managed*.
   - **Pre-clearance:** *No*.
   - **Create**.
2. Copie a **Site Key** e a **Secret Key**.
3. GitHub, ambiente `production` → variável `TALORYS_TURNSTILE_SITE_KEY` = a
   **Site Key** (é pública).
4. Cloudflare, Worker → segredo `TURNSTILE_SECRET_KEY` = a **Secret Key**.
5. Rode o Deploy.
6. Teste numa janela anônima: erre a senha uma vez; na tentativa seguinte, a
   verificação aparece acima do botão de entrar.

Precisa das duas chaves: só uma deixa o Turnstile desligado. Detalhes:
[security.md](security.md#robot-check-turnstile).

### 20. Avisos e recuperação de senha por e-mail (Email Routing)

O e-mail é o canal de último recurso dos avisos (alertas de segurança e
críticos sempre vão por ele) e o caminho do **Esqueceu a senha?** na tela de
login. Ele usa o Cloudflare Email Routing, gratuito para enviar ao **seu**
endereço verificado. Precisa de domínio próprio.

> ⚠️ **Ligar o Email Routing troca os registros MX do domínio.** Se
> `exemplo.com.br` já recebe e-mail em outro lugar (Google Workspace,
> Microsoft 365, Zoho, a hospedagem), ligar o Email Routing no domínio raiz
> **para a entrega desses e-mails**. Nesse caso, ligue-o num **subdomínio que
> não recebe e-mail** (por exemplo `avisos.exemplo.com.br`) ou num domínio só
> para isso. Antes de continuar, abra **DNS → Records** e veja se já existem
> registros `MX`: se existem, use um subdomínio.

1. Painel → o domínio → **Email → Email Routing → Get started / Enable Email
   Routing**. Para um subdomínio, use **Settings → Subdomains → Add
   subdomain** e ligue nele.
2. Aceite os registros **MX** e **TXT (SPF)** que a Cloudflare propõe →
   **Add records and enable**.
3. **Destination addresses → Add destination address** → o seu e-mail
   pessoal. Clique no link de verificação que chegar. Sem a verificação, nada
   é entregue.
4. Escolha o **remetente**: um endereço do domínio (ou subdomínio) do passo 1,
   como `talorys@exemplo.com.br`. Ele não precisa existir como caixa de
   entrada nem ter regra de roteamento.
5. Cloudflare, Worker → segredo `ALERT_EMAIL_TO` = o e-mail verificado no passo
   3. Se o `OWNER_EMAIL` já é esse mesmo endereço, pode pular: sem
   `ALERT_EMAIL_TO`, vale o `OWNER_EMAIL`.
6. GitHub, ambiente `production` → variável `TALORYS_ALERT_EMAIL_FROM` = o
   remetente do passo 4. O deploy cria o binding `send_email` (só esse
   remetente pode enviar).
7. Rode o Deploy.
8. No Talorys, **Configurações → Avisos → E-mail → Enviar e-mail de teste**.
   Se não chegar, olhe o spam e o histórico de entregas.

Com o e-mail configurado **e** o deploy sabendo o próprio endereço
(`TALORYS_CUSTOM_DOMAIN` ou `TALORYS_PUBLIC_URL`), a tela de login passa a
mostrar **Esqueceu a senha?**. O link vai só para o endereço verificado, vale
30 minutos e uma única vez, e com a verificação em duas etapas ligada a senha
nova também pede o código. Detalhes: [alerts.md](alerts.md#configurar-o-e-mail)
e [security.md](security.md).

### 21. Notificações push

1. Gere o par de chaves VAPID. Numa aba em branco (`about:blank`), **F12 →
   Console**, cole e aperte Enter:

   ```js
   (async () => {
     const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
     const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
     console.log("VAPID_PUBLIC_KEY=" + b64(await crypto.subtle.exportKey("raw", k.publicKey)));
     console.log("VAPID_PRIVATE_KEY=" + (await crypto.subtle.exportKey("jwk", k.privateKey)).d);
   })();
   ```

   As chaves são geradas no seu navegador e não saem dele. Copie as duas para
   o gerenciador de senhas e feche a aba. (No terminal:
   `npx web-push generate-vapid-keys`.)
2. Cloudflare, Worker → segredos `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`.
3. (Opcional) GitHub, ambiente `production` → variável
   `TALORYS_VAPID_SUBJECT` = `mailto:voce@exemplo.com.br`. Rode o Deploy.
4. No aparelho, abra o Talorys → **Configurações → Avisos → Notificações push
   → Ativar** (pede a senha recente). No iPhone, antes adicione o Talorys à
   **Tela de Início** (Compartilhar → Adicionar à Tela de Início) e abra por
   lá.
5. Toque em **Enviar teste**.

No máximo 3 aparelhos; um aparelho que passa 7 dias sem abrir o app sai do
push sozinho. **Não troque** as chaves depois: chaves novas desconectam todos
os aparelhos. Detalhes: [alerts.md](alerts.md#aparelhos-do-push).

### 22. Telegram

1. No Telegram, abra [@BotFather](https://t.me/BotFather) → `/newbot` → nome →
   usuário terminado em `bot`. Copie o **token** (`123456789:AA...`) para o
   gerenciador de senhas.
2. Cloudflare, Worker → segredo `TELEGRAM_BOT_TOKEN`.
3. Com o Access ligado, confira que criou a aplicação *Bypass* de
   `api/telegram/webhook` (etapa 18, passo 4).
4. No Talorys, **Configurações → Avisos → Telegram → Conectar**. Toque em
   **Abrir o chat com o bot** → **Iniciar**.
5. (Opcional) Crie um grupo de avisos, de preferência com **tópicos**, e use
   **Adicionar o bot a um grupo**. Para um tópico por categoria, torne o bot
   administrador com *Gerenciar tópicos*.
6. No @BotFather, `/setjoingroups` → o seu bot → **Disable**, para ninguém
   adicioná-lo a outros grupos.
7. **Enviar teste**.
8. Ligue a verificação em duas etapas da sua conta do Telegram
   (**Configurações → Privacidade e Segurança → Verificação em duas etapas**):
   ela passa a conversar com o seu agente.

Detalhes: [alerts.md](alerts.md#configurar-o-telegram).

### 23. n8n e outras automações (eventos e acesso remoto)

O n8n (ou qualquer script) fala com o Talorys por um **token de acesso
remoto**, sempre de servidor para servidor:

| Escopo | O que faz |
| --- | --- |
| `events` | Só envia avisos (`POST /api/remote/events`). Não lê nada. Use este para o n8n mandar alertas. |
| `read` | Lê tarefas, notas e afins. |
| `write` | Lê e altera. Dê só a quem precisa. |

1. Talorys → **Configurações → Segurança → Acesso remoto** → ligue (pede a
   senha recente) → nome `n8n` → escopo **events** → **Gerar token**. Copie o
   `tal_...` na hora: ele não aparece de novo e vence em 90 dias.
2. No n8n → **Credentials → New → Header Auth**: nome `Authorization`, valor
   `Bearer tal_...`.
3. No fluxo, nó **HTTP Request**: `POST`
   `https://assistente.exemplo.com.br/api/remote/events`, credencial do passo
   2, corpo JSON com `title`, `priority`, `source`, `kind` e `id`. Modelo
   completo em [alerts.md](alerts.md#configurar-no-n8n).
4. **Com o Access ligado:** Zero Trust → **Access → Service Auth → Create
   Service Token** (nome `n8n`, duração 1 ano). Copie o *Client ID* e o
   *Client Secret*. Na aplicação `Talorys`, acrescente uma política
   **Service Auth** que inclua esse token. No n8n, mande também os cabeçalhos
   `CF-Access-Client-Id` e `CF-Access-Client-Secret`, guardados como
   credencial, nunca dentro do fluxo.
5. Execute o nó: a resposta deve ser `201` e o aviso aparece na central.

Anote no calendário a troca do token antes dos 90 dias. Outros usos (Home
Assistant, CLI): [remote-access.md](remote-access.md).

### 24. Servidores MCP

O Talorys usa ferramentas de servidores MCP remotos (Streamable HTTP), como o
MCP Server Trigger do próprio n8n.

1. Confira que o segredo `MCP_CREDENTIAL_KEY` existe no Worker (etapa 15). Sem
   ele, só servidores sem autenticação podem ser adicionados.
2. Talorys → **Configurações → Integrações → Servidores MCP** → adicionar servidor → a URL pública do
   servidor (com o caminho, muitas vezes `/mcp`) → o token, se ele pedir, ou
   **Entrar** (OAuth).
3. Leia a descrição de cada ferramenta e ligue só as que quer usar. Ações que
   mudam algo pedem a sua confirmação no chat.
4. Recomendado: limite o Talorys aos seus servidores. No Worker, crie o segredo
   `TALORYS_MCP_ALLOWED_ORIGINS` com as origens permitidas, separadas por
   vírgula: `https://n8n.exemplo.com.br` ou `https://*.exemplo.com.br` para
   qualquer subdomínio. Qualquer outro servidor é recusado, inclusive os que
   já estavam adicionados. Uma entrada mal escrita recusa todos até ser
   corrigida. Se o servidor entra com OAuth, inclua também a origem do
   servidor de login. Não use curinga em domínios compartilhados, como
   `https://*.workers.dev`: ele libera os servidores de todos os outros
   clientes ali. Use segredo, não variável, para o endereço do seu n8n ficar
   fora do GitHub.

O Talorys só se conecta a endereços **públicos** e `https://`: um n8n na sua
rede local precisa estar publicado (por exemplo por um Cloudflare Tunnel).
Detalhes: [mcp.md](mcp.md).

---

## Parte 5 — Versões e conferência

### 25. Publicar a primeira release

1. **Actions → Prepare release → Run workflow** → branch `develop` →
   *version* `1.0.0` na primeira vez (depois, `auto`) → **Run workflow**.
2. O workflow abre o PR `release/v1.0.0` para a `develop`. Espere a CI ficar
   verde e faça **Squash and merge**.
3. Abra o PR `develop → main`, espere a CI e faça **Create a merge commit**.
4. O merge dispara dois workflows: **Release** cria a tag `v1.0.0` e o GitHub
   Release com as notas do CHANGELOG; **Deploy** publica (aprove em *Review
   deployments*).

O fluxo completo, as regras do changelog e o versionamento: [releases.md](releases.md).

### 26. Conferência final

Cloudflare:

- [ ] Verificação em duas etapas ligada na conta da Cloudflare.
- [ ] Domínio **Active**, SSL/TLS em *Full (strict)*, *Always Use HTTPS* e TLS 1.2+.
- [ ] Nenhum D1, KV, R2 ou projeto Pages criado para o Talorys.
- [ ] Worker → **Settings → Domains & Routes**: só o domínio próprio; `workers.dev` e *Preview URLs* desligados.
- [ ] Worker → **Settings → Variables and Secrets**: todos os segredos do tipo **Secret**, nenhum como *Text*.
- [ ] Token de API com data de expiração anotada.

GitHub:

- [ ] `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` só no ambiente `production`; **Repository secrets** vazio.
- [ ] Ambiente `production` com *Required reviewers* e só a branch `main`.
- [ ] Três rulesets ativos (`develop`, `main`, tags).
- [ ] Secret scanning, push protection, CodeQL e Dependabot ligados.
- [ ] **Deployments** mostra `production` verde.

Talorys:

- [ ] `http://assistente.exemplo.com.br` redireciona para `https://`.
- [ ] `https://talorys.minhaconta.workers.dev` não responde (com domínio próprio).
- [ ] Login funciona; senha errada é recusada.
- [ ] Verificação em duas etapas ligada e códigos de recuperação guardados.
- [ ] Backup baixado.
- [ ] Com Access: uma janela anônima pede o e-mail antes de mostrar o Talorys.
- [ ] Com Turnstile: depois de uma senha errada, o login pede a verificação.
- [ ] Com e-mail: o e-mail de teste chegou e o login mostra **Esqueceu a senha?**.
- [ ] Com push e Telegram: os testes chegaram.

---

## Rotina de manutenção

| Quando | O quê |
| --- | --- |
| A cada PR do Dependabot | Deixe a CI rodar e mescle na `develop` quando estiver verde. |
| A cada release | Baixe o backup antes, se o CHANGELOG fala em migração. Aprove o deploy e confira a versão em **Configurações → Sobre**. |
| Antes de vencer | Token da Cloudflare: crie o novo, troque o segredo no ambiente `production`, rode o Deploy e só então apague o antigo. Tokens de acesso remoto (90 dias) e Service Tokens do Access. |
| Todo mês | Veja **Configurações → Segurança → Atividade de acesso** e **Security** no GitHub (alertas do Dependabot, CodeQL e secret scanning). |
| Deploy ruim | Cloudflare → Worker → **Deployments** → versão anterior → **Rollback**. Vale só para o código: migrações do banco não voltam. |
| Suspeita de vazamento | Token da Cloudflare: **Account API tokens → Roll** ou apague. Senha: troque em Configurações → Segurança (ou pelo **Esqueceu a senha?**). Token remoto: revogue em Acesso remoto. Bot do Telegram: `/revoke` no @BotFather e grave o novo token. |

Mais em [deploy-github-actions.md](deploy-github-actions.md#rotina).

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| *Render the deploy config* falha com `TALORYS_WORKER_NAME is required` | Variável faltando ou criada fora do ambiente | Crie em **Environments → production → Environment variables**. |
| *Render…* diz que uma variável `is not valid` | Valor com `https://`, barra, espaço ou formato errado | `TALORYS_CUSTOM_DOMAIN` sem `https://`; `TALORYS_PUBLIC_URL` com `https://` e sem caminho; AUD com 64 caracteres hexadecimais. |
| *Deploy to Cloudflare*: `Authentication error` ou `10000` | Token errado, vencido ou sem permissão | Refaça o token da etapa 6 e atualize o segredo do ambiente. |
| *Deploy*: erro de permissão na zona ou no Custom Domain | Falta permissão de zona | Acrescente *Zone → Workers Routes: Edit* (e, se preciso, *DNS: Edit*) na zona. |
| *Deploy*: `You need a workers.dev subdomain` | Etapa 4 pulada | Registre o subdomínio em **Workers & Pages**. |
| *Health check*: `HTTP 503` | Segredo faltando ou senha fraca | Etapa 15: `OWNER_PASSWORD` forte e `SESSION_SECRET` com 32+ caracteres. |
| *Health check*: `HTTP 403` com Access | Falta a aplicação *Bypass* de `api/health` | Etapa 18, passo 3. |
| *Health check*: `000` ou erro de certificado | Certificado do domínio ainda sendo emitido | Espere alguns minutos e **Re-run failed jobs**. |
| *Check HTTPS…*: `workers.dev or preview URLs are on` | Ligados pelo painel | Worker → **Settings → Domains & Routes** → desligue os dois e rode o Deploy. |
| Toda página dá 403 | Variáveis do Access sem o Access funcionando | Apague `TALORYS_ACCESS_*`, rode o Deploy, configure o Access e crie as variáveis de novo. |
| Toda página dá 404 | Acesso por um endereço que não é o configurado | Use o endereço de `TALORYS_CUSTOM_DOMAIN` ou `TALORYS_PUBLIC_URL`. |
| E-mail: *canal não configurado* | Falta remetente, binding ou destinatário | Etapa 20, passos 5 e 6, e rode o Deploy. |
| E-mail: *Falhou* (`E_RECIPIENT_NOT_ALLOWED`) | Destino não verificado | Clique no link de verificação do Email Routing. |
| Parei de receber e-mail no domínio | Email Routing ligado no domínio que já tinha MX | Desligue o Email Routing, restaure os MX antigos e use um subdomínio. |
| **Esqueceu a senha?** não aparece | E-mail ou endereço público não configurados | Etapa 20 e `TALORYS_CUSTOM_DOMAIN`/`TALORYS_PUBLIC_URL`. |
| Todos foram desconectados e a 2FA sumiu | `SESSION_SECRET` ou `PASSWORD_PEPPER` trocado | É o comportamento esperado: entre com o `OWNER_PASSWORD` e religue a 2FA. |
| PR parado esperando `test` | A CI não rodou no último commit | **Actions → CI → Run workflow** na branch do PR. |

Outros casos: [troubleshooting.md](troubleshooting.md).

## Referência: variáveis e segredos

**Variáveis do ambiente `production` no GitHub** (públicas, entram no deploy):

| Nome | Etapa | Para quê |
| --- | --- | --- |
| `TALORYS_WORKER_NAME` | 11 | Nome do Worker (obrigatória). |
| `TALORYS_CUSTOM_DOMAIN` | 11 | Domínio próprio; desliga o `workers.dev`. |
| `TALORYS_PUBLIC_URL` | 11 | Endereço `workers.dev`, quando não há domínio. |
| `TALORYS_DEFAULT_TIMEZONE` | 11 | Fuso padrão. |
| `TALORYS_AGENT_NAME` | 11 | Nome padrão do agente. |
| `TALORYS_ACCESS_TEAM_DOMAIN`, `TALORYS_ACCESS_AUD` | 18 | Cloudflare Access (as duas ou nenhuma). |
| `TALORYS_TURNSTILE_SITE_KEY` | 19 | Site Key do Turnstile. |
| `TALORYS_ALERT_EMAIL_FROM` | 20 | Remetente dos e-mails; cria o binding `send_email`. |
| `TALORYS_VAPID_SUBJECT` | 21 | Contato para os serviços de push. |

**Segredos do ambiente `production` no GitHub:** `CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID` (etapa 11).

**Segredos do Worker na Cloudflare** (nunca no GitHub):

| Nome | Etapa | Obrigatório |
| --- | --- | --- |
| `OWNER_PASSWORD` (ou `OWNER_PASSWORD_HASH`, do instalador) | 15 | sim |
| `SESSION_SECRET` | 15 | sim |
| `PASSWORD_PEPPER` | 15 | recomendado |
| `OWNER_EMAIL` | 15 | recomendado |
| `MCP_CREDENTIAL_KEY` | 15, 24 | para MCP com token |
| `TURNSTILE_SECRET_KEY` | 19 | para o Turnstile |
| `ALERT_EMAIL_TO` | 20 | não (usa o `OWNER_EMAIL`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | 21 | para o push |
| `TELEGRAM_BOT_TOKEN` | 22 | para o Telegram |
| `TALORYS_MCP` (`off`), `TALORYS_MCP_MAX_TOOLS` | 24 | não |
| `TALORYS_MCP_ALLOWED_ORIGINS` | 24 | não (recomendado) |

Nunca defina `TALORYS_ENV`, `TALORYS_MOCK_AI`, `TALORYS_DEV_ORIGINS` nem
`TALORYS_HIBP` em produção: são só para desenvolvimento local.

Instalação pelo instalador de linha de comando (`npx create-talorys@latest`,
com Pages) em vez do deploy pelo GitHub: [deployment.md](deployment.md).
