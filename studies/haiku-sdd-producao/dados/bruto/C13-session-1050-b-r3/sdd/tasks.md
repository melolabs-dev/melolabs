# Tarefas de implementação: várias senhas de unseal (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-05).

Ordem geral: testes antes da implementação. Cada tarefa de teste precisa falhar antes da tarefa de código correspondente, como manda o `AGENTS.md` (Bug Fix Workflow). As tarefas que tocam `test/session.test.ts` ou `src/utils/session.ts` são sequenciais entre si.

**Pendência antes de T-04:** o limite `MAX_EXTRA_UNSEAL_PASSWORDS = 4` (techspec, D-04) é uma escolha da especificação, não do PRD. Confirmar o valor com o usuário antes de implementar T-04.

---

### T-01 — Teste de tipo para `extraUnsealPasswords`

Cobre: RF-01
Depende de: nenhuma

Adicionar em `test/unit/types.test-d.ts` um `expectTypeOf` que aceita `SessionConfig` com `password: string` e `extraUnsealPasswords: string[]`, e outro que aceita a ausência do campo.

Aceite: `pnpm vitest run test/unit/types.test-d.ts` falha antes de T-02 (campo inexistente).

Arquivos: `test/unit/types.test-d.ts`

---

### T-02 — Campo `extraUnsealPasswords` no `SessionConfig`

Cobre: RF-01
Depende de: T-01

Adicionar `extraUnsealPasswords?: string[]` em `SessionConfig`, logo após `password` (`src/utils/session.ts:48`), com o JSDoc da techspec. O JSDoc deve dizer que essas senhas nunca selam, que são tentadas em ordem depois de `password`, que cada uma precisa do mesmo tamanho mínimo, que a sessão aberta com uma delas é regravada com `password`, que o item deve sair da lista depois que as sessões seladas com ele expirarem, e que sessões lidas do header não recebem `Set-Cookie` (D-05).

Nenhuma mudança em `sealSession`, `useSession`, `getSession` ou nos tipos exportados além do campo novo.

Aceite: o teste de T-01 passa; `pnpm typecheck` passa; um `SessionConfig` sem o campo continua compilando.

Arquivos: `src/utils/session.ts`, `test/unit/types.test-d.ts`

---

### T-03 — Testes de comportamento (escritos antes da implementação)

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-02

Criar `describe("extraUnsealPasswords")` em `test/session.test.ts`, usando `describeMatrix`. Casos da techspec:

1. RF-02: sessão selada com `password` nova não abre com a senha antiga (`unseal` direto, como em `test/session.test.ts:157`).
2. RF-03 (ordem): com `["senha-antiga-2", "senha-antiga"]`, a sessão selada com `"senha-antiga"` é lida. Contar as chamadas a `crypto.subtle.deriveBits` com `vi.spyOn` e `legacySealFallback: false`. Esperado: 4 chamadas, na ordem `password`, `"senha-antiga-2"`, `"senha-antiga"`. Confirmar o número na implementação.
3. RF-03 (sem senha válida): cookie selado com senha fora da configuração. `getSession` retorna vazio, sem lançar.
4. RF-04: sem `extraUnsealPasswords`, o número de derivações é o mesmo de hoje. A suíte existente não recebe alteração nos asserts.
5. RF-05: sessão no formato legado (1 iteração) com senha antiga. Os dados voltam, e o cookie é regravado com `password` e as opções atuais.
6. RF-06: o cookie de resposta abre com `password` nova e não com a antiga. Uma segunda requisição com esse cookie não gera `Set-Cookie`.
7. RF-07: `[""]`, item com 31 caracteres e lista com 5 itens lançam erro na configuração. A mensagem cita `extraUnsealPasswords`. Lista vazia e ausente funcionam.

Aceite: os casos 2, 5, 6 e 7 falham antes de T-04, T-05 e T-06. Os casos 1 e 4 passam desde já. Confirmar a falha com `pnpm vitest run test/session.test.ts -t extraUnsealPasswords` e colar a saída no PR.

Arquivos: `test/session.test.ts`

---

### T-04 — Validação das senhas extras

Cobre: RF-07
Depende de: T-03

Criar `assertExtraUnsealPasswords(config)` no fim de `src/utils/session.ts` e chamá-la no início de `getSession`, antes de qualquer leitura de cookie e antes do `.catch` (`src/utils/session.ts:197`). A função lança `Error` se um item for vazio ou menor que `Math.max(encryption.minPasswordlength, integrity.minPasswordlength)` de `{ ...sealDefaults, ...config.seal }`, e se a lista tiver mais de `MAX_EXTRA_UNSEAL_PASSWORDS` itens (constante interna, valor 4, a confirmar). A mensagem cita `extraUnsealPasswords`.

`password` não recebe validação nova (D-04).

Aceite: o caso 7 de T-03 passa. A mensagem de erro contém `extraUnsealPasswords`.

Arquivos: `src/utils/session.ts`

---

### T-05 — Tentativas em ordem dentro de `unsealSession`

Cobre: RF-03, RF-04, RF-05
Depende de: T-04

Extrair `unsealWithPassword(sealed, password, sealOptions, config)` com a lógica atual de uma senha, incluindo o fallback legado de 1 iteração (`src/utils/session.ts:332-347`). `unsealSession` percorre `[config.password, ...extraUnsealPasswords]`. Só `Bad hmac value` faz a próxima senha ser tentada. Outros erros são relançados na hora. Se nenhuma abrir, relança o último erro `Bad hmac value`, como hoje. A checagem de `maxAge` e `idleTimeout` continua depois do laço.

A assinatura exportada de `unsealSession` não muda (`src/index.ts:209`).

Aceite: os casos 2, 3, 4 e 5 de T-03 passam. A contagem de derivações do caso 2 bate com o número confirmado. A suíte de `test/session.test.ts` passa sem alteração nos asserts existentes.

Arquivos: `src/utils/session.ts`

---

### T-06 — Regravação com `password` após abertura com senha extra

Cobre: RF-06
Depende de: T-05

Criar o símbolo `kRotatedSeal` em `src/utils/internal/session.ts`, no mesmo formato de `kLegacySeal` (linhas 7-9). `unsealSession` marca o resultado quando `index > 0`. Em `getSession`, ler e apagar o marcador antes de copiar os campos, e incluí-lo na condição de regravação:

```ts
if (session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))) {
```

Também cobrir os casos de expiração e cookie em partes:

- Sessão aberta com senha extra e `maxAge` vencido é tratada como inválida.
- Cookie em partes, selado com senha antiga (`test/session.test.ts:656`), é lido e regravado corretamente.
- Sessão do header aberta com senha extra não gera `Set-Cookie` (D-05).

Aceite: os casos 6 de T-03 passam. Os casos novos desta tarefa passam. Nenhum `Set-Cookie` aparece na segunda requisição com o cookie já regravado.

Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`

---

### T-07 — Teste de tipo final e verificação completa

Cobre: RF-01, RF-04
Depende de: T-06

Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/types.test-d.ts`, `pnpm vitest run test/unit/iron-crypto.test.ts`, `pnpm typecheck`, `pnpm lint` e `pnpm test`. Confirmar que nenhum assert existente foi alterado (`git diff` nos testes antigos deve estar vazio).

Aceite: todos os comandos passam. Se algum falhar, a saída vai no relatório, sem marcar a tarefa como concluída.

Arquivos: nenhum arquivo de código (somente execução e verificação)

---

### T-08 — Medição de custo de CPU

Cobre: RF-03, RF-06 (risco de custo por requisição)
Depende de: T-07

Medir o custo antes de liberar. Comparar a contagem de derivações PBKDF2 nos casos de T-03 e rodar `pnpm bench:node` antes e depois da mudança. Registrar os números no PR. Se o custo do pior caso (cookie inválido com 4 senhas extras, 5 derivações pesadas) for considerado alto, voltar à decisão do limite antes de liberar.

Aceite: os números de antes e depois estão registrados no PR, com o pior caso de cookie inválido.

Arquivos: nenhum arquivo de código (somente medição)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-02, T-07 |
| RF-02 | T-03 |
| RF-03 | T-03, T-05, T-08 |
| RF-04 | T-03, T-05, T-07 |
| RF-05 | T-03, T-05 |
| RF-06 | T-03, T-06, T-08 |
| RF-07 | T-03, T-04 |
