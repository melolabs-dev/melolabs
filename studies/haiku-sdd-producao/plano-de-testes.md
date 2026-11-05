# Plano de testes

> **Rascunho de 05/11/2026, aguardando a aprovação do autor e o piloto (F3.2).** Os números de repetição abaixo são o ponto de partida; o piloto os confirma ou muda antes do pré-registro.

## Variáveis
- **Independentes (o que muda):** o modelo (Haiku 5.5, Sonnet 5.5), a condição de prompt e de pipeline (tabela abaixo) e a variante de tarefa (#1267, #1384-A/B/C, #1050-a/b).
- **Dependentes (o que se mede):**
  - Qualidade: soma da rubrica (PRD, TechSpec C1 a C7, Tasks T1 a T5) por 3 juízes cegos; taxa de testes ocultos passando com `tsc` limpo.
  - Custo: tokens totais por agente e custo estimado em dólar por artefato aceito.
  - Tempo: duração por agente e por execução completa.
  - Processo: número de chamadas de ferramenta, rodadas de correção, escalonamentos.
- **Controladas (o que se mantém fixo):** commit do h3, CLAUDE.md e AGENTS.md do h3 nas duas condições, enunciado da feature (contrato público, sem valores de teste), rubrica, juízes, tabela de preços, ferramentas liberadas ao agente.

## Condições e baseline
| ID | Condição | Hipótese |
|---|---|---|
| C0 | Sonnet padrão: um agente por artefato, prompt neutro (baseline) | todas |
| C1 | Haiku simples: um agente por artefato, prompt neutro | H1 |
| C2 | Haiku com gates determinísticos e loop de correção por erro real | H3 |
| C2n | Haiku com autorrevisão sem feedback externo (controle negativo) | H3 |
| C3 | Haiku com voto por letra em decisões fechadas da TechSpec | H2 |
| C4 | Haiku com mitigações completas: C2, C3, citação de IDs e código com testes de aceite escritos antes e loop com a saída real do runner | H4, H5, H6 |
| C5 | Cascata: C4 que escala para o Sonnet quando o gate reprova duas vezes | H5 |
| C6 | Híbrido: Haiku em PRD e Tasks, Sonnet só na TechSpec | H10 |
| C7 | Citação de IDs com 20 erros plantados em Tasks, verificação por regra | H7 |
| C8 | Prefixo estático com cache contra sem cache | H8 |
| C9 | TechSpec em texto livre e conversão para JSON, contra JSON direto | H9 |
| C10 a C13 | Haiku com persona, só contexto detalhado, os dois, e controle de mesmo tamanho sem informação útil | H11 |
| S8 a S11 | Braços do autor: repo map, N candidatos em worktrees, limite de 40 chamadas, checagem de rodapé (exploratórios) | H4, H6 |

Controles negativos: C2n (H3) e C13 (H11).

## Concorrência e uso de recursos (decisão do autor em 05/11/2026)
- **Uma execução por vez.** Termina uma condição numa variante, passa à próxima; termina uma variante, passa à seguinte. Não há execuções de estudo em paralelo.
- **Paralelismo só dentro da condição**, e só onde a própria condição o define: as 3 amostras do voto (C3), os N candidatos em worktrees do S9, e os 3 juízes (que rodam um a um se a memória apertar).
- **Poupar a máquina é um objetivo do estudo:** a memória (15,6 GB) não pode virar causa de falha de execução. Uma só instalação de dependências compartilhada pelo `pnpm`, worktrees removidas após cada execução, e registro da memória livre antes de cada execução.
- Como o tempo até 13/11 é folgado, a prioridade é a execução completa e limpa, não a velocidade.
- **Efeito no prazo:** em fila, 300 a 350 execuções de 5 a 10 minutos somam entre 25 e 60 horas de relógio, mais os juízes. Cabe em 8 dias só se a coleta rodar em sessões longas por dia; o piloto mede a duração real e o plano é refeito com ela. Se não couber, a ordem de corte é a já combinada (S11, S8, S9) e depois repetições adicionais, nunca as hipóteses confirmatórias H4, H5 e H6.

## Aleatorização, sementes e aquecimento
- A ordem das execuções é sorteada com semente fixa `20261105` e registrada em `dados/bruto/ordem.json`, intercalando modelos e condições para que a hora do dia e a carga do serviço não coincidam com uma condição.
- Uma execução de aquecimento por variante (Haiku simples) valida o harness (worktree, medição, coleta) e é descartada, sem entrar nos dados.
- O piloto (F3.2) é separado e seus dados não entram na análise final.

## Repetições e regra de parada
- **Ponto de partida:** 3 repetições por condição e variante (mesmo n dos estudos anteriores do autor).
- **Piloto:** C0, C1 e C4 em duas variantes (#1267 e #1050-b), 2 repetições cada, para estimar variância da rubrica e dos testes ocultos, duração por execução e a taxa de falha de infraestrutura.
- **Regra de parada:** se após as 3 repetições o IC95% de uma hipótese confirmatória (H4, H5, H6) ainda cruza a margem de equivalência, estende-se até 5 repetições nas condições dessa hipótese; se continuar indecisa, o status é `subpotente` e isso é reportado, sem mais amostra.

## Avaliação cega (quando há avaliador)
- Cada artefato recebe um código aleatório; o nome do modelo, da condição e da variante é removido do texto antes dos juízes (cabeçalhos, estilo de assinatura e menção a modelo são limpos e a limpeza é registrada).
- Três juízes Opus, cada um em agente novo e sem contexto da conversa, avaliam em ordem embaralhada por juiz. Os juízes não veem os testes ocultos.
- Concordância medida com alfa de Krippendorff, com o corte de 0,67 do plano de análise.
- Os testes ocultos nunca entram no diretório da execução. Para detectar vazamento, a transcrição de cada agente é varrida por caminhos e nomes do gabarito, e a ocorrência vira exclusão registrada.

## Custo e tempo
- Por agente: tokens totais, chamadas de ferramenta e duração, copiados da notificação do harness para `dados/bruto/execucoes.jsonl`.
- **Limite declarado:** como a divisão entre entrada, saída e cache não é informada, o custo em dólar usa a proporção de 80% e 20% e a tabela datada. Isso mede bem a razão entre condições de mesmo modelo e mal a razão entre modelos de preços diferentes. A H8 (cache) depende de preço de cache hit e **não é mensurável** por este caminho; fica `subpotente` a menos que o autor libere uma chave de API para um subconjunto.
- Tempo: relógio por execução em segundos, mais a duração acumulada por condição.
- Sem teto de gasto. Os limites de uso da assinatura são registrados quando ocorrerem, com a hora e a condição afetada.
