# Estudo 3: pré-registro (rascunho para congelar)

Data do rascunho: 10/11/2026. Congelar com tag no repositório antes da rodada principal. Depois do congelamento, estímulos, gabarito, prompts, pontuação e hipóteses não mudam; o que mudar vira desvio registrado.

## Pergunta
Um conjunto formado por data lake de UX (regras de login com fonte aberta) e código mínimo de checagem (o kit) permite que o Haiku 5.5 chegue perto do Sonnet 5.5 e do Opus 5.5, em assertividade, a custo total menor? A unidade testada é o conjunto (modelo + kit), não o modelo sozinho.

## Desenho
- Modelos: Haiku 5.5, Sonnet 5.5, Opus 5.5, via `claude -p` (assinatura), `--effort medium`, sem ferramentas, prompt de sistema curto igual para todos. Custo nominal = tokens × preço de tabela (10/11/2026, por MTok: Haiku 0,10/0,50; Sonnet 2/10; Opus 4/20; leitura de cache 0,01/0,10/0,20).
- Condições: A0 puro; A1 + regras do data lake no prompt; A2 + relatório do kit; A3 regras + relatório. Controle AC (só T1, qualquer modelo): a mesma segunda chamada de correção, mas com autocrítica em vez de relatório do kit, para separar "mais uma passada" de "informação do kit".
- Tarefas (tela de login, uma só, de propósito):
  - T1 criar: 12 pedidos de contextos diferentes. A0/A1: uma chamada. A2/A3/AC: segunda chamada com correções em trechos. Pontuação: regras do data lake que o HTML final cumpre (de 30).
  - T2 melhorar: 20 telas, cada uma com 3 defeitos injetados (25 tipos, ligados a regras do data lake). Resposta em trechos aplicados por código. Pontuação: defeitos removidos, defeitos novos introduzidos.
  - T3 comparar: 60 pares (20 CSS de uma propriedade, 13 deles grandes e 7 sutis; 8 de conteúdo; 8 de fluxo; 8 compostos; 8 de ruído sem diferença real; 8 idênticos). Resposta em JSON. Pontuação: recall e alarmes falsos contra o gabarito exato.
- Amostras: 3 por célula. Cada célula é pareada pelo mesmo item.
- Estímulos gerados por script com semente fixa (`gerador/gerar.mjs`). O gabarito vem da construção, e o kit foi conferido contra ele (todos os pares com mudança foram vistos; nenhum par de ruído ou idêntico gerou diferença).

## Fonte de verdade
Só entra regra de fonte aberta e citável: WCAG 2.2, web.dev (sign-in form best practices), Material Design 3. 30 regras em `lake/login.json`, cada uma com fonte, como checar, bom e mau. 25 objetivas, 5 semi-objetivas. Não há painel humano. Estética e preferência não são medidas pelo desenho principal; um bloco exploratório pode reaproveitar rótulos humanos já publicados (WiserUI-Bench, DesignPref), marcado como exploratório e só se acesso e licença permitirem.

## Hipóteses
- H1 (comparar): no T3, o recall do Haiku com relatório do kit (A2) é maior que com A0.
- H2 (alarme falso): nos pares de ruído e idênticos, o Haiku A2 gera menos alarmes falsos que A0.
- H3 (melhorar): no T2, o Haiku A3 remove mais defeitos que A0, sem introduzir mais defeitos novos.
- H4 (criar): no T1, o Haiku A3 cumpre mais regras do data lake que A0.
- H5 (efeito do kit no cargo): o ganho de A3 sobre A0 é maior no Haiku que no Opus (interação condição × modelo).
- H6 (informação, não passada extra): no T1, A2 supera AC no Haiku.
- H7 (regras sozinhas): A1 melhora T1 e T2 do Haiku em relação a A0, e A2 melhora o T3 mais que A1.
- H8 (custo total): o custo por tarefa do Haiku A3, mais a construção do kit amortizada em N usos, fica abaixo do Sonnet A0 a partir de um N finito; reportar o N de equilíbrio.
- H9 (critério principal): Haiku A3 atinge pelo menos 90% da acurácia combinada do Sonnet A0 e do Opus A0, com custo de no máximo 50% do Sonnet A0 e de no máximo 25% do Opus A0.
- H10 (descritiva): onde cada modelo falha (tipo de defeito, categoria de par).

Acurácia combinada = média de três pontuações em [0,1]: T1 (regras cumpridas/30), T2 ((regras defeituosas removidas − regras novas que falham)/regras defeituosas injetadas, truncada em [0,1]), T3 (F1 com recall e precisão por item). Custo = tokens × preço de tabela, somando as chamadas da tarefa, mais a execução do kit (segundos medidos, reportados à parte).

## Análise
Comparações pareadas por item; intervalo de confiança por bootstrap (10.000 reamostras de itens); teste de Wilcoxon pareado; correção de Holm nas hipóteses confirmatórias (H1–H7, H9). Tamanhos de efeito reportados. Chamadas com erro são refeitas; falha repetida entra como erro e é reportada.

## Limitações declaradas antes de ver os dados
1. O mesmo código que gera o relatório do kit pontua T1 e T2. Em A2/A3 isso ensina para a prova. Mitigação: reportar também as regras que o kit não reporta (A0/A1 vs A2/A3 em regras fora do relatório) e, se houver tempo, uma checagem independente com axe-core. T3 usa gabarito por construção, não o kit.
2. Uma só tela (login) e telas sintéticas: sem validade externa para outras telas.
3. O kit foi afinado com os tipos de ruído deste conjunto; o resultado de H2 vale para esses tipos.
4. Sem rótulo humano de estética: o estudo não afirma nada sobre beleza.
5. O custo é nominal (assinatura); o consumo de limite do plano não entra.
6. Condição de imagem (screenshots) fica fora desta rodada; grau 2 (navegador real) não foi construído.
7. O estímulo e o kit foram escritos pelo mesmo autor (eu, com o Caio), e o autor sabe o que o kit detecta.

## Material e reprodução
`kit/` (kit.mjs, pontuar.mjs), `lake/login.json`, `gerador/gerar.mjs`, `executor.py`, `dados/estimulos/`, `dados/bruto/`.
