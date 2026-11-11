---
name: sdd-haiku-c4
description: Receita para gerar PRD, TechSpec, Tasks e código com o Haiku usando gates determinísticos, testes de aceite escritos antes e loop de correção com a saída real do runner. Use quando quer cortar o custo do fluxo de desenvolvimento orientado a especificação (SDD) trocando o Sonnet pelo Haiku, aceitando medir a queda de qualidade.
---

# SDD com Haiku (condição C4 do estudo 1)

Método do estudo `studies/haiku-sdd-producao` (198 execuções no projeto aberto h3). Resultados medidos: núcleo de testes 100%: Sonnet 49/54 (91%), Haiku simples 21/36 (58%), **Haiku C4 39/54 (72%)**. Sem o teste P1 (rota inexistente responde 404 em problem+json), que o contrato enxuto não pedia de forma explícita, o C4 faz 51/54 (94%). Custo de lista do C4 em relação ao Sonnet: 0,18. O híbrido (TechSpec no Sonnet) custou 3,1 vezes a cascata sem ganho de nota. A cascata Haiku para Sonnet não foi testada de verdade.

## Receita
1. **Um agente novo por artefato** (PRD, TechSpec, Tasks, código), cada um com o prompt do artefato e a regra de pasta (`tools/harness/prompts.md`). Formatos fixos de cabeçalho: `### RF-NN`, `### D-NN`, `### T-NN`.
2. **Gates determinísticos nos documentos.** Verifique por código estrutura e citação de ids (toda tarefa cita RF, toda decisão cita alternativas). Se reprovar, rode a chamada de correção com o prompt "Correção de documento reprovado" e os **erros reais** do gate. Autorrevisão sem feedback externo é controle negativo: não use.
3. **Código com testes primeiro.** O agente escreve testes de aceite derivados do PRD e da TechSpec, roda e confirma que falham; implementa; roda `typecheck`, lint dos arquivos tocados e os testes; corrige com a saída real do runner. Peça explicitamente os casos de borda de contrato (por exemplo, rota inexistente e formato de erro): foi a maior parte das 15 falhas do C4.
4. **Voto por letra** só para decisões fechadas de TechSpec (opções A a D), se quiser medir consenso.
5. **Mantenha o resto igual entre condições** (CLAUDE.md e AGENTS.md do projeto, enunciado sem valores de teste, rubrica, preços) e cada execução em cópia limpa do commit base (git worktree).

## Dependências externas
Claude Code CLI (ou subagentes), git, Node e pnpm do projeto alvo, o runner de testes do projeto (no estudo, `vitest` e `tsc`), e para a rubrica os juízes (Opus no estudo, com alfa de Krippendorff 0,61).

## Limites
Um projeto, um autor do gabarito, juízes do mesmo modelo, sem réplica externa. Notas de documento: o Haiku simples ficou a +0,7 (TechSpec) e -0,2 (Tasks) do Sonnet, dentro do ruído dos juízes.
