# Tarefas — Múltiplas senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-08, R-01 a R-06) e `sdd/techspec.md` (D-01 a D-07).

Ordem seguindo o fluxo de bug fix do AGENTS.md: primeiro o teste que falha, depois a implementação mínima. Tarefas que tocam o mesmo arquivo são sequenciais.

Mapa de cobertura:

| RF | Tarefas |
| --- | --- |
| RF-01 | T-02, T-09 |
| RF-02 | T-03, T-11 |
| RF-03 | T-03, T-10 |
| RF-04 | T-04, T-10 |
| RF-05 | T-03, T-11 |
| RF-06 | T-01, T-12 |
| RF-07 | T-03, T-10 |
| RF-08 | T-05, T-06, T-07, T-09 |

---

### T-01 — Confirmar a linha de base

**Cobre:** RF-06
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` e `pnpm vitest run test/unit/` passam sem nenhuma alteração no código. O resultado é registrado no PR. Se houver falha antes de qualquer mudança, parar e reportar.
**Arquivos:** nenhum (somente leitura)

---

### T-02 — Teste de tipo do campo `extraUnsealPasswords`

**Cobre:** RF-01
**Depende de:** T-01
**Aceite:** Verificar primeiro se `test/unit/types.test-d.ts` cobre `SessionConfig`. Se cobrir, adicionar asserção de que `extraUnsealPasswords` é opcional, do tipo `string[]`, e que `password` continua `string`. Se não cobrir, adicionar o caso no padrão existente do arquivo. O teste deve falhar agora, porque o campo ainda não existe. `pnpm typecheck` (ou `pnpm vitest run test/unit/`) mostra a falha.
**Arquivos:** `test/unit/types.test-d.ts`

---

### T-03 — Testes de integração de selagem e leitura

**Cobre:** RF-02, RF-03, RF-05, RF-07
**Depende de:** T-01
**Aceite:** Em `test/session.test.ts`, dentro de `describeMatrix` (roda em web e node), escrever os casos:
1. Cookie selado com `"senha-antiga"`, configuração com nova `password` e `extraUnsealPasswords: ["senha-antiga"]`. A leitura retorna `session.id` e `data` do cookie, sem `id` novo (RF-03).
2. Mesmo cenário sem `idleTimeout`. A resposta tem `Set-Cookie` cujo valor abre com `"senha-nova"` e não abre com `"senha-antiga"` (RF-05).
3. Sessão nova com extras configuradas. O cookie abre com `password` e falha com cada extra (RF-02).
4. Cookie selado com senha fora da lista. A leitura devolve sessão vazia, `session.id` diferente do cookie, sem `Set-Cookie`, sem exceção, e o corpo da resposta não contém nenhuma senha (RF-07).
5. `password` repetida em `extraUnsealPasswords`: a sessão abre normalmente (D-06).

Rodar antes da implementação e confirmar que os casos 1, 2, 3 e 5 falham pelo motivo esperado (campo ausente ou sem reselo). O caso 4 pode já passar, e isso é aceitável, desde que continue passando depois.
**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes de integração do caminho legado

**Cobre:** RF-04
**Depende de:** T-03
**Aceite:** Em `test/session.test.ts`, adicionar caso com selo de 1 iteração (legado) feito com a senha antiga. Com `password` nova e a antiga em `extraUnsealPasswords`, a leitura retorna os dados e há reselo com `password`. Confirmar que falha antes da implementação.
**Arquivos:** `test/session.test.ts`

---

### T-05 — Teste unitário de `assertPasswordLength`

**Cobre:** RF-08
**Depende de:** T-01
**Aceite:** Em `test/unit/iron-crypto.test.ts`, perto dos testes de `generateKey()` (`:116-126`), escrever:
- `assertPasswordLength("curta", 32)` lança `Password string too short (min 32 characters required)`.
- `assertPasswordLength` com 32 caracteres não lança.

Confirmar que falha antes da implementação, porque a função ainda não existe.
**Arquivos:** `test/unit/iron-crypto.test.ts`

---

### T-06 — Testes de validação das extras em selagem e abertura

**Cobre:** RF-08
**Depende de:** T-03
**Aceite:** Em `test/session.test.ts`, com `extraUnsealPasswords: ["curta"]`:
- `sealSession` rejeita com a mesma mensagem que `password: "curta"`.
- `unsealSession` (exportada) rejeita com a mesma mensagem, mesmo quando a `password` é válida e o cookie abriria com ela.

Confirmar que falha antes da implementação. A comparação é feita contra a mensagem de `password` curta, sem repetir o texto no teste.
**Arquivos:** `test/session.test.ts`

---

### T-07 — Extrair `assertPasswordLength` de `generateKey`

**Cobre:** RF-08
**Depende de:** T-05
**Aceite:** Em `src/utils/internal/iron-crypto.ts`, a verificação de comprimento de `generateKey` (`:191-196`) vira a função exportada `assertPasswordLength(password, minLength)`, com a mesma mensagem, e `generateKey` passa a chamá-la. Usa `options.minPasswordlength` efetivo (P-04). O teste de T-05 passa, e os testes existentes de `generateKey` continuam verdes.
**Arquivos:** `src/utils/internal/iron-crypto.ts`

---

### T-08 — Símbolo interno `kExtraUnseal`

**Cobre:** RF-05
**Depende de:** T-01
**Aceite:** Em `src/utils/internal/session.ts`, junto de `kLegacySeal` (`:7-8`), acrescentar `kExtraUnseal = Symbol.for("h3.internal.session.extra-unseal")`, seguindo a convenção `k` do AGENTS.md. Nenhum export público novo em `src/index.ts`. `test/unit/package.test.ts` continua igual.
**Arquivos:** `src/utils/internal/session.ts`

---

### T-09 — Campo `extraUnsealPasswords`, deduplicação e validação eager

**Cobre:** RF-01, RF-08
**Depende de:** T-02, T-07
**Aceite:**
- Em `src/utils/session.ts`, `SessionConfig` ganha `extraUnsealPasswords?: string[]` logo após `password` (`:48`), com a documentação do contrato da techspec. A doc diz que a ordem declarada é prioridade, que duplicatas são ignoradas e que a sessão aberta com extra é resselada com `password`.
- Função interna `unsealPasswords(config)` devolve `[password, ...extras]` sem duplicatas, preservando a ordem da primeira ocorrência (D-06). Fica no final do arquivo.
- `sealSession` e `unsealSession` chamam `assertPasswordLength` para cada item antes de qualquer trabalho criptográfico (D-02).
- T-02 passa a verde. Os testes de T-06 passam. Os testes de T-03 continuam vermelhos, porque o reselo e a abertura por extra ainda não existem.
**Arquivos:** `src/utils/session.ts`

---

### T-10 — Duas passagens de abertura com a lista de senhas

**Cobre:** RF-03, RF-04, RF-07
**Depende de:** T-08, T-09, T-04
**Aceite:** Em `src/utils/session.ts`, `unsealSession` passa a:
1. Passagem normal: `unsealWithAny` tenta cada senha de `unsealPasswords(config)` em ordem. Só `Bad hmac value` avança para a próxima. Qualquer outro erro é relançado na hora (D-07).
2. Passagem legada, só se a passagem 1 falhar com `Bad hmac value` em todas, o fallback não estiver desabilitado e `iterations !== 1`: mesma lista, com opções de 1 iteração. Marca `kLegacySeal`.
3. Se a senha que abriu não é a primeira da lista, marca `kExtraUnseal` no objeto devolvido (D-04).

Se a lista se esgota, relança o último `Bad hmac value`, sem índice e sem senha (R-06). A assinatura pública de `unsealSession` não muda. Com lista de uma senha, a sequência de chamadas é igual à de hoje. Testes de T-03 (casos 1 e 4) e T-04 passam. Os testes existentes em `test/session.test.ts` passam sem alteração de asserções.
**Arquivos:** `src/utils/session.ts`

---

### T-11 — Reselo em `getSession` para sessões abertas com senha extra

**Cobre:** RF-02, RF-05
**Depende de:** T-10
**Aceite:**
- Antes da implementação, adicionar em `test/session.test.ts` um teste que verifica que `session` não tem símbolos próprios extras após a leitura (R-07). Confirmar que falha antes, se o símbolo estiver sendo copiado.
- Em `getSession` (`src/utils/session.ts:199-216`), ler `kExtraUnseal` junto de `kLegacySeal`, apagar os dois de `unsealed` antes do `Object.assign` (D-04), e incluir `extraSeal` na condição de reselo: `legacySeal || extraSeal || shouldSlide(session, config)` (D-05).
- Só cookies migram. Sessões lidas do header não são resseladas (R-08), e isso não muda.
- Teste 2 de T-03 passa. Os demais casos de T-03 passam. Nenhum símbolo interno aparece em `session`.
**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-12 — Verificação de regressão e fechamento

**Cobre:** RF-06
**Depende de:** T-04, T-06, T-11
**Aceite:**
- `pnpm vitest run test/session.test.ts` e `pnpm vitest run test/unit/` passam.
- `pnpm lint` passa (oxlint, oxfmt --check e typecheck).
- As asserções de `test/session.test.ts` que já existiam não foram alteradas. Conferir o diff desses trechos.
- `src/index.ts`, `test/unit/package.test.ts`, `CHANGELOG.md` e `docs/4.examples/handle-session.md` não foram alterados.
- `src/utils/session.ts` continua com menos de 500 linhas. A divisão do arquivo fica para outro PR (techspec).
**Arquivos:** nenhum (verificação)

---

### T-13 — Medição de custo de CPU (R-01)

**Cobre:** RF-06
**Depende de:** T-01, T-12
**Aceite:** Rodar `pnpm bench:node` antes da implementação (T-01) e depois (T-12), com um cookie inválido e N = 0, 1 e 3 extras. Os números vão para a descrição do PR. Se o custo com N = 3 for considerado alto, registrar a recomendação de limite máximo de extras para decisão do time. Não criar limite nesta entrega sem decisão.
**Arquivos:** nenhum (medição; o benchmark existente não é alterado)

---

### T-14 — Documentação do campo no código

**Cobre:** RF-01, RF-04
**Depende de:** T-12
**Aceite:** A documentação do campo em `SessionConfig` (T-09) cobre: ordem como prioridade, deduplicação, reselo com `password`, limite para sessões lidas do header (R-08) e a ressalva de que a senha antiga vale até expirar a sessão que não foi reselada (R-02). O guia de rotação em `docs/4.examples/handle-session.md` não entra aqui, conforme o PRD.
**Arquivos:** `src/utils/session.ts`
