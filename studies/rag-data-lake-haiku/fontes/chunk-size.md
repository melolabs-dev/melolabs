---
id: rag2-2505.21700
titulo: "Rethinking Chunk Size for Long-Document Retrieval: A Multi-Dataset Analysis"
autores: "Sinchana Ramakanth Bhat, Max Rudat, Jannis Spiekermann, Nicolas Flores-Herr (Fraunhofer IAIS)"
ano: 2025
tipo: academico
url: https://arxiv.org/abs/2505.21700
doi: 10.48550/arXiv.2505.21700
acessado: 2026-11-08
nivel_evidencia: B
vies: "Preprint (cs.IR, v2 de 29/05/2025), sem revisão por pares indicada no texto. Mede só recuperação (recall@k por correspondência de string), não a qualidade da resposta gerada. Quatro dos seis conjuntos são documentos sintéticos criados por costura de pares pergunta-resposta curtos. Sem repetições, sem intervalo de confiança, sem teste de significância. Código no GitHub (Fraunhofer)."
verificada: true
---
# Rethinking Chunk Size for Long-Document Retrieval: A Multi-Dataset Analysis

> tipo: academico. nivel_evidencia: B (experimento com método descrito e código aberto, mas com os limites listados abaixo). Páginas citadas seguem os marcadores de página do texto extraído (8 páginas).

## Resumo
O artigo varre tamanhos fixos de chunk (64, 128, 256, 512 e 1024 tokens) com dois modelos de embedding (Stella 1.5B v5 e Snowflake Arctic Embed L v2.0) em seis conjuntos de perguntas e respostas extrativas sobre documentos longos. A métrica é recall@k (k de 1 a 5) por correspondência de string. A conclusão dos autores é que o melhor tamanho depende do conjunto e do modelo: chunks pequenos (64 a 128) para respostas curtas e factuais, chunks grandes (512 a 1024) para respostas que exigem contexto mais amplo. Não há avaliação de geração de resposta, só de recuperação. A leitura da tabela completa mostra que várias frases do texto não batem com os próprios números (ver Limitações).

## Método
- **Recuperação:** RAG montado com LlamaIndex; divisão com `TokenTextSplitter` em tamanho fixo, **sem sobreposição** (seção 3 e 4, p. 3); similaridade de cosseno; top-k com k de 1 a 5. Só denso, sem BM25, sem híbrido, sem reranqueamento.
- **Embeddings:** stella_en_1.5B_v5 (descrito como baseado em decodificador, janela de mais de 130 mil tokens segundo o texto) e snowflake-arctic-embed-l-v2.0 (descrito como baseado em codificador, janela de 8194 tokens segundo o texto) (p. 3 e 5).
- **Dados (Tabela 1, p. 2):** NarrativeQA (1073 docs, 51.830 tokens/doc), Natural Questions (25.010 docs, 6.918), NewsQA (685 docs, 8.485), COVID-QA (55 docs, 10.009), TechQA (45 docs, 7.597), SQuAD (306 docs, 7.998). Os quatro últimos (marcados com asterisco) foram **costurados** a partir de pares curtos para formar documentos sintéticos de pelo menos 50.000 caracteres. Filtro: a resposta esperada tem de aparecer no texto por correspondência de string e **uma única vez**.
- **Métrica:** recall@k = o chunk relevante está entre os k primeiros. O texto reporta k de 1 a 5 e analisa principalmente recall@1 (p. 3).
- **Execuções, sementes, temperatura, intervalos de confiança:** não consta (não há geração, e não há repetições nem estatística de incerteza). Número total de perguntas por conjunto: não consta (só perguntas por documento, na Tabela 1).

## Resultados
Tabela 2 (p. 4), recall@1 por tamanho de chunk (64, 128, 256, 512, 1024). Valores copiados da tabela; conferir no PDF antes de citar em texto público.

| Conjunto | Stella R@1 | Snowflake R@1 |
|---|---|---|
| NarrativeQA | 0,042; 0,057; 0,079; 0,089; 0,107 | 0,034; 0,047; 0,062; 0,089; 0,104 |
| NQ | 0,172; 0,222; 0,323; 0,385; 0,349 | 0,150; 0,204; 0,263; 0,390; 0,477 |
| NewsQA | 0,378; 0,440; 0,491; 0,560; 0,520 | 0,320; 0,416; 0,445; 0,573; 0,667 |
| COVID-QA | 0,521; 0,418; 0,424; 0,406; 0,308 | 0,390; 0,532; 0,409; 0,432; 0,542 |
| TechQA | 0,049; 0,165; 0,400; 0,614; 0,619 | 0,045; 0,184; 0,428; 0,581; 0,715 |
| SQuAD | 0,642; 0,616; 0,566; 0,498; 0,386 | 0,609; 0,600; 0,539; 0,462; 0,429 |

Leitura direta dos números:
- Em SQuAD o recall@1 **cai** com o chunk maior em ambos os modelos (Stella de 0,642 para 0,386; Snowflake de 0,609 para 0,429). O texto diz 64 tokens como melhor e queda de 10 a 15 pontos em 512 (p. 3), o que confere (queda de cerca de 14 a 15 pontos).
- Em NarrativeQA, NQ, NewsQA (Snowflake) e TechQA o recall@1 sobe com o chunk, em geral até 512 ou 1024.
- Em COVID-QA o padrão é irregular: Stella cai quase sempre; Snowflake oscila (0,390; 0,532; 0,409; 0,432; 0,542).
- O recall absoluto é baixo em NarrativeQA (no máximo 0,107 em R@1 e 0,270 em R@5) e é alto em NewsQA e SQuAD.

## Afirmações extraídas (com localização)
- Chunks de 64 a 128 tokens são melhores para respostas curtas e factuais; 512 a 1024 para respostas descritivas ou técnicas (resumo, p. 1; seção 4.1, p. 3; conclusão, p. 5-6).
- SQuAD: recall@1 de 64,1% com 64 tokens e queda de 10 a 15% em 512 (seção 4.1, p. 3). Confere com a Tabela 2.
- NewsQA: pico de recall@1 em 512 tokens, 55,9% (seção 4.1, p. 3). Confere para o Stella; o Snowflake chega a 66,7% em 1024.
- NarrativeQA: recall@1 de 4,2% (64) para 10,7% (1024) (p. 3). Confere para o Stella.
- TechQA: de 16,5% (128) para 61,3% (512) (p. 3). Confere para o Stella. Já a frase da seção 4.2 (p. 5), "de 4,8% com 64 para 71,5% com 1024", mistura modelos: 4,9% é do Stella e 71,5% é do Snowflake.
- Stella se beneficia de chunks grandes e Snowflake de chunks pequenos (resumo, p. 1; seção 4.3, p. 5). **Contradita pela Tabela 2** em vários conjuntos: Snowflake é melhor que Stella em 1024 em NQ (0,477 contra 0,349), NewsQA (0,667 contra 0,520) e TechQA (0,715 contra 0,619), e o próprio Snowflake sobe com o chunk em NarrativeQA, NQ, NewsQA e TechQA.
- A seção 4.3 diz que Stella ganha de 5 a 8 pontos de recall@1 sobre o Snowflake em 512 e 1024 em NarrativeQA, NQ e TechQA. Pela Tabela 2, a diferença nesses tamanhos vai de menos 12,8 a mais 3,3 pontos e favorece o Snowflake em NQ e TechQA a 1024.
- A seção 4.2 diz que em SQuAD o recall@1 aumenta "marginalmente" com chunks maiores (p. 5); a Tabela 2 mostra queda.
- A seção 4.2 diz que NQ tem pico em 1024 para os dois modelos (p. 4); na tabela o Stella tem pico em 512.
- Os autores afirmam que as tendências são consistentes entre os k de 1 a 5 (seção 4, p. 3). Não foi checado coluna a coluna aqui, só R@1 e R@5 em amostra.

## Limitações da fonte
- **Do autor (seção 5, p. 5):** avaliação por correspondência de string, que não captura relevância semântica; conjuntos que podem não refletir recuperação real (alguns têm estrutura sintética ou anotação de relevância pobre); foco em desempenho de recuperação, sem medir qualidade do chunk (coerência, informação); conclusão repete a necessidade de métricas intrínsecas e de conjuntos mais realistas.
- **Minhas:**
  - Só recuperação. Não há resposta gerada nem acerto de decisão, então o artigo não prova que o chunk "melhor" gera resposta melhor.
  - O k fixo compara orçamentos de contexto muito diferentes: top-5 com chunks de 64 tokens entrega cerca de 320 tokens, top-5 com 1024 entrega cerca de 5.120. Recall maior com chunk maior em parte reflete mais texto recuperado. O artigo não normaliza por tokens.
  - Quatro de seis conjuntos são colagens artificiais de documentos curtos, com fronteiras abruptas entre assuntos, diferentes de um acervo de projeto.
  - Sem sobreposição entre chunks; sem repetições nem incerteza; diferenças de 1 a 3 pontos não têm significância declarada.
  - Os textos de análise contradizem a Tabela 2 em pelo menos cinco pontos (acima), então as conclusões em prosa, inclusive a do resumo sobre os dois modelos, não devem ser citadas sem conferir os números.
  - Só dois modelos de embedding, os dois grandes. Nada sobre BM25, reranqueamento, nem sobre documentos que não sejam prosa (código, tabelas, issues).
  - Datas e versões dos conjuntos e dos modelos de embedding não constam além dos nomes.

## O que importa para o estudo 2
- **O que copiar:** (1) medir recall@k do documento-ouro separado do acerto da resposta (o plano já faz); (2) tratar o tamanho de chunk como parâmetro a fixar no pré-registro e a calibrar no piloto, não como constante; (3) varrer pelo menos dois tamanhos de chunk no piloto (por exemplo 128 e 512 tokens) com sobreposição declarada.
- **Braços e hipóteses:** afeta A3, A4 e A5 e as hipóteses H3 e H4. O ganho do A4 sobre o A3 pode vir só do tamanho do chunk se os dois braços não usarem o mesmo. Deve valer: mesmo chunk e mesmo k nos braços A3 e A4, ou comparar por orçamento de tokens e não por k.
- **Fraco, não é prova:** o artigo apoia a ideia de que a escolha do chunk altera o recall em dezenas de pontos (por exemplo TechQA com Snowflake vai de 0,045 a 0,715), logo uma linha de base A3 mal ajustada infla o ganho do A4 ou do A5. Isso reforça a prudência já presente no plano, mas não diz qual tamanho é bom para CLAUDE.md, código, issues e logs de decisão.
- **Documento inteiro como unidade:** como o gabarito do plano é por documento, um caminho simples e defensável é indexar também a unidade "documento" ou "cartão de decisão" (que é curto) e comparar com chunks; o artigo não testa isso.

## Contradições ou ajustes que o plano.md precisa
1. O plano descreve o A3 como "vetor, top-k, chunks brutos" sem fixar tamanho de chunk, sobreposição nem k. Fixar os três no pré-registro e calibrar no piloto (qua 11/11).
2. A4 muda três coisas ao mesmo tempo (híbrido, fusão, reranqueamento) e A3 pode diferir também no chunk. Garantir chunk e k iguais no A3 e A4 e, se couber, um braço de ablação do reranqueamento.
3. Reportar recall@k junto com o número médio de tokens entregues ao modelo por braço, porque o recall@k sozinho favorece o braço que entrega mais texto (e isso também é o ponto do controle N1).
4. Margens do plano (H4 com 5 pontos de acerto) são menores que a diferença detectável declarada no próprio plano (cerca de 15 pontos). Ver ficha lean-lm-rag.md, onde isso também aparece.
