# Servidores MCP remotos

O Axis consegue usar ferramentas de servidores remotos do
[Model Context Protocol](https://modelcontextprotocol.io) (MCP): um serviço de
busca, o seu gerenciador de tarefas ou um servidor que você mesmo hospeda. Você
adiciona um servidor em **Configurações → Integrações**, escolhe quais
ferramentas dele o Axis pode usar, e o agente passa a poder chamá-las no
chat.

É opcional. Sem servidores configurados nada muda, e o Axis não faz nenhuma
requisição a mais. Adicionar ou remover um servidor nunca exige um novo deploy.

## O que ele faz e o que não faz

- **Transporte:** só Streamable HTTP, por `https://`. O transporte antigo
  HTTP+SSE, stdio e servidores MCP locais não são aceitos.
- **Autenticação:** nenhuma, um token Bearer ou
  [login com OAuth](#login-com-oauth).
- **Rotinas de IA agendadas:** desligadas por padrão. Uma ferramenta configurada
  como **Executar sem perguntar** também pode ser liberada nas automações
  agendadas com a chave **Usar também em automações agendadas**. Ferramentas que
  perguntam antes nunca são usadas lá, já que não há ninguém presente para
  aprovar a chamada.
- **Só ferramentas:** prompts, recursos e sampling do MCP não são usados.

## Conectar um servidor

1. Abra **Configurações → Integrações** e escolha **Adicionar servidor MCP**.
2. Informe um nome, a URL MCP do servidor (por exemplo,
   `https://exemplo.com/mcp`) e como ele autentica: um token Bearer ou OAuth,
   para entrar com a sua conta.
3. Escolha **Conectar**. O Axis confere a URL, conecta e lista as ferramentas
   do servidor. Se não conseguir conectar, o servidor fica salvo com o motivo, e
   você pode corrigir o token ou tocar em reconectar.

Toda ferramenta começa **desligada**. Abra o servidor em **Gerenciar**, ligue as
ferramentas que quiser e escolha como cada uma roda:

| Opção | O que acontece |
| --- | --- |
| **Perguntar sempre** (padrão) | O agente propõe a chamada. Você vê o servidor, a ferramenta e os argumentos exatos num cartão de aprovação, e a chamada só roda quando você aprova. |
| **Executar sem perguntar** (só leitura) | O agente chama a ferramenta diretamente. Escolha isto só para ferramentas que apenas leem dados. |

"Executar sem perguntar" é uma decisão de confiança no servidor. Os servidores
podem marcar uma ferramenta como só leitura ou destrutiva; o Axis mostra
essas marcas, mas nunca depende delas, porque não consegue verificar o que uma
ferramenta realmente faz.

No máximo 20 ferramentas podem ficar ligadas ao mesmo tempo, somando todos os
servidores, e as descrições delas precisam caber numa fatia fixa do contexto da
IA. Desligue as ferramentas que você não usa.

## Privacidade

O Axis normalmente mantém os seus dados dentro da sua conta da Cloudflare.
**As ferramentas MCP são a exceção:** chamar uma ferramenta envia os argumentos
dela para aquele servidor, que é operado por terceiros ou por você, e o
resultado volta para a conversa.

- Só os argumentos da chamada são enviados. O Axis nunca envia por conta
  própria as suas memórias, notas, histórico de conversas ou outros dados para um
  servidor MCP. O modelo é instruído a incluir só o que o pedido precisa, mas o
  que ele puser nos argumentos sai da sua conta, então revise os cartões de
  aprovação.
- As URLs dos servidores e os nomes das ferramentas aparecem no registro de
  atividade do Axis. Argumentos, resultados e credenciais, não.
- Resultados e descrições de ferramentas são tratados como texto de terceiros
  não confiável: o modelo é instruído a nunca seguir instruções que estejam
  neles, e eles não conseguem mudar aprovações nem permissões.

## Modelo de segurança

- **Só o dono.** Os servidores são gerenciados por `/api/mcp`, que exige uma
  sessão do dono e o cabeçalho CSRF. Tokens de acesso pessoal não chegam lá, e
  nenhuma parte disso é uma ferramenta: o agente não consegue adicionar
  servidores nem ligar ferramentas.
- **Credenciais.** Tokens Bearer e tokens OAuth são cifrados com AES-256-GCM sob
  uma chave derivada do segredo `MCP_CREDENTIAL_KEY` do Worker, vinculada ao id
  do servidor. Eles nunca são devolvidos pela API, mostrados na interface,
  enviados à IA, registrados em log nem incluídos em backups. O token só é
  enviado para a própria origem do servidor: mudar a URL, mesmo que só o
  caminho, exige informá-lo de novo.
- **Endpoints.** Só são aceitas URLs `https://` em hosts públicos. Endereços
  privados, de loopback, link-local (inclusive os de metadados de nuvem), CGNAT
  e outros reservados são recusados, assim como nomes como `localhost`,
  `*.local` e `*.internal`, e URLs com credenciais ou fragmentos. Antes de cada
  conexão nova, o nome do host é resolvido por DNS-over-HTTPS, e um nome que
  aponta para um endereço privado é recusado. As requisições só podem ir para a
  origem configurada, e redirecionamentos nunca são seguidos.
- **Aprovações.** Uma aprovação fica vinculada aos argumentos exatos e ao estado
  de permissão da ferramenta no momento da proposta: se a ferramenta for
  desligada ou passar a executar sem perguntar, se o servidor for desligado ou
  removido, se o token dele mudar ou se a definição da ferramenta mudar, a
  aprovação falha e nada é enviado. Cada aprovação roda no máximo uma vez.
- **Executar sem perguntar, com proteção.** Ligar a opção numa ferramenta (ou
  ligar uma ferramenta já configurada assim, ou liberá-la nas automações
  agendadas) exige a sua senha digitada nos últimos 15 minutos, com o segundo
  fator quando ele estiver ligado. Mesmo assim, a chamada é proposta num cartão
  de aprovação, em vez de enviada, quando:
  - um resultado de **outro** servidor MCP já está na conversa, neste turno ou
    num anterior. Uma instrução escondida nesse resultado poderia levar o modelo
    a pôr os seus dados nos argumentos de uma chamada a um segundo servidor.
    Chamadas ao servidor cujo resultado já está lá continuam rodando;
  - os argumentos passam de 1.000 caracteres em JSON. Uma consulta de busca é
    curta; dados sendo enviados para fora, não;
  - as chamadas que rodaram sem perguntar neste turno já enviaram, juntas, 4.000
    caracteres de argumentos.

  Aprovar executa exatamente a chamada proposta, uma vez. As automações agendadas
  não conseguem perguntar, então lá a chamada é recusada.
- **Servidores permitidos.** Com `TALORYS_MCP_ALLOWED_ORIGINS` definido, só os
  servidores da lista podem ser adicionados, conectados ou chamados, e um
  servidor tirado da lista deixa de oferecer as ferramentas na hora (veja
  [Configuração](#configuração)). Um servidor que entra com OAuth precisa que a
  origem do servidor de login também esteja na lista. Com ela apontando para
  hosts do seu próprio domínio, um DNS rebinding só consegue alcançar os seus
  próprios hosts. Evite curingas em domínios compartilhados, como
  `https://*.workers.dev` ou o domínio de um n8n hospedado: eles também admitem
  o servidor de qualquer outro cliente ali.
- **Ferramentas alteradas.** Quando um servidor muda a descrição, as entradas ou
  as marcas de uma ferramenta, o Axis para de usá-la até você ligá-la de novo
  (para uma ferramenta "Executar sem perguntar", com a senha digitada há pouco).
  As ferramentas que o servidor deixa de listar ficam marcadas como não mais
  oferecidas.
- **Limites.** Toda chamada MCP passa pelo mesmo pipeline das ferramentas
  nativas: validação da entrada, orçamento de chamadas por turno, no máximo 3
  chamadas por ferramenta por turno e detecção de chamadas duplicadas. As
  conexões expiram em 10 s, as chamadas de ferramenta em 30 s, respostas acima
  de 2 MB são recusadas e nenhuma resposta pode ficar aberta por mais de 35 s. O
  modelo vê no máximo 8.000 caracteres de um resultado. Ferramentas com schemas
  de entrada grandes demais, aninhados demais ou não suportados aparecem na
  lista, mas não podem ser ligadas. Expressões regulares num schema (`pattern`,
  `patternProperties`) não são executadas pelo Axis; o servidor as valida.
- **Sem tráfego em segundo plano.** As sessões são abertas sob demanda e
  mantidas em memória por até dois minutos. Não há polling, nem stream de
  eventos de longa duração, nem laço de reconexão automática.

**Risco residual.** A verificação de DNS roda antes de conectar, e o runtime do
Workers resolve o nome de novo quando conecta, então um servidor que muda as
respostas de DNS nesse intervalo (DNS rebinding) não fica totalmente excluído.
As requisições de um Worker saem da rede da Cloudflare, não da sua, então elas
não conseguem alcançar dispositivos da rede da sua casa ou do seu escritório.

## Chamadas aprovadas e resultados incertos

Um serviço externo pode não conseguir desfazer o que fez, e o Axis não
consegue garantir que uma chamada aconteceu exatamente uma vez. Se a conexão
falhar ou expirar depois que uma chamada aprovada foi enviada, o Axis a
informa como falha e avisa que ela **pode ou não ter rodado**: confira o serviço
antes de pedir de novo. Chamadas aprovadas nunca são repetidas automaticamente.
Chamadas configuradas para executar sem perguntar são repetidas uma vez, só
quando uma sessão reutilizada se mostrou vencida.

## Backups e atualizações

- Um backup inclui o nome, a URL e o tipo de autenticação de cada servidor. Ele
  nunca inclui tokens, logins OAuth, sessões nem quais ferramentas estavam
  ligadas.
- Servidores importados chegam **desligados**, sem token e sem ferramentas. Ligue
  um, adicione o token ou entre de novo e escolha as ferramentas outra vez.
- Atualizar o Axis mantém os seus servidores, tokens e escolhas de
  ferramentas (eles ficam no banco SQLite do Durable Object).

## Configuração

| Nome | Tipo | Para quê |
| --- | --- | --- |
| `MCP_CREDENTIAL_KEY` | Segredo | Cifra os tokens Bearer e os logins OAuth. O instalador o cria, e `npx create-talorys@latest update` o acrescenta a instalações antigas. Sem ele, ainda dá para adicionar servidores que não pedem autenticação. Trocá-lo deixa os tokens guardados ilegíveis; informe-os de novo ou entre de novo. |
| `TALORYS_MCP` | Segredo ou variável | `off` desliga os servidores MCP na instalação. |
| `TALORYS_MCP_MAX_TOOLS` | Segredo ou variável | Máximo de ferramentas ligadas ao mesmo tempo (padrão 20, no máximo 64). |
| `TALORYS_MCP_ALLOWED_ORIGINS` | Segredo ou variável | Os únicos servidores permitidos, separados por vírgula: origens exatas (`https://n8n.exemplo.com`) ou todos os subdomínios de um domínio (`https://*.exemplo.com`, sem o próprio domínio). Sem definir: qualquer host público. É conferido quando um servidor é adicionado e antes de cada conexão e chamada, então restringir a lista também barra servidores já adicionados. Uma entrada que não seja uma origem simples recusa todos os servidores até ser corrigida. |

Num [deploy de um Worker só](deployment.md#um-worker-sem-pages), defina a
chave à mão com 32 ou mais caracteres aleatórios:

```bash
openssl rand -base64 32 | npx wrangler secret put MCP_CREDENTIAL_KEY -c wrangler.standalone.jsonc
```

Defina `TALORYS_MCP`, `TALORYS_MCP_MAX_TOOLS` e `TALORYS_MCP_ALLOWED_ORIGINS`
também com `wrangler secret put`: o instalador gera de novo a configuração do
Worker a cada atualização, o que descartaria uma variável comum.

## Uso da Cloudflare

O MCP não usa nenhum produto a mais da Cloudflare: a configuração fica no
Durable Object que já existe, e as chamadas são subrequisições `fetch` comuns
feitas a partir dele, que o plano Workers Free inclui. Cada chamada de
ferramenta custa algumas subrequisições (abrir uma sessão leva duas, depois uma
por chamada) e conta no limite de chamadas de ferramenta que o turno já tem. O
modelo continua contando no seu orçamento diário de pedidos de IA como de
costume, e descrições de ferramentas grandes deixam mais longa cada requisição
do turno.

## Solução de problemas

| Mensagem | O que fazer |
| --- | --- |
| Não foi possível conectar ao servidor MCP | Confira a URL, inclusive o caminho (muitas vezes `/mcp`). O servidor pode estar fora do ar. |
| Isto não parece um servidor MCP Streamable HTTP | A URL responde, mas não como um servidor MCP. Servidores que só suportam o transporte SSE antigo não funcionam. |
| Este servidor exige autenticação | Adicione ou substitua o token Bearer em **Gerenciar**. |
| O servidor MCP respondeu com um redirecionamento | Use a URL final do servidor. |
| Este endereço está em uma rede privada ou local | O Axis só se conecta a servidores públicos. Para testar um servidor local, use o desenvolvimento local (abaixo). |
| O servidor não retornou nenhuma ferramenta compatível | As ferramentas dele têm schemas de entrada que o Axis não consegue validar. Cada uma mostra o motivo. |
| Alterada, revise novamente | O servidor mudou a ferramenta. Leia a descrição e ligue-a de novo. |
| O armazenamento de credenciais não está configurado | Rode `npx create-talorys@latest update` ou defina `MCP_CREDENTIAL_KEY` à mão. |
| Entre para concluir a conexão com este servidor | Escolha **Entrar** e aprove o acesso na página do servidor. O link vale por 10 minutos; escolha reconectar para receber um novo. |
| O login neste servidor falhou | O login do servidor não suporta registro dinâmico de cliente ou recusou o pedido. Tente um token Bearer, se ele oferecer. |
| Este link de login expirou ou já foi usado | Comece de novo com reconectar. Cada link de login funciona uma vez. |

## Desenvolvimento local

Com `TALORYS_ENV=development` (como o `npm run dev` configura), URLs
`http://localhost`, `http://127.0.0.1` e `http://[::1]` são permitidas, então
você pode apontar o Axis para um servidor MCP rodando na sua máquina. No modo
de IA simulada (mock), uma mensagem de chat
`call mcp_<id da ferramenta> {"arg": "valor"}` chama diretamente uma ferramenta ligada. O id da ferramenta
aparece na lista de ferramentas do servidor.

## Login com OAuth

Escolha **OAuth (login)** como método de autenticação nos servidores que deixam
você entrar com a sua conta em vez de colar um token.

1. Quando você escolhe **Conectar**, o Axis pergunta ao servidor como entrar
   (metadados OAuth de recurso protegido e de servidor de autorização), se
   registra como app no servidor de autorização (registro dinâmico de cliente) e
   abre a página de login do servidor.
2. Aprove o acesso lá. O servidor de autorização manda você de volta para o
   Axis (`/settings/mcp-oauth`), que conclui o login e conecta.
3. O Axis renova o token de acesso sozinho. Se o servidor revogar o acesso ou
   o token de atualização expirar, o servidor mostra **Precisa de autenticação**
   e um botão **Entrar**.

Como isso fica seguro:

- **Código de autorização com PKCE (S256)**, como cliente público: nenhum
  segredo de cliente é guardado. O pedido indica o servidor MCP como o recurso
  (RFC 8707).
- **O state** é aleatório, vinculado ao servidor, de uso único e expira em 10
  minutos. A página de retorno o envia com a sua sessão do Axis e o cabeçalho
  CSRF, então um login só pode ser concluído no seu próprio navegador com
  sessão aberta. (O redirecionamento de volta para o Axis é entre sites, então
  o cookie de sessão não vai junto; a página de retorno faz a requisição.)
- **Os tokens, o registro do app e o verificador PKCE** ficam guardados cifrados
  com `MCP_CREDENTIAL_KEY`, como os tokens Bearer. Eles nunca são devolvidos pela
  API, mostrados, enviados à IA, registrados em log nem exportados. O token de
  acesso só é enviado para a própria origem do servidor MCP, nunca para o
  servidor de autorização.
- **O servidor de autorização** precisa passar pelas mesmas verificações de um
  endpoint MCP: host público `https://`, sem endereços privados (conferidos
  também no DNS), sem redirecionamentos.
- Mudar a URL do servidor (mesmo que só o caminho), ou trocar o método de
  autenticação dele, apaga o login guardado.

O retorno funciona igual no deploy com Pages e no deploy de um Worker só: ele é
uma página comum do app, e a requisição dele passa pelo caminho `/api` de
sempre, então o Worker privado nunca fica exposto.

Limitações: o servidor de autorização precisa suportar registro dinâmico de
cliente (a maioria dos servidores MCP que oferecem OAuth suporta). Client IDs
pré-registrados, segredos de cliente e documentos de metadados de client ID
ainda não são aceitos. O login só pode ser iniciado pelas Configurações, nunca
pelo agente.
