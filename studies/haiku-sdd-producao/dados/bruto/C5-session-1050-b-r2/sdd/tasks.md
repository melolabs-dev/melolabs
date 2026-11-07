# Tarefas de implementação — várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (decisões D-01 a D-08, riscos R-01 a R-07).

Ordem sugerida: T-01 e T-02 em paralelo; depois T-03; depois T-04; depois T-05 e T-06; por fim T-07 (medição) e T-08 (validação final).

---

### T-01 — Símbolo interno `kExtraSeal`

**Cobre:** RF-03
**Depende de:** nenhuma
**Aceite:** `src/utils/internal/session.ts` exporta `kExtraSeal` com `Symbol.for("h3.internal.session.extra-seal")`, ao lado de `kLegacySeal`, com `/* @__PURE__ */` como no símbolo existente. `pnpm typecheck` passa.
**Arquivos:** `src/utils/internal/session.ts`

---

### T-02 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-06
**Depende de:** nenhuma
**Aceite:** `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password` (`src/utils/session.ts:48`), com o TSDoc da techspec (ordem de tentativa, só abre, reselagem com `password`, mínimo de 32 caracteres). `password` continua `string`. `src/index.ts` não muda (`git diff` vazio nele) e não aparece export público novo. `pnpm typecheck` passa.
**Arquivos:** `src/utils/session.ts`

---

### T-03 — `unsealSession` com lista de senhas e duas passadas

**Cobre:** RF-01, RF-04, RF-05
**Depende de:** T-01, T-02
**Aceite:**
- Existe o helper interno, não exportado, `unsealWithPasswords(sealed, passwords, options)`. Ele avança para a próxima senha só em `"Bad hmac value"`; outros erros propagam na primeira tentativa. Se nenhuma senha abrir, relança o último `"Bad hmac value"`.
- `unsealSession` monta `passwords = [...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])]` (D-04).
- Passada 1: `sealOptions` atuais com toda a lista. Só se der `"Bad hmac value"` e `legacySealFallback !== false` e as iterações não forem 1, passada 2 com `iterations: 1` sobre toda a lista, marcando `kLegacySeal` (D-02).
- Se a senha que abriu não for `config.password`, marca `kExtraSeal` (D-03).
- As checagens de `maxAge` e `idleTimeout` continuam iguais e rodam uma vez, depois que o cookie abriu (techspec, passo 5).
- A assinatura pública de `unsealSession` não muda.
- Sem `extraUnsealPasswords`, a lista tem um item e as tentativas são as de hoje. Os testes de legado (`test/session.test.ts:134-186`) passam sem alteração.
- `pnpm typecheck` passa.

**Arquivos:** `src/utils/session.ts`

---

### T-04 — `getSession` reselando cookie aberto com senha extra

**Cobre:** RF-03
**Depende de:** T-01, T-03
**Aceite:**
- Em `getSession` (`src/utils/session.ts:196-221`), `kExtraSeal` é lido e apagado junto de `kLegacySeal` (`:199-201`) antes de `Object.assign(session, unsealed)` (`:208`). Sem isso, o símbolo, que é copiado por `Object.assign`, vaza para a sessão devolvida.
- A condição de reseal (`:214`) inclui `kExtraSeal`, e só para cookie que veio de `sessionFromCookie` (D-08). Sessão lida pelo header não gera `Set-Cookie` de migração.
- O reseal usa `sealSession`, portanto `password` (RF-02).
- Verificação manual com um teste rápido ou no teste da T-05: `Object.getOwnPropertySymbols` da sessão devolvida não contém `kExtraSeal` nem `kLegacySeal`.

**Arquivos:** `src/utils/session.ts`

---

### T-05 — Testes de RF-01 a RF-04 e das decisões D-02, D-04 e D-05

**Cobre:** RF-01, RF-02, RF-03, RF-04
**Depende de:** T-03, T-04
**Aceite:**
- Testes novos em `test/session.test.ts`, dentro de `describeMatrix`, rodando em web e node.
- As senhas usadas nos testes têm 32 caracteres ou mais, porque o iron recusa senhas mais curtas (`iron-crypto.ts:191-196`). Os nomes `A`, `B` e `C` do PRD são só rótulos.
- Os cookies de teste são selados com `seal` de `src/utils/internal/iron-crypto.ts`, como em `test/session.test.ts:134-159`.
- Casos mínimos:
  1. Cookie selado com A; config `password: B`, `extraUnsealPasswords: [A]`; `getSession` devolve os dados, sem erro e sem sessão vazia (RF-01).
  2. `useSession` + `update` com config `B, [A]`; o `Set-Cookie` abre com `B`, e `unseal` com `A` rejeita (`expect(...).rejects`) (RF-02).
  3. Cookie aberto com A gera `Set-Cookie` que abre com `B` sem usar `A` (RF-03).
  4. Cookie selado com C, fora da config; `getSession` devolve sessão vazia, sem dados e sem erro (RF-04).
  5. Cookie legado (1 iteração) selado com A; config `B, [A]`; dados devolvidos e cookie resselado com `B` nas iterações atuais (D-02).
  6. Cookie legado sob A com `legacySealFallback: false`; rejeitado, sessão vazia (D-02).
  7. `extraUnsealPasswords: [B]` com `password: B`; funciona e a tentativa não se repete (D-04). Opcional: contar `deriveBits` como em `test/session.test.ts:722-735`.
  8. Cookie selado com A e `extraUnsealPasswords: [X, A]`; abre na segunda posição (D-01, D-02).
  9. Cookie selado com A, config `password: B`, `extraUnsealPasswords: [A]`, mas com `Expired seal`; o erro propaga, a sessão fica vazia e as outras senhas não são tentadas (D-05).
  10. Senha extra com menos de 32 caracteres; a sessão fica vazia e o comportamento é o da R-02 (fixa a regra atual, ver Pendências).
- `pnpm vitest run test/session.test.ts` passa.

**Arquivos:** `test/session.test.ts`

---

### T-06 — Compatibilidade sem senhas extras (RF-05) e selagem só com `password` (RF-02)

**Cobre:** RF-05, RF-02
**Depende de:** T-03, T-04
**Aceite:**
- Com `extraUnsealPasswords` ausente e com `[]`, a suíte existente de `test/session.test.ts` passa sem alteração de comportamento. Nenhuma linha existente é modificada (`git diff` do arquivo só tem adições).
- O teste de `deriveBits` em `test/session.test.ts:722-735` continua passando sem mudança.
- `sealSession` (`src/utils/session.ts:282-307`) não é alterado (`git diff` vazio nessa faixa), e o cookie selado com `useSession` abre só com `password`.
- Um teste novo cobre `extraUnsealPasswords: []` e compara o resultado com o da configuração sem o campo.

**Arquivos:** `test/session.test.ts` (somente adições)

---

### T-07 — Medição de custo com cookie inválido (R-01)

**Cobre:** nenhum RF diretamente (risco R-01 da techspec)
**Depende de:** T-03
**Aceite:**
- Medido o tempo de `getSession` com cookie inválido, com 0, 1 e 5 senhas extras, usando `test/bench/session.ts` ou um script temporário dentro do repositório, que não é commitado.
- O custo cresce de forma linear com o número de senhas (cerca de `2 × (1 + N)` derivações, conforme R-01).
- Os números são registrados na descrição do PR. Se o custo estiver alto, a decisão de limitar a lista volta para a discussão. Não é tarefa desta entrega.

**Arquivos:** `test/bench/session.ts` (opcional, se for usado)

---

### T-08 — Validação final: lint, typecheck e suíte completa

**Cobre:** RF-07
**Depende de:** T-05, T-06
**Aceite:**
- `pnpm vitest run test/session.test.ts` passa.
- `pnpm lint` passa.
- `pnpm typecheck` passa.
- `pnpm vitest run test/` passa.
- Se algum teste de legado falhar, a causa está em D-02 e a correção vai no código, não no teste.
- A saída dos quatro comandos é registrada na descrição do PR.

**Arquivos:** nenhum (só execução)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-03, T-05 |
| RF-02 | T-05, T-06 |
| RF-03 | T-01, T-04, T-05 |
| RF-04 | T-03, T-05 |
| RF-05 | T-03, T-06 |
| RF-06 | T-02 |
| RF-07 | T-08 |

## Pendências

- **R-02 (senha extra curta):** a techspec deixa para o usuário decidir entre manter a regra igual à de `password` (o erro `Password string too short` vira sessão vazia silenciosa) ou validar o tamanho das extras no início de `unsealSession` com erro claro. Esta lista assume a primeira opção, que é a de D-06. A T-05, caso 10, precisa mudar se a decisão for a segunda.
- **Referência ausente:** a techspec cita `sdd/pedido.md`, que não existe na pasta `sdd/`. Os requisitos usados aqui vêm só do PRD e da techspec.
- **Critérios com `A`, `B` e `C`:** os critérios do PRD usam senhas de uma letra, que o iron recusa. Os testes usam senhas de 32 caracteres (T-05).
