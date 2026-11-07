# Tarefas de implementação — Problem details (RFC 9457)

Fontes: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (decisões D-01 a D-08, seção 3 de arquivos e tabela de testes).

**Gate:** a techspec exige confirmação de P1 antes de alterar `src/`. Por isso T-02 a T-07 dependem de T-01. Os testes (T-03 e T-04) podem ser escritos antes da confirmação, porque só mudam `test/`.

**Ordem sugerida:** T-01 → (T-02, T-03, T-04) → T-05 → T-06 → T-07 → T-08 → T-09 → T-10.

---

### T-01 — Confirmar P1 e as decisões D-03 a D-07

Cobre: nenhum requisito direto (gate de P1 para as tarefas que alteram `src/`).
Depende de: nenhuma.
Aceite: registro escrito de que o formato novo é padrão, sem opção de configuração e com quebra de clientes aceita (P1). Também registro de que D-03 a D-07 foram aceitas ou de que as objeções foram anotadas. Sem essa confirmação, T-02 a T-07 não começam.
Arquivos: nenhum (decisão). Referência: `sdd/techspec.md`, seção 7.

---

### T-02 — Criar a tabela interna de frases padrão de status

Cobre: RF-01 (membro `title` quando `statusText` está ausente).
Depende de: T-01.
Aceite: `src/utils/internal/status-text.ts` exporta `STATUS_PHRASES` sem imports. Conferir contra o registro IANA e a RFC 9110: 404 → "Not Found", 422 → "Unprocessable Content", 500 → "Internal Server Error". O código 499 não tem entrada. A tabela cobre os 4xx e 5xx do registro. `STATUS_TEXT` em `src/utils/response.ts` continua sem mudança (D-04).
Arquivos: `src/utils/internal/status-text.ts` (novo)

---

### T-03 — Escrever os testes unitários e de tipos (devem falhar)

Cobre: RF-02.
Depende de: T-01.
Aceite: em `test/unit/error.test.ts` (novo), os seguintes casos existem e falham antes de T-05:
- `new HTTPError({ status: 403, type, instance })` expõe `error.type` e `error.instance`; sem os campos, ambos são `undefined` (RF-02).
- `new HTTPError({ cause: { type: "x", instance: "y", status: 400 } })` não herda `type` nem `instance` (D-05).
- `toJSON()` de erro não tratado ignora `statusText` (D-04).
- `error.unhandled` e `error.statusText` continuam na instância (D-07).

Em `test/unit/types.test-d.ts`, `expectTypeOf` confirma que `ErrorInput` aceita `type` e `instance`, e que `HTTPError.type` e `HTTPError.instance` são `string | undefined`.
Comando: `pnpm vitest run test/unit`.
Arquivos: `test/unit/error.test.ts` (novo), `test/unit/types.test-d.ts`

---

### T-04 — Escrever os testes HTTP de problem details com `describeMatrix` (devem falhar)

Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09.
Depende de: T-01.
Aceite: bloco `describe("problem details")` em `test/errors.test.ts`, usando `describeMatrix` (cobre web e node). Casos:
- RF-01: `HTTPError` 404 com `message` em português. Status 404, `content-type` `application/problem+json`, corpo com `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail` igual à mensagem.
- RF-03: `type` e `instance` do erro aparecem no corpo.
- RF-04: `throw new Error("senha do banco: 123")` com `t.app.config.debug = false`. O corpo não contém "senha do banco", `detail` é "HTTPError", status 500 e `title` é "Internal Server Error".
- RF-04 (D-04): erro não tratado com `status: 403` e `statusText: "Leaky"`. `title` deve ser "Forbidden".
- RF-05: com debug ligado, `stack` é array de strings. Com debug desligado, a chave `stack` não existe.
- RF-06: `data: { campo: "x" }` e `body: { codigo: "E42" }` aparecem no nível superior.
- RF-06 (D-03): `body: { status: 999, title: "x" }` não sobrescreve os membros da RFC.
- RF-07: `headers: { "x-request-id": "abc", "content-type": "text/plain" }` gera `x-request-id: abc` e `content-type: application/problem+json`.
- R4/D-04: status sem frase (ex.: 499 sem `statusText`) gera corpo sem a chave `title`.

Atenção: `test/_setup.ts:136` roda a matriz com `debug: true`. Asserts com `toEqual` exato precisam desligar debug (`t.app.config.debug = false`) ou tirar `stack` antes de comparar.
Comando: `pnpm vitest run test/errors.test.ts -t "problem details"`. Antes de T-07 os casos falham.
Arquivos: `test/errors.test.ts`

---

### T-05 — Adicionar `type` e `instance` a `HTTPError`

Cobre: RF-02.
Depende de: T-03.
Aceite: `ErrorBody` ganha `type?: string` e `instance?: string`, com doc de RFC 9457, e a doc de `statusText` deixa de falar da chave `message`. `HTTPError` ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor só a partir de `details` (sem herança de `cause`, D-05). Nenhum nome público novo: `test/unit/package.test.ts` passa sem edição. Os casos de RF-02 de T-03 passam.
Arquivos: `src/error.ts`

---

### T-06 — Reescrever `HTTPError.toJSON()` no formato problem details

Cobre: RF-01, RF-03, RF-04, RF-06.
Depende de: T-02, T-05.
Aceite: `toJSON()` segue a referência da techspec, seção 4, com a ordem D-03: `...body` primeiro (só quando tratado), membros da RFC depois e `data` por último. Erro não tratado: `detail` é "HTTPError", `title` é a frase padrão do status, `data` e `body` ficam fora. Quando não há frase, `title` não aparece no JSON. `statusText` e `unhandled` não estão no corpo (D-07). Testes unitários de D-04 e D-07 de T-03 passam. Não há mudança em `toError`, `isError` nem em `prepareResponse`.
Arquivos: `src/error.ts` (importa `src/utils/internal/status-text.ts`)

---

### T-07 — Ajustar `errorResponse` para `Content-Type` e `stack`

Cobre: RF-01, RF-05, RF-07.
Depende de: T-04, T-06.
Aceite: `errorResponse` monta os headers na ordem `error.headers`, depois `errHeaders` (mesclados como hoje), e por último `set("content-type", "application/problem+json")` (D-06). O corpo é `JSON.stringify({ ...error.toJSON(), stack }, ...)`, com `stack` só quando `debug && error.stack`. `set-cookie` continua preservado (`getSetCookie()` em `test/errors.test.ts:48`). A status line usa `error.statusText`, sem mudança. `jsonHeaders` continua existindo para os outros caminhos. Os casos de T-04 de RF-01, RF-05 e RF-07 passam.
Arquivos: `src/response.ts`

---

### T-08 — Ajustar os testes existentes ao novo formato

Cobre: RF-08.
Depende de: T-07.
Aceite: a tabela da techspec, seção 3, foi aplicada linha a linha. Cada ajuste troca `message` por `detail`, `statusText` por `title` ou `unhandled: true` por `detail: "HTTPError"`, e mantém a verificação do valor. Nenhum assert de dado foi removido. Casos específicos: `test/errors.test.ts:44` (content-type); `test/handler.test.ts` (confirmar linha a linha se é `HTTPError` ou `data`); `test/iterable.test.ts:145` (confirmar se o erro é `HTTPError`); `test/dist.test.ts:57` (depende do build, feito em T-09). Não alterar `test/route.test.ts:84-91`, `test/validate.test.ts` nem `test/json-rpc*.test.ts`. `pnpm vitest run test/errors.test.ts test/body.test.ts test/handler.test.ts` passa.
Arquivos: `test/errors.test.ts`, `test/body.test.ts`, `test/handler.test.ts`, `test/body-limit.test.ts`, `test/proxy.test.ts`, `test/rules/cache.test.ts`, `test/iterable.test.ts`, `test/dist.test.ts`

---

### T-09 — Rodar as verificações de qualidade e a suíte completa

Cobre: RF-08, RF-10.
Depende de: T-08.
Aceite:
- `pnpm typecheck` e `pnpm lint` terminam com código 0. Se `isolatedDeclarations` reclamar do retorno de `toJSON()`, aplicar a interface não exportada da techspec, seção 4 (R-05).
- `pnpm vitest run` passa por completo, incluindo `test/rules` e `test/tracing` (R-09). Se algo falhar, reportar e não ajustar às cegas.
- `pnpm build` termina, e `pnpm vitest run test/dist.test.ts` passa.
- `test/unit/package.test.ts` passa sem edição.
- Nenhum teste foi removido sem substituto equivalente (RF-08).
- Os comandos e saídas são reportados como estão, inclusive falhas.
Arquivos: nenhum arquivo novo. Correções pontuais de lint ou tipo podem tocar `src/` e `test/` já listados nas tarefas anteriores.

---

### T-10 — Registrar a quebra de compatibilidade no changelog

Cobre: nenhum requisito direto (riscos R1, R-03 e R-04 da techspec e do PRD).
Depende de: T-09.
Aceite: entrada de changelog marcada como breaking. Ela cita a troca de `Content-Type` para `application/problem+json`, a remoção de `message`, `statusText` e `unhandled` do corpo, a precedência de `title`/`detail`/`type`/`instance` sobre `body` e a mudança de retorno de `toJSON()`. A redação final é confirmada com a equipe (techspec, pendência 3).
Arquivos: arquivo de changelog do projeto (localizar antes de editar; não foi identificado na análise)
