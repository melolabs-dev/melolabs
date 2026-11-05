---
id: haiku-enxuto-vs-sonnet
title: Haiku enxuto contra Sonnet padrão no fluxo SDD (rodada 3)
source_url: "https://claude.ai/artifact/T95jcsW3W8vvHRogEDef9Q"
kind: experiment
evidence: experimento-proprio
validated_by_author: true
publishable: false
fidelity: lossless-html
date: 2026-11-04
tags: [sdd, haiku, sonnet, benchmark, custo, avaliacao-cega]
---
# Haiku enxuto contra Sonnet padrão no fluxo SDD (rodada 3)

Rodada 3 · 4 de novembro de 2026 · registro pré-execução

# Haiku enxuto contra Sonnet padrão no fluxo SDD

PRD, TechSpec e tarefas, em três execuções por braço, com avaliação cega por três avaliadores Opus. Critérios fixados antes de gerar qualquer texto.

## Veredito: não vale a pena para o pacote completo

O pipeline com Haiku enxuto **cumpre o critério de custo**. Em dólar, custa cerca de **6% do Sonnet**, porque o Haiku custa 1/20 por token e a conta gastou 25% a mais em tokens. Mas **não cumpre o critério de qualidade** na TechSpec nem nas tarefas. No PRD o resultado é inconclusivo, com sinal negativo no gabarito.

Ou seja: o barato não compensa, porque a qualidade cai além da margem. A alternativa viável que o dado sugere é **híbrida**: Haiku para o PRD e as evidências, Sonnet para a TechSpec e as tarefas. Essa combinação não foi testada de ponta a ponta, por isso fica como hipótese.

2.01 M

tokens, Sonnet padrão (3 execuções)

2.52 M

tokens, Haiku enxuto (3 execuções)

6.3%

custo do Haiku em relação ao Sonnet (em dólar)

9 × 23

subagentes, Sonnet × Haiku

## 1. O que mudou em relação à rodada 2

A rodada 2 concluiu que o Haiku não valia a pena comparando tokens. Isso estava errado na justificativa. Com a tabela de preços vigente, o Haiku custa exatamente 1/20 do Sonnet em entrada e em saída. Então o custo em dólar é a razão de tokens dividida por 20, independentemente da divisão entre entrada e saída. A rodada 2 gastou entre 13 e 20 vezes mais tokens, o que dava custo próximo do empate, e não os 15 a 20 vezes "mais caro" que o texto anterior sugeria.

Esta rodada mede custo em dólar e qualidade ao mesmo tempo, com a regra de decisão definida antes da execução.

## 2. Método

- **Dois braços, três execuções cada.** Sonnet padrão: uma chamada por artefato (PRD, TechSpec, tarefas), com o agente especializado de cada etapa. Haiku enxuto: etapas curtas e independentes, saída montada por script, gate determinístico, e escalonamento para Sonnet só quando o gate reprova.

- **Mesmos insumos.** Mesmo PRD de origem, mesmo conjunto de repositórios em leitura, mesmos templates, mesma regra de não reutilizar documentos anteriores.

- **Gates determinísticos iguais para os dois braços:** estrutura, identificadores de requisito, rastreabilidade, citações arquivo:linha verificadas contra os repositórios, e rodapé de arquivos nas tarefas.

- **Avaliação cega.** Seis textos por tipo, rótulos embaralhados com semente fixa, mapa mantido fora da pasta de avaliação, identidade removida dos textos. Três avaliadores Opus independentes, consenso por mediana e maioria 2 de 3 no gabarito.

- **Custo.** O harness reporta só tokens totais por subagente. O custo é apresentado como faixa: 100% de entrada até 100% de saída.

## 3. Resultados: PRD

Soma dos critérios C1 a C7 (de 35), por execução. Braço Sonnet (cinza-verde) e braço Haiku (laranja).

Sonnet padrãoHaiku enxuto

| Execução | C1 | C2 | C4 | C5 | C6 | C7 | C3 | Soma | C8 alucin. | Gabarito consensual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S-r1 | 5 | 5 | 4 | 3 | 5 | 4 | 3 | 29 | 0 | G1 G2 G6 G7 G9 G10 |
| S-r2 | 5 | 4 | 4 | 3 | 4 | 4 | 1 | 25 | 1 | G1 G7 G10 |
| S-r3 | 5 | 4 | 4 | 3 | 4 | 4 | 2 | 26 | 1 | G1 G2 G9 G10 |
| L-r1 | 3 | 3 | 5 | 5 | 4 | 3 | 1 | 24 | 2 | G5 G10 |
| L-r2 | 3 | 4 | 4 | 5 | 4 | 3 | 0 | 23 | 0 | G10 |
| L-r3 | 4 | 4 | 5 | 5 | 4 | 3 | 1 | 26 | 1 | G1 G3 G10 |

C3 vem do gabarito consensual (floor(n/2)). Gabarito: G1–G10, item conta com maioria 2 de 3. C8 é a mediana dos três avaliadores.

## 4. Resultados: TechSpec de desenvolvimento

Aqui a diferença é grande: a média do Sonnet ficou em 31,3 e a do Haiku em 18,0, de 35. O Haiku também teve mais alucinações (mediana 3 contra 1).

Sonnet padrãoHaiku enxuto

| Execução | C1 | C2 | C4 | C5 | C6 | C7 | C3 | Soma | C8 alucin. | Gabarito consensual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S-r1 | 5 | 5 | 5 | 5 | 5 | 5 | 2 | 32 | 1 | G1 G2 G7 G9 G10 |
| S-r2 | 5 | 5 | 5 | 5 | 5 | 5 | 2 | 32 | 1 | G1 G2 G7 G10 |
| S-r3 | 5 | 5 | 5 | 5 | 4 | 5 | 1 | 30 | 1 | G1 G2 G10 |
| L-r1 | 3 | 3 | 4 | 1 | 3 | 2 | 1 | 17 | 3 | G1 G10 |
| L-r2 | 4 | 3 | 4 | 2 | 3 | 3 | 1 | 20 | 2 | G1 G10 |
| L-r3 | 4 | 2 | 4 | 1 | 3 | 2 | 1 | 17 | 3 | G1 G3 G10 |

O Haiku teve que ser corrigido em **todas as três execuções** da TechSpec: seções faltando (checklist), uma decisão de banco mal declarada e citações com caminho abreviado. Depois da correção, passou no gate, mas a qualidade do conteúdo continuou abaixo.

## 5. Resultados: tarefas de implementação

Sonnet padrãoHaiku enxuto

| Execução | T1 cobertura | T2 rodapé | T3 dependências | T4 granularidade | T5 aceite | Soma (de 25) |
| --- | --- | --- | --- | --- | --- | --- |
| S-r1 | 5 | 5 | 5 | 5 | 5 | 25 |
| S-r2 | 5 | 4 | 5 | 5 | 5 | 24 |
| S-r3 | 4 | 4 | 5 | 4 | 4 | 21 |
| L-r1 | 3 | 2 | 4 | 3 | 3 | 15 |
| L-r2 | 4 | 4 | 4 | 3 | 4 | 19 |
| L-r3 | 3 | 3 | 4 | 3 | 3 | 16 |

Todas as seis listas de tarefas passaram no gate determinístico. A diferença aparece na qualidade: rodapé de arquivos e granularidade. O Haiku ficou em média 16,7 de 25 e o Sonnet em 23,3.

## 6. Custo e tempo

Tokens somados dos subagentes, por fase. A avaliação com Opus não entra nesta tabela; está na seção 9.

Sonnet padrão (USD)Haiku enxuto (USD)

Custo do pipeline completo (3 execuções por braço): Sonnet entre **USD 4.02 e USD 20.10**; Haiku entre **USD 0.25 e USD 1.26**. A razão é a mesma nas duas pontas: 6.3%.

Sonnet padrãoHaiku enxuto

| Fase | Tokens Sonnet | Subagentes Sonnet | Tokens Haiku | Subagentes Haiku |
| --- | --- | --- | --- | --- |
| PRD | 609.701 | 3 | 617.094 | 5 |
| TechSpec | 921.425 | 3 | 1.544.283 | 15 |
| Tarefas | 478.903 | 3 | 357.198 | 3 |
| **Total** | **2.010.029** | **9** | **2.518.575** | **23** |

Tempo somado dos subagentes: Sonnet 51 min, Haiku 55 min. Os subagentes de uma mesma fase rodaram em paralelo, então o tempo de relógio é menor. Tokens e tempo são da soma das execuções, sem contar a avaliação.

O Haiku gastou mais tokens pela soma de etapas curtas: cada subagente carrega um custo fixo de cerca de 50 mil tokens de sistema e ferramentas, e o pipeline teve 23 subagentes contra 9 do Sonnet.

## 7. Gates: quanto o Haiku precisou de correção

- **PRD:** 1 de 3 passou sem correção (Haiku). O Sonnet passou em 0 de 3 no gate estrito: não usa o cabeçalho de requisito nem Dado/Quando/Então, que só o braço Haiku recebeu como instrução, e tem seções com nomes diferentes do template. Isso é diferença de formato medida, não de conteúdo.

- **TechSpec:** o Sonnet passou em 2 de 3. O Haiku passou em 0 de 3 na primeira tentativa e precisou de escalonamento nas três execuções.

- **Tarefas:** todos os seis passaram.

Durante a rodada, o gate foi corrigido várias vezes para não penalizar erros que eram do próprio verificador (resolução de caminho, aliases de pasta, nomes de arquivo ambíguos, contagem de identificadores, regra de banco e formato das tarefas). Todas as correções foram aplicadas aos dois braços, e as versões finais estão nos dados.

## 8. Premissas e hipóteses: status

Status dado só pelas regras definidas antes da execução. Hipóteses sem braço próprio ficam como não testadas, não como confirmadas.

| ID | Afirmação | Evidência nesta rodada | Status |
| --- | --- | --- | --- |
| P1 | O Haiku acerta fração não trivial sozinho | Gate de TechSpec: 0 de 3 passaram na primeira tentativa. PRD: 1 de 3 sem correção. | Refutada para a TechSpec |
| P2 | Gates determinísticos pegam a maioria dos erros | Pegaram todas as falhas de citação e de formato medidas. Erros de conteúdo ficaram com a avaliação. | Inconclusiva |
| P3 | Testes de aceite gerados estão corretos | Não medido: as tarefas não geram testes nesta rodada. | Não testada |
| P4 | Tarefas são separáveis por arquivo | Gate de tarefas: 6 de 6 aprovados. Rodapé de arquivos (T2): Haiku 2 a 4, Sonnet 4 a 5. | Inconclusiva |
| P5 | Resultados transferem para outras features | Uma única feature nesta rodada. | Não testada |
| P6 | Histórico de artefatos aprovados existe | Não usado nesta rodada (sem RAG nem receitas aprendidas). | Não testada |
| P7 | Economia por token do Haiku cobre as chamadas extras | Em dólar: Haiku custa 6.3% do Sonnet, apesar de gastar 25% a mais em tokens. | Confirmada (em dólar) |
| P8 | A rodada é representativa (3 execuções) | Três execuções por braço; dispersão reportada em todos os critérios. | Aplicada, com dispersão |
| P9 | A memória pode ser mantida limpa | Não usada nesta rodada. | Não testada |
| H4 | Receitas por tipo de artefato reduzem erro | Template do repositório usado como receita. Sem braço separado sem receita. | Inconclusiva |
| H6 | Localizar antes de ler corta tokens e erros | Varredura determinística e 29 a 38 fatos verificados por execução. Efeito sobre tokens não isolado. | Não isolada |
| H10 | Amostrar mais só quando o gate reprova, sem perder acerto | Escalonamento em 2 de 3 PRDs e 3 de 3 TechSpecs. Acerto da TechSpec ficou 13.3 pontos abaixo. | Refutada (acerto) |
| H12 | Checagens determinísticas substituem revisão por IA | Não há braço de revisão por IA para comparar. | Não testada |

## 9. Custo do estudo

A avaliação com Opus consumiu 2.27 milhão de tokens em 9 subagentes (três avaliadores para cada um dos três tipos de artefato). Em dólar, isso fica entre USD 9.10 e USD 45.49, mais caro que o pipeline Haiku inteiro.

## 10. Limitações

- **Uma feature.** A transferência para outras features não foi medida.

- **Três execuções por braço.** A dispersão é grande em alguns critérios, e isso pesa na leitura do PRD.

- **Gabarito escrito pelo autor** a partir da análise anterior, o que pode favorecer quem investigou os mesmos pontos.

- **Custo estimado.** O harness informa tokens totais, sem divisão entre entrada e saída nem cache. O custo é uma faixa, e a razão entre braços não depende da divisão.

- **Um agente do braço Sonnet declarou ter visto, numa busca ampla, trechos de documentos antigos do repositório.** Disse não ter usado nem citado esse conteúdo. A declaração é registrada, mas não há como verificar a fonte de cada frase.

- **Avaliadores verificaram citações contra o repositório que estava na branch local,** que pode diferir da branch de referência. Citações que não batem por isso contam como alucinação de caminho.

## 11. Conclusão e próximos passos

**Não recomendo o pipeline Haiku enxuto para gerar a TechSpec nem as tarefas.** Ele é barato, mas perde qualidade além da margem definida. Para o PRD, o resultado não permite decidir: a média está dentro da margem, mas o gabarito ficou abaixo, e a dispersão é maior que a diferença.

- **Recomendação prática:** manter o Sonnet padrão para TechSpec e tarefas. Testar o Haiku apenas para o PRD e para evidências, com o gate já existente.

- **Teste seguinte, se o interesse continuar:** híbrido (Haiku para PRD e evidências, Sonnet para o resto), com pelo menos cinco execuções por braço e uma segunda feature. A conta indica uma economia de cerca de 30% em dólar nesse desenho, mas isso ainda é estimativa.

## 12. Arquivos dos dados

Arquivos de consenso, log de uso por execução e gates, todos na pasta da rodada: `avaliacao/resultados/consenso.json`, `metadados/uso.jsonl` e `runs/*/gate-*-final.json`. Desenho pré-registrado em `DESENHO.md`.
