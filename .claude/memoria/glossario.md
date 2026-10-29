# Glossário

Termos do projeto e onde eles vivem no código.

| Termo | Significado | Onde |
| --- | --- | --- |
| Dono (owner) | O único usuário da instalação | `auth/` |
| Agente | O Durable Object `TalorysAgent`, instância fixa `personal-agent` | `apps/agent/src/agent/talorys-agent.ts` |
| Turno | Uma rodada de chat: contexto → modelo → ferramentas → resposta | `agent/runner.ts` |
| Ferramenta (tool) | Capacidade que o modelo pode chamar, com permissão `read`/`write`/`destructive` | `apps/agent/src/tools/` |
| Proposta / aprovação | Ação destrutiva guardada até o dono aprovar no cartão | `tal_pending_actions`, `ApprovalCard.tsx` |
| Plano de tarefas | Rascunho de projeto + tarefas que o dono confirma | `services/task-plans.ts`, `TaskPlanCard.tsx` |
| Automação / rotina | Lembrete ou prompt de IA agendado no fuso do dono | `agent/scheduling.ts`, `AutomationsPage.tsx` |
| Sentinela | Rotina de IA que só avisa quando algo precisa do dono | `packages/shared/src/sentinels.ts` |
| Workflow | Rotina executada pelos Cloudflare Workflows (menu Workflows) | `apps/agent/src/workflows/` |
| Memória | Fato guardado sobre o dono, com histórico (atual/incerta/passada) | `apps/agent/src/memory/` |
| Clef | Verificação opcional de conflitos de memória por modelo do Workers AI | `memory/conflict.ts` |
| Busca semântica | Embeddings e vetores no SQLite do próprio DO (não Vectorize) | `apps/agent/src/semantic/` |
| Acesso remoto | Tokens bearer para clientes externos, com lista de rotas permitidas | `apps/agent/src/remote/` |
| MCP | Servidores de ferramentas remotos que o dono conecta | `apps/agent/src/mcp/` |
| Step-up | Reautenticação recente exigida para ações sensíveis | `auth/` |
| Avisos (alerts) | Notificações proativas por push, Telegram e e-mail | `apps/agent/src/alerts/` |
| Textos do servidor | Catálogo de traduções do texto gerado no servidor | `packages/shared/src/server-text.ts` |
