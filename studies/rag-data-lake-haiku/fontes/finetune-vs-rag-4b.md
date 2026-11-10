---
id: rag2-2604.23801
titulo: "Domain Fine-Tuning vs. Retrieval-Augmented Generation for Medical Multiple-Choice Question Answering: A Controlled Comparison at the 4B-Parameter Scale"
autores: "Buskila"
ano: 2026
tipo: academico
url: https://arxiv.org/abs/2604.23801
doi: 10.48550/arXiv.2604.23801
acessado: 2026-11-08
nivel_evidencia: A
vies: "preprint (v1, abr/2026), autor único; desenho 2x2 pareado com código e traços abertos, mas um só benchmark, um só corpus de recuperação (explicações do MedMCQA, não autoritativo), um só embedder, modelos quantizados em 4 bits e um checkpoint comunitário do MedGemma; o fator 'ajuste fino' é na verdade a troca de checkpoint (Gemma 3 por MedGemma); a explicação de por que o RAG não ajudou é hipótese do autor, não foi testada"
verificada: true
---
# Domain Fine-Tuning vs. RAG para perguntas médicas de múltipla escolha, escala 4B

> tipo: academico. nivel_evidencia: A (experimento controlado, fatorial 2x2, pareado, com teste estatístico), com a ressalva de generalização nas limitações. Verificada em 08/11/2026: o PDF foi aberto no arxiv.org e o título confere. Texto lido por inteiro (8 páginas, tabelas, ameaças à validade e referências). O arquivo de texto extraído tem caracteres corrompidos (símbolos), mas as tabelas conferem com o PDF.

## Resumo
Comparação fatorial 2x2 de dois modelos de 4B parâmetros (Gemma 3 4B geral e MedGemma 4B, adaptado ao domínio médico), cada um com e sem passagens recuperadas no prompt, no conjunto de teste completo do MedQA-USMLE de 4 opções (1.273 perguntas, 3 repetições, 15.276 chamadas). A troca para o modelo adaptado ao domínio dá +6,8 pontos percentuais de acerto (53,3% contra 46,4%, McNemar p < 10^-4). O RAG sobre explicações do MedMCQA não dá ganho estatisticamente significativo em nenhum dos dois, e no modelo de domínio a estimativa é levemente negativa (-1,9 pp, p = 0,16). O autor conclui que, nessa escala e nesse benchmark, o conhecimento nos pesos domina o conhecimento fornecido no contexto.

## Método
- **Modelos:** gemma3:4b e um build comunitário em GGUF de 4 bits do MedGemma 4B (edwardlo12/medgemma-4b-it-q4_k_m), ambos servidos localmente pelo Ollama, temperatura 0,1 (seções 3.1 e 3.2, Tabela 1).
- **Dados de avaliação:** teste do MedQA-USMLE de 4 opções, 1.273 itens (seção 3.3). Acaso = 25%.
- **Corpus de recuperação:** campo "explanation" do conjunto de treino do MedMCQA; perguntas e opções do MedMCQA nunca são indexadas, e o MedMCQA é disjunto do MedQA (seção 3.4).
- **Recuperação (seção 3.4):** chunks de 512 tokens com sobreposição de 50; embeddings nomic-embed-text; ChromaDB; consulta = texto da pergunta mais as quatro opções; candidatos densos, descarte acima de distância de cosseno 0,3, reordenação por pontuação híbrida alfa x denso + (1 - alfa) x lexical com alfa = 0,6; top k = 3 inseridos no prompt. 96,35% das chamadas com RAG tiveram contexto não vazio, média de 2,89 chunks por chamada. Distância máxima, k e alfa foram ajustados num piloto menor antes da rodada final (seção 6; o tamanho do piloto e os valores testados não constam).
- **Prompts (seção 3.5):** um com e outro sem contexto, parafraseados entre si, mesma persona de especialista médico, contrato de resposta JSON {"answer":"A|B|C|D"}; o prompt com RAG avisa que as passagens podem ou não ser relevantes. Os textos exatos estão no repositório (não no artigo).
- **Repetições e agregação (seção 3.6):** 3 repetições por par (pergunta, configuração); acerto reportado = voto majoritário; empate resolvido pela primeira repetição; também se reporta a consistência entre repetições.
- **Estatística (seção 3.7):** teste exato de McNemar pareado sobre o acerto do voto majoritário, com células discordantes, estatística, valor p e intervalo de Wilson de 95%.
- **Custo, latência e uso de tokens:** não constam.

## Resultados (onde estão)
- **Tabela 2 (acerto por voto majoritário, intervalo de 95%, acertos de 1.273):** gemma3-4b 0,4643 [0,4370; 0,4917], 591; gemma3-4b+RAG 0,4729 [0,4456; 0,5004], 602; medgemma-4b+RAG 0,5137 [0,4863; 0,5411], 654; medgemma-4b 0,5326 [0,5051; 0,5599], 678.
- **Efeitos derivados da Tabela 2 (meus cálculos):** RAG no Gemma +0,9 pp (11 itens a mais); RAG no MedGemma -1,9 pp (24 itens a menos); modelo de domínio sem RAG contra geral sem RAG +6,8 pp.
- **Tabela 3 (McNemar, células só-A-certa / só-B-certa, p):** Gemma+RAG contra Gemma 156/145, p = 0,5644; MedGemma+RAG contra MedGemma 124/148, p = 0,1631; Gemma+RAG contra MedGemma+RAG 139/191, p = 0,0050; Gemma contra MedGemma 144/231, p < 10^-4; Gemma+RAG contra MedGemma 179/255, p = 0,0003; Gemma contra MedGemma+RAG 176/239, p = 0,0023. As duas comparações dentro do mesmo modelo (ligar RAG) são as não significativas. A tabela extraída vem com colunas embaralhadas; reconstruí os pares pelos totais da Tabela 2 (a diferença entre as células bate com a diferença de acertos).
- **Tabela 4 (consistência entre as 3 repetições e falha de formato após duas tentativas):** consistência 0,9974 (Gemma), 0,9992 (Gemma+RAG), 0,9921 (MedGemma), 0,9919 (MedGemma+RAG); falha de formato 0,0000, 0,0000, 0,0047, 0,0039.
- **Figuras 1 a 3:** acerto com intervalos, matriz de valores p e consistência (sem números além das tabelas).

## Afirmações extraídas (com localização)
- O ganho de trocar o modelo geral pelo adaptado ao domínio é de 6,8 pp e significativo: resumo, seção 4.1, Tabela 3.
- Ligar o RAG não dá ganho significativo em nenhum dos dois modelos; no MedGemma o ponto estimado é -1,9 pp (p = 0,16): seção 4.2, Tabela 3.
- O melhor setup sem modelo de domínio (Gemma+RAG, 47,3%) não alcança o pior com modelo de domínio (MedGemma+RAG, 51,4%): seção 4.1.
- Com temperatura 0,1 a consistência passa de 0,99 em todas as condições; as 3 repetições servem sobretudo para expor ruído de decodificação e não são fonte relevante de variância: seção 4.3, Tabela 4.
- Quatro explicações possíveis, nenhuma excluída: perguntas do USMLE são de raciocínio e não de recuperar fato; o corpus é amplo mas não autoritativo e pode diluir o prior do modelo; um modelo de 4B tem capacidade limitada para ler e integrar três chunks; o MedGemma pode já ter absorvido o conteúdo do corpus: seção 5.
- Implicação prática: para um orçamento de engenharia fixo, trocar o backbone é uma alavanca mais confiável do que montar pipeline de recuperação; o RAG "não é ativamente prejudicial" aqui: seção 5. (A segunda parte é uma interpretação: no MedGemma a estimativa é negativa, embora não significativa.)

## Limitações da fonte
**Do autor (seção 6):** um só benchmark (resultados podem diferir quando a resposta aparece literalmente no corpus); um só corpus e um só embedder; quantização de 4 bits pode mudar a acurácia em alguns pontos e não necessariamente igual nos dois modelos; uma só escala (não extrapola para 70B ou modelos de fronteira, onde o RAG pode ganhar mais); possível contaminação por pré-treino do MedQA, público.

**Minhas:**
- O "ajuste fino" não é um fator isolado: é a troca de checkpoint (Gemma 3 por MedGemma, build comunitário quantizado), que também difere em dados de pré-treino e talvez em outros aspectos que o artigo não descreve.
- O corpus usado como "textbook-style proxy" é de explicações de outro banco de questões; não há garantia de conter o fato que cada pergunta exige. O artigo não mede se o documento certo foi recuperado (não há recall@k nem braço com o documento-ouro), então não separa erro de recuperação de erro de leitura ou de raciocínio.
- A consulta usa a pergunta mais as quatro opções, o que pode puxar passagens parecidas com várias opções.
- Os intervalos de confiança e o McNemar cobrem a amostragem das perguntas, não repetições de modelo diferentes (as repetições são quase idênticas, consistência 0,99).
- Número de opções (4) e acaso de 25%; os modelos já acertam 46% a 53% sem contexto, então o conhecimento do USMLE está em boa parte nos pesos de ambos, e não só no MedGemma.
- A hipótese (iv) do autor (MedGemma já absorveu o conhecimento) não explica por que o RAG também não ajudou o Gemma geral (+0,9 pp, não significativo); o resultado é compatível com recuperação de baixa qualidade ou com incapacidade de um 4B de usar o contexto, e o artigo não distingue.
- Sem custo, latência ou tokens, o artigo não responde à pergunta de custo do estudo 2.

## O que importa para o estudo 2
- **Apoia a necessidade de H1 e do A0 como piso:** um modelo pequeno acerta 46% a 53% de perguntas de 4 opções sem contexto algum, bem acima do acaso. Se as perguntas do banco puderem ser respondidas por conhecimento geral, o lake não tem o que acrescentar. As perguntas precisam depender de fatos que só existem no projeto.
- **Mostra o risco do A3 sem controle:** RAG ingênuo sobre um corpus que não contém exatamente o fato não ajudou (+0,9 e -1,9 pp, não significativos). Apoia manter A3 como linha de base e N1 como controle, e dá uma ordem de grandeza (cerca de 2 pp) de "RAG que não faz diferença" em escala pequena.
- **Não apoia nem contradiz H3 a H5:** sem braço de oráculo, o artigo não diz se o problema era recuperação ou leitura. O braço A1 do plano resolve exatamente isso.
- **Método a copiar:** (1) teste exato de McNemar pareado sobre o acerto do voto majoritário, reportando as células discordantes; (2) intervalo de Wilson de 95% para acerto; (3) taxa de falha de formato (0,4 a 0,5% no MedGemma) como coluna fixa dos resultados; (4) corpus de recuperação que não contém as perguntas nem as opções (evita vazamento); (5) liberar JSONL com todos os traços; (6) fixar distância máxima, k e peso do híbrido em um piloto antes da rodada final e relatar os valores.
- **Parâmetros de referência de recuperação:** chunks de 512 tokens com 50 de sobreposição, k = 3, corte de distância 0,3, peso 0,6 do vetor no híbrido. São ponto de partida para o piloto, não evidência de que sejam bons para o lake (o artigo não varia esses valores no resultado final).
- **Fine-tuning está fora do escopo do plano e a conclusão "ajuste fino vence RAG" não transfere:** o MedGemma foi adaptado a um corpus médico público; o Haiku não tem os fatos privados do projeto nos pesos, então "conhecimento no contexto" é a única via sem treinar. O artigo é uma advertência sobre RAG em modelos pequenos, não sobre o Haiku 5.5.

## Contradições ou ajustes que o plano.md precisa
- **Achado 2 da seção "O que a literatura já diz" está formulado de forma mais forte do que o artigo:** o plano diz que o RAG "não ajudou um modelo de 4B quando o conhecimento já estava nos pesos". O artigo mostra que o RAG sobre um corpus proxy não deu ganho significativo, e a explicação "conhecimento já nos pesos" é uma das quatro hipóteses do autor, sem teste (e o Gemma geral também não ganhou). Sugestão: "o RAG sobre um corpus proxy não ajudou um modelo de 4B em perguntas de raciocínio; o autor sugere, sem testar, que o conhecimento estava nos pesos". A consequência de desenho (perguntas que dependam de fatos só do projeto) continua válida.
- **Temperatura e votos:** o plano pede 3 votos com maioria por letra mas não fixa a temperatura nem o desempate. Neste artigo, com temperatura 0,1, a concordância entre as 3 repetições é de 99,2% a 99,9%, ou seja, os votos quase não acrescentam informação. Decidir: temperatura maior que zero para os votos serem independentes, ou aceitar que 3 votos a baixa temperatura valem pouco e tratar a variância entre perguntas (teste pareado) como a incerteza que importa. Fixar a regra de desempate (aqui, a primeira repetição; com várias letras e a opção "informação insuficiente", empates de 3 respostas diferentes são possíveis).
- **Definir o acaso:** o teste de vazamento do plano ("A0 perto do acaso") depende do número de opções, que o plano não fixa; neste artigo são 4 (acaso 25%). Fixar o número de opções, e se "informação insuficiente" é uma opção em todas as perguntas ou só nas 20 sem resposta (isso muda o acaso e pode denunciar o tipo da pergunta).
- **Teste estatístico:** o plano não diz qual teste usa para H1 a H9; este artigo oferece McNemar exato pareado; com 9 hipóteses, acrescentar correção para múltiplas comparações (a fonte do braço Shaikh usa Holm-Bonferroni para 5 comparações-chave).
