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
| Segredo do app no GitHub | `OWNER_PASSWORD`, `SESSION_SECRET`, chaves VAPID, `MCP_CREDENTIAL_KEY` e `TELEGRAM_BOT_TOKEN` **nunca** entram no GitHub. São gravados uma vez com `wrangler secret put` e o deploy os preserva. |
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

Tudo abaixo é feito no navegador, nos painéis do GitHub e da Cloudflare. Não
precisa instalar nada no computador. Quem preferir o terminal tem a
alternativa com o Wrangler no passo 5.

Reserve uns 30 minutos. A ordem importa: siga os passos na sequência.

### 0. Antes de começar

- **Conta na Cloudflare** (o plano gratuito basta).
- **Domínio próprio na Cloudflare** (recomendado): o domínio precisa estar
  adicionado à sua conta, com os nameservers da Cloudflare (Websites → *Add a
  domain*). Defina o subdomínio do Talorys (por exemplo
  `assistente.exemplo.com.br`). Ele vai **só** na variável do ambiente (passo
  3), nunca no repositório, que é público.
  Sem domínio, o Talorys fica em `https://<nome-do-worker>.<sua-conta>.workers.dev`.
- **Regras de branch aplicadas** no GitHub (passo 4).
- Um **gerenciador de senhas** (Bitwarden, 1Password, o do navegador) para
  gerar e guardar a senha de acesso e o segredo de sessão.

### 1. Criar o token na Cloudflare

1. Painel da Cloudflare → **Manage account → Account API tokens → Create Token**
   (token da conta, não do usuário).
2. Use o modelo **Edit Cloudflare Workers** e deixe só o necessário:
   - **Account → Workers Scripts → Edit**
   - **Account → Account Settings → Read**
   - **Zone → Workers Routes → Edit** (só se for usar domínio próprio)
   - remova KV, R2, Tail e o que mais não for usado.
3. **Account Resources:** só a sua conta. **Zone Resources:** só a zona do
   domínio (por exemplo `exemplo.com.br`).
4. **TTL:** defina uma data de expiração (por exemplo 6 a 12 meses) e anote
   para renovar.
   Se o primeiro deploy com domínio falhar por permissão na zona, acrescente
   **Zone → DNS → Edit** (só nessa zona), ou ligue o domínio uma vez pelo
   painel (Worker → Settings → Domains & Routes).
5. Copie o token. Ele aparece uma vez só; não cole em nenhum outro lugar.

O **Account ID** fica na página inicial da conta (Workers & Pages → lateral direita).

### 2. Forçar HTTPS no domínio próprio

O próprio Worker já garante HTTPS: ele roda antes de qualquer arquivo da
interface, responde `301` para `https://` a toda página ou leitura pedida por
HTTP, recusa (sem redirecionar) qualquer envio por HTTP, como um login, e
qualquer chamada à API que leve credencial (um token Bearer do n8n, por
exemplo), para que o vazamento apareça em vez de ser escondido. Também manda
HSTS em todas as respostas. Mesmo assim, ligue as proteções da zona, que
agem antes de a requisição chegar ao Worker. Na zona do domínio, em
**SSL/TLS**:

- **Overview → Encryption mode:** *Full (strict)*.
- **Edge Certificates → Always Use HTTPS:** ligado.
- **Edge Certificates → Minimum TLS Version:** TLS 1.2.
- **Edge Certificates → TLS 1.3:** ligado.
- **Edge Certificates → Automatic HTTPS Rewrites:** ligado.

Não ligue o **HSTS** da zona com *includeSubDomains* nem *Preload* se outros
subdomínios do domínio ainda usam HTTP: o HSTS do Talorys vale só para o
endereço dele (e os subdomínios dele).

### 3. Criar o ambiente `production` no GitHub

Repositório → **Settings → Environments → New environment** → `production`.

- **Deployment branches and tags:** *Selected branches and tags* → adicione só `main`.
- **Required reviewers** (recomendado): o seu usuário. Cada deploy espera você
  clicar em *Approve*. Deixe *Prevent self-review* desligado, senão você não
  consegue aprovar o próprio deploy.
- **Environment secrets:**
  - `CLOUDFLARE_API_TOKEN`: o token do passo 1.
  - `CLOUDFLARE_ACCOUNT_ID`: o ID da conta.
- **Environment variables:**

| Variável | Obrigatória | Exemplo | Para quê |
| --- | --- | --- | --- |
| `TALORYS_WORKER_NAME` | sim | `talorys` | Nome do Worker. Os dados ficam no Durable Object desse Worker: se já existe uma instalação feita pelo instalador (`talorys-<id>-agent`), use esse nome para manter os dados. |
| `TALORYS_CUSTOM_DOMAIN` | recomendada | `assistente.exemplo.com.br` | Domínio próprio. Com ele, `*.workers.dev` e as URLs de preview ficam desligados. |
| `TALORYS_PUBLIC_URL` | sem domínio | `https://talorys.<sub>.workers.dev` | Para o health check quando ainda não há domínio. A API passa a responder só nesse endereço. |
| `TALORYS_DEFAULT_TIMEZONE` | não | `America/Sao_Paulo` | Fuso padrão do agente. |
| `TALORYS_AGENT_NAME` | não | `Iris` | Nome padrão do agente. |
| `TALORYS_VAPID_SUBJECT` | não | `mailto:voce@exemplo.com.br` | Contato que os serviços de push (Google, Apple, Mozilla) podem usar. Sem ela, vai o endereço do app. Não crie também um segredo `VAPID_SUBJECT` no Worker. |
| `TALORYS_ALERT_EMAIL_FROM` | não | `talorys@exemplo.com.br` | Remetente dos avisos por e-mail, num domínio com o Cloudflare Email Routing ligado. Com ela, o deploy acrescenta o binding `send_email` (só esse remetente) e a variável `ALERT_EMAIL_FROM`. Veja [alerts.md](alerts.md#configurar-o-e-mail). |
| `TALORYS_ACCESS_TEAM_DOMAIN` | não | `minhaequipe.cloudflareaccess.com` | Cloudflare Access (passo 6). Só junto com a próxima. |
| `TALORYS_ACCESS_AUD` | não | 64 caracteres hexadecimais | A *Application Audience (AUD) Tag* do Access (passo 6). |

Com o domínio próprio (ou o `TALORYS_PUBLIC_URL`), o Talorys (interface e API)
responde **só** nesse endereço. Qualquer outro host recebe 404.

#### E o endereço `*.workers.dev`?

Com `TALORYS_CUSTOM_DOMAIN` definida, ele não fica exposto. São três camadas:

1. O deploy publica com `workers_dev: false` e `preview_urls: false`, então a
   Cloudflare desliga o endereço `<worker>.<conta>.workers.dev` e as URLs de
   preview de cada versão.
2. Mesmo que alguém religue o `workers.dev` pelo painel, o Worker só atende o
   host de `TALORYS_ALLOWED_HOSTS` (o seu domínio) e devolve 404 a qualquer
   outro, na interface e na API.
3. Depois de cada deploy, o workflow confere que `http://` redireciona para
   `https://`, pergunta à API da Cloudflare se o `workers.dev` e as URLs de
   preview do Worker estão desligados e testa de fora que o endereço
   `workers.dev` não responde. Se algo falhar, o deploy fica vermelho. O
   subdomínio da conta sai mascarado no log.

> **Não crie esses segredos no nível do repositório** (Settings → Secrets →
> Actions → *Repository secrets*). No nível do repositório, qualquer workflow,
> de qualquer branch, consegue lê-los. No ambiente, só o job de deploy na `main`.

### 4. Proteger a `main`

As regras de branch (`.github/rulesets/`, veja [branch-protection.md](branch-protection.md)) exigem PR e CI verde para mesclar na `main`. Com
elas, **o merge é o portão**: nada vai ao ar sem passar pela revisão e pelos
testes. Se ainda não aplicou as regras, siga o
[branch-protection.md](branch-protection.md).

### 5. Primeiro deploy e segredos do Worker

O Worker só passa a existir no primeiro deploy, e só responde depois de
receber a senha e o segredo de sessão. Por isso o primeiro deploy **falha de
propósito no health check**: ele cria o Worker, você grava os segredos e roda
de novo.

1. **Levar o código para a `main`:** GitHub → **Pull requests → New pull
   request** → base `main`, compare `develop` → *Create pull request*. Espere
   o CI ficar verde e clique em *Merge*.
2. O merge dispara o workflow **Deploy** (aba **Actions**). Se o ambiente exige
   aprovação, clique em *Review deployments → Approve and deploy*.
   Para rodar sem merge: Actions → **Deploy** → *Run workflow* → branch `main`.
3. O job `deploy` publica o Worker e termina vermelho no passo *Health check*
   (HTTP 503). É o esperado neste primeiro deploy.
4. Painel da Cloudflare → **Workers & Pages** → o Worker com o nome de
   `TALORYS_WORKER_NAME` → **Settings → Variables and Secrets → Add**. Para
   cada linha abaixo, escolha o tipo **Secret** (nunca *Text*), cole o valor e
   clique em *Deploy*:

| Segredo | Obrigatório | Valor |
| --- | --- | --- |
| `OWNER_PASSWORD` | sim | A senha de acesso ao Talorys. Gere no gerenciador de senhas (20+ caracteres) e guarde lá. |
| `SESSION_SECRET` | sim | 48+ caracteres aleatórios, gerados no gerenciador de senhas. Ninguém precisa digitá-lo. |
| `MCP_CREDENTIAL_KEY` | não | 48+ caracteres aleatórios. Só para guardar tokens de servidores MCP. |
| `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` | não | Notificações push. Podem ficar para depois (veja [deployment.md](deployment.md)). |
| `TELEGRAM_BOT_TOKEN` | não | Token do bot do Telegram (criado no @BotFather) para receber avisos no Telegram. Veja [alerts.md](alerts.md#configurar-o-telegram). |
| `ALERT_EMAIL_TO` | não | O seu e-mail, verificado no Email Routing, para receber os avisos por e-mail (sem ele, vale o `OWNER_EMAIL`). Veja [alerts.md](alerts.md#configurar-o-e-mail). |

5. Volte ao GitHub → **Actions** → a execução que falhou → **Re-run failed
   jobs**. Agora o health check responde 200 e o job fica verde.
6. Abra o endereço (o domínio próprio ou o `*.workers.dev`) e entre com a
   senha. Em Configurações → Sobre, confira a versão publicada.

Os segredos ficam guardados no Worker: os próximos deploys os preservam e
nunca passam pelo GitHub.

<details>
<summary>Alternativa pelo terminal (Wrangler)</summary>

Com o Wrangler logado na sua conta (`npx wrangler login`), antes ou depois do
primeiro deploy. O primeiro comando cria o Worker vazio se ainda não existir.
Troque `talorys` pelo valor de `TALORYS_WORKER_NAME`.

```bash
cd apps/agent
npx wrangler secret put SESSION_SECRET --name talorys     # 32+ caracteres aleatórios
npx wrangler secret put OWNER_PASSWORD --name talorys     # ou OWNER_PASSWORD_HASH
npx wrangler secret put MCP_CREDENTIAL_KEY --name talorys # opcional
npx wrangler secret put VAPID_PUBLIC_KEY --name talorys   # opcional (push)
npx wrangler secret put VAPID_PRIVATE_KEY --name talorys  # opcional (push)
npx wrangler secret put TELEGRAM_BOT_TOKEN --name talorys # opcional (Telegram)
npx wrangler secret put ALERT_EMAIL_TO --name talorys     # opcional (e-mail)
```

Para gerar um valor aleatório: `openssl rand -base64 48`. Digite os valores
quando o Wrangler pedir; não os passe na linha de comando (ficariam no
histórico do shell).

</details>

### 6. (Recomendado) Cloudflare Access na frente

O Access pede o seu e-mail (com um código enviado a ele) antes de a página do
Talorys abrir. Quem não for você nem chega à tela de login. O Talorys confere a
assinatura do Access em cada requisição, então um endereço esquecido fora do
Access não serve de atalho. O plano Free do Zero Trust atende até 50 usuários;
no cadastro, a Cloudflare pode pedir um meio de pagamento.

1. Painel da Cloudflare → **Zero Trust**. No primeiro acesso, escolha o nome da
   equipe: o endereço fica `<equipe>.cloudflareaccess.com`.
2. **Access → Applications → Add an application → Self-hosted**:
   - **Application domain:** o seu `TALORYS_CUSTOM_DOMAIN`, sem caminho.
   - **Session duration:** `12 hours`, igual à duração máxima da sessão do app.
   - **Policy:** *Allow*, incluindo **Emails** = o seu e-mail.
3. Crie uma **segunda aplicação**, só para o health check do deploy:
   - **Application domain:** o mesmo domínio, com o caminho `api/health`.
   - **Policy:** *Bypass*, incluindo **Everyone**.
   - Sem cookie nem token, essa rota responde só `{"ok": true}`.
   - Se você usa o Telegram, crie uma **terceira aplicação** igual, com o caminho
     `api/telegram/webhook`. O Talorys continua exigindo o cabeçalho secreto do
     Telegram nessa rota (veja [alerts.md](alerts.md#configurar-o-telegram)).
4. Na primeira aplicação, aba **Overview**, copie a **Application Audience
   (AUD) Tag**.
5. No ambiente `production` do GitHub, crie as variáveis
   `TALORYS_ACCESS_TEAM_DOMAIN` e `TALORYS_ACCESS_AUD`. Depois rode o Deploy
   (Actions → **Deploy** → *Run workflow*).
6. Abra o endereço: o Access pede o e-mail e o código, e só então o Talorys
   pede a senha.

> **Ordem importa.** Crie as variáveis só depois que o Access estiver
> funcionando no domínio. Com as variáveis e sem o Access, toda requisição
> recebe 403. Para desligar o Access, apague as duas variáveis e rode o Deploy.

**Tokens de acesso remoto** (scripts que usam `Authorization: Bearer`) também
passam pelo Access. Crie um *Service Token* em **Access → Service Auth**,
acrescente à primeira aplicação uma política *Service Auth* que inclua esse
token, e mande os cabeçalhos `CF-Access-Client-Id` e `CF-Access-Client-Secret`
junto com o Bearer.

### Conferência final

- [ ] O endereço abre só em `https://` (digitar `http://` redireciona).
- [ ] O login funciona e uma senha errada é recusada.
- [ ] Com domínio próprio, `https://<worker>.<conta>.workers.dev` não responde.
- [ ] A aba **Deployments** do repositório mostra o ambiente `production` verde.
- [ ] Nenhum segredo aparece em Settings → Secrets → Actions → *Repository secrets*.
- [ ] Com o Access: uma janela anônima pede o e-mail antes de mostrar o Talorys.

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
  requisição ao Worker e uma leitura no Durable Object por deploy, e a
  conferência de HTTPS faz mais quatro (duas no domínio e duas no
  `workers.dev` desligado).
- **Interface pelo Worker:** como o Worker roda antes dos arquivos da
  interface, cada arquivo baixado conta como uma requisição ao Worker. Os
  arquivos de `/assets/` ficam em cache no navegador por um ano, então uma
  visita comum custa poucas requisições, muito abaixo das 100 mil por dia do
  plano gratuito.

## Checklist de segurança ao mexer no workflow

- Nunca usar `pull_request_target` nem `workflow_run` com código do PR.
- Nunca dar `environment: production` a um job que roda em PR.
- Nunca imprimir segredos, `env` inteiro ou o corpo do `/api/health`.
- Fixar actions novas pelo SHA completo, com a versão em comentário.
- Manter `permissions` no mínimo (`contents: read`).
