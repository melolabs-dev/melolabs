---
id: rag2-2401.14887
titulo: "The Power of Noise: Redefining Retrieval for RAG Systems"
autores: "Florin Cuconasu, Giovanni Trappolini, Federico Siciliano, Simone Filice, Cesare Campagnano, Yoelle Maarek, Nicola Tonellotto, Fabrizio Silvestri"
ano: 2024
tipo: academico
url: https://arxiv.org/abs/2401.14887
doi: 10.48550/arXiv.2401.14887
acessado: 2026-11-08
nivel_evidencia: B
vies: "Experimento controlado com código e dados abertos e teste estatístico pareado (Wilcoxon), mas com execução única e gulosa, só modelos de 7B ou menos quantizados em 4 bits, tarefa de perguntas factuais curtas sobre a Wikipedia, sem replicação independente. Evidência indireta para o Haiku em decisões de projeto. Os autores propõem as heurísticas que o estudo apoia (viés de confirmação possível)."
verificada: true
---
# The Power of Noise: Redefining Retrieval for RAG Systems

> tipo: academico. nivel_evidencia: B (método e dados abertos; não A porque é execução única, sem variância reportada e com modelos pequenos). Publicado no SIGIR '24 (DOI ACM 10.1145/3626772.3657834, constante no próprio PDF). Versão lida: arXiv v4, 1 mai 2024. O texto extraído não preserva a paginação; a localização abaixo usa seção, tabela e figura.

## Resumo
O artigo estuda que tipo de documento o recuperador deve colocar no prompt de um RAG. Separa quatro tipos: ouro, relevante, distrator e aleatório, e varia o tipo, o número e a posição dos documentos em quatro LLMs pequenos. Achados: (1) documentos parecidos com a pergunta que não contêm a resposta derrubam a acurácia, e quanto mais, pior; (2) a evidência certa perto da pergunta funciona melhor, no meio funciona pior; (3) documentos aleatórios, sem relação com a pergunta, não atrapalham e, quando colocados longe da pergunta com a evidência encostada nela, às vezes ajudam. O ganho vem sobretudo quando já existe algum documento relevante no contexto. Os autores não têm explicação comprovada para (3).

## Método
- **Tarefa e dados (Seção 4.1):** Natural Questions open (NQ-open). Corpus: dump da Wikipedia em inglês de 20/12/2018, em passagens de 100 palavras sem sobreposição, mais os documentos-ouro do NQ; 21.035.236 passagens. Há 72.209 consultas de treino e 2.889 de teste. Os experimentos de oráculo (Seções 5.1 a 5.3) usam 10 mil consultas do treino; os de "RAG na prática" (5.4) usam o conjunto de teste.
- **Definições (Seção 4.2, introdução):**
  - Ouro: a passagem original do NQ que contém a resposta.
  - Relevante: passagem que contém a resposta e é útil; o ouro é um relevante. A introdução dá uma definição mais frouxa (responde ou "poderia informar"); a Seção 4.2 usa "contém a resposta".
  - Distrator: semanticamente parecido com a consulta, mas sem a resposta. Na prática são os de maior pontuação no recuperador que não contêm a resposta. O texto não detalha como a ausência da resposta é verificada além de "não contém"; a Seção 5.4.1 admite que a checagem por presença da string da resposta é um indicador imperfeito.
  - Aleatório: sem relação com a consulta, amostrado ao acaso do próprio corpus (Wikipedia). Variantes na Seção 5.4.2: aleatórios de outro corpus (Reddit Webis-TLDR-17) e frases sem sentido de palavras aleatórias.
  - Exemplo do artigo (Figura 1 a 4): pergunta sobre quem era dono da Millennium Falcon antes de Han Solo; distrator é um trecho sobre o mesmo tema que não traz a resposta.
- **Recuperadores (4.3, 5.4.1):** Contriever (denso, padrão) com índice FAISS IndexFlatIP; BM25 na replicação esparsa; ADORE (treinado com negativos difíceis) apenas para escolher distratores na Seção 5.1.
- **Prompt (4.4, Figura 1):** instrução no início, documentos no meio, pergunta no fim. Instrução manda extrair a resposta (máx. 5 tokens) de um dos documentos e responder NO-RES se nenhum contiver a resposta. Sem exemplos (zero-shot).
- **Posição (5.2):** Near = ouro encostado na pergunta; Mid = no meio do contexto; Far = o mais longe possível da pergunta.
- **Modelos (4.5):** Llama2-7B (contexto de 4096 tokens), Falcon-7B (2048), Phi-2 (2,7B, 2048), MPT-7B (limitado a 2048). Só versões instruct reportadas. Quantização em 4 bits. Geração gulosa, resposta de até 15 tokens. Uma execução por condição (não consta repetição, semente ou temperatura além de "gulosa").
- **Número de documentos:** distratores e aleatórios de 0 a 18 (até 8 nos modelos de 2048 tokens; maiores contagens só no Llama2, porque o contexto estoura). Documentos recuperados (k) de 1 a 10 nas Tabelas 3 a 5, com aleatórios preenchendo até o limite do contexto.
- **Métrica (4.6):** acerto binário se alguma resposta aceita aparece contida na saída do modelo. Os autores reconhecem que isso erra variações ("Roosevelt" contra "President Roosevelt"). Significância: Wilcoxon, p < 0,01 (p < 0,05 na Tabela 5). Não consta como a resposta NO-RES é pontuada.

## Resultados
Todos os números abaixo são acurácia (0 a 1), lidos das tabelas indicadas.
- **Linha de base sem recuperação (legenda das Tabelas 1 e 2):** Llama2 0,1123; MPT 0,1205; Phi-2 0,0488; Falcon 0,1083. Só o ouro (linha 0 das Tabelas 1 e 2): Llama2 0,5642; MPT 0,2148; Phi-2 0,4438; Falcon 0,4330.
- **Distratores (Seção 5.1, Tabela 1):**
  - Um distrator já derruba a acurácia. Llama2 com ouro e 1 distrator: 0,4586 (Far) e 0,4283 (Near), contra 0,5642 só com o ouro.
  - Degradação cresce com a quantidade: Llama2 Far 0,2745 com 4 distratores e 0,2348 com 18; Mid 0,1795 com 18, queda de cerca de 0,38 (68%) sobre a linha de base.
  - Near sofre menos e estabiliza: Llama2 0,3795 com 4 distratores, 0,3781 com 18.
  - Com ADORE como fonte dos distratores, Llama2 fica em 0,4068, 0,3815 e 0,3626 para 1, 2 e 4 distratores, pior que com Contriever; o recuperador melhor não resolve o problema.
  - O texto da Seção 5.1 cita "0,24 (-25%)" para a queda com um só distrator; nenhuma célula da Tabela 1 mostra queda absoluta de 0,24 (a maior com 1 distrator é cerca de 0,14, ou 24% relativos no Llama2 Near). Provável confusão do texto entre queda relativa e absoluta; usar a tabela.
- **Posição (5.2):** Near melhor, Far intermediário, Mid pior. Llama2 com 18 distratores: 0,37 (Near), 0,23 (Far), 0,17 (Mid) no texto; a tabela mostra 0,3781, 0,2348 e 0,1795. Falcon e Llama2 nem sempre mostram o efeito "perdido no meio" (5.3).
- **Aleatórios com o ouro (5.3, Tabela 2):**
  - Near, Llama2: 0,4862 (1), 0,5032 (2), 0,5221 (4), 0,5681 (6), 0,5609 (8), 0,5859 (14), 0,5588 (18), contra 0,5642 só com o ouro. O ganho do Llama2 sobre o ouro isolado é pequeno (no máximo cerca de 0,02) e várias células não são significativas (marcadas com asterisco).
  - MPT melhora em todas as posições (Near, 4 aleatórios: 0,2930, +0,08 ou +36% sobre 0,2148). Phi-2 ganha pouco no Near (0,4614 com 2). Falcon não melhora.
  - Far e Mid: quedas, bem menores que as dos distratores. Llama2 com 18 aleatórios: Far 0,3466; Mid 0,2982. Ou seja, aleatório mal posicionado também machuca, só menos.
  - Comparação direta com a Tabela 1: Llama2 Near com 8 aleatórios 0,5609 contra 0,3748 com 8 distratores.
- **RAG na prática (5.4, Tabela 3, Llama2, conjunto de teste):**
  - Recuperados sem aleatórios (linha 0): Contriever 0,1620 a 0,2198 para k de 1 a 8; BM25 0,2008 a 0,2492. Acurácia de topo-k do recuperador (top-k contém a resposta): BM25 0,2966, 0,4105, 0,5237, 0,6663 para k = 1, 2, 4, 10; Contriever 0,2502, 0,3569, 0,4784, 0,6085.
  - Acrescentar aleatórios até encher o contexto quase sempre ajuda: com Contriever e k = 4, de 0,1866 para 0,2530 com 15 aleatórios (+0,07, +35%), que é o "até 35%" do resumo. Para BM25 o ganho médio é de 3 a 4 pontos percentuais.
  - Tabela 4: aleatórios do Reddit rendem ainda mais (máximo 0,2769 com k = 8 e 5 aleatórios, cerca de +0,023 sobre o melhor da Wikipedia). Frases de palavras aleatórias também ajudam, com muitas células não significativas.
  - Tabela 5 (Falcon, aleatórios do Reddit): ganhos pequenos e quase todos sem significância ou marginais (por exemplo k = 5: 0,1942 para 0,2118).
- **Compromisso (5.5):** melhor resultado com poucos documentos recuperados (3 a 5 nas consultas estudadas) mais aleatórios até o limite; recuperar demais traz distratores e derruba.
- **Mecanismo (5.5, final):** a entropia da atenção triplica quando entram aleatórios; os autores dizem que não conseguem afirmar a causa. Sem tabela.

## Afirmações extraídas com localização
- Documento parecido que não contém a resposta piora o resultado e a piora cresce com a quantidade: Seção 5.1, Tabela 1.
- Um único distrator já causa queda grande (Llama2 Near de 0,5642 para 0,4283): Seção 5.1, Tabela 1.
- Trocar o recuperador denso por um mais forte (ADORE) não alivia: Seção 5.1.
- Evidência perto da pergunta é melhor que longe ou no meio: Seção 5.2.
- Aleatórios não degradam quando a evidência fica perto da pergunta e, em alguns modelos, melhoram: Seção 5.3, Tabela 2 (efeito varia por modelo; Falcon não melhora no oráculo).
- Em RAG realista, preencher o contexto com aleatórios melhora a acurácia do Llama2 em até 35% relativos: Seção 5.4, Tabela 3.
- O resultado se repete com BM25 e com aleatórios de outro corpus ou de palavras sem sentido: Seções 5.4.1 e 5.4.2, Tabelas 3 e 4.
- É preciso existir algum conteúdo relevante no contexto para o ganho existir; recuperar muitos documentos piora: Seção 5.5.
- Atenção com mais entropia quando há aleatórios; causa não estabelecida: Seção 5.5.
- O código e os dados estão abertos (github.com/florin-git/The-Power-of-Noise): nota de rodapé 1 da primeira página.

## Limitações da fonte
- **Dos autores:** a métrica de contenção da resposta subestima respostas corretas com outra redação (4.6); a checagem de relevância por presença da resposta no texto pode errar (5.4.1); a explicação do ganho dos aleatórios é incompleta e fica para trabalho futuro (5.5); exemplos few-shot ficaram fora do escopo (4.5).
- **Minhas:**
  - Só modelos de 7B ou menos, quantizados em 4 bits, com janela de 2 a 4 mil tokens. Nada garante que o efeito vale para um modelo como o Haiku, que tem janela muito maior e melhor seguimento de instrução. O artigo não testa modelos comerciais.
  - Perguntas factuais de resposta curta sobre a Wikipedia, não escolha entre opções fechadas nem decisão de projeto.
  - Uma execução gulosa por condição; não consta repetição nem intervalo de confiança, só Wilcoxon por consulta.
  - O ganho dos aleatórios é muito dependente do modelo e da base: no oráculo o Llama2 ganha pouco, o Falcon não ganha, e o "35%" é relativo a uma base baixa (acurácia de 0,19). Em pontos absolutos é cerca de 7 pontos percentuais.
  - A tarefa tem o NO-RES como opção, mas o artigo não reporta taxa de abstenção nem como foi pontuada.
  - O texto extraído perdeu os símbolos que indicam a ordem dos blocos em alguns esquemas (por exemplo na Seção 5.4). A ordem exata de [aleatórios, recuperados] na Seção 5.4 é inferida do texto ("mais longe da pergunta"), não lida de forma direta.
  - Tabelas 1 a 5 vieram da extração de texto com colunas fora de ordem em alguns pontos (Falcon, Phi-2 e MPT nas colunas vazias); os números citados acima foram conferidos com os valores citados no corpo do texto.

## O que importa para o estudo 2
- **Controle N2 (documentos parecidos e errados):** é o controle mais bem apoiado. A fonte mostra que distratores pioram o resultado mais que aleatórios, e a queda começa já com um distrator. Mas a definição da fonte de distrator é "parecido e sem a resposta", não "contém uma resposta que contradiz". Uma decisão antiga e substituída tem uma resposta conflitante, o que tende a ser mais forte que o distrator do artigo. Sugestão: se couber, separar N2 em dois níveis (parecido sem resposta, e substituído com resposta conflitante); senão, nomear N2 corretamente como "conflito de vigência".
- **Controle N1 (texto irrelevante):** o plano define N1 como o A3 com texto irrelevante do mesmo tamanho e compara com o A0 (H8). O artigo não testa isso. Ele testa aleatório somado a evidência já presente, e diz que é preciso algum conteúdo relevante para haver ganho. Então a previsão da fonte é que texto irrelevante sozinho não ajude (compatível com H8), mas o efeito "ruído ajuda" aparece quando a evidência está junto. Isso é um risco para a leitura de A3 contra A4 e A2: parte de uma diferença pode ser efeito de preenchimento. Sugestão: acrescentar um controle N1b (A1, o oráculo, com texto irrelevante somado, longe da pergunta) para medir o efeito de preenchimento onde a fonte o observou.
- **Posição:** o artigo mostra que a posição pesa mais que o tipo para o Llama2 (Far e Mid ruins). O plano não fixa a ordem dos blocos no prompt. Fixar e registrar: pergunta no fim, evidência mais forte perto da pergunta, texto de preenchimento antes da evidência; em A2 (lake inteiro colado) a ordem arbitrária dos documentos é uma variável e deve ser sorteada e registrada, ou repetida em permutações.
- **Quantidade (k):** a fonte aponta que poucos documentos (3 a 5) com recall alto são melhores que muitos; apoia testar k pequeno em A3 a A6 e registrar recall@k por k. Não apoia nenhuma escolha específica para Haiku.
- **Hipóteses:** apoia H8 (N2 piora o A1) em direção, sem garantir a margem de 10 pontos para um modelo forte; H6 (colar tudo perde) é coerente com a degradação por distratores, mas o Haiku pode ser mais robusto que um 7B. H4 (recuperação melhor melhora) tem apoio parcial: o artigo mostra que BM25 e denso diferem pouco em acurácia final.
- **Copiar do método:** separar tipos de documento pela relação com a resposta; testar a posição; reportar acerto com teste pareado; ter linha de base sem contexto (closed-book) para provar que a pergunta exige o contexto, como o A0.

## Contradições ou ajustes que o plano.md precisa
1. O plano cita Cuconasu para "documento parecido e errado atrapalha mais que ruído aleatório"; está correto, mas deve acrescentar que o mesmo artigo reporta que aleatório pode melhorar a acurácia. Isso muda a leitura de N1: o texto atual de H8 só considera o caso em que N1 "não melhora" e trata melhora acima de 10 pontos como erro de medição. Pela fonte, uma melhora pode ser um efeito real de preenchimento, não necessariamente erro; ajustar o enunciado e o critério de refutação.
2. N1 precisa dizer onde o texto irrelevante entra (posição) e de que corpus vem (do próprio lake ou de fora). A fonte mostra que a posição inverte o sinal e que aleatório de fora do corpus funciona ao menos tão bem quanto o de dentro.
3. Fixar a ordem dos blocos no prompt e a regra de posição (ver acima), inclusive para A2.
4. O plano diz que N2 é o controle da armadilha de vigência, mas o distrator da fonte não tem resposta conflitante; deixar claro que N2 mede algo mais forte que o do artigo, para não citar a fonte como previsão do tamanho do efeito.
5. A margem de 10 pp em H8 para N2 não tem base direta na fonte para o Haiku; manter como margem de partida a calibrar no piloto.
