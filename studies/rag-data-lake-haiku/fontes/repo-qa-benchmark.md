---
id: rag2-2603.26567
titulo: "Beyond Code Snippets: Benchmarking LLMs on Repository-Level Question Answering"
autores: "Yoseph Berhanu Alebachew, Hunter Leary, Swanand Vaishampayan, Chris Brown (Virginia Tech)"
ano: 2026
tipo: academico
url: https://arxiv.org/abs/2603.26567
doi: 10.48550/arXiv.2603.26567
acessado: 2026-11-08
nivel_evidencia: B
vies: "Artigo de dados em workshop (PROMISE 2026, junto do FSE 2026; DOI ACM 10.1145/3803846.3807467). Pacote de replicação no Zenodo (10.5281/zenodo.18276514). Duas LLMs de 2024 (Claude 3.5 Sonnet e GPT-4o), juiz também LLM, gabarito é a resposta aceita no Stack Overflow (provável memorização). Texto declara que IA ajudou a revisar parágrafos."
verificada: true
---
# Beyond Code Snippets: Benchmarking LLMs on Repository-Level Question Answering

> tipo: academico. nivel_evidencia: B (método descrito, dados e pacote de replicação abertos, amostra por análise de poder; mas juiz LLM e gabarito de qualidade incerta). Leitura integral do texto extraído, seções 1 a 7 e referências. A Tabela 4 saiu em ordem incerta na extração; o que uso dela está conferido contra o texto.

## Resumo
Os autores criam o StackRepoQA: 1.318 perguntas reais do Stack Overflow, com resposta aceita, mapeadas para 134 projetos Java do GitHub. Avaliam Claude 3.5 Sonnet e GPT-4o sem ferramentas e num sistema multiagente com RAG por arquivo (vetorial) e RAG por grafo (Neo4j). Achados: acurácia moderada sem aumento; boa parte do sucesso vem de memorização do Stack Overflow (queda forte em perguntas posteriores à data de corte do modelo e respostas quase literais); com a recuperação, o grafo supera o RAG por arquivo, mas, quando se manda o modelo ignorar o que sabe, o sistema fica abaixo do modelo sem ferramentas.

## Método
- **Dados (seção 3.1):** repositórios Java com pelo menos 20 contribuidores, 10 estrelas, 1.000 commits, 10 MB e commit nos últimos 12 meses (coleta em 09/06/2025) resultam em 420 repositórios. Busca por palavra-chave do nome do repositório no dump do Stack Overflow (até 03/04/2025) dá 233.175 perguntas candidatas; 7 a 10 perguntas por repositório (só com resposta aceita), mínimo de 7 por projeto: 1.318 perguntas em 134 repositórios. Um desenvolvedor sênior marcou 249 perguntas como não relacionadas ao repositório (mantidas como casos de controle); duas pessoas revisaram 20% e relatam concordância perfeita.
- **Amostra avaliada (seção 3.2):** 482 perguntas de 49 repositórios, definidas por análise de poder.
- **Modelos:** Claude 3.5 Sonnet (junho de 2024) e GPT-4o (maio de 2024), com parâmetros de inferência padrão (temperatura não consta). A ablação usa só o Claude.
- **Estratégias comparadas:** (1) LLM só, sem ferramentas; (2) RAG por arquivo, recuperação densa com ChromaDB e embeddings all-mpnet-base-v2, similaridade de cosseno, top-k = 5; (3) RAG por grafo, em que o agente gera consultas Cypher sobre um grafo Neo4j do AST e das dependências (CALLS, CONTAINS, EXTENDS, USES); (4) arquivo mais grafo. Os agentes (AutoGen 0.9.6): supervisor, sumarizador e os dois de recuperação, com até 3 rodadas de recuperação cada. Ablação (Tabela 3): só arquivo, só grafo, todos sem o conhecimento interno do modelo (instrução para ignorá-lo) e todos com conhecimento interno. Não há BM25, busca híbrida, reranqueamento, nem colar o repositório inteiro (o artigo só cita a literatura sobre contexto longo).
- **Avaliação (seção 3.3):** juiz LLM com nota de 1 a 10 (correção, completude, fidelidade e concisão) em relação à resposta aceita; fora da ablação, cada resposta é julgada por duas LLMs para reduzir viés de autopreferência. Validação humana: 2 engenheiros em 30 respostas, kappa ponderado 0,78 entre os humanos, 0,77 e 0,87 entre o juiz e cada humano; ICC(2,1) = 0,82 e ICC(2,k) = 0,93. Testes pareados de Wilcoxon, modelo misto, delta de Cliff (a seção 3.2 cita 0,396 como efeito observado, o que é estranho para um parâmetro de planejamento). Chunking: não consta. Número de execuções por pergunta: não consta (aparentemente 1). Métricas de recuperação (recall@k etc.): não consta.

## Resultados
- **RQ1, sem aumento (Tabela 2, seção 4.1):** média geral 6,94 (GPT-4o) e 6,67 (Claude), em escala de 1 a 10. Autoavaliação: GPT 7,08 e Claude 5,88. Avaliação cruzada: GPT julgando Claude 7,21; Claude julgando GPT 6,77. Médias por tipo: perguntas relacionadas ao projeto 6,73 e não relacionadas 7,27 (diferença não significativa; o texto cita isso como indício de memorização).
- **Data de corte (seção 4.1):** Claude cai de 6,59 para 5,44 (p = 0,0009) e GPT-4o de 6,97 para 5,97 (p = 0,0024) após o corte (20/04/2024 e 01/06/2024).
- **RQ2, aumento (seção 4.2, Tabela 3, só Claude):** só agente de arquivo 5,66 (relacionadas) e 5,46 (não relacionadas); só agente de grafo 6,12 e 5,49; todos sem conhecimento interno 6,11 e 5,60; todos com conhecimento interno 6,95 e 5,43. Grafo contra arquivo: 6,12 contra 5,66 (p < 0,0002). Com todos os agentes sem conhecimento interno, o desempenho (6,11) fica abaixo do modelo sem fontes (acima de 6,5 para as relacionadas nas Tabelas 2 e 3 do texto).
- **Antes e depois do corte, com recuperação (seção 4.2):** antes 6,59 para 7,00; depois 5,44 para 5,68.
- **Multiagente por modelo (Tabela 4, texto):** média nas relacionadas 6,07; as relacionadas são 6,45 e 7,45 para o Claude (juízes Claude e GPT) e 4,78 e 5,61 para o GPT-4o, se a leitura da tabela extraída estiver certa. O GPT-4o rende bem menos que o Claude no sistema com grafo (seção 5.2).
- **Ruído (seções 4.2 e 5.4):** a recuperação em perguntas não relacionadas reduziu o desempenho ou melhorou pouco, o que os autores atribuem ao "efeito de distração".
- **Memorização (seção 5.3):** exemplos de respostas quase idênticas às aceitas (Debezium, JUnit4, Ebean, OpenRouteService, WireMock), com os IDs de pergunta citados.
- **Características do repositório (seção 4.1):** correlações de Spearman pequenas (tamanho entre -0,24 e -0,07; estrelas e forks abaixo de 0,22 em módulo).

## Afirmações extraídas (com localização)
- O desempenho sem aumento é moderado e parte vem de memorização, com queda significativa após a data de corte: seção 4.1, resposta-chave RQ1.
- O grafo supera o RAG por arquivo, e o agente de grafo responde pela maior parte do ganho: seção 4.2, Tabela 3, seção 5.2.
- Retrieval sem o conhecimento do modelo fica abaixo do modelo sozinho; os autores leem isso como prova de memorização: seção 4.2 e 5.1. Leitura alternativa minha: o RAG recuperou mal.
- Fornecer o repositório inteiro não é eficaz e pode degradar o desempenho: seção 1 e 2, citando o LongCodeBench (afirmação de terceiros, não testada aqui).
- Contexto irrelevante prejudica a resposta; sugerem portões de decisão adaptativos (por exemplo o Context Awareness Gate): seção 5.4.
- O desempenho depende do tipo de pergunta (API e conceito bem; configuração, integração e consulta mal), sem análise formal: seção 5.5.
- Os autores recomendam avaliações com corte temporal e repositórios não vistos: seção 5.3.
- O texto do resumo e da introdução fala em "cerca de 58%" no baseline e "cerca de 64%" na melhor configuração: introdução. A métrica real é nota de 1 a 10; a conversão não é explicada (não consta).

## Limitações da fonte
- **Dos autores (seção 6):** só Java; Stack Overflow pode não representar ambientes industriais ou privados; poucas estratégias de aumento (arquivo e grafo), sem fine-tuning; resposta aceita como proxy de correção; juiz LLM com possível viés e conformidade imperfeita com a instrução de ignorar o conhecimento interno; mapeamento por palavra-chave com falsos positivos (249 marcados); 7 perguntas por projeto; só duas LLMs de 2024.
- **Minhas:** (1) a variável principal, "ignorar o conhecimento interno", é uma instrução de prompt cuja obediência não foi medida; a queda pode ser mistura de pior recuperação e de menor liberdade do modelo. (2) A escala de 1 a 10 por juiz LLM em respostas abertas não equivale a acerto contra um gabarito fechado, e a autoavaliação do Claude (5,88) difere muito da avaliação do GPT sobre o Claude (7,21), o que indica forte dependência do juiz. (3) A Tabela 3 não diz qual juiz foi usado na ablação (o texto só diz que não houve dois juízes). (4) Inconsistência numérica: o texto cita 5,43 como média das perguntas não relacionadas do sistema completo, e esse é o valor da Tabela 3 só para o Claude; com os quatro valores da Tabela 4 (extraídos), a média das não relacionadas é de cerca de 5,19. (5) O top-k fixo em 5 não foi variado, a comparação "arquivo contra grafo" também troca o mecanismo (embedding contra consulta Cypher gerada por LLM), e o grafo é construído por AST do código, sem equivalente em documentos de decisão. (6) Sem repetições; sem métrica de recuperação separada da qualidade da resposta.

## O que importa para o estudo 2
- **Apoia a necessidade do teste de vazamento do A0 (H1):** quando o conhecimento já estava nos pesos, o desempenho foi alto sem fonte e despencou depois da data de corte. Isso reforça que as perguntas do estudo 2 precisam depender de fatos que só existem no projeto, e que o A0 deve ficar perto do acaso. Também reforça usar o h3 como corpus (fatos privados e recentes, dentro do que o Haiku 5.5 não viu) e registrar a data de corte do Haiku contra as datas das decisões do lake.
- **Apoia o controle N1 e as perguntas "sem resposta" (H7, H8):** a recuperação em perguntas sem relação com o projeto piorou ou pouco ajudou (seções 4.2 e 5.4), que é o efeito de distração. Os autores sugerem gates adaptativos, que é exatamente o A6. A direção do efeito nesse estudo é um sinal, não uma evidência forte (ver limitações 2 e 4).
- **Não responde a H4 (híbrido contra vetorial ingênuo):** o único contraste é arquivo (vetorial, k = 5) contra grafo. Nada de BM25, híbrido ou reranqueamento. O grafo no código não traduz para o lake de documentos; o equivalente seria usar metadados e links `supersedes` (A5), que é um tipo de estrutura, e o resultado "estrutura vence texto plano" é consistente com H5, mas é um paralelo indireto.
- **Colar tudo (H6):** o artigo não testa; só cita literatura de terceiros. Não conta como evidência.
- **Copiar do método:** análise de poder para dimensionar a amostra (o plano já faz esse raciocínio); testes pareados com delta de Cliff ou equivalente; modelo misto com efeitos aleatórios por pergunta; validação do juiz com dois humanos e kappa em 30 respostas (o estudo 2 usa gabarito fechado, então não precisa de juiz, mas a mesma checagem vale para qualquer juiz usado na citação de documento); registrar o corte temporal; pacote de replicação com saídas de todas as execuções.
- **Evitar:** usar instrução de prompt "ignore o que você sabe" como controle sem medir a obediência; o plano usa N1 e A0, que não dependem disso.

## Contradições ou ajustes que o plano.md precisa
1. O plano cita Gupta et al. para "contexto importa mais que tamanho do modelo"; esta fonte acrescenta o contrapeso de que RAG com o modelo proibido de usar o próprio conhecimento ficou abaixo do modelo sem fontes. Vale mencionar a memorização como explicação alternativa na seção de hipótese nula, ao lado do achado de Gupta e de Buskila.
2. `fontes/leitura.md` diz que o grafo "só chegou a cerca de 64%". Isso copia a frase da introdução, mas a métrica real é nota de 1 a 10 de um juiz LLM e a conversão para porcentagem não consta; reescrever como "melhor configuração em torno de 6,1 a 6,95 de 10" ou citar a frase como dos autores, com a ressalva.
3. Registrar no protocolo a data de corte do Haiku 5.5 e a data de cada documento-ouro, para separar memorização de recuperação (análise pós-hoc simples).
4. Pergunta aberta para o piloto: a queda por distração aparece no estudo 2 quando o top-k traz decisões substituídas? O N2 já mede isso; manter H8 como previsto.
