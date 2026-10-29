# Desenvolvimento

```bash
npm install
npm run dev
```

| Processo | Porta | Para quê |
| --- | --- | --- |
| `wrangler dev --local` (apps/agent) | 8787 | Worker do agente + Durable Object (estado em `.wrangler/state`) |
| `wrangler pages dev` (apps/web) | 8788 | Pages Function real + service binding `AGENT` |
| Vite | 5173 | Interface com HMR; repassa `/api` para a 8788 |

`scripts/dev-setup.mjs` cria `apps/agent/.dev.vars` (ignorado pelo git) com
`TALORYS_ENV=development`, o provedor de IA simulado, um hash de senha local, um
segredo de sessão e um par de chaves do Web Push (os navegadores permitem push
em `localhost`). Defina `TALORYS_DEV_PASSWORD` antes da primeira execução para
escolher a senha, ou apague o arquivo para gerá-lo de novo. Um arquivo criado
antes de o push existir ganha um par de chaves do Web Push na próxima execução;
nada mais nele muda.

### Workers AI real no ambiente local

```bash
npx wrangler login
npm run dev:remote-ai -w @talorys/agent   # no lugar de dev:agent
```

### Scripts

| Script | O que faz |
| --- | --- |
| `npm run build` | Build da web, bundle do Worker (simulação), CLI + templates |
| `npm test` | Testes do shared, do agente (dentro do workerd), da Pages Function e do instalador |
| `npm run test:e2e` | Testes de interface com Playwright num ambiente local isolado |
| `npm run test:pack` | Roda `npm pack` no instalador e o executa fora do monorepo |
| `npm run test:smoke` | Teste opcional com um deploy real na Cloudflare |
| `npm run typecheck` | TypeScript em todos os workspaces |
| `npm run lint` | Biome |

### Intenções da IA simulada

`remember …`, `add task …`, `add note …`, `complete task …`, `list tasks`,
`remind me in N minutes to …`, `search …`. Qualquer outra coisa recebe uma
resposta de eco.

### Busca semântica

Com o provedor de IA simulado (ou no modo Demo), a
[busca semântica](semantic-recall.md) usa o gerador de embeddings simulado no
lugar do Workers AI: um saco de palavras com hash determinístico mais uma
pequena tabela de conceitos (car/tesla/oil, vegetarian/dinner, peanut/allergic,
city/denver, heights/mountains/knee). Ele percorre o caminho de código completo
sem rede, mas não produz semelhança semântica de verdade. O cartão nas
Configurações mostra "Simulado (dev local)" como gerador de embeddings. Use
`dev:remote-ai` para testar embeddings reais.

### Adicionar uma ferramenta

1. Crie `apps/agent/src/tools/<nome>.ts` com entradas `defineTool({...})`.
2. Registre-as em `apps/agent/src/tools/index.ts`.
3. Adicione testes em `apps/agent/test/`.

### Textos da interface e idiomas

Os textos da interface ficam em `apps/web/src/lib/i18n/en.ts`. Os componentes os
leem por `useI18n()`: `t("chave")` para textos simples e atributos,
`rich("chave", {...})` quando um parâmetro é um elemento, como `<code>`. Os
marcadores são escritos como `{nome}`, e os nomes deles são conferidos pelo
TypeScript contra o texto em inglês. Uma mensagem com plural é um objeto com as
categorias do `Intl.PluralRules` como chaves (`one`, `few`, `many`, `other`,
...) e recebe `{count}`.

As chaves são agrupadas por onde o texto aparece: `nav.*` para a estrutura do
app, `tasks.*`, `memory.*` e assim por diante para cada página. Rótulos que
muitas telas compartilham, como Cancelar, Excluir e Fechar, ficam em
`common.*`.

Passe o `locale` de `useI18n()` para `formatDateTime`, `relativeTime`,
`toLocaleString` e os outros formatadores de exibição, para que datas e números
sigam o idioma escolhido.

O idioma padrão é o português do Brasil (`DEFAULT_LANGUAGE` em
`packages/shared/src/constants.ts`). Ele vale para instalações novas e para
"Padrão do navegador" quando o navegador pede um idioma que o Talorys não tem.
Uma instalação pode escolher outro padrão com a variável
`TALORYS_DEFAULT_LANGUAGE` do Worker (`en`, `ko`, `pt-BR` ou `system`); os
testes do agente e o servidor dos testes e2e a definem como `en`, e o navegador
dos testes e2e começa em inglês.

Para adicionar um idioma:

1. Adicione o código dele a `LANGUAGES` em `packages/shared/src/constants.ts`.
2. Crie `apps/web/src/lib/i18n/<código>.ts` exportando um objeto que
   `satisfies Translation`. As chaves que faltarem nele caem para o inglês;
   chaves que não existem em inglês são erro de tipo.
3. Registre-o em `translations` em `apps/web/src/lib/i18n/core.ts` e adicione o
   nome dele, no próprio idioma, a `LANGUAGE_NAMES` em
   `apps/web/src/lib/i18n/index.tsx`.

Os textos gerados no servidor (erros da API, notificações, resumos, rótulos de
ferramentas e de aprovações, erros de automações) são escritos em inglês e
guardados assim. `packages/shared/src/server-text.ts` os traduz a partir de um
catálogo cujas chaves são o texto em inglês, com marcadores `{nome}` para as
partes que variam. O app web os mostra por `serverText(texto)`, de `useI18n()`,
e o Web Push traduz o título e o corpo antes de enviar, usando o idioma
configurado pelo dono. Um texto que o catálogo não conhece, como o que o modelo
escreveu, aparece como está. O prompt de sistema do agente e as descrições das
ferramentas não são traduzidos; o modelo responde no idioma em que o dono
escreve.

O CI mantém as traduções completas conforme o código muda:

- `apps/web/test/i18n-coverage.test.ts` falha quando uma chave em inglês não tem
  mensagem em `pt-BR`, quando uma tradução perde um marcador ou quando um
  componente escreve texto de interface diretamente, em vez de usar `t()`. Um
  texto só para desenvolvedores pode ficar de fora com um comentário
  `// i18n-ignore` na linha de cima.
- `apps/web/test/server-text-coverage.test.ts` falha quando o agente lança um
  erro ou define um rótulo, resumo, motivo, título ou corpo cujo texto não está
  no catálogo de textos do servidor.

Então uma mudança que acrescenta texto o acrescenta a `en.ts` e a `pt-BR.ts` (ou
ao catálogo de textos do servidor) no mesmo pull request.

### Documentação

A documentação em `docs/`, o `README.md`, o `CHANGELOG.md` e os textos de PRs,
commits e releases são escritos em português do Brasil. Nomes de código,
comandos, variáveis e rótulos de serviços de terceiros que não têm interface em
português (GitHub, Cloudflare, Google Cloud) ficam como aparecem na tela.

### Adicionar uma migration

Acrescente ao `MIGRATIONS` em `apps/agent/src/db/migrations.ts` com a próxima
versão. Nunca edite entradas existentes nem apague dados do dono.
