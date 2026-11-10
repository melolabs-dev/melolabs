# Regras de decisão por hipótese (adendo 1, 06/11/2026)

Nível de significância global de 5% por família, com Holm. A família principal é **H4 e H5**; a secundária é H1, H2, H3, H7, H8, H9, H10 e H11. Para decisões por intervalo, o nível de cada passo de Holm define o nível do intervalo (por exemplo, 97,5% bilateral no primeiro passo de duas hipóteses). H6 é descritiva, sem teste.

| Hipótese | Desfecho | Método | Regra de confirmação |
|---|---|---|---|
| H4 | Proporção de execuções com núcleo 100% e typecheck e lint limpos, C4 contra C0 | Intervalo de Newcombe da diferença (C4 − C0), unilateral | Confirmada (equivalente por não inferioridade) se o limite inferior ≥ −0,10 **e** o instrumento é sensível (alguma condição não satura); se C1 também satura, "não informativa (saturação)". Refutada se o limite superior < −0,10 |
| H5 | (a) razão de qualidade (rubrica) cascata ÷ Sonnet; (b) razão de custo de lista | (a) intervalo por permutação estratificada por feature; (b) descritivo | Confirmada se o limite inferior da razão de qualidade ≥ 0,90 e a razão de custo ≤ 0,50. A razão de qualidade vale só na parte (a); uma razão acima de 1,10 não reprova (não inferioridade) |
| H6 | Razão de custo de lista, de tokens totais e de tokens novos (C4 ÷ C0) | Descritivo, IC por bootstrap por feature | Sem teste. Reporta os três números |
| H1 | Soma da rubrica de TechSpec e de Tasks (Sonnet menos Haiku simples) | Diferença das médias dos 3 juízes por artefato; permutação estratificada por feature | Duas subhipóteses (TechSpec, Tasks) dentro da família; confirmada se o limite inferior do IC da diferença ≥ 3 pontos |
| H2, H7, H8, H9 | Conforme `hipoteses.json` | Conforme `hipoteses.json` | Só se forem executadas (fase C); senão "não testada" |
| H3 | Ganho da rubrica de C2 sobre C1 | Idem H1 | Só se a taxa de reprovação no primeiro gate for ≥ 10% na fase A; senão "não testável" |
| H10 | Razão de qualidade e custo do híbrido C6 contra a cascata C5 | Idem H5 | Limite inferior da razão de qualidade ≥ 0,90 e custo menor que o da C5 |
| H11 | Ganho da rubrica de C10, C11 e C12 sobre C1 (3 contrastes), com C13 como controle | Idem H1 | Três subhipóteses; o contraste só vale se o controle C13 ficar dentro da margem de 2 pontos de zero |

Margens de equivalência e limiares: os de `hipoteses.json`. Status possíveis: confirmada, refutada, equivalente, subpotente, não informativa, não testada, não testável.
