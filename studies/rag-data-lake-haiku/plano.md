# Estudo 2: Haiku com um mini data lake (RAG) para decidir melhor

> Rascunho v2 do plano, 08/11/2026, revisado depois da leitura integral dos 18 artigos (`fontes/leitura.md`). Nada aqui foi pré-registrado nem aprovado. Prazo: dados congelados na sexta 13/11, texto no sábado 14/11, publicação no domingo 15/11.

## Pergunta
Um mini data lake com as informações do projeto, ligado ao Haiku por RAG, faz o Haiku tomar decisões de projeto tão boas quanto o Sonnet, a um custo menor?

Fecha a H2 do estudo 1 (decisões com opções fechadas), que ficou "não testada". Retoma também a candidata C1 (pacote de contexto mínimo) e a C5 (exemplos recuperados por similaridade) do estudo 1.

## O que a literatura sustenta e o que não sustenta
Fichas em `fontes/`. Em resumo, depois de ler tudo:

1. **Recuperação ajuda, mas pouco e de forma desigual.** No melhor caso (modelos enxutos com coleção de domínio) quase todo o ganho vem da recuperação. Em ADR, o ganho é pequeno nos modelos grandes e nulo nos abertos de 8 e 9B.
2. **RAG pode não ajudar um modelo pequeno** (4B médico: +0,9 e −1,9 pp, sem significância; o modelo já acertava 46% a 53% das 4 opções sem contexto). Por isso o A0 pode ficar bem acima do acaso e as perguntas têm de depender de fatos do projeto.
3. **Recuperar pode piorar** (repositório: RAG por arquivo 5,66 contra 6,67 a 6,94 do modelo sozinho; Self-RAG: recuperar sempre custa cerca de 3,5 pontos). O lake precisa ser medido, não assumido.
4. **Contexto de ADR:** janela recente, recuperação e "colar tudo" empatam nas médias, sem teste no corpo do artigo. Não é prova de que contexto importa mais que tamanho do modelo; a tarefa lá é gerar texto, não escolher.
5. **Ruído:** o efeito depende de haver evidência junto e da posição; distrator é trecho parecido que não responde, e não decisão conflitante. O N2 abaixo mede algo mais forte que os distratores da literatura.
6. **Posição e tamanho do contexto:** o efeito do meio existe em modelos de 2023 e pode não existir no Haiku 5.5.
7. **Híbrido, reranqueamento e grafo:** efeitos de cerca de 2 pontos por componente; vetor simples quase empata com GraphRAG; o oráculo nem sempre é teto.
8. **Abstenção (H7) e curadoria por metadados (A5, H5) não têm apoio empírico** em nenhum artigo lido. Aqui o estudo é exploratório.

## O que é o "mini data lake"
Três zonas, em arquivos e SQLite (reprodutível, sem custo). A divisão é desenho nosso; o RAGOps só recomenda manter dados verificados antes do chunking, com metadados de tempo, autoria e fonte, e arquivar versões antigas.

- **Bruto:** documentos do projeto como estão (h3: CLAUDE.md e AGENTS.md, docs, trechos de código, issues e PRs, o log de decisões do estudo 1).
- **Curado:** metadados por documento (tipo, data, vigente ou substituído, `supersedes`, módulo) e "cartões de decisão" curtos, escritos **antes** das perguntas.
- **Índice:** BM25 (FTS5 do SQLite) mais embeddings, com filtro por metadados.

## Parâmetros fixos (a congelar no pré-registro)
Os artigos não dão estes valores; todos entram no protocolo antes do piloto.
- **Temperatura e votos:** com temperatura baixa as repetições concordam em cerca de 99% e votar não acrescenta informação. O `claude -p` não permite fixar a temperatura (aprovado em 10/11/2026): vale o padrão do harness. Usar 5 amostras por pergunta, maioria por letra, desempate pela menor letra (regra fixa). Medir a concordância entre amostras e reportar.
- **Opções:** 4 por pergunta, uma delas sempre "informação insuficiente"; acaso de 25%. Reportar o acerto de cada braço contra o acaso.
- **Recuperação:** tamanho de chunk, sobreposição, k e embedding fixos; o k é varrido só no piloto (valores candidatos 3, 5, 10, 15). O prompt segue sempre a mesma ordem de blocos, e a posição do documento certo é registrada.
- **Tokens:** reportar os tokens entregues por braço, porque o mesmo k entrega orçamentos diferentes.
- **Estatística:** teste de McNemar exato pareado e intervalo de Wilson, por pergunta; correção de Holm só nas hipóteses confirmatórias.

## Desenho
Todas as condições usam o Haiku 5.5 e as mesmas perguntas, salvo S0 e S1 (Sonnet 5.5).

| Braço | O que o Haiku recebe | Para que serve |
|---|---|---|
| A0 | só a pergunta | piso; mede quanto vem do conhecimento prévio |
| A1 | só os documentos-ouro | teto da recuperação (não é teto rígido) |
| A2 | o lake inteiro colado, ordem embaralhada com semente fixa | "sem RAG"; registra tokens do lake e posição do ouro |
| A3 | RAG ingênuo: vetor, top-k, chunks brutos | linha de base |
| A4a | BM25 mais vetor com fusão por rank | efeito do híbrido |
| A4b | A4a mais reranqueamento | efeito do reranqueador |
| A5 | melhor entre A4a e A4b sobre o lake curado (metadados, vigência, cartões) | efeito da curadoria |
| A6 | A5 mais portão de abstenção (ver abaixo) | reduz erro confiante |
| S0 e S1 | Sonnet 5.5 sem contexto e com o ouro | referência do modelo maior |
| N1 | A3 com texto irrelevante do mesmo tamanho | controle: mais tokens sem evidência |
| N1b | A1 mais texto irrelevante | controle: ruído com evidência presente |
| N2 | A1 mais decisões antigas e substituídas | armadilha de vigência |

**Validação do ouro (antes de tudo):** rodar o Haiku 5 vezes só com o documento-ouro de cada pergunta; pergunta em que o ouro não basta é revista ou removida.

**Portão do A6:** o sinal de confiança precisa ser definido antes do congelamento. Cortar pela pontuação máxima da recuperação falhou em um benchmark com casos naturais sem resposta, então o portão usa o próprio Haiku (resposta "informação insuficiente" depois de uma checagem de suporte com os trechos citados) e o limiar é calibrado em 20 perguntas extras, fora das 100. O CRAG não se abstém (busca na web), então o A6 se inspira nele mas não é uma réplica.

**Banco de perguntas (120, opções fechadas):** 60 comuns (uma e várias fontes), 30 com decisão antiga em conflito com a vigente, 30 sem resposta no lake. As sem resposta têm de ser casos plausíveis do projeto, não assuntos de fora. O gabarito e os cartões são escritos antes; as opções não indicam a resposta.

**Quem escreve o gabarito (decisão do autor de 08/11/2026: pode ser a IA):** o autor delegou a criação e a revisão a Claude. Para não repetir o problema de "o mesmo modelo gera e avalia" (apontado no lean-lm e no UnWeaver), cada resposta do gabarito tem de (a) citar o documento e o trecho do lake que a sustenta, conferível por busca textual; (b) ser revisada às cegas por um segundo agente de outro modelo (Opus), que responde sem ver o gabarito; (c) ser removida ou reescrita quando houver discordância ou ambiguidade. O Haiku, que é o modelo avaliado, não participa. O artigo declara que o gabarito foi feito por IA, com essas travas. O autor só é chamado para decisões de escopo e para casos que a IA não consiga resolver. Teste de vazamento: o A0 é comparado ao acaso e reportado; se ficar muito acima, a pergunta é revista, mas não se exige acaso, porque conhecimento prévio legítimo existe.

**Métricas:**
- acerto contra o gabarito;
- recall@k e precisão da recuperação;
- taxa de uso (documento certo recuperado e citado);
- fração de acertos em que o ouro não foi recuperado;
- precisão da abstenção;
- custo por decisão certa;
- tokens por braço;
- classificação dos erros pela taxonomia de falhas FP1 a FP7;
- taxa de falha de formato.

## Hipóteses propostas
O poder é de cerca de 14 pp com 120 perguntas pareadas (diferença que tem 80% de chance de ser detectada, estimativa de ordem de grandeza, a confirmar no piloto). Subir de 100 para 120 melhora pouco o conjunto todo; o ganho real é nos blocos de conflito e de sem resposta (30 perguntas cada, que detectam uns 25 pp). Hipóteses cuja margem é menor que isso saem como exploratórias, para não repetir o "subpotente" do estudo 1.

**Confirmatórias (Holm):**
| ID | Enunciado | Refutada se |
|---|---|---|
| H1 | Validade: A1 supera A0 em pelo menos 25 pp. | menos de 15 pp (o banco não mede o lake) |
| H2 | Com o mesmo ouro, Haiku (A1) fica a no máximo 10 pp do Sonnet (S1). | Haiku abaixo por mais de 10 pp |
| H3 | O melhor braço de RAG (A3 a A6) recupera pelo menos 80% do ganho do ouro sobre o A0. A razão pode passar de 100%; nesse caso vale min(razão, 1) e o intervalo é reportado. | recupera menos de 60% |
| H9 | Haiku com o melhor RAG atinge pelo menos 90% do acerto do Sonnet com ouro, a no máximo 50% do custo por decisão certa. | razão de acerto abaixo de 0,80 ou custo acima de 0,70 |

**Exploratórias (sem controle de erro; resultado descritivo com intervalo):**
| ID | Enunciado |
|---|---|
| H4 | Híbrido (A4a) acima do vetor (A3) em recall@k de pelo menos 10 pp; reranqueador (A4b) acima do A4a em recall@k. O acerto é descritivo. |
| H5 | Nas 20 de conflito, A5 supera A4 por pelo menos 15 pp. Sem apoio prévio na literatura. |
| H6 | Colar tudo (A2) fica abaixo do melhor RAG em acerto ou empata com custo maior. Pode ser que o Haiku seja imune à posição. |
| H7 | O portão corta as respostas erradas e confiantes nas 20 sem resposta, sem perder acerto nas respondíveis. Sem apoio prévio. |

**Controles (checam a medição; não são hipóteses):** N1 não difere do A0 por mais de 10 pp; N1b e N2 reportados com intervalo (N2 deve piorar o A1). Se o N1 melhorar o A0 por mais de 10 pp, a medição está em dúvida e isso é reportado.

**Hipótese nula e explicações alternativas:** o lake não acrescenta nada além de colar o contexto certo; o ganho é de tokens e não de conteúdo; o gabarito ou os cartões vazam a resposta (risco apontado no DRAG); as perguntas são fáceis; gerador e juiz do gabarito são o mesmo modelo (apontado no lean-lm e no UnWeaver, por isso o gabarito tem as travas descritas acima e o Haiku nunca participa dele).

## Escopo
- **Dentro:** decisões de projeto com opções fechadas, no h3, só Haiku 5.5 (Sonnet como referência), recuperação lexical e vetorial, curadoria por metadados.
- **Fora:** fine-tuning, GraphRAG (ganho pequeno e inconstante sobre vetor simples), agentes de livre exploração, outros modelos e projetos, dados da empresa, validação em operação (os Seven Failure Points lembram que RAG só se valida em uso real; este estudo é offline e diz isso).

## Execução (cálculo)
Cerca de 120 perguntas, 11 braços do Haiku, 5 amostras: perto de 6.600 chamadas pequenas; Sonnet 2 braços, 1.200 chamadas. Poucas horas. O gargalo é a qualidade do gabarito e dos cartões.

## Cronograma (hoje é domingo 08/11)
| Dia | Entrega |
|---|---|
| Dom 08/11 | Plano v2 e leitura integral (este documento) |
| Seg 09/11 | Montar o lake (bruto e curado) e o rascunho das perguntas, sem as respostas nas opções |
| Ter 10/11 | Gabarito e cartões feitos e revisados pela IA (revisão cega por Opus). Validação do ouro e teste de vazamento. Pré-registro e congelamento do protocolo |
| Qua 11/11 | Índice e braços. Piloto com 15 perguntas, varredura de k, calibração do portão |
| Qui 12/11 | Rodada principal |
| Sex 13/11 | Congelar os dados. Análise e figuras |
| Sáb 14/11 | Artigo técnico e guia simples, pt e en. Revisão adversarial |
| Dom 15/11 | Aprovação, publicação, DOI e jornada |

## Decisões do autor (08/11/2026)
1. Corpus: h3 mais o log do estudo 1.
2. Banco de 120 perguntas.
3. Embeddings: modelo local pequeno (o mesmo vetor em todos os braços, reproduzível por qualquer pessoa).
4. Gabarito e cartões de decisão: feitos e revisados pela IA, com as travas descritas acima. O autor não escreve nem revisa.

## Estado em 08/11/2026 (noite): o que já está pronto, para aprovação na segunda
Tudo abaixo é rascunho feito por IA e aguarda a aprovação do autor. Nada foi pré-registrado, nenhum braço foi rodado.

- **Lake bruto** (`lake/bruto/`, manifesto em `lake/manifesto-bruto.json`): 109 documentos, 551 mil bytes, de 138 mil a 184 mil tokens conforme a razão de caracteres por token (a medida real de tokens ainda não foi feita). O braço A2 (lake inteiro colado) pode não caber no contexto do Haiku; o piloto mede e, se não couber, o A2 usa um subconjunto declarado.
- **Lake curado** (`lake/curado/cartoes.json`): 152 cartões de decisão (82 vigentes, 27 substituídos, 3 de contexto e os demais ligados por `substitui`), todos com trecho literal conferido por programa (`tools/rag-lake/verificar_cartoes.py`). Em 68 cartões de issues e PRs os ids de documento vieram deslocados por uma posição e foram corrigidos pelo próprio trecho (`lake/curado/correcoes-ids-iss.json`).
- **Índice** (BM25 e embeddings): ainda não construído.
- **Banco de 120 perguntas** (`lake/perguntas/perguntas.json`, gabarito em `gabarito/rascunho.json`, montagem por `tools/rag-lake/montar_banco.py`, semente 20261109): 60 comuns, 30 de conflito, 30 sem resposta. A letra correta fica em A 28, B 31, C 32, D 29. A opção correta é a mais longa em 26% das perguntas comuns e de conflito (o acaso seria 33%; chegou a 44% no primeiro rascunho, p de cerca de 0,025, e foi corrigido).
- **Revisão cega por Opus** (`lake/revisao/`): na primeira passada o revisor concordou com o gabarito em 118 das 120 perguntas (comuns 59/60, conflito 30/30, sem resposta 29/30). As duas discordâncias, mais uma pergunta que dependia de arquivo fora do lake e duas ambíguas, foram reescritas e um segundo revisor novo acertou as cinco. Isso dá 120 de 120 depois dos ajustes, mas **não é uma medida independente de acurácia**: as correções vieram depois de ver o primeiro resultado.

### Ressalvas que o artigo precisa declarar
1. **Gabarito feito por IA** (decisão do autor), com as travas: citação literal, revisão cega por outro modelo, remoção das perguntas ambíguas. Os autores das perguntas (Sonnet) e os revisores (Opus) são da mesma família de modelos e podem compartilhar pontos cegos.
2. **17 das 30 perguntas "sem resposta" foram marcadas pelo revisor como "parcialmente respondidas"**: o lake traz algo próximo, mas nenhuma opção fica sustentada. O revisor ainda assim escolheu "informação insuficiente" em todas. O protocolo define "sem resposta" como "nenhuma opção está sustentada pelo lake", e não como "o assunto não aparece".
3. **3 perguntas de conflito ou sem resposta ficaram marcadas como ambíguas** (q-conf-e1-09, q-conf-e1-01, q-sem-iss-08). As duas de conflito são ambíguas por construção (a decisão antiga também está escrita no lake; a pergunta pede a vigente). Seguem no banco com essa marca.
4. **Dependência entre perguntas:** duas perguntas de conflito do estudo 1 (par 09/11 e par 10/11) compartilham o mesmo cartão vigente.
5. **Pares inferidos:** 3 pares de código do changelog só trazem a correção, não o comportamento antigo; não foram usados em nenhuma pergunta.
6. O PR #1608 (doc-0056) está cortado no limite de 4.000 caracteres; nenhuma pergunta usa esse documento.
7. As perguntas sobre o estudo 1 têm como "projeto" o próprio estudo do autor, o que dá ao lake pedaços que o Haiku nunca viu; isso é intencional e o artigo explica.

### Próximos passos (segunda)
Construir o índice e medir os tokens reais do lake; rodar o piloto com 15 perguntas; fixar k, chunk, temperatura e o portão do A6; só então pré-registrar.

## Piloto em 08/11/2026 (noite)
- Índice: 1.292 trechos (600 caracteres, sobreposição 100), embedding paraphrase-multilingual-MiniLM-L12-v2 local. Recall do híbrido RRF nas 90 perguntas com ouro: documento certo entre os k trechos 0,63 (k=3), 0,76 (5), 0,81 (10), 0,86 (15); trecho-ouro completo 0,26 / 0,34 / 0,43 / 0,50. BM25 sozinho é fraco (perguntas em português, lake majoritariamente em inglês).
- Lake inteiro: cerca de 223 mil tokens reais; o Haiku aceitou. `claude -p` padrão gasta 26 mil tokens de sistema; o executor usa `--tools ""` e prompt de sistema curto (cerca de 1 mil tokens). Temperatura não é controlável: vale o padrão do harness.
- Piloto (15 perguntas sorteadas, 5 por bloco, 3 amostras, maioria): A0 acerta 0/10 nas respondíveis e 5/5 nas sem resposta (escolhe sempre "insuficiente"); A1 9/10; A3 k=10 5/10 nas respondíveis; A4a k=3, 5, 10 e 15 empatam (6/10). n=15 não separa os k.
- Consequência: a acurácia global mistura dois comportamentos; reportar por bloco e a taxa de abstenção por braço. k fixado em 10 (k=15 como sensibilidade). Estas 15 perguntas foram usadas na escolha: análise de sensibilidade sem elas.
- Dados: piloto/piloto.jsonl. Código: tools/rag-lake/indice.py e executor.py.

## Medições de 10/11/2026
- Login do `claude -p` renovado. Executor passou a recusar chamada sem tokens (antes gravava resposta vazia).
- Cache do lake inteiro (A2): a primeira versão (lake na mensagem do usuário) não usou cache, porque a pergunta muda o prefixo; custo de US$ 0,224 por chamada. Com o lake no prompt de sistema (`--system-prompt-file`), a segunda chamada leu 222.784 tokens do cache e custou US$ 0,012. Pilot A2 (45 chamadas, 1 de aquecimento): média de US$ 0,0169 por chamada; 600 chamadas projetam cerca de US$ 10. Diferença declarada: no A2 o material vai no prompt de sistema, nos outros braços na mensagem do usuário.
- Aquecimento: a primeira chamada do A2 roda sozinha antes das demais.
- Piloto Sonnet (15 perguntas, 3 amostras, maioria): A0 1/10 nas respondíveis e 4/5 nas sem resposta; A1 10/10; A3 k=10 6/10 e A4a k=10 6/10 nas respondíveis, 5/5 nas sem resposta. Custo por chamada: A0 US$ 0,0058, A1 US$ 0,0276, A4a k=10 US$ 0,0106 (cerca de 19 a 25 vezes o do Haiku).
- Piloto A2 com Haiku: comum 4/5, conflito 2/5, sem resposta 5/5 (nas 15 perguntas, similar ao RAG).
- Peso do cache no limite da assinatura: a documentação oficial diz que conteúdo em cache conta menos, sem porcentagem. Medir a barra de uso do plano na rodada.
