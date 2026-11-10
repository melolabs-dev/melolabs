---
id: rag2-2606.21553
titulo: "Dissecting Agentic RAG: A Component Ablation for Multi-Hop QA with a Local 7B Model"
autores: "Shaikh"
ano: 2026
tipo: independente
url: https://arxiv.org/abs/2606.21553
doi: 10.48550/arXiv.2606.21553
acessado: 2026-11-08
nivel_evidencia: B
vies: "preprint (v1, jun/2026) de pesquisador independente, sem financiamento, hardware pessoal; ablação controlada com testes pareados, mas uma só execução por condição com decodificação gulosa, um só modelo (Qwen2.5-7B-Instruct), um só benchmark (HotpotQA, amostra de 5.000 do conjunto de desenvolvimento no cenário com distratores); a condição hybrid-only é a melhor de oito, escolhida depois de ver os resultados; o roteador testado é uma heurística de regras simples escolhida pelo autor"
verificada: true
---
# Dissecting Agentic RAG: ablação de componentes em QA multi-salto com um 7B local

> tipo: independente (pesquisador independente, preprint). nivel_evidencia: B (ablação com método e código abertos, testes pareados, mas sem repetições, um modelo e um benchmark). Verificada em 08/11/2026: o PDF foi aberto no arxiv.org e o título confere. Texto lido por inteiro (8 páginas, Tabelas 1 a 4, limitações e referências). As Tabelas 1 e 2 foram conferidas com a extração com layout do PDF.

## Resumo
Ablação de um pipeline de RAG "agêntico" (decomposição da pergunta em sub-perguntas, laço de recuperação sobre elas, roteamento adaptativo entre denso, BM25 e híbrido, reranqueador cruzado e uma chamada final de síntese) com Qwen2.5-7B-Instruct local, em 5.000 perguntas do HotpotQA com distratores. O pipeline completo chega a EM 53,2 e F1 61,6 contra EM 43,1 e F1 54,0 de um RAG de passagem única com recuperação densa. Entre as oito condições de ablação, usar sempre recuperação híbrida por fusão de ranks supera o roteador por regras (+1,8 EM, +1,9 F1); duas iterações capturam 95% do ganho de cinco; decomposição e reranqueamento dão ganhos significativos porém menores.

## Método
- **Modelo:** Qwen2.5-7B-Instruct via Ollama, em uma GPU RTX A6000 de 49 GB; sem APIs proprietárias (seção 3, Implementação). Armazenamento vetorial Qdrant com FastEmbed; rastros em DuckDB.
- **Dados:** amostra aleatória fixa de 5.000 perguntas do conjunto de desenvolvimento do HotpotQA no cenário com distratores (10 parágrafos por pergunta, 2 relevantes e 8 distratores); mesma amostra em todas as condições (seção 4). O tamanho do índice de recuperação (se agrega os parágrafos de todas as perguntas ou só os 10 de cada uma) não consta.
- **Pipeline (seção 3, Figura 1):** decompositor gera de uma vez as sub-perguntas; laço de até T = 5 passos, um por sub-pergunta, em que o agente escolhe a estratégia, recupera, reranqueia e acrescenta ao contexto; uma única chamada de síntese gera a resposta. O modelo não é consultado entre as recuperações (plano-e-execução, não ReAct).
- **Estratégias de recuperação (seção 4):** densa com BGE-small-en-v1.5; esparsa BM25; híbrida por fusão de ranks recíprocos (RRF) com pesos iguais. Roteador por regras: consultas com entidades nomeadas, datas ou números vão para BM25; curtas ou conceituais para a densa; as demais para a híbrida. Os 20 melhores candidatos da estratégia escolhida passam por reranqueador cruzado (ms-marco-MiniLM-L-6-v2) e ficam os 5 melhores.
- **Baseline:** passagem única, recuperação densa top-10, síntese direta, sem decomposição, sem laço, sem reranqueador (seção 4). Difere do pipeline completo em vários aspectos ao mesmo tempo.
- **Condições (seção 4):** steps-1, steps-2, steps-3 (profundidade do laço), no-decomp, no-reranker, dense-only, sparse-only, hybrid-only; cada uma altera um componente do pipeline completo.
- **Métricas e estatística:** EM e F1 do script oficial do HotpotQA; latência média por pergunta com um único trabalhador; intervalo de confiança bootstrap percentílico de 95% com 10.000 reamostragens; McNemar exato para EM e Wilcoxon para F1, pareados por pergunta; todos os valores p unilaterais na direção da hipótese, com Holm-Bonferroni para cinco comparações-chave (seção 4).
- **Parâmetros de decodificação:** temperatura 0 (gulosa), uma execução por condição (seção 7). Tamanho de chunk: não consta.
- **Custo em dólar:** não se aplica (modelo local). Latência reportada em ms, específica do hardware.

## Resultados (onde estão)
- **Tabela 1 (EM / F1 / latência):** baseline 43,1 / 54,0 / 546 ms; agêntico completo 53,2 / 61,6 / 5.642 ms; hybrid-only 55,0 / 63,5 / 5.688 ms. Completo contra baseline: +10,1 EM e +7,6 F1 (p < 0,001); o próprio artigo diz que isso mede o pipeline inteiro e não um componente.
- **Tabela 2 (EM, F1, latência em ms; diferença de EM contra o completo):** no-decomp 51,9 / 60,1 / 2.546 (-1,4); no-reranker 51,5 / 59,4 / 5.648 (-1,7); steps-1 46,1 / 53,9 / 5.426 (-7,1); steps-2 52,9 / 61,3 / 5.628 (-0,3); steps-3 53,2 / 61,6 / 5.643 (0,0); dense-only 53,0 / 61,9 / 5.623 (-0,2); sparse-only 53,0 / 61,2 / 5.681 (-0,2); hybrid-only 55,0 / 63,5 / 5.688 (+1,8). Intervalos de 95% de EM: baseline [41,8; 44,5]; completo [51,8; 54,6]; hybrid-only [53,6; 56,4].
- **Seção 6, roteamento:** a passagem de topo do pipeline completo veio da busca BM25 em 79,2% das perguntas (3.961), da híbrida em 16,3% (814) e da densa em 4,5% (225) (Tabela 3, Figura 4); o texto também diz que 72% de todas as chamadas de recuperação foram roteadas para BM25 (métricas diferentes: passagem de topo contra chamadas). O EM por estrato parece favorecer BM25 (53,9 contra 50,9 e 50,7), mas o autor atribui a viés de seleção (a regra manda para BM25 as perguntas mais simples, ancoradas em entidade).
- **Seção 6, iterações:** steps-1 é a maior queda isolada (-7,1 EM, p < 0,001); steps-2 fica a 0,3 EM do completo; steps-3 é estatisticamente indistinguível. Exemplos qualitativos na Tabela 4.
- **Seção 6, decomposição e reranqueamento:** sem decomposição -1,4 EM (p = 0,004), com latência de 2.546 contra 5.642 ms; sem reranqueador -1,7 EM (p < 0,001), com custo de latência desprezível. O autor adverte que desligar a decomposição também reduz o laço a uma única recuperação, então o -1,4 mistura os dois efeitos.
- **Seção 6, estratégias fixas dentro do laço:** denso fixo e esparso fixo empatam com o roteador (EM 53,0 contra 53,2).

## Afirmações extraídas (com localização)
- Recuperação híbrida fixa por RRF supera o roteador adaptativo por regras em +1,8 EM e +1,9 F1 (p < 0,001, McNemar exato para EM): resumo, seção 5.1, seção 6, Tabela 2.
- O roteador envia a maior parte das sub-perguntas para BM25 porque dispara com entidades nomeadas, que aparecem em quase toda sub-pergunta multi-salto: seção 6, Tabela 3, Figura 4.
- Duas iterações capturam 95% do ganho de cinco; passos além de 2 ou 3 não trazem benefício mensurável: resumo, seção 6, Figura 3.
- Rodar o laço de recuperação em vez de uma passada única é a principal fonte do ganho sobre o baseline, não rodá-lo muitas vezes: seção 1 e seção 6.
- Em um laço iterativo, a escolha da estratégia por passo importa menos que a profundidade do laço: seção 6.
- Reranqueamento (-1,7 EM sem ele) e decomposição (-1,4 EM) são significativos mas menores; decomposição custa cerca de o dobro de latência: seção 6.
- Recomendação final: híbrida fixa em vez de roteamento por regras e laço de no máximo dois ou três passos: conclusão.

## Limitações da fonte
**Do autor (seção 7):** amostra de 5.000 perguntas, não o conjunto completo; uma só família de modelo (Qwen2.5-7B-Instruct); um só benchmark de dois saltos, e tarefas com cadeias mais longas ou raciocínio numérico podem ter outra ordem de componentes; latência é específica do hardware; uma execução por condição com decodificação gulosa, então os intervalos refletem a amostragem de perguntas e não a variação entre execuções do modelo. Nota de rodapé: o HGN (EM 69,2) está no conjunto de teste com outro sistema, sem intenção de comparação direta.

**Minhas:**
- Nenhum teste pareado é reportado entre hybrid-only e dense-only ou sparse-only; só entre hybrid-only e o pipeline completo adaptativo. A diferença de +2,0 EM entre híbrida e as estratégias puras é lida em tabela, sem valor p no texto.
- Hybrid-only é a melhor de oito condições e foi destacada depois de ver os resultados; só cinco comparações entram na correção de Holm-Bonferroni.
- Os intervalos de confiança de EM do completo ([51,8; 54,6]) e do hybrid-only ([53,6; 56,4]) se sobrepõem; a diferença é significativa apenas no teste pareado.
- O resultado de "híbrido supera adaptativo" vale para esta heurística de regras (entidade, data ou número vai para BM25); o artigo não testa roteadores melhores, então não mostra que "escolhas fixas empatam com roteamento adaptativo" em geral.
- Os ganhos do pipeline são em perguntas de dois saltos com 10 parágrafos candidatos por pergunta; o artigo não esclarece o tamanho do corpus recuperado nem a taxa de recuperação dos parágrafos-ouro (recall@k não consta).
- Os valores p são unilaterais na direção da hipótese declarada (seção 4); em pré-registro, a direção deve ser fixada antes dos dados.
- A fusão por RRF com pesos iguais é a única configuração híbrida; não há varredura de pesos.
- O artigo não mede abstenção nem perguntas sem resposta; a única "resposta de baixa confiança" aparece como exemplo qualitativo (Tabela 4).

## O que importa para o estudo 2
- **Base para o A4 (híbrido por rank mais reranqueamento):** a fusão RRF de BM25 e vetor com pesos iguais e um reranqueador cruzado sobre os 20 melhores (ficam 5) é uma configuração documentada, local e barata. É ponto de partida para o piloto.
- **Ordem de grandeza dos efeitos (ajuste de H4):** dentro do pipeline, trocar BM25 ou vetor puro por híbrido valeu cerca de +2,0 EM, e o reranqueador, cerca de 1,7 EM. Em um benchmark de múltiplos saltos, com modelo de 7B e outra métrica, esses são os efeitos de cada componente, bem menores que a margem de 5 pp de acerto de H4 e na região da margem de refutação (3 pp). Com 100 perguntas, o estudo 2 não detecta diferenças desse tamanho (cerca de 15 pp); H4 em acerto tende a terminar inconclusiva, e o recall@k (métrica mais próxima do componente) é a medida certa para H4.
- **Reforça o desenho do A4 como braço fixo, sem roteador:** apoia não incluir roteamento adaptativo no estudo. Não apoia afirmar que fixo "empata" com adaptativo em geral.
- **Contra-indicação para o plano:** o laço de recuperação (sub-perguntas e iterações) é o que mais rende no HotpotQA, mas ele resolve perguntas de múltiplos saltos. No banco do estudo 2, as 60 perguntas comuns incluem "várias fontes"; um laço pode ajudar nelas e não nas demais. O plano acerta em deixar agentes que exploram livremente fora do escopo; vale registrar como limitação que o A4 é de passada única.
- **Latência:** o custo do laço vem das chamadas ao LLM (decomposição e síntese), não das recuperações; a recuperação e o reranqueamento são baratos. Para o custo por decisão certa (H9), contar chamadas e tokens do LLM, e não o tempo da busca.
- **Método a copiar:** mesma amostra fixa em todas as condições; testes pareados por pergunta (McNemar exato); correção de Holm-Bonferroni para as comparações-chave; liberar IDs das perguntas e rastros; relatar o baseline separadamente do pipeline e dizer que diferenças vêm de vários componentes ao mesmo tempo, como o artigo faz.

## Contradições ou ajustes que o plano.md precisa
- **Achado 5 da seção "O que a literatura já diz" está mais forte do que o artigo:** o plano diz que "escolhas fixas e simples costumam empatar com roteamento adaptativo" em um 7B local. O artigo mostra que a híbrida fixa superou (não empatou com) o roteador por regras em +1,8 EM, enquanto dense-only e sparse-only fixos empataram com ele; o "costumam" generaliza de um benchmark, um modelo, uma execução e uma heurística simples. Sugestão: "num 7B local em HotpotQA, a híbrida fixa por RRF superou um roteador por regras em 1,8 EM; estratégias puras fixas empataram com ele".
- **"Poucas iterações" não se aplica ao A4:** o plano cita, entre as escolhas fixas, "poucas iterações". No artigo, "iterações" são recuperações sobre sub-perguntas geradas por decomposição para QA multi-salto. O A4 do plano é de passada única; a recomendação não vale para ele.
- **Margens de H4:** o ganho de 5 pp de acerto do A4 sobre o A3 é maior do que os efeitos por componente deste artigo (cerca de 2 EM cada). Reavaliar a margem no piloto ou assumir que H4 só será respondida em recall@k.
- **Parâmetros ausentes no plano:** o plano não fixa k nem o tamanho do chunk nem o número de candidatos antes do reranqueamento. Este artigo usa 20 candidatos e 5 finais (baseline com 10); Buskila usa k = 3 e chunks de 512 tokens. Fixar os valores antes do piloto e usar o mesmo k em A3, A4, A5 e N1.
