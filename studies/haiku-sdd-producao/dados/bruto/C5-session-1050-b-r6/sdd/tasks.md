# Tarefas — Múltiplas senhas de unseal nas sessões

Referências: `sdd/pedido.md`, `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-11, R-01 a R-10).
Ordem de trabalho: escrever os testes antes da mudança (T-02), ver que os casos de abertura falham, implementar (T-03), depois validar.

---

### T-01 — Adicionar o campo `extraUnsealPasswords` a `SessionConfig`

**Cobre:** RF-01, RF-09
**Depende de:** nenhuma
**Aceite:** `SessionConfig` tem `extraUnsealPasswords?: string[]` logo depois de `password`. O JSDoc diz que as extras só abrem sessões, que a selagem usa sempre `password`, que as extras exigem a mesma entropia e o mesmo tamanho mínimo de `password`, e que cada extra deve ser removida depois da maior `maxAge` (ou `idleTimeout`) das sessões que ela selou. O JSDoc também menciona o custo de uma derivação PBKDF2 por extra. Nada disso contradiz o JSDoc de `password`. `pnpm typecheck` passa, e uma configuração sem o campo continua válida.
**Arquivos:** `src/utils/session.ts`

---

### T-02 — Escrever os testes novos antes da mudança em `unsealSession`

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-08, RF-10
**Depende de:** T-01
**Aceite:** o arquivo novo usa `describeMatrix` (web e node), `sessionConfig` com `generateId` previsível e `seal`/`unseal` de `src/utils/internal/iron-crypto.ts`. Cobre os casos da tabela da techspec: abertura com a extra (mesmo `id` e dados), abertura com a segunda extra, senha desconhecida virando sessão nova sem exceção, escrita com `update` regravando com `password`, sessão selada com extra enviada pelo header `x-h3-test-session`, fallback legado com e sem `legacySealFallback: false`, `maxAge` vencido com extra, extra curta sem erro propagado, e `password` primeiro com extras que não batem. Ao rodar `pnpm vitest run test/session-unseal-passwords.test.ts` antes de T-03, os casos de RF-02, RF-05 e RF-06 (abertura por extra) falham. Casos que já passam hoje (por exemplo, RF-04, RF-07 e a parte de selagem do RF-03) continuam verdes e isso é esperado. A saída do teste é registrada na entrega.
**Arquivos:** `test/session-unseal-passwords.test.ts`

---

### T-03 — Trocar as chamadas diretas a `unseal` pelo loop e pelo helper

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-08
**Depende de:** T-02
**Aceite:**
- `unsealSession` monta a lista com `new Set([config.password, ...(config.extraUnsealPasswords ?? [])])`, preservando a ordem declarada e removendo duplicatas.
- O loop para na primeira senha que abre. Usa uma flag `found`, não a veracidade de `unsealed`, porque `unseal` pode retornar `null`.
- Só continua para a próxima senha no erro `"Bad hmac value"` (função `isBadHmac`). Qualquer outro erro é relançado na hora. Se nenhuma senha abrir, o último erro é relançado.
- O helper não exportado `unsealWithPassword` concentra a lógica atual de fallback legado (1 iteração PBKDF2 quando `legacySealFallback !== false`) e marca `kLegacySeal` dentro dele.
- `sealSession`, `updateSession`, `getSession` e `clearSession` não mudam. `src/index.ts` não ganha exportação.
- Os testes de T-02 passam. Um cookie que nenhuma senha abre continua virando sessão nova sem exceção.
- Se o oxlint sinalizar `await` dentro de `for`, a correção é desligar a regra mais estreita possível, só na linha, e não globalmente.
**Arquivos:** `src/utils/session.ts`

---

### T-04 — Confirmar que a suíte existente não mudou e que o caso sem extras é idêntico

**Cobre:** RF-07, RF-10
**Depende de:** T-03
**Aceite:** `pnpm vitest run test/session.test.ts test/cookies.test.ts` passa com 194 testes, nos modos web e node, sem alterar expectativas existentes. O caso com `extraUnsealPasswords: []` tem o mesmo resultado que o caso sem o campo, e os cookies gerados são iguais. Se algum teste existente precisar de ajuste, o motivo fica registrado na entrega, conforme a regra do `sdd/pedido.md` (só o que a mudança altera).
**Arquivos:** `test/session.test.ts`, `test/cookies.test.ts` (somente se precisar de ajuste), `test/session-unseal-passwords.test.ts`

---

### T-05 — Documentar a rotação de senha em `handle-session`

**Cobre:** RF-09
**Depende de:** T-03
**Aceite:** uma seção curta perto de "Use Multiple Sessions" (linha ~190) explica: a ordem de implantação recomendada (primeiro `password` antiga com `extraUnsealPasswords: [nova]`, depois trocar `password`), que a extra deve ser removida depois da maior `maxAge`/`idleTimeout`, que sessões sem expiração e sem escrita mantêm a senha antiga, e que cada extra custa uma derivação por requisição com cookie inválido. `CHANGELOG.md` não é alterado.
**Arquivos:** `docs/4.examples/handle-session.md`

---

### T-06 — Corrigir a premissa de tamanho mínimo no PRD

**Cobre:** RF-09
**Depende de:** nenhuma
**Aceite:** a frase da seção "Premissas" de `sdd/prd.md` que diz que não há validação em runtime do tamanho mínimo de `password` é trocada por um texto correto: o iron rejeita senhas string menores que `minPasswordlength` (padrão 32) em `generateKey`, e as extras seguem o mesmo limite (D-08 e R-04 da techspec). O restante do PRD não muda.
**Arquivos:** `sdd/prd.md`

---

### T-07 — Verificação final: lint, typecheck e suíte completa

**Cobre:** RF-01, RF-10
**Depende de:** T-04, T-05, T-06
**Aceite:** `pnpm lint`, `pnpm typecheck` e `pnpm test` passam sem erros. A cobertura não cai. Os testes novos passam nos modos web e node. Se algum comando falhar, a saída é colada na entrega, não resumida.
**Arquivos:** nenhum arquivo novo (somente execução de comandos)
