# Deploy

## Um comando

```bash
npx create-talorys@latest
```

### Etapas que o instalador executa

| Etapa | Implementação |
| --- | --- |
| Conferir Node.js ≥ 24, templates e o Wrangler embutido | `requirements.ts`, `scaffold.ts` |
| Detectar `wrangler` / `cf` globais (só informativo) | `requirements.ts` |
| Verificar o login ou abrir o OAuth no navegador (`wrangler login`) | `install.ts › ensureAuthenticated` |
| Escolher a conta (`wrangler whoami --json`) | `install.ts › chooseAccount` |
| Reservar nomes sem colisão | `install.ts › allocateNames` |
| Pedir a senha (oculta, com verificação de força) | `ui.ts`, `secrets.ts` |
| Gravar o manifesto `talorys.json` (sem segredos) | `manifest.ts` |
| Gravar o bundle do Worker, o frontend e os arquivos `wrangler.jsonc` gerados | `scaffold.ts`, `config.ts` |
| Conferir se o modelo do Workers AI existe (sem inferência) | `wrangler ai models schema` |
| Fazer o deploy do Worker privado (cria o DO com SQLite no primeiro deploy) | `wrangler deploy` |
| Guardar `OWNER_PASSWORD_HASH`, `SESSION_SECRET` e as chaves do Web Push (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) via stdin | `wrangler secret bulk` |
| Criar ou reconciliar o projeto do Pages e fazer o deploy dele | `wrangler pages project create`, `wrangler pages deploy` |
| Verificar pela URL pública | `verify.ts` |

O Worker sempre sobe antes do Pages, porque o service binding do Pages aponta
para ele.

### Configuração gerada do Worker

```jsonc
{
  "name": "talorys-<id>-agent",
  "main": "worker.js",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "TalorysAgent", "class_name": "TalorysAgent" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TalorysAgent"] }],
  "vars": { "TALORYS_INSTALLATION_ID": "…", "TALORYS_DEPLOYED_VERSION": "…", "TALORYS_DEFAULT_TIMEZONE": "…", "TALORYS_AGENT_NAME": "…" }
}
```

### Configuração gerada do Pages

```jsonc
{
  "name": "talorys-<id>-web",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2026-10-01",
  "services": [{ "binding": "AGENT", "service": "talorys-<id>-agent" }]
}
```

## Um Worker, sem Pages

Para publicar este build automaticamente a cada merge na `main`, veja
[Deploy automático pelo GitHub](deploy-github-actions.md).

`apps/agent/wrangler.standalone.jsonc` faz o deploy do Worker do agente com a
interface web como arquivos estáticos, então um único Worker serve as duas
coisas. O Worker roda antes de qualquer arquivo (`run_worker_first`), então a
interface passa pelas mesmas barreiras da API: HTTP simples é levado para HTTPS
(uma requisição com corpo é recusada), hosts fora de `TALORYS_ALLOWED_HOSTS`
recebem 404, o Cloudflare Access é verificado e os cabeçalhos de segurança de
`apps/web/public/_headers` são acrescentados. Use com ferramentas que fazem o
deploy de um único Worker:

```bash
npm run build -w @talorys/web
cd apps/agent
npx wrangler secret put OWNER_PASSWORD -c wrangler.standalone.jsonc
npx wrangler secret put SESSION_SECRET -c wrangler.standalone.jsonc   # 32+ caracteres aleatórios
npx wrangler deploy -c wrangler.standalone.jsonc
```

As notificações push são opcionais aqui; veja
[Notificações push](#notificações-push) para acrescentar as chaves. Para
conectar servidores MCP que pedem token, defina também `MCP_CREDENTIAL_KEY`
(veja [Servidores MCP remotos](mcp.md#configuração)). Para avisos no Telegram,
defina `TELEGRAM_BOT_TOKEN` (veja [Avisos](alerts.md#configurar-o-telegram)).
Para a Google Agenda, defina `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e
`MCP_CREDENTIAL_KEY` (veja [Google Agenda](google-calendar.md#configuração)).
Para avisos por e-mail pelo Cloudflare Email Routing (gratuito para o seu
endereço verificado), acrescente o binding `send_email`, a variável
`ALERT_EMAIL_FROM` e o segredo `ALERT_EMAIL_TO` (veja
[Avisos](alerts.md#configurar-o-e-mail)). Para pedir o Cloudflare Turnstile
(gratuito) nos logins arriscados, defina a variável `TURNSTILE_SITE_KEY` e o
segredo `TURNSTILE_SECRET_KEY` (veja
[Segurança](security.md#verificação-contra-robôs-turnstile)).

`OWNER_PASSWORD` é a senha em texto puro, para deploys que não conseguem gerar o
hash antes. Ela precisa passar na verificação de força do instalador (10+
caracteres com tipos variados ou 16+ caracteres, sem palavras comuns); uma senha
fraca conta como não configurada e `/api/health` informa `"password": false`.
Quando `OWNER_PASSWORD_HASH` está definido, ele tem prioridade.

Nesse modo, trocar `SESSION_SECRET` também descarta uma senha trocada pela
interface: o login volta para `OWNER_PASSWORD` e todos os dispositivos são
desconectados.

A configuração dá ao Worker o nome `talorys`, e `wrangler deploy` substitui
qualquer Worker com esse nome na conta. Troque `name` (ou passe `--name`) para
fazer o deploy com outro nome.

## Notificações push

O Web Push precisa de um par de chaves VAPID guardado como dois segredos do
Worker. O instalador os cria numa instalação nova, e
`npx create-talorys@latest update` os acrescenta a uma instalação feita antes de
o push existir. Chaves existentes nunca são substituídas, porque chaves novas
desconectariam todos os dispositivos inscritos.

Sem as chaves, todo o resto funciona: `/api/health` informa `"push": false` e
as Configurações mostram o push como indisponível. Para acrescentá-las à mão
(por exemplo, num deploy de um Worker só), gere um par P-256 no formato
base64url de costume, por exemplo com `npx web-push generate-vapid-keys`, e
guarde as duas:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY    # acrescente -c wrangler.standalone.jsonc num deploy de um Worker só
npx wrangler secret put VAPID_PRIVATE_KEY
```

O `VAPID_SUBJECT` opcional (`mailto:voce@exemplo.com` ou uma URL `https://`) é o
contato que os serviços de push veem. Por padrão é a URL do próprio app,
registrada quando cada dispositivo se inscreveu. Defina-o com
`npx wrangler secret put VAPID_SUBJECT`; uma variável comum seria descartada
quando uma atualização gerasse de novo a configuração do Worker.

## Seu próprio domínio

```bash
npx create-talorys@latest update --domain talorys.exemplo.com
```

`--domain` faz o instalador usar esse endereço para tudo: as verificações de
saúde, `status`, `doctor` e a URL que ele imprime. Ele também define
`TALORYS_ALLOWED_HOSTS` no Worker, então a API só responde nesse domínio e os
endereços `*.pages.dev` do projeto (inclusive os de deploys antigos) param de
funcionar. O domínio fica registrado em `talorys.json`; as próximas
atualizações o mantêm, e `--domain none` volta para o `pages.dev`.

O Wrangler não consegue ligar um domínio a um projeto do Pages, então faça isso
uma vez no painel: Workers & Pages → seu projeto → **Custom domains** → *Set up
a custom domain*. Enquanto o certificado não estiver ativo, a verificação de
saúde falha; rode o mesmo comando de novo alguns minutos depois.

Use um subdomínio como `talorys.exemplo.com`, não o domínio raiz: o app envia
HSTS com `includeSubDomains`, então os navegadores passariam a exigir HTTPS em
todos os hosts daquele domínio por dois anos.

As inscrições de push pertencem ao endereço em que o dispositivo se inscreveu.
Depois de uma mudança de endereço, os dispositivos do endereço antigo são
removidos quando você abre as Configurações no novo; ligue o push de novo lá.

## Idempotência e recuperação

- O manifesto registra o id da instalação; novas execuções reutilizam os mesmos nomes.
- Segredos que já existem nunca são sobrescritos (a senha não é pedida de novo).
- Projetos do Pages existentes são reutilizados; os Workers são atualizados no lugar.
- Falhas marcam o manifesto como `failed`, com as etapas concluídas; rodar de novo continua de onde parou.
- O instalador nunca roda comandos de exclusão.
- Uma pasta não vazia sem manifesto é recusada, para que nada alheio seja sobrescrito.
- Os nomes de recursos novos são conferidos com os Workers e projetos do Pages existentes.

## Atualizações

`npx create-talorys@latest update` renova os artefatos, mantém os mesmos nomes e
a mesma classe do Durable Object, acrescenta (nunca edita) migrations, mantém os
segredos e verifica tudo de novo. As migrations de schema rodam em transação
dentro do Durable Object.

O Cloudflare Pages mantém todos os deploys anteriores acessíveis no endereço
`<hash>.<projeto>.pages.dev` de cada um, ligados ao mesmo backend. Depois de uma
atualização que corrige a interface web, exclua os deploys antigos no painel
(Workers & Pages → seu projeto → Deployments) ou com
`npx wrangler pages deployment delete <id> --project-name <projeto>`, para que
uma cópia antiga da interface não possa ser usada para roubar a senha do dono.

## Permissões

O login por OAuth (padrão) usa os escopos padrão do Wrangler. Tokens de API
precisam de Workers Scripts:Edit, Cloudflare Pages:Edit, Workers AI:Read e
Account Settings:Read. Uma Global API Key nunca é necessária.

## Publicar o pacote npm (mantenedores)

Este fork publica o instalador automaticamente, como o pacote privado
`@pablopfg/create-talorys` no GitHub Packages, depois de cada release: veja
[releases.md](releases.md#instalador-no-github-packages). À mão:

```bash
npm run build -w create-talorys   # gera dist/ e templates/
npm run test:pack                 # verifica o tarball fora do monorepo
cd packages/create-talorys && npm publish
```

`TALORYS_VERSION` em `packages/shared/src/constants.ts` precisa ser igual à
versão do pacote.

## Teste rápido numa conta real

```bash
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run test:smoke
# acrescente TALORYS_SMOKE_AI=1 para incluir um turno de chat do Workers AI em streaming
```
