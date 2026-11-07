# Tarefas de implementação: várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-09), `sdd/techspec.md` (D-01 a D-06).

Ordem sugerida: T-01 e T-02 primeiro (podem rodar em paralelo), depois T-03 a T-06, e por fim T-07 a T-09. Os testes de T-01 devem falhar antes de T-03 começar (`AGENTS.md`, "Bug Fix Workflow" e a estratégia de testes da techspec).

Cobertura dos requisitos:

| Requisito | Tarefas |
| --------- | ------- |
| RF-01 | T-01, T-03 |
| RF-02 | T-01, T-04 |
| RF-03 | T-01, T-05 |
| RF-04 | T-01, T-04 |
| RF-05 | T-01, T-03 |
| RF-06 | T-01, T-02, T-06 |
| RF-07 | T-01, T-05 |
| RF-08 | T-07, T-08 |
| RF-09 | T-01, T-09 |

---

### T-01 — Testes de rotação de senhas (escritos antes da implementação)

Escrever o bloco `describe("password rotation")` dentro de `describeMatrix` em `test/session.test.ts`, depois de `describe("lazy creation")`. Usar duas senhas de 51 caracteres (`NOVA` e `ANTIGA`) e um terceiro valor `TERCEIRA` para o teste de três senhas. Cobrir os casos 1 a 12 da estratégia de testes da techspec:

- aceita lista sem erro e emite `Set-Cookie` (RF-01);
- cookie de `useSession` abre com `NOVA` e falha com `ANTIGA` ("Bad hmac value") (RF-02);
- cookie selado com `ANTIGA` é lido, mantém `id` e `data`, e gera exatamente um `Set-Cookie` que abre com `NOVA` (RF-03, RF-06);
- cookie selado com `NOVA` não gera `Set-Cookie` na leitura (RF-06, caso negativo);
- `password` em string continua sem `Set-Cookie` no caminho feliz (RF-04);
- `password: []` faz a rota responder com erro contendo a mensagem de lista vazia, limpando `t.errors` (RF-05);
- cookie legado (1 iteração) selado com `ANTIGA` é lido, mantém `data` e é resselado com `NOVA` (RF-07);
- cookie selado com a terceira senha abre, e a ordem `[A, B, C]` é respeitada (RF-03);
- chave desconhecida gera sessão nova, sem erro e sem `Set-Cookie`;
- com `legacySealFallback: false`, cookie legado é rejeitado mesmo com a senha na lista (RF-07);
- cookie com `ANTIGA` enviado pelo header abre sem `Set-Cookie` (D-06);
- a sessão lida tem as mesmas chaves que a sessão de senha única, sem símbolo interno sobrando.

Os testes devem falhar na branch antes das implementações (T-02 a T-06). Registrar quais falham e por quê.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` executa o novo bloco em `web` e `node`. Os casos de rotação falham sem as implementações, pelo motivo esperado (ex.: tipo/lista não aceita, sem `Set-Cookie`). Os testes existentes do arquivo continuam passando sem alteração.
**Arquivos:** `test/session.test.ts`

---

### T-02 — Marcador interno `kRotatedSeal`

Adicionar `kRotatedSeal` em `src/utils/internal/session.ts`, logo após `kLegacySeal`, com `Symbol.for("h3.internal.session.rotated-seal")` e o mesmo formato de `kLegacySeal` (`/* @__PURE__ */` e `unique symbol`). Não exportar nada novo de `src/index.ts`.

**Cobre:** RF-06
**Depende de:** nenhuma
**Aceite:** `kRotatedSeal` existe e é importável por `src/utils/session.ts` sem aparecer em `src/index.ts`. `pnpm typecheck` passa.
**Arquivos:** `src/utils/internal/session.ts`

---

### T-03 — Tipo `string | string[]` e validação de `password`

Alterar `SessionConfig.password` em `src/utils/session.ts` para `string | string[]`, com JSDoc dizendo que a primeira senha sela, as demais só abrem, que cada item precisa do tamanho mínimo e que cada senha extra aumenta o custo de leitura. Criar o helper privado `resolvePasswords(config)` no fim do arquivo: normaliza para `string[]`, lança `Error` com mensagem clara para lista vazia (RF-05) e para item abaixo do mínimo efetivo `Math.max(seal.encryption.minPasswordlength, seal.integrity.minPasswordlength)` calculado a partir de `{ ...sealDefaults, ...config.seal }` (D-04). Criar também `isBadHmac(error)` no fim do arquivo, comparando a mensagem `"Bad hmac value"` como o código atual já faz. Chamar `resolvePasswords(config)` no início de `getSession`, `sealSession` e `unsealSession`, antes de qualquer outra coisa.

Não alterar o comportamento de selagem nem de leitura nesta tarefa.

**Cobre:** RF-01, RF-05
**Depende de:** T-01
**Aceite:** os testes de RF-01 e RF-05 de T-01 passam. Lista `[]` e lista com item curto geram `Error` tanto em `sealSession`/`unsealSession` quanto dentro de `getSession` (sem ser engolido pelo `.catch`). Strings continuam aceitas. `pnpm typecheck` passa.
**Arquivos:** `src/utils/session.ts`

---

### T-04 — Selagem com a primeira senha

Em `src/utils/session.ts`, trocar a chamada de selagem (`seal(session, config.password, ...)`, hoje perto de `:300-304`) por `seal(session, resolvePasswords(config)[0], ...)`. Como a selagem usa uma `string`, o `passwordId` gravado continua `""`, e o formato do cookie não muda (D-02).

**Cobre:** RF-02, RF-04
**Depende de:** T-03
**Aceite:** o teste de RF-02 de T-01 passa: o cookie emitido com `["NOVA", "ANTIGA"]` abre com `NOVA` e falha com `ANTIGA`. Com `password` em string, o cookie gerado é idêntico ao da versão atual para a mesma entrada de teste (RF-04).
**Arquivos:** `src/utils/session.ts`

---

### T-05 — Leitura com várias senhas e duas passadas

Criar `unsealWithPasswords(sealed, passwords, opts)` no fim de `src/utils/session.ts`, que retorna `{ unsealed, index }`. Ele tenta cada senha em ordem com as opções atuais e avança apenas em `isBadHmac`; qualquer outro erro sobe imediatamente. Se nenhuma abrir, e o fallback legado estiver habilitado, faz uma segunda passada com todas as senhas e as opções de 1 iteração (D-03). Trocar o corpo de `unsealSession` (`:312-347`) para usar esse helper, trocando a condição do fallback por `isBadHmac(error)` com o mesmo comportamento de hoje. Não mexer em `iron-crypto.ts` (techspec, "Não alterar").

**Cobre:** RF-03, RF-07
**Depende de:** T-02, T-03
**Aceite:** os testes de RF-03 e RF-07 de T-01 passam, incluindo a ordem `[A, B, C]` e o caso `legacySealFallback: false`. O teste de legado existente (`test/session.test.ts`, bloco de legado) continua passando sem alteração.
**Arquivos:** `src/utils/session.ts`

---

### T-06 — Reselamento na leitura e remoção do marcador

Em `unsealSession`, marcar o objeto retornado com `kRotatedSeal` quando o `index` for maior que zero (D-05). Em `getSession`, ler o marcador, removê-lo antes de `Object.assign` (senão o símbolo vai para a sessão e para o cookie seguinte, techspec risco 3), e incluir `rotatedSeal` na condição de reselamento: `legacySeal || rotatedSeal || shouldSlide`. Manter a exigência de `sessionFromCookie`, para que sessões de header não recebam `Set-Cookie` (D-06).

**Cobre:** RF-06
**Depende de:** T-02, T-05
**Aceite:** os testes de RF-06 (positivo e negativo), de sessão de header e de "sem vazamento do marcador" passam. Após a leitura, as chaves da sessão são iguais às da sessão de senha única.
**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-07 — Conferência da API pública

Comparar os exports de `src/utils/session.ts` e `src/index.ts` antes e depois das mudanças. A única diferença deve ser o tipo aceito por `SessionConfig.password`. Nenhum export, opção ou tipo público novo. `resolvePasswords`, `unsealWithPasswords`, `isBadHmac` e `kRotatedSeal` devem ficar fora de `src/index.ts`. Verificar também que `src/index.ts:207-212` (`unsealSession`, `sealSession`) não mudou de assinatura.

**Cobre:** RF-08
**Depende de:** T-04, T-05, T-06
**Aceite:** diff de `src/index.ts` vazio. Diff dos exports de `src/utils/session.ts` mostra apenas a mudança de tipo de `password`. Os helpers novos não são exportados.
**Arquivos:** `src/utils/session.ts`, `src/index.ts`

---

### T-08 — Documentação da rotação

Atualizar `docs/4.examples/handle-session.md`: incluir a lista na descrição de `password` (linha ~37) e criar a seção "Rotate the password" entre "Options" e "Expiration" (linha ~120 a ~151), em inglês. Conteúdo: a primeira senha sela e as demais só abrem; manter a senha antiga até o maior prazo de vida da sessão (`maxAge`, ou `idleTimeout` para sessões de header); o reselamento só ocorre em cookies; cada senha extra aumenta o custo de leitura, recomendando até 3; senhas antigas aceitas ampliam a superfície de ataque até serem removidas.

**Cobre:** RF-08 (menção ao novo tipo de `password` na documentação; os riscos de operação do PRD também precisam estar documentados)
**Depende de:** T-04, T-06
**Aceite:** a seção existe e cobre os cinco pontos acima. O exemplo de código compila com o tipo novo. Revisão visual do Markdown sem links quebrados.
**Arquivos:** `docs/4.examples/handle-session.md`

---

### T-09 — Verificação final

Rodar a verificação completa e corrigir regressões que aparecerem. Comandos: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/iron-crypto.test.ts` (sem mudança, confirma a base), `pnpm lint`, `pnpm typecheck` e `pnpm test`. Conferir que os ramos novos ficam cobertos pelos testes de T-01.

**Cobre:** RF-09
**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08
**Aceite:** `pnpm test` passa por completo (lint, typecheck e cobertura). Todos os testes existentes passam sem alteração, e os novos cobrem RF-01 a RF-07. Qualquer falha é reportada com a saída do comando.
**Arquivos:** nenhum arquivo novo; correções, se houver, nos arquivos das tarefas anteriores.
