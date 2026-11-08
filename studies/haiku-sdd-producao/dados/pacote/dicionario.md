# Dicionário de dados e esquema de coleta

> Rascunho de 05/11/2026. Os arquivos ficam em `dados/bruto/` (um registro por fato) e `dados/processado/` (tabelas derivadas por script). Nada em `bruto/` é editado à mão depois de gravado; correções entram como nova linha com `corrige`.

## `dados/bruto/execucoes.jsonl` (uma linha por chamada de agente)
| Coluna | Tipo | Unidade | Descrição | Valores válidos |
| --- | --- | --- | --- | --- |
| id | texto | | Identificador da execução (`<condicao>-<variante>-r<rep>`) | único por execução |
| etapa | texto | | Etapa do pipeline a que a chamada pertence | prd, techspec, tasks, testes, codigo, correcao, voto, juiz, escalonamento |
| variante | texto | | Variante de tarefa | range-1267, problem-1384-a/b/c, session-1050-a/b |
| condicao | texto | | Condição do plano de testes | C0 a C13, S8 a S11 |
| modelo | texto | | Apelido usado na chamada | haiku, sonnet, opus |
| modelo_efetivo | texto | | Identificador que o agente informou ou a ferramenta mostrou | texto livre, "não informado" |
| repeticao | inteiro | | Número da repetição | 1 a 6 |
| tokens_totais | inteiro | tokens | Total informado pelo harness para a chamada | maior ou igual a 0 |
| chamadas_ferramenta | inteiro | chamadas | Número de usos de ferramenta | maior ou igual a 0 |
| duracao_s | decimal | segundos | Duração da chamada informada pelo harness | maior que 0 |
| inicio, fim | texto | ISO 8601 | Hora local | datas |
| mem_livre_gb | decimal | GB | Memória livre antes da execução | maior que 0 |
| falha_infra | booleano | | Falha de infraestrutura (API, tempo esgotado) | true, false |
| rodadas_correcao | inteiro | rodadas | Voltas do loop de correção | 0 a 3 |
| escalonou | booleano | | A cascata trocou Haiku por Sonnet | true, false |
| gate_ok | booleano | | Gate determinístico da etapa passou | true, false, nulo |
| obs | texto | | Observação livre | |

## `dados/bruto/<id>/score.json` (uma por execução de código)
| Coluna | Tipo | Unidade | Descrição | Valores válidos |
| --- | --- | --- | --- | --- |
| testes | mapa | | Estado de cada teste oculto (`arquivo::nome`) | passed, failed, skipped |
| passaram, falharam, total | inteiro | testes | Contagens | maior ou igual a 0 |
| typecheck_ok | booleano | | `pnpm typecheck` limpo | true, false |
| suite_completa | texto | | Resumo da suíte completa com os testes ocultos copiados | texto |

## `dados/bruto/<id>/observacoes.jsonl`
Observações dos testes de "observação" (P10 e as extras): o que a implementação fez, sem aprovar nem reprovar.

## `dados/bruto/<id>/` (demais arquivos)
`codigo.diff` (alterações ao h3 sem a pasta `sdd/`), `sdd/` (PRD, TechSpec, Tasks e testes escritos pelo agente), `auditoria.json` (varredura de vazamento: limpo ou ocorrências).

## `dados/bruto/juizes.jsonl` (uma linha por juiz, artefato e critério)
| Coluna | Tipo | Unidade | Descrição | Valores válidos |
| --- | --- | --- | --- | --- |
| codigo_artefato | texto | | Código aleatório do artefato cego | único |
| juiz | inteiro | | Juiz 1, 2 ou 3 | 1 a 3 |
| tipo | texto | | Tipo de artefato | prd, techspec, tasks |
| criterio | texto | | Critério da rubrica | C1 a C7, T1 a T5 |
| nota | inteiro | pontos | Nota do critério | 0 a 5 |
| alucinacoes | inteiro | itens | Citações inventadas encontradas | maior ou igual a 0 |

O mapa código para condição fica em `dados/bruto/mapa-cego.json`, fora da pasta que os juízes enxergam.

## `dados/processado/`
Tabelas derivadas por script em `analise/` a partir de `bruto/`: notas por artefato (mediana dos 3 juízes), custo em tokens por artefato aceito, estimativa em dólar nas três proporções (60/40, 80/20, 95/5) com a tabela de 04/11/2026, e taxa de testes ocultos.

## Regras
- Datas em ISO 8601, texto em UTF-8, números com ponto decimal.
- Falta de dado é `null`, nunca zero.
- Cada arquivo derivado registra o commit do script e a hora em que foi gerado.

## Campos reais da coleta com o orquestrador (adendo 1, 06/11/2026)
`execucoes.jsonl` passa a ter uma linha por tentativa de etapa, com: `id`, `etapa`, `tentativa`, `modelo`, `modelo_efetivo`, `inicio`, `duracao_s`, `duracao_api_ms`, `mem_livre_gb`, `chamadas_ferramenta`, `turnos`, `tokens_entrada`, `tokens_saida`, `tokens_cache_criado`, `tokens_cache_lido`, `tokens_totais`, `tokens_novos`, `maior_prompt`, `custo_usd_lista`, `negacoes`, `prompt_sha256`, `transcricao`, `acessos_suspeitos`, `falha_infra`, `returncode`, `resposta_final`. `score.json` ganha `arquivos`, `lint_ok`, `nucleo_passaram`, `nucleo_total`, `nucleo_esperado` e `nucleo_100`. `concluida.json` marca a execução como completa e guarda as decisões de gate e escalonamento.
