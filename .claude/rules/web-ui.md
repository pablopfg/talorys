---
paths:
  - "apps/web/src/**"
  - "apps/web/index.html"
  - "apps/web/public/**"
---

# Interface web (`apps/web`)

- React 19 + TanStack Query + React Router + Tailwind. Rotas em `src/App.tsx`
  (páginas pesadas com `Lazy`), chamadas à API em `src/lib/api.ts`, queries e
  mutations em `src/hooks/queries.ts`.
- Reaproveite os componentes de `src/components/ui/index.tsx` (`Button`,
  `Input`, `Dialog`, `ConfirmDialog`, `EmptyState`, `ErrorNotice`,
  `PageHeader`, `Card`, `Badge`, `Switch`, `Spinner`) antes de criar outro.
- **Todo texto visível** vem de `useI18n()` (`t("chave")` ou `rich(...)`).
  Texto literal em JSX quebra o teste de cobertura de i18n.
- Datas e números: passe o `locale` de `useI18n()` para os formatadores.
- UX: todo estado tem tela (carregando, vazio, erro com "tentar de novo",
  sucesso). Ações destrutivas usam `ConfirmDialog`. Feedback por toast
  (`hooks/toast.tsx`). Funciona no celular (teste e2e `@mobile`) e no teclado.
- Acessibilidade: rótulos em campos e botões só com ícone (`aria-label` via
  `t()`), foco visível, contraste AA, nada que dependa só de cor.
- Segurança: nada de segredo, token ou binding no navegador. Nada de
  `dangerouslySetInnerHTML`; Markdown passa por `components/Markdown.tsx`, que
  já trata links. Não acrescente scripts ou estilos de terceiros (a CSP
  bloqueia).
- O texto do servidor chega em inglês: mostre com `serverText(texto)`.
