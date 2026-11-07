# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession`, `getSession`, `updateSession` e `unsealSession` (`src/utils/session.ts`) aceitam uma única `password`. Para trocar essa senha (rotação de segredo), é preciso escolher entre invalidar todas as sessões ativas, forçando novo login de todos os usuários, ou manter a senha antiga indefinidamente.

**Objetivo:** permitir que `SessionConfig` declare senhas anteriores que **só abrem** sessões seladas, enquanto `password` continua sendo a única usada para **selar**. Assim a rotação acontece sem derrubar sessões válidas, e as sessões migram para a senha nova conforme são usadas.

Referência: issue h3js/h3#1050, primeira alternativa proposta (campo novo, sem mudar o tipo de `password`).

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com JSDoc explicando que as senhas só abrem sessões e nunca selam. `password` continua sendo `string`.

**Dado** um objeto `SessionConfig` com `password: "<senha nova>"` e `extraUnsealPasswords: ["<senha antiga>"]`,
**Quando** o projeto passa pelo `pnpm typecheck`,
**Então** a configuração compila sem erro, e um valor como `extraUnsealPasswords: "abc"` ou `extraUnsealPasswords: [1]` gera erro de tipo (teste em `test/unit/types.test-d.ts`).

### RF-02 — Abrir sessão selada com uma senha extra

Ao ler uma sessão, `unsealSession` tenta abrir o selo primeiro com `password` e, se falhar, com cada item de `extraUnsealPasswords`, na ordem do array. A primeira senha que abre o selo vence.

**Dado** uma sessão selada com a senha `A` (antiga), e a configuração `{ password: "B", extraUnsealPasswords: ["A"] }`,
**Quando** `getSession(event, config)` é chamado com o cookie dessa sessão,
**Então** o `id`, o `createdAt` e o `data` originais são restaurados, e a função não lança erro.

### RF-03 — Selar usa somente `password`

Nenhuma escrita de sessão usa `extraUnsealPasswords` para selar.

**Dado** a configuração `{ password: "B", extraUnsealPasswords: ["A"] }`,
**Quando** `updateSession(event, config, { user: "x" })` é chamado,
**Então** o cookie `Set-Cookie` gerado abre com `unseal(..., "B")` e falha com `"A"`.

### RF-04 — Migração para a senha atual na leitura

Quando uma sessão é aberta com uma senha extra, ela é resselada com `password` na mesma requisição, para que o cookie passe a usar a senha nova. A resselagem segue a regra já existente de `getSession` (ela acontece pelo mesmo caminho que hoje reselaria uma sessão legada).

**Dado** a configuração `{ password: "B", extraUnsealPasswords: ["A"] }` e uma sessão selada com `A`,
**Quando** `getSession` é chamado com esse cookie,
**Então** a resposta contém um `Set-Cookie` novo, e o cookie novo abre com `"B"` sem ajuda de `"A"` (verificado com `unsealSession` usando apenas `{ password: "B" }`).

### RF-05 — Sem senhas extras, comportamento idêntico ao atual

Quando `extraUnsealPasswords` está ausente, é `undefined` ou é `[]`, nada muda: o payload selado, os cookies emitidos e o retorno das funções são os mesmos de hoje.

**Dado** a configuração `{ password: "B" }` (ou com `extraUnsealPasswords: []`),
**Quando** a suíte existente `test/session.test.ts` e `test/unit/iron-crypto.test.ts` rodam,
**Então** todos os testes passam sem alteração nas asserções existentes.

### RF-06 — Expiração vale também para senhas extras

As regras de `maxAge` e `idleTimeout` são aplicadas da mesma forma a uma sessão aberta por senha extra. Se a sessão está expirada, ela é rejeitada e não é resselada.

**Dado** uma sessão selada com `A`, criada há mais tempo que `maxAge`, e a configuração `{ password: "B", extraUnsealPasswords: ["A"], maxAge: 60 }`,
**Quando** `unsealSession` é chamado com o cookie,
**Então** a função lança `Error("Session expired!")`, e `getSession` devolve uma sessão nova, sem `data`, sem `Set-Cookie` de resselagem.

### RF-07 — Senha extra não correspondente se comporta como senha errada

Se nenhuma senha (nem `password`, nem extras) abre o selo, o comportamento é o de hoje para senha errada.

**Dado** uma sessão selada com `C`, e a configuração `{ password: "B", extraUnsealPasswords: ["A"] }`,
**Quando** `getSession` é chamado com esse cookie,
**Então** não há exceção, a sessão retornada é nova (`data` vazio, `id` novo), e `unsealSession` lança erro com o mesmo tipo de erro que lança hoje para senha errada.

### RF-08 — Fallback de selo legado vale para cada senha

Sessões seladas com 1 iteração PBKDF2 (fallback `legacySealFallback`, ainda suportado) são aceitas também quando seladas com uma senha extra.

**Dado** uma sessão legada selada com 1 iteração usando a senha `A`, e a configuração `{ password: "B", extraUnsealPasswords: ["A"] }` com `legacySealFallback` não definido,
**Quando** `getSession` é chamado com esse cookie,
**Então** a sessão é restaurada e resselada com `B`, como já acontece para senha única.

**Dado** a mesma sessão e a configuração com `legacySealFallback: false`,
**Quando** `getSession` é chamado,
**Então** a sessão é rejeitada (sessão nova), como acontece hoje para senha única com a opção desligada.

### RF-09 — Mesmo comportamento para o header de sessão

O cookie e o header de sessão (`sessionHeader`) são tratados igualmente. Uma sessão recebida pelo header e selada com senha extra é aberta; como sessões do header não são resseladas, não há `Set-Cookie` nesse caso.

**Dado** uma sessão selada com `A`, enviada no header `x-h3-session`, e a configuração `{ password: "B", extraUnsealPasswords: ["A"] }`,
**Quando** `getSession` é chamado,
**Então** a sessão é restaurada e nenhum `Set-Cookie` é emitido.

### RF-10 — Nenhum nome público novo além do campo

A única mudança de API pública é o campo `extraUnsealPasswords` em `SessionConfig`. `src/index.ts` não ganha exports novos.

**Dado** a lista de exports públicos de `src/index.ts` antes da mudança,
**Quando** a mudança é aplicada,
**Então** a lista é idêntica, e `test/unit/package.test.ts` continua passando.

### RF-11 — Testes nos dois alvos de runtime

Os testes novos usam `describeMatrix` (ou `setupWebTest`/`setupNodeTest`), para rodar em `web` e `node`.

**Dado** os testes novos em `test/session.test.ts` (ou arquivo irmão de sessão),
**Quando** `pnpm vitest run test/session.test.ts` é executado,
**Então** todos os casos passam nos dois alvos (`web` e `node`), e cada RF acima tem pelo menos um teste correspondente. Pelo menos um teste de regressão falha antes da mudança (procedimento de `AGENTS.md`, "Bug Fix Workflow").

### RF-12 — Qualidade do projeto

**Dado** a branch com a mudança,
**Quando** `pnpm lint` e `pnpm typecheck` são executados,
**Então** ambos terminam sem erro, e o código novo segue o estilo existente (ESM, imports com `.ts`, `oxfmt`).

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue).
- Helper ou CLI para rotação de segredos, ou script para reselar sessões armazenadas fora do cookie.
- Mudança no formato do selo (iron) ou troca de algoritmo.
- Remoção do `legacySealFallback` (isso fica para v3, conforme o TODO já existente).
- Validação de força mínima das senhas extras além da que o iron já faz (ver premissas).
- Documentação no site de docs; aqui vale apenas o JSDoc do campo.
- Quebrar `src/utils/session.ts` em arquivos menores (já tem ~465 linhas, mas a divisão é outra tarefa).
- Qualquer mudança em `h3/rules`, `ocache` ou `crossws`.

## Premissas

- A senha extra é tratada como string, igual a `password`. Cada candidata é passada ao `unseal` como string, então não é preciso mapear ids de senha.
- O `iron` já impõe o tamanho mínimo de 32 caracteres. Uma senha extra vazia ou curta falha no `unseal` e cai no caminho de "senha errada" (RF-07). Não será criada validação nova no construtor de config.
- A resselagem da RF-04 é uma decisão de produto tomada aqui: o objetivo da rotação é que as sessões migrem. Se o time preferir que a leitura nunca escreva cookie por causa de senha extra, a RF-04 deve ser removida e a sessão continua aberta com a senha antiga até expirar.
- Mantém-se a ordem atual de checagens: o fallback legado é tentado para cada senha, e as checagens de expiração (`maxAge`/`idleTimeout`) são feitas sobre o resultado da primeira senha que abriu o selo. Uma sessão expirada não é reaberta com outra senha.
- Todas as runtimes suportadas (Node, Bun, Deno, Workers) já usam o mesmo código de selo, então não há caminho específico de runtime.

## Riscos

- **Custo de CPU sob cookies inválidos.** Cada cookie que nenhuma senha abre custa (1 + número de extras) × tentativas de PBKDF2, e com o fallback legado o número de tentativas dobra. Um cliente pode forçar esse custo com cookies forjados. Mitigação proposta: documentar que a lista deve ser curta e removida quando a última sessão com a senha antiga expirar. Limite rígido no código fica como questão em aberto.
- **Senha antiga viva por mais tempo que o necessário.** Se alguém deixa a senha antiga em `extraUnsealPasswords` sem prazo, o segredo antigo continua valendo. A doc do campo precisa dizer isso.
- **Divergência de comportamento entre cookie e header.** Sessões do header não são resseladas (RF-09), então elas continuam com a senha antiga até expirar. Isso deve estar explícito na documentação.
- **Regressão em sessões existentes.** A mudança toca o caminho de leitura de todas as sessões. A proteção é a RF-05 (suíte existente sem alteração de asserções) e um teste de regressão escrito antes do código, conforme o procedimento do projeto.

## Questões em aberto

1. A RF-04 (migração na leitura) entra nesta versão? Recomendação: sim.
2. Há limite máximo para `extraUnsealPasswords`? Recomendação: documentar um limite sugerido, sem validação rígida, até medir o custo real.
