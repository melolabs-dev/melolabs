# Tarefas de implementação — Várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-10), `sdd/techspec.md` (D-01 a D-07, §3 e §5).

Ordem de trabalho: os testes vêm antes da implementação (AGENTS.md, "Bug Fix Workflow"). As tarefas T-01 a T-04 escrevem os testes e devem falhar antes das tarefas de implementação. Os padrões de decisão da techspec são usados como estão (D-03 reselar ao abrir com extra; D-04 validação na primeira chamada). As duas decisões seguem pendentes de confirmação do usuário (techspec §7).

### T-01 — Testes de abertura com senhas extras

**Cobre:** RF-01, RF-03, RF-04, RF-08

Escrever em `test/session.test.ts`, dentro de `describeMatrix`, os casos:

- sessão selada com `A` lida com `password: "B"` e `extraUnsealPasswords: ["A"]`, com `data` preservado;
- `password: "B"`, `extraUnsealPasswords: ["A", "C"]`, cookie selado com `C`: sucesso;
- sessão legada (iteração 1, via `seal` direto) selada com `A`, lida com `{ B, [A] }`: abre e o cookie resultante abre com `B` nas iterações atuais.

Os testes devem falhar antes da implementação.

**Depende de:** nenhuma

**Arquivos:** `test/session.test.ts`

**Aceite:** `pnpm vitest run test/session.test.ts -t "extra"` executa os casos novos, que falham antes de T-05 a T-08 e passam depois, nos alvos `web` e `node`.

### T-02 — Testes de reselagem com `password`

**Cobre:** RF-02

Escrever em `test/session.test.ts`:

- sessão aberta por senha extra é reselada: o cookie resultante abre com `B` (`unseal(..., B)` sucede) e não abre com `A` (`unseal(..., A)` falha). Ler sem `idleTimeout` e sem legado, para que só a rotação cause o `Set-Cookie`;
- a sessão reselada não expõe o símbolo interno `kRotatedSeal` no `session.data` nem em `Object.assign` do resultado.

**Depende de:** nenhuma

**Arquivos:** `test/session.test.ts`

**Aceite:** os casos falham antes de T-06 e T-09 e passam depois, nos dois alvos.

### T-03 — Testes de falha com todas as senhas e de validação

**Cobre:** RF-05, RF-07, RF-08

Escrever em `test/session.test.ts`:

- cookie selado com `Z` (não configurada), com `password: "B"` e `extraUnsealPasswords: ["A"]`: `getSession` devolve `data` vazio, não lança exceção no handler, e o `id` da sessão é diferente do `id` do cookie recebido (correção de RF-05 pela techspec D-07). Não deve haver `errors` no contexto de teste;
- `unsealSession({} as HTTPEvent, cfg, sealed)` com `extraUnsealPasswords: [""]` e com um item curto: `rejects.toThrow(/extraUnsealPasswords/)`.

**Depende de:** nenhuma

**Arquivos:** `test/session.test.ts`

**Aceite:** os casos de falha e de validação existem e falham antes de T-07 e T-08; depois passam nos dois alvos.

### T-04 — Testes de retrocompatibilidade e de custo com cookie inválido

**Cobre:** RF-06, RF-08

Escrever em `test/session.test.ts`:

- `extraUnsealPasswords: []` produz o mesmo resultado que omitir o campo (leitura e `Set-Cookie` iguais);
- custo com cookie inválido: espionar `crypto.subtle.deriveBits` (padrão de `test/session.test.ts:722-736`). Com `extraUnsealPasswords` de tamanho N e cookie `Z`, esperar `2 * (1 + N)` chamadas com `legacySealFallback` ligado e `1 + N` com `legacySealFallback: false`.

Não alterar as asserções das 58 sessões existentes.

**Depende de:** nenhuma

**Arquivos:** `test/session.test.ts`

**Aceite:** a suíte existente sem alteração de asserções continua passando; os casos novos de custo passam após T-08 com N = 1, 3 e 5 (techspec §6, item 3).

### T-05 — Campo `extraUnsealPasswords` e JSDoc em `SessionConfig`

**Cobre:** RF-01, RF-09, RF-10

Em `src/utils/session.ts`, após `password` (`:48`), adicionar `extraUnsealPasswords?: string[]` com o JSDoc da techspec §4: senhas só para abrir, ordem `password` e depois as extras, reselagem com `password`, remoção invalida sessões que dependem da senha, procedimento de rotação.

Confirmar que `useSession` e `getSession` recebem o campo sem mudança de assinatura (PRD, Fora de escopo).

**Depende de:** nenhuma

**Arquivos:** `src/utils/session.ts`

**Aceite:** `pnpm typecheck` passa; passar o cursor sobre `extraUnsealPasswords` mostra o JSDoc; os testes de T-01 deixam de falhar por erro de tipo (passam a falhar só por comportamento).

### T-06 — Símbolo interno `kRotatedSeal`

**Cobre:** RF-02

Em `src/utils/internal/session.ts`, junto de `kLegacySeal` (`:7-9`), adicionar:

```ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.rotated-seal");
```

**Depende de:** nenhuma

**Arquivos:** `src/utils/internal/session.ts`

**Aceite:** `pnpm typecheck` passa; o símbolo é importado apenas por `src/utils/session.ts`.

### T-07 — Helpers `resolveSealOptions` e `assertExtraUnsealPasswords`

**Cobre:** RF-07

No fim de `src/utils/session.ts`, criar as funções internas:

- `resolveSealOptions(config)`: extrai a expressão `{ ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal }` que hoje se repete em `:300-304` e `:317-321`; substituir as duas cópias por chamadas a ela (D-06);
- `assertExtraUnsealPasswords(config, sealOptions)`: para cada item, lançar `Error` com a mensagem `Invalid extraUnsealPasswords[i]: each password must be a string of at least N characters` quando não for string ou tiver `length < max(encryption.minPasswordlength, integrity.minPasswordlength)`. Chamada no início de `getSession`, antes de `:158` e fora da cadeia `.catch` de `:197` (D-04).

Não alterar `src/utils/internal/iron-crypto.ts`.

**Depende de:** T-05

**Arquivos:** `src/utils/session.ts`

**Aceite:** os casos de validação de T-03 passam nos dois alvos; `pnpm vitest run test/session.test.ts` mantém os 58 testes existentes passando.

### T-08 — Laço de senhas em `unsealSession` e `unsealWithFallback`

**Cobre:** RF-03, RF-04, RF-05

Reescrever o `try/catch` de `unsealSession` (`src/utils/session.ts:312-348`) conforme a techspec §4 e D-01:

- `passwords = [config.password, ...(config.extraUnsealPasswords ?? [])]`, tentadas na ordem declarada;
- somente `isBadHmac(error)` (`error instanceof Error && error.message === "Bad hmac value"`) avança para a próxima senha; qualquer outro erro é relançado;
- quando todas falham, lançar o erro da primeira tentativa (`firstError ??= error`);
- usar a flag `opened`, não `unsealed`, porque `unseal` pode devolver `null` (`src/utils/internal/iron-crypto.ts:149`).

Extrair `unsealWithFallback(sealed, password, sealOptions, legacySealFallback)` (D-02): para cada senha tenta a iteração completa e, em `Bad hmac value` com o fallback ativo, a iteração 1 com a mesma senha, marcando `kLegacySeal` nesse caso. O fallback legado atual (`:326-346`) passa a usar essa função.

Chamar `assertExtraUnsealPasswords` no início de `unsealSession`.

**Depende de:** T-05, T-07

**Arquivos:** `src/utils/session.ts`

**Aceite:** T-01 (RF-01, RF-03, RF-04), a parte de falha de T-03 (RF-05) e T-04 (custo) passam nos dois alvos; os testes existentes de legado e de `legacySealFallback: false` continuam passando sem alteração.

### T-09 — Reselagem em `getSession` ao abrir com senha extra

**Cobre:** RF-02

Em `getSession` (`src/utils/session.ts:199-214`):

- ler `kRotatedSeal` de `unsealed` e removê-lo com `delete`, antes de `Object.assign(session, unsealed)` (`:208`), porque `Object.assign` copia símbolos próprios;
- incluir `rotatedSeal` na condição que chama `updateSession` (`:214`), junto de `legacySeal` e `shouldSlide`.

A sessão enviada pelo header de sessão não é reselada (techspec §6, riscos residuais); o teste de header de T-10 cobre isso.

**Depende de:** T-06, T-08

**Arquivos:** `src/utils/session.ts`

**Aceite:** T-02 passa nos dois alvos; o caminho sem extras não emite `Set-Cookie` novo (suíte existente passa).

### T-10 — Testes de header de sessão, cookie em partes e exports públicos

**Cobre:** RF-09, RF-08

Escrever em `test/session.test.ts`:

- sessão `A` enviada no header `x-h3-test-session`, lida com `{B, [A]}`: `data` preservado e sem `Set-Cookie`;
- sessão grande selada com `A`, lida com `{B, [A]}`: o cookie resultante, em partes (chunked), abre com `B`.

Comparar os exports de `src/index.ts` e `src/utils/session.ts` antes e depois da mudança (`git diff`): a única adição de API pública é a propriedade `extraUnsealPasswords` em `SessionConfig` (RF-09). Nenhuma função nova é exportada; `resolveSealOptions`, `assertExtraUnsealPasswords`, `unsealWithFallback` e `isBadHmac` ficam sem `export`.

**Depende de:** T-09

**Arquivos:** `test/session.test.ts`, `src/utils/session.ts`

**Aceite:** os dois casos novos passam nos alvos `web` e `node`; `pnpm vitest run test/unit/` passa; o diff de exports mostra só `extraUnsealPasswords`.

### T-11 — Verificação final

**Cobre:** RF-06, RF-08, RF-09

Executar, nesta ordem:

1. `pnpm vitest run test/session.test.ts` (58 existentes sem alteração de asserções, mais os novos, nos alvos `web` e `node`);
2. `pnpm vitest run test/unit/`;
3. `pnpm typecheck`;
4. `pnpm lint` (oxlint + oxfmt);
5. `pnpm test` (suíte completa com cobertura), para checar regressões fora de sessões.

Registrar o resultado de cada comando. Se algum falhar, reportar a saída; não alterar asserções existentes para passar.

**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10

**Arquivos:** nenhum arquivo do projeto (apenas execução de comandos)

**Aceite:** todos os comandos passam; a medição de custo de T-04 com N = 1, 3 e 5 é registrada (techspec §6, item 3).
