@AGENTS.md

## Específico do Claude Code

- Regras por área em `.claude/rules/`: carregam sozinhas quando você abre um
  arquivo do caminho correspondente. Releia a regra da área antes de mudar
  algo nela.
- Skills do projeto (`.claude/skills/`):
  - `/verificar`: typecheck, lint e testes, com resumo das falhas.
  - `/auditoria-seguranca`: auditoria independente obrigatória ao fim de cada
    ajuste.
  - `/preparar-pr`: título, changelog e descrição do PR em pt-BR.
  - `/nova-migration` e `/nova-ferramenta`: passo a passo seguro para as duas
    mudanças mais delicadas do agente.
- Subagentes (`.claude/agents/`): `verificador`, `auditor-seguranca`,
  `revisor-cloudflare` e `revisor-ux`. Use-os para revisões independentes; eles
  não editam código, só relatam.
- O plugin oficial `cloudflare` (marketplace `cloudflare/skills`) está
  declarado em `.claude/settings.json`. Prefira as skills dele
  (`workers-best-practices`, `durable-objects`, `agents-sdk`, `wrangler`) a
  lembrar de APIs da Cloudflare de memória. O plugin também traz o servidor
  MCP da Cloudflare, que só funciona depois de um login OAuth explícito: use-o
  para consultar documentação e o estado da conta, nunca para fazer deploy,
  mudar recursos ou ler segredos da conta de produção sem pedido do dono.
- Memória do projeto versionada: `.claude/memoria/`. Quando o dono decidir algo
  que valha para os próximos PRs, acrescente em `decisoes.md` (sem dados
  pessoais, domínio ou segredos).
- Preferências locais vão em `CLAUDE.local.md` ou `.claude/settings.local.json`,
  ambos ignorados pelo Git.
