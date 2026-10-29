# Workflows

O menu **Workflows** reúne rotinas que antes rodavam no n8n e agora rodam
dentro da sua conta da Cloudflare, com os
[Cloudflare Workflows](https://developers.cloudflare.com/workflows/). Cada
workflow tem uma chave para ligar e desligar, um agendamento e um histórico de
execuções.

## Por que Workflows, e não o n8n

| | n8n | Workflows no Axis |
| --- | --- | --- |
| Onde roda | Um servidor que precisa ficar no ar | Na Cloudflare, junto com o Axis |
| Falha de rede | O fluxo para, a não ser que você monte as tentativas | Cada etapa tenta de novo sozinha (3 tentativas, 20 s entre elas) |
| Reinício no meio | Perde a execução | Continua de onde parou: etapa pronta não roda de novo |
| Avisos | Precisa de um nó para cada canal | Usam a central de avisos (push, Telegram, e-mail, prioridade que aprende) |
| Custo | Servidor próprio | Plano gratuito do Workers |

O n8n continua útil para integrações que o Axis não tem (os eventos do n8n
seguem funcionando, veja [alerts.md](alerts.md#eventos-do-n8n-e-de-outras-automações)).
Cada rotina do n8n que for migrada vira um workflow novo neste menu.

## Workflows disponíveis

### Monitor de sites

Confere até 10 endereços `https://` no intervalo escolhido (padrão: a cada 15
minutos).

- Qualquer resposta abaixo de 400 conta como no ar (um redirecionamento
  também; ele não é seguido).
- Um site só é dado como fora do ar depois de **duas execuções seguidas** com
  falha, cada uma já com as 3 tentativas da etapa. Uma oscilação isolada não
  gera aviso.
- O aviso **Site fora do ar** tem prioridade **alta**: insiste até você
  confirmar. Quando o site volta, chega **Site de volta**, com o horário em que
  caiu.

## Como usar

1. Abra **Workflows** no menu.
2. Toque no lápis do workflow, preencha os endereços (um por linha), escolha
   quando roda e ligue a chave **Workflow ligado**.
3. **Executar agora** (▶) roda na hora. O resultado aparece em instantes em
   **Execuções recentes** (a página se atualiza sozinha enquanto há execução
   em andamento). Entre dois toques há uma espera de 1 minuto.

Os horários usam o fuso de **Configurações → Geral**. Mudar o fuso reprograma
os workflows ligados.

## Como funciona

```
Durable Object (agente)                     Cloudflare Workflow
 ├─ alarme na hora agendada  ──cria──▶  instância (uma por execução)
 │                                       ├─ etapa "check site 1"  (3 tentativas)
 │                                       ├─ etapa "check site 2"  (3 tentativas)
 │                                       └─ etapa "report" ──RPC──┐
 ├─ workflowReport(): memória entre      ◀──────────────────────────┘
 │   execuções + avisos na central
 └─ histórico em tal_workflow_runs
```

- O agente guarda as configurações, a memória entre execuções (sites fora do
  ar) e o histórico (50 execuções por workflow).
- O Workflow faz só o trabalho de rede, em etapas duráveis, e devolve o
  resultado ao agente. Ele não lê os seus dados nem os seus segredos.
- Uma execução que não termina em 30 minutos é encerrada como falha. Uma
  execução que falha na Cloudflare gera o aviso **Workflow falhou** (no máximo
  um a cada 6 horas por workflow).
- Sem o binding `TALORYS_WORKFLOW` (uma instalação antiga), o menu mostra o
  aviso de que os workflows não estão configurados e não deixa ligar nenhum.
  Faça o deploy de novo para criar o Workflow.

## Segurança

- Só a sessão do dono gerencia os workflows. Tokens de acesso (n8n, scripts)
  recebem **403** em todas as rotas `/api/workflows`.
- Ligar um workflow ou trocar os endereços pede a senha digitada há pouco.
  Desligar nunca pede.
- Endereços só `https://`, sem usuário e senha, e nunca de rede privada ou
  local (`localhost`, `10.x`, `192.168.x`, `*.local`, `169.254.169.254`…). Antes
  de cada requisição o nome é consultado no DNS e recusado se apontar para um
  endereço privado.
- Cada requisição tem limite de 15 segundos. Redirecionamentos não são
  seguidos.
- O Workflow se identifica com o `User-Agent` `Axis-Workflows/1.0`.

## Custos (plano gratuito)

| Limite do Workers Free | Uso do Axis |
| --- | --- |
| 100 mil requisições por dia | Uma por execução. O monitor a cada 15 minutos usa 96 por dia. |
| 10 ms de CPU por etapa | Uma etapa por endereço; esperar a rede não conta. |
| 100 execuções ao mesmo tempo | No máximo uma por workflow. |
| Estado guardado por 3 dias | O histórico fica no Axis, não depende disso. |

Fonte: [limites dos Workflows](https://developers.cloudflare.com/workflows/reference/limits/)
e [preços](https://developers.cloudflare.com/workflows/reference/pricing/).

## API

| Rota | O que faz |
| --- | --- |
| `GET /api/workflows` | Workflows, as 30 execuções mais recentes, se o binding existe e o fuso |
| `PATCH /api/workflows/:key` | `enabled`, `schedule` (que se repete) e `config`; ligar ou mudar `config` pede a senha recente |
| `POST /api/workflows/:key/run` | Executa agora (uma vez por minuto); 429 com `retry-after` antes disso |
| `GET /api/workflows/:key/runs` | As 50 execuções guardadas desse workflow |

Chave: `site_monitor` (`config: { urls }`).

## Adicionar um workflow

1. Em `packages/shared/src/workflows.ts`: a chave em `WORKFLOW_KEYS`, o schema
   da configuração e os padrões.
2. Em `apps/agent/src/workflows/workflow.ts`: as etapas (rede em `step.do`, uma
   por endereço) e a etapa `report`.
3. Em `apps/agent/src/workflows/service.ts`: o que fazer com o relatório
   (memória e avisos).
4. Textos em inglês com tradução em `packages/shared/src/server-text.ts` e no
   `pt-BR.ts` da interface; testes em `apps/agent/test/workflows.test.ts`.
