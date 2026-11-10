---
id: rag2-2607.24882
titulo: "Agent Retrieval Bench: Evaluating Repository Context Retrieval for Coding Agents"
autores: "Bowen Qin, Yi Xie"
ano: 2026
tipo: academico
url: https://arxiv.org/abs/2607.24882
doi: 10.48550/arXiv.2607.24882
acessado: 2026-11-08
nivel_evidencia: B
vies: "Preprint v1 (27/07/2026), dois autores, sem revisão por pares conhecida. Os autores são os criadores do benchmark e dos baselines. Os rótulos de relevância foram auditados com apoio de modelo. O estudo de intervenção é piloto de uma execução por par amostra-braço. Domínio é código, não decisões de projeto."
verificada: true
---
# Agent Retrieval Bench: Evaluating Repository Context Retrieval for Coding Agents

> tipo: academico. nivel_evidencia: B (benchmark com método, dados e código abertos e controles de vazamento descritos, mas poucas amostras, sem intervalos e com o piloto de intervenção sem repetição). Texto lido por inteiro, incluindo apêndices A a E. As tabelas vêm de extração de PDF, em que as colunas aparecem em listas verticais; reconstruí as linhas pela ordem dos modelos e conferi contra os números citados no texto.

## Resumo
O artigo propõe um benchmark de recuperação de arquivos de um repositório, para a etapa que antecede a edição de código por agentes. São 427 amostras em 25 repositórios: 345 positivas em quatro tarefas (code2test, comment2context, trace2code, edit2ripple) e 82 sem resposta (50 naturais e 32 de controle contrafactual com repositório errado). Compara BM25, uma heurística lexical, um mapa estrutural do repositório (RepoMap), cinco modelos de embeddings abertos e trajetórias registradas de agentes. Nenhum método domina: a ordem muda por tarefa e por orçamento de contexto. Uma fusão simples de ranks entre vetor e estrutura melhora o resultado. Limiares de abstenção baseados na pontuação de recuperação funcionam nos controles contrafactuais, mas pioram o resultado nos casos naturais. Um piloto de 45 amostras sugere que contexto vindo de recuperação ajuda mais e com menos exploração que contexto aleatório, e que o contexto-ouro ainda deixa muita margem.

## Método
- **Tarefa:** dado uma consulta derivada de um sinal real de trabalho (PR, comentário de revisão, falha reproduzida, edição ancorada) e o repositório congelado no commit-base, ranquear os arquivos que o agente precisa ler a seguir. Unidade é o arquivo, não o trecho (seção 3).
- **Dados (seções 4 e 5, Tabela 2):** code2test 106, comment2context 80, trace2code 101, edit2ripple 58, abstenção natural 50, abstenção contrafactual 32. 25 repositórios, 6 linguagens (13 Python, 3 Go, 3 Rust, 3 TypeScript, 2 Java, 1 JavaScript), 271 pares repositório-commit. Corpus completo: 308 snapshots, 391.932 arquivos, 7.922.369 trechos, com 81,99% de textos de trecho duplicados. Repositórios escolhidos de propósito, não ao acaso. Gin dá 88 das 345 positivas, e os quatro maiores repositórios dão 58,8%.
- **Controles de vazamento (seção 6, Tabela 3):** zero linhas inválidas de esquema, zero vazamentos de caminho-ouro, patch, hash de commit ou artefato gerado por modelo. Auditoria de evidência com apoio de modelo, sem gerar texto de consulta. Os autores avisam que isso não garante que todos os arquivos úteis foram rotulados.
- **Baselines (seção 7, Apêndice C):** BM25; "lexical" (heurística tipo TF-IDF com bônus de caminho, nome e símbolo, que os autores dizem não ser BM25 padrão); RepoMap (estrutura, sem vetor, inspirado no repo map do Aider); embeddings Qwen3-Embedding-4B e 8B, jina-code-embeddings-0.5b, pplx-embed-v1-4b e nomic-embed-code, sem prefixo de instrução, normalizados em L2, pontuação do arquivo = máximo entre seus trechos. Revisões de checkpoint, pooling e limite de sequência estão na Tabela 24. A linha do pplx é provisória por aviso de tokenizador. Sem reranqueador de modelo.
- **Fusão:** RRF com constante 60, sobre os top 20 de Qwen3-8B e RepoMap (8.4). RRF-3 usa também Qwen3-4B.
- **Métricas (seção 3):** Recall@5, @10 e @20, MRR, Any@k, nDCG@20, BCY@B (rendimento de contexto dentro de um orçamento de tokens, com 4k, 8k, 16k e 32k, empacotando arquivos por rank), PES (economia potencial de exploração do agente). Para abstenção: balanced accuracy, sucesso seletivo @20, cobertura, com validação cruzada em 5 partes agrupada por repositório (8.8).
- **Agentes registrados (8.5, 8.7):** OpenAI GPT-5.4-mini em modo estrito, Codex CLI GPT-5.4 e GPT-5.5 (trajetórias recuperadas). Piloto de intervenção com Codex GPT-5.5 em contêiner Docker, ferramentas fechadas (listar diretório, grep, ler arquivo, submeter), no máximo 16 chamadas, 20 turnos, 8k tokens de leitura depois da semente, 1.200 tokens por arquivo, conjunto final de 3 arquivos.
- **k, tamanho de chunk dos embeddings:** chunk com limite de sequência por modelo (32.768 a 40.960 tokens, Tabela 24). Tamanho de chunk em caracteres para o diagnóstico antigo: 8.000. Temperatura do agente e semente: não constam, e os autores avisam disso.
- **Número de execuções:** uma por amostra e braço no piloto (n = 45). Nos baselines estáticos a execução é determinística. Intervalos de confiança e testes de significância: não constam, e os autores o dizem de forma explícita (seção 11).

## Resultados
**Placar geral de 345 amostras positivas (seção 8.1, Tabela 4).** Ordem dos modelos: Qwen3-4B, Qwen3-8B, pplx-4B, RepoMap, Nomic, Jina-0.5B, lexical, BM25.
- Recall@5: 0,3182 / 0,3565 / 0,3066 / 0,3134 / 0,2777 / 0,2449 / 0,2292 / 0,1899.
- Recall@20: 0,6306 / 0,7029 / 0,6072 / 0,6333 / 0,5244 / 0,4823 / 0,4940 / 0,4452.
- MRR: 0,2379 / 0,2336 / 0,2267 / 0,2158 / 0,1986 / 0,1914 / 0,1574 / 0,1520.
- BCY@8k: 0,3409 / 0,3732 / 0,3549 / 0,3788 / 0,2781 / 0,2783 / 0,2650 / 0,2051.
- Qwen3-4B lidera o MRR, Qwen3-8B o Recall@20 e o RepoMap o BCY@8k. A margem de MRR é estreita (0,2379 contra 0,2336).

**Ponderando repositórios por igual (8.1, Tabela 5):** Recall@20 passa a ser liderado por Qwen3-4B (0,6344) contra Qwen3-8B (0,6193); o RepoMap cai de 0,6333 para 0,4619. A liderança por amostra é, em parte, efeito dos repositórios mais frequentes.

**Vencedores por tarefa (8.2, Tabela 6):** code2test e MRR geral: Qwen3-4B; comment2context: jina-code-embeddings-0.5b (MRR 0,3043); trace2code: RepoMap (MRR 0,2742); edit2ripple: pplx-embed-v1-4b (MRR 0,2877, provisório). Em trace2code (8.10, Tabela 20), RepoMap tem Recall@20 de 0,8366 e MRR de 0,2742, contra Qwen3-4B com Recall@20 de 0,5050 e MRR de 0,0827.

**Fusão de ranks (8.4, Tabela 9; 287 amostras de três tarefas):** RRF de Qwen3-8B e RepoMap leva o MRR de 0,2296 (melhor execução única) para 0,2713, e o Recall@20 de 0,7070 para 0,7331. Em trace2code, Recall@20 de 0,8795 contra 0,8366 (RepoMap) e 0,7970 (Qwen3-8B). Em code2test o MRR fica pouco abaixo do Qwen3-4B. BCY@8k: RRF 0,4884, RepoMap 0,3828, Qwen3-4B 0,3079, lexical 0,2282 e grep 0,2157 (Tabela 10). É uma análise a posteriori, uma única execução.

**Por relação de relevância (8.3, Tabelas 7 e 8):** embeddings e fusões vencem casos semântico-diretos e convencionais de fluxo; o RepoMap vence os causais indiretos (trace2code). A taxonomia é determinística, os grupos se confundem com a tarefa, e os autores pedem para lê-la como descritiva.

**Arquivo contra trecho (8.6, Tabelas 11 e 12):** o arquivo-ouro mediano tem 515 linhas, e a evidência mediana ocupa 27 linhas (4,7% do arquivo). A ordem dos métodos muda por F1 de linhas: Qwen3-8B lidera Recall@20 de arquivo (0,7070) mas fica em quarto em F1 de linhas (0,0165), enquanto Qwen3-4B lidera F1 de linhas (0,0276). Os valores absolutos de precisão e F1 de linhas são baixos para todos.

**Agentes e custo (8.7, Tabelas 13 a 15):** nas 287 amostras, eventos por amostra: GPT-5.4-mini estrito 3,2 (pelo menos um arquivo-ouro tocado em 64,8%), Codex GPT-5.4 6,2 (72,8%), Codex GPT-5.5 6,5 (70,7%). Agentes nunca tocam arquivo-ouro em 35,2% (OpenAI) e 27,2 a 29,3% (Codex). Mediana do primeiro acerto: passo 2 (OpenAI) e 3 (Codex), só entre os bem-sucedidos. Complementaridade com Codex GPT-5.4 e top 20: o recuperador acerta onde o agente erra em 12 a 18% dos casos, e o agente acerta onde o recuperador erra em 8 a 22%.

**Piloto de intervenção (8.7, Tabelas 16 e 17; n = 45, 15 por tarefa, uma trajetória por par):**
| Braço | F1 final | Any-gold | Chamadas após a semente |
|---|---|---|---|
| Sem semente | 0,3222 | 0,5111 | 3,71 |
| Aleatória, sem ouro | 0,3437 | 0,7333 | 8,49 |
| Lexical | 0,3981 | 0,8000 | 6,24 |
| Qwen3-8B | 0,3726 | 0,7556 | 5,51 |
| RRF (Qwen3-8B + RepoMap) | 0,3967 | 0,8000 | 5,42 |
| Oracle (ouro) | 0,6337 | 1,0000 | 4,18 |

Os pares sem semente e semente variam nos dois sentidos: contexto aleatório piorou 33,3% das amostras e melhorou 26,7% (Tabela 17); RRF melhorou 42,2% e piorou 33,3%. O oracle não chega a precisão final perfeita. A ordem de colunas de "primeiro acerto" e "chamadas" na extração é ambígua; cito só F1, Any-gold e chamadas.

**Abstenção (8.8, Tabela 19):** no protocolo misto, o lexical sobe o sucesso seletivo de 0,461 para 0,496. Ao retirar os 32 controles contrafactuais e recalibrar só com casos naturais, nenhum ranker melhora: lexical cai de 0,499 para 0,294, Jina de 0,489 para 0,334, BM25 de 0,463 para 0,220. O lexical abstém em todos os 32 controles contrafactuais, mas em só 34% dos 50 naturais. O Jina abstém corretamente em 94,0% dos casos naturais sem resposta e deixa passar só 37,7% dos positivos. Conclusão dos autores: a pontuação máxima da recuperação não basta como sinal de abstenção para casos naturais.

**Diagnóstico de ferramentas fechadas (Apêndice E, Tabelas 26 a 28):** Codex fechado, F1 final 0,3279 e Any-gold 0,5470 nas 287 amostras, com ganho concentrado entre duas e quatro chamadas. grep roteirizado, F1 0,0719 (limite inferior deliberado).

## Afirmações extraídas (com localização)
- Nenhuma família de recuperação domina por tarefa ou por orçamento: resumo, 8.2, conclusão.
- Fusão simples vetor mais estrutura melhora MRR e Recall@20: 8.4, Tabela 9.
- Agentes interativos nunca tocam arquivo-ouro em 27 a 35% das amostras: seção 1, 8.7, Tabela 13.
- Contexto-semente por recuperação gera F1 maior, contato mais cedo com o ouro e menos exploração que contexto aleatório, em piloto de 45 amostras e uma execução: 8.7, Tabelas 16 e 17. Os autores avisam que pequenas diferenças entre braços de recuperação não são resolvidas estatisticamente.
- Mesmo contexto aleatório sem ouro melhora o F1 e o contato com o ouro, então o piloto é um teste conservador da qualidade da semente: 8.7, texto após a Tabela 17.
- Limiares da pontuação do recuperador funcionam nos controles contrafactuais, mas falham nos casos naturais; o resultado misto não sobrevive à análise controlada: 8.8 e conclusão.
- Acerto em nível de arquivo pode inflar a precisão dentro do arquivo: 8.6, seção 11.
- O ranking geral não é uniforme entre repositórios: 8.1, Tabela 5, seção 11.
- Os autores não reivindicam efeito de recuperação sobre sucesso de correção de código: seção 1, 8.7 (limite de evidência).

## Limitações da fonte
**Dos autores (seção 11 e 8.x):** benchmark diagnóstico, não de grande escala; repositórios desbalanceados; unidade de arquivo e não de trecho; rótulos aproximam "arquivos que precisam ser lidos" e podem omitir arquivos úteis; corpus fixo no commit-base, sem exploração iterativa no placar principal; piloto com uma trajetória por par, sem temperatura nem semente registradas, logo sem intervalos nem diferenças estatisticamente significativas; taxonomia de relevância determinística e confundida com a tarefa; linha do pplx provisória; BCY de 16k e 32k são limites inferiores; não mede sucesso de correção.

**Minhas:**
- Domínio é código (testes, rastros de falha, revisão de PR). Nenhuma tarefa é de decisão com opções fechadas, e nenhuma lida com decisões substituídas.
- O artigo mede recuperação, não geração: nenhum LLM responde com o contexto recuperado, exceto o piloto de agente de código com Codex. Nenhum modelo da família Claude é usado.
- Nenhum reranqueador de modelo foi avaliado; a fusão (RRF) é a posteriori e sobre execução única; sem intervalos de confiança nos placares estáticos.
- O "lexical" não é BM25 padrão e não é comparável diretamente com o BM25 da tabela.
- Autores criaram o benchmark e escolheram os baselines; o conjunto tem poucas amostras por tarefa (58 a 106), então diferenças de poucos pontos entre métodos próximos (MRR 0,2379 contra 0,2336) são frágeis.
- O pplx não é confiável (aviso de tokenizador) e fica fora de conclusões firmes.

## O que importa para o estudo 2
**Copiar do método**
- **Controles de vazamento documentados** (caminho-ouro, patch, hash, artefatos gerados) e a prática de relatar os resultados de verificação em uma tabela. Equivale ao teste de vazamento do plano (A0 perto do acaso). Adotar a lista de verificações como lista do plano.
- **Separar abstenção natural de abstenção contrafactual** e reportar cada uma. Para as 20 perguntas sem resposta, escrever casos plausíveis dentro do projeto cuja resposta não está no lake, em vez de perguntas óbvias de outro assunto; caso contrário o portão do A6 parece melhor do que é.
- **Fusão por rank (RRF, constante 60)** como método de combinação do A4: foi usada aqui, simples e sem treino, e o artigo mostra ganho de MRR e Recall@20 sobre o melhor executor único em código.
- **Relatar métricas ponderadas por amostra e por categoria** (aqui, por tarefa e por repositório). No banco do estudo 2, reportar acerto por bloco (60 comuns, 20 conflito, 20 sem resposta) e por documento-fonte, não só o agregado.
- **Medir recuperação em duas granularidades** (documento e trecho com evidência), já que acerto no nível do arquivo pode superestimar.
- **Piloto com um braço de contexto aleatório**, que é o N1 do plano, e um braço oráculo, que é o A1, no mesmo protocolo. O artigo faz as duas coisas.

**Que braço ou hipótese isso apoia ou contradiz**
- **H7 e A6 (portão de abstenção): contradiz a versão ingênua.** O corte pela pontuação máxima da recuperação falhou nos casos naturais sem resposta. Se o A6 usar "confiança baixa" como a pontuação de recuperação, a expectativa razoável é que perca acertos nas perguntas respondíveis (resultado no artigo: Jina deixa passar só 37,7% dos positivos). A H7 já prevê o risco de perder mais de 10 pp, mas o plano deve definir de antemão qual é o sinal de confiança (por exemplo, o próprio modelo declarar insuficiência, ou o reranqueador) e calibrá-lo só nos casos naturais, em partição separada do banco final.
- **H4 e A4 (híbrido contra vetorial): apoia o sentido**, em código: a fusão melhora MRR e Recall sobre a melhor linha única, e o estrutural e o vetorial acertam coisas diferentes. Não prova que BM25 mais vetor ganhe em texto de projeto, e o ganho no artigo é de métricas de recuperação, não de acerto de resposta.
- **H8 (controle N1):** contradiz a premissa de que contexto irrelevante é inerte. No piloto, contexto aleatório sem ouro elevou o Any-gold de 0,5111 para 0,7333 e o F1 em 0,0215, embora tenha piorado 33,3% das amostras. O cenário é de agente que explora um repositório, não de escolha de letra com contexto colado, então a transferência é indireta. Mantém-se o N1, mas o limite de "dentro de 5 pp" deve ser tratado como suposição a ser verificada no piloto.
- **H1 e H3 (oráculo como teto):** apoia a cautela. O oráculo chegou a F1 de 0,6337 e precisão final imperfeita, ou seja, mesmo com os documentos certos o agente ainda erra a seleção. No estudo 2, o A1 mede raciocínio com os documentos certos, e não deve ser tomado como 100%.
- **Tema transversal:** nenhum recuperador domina, e a ordem muda por tipo de pergunta. Apoia reportar acerto por bloco (comum, conflito, sem resposta) em vez de só o agregado.

## Contradições ou ajustes que o plano.md precisa
1. **A6 e H7:** acrescentar que o sinal de abstenção precisa ser calibrado e avaliado separadamente em casos "plausíveis mas sem resposta", e que o limiar por pontuação bruta de recuperação já falhou em outro benchmark. Definir qual é o sinal antes do congelamento.
2. **Banco de perguntas, 20 sem resposta:** exigir que sejam casos naturais (tema do projeto, resposta ausente) e não perguntas de outro assunto. Registrar a razão da ausência, como o artigo faz com o campo de motivo.
3. **H8:** o piloto de 15 perguntas deve medir o N1 com atenção; o artigo traz evidência de que contexto aleatório pode mexer no resultado em ambas as direções.
4. **Recall@k do documento-ouro:** reportar também no nível do trecho, para não superestimar a recuperação.
5. **Análise:** reportar resultados por bloco e, quando houver mais de um projeto ou módulo, por módulo. A liderança agregada do artigo mudou ao ponderar repositórios por igual.
6. **Linguagem no plano:** não citar este artigo como base para o desempenho de RAG com LLM geradores. Ele mede recuperação de arquivos de código e, no máximo, um agente Codex.
