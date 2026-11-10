---
id: rag2-2005.11401
titulo: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
autores: "Patrick Lewis, Ethan Perez, Aleksandra Piktus, Fabio Petroni, Vladimir Karpukhin, Naman Goyal, Heinrich Küttler, Mike Lewis, Wen-tau Yih, Tim Rocktäschel, Sebastian Riedel, Douwe Kiela (Facebook AI Research, University College London, New York University)"
ano: 2020
tipo: academico
url: https://arxiv.org/abs/2005.11401
doi: 10.48550/arXiv.2005.11401
acessado: 2026-11-08
nivel_evidencia: B
vies: "Artigo fundador do rótulo RAG, escrito pelos autores da proposta (sem avaliação independente). Os modelos são BART-large (400M) e DPR com ajuste fino de ponta a ponta, não um LLM fechado usado por prompt. Wikipédia de dezembro de 2018 como base, que se sobrepõe ao pré-treino dos modelos. Sem barras de erro, sem repetições. A versão lida é a v4 (abril de 2021). O texto não cita o veículo de publicação; outros artigos do conjunto o citam como NeurIPS 2020."
verificada: true
---
# Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks

> tipo: academico. nivel_evidencia: B (experimentos em vários conjuntos públicos com código aberto no HuggingFace, mas sem variância reportada). Páginas citadas seguem os marcadores de página do texto extraído (19 páginas).

## Resumo
Propõe o RAG: um modelo seq2seq pré-treinado (BART-large) combinado com um índice denso da Wikipédia (21 milhões de trechos de 100 palavras) acessado por um recuperador DPR, treinados juntos com o documento recuperado tratado como variável latente. Há duas formulações: RAG-Sequence (o mesmo documento para a sequência toda) e RAG-Token (documentos diferentes por token). Os autores avaliam em QA de domínio aberto (NQ, TriviaQA, WebQuestions, CuratedTrec), QA abstrativo (MS-MARCO), geração de perguntas Jeopardy e verificação de fatos (FEVER). Reportam estado da arte nos QA abertos, respostas mais factuais e específicas que o BART sozinho na avaliação humana, ablações do recuperador (aprendido, congelado, BM25), efeito do número de documentos e a troca do índice para atualizar conhecimento sem retreinar.

## Método
- **Modelos:** gerador BART-large (cerca de 400M de parâmetros, seção 2.3); recuperador DPR com dois codificadores BERT-base (110M cada); só o codificador da consulta e o BART são ajustados, o codificador de documentos e o índice ficam fixos (seção 2.4). Total de 626M de parâmetros treináveis, segundo o Apêndice G (p. 18-19).
- **Base de conhecimento:** Wikipédia de dezembro de 2018 em trechos disjuntos de 100 palavras, 21 milhões de documentos, índice FAISS com HNSW (seção 3, p. 4).
- **k (documentos recuperados):** treino com k de 5 ou 10; no teste o k é escolhido com os dados de desenvolvimento (seção 3). Resultados finais: QA aberto com 15 documentos (RAG-Token) e 50 (RAG-Sequence, com decodificação "Thorough"); MS-MARCO e Jeopardy com 10 (Apêndice A, p. 17).
- **Decodificação:** gulosa para QA; feixe de 4 para MS-MARCO e Jeopardy (Apêndice A). Temperatura de amostragem: não consta (a decodificação é determinística).
- **Métricas:** exact match (QA aberto); Bleu-1 e Rouge-L (MS-MARCO); Q-BLEU-1 e Bleu-1 (Jeopardy); acurácia de rótulo (FEVER 3 e 2 classes); avaliação humana pareada de factualidade e especificidade em 452 pares (seção 4.3); razão de n-gramas distintos (diversidade).
- **Conjuntos e tamanhos:** Tabela 7 (p. 19), por exemplo NQ com 79.169 de treino, 8.758 de desenvolvimento e 3.611 de teste; FEVER-3 com 145.450, 10.000 e 10.000.
- **Número de execuções, sementes, intervalos de confiança:** não consta.
- **Treino:** Fairseq, 8 GPUs V100 de 32 GB, precisão mista, índice de cerca de 100 GB na memória da CPU (36 GB comprimido) (Apêndice C, p. 17).

## Resultados
- **QA aberto (Tabela 1, p. 6), exact match:** RAG-Token 44,1 em NQ, 55,2 e 66,1 em TriviaQA (conjunto padrão e conjunto Wiki), 45,5 em WebQuestions, 50,0 em CuratedTrec; RAG-Sequence 44,5, 56,8 e 68,0, 45,2 e 52,2. Referências: T5-11B de livro fechado 34,5 em NQ; REALM 40,4; DPR 41,5. Estado da arte declarado nas quatro tarefas (no TriviaQA só no conjunto comparável ao T5).
- **Respostas certas sem a resposta no recuperado:** 11,8% de acerto em NQ quando a resposta não está em nenhum documento recuperado, onde um extrator marcaria 0% (seção 4.1, p. 6).
- **Geração (Tabela 2, p. 6):** MS-MARCO, RAG-Sequence supera o BART em 2,6 pontos de Bleu-1 e 2,6 de Rouge-L (44,2 contra 41,6; 40,8 contra 38,2). Jeopardy, Q-BLEU-1 de 22,2 (Token) e 21,4 (Sequence) contra 19,7 do BART. FEVER-3, 72,5 contra 64,0 do BART e 76,8 do estado da arte com supervisão de evidência (diferença de 4,3 pontos); FEVER-2, 89,5 contra 92,2 (diferença de 2,7).
- **Avaliação humana (Tabela 4, p. 8):** na factualidade, o BART foi melhor em 7,1% dos pares e o RAG em 42,7%; ambos bons 11,7%; ambos ruins 17,7%; sem maioria 20,8%. Na especificidade: 16,8% BART, 37,4% RAG, 11,8% ambos bons, 6,9% ambos ruins, 20,1% sem maioria.
- **Diversidade (Tabela 5, p. 8):** razão de trigramas distintos de 53,8% (RAG-Sequence) e 46,8% (RAG-Token) contra 32,4% do BART no Jeopardy; 83,5%, 77,8% e 70,7% no MS-MARCO (referência humana 89,6% e 90,0%).
- **Ablação do recuperador (Tabela 6, p. 8, seção 4.5):** o recuperador aprendido supera o congelado e o BM25 em todas as tarefas exceto FEVER. Por exemplo em NQ, RAG-Token 43,5 contra 37,8 (congelado) e 29,7 (BM25); RAG-Sequence 44,0 contra 41,2 e 31,8. Em FEVER-3, o BM25 deu 75,1 contra 74,5 do aprendido (RAG-Token); os autores atribuem ao caráter centrado em entidades das alegações.
- **Troca de índice (seção 4.5, p. 7-8):** 82 líderes mundiais que mudaram entre dezembro de 2016 e dezembro de 2018, pergunta "Who is {cargo}?". Acerto de 70% com o índice de 2016 para líderes de 2016 e 68% com o de 2018 para líderes de 2018; 12% com o índice de 2018 para líderes de 2016 e 4% com o de 2016 para líderes de 2018.
- **Mais documentos no teste (Figura 3, p. 8):** em QA aberto o RAG-Sequence melhora de forma monotônica com mais documentos, o RAG-Token tem pico em 10; em MS-MARCO mais documentos elevam o Rouge-L do RAG-Token à custa do Bleu-1. Não há tabela numérica, só o gráfico (k até 50). Treinar com 5 ou 10 documentos não mostrou diferença significativa.
- **Recuperação em FEVER (seção 4.4, p. 7):** o documento mais bem colocado é de artigo-ouro em 71% dos casos e há artigo-ouro entre os 10 primeiros em 90%.

## Afirmações extraídas (com localização)
- Não é preciso reranqueador nem leitor extrativo para ter estado da arte em QA aberto (seção 4.1, p. 5).
- Gerar a resposta permite acertar quando os documentos têm só pistas, sem a resposta literal (seção 4.1, p. 5-6).
- O RAG alucina menos e gera mais texto factual que o BART; avaliadores humanos preferem o RAG em factualidade e especificidade (seções 4.2 e 4.3, p. 6; Tabela 4).
- O recuperador aprendido é crucial em QA aberto; em FEVER o BM25 funciona melhor, provavelmente por serem alegações centradas em entidades (seção 4.5, p. 7; Tabela 6).
- O conhecimento pode ser atualizado trocando o índice, sem retreinar (seção 4.5, p. 7-8).
- Um mecanismo de "documento nulo" para casos sem informação útil foi testado em três variantes e não melhorou o desempenho, então foi omitido (Apêndice F, p. 18).
- Em algumas tarefas (geração de histórias) o recuperador "colapsa" e passa a trazer os mesmos documentos para qualquer entrada, e o gerador aprende a ignorá-los, equivalendo ao BART sozinho (Apêndice H, p. 19).
- O conhecimento paramétrico e o não paramétrico trabalham juntos: no exemplo do Jeopardy o BART completa o título do livro sem depender do documento (seção 4.3, p. 6).
- Perguntas do MS-MARCO podem ser inalcançáveis sem os trechos-ouro e algumas não se respondem só com a Wikipédia (seção 3.2, p. 4-5).

## Limitações da fonte
- **Do autor:** a Wikipédia (ou qualquer fonte externa) nunca é totalmente factual nem livre de viés (Impacto Amplo, p. 9); risco de uso para conteúdo enganoso; o colapso do recuperador em tarefas pouco dependentes de fatos (Apêndice H); a subtarefa de recuperar evidência do FEVER não foi atacada, porque a Wikipédia usada difere da do FEVER (Apêndice E); resultados do TriviaQA no conjunto Wiki oficial são bem maiores porque as perguntas são mais simples (Apêndice D); parte do MS-MARCO é inalcançável (seção 3.2).
- **Minhas:**
  - Modelo pequeno e ajustado por treino (BART com 400M, DPR), com recuperador treinado em NQ e TriviaQA. É outro regime em relação a um LLM geral usado por prompt com contexto colado (caso do Haiku). Os números não transferem.
  - Sem repetições nem intervalos de confiança; diferenças pequenas (por exemplo 75,1 contra 74,5 em FEVER) não têm incerteza declarada.
  - A avaliação humana usa 452 pares, mas o texto diz "17%" para ambos factuais, enquanto a Tabela 4 traz 11,7% para ambos bons e 17,7% para ambos ruins; a coluna de especificidade soma 93,0%, não 100%. Há inconsistência de texto ou tabela.
  - A leitura da Tabela 6 no texto extraído está embaralhada; os números de NQ, TriviaQA, WebQuestions, CuratedTrec e FEVER foram atribuídos pela posição das colunas e devem ser conferidos no PDF. As colunas de MS-MARCO e Jeopardy da Tabela 6 não foram usadas aqui.
  - A troca de índice substitui a coleção inteira; não testa uma coleção em que a versão antiga e a nova convivem, que é o caso do estudo 2.
  - Nenhum teste isolado de perguntas sem resposta no acervo. O FEVER-3 tem a classe "sem informação suficiente", mas o artigo não reporta a precisão por classe.
  - Tarefas em Wikipédia, que o BART e o DPR podem ter visto no pré-treino. O acerto sem recuperação não é separado do acerto com recuperação para um mesmo modelo, exceto pelo BART contra o RAG nas tarefas de geração.

## O que importa para o estudo 2
- **O que copiar do método:**
  - Ablação do recuperador contra BM25 e contra um recuperador fixo (Tabela 6): serve de modelo para comparar A3, A4 e A5.
  - Testar mais de um k e reportar a curva (Figura 3). O plano deve fixar o k de cada braço e olhar a sensibilidade no piloto.
  - Medir acerto quando a resposta não está no recuperado (aqui 11,8%): equivale a medir, no A3 e no A4, o acerto das perguntas em que o documento-ouro não entrou no top-k.
  - A prática de comparar com a mesma base sem recuperação (BART contra RAG) apoia o A0.
- **Apoia:** A4 (híbrido). O BM25 ganhou onde a consulta é centrada em entidades (FEVER) e o denso ganhou nas demais; em acervo de projeto, com nomes de arquivos, identificadores e siglas, o lexical deve contribuir. Esta ficha não testa híbrido nem fusão por rank, então o apoio é indireto.
- **Apoia o desenho de N2 e H5 (conflito entre decisão antiga e vigente):** a resposta do modelo seguiu o índice (acerto de 68 a 70% com índice coerente e de 4 a 12% com índice defasado). Mostra que a resposta depende do que a base contém; por si só não mede o que acontece quando versão antiga e nova coexistem.
- **Não apoia H7:** o mecanismo de documento nulo não ajudou; a abstenção de A6 precisa de outra fonte e de seu próprio piloto. O artigo não avalia perguntas sem resposta.
- **Contexto para H1 e o teste de vazamento:** o modelo acertou 11,8% sem a resposta no recuperado e completa nomes só com conhecimento paramétrico. Isso apoia a exigência do plano de que o A0 fique perto do acaso, mas com opções fechadas o conhecimento prévio genérico pode bastar para acertar acima do acaso (inferência minha).
- **Controle de colapso:** o Apêndice H alerta que, quando a tarefa não exige o fato, o gerador ignora os documentos. Em H8 (N1), um resultado de N1 igual ao A0 e um A3 igual ao A0 podem ser o mesmo fenômeno; olhar a citação do documento correto, que o plano já mede.

## Contradições ou ajustes que o plano.md precisa
1. O plano não fixa k para os braços A3, A4, A5 e A6. Declarar k e testar mais de um valor no piloto, com o orçamento de tokens registrado.
2. O plano trata o BM25 como metade do híbrido sem evidência própria. Registrar a ablação BM25 sozinho, vetor sozinho e híbrido (a literatura desta ficha só mostra que o resultado depende do tipo de consulta).
3. H5 e N2 mudam de natureza se a coleção do A5 tiver o filtro de vigência e a do A4 não: o ganho do A5 virá da regra de metadados, não do raciocínio do modelo. Registrar isso na interpretação.
4. Reservar espaço no plano para a hipótese de que H7 não é apoiada pela literatura lida aqui.
