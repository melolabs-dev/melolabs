---
id: rag2-2307.03172
titulo: "Lost in the Middle: How Language Models Use Long Contexts"
autores: "Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, Percy Liang"
ano: 2023
tipo: academico
url: https://arxiv.org/abs/2307.03172
doi: 10.48550/arXiv.2307.03172
acessado: 2026-11-08
nivel_evidencia: A
vies: "Experimento controlado em três tarefas, com código e dados liberados, versão v3 (20 nov 2023) com agradecimento ao editor do TACL, o que indica versão aceita em periódico (o texto não informa a data da publicação). Apoio de crédito de API da OpenAI e da Anthropic. Modelos de 2023, de contexto de 2K a 16K tokens (Claude-1.3 de 100K), anteriores à geração atual."
verificada: true
---
# Lost in the Middle: How Language Models Use Long Contexts

> tipo: academico. nivel_evidencia: A (experimento controlado: varia só posição e quantidade de documentos, com os mesmos casos, seis modelos mais extras; código e dados liberados). Texto lido por inteiro, incluindo apêndices A a G (Tabelas 5 a 7). Sem repetições estatísticas reportadas (intervalos de confiança: não consta).

## Resumo
Os autores medem como modelos de linguagem usam informação em contextos longos mudando a posição do documento que contém a resposta. Em perguntas e respostas sobre vários documentos e numa tarefa sintética de recuperar um valor por chave, o desempenho é mais alto quando a informação relevante está no começo ou no fim do contexto e cai quando está no meio, formando uma curva em U. Contextos estendidos não melhoram a robustez, colocar a pergunta antes e depois dos dados resolve a tarefa sintética mas quase não ajuda nas perguntas e respostas, e, num estudo de caso com recuperador mais leitor, o desempenho do modelo satura muito antes do recall do recuperador.

## Método
**Tarefa 1: perguntas e respostas com vários documentos (Seção 2.1).**
- Dados: 2.655 perguntas do NaturalQuestions-Open cuja resposta longa anotada é um parágrafo. Documentos: trechos da Wikipédia de no máximo 100 tokens; um documento contém a resposta e os outros k−1 são distratores.
- Distratores: os k−1 trechos mais relevantes segundo o Contriever (ajustado no MS-MARCO) que não contêm a resposta anotada, apresentados em ordem decrescente de relevância. Apêndice B: com distratores aleatórios a precisão sobe, mas a curva em U continua. Apêndice C: com ordem aleatória dos distratores e aviso no prompt, a curva em U continua.
- Variações: k = 10, 20 e 30 documentos (cerca de 2K, 4K e 6K tokens) e posição da resposta (índice 0 até k−1).
- Prompt (Figura 2): "responda usando apenas os resultados de busca fornecidos (alguns podem ser irrelevantes)". Decodificação gulosa. Métrica: acerto se alguma resposta correta anotada aparece na saída.
- Linhas de base: livro fechado (sem documentos) e oráculo (só o documento com a resposta), Tabela 1.

**Tarefa 2: recuperação de chave e valor sintética (Seção 3).** Objeto JSON com 75, 140 ou 300 pares de UUIDs (cerca de 4K, 8K e 16K tokens), 500 exemplos por configuração, posição da chave variada.

**Modelos (Seção 2.2).** Abertos: MPT-30B-Instruct (8K de contexto) e LongChat-13B (16K). Fechados: GPT-3.5-Turbo (4K) e GPT-3.5-Turbo (16K), Claude-1.3 (8K) e Claude-1.3 (100K). Extras: Flan-T5-XXL e Flan-UL2 (Seção 4.1); MPT-30B base (4.3); GPT-4 (8K) em 500 exemplos com 20 documentos (Apêndice D, custo estimado de 6.000 dólares para o experimento completo, nota 6); Llama-2 de 7B, 13B e 70B com e sem ajuste (Apêndice E; 20 exemplos acima de 4.096 tokens descartados).

**Estudo de caso (Seção 5).** Recuperador (Contriever) mais leitor sobre a Wikipédia, com o mesmo subconjunto do NaturalQuestions-Open, medindo recall do recuperador e precisão do leitor em função do número de documentos recuperados (até 50).

**Parâmetros.** Temperatura: não consta além de "decodificação gulosa". Tamanho de chunk: 100 tokens. Número de execuções por caso: não consta (uma, dada a decodificação gulosa).

## Resultados
**Tabela 1 (Seção 2.3): livro fechado e oráculo.**

| Modelo | Livro fechado | Oráculo |
|---|---|---|
| LongChat-13B (16K) | 35,0% | 83,4% |
| MPT-30B-Instruct | 31,5% | 81,9% |
| GPT-3.5-Turbo | 56,1% | 88,3% |
| GPT-3.5-Turbo (16K) | 56,0% | 88,6% |
| Claude-1.3 | 48,3% | 76,1% |
| Claude-1.3 (100K) | 48,2% | 76,4% |

**Figura 5 e Tabelas 5 a 7 (Apêndice G): precisão por posição da resposta.** Valores da tabela, em %, índices 0 (início) até o último:
- 10 documentos (Tabela 5, índices 0, 4, 9): GPT-3.5-Turbo 76,8, 61,2, 62,4; Claude-1.3 62,9, 58,3, 59,7; MPT-30B-Instruct 60,2, 56,2, 59,7; LongChat 72,1, 58,9, 58,5.
- 20 documentos (Tabela 6, índices 0, 4, 9, 14, 19): GPT-3.5-Turbo 75,8, 57,2, 53,8, 55,4, 63,2; Claude-1.3 59,9, 55,9, 56,8, 57,2, 60,1; MPT-30B-Instruct 53,7, 51,8, 52,2, 52,7, 56,3; LongChat 68,6, 57,4, 55,3, 52,5, 55,0.
- 30 documentos (Tabela 7, índices 0, 4, 9, 14, 19, 24, 29): GPT-3.5-Turbo (16K) 73,4, 55,1, 50,5, 50,9, 51,8, 54,9, 63,7; Claude-1.3 59,1, 55,1, 54,8, 55,7, 56,4, 56,2, 59,9; MPT-30B-Instruct 51,6, 51,3, 51,2, 49,0, 49,6, 51,3, 54,1; LongChat 66,9, 54,8, 52,5, 52,9, 52,2, 51,3, 55,1.
- No pior caso, a precisão do GPT-3.5-Turbo com 20 e 30 documentos fica abaixo do livro fechado (56,1%): 53,8% e 50,5% (Seção 2.3; Tabelas 6 e 7). A queda do melhor para o pior ponto chega a mais de 20 pontos no GPT-3.5-Turbo (texto da Seção 2.3).
- O Claude-1.3 tem a curva mais plana: diferença entre melhor e pior ponto de cerca de 4 pontos com 20 documentos (60,1 contra 55,9), e nunca fica abaixo do livro fechado dele (48,3%). Isto é leitura minha das tabelas, não afirmação do texto.
- Modelos de contexto estendido (16K e 100K) têm desempenho quase idêntico ao do irmão curto quando o prompt cabe nos dois (Seção 2.3, Tabelas 5 a 7).

**Chave e valor (Seção 3.2, Figura 7).** Claude-1.3 e Claude-1.3 (100K) ficam quase perfeitos em todos os tamanhos; os outros degradam, principalmente no meio, em 140 e 300 pares. O LongChat mostra outro padrão em 140 pares (às vezes gera código em vez do valor quando a chave está no início).

**Por que acontece (Seção 4).**
- Arquitetura (4.1, Figura 8): o codificador-decodificador Flan-UL2 é robusto à posição dentro do comprimento de treino (diferença de 1,9 ponto entre melhor e pior caso), e degrada além dele.
- Pergunta antes e depois dos dados (4.2, Figura 9): resolve a tarefa sintética (todos quase perfeitos; GPT-3.5-Turbo 16K perfeito com 300 pares, contra pior caso de 45,6% sem o truque), mas quase não muda a tendência nas perguntas e respostas (sobe um pouco no início, desce um pouco no resto).
- Ajuste por instrução (4.3, Figura 10): o MPT-30B base também tem curva em U; o ajuste reduz a diferença entre melhor e pior de quase 10 pontos para cerca de 4. Apêndice E: só modelos grandes (13B e 70B) mostram curva em U; o Llama-2 de 7B só tem viés de recência.

**Estudo de caso de recuperação (Seção 5, Figura 11).** Com mais de 20 documentos recuperados, a melhora do leitor é marginal: 1,5 ponto no GPT-3.5-Turbo e 1 ponto no Claude-1.3 ao passar de 20 para 50 documentos, enquanto o contexto, a latência e o custo crescem. Os autores sugerem reranqueamento (empurrar o relevante para o início) ou truncar a lista (menos documentos quando cabível).

## Afirmações extraídas (com localização)
- Mudar a posição da informação relevante muda muito o desempenho; curva em U com viés de primazia e de recência. Seção 2.3, Figura 1 e 5.
- Em alguns casos, usar o contexto com a informação no meio é pior que não dar documentos. Seção 1 e 2.3.
- Modelos com contexto estendido não usam o contexto melhor que seus equivalentes curtos. Seção 2.3.
- Mesmo modelos sem ajuste por instrução têm a curva em U. Seção 4.3.
- A pergunta antes e depois dos documentos quase não ajuda em perguntas e respostas. Seção 4.2.
- O desempenho do leitor satura antes do recall do recuperador; usar 50 em vez de 20 documentos rende só 1,5 ponto (GPT-3.5) e 1 ponto (Claude-1.3). Seção 1 e 5.
- Para afirmar que um modelo usa bem contexto longo, é preciso mostrar que o desempenho quase não depende da posição da informação. Seção 1.
- Reranqueamento e truncamento da lista recuperada podem melhorar a leitura. Seção 5.
- A curva persiste com distratores aleatórios e com distratores em ordem aleatória. Apêndices B e C.
- GPT-4 (8K) tem desempenho absoluto mais alto, mas ainda mostra a curva em U. Apêndice D.

## Limitações da fonte
**Do autor.** Decodificação gulosa apenas, outras estratégias ficam para trabalho futuro (Seção 2.2). Ambiguidade do NaturalQuestions e descompasso temporal entre a Wikipédia de 2018 e as anotações (Apêndice A; subconjunto sem ambiguidade dá resultado parecido). GPT-4 só em subconjunto por custo. Análises de causa (arquitetura, pergunta antes e depois, ajuste por instrução) são "investigações preliminares" (Seção 4).

**Minhas.**
1. Modelos de 2023; nenhum é da família atual (Haiku ou Sonnet 5.5). A magnitude e até a existência da curva em U nos modelos de 2026 não é testada aqui. O próprio artigo mostra que o Claude-1.3 é bem mais plano que o GPT-3.5.
2. Contextos de 2K a 6K tokens (16K na tarefa sintética). Um lake colado por inteiro no estudo 2 pode ser maior ou menor; o tamanho do lake em tokens não está no plano.
3. Tarefa de extração de fato de um documento (Wikipédia), com um único documento relevante, em inglês. Decisões de projeto exigem às vezes combinar vários documentos e ponderar vigência; o artigo não cobre isso.
4. Sem repetição, sem intervalo de confiança nem teste de significância; com 2.655 perguntas, as diferenças de vários pontos são provavelmente reais, mas diferenças de 1 ou 2 pontos (por exemplo no estudo de caso) não são interpretáveis.
5. Métrica de acerto por presença da resposta no texto gerado, não por correção exata ou citação.

## O que importa para o estudo 2
**Copiar do método.**
- Controlar e registrar a posição do documento-ouro no prompt. No A2 (lake inteiro colado) e nos braços de RAG, anotar em que posição (índice, e início, meio ou fim) caiu cada documento-ouro, para poder separar efeito de posição de efeito de recuperação.
- Incluir variações de ordem: rodar o A2 com a ordem do lake embaralhada (semente fixa) e ao menos duas ordens, para ver se o resultado depende da posição. Rodada extra barata (cem perguntas, poucas chamadas).
- Linhas de base de livro fechado e oráculo, que o plano já tem como A0 e A1, são exatamente a Tabela 1 do artigo; a lição é que o pior caso do contexto longo pode ficar abaixo do livro fechado, o que o A0 mede.
- Pergunta antes e depois do contexto no prompt é uma alteração grátis, com efeito pequeno em perguntas e respostas. Fixar um formato de prompt e usar o mesmo em todos os braços.
- Limitar k: o estudo de caso mostra retorno marginal depois de cerca de 20 documentos; o plano deve fixar k (por exemplo 5, 10 e 20) e reportar a curva em vez de um único k.
- Reranqueamento põe o relevante no começo, o que é um efeito de posição e não só de relevância. Ao comparar A4 com A3, parte do ganho pode ser reordenação; registrar a posição final do documento-ouro depois do reranqueamento.

**Braços e hipóteses.**
- H6 (colar tudo fica abaixo do melhor RAG ou empata com custo maior): é a hipótese que este artigo mais sustenta, com a ressalva dos modelos antigos. Contradição possível: o Claude-1.3 foi quase imune em chave e valor; se o Haiku 5.5 também for, o A2 pode empatar ou ganhar do RAG. A hipótese está bem formulada (refutada se o A2 ficar acima com custo menor).
- H8/N1 (texto irrelevante do mesmo tamanho): o Apêndice B mostra que distratores aleatórios elevam a precisão absoluta mas mantêm a curva; apoia a ideia de que tamanho e posição importam, e justifica controlar o comprimento.
- H4 (híbrido e reranqueamento melhoram sobre o RAG ingênuo): o estudo de caso e a sugestão de reranqueamento apoiam a direção, mas não medem reranqueamento.
- H1, H2, H3, H5, H7, H9: não cobertas.

## Contradições ou ajustes que o plano.md precisa
1. A frase "Um lake pequeno cabe inteiro no prompt, então 'colar tudo' é um braço honesto" está correta como justificativa do braço, mas a leitura do artigo pede mais: a degradação aparece já em 2K a 6K tokens (o artigo vai de 2K a 6K nas perguntas e respostas), então "caber" não significa "ser usado bem". Registrar o tamanho do lake em tokens e a posição do documento-ouro no A2.
2. O plano não fixa a ordem dos documentos no A2 nem a posição dos chunks no prompt dos braços A3 a A6. Fixar, registrar e, no A2, embaralhar com semente.
3. Citar a limitação: o artigo testou modelos de 2023 e não o Haiku; não escrever "o Haiku sofre da curva em U" sem medir. O plano pode tratar como hipótese a testar com o próprio A2 (posição do ouro no começo, meio ou fim), o que não custa chamadas extras relevantes.
4. O plano diz "Contexto longo e mal posicionado degrada (Liu et al., 2307.03172)". Fiel ao artigo, mas acrescentar que o Claude-1.3 degradou pouco nas perguntas e respostas e quase nada em chave e valor, para não superestimar o efeito.
5. O plano não define k nem o número de documentos recuperados; este artigo mostra ganho marginal depois de 20 documentos, em modelos de 2023. Definir k antes do piloto.
