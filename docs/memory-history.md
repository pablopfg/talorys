# Histórico de memória

Fatos pessoais mudam. O histórico de memória deixa o Axis acompanhar:

- Quando você diz "I sold my Volkswagen and bought a Tesla" (vendi meu
  Volkswagen e comprei um Tesla), o Tesla passa a ser o atual e o Volkswagen
  fica guardado como **fato passado**. Pergunte "What car do I drive?" e a
  resposta é o Tesla; pergunte "What did I drive before?" e o Volkswagen
  continua lá.
- Quando duas memórias *podem* conflitar, mas não está claro ("I live in Paris"
  depois de "I live in London"), o Axis mantém as duas e pergunta a você na
  página **Memória**.
- Nada é sobrescrito em silêncio, e nada é excluído a menos que você peça.

Os exemplos estão em inglês porque as regras de texto que detectam mudanças e
perguntas sobre o passado, por enquanto, reconhecem frases em inglês (veja
[Limitações conhecidas](#limitações-conhecidas)).

Funciona com a busca por palavra-chave e com a
[busca semântica](semantic-recall.md), não usa IA por padrão e não precisa de
nenhum serviço a mais da Cloudflare.

## Status

Toda memória tem um status:

- **Atual**: o que o Axis trata como verdade agora.
- **Histórica** ("Passado"): era verdade antes; fica guardada para perguntas
  sobre o passado.
- **Incerta**: marcada como possivelmente desatualizada.

As memórias que já existiam antes deste recurso são todas atuais.

## Como as mudanças são detectadas

Quando você salva ou edita uma memória (na página **Memória**, ou quando o
Axis usa as ferramentas `remember` / `update_memory` no chat), o Axis
procura memórias atuais relacionadas (as que têm palavras em comum, ou que
tratam do mesmo assunto de valor único: onde você mora, o seu carro, o seu
trabalho, a sua dieta, o seu relacionamento) e decide:

| Memória nova vs. antiga | Exemplo | Resultado |
| --- | --- | --- |
| Substituição explícita | "I moved from London to New York" vs. "I live in London" | **As duas ficam**; aparecem em *Para revisar* como possível atualização |
| Mudança explícita de um assunto de valor único | "I moved permanently to Paris" vs. "I live in London" | **As duas ficam**; aparecem em *Para revisar* como possível atualização |
| Versão mais detalhada | "Prefers green tea in the morning with honey" vs. "Prefers green tea in the morning" | **As duas ficam**; aparecem em *Para revisar* como possível atualização |
| Mesmo assunto, sem clareza | "I live in Paris" vs. "I live in London" | **As duas ficam**; aparecem em *Para revisar* |
| Acréscimo / sem relação | "I visited Paris" vs. "I live in London" | Nada muda |

Sem a verificação por IA, o Axis nunca aposenta uma memória sozinho. As
regras de texto ("sold", "moved", "no longer", "replaced", …) só sinalizam uma
provável substituição para você revisar; escolha **Marcar a antiga como
passado** para manter a antiga como histórico. A detecção só roda quando uma
memória é gravada, nunca a cada mensagem do chat.

Quando o Axis reescreve uma memória com `update_memory`, o texto novo é
salvo como uma memória nova e a antiga vira um fato passado ligado a ela, igual
a **Atualizar este fato** na página **Memória**, então o agente nunca consegue
apagar o que você contou.

As datas só são registradas quando você as informa ("since 2024", "in March
2025", "as of 2026-02-01"). O Axis nunca trata o momento da gravação como a
data em que um fato passou a ser verdade.

### Verificação opcional de conflitos por IA

**Configurações → IA → Histórico de memória → Verificar conflitos com IA**
(desligado por padrão) entrega a decisão ao
[Clef](https://developers.cloudflare.com/workers-ai/models/clef/)
(`@cf/cloudflare/clef`), o modelo de decisão da Cloudflare no Workers AI, pelo
mesmo binding `AI` do chat. Sem chave nem serviço novos.

Com ela ligada, as regras de texto e a busca semântica só *indicam* memórias
mais antigas: as que batem nas regras, mais até 3 memórias atuais com cosseno de
0,60 ou mais em relação à nova (só com a busca semântica ligada; só vetores
atualizados são usados). Uma chamada ao Clef por gravação pergunta como a
memória nova se relaciona com cada uma delas, e o Clef devolve uma
probabilidade para cada resposta:

| Resposta do Clef | Resultado |
| --- | --- |
| Substitui, probabilidade de 0,8 ou mais | A antiga vira passado (reversível) |
| Substitui, abaixo de 0,8 | **As duas ficam**; aparecem em *Para revisar* |
| Conflita | **As duas ficam**; aparecem em *Para revisar*. Para uma memória encontrada só por semelhança, o conflito precisa de probabilidade de 0,7 ou mais; abaixo disso nada muda |
| Mais detalhe, compatível ou sem relação | Se as regras de texto a teriam substituído: **as duas ficam**; aparecem em *Para revisar*. Se as regras de texto a sinalizaram para revisão: ela continua em *Para revisar*, a menos que o Clef tenha 0,8 ou mais de certeza nessa resposta. Nos outros casos nada muda |

Os fatos são enviados como dados, e só as probabilidades do Clef são lidas,
nunca texto livre. Cada chamada conta como um pedido no seu limite diário de
pedidos de IA (o Clef cobra só os tokens de entrada; uma verificação custa
cerca de 7 a 17 Neurons). A verificação só roda quando há algo com que
comparar.

O Clef tem 3 segundos para responder. Quando ele não consegue responder (IA
simulada ou modo Demo, limite diário atingido, sem resposta em 3 segundos, um
erro ou uma resposta inesperada), a verificação volta para as regras de texto:
as que batem aparecem em *Para revisar*, como com a verificação desligada; nada
é aposentado, e as memórias indicadas só por semelhança ficam como estão. O
Clef e o limite diário são conferidos antes de qualquer busca por semelhança,
então uma gravação nesse caso não gasta embeddings. A memória nova recebe o
próprio embedding se o vetor dela estiver faltando ou desatualizado (contado no
limite diário de embeddings); memórias antigas com vetores desatualizados são
puladas até o índice em segundo plano alcançá-las. Um tempo esgotado conta como
erro de IA. Uma gravação cancelada enquanto o Clef responde também termina com
as regras de texto, mas não conta como erro de IA.

Com a verificação desligada, a detecção é só pelas regras de texto, como
descrito acima: as que batem esperam em *Para revisar* e nenhuma memória é
aposentada automaticamente.

Desligar **Revisão de conflitos de memória** desativa a detecção por completo;
as memórias passam a ser salvas exatamente como antes.

## Revisar conflitos

Na página **Memória**, *Possíveis conflitos* mostra a memória mais recente e a
mais antiga lado a lado:

- **Manter ambas**: as duas continuam atuais.
- **Marcar a antiga como passado**: a mais antiga vira histórico.
- **Substituir a antiga**: a mais antiga é excluída de vez.
- **Descartar a recente**: a mais recente é excluída de vez.

## Gerenciar memórias

Use os filtros **Todas · Atuais · Históricas · Para revisar**. Para cada
memória:

- **Atualizar este fato** (↻): algo mudou; salve a versão nova e mantenha a
  antiga como histórico.
- **Editar** (✎): corrija um erro de digitação no lugar (sem histórico).
- **Marcar como passado / Restaurar como atual**.
- **Histórico** (🕒): "Atual: … / Anteriormente: …".
- **Excluir**: definitivo.

## O que a IA vê

Cada turno do chat inclui um pequeno conjunto de memórias relevantes (no máximo
8, dentro de 20% do **Máximo de tokens de contexto** e nunca mais de 1.500
tokens), em seções rotuladas: *atuais*, *possivelmente desatualizadas* e
*históricas, não atuais*. Cada uma é marcada como dado, não como instrução.
Fatos passados só entram quando a sua pergunta é sobre o passado ("before",
"previously", "used to", "did I…"), junto com o que os substituiu.

Com a [busca semântica](semantic-recall.md) ligada, as mesmas regras valem para
os resultados por significado: fatos passados ficam de fora das perguntas no
presente.

## Backups

- Os backups incluem o status, as datas e o vínculo "substituída por" de cada
  memória. A versão do formato de backup não mudou (v1); versões antigas do
  Axis ignoram os campos novos.
- Backups antigos são importados sem mudança; as memórias deles ficam atuais.
- Os vínculos importados são conferidos: vínculos para memórias que não
  existem, vínculos para si mesma e ciclos são descartados.
- A importação é idempotente, e uma memória que você editou depois do backup não
  é sobrescrita pela cópia mais antiga.
- As revisões de conflito pendentes não entram nos backups.

## Excluir

Excluir uma memória remove a memória, a entrada dela no índice de texto
completo, o vetor semântico (se houver), as revisões de conflito, os vínculos
de outras memórias e a linha do registro de atividade que a citava. O histórico
nunca traz de volta dados excluídos. Uma memória que a excluída tinha
substituído continua histórica; você pode restaurá-la.

## Limitações conhecidas

- Sem a verificação de conflitos por IA, a detecção de mudanças usa regras de
  texto em inglês e um punhado de assuntos. As outras mudanças ficam lado a lado
  ou são sinalizadas para revisão, em vez de substituídas.
- As "perguntas sobre o passado" são detectadas por frases em inglês.
- Sem a busca semântica, uma pergunta sobre o passado só encontra fatos antigos
  que tenham palavras em comum com ela (mais as versões anteriores do que ela
  encontrar).
