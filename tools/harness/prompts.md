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

---

# Variações da H11 (personas e contexto detalhado) e das demais condições da fase B

O prompt de cada etapa é o mesmo das seções acima; muda só o bloco inserido logo depois da "Regra comum". `{ETAPA}` é prd, techspec, tasks ou codigo.

## C10, só persona (um parágrafo curto por etapa)
- prd: "Você é uma gerente de produto sênior, com anos de experiência em frameworks HTTP e bibliotecas de código aberto, e escreve requisitos que um engenheiro consegue testar sem perguntar nada."
- techspec: "Você é um arquiteto de software sênior de TypeScript e de plataformas web, e escreve especificações técnicas que um engenheiro pleno implementa sem ambiguidade."
- tasks: "Você é uma tech lead que quebra especificações em tarefas pequenas, independentes e verificáveis."
- codigo: "Você é um engenheiro sênior de TypeScript especialista em HTTP, sessões e segurança, e entrega código pequeno, testado e compatível com o que já existe."

## C11, só contexto detalhado (bloco igual em todas as etapas)
"Contexto do projeto: o h3 é um framework HTTP mínimo e de alto desempenho, baseado nos primitivos padrão da web (Request, Response, URL, Headers), que roda em Node.js, Bun, Deno e Cloudflare Workers. O código fica em src/, os testes em test/ (vitest, rodando nos alvos web e node por meio de describeMatrix), e as convenções estão no AGENTS.md e no CLAUDE.md. Mudanças devem ser compatíveis com o que já existe, sem novas dependências e sem novas exportações públicas além do pedido. Um bom requisito tem identificador, comportamento observável e critério Dado/Quando/Então; uma boa especificação cita arquivo e linha reais, justifica cada decisão com alternativas e lista riscos; uma boa tarefa declara os arquivos que toca e como verificá-la; um bom código é pequeno, segue o estilo do arquivo vizinho e passa em typecheck, lint e na suíte existente. Antes de decidir qualquer ponto em aberto, procure no código existente como o projeto já resolveu caso parecido e siga esse padrão."

## C12, persona e contexto (persona da C10 seguida do bloco da C11)

## C13, controle de mesmo tamanho (sem informação útil)
"Observações gerais sobre organização de trabalho: documentos costumam ser lidos de cima para baixo, por isso vale começar pelo mais importante. Frases curtas ajudam a leitura, e listas ajudam quando há itens paralelos. Revisar o texto antes de entregar costuma melhorar a clareza. Vale usar nomes consistentes para as mesmas coisas ao longo do documento, manter a formatação uniforme e evitar repetições desnecessárias. Ao trabalhar em equipe, é útil registrar decisões e combinar quem confere cada parte. Em geral, trabalhos longos se beneficiam de pausas regulares, e um ambiente organizado reduz erros de distração. Quando houver dúvidas sobre prioridades, vale conversar cedo, porque ajustes tardios costumam custar mais do que ajustes cedo. Também ajuda manter anotações do que já foi feito, para não repetir esforço, e reservar tempo no fim para uma leitura final com calma."

## C2, Haiku com gate e loop só nos documentos (código sem TDD)
Prompts das etapas iguais à C1; depois de cada documento roda `gates.py`; se reprovar, roda o prompt "Correção de documento reprovado no gate" com os erros reais, no máximo 2 rodadas. Código com o prompt da C1.

## C2n, controle negativo de autorrevisão
Prompts das etapas iguais à C1; depois de cada documento, um segundo agente do mesmo modelo recebe: "Releia o documento sdd/<arquivo> e melhore o que achar que está fraco, sem consultar nenhum comando ou ferramenta de verificação." (sem passar os erros do gate). Código com o prompt da C1.

## C5, cascata
Igual à C4; se um documento ainda reprova o gate depois de 2 rodadas de correção, a etapa é refeita com o Sonnet. Se o código não passa em typecheck e nos testes que o próprio agente escreveu depois de 3 rodadas, o código é refeito pelo Sonnet com a saída do erro.

## C6, híbrido
PRD e Tasks pelo Haiku (prompts da C1); TechSpec pelo Sonnet; código pelo Haiku com o prompt da C1.
