# Arquitetura

## Componentes

| Componente | Local | Roda em |
| --- | --- | --- |
| App web (React, Vite, Tailwind, TanStack Query, React Router) | `apps/web/src` | Cloudflare Pages (estático) |
| Proxy da API | `apps/web/functions/api/[[path]].ts` | Pages Function |
| Worker do agente (API Hono + `TalorysAgent`) | `apps/agent/src` | Cloudflare Workers + Durable Objects |
| Schemas compartilhados, recorrência, criptografia | `packages/shared` | Empacotado em todos os anteriores |
| Instalador | `packages/create-talorys` | A máquina do dono (Node.js) |

## Fluxo de uma requisição

1. O navegador carrega os arquivos estáticos de `https://<projeto>.pages.dev`.
2. As chamadas a `/api/*` (mesma origem, autenticação por cookie) acionam a Pages Function.
3. A função repassa a **requisição original** para `env.AGENT.fetch(request)`,
   um service binding para o Worker privado. URL, método, cabeçalhos e corpo são
   preservados, então o Worker consegue validar o `Origin`. As respostas
   (inclusive streams SSE) voltam sem buffer.
4. O Worker repassa `/api/*` para `getAgentByName(env.TalorysAgent, "personal-agent")`.
   O nome da instância é fixo no servidor; os clientes não conseguem endereçar
   outros agentes. Upgrades de WebSocket são recusados (o app usa só HTTP + SSE).
5. `TalorysAgent.onRequest` roda o app Hono ao lado do seu banco SQLite.

## TalorysAgent

`apps/agent/src/agent/talorys-agent.ts` estende a classe `Agent` do Agents SDK.

- **Armazenamento**: SQLite do Durable Object via `ctx.storage.sql`, encapsulado
  por `db/database.ts` e por repositórios por entidade em `db/repositories/`. As
  tabelas do Axis têm o prefixo `tal_` e nunca tocam nas tabelas
  `cf_agents_*` do SDK.
- **Migrations**: `db/migrations.ts`, versionadas e só de acréscimo, cada uma
  aplicada numa transação junto com o aumento de versão. Rodam sob demanda no
  primeiro uso depois de cada deploy.
- **Busca de texto completo**: índices FTS5 de conteúdo externo para memórias e
  notas, mantidos em sincronia por triggers. Tarefas e conversas usam `LIKE`
  com escape.
- **Agendamento**: cada automação ligada tem exatamente um agendamento único
  pendente do SDK (`this.schedule(date, "runAutomation", { automationId })`).
  Quando ele dispara, `AutomationService.fire` executa a automação, registra a
  execução e calcula a próxima ocorrência no fuso horário do dono. `onStart`
  reconcilia agendamentos perdidos ou interrompidos (uma execução perdida há
  menos de 24 h roda uma vez). Terminar uma execução em andamento preserva as
  pausas, exclusões e agendamentos substitutos feitos pelo dono; callbacks
  duplicados não rodam de novo enquanto aquela execução está ativa.
- **Turnos do agente**: `agent/runner.ts` monta o contexto (prompt de sistema,
  memórias relevantes, resumo corrente, histórico recente dentro do orçamento de
  tokens), chama o provedor com as ferramentas, transmite os eventos, persiste o
  resultado e registra o uso. As memórias vêm da busca por palavra-chave
  (`agent/memory.ts`) ou, quando ligada, da busca semântica (`semantic/`); depois
  são rotuladas como atual / incerta / passada e mantidas dentro de um orçamento
  de 20% do limite de contexto (no máximo 1.500 tokens).

## Histórico de memória

`apps/agent/src/memory/`; veja [memory-history.md](memory-history.md) para a
descrição voltada ao usuário.

| Módulo | Responsabilidade |
| --- | --- |
| `conflict.ts` | Regras determinísticas de relação; verificação opcional pelo Clef (modelo de decisão do Workers AI): requisição, validação da resposta, decisão |
| `lifecycle.ts` | Substituição / mudanças de status / histórico / resolução de revisões; prevenção de ciclos; extração de datas informadas |
| `intent.ts` | Detecta perguntas sobre o passado |
| `service.ts` | `MemoryHistoryService`: caminhos de escrita, pipeline de conflitos, exclusão completa (inclusive vetores semânticos), rótulos do prompt |

Os caminhos de escrita (`POST/PATCH /api/memories`, `/correct`, as ferramentas
`remember` e `update_memory`) salvam a memória primeiro e depois rodam a
detecção de conflitos. Ela nunca roda a cada mensagem do chat e não usa IA, a
menos que o dono ligue a verificação de conflitos por IA. Nesse caso, as regras
que batem e as memórias semanticamente parecidas (`semantic/neighbors.ts`) só
indicam candidatas, e uma chamada ao Clef por gravação decide. Os dois caminhos
de busca deixam de fora as memórias passadas (`historical`), a menos que a
pergunta seja sobre o passado; aí as versões anteriores dos fatos encontrados
são acrescentadas.

## Abstração do provedor de IA

`ai/provider.ts` define `AIProvider` (`generate`, `stream`, `generateWithTools`).

- `CloudflareWorkersAIProvider` (`ai/workers-ai.ts`) usa o AI SDK com o
  `workers-ai-provider` oficial. O raciocínio ("thinking") fica desligado para
  economizar Neurons. No último passo permitido, ou quando o orçamento de
  ferramentas acaba, `toolChoice: "none"` força uma resposta em texto.
- `MockAIProvider` (`ai/mock.ts`) é determinístico e usado no desenvolvimento
  local, nos testes e no modo Demo opcional. Ele encaminha intenções simples
  pelo pipeline real de ferramentas.

Adicionar um provedor (OpenRouter, Gemini, …) significa implementar
`AIProvider` e selecioná-lo em `TalorysAgent.aiProvider()`.

O uso é somado por passo do modelo, incluindo resumos e inferência de memórias.
Os tokens de entrada e de saída preservam, cada um, os valores informados pelo
provedor quando existem (inclusive zero); as direções que faltam usam uma
estimativa separada. As chamadas de embedding também são medidas, mas não
consomem o limite de requisições do modelo de chat. Todo embedder semântico é
encapsulado em `MeteredEmbedder`, então cada chamada é registrada seja qual for
o caminho de código que a faz. Chamadas do mock trazem tokens estimados e não
são cobráveis.

Uma regra vale para as falhas: toda chamada de modelo que chegou ao binding é
medida, tenha terminado, falhado ou sido abortada. As contagens recebidas são
mantidas e as direções que faltam são estimadas. Isso vale igualmente para
passos do chat, resumos, execuções agendadas, verificações de memória do Clef e
embeddings. Uma chamada recusada antes da inferência pode ser contada a mais
assim; os totais são estimativas, e contar a menos uma chamada que de fato rodou
seria pior.

O adaptador do Workers AI observa o uso bruto da resposta antes da normalização
do SDK, que de outra forma transforma contagens ausentes em zero. O uso em
streaming é emitido por passo, não a partir dos totais acumulados do turno, e
antes de um erro ser relançado, então passos que terminam em erro, se
interrompem no meio do stream ou falham de vez também são registrados. Passos
interrompidos mantêm as contagens recebidas e estimam as direções que faltam a
partir da requisição real montada pelo SDK e do maior entre a saída que o SDK
expôs e o texto bruto visto na resposta do binding. Um `generate()` que falha
anexa seu uso ao erro para quem chamou registrar. A geração além do stream
observado não pode ser medida.

O observador de uso do SSE declara `eventsource-parser` diretamente, em vez de
depender de uma dependência transitiva de um SDK. O limite de buffer nativo dele
restringe os dados de eventos pendentes, não o tráfego de heartbeat. Eventos
incompletos grandes demais interrompem a observação do uso sem abortar a
inferência.

As estimativas locais de Neurons e de USD usam, no momento do registro, uma
tabela estática de preços publicados por modelo e persistem o resultado, em vez
de reprecificar o histórico. Modelos desconhecidos contam como sem preço;
cobertura mista é um subtotal parcial, nunca uma conta exata. Os tokens de chat
mistos antigos mantêm modelo e procedência desconhecidos e ficam fora da
precificação. As estimativas antigas de embedding se juntam a eles no grupo
legado (modelo e procedência desconhecidos, sem preço), em vez de contar como
estimativas atuais ou chamadas sem preço. A entrada em cache recebe um preço
separado só quando a contagem dela e o preço de cache daquele modelo são
conhecidos. Sem chamadas cobráveis com preço, as estimativas ficam
indisponíveis, não zeradas. A interface mostra a data e a fonte dos preços. A
contabilidade não precisa de credenciais da conta nem de requisições de rede
adicionais, exclui o uso da conta inteira e as franquias gratuitas, e não mede a
cota restante na Cloudflare.

## Ferramentas

As ferramentas ficam em `apps/agent/src/tools/` e são registradas em
`tools/index.ts`. Cada uma tem nome único, descrição, schema Zod de entrada,
permissão (`read` | `write` | `destructive`), limite por turno, rótulo na
interface e resultado tipado. O `ToolExecutor` aplica a validação, o orçamento
global de chamadas, os limites por ferramenta, a detecção de chamadas
duplicadas (laços), a aprovação do dono para ações destrutivas (vinculada a um
hash do alvo como ele foi proposto) e o acesso só de leitura para execuções
agendadas. As ferramentas usam só a camada de serviços: nada de shell, execução
de código, rede ou credenciais.

As ferramentas de servidores MCP remotos (`apps/agent/src/mcp/`) são adaptadas
para o mesmo formato `ToolDefinition` e acrescentadas depois das ferramentas
nativas (ou semânticas), então nunca conseguem encobrir uma delas; os nomes
nativos não podem começar com o prefixo reservado `mcp_`. O dono liga as
ferramentas por servidor. Uma ferramenta configurada para rodar sem perguntar
vira uma ferramenta `read`; todas as outras ferramentas ligadas viram
`destructive`, cujo `commit` faz a chamada depois da aprovação, com a aprovação
vinculada a um hash do estado de permissões do servidor e da ferramenta. As
entradas em JSON Schema são convertidas para Zod (`z.fromJSONSchema`), então a
validação, o orçamento de chamadas, os limites por ferramenta e a detecção de
duplicadas valem para elas também. As ferramentas externas levam a marca
`external` e o `ToolExecutor` nunca as oferece fora do chat. O `McpService`
guarda a configuração e o último catálogo descoberto no SQLite
(`tal_mcp_servers`, `tal_mcp_tools`, migration 12) e abre sessões Streamable
HTTP sob demanda com o cliente MCP oficial, por meio de um `fetch` protegido
(trava de origem, injeção de credenciais, sem redirecionamentos, limites de
tamanho). Servidores com OAuth usam o cliente OAuth do SDK por meio do
`TalorysOAuthProvider` (`mcp/oauth.ts`), cujo estado fica cifrado na coluna
`credential` do servidor; a origem do servidor de autorização é admitida pela
mesma proteção depois das verificações de endpoint e de DNS. O navegador volta
para a página `/settings/mcp-oauth` do SPA, que envia o código e o estado para
`POST /api/mcp/oauth/callback`. O `MCPClientManager` do Agents SDK não é usado,
porque ele guardaria os cabeçalhos de conexão em texto puro e reconectaria os
servidores ao acordar, fora dessas verificações. Veja [mcp.md](mcp.md).

`propose_task_plan` (uma ferramenta `write`, então nunca oferecida a execuções
agendadas, uma vez por turno) não é imediata nem destrutiva no efeito: ela
valida a proposta do modelo com o schema Zod compartilhado
(`packages/shared/src/plans.ts`), descarta tarefas duplicadas, resolve o projeto
e guarda um rascunho em `tal_task_plan_drafts` por meio do `TaskPlanService`.
Ela não cria tarefas. O rascunho viaja na atividade de ferramentas da mensagem
do chat (`ToolActivity.plan`) e é atualizado a partir da tabela sempre que uma
conversa é lida, então o cartão sobrevive a recarregamentos. O dono edita
(`PATCH /api/conversations/:cid/task-plans/:id`), confirma (`POST …/confirm`) ou
cancela (`POST …/cancel`); cada chamada informa a conversa e a revisão que o
dono viu. A confirmação valida de novo o plano final, reivindica o rascunho com
uma atualização condicional e cria o projeto e as tarefas na mesma transação do
SQLite, então ela é atômica e roda no máximo uma vez; uma chamada repetida
devolve o primeiro resultado. Editar ou confirmar não faz nenhuma chamada ao
modelo. Um turno que o dono interrompe retira qualquer plano que tenha proposto.

## Modelo de dados

`tal_settings`, `tal_conversations`, `tal_messages`, `tal_memories`,
`tal_projects`, `tal_tasks`, `tal_notes`, `tal_automations`,
`tal_automation_runs`, `tal_notifications`, `tal_activity`, `tal_sessions`,
`tal_login_attempts`, `tal_usage_daily`, `tal_model_usage_daily`,
`tal_memory_reviews`, `tal_push_subscriptions`, além das tabelas FTS. A
migration 3 acrescentou `tal_messages.source` (chat ou importação); a migration
4 acrescentou as colunas do ciclo de vida das memórias (`status`,
`superseded_by`, `valid_from`, `valid_until`) e a tabela `tal_memory_reviews`;
as memórias existentes ficam `active` por padrão. A migration 5 acrescentou
colunas de vínculo de aprovação a `tal_pending_actions` (`target_version`,
`payload`, `preview`); a migration 6 acrescentou `tal_push_subscriptions` para
os dispositivos de Web Push. A migration 7 acrescenta procedência por dia e por
modelo e estimativas de preço persistidas, sem mexer nos tokens de chat antigos.
Os contadores de embedding semântico existentes são copiados para o grupo de
tokens legado sem criar as tabelas semânticas quando o recurso nunca foi ligado.
As migrations 8 a 10 acrescentam os tokens de acesso remoto e seus contadores; a
migration 11 acrescenta `tal_task_plan_drafts` para os planos de tarefas
propostos.

## Escolhas para o plano gratuito

Sem KV/D1/R2/Vectorize/Workflows. Um único Durable Object guarda tudo. Os
arquivos estáticos são servidos sem acionar Functions (o Pages encaminha só
`/api/*` para a função). Lembretes e resumos são determinísticos. O contexto do
chat é limitado e só é resumido depois que histórico suficiente transborda.

A entrada de voz no chat é uma chamada ao Whisper por clipe gravado
(`POST /api/transcribe`), cobrada por minuto de áudio (cerca de 46,6 Neurons por
minuto). Os clipes têm limite de 60 s e o áudio, de 60 minutos por dia
(`TRANSCRIPTION_LIMITS`), à parte do orçamento diário de requisições de IA, e
são registrados no histórico de uso como qualquer outra chamada de modelo. As
mensagens de voz do Telegram (até 5 minutos e 5 MB) passam pelo mesmo
`TalorysAgent.transcribeClip`, então compartilham a trava de um por vez e o
limite diário de áudio com o app.
