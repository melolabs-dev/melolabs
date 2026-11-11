---
# Frontmatter exigido. O portão (tools/publish/publish.py) bloqueia sem: title, lang igual ao arquivo (pt.md = pt, en.md = en),
# status: approved (só o autor aprova), sources com ids de notas do RAG validadas e publicáveis, e qualquer "TODO" no texto.
# O site (Astro) aceita: title, lang, date, tags, sources, summary, status. Os demais campos abaixo são exigidos pelo CLAUDE.md.
title: ""                       # promessa concreta; nome do que foi medido, não do que se sente. Ex.: "Haiku com mini data lake: como testamos, o que funcionou e o que o teste não prova"
lang: pt                        # pt | en (um arquivo por idioma: pt.md e en.md)
date: AAAA-MM-DD
tags: []                        # até 4 (o DEV corta em 4). Sem espaços nem hífens nas que forem para o DEV.
sources: []                     # ids das notas do RAG (ex.: estudo-<slug>). O portão confere validated_by_author e publishable.
summary: ""                     # 1 frase para o cartão e o RSS (opcional no site)
status: draft                   # draft | review | approved (nunca marcar approved por conta própria) | published
study: slug-do-estudo           # pasta em studies/<slug>/
translation_of: ""              # só no en.md: slug do artigo em pt (CLAUDE.md, seção Idiomas)
---

<!--
COMO USAR ESTE TEMPLATE
- Estrutura extraída dos artigos que funcionaram (haiku-sdd-producao e rag-data-lake-haiku). Apague os comentários antes de pedir revisão.
- Todo número do texto precisa de uma linha em studies/<slug>/claims.json apontando para o dado bruto, a análise ou a fonte verificada.
  Sem claim, escreva "TODO: medir" (o portão bloqueia até resolver). Nunca invente número, DOI, URL ou benchmark.
- pt e en têm números, tabelas e links de dados IDÊNTICOS. Ajuste de número só com o outro idioma junto.
- Resultado negativo e inconclusivo entra com o mesmo rigor do positivo. Hipótese pendente ou subpotente impede a publicação (CLAUDE.md).
- Figuras em dois idiomas: assets/<slug>/fig-<nome>-pt.svg e fig-<nome>-en.svg (e .png). Texto alternativo descritivo em cada uma.
- Escreva o artigo técnico e, junto, o guia simples (templates/guia.md); o resumo do topo aponta para o guia.
-->

**Resumo.** <!-- 3 a 6 linhas: o que pré-registrou, quantas chamadas/execuções rodou, o número principal com a comparação (X contra Y, a custo Z), quantas hipóteses foram apoiadas e qual não foi, e a principal ameaça à validade (apontar a seção). Termine com o link para o guia: "Para quem quer só o resumo prático, existe o [guia simples](/pt/<slug>-guia/)." -->

![Visão geral do método](/assets/<slug>/fig-metodo-pt.svg)

## 1. A pergunta e a decisão que ela informa

<!-- Contexto de uma ou duas frases (estudo anterior, lacuna). Depois: que decisão prática o resultado orienta (onde investir, o que trocar). -->

**Pergunta do estudo:** <!-- uma frase, mensurável. -->

## 2. O material

<!-- O que foi testado: base de dados, projeto, estímulos, perguntas. Versão/commit, tamanhos, como foi gerado ou escolhido (semente fixa, se houver sorteio). -->

### 2.1 <!-- insumo principal (lake, corpus, telas) -->

### 2.2 <!-- perguntas / tarefas / pares, com 1 exemplo real -->

### 2.3 O gabarito e como o validamos

<!-- Quem escreveu (IA ou humano), como foi conferido (revisão cega, validação com material-ouro, calibração separada) e o que isso NÃO mede (ex.: consistência, não acurácia independente). -->

## 3. As condições (ou braços): o que cada uma recebe e por que existe

| Condição | O que o modelo recebe | A pergunta que ela responde |
|---|---|---|
| A0 | só o pedido | linha de base |
| A1 | | |
| Controle | | o que o ruído/passada extra faz sozinho? (controle negativo) |

<!-- Inclua controles negativos: sem eles, "o contexto ajudou" pode ser só "qualquer texto no prompt ajuda". -->

## 4. As escolhas de projeto, e como as definimos antes da rodada

<!-- Piloto (tamanho), o que ele fixou (parâmetros, k, limiares), o que foi congelado e onde (tag git prereg-<slug>, hashes em dados/CONGELADO.txt). Custo: como foi medido (tokens x preço de lista, igual para todos), preço usado e data. -->

## 5. A execução

<!-- Como rodou (ferramenta, esforço, ferramentas desligadas, nº de chamadas, duração), quantas falharam, o que foi refeito, desvios do pré-registro (arquivo de desvios) e tag dos dados brutos (dados-<slug>). -->

## 6. As hipóteses, uma a uma

<!-- Para CADA hipótese: o que compara, métrica, limiar de apoio, critério de refutação, resultado com intervalo e p (com correção de múltiplos testes, ex. Holm) e o veredito (apoiada | refutada | equivalente | não apoiada). Nada de "inconclusiva": ou decide ou fica subpotente e a amostra é estendida. -->

![As hipóteses e o resultado de cada uma](/assets/<slug>/fig-hipoteses-pt.svg)

| Hipótese | Métrica e critério | Resultado (IC 95%) | p (após correção) | Veredito |
|---|---|---|---|---|
| H1 | | | | |

**H1: <!-- pergunta em linguagem direta -->** <!-- compara X com Y em N itens. Critério: ... Resultado: ... -->

<!-- Análise de sensibilidade (ex.: sem o piloto) e a conclusão dela. -->

## 7. Resultados

![Resultado principal](/assets/<slug>/fig-acerto-pt.svg)

| Condição | Resultado principal | Por tipo/bloco | Custo por decisão correta (US$ nominal) |
|---|---|---|---|

<!-- Mostrar variação (IC, desvio, concordância entre amostras), não só média. -->

### 7.1 O que deu certo

<!-- Lista numerada, cada item com número e claim. -->

### 7.2 Como o modelo erra

<!-- Tabela dos tipos de erro por condição (abstenção, decisão antiga, outra). O erro dominante costuma ser surpreendente. -->

### 7.3 O custo

![Custo](/assets/<slug>/fig-custo-pt.svg)

<!-- Custo nominal a preço de lista, o gasto real à parte, custo de montar o material (estimado, não medido) como ponto de equilíbrio. -->

### 7.4 O que não funcionou, ou ficou inconclusivo

<!-- Itens que pioraram, hipótese não apoiada, bloco fácil demais (teto/piso), instrumento que não validou. Mesmo rigor do positivo. -->

## 8. Por que esses resultados valem, e até onde

<!-- Proteções do desenho: pré-registro, controles, amostras repetidas, correção de múltiplos testes, sensibilidade, hashes, relato dos negativos. -->

## 9. Ameaças à validade

<!-- Uma por linha, em negrito + 1 a 2 frases. Obrigatórias, se existirem: circularidade (quem gerou e quem pontua), autoria por IA da mesma família, uma só base/tela/projeto, poder estatístico (que diferença detecta), parâmetros escolhidos no piloto, temperatura não controlada, custo de montar o material fora da conta, instrumento não validado (ex.: estética). -->

## 10. O que isso permite concluir

<!-- Dois blocos: "Com segurança:" e "Sem segurança:". Termine com o próximo passo natural. -->

## 11. Reprodutibilidade

<!-- Código (tools/...), dados (studies/<slug>/dados/bruto/ com manifesto de hashes), figuras (script), tags prereg-<slug> e dados-<slug>, comando exato da análise, DOI do arquivamento (Zenodo) com versão. -->

## Referências

<!-- Só fontes com verificada: true em studies/<slug>/fontes/ (URL ou DOI aberto). -->

---
*Os experimentos, os dados e as conclusões são meus. A redação foi assistida por IA e revisada por mim.*
<!-- No en.md: "The experiments, data and conclusions are mine. The writing was AI-assisted and reviewed by me." (o portão reconhece "assistida por IA" e "AI-assisted") -->
