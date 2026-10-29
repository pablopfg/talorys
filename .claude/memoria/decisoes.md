# Decisões do projeto

Decisões já tomadas pelo dono do projeto. Elas valem para todo PR; não as
reabra sem pedido dele. Para números, a fonte da verdade é o código citado,
não este arquivo. Acrescente uma linha datada quando surgir decisão nova (sem
dados pessoais, domínio ou segredos: o repositório é público).

## Produto

- **Um único usuário, auto-hospedado, plano gratuito da Cloudflare.** Recurso
  pago (Cloudflare ou API de IA) só com aprovação explícita, marcado com ⚠️.
- **Idioma padrão pt-BR** para interface, servidor, docs, changelog, PRs e
  commits. Código e comentários em inglês. Fuso padrão `America/Sao_Paulo`.
- **Modelos pagos aprovados (2026-10-29):** Anthropic e OpenAI como principal e
  fallback, com teto diário em US$ (`DEFAULT_LIMITS.maxPaidAiUsdPerDay` em
  `packages/shared/src/constants.ts`). Chaves só como Worker secrets
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Veja `docs/modelos-de-ia.md`.
- **Rebrand para Axis (2026-10-29):** planejado, em PRs próprios. Até lá o
  código continua Talorys; não renomeie identificadores por conta própria.
- **Workflows (2026-10-29):** o menu Workflows usa Cloudflare Workflows (plano
  gratuito) e começou só com o monitor de sites. Veja `docs/workflows.md`.

## Segurança

- **Sessão:** encerra por inatividade e por duração máxima; valores e faixas
  em `DEFAULT_SESSION_TIMEOUTS` e `SESSION_TIMEOUT_RANGES`
  (`packages/shared/src/constants.ts`).
- **Senha:** padrão mais forte, nunca aceitar senha fraca: mínimo em
  `PASSWORD_MIN_LENGTH` (`packages/shared/src/password-policy.ts`), checagem
  no Have I Been Pwned que falha fechada, lista de bloqueio e pepper
  (`PASSWORD_PEPPER`).
- **Login:** limite de tentativas por rede, Turnstile para entradas
  arriscadas, 2FA (TOTP e passkeys), recuperação por e-mail. Veja
  `docs/security.md`.
- **Auditoria obrigatória** ao fim de cada ajuste (skill
  `auditoria-seguranca`).

## Armazenamento e limpeza (2026-10-29)

- **Limites por tipo** (`packages/shared/src/storage.ts`) são a trava final: no
  limite, recusar com `STORAGE_LIMIT_REACHED`, nunca apagar para abrir espaço.
  Aviso em 80% em Configurações → Privacidade.
- **Nada some sem passar pela lixeira** (30 dias; arquivo, 1 ano). A lixeira e
  o arquivo são o ponto de restauração da limpeza automática; não há backup
  separado. Exceção: mensagens do chat já cobertas pelo resumo sem lacunas.
- **Tokens de acesso** têm espaço próprio na lixeira e são recusados quando ele
  acaba; nunca empurram itens do dono para fora.
- **Limpeza automática** ligada por padrão, primeira execução 7 dias depois do
  deploy com aviso. A compactação só remove memórias que o agente salvou e
  ninguém editou; nunca as do dono, importadas, por token, em revisão ou
  ligadas a um fato passado. Sem IA.
- Memória "fixada/importante" não existe como campo; se o dono pedir, entra
  como recurso próprio.

## Entrega

- **Deploy pelo GitHub Actions** (`.github/workflows/deploy.yml`), um Worker
  com a interface embutida, no domínio próprio. O domínio fica só na variável
  do ambiente `production` do GitHub, nunca no repositório (docs usam
  `exemplo.com.br`). Não usar Workers Builds.
- **Branches:** trabalho → PR para `develop` → release → `main`. PRs na
  `develop` podem ser mesclados com CI verde; a `main` só é mesclada pelo
  dono.
- **Instalador** publicado como pacote privado no GitHub Packages, só a partir
  de tags (`docs/releases.md`).
- **Sincronização com o projeto original** só manual (o aviso semanal foi
  removido).
