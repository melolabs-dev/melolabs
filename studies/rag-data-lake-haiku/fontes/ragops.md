---
id: rag2-2506.03401
titulo: "RAGOps: Operating and Managing Retrieval-Augmented Generation Pipelines"
autores: "Xiwei Xu, Hans Weytjens, Dawen Zhang, Qinghua Lu, Ingo Weber, Liming Zhu"
ano: 2025
tipo: academico
url: https://arxiv.org/abs/2506.03401
doi: 10.48550/arXiv.2506.03401
acessado: 2026-11-08
nivel_evidencia: D
vies: "Artigo conceitual de arquitetura de software (preprint v1, 3 jun 2025), sem experimento, sem medição e sem dados. Os dois casos de uso (assistente tributário com startup parceira e Magda Copilot, da própria CSIRO) são relatos dos autores, sem avaliação reportada. Autores do CSIRO Data61 com interesse em consolidar o termo RAGOps."
verificada: true
---
# RAGOps: Operating and Managing Retrieval-Augmented Generation Pipelines

> tipo: academico. nivel_evidencia: D (proposta conceitual e opinião de especialistas; nenhum número de desempenho). Texto lido por inteiro, incluindo as tabelas 1 e 2, os casos de uso e as referências (percorridas).

## Resumo
O artigo define RAGOps como uma extensão do LLMOps que dá peso central ao ciclo de vida dos dados externos que o RAG consulta. Descreve a arquitetura de um sistema RAG com o modelo de visões 4+1 de Kruchten, separa dois ciclos entrelaçados (pipeline de consulta, que segue DevOps, e gestão de dados, em cinco etapas), lista atributos de qualidade (adaptabilidade, monitorabilidade, observabilidade, rastreabilidade, confiabilidade), desafios abertos e dois casos de uso. É um quadro de referência para organizar um sistema, não um resultado empírico.

## Método
Não há método experimental. O que existe: revisão curta de LLMOps e observabilidade (Seção 2), caracterização arquitetural (Seção 3), definição dos ciclos (Seção 4), qualidades (Seção 5), desafios (Seção 6) e dois casos de uso descritivos (Seção 7). Modelos, tamanhos de chunk, k, temperatura, número de execuções: não consta. A única cifra do texto é a afirmação de que 60% dos sistemas compostos de LLM em empresas usam alguma forma de RAG (resumo e Seção 1); ela é atribuída à referência [2], que na lista é o artigo original do RAG (Lewis et al., 2020), de modo que a fonte real do número não está clara.

## Resultados
Não há resultados quantitativos. O conteúdo central, com localização:

**Data lake, zona bruta e onde ele fica (Seções 3.2.2, 3.3, 3.4, 4.2.3, Figura 2).**
- O "data lake" é um repositório que fica antes da fragmentação e dos embeddings: guarda os dados já ingeridos e verificados, e alimenta o módulo "retrieval sources" (índice vetorial, grafo de conhecimento, repositório de documentos com busca por palavra-chave). A Seção 3.3 chama isso de "curated data lake".
- Vantagem declarada de separar o lake do índice, quando várias aplicações compartilham fontes: consistência, menos redundância, "fonte única de verdade", dados já validados, governança e auditoria, atualização única (Seção 4.2.3).
- "Zona bruta" como termo: não consta. O artigo não define zonas (bruta, curada, refinada) dentro do lake. A palavra "raw data" aparece uma vez, na Seção 3.4, para dizer que fontes de recuperação podem ter de ser construídas a partir de dados brutos em vários formatos. O que o artigo descreve como "bruto" é a entrada da ingestão; o que vai para o lake já passou por verificação. Portanto a divisão do plano em bruto, curado e índice é uma leitura nossa, compatível com o artigo, mas não é terminologia dele.

**Ciclo de vida dos dados (Seção 4.2, Figura 3).** Sete subetapas (ingestão, verificação, atualização do lake, atualização das fontes, teste offline, teste ao vivo, cobertura), aqui agrupadas:
1. Ingestão (4.2.1): fontes diversas (arquivos, bancos, APIs, web, tempo real, especialistas); métodos de captura (webhook, CDC, polling, observador de arquivos, rastreadores); ingestão inclui atualização e exclusão e conversão de formato (extrair texto de PDF, transcrever áudio).
2. Verificação (4.2.2), com cinco verificações: qualidade; completude (campos esperados, inclusive metadados como carimbo de tempo, autoria e fonte); recência (versões antigas não devem ser mantidas, e sim arquivadas e substituídas por versões novas, avaliada por carimbo de tempo dos metadados, carimbo embutido ou análise semântica); consistência (contradições detectadas por similaridade semântica, resolvidas por peso de confiança da fonte ou por intervenção humana); unicidade (deduplicação por hash e por embeddings com agrupamento; TF-IDF e LDA para tópicos parecidos).
3. Atualização do lake (4.2.3): aplicar atualizações e exclusões; arquivar em vez de apagar para permitir reversão; versionar cada modificação; manter consistência lógica (sem órfãos, referências a dados obsoletos corrigidas); guardar metadados de controle de acesso junto de cada entrada.
4. Atualização das fontes de recuperação (4.2.4): chunking e embedding incrementais, índice atualizado, remoção de dados obsoletos.
5. Teste offline (4.2.5) e ao vivo (4.2.6) em três níveis (módulo, componente, ponta a ponta); Tabela 1 exemplifica com embedding. Métricas de recuperação citadas na Tabela 1: MRR, recall@K, precision@K, nDCG; de resposta: fidelidade, alucinação, correção, BLEU, ROUGE, BERTScore.
6. Verificação de cobertura (4.2.7): o conjunto de teste precisa continuar representativo do uso real; exemplo de limiar do texto: se menos de 85% das consultas reais atingirem certa similaridade com as de teste, ampliar o conjunto.

**Reprodutibilidade (4.2.5).** RAG tem estocasticidade na recuperação (busca aproximada, desempate de ranking) e na geração; recomenda fixar sementes aleatórias para comparar métricas entre execuções. Conjuntos de teste específicos do domínio, mais benchmarks padrão (BEIR, MS MARCO) e dados sintéticos para casos de borda.

**Qualidades (Seção 5, Tabela 2).** Rastreabilidade: versionar fontes, registrar a ligação entre consulta, documentos recuperados, IDs de embedding, filtros e reranqueamento aplicados, e reconstruir o prompt de geração. Observabilidade: camada transversal que registra consultas, respostas e entradas e saídas de cada componente.

**Casos de uso (Seção 7).**
- Assistente tributário: dados oficiais abertos do governo, rastreador semanal, texto em banco vetorial (grafo de conhecimento descartado por ser pesado e caro para o caso), chunk definido como cada par pergunta-resposta de uma decisão privada, metadados com a decisão e o raciocínio (casos específicos) ou resumo do documento (os demais), classificador de cenário, reranqueador baseado em LLM, guarda de privacidade. Verdade de referência: perguntas e respostas certificadas do fórum aberto da receita; casos complexos com especialistas da empresa; o restante gerado por LLM. Nenhuma métrica de desempenho reportada (não consta).
- Magda Copilot: ferramentas sobre dados científicos (UniProt, BLAST, AlphaFold, SQL em tabela interna, grafo causal de PDFs); conhecimento tácito de especialistas tratado como nova fonte de recuperação. Nenhuma métrica reportada.

## Afirmações extraídas (com localização)
- RAGOps estende o LLMOps com foco em gestão de dados, porque as ferramentas de LLMOps cobrem pouco os dados criados e usados depois do treino. Resumo, Seção 1, Seção 2.1.
- Manter um data lake separado antes do chunking e dos embeddings é vantajoso quando vários sistemas compartilham fontes: fonte única de verdade, governança, auditoria. Seção 4.2.3.
- Versões antigas não devem ficar ativas na recuperação: devem ser arquivadas e substituídas pelas novas, com avaliação de recência por metadados. Seção 4.2.2 (Recência) e 4.2.3.
- Documentos que se contradizem devem ser detectados (similaridade semântica) e resolvidos por confiança da fonte ou por humano. Seção 4.2.2 (Consistência).
- Metadados esperados em cada registro: carimbo de tempo, autoria, fonte, e controle de acesso. Seções 4.2.2 e 4.2.3.
- Cada mudança no lake deve ser versionada para permitir reversão e histórico; arquivar, não apagar. Seção 4.2.3.
- Testar em três níveis e fixar sementes por causa da estocasticidade. Seção 4.2.5.
- Não existem métricas padronizadas de avaliação para recursos de recuperação, processo de recuperação e geração; decisões iniciais (chunking, modelo de embedding) afetam todas as etapas seguintes e são difíceis de avaliar. Seção 6.2.
- O reranqueamento prioriza o recuperado e remove redundância e dados irrelevantes; pode usar regras, modelos de ML ou LLM. Seção 3.2.1.
- Humanos com conhecimento tácito podem ser fonte de recuperação ativa. Seções 3.1, 5.2.

## Limitações da fonte
**Do autor.** Falta mecanismo para detectar inserção maliciosa de dados na etapa de verificação; tooling específico de RAGOps ainda não existe; efeitos de abordagens agênticas em aberto (Seção 8). Também reconhecem a falta de métricas padrão (Seção 6.2).

**Minhas.**
1. Zero evidência de que a verificação de recência, a curadoria ou o data lake melhorem a acurácia da resposta. As recomendações são raciocínio de engenharia, não achado.
2. Casos de uso sem avaliação reportada; foram projetos dos próprios autores ou de parceiro, descritos de forma a ilustrar o quadro.
3. A cifra de 60% de adoção está atribuída a uma referência que não pode ser a fonte (artigo de 2020, Lewis et al.); tratar como não verificada.
4. Foco em operação contínua em produção (dados mudando sem parar); o estudo 2 é um instantâneo congelado de um corpus pequeno, então grande parte do ciclo (CDC, shadow testing, A/B, cobertura ao vivo) não se aplica.
5. Não discute custo de curadoria nem quanto ela rende; não compara RAG com colar o contexto inteiro.

## O que importa para o estudo 2
**Copiar do método (como vocabulário e checklist, não como evidência).**
- Descrever o lake com as etapas ingestão, verificação, atualização do lake e atualização do índice; registrar no estudo o que cada uma fez.
- Cinco verificações na etapa de verificação (qualidade, completude, recência, consistência, unicidade) viram um checklist da montagem do lake.
- Metadados mínimos por documento: data, autoria ou origem, fonte, status (vigente ou substituído) e, se couber, módulo. O plano já tem tipo, data, status, `supersedes` e módulo; acrescentar origem e versão do documento. O artigo cita carimbo de tempo, autoria, fonte e controle de acesso.
- Recência por arquivamento: documento substituído sai do índice ativo e fica no arquivo, com histórico. Isto é exatamente o filtro de vigência do A5.
- Rastreabilidade por pergunta: guardar a consulta, os documentos recuperados com ID, filtros e reranqueamento aplicados e o prompt final montado. Permite calcular recall@k e a citação correta depois.
- Fixar sementes e registrar versões do índice e do modelo de embedding; testar em três níveis (módulo, componente, ponta a ponta): o plano já separa recall@k (componente) de acerto (ponta a ponta).
- Verificações de consistência e duplicatas na montagem do lake (hash e similaridade); aplicar ao banco de perguntas também, para achar documentos quase idênticos que viram vazamento.

**Braços e hipóteses.** Apoia conceitualmente o A5 e a H5 (curadoria com vigência ajuda nos casos de conflito); a fonte, porém, não traz número e não prevê o tamanho do efeito. Não apoia nem contradiz H1 a H4, H6 a H9. Notar que o "N2" do plano (documentos substituídos misturados ao oráculo) é o cenário que o RAGOps manda evitar; serve como medida do que se perde sem a verificação de recência.

## Contradições ou ajustes que o plano.md precisa
1. O plano chama a primeira zona de "Bruto", com "documentos do projeto como estão". O RAGOps não usa "zona bruta"; o lake dele já contém dados verificados e, segundo o artigo, versões antigas arquivadas, não ativas. Ajuste de texto: dizer que a divisão em bruto, curado e índice é desenho próprio, inspirado no ciclo ingestão, verificação, lake, índice do RAGOps, e não termo emprestado.
2. A A2 (lake inteiro colado) e o A3 (RAG ingênuo) usam o lake bruto, com decisões substituídas dentro. Conforme o RAGOps, isso é um sistema sem a etapa de verificação de recência; o plano deve explicitar que A3 e A4 operam sem verificação por escolha de desenho (para isolar o efeito da curadoria no A5), e não porque seja a prática recomendada.
3. O plano trata "separar recuperação de curadoria" como a contribuição; o RAGOps não oferece evidência a favor da curadoria. Cuidar para não escrever no artigo que "a literatura (RAGOps) indica que curadoria melhora" a resposta. A frase correta é: a literatura de engenharia recomenda, sem medir.
4. Falta uma linha de custo da curadoria (horas de escrita de metadados e cartões de decisão) para a H9 e o custo por decisão certa; o RAGOps lista a verificação como etapa operacional mas não dá custo.
5. Teste de cobertura (4.2.7): vale uma verificação simples de que as 100 perguntas cobrem os tipos de documento do lake (código, issues, PRs, CLAUDE.md, log de decisões).
