---
id: estudo-haiku-ui-design
title: "Estudo: Haiku com kit de UX (regras abertas + checador por código) em criar, melhorar e comparar telas de login"
source_url: https://github.com/melolabs-dev/melolabs/tree/main/studies/haiku-ui-design
kind: experimento
evidence: experimento-proprio
validated_by_author: true
publishable: true
fidelity: resultado-medido
date: 2026-11-10
tags: [ux, ui, css, haiku, data-lake, custo, estudo]
---

# Estudo: Haiku com kit de UX (resultados medidos)

Experimento do Melo Labs: tela de login, três tarefas (T1 criar 12 pedidos, T2 melhorar 20 telas com 3 defeitos injetados, T3 comparar 60 pares), condições A0 puro, A1 +30 regras do data lake (WCAG 2.2, web.dev, Material 3), A2 +relatório do kit (parse5, css-tree, culori; sem navegador), A3 ambos, AC autocrítica (só Haiku, T1). Haiku 5.5 e Sonnet 5.5 por `claude -p`, esforço médio, sem ferramentas, 3 amostras: 2.244 itens, 2.424 chamadas, 0 falhas no final. Opus retirado por custo (decisão do autor). Hashes em `dados/CONGELADO.txt`; desvios em `dados/DESVIOS.md`. Sem dados de empresa.

Resultados (`dados/analise.txt`):
- Pontuação 0-1 (Haiku A0 → A3): T1 0,744 → 0,998; T2 0,754 → 0,926; T3 0,933 → 0,905. Sonnet A0: T1 0,774; T2 0,935; T3 0,938.
- H9 (só contra o Sonnet): acurácia combinada Haiku A3 0,943 vs Sonnet A0 0,882 (razão 1,07), custo por tarefa US$ 0,0022 vs 0,0210 (razão 0,10): suportada. Custo nominal total US$ 19,63 (Haiku 1,69; Sonnet 17,94).
- Holm em 12 comparações: 7 rejeitam H0 (H4, H3, H5 T1 e T2, H6, H7a, H7b). H1, H3b, H5 T3, H7c não passam; H2 não testável (teto: ruído e idênticos 1,00 em tudo).
- axe-core (independente): T1 Haiku violações A0 0,50, A1 0,03, A2 0,08, A3 0,03, AC 0,06; confirma criar, não discrimina melhorar, não confirma kit > autocrítica.
- Estética: UIClip (A 9/15 e 8/15; B 2/5 nas duas tentativas), consistência por código (A 9/15; B 4/5) e juiz Fable vs WiserUI-Bench (55,6%, IC95 49,9-61,1; consistência de posição 58,6%; custo do juiz US$ 21,32) NÃO validaram; estética fora da decisão.
- Ressalva central: as 30 regras que pontuam T1 e T2 são as mesmas dadas no prompt e checadas pelo kit (circularidade); uma tela, telas sintéticas, sem Opus, sem layout no kit; URLs das fontes das regras ainda sem conferência de abertura.
