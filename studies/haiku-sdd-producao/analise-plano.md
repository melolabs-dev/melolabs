# Plano de análise (pré-registrado)

> **Rascunho de 05/11/2026, aguardando a aprovação do autor.** Tudo aqui é definido antes de qualquer dado de teste existir. Depois do pré-registro (F3.3), qualquer mudança vira um adendo datado, nunca uma troca silenciosa.

## Unidades e delineamento
- **Insumos:** 3 features do h3 (#1267, #1384, #1050), commit do h3 fixado no pré-registro.
- **Condições:** Sonnet padrão (referência), Haiku simples, e os braços das hipóteses H2 a H11 e dos braços do autor S8 a S11. A lista final e o orçamento saem do plano de testes (F4).
- **Repetições:** 3 por condição e por feature. A **unidade de análise é a execução** (feature × repetição × condição), pareada por feature.
- **Limite honesto:** só 3 features. Os resultados valem para essas 3 features e para este repositório; o artigo não generaliza além disso. As 3 features são blocos, não uma amostra de "projetos TypeScript".

## Métricas primárias e secundárias
| Hipótese | Métrica primária | Secundárias |
|---|---|---|
| H1 | Soma da rubrica: TechSpec C1 a C7 (de 35) e Tasks T1 a T5 (de 25) | PRD, notas por critério |
| H2 | % de decisões com maioria clara; % que coincide com o gabarito | custo do voto |
| H3 | Ganho da soma da rubrica (loop contra sem loop) | nº de rodadas, custo do loop |
| H4 | % de tarefas com 100% dos testes de aceite ocultos passando e tsc/lint limpos | cobertura, tempo |
| H5 | Razão de qualidade (mediana da rubrica) e razão de custo (USD por artefato aceito) | taxa de escalonamento |
| H6 | Razão de custo Haiku com mitigações ÷ Sonnet padrão | maior prompt por chamada (tier acima de 100 mil tokens) |
| H7 | Recall e falsos positivos com 20 erros plantados | tipos de erro perdidos |
| H8 | Redução do custo de entrada com cache e variação da nota | taxa de cache hit |
| H9 | Variação da nota e taxa de JSON inválido | tokens extras da 2ª chamada |
| H10 | Razão de qualidade e custo contra a cascata | custo por etapa |
| H11 | Ganho da rubrica e dos testes ocultos contra o prompt neutro | custo extra; controle de mesmo tamanho |
| S8 a S11 | Mesmas métricas da hipótese ligada (H4 e H6) | marcados como exploratórios |

**Definição de "artefato aceito":** passa no gate determinístico da etapa (e, para código, nos testes ocultos). O custo por artefato aceito soma todas as chamadas da condição (votos, retentativas, gates, escalonamentos, juízes não entram), com a tabela de preços datada de 04/11/2026.

## Estatísticas e intervalos
- **Descritivas:** mediana e IQR para notas; média e desvio para custo; proporções com intervalo de Wilson.
- **Intervalos:** bootstrap percentil de 10.000 reamostragens, com semente fixa registrada, reamostrando execuções dentro de cada feature (estratificado), IC de 95%.
- **Efeito:** diferença de medianas em pontos da rubrica; diferença de proporções em pontos percentuais; razões com IC; d de Cliff como medida complementar para a rubrica (ordinal).
- **Razões (H5, H6, H10):** razão das médias de custo e razão das medianas de qualidade, ambas com bootstrap pareado por feature.
- **Concordância dos juízes:** alfa de Krippendorff entre os 3 juízes; se ficar abaixo de 0,67, a rubrica é reportada como pouco confiável e a hipótese fica `subpotente`, não confirmada.

## Testes por hipótese
- **Hipóteses de superioridade (H1, H3, H7, H11):** diferença de medianas ou proporções, IC de 95% por bootstrap; confirmada se o IC exclui zero e o efeito passa do mínimo declarado em `hipoteses.json`.
- **Hipóteses de "sem diferença" (H4, H5, H9, H10):** teste de equivalência por duas unilaterais (TOST) a 5%, usando a margem declarada em cada hipótese; é o mesmo que o IC de 90% caber inteiro na margem. Não se conclui equivalência de um teste de diferença não significativo.
- **Hipóteses de custo (H6, H8):** razão com IC; confirmada se o limite superior do IC fica abaixo do limiar.
- **H2:** proporção de decisões com maioria clara com IC de Wilson, e diferença de acerto contra o Sonnet pela mesma regra de equivalência.
- **Controles negativos:** autorrevisão sem feedback (H3) e texto de mesmo tamanho (H11) devem ficar dentro da margem de zero. Se não ficarem, o método de medição é questionado antes de qualquer conclusão.
- **Status possíveis (como em `hipoteses.json`):** confirmada, refutada, equivalente, subpotente (IC largo demais para decidir). Não existe "quase confirmada".

## Correção para múltiplas comparações
- **Família confirmatória principal:** H4, H5 e H6, que respondem à pergunta central do artigo. Correção de Holm, nível global de 5%.
- **Família confirmatória secundária:** H1, H2, H3, H7, H8, H9, H10 e H11, com Holm separado. Os resultados saem rotulados como secundários.
- **Exploratórias:** S8 a S11, análises por feature e qualquer pergunta que surja depois. Sem correção, rotuladas como exploratórias e não entram na conclusão do artigo.

## Regra de outliers e dados faltantes
- **Nenhum outlier é removido.** Reporta-se a análise com todos os dados e, ao lado, a mesma análise sem execuções acima de 3 vezes o IQR, para mostrar se mudam a conclusão.
- **Falha de infraestrutura** (erro de API, timeout de rede): a execução é refeita até 2 vezes e a falha original é registrada. Só se exclui quando as 2 refeitas também falham por infraestrutura, com a contagem no artigo.
- **Falha causada pelo modelo** (saída inválida, estouro do limite de chamadas, loop sem convergir): conta como execução reprovada na qualidade e o custo gasto entra no custo (análise por intenção de tratar).
- **Dados faltantes de juiz:** se um juiz falha, repete-se a avaliação; se continuar faltando, usa-se a mediana dos juízes restantes e isso é registrado.
- **Preço:** um único dia de tabela; se a tabela mudar durante a coleta, recalcula-se com a tabela de cada data e reporta-se a diferença.

## Análises confirmatórias e exploratórias
- **Confirmatórias** são exatamente as 11 hipóteses de `hipoteses.json`, com os limiares e margens já pré-registrados.
- **Exploratórias** recebem o rótulo "exploratória, gerada depois de ver os dados" no texto, na tabela e no gráfico, e não são usadas para afirmar nada no título nem no resumo.
- **Resultados negativos e equivalentes** entram no artigo com o mesmo destaque dos positivos.
- **Reprodutibilidade:** scripts em `analise/`, semente fixa, dados brutos em `dados/bruto/`, e uma tabela que liga cada número do artigo ao arquivo que o gerou.

## Decisões que precisam do autor
1. Famílias de Holm: principal com H4, H5 e H6, e as demais como secundárias. Confirma ou muda?
2. Rotular S8 a S11 como exploratórios (menos poder, mas sem inflar a correção)?
3. Concordância mínima dos juízes (alfa de Krippendorff 0,67): aceita ou prefere outro corte?
4. Falha causada pelo modelo conta como reprovada, com o custo incluído (intenção de tratar): aceita?
5. Os juízes Opus entram no custo do estudo, mas não no custo por artefato aceito das condições: aceita?
