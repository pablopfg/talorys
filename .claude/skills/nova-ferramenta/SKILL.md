---
name: nova-ferramenta
description: Passo a passo para criar uma ferramenta nova do agente do Talorys com schema, permissão, aprovação, tradução e testes. Use quando o agente precisar de uma capacidade nova.
---

# Nova ferramenta do agente

Leia `.claude/rules/ferramentas.md` e a seção "Prompt injection e segurança
das ferramentas" de `docs/security.md` primeiro.

1. **Desenho.** Defina o que a ferramenta lê e muda e escolha a permissão:
   - `read`: só lê; pode rodar em execuções agendadas.
   - `write`: cria ou muda sem apagar texto do dono.
   - `destructive`: apaga, substitui ou cancela → `prepare` + `commit`, com
     aprovação do dono.
   Se a ferramenta precisaria de rede, shell, credencial ou deploy, **pare** e
   pergunte ao dono: isso fere as regras do projeto.
2. **Código.** Em `apps/agent/src/tools/<area>.ts`, com `defineTool({...})`:
   `name` em snake_case (sem `mcp_`), `description` clara em inglês para o
   modelo, `input` Zod com `.max()` em strings e listas, `label`,
   `maxCallsPerTurn` quando repetir for perigoso. A lógica fica no serviço da
   área, não na ferramenta.
3. **Registro.** Acrescente ao `ALL_TOOLS` em `apps/agent/src/tools/index.ts`.
4. **Textos.** Rótulos, resumos de aprovação e erros em inglês, com entrada no
   catálogo `PT_BR` de `packages/shared/src/server-text.ts`.
5. **Testes** em `apps/agent/test/`: caminho feliz com o `MockAIProvider`,
   entrada inválida, limite por turno, aprovação e item alterado antes da
   aprovação (para `destructive`), e um texto injetado numa nota ou memória
   tentando acionar a ferramenta.
6. **Docs.** Atualize `docs/security.md` se a ferramenta muda o que o agente
   consegue fazer, e o changelog em `### Adicionado`.
7. Rode `verificar` e `auditoria-seguranca`.
