---
id: haiku-contra-sonnet-sdd
title: Haiku contra Sonnet no SDD (rodadas 1 e 2)
source_url: "https://claude.ai/artifact/2DPBs4qBTeG8CQNcEEi66F"
kind: experiment
evidence: experimento-proprio
validated_by_author: true
publishable: false
fidelity: lossless-html
date: 2026-11-04
tags: [sdd, haiku, sonnet, prd, techspec, voto, gate]
---
# Haiku contra Sonnet no SDD (rodadas 1 e 2)

Estudo de caso · 4 e 5 de novembro de 2026

# Haiku contra Sonnet no SDD

Um modelo pequeno, guiado por um fluxo de verificação, ajuda a escrever PRDs, decisões e especificações melhores? Três testes, o custo de cada um, e o que o método revelou no caminho.

Autor: Caio Melo · Tema: login persistente entre sistemas clientes (especificação de SSO)

## Resumo

Foram três testes, todos com os mesmos insumos para os dois braços. O primeiro comparou PRDs, o segundo decisões de arquitetura e o terceiro especificações de desenvolvimento de baixo nível. Em cada um, o braço Haiku seguiu o fluxo do paper; o braço Sonnet usou o agente padrão. Os textos foram julgados às cegas, por três avaliadores Opus, e as decisões foram comparadas com um gabarito.

26/35

PRD pelo fluxo com Haiku

15/35

PRD pelo Sonnet padrão

26 = 26

especificação: empate na rubrica

~20×

tokens do fluxo Haiku na especificação

**Leitura em uma frase.** O fluxo com Haiku melhora a rastreabilidade e a cobertura do gabarito, mas não produz uma especificação mais executável, e custa cerca de vinte vezes mais tokens. Para especificar, o agente padrão do Sonnet bastou nesta rodada. O fluxo do paper se paga, se for o caso, como verificador.

## Pergunta e método

A pergunta é se a estratégia do paper, de decompor, verificar com sinais objetivos e escalar só quando preciso, faz um modelo pequeno chegar perto de um modelo maior. Cada teste usou a mesma tarefa: expandir um PRD de SSO para o caso em que um sistema de autenticação entra por outro serviço de identidade e reaproveita a mesma sessão.

O braço Haiku foi executado de forma purista: cada etapa do paper virou um subagente novo, com um objetivo só e sem contexto herdado. O braço Sonnet usou o agente padrão de cada tarefa. Não havia humano para responder perguntas, então cada braço assumiu premissas e as registrou. O gabarito veio de uma análise feita antes, e os avaliadores o usaram só para checar cobertura.

## Teste 1: o PRD

O avaliador recebeu os dois PRDs com rótulos aleatórios e a rubrica. Ele conferiu as citações de arquivo e linha no código. O total soma sete critérios de 0 a 5, o que dá 35 pontos.

**Fluxo com Haiku**Padrão (Sonnet)

PRD: notas por critério (0 a 5). C3 é a conversão do número de itens do gabarito identificados, pela regra floor(n/2).

O padrão errou um ponto central do estado atual: disse que a integração estava desligada por uma flag que só controla um provedor. O fluxo com Haiku identificou que a parte de backend do primeiro requisito já existia e que o problema estava na interface. Ele teve uma incoerência de baixo impacto, ao listar como fora de escopo uma migração que o sistema já tinha feito.

## Teste 2: as decisões

Seis perguntas de arquitetura, cada uma com opções. As opções foram escritas com a resposta correta sinalizada no enunciado, o que se mostrou um erro de desenho.

| Pergunta | Gabarito | Haiku | Conf. | Sonnet | Conf. |
| --- | --- | --- | --- | --- | --- |
| Q1 Sessão válida pula o login | A | A ok | 0,85 | A ok | 0,75 |
| Q2 Validação do endereço de retorno | B | B ok | 0,75 | B ok | 0,80 |
| Q3 Token por cliente | B | B ok | 0,70 | B ok | 0,70 |
| Q4 Logout explícito e migração de chamada | C | C ok | 0,55 | C ok | 0,65 |
| Q5 Segredo fora da URL | B | B ok | 0,80 | B ok | 0,75 |
| Q6 Bloquear endpoints legados | A | A ok | 0,70 | A ok | 0,85 |
| **Acertos** |  | **6 de 6** | 0,725 | **6 de 6** | 0,750 |

**Empate que não ensina nada.** Os dois acertaram tudo, e as escolhas foram iguais nas seis perguntas. Este conjunto não separa os modelos.

## Teste 3: a especificação de desenvolvimento

Este teste pediu uma especificação de baixo nível, para um desenvolvedor pleno implementar sem perguntar: regras, mudanças de banco, endpoints com requisição e resposta, e trechos antes e depois. O braço Sonnet usou o agente padrão de especificação, em um subagente. O braço Haiku seguiu o pipeline do paper em etapas separadas: esclarecimento, plano, investigação, amostras por decisão com voto, escalonamento, requisitos, verificação em quatro chamadas, gate, detalhamento e extração.

### Como o pipeline funcionou

| Etapa | Subagentes | Resultado |
| --- | --- | --- |
| Esclarecimento, plano e investigação | 3 | 24 decisões identificadas, com evidências de código. |
| Classificação das críticas | 1 | 23 de 24 marcadas como críticas. Mais do que o paper pede. |
| Amostras independentes (3 por decisão) | 69 | Cada amostra é um subagente novo, sem ver as outras. |
| Voto determinístico (script) | 0 | **8 de 23 com consenso. 15 sem maioria (65%).** |
| Escalonamento para Sonnet (árbitro) | 15 | Um árbitro por decisão sem consenso, com as três propostas à vista. |
| Requisitos com IDs | 1 | 35 requisitos, cada um ligado a uma decisão. |
| Verificação independente (CoVe) | 4 | Três checagens sem problema. Uma tensão real, que virou correção. |
| Correção pela verificação | 1 | Uma tensão real resolvida num requisito. |
| Gate determinístico | 0 | Reprovou, por falso positivo (ver abaixo). Passou na checagem corrigida. |
| Detalhamento livre e extração | 2 | Endpoints, banco e antes/depois, depois formatados. |
| **Total do braço Haiku** | **96** |  |
| Braço Sonnet (agente padrão) | 1 | 78 chamadas de ferramenta, 948 s. |

### O que o método revelou

- falha **Voto com texto livre não converge.** Três amostras propuseram três redações diferentes da mesma ideia, e o voto por texto normalizado não as agrupou. O paper pede opções fechadas, e o plano não as forneceu. Isso jogou 65% das decisões para o escalonamento, e foi o maior custo do pipeline.

- falha **O gate bruto reprovou um documento correto.** O validador contava cada menção a um requisito, inclusive as referências cruzadas no corpo, como uma definição nova. Por isso 13 requisitos apareceram como duplicados e sem critério. Contando só as definições, o documento passou: 35 requisitos, todos com Dado/Quando/Então. Um gate precisa separar definição de referência.

- sucesso **A verificação independente achou uma tensão real.** Nenhuma das quatro checagens achou contradição direta, mas a de contradições apontou um par de requisitos cujo efeito conflitava. A correção foi feita e documentada.

- sucesso **O escalonamento produziu decisões defendidas por evidência.** Em vários casos o árbitro rejeitou as três amostras e propôs uma síntese, citando o trecho de código que a sustentava.

- falha **A cegueira vazou uma vez.** Na primeira rodada de avaliação, um dos textos trazia no título o nome do braço. A rodada foi descartada, as cópias foram limpas e a avaliação refeita do zero.

### Julgamento da especificação

Três avaliadores Opus avaliaram os dois textos às cegas, na segunda rodada, com a rubrica do teste de PRD adaptada para especificação. O consenso é a mediana por critério e a maioria de dois em três nos itens do gabarito.

**Fluxo com Haiku**Agente padrão (Sonnet)

Especificação, consenso de três avaliadores: notas por critério (0 a 5). C8 não entra na soma, e tem menor valor melhor.

| Critério | Fluxo Haiku | Sonnet | O que mede |
| --- | --- | --- | --- |
| C1 Cobertura do pedido | 3 | 4 | Se o caso de autenticação pelo outro serviço, com reuso de sessão, aparece com o peso pedido. |
| C2 Precisão factual | 5 | 5 | Citações arquivo:linha conferidas no código. |
| C3 Gabarito (floor(n/2)) | 2 | 1 | Consenso: 5 itens do gabarito no fluxo Haiku, 2 no Sonnet. |
| C4 Executabilidade | 2 | 4 | Um dev pleno implementa sem perguntar? Código antes/depois e contratos completos. |
| C5 Testabilidade | 5 | 4 | Critérios Dado/Quando/Então ou verificáveis. |
| C6 Escopo e riscos | 5 | 4 | Fora de escopo, premissas e lacunas marcadas. |
| C7 Rastreabilidade | 4 | 4 | Requisitos ligados a decisões e evidências. |
| **Total (C1 a C7)** | **26** | **26** | Empate. |
| C8 Alucinações (menor é melhor) | 2 | 3 | Afirmações sem sustentação no código. |

**Empate no total, perfis opostos.** O fluxo com Haiku ganha em teste, cobertura do gabarito e rastreabilidade, e erra menos. O agente padrão ganha em executabilidade e cobertura do pedido: traz código antes/depois e os contratos que um desenvolvedor usa. Para implementar, a especificação do Sonnet é a mais útil. Para auditar e cobrir pontos de risco, a do Haiku é a mais completa.

### Confiança nos avaliadores

- **Primeira rodada descartada.** Um dos textos trazia no título o nome do braço, o que quebrava a cegueira. Ela foi descartada.

- **Segunda rodada, três avaliadores limpos.** As somas de C1 a C7 foram 26, 24 e 25 para o Sonnet, e 26, 26 e 26 para o Haiku. As conclusões são as mesmas nos três, com variação pequena.

- **Contagem de citações.** Os três conferiram entre 18 e 58 citações por texto. As duas especificações têm alta precisão factual.

## Custo e tempo

Os tokens vêm do relatório de uso do harness, por subagente. Entrada, saída e cache não foram divididos. As amostras das decisões somam 69 subagentes, e eu não guardei o valor exato de cada uma, então o total delas é uma estimativa.

**Fluxo com Haiku**Sonnet

Tokens totais, em milhões. O braço Haiku da especificação é medido mais estimado (amostras). Sonnet da especificação é o total do único subagente.

| Execução | Modelo | Subagentes | Tokens | Duração |
| --- | --- | --- | --- | --- |
| PRD | Haiku, fluxo SDD | 1 | 150.706 | 308 s |
| PRD | Sonnet, padrão | 1 | 99.573 | 362 s |
| Decisões | Haiku puro | 1 | 139.906 | 104 s |
| Decisões | Sonnet puro | 1 | 223.983 | 330 s |
| Especificação | Haiku, pipeline completo | 96 | ≈ 6,1 milhões (medido 2,2 M, amostras estimadas em ≈ 3,9 M) | n/d |
| Especificação | Sonnet, agente padrão | 1 | 298.431 | 948 s |
| Avaliação Opus, PRD | Opus, 1 avaliador | 1 | 176.958 | 340 s |
| Avaliação Opus, especificação | Opus, 3 avaliadores (rodada limpa) | 3 | 542.213 | ≈ 200 s cada |

- **Especificação:** o fluxo com Haiku usou cerca de 20 vezes mais tokens que o agente padrão do Sonnet, para um empate na nota total.

- **Escalonamento:** 1,12 milhão de tokens só para os quinze árbitros, por causa do voto com texto livre.

- **PRD e decisões:** o fluxo com Haiku gastou 51% a mais de tokens no PRD e 37% a menos nas decisões.

**Ponto de equilíbrio em preço.** Com a mesma proporção de entrada e saída, o fluxo com Haiku só é mais barato que o Sonnet se o preço por token do Haiku for menor que cerca de 0,05 do preço do Sonnet, na especificação. No PRD, o limite era 0,66. A tabela de preços vigente não foi verificada nesta rodada.

## O que deu certo

- sucesso O fluxo com Haiku teve precisão factual máxima nas citações, nos três testes.

- sucesso A verificação independente achou uma tensão real, que foi corrigida.

- sucesso O Haiku puro acertou as seis decisões, com confiança média de 0,73.

- sucesso O Haiku cobriu cinco itens do gabarito na especificação, contra dois do Sonnet.

- sucesso A medição de cada execução saiu do harness, então tokens e tempo não dependem do que o agente lembra de si.

## O que não deu certo

- falha O fluxo com Haiku não cumpriu o protocolo do paper em todas as etapas: o PRD rodou num único subagente, e não em chamadas separadas por etapa.

- falha O voto com texto livre não converge. Sem opções fechadas, 65% das decisões foram para o escalonamento.

- falha O gate bruto reprovou um documento correto, por falso positivo do validador.

- falha A especificação do Haiku é menos executável: nota 2 de 5, contra 4 do Sonnet.

- falha O teste de decisões saturou, com 6 de 6 para os dois.

- falha A cegueira vazou na primeira rodada de avaliação, e a rodada teve de ser refeita.

## Preocupações

- **Amostra pequena.** Uma execução por braço em cada teste. Uma diferença de 26 contra 15 no PRD pode ser variação entre execuções.

- **Gabarito escrito pelo próprio autor.** A análise de referência foi escrita por quem conduziu o teste, o que pode favorecer os itens que ele mesmo levantou.

- **Escala do gabarito.** A conversão de itens encontrados para a escala 0 a 5 usa floor(n/2). Os números brutos são mais honestos.

- **Sem humano no loop.** Os dois braços assumiram premissas. O paper prevê respostas humanas ou de um modelo maior na etapa de esclarecimento.

- **Custo de medição.** Os avaliadores Opus também consomem tokens, e são contados à parte.

## Próximas rodadas

- Trocar o voto de texto livre por opções fechadas, numeradas no plano. Sem isso, o voto não tem como convergir.

- Separar, no gate, definição de referência: só cabeçalho de requisito conta como definição.

- Repetir cada braço três vezes, com média e dispersão.

- Testar a verificação com o Haiku só nas etapas que ela ajuda, em vez de rodar o pipeline inteiro.

- Medir tokens de entrada e saída separados, e anotar o preço dos modelos na data da rodada.

- Usar duas ou três features novas, e não só esta.

## Rodada 2: refazer com as melhorias

Na segunda rodada, o pipeline Haiku foi refeito em duas variantes, comparadas com a primeira versão e com o agente padrão do Sonnet, que não foi refeito. A variante A2 aplicou as melhorias listadas no artigo. A variante A3 aplicou também hipóteses inferidas dos testes, para cortar tokens. Cada texto foi avaliado às cegas por três avaliadores Opus, com a mesma rubrica.

### O que mudou em cada variante

- **M1, opções fechadas:** cada decisão recebeu três opções e a opção "nenhuma". O voto passou a comparar letras.

- **M2, contexto mínimo:** cada amostra lê só o arquivo da própria decisão.

- **M3, gate por definição:** só o cabeçalho de requisito conta como definição.

- **M4, árbitro só sem maioria**, e **M5, verificação em quatro chamadas**.

- **H2 (só em A3):** verificação em duas chamadas, em vez de quatro.

- **H3 (só em A3):** extração por script, sem LLM.

- **H1 (testada e refutada):** classificação mais estrita das críticas. O classificador continuou marcando as 23 decisões.

### O que o voto por letra mudou

| Medida | Texto livre (rodada 1) | Opções fechadas (rodada 2) |
| --- | --- | --- |
| Decisões críticas com consenso | 8 de 23 | 23 de 23 |
| Árbitros Sonnet necessários | 15 | 0 |
| Subagentes de amostra | 69 | 69 |

Esta foi a maior melhoria da rodada. Com texto livre, as três amostras quase nunca coincidiam. Com letras, a votação fechou em todas as decisões críticas e dispensou os quinze árbitros.

### Quatro textos avaliados às cegas

Três avaliadores Opus, cada um com a rubrica completa. O consenso usa a mediana por critério e a maioria de dois em três nos itens do gabarito.

| Texto | Soma C1..C7 (de 35) | Gabarito (de 10) | Alucinações | Observação |
| --- | --- | --- | --- | --- |
| Agente padrão Sonnet | **29** | 3 | 4 | Mais executável e mais completo no pedido. Erra a mecânica de partida do sistema de autenticação. |
| Haiku v1 (primeira versão) | 25 | **5** | 3 | Mais cobertura do gabarito. Pouco executável. |
| Haiku A2 (melhorias do artigo) | 22 | 2 | **1** | Menos alucinações, menos cobertura do gabarito. |
| Haiku A3 (hipóteses) | 17 | 1 | 5 | Pior em tudo. O corte de verificação e a extração por script prejudicaram o texto. |

Nenhum texto cobre o endpoint legado de roteamento, o retorno 410 do cliente de configurações e a divergência de atributos entre senha e token. Essas lacunas valem para todos.

### Custo da rodada 2

| Variante | Subagentes | Tokens (medidos e estimados) |
| --- | --- | --- |
| Agente padrão Sonnet | 1 | ≈ 0,30 milhão |
| Haiku v1 (primeira versão) | 96 | ≈ 6,1 milhões |
| Haiku A2 | 78 | ≈ 4,2 milhões (amostras estimadas em 3,6 milhões) |
| Haiku A3 | 6 próprios, mais as amostras e opções compartilhadas com A2 | ≈ 4,1 milhões |

A amostragem domina o custo. Cada subagente gasta cerca de 52 mil tokens só de base, mesmo com contexto mínimo. Por isso, cortar verificação ou extração economiza pouco: as 69 amostras sozinhas somam cerca de 3,6 milhões.

## Conclusão

Nesta rodada, o pipeline do paper com Haiku não superou o agente padrão do Sonnet em produzir uma especificação. Empatou na nota total e custou cerca de vinte vezes mais. Ele foi melhor em cobertura do gabarito, em rastreabilidade e em erros, e pior em executabilidade. O papel mais defensável para o fluxo é o de verificador: achar o que o agente padrão deixou de fora. Para escrever a especificação, o agente padrão bastou.

## Vale a pena?

**Para gerar a especificação, não vale a pena.** O agente padrão do Sonnet fez a especificação mais completa no pedido, com nota 29 contra 25 da melhor variante Haiku, e custou cerca de 15 a 20 vezes menos tokens (0,3 milhão contra 4 a 6 milhões).

- **O que funcionou:** o voto por opções fechadas. Foi a única melhoria que teve efeito grande e claro: fechou 23 de 23 decisões críticas, contra 8 de 23, e eliminou 15 árbitros. O gate por definição também corrigiu um falso positivo.

- **O que não funcionou:** a classificação mais estrita das críticas, que foi refutada. E os cortes de verificação e de extração, que não trouxeram economia relevante e pioraram o texto. A variante com mais cortes ficou em último lugar.

- **Onde o Haiku ajuda:** a verificação independente encontrou erros reais no levantamento de requisitos, como cinco decisões com letra trocada. Isso mostra o papel de verificador. A variante A2 não teve esses erros, o que indica variação entre execuções.

- **Onde o custo está:** cada subagente gasta cerca de 52 mil tokens de base. Com 69 amostras independentes, esse custo fixo domina tudo. Reduzir o número de subagentes é a alavanca real de economia.

**Recomendação prática.** Use o agente padrão do Sonnet para produzir a especificação. Use o fluxo com Haiku só como verificador seletivo, em decisões de alto risco, e sempre com opções fechadas. Antes de adotar qualquer variante, teste se a votação funciona com uma única chamada que responda as três amostras em letras, para medir o quanto a independência pesa no resultado.

## Dados do estudo

Todos os números deste artigo saem de registros gravados durante o teste: as avaliações, o uso reportado pelo harness, a correção das decisões, o voto, o gate e a consolidação do consenso.

| Registro | Conteúdo |
| --- | --- |
| Relatório do benchmark | Resultados, método e limitações de cada teste. |
| Avaliações dos textos | Notas por critério, citações conferidas, alucinações e consenso de três avaliadores. |
| Uso reportado pelo harness | Tokens, chamadas de ferramenta e duração de cada subagente. |
| Voto e escalonamento | Escolhas por amostra, grupos, consenso e árbitros. |
| Gate e verificações | Resultado bruto, checagem por definição e respostas da verificação independente. |

Estudo conduzido com Claude Code. Números medidos entre 4 e 5 de novembro de 2026. Os resultados valem para esta rodada e estes insumos.
