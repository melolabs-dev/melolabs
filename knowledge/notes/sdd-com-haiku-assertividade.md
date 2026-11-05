---
id: sdd-com-haiku-assertividade
title: "SDD com Haiku: como aumentar a assertividade de um modelo pequeno em PRDs, TechSpecs e Tasks"
source_url: https://claude.ai/artifact/3yeX2D8bSNMkECuRi6kFKb
kind: literature-review
evidence: revisao-de-literatura
validated_by_author: false
publishable: false
fidelity: resumo-curado
date: 2026-11-04
tags: [sdd, haiku, prd, techspec, tasks, papers]
---

# SDD com Haiku: como aumentar a assertividade de um modelo pequeno

> Resumo curado do documento original (fonte de verdade: `source_url`). Números vêm de papers com benchmarks diferentes do contexto do autor: tratar como **direção**, não como magnitude (premissa P5 do registro de suposições). Nada aqui foi validado pelo autor ainda.

## Tese

Um modelo pequeno como o Haiku fica mais assertivo em SDD quando o ganho vem do **fluxo**, não do prompt: tarefas menores, verificação externa e escalonamento seletivo. A literatura converge em três ideias: decompor e planejar antes de gerar; verificar com sinais objetivos (testes, compilador, rastreabilidade) em vez de autocrítica; gastar computação extra só onde o problema é difícil.

## As 10 melhorias de maior impacto (em ordem de prioridade)

1. **Trocar prompt engineering por flow engineering.** Cada artefato (PRD, TechSpec, Tasks) vira uma sequência de chamadas curtas, cada uma com um único objetivo. AlphaCodium levou o GPT-4 de 19% para 44% (pass@5) só mudando o fluxo.
2. **IDs rastreáveis em tudo.** Requisitos com IDs hierárquicos (`REQ-<área>.<feature>.<item>`); cada task e trecho de código cita os IDs que implementa. Permite detectar alucinação por diferença de conjuntos, sem LLM.
3. **Gates determinísticos antes dos gates de IA.** Validar schema, cobertura de IDs, `tsc`, lint e testes antes de pedir revisão a um modelo.
4. **Não confiar em autocorreção pura.** Modelos pioram ao revisar a própria resposta sem feedback externo; o loop de correção precisa receber erros reais (stack trace, teste falhando, ID órfão).
5. **Planejar antes de escrever.** Etapa explícita de plano antes de cada artefato e de cada task de código (até +25,4% de Pass@1 em geração de código, Self-planning).
6. **Amostrar várias vezes e votar só nas decisões críticas.** Escolhas de arquitetura na TechSpec ganham com N amostras + voto (self-consistency); tasks triviais não precisam.
7. **Cascata Haiku → modelo maior.** Haiku por padrão; escala para Sonnet/Opus quando o verificador falha duas vezes ou o voto não converge.
8. **Contexto mínimo e bem posicionado.** Um pacote de contexto por task, com o essencial no início e no fim do prompt; nada de colar o PRD inteiro em cada agente (Lost in the Middle).
9. **Raciocinar livre, formatar depois.** Gerar o conteúdo em texto livre e converter para JSON/YAML numa segunda chamada; formato rígido durante o raciocínio derruba a qualidade.
10. **Testes como parte da spec.** Critérios de aceite viram testes executáveis antes do código, gerados a partir da spec e não do código.

## Por que um modelo pequeno erra em SDD

O Haiku raramente erra por falta de conhecimento de engenharia; erra por **carga cognitiva por chamada** (muitas restrições, contexto longo, decisões encadeadas num único passo). No fluxo PRD → TechSpec → ~50 tasks, o erro de uma etapa se propaga, então a precisão precisa ser garantida na fronteira de cada artefato.

| Modo de falha | Onde aparece | Mitigação |
| --- | --- | --- |
| Requisito implícito ou ambíguo | PRD | Perguntas de esclarecimento + critérios testáveis |
| Informação perdida em contexto longo | TechSpec, Tasks | Pacote de contexto por task, essencial no início/fim |
| Decisão de arquitetura instável | TechSpec | N amostras + voto; escalar se não convergir |
| Escopo inventado (alucinação) | Tasks, código | IDs REQ citados + checagem de órfãos |
| Requisito esquecido | Tasks | Checagem de cobertura por diferença de conjuntos |
| Dependências erradas entre tasks | Tasks | Declarar arquivos/módulos tocados por task e validar |
| Autocrítica que piora a resposta | Gates de IA | Revisão alimentada por erros reais |
| Formato rígido atrapalhando o raciocínio | Todas | Gerar em texto, converter depois |

## O que a literatura diz (resumo dos achados relevantes)

| Estudo | Achado principal | Implicação para o SDD |
| --- | --- | --- |
| Citation Discipline in SDD (Panda, 2026) | Exigir citação por linha de IDs REQ-X.Y.Z permitiu detectar alucinação automaticamente em 86,4% (Claude) e 88,0% (GLM) dos casos, com 0% de falso positivo; sem citação a detecção foi 0% | Adotar IDs hierárquicos e citação obrigatória nas tasks |
| AlphaCodium (Ridnik et al., 2024) | Fluxo iterativo baseado em testes elevou o GPT-4 de 19% para 44% (pass@5); ~95% do esforço foi "flow engineering" | Quebrar cada artefato em etapas pequenas |
| Self-planning (Jiang et al.) | Planejar antes de codificar: até 25,4% de ganho relativo em Pass@1 vs geração direta | Etapa de plano obrigatória antes de cada task |
| LLMs Cannot Self-Correct Reasoning Yet (Huang et al., 2023) | Sem feedback externo, modelos não melhoram e às vezes pioram | Gates de IA devem receber erros concretos |
| Scaling Test-Time Compute (Snell et al., 2024) | Alocar inferência por dificuldade foi >4x mais eficiente que best-of-N; modelo menor superou um 14x maior onde já tinha acerto não trivial | Amostras extras só nas decisões difíceis |
| Self-Consistency (Wang et al., 2022) | Votar entre vários raciocínios elevou GSM8K de 56,5% para 74,4% | Votação na TechSpec e na decomposição |
| FrugalGPT (Chen et al., 2023) | Cascata de modelos igualou o melhor modelo com até 98% menos custo | Haiku por padrão, escalar quando necessário |
| Lost in the Middle (Liu et al., 2023) | Desempenho maior com informação no início/fim do contexto; cai no meio e com contexto mais longo | Pacotes curtos; restrições críticas no topo e repetidas no fim |
| Let Me Speak Freely? (Tam et al., 2024) | Restrições de formato degradam o raciocínio | Duas chamadas: conteúdo livre, depois extração para JSON |
| Test-Driven Development for Code Generation (Mathews & Nagappan, 2024) | Incluir testes no enunciado aumentou a taxa de sucesso em MBPP e HumanEval | Tasks recebem testes de aceite prontos |
| Tese de Mathews (Waterloo, 2025) | Testes gerados por LLM a partir do código podem validar bugs | Gerar testes a partir da spec, nunca do código recém-escrito |
| Chain-of-Verification (Dhuliawala et al., 2023) | Rascunho → perguntas de verificação → respostas independentes → versão final reduz alucinação | Aplicar no PRD e na TechSpec |
| LLM-as-a-Judge (Zheng et al., 2023) | Juízes LLM têm vieses de posição, verbosidade e autopreferência | Checklist fechado, ordem aleatória, modelo diferente do gerador |
| Spec-Driven Code Generation (Rosa et al., SANER 2026) | Protocolo para medir fluxo Especificação → Testes → Função; trabalhos anteriores indicam ganho com TDD | Base metodológica do experimento A/B |

Limite comum: quase todos os números vêm de benchmarks de funções isoladas ou raciocínio, não de projetos com 50 tasks. A direção dos efeitos é consistente; a magnitude no sistema do autor precisa ser medida.

## Pontos de melhoria por artefato

**PRD**
- Fase de perguntas antes do rascunho (ambiguidades e premissas; o modelo não escreve requisitos ainda).
- IDs hierárquicos obrigatórios; cada requisito com critério Dado/Quando/Então e prioridade; requisito sem critério testável é rejeitado pelo validador.
- Seção "fora de escopo" explícita (alimenta a checagem de escopo inventado).
- Chain-of-Verification: perguntas de checagem respondidas em chamadas separadas ("algum requisito contradiz outro?", "há requisito sem ator?").

**TechSpec**
- Plano primeiro, texto depois: uma chamada lista as decisões a tomar; cada decisão vira chamada própria.
- Votação (3 a 5 propostas independentes) nas decisões críticas; sem maioria clara, escalar para modelo maior.
- Rastreabilidade REQ → componente validada por script.
- Árvore de decisões existente como contexto fixo (restrição, não histórico).
- Contratos executáveis (interfaces TypeScript, schemas Zod/JSON Schema) compilados com `tsc` já no gate da TechSpec.

**Tasks**
- Formato fixo por task: REQs implementados, arquivos/módulos tocados, dependências, testes de aceite, definição de pronto.
- Checagem de cobertura e de órfãos sem LLM (diferença de conjuntos de REQs).
- Validação de paralelismo: duas tasks no mesmo lote não podem declarar o mesmo arquivo.
- Testes antes do código; loop de correção só com saída real do runner.
- Pacote de contexto por task com restrições críticas no início e repetidas no fim.
- Tamanho calibrado: se uma task falha repetidamente, dividi-la em vez de insistir.

**Gates de revisão e integração**
- Ordem: schema e IDs → `tsc` e lint → testes afetados → revisão por IA → integração. O gate de IA só vê o que passou nos anteriores.
- Revisor com checklist fechado, itens em ordem aleatória e, se possível, modelo diferente do que gerou.
- Rodar no gate de revisão só os testes impactados pelos arquivos da task; suíte completa só no gate de integração.

## Pipeline proposto

Haiku como gerador em todas as etapas, com gate determinístico na saída de cada uma; o modelo maior só entra por duas portas: verificador que falha duas vezes, ou voto sem maioria. Gates de cobertura, órfãos e conflito de arquivos são scripts simples sobre os metadados das tasks; a taxa de escalonamento vira o principal indicador de custo.

## Prompts-modelo (resumo)

Sete templates, cada um faz uma coisa só, usa tags XML para separar contexto de instrução e coloca as restrições no início e no fim: (1) esclarecimento do PRD (só perguntas e premissas); (2) requisito com ID e critério testável; (3) verificação independente (CoVe, uma chamada por pergunta); (4) decisão de arquitetura com votação (3 a 5 execuções, formato `ESCOLHA / REQS_ATENDIDOS / RISCO_PRINCIPAL`, maioria ≥ 3/5 segue); (5) task para o executor (plano de no máximo 6 passos, depois implementação comentando o REQ de cada função); (6) loop de correção com erro real e trecho de código; (7) extração para formato estruturado em chamada separada. Texto completo no documento original.

## Como medir assertividade

| Métrica | Como calcular | O que indica |
| --- | --- | --- |
| Aceite na primeira passada | Tasks aprovadas em todos os gates sem retrabalho ÷ total | Assertividade geral do executor |
| Rejeição por gate | Reprovações em cada gate ÷ tasks que chegaram nele | Em que etapa o Haiku mais erra |
| Cobertura de REQ | REQs com ≥ 1 task ÷ REQs do PRD | Requisitos esquecidos na decomposição |
| Taxa de órfãos | IDs citados inexistentes ÷ IDs citados | Escopo inventado / alucinação |
| Iterações até verde | Média de ciclos no loop de correção | Qualidade do pacote de contexto e dos testes |
| Taxa de escalonamento | Chamadas escaladas ao modelo maior ÷ total | Custo real da cascata |
| Concordância da votação | % de decisões com maioria clara | Dificuldade e estabilidade da TechSpec |
| Conflitos de merge | Conflitos no gate de integração ÷ lotes | Qualidade da declaração de arquivos por task |
| Defeitos pós-merge | Bugs abertos ligados a um REQ após integração | Asserções que os testes não pegaram |
| Custo e tempo por feature | Tokens e minutos do PRD ao merge | Se o ganho compensa |

**Experimento A/B sugerido:** separar 5 a 10 features já entregues (com PRD e código final conhecidos), rodar o pipeline atual (A) e o pipeline com melhorias (B) sobre os mesmos insumos, cada um pelo menos 3 vezes (a variação entre execuções é grande), introduzir uma melhoria por vez (IDs → gates determinísticos → votação → cascata), comparar as métricas e guardar todas as execuções como dados rotulados.

## Referências citadas

Panda (2026) Citation Discipline in Spec-Driven Development; Rosa et al. (2026) Understanding Specification-Driven Code Generation with LLMs; Ridnik et al. (2024) AlphaCodium; Jiang et al. Self-planning Code Generation; Huang et al. (2023) LLMs Cannot Self-Correct Reasoning Yet; Snell et al. (2024) Scaling LLM Test-Time Compute; Wang et al. (2022) Self-Consistency; Chen et al. (2023) FrugalGPT; Liu et al. (2023) Lost in the Middle; Tam et al. (2024) Let Me Speak Freely?; Mathews & Nagappan (2024) TDD for Code Generation; Mathews (2025) tese Waterloo; Dhuliawala et al. (2023) Chain-of-Verification; Zheng et al. (2023) LLM-as-a-Judge.
