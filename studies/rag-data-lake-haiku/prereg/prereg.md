# Pré-registro do estudo 2: Haiku com mini data lake

Data do congelamento: 10/11/2026. Autor: Caio Melo. Redigido com Claude Sonnet 5.5, que também montou o lake, as perguntas e o gabarito (ver "Limites declarados"). O plano completo está em `plano.md`; este arquivo fixa o que não muda depois de ver os dados da rodada principal.

## Pergunta
Um modelo pequeno (Haiku 5.5) com um mini data lake do projeto decide tão bem quanto um modelo maior (Sonnet 5.5) com o contexto certo, e a que custo?

## Material
- Lake de 109 documentos do h3 (commit `f0e17808ac2439b6434bb10609a961067f4d555b`, 22/10/2026) e do estudo 1, com 152 cartões de decisão. Manifesto com hashes em `manifesto.json` desta pasta.
- 120 perguntas de múltipla escolha (60 comuns, 30 de conflito entre decisão antiga e vigente, 30 sem resposta no lake), quatro opções, uma sempre "Informação insuficiente no material" (acaso de 25%). Letras embaralhadas com a semente 20261109. Gabarito escrito por IA e conferido por revisão cega (118 de 120 na primeira passada, 120 de 120 depois das correções, o que não é acurácia independente) e por validação com os documentos-ouro (Haiku, 5 amostras, 86 de 90 respondíveis acertam no voto; os quatro erros foram conferidos contra as fontes e o gabarito foi mantido).
- 20 perguntas de calibração (6 comuns, 4 de conflito, 10 sem resposta), fora das 120, usadas só para fixar o limiar do portão do A6.

## Braços (todos com Haiku; S0, S1 e as variantes de Sonnet usam Sonnet)
| Braço | O que o modelo recebe |
|---|---|
| A0 | só a pergunta |
| A1 | documentos-ouro inteiros (só nas 90 respondíveis) |
| A2 | lake inteiro (cerca de 223 mil tokens) no prompt de sistema, com cache de prompt; a primeira chamada roda sozinha para aquecer o cache |
| A3 | 10 trechos mais próximos por vetor |
| A4a | 10 trechos do híbrido BM25 + vetor por fusão de ranking (RRF) |
| A4b | 10 trechos do híbrido reordenados pelo reranker multilíngue (30 candidatos) |
| A5 | recuperação por reranker (escolhida pelo recall do piloto: com k=10, o documento-ouro aparece em 91% e o trecho em 79%, contra 81% e 66% do RRF) (k=10) mais 3 cartões; cartão substituído traz o que o substitui; trechos etiquetados com estado (vigente, substituída) |
| A6 | A5 com portão: se a nota máxima do reranker for menor que tau = 1,05 (calibrado em 20 perguntas extras; acerto de classificação 80%), responde "insuficiente" sem chamar o modelo |
| S0, S1 | Sonnet em A0 e em A1 |
| N1 | 10 trechos sorteados de documentos fora do ouro (controle de ruído) |
| N1b | N1 e depois o ouro (ouro mais perto da pergunta) |
| N2 | ouro e depois 3 trechos de decisões já substituídas (mais parecidos com a pergunta) |

Consulta de recuperação: só o texto da pergunta. Trechos de até 600 caracteres, sobreposição de 100, embedding `paraphrase-multilingual-MiniLM-L12-v2` (local), reranker `BAAI/bge-reranker-v2-m3-int8`. Nos braços com recuperação o material vai na mensagem do usuário; no A2 vai no prompt de sistema (diferença declarada, necessária para o cache). Prompt: "Material do projeto:" seguido do contexto, depois a pergunta, as opções e a instrução de responder só com a letra.

## Execução
`claude -p` sem ferramentas, prompt de sistema curto, 5 amostras por pergunta, temperatura no padrão do harness (não é controlável), voto por maioria com empate pela menor letra. Perguntas sem documento-ouro não entram em A1, N1b e N2. Sobras: resposta sem letra conta como erro e a taxa de falha de formato é reportada.

## Hipóteses confirmatórias (Holm entre 6; p por bootstrap unilateral de 10.000 réplicas de perguntas)
- **H1:** A1 supera A0 em pelo menos 25 pontos percentuais nas 90 respondíveis (refutada abaixo de 15).
- **H2:** Haiku em A1 fica a no máximo 10 pp do Sonnet em A1 (estimativa maior que -10 pp).
- **H3:** o melhor RAG (entre A3, A4a, A4b e A5, escolhido dentro de cada réplica) recupera pelo menos 80% do ganho do oráculo, razão limitada a 1.
- **H9:** o melhor RAG com Haiku alcança pelo menos 90% do acerto do Sonnet com oráculo e custa no máximo 50% do custo por decisão correta.
- **H10a:** A5 custa no máximo 25% do custo por decisão correta do A2 e não perde mais de 10 pp de acerto frente a ele (120 perguntas).
- **H10b:** A5 custa menos por decisão correta que A3, com intervalo de 95% inteiro abaixo de zero (bootstrap pareado).

Exploratórias, sem correção de múltiplos testes e marcadas como tal: H4 (híbrido e reranker na recuperação), H5 (A5 contra A4 nas 30 de conflito, 15 pp), H6 (lake inteiro contra melhor RAG), H7 (portão do A6). Acurácia por bloco, abstenção, recall@k, taxa de uso e taxonomia de erros também são descritivas.

## Custo
Custo nominal por chamada = tokens de entrada × preço de entrada + tokens de saída × preço de saída, com o preço efetivo a frio do `claude -p` medido em 10/11/2026 (`piloto/preco-frio.jsonl`): Haiku US$ 0,20 e US$ 0,50 por milhão (entrada e saída) até cerca de 43 mil tokens e US$ 1,00 por milhão de entrada a partir de 125 mil tokens; Sonnet US$ 4,00 e US$ 10,00. Custo por decisão correta = soma do custo nominal dividida pelo número de perguntas acertadas no voto. O gasto real com cache aparece em separado, só como informação. O custo de montar o lake é estimado, não medido, e apresentado como ponto de equilíbrio. Dólar de lista não é cobrança da assinatura. O efeito do cache no limite do plano não é publicado; a barra de uso será observada durante a rodada.

## Análise
Acerto com intervalo de Wilson 95%, McNemar exato pareado entre braços (apenas descritivo), bootstrap de perguntas para as hipóteses. Análise de sensibilidade sem as 15 perguntas do piloto, usadas para escolher k.

## Limites declarados
1. Mesma família de modelos escreveu o lake, as perguntas, o gabarito e a revisão, e roda os braços: pontos cegos compartilhados são possíveis.
2. Um único projeto (h3, MIT), 120 perguntas de múltipla escolha: o poder detecta cerca de 14 pp globais e cerca de 25 pp em blocos de 30.
3. 30 das perguntas sem resposta foram marcadas em parte como parciais na revisão cega; ver `lake/revisao/comparacao.json`.
4. Os valores de k, tamanho de trecho e prompt foram escolhidos num piloto de 15 perguntas, que seguem no banco.
5. Temperatura não controlada; o `claude -p` define o padrão.
6. O gabarito do PR #1608 (doc-0056) termina cortado e nenhuma pergunta o usa.
7. O A2 usa prompt de sistema e os demais usam a mensagem do usuário.
