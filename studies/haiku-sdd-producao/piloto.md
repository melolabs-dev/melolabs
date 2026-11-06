# Piloto (F3.2): resultados e dimensionamento da amostra

> Feito em 05/11/2026. **Os dados do piloto não entram na análise final.** Dados brutos em `dados/bruto/piloto-*` e `execucoes.jsonl`; resumo em `dados/processado/piloto.json`.

## O que foi rodado
- 12 execuções completas (PRD, TechSpec, Tasks e código) mais 1 de aquecimento descartada: Sonnet padrão (C0), Haiku simples (C1) e Haiku com mitigações (C4), em duas features (#1267 e #1050-b), 2 repetições cada. Todas em fila, uma por vez.
- 48 chamadas de agente nas execuções válidas, 4,78 milhões de tokens no piloto, cerca de 80 minutos de execução.
- Auditoria de vazamento: limpa nas 12 execuções.

## Resultados por célula (média de 2 repetições)
| Feature | Condição | Aprovados | Extras | Tokens | Tempo | CV tokens | CV tempo |
|---|---|---|---|---|---|---|---|
| #1267 | Sonnet padrão | 58/58 | 20/24 | 342.348 | 275 s | 1,3% | 7,5% |
| #1267 | Haiku simples | 58/58 | 18/24 | 416.020 | 420 s | 1,7% | 2,9% |
| #1267 | Haiku com mitigações | 58/58 | 16/24 | 413.656 | 422 s | 4,3% | 12,7% |
| #1050-b | Sonnet padrão | 40/40 | 12/12 | 356.254 | 330 s | 3,6% | 3,3% |
| #1050-b | Haiku simples | 40/40 | 12/12 | 429.680 | 522 s | 1,9% | 1,7% |
| #1050-b | Haiku com mitigações | 40/40 | 12/12 | 433.385 | 426 s | 0,9% | 8,2% |

## O que o piloto ensina
1. **Variância pequena em tokens e tempo.** CV médio de 2,3% em tokens e 6,1% em tempo entre repetições. Para detectar uma diferença de 20% em tokens basta 2 a 3 repetições por condição (poder de 80%, 5%).
2. **Razão Haiku sobre Sonnet em tokens:** 1,21 a 1,22 nas duas features e nas duas variantes do Haiku. O Haiku gasta cerca de 21% mais tokens que o Sonnet e de 29% a 58% mais tempo.
3. **Os testes aprovados saturam.** 100% (198 de 198 testes) em todas as 12 execuções, nas três condições. Com a qualidade igual, a H4 e a parte de qualidade da H5 não separam os modelos.
4. **A equivalência da H4 não é demonstrável com a amostra planejada, mesmo que tudo passe.** O limite inferior de Wilson (95%) para n sucessos de n execuções é 0,61 com n=6, 0,82 com n=18 e 0,90 só com n=35. Para concluir que o Haiku fica a menos de 10 pontos do Sonnet (margem da H4) é preciso cerca de 35 execuções perfeitas por condição, e não as 18 do plano (6 variantes × 3 repetições).
5. **Os extras são ruído de ambiguidade.** Falham em qualquer condição, e em testes diferentes (E2, E3, E4), todos sobre pontos que o contrato não define. Ficam exploratórios.
6. **O processo de correção quase não aparece.** O loop com gate e testes primeiro rodou 0 a 2 rodadas e não mudou o resultado em testes; mudou o jeito de trabalhar (testes escritos antes, com muitos casos).
7. **Mitigações não reduziram o custo em tokens.** O C4 gastou o mesmo que o Haiku simples; o tempo foi igual ou até 18% menor na #1050-b.

## Problemas de método achados e resolvidos
- Gate com falso positivo em citações só com nome de arquivo: corrigido.
- Nota do contrato citava "testes ocultos" para os modelos: removida do enunciado (o piloto já viu a nota).
- Referência do #1267 com bug (Range aberto com início ≥ tamanho): achado pelo extra E5 e corrigido.
- O teste `cli.test.ts` do h3 abre abas reais do navegador no Windows: removido das pastas de execução.
- Agentes Haiku tentaram por engano chamar uma ferramenta de handoff de sessão (negado, sem efeito).

## Dimensionamento proposto
| Hipótese | Repetições propostas | Motivo |
|---|---|---|
| H6 (custo em tokens), H1, H3, H5 (qualidade da rubrica), H10, H11 | 3 por condição e variante | Variância baixa em tokens e tempo |
| H4 (testes ocultos) | 6 por variante e condição, em C0 e C4 (36 por condição) | Só assim o limite inferior de Wilson chega a 0,90 se tudo passar |
| Extras | exploratórios | Medem ambiguidade do contrato |

Regra de parada (mantida do plano): se o IC95% de H4, H5 ou H6 ainda cruzar a margem após as repetições planejadas, estende-se até 5 repetições nessas condições; se continuar indecisa, o status é `subpotente`.

## Decisões abertas para o autor
1. Como lidar com a saturação dos testes aprovados (opções na conversa).
2. Aceitar 6 repetições por variante para H4 (cerca de 72 execuções extras de código nas duas condições).
