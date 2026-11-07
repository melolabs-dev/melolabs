# Tarefas de implementação — Múltiplas senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (decisões D-01 a D-08, estratégia de testes e riscos R-01 a R-11).

Ordem: as tarefas T-01 e T-02 vêm antes de qualquer mudança em `src/`, seguindo o *Bug Fix Workflow* de `AGENTS.md`. Os casos de T-02 precisam estar falhando antes de T-03 começar.

---

### T-01 — Adaptar os usos diretos de `password` em `test/session.test.ts`

**Cobre:** RF-07

**Depende de:** nenhuma

**Descrição:**
- Extrair `const password = "..."` no bloco de configuração (`test/session.test.ts:21-25`) e usar `sessionConfig = { password, ... }`.
- Trocar `sessionConfig.password` por `password` nas chamadas diretas a `seal`/`unseal` (`:137`, `:157`, `:164`), porque essas funções continuam aceitando só `string`.
- Não alterar nenhuma verificação (`expect`) dos testes existentes.

**Aceite:**
- `pnpm vitest run test/session.test.ts` passa.
- O diff de `test/session.test.ts` contém apenas a troca de origem da senha; nenhuma linha de `expect` muda.

**Arquivos:** `test/session.test.ts`

---

### T-02 — Escrever os casos de RF-01 a RF-08 antes da implementação

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

**Depende de:** nenhuma

**Descrição:**
- Criar `test/session-rotation.test.ts` com `describeMatrix` (web e node), seguindo o padrão `ctx.app` / `ctx.fetch` de `AGENTS.md`.
- Implementar os casos 1 a 10 da seção "Estratégia de testes" da techspec, incluindo:
  - ordem invertida `[antiga, nova]` (protege contra R-01);
  - leitura de sessão antiga por header, sem `Set-Cookie` (D-05);
  - `legacySealFallback: false` com lista rejeitando cookie legado (item 8);
  - `password: 42` (JS) falhando com "missing or invalid";
  - `password: "x"` e `password: ["x"]` com o mesmo resultado (RF-07).
- Os cookies de teste são gerados com `seal`/`useSession` usando as senhas indicadas, incluindo cookie com iterações legadas para RF-08.

**Aceite:**
- `pnpm vitest run test/session-rotation.test.ts` executa.
- Antes de qualquer mudança em `src/`, os casos de RF-01 a RF-06 e RF-08 que dependem de comportamento novo falham. A saída da falha é registrada (quais casos e com qual erro) para comparar depois.
- Os casos de RF-07 com senha única passam.

**Arquivos:** `test/session-rotation.test.ts`

---

### T-03 — Extrair `assertPasswordLength` de `generateKey`

**Cobre:** RF-06

**Depende de:** T-02

**Descrição:**
- Em `src/utils/internal/iron-crypto.ts`, extrair a verificação de tamanho mínimo de `generateKey` (`:191-196`) para uma função interna exportada `assertPasswordLength(password: string, minLength: number): void`.
- `generateKey` passa a chamar essa função. A mensagem de erro não muda.
- A API pública de `iron-crypto` não muda; o módulo é interno (PRD, Fora de escopo).

**Aceite:**
- Os testes existentes de tamanho mínimo de senha continuam passando.
- `pnpm vitest run test/unit/` passa sem mudança.

**Arquivos:** `src/utils/internal/iron-crypto.ts`

---

### T-04 — Tipo `string | string[]`, helper `resolvePasswords` e selagem com a primeira senha

**Cobre:** RF-01, RF-02, RF-06

**Depende de:** T-02, T-03

**Descrição:**
- Em `src/utils/session.ts:40-48`, mudar `SessionConfig.password` para `string | string[]` e atualizar o JSDoc conforme D-08. O JSDoc deve cobrir:
  - a ordem da lista, em que a primeira senha sela e as demais só abrem;
  - que a senha antiga não tem prazo, e que a remoção é decisão operacional (R-08);
  - que cada item acrescenta até duas derivações PBKDF2 por cookie inválido, e que a lista deve ser curta (D-07).
- Criar a função interna `resolvePasswords(config): string[]` no fim de `src/utils/session.ts` (D-02):
  - `Array.isArray` decide entre lista e item único;
  - lista vazia, `undefined` ou item não-string lança `Session password is missing or invalid`;
  - item `""` lança `Empty password`;
  - item curto chama `assertPasswordLength` com o mínimo de `{ ...sealDefaults, ...config.seal }`.
- `sealSession` (`:300`) usa `resolvePasswords(config)[0]`.
- Em `unsealSession` (`:312-348`), a leitura ainda usa só a primeira senha por enquanto, via `resolvePasswords(config)[0]`. A tarefa T-05 troca isso pelo laço.

**Aceite:**
- Em `test/session-rotation.test.ts`, os casos de RF-01 e RF-02 passam (inclusive a ordem invertida), e os casos de RF-06 de selagem passam (`[]`, `[nova, ""]`, `[nova, "curta"]`, `42`).
- Os casos de RF-03, RF-04, RF-05 e RF-08 continuam falhando; isso é esperado até T-05 e T-06.
- `pnpm typecheck` passa.

**Arquivos:** `src/utils/session.ts`

---

### T-05 — `unsealSession` tenta cada senha em ordem, com o fallback legado dentro de cada tentativa

**Cobre:** RF-03, RF-04, RF-08

**Depende de:** T-04

**Descrição:**
- Criar o símbolo interno `kRotatedSeal` em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal` (`:7-9`), com `Symbol.for("h3.internal.session.rotated-seal")`.
- Em `unsealSession`, substituir a senha única por um laço sobre `resolvePasswords(config)` (D-03):
  - para cada senha, tentar modo normal e, se falhar com `"Bad hmac value"` e o legado estiver habilitado, tentar o modo legado com 1 iteração;
  - só `"Bad hmac value"` avança para a próxima senha. Qualquer outro erro é propagado imediatamente (R-07);
  - ao abrir com índice maior que zero, marcar `kRotatedSeal`;
  - ao abrir pelo legado, marcar `kLegacySeal`, como hoje;
  - se nenhuma senha abrir, lançar o último `"Bad hmac value"`.
- A verificação de expiração e de `idleTimeout` (`:350-365`) continua depois do laço, sem mudança.
- A assinatura de `unsealSession` não muda (`src/index.ts:209`).

**Aceite:**
- RF-03: cookie selado com a senha antiga abre com `[nova, antiga]`.
- RF-04: cookie com senha desconhecida faz `unsealSession` lançar `"Bad hmac value"`.
- RF-08: cookie legado selado com a senha antiga abre com `[nova, antiga]` e é marcado como legado; com `legacySealFallback: false`, o mesmo cookie é rejeitado.
- Erro `"Expired seal"` com lista é propagado sem tentar a segunda senha (item 10 da techspec).

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-06 — `getSession` valida a configuração e regrava sessões abertas com senha não primária

**Cobre:** RF-05, RF-06

**Depende de:** T-05

**Descrição:**
- Chamar `resolvePasswords(config)` no início de `getSession`, antes de `context.sessions` (`src/utils/session.ts:149-155`). Esse erro não passa pelo `.catch` que engole falhas de `unsealSession` (D-06).
- Ler `kRotatedSeal` do resultado de `unsealSession` e apagá-lo antes do `Object.assign`, da mesma forma que `kLegacySeal` (`:199-201`), para não vazar para a sessão viva (R-04).
- Mudar a condição de regravação para `session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))` (`:214-216`). A regravação usa a primeira senha, porque `sealSession` já faz isso.
- Sessões lidas por header não são regravadas nessa etapa (D-05).

**Aceite:**
- RF-05: cookie selado com a senha antiga, lido com `[nova, antiga]`, gera `Set-Cookie`; o novo cookie abre com `nova` sozinha.
- RF-05: sessão antiga lida por header não gera `Set-Cookie`.
- RF-04 via `getSession`: devolve sessão nova (id diferente, dados vazios), sem erro.
- RF-06 via leitura: `[]` lança mesmo sem cookie; `[nova, ""]` lança `Empty password` mesmo com cookie que abre com `nova`.
- Nenhum símbolo `kRotatedSeal` aparece em `session.data` ou no objeto de sessão retornado.

**Arquivos:** `src/utils/session.ts`

---

### T-07 — Testes de custo e de propagação de erro

**Cobre:** RF-02, RF-04

**Depende de:** T-06

**Descrição:**
- Em `test/session-rotation.test.ts`, adicionar o teste de regressão de contagem de derivações, no modelo de `test/session.test.ts:722-735`: uma selagem com lista de 2 senhas faz exatamente 2 `deriveBits` (R-11).
- Adicionar o teste de propagação do item 10, se ainda não estiver coberto em T-05.
- Opcional: criar `test/bench/session.ts` com cookie inválido e listas de 1 e 3 senhas, para registrar o custo citado no D-07 (R-02). Não bloqueia a entrega.

**Aceite:**
- O teste de contagem de derivações passa e falharia se a selagem fizesse trabalho extra.
- Se o bench for criado, `pnpm bench:node` executa o arquivo sem erro e o resultado é anotado no PR.

**Arquivos:** `test/session-rotation.test.ts`, `test/bench/session.ts` (novo, opcional)

---

### T-08 — Verificação final e compatibilidade

**Cobre:** RF-07

**Depende de:** T-01, T-06, T-07

**Descrição:**
- Rodar a suíte completa e confirmar que `test/session.test.ts` passa sem mudança nas verificações (RF-07).
- Confirmar que nenhum export novo foi adicionado: `test/unit/package.test.ts` (`:125`, `:149`) passa sem mudança.
- Confirmar que `password: "x"` e `password: ["x"]` têm o mesmo comportamento (RF-07, caso 7).
- Se o projeto mantiver changelog, registrar que a mudança de tipo é compatível para quem entra com string, mas não para quem lê `config.password` como string (R-06). Se não houver changelog, anotar isso no PR.
- Revisar o JSDoc de `password` contra D-08 e R-08.

**Aceite:**
- `pnpm lint` passa.
- `pnpm typecheck` passa.
- `pnpm test` passa (lint, typecheck e cobertura).
- `pnpm vitest run test/unit/` passa.
- Nenhum teste existente teve `expect` alterado (comparar com o diff de T-01).

**Arquivos:** nenhum (verificação; ajustes de changelog ou JSDoc, se houver, entram nos arquivos de T-04)
