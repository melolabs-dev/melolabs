# Tarefas de implementação: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (decisões D-01 a D-10, riscos R-01 a R-08).

Ordem sugerida: T-01 e T-02 em paralelo; depois T-03 e T-04; depois T-05; testes T-06 a T-08; por fim T-09.

Premissa corrigida pela techspec (§1, achado 1): `minPasswordlength` não está em `SessionConfig`. Está em `SealOptions` (`src/utils/internal/iron-crypto.ts`), e o valor efetivo vem de `encryption.minPasswordlength` após o merge de opções. Não criar campo público novo (RF-09).

---

### T-01 — Adicionar `extraUnsealPasswords` em `SessionConfig`

Cobre: RF-01, RF-09
Depende de: nenhuma
Aceite: `SessionConfig` tem `extraUnsealPasswords?: string[]` com o JSDoc da techspec §4 (somente abertura, nunca selagem; lista curta por causa do custo de CPU; leituras com senha extra geram `Set-Cookie`). `password` continua `string`. Nenhum export público novo além do campo. `pnpm typecheck` passa.
Arquivos: `src/utils/session.ts`

### T-02 — Criar o símbolo interno `kUnsealedWithExtra`

Cobre: RF-05
Depende de: nenhuma
Aceite: `src/utils/internal/session.ts` exporta `kUnsealedWithExtra`, definido como `Symbol.for("h3.internal.session.unsealed-with-extra")`, no mesmo padrão de `kLegacySeal`. O símbolo não aparece em `src/index.ts`. `pnpm typecheck` passa.
Arquivos: `src/utils/internal/session.ts`

### T-03 — Validar senhas extras antes de qualquer selagem

Cobre: RF-06, RF-02
Depende de: T-01
Aceite:
- Helper `resolveSealOptions(config)` (techspec §4) faz o mesmo merge de hoje (`sealDefaults`, `ttl`, `config.seal`). `sealSession` passa a usá-lo.
- `assertSealPasswords(config)` lança erro para extra vazia e para extra com menos de `encryption.minPasswordlength` caracteres. A mensagem contém "password" em minúsculas, o índice da senha, e nunca o valor (D-05).
- A validação usa o mínimo resolvido (D-06), não um valor fixo.
- `assertSealPasswords` é chamada no início de `sealSession` e no início de `updateSession`, antes do `if` que checa `config.cookie` e `event.res`. Assim `useSession` na criação também rejeita (D-04).
- `seal` continua recebendo só `config.password`. Nenhuma extra é usada para selar.
- Erros de `password` inválida continuam vindo de `generateKey`, como hoje.
Arquivos: `src/utils/session.ts`

### T-04 — Abrir sessões tentando `password` e depois as extras

Cobre: RF-03, RF-04, RF-07, RF-08
Depende de: T-01, T-02
Aceite:
- `unsealSession` tenta `[config.password, ...(config.extraUnsealPasswords ?? [])]` em ordem e para na primeira que abrir (D-09). Se nenhuma abrir, lança o erro da primeira tentativa.
- Campo ausente e `[]` seguem o caminho atual, sem marcador e com o mesmo erro (D-07).
- Fallback legado aplicado por senha, na ordem (i) de D-02: para cada senha, iterações atuais e depois a de 1 iteração. Não há duas passadas.
- `legacySealFallback: false` desliga o fallback para todas as senhas.
- Abertura com extra (índice maior que zero) marca `kUnsealedWithExtra = true` no objeto retornado.
- Checagens de `maxAge` e `idleTimeout` são feitas uma vez, depois do laço (D-09).
- Sessão com senha desconhecida faz `unsealSession` lançar. `getSession` continua capturando o erro e devolve sessão nova e vazia, como hoje (RF-04).
- Assinatura pública de `unsealSession` não muda.
Arquivos: `src/utils/session.ts`

### T-05 — Re-selar em `getSession` quando a sessão abriu com extra

Cobre: RF-05
Depende de: T-02, T-04
Aceite:
- `getSession` lê `kUnsealedWithExtra` e o remove do objeto antes de `Object.assign` (R-06).
- A condição de re-selagem inclui a abertura com extra. Ela fica junto de `legacySeal` e `shouldSlide`, como na techspec §4.
- Sessão vinda do cabeçalho de sessão não é re-selada por esse motivo.
- Sessão aberta com `password` não gera novo `Set-Cookie` por esse motivo.
- Sessão retornada não tem o símbolo marcador (`Object.getOwnPropertySymbols` não o contém).
Arquivos: `src/utils/session.ts`

### T-06 — Testes de selagem e validação

Cobre: RF-02, RF-06
Depende de: T-03
Aceite: em `test/session.test.ts`, com `describeMatrix`:
- Com `password = P1` e `extraUnsealPasswords = [P0]`, o cookie de `useSession` (criação), `updateSession` e `sealSession` abre com `P1` e não abre só com `P0`.
- Extra vazia, extra de 10 caracteres e extra inválida na segunda posição: `updateSession`, `sealSession` e `useSession` (criação) rejeitam. Testar também sem cookie. A mensagem contém "password" e não contém o valor da senha.
- Com `seal.encryption.minPasswordlength` maior, uma extra antes válida passa a ser rejeitada (D-06).
- Regressão: `password` inválida mantém a mensagem atual.
Arquivos: `test/session.test.ts`

### T-07 — Testes de abertura, rotação e expiração

Cobre: RF-03, RF-04, RF-05
Depende de: T-04, T-05
Aceite: em `test/session.test.ts`:
- Sessão selada com `P0`, em `extraUnsealPasswords = [P9, P0]`, abre com `getSession`. `id`, `createdAt` e dados são preservados. A ordem de tentativas é `password`, `P9`, `P0`. Se spy em módulo ESM não for viável, verificar a ordem pelo efeito observável (qual senha abriu) e registrar a alternativa no teste.
- Sessão selada com `password` não tenta nenhuma extra.
- Sessão com senha fora da configuração: `getSession` não lança, e a sessão é nova e vazia.
- `useSession` com cookie selado por `P0`: a resposta traz `Set-Cookie` com sessão selada por `P1`, com `id`, `createdAt` e dados preservados.
- Cookie selado com `password`: nenhum `Set-Cookie` por esse motivo.
- Sessão vinda do cabeçalho de sessão aberta com extra: nenhum `Set-Cookie` de re-selagem.
- Sessão aberta com extra e expirada (`maxAge`): lança "Session expired!" e vira sessão nova, sem tentar senhas seguintes (D-09).
Arquivos: `test/session.test.ts`

### T-08 — Testes de formatos de cookie e legado

Cobre: RF-07, RF-08
Depende de: T-04, T-05
Aceite: em `test/session.test.ts`:
- Sessão selada com extra em cookie dividido em chunks (cookie grande, como em `test/session.test.ts:656`): `getSession` e `unsealSession` abrem com `id`, `createdAt` e dados preservados.
- Sessão selada com extra pelo cabeçalho de sessão: `getSession` abre sem re-selagem.
- `clearSession` com sessão selada com extra: não lança e envia os cookies de expiração.
- Sessão legada (1 iteração de PBKDF2) selada com `P0`, com `legacySealFallback` ativo: aberta, re-selada com `P1` e opções atuais, com novo `Set-Cookie`. Seguir o padrão de `test/session.test.ts:134-159`.
- Mesma sessão legada com `legacySealFallback: false`: sessão nova e vazia. Seguir `test/session.test.ts:161-186`.
Arquivos: `test/session.test.ts`

### T-09 — Verificação de compatibilidade, lint e exports

Cobre: RF-01, RF-09
Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08
Aceite:
- Teste novo: sem `extraUnsealPasswords` e com `[]` produzem a mesma resposta, com o mesmo número de `Set-Cookie` (RF-01).
- `pnpm vitest run test/session.test.ts` e `pnpm vitest run test/unit/iron-crypto.test.ts` passam. A suíte existente não tem expectativas alteradas; só há adições.
- `pnpm test` (lint, typecheck e coverage) passa.
- Lista de exports públicos de `h3` antes e depois da mudança: a única diferença é o campo `extraUnsealPasswords` em `SessionConfig`.
Arquivos: `test/session.test.ts`, `src/index.ts` (somente leitura, para conferir os exports)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-09 |
| RF-02 | T-03, T-06 |
| RF-03 | T-04, T-07 |
| RF-04 | T-04, T-07 |
| RF-05 | T-02, T-05, T-07 |
| RF-06 | T-03, T-06 |
| RF-07 | T-04, T-08 |
| RF-08 | T-04, T-08 |
| RF-09 | T-01, T-09 |
