# Solução de problemas

Comece com:

```bash
npx create-talorys@latest doctor
```

## Instalação

As mensagens do instalador aparecem em inglês, como o próprio terminal as
mostra.

**O login pelo navegador não abre ou expira.** Copie para o navegador a URL que
o Wrangler imprime. Em SSH ou em containers, defina `CLOUDFLARE_API_TOKEN` em
vez disso.

**"Multiple Cloudflare accounts are available."** Informe
`--account-id <id>` no modo não interativo.

**"…lacks a required permission."** Você precisa poder editar Workers e Pages na
conta escolhida (veja [deployment.md](deployment.md#permissões)).

**"The deployment did not pass its health checks yet."** Sites `pages.dev` novos
podem levar alguns minutos para receber DNS e certificados. Rode o mesmo comando
de novo; ele continua de onde parou sem duplicar nada.

**"…already exists and is not a Talorys installation."** Escolha outra pasta com
`--dir`. O instalador nunca sobrescreve pastas que não são dele.

**"SQLite-backed Durable Objects are not available."** Confira as configurações
de Workers da conta; Durable Objects com SQLite fazem parte do plano Free.

## Usando o Talorys

**"Sua conta Cloudflare usou a cota do Workers AI de hoje."** A cota diária
gratuita de Neurons acabou. O chat volta depois que a cota reinicia; tarefas,
notas, memórias e lembretes continuam funcionando. O uso exato fica no painel da
Cloudflare (Workers AI).

**"O Talorys atingiu o limite diário de N pedidos de IA."** Esse é o limite de
proteção do próprio Talorys; aumente-o em **Configurações → IA**.

**"Muitas tentativas sem sucesso."** Espere 15 minutos, use **Esqueceu a
senha?** na tela de login (quando o e-mail estiver configurado) ou redefina a
senha com `npx create-talorys@latest reset-password`.

**Lembretes disparam na hora errada.** Confira **Configurações → Geral → Fuso
horário**. Mudar o fuso reagenda todas as automações.

**"O modelo de IA configurado não está disponível."** Escolha em
**Configurações → IA** um modelo do Workers AI compatível com chamada de
ferramentas (o padrão é `@cf/zai-org/glm-4.7-flash`).

## Desenvolvimento

**`database is locked: SQLITE_BUSY`**: dois runtimes locais estão usando a mesma
pasta de estado. Pare os processos `wrangler` perdidos; os scripts de
desenvolvimento usam pastas separadas para o Worker e para o Pages.

**Porta já em uso**: pare outros servidores de desenvolvimento nas portas 5173,
8787 ou 8788.

## Servidores MCP

Veja [Servidores MCP remotos → Solução de problemas](mcp.md#solução-de-problemas)
para as mensagens de conexão, autenticação e ferramentas.
