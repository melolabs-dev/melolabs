---
id: registro-suposicoes-haiku-sonnet-sdd
title: "Registro de suposições: Haiku vs Sonnet no SDD"
source_url: https://claude.ai/artifact/T9o4SWtv27aDjSCiKj1EDF
kind: hypothesis-register
evidence: hipoteses-nao-testadas
validated_by_author: false
publishable: false
fidelity: transcricao-fiel
date: 2026-11-04
tags: [sdd, haiku, hipoteses, premissas]
---

# Registro de suposições: Haiku vs Sonnet no SDD

Reúne tudo o que o estudo "SDD com Haiku" (ver nota `sdd-com-haiku-assertividade`) supõe: 9 premissas de base, que precisam ser verdadeiras para o plano fazer sentido, e 16 hipóteses testáveis. Nenhuma estava confirmada no sistema do autor; as evidências vêm de papers com benchmarks diferentes.

## Premissas de base

Se alguma for falsa, várias hipóteses perdem o sentido. Verificar antes de investir nas hipóteses.

| ID | Premissa | Por que importa | Como verificar | Se for falsa |
| --- | --- | --- | --- | --- |
| P1 | O Haiku já acerta uma fração não trivial das tasks sozinho | Snell et al. só viram o modelo pequeno superar o grande onde ele já tinha acerto razoável | Taxa de aceite do Haiku puro por tipo de task na rodada passada | Nesses tipos, escalar para o Sonnet; investir no Haiku só onde P1 vale |
| P2 | Os gates determinísticos (tsc, lint, testes) pegam a maioria dos erros reais | Parada antecipada e memória só funcionam se o gate for confiável | Contar defeitos que passaram pelos gates e apareceram depois | Fortalecer testes antes de qualquer otimização de tokens |
| P3 | Testes de aceite gerados da spec estão corretos | Testes errados validam bugs (tese de Mathews) | Revisão humana de uma amostra de testes por feature | Manter revisão humana dos testes ou gerá-los com o Sonnet |
| P4 | As tasks são de fato separáveis por arquivo | Base do paralelismo e da localização | Taxa de conflitos no gate de integração | Agrupar tasks acopladas num mesmo agente |
| P5 | Resultados de benchmarks transferem para um projeto TypeScript com ~50 tasks | Os papers usam funções isoladas, navegação web ou issues do GitHub | Só se confirma com os experimentos próprios | Tratar cada número dos papers como direção, não magnitude |
| P6 | Há histórico suficiente de artefatos aprovados para RAG e receitas | Memória vazia não ajuda (cold start) | Contar PRDs, TechSpecs e tasks aprovados por tipo | Começar por gates e cache; ligar memória quando o histórico existir |
| P7 | A economia por token do Haiku cobre as chamadas extras do pipeline | Votação, verificação e localização multiplicam chamadas | Custo total por feature aceita, Haiku pipeline vs Sonnet puro | Reduzir votação ou usar o Sonnet direto nas etapas onde ele é mais barato no total |
| P8 | A rodada em que o Sonnet venceu é representativa | Variância entre execuções é grande | Número de execuções e dispersão das métricas na rodada | Repetir com 3+ execuções antes de concluir |
| P9 | A memória pode ser mantida limpa e atual | Lição errada ou receita antiga piora o modelo | Taxa de lições contrariadas por gates posteriores | Expirar lições automaticamente; revisar receitas a cada mudança de arquitetura |

## Registro de hipóteses

Cada hipótese tem uma previsão mensurável e um critério de refutação definido antes do teste, para o resultado não ser reinterpretado depois. O grupo H0 explica a derrota; H1–H12 são as apostas para virar o jogo. Status de todas na data do registro: **Não testada** (atualizar conforme experimentos; ver nota `haiku-enxuto-vs-sonnet` para o que a rodada 3 já mediu sobre H10, H12, P1, P7).

| ID | Suposição | Base | Previsão mensurável | Refutada se | Status |
| --- | --- | --- | --- | --- | --- |
| H0.1 | O Haiku perdeu por falta de conhecimento do projeto | Diagnóstico; RepoCoder (arxiv 2303.12570) | A maioria das falhas do Haiku envolve APIs, contratos ou convenções do repo | Falhas concentradas em lógica pura, sem relação com o repo | Não testada |
| H0.2 | O Haiku edita o lugar errado | Agentless (arxiv 2407.01489) | Parte relevante das falhas toca arquivo/função fora do escopo certo | Edições quase sempre no lugar certo | Não testada |
| H0.3 | O Haiku precisa de mais voltas no loop de correção | ExpeL (arxiv 2308.10144) | Iterações até verde maiores que as do Sonnet | Iterações parecidas entre os dois | Não testada |
| H0.4 | As falhas se concentram nas tasks maiores | Self-planning (arxiv 2303.06689); decomposição | Taxa de falha cresce com o tamanho da task | Taxa de falha sem relação com tamanho | Não testada |
| H1 | RAG iterativo do repo reduz erros de API/contrato | RepoCoder | Menos reprovações por `tsc` e contrato em tasks que tocam código existente | Reprovações iguais ou maiores com RAG | Não testada |
| H2 | Exemplos aprovados mais parecidos superam template fixo | KATE (arxiv 2101.06804) | Aceite na primeira passada sobe vs. template fixo | Sem diferença em 3+ execuções | Não testada |
| H3 | Lições extraídas de reprovações reduzem iterações | ExpeL, ERL | Iterações até verde caem nas tasks com lição recuperada | Iterações iguais, ou lições contrariadas com frequência | Não testada |
| H4 | Receitas por tipo de task reduzem erro e tokens | Agent Workflow Memory (arxiv 2409.07429) | Aceite sobe e tokens de plano caem nos tipos com receita | Aceite igual ou pior com receita | Não testada |
| H5 | Saídas do Sonnet como exemplos transferem parte da vantagem | Extrapolação de Distilling step-by-step (arxiv 2305.02301; lá é fine-tuning) | Haiku com exemplos do Sonnet fecha parte da diferença de aceite | Diferença igual com e sem esses exemplos | Não testada |
| H6 | Localizar antes de ler corta tokens e erros de edição | Agentless | Tokens de input por task caem; erros de lugar caem | Localização erra e piora o aceite | Não testada |
| H7 | Comprimir prosa mantém o aceite e reduz input | LLMLingua | Input cai sem queda de aceite | Aceite cai além da margem aceitável | Não testada |
| H8 | Prefixo estático com cache reduz custo por feature | Prompt caching da API Anthropic | Custo de input por feature cai nas ~50 tasks | Prefixo muda tanto que o cache quase não é aproveitado | Não testada |
| H9 | Com receita, o plano encolhe e o código fica mais curto | Agent Workflow Memory | Tokens de saída por task caem | Tokens iguais ou maiores | Não testada |
| H10 | Amostrar mais só quando o gate reprova economiza sem perder acerto | Snell et al. (arxiv 2408.03314) | Tokens de votação caem; aceite se mantém | Aceite cai vs. votação sempre ligada | Não testada (rodada 3 do experimento: refutada quanto ao acerto da TechSpec) |
| H11 | Saída em diff reduz tokens de saída | Agentless | Tokens de saída caem; diffs aplicam limpo | Muitos diffs falham no `git apply --check` | Não testada |
| H12 | Checagens determinísticas substituem parte da revisão por IA sem perder detecção | Panda, 2026 | Custo do gate cai; defeitos detectados se mantêm | Defeitos escapam que a revisão de IA pegava | Não testada |

## Como testar e registrar

1. Confirmar as premissas P1, P2 e P8 primeiro; elas decidem se vale testar o resto.
2. Antes de rodar, definir a margem que conta como "igual" (por exemplo, diferença de aceite que se aceita ignorar) e anotar na hipótese.
3. Rodar baseline e variante sobre as mesmas features, pelo menos 3 vezes cada, com a mesma versão de prompts e gates.
4. Registrar por execução: versão do pipeline, features, modelo, tokens de input e saída, custo, aceite na primeira passada, iterações até verde e reprovações por gate.
5. Atualizar o Status: **Confirmada** só quando a previsão se cumpre em todas as execuções; **Inconclusiva** quando a dispersão é maior que a diferença.
6. Hipótese refutada não é descartada em silêncio: anotar o motivo provável, porque ele costuma apontar para uma premissa falsa.

Modelo de linha para o log de execuções:

```csv
data,hipotese,variante,modelo,features,execucao,tokens_in,tokens_out,custo_usd,aceite_1a_passada,iteracoes_ate_verde,reprovacoes_gate
2026-11-05,H2,baseline,haiku,feat-auth,1,,,,,,
2026-11-05,H2,exemplos-dinamicos,haiku,feat-auth,1,,,,,,
```
