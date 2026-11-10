---
id: rag2-2401.15884
titulo: "Corrective Retrieval Augmented Generation"
autores: "Shi-Qi Yan, Jia-Chen Gu, Yun Zhu, Zhen-Hua Ling"
ano: 2024
tipo: academico
url: https://arxiv.org/abs/2401.15884
doi: 10.48550/arXiv.2401.15884
acessado: 2026-11-08
nivel_evidencia: B
vies: "Autores propõem e avaliam o próprio método. Execução única, sem variância nem teste de significância reportados. Geradores de 7B (LLaMA2 e Self-RAG), avaliador ajustado nos dados do PopQA e limiares escolhidos empiricamente por conjunto. Parte dos números das linhas de comparação foi citada de outros artigos."
verificada: true
---
# Corrective Retrieval Augmented Generation (CRAG)

> tipo: academico. nivel_evidencia: B (método descrito, código anunciado, conjuntos públicos; não A porque é execução única e sem intervalos). Versão lida: arXiv v3, 7 out 2024. O texto extraído não tem paginação confiável; a localização usa seção, tabela e figura. A venue de publicação não consta no texto lido. A Tabela 1 saiu da extração com as colunas embaralhadas; reconstruí as linhas e conferi cada diferença com os valores dados na prosa da Seção 5.3 (todas batem).

## Resumo
CRAG acrescenta ao RAG um avaliador de recuperação leve que dá uma nota de relevância a cada documento recuperado e, a partir de limiares, escolhe uma entre três ações: Correto (refinar os documentos em trechos menores e usar), Incorreto (descartar e buscar na web) ou Ambíguo (combinar os dois). Um passo de decompor e recompor filtra trechos irrelevantes dos documentos. O método é plug-and-play e foi acoplado ao RAG padrão e ao Self-RAG, com ganhos em quatro conjuntos (PopQA, Biography, PubHealth, ARC-Challenge) usando geradores de 7B. Importante para o nosso uso: em nenhum caso o sistema se abstém; baixa confiança aciona busca externa, não a resposta "sem informação".

## Método
- **Avaliador (Seção 4.2, Apêndice B.3):** T5-large (0,77B parâmetros) ajustado. Compara-se com o crítico do Self-RAG, um LLaMA-2 de 7B ajustado. Para cada pergunta, geralmente 10 documentos recuperados (Contriever, os mesmos resultados do Self-RAG); a pergunta é concatenada a cada documento e o avaliador dá uma nota individual de -1 a 1.
- **Dados de treino do avaliador (4.2, B.3):** positivos vêm do título da Wikipedia "ouro" do PopQA (passagem de qualidade alta, "não 100% relevante"), rótulo 1; negativos são amostrados dos resultados recuperados, parecidos com a pergunta mas não relevantes, rótulo -1. O PopQA tem 14 mil amostras, 1.399 para teste (como no Self-RAG) e o restante para ajuste. O mesmo avaliador é transferido sem novo ajuste para Biography, PubHealth e ARC.
- **Gatilho de ação (4.3, B.3):** dois limiares, superior e inferior, definidos empiricamente.
  - Correto: pelo menos um documento com nota acima do limiar superior.
  - Incorreto: todos os documentos abaixo do limiar inferior.
  - Ambíguo: todos os demais casos.
  - Valores (superior, inferior): PopQA (0,59, -0,99); PubHealth e ARC (0,5, -0,91); Biography (0,95, -0,91). O texto escreve "PubQA" para PubHealth, erro de digitação óbvio. Não consta com que dados os limiares foram escolhidos (se no teste ou numa parte separada).
  - Discussão da Seção 4.3: com só duas ações (Correto e Incorreto) a eficácia dependia demais da acurácia do avaliador; o Ambíguo reduz essa dependência (resultado qualitativo preliminar, sem tabela própria).
- **Refinamento (4.4, B.3):** documentos curtos (uma ou duas frases) viram um trecho; os longos são divididos em unidades de poucas frases. O mesmo avaliador pontua cada trecho; os de nota abaixo de -0,5 saem, top-k = 5, e os que ficam são concatenados em ordem.
- **Busca na web (4.5, B.3):** a pergunta é reescrita em até três palavras-chave por ChatGPT (GPT-3.5 Turbo, prompt na Tabela 7), Google Search API, top-5 páginas, Wikipedia preferida, mesma filtragem por avaliador.
- **Geração (Figura 2, Algoritmo 1):** Correto usa a pergunta mais o conhecimento interno refinado; Incorreto usa a pergunta mais o conhecimento externo; Ambíguo usa os dois.
- **Modelos geradores (5.2, B.3):** LLaMA2-hf-7b e SelfRAG-LLaMA2-7b; baselines LLaMA2-7B e 13B, Alpaca-7B e 13B, CoVE-65B, ChatGPT, Ret-ChatGPT, Ret-LLaMA2-chat-13B, SAIL, Perplexity.ai (alguns números citados de outros artigos; os reproduzidos pelos autores levam asterisco).
- **Conjuntos e métricas (5.1, B.1):** PopQA (1.399 consultas de entidades raras, acurácia), Biography (FactScore), PubHealth (verdadeiro ou falso, acurácia), ARC-Challenge (múltipla escolha de 3 ou 4 opções, acurácia). Hardware: NVIDIA A800 80 GB (B.2).
- **Temperatura, k de recuperação para a geração, número de execuções, sementes:** não consta (k = 5 só para o filtro de trechos e a busca web).

## Resultados
- **Tabela 1 (acurácia, FactScore na coluna Bio), reconstruída; ordem PopQA, Bio, Pub, ARC:**
  - Gerador LLaMA2-hf-7b: RAG 50,5, 44,9, 48,9, 43,4; CRAG 54,9, 47,7, 59,5, 53,7; Self-RAG 29,0, 32,2, 0,7, 23,9; Self-CRAG 49,0, 69,1, 0,6, 27,9.
  - Gerador SelfRAG-LLaMA2-7b: RAG 52,8, 59,2, 39,0, 53,2; CRAG 59,8, 74,1, 75,6, 68,6; Self-RAG 54,9, 81,2, 72,4, 67,3; Self-CRAG 61,8, 86,2, 74,8, 67,2.
  - Sem recuperação, LLaMA2-7B: PopQA 14,7; LLaMA2-13B: 14,7 (alguns outros valores da linha não pude associar com segurança; não uso).
  - Conferência com a prosa (5.3): CRAG sobre RAG no gerador SelfRAG-7b, +7,0 (PopQA), +14,9 (Bio), +36,6 (Pub), +15,4 (ARC); no LLaMA2-hf-7b, +4,4, +2,8 e +10,3 (PopQA, Bio, ARC). Self-CRAG sobre Self-RAG: +20,0, +36,9 e +4,0 (hf-7b, PopQA, Bio, ARC) e +6,9, +5,0 e +2,4 (SelfRAG-7b, PopQA, Bio, Pub). No ARC com SelfRAG-7b o Self-CRAG (67,2) fica um décimo abaixo do Self-RAG (67,3), o que a prosa não menciona.
  - A PubHealth com LLaMA2-hf-7b é quase zero para Self-RAG e Self-CRAG (0,7 e 0,6) porque o modelo falha em responder verdadeiro ou falso (B.5); o mesmo ocorre às vezes no ARC (não gera o índice da opção).
- **Ablação por ação (Seção 5.4, Tabela 2, PopQA):** sem Correto, CRAG cai de 54,9 para 53,2 (hf) e de 59,8 para 58,3 (SelfRAG-7b); sem Incorreto, 54,4 e 59,5; sem Ambíguo, 54,0 e 59,0. Self-CRAG hf: 49,0, sem Correto 43,6, sem Incorreto 47,7, sem Ambíguo 48,1. Com uma só ação (Apêndice B.4, Tabela 11): só Incorreto 47,0 (hf) e 48,5 (SelfRAG-7b), só Correto 52,4 e 56,7, só Ambíguo 52,7 e 58,0, todos abaixo do CRAG completo. Efeitos de tamanho pequeno (cerca de 1 a 2 pontos) para a maioria das retiradas únicas.
- **Ablação das operações (5.4, Tabela 3, PopQA):** sem refinamento, CRAG 49,8 (hf) e 54,2; sem reescrita, 51,7 e 56,2; sem seleção do conhecimento externo, 50,9 e 58,6. Self-CRAG hf sem seleção cai para 24,9, sem refinamento 35,9.
- **Acurácia do avaliador (5.5, Tabela 4, PopQA):** avaliador T5 84,3; ChatGPT em prompt direto 58,0; com cadeia de raciocínio 62,4; com poucos exemplos 64,7. Os prompts estão nas Tabelas 8 a 10. A definição operacional de "acurácia da avaliação" (qual rótulo de verdade por consulta) não aparece no texto.
- **Robustez à qualidade da recuperação (5.6, Figura 3, PopQA, SelfRAG-7b):** removendo ao acaso parte das recuperações corretas, a acurácia de Self-RAG e Self-CRAG cai, e a do Self-CRAG cai menos. Valores numéricos só em gráfico, não extraídos.
- **Efeito da busca na web sozinha (5.7, Tabela 5, PopQA):** RAG com web 52,2 (hf) e 53,8, contra CRAG 54,9 e 59,8. Self-RAG com web 24,9 (hf, pior que sem web, 29,0) e 57,9. Os autores concluem que o ganho vem da correção e não só da web.
- **Custo (5.8, Tabela 6):** FLOPs por token cerca de 26,5 (RAG) e 27,2 (CRAG); Self-RAG de 26,5 a 132,4 e Self-CRAG de 27,2 a 80,2. Tempo por instância em PopQA: RAG 0,363 s, CRAG 0,512 s, Self-RAG 0,741 s, Self-CRAG 0,908 s (associação das colunas pela ordem do texto). Não inclui recuperação nem processamento de dados, e os autores dizem que é estimativa grosseira.

## Afirmações extraídas com localização
- A qualidade da recuperação limita a geração; retrieval ruim induz erro: Introdução, Figura 1, Seção 3.
- Um avaliador leve de 0,77B dá nota de relevância por documento e decide entre Correto, Incorreto e Ambíguo por dois limiares: Seções 4.2 e 4.3, Apêndice B.3.
- Correto exige um documento acima do limiar superior; Incorreto exige todos abaixo do inferior: Seção 4.3.
- O estado Ambíguo existe porque duas ações dependiam demais da precisão do avaliador: Seção 4.3 (Discussão).
- CRAG melhora RAG e Self-RAG em quatro conjuntos: Seção 5.3, Tabela 1.
- Cada ação e cada operação de refinamento contribui: Seção 5.4, Tabelas 2, 3 e 11.
- O avaliador ajustado supera um ChatGPT usado como juiz de relevância: Seção 5.5, Tabela 4.
- O ganho não vem só da busca na web: Seção 5.7, Tabela 5.
- A sobrecarga computacional é modesta: Seção 5.8, Tabela 6.
- É preciso ajustar um avaliador externo, o que os autores veem como limitação: Seção 6.
- Aviso de código: nota de rodapé 1 dá o repositório (github.com/HuskyInSalt/CRAG), mas a Introdução também diz que o código será publicado depois (inconsistência no texto).

## Limitações da fonte
- **Dos autores (Seção 6):** é preciso ajustar um avaliador externo; remover essa dependência é trabalho futuro.
- **Minhas:**
  - Nenhuma execução repetida, desvio ou teste de significância; muitas diferenças de ablação são de 1 a 2 pontos.
  - Limiares escolhidos por conjunto e "empiricamente"; não consta em que dados, então há risco de ajuste no teste. O limiar inferior de -0,99 é extremo: a classe Incorreto pode ser rara. A proporção de consultas em cada ação não é reportada.
  - O avaliador foi treinado com rótulos do PopQA (relevância por título de página "ouro"); a transferência a outros domínios (Biography, PubHealth, ARC) é só aplicada, sem avaliação isolada fora do PopQA (a Tabela 4 é só PopQA).
  - Geradores pequenos e específicos (LLaMA2-7B e Self-RAG), perguntas sobre a Wikipedia e a web; sem decisões de projeto nem modelos modernos. O desempenho dos ChatGPT como avaliador (Tabela 4) usa GPT-3.5 Turbo, bem mais fraco que modelos de hoje.
  - Parte dos baselines é citada de outros artigos, não reproduzida no mesmo ambiente (Tabela 1, legenda).
  - O sistema nunca responde "não sei"; não há métrica de abstenção, de resposta errada confiante nem de precisão da recusa.
  - Dois conjuntos (PubHealth e ARC) são de resposta fechada, o que se parece com o nosso formato, mas com o LLaMA2-hf-7b o modelo nem produz o formato pedido (B.5), o que confunde o efeito da recuperação.
  - Há uma ressalva própria dos autores na Tabela 5: Self-RAG com web ficou pior que sem web com o LLaMA2 original.

## O que importa para o estudo 2
- **Portão do A6:** o artigo inspira o desenho em três zonas e a regra "responder se existe pelo menos um documento acima do limiar alto; recusar se todos estão abaixo do limiar baixo; zona do meio com tratamento próprio". Mas CRAG não faz abstenção. Nossa versão é uma adaptação: Incorreto (todos abaixo do limiar baixo) viraria "informação insuficiente", em vez de busca na web (que está fora do escopo). O Ambíguo pode virar "responder com os documentos disponíveis e marcar baixa confiança" ou ir para um segundo estágio, e isso precisa ser decidido e declarado como adaptação.
- **O avaliador:** o plano não treina nada. A fonte avisa que um LLM usado como juiz de relevância por prompt ficou muito atrás do avaliador ajustado (58,0 a 64,7 contra 84,3, com GPT-3.5 Turbo e na tarefa do PopQA). Para o A6, é preciso decidir se o juiz é uma nota do reranqueador, uma chamada ao Haiku ou outro, e medir sua precisão contra o gabarito de documento-ouro (que já existe nas 100 perguntas) antes de confiar nele. Isso vira uma métrica reportável: acerto do portão sobre as perguntas respondíveis e as 20 sem resposta.
- **Limiares:** os autores calibraram por conjunto. No estudo 2, calibrar numa amostra separada (o piloto de 15 perguntas é pequeno demais) e congelar antes da rodada principal, para não ajustar no teste. Reportar a proporção de consultas por zona.
- **Refinamento em trechos:** a ablação mostra queda de cerca de 5 pontos sem refinar (Tabela 3). Apoia testar, em A4 ou A5, filtrar chunks por nota antes de colar no prompt, e conversa com o tamanho de chunk e o k do plano.
- **H7 e H9:** a fonte não apoia nem contradiz H7 (cortar erros confiantes); não há número de abstenção. Para H9 (custo), o único dado é a sobrecarga de 0,512 s contra 0,363 s por instância (cerca de 41% de tempo a mais para RAG com avaliador) com geradores de 7B; não transfere para chamadas de API do Haiku.
- **Copiar do método:** três zonas de decisão; avaliar a qualidade da recuperação separadamente da geração (como a Tabela 4); medir a robustez quando a recuperação piora (Figura 3), análogo ao N2 e ao A1 contra A4; ablações retirando um componente por vez.

## Contradições ou ajustes que o plano.md precisa
1. A linha do A6 diz "portão de abstenção (confiança baixa vira 'sem informação')". Isso não é o CRAG, que aciona busca na web em vez de abster. Citar o CRAG como inspiração do limiar duplo, não como evidência de que a abstenção melhora a acurácia; H7 fica sem apoio direto da literatura lida.
2. Definir antes da rodada como o portão decide: nota de quem (reranqueador, Haiku ou outro), os dois limiares, e o que acontece na zona intermediária.
3. Declarar a calibração dos limiares numa amostra fora das 100 perguntas, ou aceitar que o piloto de 15 é só para fumaça, e congelar no pré-registro.
4. Acrescentar uma métrica do próprio portão (recusa correta nas 20 sem resposta e recusa indevida nas respondíveis), já que a fonte reporta a acurácia do avaliador (Tabela 4) como componente separado.
5. Observação sobre o texto do plano (seção "O que a literatura já diz"): os cinco achados listados não incluem o CRAG; se for citado, entra como apoio de desenho do A6, com o aviso de que a fonte é de geradores de 7B e nunca mede abstenção.
