# Avaliação das superfícies semânticas

Relatório gerado por `scripts/semantic-eval.mjs`. As consultas e os itens são os casos de teste, em inglês.

Modelo: `@cf/baai/bge-m3`  
Data: 2026-10-15T04:05:42.551Z  
Piso: 0.55

Resultado: PASSOU (18/18 casos passam)

| Caso | Consulta | Tipo | Alvo | Cosseno do alvo | Posição | Melhor distrator | Cosseno do distrator | Seção do prompt | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EX-T1 | doc appt soon? | positivo | patel | 0.607 | 1 | dentist | 0.577 | 2 itens | passou |
| EX-T2 | travel prep? | positivo | passport | 0.641 | 1 | brakes | 0.519 | 1 item | passou |
| EX-T3 | car stuff? | positivo | brakes | 0.640 | 1 | gutters | 0.531 | 1 item | passou |
| EX-T4 | whats 2+2 | negativo | — | — | — | plants | 0.370 | nenhum | passou |
| EX-T5 | gm | negativo | — | — | — | router | 0.456 | nenhum | passou |
| EX-T6 | capital of france | negativo | — | — | — | lisbon | 0.407 | nenhum | passou |
| EX-N1 | gift ideas for dad? | positivo | skillet | 0.608 | 1 | mom-birthday | 0.543 | 1 item | passou |
| EX-N2 | door code? | positivo | keypad | 0.600 | 1 | garage | 0.571 | 2 itens | passou |
| EX-N3 | dogs ok here? | positivo | lease | 0.585 | 1 | review | 0.510 | 1 item | passou |
| EX-N4 | who wrote hamlet | negativo | — | — | — | lake-house | 0.328 | nenhum | passou |
| EX-N5 | who won last nite | negativo | — | — | — | recipes | 0.459 | nenhum | passou |
| EX-N6 | thx | negativo | — | — | — | plants | 0.420 | nenhum | passou |
| EX-A1 | garbage night? | positivo | bins | 0.584 | 1 | gutters | 0.557 | 2 itens | passou |
| EX-A2 | bill reminders? | positivo | rent | 0.550 | 4 | bins | 0.614 | 3 itens | passou |
| EX-A3 | vit D reminder? | positivo | vitamin | 0.648 | 1 | bins | 0.525 | 1 item | passou |
| EX-A4 | brb | negativo | — | — | — | brakes | 0.399 | nenhum | passou |
| EX-A5 | weather tmrw | negativo | — | — | — | umbrella | 0.478 | nenhum | passou |
| EX-A6 | hi | negativo | — | — | — | review | 0.534 | nenhum | passou |

## Linhas informativas

| Linha | Consulta | Comparada com | Cosseno |
| --- | --- | --- | --- |
| XT-weather-umbrella | weather tmrw | umbrella reminder | 0.478 |
| XT-trash-old | trash | bins reminder, old text | 0.540 |
| XT-trash-slim | trash | bins reminder, slim text | 0.611 |
| XT-trash-reminder-old | do i have a reminder about trash | bins reminder, old text | 0.699 |
| XT-trash-reminder-slim | do i have a reminder about trash | bins reminder, slim text | 0.749 |
| XT-garbage-night-old | garbage night? | bins reminder, old text | 0.492 |
| XT-garbage-night-slim | garbage night? | bins reminder, slim text | 0.584 |
