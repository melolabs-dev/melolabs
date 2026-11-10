---
id: rag2-2401.05856
titulo: "Seven Failure Points When Engineering a Retrieval Augmented Generation System"
autores: "Barnett, Kurniawan, Thudumu, Brannelly, Abdelrazek"
ano: 2024
tipo: academico
url: https://arxiv.org/abs/2401.05856
doi: 10.48550/arXiv.2401.05856
acessado: 2026-11-08
nivel_evidencia: C
vies: "relato de experiência (CAIN 2024, formato do ACM com DOI de modelo ainda não preenchido); três estudos de caso, dois deles confidenciais e sem dados; o único experimento (BioASQ) não traz números no texto; avaliação do experimento com o GPT-4 e revisores que não são especialistas; contagem de documentos do BioASQ inconsistente entre as seções"
verificada: true
---
# Seven Failure Points When Engineering a RAG System

> tipo: academico. nivel_evidencia: C (relato técnico com observações de três sistemas; o artigo não apresenta medições numéricas dos pontos de falha). Verificada em 08/11/2026: o PDF foi aberto no arxiv.org e o título confere. Texto lido por inteiro (6 páginas, tabelas e referências). O arquivo de texto extraído embaralha as colunas da Tabela 2; o que cito dela são frases legíveis, e o pareamento exato entre cada lição, ponto de falha e estudo de caso não foi confirmado.

## Resumo
Relato de engenharia de três sistemas de RAG de domínios diferentes (Cognitive Reviewer, para pesquisa; AI Tutor, para educação; e um sistema de perguntas e respostas biomédicas sobre o BioASQ). Os autores catalogam sete pontos de falha (FP1 a FP7), registram lições para quem constrói RAG e propõem uma agenda de pesquisa (chunking e embeddings, RAG contra ajuste fino, testes e monitoramento). As duas conclusões centrais: a validação de um sistema de RAG só é viável em operação, e a robustez evolui em vez de ser projetada de uma vez.

## Método
- **Tipo de estudo:** relato de experiência com três estudos de caso (seção 4, Tabela 1). Cognitive Reviewer e AI Tutor são sistemas em uso na Deakin University (o AI Tutor com piloto de 200 estudantes a partir de 30/10/2023); o BioASQ é um sistema montado para explorar escala maior. Os dois primeiros foram excluídos dos dados abertos por confidencialidade (seção 4).
- **Experimento do BioASQ (seções 1, 4.3):** perguntas e respostas de especialistas do BioASQ, com respostas de tipo sim/não, resumo, factual e lista; GPT-4 como gerador; avaliação automática com OpenAI evals; inspeção manual de todas as respostas marcadas como incorretas, de 40 casos e de uma amostra das corretas. Código, dados e exemplos de cada ponto de falha estão em um repositório do figshare.
- **Tamanho do experimento:** inconsistente no texto. A seção 1 e a conclusão dizem 15.000 documentos e 1.000 perguntas; a seção 4.3 e a Tabela 1 dizem 4.017 documentos e 1.000 perguntas. Não é possível saber qual vale sem abrir o repositório.
- **Parâmetros relevantes (k, tamanho de chunk, temperatura, número de execuções, modelo de embedding):** não constam. O artigo só diz que há de se calibrar tamanho de chunk, estratégia de embedding, estratégia de recuperação, estratégia de consolidação, tamanho de contexto e prompts (seção 6, Tabela 2).
- **Métricas:** não há métrica quantitativa reportada; os resultados são padrões de falha identificados por inspeção.

## Resultados (onde estão)
- **Seção 5, catálogo de falhas:** FP1 Conteúdo ausente (pergunta sem resposta nos documentos; o sistema pode ser enganado a responder quando a pergunta é relacionada mas não respondida); FP2 Documento relevante fora do topo (a resposta existe mas não ficou entre os k retornados); FP3 Fora do contexto por consolidação (o documento foi recuperado mas não entrou no contexto); FP4 Não extraída (a resposta está no contexto, o modelo não a extrai, em geral por ruído ou informação contraditória); FP5 Formato errado; FP6 Especificidade incorreta; FP7 Incompleta (a resposta não está errada mas omite informação que estava no contexto).
- **Seção 4.3:** a avaliação automática foi mais pessimista que a humana nesse domínio; ressalva do próprio texto: os revisores não eram especialistas, então o modelo pode saber mais que eles.
- **Tabela 2 (lições):** (a) contexto maior deu respostas mais precisas, 8K contra 4K, "contrário a trabalho anterior com GPT-3.5" (citando Liu et al., 2023, "Lost in the Middle"); (b) cache semântico reduz custo e latência; (c) jailbreaks podem contornar o sistema de RAG e chegar ao treino de segurança do modelo, e há pesquisa citada de que ajuste fino reverte treino de segurança; (d) acrescentar nome do arquivo e número do chunk ao contexto recuperado ajudou o leitor a extrair a informação; (e) modelos de embedding abertos tiveram desempenho tão bom quanto os fechados em textos curtos (o título da linha diz "melhores"; a descrição diz "tão bom quanto"); (f) sistemas de RAG exigem calibração contínua; (g) recomenda-se um pipeline de RAG configurável; (h) montar soluções sob medida é subótimo e o desempenho só se testa em tempo de execução; (i) técnicas de avaliação offline como G-Eval partem de pares pergunta-resposta rotulados.
- **Seção 6:** agenda de pesquisa. Chunking heurístico contra semântico; embeddings dependentes de domínio; RAG contra ajuste fino (sem comparação feita, pede-se estudo sistemático em acurácia, latência, custo e robustez); testes e monitoramento.
- **Números:** nenhum resultado numérico de acerto, recall ou taxa de cada ponto de falha consta no texto.

## Afirmações extraídas (com localização)
- Os sistemas de RAG buscam reduzir alucinação, ligar fontes às respostas e dispensar anotar documentos com metadados: resumo e seção 1 (descrito como objetivo declarado dos sistemas).
- Sete pontos de falha de engenharia de RAG: seção 5.
- A validação de um sistema de RAG só é viável durante a operação, e a robustez evolui em vez de ser projetada no início: resumo, seção 6, Tabela 2.
- Contexto maior (8K contra 4K) melhorou as respostas no AI Tutor: Tabela 2, primeira lição.
- Adicionar metadados (nome do arquivo e número do chunk) ao contexto recuperado ajudou a extração: Tabela 2.
- Se os chunks são pequenos demais, algumas perguntas não podem ser respondidas; se são longos demais, a resposta inclui ruído gerado: seção 3.1.
- Trocar o modelo de embedding exige reindexar todos os chunks: seção 3.1.
- Os testes de RAG precisam de dados que não existem de antemão e têm de ser descobertos por geração sintética ou por piloto: seção 3.2 e seção 6.3.

## Limitações da fonte
**Do autor:** dois dos três casos são confidenciais e não têm dados abertos (seção 4); a avaliação do experimento com o GPT-4 foi mais pessimista que a humana, e os revisores humanos não eram especialistas (seção 4.3); as lições do AI Tutor vêm de um sistema em desenvolvimento, com os resultados do piloto prometidos para depois (seção 4.2); como as técnicas de avaliação offline dependem de pares rotulados, a validação em operação é a saída apontada (Tabela 2, seção 6.3).

**Minhas:**
- Não há medição reportada: nenhum número de recall, acerto ou frequência por ponto de falha, então a taxonomia é qualitativa e não permite dizer qual falha pesa mais.
- A contagem de documentos do BioASQ é inconsistente (15.000 contra 4.017).
- Sem modelo, versão, parâmetros ou tamanho de chunk para os casos, não dá para reproduzir; só o BioASQ tem repositório.
- As lições têm base de um caso cada (por exemplo contexto 8K contra 4K só no AI Tutor), sem comparação controlada; não as trato como efeitos.
- O artigo é de janeiro de 2024; as lições sobre limite de tokens e contexto de 4K a 8K estão desatualizadas para modelos atuais.
- O DOI do ACM no texto é um modelo ainda não preenchido; o DOI registrado aqui é o do arXiv.

## O que importa para o estudo 2
- **Taxonomia para a análise de erros dos braços A3 a A6.** Os pontos de falha viram rótulos das respostas erradas: FP1 corresponde às 20 perguntas sem resposta (e ao portão do A6, H7); FP2 e FP3 são falhas de recuperação e de consolidação (recall@k, k, reranqueamento); FP4 é erro de leitura com o documento-ouro no contexto, que o braço A1 (oráculo) isola, e inclui o caso de informação contraditória, que são as 20 perguntas de decisão antiga contra vigente (H5) e o controle N2 (H8); FP5 é formato da resposta (letra fora do padrão) e deve ser registrado como taxa de falha de formato. FP6 e FP7 pouco se aplicam a perguntas de opção fechada. A taxonomia dá nomes aos erros, não fornece evidência dos efeitos.
- **Suporta o foco em curadoria (A5):** a lição de que acrescentar nome do arquivo e número do chunk ao contexto ajudou o leitor, e a recomendação de metadados, vão na mesma direção da curadoria por metadados do plano. É evidência anedótica (um sistema, sem números). O artigo ainda lista como objetivo do RAG "dispensar anotar documentos com metadados", premissa que o estudo 2 testa e que a lição de metadados contraria.
- **Apoia H6 de forma fraca e contraditória com a literatura de contexto longo:** "contexto maior melhorou" (8K contra 4K) vem de um sistema, sem números, e é citado pelos autores como contrário ao "Lost in the Middle". Não decide H6; reforça que o A2 (lake inteiro) precisa ser medido, não presumido.
- **Avaliação por juiz de modelo:** o experimento do BioASQ mostra juiz automático mais pessimista que o humano, com a ressalva dos revisores não especialistas. O estudo 2 usa opções fechadas e gabarito escrito antes, o que dispensa juiz de modelo para o acerto; a citação do documento correto também deve ser conferida por regra (identificador do documento), não por juiz.
- **Validação em operação:** a tese de que o RAG só se valida em operação é um limite para as conclusões do estudo 2: o resultado vale para um banco offline de 100 perguntas sobre um lake congelado, não para uso real com perguntas imprevisíveis.
- **Chunking e embeddings:** o artigo alerta que o tamanho do chunk e o modelo de embedding mudam tudo e que trocar o embedding exige reindexar; o plano deve fixar ambos antes do piloto e reportá-los.

## Contradições ou ajustes que o plano.md precisa
- Não encontrei erro factual do plano relacionado a este artigo (o plano não o cita nos cinco achados). Sugestão: acrescentar a taxonomia FP1 a FP7 à seção de análise e às métricas (classificar cada erro dos braços de RAG como falha de recuperação, de consolidação, de leitura, de ausência de conteúdo ou de formato).
- Incluir nas limitações do plano que o estudo é offline: o artigo afirma que a validação de RAG só se completa em operação.
- Fixar e reportar chunk, embedding, k e estratégia de consolidação (como o artigo lista, a calibração desses itens muda o resultado); hoje o plano deixa "chunks brutos" e "top-k" sem valores.
- Observar que o argumento de H6 e o achado 4 do plano (contexto longo degrada) têm um contraexemplo anedótico neste artigo (8K melhor que 4K no AI Tutor); isso não muda o desenho, só reforça medir o A2.
