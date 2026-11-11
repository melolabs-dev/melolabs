---
name: kit-ux-haiku
description: Dá ao Haiku um kit de UX (lake de regras abertas, verificador em navegador e relatório de regras violadas) para criar, melhorar ou revisar telas. Use ao pedir a um modelo pequeno que revise ou conserte uma tela para produção e você quer medir ou aumentar a conformidade com regras de UX e acessibilidade.
---

# Kit de UX para modelo pequeno

Métodos dos estudos 3 (`studies/haiku-ui-design`, tela de login) e 3b (`studies/haiku-ui-producao`, seis famílias de tela grande).

## O que funcionou (medido)
- **Tela simples:** Haiku com 30 regras e o relatório do kit foi de 0,744 para 0,998 ao criar e de 0,754 para 0,926 ao melhorar; acurácia combinada 1,07 vez a do Sonnet puro, a 10% do custo por tarefa.
- **Tela grande, pedido vago:** o acerto do Haiku foi de 46% sem regras para 57%, 63% e 70% com 25%, 50% e 100% do lake, e 78% com o lake e o relatório. O Haiku com o lake superou o Sonnet sem ele (61%) a cerca de 8% do custo por chamada.
- **A regra certa pesa mais que o volume:** o mesmo número de regras de outros assuntos só chegou a 52%.

## Passos
1. **Lake de regras.** Cada regra: `id`, texto, domínio, URL da fonte aberta (WCAG, GOV.UK, web.dev, MDN, USWDS, NN/g, Baymard público). **Audite cada regra contra a página da fonte**: no estudo 3b só 111 de 200 foram totalmente sustentadas, 86 parcialmente (reescreva para o que a página diz) e 3 não. Guarde só o texto reescrito (`regra_final`).
2. **Verificador por regra.** Para cada regra verificável, um teste em navegador real (`playwright-core` com Chrome) mais `axe-core` para o que ele cobre. Valide com telas limpas, violação isolada e violações juntas; depois **audite uma amostra dos veredictos** (no estudo errou em cerca de 13%).
3. **Relatório.** Rode o verificador sobre a tela e entregue ao modelo a lista de regras violadas, só entre as regras que o lake mostra.
4. **Prompt.** Mostre **todas as regras da família da tela** (em tela grande ficou em cerca de 19 mil tokens de entrada) e o relatório. Uma busca simples com as 12 regras mais próximas (BM25) recuperou só 31% do ganho: não use recuperação fraca no lugar do conjunto inteiro.
5. **Resposta.** Peça trechos ANTES/DEPOIS e aplique por código; peça que o modelo liste as decisões citando o id da regra. Rode o verificador de novo e o `axe-core` como medida independente.
6. **Parâmetros do estudo.** `--effort medium`, sem ferramentas, sem internet, 3 amostras (Haiku) e telas pareadas entre condições.

## Dependências externas
Node (o estudo usou v24) com `axe-core`, `css-tree`, `culori`, `parse5` e `playwright-core`; Google Chrome instalado (`channel: 'chrome'`); Python com `numpy` e `scipy` para a análise; Claude Code CLI.

## Limites que você deve repetir ao usar
Telas sintéticas; o verificador e o relatório vêm do mesmo autor das regras (circularidade); mede-se conformidade com regras, não estética nem resultado de produto. O relatório sozinho faz o modelo corrigir só o que está nele.
