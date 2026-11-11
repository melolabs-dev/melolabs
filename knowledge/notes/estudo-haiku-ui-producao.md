---
id: estudo-haiku-ui-producao
title: "Estudo 3b: completude do data lake de UX para o Haiku em telas grandes (resultados)"
source_url: studies/haiku-ui-producao/dados/analise.txt
kind: estudo-proprio
evidence: experimento-pre-registrado
validated_by_author: false
publishable: false
fidelity: resumo-curado
date: 2026-11-11
tags: [haiku, sonnet, ux, data-lake, completude, bm25, verificador]
---

# Estudo 3b: resultados em uma página (aguardando validação do autor)

Fonte de verdade: `studies/haiku-ui-producao/` (dados brutos, análise, claims.json). 2.640 chamadas, 48 telas por tarefa, 6 famílias sintéticas.

- T4 (revisão aberta, todas as regras violadas), Haiku: L0 46%, L25 57%, L50 63%, L100 70%, D (outros domínios) 51%, BM25-12 54%, L100+relatório 78%.
- Nas regras mostradas: 47%, 59%, 67%, 76% em 0/25/50/100% do lake: ganho aproximadamente linear de 8 a 12 pontos por degrau.
- Volume sem relevância (D) quase não ajuda; BM25 com 12 regras mantém só 31% do ganho (H5 falhou).
- Lake cheio não atrapalhou regras nunca mostradas (+11 pp, H3).
- Relatório do verificador: reduz regras novas que falham e soma 8 pp ao lake cheio no T4, mas no T2 reduz a correção de regras fora da lista (retidas 60% → 28%) e não soma sobre as regras (H6a falhou).
- Haiku com lake supera Sonnet sem lake (70% vs 61%) a 8% do custo por chamada; Sonnet continua melhor nas mesmas condições.
- Limites: telas sintéticas, T4 é revisão de rascunho, verificador errou em ~13% dos veredictos auditados, lake auditado por modelo, custo nominal. Nada vale como afirmação sobre produção real ainda.
