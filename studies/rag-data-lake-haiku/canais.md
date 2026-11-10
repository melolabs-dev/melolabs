# Textos para os canais (foco na versão simples; o artigo técnico entra como "para quem quer os números")

Nada foi postado no LinkedIn sem aprovação do autor. Links: guia https://melolabs.net/pt/rag-data-lake-haiku-guia/ e https://melolabs.net/en/rag-data-lake-haiku-guia/; técnico https://melolabs.net/pt/rag-data-lake-haiku/ e https://melolabs.net/en/rag-data-lake-haiku/.

## LinkedIn (guia, pt)
Dá para um modelo pequeno decidir como um grande se você der a ele a memória do projeto? Testei isso com o Haiku em 7.200 respostas sobre um projeto aberto de verdade, com as hipóteses escritas antes de rodar.

O que aconteceu: sem nenhum material, o Haiku acerta 14% das decisões que dependem do histórico do projeto. Com uma memória curada (trechos buscados, cartões de decisão e a marca do que foi substituído), acerta 93%, e cada resposta custa cerca de 250 vezes menos do que colar o projeto inteiro no prompt. Nas perguntas em que uma decisão antiga foi trocada por outra, acertou 30 de 30.

Um detalhe que me surpreendeu: quando o Haiku erra, quase nunca é por inventar. Ele responde "informação insuficiente" mesmo quando a resposta está lá.

Também ficou registrado o que não funcionou (um "portão" que responde "não sei" sozinho piorou o resultado) e a principal ressalva: minhas perguntas saíram dos mesmos cartões que a memória curada entrega, então o ganho dela é um teto, não uma previsão.

Guia com figuras: https://melolabs.net/pt/rag-data-lake-haiku-guia/
Método, números e limitações: https://melolabs.net/pt/rag-data-lake-haiku/

## LinkedIn (guide, en)
Can a small model decide like a big one if you give it the project's memory? I tested it with Haiku across 7,200 answers on a real open-source project, with the hypotheses written before running.

What happened: with no material, Haiku gets 14% of the decisions that depend on project history right. With a curated memory (retrieved chunks, decision cards and a flag for what was superseded) it gets 93%, and each answer costs about 250 times less than pasting the whole project into the prompt. On questions where an old decision had been replaced by a new one, it got 30 of 30.

One detail surprised me: when Haiku is wrong, it is almost never by making things up. It answers "insufficient information" even when the answer is there.

What did not work is recorded too (a "gate" that answers "I don't know" on its own made results worse), along with the main caveat: my questions came from the same cards the curated memory delivers, so its gain is a ceiling, not a forecast.

Guide with figures: https://melolabs.net/en/rag-data-lake-haiku-guia/
Method, numbers and limitations: https://melolabs.net/en/rag-data-lake-haiku/
