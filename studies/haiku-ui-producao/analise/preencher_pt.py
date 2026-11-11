"""Preenche os marcadores do rascunho pt.md com os textos finais (números de dados/analise.txt e dados/bruto/axe-todos.json)."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
p = ROOT / "posts/drafts/haiku-ui-producao/pt.md"
s = p.read_text(encoding="utf-8")
R = {}
R["<<RESUMO>>"] = "Em 2.640 chamadas (Haiku 5.5 e Sonnet 5.5, 48 telas por tarefa, seis famílias de tela), o acerto do Haiku ao revisar uma tela de produção com todos os defeitos subiu de **46% sem lake para 70% com o lake inteiro** e **78% com o lake e o relatório do verificador**, em degraus: 0%, 25%, 50% e 100% do lake deram 47%, 59%, 67% e 76% nas regras mostradas. Mostrar o mesmo volume de texto de outros domínios (52%) ou as 12 regras mais próximas por BM25 (57%) ficou muito abaixo do lake inteiro. O Haiku com lake (70%) superou o Sonnet sem lake (61%) a cerca de 8% do custo nominal por chamada. Ressalvas centrais: telas sintéticas, revisão de rascunho e não criação, e um verificador que errou em cerca de 13% dos veredictos auditados."
R["<<NCHAMADAS>>"] = "2.640"
R["<<HIPOTESES>>"] = """Testes pareados por tela (média das amostras), Wilcoxon unilateral, IC95 por bootstrap de 10.000 reamostras de telas e correção de Holm sobre os 11 testes confirmatórios. Todos no Haiku; diferenças em pontos percentuais (pp) de regras corrigidas.

| Hipótese | Resultado | Diferença (IC95) | Veredito |
|---|---|---|---|
| H1 regra presente > ausente, L25 | 81% vs 52% | +29 pp (+26 a +33) | confirmada |
| H1 regra presente > ausente, L50 | 79% vs 55% | +24 pp (+20 a +27) | confirmada |
| H2a L25 > L0 | 59% vs 47% | +12 pp (+10 a +15) | confirmada |
| H2b L50 > L25 | 67% vs 59% | +8 pp (+5 a +10) | confirmada |
| H2c L100 > L50 | 76% vs 67% | +9 pp (+6 a +11) | confirmada |
| H3 retidas: L100 não pior que L0 (margem 5 pp) | 55% vs 44% | +11 pp (+7 a +15) | confirmada (o lake não atrapalhou onde não cobria) |
| H4 L100 > D (outros domínios) | 76% vs 52% | +23 pp (+21 a +26) | confirmada |
| H6a T2 A3 > A1 | 80,6% vs 80,9% | -0,3 pp (-3 a +3) | **não confirmada** |
| H6b T4 K > L100 | 78% vs 70% | +8 pp (+6 a +11) | confirmada |
| H7a T2 regras novas A0 > A2 | 0,94 vs 0,21 por chamada | -0,74 | confirmada |
| H7b T4 regras novas L100 vs K | 0 vs 0 | n/a | **não testável** (no T4 todas as regras já estão violadas) |

Nove dos onze testes rejeitam a hipótese nula pelo critério de Holm. Fora do conjunto confirmatório:

- **H5 (a busca simples mantém 90% do ganho?)**: **não**. O BM25 com 12 regras manteve 31% do ganho do lake inteiro (+7 pp contra +24 pp sobre L0), com menos tokens de entrada (13,6 mil contra 19,2 mil).
- **H8 (dificuldade)**: confirmada. O Haiku puro corrigiu 52% no T2 e 46% no T4, bem abaixo dos 85% do limiar de teto.
- **H9 (descritiva, Haiku com lake contra Sonnet sem lake)**: no T2, Haiku A3 81% contra Sonnet A0 63% (razão 1,28), com 6% do custo; no T4, Haiku L100 70% contra Sonnet L0 61% (razão 1,14), com 8% do custo. Passa os dois critérios (pelo menos 90% da pontuação com no máximo 50% do custo). O Sonnet também melhora com o lake e supera o Haiku nas mesmas condições (seção 7.3)."""
R["<<RESULTADOS>>"] = """### 7.1 A completude do lake, em degraus (T4)

![Completude do lake no T4](/assets/haiku-ui-producao/fig-completude-pt.svg)

Fração das regras violadas que passam a cumprir, média sobre 48 telas (3 amostras no Haiku, 2 no Sonnet):

| Condição | Haiku (todas) | Haiku (mostradas) | Haiku (retidas) | Sonnet (todas) | Sonnet (mostradas) |
|---|---|---|---|---|---|
| L0, sem lake | 46,1% | 46,9% | 43,6% | 61,3% | 61,4% |
| L25 | 56,9% | 59,3% | 50,3% | 66,3% | 68,7% |
| L50 | 63,1% | 66,9% | 52,3% | 72,4% | 76,3% |
| L100 | 70,1% | 75,7% | 54,5% | 79,7% | 85,9% |
| D (outros domínios) | 51,2% | 52,4% | 47,8% | 63,1% | 64,2% |
| R (BM25, 12 regras) | 53,5% | 56,8% | 44,0% | 62,7% | 64,8% |
| K (L100 + relatório) | 78,4% | 88,5% | 50,0% | 83,0% | 91,8% |

O ganho é quase linear: cada 25% a mais de lake rende de 8 a 12 pontos no Haiku. Dentro da mesma tela e amostra, a regra presente foi cumprida em 81% das vezes e a ausente em 52% (L25). O efeito do volume puro (D, +5 pp sobre L0) e o da busca simples (R, +7 pp) são pequenos perto do lake completo (+24 pp). Entre as decisões que o Haiku citou, a fração que aponta para uma regra realmente mostrada subiu de 59% (L25) para 90% (L100); em D foi 54% e em R, 49%: com pouca informação o modelo cita regras que não recebeu.

### 7.2 O relatório do verificador (T2 e T4)

![T2: regras mostradas e retidas por condição](/assets/haiku-ui-producao/fig-t2-pt.svg)

No T2, as regras da família (A1) levaram o Haiku de 48% para 91% nas regras mostradas; o relatório (A2) a 96%; os dois juntos (A3) a 96%, sem ganho sobre as regras sozinhas no total (80,6% contra 80,9%). O relatório faz outra coisa: reduz as regras novas que passam a falhar (0,94 por chamada em A0, 0,50 em A1, 0,21 em A2) e deixa o modelo focado no que ele lista. Nas regras retidas, que o relatório nunca menciona, o Haiku foi de 60% (A0) a 28% (A2): o relatório diz o que corrigir e o modelo deixa o resto. No T4, o relatório somado ao lake inteiro (K) subiu o Haiku de 70% para 78% (nas regras mostradas, de 76% para 89%).

### 7.3 Haiku e Sonnet, e o custo

![Custo nominal por chamada e acerto](/assets/haiku-ui-producao/fig-custo-pt.svg)

O Sonnet é melhor que o Haiku nas mesmas condições (T4 L0: 61% contra 46%; L100: 80% contra 70%; K: 83% contra 78%). Mas o Haiku com lake supera o Sonnet puro, e o custo nominal por chamada é muito diferente: Haiku L100 US$ 0,0225 contra Sonnet L0 US$ 0,2728 (8%); no T2, Haiku A3 US$ 0,0093 contra Sonnet A0 US$ 0,1526 (6%). A rodada inteira custou US$ 252,29 nominais (Haiku US$ 25,41, Sonnet US$ 226,88).

### 7.4 Medida independente: axe-core

Em violações WCAG A/AA por tela final, medidas pelo axe-core (que não depende do nosso verificador), o Haiku no T4 foi de 0,90 (L0) para 0,60 (L25), 0,52 (L50) e 0,47 (L100), com 0,75 em D, 0,86 em R e 0,49 em K. O Sonnet ficou em torno de 0,3 em todas as condições do T4. No T2, o relatório sozinho (A2) elevou as violações do Haiku (0,60 contra 0,39 em A0), coerente com o foco estreito do relatório. São médias baixas (menos de uma violação por tela) e o axe cobre só parte das nossas regras, então ele confirma a direção, não a magnitude.

### 7.5 Robustez

Excluindo as 26 regras condicionais (cuja condição pode não existir na tela) ou as 12 regras com defeito de verificador confirmado em auditoria, os níveis absolutos mudam poucos pontos e a ordem das condições é a mesma (Haiku T4 sem as 12 regras: L0 47%, L25 58%, L50 65%, L100 72%, D 53%, R 54%, K 81%)."""
R["<<CONCLUSAO>>"] = """- **Para quem monta um data lake de UX:** neste conjunto de telas, mais regras relevantes deram mais acerto, em degraus aproximadamente iguais até o lake inteiro, sem sinal de platô. O volume de texto sozinho não explica o ganho (D) e a regra certa importa (H1, H4).
- **Uma busca simples (BM25 com 12 regras) não bastou**: recuperou 31% do ganho. Se o lake for usado por recuperação, ela precisa ser melhor que essa, ou o lake relevante precisa caber inteiro no contexto.
- **O lake não atrapalhou onde não cobria**: nas regras nunca mostradas, o acerto foi até 11 pontos maior com o lake inteiro (H3). Pode ser transbordamento ou apenas um modelo mais cuidadoso; não separamos as duas explicações.
- **O relatório do verificador evita regressões e fecha o que lista, mas estreita o foco**: reduziu as regras novas que passaram a falhar e, no T2, deixou de corrigir regras que não estavam na lista. Somado ao lake inteiro no T4, melhorou 8 pontos.
- **Custo:** com o lake, o Haiku superou o Sonnet sem lake por 6% a 8% do custo por chamada. O Sonnet, porém, continua melhor nas mesmas condições.
- **O que isso não permite concluir:** que o resultado vale para um projeto real em produção (as telas são sintéticas e o T4 é revisão de um rascunho), que as regras do lake causam melhores decisões de UX para usuários reais (medimos conformidade com regras, não resultado de produto) ou que vale para outros modelos além dos dois testados.

**O que eu faria a seguir:** repetir o T4 em telas reais de produção, com um revisor humano como segundo medidor, e testar uma recuperação melhor que o BM25."""
for k, v in R.items():
    assert k in s, k
    s = s.replace(k, v)
s = s.replace("O ritmo foi de cerca de 10 chamadas por minuto, com 14 em paralelo no Sonnet e 8 no Haiku.", "O ritmo foi de cerca de 10 chamadas por minuto, com 14 em paralelo no Sonnet e de 8 a 20 no Haiku.")
p.write_text(s, encoding="utf-8")
print("ok")
