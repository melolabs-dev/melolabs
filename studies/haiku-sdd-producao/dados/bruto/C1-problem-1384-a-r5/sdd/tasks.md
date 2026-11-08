# Tarefas — Problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-09).

Regra para todas as tarefas: seguir o fluxo de `AGENTS.md` (escrever o teste, ver falhar, implementar, ver passar). Testes novos usam `describeMatrix` (web e node).

---

### T-01 — Opção `problemDetails` em `H3Config`

Cobre: RF-01, RF-06

Depende de: nenhuma

Aceite:
- `problemDetails?: boolean` existe em `H3Config` com JSDoc, inserido após `silent` (techspec §3.1, D-01).
- Teste em `test/problem-details.test.ts` (cria o arquivo): com a opção ausente, `ctx.app.config.problemDetails` é `undefined` ou `false`, e um `HTTPError.status(404, "Not Found", { message })` responde `application/json;charset=UTF-8` com o corpo atual.
- `new H3({ problemDetails: true })` compila sem erro de tipo e `app.config.problemDetails` vale `true`.
- `pnpm vitest run test/problem-details.test.ts` e `pnpm typecheck` passam.

Arquivos: `src/types/h3.ts`, `test/problem-details.test.ts`

---

### T-02 — `HTTPError` aceita e expõe `type` e `instance`

Cobre: RF-04, RF-06

Depende de: nenhuma

Aceite:
- `ErrorInput` ganha `type?: string` e `instance?: string` (D-03). `ErrorBody` não muda.
- A classe `HTTPError` ganha `readonly type` e `readonly instance`, atribuídos a partir do objeto de entrada, sem herdar de `cause` (D-04).
- `toJSON()` permanece idêntico (D-02): o JSON não contém `type` nem `instance`.
- Novo `test/unit/error.test.ts` cobre:
  - `new HTTPError({ status: 409, type, instance })` expõe os valores;
  - `new HTTPError("Erro", { status: 400 })` tem `type` e `instance` `undefined`;
  - `cause` com `type` não é herdado;
  - `JSON.stringify(...)` não contém `type` nem `instance`.
- Testes passam com `pnpm vitest run test/unit/error.test.ts`.

Arquivos: `src/error.ts`, `test/unit/error.test.ts`

---

### T-03 — Renderização RFC 9457 em `errorResponse`

Cobre: RF-02, RF-03, RF-06

Depende de: T-01, T-02

Aceite:
- `errorResponse(error, config, errHeaders?)` escolhe `problemHeaders` (`content-type` exatamente `application/problem+json`, sem `charset`, D-05) ou `jsonHeaders`, conforme `config.problemDetails`. `src/response.ts:173` passa o `config`.
- `toProblemDetails(error)` é helper interno e não exportado (D-02). Monta o corpo com `data` e `...body` primeiro e `type` (padrão `"about:blank"`), `title` (de `statusText`, some quando indefinido), `status`, `detail` (de `message`) e `instance` por último, para que os members RFC prevaleçam (D-06).
- Testes em `test/problem-details.test.ts`:
  - HTTPError 404 com a opção ligada: status 404, `content-type` igual a `application/problem+json`, corpo com `status: 404`;
  - `throw new Error("x")` com a opção ligada: status 500 e `content-type: application/problem+json`;
  - HTTPError 422 com `type`, `instance`, `statusText`, `message`, `data` e `body`: corpo igual ao exemplo do RF-03;
  - HTTPError sem `type` e sem `statusText`: `type === "about:blank"` e chave `title` ausente;
  - colisão com `body: { type: "x", title: "y", detail: "z" }`: os members RFC prevalecem;
  - HEAD com erro: corpo vazio e `content-type` ainda `application/problem+json`;
  - sem a opção, HTTPError com `type` e `instance`: corpo e `content-type` atuais, sem `type`, `instance` nem `title` (RF-06).
- `pnpm vitest run test/problem-details.test.ts test/errors.test.ts` passa sem alterar `test/errors.test.ts`.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-04 — Erros não tratados não expõem a mensagem real

Cobre: RF-05

Depende de: T-03

Aceite:
- Com `unhandled: true` e a opção ligada, `toProblemDetails` define `detail: "HTTPError"` e omite `data` e `body` (D-07). `type` e `instance` não são mascarados.
- Teste com `message: "senha do banco incorreta"` e `data` no erro não tratado: o corpo tem `detail: "HTTPError"`, não contém a string `"senha do banco incorreta"` e não tem `data`. Usar `allowUnhandledErrors` se necessário, como nos outros testes de erro, para o `afterEach` não falhar.
- `pnpm vitest run test/problem-details.test.ts` passa.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-05 — Compatibilidade com `onError`, headers, `debug` e `event.res`

Cobre: RF-07

Depende de: T-03, T-04

Aceite:
- Com `problemDetails: true`, `debug: true` e `error.headers: { "x-erro": "1" }`: a resposta tem `content-type: application/problem+json`, o header `x-erro: 1` e o corpo tem `stack` como array de linhas (D-08).
- Mesmo cenário com `debug: false`: o corpo não tem `stack`.
- `onError` é chamado uma vez antes da renderização (`t.hooks.onError`) e um `event.res.errHeaders` staged ainda é aplicado.
- `onError` que devolve `Response` própria: a resposta do hook é usada e não é reformatada (caminho `nested`, `src/response.ts:161-165`).
- Cache (D-09): sem alteração em `src/utils/cache.ts` e `src/utils/internal/staged-headers.ts`. Conferir por leitura que `withStagedHeaders` não aplica headers de sucesso em respostas `>= 400` (`src/utils/internal/staged-headers.ts:69-70`) e registrar a conferência na descrição da entrega.
- `pnpm vitest run test/problem-details.test.ts` passa.

Arquivos: `test/problem-details.test.ts`

---

### T-06 — Documentação da opção e dos campos novos

Cobre: RF-01, RF-03, RF-04

Depende de: T-04, T-05

Aceite:
- `docs/1.guide/900.api/1.h3.md`: entrada `problemDetails` na lista de opções, perto de `silent` e `allowMalformedURL` (techspec §3.1). Dizer que o padrão é desligado e que mounts usam a opção do app que renderiza.
- `docs/1.guide/1.basics/6.error.md`: documentar `type` e `instance` na lista de campos e o formato RFC com a opção ligada. Explicar a troca de members (`statusText` e `message` viram `title` e `detail`; `unhandled` não aparece nesse formato, como já diz a nota da linha ~90). Documentar que `error.headers` com `content-type` próprio sobrescreve `problem+json`.
- Os exemplos da documentação batem com o corpo real de `test/problem-details.test.ts`.

Arquivos: `docs/1.guide/900.api/1.h3.md`, `docs/1.guide/1.basics/6.error.md`

---

### T-07 — Verificação final e regressão

Cobre: RF-06

Depende de: T-01, T-02, T-03, T-04, T-05, T-06

Aceite:
- `pnpm vitest run test/problem-details.test.ts test/unit/error.test.ts` passa.
- `pnpm vitest run test/errors.test.ts test/security.test.ts test/json-rpc.test.ts` passa sem alteração nesses arquivos (`test/errors.test.ts:44` e `:140`, `test/security.test.ts:556`).
- `pnpm vitest run` (suíte completa) passa. Se algum teste existente quebrar, a causa é bug na implementação, não ajuste de teste (techspec §3.2).
- `pnpm lint` e `pnpm typecheck` passam.
- `test/unit/package.test.ts` (snapshot de exports) passa sem alteração, confirmando que nenhum export novo foi criado (PRD, Fora de escopo).
- `pnpm build` não é alterado (sem mudança em `package.json` ou `src/_entries/*`).

Arquivos: nenhum (somente verificação)
