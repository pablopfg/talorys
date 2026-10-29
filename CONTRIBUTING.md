# Como contribuir com o Talorys

Obrigado pelo interesse! Relatos de bugs, correções na documentação e pull
requests focados são todos bem-vindos.

## Princípios

O Talorys é um agente **de um único usuário e auto-hospedado** que precisa
caber no plano gratuito da Cloudflare. As mudanças devem manter estas
propriedades:

- Sem telemetria, analytics ou chamadas a serviços operados pelos
  desenvolvedores do Talorys.
- Nenhum serviço pago da Cloudflare ligado automaticamente, e nenhuma troca
  automática para um modelo pago.
- Segredos, tokens de API e bindings de IA/armazenamento nunca chegam ao código
  do navegador.
- O agente não recebe shell, execução de código, HTTP arbitrário nem
  ferramentas de deploy. Ferramentas novas precisam de um schema Zod, um nível
  de permissão e a confirmação do dono para ações destrutivas.
- O instalador continua idempotente e nunca exclui dados do usuário.
- As migrations do Durable Object são só de acréscimo: nunca edite uma migration
  existente.

Para qualquer coisa maior que uma correção de bug, abra uma issue antes para
discutir.

## Ambiente de desenvolvimento

Requer Node.js 24+. O desenvolvimento e o CI usam a LTS ativa, Node.js 26,
fixada no `.nvmrc` (rode `nvm use`).

```bash
npm install
npm run dev
```

Isso roda localmente o Worker do agente, o proxy da Pages Function e a
interface do Vite, com um provedor de IA simulado; não é preciso ter conta na
Cloudflare. Abra http://localhost:5173 e entre com `dev-Owner-violeta-trem-81`.
Veja [docs/development.md](docs/development.md) para os detalhes.

## Antes de abrir um pull request

Abra os pull requests contra a `develop`; a `main` só recebe releases vindas da
`develop` (veja [docs/branch-protection.md](docs/branch-protection.md)).

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Se você mexeu no instalador, rode também `npm run test:pack`.

- Adicione ou atualize testes para mudanças de comportamento.
- Atualize a documentação quando mudar um comportamento visível ao usuário.
- Mantenha os pull requests focados, com uma descrição clara do que muda e por
  quê.
- Escreva títulos e descrições de PR, mensagens de commit, a documentação e o
  changelog em português do Brasil.

## Changelog e releases

Os títulos de pull request seguem o
[Conventional Commits](https://www.conventionalcommits.org/pt-br/), com o
prefixo em inglês e o resto em português (`feat(chat): …`, `fix: …`).
Descreva as mudanças visíveis ao usuário em "Não lançado" no
[CHANGELOG.md](CHANGELOG.md), ou adicione o rótulo `sem-changelog`. As versões e
as releases do GitHub são criadas por workflows; veja
[docs/releases.md](docs/releases.md).

## Como relatar bugs

Abra uma issue com os passos para reproduzir, o comportamento esperado e o que
aconteceu, e a saída de `npx create-talorys@latest doctor` se o problema for de
uma instalação. Remova antes qualquer dado pessoal.

**Problemas de segurança:** não abra uma issue pública. Siga o
[SECURITY.md](SECURITY.md).

## Licença

Ao contribuir, você concorda que as suas contribuições ficam licenciadas sob a
[Licença MIT](LICENSE).
