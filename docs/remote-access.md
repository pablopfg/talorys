# Acesso remoto

Clientes automatizados podem chamar a sua instalação privada do Axis com um
**token de acesso pessoal** (PAT). Os tokens têm nome e escopo (`read` ou
`write`), aparecem uma única vez na criação, ficam guardados só como hash e são
revogados nas Configurações.

Isto **não** é um servidor MCP. O CORS continua fechado: use um cliente do lado
do servidor (`curl`, Home Assistant, uma CLI, um cron job). Navegadores em
outras origens não conseguem chamar estas rotas.

O acesso por sessão com cookie + CSRF já funciona para a interface do dono e
para clientes de sessão por script. O acesso remoto acrescenta tokens de acesso
pessoais **com nome, escopo e revogáveis**, para que uma integração não precise
da sessão completa do dono.

## Ligar e criar um token

1. Abra **Configurações → Segurança → Acesso remoto**.
2. Ligue o **Acesso remoto** (desligado por padrão). Se você entrou há mais de 15
   minutos, o Axis pede a sua senha antes; criar um token pede do mesmo jeito.
3. Informe um nome (1 a 64 caracteres), deixe o escopo em **`read`**, a menos
   que precise de escrita, e escolha **Gerar token**.
4. **Copie o token na hora.** Ele começa com `tal_` e aparece uma única vez.
   Fechar o painel faz o texto do token se perder para sempre. O painel também
   mostra um exemplo de `curl` pronto para a sua instalação.
5. Guarde-o no cofre de segredos do seu cliente (não no git, no chat nem em logs
   de CI).
6. Cada token vale por **90 dias**; as Configurações mostram a data. Depois disso
   ele falha como um token revogado (Bearer **401**), e você cria um novo.

As rotas de administração (`/api/remote/*`) exigem a sessão do navegador e o
cabeçalho CSRF. Tokens não conseguem gerenciar outros tokens.

## Escopos

| Escopo | Permitido |
| --- | --- |
| `read` (padrão) | `GET` / `HEAD` só na lista de rotas permitidas. Escritas devolvem **403**. |
| `write` | Tudo o que `read` faz, mais `POST` / `PATCH` / `DELETE` nas coleções permitidas. **Nível de dono** nessa superfície: substituir conteúdo e excluir. |
| `events` | Só `POST /api/remote/events`, que transforma um evento do n8n ou de outra automação num aviso. Todas as outras rotas devolvem **403**, e nenhum outro token (nem a sessão do dono) consegue chamar esta. Veja [Eventos](#eventos). |

Tokens com nome são o controle de privilégio mínimo (`home-assistant` = read,
`voice-capture` = write, `n8n` = events).

## Rotas permitidas

Tudo é negado por padrão. Um token Bearer só pode chamar estes pares de método +
caminho (comparados como foram enviados; percent-encoding e barras no final não
são decodificados para casar com uma rota permitida):

| Método | Caminho |
| --- | --- |
| `GET` | `/api/health` |
| `GET` | `/api/semantic/search` |
| `GET`, `POST` | `/api/tasks`, `/api/notes`, `/api/automations`, `/api/memories` |
| `GET`, `PATCH`, `DELETE` | `/api/tasks/:id`, `/api/notes/:id`, `/api/automations/:id`, `/api/memories/:id` |

`:id` precisa ser um UUID. Segmentos de caminho sempre negados, mesmo que pareçam
um id: `reviews`, `history`, `correct`, `status`, `notifications`, `import`,
`export`.

### Resumo do que é negado

Todo o resto devolve **403** para um token válido (ou **401** se o token for
inválido ou o recurso estiver desligado), inclusive: chat, configurações,
projetos, importação/exportação, senha, push, `/api/remote/*`,
`/api/memories/reviews`, reindexação semântica e todas as outras rotas do dono.

### D13: tipos de automação

Com Bearer `write`, você pode criar, editar, ligar e reagendar **só `reminder` e
`task_digest`**. Criar ou alterar uma automação **`agent_prompt`** devolve
**403** ("Tokens de acesso não podem criar nem alterar automações de prompt de
IA."). Excluir qualquer automação (inclusive `agent_prompt`) é permitido. A
interface com cookie não muda.

## Requisições

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Sem o cabeçalho CSRF `x-talorys-request`. Sem cookies. Os corpos JSON de
requisição e resposta são os mesmos dos handlers de `/api` que já existem.

Ordem da autenticação: se `Authorization` estiver presente, precisa ser um token
Bearer válido. Um token inválido ou revogado recebe **401** e nunca cai para um
cookie de sessão.

## Filtros de notas

`GET /api/notes?q=tomate&project_id=<id-do-projeto>` busca só nas notas daquele
projeto. Sem `project_id`, a busca passa por todos os projetos, inclusive as
notas sem projeto.

## Datas

- `due_at` das tarefas: ISO-8601 com fuso (ou como a API de tarefas já aceita).
- Agendamentos únicos de automação usam o **horário local** no fuso do dono
  (**Configurações** → fuso horário).
- "Hoje" nos resumos: use os limites de hoje de `GET /api/tasks?view=today` e o
  campo `timezone` de `GET /api/automations`.

## Erros

| Status | Significado |
| --- | --- |
| 200 / 201 | Sucesso (criar costuma devolver 201). |
| 400 | Validação / corpo ou query inválidos. |
| 401 | Bearer ausente, inválido ou revogado, ou Acesso remoto desligado (tokens suspensos). |
| 403 | Escopo incompatível, rota fora da lista permitida, negação D13 de `agent_prompt`, criação com o recurso desligado ou com o máximo de tokens. |
| 404 | Id desconhecido. |
| 409 | Busca semântica desligada na busca; outros conflitos dos handlers, como já acontece. |
| 429 | Limite de requisições por token ou bloqueio por Bearer inválido; respeite `Retry-After` quando vier. |
| 5xx | Erro do servidor / Durable Object. |

## Limites das listas

**Uma resposta de lista bem-sucedida não traz todos os registros.** Os clientes
não podem supor que a lista está completa. Não há paginação nova na v1.

| Recurso | Limite |
| --- | --- |
| Tarefas | Padrão **200**, máximo **500** (query `limit`). |
| Notas | Padrão **500**; com `q`, a busca usa **50** por padrão. |
| Memórias | Padrão **500**; com `q`, a busca usa **100** por padrão. |
| Automações | Lista completa numa resposta (mais os metadados das execuções recentes). |

## Contrato da busca

`GET /api/semantic/search?q=…`

- Sem `types` → **só resultados de memória**.
- `types` é uma lista separada por vírgula com `memory`, `task`, `note`,
  `automation` (e outros tipos que o handler aceitar).
- `limit` tem padrão **10** e máximo **50** (aplicado por tipo quando os tipos
  são informados; os resultados são concatenados).
- Busca semântica **desligada** → **409**. Os clientes precisam tratar isso; não
  há um modo especial "palavra-chave com o recurso desligado" para o acesso
  remoto.
- As buscas por token podem usar no máximo **metade** de cada limite diário de
  embeddings (memórias e itens). Passado isso, elas devolvem só resultados por
  palavra-chave (`cosine: null`) pelo resto do dia, enquanto o chat do dono
  fica com a outra metade.
- Uma memória criada ou editada por token também usa no máximo **metade** do
  limite diário de embeddings na conferência de conflitos. Passado isso, ela é salva do mesmo
  jeito e espera a indexação em segundo plano, que embeda as memórias pendentes
  em lotes.
- O que um token de escrita exclui vai para a **lixeira** por 30 dias, num
  espaço só dos tokens (2.000 itens, 64 MB). Quando ele acaba, a exclusão por
  token é recusada com 409 `STORAGE_LIMIT_REACHED`, e nada sai da lixeira para
  abrir espaço. Só a sessão do dono vê, restaura ou esvazia a lixeira
  (`/api/trash` e `/api/storage` ficam fora da allowlist de tokens).
- Os resultados são enxutos (ids / pontuações / campos curtos). Depois, use
  `GET /api/…/:id` para o conteúdo completo.
- Tarefas concluídas e automações inativas **não** são filtradas da busca de
  itens.

## Eventos

`POST /api/remote/events` com um token `events` gera um aviso na categoria
**Eventos**. Corpo (JSON, no máximo 2 KB): `title` (1 a 120 caracteres,
obrigatório), `body` (até 1000), `priority` (`low`, `normal` como padrão, ou
`high`; `critical` é recusado), `source` e `kind` (até 40 caracteres entre
letras, dígitos, `.`, `-`, `_`) e `id` (até 100 caracteres; o mesmo `source` +
`id` dentro de 24 horas é descartado).

| Status | Significado |
| --- | --- |
| **201** | `{ event: { id, priority }, duplicate: false }` |
| **200** | `{ event: null, duplicate: true }`: repetição de um `id` |
| **400** | Campo inválido |
| **403** | Não é um token `events` |
| **429** | Mais de **60** eventos numa hora ou **100** em 24 horas, somando todos os tokens (com `Retry-After`) |

O título começa com a origem (`n8n: …`) e fica numa linha só; os links são
desarmados (`hxxps://`, entre crases) em todos os canais. Os eventos usam no
máximo metade dos limites de cada canal de aviso, no máximo 3 insistem ao mesmo
tempo, e no máximo 50 pares de origem + tipo aprendem a própria prioridade. O
guia completo, com o nó HTTP Request do n8n e os service tokens do Cloudflare
Access, está em
[alerts.md](alerts.md#eventos-do-n8n-e-de-outras-automações).

## Limites de requisições e de tokens

| Limite | Valor |
| --- | --- |
| Máximo de tokens por instalação | **20** (`MAX_REMOTE_TOKENS`). Criar devolve **403** no limite. |
| Requisições por token | **120** a cada janela de **60 s**. Contadas na memória do Durable Object, então a janela também zera quando o DO reinicia (cold start / remoção da memória), além de quando o minuto passa. |
| Tentativas de Bearer inválidas | **10** por IP de cliente em **15 minutos**; depois, **429** mesmo com o token certo. A chave do cliente é o `CF-Connecting-IP` (IPv6 agrupado por **/64**), então outro host no mesmo /64 ou atrás do mesmo NAT pode bloquear um token legítimo por até 15 minutos. É separado do bloqueio de login do navegador. |

As alterações são atribuídas no registro de atividade de forma **agrupada**: no
máximo uma linha `remote.request` por token a cada janela de 15 minutos; o
volume completo de escritas fica num contador diário por token, para que uma
automação movimentada não empurre o histórico do dono para fora do registro de
atividade de 1000 linhas.

## Ciclo de vida das credenciais

| Evento | Efeito |
| --- | --- |
| Revogar um | Hash apagado; Bearer **401** na hora. |
| Revogar todos | Todos os tokens apagados; Bearer **401**. |
| 90 dias depois da criação | Token expirado; Bearer **401**. Tokens criados antes de a expiração existir ganharam 90 dias a partir da atualização. |
| Troca de senha (interface) | Todos os tokens remotos revogados. |
| `reset-password` na CLI | Todos os tokens remotos revogados (junto com as sessões). |
| Rotação do `SESSION_SECRET` | Os hashes guardados deixam de conferir; gere os tokens de novo. |
| Recurso desligado | Bearer sempre **401**. Os tokens **continuam guardados, mas suspensos**, até ligar de novo. Criar fica desativado; listar e revogar (e revogar todos) continuam funcionando na interface. |
| Backups | As linhas de tokens **não** entram. Restaurar um backup **nunca** liga o Acesso remoto nem ressuscita tokens. |

## Quatro cenários

Marcadores: `$TALORYS_URL` (a origem, sem barra no final) e `$TALORYS_TOKEN` (o
PAT em texto). Nunca faça commit do token nem o registre em log.

### Cenário 1: leitura pelo Home Assistant

Token de leitura. Liste as automações e busque uma pelo significado (filtre
tipos e nomes no cliente).

```bash
curl -sS -H "Authorization: Bearer $TALORYS_TOKEN" \
  "$TALORYS_URL/api/automations"

curl -sS -H "Authorization: Bearer $TALORYS_TOKEN" \
  "$TALORYS_URL/api/semantic/search?q=lixo&types=automation"
```

Um **409** na busca significa que a busca semântica está desligada: use a lista
de automações e filtre localmente.

### Cenário 2: alterar uma nota pela CLI

Token de escrita. Altere uma nota existente pelo id.

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $TALORYS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Atualizado pela CLI"}' \
  "$TALORYS_URL/api/notes/<id-da-nota>"
```

### Cenário 3: captura por voz

Token de escrita. Crie uma tarefa; evite duplicatas de novas tentativas no
cliente (não há chaves de idempotência no servidor na v1).

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TALORYS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Buscar a roupa na lavanderia"}' \
  "$TALORYS_URL/api/tasks"
```

### Cenário 4: resumo da manhã

Token de leitura. As tarefas de hoje mais as automações cujo `next_run` cai hoje
(compare usando o `timezone` da resposta e os limites de hoje).

```bash
curl -sS -H "Authorization: Bearer $TALORYS_TOKEN" \
  "$TALORYS_URL/api/tasks?view=today"

curl -sS -H "Authorization: Bearer $TALORYS_TOKEN" \
  "$TALORYS_URL/api/automations"
```

## Script de verificação rápida

Verificação sem dependências (Node ≥ 24):

```bash
TALORYS_URL="$TALORYS_URL" TALORYS_TOKEN="$TALORYS_TOKEN" \
  node scripts/remote-smoke.mjs
```

Modos:

- padrão: cria uma tarefa descartável, faz get/list/search e a exclui
- `--read-only`: listas + busca; confere que `POST` → 403
- `--expect-revoked`: confere que `GET /api/tasks` → 401

Imprime só linhas `ok <etapa>` / `FAIL <etapa>: <status>`, nunca o token. Sai
com **2** se faltar variável de ambiente.
