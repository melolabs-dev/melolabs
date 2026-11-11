# Estudo 3b: pré-registro (versão a congelar por hash)

Data: 10/11/2026. Substitui o rascunho PRE-REGISTRO-RASCUNHO.md. As mudanças em relação ao rascunho estão em "Desvios do rascunho" e existem por duas razões medidas no piloto: custo do Sonnet e limite dos verificadores. Depois do congelamento (hashes em `dados/CONGELADO.txt`), estímulos, gabarito, prompts, pontuação e hipóteses só mudam como desvio registrado em `dados/DESVIOS.md`.

## Pergunta
Em telas grandes e complicadas, o data lake de UX (regras de fonte aberta) e um verificador automático ajudam o Haiku a decidir melhor? Quanto da **completude do lake** vira decisão melhor, e o lake atrapalha onde não cobre?

## Material
- **Lake de referência:** `lake/lake-ref-v2.json`, 200 regras de 105 fontes abertas, todas auditadas uma a uma contra a página da fonte. 185 elegíveis (111 sustentadas, 74 parciais com redação ajustada ao que a fonte diz). Só `regra_final` vai para os prompts. A auditoria é de modelo, sem revisão humana.
- **6 famílias de telas** (painel, listagem, formulário, checkout, configurações, navegação): 140 regras com verificador em navegador real (Chrome, Playwright, axe-core quando aplicável). Cada tela tem de 383 a 1.200 linhas. Autoconsistência: 100% de concordância entre gerador e verificador em 15 sementes por família (violação isolada, violação de 5 regras juntas, tela limpa).
- **Regras retidas:** 25% das regras de cada família, sorteadas com semente fixa (`dados/estimulos/retidas.json`). Nunca aparecem em lake, relatório nem prompt. Medem transbordamento: o que o modelo acerta sem ter sido ensinado.
- **Verificador como "kit" (grau 2):** o relatório mostrado ao modelo usa o mesmo verificador que pontua, mas só sobre as regras mostradas. A pontuação de regras retidas e a de axe-core são independentes do que o modelo viu.

## Tarefas
- **T2 melhorar:** tela com 3, 6 ou 9 regras violadas (graduado), ≥1 retida entre elas. Pedido: "melhore para produção". Condições: A0 puro; A1 regras da família (sem as retidas); A2 relatório do verificador; A3 ambos.
- **T4 revisão aberta para produção:** rascunho com **todas** as regras da família violadas e um pedido vago do gerente, sem lista de defeitos. O modelo decide o que mudar e lista suas decisões citando a regra usada. Condições (lake em níveis, sorteado de novo a cada amostra): L0 sem lake; L25, L50, L100 (percentual do conjunto mostrável, 148 regras); D (regras de outros domínios, mesmo papel de volume); R (as 12 regras mais próximas por BM25 da tela); K (L100 + relatório do verificador).
- Respostas em trechos ANTES/DEPOIS, aplicados por código. Pontuação por verificador: regras violadas que passaram a cumprir; regras novas que passaram a falhar; separadas em **mostradas** e **retidas**. Axe-core em todas as telas finais como medida independente.

## Grade (limitada pelo custo)
- **Haiku 5.5, grade completa:** T2 48 telas × 4 condições × 2 amostras; T4 48 telas × 7 condições × 2 amostras.
- **Sonnet 5.5, grade reduzida, 1 amostra:** T4 em L0, L100, R; T2 em A0 e A3; 24 telas por tarefa. Se sobrar orçamento, estende-se na ordem: segunda amostra do T4, depois mais condições. A ordem de execução é embaralhada com semente fixa, então uma parada pelo teto não desbalanceia o desenho.
- Opus fora por custo; validação com Fable fica para depois.
- Teto de custo nominal: US$ 115 (autorização do Caio: até US$ 120). Preço por MTok: Haiku 0,10/0,50 (cache 0,01), Sonnet 2/10 (cache 0,10); escrita de cache 1,25× entrada. O piloto mediu o Sonnet em US$ 0,16 a 0,27 por chamada (10 a 20 mil tokens de saída).

## Hipóteses confirmatórias (Holm)
Testes pareados por tela (média das amostras), Wilcoxon, IC95 por bootstrap de 10.000 reamostras de telas.
- **H1** (efeito da regra presente): no T4, no Haiku, a taxa de acerto por regra é maior quando a regra está entre as mostradas que quando está ausente, nos níveis L25 e L50 (comparação dentro da mesma tela e amostra).
- **H2** (dose-resposta): média de regras corrigidas no T4 do Haiku cresce com a completude: L0 < L25 < L50 < L100 (tendência monótona, teste de Jonckheere ou de Page).
- **H3** (sem dano onde não há regra): nas regras retidas, L100 não é pior que L0 por mais de 5 pontos percentuais (não inferioridade).
- **H4** (regra certa, não volume): L100 > D nas regras mostradas do T4 (Haiku).
- **H5** (recuperação): R mantém ao menos 90% do ganho de L100 sobre L0, com menos tokens de entrada (Haiku, T4).
- **H6** (kit em tela grande): A3 > A1 no T2 e K > L100 no T4, Haiku.
- **H7** (regras novas): o relatório (A2, A3, K) reduz regras novas que passam a falhar.
- **H8** (dificuldade): Haiku A0 abaixo de 85% (já visto no piloto).
- **H9** (critério principal, descritivo para o Sonnet por ser grade reduzida): Haiku com lake e kit (T2 A3, T4 K) atinge 90% da pontuação do Sonnet A0 (T2) e L0 (T4) com custo de no máximo 50%.
Descritivas: efeito por regra e por domínio; tokens e custo por nível de completude; fração de decisões citadas que apontam para regras existentes e visíveis; axe-core (violações por tela) por condição.

## Piloto e calibração
12 telas por tarefa com sementes distintas das da rodada principal (+500), Haiku (48 chamadas) e 3 chamadas do Sonnet. Fora da análise. Resultado do piloto: Haiku A0 corrigiu 56% (T2) e 41% (T4 L0), abaixo do limiar de 85%, sem ajuste de dificuldade.

## Limitações declaradas antes de ver os dados
1. **Telas sintéticas geradas por script.** A estrutura de cada família é fixa; varia conteúdo, tema e defeitos. Não há conjunto externo de projetos reais nesta rodada. Validade para produção real não está demonstrada.
2. **T4 é revisão de rascunho, não criação do zero.** Os verificadores dependem da marcação das nossas telas; não conseguem pontuar uma tela inventada pelo modelo.
3. **O gerador e o verificador têm o mesmo autor.** A concordância de 100% mostra consistência, não validade. Para mitigar, auditamos por amostra os veredictos do verificador em telas escritas pelo modelo (resultado em `dados/piloto/auditoria/`).
4. **Auditoria do lake feita por modelo**, com páginas resumidas por modelo pequeno; sem revisão humana.
5. **Fontes de pesquisa (Nielsen, Baymard) não são norma:** a "decisão certa" de algumas regras é a recomendação da fonte, não prova de causalidade.
6. **Sonnet em grade reduzida; Opus e Fable ausentes.** Qualquer comparação com o Sonnet tem menos poder.
7. **Custo nominal** (preço de tabela), sem o limite do plano.
8. Sem medida de estética.

## Desvios do rascunho (registrados antes da rodada)
- T3 (comparar) saiu: o estudo 3 já mostrou teto de acerto e o kit não ajudou.
- T1 (criar do zero) saiu pelo limite 2.
- Condição R usa 12 regras (rascunho dizia 8) e K foi adicionada.
- Sonnet em grade reduzida por custo medido (rascunho previa a grade completa).
- Conflito entre regras (tipo c) não foi implementado.
- Kit estático (parse5/css-tree) não foi estendido; o relatório vem do verificador em navegador (grau 2).

## Reprodução
`gerador/` (famílias, estímulos, verificador), `executor3b.py`, `dados/estimulos/`, `dados/bruto/`, `lake/`.
