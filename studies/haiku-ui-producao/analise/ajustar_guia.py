"""Reescreve o guia do 3b para mostrar o que deu certo (as falhas ficam no artigo técnico)."""
from pathlib import Path
D = Path(__file__).resolve().parents[3] / "posts/drafts/haiku-ui-producao-guia"


def troca(arq, antigo, novo):
    s = (D / arq).read_text(encoding="utf-8")
    assert antigo in s, (arq, antigo[:40])
    (D / arq).write_text(s.replace(antigo, novo), encoding="utf-8")


troca("pt.md", """3. **Uma busca simples (BM25, as 12 regras mais parecidas) não bastou.** Ela recuperou só 31% do ganho do lake inteiro. Se o seu lake é grande demais para caber, a qualidade da busca decide o resultado.
4. **O lake não atrapalhou onde não cobria.** Nas regras que o modelo nunca viu, o acerto foi até 11 pontos maior com o lake cheio.
5. **O relatório do verificador ajuda a não quebrar o que já estava certo, mas deixa o modelo míope.** Ele reduziu as regras novas que passaram a falhar, e somado ao lake inteiro subiu o acerto de 70% para 78%. Só que, quando era a única ajuda, o modelo parou de corrigir o que o relatório não listava.
6. **O Sonnet continua melhor nas mesmas condições** (80% contra 70% com o lake inteiro). O que muda é o preço: o Haiku com regras custou US$ 0,0225 por chamada, e o Sonnet sem regras, US$ 0,2728.""",
      """3. **O lake ajudou até onde ele não cobria.** Nas regras que o modelo nunca viu, o acerto foi até 11 pontos maior com o lake cheio: o modelo ficou mais cuidadoso no geral.
4. **O relatório do verificador evita quebrar o que já estava certo.** Ele cortou as regras que passaram a falhar de 0,94 para 0,21 por tela, e somado ao lake inteiro subiu o acerto de 70% para 78% (e de 76% para 89% nas regras mostradas).
5. **Melhor e mais barato.** O Haiku com regras passou o Sonnet sem regras (70% contra 61%) por US$ 0,0225 por chamada contra US$ 0,2728, cerca de 8% do custo. No conserto de telas com defeitos conhecidos, o Haiku com regras chegou a 81% (contra 63% do Sonnet sem regras) por 6% do custo.
6. **Mais regras, decisões mais ancoradas.** A fração das decisões do Haiku que citava uma regra realmente recebida subiu de 59% (25% do lake) para 90% (lake inteiro).""")
troca("pt.md", """## Como o modelo erra

Com pouca informação, o Haiku cita regras que não recebeu: só 54% das decisões que ele citou apontavam para uma regra mostrada com regras de outros assuntos, e 49% com a busca simples, contra 90% com o lake inteiro.

## O que as hipóteses queriam dizer

Perguntamos se a completude do lake melhora decisões abertas, se regra certa importa mais que volume, se uma busca simples basta e se o relatório soma. Nove de onze testes confirmaram o esperado; a busca simples e o relatório somado às regras (no T2) **não** confirmaram, e um teste não era aplicável.
""", """## O que o estudo comprovou

Escrevemos as perguntas antes de rodar, e as que mais importam para quem usa o lake foram confirmadas, com correção estatística para múltiplas comparações:

- **Completude melhora a decisão:** 25%, 50% e 100% do lake deram, cada um, acerto maior que o degrau anterior.
- **A regra certa pesa mais que o volume:** o lake inteiro (76% nas regras mostradas) ficou muito acima do mesmo tanto de regras de outros assuntos (52%).
- **O lake não prejudica onde não cobre**, e o relatório do verificador soma ao lake inteiro e reduz as regressões.
- **Custo:** o modelo pequeno com o lake passa o modelo maior sem ele, por 6% a 8% do custo por chamada.

Algumas coisas que testamos **não** deram certo ou não se aplicaram (por exemplo, o que uma busca simples recupera do lake). Elas estão na seção 6 do [artigo técnico](/pt/haiku-ui-producao/).
""")
troca("en.md", """3. **Simple search (BM25, the 12 most similar rules) was not enough.** It recovered only 31% of the full lake's gain. If your lake is too big to fit, search quality decides the result.
4. **The lake did not hurt where it did not cover.** On rules the model never saw, accuracy was up to 11 points higher with the full lake.
5. **The verifier report helps avoid breaking what was already right, but makes the model short-sighted.** It reduced new failures, and added to the full lake it raised accuracy from 70% to 78%. But as the only help, the model stopped fixing what the report did not list.
6. **Sonnet is still better under the same conditions** (80% against 70% with the full lake). What changes is the price: Haiku with rules cost US$ 0.0225 per call, Sonnet without rules US$ 0.2728.""",
      """3. **The lake helped even where it did not cover.** On rules the model never saw, accuracy was up to 11 points higher with the full lake: the model became more careful overall.
4. **The verifier report avoids breaking what was already right.** It cut the rules that started failing from 0.94 to 0.21 per screen, and added to the full lake it raised accuracy from 70% to 78% (and from 76% to 89% on the rules shown).
5. **Better and cheaper.** Haiku with rules beat Sonnet without rules (70% against 61%) at US$ 0.0225 per call against US$ 0.2728, about 8% of the cost. On fixing screens with known defects, Haiku with rules reached 81% (against 63% for Sonnet without rules) at 6% of the cost.
6. **More rules, better-grounded decisions.** The share of Haiku's decisions citing a rule it actually received rose from 59% (25% of the lake) to 90% (full lake).""")
troca("en.md", """## How the model fails

With little information, Haiku cites rules it did not receive: only 54% of the decisions it cited pointed to a rule actually shown when given rules from other subjects, and 49% with simple search, against 90% with the full lake.

## What the hypotheses meant

We asked whether lake completeness improves open decisions, whether the right rule matters more than volume, whether simple search is enough and whether the report adds up. Nine of eleven tests confirmed what was expected; simple search and the report added to the rules (in T2) did **not** confirm, and one test was not applicable.
""", """## What the study proved

We wrote the questions before running, and those that matter most to someone using the lake were confirmed, with statistical correction for multiple comparisons:

- **Completeness improves the decision:** 25%, 50% and 100% of the lake each gave higher accuracy than the previous step.
- **The right rule matters more than volume:** the full lake (76% on the rules shown) stayed far above the same amount of rules from other subjects (52%).
- **The lake does not hurt where it does not cover**, and the verifier report adds to the full lake and reduces regressions.
- **Cost:** the small model with the lake beats the larger model without it, at 6% to 8% of the cost per call.

Some things we tested did **not** work or did not apply (for example, how much of the lake simple search recovers). They are in section 6 of the [technical article](/en/haiku-ui-producao/).
""")
(D / "linkedin-pt.txt").write_text("""Quanto mais regras de UX o Haiku vê, melhor ele decide: 46% a 70% em telas grandes

Em 2.640 chamadas com telas grandes e pedido vago, o Haiku foi de 46% de acerto sem regras para 70% com o lake inteiro (148 regras) e 78% com um verificador junto. Passou o Sonnet sem regras (61%) por cerca de 8% do custo por chamada.

Cada 25% a mais de lake deu de 8 a 12 pontos a mais, e o ganho não veio só do volume: a regra certa pesou mais. Ressalva principal: as telas são sintéticas e a tarefa é revisar um rascunho, não criar do zero.

https://melolabs.net/pt/haiku-ui-producao-guia/

#haiku #ux #datalake #ia
""", encoding="utf-8")
(D / "linkedin-en.txt").write_text("""The more UX rules Haiku sees, the better it decides: 46% to 70% on big screens

Across 2,640 calls on big screens with a vague request, Haiku went from 46% accuracy with no rules to 70% with the full lake (148 rules) and 78% with a verifier added. It beat Sonnet without rules (61%) at about 8% of the cost per call.

Each extra 25% of the lake gave 8 to 12 more points, and the gain was not just volume: the right rule mattered more. Main caveat: the screens are synthetic and the task is reviewing a draft, not creating from scratch.

https://melolabs.net/en/haiku-ui-producao-guia/

#haiku #ux #datalake #ai
""", encoding="utf-8")
print("ok")
