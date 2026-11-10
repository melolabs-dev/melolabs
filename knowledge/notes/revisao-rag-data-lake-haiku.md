---
id: revisao-rag-data-lake-haiku
title: "Revisão de literatura: RAG, contexto e decisões com modelos pequenos (18 artigos lidos por inteiro)"
source_url: https://github.com/melolabs-dev/melolabs/tree/main/studies/rag-data-lake-haiku/fontes
kind: revisao-de-literatura
evidence: revisao-de-literatura
validated_by_author: false
publishable: false
fidelity: resumo-curado
date: 2026-11-08
tags: [rag, data-lake, haiku, decisao, contexto, revisao, estudo-2]
---

# Revisão de literatura para o estudo 2 (Haiku com mini data lake)

Base do estudo 2. Os 18 artigos do arXiv foram lidos por inteiro por agentes (texto extraído do PDF) e cada um tem uma ficha em `studies/rag-data-lake-haiku/fontes/<slug>.md`, com método, números com localização, limitações e ajustes ao plano. Ressalvas: a extração de PDF embaralhou algumas tabelas (as fichas marcam "conferir no PDF"); as fichas citam seção, tabela e figura, não página; nenhuma conclusão foi validada pelo autor ainda. Nenhum artigo mede RAG em decisões de projeto com modelo pequeno contra modelo maior com o mesmo oráculo: essa é a lacuna do estudo 2.

## O que a literatura sustenta
- **Recuperação ajuda, mas o ganho é pequeno e depende do modelo.** Lean LMs (2508.11386): no Qwen 32B a nota vai de 0,38 para 0,54 só com recuperação, e o ajuste de raciocínio soma 2 pontos; teto de recuperação com k=5 é 0,76. DRAFT-ADR (2504.08207), em BERTScore F1: +0,022 no GPT-4o e +0,014 no Gemini, mas +0,002 no Llama-3-8B e −0,003 no Gemma-2-9B (sem repetições nem intervalo).
- **RAG pode não ajudar um modelo pequeno.** 4B médico (2604.23801): com 4 opções o modelo já acerta 46% a 53% sem contexto; RAG deu +0,9 pp (Gemma) e −1,9 pp (MedGemma), ambos sem significância. A explicação "conhecimento nos pesos" é hipótese do autor, não testada. Com temperatura 0,1 as 3 repetições concordam em cerca de 99%, então votar quase não acrescenta informação.
- **Recuperar pode piorar.** StackRepoQA (2603.26567, nota 1 a 10 de juiz LLM): sem ferramentas 6,94 (GPT-4o) e 6,67 (Claude); só arquivo 5,66; só grafo 6,12. Self-RAG (2310.11511): recuperar sempre custa cerca de 3,5 pontos e piora modelos fortes em PubHealth.
- **Contexto de ADR.** Gupta et al. (2604.03826): a tarefa é gerar o texto do ADR (similaridade, não escolha); Last_K, RAFG (só vetor) e All_N empatam na terceira ou quarta casa decimal; não há teste estatístico no corpo, só no resumo ("sem vantagem significativa"); quatro modelos (Gemini-2.5-Pro, Qwen3-235B, GLM-4.6, Gemma3-4B), sem controle de tamanho dentro da mesma arquitetura.
- **Ruído e distratores.** Power of Noise (2401.14887): distrator é trecho parecido que não contém a resposta (não contradiz); aleatório ajudou o Llama2 com 4 documentos (0,187 para 0,253), mas só com evidência junto e dependendo da posição; modelos de 7B ou menos, 4 bits, resposta curta. ARB (2607.24882): contexto aleatório levou o Any-gold de 0,51 a 0,73 e piorou 33% das amostras (agente de código).
- **Posição.** Lost in the Middle (2307.03172): queda no meio com 10, 20 e 30 documentos; no GPT-3.5 o pior caso fica abaixo do livro fechado (53,8% contra 56,1% com 20); Claude-1.3 mais plano; passar de 20 para 50 documentos rende só +1 a +1,5 ponto. Modelos de 2023.
- **Híbrido, reranqueamento, chunk.** Shaikh (2606.21553, Qwen2.5-7B, HotpotQA): híbrido fixo por fusão de rank supera o roteador por regras em +1,8 EM; dense-only e sparse-only fixos empatam com o híbrido; efeitos por componente de cerca de 2 EM; sem teste pareado entre híbrido e as variantes puras. Lewis (2005.11401): BM25 só ganhou em FEVER. Chunk size (2505.21700): só mede recuperação, e o melhor tamanho varia em dezenas de pontos conforme conjunto e embedding.
- **Grafo.** UnWeaver (2603.29875): VectorRAG fica a menos de 0,01 do método proposto em 3 de 4 conjuntos e o GraphRAG fica em último; HippoRAG2 superou o oráculo em dois conjuntos (o oráculo não é teto rígido); sem testes estatísticos.
- **Abstenção não tem apoio.** CRAG (2401.15884) não se abstém (busca na web quando a recuperação é ruim; avaliador T5-large de 0,77B); Lewis: mecanismo de documento nulo não ajudou; ARB: corte pela pontuação máxima de recuperação falhou nos casos naturais sem resposta; Self-RAG e lean-lm não medem abstenção.
- **Validação do ouro e uso da evidência.** ContextBench (2602.05892): validar a suficiência do ouro rodando o modelo só com ele (5 tentativas); "queda de uso" de 18% a 44% (o modelo viu o ouro e não o usou); agente simples iguala scaffolds sofisticados. DRAG (2506.01954): sem fine-tuning, mas a evidência vem da memória do professor, sem corpus, e há risco de vazamento de gabarito.
- **Dados e operação.** RAGOps (2506.03401): conceitual, sem dados; lake antes do chunking, metadados de tempo, autoria, fonte e acesso, versões antigas arquivadas. Seven Failure Points (2401.05856): relato qualitativo sem números; taxonomia FP1 a FP7 útil para classificar erros.

## Implicações para o desenho (resumo)
Medir o lake em vez de assumir o ganho; separar recuperação de raciocínio com oráculo validado; fixar temperatura, k, chunk, ordem e posição; reportar tokens por braço; controles de ruído com e sem evidência; sinal de confiança do portão definido antes do congelamento; margens compatíveis com o poder de 100 perguntas. Detalhes em `studies/rag-data-lake-haiku/plano.md`.

## Erros já corrigidos na leitura inicial
O DRAG não exige treino; o "cerca de 64%" do StackRepoQA era frase da introdução, a métrica é nota de 1 a 10; a afirmação de que a janela recente "ganhou" da recuperação no artigo de ADR estava errada (é empate sem teste).
