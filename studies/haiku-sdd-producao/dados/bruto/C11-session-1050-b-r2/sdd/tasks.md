# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-07).

Ordem de execução: as tarefas de teste (T-01 a T-09) vêm antes das de implementação (T-10 a T-13), seguindo o *Bug Fix Workflow* do `AGENTS.md`: o teste precisa falhar antes da mudança. As linhas citadas em `src/utils/session.ts` vêm da techspec e devem ser conferidas antes de editar, porque podem ter mudado.

---

### T-01 — Linha de base da suíte existente

**Cobre:** RF-05
**Depende de:** nenhuma

Antes de qualquer mudança, rodar a suíte existente de sessão e os testes de contrato, para registrar que partem verdes. Nenhum arquivo é alterado nesta tarefa.

**Arquivos:** `test/session.test.ts`, `test/unit/package.test.ts`, `test/unit/iron-crypto.test.ts` (somente leitura)

**Aceite:** `pnpm vitest run test/session.test.ts test/unit/package.test.ts test/unit/iron-crypto.test.ts` termina sem falhas. O resultado é anotado na descrição da entrega.

---

### T-02 — Teste de tipo para `extraUnsealPasswords`

**Cobre:** RF-01
**Depende de:** nenhuma

Adicionar em `test/unit/types.test-d.ts` a verificação de que `SessionConfig["extraUnsealPasswords"]` é `string[] | undefined`, e que `useSession`, `getSession` e `updateSession` aceitam uma config com o campo. Antes da T-03, o typecheck deve falhar.

**Arquivos:** `test/unit/types.test-d.ts`

**Aceite:** `pnpm lint` (typecheck) acusa erro nesse teste antes da T-03. Esse erro é esperado e vira verde na T-03.

---

### T-03 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01
**Depende de:** T-02

Adicionar `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig`, com JSDoc dizendo que as senhas só abrem sessões, que são tentadas depois de `password` na ordem do array, e que `password` é a única usada para selar. Nenhum export novo.

**Arquivos:** `src/utils/session.ts`

**Aceite:** o teste de tipo da T-02 passa. `pnpm vitest run test/unit/package.test.ts` continua verde (snapshot de exports inalterado).

---

### T-04 — Testes de abertura, selagem e senha desconhecida

**Cobre:** RF-02, RF-03, RF-04, RF-10
**Depende de:** nenhuma

Criar `test/session-extra-passwords.test.ts` com `describeMatrix`, reutilizando a configuração de `test/session.test.ts:21-37` (`password` de 49 caracteres e `generateId` determinístico). Este arquivo é a base das tarefas T-05 a T-09, que acrescentam casos a ele. Casos desta tarefa:

- Cookie selado com `"senha-antiga"` abre com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`. `session.id` e `session.data` são os originais.
- `updateSession(event, config, { user: "ana" })` emite cookie que abre com `unsealSession` usando só `"senha-nova"`, e falha ao ser aberto só com `"senha-antiga"`.
- Cookie selado com `"senha-desconhecida"` vira sessão nova: `id` novo, `data` vazio, nenhum erro.

Antes da T-10 a T-13, esses casos devem falhar (exceto o de senha desconhecida, que pode passar por já ser o comportamento atual; registrar isso).

**Arquivos:** `test/session-extra-passwords.test.ts` (novo)

**Aceite:** `pnpm vitest run test/session-extra-passwords.test.ts` roda nos alvos `web` e `node`. Os casos de abertura falham antes da implementação e a falha é registrada.

---

### T-05 — Lista vazia e ordem de tentativa

**Cobre:** RF-02, RF-05
**Depende de:** T-04

Acrescentar ao arquivo de testes:

- Com `extraUnsealPasswords: []` e com o campo ausente, o resultado é idêntico (mesma sessão, mesmo comportamento de senha desconhecida).
- Com duas extras, `["senha-1", "senha-antiga"]`, a segunda abre a sessão. Prova que a tentativa percorre o array.
- Quando a senha atual (`password`) é a que abre, nenhuma extra é consultada.
- Um `unseal` que lança erro que não seja `"Bad hmac value"` (por exemplo, senha atual com menos caracteres ou `"Expired seal"`) não tenta as extras e é propagado (D-05). Para isso, espionar `unseal` ou usar um cookie com `maxAge` vencido, conforme for mais simples.

**Arquivos:** `test/session-extra-passwords.test.ts`

**Aceite:** os casos de lista vazia passam já com o código atual. Os casos de ordem e D-05 falham antes da T-12.

---

### T-06 — Validação das senhas extras

**Cobre:** RF-07
**Depende de:** T-04

Acrescentar os casos de validação:

- `extraUnsealPasswords: [""]` faz `getSession` rejeitar, com mensagem que cita `extraUnsealPasswords`.
- Um item com 10 caracteres faz `getSession` rejeitar com a mesma verificação.
- `useSession` também rejeita com essa config.
- A rejeição acontece mesmo quando a sessão já existe no contexto (D-04: validação antes do retorno antecipado).

**Arquivos:** `test/session-extra-passwords.test.ts`

**Aceite:** os casos falham antes da T-11 (hoje a config inválida é ignorada em silêncio ou a sessão é criada nova).

---

### T-07 — Reselagem de sessões abertas por senha extra

**Cobre:** RF-06, RF-10
**Depende de:** T-04

Acrescentar os casos de migração:

- Cookie selado com `"senha-antiga"`: a resposta de `getSession` contém `Set-Cookie` novo, e esse cookie abre só com `"senha-nova"`.
- O mesmo cenário com a sessão enviada pelo header `x-h3-session`: a sessão carrega normalmente e nenhum `Set-Cookie` é emitido.

**Arquivos:** `test/session-extra-passwords.test.ts`

**Aceite:** os casos de cookie falham antes da T-13. O caso de header passa após a T-12 e continua passando depois da T-13.

---

### T-08 — Expiração e fallback legado com senhas extras

**Cobre:** RF-08, RF-09, RF-10
**Depende de:** T-04

Acrescentar:

- Sessão selada com `"senha-antiga"` cujo `createdAt` ultrapassa `maxAge` vira sessão nova com a config que tem `extraUnsealPasswords: ["senha-antiga"]`. Usar `vi.useFakeTimers({ toFake: ["Date"] })`, como nos testes de idle de `test/session.test.ts`.
- Cookie selado com `"senha-antiga"` usando 1 iteração (legado) é carregado e resselado com as opções atuais.

**Arquivos:** `test/session-extra-passwords.test.ts`

**Aceite:** o caso de expiração passa após a T-12 (a checagem de `maxAge` já existe). O caso de legado falha antes da T-12 e passa depois dela.

---

### T-09 — Custo, `legacySealFallback: false` e `idleTimeout`

**Cobre:** RF-06, RF-09, RF-08
**Depende de:** T-04

Acrescentar:

- Cookie forjado com N = 2 extras e fallback ligado: `vi.spyOn(crypto.subtle, "deriveBits")` deve ser chamado exatamente `2 × (1 + N)` = 6 vezes (D-02, risco 1), como em `test/session.test.ts:723-733`.
- Com `legacySealFallback: false`, cookie com a senha antiga em formato legado é rejeitado, ou seja, não há fallback nem por extra.
- Sessão aberta por extra com `idleTimeout`: o reseal restampa `lastSeenAt` e a janela desliza.

**Arquivos:** `test/session-extra-passwords.test.ts`

**Aceite:** o teste de custo passa só depois da T-12 e fixa o número 6. Os outros dois casos passam após a T-13.

---

### T-10 — Símbolo interno `kExtraUnsealPassword`

**Cobre:** RF-06
**Depende de:** T-07

Adicionar em `src/utils/internal/session.ts` o símbolo `kExtraUnsealPassword`, com `Symbol.for("h3.internal.session.extra-unseal-password")`, no mesmo padrão de `kLegacySeal`. Não exportar pela API pública.

**Arquivos:** `src/utils/internal/session.ts`

**Aceite:** `pnpm vitest run test/unit/package.test.ts` continua verde. O símbolo não aparece em `src/index.ts`.

---

### T-11 — Validação de `extraUnsealPasswords` em `getSession`

**Cobre:** RF-07
**Depende de:** T-03, T-06

Adicionar a função interna `assertExtraUnsealPasswords(config)` no fim de `src/utils/session.ts`. Ela usa o maior entre `encryption.minPasswordlength` e `integrity.minPasswordlength` das opções efetivas, e rejeita string vazia explicitamente. Chamar a função como primeira instrução de `getSession`, antes do retorno antecipado de sessão existente e de qualquer escrita em `context.sessions`.

**Arquivos:** `src/utils/session.ts`

**Aceite:** os casos da T-06 passam. `pnpm vitest run test/session.test.ts` continua verde.

---

### T-12 — Loop de senhas em `unsealSession`

**Cobre:** RF-02, RF-04, RF-08, RF-09
**Depende de:** T-03, T-05, T-08, T-09, T-11

Implementar em `src/utils/session.ts`, com a assinatura pública inalterada:

- Helper interno `unsealWithPassword(sealed, password, sealOptions, legacyFallback)` no fim do arquivo. Ele tenta os iterations atuais e, se der `"Bad hmac value"` e `legacySealFallback !== false`, tenta o legado de 1 iteração. Retorna `undefined` só para `"Bad hmac value"`, e trata `null` como sucesso (sem tentar o legado), como hoje.
- `unsealSession` itera `[config.password, ...(config.extraUnsealPasswords || [])]`. Para na primeira senha que não retorna `undefined`. Se nenhuma valida, lança `new Error("Bad hmac value")`.
- As checagens de `maxAge` e `idleTimeout` continuam depois do loop, sem mudança.
- Qualquer erro que não seja `"Bad hmac value"` é relançado e interrompe o loop (D-05).

**Arquivos:** `src/utils/session.ts`

**Aceite:** `pnpm vitest run test/session-extra-passwords.test.ts` passa nos casos das T-04, T-05, T-08 e T-09 (exceto os de reselagem da T-07). `pnpm vitest run test/session.test.ts` continua verde sem alterações nos testes.

---

### T-13 — Reselagem por cookie e `password` como única senha de selagem

**Cobre:** RF-03, RF-06
**Depende de:** T-07, T-10, T-12

Em `src/utils/session.ts`:

- Em `getSession`, ler e apagar `kExtraUnsealPassword` do objeto aberto, junto de `kLegacySeal`, antes de `Object.assign(session, unsealed)`. Sem isso, o símbolo vaza para `session`.
- A condição de reseal passa a ser `legacySeal || extraUnsealPassword || shouldSlide(session, config)`. Continua restrita a `sessionFromCookie`, então sessões lidas por header não são resseladas.
- `updateSession` e `sealSession` continuam usando só `config.password`. Não ler `extraUnsealPasswords` em nenhum caminho de selagem.

**Arquivos:** `src/utils/session.ts`

**Aceite:** todos os casos de `test/session-extra-passwords.test.ts` passam, incluindo os de reselagem da T-07 e o de RF-03 da T-04. O caso de header não emite `Set-Cookie`. Nenhum objeto de sessão contém o símbolo `kExtraUnsealPassword` (verificar com `Object.getOwnPropertySymbols`).

---

### T-14 — Documentação da rotação

**Cobre:** RF-01, RF-06, RF-07
**Depende de:** T-13

Atualizar `docs/4.examples/handle-session.md`:

- Na seção Options (`:120`): descrever `extraUnsealPasswords`, a ordem de tentativa, que `password` sela, e a validação (vazia ou abaixo do mínimo gera erro).
- Na seção Expiration (`:151`): o procedimento de rotação. Colocar a nova senha em `password`, mover a antiga para `extraUnsealPasswords`, e remover a antiga quando o último cookie com ela tiver expirado (`maxAge`).
- Registrar os riscos da techspec: limite prático de extras, custo de CPU, e sessões por header que continuam válidas até expirar sem migração (`:180`).

Revisar `docs/2.utils/4.security.md`, que menciona `useSession`, e acrescentar uma nota sobre rotação se fizer sentido.

**Arquivos:** `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`

**Aceite:** a documentação descreve o procedimento de rotação em passos. Os links e âncoras existentes continuam válidos. `pnpm lint` (oxfmt) passa nos arquivos alterados.

---

### T-15 — Verificação final

**Cobre:** RF-05, RF-10
**Depende de:** T-11, T-13, T-14

Rodar os comandos da techspec, nesta ordem:

- `pnpm vitest run test/session.test.ts` (sem alterações nos testes)
- `pnpm vitest run test/session-extra-passwords.test.ts` (web e node)
- `pnpm vitest run test/unit/package.test.ts`
- `pnpm vitest run test/unit/iron-crypto.test.ts`
- `pnpm lint`
- `pnpm test`

Confirmar que `src/index.ts`, `src/utils/internal/iron-crypto.ts`, `test/session.test.ts` e `CHANGELOG.md` não foram alterados (`git diff --stat`).

**Arquivos:** nenhum arquivo novo. Verificação apenas.

**Aceite:** todos os comandos passam. Se algum falhar, a saída completa é registrada na entrega, e a falha não é marcada como resolvida.
