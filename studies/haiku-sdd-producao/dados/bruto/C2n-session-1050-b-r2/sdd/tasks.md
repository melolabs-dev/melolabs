# Tarefas: várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-10), `sdd/techspec.md` (D-01 a D-07, estratégia de testes e ordem de execução).

Ordem geral:

1. Decisões e linha de base: T-01 e T-02. T-02 precisa acontecer antes de qualquer alteração de código, inclusive T-03.
2. Testes que devem falhar antes da implementação: T-04 e T-05. Só eles são escritos antes do código, como pede a techspec. T-03 é só tipo e não precisa falhar.
3. Implementação: T-03 (campo), T-06 (abertura em cascata), T-08 (reselagem).
4. Testes restantes, que dependem da implementação: T-07, T-09, T-10.
5. Documentação: T-12 e depois T-13.
6. Verificação final: T-11, por último.

### T-01 — Fechar decisões pendentes e corrigir o PRD

Cobre: RF-07, RF-10

Depende de: nenhuma

Aceite:
- Antes de tudo, confirmar que `sdd/pedido.md` existe. Ele é citado como contrato, mas não foi verificado em nenhuma revisão. Se não existir, parar e perguntar ao usuário; não reconstruir o contrato a partir do PRD.
- Decisão sobre sessões do cabeçalho `x-h3-session` registrada no PRD. Recomendação da techspec (risco 3): aceitar que não são resseladas e documentar. Em seguida, o RF-07 e a premissa de prazo de remoção no `sdd/prd.md` passam a valer só para sessões de cookie.
- A premissa de 32 caracteres no `sdd/prd.md` (premissas e riscos) corrigida: o código impõe o comprimento mínimo de 32 caracteres (`src/utils/internal/iron-crypto.ts:22` e `:28`), mas não impõe entropia. Conferir os números de linha antes de citá-los.
- Confirmado com o código que `updateSession` sela o objeto em memória e não chama `getSession` (D-04). Se chamar, a techspec precisa ser revisada antes de T-08.
- Confirmado como `setCookie` trata um cookie de mesmo nome já emitido na resposta (risco 7). Se acrescentar, registrar que a última escrita deve vencer.
- Confirmado que `useSession` passa pelo mesmo caminho de `getSession` e não precisa de mudança própria.
- Confirmado se algum outro lugar do repositório (exemplos, documentação de `h3/rules`, testes de tipo) usa o campo `password` e precisa ser atualizado. Pergunta em aberto do PRD, hoje sem tarefa.
- Conferido o contrato `sdd/pedido.md` contra o PRD. Divergências registradas no PRD.
- Respostas registradas nas seções "Perguntas em aberto" do `sdd/prd.md` e do `sdd/techspec.md`.

Arquivos: `sdd/prd.md`, `sdd/techspec.md`

### T-02 — Registrar a linha de base de desempenho e o limite de aceitação

Cobre: RF-04

Depende de: nenhuma. Deve ser executada antes de qualquer alteração em `src/`, inclusive T-03.

Aceite:
- `pnpm bench:node` executado sobre o código ainda não alterado. Registrar o nome exato do caso de leitura de cookie inválido em `test/bench/session.ts`, porque é esse caso que será comparado.
- Valores salvos em `sdd/benchmark.md` (arquivo novo, dentro de `sdd/`), com máquina, data e commit de base (`d5baeed`), para comparação com T-11.
- Limite numérico de aceitação definido e registrado nesse mesmo arquivo, antes de T-06 (risco 1 da techspec). Proposta: com N extras, o custo de leitura de cookie inválido fica em no máximo `(1 + N) × 1,2` do valor de base. Se a proposta mudar, a mudança é registrada aqui, não em T-11.
- Nenhum arquivo de código alterado nesta tarefa.

Arquivos: `test/bench/session.ts` (somente leitura e execução), `sdd/benchmark.md` (novo)

### T-03 — Adicionar `extraUnsealPasswords` em `SessionConfig` com teste de tipo

Cobre: RF-01

Depende de: T-01, T-02

Aceite:
- `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password` (`src/utils/session.ts:48`), com JSDoc mínimo provisório (o texto final vem em T-12).
- `password` continua `string`.
- Bloco `describe("SessionConfig")` em `test/unit/types.test-d.ts`, após o bloco de `basicAuth context`, com `expectTypeOf` para `password` (`string`) e `extraUnsealPasswords` (`string[] | undefined`).
- `SessionConfig` continua exportado de forma que o teste de tipo consiga importá-lo.
- `pnpm lint` passa (oxlint, oxfmt e checagem de tipo).

Arquivos: `src/utils/session.ts`, `test/unit/types.test-d.ts`

### T-04 — Escrever os testes de integração de abertura, selagem e reselagem (vermelhos)

Cobre: RF-02, RF-03, RF-07

Depende de: T-03

Aceite:
- Novo `describe("extraUnsealPasswords", ...)` no fim de `test/session.test.ts`, com `describeMatrix`, senhas de 32 ou mais caracteres e `sessionConfig` como base.
- Casos: cookie selado com a senha antiga abre com `password` + extra, mantendo `id` e `data`; leitura sem escrita com extra gera `Set-Cookie` que abre só com `password`; escrita com `updateSession` após abertura com extra gera cookie que não abre com a senha antiga.
- Executados antes de T-06 e confirmados como falhando pelo motivo esperado (cookie não aberto ou ausência de `Set-Cookie`), não por erro de sintaxe ou de import. Registrar a saída do teste que falha.
- Suíte existente de `test/session.test.ts` continua passando.

Arquivos: `test/session.test.ts`

### T-05 — Escrever os testes unitários de ordem de tentativa e falha (vermelhos)

Cobre: RF-02, RF-08, D-03, D-05

Depende de: T-03

Aceite:
- Novo `test/unit/session-unseal.test.ts` com `vi.mock` de `src/utils/internal/iron-crypto.ts`: `unseal` e `seal` envolvidos por `vi.fn`, com `importOriginal`.
- Casos de ordem, parada e falha de candidato (abaixo) usam `legacySealFallback: false`. Com o fallback ligado, cada candidato chama `unseal` duas vezes (risco 8 da techspec), e a contagem de chamadas deixa de representar a ordem.
- Casos:
  - Ordem de tentativa (`password`, depois extras na ordem informada).
  - Parada na primeira que abre: com `["a", "b"]` e cookie da primeira extra, `b` não é chamada.
  - Erro de candidato (senha curta) não impede a tentativa seguinte.
  - Nenhuma senha abre: `getSession` trata como sessão nova sem erro (RF-08).
  - Nenhuma senha abre com uma só senha: `unsealSession` lança a mesma mensagem de erro de hoje (D-03).
- Testes que dependem da nova ordem falham antes de T-06 pelo motivo esperado. O teste de erro com uma senha pode já passar antes da mudança; nesse caso ele é uma guarda de regressão, e isso fica dito no arquivo.

Arquivos: `test/unit/session-unseal.test.ts`

### T-06 — Implementar a abertura em cascata (`unsealPasswords`, `unsealWithPassword`, `unsealCandidates`)

Cobre: RF-02, RF-04, RF-05, RF-06, RF-08

Depende de: T-04, T-05

Aceite:
- Helpers internos no fim de `src/utils/session.ts`, conforme D-02 e D-03 da techspec: `unsealPasswords` (filtra vazias e remove duplicatas com `Set`, `password` sempre primeiro), `unsealWithPassword` (corpo atual de `src/utils/session.ts:322-348` com `password` como parâmetro, mantendo `legacySealFallback` e `kLegacySeal`) e `unsealCandidates` (tenta em ordem, guarda o primeiro erro, devolve `{ session, openedWithExtra }`).
- Checagens de `maxAge` e `idleTimeout` ficam fora do `try` e sem alteração de conteúdo.
- `unsealSession` vira invólucro que devolve só `session`, com a mesma assinatura e o mesmo erro quando nenhuma senha abre (D-05).
- `getSession` usa `unsealCandidates(...).catch(() => undefined)` (`src/utils/session.ts:196-197`), sem mudar o tratamento de sessão nova.
- Suíte existente (`test/session.test.ts`, incluindo os testes sem `extraUnsealPasswords`) passa sem alteração.
- Testes de T-04 (abertura e selagem) e T-05 (ordem, parada, RF-08) passam.
- Nenhum símbolo novo, nenhum `as any`, nenhum arquivo de `src/utils/internal/` alterado.
- Dívida de tamanho registrada (techspec, risco 9): `src/utils/session.ts` passa de 200 linhas.

Arquivos: `src/utils/session.ts`, `sdd/techspec.md` (só o registro da dívida)

### T-07 — Testes de legado, expiração e ausência de senhas extras

Cobre: RF-04, RF-05, RF-06

Depende de: T-06, T-08

Motivo da dependência em T-08: o "um único `Set-Cookie`" no caso legado só existe depois da reselagem de D-04.

Aceite:
- Em `test/session.test.ts`, no bloco de `extraUnsealPasswords`:
  - Cookie legado (`iterations: 1`) aberto com a senha extra: sessão carregada e um único `Set-Cookie` selado com `password` (RF-05).
  - `maxAge` vencido com extra: sessão não carregada, com `vi.useFakeTimers({ toFake: ["Date"] })` como em `test/session.test.ts:188-190` (RF-06).
  - `idleTimeout` vencido com extra, dentro de `maxAge`: sessão não carregada (RF-06).
  - Sem `extraUnsealPasswords` e com cookie selado com outra senha: sessão nova, sem erro e sem `Set-Cookie` (RF-04).
- Em `test/unit/session-unseal.test.ts`, legado + extra e modern + extra resultam em `seal.mock.calls.length === 1` (D-04, RF-05).
- Testes de legado e expiração passam.

Arquivos: `test/session.test.ts`, `test/unit/session-unseal.test.ts`

### T-08 — Reselar com `password` após abertura com senha extra

Cobre: RF-07

Depende de: T-01, T-04, T-06

Motivo da dependência em T-01: D-04 só vale depois que o PRD registrar a exceção das sessões do cabeçalho e que `updateSession` for confirmado como selagem em memória.

Aceite:
- Em `getSession` (`src/utils/session.ts:214-216`), o bloco de reselagem fica como D-04: se `openedWithExtra` e `sessionFromCookie`, chama `updateSession(event, config).catch(() => {})`; caso contrário, mantém a condição atual (`legacySeal || shouldSlide`).
- Sessão aberta com extra e sem escrita gera `Set-Cookie` selado com `password` (teste de T-04 passa).
- Sessão vinda do cabeçalho `x-h3-session` aberta com extra não gera `Set-Cookie` (teste de integração documentando a exceção de D-04).
- Teste unitário: `seal.mockRejectedValueOnce(...)` na reselagem de rotação, e `getSession` resolve com a sessão, sem rejeitar (D-04, risco 5).
- Nenhum `Set-Cookie` extra quando a sessão não foi aberta com extra e não há slide (RF-04).

Arquivos: `src/utils/session.ts`, `test/session.test.ts`, `test/unit/session-unseal.test.ts`

### T-09 — Garantir que a selagem usa só `password` e que o último `Set-Cookie` vence

Cobre: RF-03

Depende de: T-01, T-08

Aceite:
- `sealSession` (`src/utils/session.ts:300`) e `updateSession` (`src/utils/session.ts:267`) continuam selando só com `config.password`, sem alteração de código nesses pontos.
- Teste: após abrir com extra e gravar com `updateSession`, o `Set-Cookie` final abre com `password` e não abre com a senha antiga (RF-03).
- Teste: chamada direta de `sealSession` com config que tem extra gera cookie que não abre com a extra.
- Teste de integração: o cliente recebe dois `Set-Cookie` do mesmo nome (reselagem e escrita do handler) e fica com o último (risco 7 da techspec).
- Se esse último teste mostrar que o cliente fica com o primeiro, a correção é de ordem de escrita em `getSession`/`updateSession`. Ela sai do escopo "sem alteração de código" deste item, então a tarefa para e a decisão volta para T-01 antes de fechar.

Arquivos: `src/utils/session.ts`, `test/session.test.ts`

### T-10 — Testes de casos de borda de senhas

Cobre: RF-09

Depende de: T-05, T-06

Aceite:
- Em `test/unit/session-unseal.test.ts`:
  - Senha extra igual a `password`: `unseal` chamado uma vez com essa senha.
  - Senha extra vazia (`""`): ignorada, sem chamada extra.
  - Senhas extras duplicadas: uma chamada por senha distinta não vazia.
  - Repetição de `password` nas extras não gera tentativa adicional.
- Casos passam e não geram erro de configuração.
- Teste de D-05: `unsealSession` devolve objeto sem propriedades novas, inclusive quando aberto com extra (`Object.keys` e `Object.getOwnPropertySymbols` iguais aos da abertura com senha atual). Ele pode passar antes da mudança e serve de guarda.

Arquivos: `test/unit/session-unseal.test.ts`

### T-11 — Verificação final: suíte, lint, cobertura e benchmark

Cobre: RF-01 a RF-10 (checklist), RF-04, RF-09

Depende de: T-02, T-07, T-09, T-10, T-12, T-13

Aceite:
- `pnpm vitest run test/session.test.ts test/unit/session-unseal.test.ts` passa nos modos `web` e `node`.
- `pnpm lint` passa.
- `pnpm test` (suíte completa com cobertura) passa.
- `pnpm bench:node` executado nas mesmas condições de T-02 e comparado com a linha de base de `sdd/benchmark.md`. O limite é o que foi registrado em T-02; não se redefine aqui.
- Checklist RF-01 a RF-10 do PRD conferido item por item contra o código e os testes, com o resultado registrado no próprio `sdd/prd.md` ou em `sdd/benchmark.md`.
- Se algum teste ou limite falhar, a tarefa fica aberta e o resultado é reportado com a saída, sem ajustar o limite para passar.

Arquivos: nenhum arquivo de código alterado nesta tarefa (apenas execução de comandos e registro de resultados)

### T-12 — Escrever o JSDoc de `SessionConfig.extraUnsealPasswords` e de `password`

Cobre: RF-10

Depende de: T-01, T-03

Aceite:
- JSDoc de `extraUnsealPasswords` em português, com: senhas só para abrir; nunca selam; ordem de tentativa; reselagem com `password` ao abrir com extra; remover a senha depois que as sessões forem resseladas ou expirarem (prazo = `maxAge` mais a janela até a próxima leitura); exceção das sessões do cabeçalho `x-h3-session`; limite recomendado de duas senhas e custo de CPU; senhas de 32 ou mais caracteres.
- JSDoc de `password` (`src/utils/session.ts:40-47`) aponta para `extraUnsealPasswords` e mantém a regra de comprimento.
- Os dois JSDocs e o texto de T-13 usam a mesma regra de comprimento e o mesmo limite de senhas, sem contradição.
- Lido sem outras referências, o JSDoc de `extraUnsealPasswords` deixa claro o prazo da transição e que a senha extra nunca sela (critério de aceite de RF-10 no PRD).

Arquivos: `src/utils/session.ts`

### T-13 — Documentar a rotação de senhas no guia de sessão

Cobre: RF-10

Depende de: T-01, T-12

Aceite:
- Conferir as linhas `:37` e `:43` de `docs/4.examples/handle-session.md` antes de editar, porque podem ter mudado.
- Parágrafo novo após a nota de entropia (`:37`), com o passo a passo: adicionar a senha antiga em `extraUnsealPasswords`, trocar `password`, remover a antiga após o prazo.
- Ajuste da nota de comprimento (`:43`) para citar a regra de 32 caracteres sem contradizer o código.
- Limite de duas senhas extras e a exceção das sessões do cabeçalho descritos.
- Formatação conferida só neste arquivo, com `oxfmt` sobre ele. Não usar `pnpm fmt`, que roda `automd` e `oxlint --fix` e pode alterar outros arquivos.

Arquivos: `docs/4.examples/handle-session.md`
