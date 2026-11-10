---
id: rag2-2603.29875
titulo: "UnWeaving the knots of GraphRAG - turns out VectorRAG is almost enough"
autores: "Ryszard Tuora, Mateusz Galinski, Michal T. Godziszewski, Michal Karpowicz, Mateusz Czyznikiewicz, Adam Kozakiewicz, Tomasz Zietkiewicz"
ano: 2026
tipo: academico
url: https://arxiv.org/abs/2603.29875
doi: 10.48550/arXiv.2603.29875
acessado: 2026-11-08
nivel_evidencia: C
vies: "Autores (Samsung AI Warsaw) propõem o método UnWeaver e comparam com concorrentes, o que cria interesse em mostrar o método bem. O modelo gerador e o juiz são o mesmo (GPT-OSS-120B). Experimento curto, sem intervalos entre execuções completas e sem parâmetros de recuperação. Preprint v3 de 08/06/2026."
verificada: true
---
# UnWeaving the knots of GraphRAG - turns out VectorRAG is almost enough

> tipo: academico. nivel_evidencia: C (artigo curto com medição e código, mas com parâmetros ausentes, sem estatística de comparação e com os autores avaliando o próprio método). Texto lido por inteiro, incluindo apêndices A a E. Tabela 1 vem de extração de PDF e saiu embaralhada nas colunas de tokens; só as colunas de FC e de variância foram recuperadas com segurança.

## Resumo
O artigo propõe o UnWeaver, uma variante simplificada de GraphRAG. Um LLM extrai entidades de cada trecho (chunk), as entidades iguais pelo nome são unidas, e as descrições concatenadas viram os vetores indexados. Na consulta, acha-se as entidades mais próximas e votam-se os trechos originais. Em quatro conjuntos de perguntas e respostas, compara com VectorRAG, RAPTOR, GraphRAG da Microsoft e HippoRAG2. A conclusão que o título resume é que o RAG vetorial simples fica muito perto dos sistemas de grafo mais fortes, bem acima do GraphRAG da Microsoft, e custa uma fração. Os autores admitem que a posição relativa muda conforme o conjunto de dados.

## Método
- **Sistemas comparados:** UnWeaver (votação de entidades), UnWeaverPPR (mesma indexação, recuperação com PageRank personalizado), VectorRAG, RAPTOR, GraphRAG, HippoRAG2. Também um limite inferior (ClosedBook, sem contexto) e um superior (Oracle, trechos corretos) (seção 3).
- **Modelo e embeddings:** todos os métodos foram indexados e consultados com GPT-OSS-120B e embeddings Qwen3-Embedding-4B (seção 3). O juiz da métrica é o mesmo GPT-OSS-120B.
- **Dados:** COVID-QA (1.234 perguntas), eManual (522) e Tech-QA (596), do RAGBench, todos de pergunta de um salto; MuSiQue (2.417), de vários saltos (Tabela 1, seção 3). O texto observa que os conjuntos do RAGBench foram gerados à distância por um procedimento parecido com o do VectorRAG.
- **Métrica:** Factual Correctness (F1) do RAGAS, com decomposição das respostas em afirmações por LLM. 5 execuções da avaliação para obter média e variância da média (seção 3). O prompt de consulta é o mesmo para todos, com resposta em uma frase (Apêndice E).
- **Custo:** tokens de prompt e de conclusão na indexação e na consulta, tokens do embedder (Tabela 1). As colunas de tokens saíram embaralhadas na extração, e não reproduzo números delas.
- **k (trechos ou entidades recuperados), tamanho do chunk, temperatura, número de execuções de indexação, quantidade r de trechos escolhidos:** não consta. O apêndice mostra só a formulação matemática, o algoritmo e um exemplo numérico de 2 trechos.
- **Teste estatístico e tamanho de efeito:** não constam. Só a variância da média sobre 5 avaliações do juiz, que não cobre a variação de indexação nem de geração.

## Resultados
Tabela 1 (seção 3). Factual Correctness F1 (média). A coluna seguinte do artigo, com valores da ordem de 1e-5 a 1e-6, parece ser a variância (inferência minha, a partir do texto sobre "variância da média").

| Método | COVID-QA | eManual | Tech-QA | MuSiQue |
|---|---|---|---|---|
| UnWeaver | 0,3823 | 0,4811 | 0,3135 | 0,2028 |
| UnWeaverPPR | 0,3701 | 0,4514 | 0,3123 | 0,1946 |
| VectorRAG | 0,3790 | 0,4793 | 0,3218 | 0,2007 |
| RAPTOR | 0,3643 | 0,4466 | sem resultado | 0,1858 |
| GraphRAG | 0,3092 | 0,3424 | 0,2847 | 0,1353 |
| HippoRAG2 | 0,3735 | 0,4680 | 0,3448 | 0,2196 |
| ClosedBook | 0,2135 | 0,1793 | 0,2052 | 0,1476 |
| Oracle | 0,4765 | 0,5318 | 0,3367 | 0,2176 |

Na linha Tech-QA, a atribuição de cada valor ao método é por posição e eliminação, porque RAPTOR não rodou (nota 7: instabilidade numérica nos Gaussian Mixture Models).

Leituras:
- UnWeaver é o melhor em COVID-QA e eManual, e HippoRAG2 é o melhor em Tech-QA e MuSiQue (seção 3). As três primeiras posições envolvem sempre HippoRAG2, VectorRAG e UnWeaver. O GraphRAG fica sempre em último.
- **VectorRAG contra UnWeaver:** diferença de 0,0033 em COVID-QA, 0,0018 em eManual; o VectorRAG é maior em Tech-QA (0,3218 contra 0,3135) e HippoRAG2 passa os dois em MuSiQue. Sem teste estatístico, essas diferenças não podem ser lidas como ordem real.
- **Oracle não é teto estrito para esta métrica:** HippoRAG2 (0,3448) supera o Oracle (0,3367) em Tech-QA, e (0,2196) passa o Oracle (0,2176) em MuSiQue. Fica evidente que "contexto perfeito" não tem de ser o máximo de FC.
- **Cada tipo de método ganha num tipo de conjunto:** em Tech-QA e MuSiQue, métodos que transformam o texto (HippoRAG2, GraphRAG, RAPTOR) tiveram bons resultados; em COVID-QA e eManual, o oposto (seção 3). Os autores usam isso para falar da vulnerabilidade da avaliação ao conjunto de dados.
- **Custo:** o texto diz que, fora o eManual, o UnWeaver gasta na consulta quase os mesmos tokens do VectorRAG, que é o mais barato, e que o HippoRAG2 gasta de cerca de 1,5 a 2,75 vezes mais na indexação (seção 3).
- **Observação minha sobre uma afirmação do texto:** a seção 3 diz que o GraphRAG pode ficar abaixo do LLM sem contexto. Pela Tabela 1 isso só ocorre em MuSiQue (0,1353 contra 0,1476). Nos outros três conjuntos o GraphRAG fica acima do ClosedBook.

## Afirmações extraídas (com localização)
- VectorRAG vai melhor que o GraphRAG padrão e quase tão bem quanto soluções de grafo de ponta, por uma fração do custo: resumo e seção 3.
- UnWeaver rende mais precisão e fidelidade que a recuperação simples por trechos: seção 1 (contribuições). Isso não aparece de forma nítida na Tabela 1, onde o VectorRAG fica a menos de 0,01 em três dos quatro conjuntos.
- O desempenho de VectorRAG pode ser explicado em parte pela semelhança de arquitetura com o procedimento que gerou os conjuntos: seção 3, texto após a Tabela 1.
- Transformar demais o texto pode ser desastroso, como no GraphRAG: seção 3. Pela tabela, só MuSiQue o confirma contra o ClosedBook.
- Ranking muda por conjunto de dados: seção 3.
- Contexto ruidoso e trechos mal escolhidos injetam fatos errados e aumentam a taxa de erro: seção 1 (fundamentação, citando outros trabalhos, sem experimento próprio).
- A construção do índice do GraphRAG e do HippoRAG2 consome ordens de grandeza a mais de processamento: seção 1 e Tabela 1 (tokens).

## Limitações da fonte
**Dos autores:** reconhecem que o ranking depende do conjunto de dados e que o VectorRAG se beneficia de se parecer com o processo que gerou os dados (seção 3). Registram a falha do RAPTOR em Tech-QA (nota 7). O artigo não tem seção de limitações.

**Minhas:**
- Autores comparam o próprio método com concorrentes que eles mesmos executaram; ajuste de hiperparâmetros dos concorrentes não consta.
- Gerador e juiz são o mesmo modelo, e a métrica depende de um LLM decompor afirmações. Risco de viés de autoafinidade.
- Variância só sobre 5 repetições da avaliação, não da indexação ou da geração; nenhum intervalo, teste ou tamanho de efeito. Diferenças de 0,001 a 0,01 em FC não permitem ordenar métodos.
- k, tamanho de chunk, temperatura e r não constam. Dificulta reproduzir o "VectorRAG" que ganhou, e sem isso não dá para copiar a configuração.
- Os conjuntos são de perguntas e respostas de um trecho ou de vários saltos, em texto de covid, manuais e suporte técnico. Não são decisões de projeto, não têm opções fechadas, não têm abstenção e não têm versões antigas e substituídas de documentos.
- O VectorRAG comparado é simples (um vetor). Não há BM25, híbrido, reranqueamento nem filtro por metadados. Portanto o artigo não diz nada sobre o ganho de um índice híbrido.
- Tabela 1 saiu da extração com colunas de tokens embaralhadas; não extraí custos em números.

## O que importa para o estudo 2
**Copiar do método**
- Rodar a métrica de avaliação várias vezes quando houver juiz de LLM (aqui, 5), e reportar a variância. No estudo 2 a métrica é acerto por letra, então o juiz não existe; os 3 votos já cobrem a variação do modelo, e vale acrescentar repetições do mesmo item para estimar ruído.
- Incluir limite inferior e limite superior (ClosedBook e Oracle) na mesma tabela: é o que nossos A0 e A1 fazem. Reforça a escolha do plano.
- Prompt de consulta idêntico em todos os braços, para isolar o efeito da recuperação. Fazer o mesmo e registrar o prompt no pré-registro.

**Que braço ou hipótese isso apoia ou contradiz**
- Apoia deixar o GraphRAG de fora (plano, escopo): em quatro conjuntos ele ficou em último, e o ganho de métodos de grafo sobre o vetorial simples é pequeno e inconstante. O plano diz que a literatura é "inconclusiva"; este artigo inclina para "sem vantagem clara de grafo sobre vetorial" mas, por ser dos autores de um concorrente, é evidência fraca.
- Apoia A3 (RAG ingênuo vetorial) como linha de base forte, e portanto um A4 que não passe de A3 por mais que 3 a 5 pp não seria surpresa. Isso casa com o limite de refutação da H4 (menos de 3 pp de acerto).
- Contradiz a ideia de que o oráculo (A1) é um teto rígido (H1, H3): aqui um método de recuperação passou o oráculo em dois conjuntos, em FC. No plano, o A1 deve ser tratado como "referência com os documentos-ouro", e a H3 (recuperar 80% do ganho do oráculo) precisa prever razões acima de 100%.
- Não informa H5, H6, H7 (vigência, contexto longo, abstenção).

## Contradições ou ajustes que o plano.md precisa
1. **H3:** acrescentar que a razão "ganho do RAG sobre ganho do oráculo" pode passar de 100%. Definir de antemão como será tratada (limitar a 100% ou reportar bruta).
2. **Escopo, linha 69:** trocar "a literatura é inconclusiva" por algo como "os poucos resultados disponíveis mostram ganho pequeno e inconstante de grafo sobre vetorial simples (Tuora et al., 2603.29875), com ressalvas de método".
3. **Não citar este artigo como base para o A4** (híbrido com BM25 e reranqueamento): o VectorRAG deles é só denso, e os conjuntos não têm decisões de projeto.
4. **Registrar a ressalva de avaliação:** a ordem de métodos de RAG muda com o conjunto de dados. O estudo 2 vale para um corpus (h3) e deve dizer isso no resumo.
