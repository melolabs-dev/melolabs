# Soluções e testes do autor, rodando em paralelo

> **Decidido pelo autor em 05/11/2026: os 4 braços novos (S8, S9, S10, S11) entram.** **Dados de trabalho podem aparecer no artigo, sem nenhum dado da empresa do autor** (decidido em 05/11/2026). Pedido em 05/11/2026: usar os seus estudos e testes anteriores como soluções candidatas e como testes em paralelo neste estudo. Tudo vem de notas que já estão na base de conhecimento.

## Como entram no estudo
- Cada solução abaixo vira um **braço** (condição) que roda nas mesmas 3 features do h3, com o mesmo avaliador cego e a mesma tabela de preços datada.
- Os braços do autor entram **em paralelo** com os braços das hipóteses H1 a H11, sem substituí-los. O que já existe no estudo fica como está.
- Resultados anteriores seus (rodadas 1 a 3, balanço do ciclo) entram como **evidência de base e de planejamento**. Eles não contam como dados deste estudo, porque outro projeto, outros insumos e outras versões de modelo foram usados.

## Soluções do autor e a hipótese que cada uma alimenta

| # | Solução do autor | Origem na base | Hipótese ligada | Braço novo? |
| --- | --- | --- | --- | --- |
| S1 | Voto por letra em opções fechadas, no lugar de texto livre | haiku-contra-sonnet-sdd (23 de 23 com letras contra 8 de 23 com texto livre) | H2 | Não, já é a H2 |
| S2 | Gate determinístico com falso positivo corrigido: só cabeçalho de requisito conta como definição | haiku-contra-sonnet-sdd (próximas rodadas) | H3 | Detalhe do gate da H3 |
| S3 | IDs rastreáveis em tudo e checagem por diferença de conjuntos | sdd-com-haiku-assertividade (melhoria 2) | H7 | Não, já é a H7 |
| S4 | Autocorreção só com erro real, nunca com autorrevisão | sdd-com-haiku-assertividade (melhoria 4) | H3 | Controle negativo da H3 |
| S5 | Cascata Haiku para modelo maior quando o gate reprova duas vezes | sdd-com-haiku-assertividade (melhoria 7) | H5 | Não, já é a H5 |
| S6 | Prefixo estável com cache | turbinando-claude-haiku (passo 2) | H8 | Não, já é a H8 |
| S7 | Raciocinar livre e formatar depois | sdd-com-haiku-assertividade (melhoria 9) | H9 | Não, já é a H9 |
| S8 | Repo map do TypeScript e localização hierárquica antes de editar | turbinando-claude-haiku (passos 3 e 4) | H4 | **Sim**: braço "Haiku com repo map" na geração de código |
| S9 | N candidatos em worktrees isoladas, verificador em camadas (`tsc`, ESLint, testes), vence quem passa mais testes | turbinando-claude-haiku (passo 7) | H4 | **Sim**: braço "Haiku com N candidatos" na geração de código |
| S10 | Limite de chamadas por worker (no máximo 40) e proibir repetir teste verde sem mudança | balanco-ciclo-prototipo-final (SV-05 e SV-07; nota confidencial) | H6 | **Sim**: regra de orçamento no braço de custo |
| S11 | Checagem de rodapé: listar de antemão os arquivos de teste que o texto trocado afeta | estudo-paralelismo-sdd (otimizações 1 e 2; nota confidencial) | H4 | **Sim**, mas só se a feature tocar mensagens de erro |
| S12 | Reflexão com limite de 2 a 3 rodadas | turbinando-claude-haiku (passo 8) | H3 | Detalhe do loop da H3 |

## Testes anteriores seus reaproveitados
- **Rubrica de TechSpec e Tasks** (C1 a C7 e T1 a T5), com avaliação cega e embaralhada: reaproveitada como está nas H1, H3, H5 e H10.
- **Gabarito escrito antes**, sem vazar a resposta no enunciado: regra adotada na H2, porque as rodadas anteriores saturaram em 6 de 6.
- **Medição pelo harness** (tokens, tempo e chamadas por agente, e não o que o agente diz de si): obrigatória em todos os braços.
- **Três repetições por braço**, com média e dispersão: mantida.
- **Entrada e saída de tokens separadas**, com preço da data: mantida para H6, H8 e H10.

## O que muda no custo do estudo
Os braços novos (S8, S9, S10 e S11) somam condições por feature. Com 3 features, 3 repetições e os braços das 11 hipóteses (a H11 soma 3 variantes de prompt: persona, contexto e os dois, mais um controle de mesmo tamanho), o número de execuções cresce. **Não há teto de gasto** (decisão do autor em 05/11/2026). O gasto é medido e reportado, e o fator limitante passa a ser o tempo até o congelamento de dados (13/11). A estimativa de custo e de duração fica para o plano de testes, F4. Se o tempo não bastar, a ordem de corte proposta continua: S11, depois S8, e por último S9.

## O que o autor precisa decidir
1. ~~Os 4 braços novos entram?~~ Decidido: entram.
2. ~~Os dados de trabalho podem aparecer no artigo?~~ Decidido: podem, anonimizados. Ver `declaracoes.md`.
