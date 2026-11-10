---
id: rag2-2504.08207
titulo: "DRAFT-ing Architectural Design Decisions using LLMs"
autores: "Rudra Dhar, Adyansh Kakran, Amey Karan, Karthik Vaidhyanathan, Vasudeva Varma"
ano: 2025
tipo: academico
url: https://arxiv.org/abs/2504.08207
doi: 10.48550/arXiv.2504.08207
acessado: 2026-11-08
nivel_evidencia: B
vies: "Preprint v1 (11 abr 2025), submetido ao Journal of Systems and Software, sem revisão por pares concluída. Os autores propõem o DRAFT e o avaliam contra baselines que eles mesmos montaram. Métricas principais de sobreposição de texto, não de correção da decisão. Uma execução por configuração, sem intervalo de confiança."
verificada: true
---
# DRAFT-ing Architectural Design Decisions using LLMs

> tipo: academico. nivel_evidencia: B (método e dados abertos no GitHub, sa4s-serc/LLM4ADR; porém sem repetição de execuções nem estatística inferencial). Texto lido por inteiro, incluindo tabelas, ameaças à validade e conclusão. A lista de referências foi apenas percorrida.

## Resumo
Os autores querem gerar a "Decisão de Projeto" (D) de um ADR (Architectural Decision Record) a partir do "Contexto da Decisão" (C). Comparam quatro abordagens: prompt sem exemplos (zero-shot), RAG de poucos exemplos (few-shot recuperado), fine-tuning e a proposta deles, o DRAFT (fine-tuning de um modelo para gerar D a partir de C mais exemplos recuperados de ADRs parecidos). Num conjunto de 4.911 ADRs de repositórios abertos, o DRAFT tem os melhores números automáticos em todas as métricas e, segundo os autores, também no custo de inferência. A avaliação humana (23 arquitetos) é qualitativa e mostra que a métrica automática e a preferência humana divergem.

## Método
**Tarefa.** Dado C, gerar D (texto livre). Não há opções fechadas nem gabarito de "decisão correta" além da decisão humana original (Seção 2.1, 5.1).

**Dados (Seção 5.1).**
- ADRs de repositórios abertos do GitHub, a partir da lista do estudo MSR de Buchgeher et al.; os arquivos foram raspados de novo e conferidos à mão por mudanças desde o estudo original. Resultado inicial: 5.262 ADRs.
- Limite de 500 tokens no Contexto (tiktoken). Mediana do comprimento do ADR: 56 tokens (cerca de 42 palavras). Depois do pré-processamento: 4.911 ADRs.
- Divisão 60-20-20: treino 2.946, validação 982, teste 983.
- Limpeza por expressões regulares e normalização de seções entre modelos de ADR (Nygard, MADR), por exemplo "Context and Problem Statement" vira "Context" (Seção 4.1).

**Como o RAG foi montado (Seções 2.4, 5.3).** É RAG de poucos exemplos, não RAG sobre documentos de projeto.
- Base vetorial (VDB) com os pares contexto-decisão (Ci, Di); o vetor é do Contexto, gerado por um modelo de embedding.
- Recuperação por similaridade (cosseno; FAISS citado como exemplo) dos 5 pares mais parecidos (top-5, Seção 5.3). Sem BM25, sem híbrido, sem reranqueamento, sem metadados, sem filtro de vigência. Tamanho de chunk: o "documento" é o par C-D inteiro; não consta estudo de tamanho de chunk.
- Os 5 pares entram no prompt como exemplos antes do contexto novo (prompt de exemplo na Seção 4.2). O prompt pede decisões "parecidas com as de cima".
- No DRAFT, o mesmo formato de prompt é usado no treino (os exemplos são recuperados da VDB para cada contexto de treino) e na inferência (Algoritmos 1 a 4). O artigo não diz como evita que o par de treino recupere a si mesmo; não consta.

**Modelos (Tabelas 1 e 2).**
- Geradores: GPT-4o e Gemini-1.5-Pro (tamanho desconhecido, proprietários); Llama-3-8B-Instruct (8B), Gemma-2-9B-it (9B), Flan-T5-base (248M, citado como 250M no texto).
- Embeddings: text-embedding-3-large (par do GPT-4o), text-embedding-004 (par do Gemini), bert-base-uncased (110M) para todos os modelos abertos. Ou seja, os modelos abertos usam um BERT puro, não treinado para busca.
- Escolha dos modelos pelo ranking LMArena de julho de 2024.
- Fine-tuning e DRAFT só nos abertos, com LoRA em Llama e Gemma; Flan-T5 com treino completo (Full) e com LoRA (Seção 5.3). Máximo de 10 épocas no fine-tuning e 5 no DRAFT, escolhendo o checkpoint de menor perda de validação. Hardware: 4 GPUs de 12 GB, 40 núcleos, 80 GB de RAM; Flan-T5 com LoRA num iMac M2 de 16 GB.
- Zero-shot: prompts da Tabela 3 (uma instrução curta de sistema).

**Métricas (Seção 5.4).** ROUGE-1, BLEU, METEOR e BERTScore (precisão, recall, F1); o BERTScore F1 é declarado a métrica principal. Avaliação humana secundária: 23 pessoas com experiência em ADR (média de 9,95 anos de indústria, Tabela 4), estudo cego; cada avaliador escreveu um contexto, recebeu uma saída do DRAFT e uma de outra abordagem sorteada (prompt, RAG ou fine-tuning), e avaliou relevância, coerência, completude e concisão, com comentários. Só os melhores modelos de cada abordagem (Tabela 5) foram avaliados por humanos.

**Parâmetros.** Temperatura, top-p e top-k: valores padrão de cada modelo, valores numéricos não consta (Seção 7.1 admite que não foram variados). Número de execuções por configuração: não consta (aparenta ser uma). Sem teste de significância, sem intervalo de confiança.

## Resultados
**Tabela 6 (Seção 5.5 e 5.6), conjunto de teste de 983 ADRs.** O texto extraído embaralhou as colunas; as linhas abaixo foram reconstruídas pela ordem em que aparecem, e os números batem com o texto em vários pontos (GPT-4o 0,814 para 0,836; Flan-T5 0,734 para 0,772 e para 0,855; Llama 0,805 para 0,801). A atribuição de "Full" a algumas linhas é inferida pela ordem; conferir no PDF antes de citar.

| Abordagem | Modelo | ROUGE-1 | BLEU | METEOR | BERTScore F1 |
|---|---|---|---|---|---|
| Zero-shot | Flan-T5 | 0,088 | 0,009 | 0,070 | 0,734 |
| Zero-shot | Llama-3-8B | 0,155 | 0,029 | 0,179 | 0,805 |
| Zero-shot | Gemma-2-9B | 0,152 | 0,040 | 0,176 | 0,810 |
| Zero-shot | GPT-4o | 0,167 | 0,020 | 0,180 | 0,814 |
| Zero-shot | Gemini-1.5-Pro | 0,179 | 0,018 | 0,176 | 0,817 |
| RAG (top-5) | Flan-T5 | 0,152 | 0,029 | 0,157 | 0,772 |
| RAG (top-5) | Llama-3-8B | 0,095 | 0,022 | 0,149 | 0,807 |
| RAG (top-5) | Gemma-2-9B | 0,115 | 0,028 | 0,171 | 0,807 |
| RAG (top-5) | GPT-4o | 0,260 | 0,054 | 0,251 | 0,836 |
| RAG (top-5) | Gemini-1.5-Pro | 0,246 | 0,041 | 0,238 | 0,831 |
| Fine-tuning | Flan-T5 (Full) | 0,296 | 0,056 | 0,205 | 0,855 |
| Fine-tuning | Flan-T5 (LoRA) | 0,234 | 0,067 | 0,185 | 0,837 |
| Fine-tuning | Llama-3-8B | 0,126 | 0,045 | 0,169 | 0,801 |
| Fine-tuning | Gemma-2-9B | 0,289 | 0,085 | 0,242 | 0,847 |
| DRAFT | Flan-T5 (Full) | 0,493 | 0,221 | 0,430 | 0,885 |
| DRAFT | Flan-T5 (LoRA) | 0,165 | 0,033 | 0,201 | 0,810 |
| DRAFT | Llama-3-8B | 0,314 | 0,069 | 0,260 | 0,848 |
| DRAFT | Gemma-2-9B | 0,309 | 0,102 | 0,280 | 0,842 |

Leituras que importam:
- RAG sobre zero-shot, em BERTScore F1: GPT-4o +0,022 e Gemini +0,014 (modelos grandes); Flan-T5 +0,038; Llama +0,002 e Gemma −0,003 (modelos de 8B e 9B, efeito nulo). Os autores concluem que o RAG "geralmente melhora, de forma inconsistente" e que o benefício é maior em modelos maiores (Seções 5.5.2 e 6.1). Os ganhos de GPT-4o e Gemini em ROUGE-1 e METEOR são proporcionalmente maiores (ROUGE-1 de 0,167 para 0,260 no GPT-4o).
- O DRAFT com Flan-T5 (Full) é o melhor de tudo: BERTScore F1 de 0,885. O ganho do DRAFT sobre o fine-tuning simples é pequeno nos modelos de 8B e 9B (Llama 0,801 para 0,848; Gemma 0,847 para 0,842, queda).
- O texto da Seção 5.5.3 diz que o Gemma foi de 0,817 para 0,847 no fine-tuning, mas a Tabela 6 dá 0,810 como linha de base do Gemma (0,817 é a do Gemini). Inconsistência interna do artigo.
- Os autores admitem que o ranking automático (Flan-T5 no topo) não bate com o humano: avaliadores acharam o Flan-T5 repetitivo e fraco em contextos próprios, e preferiram o DRAFT com Llama-3-8B (Seção 5.6, 6.1). Também acharam as saídas do DRAFT curtas e com pouco raciocínio, e as de GPT-4o/Gemini (zero-shot e RAG) mais legíveis, com títulos e markdown.
- Notas numéricas da avaliação humana (médias por critério): não consta. Só comentários qualitativos resumidos.

**Tabela 7 (Seção 5.7), 100 contextos amostrados, só fase online.**

| Abordagem | Modelo | Tokens de entrada | Tokens de saída | Tempo (s) |
|---|---|---|---|---|
| Zero-shot | Gemini-1.5-Pro | 157,18 | 111,23 | 14,05 |
| RAG | GPT-4o | 1.495,03 | 164,68 | 5,30 |
| Fine-tuning | Gemma-2-9B | 141,18 | 97,22 | 3,88 |
| DRAFT | Flan-T5-base | 856,80 | 174,27 | 3,76 |
| DRAFT | Llama-3-8B | 718,42 | 58,72 | 2,43 |

RAG e DRAFT gastam muito mais tokens de entrada que zero-shot (cerca de 9,5 vezes no RAG com GPT-4o). Os tempos comparam APIs remotas com modelos hospedados localmente, então não são comparáveis entre si. Custo em dinheiro: não consta (tokens são tomados como proxy, Seção 5.7).

## Afirmações extraídas (com localização)
- RAG de poucos exemplos melhora o desempenho de modelos grandes proprietários de forma clara e de modelos pequenos de forma inconsistente. Seção 5.5.2, Tabela 6, Seção 6.1.
- O DRAFT supera prompt, RAG e fine-tuning isolados nas métricas automáticas. Seção 5.6, Tabela 6, Figura 10.
- Métrica automática e julgamento humano divergem: a brevidade das saídas, aprendida de ADRs curtos (maioria com menos de 50 palavras), melhora as métricas e piora a preferência humana. Seção 6.1.
- Para os autores, as organizações pequenas podem ajustar e hospedar modelos pequenos para ter privacidade com desempenho "comparável" ao de modelos proprietários maiores. Seção 6.3. (A Tabela 6 mostra isso só para Flan-T5 Full no BERTScore; o próprio modelo foi mal avaliado por humanos.)
- O custo de tokens do RAG e do DRAFT é alto, mas o tempo de inferência não sobe. Seção 5.7, 6.3.
- Os dados de treino e avaliação são ADRs reais curtos de repositórios abertos. Seção 5.1.

## Limitações da fonte
**Do autor (Seção 7).** Filtro de 500 tokens pode ter excluído casos; escolha de métricas de geração é um problema em aberto; estilos de ADR variam e penalizam saídas corretas mas escritas de outro jeito; parâmetros de geração não foram ajustados; conjunto de dados pode não cobrir toda a diversidade; só um subconjunto de modelos; um único modelo de embedding para o RAG (bert-base-uncased nos abertos); avaliação humana sujeita a viés; comparação de eficiência mistura modelos grandes (prompt, RAG) e pequenos (DRAFT, fine-tuning) e ignora a fase offline.

**Minhas.**
1. A tarefa é gerar texto livre avaliado por similaridade com a decisão humana. Não mede se a decisão é boa nem se escolhe a opção certa entre alternativas fechadas.
2. O "mini lake" do DRAFT são ADRs de outros projetos usados como exemplos de estilo e precedente. Não é conhecimento específico do projeto consultado, que é o caso do estudo 2. Mal responde se RAG ajuda quando o fato só existe no projeto.
3. ADRs públicos do GitHub podem ter estado nos dados de pré-treino do GPT-4o e do Gemini; o artigo não discute contaminação (não consta). Isso pesa justamente na comparação zero-shot contra RAG.
4. Sem repetições, sem intervalo de confiança, sem teste de significância; diferenças de 0,002 a 0,003 em BERTScore (Llama, Gemma) não permitem conclusão.
5. Embedding dos modelos abertos é um BERT puro (não ajustado para similaridade de sentenças), o que enfraquece o RAG justamente nos modelos pequenos; o efeito "RAG não ajuda modelo pequeno" pode ser da recuperação, não do modelo. Não há análise de qualidade da recuperação (recall@k não consta).
6. Inconsistência entre texto e Tabela 6 no valor-base do Gemma (0,817 contra 0,810) e extração de tabela embaralhada; a linha "Full" de alguns resultados é inferida.
7. Preprint, não revisado por pares.

## O que importa para o estudo 2
**Copiar do método.** (a) Registrar tokens de entrada e saída por abordagem como proxy de custo, como na Tabela 7, mas acrescentar custo em dólar e comparar modelos de preço diferente no mesmo cálculo. (b) Separar métrica automática de julgamento humano e relatar a divergência; o estudo 2 evita o problema usando opções fechadas e gabarito escrito antes. (c) Escolher o checkpoint ou configuração em validação, nunca no teste: o plano já prevê piloto de 15 perguntas para calibrar margens, o que tem o mesmo papel. (d) Relatar que o ganho do RAG depende da capacidade do modelo: o estudo 2 deve apresentar o efeito do RAG por modelo (Haiku e Sonnet) e não só agregado.

**Hipóteses e braços.** Apoia, de forma fraca, H3 e H4 (RAG ajuda mais quando o modelo é maior e quando o embedding é bom); o Haiku 5.5 não é comparável a modelos de 8B nem a um GPT-4o de 2024, então a transferência é incerta. Não apoia nem contradiz H5 a H9: não há conflito de vigência, abstenção, oráculo nem controles. Como contraexemplo para o N1/H8: o DRAFT trata "mais tokens de exemplos" como causa de ganho, sem controle de tokens irrelevantes (não consta), então o N1 do plano é uma melhoria sobre a literatura.

**Aviso de não generalização.** Não usar esta fonte para afirmar que "RAG melhora decisões de arquitetura". Ela mostra que exemplos parecidos melhoram a semelhança de texto com a decisão humana em modelos grandes.

## Contradições ou ajustes que o plano.md precisa
1. O plano.md não cita este artigo. Se for citado, a frase correta é: ganho de RAG de poucos exemplos foi claro em GPT-4o e Gemini (BERTScore F1 +0,022 e +0,014) e nulo em Llama-3-8B e Gemma-2-9B, medido por similaridade de texto, sem controle de vigência. Não vendê-lo como apoio direto ao A5 ou ao oráculo.
2. A seção "O que a literatura já diz" fala de "RAG não ajudou um modelo de 4B" (Buskila). O DRAFT traz um segundo dado na mesma direção (8B e 9B sem ganho consistente) com a ressalva do embedding fraco. Se o plano quiser sustentar "RAG depende do modelo", pode juntar as duas fontes.
3. A hipótese H3 define "melhor braço de RAG" com 80% do ganho do oráculo. O DRAFT não tem oráculo; não há referência na literatura lida aqui para essa margem. Marcar a margem como arbitrária de partida (já está) e não atribuí-la a nenhuma fonte.
4. Registrar no protocolo temperatura e número de execuções por pergunta. O artigo deixa os dois como "padrão do provedor" e uma execução; isso é exatamente o que o estudo 2 não deve repetir. Observação: com os 3 votos do plano, temperatura zero daria três respostas idênticas; o plano não fixa a temperatura.
