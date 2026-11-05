---
id: turbinando-claude-haiku
title: "Turbinando o Claude Haiku: pesquisa e soluções para modelos menores mais performáticos"
source_url: https://claude.ai/artifact/4MoTDcGvAvtTwjdfwZpx2c
kind: literature-review
evidence: revisao-de-literatura
validated_by_author: false
publishable: false
fidelity: resumo-curado
date: 2026-11-04
tags: [haiku, test-time-compute, contexto, rag, multiagente, papers]
---

# Turbinando o Claude Haiku: pesquisa e soluções para modelos menores

> Resumo curado do documento original (fonte de verdade: `source_url`). Os números vêm de benchmarks e modelos diferentes; servem para mostrar direção e ordem de grandeza, não para comparar entre si. Preços e especificações do Haiku 5.5 devem ser conferidos na documentação oficial da data de uso. Nada aqui foi validado pelo autor ainda.

## Resumo

O Haiku rende mais quando é tratado como mão de obra paralela barata atrás de um verificador forte, com contexto curto e preciso. A literatura mostra que isso aproxima modelos menores dos maiores em tarefas de escopo bem definido, mas não nas mais difíceis.

- **Gere várias, verifique com testes.** Amostragem repetida + seleção por testes é a alavanca com mais evidência (CodeMonkeys, Large Language Monkeys).
- **Menos contexto, mais precisão.** Repo map por AST, localização hierárquica e RAG com Contextual Retrieval superam encher a janela de 1M tokens.
- **Paralelize só o que é independente.** Um Haiku por task, cada um com janela limpa e prefixo em cache (leitura ~90% mais barata).
- **Quebre o que estiver acima do alcance.** Quando mais tentativas e mais esforço não resolvem, decompor a task em vez de insistir.

Segundo o documento original, o Haiku 5.5 custa US$ 0,10 (entrada) e US$ 0,50 (saída) por milhão de tokens, e 5 a 10 tentativas por task ainda custam menos que uma tentativa no Sonnet 5.5 (conferir preço atual).

## Por que um modelo menor pode render mais

Gastar mais computação na inferência (várias tentativas + um verificador) pode substituir boa parte do tamanho do modelo.

- **Amostragem repetida (Large Language Monkeys, Stanford/Oxford/DeepMind, 2024).** No SWE-bench Lite, um modelo mais fraco foi de 15,9% de issues resolvidas com 1 tentativa para 56% com 250, superando o estado da arte de tentativa única da época (43%).
- **O gargalo é escolher a resposta certa.** Votação por maioria e reward models estagnam depois de algumas centenas de amostras; o ganho só escala onde existe verificador automático — em código, isso significa testes.
- **Computação adaptativa por dificuldade (Snell et al., ICLR 2025).** Distribuir o orçamento de inferência conforme a dificuldade foi mais de 4x mais eficiente que best-of-N fixo; com FLOPs equivalentes, o modelo menor superou um modelo 14x maior nos problemas em que já tinha alguma taxa de acerto.
- **O limite.** Nos problemas mais difíceis o modelo maior ainda vence: test-time compute não cria capacidade que o modelo não tem. Primeiro passo: quebrar a tarefa até ela ficar no alcance do Haiku.

**Haiku 5.5 (segundo o documento, lançado em 7/out/2026).** Janela de 1M tokens, ~10x mais barato que o Haiku 4.5, primeiro Haiku com ajuste de esforço (low → max). A própria Anthropic o indica para tarefas de escopo estreito (subagentes, compactação, sumarização); Sonnet/Opus seguem melhores em agentic coding complexo: Terminal-Bench 4.0 dá 39,2% no Haiku 5.5 contra 70,6% no Sonnet 5.5.

## Contexto e conhecimento do código

Para um modelo pequeno, contexto curto e certeiro vale mais que janela grande.

- **Context Rot (Chroma, jul/2025).** 18 LLMs testados; todos ficaram menos confiáveis à medida que a entrada cresceu, mesmo em tarefas triviais; trechos parecidos com a resposta mas errados (distratores) pioram ainda mais.
- **Técnicas, da mais barata à mais sofisticada:**
  1. Arquivo de contexto do projeto (CLAUDE.md / AGENTS.md): convenções, comandos de teste, mapa de pastas, decisões de arquitetura. Sempre em cache.
  2. Repo map por AST (Aider): Tree-sitter extrai assinaturas, classes e interfaces; grafo arquivo→referência ranqueado por algoritmo derivado do PageRank; mapa padrão em ~1k tokens.
  3. Localização hierárquica (Agentless): arquivo → classe/função → linhas a editar, combinando LLM com recuperação clássica. Chegou a 27,33% no SWE-bench Lite a US$ 0,34 por issue na época.
  4. RAG de código com Contextual Retrieval: antes de indexar, o LLM escreve um parágrafo sobre onde cada trecho se encaixa; reduziu falhas de recuperação em 35%; com BM25, 49%; com reranking, 67% (de 5,7% para 1,9%).
  5. Ferramentas semânticas via MCP: LSP (definição, referências, tipos) e busca (ripgrep, BM25) no lugar de ler arquivos inteiros.
- **Regra de bolso:** cada subagente Haiku recebe o arquivo de contexto do projeto + o trecho do repo map relevante + 3–5 trechos recuperados + a task. Nada de histórico de conversa de outras tasks.

## Técnicas de inferência: gerar várias, verificar, refinar

- **Pares (edit, teste) em paralelo — CodeMonkeys (Stanford, 2025).** 10 trajetórias paralelas, cada uma gerando edição + script de teste e iterando até 8 vezes. Cobertura de 69,8% no SWE-bench Verified; com votação por testes gerados + etapa final de seleção pelo modelo, 57,4%, fechando cerca de metade da distância entre seleção aleatória (45,8%) e o oráculo (69,8%). Dividir o orçamento entre mais iterações ou mais trajetórias deu cobertura parecida.
- **Onde o dinheiro foi:** gerar edições consumiu 59,6% do custo, gerar testes 19,2%, selecionar só 5,8%. A seleção é barata e é onde um bom verificador multiplica o ganho.
- **Reflexion (NeurIPS 2023).** O agente lê o resultado dos testes, escreve uma reflexão em texto sobre o erro e tenta de novo, sem treinar pesos: 91% pass@1 no HumanEval, contra 80% do GPT-4 sozinho.
- **Self-Refine (NeurIPS 2023).** Gera → critica → reescreve; ganho médio de cerca de 20 pontos absolutos em 7 tarefas.
- **Cuidado:** relatos posteriores indicam que o ganho estaciona em 2–3 rodadas e que a reflexão só funciona bem ancorada em algo externo (teste, compilador, linter). Sem isso, o modelo pode piorar a própria resposta.
- **Esforço ajustável no Haiku 5.5:** baixo em tasks fáceis, alto nas difíceis (versão "embutida" da computação adaptativa de Snell).
- **Receita para TypeScript:** `tsc --noEmit` + ESLint + testes unitários da área tocada formam um verificador em camadas, do mais barato ao mais caro. Rodar o barato em todos os candidatos e o caro só nos sobreviventes.

## Orquestração: muitos Haikus, cada um com contexto limpo

- **Dado central (sistema de pesquisa da Anthropic):** arranjo líder + subagentes superou o agente único em 90,2% no eval interno. No BrowseComp, o volume de tokens sozinho explicou 80% da variância de desempenho; número de chamadas de ferramenta e escolha do modelo foram os outros fatores. Custo: agentes usam ~4x os tokens de um chat, multiagente ~15x.
- **Por que isso favorece o Haiku:** se tokens explicam a maior parte do resultado, o modelo mais barato por token compra mais exploração com o mesmo orçamento. A Anthropic posiciona o Haiku 5.5 como subagente de código ao lado de Sonnet/Opus; a Cognition relata que o Devin Fusion manteve 66,2 no FrontierCode usando o Haiku 5.5 como "sidekick", com menos custo e latência.
- **Quando NÃO paralelizar:** multiagente ganha em tarefas que se decompõem em frentes independentes; em fluxos com dependências encadeadas, um agente único ou pipeline determinístico com agentes menores costuma ser mais barato e confiável. O grafo de dependências das tasks do SDD é o critério certo.
- **Prompt caching como multiplicador:** no Haiku 5.5, ler do cache custa US$ 0,01 por milhão contra US$ 0,10 de entrada normal (90% mais barato). Colocar no início do prompt o que todos os subagentes compartilham (CLAUDE.md, TechSpec, repo map, definições de ferramentas) e deixar a task específica no final.
- **Contexto que não vaza:** cada subagente devolve ao orquestrador um resumo estruturado (diff, testes rodados, riscos), não a transcrição inteira.
- **Gargalo de CPU/memória dos testes:** com N candidatos por task o verificador vira o custo dominante. Rodar só os testes afetados (`vitest --changed`, `jest --findRelatedTests`), usar worktrees isoladas por agente e reservar os testes de integração para o gate final, só no candidato vencedor.

## Dados coletados

| Trabalho | Ano | Técnica | Resultado medido | Como usar com o Haiku |
| --- | --- | --- | --- | --- |
| Haiku 5.5 (Anthropic) | 2026 | Modelo pequeno com esforço ajustável | US$ 0,10/0,50 por MTok; Terminal-Bench 4.0: 39,2% (Sonnet 5.5: 70,6%) | Subagente de escopo estreito; esforço alto só onde o eval mostra ganho |
| Multi-agent Research (Anthropic) | 2025 | Orquestrador + subagentes paralelos | +90,2% vs agente único; tokens explicam 80% da variância | Um Haiku por task independente, contexto isolado |
| Context Rot (Chroma) | 2025 | Estudo de comprimento de entrada | 18 de 18 modelos pioram com entrada maior | Contexto mínimo por subagente |
| CodeMonkeys (Stanford) | 2025 | Pares (edit, teste) paralelos + seleção | 57,4% no SWE-bench Verified; cobertura 69,8% | 5–10 candidatos por task, votação por testes |
| Snell et al. (ICLR) | 2025 | Computação adaptativa por dificuldade | >4x mais eficiente que best-of-N; supera modelo 14x maior | Mais tentativas/esforço só nas tasks difíceis |
| Large Language Monkeys | 2024 | Amostragem repetida | SWE-bench Lite: 15,9% → 56% (1 → 250 amostras) | Paralelismo barato com verificador |
| Agentless | 2024 | Localização hierárquica + reparo | 27,33% no SWE-bench Lite a US$ 0,34/issue | Pipeline fixo em vez de agente livre |
| Contextual Retrieval (Anthropic) | 2024 | Contexto por chunk + BM25 + rerank | Falhas de recuperação −49% (−67% com rerank) | Indexar o repo com descrições geradas pelo Haiku |
| Aider repo map | — | AST (Tree-sitter) + PageRank | Mapa do repo em ~1k tokens | Visão global barata no prompt em cache |
| Reflexion | 2023 | Reflexão verbal sobre falhas | HumanEval 91% pass@1 (GPT-4: 80%) | Ler erro do teste antes de tentar de novo |
| Self-Refine | 2023 | Gerar → criticar → reescrever | ~+20 pontos em 7 tarefas | Máx. 2–3 rodadas, ancoradas em tsc/lint/testes |

Os números vêm de benchmarks e modelos diferentes. Para o caso do autor, só um eval próprio (tasks reais do repositório) diz qual combinação vale o custo.

## Plano de ação: pipeline "só Haiku"

O Haiku 5.5 orquestra, localiza, gera e critica; quem decide o que entra é o verificador automático. Passos em ordem de retorno sobre esforço:

1. **Montar um eval próprio antes de otimizar.** 20–30 tasks reais já resolvidas do repositório, com testes. Medir taxa de acerto, custo e tempo do Haiku 5.5 em esforço medium e high.
2. **Prefixo cacheável e estável.** CLAUDE.md + TechSpec + repo map + definições de ferramentas, sempre na mesma ordem, no topo do prompt de todo subagente; a task vai no final.
3. **Repo map em TypeScript.** Assinaturas e exports por Tree-sitter ou pela API do compilador TS, rankeados por referências, limitado a ~1–2k tokens.
4. **Localização hierárquica antes de editar.** Uma chamada escolhe arquivos a partir do repo map; outra escolhe funções; só então abre o código dessas funções.
5. **Índice de código com Contextual Retrieval.** Quebrar por função/classe via AST, pedir ao Haiku um parágrafo de contexto por trecho, indexar com embeddings + BM25 e reranquear os top-20 para 3–5 trechos.
6. **Ferramentas via MCP.** Definição, referências, tipos de um símbolo, ripgrep e "rodar testes afetados" no lugar de leitura de arquivos inteiros.
7. **N candidatos + verificador em camadas.** 3–5 candidatos por task em worktrees isoladas; `tsc --noEmit` → ESLint → testes da área tocada; vence o que passa em mais testes. Integração só no vencedor.
8. **Reflexão com limite.** Se todos falham, cada candidato recebe o log de erro e tenta de novo, no máximo 2–3 rodadas.
9. **Escalonamento dentro do próprio Haiku.** Task que ainda falha sobe o esforço (high → max) e aumenta N; se continuar falhando, volta ao orquestrador para ser quebrada em tasks menores.
10. **Medir custo por task resolvida**, não por chamada: tokens, tempo de CPU dos testes e taxa de acerto, no mesmo eval do passo 1.

Fila de estudo acadêmico sugerida: CodeMonkeys e Large Language Monkeys (escala paralela + verificação), depois Snell et al. (alocação adaptativa) e Agentless (pipelines simples); o post de engenharia multiagente da Anthropic fecha a parte de orquestração.

## Fontes originais (listadas no documento)

Anthropic — Claude Haiku 5.5; Apidog — benchmarks do Haiku 5.5; Anthropic Engineering — multi-agent research system; ZenML e DEV Community — análises do sistema multiagente; Large Language Monkeys (Stanford/arXiv 2407.21787); Snell et al. (ICLR 2025); CodeMonkeys (arXiv 2501.14723); Agentless (arXiv 2407.01489); Reflexion (arXiv 2303.11366); Self-Refine (NeurIPS 2023); Chroma — Context Rot; Anthropic Contextual Retrieval (via Maginative/memx); Aider repo map (fast.io) e repo-mapper (docs.rs).
