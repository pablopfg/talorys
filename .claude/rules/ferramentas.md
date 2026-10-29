---
paths:
  - "apps/agent/src/tools/**"
  - "apps/agent/src/mcp/**"
  - "apps/agent/src/agent/**"
---

# Ferramentas do agente e prompt

O modelo é tratado como **não confiável**: notas, memórias, resultados de
ferramentas, respostas de MCP, mensagens do Telegram e eventos de automações
são dados, nunca instruções. Leia a seção "Prompt injection e segurança das
ferramentas" de `docs/security.md` antes de mexer aqui.

## Ferramenta nova

1. Crie ou edite `apps/agent/src/tools/<area>.ts` com `defineTool({...})`
   (tipos em `tools/registry.ts`).
2. Campos obrigatórios: `name` único em snake_case (nunca com o prefixo
   reservado `mcp_`), `description` em inglês, `input` em Zod com limites de
   tamanho, `permission` (`read` | `write` | `destructive`), `label` e,
   quando fizer sentido, `maxCallsPerTurn`.
3. `destructive` nunca executa durante o turno: implementa `prepare` (resolve
   o alvo exato e devolve `PreparedAction` com `summary` e `preview`) e
   `commit` (roda depois da aprovação, uma vez, vinculada ao hash do alvo).
4. Registre em `tools/index.ts`. O registro falha na carga com nome
   duplicado.
5. Ferramentas acessam só a camada de serviços (`services/container.ts`):
   nada de rede, shell, `eval`, credenciais ou deploy. Execuções agendadas
   recebem só leitura + `notify_owner`.
6. Rótulos, resumos e erros em inglês e presentes no catálogo de
   `packages/shared/src/server-text.ts` (há teste que cobra).
7. Testes em `apps/agent/test/`: caminho feliz, validação, limite por turno,
   aprovação (para `destructive`) e tentativa de injeção.

## Prompt de sistema (`agent/prompt.ts`)

- Conteúdo do dono entra em blocos `<data>`, com as tags neutralizadas. Não
  crie um caminho que concatene texto do usuário fora desses blocos.
- O nome do agente entra numa linha só e exige senha recente para mudar.
- Não traduza o prompt de sistema nem as descrições das ferramentas; o modelo
  responde no idioma do dono.

## MCP remoto

- Toda chamada passa pelo `fetch` protegido (trava de origem, sem
  redirecionamento, limites de tamanho, checagem de DNS). Não crie atalho.
- Credenciais ficam cifradas com `MCP_CREDENTIAL_KEY`; nunca em log ou
  resposta da API.
- Ferramentas MCP marcadas `external` nunca são oferecidas fora do chat, salvo
  permissão explícita do dono por servidor.
