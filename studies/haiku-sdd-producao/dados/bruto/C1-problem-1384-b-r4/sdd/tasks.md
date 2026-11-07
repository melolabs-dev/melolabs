# Tarefas — Problem details (RFC 9457) como formato padrão de erro

Referências: `sdd/prd.md` (RF-01 a RF-10), `sdd/techspec.md` (D-01 a D-10, seções 3 a 6).

## Pendências antes de implementar

- **Premissa de `title` (techspec D-03).** O PRD diz que `title` fica ausente sem `statusText`, mas RF-05 exige `title` no erro não tratado. A techspec propõe uma tabela interna de frases (T-02). Confirmar com o solicitante antes de T-02 e T-04.
- **"Não quebrar o que já existe" (PRD, Riscos).** A leitura adotada é: a API de `HTTPError` não muda e a quebra é só no corpo e no `Content-Type` de erros. Confirmar antes de T-04.

## Ordem sugerida

T-01 e T-02 podem começar em paralelo. T-03 vem depois de T-01. T-04 depois de T-02 e T-03. T-05 depois de T-04. T-06 e T-08 depois de T-05. T-07 depois de T-05 e T-06. T-09 é a última.

---

### T-01 — Testes de problem details (escritos antes da implementação)

Criar `test/problem-details.test.ts` com `describeMatrix`, para rodar em `web` e `node`. Cada teste segue o formato de `test/_setup.ts`. Os casos ficam na tabela de `techspec.md` seção 6. Rodar o arquivo antes das mudanças de código e confirmar que os testes de formato falham. Os testes de `HTTPError` do RF-03 usam `new HTTPError(...)` direto, fora do matrix.

Casos a cobrir:
- 404 com `message` e `statusText` gera `status`, `title`, `detail` e `type: "about:blank"`, sem `instance` (RF-01).
- Erro 400 gera `content-type` exato `application/problem+json`. Rota que retorna objeto com 200 continua `application/json;charset=UTF-8` (RF-02).
- `data` e `body` aparecem no topo. `body: { status: 200 }` não muda o status (RF-04).
- `new Error("senha do banco: 123")` gera 500, `title: "Internal Server Error"`, `detail: "HTTPError"`, e a string `"senha do banco"` não aparece no corpo. Também com `data` e `body` preenchidos num `HTTPError` `unhandled` (RF-05).
- Sem `debug`, o corpo não tem `stack`. Com `debug: true`, `stack` é array de strings (RF-06).
- `GET /inexistente` responde 404 com `application/problem+json` e `status: 404`. Também cobrir validação de body e 405 de `static` (RF-07).
- `new HTTPError({ status: 401, headers: { "WWW-Authenticate": "Basic" } })` gera o header e `application/problem+json` (RF-09).

- **Cobre:** RF-01, RF-02, RF-04, RF-05, RF-06, RF-07, RF-09
- **Depende de:** nenhuma
- **Aceite:** o arquivo existe, usa `describeMatrix`, cobre os casos acima e falha nos casos de formato antes da implementação. Os casos de `HTTPError` direto (RF-03) ficam no mesmo arquivo e podem passar ou falhar nesta etapa.
- **Arquivos:** `test/problem-details.test.ts`

---

### T-02 — Tabela interna de frases padrão

Criar `src/utils/internal/status.ts` com `kReasonPhrases` (não exportado publicamente) e a função `reasonPhrase(status: number): string | undefined`. A tabela cobre 400, 401, 403, 404, 405, 413, 415, 500, 502, 503 e 504. Para códigos fora dela, a função retorna `undefined`. Não exportar nada em `src/index.ts`. Ver techspec D-03 e seção 4.4.

- **Cobre:** RF-01 (fallback de `title`)
- **Depende de:** nenhuma (depende da confirmação da pendência de `title`)
- **Aceite:** `reasonPhrase(500) === "Internal Server Error"`, `reasonPhrase(404) === "Not Found"`, `reasonPhrase(299) === undefined`. Nenhuma linha nova em `src/index.ts`. Typecheck passa.
- **Arquivos:** `src/utils/internal/status.ts`

---

### T-03 — Campos `type` e `instance` em `HTTPError`

Em `src/error.ts`:
- Adicionar `type?: string` e `instance?: string` em `ErrorInput` (linha 6), com JSDoc citando a RFC 9457. Não colocar esses campos em `ErrorBody`.
- Declarar `readonly type: string` e `readonly instance: string | undefined` na classe (linha 74), junto de `data` e `body`.
- No construtor (linhas 199-209): `this.type = (details as ErrorInput)?.type || "about:blank"` e `this.instance = (details as ErrorInput)?.instance`.
- Não ler `type` nem `instance` de `details.cause` (D-07).

Assinaturas existentes ficam iguais (RF-08).

- **Cobre:** RF-03, RF-08
- **Depende de:** T-01
- **Aceite:** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/pagamentos/42" })` expõe os valores. `new HTTPError({ status: 403 })` tem `type === "about:blank"` e `instance === undefined`. `type` e `instance` de `cause` são ignorados. `test/errors.test.ts` e `test/unit/` passam sem mudança de assinatura.
- **Arquivos:** `src/error.ts`

---

### T-04 — `HTTPError.toJSON()` no formato RFC 9457

Reescrever `toJSON()` em `src/error.ts` (linhas 226-236) seguindo `techspec.md` seção 4.1:
- Espalhar `...this.body` primeiro, só quando não é `unhandled` (D-04, D-06).
- Depois, `type`, `title` (`this.statusText || reasonPhrase(this.status)`), `status`, `detail` (`this.message`), `instance` e `data`, com os membros RFC vencendo sobre `body` (D-04).
- Para `unhandled`: `type: "about:blank"`, `detail: "HTTPError"`, sem `instance`, sem `data`, sem `body` (D-06).
- Não sair `message`, `statusText` nem `unhandled` do topo (D-05).
- O tipo de retorno fica inline, sem tipo novo exportado (`isolatedDeclarations`).

- **Cobre:** RF-01, RF-04, RF-05, RF-08
- **Depende de:** T-02, T-03
- **Aceite:** o teste de RF-04 (`body: { status: 200 }` não muda o status) e de RF-05 (`senha do banco` ausente, `title` da tabela) passam. `JSON.stringify(new HTTPError({ status: 404 }))` não tem `undefined` nem `instance`. `HTTPError.isError` continua `true`. `pnpm typecheck` passa, incluindo a checagem de `isolatedDeclarations`.
- **Arquivos:** `src/error.ts`

---

### T-05 — `errorResponse()` com `application/problem+json`

Em `src/response.ts`:
- Adicionar `problemHeaders` (`FrozenHeaders`, `content-type: application/problem+json`, sem `charset`) ao lado de `jsonHeaders` (linhas 270-272), no mesmo padrão de `FrozenHeaders` (D-02).
- Em `errorResponse()` (linhas 358-380), trocar `jsonHeaders` por `problemHeaders` (linha 360). Manter `stack` só com `debug` (linha 369).
- `jsonHeaders` continua sendo usado nas respostas de sucesso.
- Conferir que `errHeaders` com `set-cookie` continua aparecendo uma vez (regressão de `src/response.ts:167-173`).

- **Cobre:** RF-02, RF-06, RF-09
- **Depende de:** T-04
- **Aceite:** respostas de erro vêm com `content-type: application/problem+json` (exato). Respostas de 200 continuam `application/json;charset=UTF-8`. Com `debug` desligado não há `stack`, e com ele ligado há `stack` como array. O header `WWW-Authenticate` do erro aparece. Teste de `set-cookie` passa. `HEAD` em rota inexistente continua sem corpo (`test/errors.test.ts:17-24`).
- **Arquivos:** `src/response.ts`

---

### T-06 — Erros internos do h3 no novo formato

Confirmar que os erros produzidos pelo próprio h3 passam por `errorResponse()` e saem no novo formato (RF-07):
- 404 de rota inexistente (`src/response.ts:140`).
- 405 de `src/utils/static.ts:121`.
- Falha de validação de body (`src/utils/body.ts:225`) e de validação em geral (`src/utils/internal/validate.ts:217-230`). Esse arquivo não muda (D-09). `title` vem de `statusText: "Validation failed"`, `detail` de `message`, e `data.issues` continua em `data`.
- `onError` do app que devolve `Response` própria não é afetado (techspec seção 6).

Se algum desses caminhos não passar por `errorResponse()`, corrigir apenas esse caminho.

- **Cobre:** RF-07
- **Depende de:** T-05
- **Aceite:** em `test/problem-details.test.ts`, os casos de RF-07 passam em `web` e `node`. Erro de validação mantém `title: "Validation failed"` e `data.issues`. `onError` do app com `Response` própria continua devolvendo a resposta dele.
- **Arquivos:** `src/response.ts`, `src/utils/body.ts`, `src/utils/static.ts` (somente se algum caminho precisar de ajuste), `test/problem-details.test.ts`

---

### T-07 — Adaptar testes existentes ao novo formato

Ajustar os testes listados em `techspec.md` seção 3.5, trocando só nomes de campo e media type. Cada teste mantém a verificação original (status, mensagem, mascaramento, debug):
- `test/errors.test.ts`: linhas 44, 140, 146-150, 257, 309, 350, 384, 420, 442. Em 350, `t.errors[0].unhandled` (linha 351) continua igual.
- `test/app.test.ts:205`: `.statusText` vira `.title`.
- `test/body.test.ts:457`: `resultJson.statusText` vira `resultJson.title`. `stack[0]` (linha 458) fica igual.
- `test/iterable.test.ts:145`, `test/dist.test.ts:57`, `test/rules/cache.test.ts:251`: `.message` vira `.detail`.
- `test/handler.test.ts:222,238,272` e `test/route.test.ts:72`: `statusText`/`message` viram `title`/`detail`. `data.issues` fica igual.

Antes de editar, rodar `grep` em `test/` por `\.json()` e `text()` seguido de `statusText`, `message` e `unhandled`, para confirmar que a lista está completa. Testes que só checam `res.statusText` (`test/errors.test.ts:43`, `test/mount.test.ts:294`) não mudam.

- **Cobre:** RF-10
- **Depende de:** T-05, T-06
- **Aceite:** `pnpm vitest run test/errors.test.ts test/body.test.ts test/app.test.ts test/handler.test.ts test/route.test.ts test/iterable.test.ts test/dist.test.ts test/rules/cache.test.ts` passa. A busca por `statusText`/`message`/`unhandled` em corpos JSON de `test/` não retorna nada que sobrou sem justificativa.
- **Arquivos:** `test/errors.test.ts`, `test/app.test.ts`, `test/body.test.ts`, `test/iterable.test.ts`, `test/dist.test.ts`, `test/rules/cache.test.ts`, `test/handler.test.ts`, `test/route.test.ts`

---

### T-08 — Documentação do formato de erro

Atualizar `docs/1.guide/1.basics/6.error.md`:
- Trocar o exemplo de corpo JSON (linhas 43-44) pelo formato novo.
- Descrever `type`, `instance` e a troca de `message` por `detail` (linhas 54, 60, 76).
- Atualizar a lista de campos ocultos em erros não tratados (linha 90): passam a ser `type`, `instance`, `data`, `body` e `detail`.
- Citar a mudança de `Content-Type` para `application/problem+json`.

Não editar `CHANGELOG.md`. A release gera esse arquivo.

- **Cobre:** RF-01, RF-04, RF-05
- **Depende de:** T-05
- **Aceite:** o exemplo do guia tem o mesmo shape que `techspec.md` seção 5. A página cita `application/problem+json`. Nenhum exemplo do guia mostra `message`, `statusText` ou `unhandled` no topo do corpo de erro.
- **Arquivos:** `docs/1.guide/1.basics/6.error.md`

---

### T-09 — Verificação final

Rodar, nesta ordem:
1. `pnpm vitest run test/problem-details.test.ts`
2. `pnpm lint` (oxlint + oxfmt --check)
3. `pnpm typecheck`
4. `pnpm test` (lint, typecheck e cobertura)
5. `pnpm build`, e conferir que `dist/*.d.mts` não tem tipos não exportados referenciados por `toJSON()` ou `HTTPError`

Se algum comando falhar, relatar a saída e não declarar a tarefa concluída.

- **Cobre:** RF-10
- **Depende de:** T-07, T-08
- **Aceite:** os cinco comandos terminam sem erro. Se houver falha, a saída fica registrada no relatório.
- **Arquivos:** nenhum (somente execução de comandos)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --------- | ------- |
| RF-01 | T-01, T-02, T-04, T-08 |
| RF-02 | T-01, T-05 |
| RF-03 | T-01, T-03 |
| RF-04 | T-01, T-04, T-08 |
| RF-05 | T-01, T-04, T-08 |
| RF-06 | T-01, T-05 |
| RF-07 | T-01, T-06 |
| RF-08 | T-03, T-04, T-07 |
| RF-09 | T-01, T-05 |
| RF-10 | T-07, T-09 |
