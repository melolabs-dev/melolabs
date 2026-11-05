# Prompts das etapas (neutros; iguais para Haiku e Sonnet)

Cada chamada é um agente novo, sem a conversa. Substituir `{RUN}` pela pasta da execução (`C:\dev\runs\<id>`). A regra de pasta vale para todos os prompts.

## Regra comum (primeira linha de todo prompt)
Trabalhe somente dentro da pasta `{RUN}` (um clone do projeto h3). Não leia, liste nem procure arquivos fora dela. Leia o `CLAUDE.md` e o `AGENTS.md` dessa pasta antes de começar. Responda no final com no máximo 5 linhas: o que foi feito e se algo ficou pendente.

## PRD
Leia `sdd/pedido.md`. Escreva o PRD em `sdd/prd.md`, em português, com: problema e objetivo; requisitos funcionais, cada um com cabeçalho `### RF-NN — título` e um critério de aceite no formato Dado/Quando/Então; seção "Fora de escopo"; premissas e riscos. Não altere o código do projeto.

## TechSpec
Leia `sdd/pedido.md`, `sdd/prd.md` e o código relevante do projeto. Escreva a especificação técnica em `sdd/techspec.md`, em português, com: decisões de arquitetura, cada uma com cabeçalho `### D-NN — título`, alternativas consideradas e a escolha justificada; arquivos a alterar com citações no formato `caminho/arquivo.ts:linha` conferidas no código; contratos e assinaturas; estratégia de testes; riscos. Não altere o código do projeto.

## Tasks
Leia `sdd/prd.md` e `sdd/techspec.md`. Escreva as tarefas de implementação em `sdd/tasks.md`, em português. Cada tarefa tem cabeçalho `### T-NN — título` e os campos `Cobre:` (ids RF-NN), `Arquivos:` (rodapé com os arquivos que a tarefa toca), `Depende de:` (ids de tarefa ou "nenhuma") e `Aceite:` (como verificar). Todo requisito do PRD deve ser coberto por pelo menos uma tarefa. Não altere o código do projeto.

## Código (C0, C1 e demais condições sem TDD)
Implemente a feature seguindo `sdd/techspec.md` e `sdd/tasks.md`. Rode `pnpm typecheck` e os testes existentes relacionados ao que você alterou e corrija o que quebrar. Não crie arquivos de documentação além dos de `sdd/`.

## Código com testes primeiro e loop (C4)
Implemente a feature seguindo `sdd/techspec.md` e `sdd/tasks.md`, nesta ordem: (1) escreva primeiro testes de aceite em `test/sdd-<nome>.test.ts`, derivados do PRD e da TechSpec, no estilo dos testes existentes do projeto; rode-os e confirme que falham; (2) implemente; (3) rode os testes que você escreveu, `pnpm typecheck` e os testes existentes relacionados, e repita a correção usando a saída real do comando, no máximo 3 rodadas. Não crie arquivos de documentação além dos de `sdd/`.

## Correção de documento reprovado no gate (C2, C4)
O gate determinístico reprovou `sdd/<arquivo>` com estes erros reais:

{ERROS}

Corrija somente esses pontos em `sdd/<arquivo>`, mantendo o resto. Não altere o código do projeto.
