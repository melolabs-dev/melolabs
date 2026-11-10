---
id: rag2-2508.11386
titulo: "Retrieval-augmented reasoning with lean language models"
autores: "Ryan Sze-Yin Chan, Federico Nanni, Tomas Lazauskas, Rosie Wood, Penelope Yong, Lionel Tarassenko, Mark Girolami, James Geddes, Andrew Duncan (The Alan Turing Institute, Oxford, Cambridge, Imperial College London)"
ano: 2025
tipo: academico
url: https://arxiv.org/abs/2508.11386
doi: 10.48550/arXiv.2508.11386
acessado: 2026-11-08
nivel_evidencia: C
vies: "Relatório técnico de um instituto de pesquisa (cs.CL, v1 de 15/08/2025), sem revisão por pares indicada. Caso único (condições do NHS, domínio médico, informação pública). Consultas e rótulos gerados por GPT-4o a partir das próprias páginas, e o GPT-4o também é um dos modelos avaliados. Só uma parte dos resultados tem repetição (10 execuções); a Tabela 3 é de uma execução. Código aberto no GitHub (t0-1)."
verificada: true
---
# Retrieval-augmented reasoning with lean language models

> tipo: academico (relatório técnico). nivel_evidencia: C (relato técnico com medição; o código é aberto, mas não consta que o conjunto de consultas sintéticas tenha sido publicado). Páginas citadas seguem os marcadores de página do texto extraído (45 páginas).

## Resumo
Descreve um sistema que combina RAG e raciocínio em um modelo pequeno ("lean") sem depender de API externa, pensado para dados privados. Recuperador denso (all-mpnet-base-v2, Chroma) sobre 989 páginas de condições do NHS; consultas sintéticas de pacientes geradas pelo GPT-4o; traços de raciocínio do DeepSeek-R1 usados para ajustar finamente o Qwen2.5-Instruct de 1,5B a 32B. Tarefa: prever a condição e a disposição (autocuidado, atenção primária urgente, pronto-socorro). O modelo de 32B ajustado (t0-1.1-k5-32B) acerta a condição em 56% das consultas, na faixa de GPT-4o, o3-mini e DeepSeek-R1 com RAG; a acurácia de disposição fica perto de 50% para todos. O RAG sozinho já explica a maior parte do ganho; o raciocínio ajustado acrescenta pouco no modelo de 32B e muito nos modelos de 1,5B e 3B. Os autores também descrevem a interface conversacional e o uso da recuperação como ferramenta.

## Método
- **Dados:** 990 páginas raspadas, 989 após remover "Mental Health" (seção 4.1, p. 18; a seção 4.3 fala em 988, discrepância do próprio texto). Cada página tem título, texto completo e um resumo gerado por Qwen2.5-32B-Instruct que reduz o tamanho em 85% (prompt no Apêndice A.3).
- **Consultas sintéticas (seção 4.2, p. 19-20):** GPT-4o gera a consulta a partir da página, de uma disposição-alvo e do sexo do paciente; três tipos: básica, hipocondríaca e minimizadora ("downplay"). Conjunto de avaliação com 1.000 consultas e conjunto de ajuste fino com 2.000, sem sobreposição de par condição-disposição. Um clínico revisou **um subconjunto** (tamanho: não consta).
- **Recuperação (seção 3.2.2, p. 10-12):** all-mpnet-base-v2 (109M de parâmetros, vetor de 768 dimensões, sequência máxima de 384 tokens), sobreposição de 50 tokens por padrão, Chroma com distância L2; Chroma e FAISS tiveram desempenho parecido. Se algum chunk de uma página entra no top-k, a página inteira é recuperada. Só denso: sem BM25, sem híbrido. Reranqueamento com uma chamada extra de LLM e reformulação de consulta foram tentados e não levaram de forma consistente a melhoras significativas (seção 4.3, p. 21), sem números.
- **k:** testado de 1 a 100 (Tabela 1); os experimentos finais usam k = 5 por limite de contexto e de recursos (seção 4.3, p. 21).
- **Ajuste fino (seções 3.2.5, 4.4):** Qwen2.5-Instruct de 1,5B, 3B, 7B, 14B e 32B; 5 épocas, taxa de aprendizado de 1e-5 com cosseno, tamanho de lote 1 por dispositivo, bf16, bloco de 32.768 tokens, FSDP. Exemplos com 5 resumos recuperados têm em média 7.544 tokens; com páginas inteiras seriam 74.641 (p. 13).
- **Avaliação (seção 4.5, p. 23-25):** acurácia de condição e de disposição; todos os modelos com RAG recebem os mesmos 5 documentos; a linha sem recuperação recebe a lista das 989 condições no prompt (Apêndice A.6.3 e A.6.4, p. 43-44). A opção "inconclusive" existe nos prompts de avaliação. Valores da Tabela 2 são **médias de 10 execuções**, com desvio-padrão em geral de cerca de 0,01 (legenda da Tabela 2). Tabelas 3 e 4: a Tabela 3 é de **uma execução**; na Tabela 4 o número de execuções: não consta. Temperatura: não consta. Para t0 e s1.1, "budget forcing" com no máximo 1.024 tokens de raciocínio e até 3 supressões do fim do raciocínio (nota 21, p. 23).
- **Orquestração:** o agente conversacional (Qwen2.5-Instruct-32B) decide se chama o recuperador como ferramenta e que consulta escrever; o modelo ajustado responde com o contexto no prompt de sistema (seção 3.3, p. 14-16). As similaridades (L2) vão no prompt.

## Resultados
- **Tabela 1 (recuperação, p. 21), 1.000 consultas, p@k = a condição correta está entre os k retornados:** páginas completas em chunks (5.824 itens) com p@1, p@5, p@10, p@30, p@50, p@100 de 0,47; 0,68; 0,78; 0,87; 0,91; 0,94. Resumos (989 itens) de 0,51; 0,76; 0,83; 0,93; 0,96; 0,98. Com k = 5 o teto de acurácia de condição é 0,76 (seção 4.3).
- **Tabela 2 (p. 24), condição e disposição, médias de 10 execuções:**
  - Qwen2.5-32B-Instruct sem recuperação: 0,38 e 0,46; com 5 documentos: 0,54 e 0,50. Ganho de 16 pontos na condição e 4 na disposição.
  - t0-1.1-k5-32B: 0,56 e 0,51. s1.1-32B: 0,49 e 0,46. Qwen3-32B: 0,53 na condição (a coluna de disposição não ficou legível no texto extraído; conferir no PDF).
  - GPT-4o: 0,49 na condição sem recuperação e 0,56 com; a disposição cai de 0,56 para 0,54 com recuperação segundo o texto (+7 pontos na condição, queda leve na disposição, p. 23).
  - o3-mini: 0,27 sem recuperação e 0,57 com. DeepSeek-R1: 0,44 sem e 0,56 com. (A atribuição das colunas de disposição desses três modelos foi inferida da posição no texto extraído; conferir no PDF.)
  - Tese do texto: o RAG sozinho dá a maior parte do ganho; o ajuste de raciocínio dá um pequeno ganho adicional no modelo de 32B (de 0,54 para 0,56 na condição).
- **Tabela 3 (p. 26), uma execução, k = 5:** t0 contra s1.1, condição e disposição: básica 0,52 e 0,64 contra 0,49 e 0,52; hipocondríaca 0,62 e 0,44 contra 0,52 e 0,37; minimizadora 0,53 e 0,47 contra 0,47 e 0,43. O s1.1 faz mais de 40% a mais de erros de subestimação em consultas básicas (seção 5.1).
- **Tabela 4 (p. 27), k = 5, condição e disposição:** 1,5B com 3 GB: 0,53 e 0,47; 3B com 6 GB: 0,56 e 0,48; 7B com 14 GB: 0,54 e 0,48; 14B com 28 GB: 0,56 e 0,48; 32B com 64 GB: 0,56 e 0,51; Qwen 32B sem raciocínio com RAG: 0,54 e 0,50; DeepSeek-R1 (671B): 0,56 e 0,51. A Figura 5 (p. 28) compara cada Qwen sozinho, com RAG e com o ajuste t0 na condição; no texto, em 1,5B e 3B o ganho vem do ajuste de raciocínio, em 32B vem principalmente da capacidade de interpretar o recuperado. Valores do gráfico: não constam no texto.
- **Figura 2 (p. 11):** reproduzindo o s1.1 em AIME24, o benefício do raciocínio aparece a partir de 14B; em 1,5B o ajuste piora o desempenho.
- **Custo de computação (seção 3.1, p. 8-9):** cerca de 2.500 GPU-horas no Azure, 700 em Isambard-AI e 500 em Baskerville; o ajuste final de 32B levou cerca de 80 GPU-horas.

## Afirmações extraídas (com localização)
- Sem recuperação, um modelo de 32B já identifica a condição em 38% e a disposição em 46% dos casos; o GPT-4o, em 49% e 56% (seção 4.5, p. 23).
- Dar os documentos melhora a condição em mais de 15 pontos no Qwen 32B e 7 no GPT-4o; a disposição sobe 4 pontos no Qwen e cai levemente no GPT-4o, talvez por mais ambiguidade com mais informação (seção 4.5, p. 23).
- O o3-mini perde o foco sem evidência e considera cenários demais (0,27 de acurácia de condição) (p. 25).
- Resumir as páginas em 85% do tamanho melhora a recuperação em relação às páginas inteiras em chunks, mas o resumo foi escrito já sabendo o tipo de consulta (seção 4.3, p. 21).
- A abordagem de reranqueamento e de reformulação de consulta não deu ganho consistente (seção 4.3, p. 21).
- Um modelo de 1,5B ajustado atinge desempenho comparável ao de 32B sem raciocínio na condição (seção 5.2, p. 27-28).
- Obter traços de raciocínio é o gargalo para dados privados; os autores sugerem criar à mão ou corrigir manualmente os de um modelo local (seção 5.1, p. 26).
- O código e os modelos destilados estão publicados (nota 22, p. 27).

## Limitações da fonte
- **Do autor:** o resumo escrito para uma tarefa conhecida pode não servir para busca geral (seção 4.3); k = 5 impõe teto de 76% na condição; o desempenho em disposição está limitado pela qualidade dos traços do DeepSeek-R1 e não alcança o o3-mini (seção 4.5); a geração sintética com um LLM de fronteira não serve para dados privados e exige outra estratégia (seção 4.2); o protótipo não é ferramenta de aconselhamento médico (seção 4); sem autenticação na interface (seção 3.3.3).
- **Minhas:**
  - Um domínio, informação pública, que os modelos podem ter visto no pré-treino; o ganho de RAG é medido contra modelos que já sabiam parte do conteúdo (38 a 49%).
  - Consultas e gabarito sintéticos gerados a partir da mesma página que serve de base de recuperação, pelo GPT-4o, que também é avaliado: risco de viés de estilo e de vazamento de vocabulário a favor da recuperação. Só um subconjunto foi revisado por clínico, de tamanho não informado.
  - A disposição tem 3 classes (acaso de 0,33) e todos os modelos ficam entre 0,46 e 0,56. As diferenças de 1 a 2 pontos são pequenas diante do ruído do gabarito sintético.
  - Todo o gabarito tem uma condição verdadeira. Não há perguntas sem resposta na base, então a opção "inconclusive" existe nos prompts, mas o artigo não reporta com que frequência foi usada nem a precisão da abstenção.
  - A comparação de recuperação (Tabela 1) mistura unidades: 5.824 chunks contra 989 resumos, e o k conta chunks em um caso e páginas em outro; a vantagem do resumo (0,76 contra 0,68 em p@5) não isola o efeito do resumo.
  - A linha "sem recuperação" recebe a lista das 989 condições, o que equivale a um problema de múltipla escolha grande, não a uma pergunta aberta.
  - A Tabela 3 é de uma única execução; na Tabela 4 as execuções não constam. Em nenhuma tabela há teste de significância; só a Tabela 2 reporta desvio-padrão.
  - O texto extraído embaralha as colunas de várias linhas da Tabela 2; os valores de Qwen3-32B e de disposição dos modelos de fronteira devem ser conferidos no PDF.
  - O ajuste fino de raciocínio é irrelevante para o Haiku (modelo fechado, sem ajuste), então só o lado do RAG se aplica.

## O que importa para o estudo 2
- **O que copiar:** (1) desenho com e sem recuperação sobre as mesmas perguntas e o mesmo modelo, com a base de comparação "sem recuperação" explícita; (2) reportar p@k da recuperação separada da acurácia final e tratar o recall@k como teto; (3) repetir execuções e reportar desvio-padrão (10 execuções aqui; o plano prevê 3 votos); (4) o prompt de avaliação com a opção explícita de resposta inconclusiva (Apêndice A.6) como ponto de partida para as 20 perguntas sem resposta; (5) tipos de consulta adversariais ("downplay", "hipocondríaca") como inspiração para variar a formulação das perguntas de conflito.
- **Apoia:**
  - A1 contra A3/A4/H3: o teto de recuperação limita o acerto (0,76 de teto de recuperação com 0,56 de acerto; o plano usa o oráculo A1 para separar os dois erros).
  - H1 e o teste de vazamento: sem contexto, os modelos ficaram bem acima do acaso mesmo em um domínio "privado-like" (0,38 de 989 opções), logo A0 pode não ficar no acaso se a pergunta tiver opções genéricas.
  - A5 (curadoria): a versão curta e orientada ao tipo de pergunta dos documentos elevou p@5 de 0,68 para 0,76 e p@1 de 0,47 para 0,51, o que lembra os "cartões de decisão". Apoio fraco, pela confusão de unidades acima.
  - O comportamento do contexto em H6/N1: mais contexto pode piorar a disposição no GPT-4o (queda leve). Indício fraco de que mais tokens nem sempre ajuda.
- **Contradiz ou enfraquece:** o reranqueamento por LLM e a reformulação de consulta não deram ganho consistente (sem números). Enfraquece a expectativa de H4, de que o A4 com reranqueamento supere o A3 em 10 pontos de recall.
- **Não cobre:** híbrido BM25 mais vetor, fusão por rank, metadados, filtro de vigência, abstenção medida, perguntas com decisão antiga e vigente em conflito. Para H5 e H7 esta ficha não traz evidência.

## Contradições ou ajustes que o plano.md precisa
1. **Margens menores que a resolução declarada.** O plano diz que com 100 perguntas pareadas a diferença detectável é de cerca de 15 pontos, mas H4 usa 5 pontos de acerto (refutada abaixo de 3), H7 usa 5 pontos de perda e H8 usa 5 e 10 pontos. Neste artigo, com 1.000 consultas e 10 execuções, as diferenças que interessam (1 a 4 pontos) já ficam perto do ruído. Reescrever essas margens como estimativas com intervalo, ou subir o número de perguntas, ou declarar essas hipóteses como exploratórias.
2. **A0 pode não ficar perto do acaso.** Com opções fechadas e conhecimento genérico, o piso é maior que o acaso (aqui 0,38 contra 0,001 de acaso em 989 opções). A refutação de H1 pelo vazamento deve comparar com um piso de referência, por exemplo um modelo sem acesso ao lake com perguntas de múltipla escolha de outro projeto.
3. **Registrar o k e os tokens entregues por braço**, porque o teto de recuperação com k = 5 foi o fator limitante aqui (0,76).
4. **Gabarito gerado por IA a partir dos próprios documentos** (plano: "rascunho por IA" na segunda). É o mesmo processo que aqui exige revisão: o plano já prevê a revisão do autor na terça, o que é melhor que um subconjunto revisado; manter e registrar quantas perguntas foram alteradas na revisão.
5. **Evitar o modelo avaliado como gerador do gabarito** (aqui o GPT-4o gera e é avaliado). Para o estudo 2, se o rascunho vier do Sonnet ou do Haiku, registrar isso como risco de viés de estilo.
6. **A abstenção (H7) não tem apoio aqui**: o artigo oferece a opção "inconclusive" mas não mede a abstenção.
