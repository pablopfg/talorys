# Segurança

O Axis é de um único usuário. O modelo de ameaças supõe que a internet
consegue chegar à sua URL `pages.dev`; só o dono deve conseguir ler ou alterar
os dados.

## Autenticação

- A senha do dono vira hash **na máquina do instalador** com PBKDF2-HMAC-SHA256
  (100.000 iterações, o máximo do Workers, e salt aleatório de 16 bytes) e fica
  guardada como o segredo `OWNER_PASSWORD_HASH` do Worker. O texto da senha
  nunca sai da máquina, nunca é gravado em disco e nunca aparece em log. A
  exceção é um [deploy de um Worker só](deployment.md#um-worker-sem-pages)
  com `OWNER_PASSWORD`: nesse caso o texto da senha fica guardado como um
  segredo (cifrado) do Worker. Ela precisa passar na verificação de força do
  instalador, ou o Worker trata a senha como não configurada e recusa todo
  login.
- Um `SESSION_SECRET` de 256 bits é gerado localmente e guardado como segredo do
  Worker.
- As sessões são tokens aleatórios de 256 bits num cookie `HttpOnly; Secure;
  SameSite=Strict; Path=/` chamado `__Host-talorys_session`. Fora do
  desenvolvimento, o Worker recusa HTTP simples e sempre emite esse cookie,
  nunca o sem prefixo usado no desenvolvimento local. O banco guarda só
  `HMAC(SESSION_SECRET, token)`; um vazamento do armazenamento não pode ser
  reaproveitado.
- Uma sessão termina no servidor, no que acontecer primeiro, depois de:
  - **30 minutos sem uso** (um clique, uma tecla, a roda do mouse: só contam as
    requisições que o dono iniciou, marcadas com o cabeçalho
    `x-talorys-activity`, nunca o polling em segundo plano);
  - **5 minutos sem nenhuma aba aberta** (uma aba por navegador envia um sinal
    de presença para `POST /api/auth/heartbeat` uma vez por minuto);
  - **6 horas** no total, com uso ou sem.
  Enquanto o dono continua usando uma aba aberta, só o máximo encerra a sessão.
  O dono pode mudar esses tempos em **Configurações → Segurança → Saída
  automática** (5 a 60 minutos, 3 a 15 minutos, 1 a 24 horas); aumentar
  qualquer um deles pede a senha de novo. O navegador avisa 2 minutos antes do
  fim, desconecta todas as abas de uma vez, e o cookie de sessão não tem data de
  validade, então some quando o navegador fecha. Sair e "encerrar as outras
  sessões" revogam no servidor; sair também envia `Clear-Site-Data: "cache"`
  (não `"cookies"`, que apagaria também os cookies de todos os outros sites do
  seu domínio, inclusive os do Cloudflare Access), e cada encerramento fica no
  registro de atividade. No máximo 20 sessões são mantidas.
- Entrar encerra a sessão que o navegador já tinha, então um cookie plantado
  antes do login não pega carona.
- Trocar a senha pela interface encerra todas as sessões e tokens de acesso,
  inclusive a atual, e entra de novo neste navegador numa sessão nova.
- `reset-password` (CLI) substitui o segredo; o Durable Object percebe a
  impressão digital diferente, descarta qualquer senha definida pela interface,
  desliga a verificação em duas etapas (para que um celular perdido nunca deixe
  o dono trancado para fora de vez) e revoga todas as sessões.
- Ações sensíveis exigem a senha digitada nos últimos 15 minutos nesta sessão:
  exportar ou importar um backup, ligar o acesso remoto e criar um token de
  acesso. Entrar conta; depois disso o app pede a senha de novo
  (`POST /api/auth/confirm`, com o mesmo limite de tentativas do login). Com a
  verificação em duas etapas ligada, um código atual do app autenticador vale
  no lugar da senha (os códigos de recuperação, não). Um cookie de sessão
  roubado, sozinho, não consegue levar os dados nem abrir uma porta dos fundos.
  Desligar o acesso remoto e revogar tokens nunca pedem a senha.
- Não existe endpoint de cadastro, de configuração inicial nem de
  reivindicação de dono.

## Verificação em duas etapas

Opcional, e recomendada: enquanto estiver desligada, o app mostra um lembrete
em todas as telas, menos nas Configurações (dá para adiar por 3 dias num
navegador, nunca para sempre).

- **App autenticador (TOTP, RFC 6238).** HMAC-SHA1, 6 dígitos, passos de 30
  segundos, como todo app autenticador espera. Um código do passo anterior ou
  do seguinte também vale, para um relógio de celular um pouco fora; um passo
  já usado nunca vale de novo, então um código visto por cima do ombro não pode
  ser reaproveitado. Ligar mostra um QR code (desenhado no navegador, nunca
  enviado a lugar nenhum) e a chave em texto, e só vale depois do primeiro
  código certo.
- **O segredo** fica cifrado com AES-256-GCM sob uma chave derivada (HKDF) do
  `SESSION_SECRET`, então uma cópia do armazenamento do Durable Object, sozinha,
  não consegue gerar códigos. Ele nunca é mostrado de novo depois da
  configuração e nunca entra em backup. Se o `SESSION_SECRET` mudar, os códigos
  do app param de funcionar; os códigos de recuperação continuam valendo, e
  `reset-password` desliga a segunda etapa.
- **Códigos de recuperação.** 10 códigos de uso único com 80 bits aleatórios,
  mostrados uma vez (copiar ou baixar) e guardados só como hashes SHA-256. Cada
  um faz um login no lugar do código do app; usar um avisa o dono. As
  Configurações mostram quantos restam e pedem novos quando sobram 2 ou menos.
- **Login.** Uma senha certa com a segunda etapa ligada não abre sessão: ela
  define `__Host-talorys_mfa` (aleatório, 5 minutos, `HttpOnly; Secure;
  SameSite=Strict`), cujo HMAC aponta para uma linha de desafio no banco. O
  desafio aceita 5 códigos errados; depois, a senha é pedida de novo; no
  máximo 5 desafios são mantidos. A tentativa de senha continua contando como
  falha no [limite contra força bruta](#força-bruta) até o código também estar
  certo, então saber a senha não dá tentativas a mais. Cada tentativa é
  descontada do desafio antes de o código ser conferido, então requisições em
  paralelo não conseguem dividir uma contagem. Passados 10 códigos errados em 15
  minutos, somando todas as redes, só as redes de onde o dono entrou nos últimos
  30 dias podem tentar códigos até a janela passar, então abrir desafios a
  partir de muitos endereços também não dá tentativas a mais. Três códigos
  errados seguidos avisam o dono, porque significam que a senha é conhecida.
  Trocar a senha encerra todos os logins que esperam o código.
- **Mudar a configuração.** Ligar ou desligar e gerar novos códigos de
  recuperação exigem a senha digitada nos últimos 15 minutos e um código atual
  (desligar também aceita um código de recuperação). Ligar ou desligar encerra
  todas as outras sessões e avisa o dono. Códigos errados ao desligar, ao gerar
  novos códigos ou ao confirmar a identidade para uma ação sensível contam no
  limite de tentativas do login e como códigos errados da segunda etapa: a
  mesma pausa de 10 em 15 minutos e o mesmo alerta depois de 3 seguidos, então
  uma sessão roubada também não consegue chutar códigos.
- **Atividade.** Cada etapa aparece na [atividade de acesso](#atividade-de-acesso):
  código pedido, código errado (e o motivo), qual fator fez o login, ligado ou
  desligado, códigos novos. Os códigos em si nunca vão para o registro.
- **Passkeys.** Com a verificação em duas etapas ligada, **Configurações →
  Segurança → Passkeys** adiciona passkeys (Face ID, Touch ID, Windows Hello,
  Android, um gerenciador de senhas ou uma chave de segurança) como outra forma
  de fazer a segunda etapa: depois da senha, **Usar uma passkey** em vez de
  digitar um código. Elas exigem a verificação em duas etapas ligada, então os
  códigos de recuperação continuam sendo o caminho de volta; desligá-la (ou
  rodar `reset-password`) remove todas as passkeys. Só a chave pública e o
  contador de assinaturas ficam guardados; o desafio de cada pedido é
  aleatório, fica no servidor, é vinculado ao domínio e à origem da própria
  página e é usado uma vez, certo ou errado, então uma página falsa que
  repasse o pedido recebe uma resposta que é recusada. Um contador que volta
  para trás (uma chave de segurança copiada) também é recusado. Uma resposta
  errada conta como um código errado. Adicionar ou remover uma exige a senha
  digitada nos últimos 15 minutos, fica no registro e gera um alerta de
  segurança. No máximo 10. Uma passkey pertence ao domínio onde foi criada: uma
  criada no endereço `workers.dev` não funciona no seu domínio próprio, então
  adicione-as depois de passar para o domínio próprio (a lista marca as outras
  como "Outro endereço").

## Recuperação de senha por e-mail

**Esqueceu a senha?** na tela de login manda por e-mail um link de uso único,
quando os avisos por e-mail estão configurados (Cloudflare Email Routing, veja
[Avisos](alerts.md#configurar-o-e-mail)) e o deploy conhece o próprio endereço
(`TALORYS_ALLOWED_HOSTS`, definido a partir do domínio próprio ou de
`TALORYS_PUBLIC_URL`). Sem um dos dois, a opção não aparece e `reset-password`
(CLI) continua sendo o caminho de volta.

- **Sem enumeração.** O pedido sempre responde do mesmo jeito. O endereço
  digitado sempre precisa bater com o do dono (`OWNER_EMAIL`, ou então o
  destinatário dos avisos), comparados como hashes com chave, então quem não o
  conhece não consegue substituir o link nem gastar os e-mails do dia. O link
  vai só para o destinatário verificado (`ALERT_EMAIL_TO`, ou então
  `OWNER_EMAIL`), nunca para o que foi digitado.
- **O link não pode ser desviado.** O host dele vem da configuração do deploy,
  nunca do cabeçalho `Host` da requisição. O token (256 bits) vai no fragmento
  da URL, que os navegadores nunca enviam ao servidor, e a página o tira da
  barra de endereço assim que o lê. Só um HMAC do token (com a chave
  `SESSION_SECRET`) fica guardado.
- **Curto e único.** 30 minutos, um uso, e cada e-mail novo substitui o link
  anterior. 5 tentativas por link (um código errado da segunda etapa conta;
  uma senha nova recusada, não); depois disso ele para de funcionar. Redefinir a
  senha pela CLI anula um link pendente, e nenhum link funciona enquanto a
  recuperação estiver desligada.
- **Com limites.** 3 pedidos por rede em 15 minutos, 3 e-mails de recuperação
  por dia no total, e os limites de tentativas do login valem (uma rede
  bloqueada não consegue pedir). Os e-mails de recuperação saem da cota comum
  de avisos, nunca da parte reservada para os alertas de segurança; quando não
  há espaço, o último link continua valendo. Com o Turnstile ligado, todo pedido
  precisa passar por ele. Um token errado conta como login sem sucesso.
- **A verificação em duas etapas continua valendo.** Com ela ligada, a senha
  nova também exige um código do app autenticador ou um código de recuperação,
  pedido só depois que o link é aceito, com as mesmas proteções do login (pausa
  por códigos errados, alerta depois de códigos errados seguidos). A senha nova
  é conferida (força, verificação de vazamentos) antes do código, então um
  código de recuperação nunca é gasto numa senha recusada. Perder o e-mail e o
  segundo fator ao mesmo tempo continua significando `reset-password`.
- **Tudo é encerrado.** Definir a senha nova desconecta todas as sessões, revoga
  os tokens de acesso remoto e os desafios da segunda etapa pendentes e gera o
  alerta de segurança "Senha redefinida por e-mail" em todos os canais. A
  atividade de acesso registra o pedido (enviado, endereço que não é o seu,
  limite diário) e a redefinição.

## Força bruta

3 logins sem sucesso por cliente em 15 minutos bloqueiam aquele cliente. Um
cliente é o endereço IP do `CF-Connecting-IP` (fora do desenvolvimento, uma
requisição sem ele é recusada, para não cair num grupo compartilhado), ou o /64
inteiro no IPv6, já que um assinante costuma ter um /64 e poderia, de outro
jeito, ir trocando de endereço. Quando 25 falhas se acumulam somando todos os
clientes na janela (um ataque distribuído), o login nunca é bloqueado para
todo mundo: as redes que entraram com sucesso nos últimos 30 dias mantêm o
limite normal, e qualquer outra rede recebe uma única tentativa por janela.
Chutar a partir de muitos endereços fica reduzido a um chute por endereço, e o
dono numa rede nova ainda consegue entrar uma vez. O dono recebe um aviso quando
isso começa (no máximo a cada 6 horas). As respostas incluem `Retry-After`. A
troca de senha e a confirmação de senha usam o mesmo limitador.

### Verificação contra robôs (Turnstile)

Com o Cloudflare Turnstile configurado (a variável `TURNSTILE_SITE_KEY` e o
segredo `TURNSTILE_SECRET_KEY` do Worker; os dois, ou ele fica desligado), o
login só pede a verificação quando um login parece arriscado:

- a rede errou a senha nos últimos 15 minutos, ou
- 10 falhas se acumularam somando todas as redes na janela (um ataque em
  andamento) e a rede não entrou com sucesso nos últimos 30 dias.

Todo o resto entra só com a senha, e a verificação nunca substitui os limites
acima: uma rede bloqueada recebe o pedido de espera antes de qualquer outra
coisa. O Worker confirma o token do widget no `siteverify` da Cloudflare antes
de a tentativa ser contada e antes de qualquer hash de senha, então um robô sem
token válido não custa trabalho de PBKDF2 nem gasta um chute. As verificações
recusadas são contadas por rede: passadas 10 na janela, a rede recebe o pedido
de espera como qualquer rede bloqueada, antes de qualquer chamada ao
`siteverify`, e as linhas dela na atividade de acesso são agrupadas como as
tentativas bloqueadas. O token precisa vir da ação `login` e, com hosts
permitidos definidos, de um desses nomes de host; a Cloudflare aceita cada token
uma vez. Se o `siteverify` não responder, o login é recusado (falha fechada) com
uma mensagem de "tente de novo em instantes". O script e o frame do widget vêm
de `challenges.cloudflare.com`, a única origem de terceiros na CSP, e só são
carregados quando o formulário precisa deles. Cada recusa vira uma linha
"Verificação contra robôs não aprovada" na atividade de acesso. A chave secreta
é só um segredo do Worker, nunca fica no repositório nem no GitHub.

## Atividade de acesso

**Configurações → Segurança → Atividade de acesso** lista todos os logins,
tentativas sem sucesso, tentativas bloqueadas, saídas (manuais, automáticas ou a
partir de outra sessão), trocas e confirmações de senha e todos os tokens de
acesso recusados. Cada registro guarda o horário, o IP do cliente e a rede dele
para o limite de tentativas, o país, a região, a cidade, o ASN e o data center
da borda, o host, o user agent (no máximo 300 caracteres), se o navegador
trazia um cookie de dispositivo conhecido e os 16 primeiros caracteres do id
público da sessão.

- **Nunca guardados:** senhas, códigos, tokens e o endereço de e-mail digitado
  numa tentativa sem sucesso.
- **A localização vem só da borda da Cloudflare.** O ponto de entrada do Worker
  remove qualquer cabeçalho `x-talorys-client-geo` que o cliente envie e o
  define a partir de `request.cf`; a API nunca confia numa localização vinda do
  navegador.
- **Com limites.** Passadas 20 falhas de uma rede em 15 minutos, as falhas
  seguintes viram uma única linha com contador. Uma rede bloqueada recebe uma
  linha por janela, e o contador dela chega ao armazenamento no máximo uma vez
  por minuto, então martelar um login bloqueado não custa gravações a mais. No
  máximo 50.000 linhas detalhadas são mantidas, 5.000 delas reservadas para os
  eventos do próprio dono (logins, saídas, trocas de senha): uma enxurrada de
  recusas empurra para fora recusas mais antigas, nunca o registro de quem
  entrou. O texto perde os caracteres de controle, e a exportação em CSV escapa
  as células que uma planilha executaria como fórmula.
- **Retenção (LGPD).** Os detalhes com IP e user agent ficam 90 dias por padrão
  (30 a 180, nas Configurações) e depois são reduzidos a contagens diárias por
  país e tipo, sem IP nem user agent, guardadas por um ano. A base legal é o
  legítimo interesse do controlador na segurança da conta (LGPD art. 7º, IX, e
  art. 46). As linhas vencidas são reduzidas no máximo uma hora depois de
  vencerem, sempre que a atividade é gravada ou lida. O dono pode exportar os
  registros detalhados em CSV ou apagar tudo. O resumo das últimas 24 horas
  aparece com a sessão; a lista detalhada, a exportação, a exclusão e qualquer
  mudança de retenção pedem a senha digitada nos últimos 15 minutos, então um
  cookie de sessão roubado, sozinho, não consegue ler os IPs nem apagar o
  registro.
- **Cookie de dispositivo.** Um login define `__Host-talorys_device` (aleatório,
  180 dias, `HttpOnly; Secure; SameSite=Strict`). O servidor guarda só o HMAC
  dele, para no máximo 50 dispositivos. Ele só distingue um navegador conhecido
  de um novo: nunca autentica, nunca dispensa a senha ou o segundo fator e
  nunca afrouxa o limite de tentativas.
- **Alertas.** Um login de um dispositivo novo ou de um país novo, depois do
  primeiro, cria uma notificação (e um push). O texto é genérico, então uma
  tela de celular bloqueada não mostra nada sobre onde nem como.
- **Não registrado:** requisições recusadas na entrada do Worker antes do
  agente (um host fora de `TALORYS_ALLOWED_HOSTS`, um token do Cloudflare
  Access ausente). Registrá-las custaria uma requisição ao Durable Object cada
  uma, então uma enxurrada de tráfego lixo gastaria o plano gratuito; as
  análises da própria Cloudflare e os logs do Access cobrem essas.

## CSRF

Toda requisição que não seja GET precisa levar `x-talorys-request: 1`
(formulários de outros sites não conseguem definir cabeçalhos próprios, e
nenhum CORS é concedido), um `Origin` igual à origem da requisição (ou um
`Sec-Fetch-Site` de mesma origem), e o cookie é `SameSite=Strict`.

## Exposição do backend

O Worker sobe com `workers_dev: false` e `preview_urls: false`. Ele só é
alcançável pelo service binding do Pages. Um deploy de um Worker só fica
público no `workers.dev`, atrás das mesmas verificações. A autorização é
aplicada no Worker em todas as rotas, menos `GET /api/health`,
`POST /api/auth/login` e `GET /api/auth/session`. Sem sessão ou token,
`GET /api/health` responde só `{ "ok": true|false }`; a versão, o schema e os
detalhes de configuração são para o dono. O nome da instância do agente é fixo
no servidor.

Duas barreiras opcionais rodam no ponto de entrada do Worker, antes do Durable
Object:

- **Hosts permitidos.** Com `TALORYS_ALLOWED_HOSTS` (separados por vírgula),
  qualquer outro host recebe 404. O deploy pelo GitHub o define com o domínio
  próprio (ou com o host `workers.dev` do `TALORYS_PUBLIC_URL`).
- **Cloudflare Access.** Com `TALORYS_ACCESS_TEAM_DOMAIN` e
  `TALORYS_ACCESS_AUD`, toda requisição precisa de um token
  `Cf-Access-Jwt-Assertion` assinado por aquele time para aquela aplicação
  (RS256, com audiência, emissor, validade e assinatura conferidos com as
  chaves publicadas do time). Um host que o Access não cobre, portanto, não
  consegue escapar da verificação. Só o `GET /api/health` anônimo, sem cookie
  nem token, fica de fora, para que um deploy consiga se verificar por uma regra
  de bypass do Access. Uma configuração pela metade responde 503 em vez de
  desligar a verificação. O webhook do Telegram (`POST /api/telegram/webhook`)
  também fica de fora, mas só sem cookie nem token e com o cabeçalho secreto do
  Telegram, um HMAC do `SESSION_SECRET` comparado em tempo constante (veja
  [alerts.md](alerts.md#segurança-do-telegram)).

## XSS e proteção do navegador

- O React escapa a saída; o Markdown é renderizado sem HTML bruto; imagens
  remotas na saída do modelo não são carregadas; links abrem com
  `noopener noreferrer`.
- `_headers` define uma CSP rígida (`script-src 'self'` mais
  `https://challenges.cloudflare.com` para o widget do Turnstile, `frame-src`
  só com essa origem, `connect-src 'self'`, `frame-ancestors 'none'`),
  `X-Frame-Options: DENY`, `nosniff`, HSTS
  (`max-age=63072000; includeSubDomains`; sirva o Axis num subdomínio, não
  no domínio raiz) e uma `Permissions-Policy` restritiva (câmera, localização e
  pagamento desligados; o microfone só para a própria origem do app, para a
  entrada de voz no chat).
- A entrada de voz envia um clipe gravado (no máximo 60 s e 2 MB) para
  `POST /api/transcribe`, que exige a sessão do dono e não está aberta a tokens
  de acesso remoto. O áudio vai só para o Workers AI e nunca é guardado; a
  transcrição tem um limite diário próprio de minutos de áudio.
- As mensagens de voz do Telegram vindas do chat privado vinculado do dono (no
  máximo 5 minutos e 5 MB) são baixadas só de `api.telegram.org`, sem seguir
  redirecionamentos, com o caminho do arquivo conferido e a leitura cortada
  depois de 5 MB. Elas compartilham a mesma trava de transcrição e o mesmo
  limite diário, e o áudio nunca é guardado.
- Os alertas de segurança (login novo, mudanças na verificação em duas etapas,
  muitos logins sem sucesso, um código de recuperação usado) são críticos, vão
  para todos os canais e insistem (de novo depois de 15 minutos e de 1 hora).
  Nada feito dentro do app interrompe isso: ler, rebaixar, silenciar ou excluir
  não interrompem, então alguém na sessão do dono não consegue calar o aviso
  sobre o que acabou de fazer. Só uma resposta pelo Telegram do dono (um botão
  ou uma mensagem no chat privado do bot) os confirma. As notificações push
  desses alertas não têm botões. Veja [alerts.md](alerts.md#insistência).
- Mudanças que abrem uma porta para os dados do dono também geram alerta de
  segurança: troca de senha, acesso remoto ligado, token de acesso criado, chat
  ou grupo do Telegram vinculado ou desvinculado, conversa pelo Telegram
  ligada, dispositivo de push adicionado (o que também exige a senha digitada
  há pouco) ou removido, servidor MCP adicionado, atividade de acesso apagada e
  backup exportado ou importado (gerado assim que a importação é gravada). Eles
  vão para todos os canais, e-mail incluído, mesmo quando quem fez a mudança
  está com a sessão aberta, e dizem só o que aconteceu (nunca o nome do token,
  o IP ou os dados). Excluir um alerta de segurança exige a senha digitada há
  pouco, e os 200 mais recentes ficam separados dos outros avisos, para que uma
  enxurrada de avisos de rotina não os empurre para fora do registro.
- Os avisos por e-mail usam o binding `send_email` do Cloudflare Email Routing,
  restrito a um remetente (`allowed_sender_addresses`) e capaz de entregar só
  para endereços verificados na conta. O Axis envia para um endereço (o
  segredo `ALERT_EMAIL_TO` ou `OWNER_EMAIL`, nunca no repositório), aceita só
  endereços simples, tira as quebras de linha do assunto, envia só texto puro e
  limita o e-mail a 10 mensagens em 24 horas (contadas antes de cada envio,
  inclusive as que falham), seja qual for a prioridade. As 4 últimas ficam
  reservadas para alertas de segurança e críticos, e o e-mail de teste exige a
  senha digitada há pouco e sai no máximo duas vezes por dia, então uma sessão
  roubada não consegue esgotar o limite antes de agir. Só a primeira tentativa
  de um aviso vai por e-mail. Os logs trazem o código do erro, nunca os
  endereços. Todo e-mail de segurança diz que o Axis nunca pede a senha nem
  códigos por e-mail.
- A prioridade aprendida nunca mexe nos alertas de segurança: eles não têm
  perfil, são sempre críticos, não podem ser fixados, e rebaixar um (pelo app,
  pela API ou pelo Telegram) é recusado. O aprendizado não consegue tornar
  nenhum aviso crítico, e os eventos de fora do Axis ficam no máximo em alta.
  As correções do dono chegam ao modelo só como um bloco de dados (com as tags
  neutralizadas), nunca como instruções.
- Os vigias (a cada 15 minutos) são verificações determinísticas em SQL, sem IA
  e sem chamadas externas, a não ser a verificação de atualizações no npm uma
  vez por dia, quando o dono a ligou. Títulos de tarefas e nomes de rotinas e de
  servidores MCP entram no texto dos avisos com os links desarmados; cada
  rodada gera no máximo 5 avisos de tarefa, e as chaves de deduplicação evitam
  que uma descoberta se repita. Os avisos insistentes de tarefas atrasadas
  contam no limite de 20 avisos insistindo ao mesmo tempo.
- Os botões das notificações push (Feito, Adiar, Silenciar) chamam
  `POST /api/notifications/:id/action` a partir do service worker, com o cookie
  de sessão e o cabeçalho CSRF, como o app; tokens de acesso remoto não chegam
  lá.
- As respostas da API levam a própria
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `X-Frame-Options: DENY` e HSTS, então uma resposta JSON aberta diretamente não
  consegue carregar nada nem ser posta num frame.
- As inscrições de push precisam ter exatamente uma chave P-256 de 65 bytes e um
  segredo de 16 bytes, como a RFC 8291 exige.
- O service worker (`/sw.js`) só mostra notificações push e não guarda nada em
  cache; um clique numa notificação só consegue abrir um caminho na própria
  origem do app.
- O corpo das notificações mostra todo link, em qualquer forma de Markdown, como
  código simples ao lado do rótulo: um lembrete, resumo ou rotina não consegue
  plantar um link clicável que o dono tome como sendo do próprio Axis.
- Não existem segredos nem bindings no código do navegador (o build confere
  isso).

## Prompt injection e segurança das ferramentas

- O prompt de sistema marca notas, memórias, resultados de ferramentas e
  histórico como dados.
- As ferramentas destrutivas (`delete_task`, `delete_note`, `forget_memory`,
  `cancel_automation`, `replace_note_content`) nunca rodam durante o turno do
  agente. Elas só criam uma proposta; o dono aprova ou recusa com um botão (uma
  requisição autenticada e protegida contra CSRF), e cada proposta roda no
  máximo uma vez. Uma proposta de reescrita de nota mostra o texto novo
  completo no cartão.
- Uma proposta fica vinculada ao item como ele foi mostrado: se o item mudar
  antes de o dono aprovar (uma edição, outra aba, uma importação de backup), a
  aprovação falha e nada é feito.
- Os planos de tarefas (`propose_task_plan`) só guardam um rascunho. As tarefas
  são criadas pela requisição autenticada de confirmação do dono, que fica
  vinculada à conversa e à revisão do rascunho, valida de novo o plano final no
  servidor e roda numa transação, no máximo uma vez. Rascunhos expirados,
  cancelados e desatualizados são recusados. As rotas de planos não são
  alcançáveis com tokens de acesso remoto.
- O agente não consegue apagar texto por conta própria: `update_note` só
  renomeia uma nota ou acrescenta texto a ela (até 50.000 caracteres),
  `update_task` só adiciona descrição a uma tarefa que não tem
  (`replace_task_description` é uma proposta; os títulos continuam podendo mudar
  sem aprovação), e `update_memory` salva o texto novo como uma memória nova,
  enquanto a antiga fica como fato passado. `complete_task` roda no máximo 3
  vezes por turno.
- As rotinas de IA (automações `agent_prompt`) rodam sem ninguém olhando, então
  o agente só consegue propor uma (`propose_ai_routine`): o cartão mostra o
  prompt completo e o agendamento, e nada é agendado até o dono aprovar. Uma
  nota, memória ou resultado de ferramenta que mande o modelo criar uma não
  consegue agendá-la sozinho. O agente não consegue repetir nenhum agendamento
  com frequência maior que de hora em hora, e no máximo 50 automações podem
  ficar ativas ao mesmo tempo.
- Memórias, o resumo da conversa e as tarefas, notas e lembretes encontrados
  entram no prompt de sistema dentro de blocos `<data>`, um item por linha, com
  tudo o que tiver a forma das próprias tags do bloco neutralizado, então um
  texto guardado não consegue fechar o bloco e se passar por regra. O resultado
  de uma chamada MCP aprovada entra do mesmo jeito, então a resposta de um
  servidor não consegue se passar pelo resultado de outra aprovação.
- Uma conversa restaurada de um backup aparece para o modelo como conversa
  passada, não como instruções do dono, e mantém esse rótulo quando é resumida.
- Os lembretes e automações que o agente cria guardam os links como texto
  visível e não clicável, e o resumo de tarefas mostra os títulos das tarefas do
  mesmo jeito, então um texto injetado não consegue plantar um link clicável
  numa notificação. `update_task` não consegue marcar uma tarefa como feita;
  isso passa por `complete_task` e pelo limite dela.
- As execuções de IA agendadas recebem ferramentas só de leitura mais
  `notify_owner`, que só existe ali. O título dela sempre começa com o nome da
  rotina, e os links nele, e na resposta da execução, aparecem como texto
  simples, não clicável.
- Fora do app, o Telegram e os clientes de e-mail transformam qualquer endereço
  em link, mesmo entre crases. Por isso, todo título e texto de aviso enviado ao
  Telegram ou por e-mail tem `http` escrito como `hxxp`, `tg:` e `mailto:` como
  `tg[:]` e `mailto[:]`, `www.` como `www[.]` e cada ponto de um host como
  `[.]`; só o botão **Abrir o Axis** e o rodapé do e-mail, do próprio
  Axis, continuam clicáveis.
- O nome do agente abre todo prompt de sistema: renomeá-lo exige a senha
  recente, um backup não consegue mudá-lo, e ele sempre entra numa linha só.
- Limites por requisição: chamadas de ferramenta, limites por ferramenta,
  detecção de chamadas duplicadas, passos de raciocínio, tokens de saída e de
  contexto; limites diários de pedidos de IA e de execuções de IA agendadas.
  Toda chamada de modelo (cada passo do laço de ferramentas e cada resumo de
  histórico) é contada no limite diário antes de ser feita, e as novas
  tentativas automáticas do SDK ficam desligadas, para que nenhuma chamada
  passe sem contar. Uma execução de IA agendada e um pedido de embedding também
  são contados antes da chamada, então requisições simultâneas não conseguem
  estourar os limites.
- Não existem ferramentas de shell, execução de código, credenciais ou deploy, e
  nenhuma ferramenta nativa faz requisições HTTP externas. Os envios de Web Push
  são feitos pelo serviço de notificações, nunca por uma ferramenta. As únicas
  ferramentas que chegam à rede são as ferramentas MCP remotas que o dono
  conectou e ligou (abaixo).

## Eventos de automações

- `POST /api/remote/events` só aceita um token remoto de escopo `events`, e esse
  escopo não alcança mais nada (`apps/agent/src/remote/middleware.ts`): um token
  do n8n vazado consegue gerar avisos, mas não consegue ler nem alterar dados.
- No máximo 60 eventos por hora e 100 em 24 horas, somando todos os tokens
  (contados antes de gerar o aviso, então repetições contam), corpos de no
  máximo 2 KB e nunca `critical`: a central de avisos limita a categoria Eventos
  em Alta, então um sistema de fora não consegue criar um aviso que só o
  Telegram consiga silenciar.
- Os eventos não conseguem tirar espaço dos avisos do dono: eles ficam só com a
  primeira metade do limite por hora e por dia de cada canal, no máximo 3
  insistem ao mesmo tempo (`EVENT_ALERTS`), e passados 50 pares de origem +
  tipo, os novos dividem um único perfil aprendido, então as prioridades
  aprendidas do dono nunca são empurradas para fora.
- Os títulos começam com a origem e ficam numa linha só; os links são
  desarmados (`hxxps://` entre crases), para que nem o app, nem o Telegram, nem
  um cliente de e-mail os torne clicáveis: um token vazado não consegue enviar
  um link de login convincente. Uma origem com o nome do app ou do agente
  (`Axis`) aparece como `remote`, então um evento não consegue se passar por
  um aviso do próprio Axis.

## Notificações push

- A chave privada VAPID é um segredo do Worker, gerado localmente pelo
  instalador e enviado ao Wrangler via stdin. Só a chave pública chega ao
  navegador.
- Os endpoints de inscrição vêm do navegador, então são tratados como URLs não
  confiáveis para as quais o Worker vai fazer POST. Só os serviços de push dos
  navegadores são aceitos (`fcm.googleapis.com`,
  `updates.push.services.mozilla.com`, `*.push.apple.com`,
  `*.notify.windows.com`; a lista está em `apps/agent/src/push/endpoint.ts`),
  por `https` na porta padrão e sem credenciais na URL. Redirecionamentos não
  são seguidos, cada envio expira em 10 segundos, e há no máximo 3 dispositivos.
- O conteúdo é cifrado para cada dispositivo (RFC 8291, `aes128gcm`). O serviço
  de push (Google, Mozilla, Apple ou Microsoft) vê o endpoint, o horário e o
  tamanho do texto cifrado, não o texto. O conteúdo é o título da notificação e
  os 240 primeiros caracteres do corpo, que a tela de bloqueio do dispositivo
  pode mostrar.
- As inscrições são segredos de cada dispositivo: nunca entram nos backups. Os
  endpoints que o serviço de push informa como inexistentes (404/410) são
  apagados na hora, e um que falha 10 vezes seguidas é descartado.
- Um dispositivo que não abriu o Axis com sessão por 7 dias é removido
  (conferido a cada 15 minutos, mesmo com os vigias desligados), então um
  celular perdido ou esquecido deixa de receber os avisos do dono sozinho. Um
  navegador com sessão informa o próprio endpoint para `POST /api/push/seen` no
  máximo uma vez por hora; a remoção fica no registro de atividade e o dono é
  avisado pelos canais restantes.
- Quando o navegador troca uma inscrição, o service worker envia a nova com o
  endpoint antigo em `replaces`; o servidor move aquele dispositivo sem pedir a
  senha recente e mantém o horário do último acesso. Os endpoints nunca são
  devolvidos pela API, então só o navegador que tinha um consegue indicá-lo.
- O envio roda em segundo plano e nunca faz falhar a automação, o lembrete ou o
  turno de chat que criou a notificação.
- As rotas (`/api/push/*`) exigem uma sessão e as verificações de CSRF, como
  todas as outras rotas do dono.

## Backups

Um arquivo de backup é uma entrada não confiável; importar um não consegue
mudar o que o Axis faz por conta própria:

- As automações novas chegam pausadas, e as existentes nunca são reescritas nem
  religadas (um backup só pode pausá-las).
- O modelo, os limites, o modo Demo, a memória automática, o histórico de
  memória, as instruções personalizadas e o nome do agente não são importados
  (os dois últimos entram em todo prompt de sistema).
- Os resumos de conversa são descartados; eles alimentam o prompt de sistema,
  mas são invisíveis na interface. Eles são gerados de novo a partir das
  mensagens visíveis.
- As mensagens importadas ficam marcadas como importadas. Tentar de novo as
  recusa, e as aprovações registradas são removidas, então elas nunca contam
  como entrada do dono.
- Atividade de ferramenta malformada é descartada, em vez de quebrar a tela do
  chat.
- Os servidores MCP chegam desligados, sem credencial e sem ferramentas ligadas;
  um servidor existente nunca é alterado, e URLs inseguras ou ids que não sejam
  UUIDs são pulados.
- As mensagens só entram em conversas que a importação cria ou que só têm
  mensagens importadas; um backup não consegue acrescentar turnos a uma
  conversa que você já tinha, nem mudar o título dela.
- Datas de vencimento que não sejam data e hora ISO completas são descartadas, e
  as memórias são cortadas em 2.000 caracteres, como a API permite.
- Uma data que não pode ser lida, ou que esteja mais de 5 minutos no futuro, é
  trocada pelo horário da importação e nunca substitui um registro local, então
  uma data forjada não consegue ganhar o "a cópia mais nova vence" contra as
  suas edições posteriores.
- Um arquivo tem no máximo 10 MB, com um limite de registros de cada tipo (por
  exemplo, 50.000 mensagens e 500 automações); passado qualquer um dos dois,
  nada é importado.
- Uma importação que passaria de algum limite de armazenamento (veja abaixo)
  é desfeita inteira, sem gravar nada.

## Limites de armazenamento e lixeira

O banco de cada instalação tem limites por tipo de dado, que mantêm o Axis
bem dentro do plano gratuito da Cloudflare (5 GB de Durable Objects por conta),
mesmo com um token de escrita vazado ou importações repetidas:

| Tipo | Limite |
|---|---|
| Memórias | 10.000 |
| Tarefas | 20.000 |
| Notas | 5.000 |
| Projetos | 1.000 |
| Conversas | 5.000 |
| Mensagens do chat | 200.000 |
| Automações | 500 |
| Tamanho total do banco | 4 GiB |

- No limite, o item novo é recusado com o erro `STORAGE_LIMIT_REACHED` (HTTP
  409) e uma mensagem clara. Nada é apagado para abrir espaço. No chat, só um
  turno novo é recusado: a resposta de um turno já em andamento é sempre salva.
- Em **Configurações → Privacidade → Armazenamento**, cada tipo mostra o uso, e
  um aviso aparece a partir de 80% de qualquer limite.
- Tarefas, notas e memórias excluídas (pelo dono, por uma ação aprovada do
  agente ou por um token de escrita) vão para a **lixeira** por 30 dias; as
  arquivadas ficam um ano no **arquivo**. Depois disso, são apagadas de vez,
  mesmo que você nunca abra a lixeira (a limpeza roda a cada 15 minutos).
- A lixeira tem um espaço separado para cada origem, contado em itens e em
  bytes: o dono (10.000 itens, 256 MB), os tokens de acesso (2.000 itens,
  64 MB) e o próprio Axis, que arquiva e combina itens (20.000 itens,
  256 MB). Quando o espaço do dono acaba, os itens mais antigos dele saem
  primeiro. Quando o espaço dos tokens acaba, a exclusão por token é recusada
  (e não acontece). Assim, um token vazado nunca empurra para fora da lixeira o
  que ele mesmo apagou, nem o que você apagou, e não consegue encher o banco
  por ela.
- Só a sessão do dono lista, restaura, exclui de vez ou esvazia a lixeira;
  tokens de acesso recebem 403. Restaurar respeita os limites, e um projeto ou
  uma memória ligada que não existe mais fica de fora.
- **Apagar todas as memórias** e excluir conversas continuam definitivos: essas
  ações de privacidade não passam pela lixeira. Apagar todas as memórias também
  apaga as memórias que estavam na lixeira. O backup exportado não inclui a
  lixeira.
- Resolver um conflito de memória com "substituir" ou "cancelar" continua
  excluindo de vez a versão descartada, porque é uma escolha explícita sua.

## Instalador

- Os comandos são iniciados com listas de argumentos (sem shell).
- Os segredos vão para o Wrangler só via stdin.
- Antes de gravar, o `talorys.json` é conferido para não conter nada parecido
  com um segredo.
- A saída de erros é limpa de textos parecidos com tokens.
- O pacote publicado traz o `npm-shrinkwrap.json`, então `npx create-talorys`
  instala exatamente a árvore de dependências que foi testada, com hashes de
  integridade, em vez das versões mais novas do dia. Depois de mudar as
  `dependencies` do instalador, rode `npm run shrinkwrap -w create-talorys`; os
  testes de release falham enquanto os dois discordarem.

## Dependências

- Todo `package.json` do repositório fixa versões exatas (`save-exact=true` no
  `.npmrc`), e o CI instala com `npm ci` a partir do lockfile versionado. Um
  teste falha em qualquer faixa como `^1.2.3`.
- O Dependabot propõe atualizações todos os dias, depois de uma espera de 3 a 14
  dias, então uma versão comprometida costuma ser retirada antes de chegar a um
  PR. As atualizações de segurança pulam essa espera.
- Com o npm 11 (que vem com o Node.js 26, do `.nvmrc`), nenhum script de
  instalação de dependência roda: o npm os bloqueia por padrão, e o campo
  `allowScripts` do `package.json` da raiz registra os que estão na árvore como
  negados (`esbuild`, `workerd`, `core-js-pure`). Os binários deles vêm de
  pacotes por plataforma no lockfile. O job de deploy também instala com
  `--ignore-scripts`. Revise qualquer pacote novo que `npm install-scripts ls`
  listar antes de aprová-lo.
- Desenvolvimento, CI e deploy usam a versão do Node.js do `.nvmrc` (a LTS
  ativa). O instalador aceita a LTS suportada mais antiga em `engines` e é
  testado nela no CI.

## Verificação de atualizações

Desligada por padrão. Quando ligada, uma vez por dia, quando **Configurações →
Sobre** é aberto, o Worker busca
`https://registry.npmjs.org/create-talorys/latest` para ver se existe uma versão
mais nova. A requisição não leva dados do usuário; o npm só vê o IP do Worker. O
navegador nunca fala com o npm (`connect-src 'self'` não muda). Ligue ou
desligue em **Configurações → Sobre → Verificar atualizações**.

## Acesso remoto

Acesso opcional para clientes automatizados, com tokens de acesso pessoais com
nome (`tal_…`).

- Os tokens ficam guardados só como **HMAC(SESSION_SECRET, token)**; o texto é
  devolvido **uma vez** na criação e não pode ser recuperado do banco.
- Escopos: `read` (GET nas rotas permitidas) ou `write` (substituir e excluir
  com nível de dono nas rotas permitidas). No máximo **20** tokens.
- Os tokens expiram **90 dias** depois da criação.
- **Revogar** / **Revogar todos** destroem os hashes na hora. Desligar o Acesso
  remoto suspende os tokens (Bearer 401) sem apagá-los; ligar de novo os
  restaura.
- O CORS continua fechado. Só clientes do lado do servidor.
- As linhas de tokens ficam fora dos backups; uma restauração nunca liga o
  Acesso remoto nem ressuscita tokens.
- **Ordem da autenticação:** um cabeçalho `Authorization` presente precisa ser
  válido como Bearer. Só um token **validado** dispensa as verificações de
  CSRF/sessão. Um Bearer inválido nunca cai para um cookie.
- O bloqueio por Bearer inválido usa como chave o IP do cliente
  (`CF-Connecting-IP`; IPv6 por /64) e é separado do bloqueio de login do
  navegador. Os limites de requisições por token (em memória; zeram quando o
  Durable Object reinicia) devolvem **429** com `Retry-After`.
- As alterações são atribuídas no registro de atividade pelo nome do token e
  pelo prefixo do id (sem corpos nem credenciais), agrupadas em no máximo uma
  linha `remote.request` por token a cada janela de 15 minutos; o volume de
  escritas também é contado por token por dia. As memórias criadas via Bearer
  usam a origem `remote`.
- Um Bearer não consegue criar nem alterar automações `agent_prompt` (403); veja
  [Acesso remoto](remote-access.md).

## Servidores MCP remotos

Opcional. Detalhes completos:
[Servidores MCP remotos](mcp.md#modelo-de-segurança).

- Gerenciados só a partir de uma sessão do dono (`/api/mcp`, protegido contra
  CSRF). Tokens de acesso são recusados, e nenhuma ferramenta consegue
  adicionar servidores nem ligar ferramentas.
- As ferramentas descobertas começam desligadas. Uma ferramenta ligada ou pede
  aprovação a cada chamada (o padrão, pelo mesmo fluxo de ações pendentes das
  exclusões, vinculado aos argumentos exatos e ao estado de permissão da
  ferramenta) ou, se o dono escolher, roda sem perguntar. Anotações do servidor
  como `readOnlyHint` são mostradas, mas nunca levadas em confiança.
- As execuções agendadas só recebem uma ferramenta MCP quando o dono a
  configurou para rodar sem perguntar e também a liberou nas automações
  agendadas (desligado por padrão). As ferramentas que perguntam antes nunca
  são oferecidas lá, já que não há ninguém presente para aprovar: passar uma
  ferramenta para perguntar antes a tira das execuções agendadas, e o executor
  descarta qualquer outra ferramenta externa fora do chat.
- Os tokens Bearer e os logins OAuth (tokens, registro do cliente, verificador
  PKCE) são cifrados com AES-256-GCM sob `MCP_CREDENTIAL_KEY`, vinculados ao id
  do servidor, enviados só para a origem configurada e nunca devolvidos,
  registrados em log, enviados ao modelo ou exportados.
- O OAuth usa o fluxo de código de autorização com PKCE, como cliente público.
  O state é aleatório, vinculado ao servidor, de uso único e expira em 10
  minutos; o retorno é concluído por uma página do app que o envia com a sessão
  do dono e o cabeçalho CSRF. Os servidores de autorização precisam passar pelas
  mesmas verificações de endpoint dos servidores MCP, e o token de acesso nunca
  é enviado a eles.
- Os endpoints precisam ser hosts públicos `https://`. Endereços privados, de
  loopback, link-local, de metadados e reservados são recusados, tanto escritos
  diretamente quanto como respostas de DNS (conferidas por DNS-over-HTTPS antes
  de cada conexão nova). Redirecionamentos são recusados, e toda requisição
  precisa ficar na origem configurada.
- As chamadas dividem o orçamento de ferramentas do turno, os limites por
  ferramenta e a detecção de duplicadas, e são limitadas por tempos de espera,
  limites de tamanho de resposta e um limite de 35 segundos para qualquer
  resposta ficar aberta. Resultados e descrições são marcados no prompt como
  dados de terceiros não confiáveis.
- Uma ferramenta que roda sem perguntar é conferida de novo na hora da chamada:
  assim que o dono a passa para perguntar antes, ou a tira das execuções
  agendadas, um turno ou execução já em andamento também não consegue chamá-la
  por conta própria.
- Expressões regulares no schema de entrada de uma ferramenta (`pattern`,
  `patternProperties`) não rodam dentro do agente, então um servidor não
  consegue travar o Durable Object com um padrão de backtracking; o servidor as
  valida.
- Uma definição de ferramenta alterada esconde a ferramenta até o dono revisá-la
  de novo.
- Adicionar um servidor exige a senha digitada nos últimos 15 minutos. Apontar
  um servidor para outra URL (mesmo outro caminho no mesmo host, onde o caminho
  de um gateway pode escolher outro cliente) é tratado como adicionar um: exige
  a senha recente, gera o mesmo alerta de segurança, descarta a credencial
  guardada e desliga todas as ferramentas, tira-as das execuções agendadas e as
  volta para perguntar antes, já que o dono as revisou para o endereço antigo.
- Os backups levam só os nomes, as URLs e os tipos de autenticação dos
  servidores; os servidores importados chegam desligados, sem credenciais nem
  ferramentas.

## Google Agenda

Veja [google-calendar.md](google-calendar.md#modelo-de-segurança) para o modelo
completo.

- Só o dono, no app, conecta uma conta ou abre uma agenda para o agente; as duas
  coisas exigem a senha digitada há pouco, e conectar gera um alerta de
  segurança. Nenhuma ferramenta consegue mudar essas opções.
- O OAuth usa PKCE e um state guardado como hash, de uso único, que expira em 10
  minutos. Se o Google conceder menos permissões do que o pedido, nada é salvo
  e o acesso é revogado (a menos que uma conta já esteja conectada, cuja
  concessão ele compartilha).
- Os tokens do Google ficam lacrados com `MCP_CREDENTIAL_KEY` (AES-256-GCM) e
  nunca aparecem em backups, exportações ou respostas da API. Desconectar os
  revoga.
- O agente só propõe alterações no chat, só nas agendas configuradas como **Ler
  e propor alterações** em que o Google deixa a conta editar, e cada uma espera
  aprovação. As alterações nunca mandam e-mail aos convidados e são enviadas
  com o etag do evento, então uma edição mais nova no Google prevalece. As
  automações agendadas só conseguem ler.
- O texto dos eventos vem de quem mandou o convite: ele chega ao modelo como
  dado não confiável dentro de um bloco de dados, sem caracteres de controle.

## Como relatar

Relate vulnerabilidades de forma privada pelos GitHub Security Advisories.
