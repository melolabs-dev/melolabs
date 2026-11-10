---
id: rag2-2310.11511
titulo: "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection"
autores: "Asai, Wu, Wang, Sil, Hajishirzi"
ano: 2023
tipo: academico
url: https://arxiv.org/abs/2310.11511
doi: 10.48550/arXiv.2310.11511
acessado: 2026-11-08
nivel_evidencia: B
vies: "preprint (v1, out/2023; o texto lido se declara Preprint, publicação em evento não consta no arquivo); método exige treinar o modelo (Llama 2 7B e 13B), então não se aplica ao Haiku, que é de API; vários baselines vêm de números de outros artigos; execução única, sem intervalo de confiança nem teste de significância; críticos treinados com rótulos do GPT-4; o resumo afirma mais do que a Tabela 2 mostra"
verificada: true
---
# Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection

> tipo: academico. nivel_evidencia: B (método e comparações extensas, código e modelos abertos, mas sem repetições nem testes estatísticos e com baselines de origens diferentes). Verificada em 08/11/2026: o PDF foi aberto no arxiv.org e o título confere. Texto lido por inteiro (corpo, tabelas, apêndices A a D e referências).

## Resumo
Os autores treinam um modelo de linguagem (Llama 2 de 7B e 13B) para gerar, além do texto, "tokens de reflexão": um decide se vale recuperar passagens (Retrieve), três criticam a relevância da passagem (IsRel), se a resposta é sustentada por ela (IsSup) e a utilidade da resposta (IsUse). Na inferência o modelo recupera sob demanda, processa várias passagens em paralelo e escolhe o melhor segmento por uma busca em feixe pontuada por esses tokens. Em seis tarefas (PopQA cauda longa, TriviaQA, PubHealth, ARC-Challenge, biografias com FactScore, ASQA com citações) o Self-RAG supera baselines de mesmo tamanho com RAG tradicional e, em parte das tarefas, o ChatGPT. O maior ganho é em citação, não em acerto de resposta curta.

## Método
- **Modelos:** gerador Llama 2 7B e 13B; crítico Llama 2 7B (seção 4.3, 3.2.1). Treino em 4 GPUs A100 de 80 GB, 3 épocas, lote 128, taxa de aprendizado de pico 2e-5 (apêndice B.1).
- **Dados de treino:** cerca de 150 mil pares instrução-saída no texto principal (145.619 na Tabela 3 do apêndice A.2), de Open-Instruct e de conjuntos intensivos em conhecimento (KILT, ASQA, ARC-Easy, OpenBookQA).
- **Crítico:** rótulos coletados com GPT-4 (temperatura 1, no máximo 200 tokens) e destilados no crítico: 12.594 exemplos para Retrieve, 11.181 para IsSup, 19.317 para IsRel, 3.831 para IsUse (apêndice A.1; o texto do apêndice escreve "1,2594" para o primeiro, interpretei como 12.594). Verificação manual pelos autores de 20 instâncias por aspecto: concordância de 95% (relevância e necessidade de recuperação), 90% (suporte), 80% (utilidade).
- **Recuperador:** Contriever-MS MARCO fixo. Até 10 documentos por entrada no treino (seção 4.3); por padrão os 5 primeiros na inferência; biografias e QA aberto usam mais 5 de um buscador web; ASQA usa os 5 documentos do GTR-XXL fornecidos pelos autores do ALCE para todos os sistemas.
- **Inferência (seção 3.3, 4.3):** pesos 1,0 (IsRel), 1,0 (IsSup), 0,5 (IsUse); limiar de recuperação 0,2 na maioria das tarefas e 0 no ALCE; feixe de largura 2 por segmento; decodificação gulosa no nível do token; zero-shot, sem exemplos.
- **Métricas:** acurácia (PubHealth, ARC, PopQA, TriviaQA, esta última por "contém a resposta" e não por correspondência exata), FactScore, str-em, Rouge, MAUVE, precisão e revocação de citação (ALCE).
- **Execuções:** uma por condição; número de repetições, sementes e intervalos de confiança não constam.
- **Baselines:** Llama 2 e Alpaca sem e com recuperação (mesmo recuperador), Llama2-FT (ajustado nos mesmos dados sem tokens de reflexão), Llama2-chat, ChatGPT, Ret-ChatGPT, Perplexity.ai, e Toolformer, SAIL e CoVE com números copiados dos artigos originais.

## Resultados (onde estão)
- **Tabela 2 (p. 8), Self-RAG 7B / 13B:** PopQA 54,9 / 55,8; TriviaQA 66,4 / 69,3; PubHealth 72,4 / 74,5; ARC-Challenge 67,3 / 73,1; biografia (FactScore) 81,2 / 80,2; ASQA str-em 30,0 / 31,7; MAUVE 74,3 / 71,6; precisão de citação 66,9 / 70,3; revocação de citação 67,8 / 71,3.
- **Comparação na mesma tabela:** ChatGPT sem recuperação tem TriviaQA 74,3 e ARC 75,3, acima do Self-RAG; Ret-ChatGPT tem ASQA str-em 40,7, precisão de citação 65,1 e revocação 76,6. O Self-RAG 13B passa o ChatGPT em precisão de citação, mas não em revocação.
- **Recuperação nem sempre ajuda os baselines (Tabela 2, seção 5.1):** Alpaca 7B vai de 49,8 para 40,2 em PubHealth com recuperação; Ret-ChatGPT cai de 70,1 para 54,7 em PubHealth e fica igual (75,3) em ARC; Llama 2 13B cai de 29,4 para 26,0 em ARC. Em PopQA (cauda longa) o ganho é grande: Llama 2 7B de 14,7 para 38,2. O texto diz que em PubHealth e ARC os baselines com recuperação "não melhoram de forma notável".
- **Ablação (seção 5.2, Tabela 3a, modelo 7B treinado com 50 mil exemplos), PopQA / PubHealth / ASQA str-em:** completo 45,5 / 73,5 / 32,1; sem recuperador no treino 43,6 / 67,8 / 31,0; sem crítico (sempre o top-1, sem tokens) 42,6 / 72,0 / 18,1; sem recuperação na inferência 24,7 / 73,0 / não se aplica; restrição rígida em vez do limiar 28,3 / 72,6; recuperar sempre só o top-1 41,8 / 73,1 / 28,6; sem IsSup 44,1 / 73,2 / 30,6. A ASQA da ablação usa 150 instâncias amostradas.
- **Personalização (Figura 3b):** subir o peso de IsSup aumenta a precisão de citação e reduz o MAUVE (a legenda e o texto descrevem a direção; os valores só aparecem no gráfico).
- **Frequência de recuperação (Figura 3c, seção 5.2):** variar o limiar muda muito a frequência de recuperação; a perda por recuperar menos é pequena em PubHealth e maior em PopQA.
- **Escala de treino (Figura 4a a 4c):** mais dados melhoram o Self-RAG, sobretudo PopQA e ASQA, sem o mesmo efeito no Llama2-FT de 50 mil para 150 mil.
- **Avaliação humana (seção 5.2, Figura 4d, apêndice C.2):** 50 amostras de PopQA e biografia; os avaliadores acham as respostas em geral plausíveis e sustentadas e as previsões de IsRel e IsSup em geral alinhadas.
- **Acurácia do crítico (apêndice A.2, tabela legendada Figure 5 e citada como Table 5 no texto):** Llama 2 7B concorda com o GPT-4 em 93,8 (Retrieve), 93,5 (IsSup), 80,2 (IsRel) e 73,5 (IsUse); FLAN-3B em 85,6, 73,1, 82,0 e 72,1.
- **Origem das respostas certas (apêndice C.1):** entre as respostas corretas em PopQA e TriviaQA, a fração cujo gabarito não aparece nas passagens recuperadas é de 2% no Self-RAG, 15% a 20% nos baselines instruídos (Alpaca, Llama2-chat); o texto cita "Alpaca 30B", modelo que não está na lista de baselines.

## Afirmações extraídas (com localização)
- Recuperar um número fixo de passagens sem checar necessidade ou relevância pode atrapalhar e gerar respostas pouco úteis: resumo e seção 1 (motivação, citando trabalhos anteriores, não testada de forma isolada em modelo fechado).
- Self-RAG supera RAG convencional de mesmo tamanho em todas as tarefas e é o melhor entre os modelos não proprietários: seção 5.1, Tabela 2.
- O ganho não vem só dos dados de treino, porque o Llama2-FT com os mesmos dados fica atrás: seção 5.1.
- Recuperar sempre o top-1 derruba PopQA e ASQA em relação ao Self-RAG completo: seção 5.2, Tabela 3a (45,5 para 41,8 e 32,1 para 28,6).
- Em PubHealth a recuperação quase não muda o resultado do Self-RAG (73,0 sem, 73,5 com): Tabela 3a.
- A citação melhora muito frente aos baselines com recuperação (precisão 2,0 a 5,5 nos Llama2 e Alpaca com recuperação, 66,9 a 70,3 no Self-RAG): Tabela 2, ASQA.
- O resumo diz que supera o ChatGPT em QA aberto, raciocínio e verificação de fatos; a Tabela 2 mostra o ChatGPT acima em TriviaQA e ARC, e o texto da seção 5.1 lista PubHealth, PopQA, biografia e ASQA (Rouge e MAUVE) como as vitórias. A afirmação do resumo é mais ampla que os dados.
- O texto diz que o crítico passa de 90% de concordância "na maioria das categorias" (seção 3.2.1); a tabela do apêndice A.2 mostra 2 de 4 acima de 90% (Retrieve e IsSup).

## Limitações da fonte
**Do autor:** não há seção de limitações. Citam no apêndice B.2 que recuperadores prontos, treinados em tarefas de conhecimento, funcionam pouco em geração aberta; que dumps diferentes da Wikipédia mudam o resultado; e, nas considerações éticas, que o modelo ainda pode gerar saídas não totalmente sustentadas pelas citações. Dizem que a mensuração de utilidade é "percebida", independente de factualidade.

**Minhas:**
- Não se aplica ao Haiku: exige treinar um modelo e ler probabilidades de tokens de reflexão. O que dá para aproveitar é a ideia e as ablações, não a técnica.
- Uma execução por condição, sem intervalos, sem teste pareado; diferenças pequenas (1 a 2 pontos) não são interpretáveis.
- Comparações heterogêneas: Toolformer, SAIL e CoVE vêm de números dos artigos originais; Perplexity.ai e ChatGPT são caixas-pretas que mudam com o tempo.
- Todas as tarefas têm resposta no corpus (Wikipédia) ou são de conhecimento geral; não há perguntas sem resposta, então a abstenção não é medida. A recuperação sobre um corpus aberto e enorme é bem diferente de um lake pequeno e privado.
- O crítico foi treinado com rótulos do GPT-4 checados em só 20 exemplos por aspecto; o IsUse concorda pouco (73,5% com o GPT-4).
- ASQA da ablação usa 150 instâncias; a avaliação humana usa 50.
- Os valores das Figuras 3b, 3c e 4 só estão em gráfico; não os li com precisão e não os uso.
- A Tabela 3a é citada no texto como "Table 3a" e a legenda diz Figure 3(a); inconsistência de rotulagem do artigo.

## O que importa para o estudo 2
- **Apoia H1 e o teste de vazamento (A0).** O valor da recuperação depende de a pergunta exigir conhecimento fora dos pesos: PopQA de cauda longa vai de 24,7 (sem recuperação) para 45,5 (completo); PubHealth fica em 73,0 contra 73,5. As perguntas do banco precisam ser como PopQA (fato só existe no lake), não como PubHealth.
- **Apoia a necessidade do A3 e do controle N1, e contradiz a suposição de que RAG ajuda sempre.** Há casos em que recuperação piora um modelo forte (Ret-ChatGPT em PubHealth, de 70,1 para 54,7). Registrar o efeito do A3 sobre o A0 por tipo de pergunta, não só no total.
- **Método a copiar: checar se o acerto veio da evidência.** O apêndice C.1 mede a fração de respostas certas cuja resposta não está nas passagens recuperadas. No estudo 2, o análogo é a fração de acertos dos braços A3 a A6 em que o documento-ouro não foi recuperado; deve ser baixa se o acerto vem do lake e alta se vem de vazamento ou de conhecimento prévio. Complementa o teste "A0 perto do acaso".
- **Citação do documento correto.** O artigo usa precisão e revocação de citação (ALCE) como métricas centrais, que é o que o plano chama de "citação do documento correto". Apoia mantê-la como métrica separada de acerto.
- **A6 (portão de abstenção): apoio conceitual, não evidência.** O Self-RAG decide recuperar ou não e avalia relevância por token treinado, com limiar de probabilidade (0,2) e curva de frequência de recuperação contra acurácia (Figura 3c). Com o Haiku não há esses tokens; o portão terá de ser uma autoavaliação verbal ou um limiar sobre outra pontuação, e o artigo não valida isso. Não há nenhuma pergunta sem resposta no artigo, então ele não apoia nem contradiz H7. A troca vista com o peso de IsSup (mais precisão de citação, menos fluência) é um análogo da troca de H7 (menos erro confiante, menos respostas nas respondíveis).
- **Ablação "recuperar sempre o top-1" (Tabela 3a)** é o análogo do A3 e mostra que usar o top-1 sem filtro custa 3,7 pontos em PopQA e 3,5 em ASQA; é a ordem de grandeza esperada para diferenças entre A3 e A4 e abaixo do poder de 100 perguntas (cerca de 15 pp).
- **Filtro de relevância por passagem (IsRel) antes de gerar** apoia a ideia do A5 e do A6 de filtrar por vigência e por confiança antes de dar o contexto ao modelo.

## Contradições ou ajustes que o plano.md precisa
- Nenhum erro factual do plano vem deste artigo (o plano não o cita). Sugestão: citá-lo como apoio para (a) medir se o acerto vem da evidência, (b) separar métricas de acerto e de citação, (c) o formato do portão do A6.
- A6 hoje diz "confiança baixa vira sem informação" sem dizer como medir a confiança no Haiku. O artigo mostra que o limiar de recuperação precisa ser calibrado e relatado (frequência de recuperação contra acurácia); o plano deve fixar no piloto o critério e o limiar, e registrar a taxa de abstenção por braço.
- Registrar que o estudo não replica o Self-RAG (nada é treinado) para não sugerir isso ao leitor.
