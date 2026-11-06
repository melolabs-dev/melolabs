# Como repetir este estudo

## Pré-requisitos
- Windows 11, Node 24, pnpm 11, git e openssl; clone do h3 em `C:\dev\h3-estudo` no commit `f0e17808ac2439b6434bb10609a961067f4d555b`; chave do gabarito em `C:\Users\<usuario>\.melolabs-gabarito.key` (fora do repositório); Claude Code com os modelos Haiku, Sonnet e Opus.
- Os testes ocultos ficam cifrados em `studies/haiku-sdd-producao/gabarito-cifrado/`; sem a chave, só é possível rodar a coleta até o código, não pontuar.

## Como rodar
Não há um único comando que rode tudo, porque cada etapa é um agente do Claude Code com contexto limpo, e só o Claude Code consegue criá-los. O que existe é um protocolo fixo, com tudo o que não é agente automatizado em `tools/harness/harness.py`:
1. `python tools/harness/harness.py proxima` mostra a próxima execução do plano (`dados/bruto/plano-execucoes.json`, ordem sorteada com a semente `20261105`).
2. `python tools/harness/harness.py prep <id> <variante>` cria a pasta limpa `C:\dev\runs\<id>`.
3. Quatro agentes novos, um por etapa (PRD, TechSpec, Tasks, código), com os prompts de `tools/harness/prompts.md`; depois de cada documento roda `python tools/harness/gates.py <prd|techspec|tasks> <pasta>` e `python tools/harness/harness.py etapa ...` grava tokens, chamadas e tempo.
4. `python tools/harness/harness.py score <id> <variante>` decifra os testes, roda, grava `score.json` e apaga os testes.
5. `python tools/harness/harness.py audit <id> <transcrições...>` varre vazamento; `python tools/harness/harness.py finish <id>` guarda diff e artefatos e remove a pasta.

## Onde saem os dados
`studies/haiku-sdd-producao/dados/bruto/` (um `execucoes.jsonl` e uma pasta por execução) e `dados/processado/`.

## Tempo esperado
De 6 a 8 minutos por execução (Haiku ou Sonnet), em fila. O plano completo tem 138 execuções de código em duas fases (A e B), mais a avaliação cega. Cerca de 17 horas de execução e 7 de avaliação.

## Como conferir
`python tools/research/pesquisa.py status haiku-sdd-producao` e a tabela de `dados/processado/` gerada pelos scripts de `analise/`.
