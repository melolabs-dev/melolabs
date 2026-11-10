---
id: rag2-2506.01954
titulo: "DRAG: Distilling RAG for SLMs from LLMs to Transfer Knowledge and Mitigate Hallucination via Evidence and Graph-based Distillation"
autores: "Jennifer Chen, Aidar Myrzakhan, Yaxin Luo, Hassaan Muhammad Khan, Sondos Mahmoud Bsharat, Zhiqiang Shen (VILA Lab, MBZUAI)"
ano: 2025
tipo: academico
url: https://arxiv.org/abs/2506.01954
doi: 10.48550/arXiv.2506.01954
acessado: 2026-11-08
nivel_evidencia: B
vies: "Preprint v1 (02/06/2025). Os autores propõem o método e o comparam com baselines. Nos experimentos o professor (GPT-4o etc.) gera a evidência do zero, então o ganho mistura conhecimento do professor com recuperação. Benchmarks públicos (ARC-C, MMLU, MedMCQA, GPQA), expostos a contaminação dos próprios professores. Execução única e sem variância (não consta)."
verificada: true
---
# DRAG: Distilling RAG for SLMs from LLMs

> tipo: academico. nivel_evidencia: B (método descrito, código no GitHub segundo o resumo, muitos experimentos; mas desenho confundido, sem repetições). Leitura integral do texto extraído, incluindo apêndices A a I e Tabelas 1 a 17. As células das Tabelas 2, 4 e 8 a 17 vieram em colunas embaralhadas; só uso números que a prosa confirma.

## Resumo
O DRAG tenta levar a vantagem de um RAG "grande" para modelos pequenos (2B a 9B), sem fine-tuning. Um LLM professor na nuvem gera N evidências textuais para cada pergunta, essas evidências são ranqueadas (similaridade de cosseno mais nota do próprio LLM) e filtradas, e opcionalmente viram um grafo de relações (triplas entre entidades). O modelo pequeno recebe a evidência e/ou o grafo no prompt e responde. Os autores relatam ganhos grandes sobre o modelo pequeno sem contexto e sobre RAGs anteriores (MiniRAG, Self-RAG, CRAG, SimRAG), além de um caso de uso de privacidade.

## Método
- **O que "recuperação" significa aqui (seção 3.2):** não há corpus nem índice. A "evidência" é gerada pelo professor a partir da própria memória (parametric knowledge), com o prompt "gere N evidências relevantes para a pergunta", pedindo para não entregar a resposta (apêndice F). Os autores afirmam que um LLM bem treinado é um recuperador mais forte para SLMs que "codificador de consulta mais índice".
- **Pipeline (Algoritmo 1):** (1) gerar N evidências; (2) ranquear por `score = cos(evidência, pergunta) + nota do LLM`, com soma de pesos iguais, usando sentence-transformers, e descartar as N-K piores; (3) extrair triplas (entidade, entidade, relação) das evidências filtradas e ficar com as K melhores; (4) o SLM responde com evidências e/ou triplas. Agregação opcional de grafo (apêndice H).
- **Modelos:** professores GPT-4o, DeepSeek-V3, Gemini 1.5 Flash, Claude 3.5 Sonnet, Llama-3.3-70B (GPT-4o-mini no Open-LLM Leaderboard). Alunos Gemma-2-2B-it, Phi-3.5-mini-instruct, Qwen2.5-3B-Instruct, Llama-3.2-3B-Instruct, Qwen2.5-7B-Instruct, Llama-3.1-8B-Instruct, Gemma-2-9B-it (2B a 9B); BLOOM-7b e GPT-3.5-Turbo no AVERITEC (seção 4.1, 4.6).
- **Dados:** ARC-Challenge, MedMCQA, GPQA, MMLU (múltipla escolha), Open-LLM-Leaderboard (resposta aberta), AVERITEC (verificação de fatos), WebQuestions (apêndice C) e um benchmark de privacidade criado a partir de 5.000 perguntas do MMLU com PII sintética injetada (apêndice G). Tamanho dos conjuntos de teste: não consta na prosa.
- **Parâmetros:** número de evidências ou relações N e K de 5, 10, 15 e 20 (e 30, 40, 50 no apêndice D). Avaliação zero-shot com o lm-evaluation-harness em 4 GPUs RTX 4090 (seção 4.1). Temperatura, semente e número de execuções: não constam. Tamanho de chunk: não se aplica (a evidência é gerada).
- **Baselines (Tabela 1):** Self-RAG, CRAG, SimRAG e MiniRAG, com os números de acurácia de cada um sob "mesmo backbone e configuração de inferência"; não fica claro na prosa se foram reexecutados ou copiados dos artigos originais.

## Resultados
- **Tabela 1 (seção 4.2):** DRAG com o Llama-3.1-8B-Instruct chega a 75,7% no MMLU e 93,1% no ARC-C contra 67,5% e 81,4% do SimRAG (+8,2 e +11,7 pontos). Com Llama-2-7B, 72,4% no MedMCQA. Contra o MiniRAG com os mesmos SLMs, os maiores ganhos são +23,9 (MedMCQA), +13,9 (MMLU) e +11,4 (ARC-C); o resumo fala em até 27,7% (ganho no ARC-C com GLM-edge-1.5B e com Llama-3.2-3B, 90,0 e 93,0 contra 62,3 e 65,3 do MiniRAG, segundo a Tabela 1). O DRAG chega a 94,1% no ARC-C, contra 67,3% do Self-RAG e 68,6% do CRAG (+26,8 e +25,5).
- **Número de evidências (Tabela 2, Figura 2, seção 4.3):** em média 15 evidências dão a melhor relação custo-acurácia; poucas deixam o modelo sem conhecimento, muitas trazem redundância e piora leve por ruído. Com N de 30 a 50 não há ganho significativo (apêndice D, Tabela 17).
- **Evidência versus grafo (seção 4.3 e apêndice B.2):** evidência sozinha tem a maior acurácia; o grafo é mais curto (21,55 tokens médios contra 26,30 por evidência, redução de 18,1%, Tabela 5) e perde um pouco; combinar os dois repete o resultado da evidência com custo extra.
- **Professor (Tabela 3, seção 4.3):** "mais forte" não significa melhor professor; ranking GPT-4o, Claude 3.5 Sonnet, DeepSeek V3, Llama 3.3 70B, Gemini 1.5 Flash. Na Tabela 9 (apêndice E), o GPT-4o marca 96,7 (ARC-C), 77,0 (MedMCQA), 53,6 (GPQA) e 88,7 (MMLU) como teto; os melhores alunos ficam a 2,0 a 2,5 pontos dele em ARC-C e MedMCQA.
- **Múltipla escolha (seção 4.4):** Gemma-2-9b-it com GPT-4o e só evidência: 94,73% no ARC-C, 77,80% no MMLU, 74,42% no MedMCQA e 40,11% no GPQA, contra 53,71%, 71,80%, 56,83% e 34,80% sem contexto. O Gemma-2-2b-it vai de 42,91% a 72,44% no MedMCQA (+29,52 pontos, apêndice B.1). Ganhos de 14,7 a 29,5 pontos no MedMCQA entre os cinco professores; modelos menores ganham mais.
- **Resposta aberta (seção 4.5, Tabela 6):** Gemma-2-9b-it 46,44 para 53,45; Qwen2.5-7B 44,67 para 52,36.
- **Fatos (Tabela 7):** GPT-3.5-Turbo 29 para 49,10 com evidência; BLOOM-7b 26 para 32,43.
- **Privacidade (seção 4.7):** de 15.090 PII injetadas, 649 sobraram após o filtro (redução de 95,7%).

## Afirmações extraídas (com localização)
- O DRAG supera o MiniRAG em até 27,7% com os mesmos modelos: resumo; seção 4.2, Tabela 1.
- O professor deve fornecer evidência e grafo, não a resposta final, para o aluno: seção 3.4.
- 15 evidências são o ponto ótimo; mais que isso piora levemente por ruído: seção 4.3, apêndice D.
- Um professor mais capaz nem sempre dá melhor aluno; qualidade e consistência da evidência importam mais: seção 4.3, Tabela 3.
- Evidência textual direta supera o grafo isolado, que só reduz custo: seção 4.3, 4.4 e apêndice B.2.
- Alunos pequenos aproximam-se do teto do professor (2,0 a 2,5 pontos no ARC-C e MedMCQA): apêndice E, Tabela 9.
- Ganhos maiores em modelos menores: apêndice B.1.
- O DRAG é livre de fine-tuning, diferente do LLMQuoter (LoRA em 15 mil amostras do HotpotQA): seção 2.

## Limitações da fonte
- **Dos autores (seção Limitações):** perda de conhecimento implícito ou sutil em tarefas criativas e subjetivas; custo computacional alto na etapa de geração e ranqueamento de evidências; risco de vazamento da resposta pela evidência apesar da instrução "não entregue a resposta", o que os autores reconhecem como ameaça à integridade da destilação. A declaração de ética lembra que o método herda vieses do professor.
- **Minhas:** (1) A "evidência" é conhecimento do professor, não recuperação de um corpus; o método não testa nada sobre buscar em documentos privados ou sobre decisões que dependem de fatos que só existem no projeto. (2) A comparação com MiniRAG, Self-RAG e CRAG mistura fonte de conhecimento (um GPT-4o por trás) com técnica de recuperação; não é um experimento controlado de recuperação. (3) Os benchmarks são de conhecimento público (ARC-C, MMLU, MedMCQA) e os professores provavelmente os viram em treino, então o ganho pode ser dica do professor sobre o gabarito, no limite do vazamento. (4) Uma única execução, sem variância ou testes (não consta); temperatura e semente não constam. (5) Os alunos são modelos abertos de 2B a 9B, não modelos da classe do Haiku 5.5.

## O que importa para o estudo 2
- **Relevância direta é baixa.** O DRAG está fora do escopo (o plano já diz que não há fine-tuning), e o que ele chama de recuperação não é busca em corpus. Mas há três usos.
- **Apoia o controle N2 e o aviso do plano sobre evidência que "entrega a resposta":** os autores reconhecem o risco de vazamento mesmo com instrução explícita. No estudo 2, se qualquer parte do lake ou dos cartões de decisão do A5 for escrita com a pergunta à frente, ela pode vazar o gabarito; escrever os cartões antes do banco de perguntas e testar o vazamento no A0.
- **H4 e H6 (quantidade de contexto):** a curva de 5 a 20 evidências, com pico em torno de 15 e queda leve por ruído (seção 4.3), apoia a ideia de varrer o k no piloto em vez de fixá-lo, e dá uma faixa a testar (por exemplo 5, 10, 15 itens). O valor vale para evidência curta (cerca de 26 tokens), não para chunks de documento.
- **Teto do professor (Tabela 9, apêndice E):** o aluno com boa evidência chega perto do professor. Isso ecoa o H2 e o H9 (Haiku com contexto perto do Sonnet), mas a evidência veio do próprio professor, então não vale como apoio direto.
- **Cartões de decisão do A5:** o resultado de que evidência curta e estruturada rende bem sugere que cartões curtos são plausíveis, mas o grafo não superou a evidência textual (seção 4.3); então o grafo continua fora do escopo.
- **Não copiar:** o desenho "professor gera a evidência".

## Contradições ou ajustes que o plano.md precisa
1. Nenhum erro no plano.md sobre esta fonte (o plano não a cita no corpo).
2. **Erro em `fontes/leitura.md` (linha da 2506.01954):** diz que o método "requer treino". O artigo afirma o contrário: o DRAG não usa fine-tuning (seção 2); o professor gera evidência e o aluno só recebe o contexto no prompt, em modo zero-shot. O motivo correto para ficar fora do escopo é que a evidência vem da memória do professor, e não de um corpus do projeto.
3. Sugestão ao plano: no piloto, testar pelo menos dois valores de k (por exemplo 5 e 10 ou 15) no A3 e no A4, em vez de fixar um; registrar o valor escolhido antes da rodada principal.
