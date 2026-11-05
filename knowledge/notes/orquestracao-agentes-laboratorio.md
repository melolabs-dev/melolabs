---
id: orquestracao-agentes-laboratorio
title: "Orquestração de agentes de IA no desenvolvimento de software: um laboratório"
source_url: "https://claude.ai/artifact/4NrBysawYvXXMR8Gy8aiA6"
kind: experiment
evidence: experimento-proprio
validated_by_author: true
publishable: false
fidelity: lossless-html
date: 2026-11-04
tags: [orquestracao, agentes, paralelismo, gates, revisao-enxuta]
---
# Orquestração de agentes de IA no desenvolvimento de software: um laboratório

# Orquestração de agentes de IA no desenvolvimento de software: um laboratório em computador de trabalho

**Resumo.** Relatamos um laboratório de cerca de 36 horas, feito num computador de trabalho com 16 GB de memória e 12 núcleos, no qual agentes de IA (um orquestrador Sonnet e workers Haiku) executaram tarefas reais de dois repositórios (um frontend React e um backend Java/Quarkus) de um mesmo ciclo de entrega. Medimos tempos por evento (tarefa, revisão, gate e integração), registramos as decisões tomadas e comparamos o processo antes e depois de mudanças de fluxo. A revisão enxuta, baseada em gates verdes do próprio worker, reduziu a mediana do tempo de revisão de 620 s para 60 s (redução de 90%) nas tarefas medidas. O gargalo dominante deixou de ser a execução dos agentes e passou a ser a espera por gates pesados, a memória da máquina e pausas de orquestração. Discutimos o que transfere do front ao back, o que diverge do estudo teórico anterior e quais medições ainda faltam.

## 1. Contexto e questão

O estudo anterior, de paralelismo, estimou ganhos a partir de modelos e de medições isoladas. A pergunta deste laboratório foi outra: num computador de trabalho, com tarefas reais e decisões reais, quanto tempo leva cada etapa do ciclo, o que atrasa, e quais mudanças de processo reduzem o tempo sem perder qualidade?

Restrições do ambiente: 15,7 GB de memória física, com 0,3 a 6 GB livres durante a maior parte do laboratório; antivírus corporativo (CrowdStrike Falcon) que não podia ser alterado; WSL 2 para o backend; ciclo de 56 tarefas de front e 11 de back.

## 2. Método

- **Medição.** Cada evento relevante gerou uma linha num arquivo tabular (benchmark.tsv), com horário, projeto, etapa, duração, código de saída e memória livre no momento. Foram 160 linhas entre 15:18 e 02:13.

- **Decisões.** Cada decisão de processo ou de implementação recebeu identificador próprio (D-050 a D-110 no período), com contexto, alternativas, justificativa e resultado. O orquestrador registrou seis decisões de velocidade (SV-01 a SV-06) com medição antes e depois.

- **Qualidade.** Os gates foram os do processo oficial: lint, types, testes afetados, e2e por tag e trace de critérios de aceite; o ci:quality completo ficou no fechamento de lote. A revisão enxuta exigia gate verde do worker e não substituía o gate completo.

- **Limitações do método.** Uma única máquina, um único ciclo, um único orquestrador. As medições de memória são leituras pontuais.

## 3. Resultados

### 3.1 Tempo por etapa (medianas)

| Etapa | Projeto | n | Mediana |
| --- | --- | --- | --- |
| Gate do worker (fila e execução) | front | 20 | 540 s |
| Gate do worker | back | 17 | 147 s |
| Revisão completa (antes de SV-01) | front | 18 | 620 s |
| Revisão completa | back | 7 | 515 s |
| Revisão enxuta (SV-01, depois) | front | 26 | 60 s (média 73 s) |
| Integração | front | 45 | 30 s |
| Integração | back | 8 | 15 s |
| Vitest isolado, 4 workers | front | 4 | 60 s (contra 304 s com 1 worker) |

### 3.2 Efeito das mudanças de processo

| Mudança | Antes | Depois | Efeito medido |
| --- | --- | --- | --- |
| Revisão enxuta quando o worker já reportou gate verde (SV-01, 01:00) | revisão completa, mediana 620 s | 60 s (média 73 s) | redução de 90% no tempo de revisão |
| Conflito trivial resolvido na integração (SV-02) | devolver ao worker (estimado de 5 a 10 min) | 30 s | 10 ocorrências resolvidas diretamente |
| Teto de workers de 3 para 5, depois 6 (SV-03, SV-05) | 3 simultâneos | 5 a 6 simultâneos | 12 tarefas de front em 159 min, cerca de 13 min por tarefa |
| Gate padronizado em pnpm type-check (SV-06) | achado repetido por cada worker | sem recorrência | evitou reescrita do script três vezes |
| Teto dinâmico pela memória (regra 1) | fixo | 2 a 4 conforme memória livre | evitou falhas por memória em vários momentos |

### 3.3 Falhas e retrabalho

Dos 37 gates de worker medidos, cerca de 8 falharam na primeira rodada (aproximadamente 22%). As causas mais frequentes foram: teste de componente com operação ausente no snapshot, limite de tamanho de arquivo no checkstyle, divergência entre documento gerado e snapshot, e status HTTP inesperado (403 em vez de 400). Duas revisões foram reprovadas: uma por engano, porque o ci-quality completo não é gate de tarefa, e uma por achado alto real. O retrabalho típico foi de 9 a 15 minutos por falha.

### 3.4 A maior perda de tempo não foi computacional

O evento de maior duração do laboratório foi uma parada de 11.820 s (3 h 17 min), entre 22:07 e 01:24, sem nenhum worker de front disparado, por decisão de orquestração, à espera de ordem do usuário. Esse único intervalo custou mais tempo do que todas as esperas de gate somadas. Ao retomar, a vazão subiu de 3 para 7 tarefas por hora.

### 3.5 Qualidade

- O trace de critérios de aceite fechou com zero critérios órfãos (136 cobertos) ao final do front.

- Uma revisão enxuta foi reprovada depois de integrada, por achado alto de seleção de linha fora da lista visível. A revisão leve não elimina a revisão em profundidade quando há risco de interação.

- A revisão enxuta depende da confiança no gate do worker. Não medimos sistematicamente a taxa de defeitos que escapou depois da integração; é uma lacuna.

## 4. Discussão

### 4.1 O que deu certo

1. **Gate do worker e revisão enxuta.** Quando o worker entrega gate verde com o mesmo conjunto de checagens, a revisão completa repete trabalho. A redução de 90% foi a maior alavanca do laboratório.

2. **Integração imediata com resolução de conflitos triviais.** Conflitos de checkbox e de acréscimo são baratos de resolver; devolvê-los ao worker custava mais.

3. **Ordem pelo caminho crítico.** Disparar primeiro as tarefas que destravam outras reduziu paradas por dependência.

4. **Teto dinâmico pela memória.** Permitiu aumentar o paralelismo sem falhas recorrentes de memória.

### 4.2 O que diverge do estudo anterior

- O estudo teórico apontava a fila de gates como gargalo principal. No laboratório a fila pesou, mas a pausa de orquestração pesou mais.

- O estudo previa ganho grande do Vitest em paralelo. No teste isolado o ganho foi de 5 vezes, mas na revisão real o vitest relacionado continuou longo (cerca de 387 s), porque o conjunto afetado era grande: os locales JSON são importados por quase todo o front.

- Ferramentas em Rust e Go para lint e type-check tiveram resultados mistos: tsgo deu 2,4 vezes no type-check com resultado idêntico; oxlint deu 4,6 vezes no lint, mas não cobre as regras próprias; Biome falhou na configuração padrão.

### 4.3 O que pode ser explorado em execuções paralelas futuras

- Revisão em lote de tarefas independentes, com o ci:quality completo só no fechamento.

- Separar a fila de gates unitários da de integração (testes de integração longos), para que um teste longo não bloqueie um gate curto.

- Manter o orquestrador ativo com monitores em segundo plano, evitando pausas como a de 3 horas.

- Padronizar o gate por tarefa com o mesmo script em todas as worktrees, sem depender de scripts criados só na pasta principal.

### 4.4 O que do front transfere ao backend

- **Revisão enxuta** com gate verde do worker: aplicada ao back em revisões de 444 s e 324 s, ainda não reduzidas ao mínimo. O que transfere é a regra, não o número.

- **Integração imediata:** o back integrou em 15 s (mediana), contra 30 s do front. O gargalo do back é o build, não a integração.

- **Checagem de rastreabilidade antes do gate:** a tarefa 6.0 perdeu duas rodadas por um identificador de critério inexistente. Uma checagem barata antes de disparar o gate teria evitado as duas.

- **Cache do Gradle:** o gate da 6.0 caiu de 89 s para 4 s quando o build já estava em cache. O efeito do cache é grande e deve ser medido separadamente do efeito de processo.

### 4.5 Limitações

- Um único ciclo, uma máquina, um orquestrador. Não há grupo de controle sem as mudanças de processo.

- As medições de memória são pontuais. O laboratório ocorreu com memória livre entre 0,3 e 6 GB.

- As revisões enxutas não foram auditadas por amostragem sistemática.

- Parte das decisões do orquestrador se beneficiou de decisões anteriores (aprendizado no próprio laboratório), o que confunde a comparação antes e depois.

## 5. O que deve ser levantado em estudos futuros

1. **Grupo de controle:** rodar o mesmo ciclo com revisão completa e com revisão enxuta, em ordem aleatória, para medir a diferença de defeitos que escapam.

2. **Medição contínua de memória e CPU** durante o ciclo, e não só em leituras pontuais.

3. **Tempo do worker:** início e fim de cada desenvolvimento, que não foi registrado de forma completa.

4. **Custo de decisão:** tempo entre abrir e decidir cada caso, e quantos casos foram ao decisor inédito.

5. **Efeito do cache do Gradle e do Vitest,** isolado do efeito de processo.

6. **Repetição em outro computador,** inclusive com ambiente ideal, para separar limite de máquina de limite de processo.

## 6. Conclusão

Num computador de trabalho com recursos limitados, a velocidade de entrega foi determinada menos pelo tempo de execução dos agentes e mais por três coisas: esperas em gates, pausas de orquestração e revisões repetidas. A revisão enxuta sobre gates verdes do worker foi a mudança de maior efeito, com redução de 90% no tempo de revisão. A maior perda do laboratório foi uma pausa de orquestração de 3 h 17 min, sem relação com a máquina. O que transfere ao backend é a regra de processo e a checagem barata antes do gate; o ganho de build depende do cache, que precisa ser medido por si só.
