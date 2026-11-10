---
id: rag2-2604.03826
titulo: "Context Matters: Evaluating Context Strategies for Automated ADR Generation Using LLMs"
autores: "Aviral Gupta, Rudra Dhar, Daniel Feitosa, Karthik Vaidhyanathan"
ano: 2026
tipo: academico
url: https://arxiv.org/abs/2604.03826
doi: 10.48550/arXiv.2604.03826
acessado: 2026-11-08
nivel_evidencia: B
vies: "Preprint v2 (15/04/2026), aceito no EASE 2026. Métricas são só de similaridade textual com o ADR humano (sem acerto de decisão e sem teste estatístico). Comparação entre modelos mistura famílias. Os autores não declaram conflito de interesse; o DOI da ACM no texto é um marcador não preenchido."
verificada: true
---
# Context Matters: Evaluating Context Strategies for Automated ADR Generation Using LLMs

> tipo: academico. nivel_evidencia: B (experimento controlado em larga escala com pacote de replicação aberto, mas sem inferência estatística e com métrica indireta). Texto lido por inteiro (corpo, tabela 1, discussão, ameaças, referências). As figuras 3 a 6 não foram lidas como imagem, só as legendas e o texto que as descreve; a tabela 1 vem de extração de PDF e foi conferida contra os números citados no texto.

## Resumo
Os autores montam um corpus de ADRs (registros de decisão de arquitetura) em sequência cronológica, tirado de 750 repositórios abertos, e pedem a quatro LLMs que gerem o próximo ADR a partir só do título. Comparam cinco condições de contexto: nenhum, histórico inteiro, os K primeiros, os K últimos e recuperação semântica (RAFG). Concluem que qualquer contexto bate o caso sem contexto em todas as métricas e em todos os modelos. Uma janela de 3 a 5 registros recentes rende quase o mesmo que o histórico inteiro. A recuperação empata com a janela recente no agregado, e só "parece" ajudar em decisões transversais, o que vem de inspeção informal de amostras. Argumentam que a estratégia de contexto pesa mais que o tamanho do modelo.

## Método
- **Tarefa:** dado só o título do enésimo ADR, gerar o ADR inteiro (seção 3.1, 3.4). Texto aberto, não é escolha entre opções fechadas.
- **Dados (3.3.1):** corpus de Buchgeher et al., refinado à mão (estrutura, ordem cronológica, ruído). Mais de 4.500 ADRs validados em 750 repositórios, média de cerca de 6,03 ADRs por repositório, com forte assimetria (menos de 2% passam de 25 registros). A limpeza foi feita pelo primeiro autor com critérios por regras. Quantos ADRs entraram de fato em cada célula do experimento: não consta. O texto fala em mais de 80.000 gerações (5.3).
- **Modelos (3.3.2):** Gemini-2.5-Pro (proprietário), Qwen3-235B-A22B-Instruct-2507 (aberto), GLM-4.6 (aberto, descrito pelos autores como "graph-augmented") e Gemma-3-4B-it (local, leve). Escolhidos pelo ranking LMArena de 15/10/2025 e por custo e acesso. Tamanhos dos modelos fechados: não consta. Haiku e Sonnet não aparecem.
- **As cinco condições de contexto (3.4), com definição:**
  1. **Baseline:** só o título do ADR alvo e a instrução de gerar. Nenhum ADR anterior.
  2. **All_N:** todos os ADRs anteriores do repositório, em ordem.
  3. **First_K:** os K primeiros ADRs do repositório (decisões fundadoras).
  4. **Last_K:** os K ADRs imediatamente anteriores ao alvo (janela recente).
  5. **RAFG (Retrieval-Augmented Few-shot Generation):** os K ADRs anteriores mais parecidos com o título alvo. Embeddings com all-MiniLM-L6-v2 (SentenceTransformers), similaridade do cosseno entre o título (consulta) e o conteúdo inteiro de cada ADR anterior. Sem chunking por seção (Contexto, Decisão, Consequências) e sem banco vetorial externo, tudo em memória. Sem BM25, sem reranqueador, sem filtro por metadados.
- **K:** 3 e 5 em First_K, Last_K e RAFG (Tabela 1). O valor foi escolhido em experimentos preliminares como o ponto em que mais ADRs deixavam de dar ganho; não há análise de sensibilidade (5.3).
- **Métricas (3.5):** BERTScore (F1, precisão, recall), BLEU, ROUGE-1, ROUGE-L, METEOR, contra o ADR humano. Mais comprimento da saída em tokens (média e desvio). Revisão manual de amostras, exploratória, por dois autores, sem rubrica nem concordância entre avaliadores (5.3).
- **Temperatura, número de execuções por item, prompt exato, semente:** não consta. O texto não diz se cada item foi gerado uma vez.
- **Testes estatísticos e tamanhos de efeito:** não constam. Busquei no texto inteiro termos como teste de hipótese, valor-p, Wilcoxon, Cohen e tamanho de efeito, e só aparece a palavra "significativo" em sentido corrente. A afirmação do resumo de que a recuperação "não oferece vantagem estatisticamente significativa" não tem teste reportado no corpo do artigo. O pacote de replicação (Zenodo 18370195) pode conter mais, e eu não o abri.

## Resultados
Todos os números abaixo vêm da Tabela 1 (seção 4), média sobre o corpus. Colunas: BERTScore F1 / BLEU / METEOR / ROUGE-1 / ROUGE-L / tokens médios. Os ADRs humanos têm em média 526,74 tokens (desvio 741,88).

| Modelo | Baseline | All_N | First_K(3) | Last_K(3) | RAFG(3) |
|---|---|---|---|---|---|
| Gemini-2.5-Pro | 0,8199 / 0,0193 / 0,1433 / 0,2584 / 0,1182 / 1123,41 | 0,8421 / 0,0755 / 0,2303 / 0,3593 / 0,1820 / 709,89 | 0,8401 / 0,0746 / 0,2363 / 0,3478 / 0,1778 / 636,62 | 0,8440 / 0,0866 / 0,2428 / 0,3633 / 0,1891 / 680,23 | 0,8438 / 0,0847 / 0,2423 / 0,3616 / 0,1877 / 674,39 |
| Qwen3-235B | 0,8184 / 0,0325 / 0,1733 / 0,2626 / 0,1253 / 680,45 | 0,8379 / 0,0677 / 0,2142 / 0,3355 / 0,1667 / 678,00 | 0,8344 / 0,0608 / 0,2088 / 0,3157 / 0,1577 / 678,98 | 0,8375 / 0,0670 / 0,2113 / 0,3275 / 0,1648 / 738,44 | 0,8375 / 0,0669 / 0,2118 / 0,3281 / 0,1654 / 727,16 |
| Gemma3-4B | 0,8152 / 0,0245 / 0,1630 / 0,2584 / 0,1264 / 814,99 | 0,8326 / 0,0651 / 0,2136 / 0,3132 / 0,1658 / 666,28 | 0,8265 / 0,0528 / 0,2039 / 0,2908 / 0,1510 / 610,57 | 0,8313 / 0,0617 / 0,2085 / 0,3044 / 0,1615 / 648,14 | 0,8310 / 0,0593 / 0,2071 / 0,3031 / 0,1599 / 655,87 |
| GLM-4.6 | 0,8186 / 0,0275 / 0,1675 / 0,2635 / 0,1256 / 841,88 | 0,8379 / 0,0779 / 0,2300 / 0,3327 / 0,1737 / 669,46 | 0,8365 / 0,0755 / 0,2340 / 0,3224 / 0,1699 / 579,64 | 0,8395 / 0,0839 / 0,2365 / 0,3344 / 0,1781 / 640,84 | 0,8395 / 0,0841 / 0,2383 / 0,3355 / 0,1794 / 620,10 |

Os valores para K=5 estão na mesma tabela e ficam sempre muito próximos dos de K=3 (diferenças na terceira ou quarta casa decimal).

Achados lidos da tabela e do texto:
- **Qualquer contexto bate o baseline, em todos os modelos e métricas** (4.1). Exemplo do texto: Gemini, BLEU de 0,0193 para 0,0755 com All_N. O baseline também é mais prolixo (1123 tokens contra 710 no Gemini All_N) e menos variável (4.1).
- **Janela pequena rende quase o mesmo que tudo** (4.2). Qwen: BERTScore F1 de 0,8375 com Last_K(3), 0,8373 com Last_K(5), 0,8379 com All_N. Diferença de 0,0004. Custo de All_N cresce linearmente com o repositório.
- **First_K é o pior dos contextos**, mas ainda acima do baseline (4.2; ex.: Gemini ROUGE-1 0,3478 contra 0,3633 do Last_K).
- **RAFG empata com Last_K no agregado** (4.3). Diferenças típicas na terceira ou quarta casa decimal; por exemplo, Gemini BLEU 0,0866 (Last_K 3) contra 0,0847 (RAFG 3), e Qwen METEOR 0,2113 contra 0,2118.
- **Observação minha a partir da Tabela 1:** o texto diz que Last_K é "o mais forte", mas em Qwen e em Gemma o All_N tem o maior BERTScore F1 (0,8379 e 0,8326). A vantagem de Last_K aparece em Gemini e GLM, e é pequena.
- **Contexto contra modelo (conta minha, Tabela 1, BERTScore F1):** o ganho do baseline para Last_K(3) vai de 0,0161 (Gemma) a 0,0241 (Gemini). A diferença entre modelos com o mesmo contexto Last_K(3) é de 0,0127 (Gemini 0,8440 contra Gemma 0,8313). Em BLEU, o ganho do contexto (0,0372 a 0,0673) também supera a diferença entre modelos (0,0249). O padrão apoia a tese dos autores, mas as diferenças são pequenas e BERTScore comprime a escala.
- **Vantagem da recuperação em casos transversais:** vem de leitura informal de amostras (4.3, 5.1). Nenhum número separa decisões lineares de transversais.
- **Figuras:** Fig. 5 (boxplots por modelo, K=3) e Fig. 6 (qualidade por posição do ADR na sequência, K=3). Não li os valores dos gráficos.

## Afirmações extraídas (com localização)
- Qualquer contexto histórico melhora a geração em relação a nenhum contexto, em todos os modelos: seção 4.1, Tabela 1.
- Um histórico completo traz benefício desprezível sobre 3 a 5 registros recentes: seção 4.2, Tabela 1 (exemplo Qwen).
- Last_K supera First_K de forma consistente e muitas vezes iguala ou passa All_N: resposta ao RQ2, seção 4.2.
- RAFG supera First_K e empata com Last_K; a vantagem para decisões transversais é "possível" e baseada em amostra: seção 4.3, resposta ao RQ3.
- A estratégia de contexto importa mais que a escala do modelo: seção 5.1 e conclusão (7). Os próprios autores admitem que faltam comparações de tamanho dentro da mesma arquitetura (5.3, validade de conclusão).
- Um modelo de 4B com contexto gera ADRs "comparáveis" aos de modelos muito maiores: seção 5.2.1. Na Tabela 1 o Gemma fica abaixo dos outros três em todas as métricas, por margem pequena.
- A queda de desempenho se associa a ADRs que apontam para conteúdo externo (wiki, issues) e a conhecimento só na memória da equipe: seção 5.1. Os autores dizem que causalidade não foi estabelecida.
- Recomendação prática: janela recente como padrão e recuperação como reserva para casos transversais: 5.2.1 e 7.
- As métricas medem fidelidade de réplica, não qualidade absoluta: 5.3 (validade de construto).
- Os valores de K vieram de inspeção de retornos decrescentes, sem análise de sensibilidade: 3.4 e 5.3.

## Limitações da fonte
**Dos autores (5.3):** métricas medem similaridade com o ADR humano e punitivas para saídas auto contidas quando a referência aponta para recursos externos; títulos ambíguos inflam a variância; baseline sem contexto é só um de vários possíveis (faltou, por exemplo, K aleatório); revisão manual exploratória, sem rubrica; extração automática de títulos errou em menos de 0,2% dos casos; K sem análise de sensibilidade; geração é probabilística e o grande número de gerações serve de média; ADRs de repositórios abertos podem ter vazado para o treino dos modelos (os autores argumentam que afeta todas as estratégias por igual); comparação de tamanho dentro da mesma arquitetura ficou por fazer.

**Minhas:**
- Não há teste estatístico, intervalo de confiança, nem tamanho de efeito. As diferenças entre Last_K, RAFG e All_N estão na terceira ou quarta casa decimal. "Empate" aqui é leitura de médias, não resultado inferencial. A afirmação de "sem vantagem estatisticamente significativa" no resumo fica sem sustentação no corpo do artigo.
- A tarefa é geração aberta de texto avaliada por similaridade. Não há acerto de decisão, nem opções fechadas, nem verificação de vigência de decisões.
- A recuperação testada é fraca: só vetor (MiniLM), consulta de título curta, documento inteiro, sem BM25, reranqueamento, metadados ou noção de decisão substituída. Isso não mede o que o plano chama de RAG híbrido com curadoria.
- No corpus de ADRs numerados, a janela recente tem uma vantagem estrutural: o ADR anterior costuma ser relacionado. Num lake de documentos heterogêneos (código, issues, docs) não existe "janela recente" equivalente.
- A comparação entre modelos mistura famílias, e não informa os tamanhos dos modelos fechados. O vazamento de treino é provável em ADRs públicos.
- Temperatura, número de execuções por item, prompt e quantos ADRs por célula: não constam.
- Tabela e figuras vieram de PDF e extração de texto; os números das células foram conferidos contra os trechos citados no texto, mas não contra a imagem da tabela.

## O que importa para o estudo 2
**Copiar do método**
- Separar a recuperação de duas linhas de comparação simples: "colar tudo" (All_N, nosso A2) e "colar o contexto certo ou recente" (nosso A1 oracle e um braço de janela recente). O artigo mostra que um baseline de contexto simples iguala a recuperação, então o estudo 2 precisa dos dois comparadores para que um ganho do RAG signifique algo.
- Relatar tokens de entrada e de saída por condição (Tabela 1 faz isso), porque custo é metade da pergunta do estudo.
- Reportar K de forma explícita e testar mais de um valor (aqui 3 e 5), mesmo que só no piloto.
- Dizer abertamente que o corpus pode ter vazado para o treino e que o teste de vazamento do plano (A0 perto do acaso) é a resposta.

**Que braço ou hipótese isso apoia ou contradiz**
- Apoia o N1 e a lógica do plano de que "mais contexto" não basta: o baseline é pior que qualquer contexto, mas o All_N não vence a janela curta.
- Apoia a H6 (colar tudo não ganha do melhor RAG, ou empata com custo maior) no sentido de que All_N não foi melhor que seleções curtas e custa mais tokens. Cuidado: no artigo All_N empatou, e em Qwen e Gemma foi até o melhor por margem mínima. A H6 deve esperar empate em acerto e olhar o custo.
- Apoia o H2 e o H9 só de leve: contexto fecha boa parte da distância entre modelos pequenos e grandes em similaridade textual. Não há evidência sobre decisões com opções fechadas.
- Não testa nada do que A4, A5 e A6 propõem (híbrido, curadoria de vigência, abstenção). Fica sem apoio nem contradição para H4, H5 e H7.
- Um braço de "janela recente dos registros" (últimos K registros do log de decisões) é barato e derivado direto deste artigo. Vale incluir como A-extra no piloto, se o log de decisões do estudo 1 tiver ordem temporal.

## Contradições ou ajustes que o plano.md precisa
1. **Linha 13 do plano ("a janela recente de registros ganhou da recuperação em fluxos lineares"):** o artigo mostra paridade, não vitória, e sem teste estatístico. Reescrever como "empatou com a recuperação no agregado, com diferenças na terceira ou quarta casa decimal".
2. **Mesma linha, "contexto importa mais que tamanho do modelo em decisões de arquitetura":** a tarefa do artigo é gerar texto de ADR avaliado por similaridade, não tomar decisões com resposta certa. Os autores reconhecem que não controlaram o tamanho dentro da mesma arquitetura. Trocar por "contexto pesou mais que a escolha do modelo na geração de ADRs, em métricas de similaridade".
3. **Contagem de braços da fonte:** são cinco condições (baseline, All_N, First_K, Last_K, RAFG), com K em 3 e 5. O plano pode citar o artigo para justificar A0, A2 e A3 só como analogias: o RAFG deles é só vetor, sem BM25, reranqueamento nem metadados, então não há fundamento aqui para H4 e H5.
4. **Margens de partida das hipóteses não vêm deste artigo.** Não há tamanhos de efeito para calibrar H1 a H9, e o plano não deve citá-lo como fonte de margens.
5. **Registrar no plano o contra-argumento da fonte:** se o estudo 2 achar que a recuperação não ajuda além de colar o contexto certo, isso é compatível com o artigo (hipótese nula do plano, linha 65). Acrescentar o braço de janela recente como comparador pré-registrado.
