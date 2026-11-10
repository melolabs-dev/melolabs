---
title: "Dê ao Haiku a memória do projeto, não o projeto inteiro"
lang: pt
date: 2026-11-10
tags: [rag, haiku, guia, custo, agentes]
sources: [estudo-rag-data-lake-haiku]
status: draft
study: rag-data-lake-haiku
---

**Versão simples do estudo "Haiku com mini data lake".** Se você quer o rigor científico, leia o [artigo técnico](/pt/rag-data-lake-haiku/). Aqui está o que ele significa para quem quer usar isso amanhã.

## Em uma frase

Um modelo pequeno, o Haiku, **sem nenhum material do projeto, acerta só 1 de cada 7 decisões** que dependem do histórico do projeto. Com uma **memória curada do projeto** (trechos dos documentos mais os cartões de decisão, com a marca de quais decisões já foram substituídas), ele acertou **114 de 120 perguntas, por menos de 1/200 do custo de colar o projeto inteiro no prompt**. A ressalva importante está mais abaixo: as perguntas saíram dos mesmos cartões que a memória entrega.

## O que a gente testou

Montamos um "mini data lake" do projeto aberto h3: 109 documentos (código, issues, documentação e o estudo anterior) e 152 cartões de decisão, cada um com a decisão, o motivo, quando vale e se foi substituída por outra. Fizemos **120 perguntas de múltipla escolha** sobre decisões do projeto (60 comuns, 30 em que existe uma decisão antiga e uma vigente, 30 sem resposta no material). Cada pergunta foi respondida **5 vezes** por cada forma de dar contexto ao Haiku, num total de **7.200 chamadas**, sem nenhuma falha.

## O que a gente descobriu

| Como o Haiku recebeu o contexto | Acertos em 120 | Custo por decisão correta* |
|---|---|---|
| Só a pergunta | 43 (36%) | US$ 0,001 |
| Projeto inteiro colado no prompt | 91 (76%) | **US$ 0,295** |
| Busca simples por trechos | 84 (70%) | US$ 0,0011 |
| Busca melhor (híbrida + reordenação) | 99 (83%) | US$ 0,0010 |
| **Memória curada (trechos + cartões + decisões substituídas)** | **114 (95%)** | **US$ 0,0009** |
| Documentos certos entregues de bandeja (limite superior) | 86 de 90 (96%) | US$ 0,0015 |

*Preço de lista sem cache, por chamada acertada. Na assinatura o gasto real foi menor.

**1. Colar tudo é caro e não é o melhor.** O projeto inteiro tem cerca de 224 mil tokens. Colar isso em cada pergunta custou, no preço de lista, **mais de 300 vezes** o da memória curada, e acertou menos (76% contra 95%).

**2. A memória curada chegou perto do máximo.** Nas 90 perguntas que têm resposta no material, ela acertou 84 (93%); entregar os documentos certos de bandeja acertou 86 (96%).

**3. O Haiku com o contexto certo ficou perto do Sonnet.** Com os documentos certos, o Haiku acertou 86 de 90 e o Sonnet 90 de 90, uma diferença de cerca de 4 pontos.

**4. Ruído e decisões velhas não atrapalharam tanto aqui.** Misturar trechos irrelevantes ao material certo, ou decisões já substituídas, mudou pouco o acerto (86 e 87 de 90 contra 86). Trechos irrelevantes sozinhos derrubaram o Haiku para 26%, abaixo de não dar nada.

## Onde a gente não confirmou

- **O "portão de abstenção" piorou o resultado.** A ideia era o sistema responder "não sei" sem chamar o modelo quando a busca não achasse nada bom. Ele abstém demais: caiu para 78 acertos de 120. Não vale usar como está.
- **Custo contra o Sonnet com os documentos certos.** Esperávamos que o Haiku com a melhor busca chegasse a 90% do acerto do Sonnet com os documentos certos gastando menos da metade. O custo ficou muito abaixo, mas a evidência estatística do acerto não passou do nosso critério (p = 0,08 após a correção).

## A ressalva que muda como ler isso

**As perguntas foram escritas a partir dos mesmos cartões de decisão que a memória curada entrega.** Em 79 das 90 perguntas com resposta, o cartão de origem estava entre os 3 cartões entregues. Num projeto real, as suas perguntas não saem dos seus cartões. O ganho de 83% para 95% da memória curada sobre a busca melhor é, portanto, um **teto**, não uma previsão. O que sobra com segurança: buscar bem (híbrido mais reordenação) já ganha muito de colar tudo, e entregar poucos trechos custa centenas de vezes menos.

## A receita prática

1. **Não cole o projeto inteiro.** Mais contexto não é mais acerto.
2. **Busque por trechos, combinando palavra-chave e significado, e reordene** os candidatos antes de montar o prompt.
3. **Escreva cartões de decisão** (decisão, motivo, quando vale, o que substitui) e **marque o que foi substituído**.
4. **Permita responder "informação insuficiente"**, mas não automatize essa abstenção sem testar.
5. **Meça com perguntas que você não escreveu a partir dos seus cartões.**

## O que fica de fora

Um projeto, 120 perguntas de múltipla escolha, gabarito escrito e revisado por IA da mesma família dos modelos testados. Perguntas abertas, outros projetos e outros modelos ficam para outros estudos. Os dados e o código estão no [repositório do estudo](/pt/rag-data-lake-haiku/).
