# Tarefas de implementação — Respostas de erro em problem details (RFC 9457)

Base: `sdd/prd.md` (RF-01 a RF-05), `sdd/techspec.md` (decisões D-01 a D-09, seção 8 para a ordem sugerida).

Ordem: testes primeiro (AGENTS.md, "Bug Fix Workflow"), depois implementação, depois ajuste dos testes antigos e verificação.

**Pendências antes de começar:** as questões Q1 a Q4 da techspec (seção 7) não foram confirmadas. Q1 (versionamento, premissa P1 do PRD) bloqueia a publicação, mas não impede escrever os testes e o código. T-01 a T-05 podem começar com as decisões D-01 a D-09 como estão na techspec.

---

### T-01 — Testes de regressão da resposta de erro

**Cobre:** RF-01, RF-03, RF-04

**Depende de:** nenhuma

**Aceite:** criar `test/problem-details.test.ts` com `describeMatrix` (web e node), cobrindo os cenários da seção 5.1 da techspec: 404 com `title`/`detail`/`type`; `data` e `body` como extensões; membros RFC com precedência sobre chaves `status`/`detail` de `body`; `type` e `instance` informados e ausentes; `title` pela frase IANA quando não há `statusText`; código fora da tabela sem `title`; erro não tratado com debug desligado (sem `"senha do banco"` e sem `stack`) e com debug ligado (com `stack`); `headers` do erro e `errHeaders`; HEAD sem corpo; `onError`. Executar `pnpm vitest run test/problem-details.test.ts` e confirmar que os cenários novos **falham** pelo formato antigo, antes de qualquer mudança em `src/`.

**Arquivos:** `test/problem-details.test.ts`

---

### T-02 — Testes unitários de `HTTPError` e de tipos

**Cobre:** RF-02, RF-05

**Depende de:** nenhuma

**Aceite:** criar testes unitários em `test/unit/` (seção 5.2 da techspec) cobrindo: `type` e `instance` informados são expostos; ausentes resultam em `undefined`; `cause` com `type`/`instance` não é copiado (D-06); `type: 42` vira `undefined`; `HTTPError.status(400, "Bad Request", { message: "Inválido" }).toJSON()` é comparado com um objeto literal escrito no teste, com o formato atual. Acrescentar em `test/unit/types.test-d.ts` as asserções `expectTypeOf` de `ErrorInput["type"]`, `ErrorInput["instance"]`, `HTTPError["type"]` e `HTTPError["instance"]` (seção 5.3). Confirmar que os testes de `type`/`instance` falham antes da implementação. O teste de `toJSON()` deve **passar** já agora, pois RF-05 exige que ele não mude.

**Arquivos:** `test/unit/http-error.test.ts`, `test/unit/types.test-d.ts`

---

### T-03 — Campos `type` e `instance` em `HTTPError`

**Cobre:** RF-02

**Depende de:** T-02

**Aceite:** em `src/error.ts`, `ErrorInput` aceita `type?: string` e `instance?: string` (com comentário JSDoc, como os demais campos). A classe declara `readonly type` e `readonly instance`, preenchidos no construtor após `this.body`, lendo só de `details` e aceitando só strings (D-06). `toJSON()` não muda. Nenhum export novo em `src/index.ts`. `pnpm vitest run test/unit/` passa e `pnpm typecheck` (via `pnpm lint`) passa. O arquivo continua abaixo de 200 linhas, ou a diferença fica registrada na tarefa.

**Arquivos:** `src/error.ts`

---

### T-04 — Helper `toProblemDetails` e tabela de frases

**Cobre:** RF-01, RF-03, RF-04

**Depende de:** T-03

**Aceite:** criar `src/utils/internal/problem.ts` com `ProblemDetails`, `toProblemDetails(error, debug)` e `kReasonPhrases` (frases IANA para os códigos de 1xx a 5xx, enxuta). Seguir D-02, D-03, D-04, D-05 e D-09: extensões (`body`, `data`, `unhandled`, `stack`) antes dos membros RFC; `type` = `"about:blank"` por padrão; `title` = `statusText` ou frase IANA, ignorando `statusText` quando `unhandled`; `unhandled` usa `detail: "HTTPError"` e não inclui `type`, `instance`, `data` nem `body`; `instance` só aparece quando existe. Não usar `toJSON()` como fonte. Verificar com `pnpm lint` que não há spread ou objeto sem efeito. Verificar que o arquivo fica abaixo de 200 linhas.

**Arquivos:** `src/utils/internal/problem.ts`

---

### T-05 — `errorResponse` com `application/problem+json`

**Cobre:** RF-01, RF-03, RF-04

**Depende de:** T-04

**Aceite:** em `src/response.ts`, `errorResponse()` usa `problemHeaders` com `content-type: application/problem+json` (sem `charset`, D-07). O corpo é `JSON.stringify(toProblemDetails(error, debug), undefined, debug ? 2 : undefined)`. `jsonHeaders` continua para respostas de sucesso. `FrozenHeaders` é declarada antes de `problemHeaders`. `prepareResponse()` não muda. Se `HTTPError.headers` definir `content-type`, o valor do erro continua vencendo (P4). Rodar `pnpm vitest run test/problem-details.test.ts` e confirmar que os cenários de T-01 passam.

**Arquivos:** `src/response.ts`

---

### T-06 — Ajustar testes existentes ao novo formato

**Cobre:** RF-01, RF-04, RF-05

**Depende de:** T-05

**Aceite:** atualizar apenas as asserções que mudam com o formato, conforme a seção 3 da techspec. Em `test/errors.test.ts`: `content-type` (linhas 44 e 140); `statusText` → `title` e `message` → `detail` (linhas 53–57, 79–84, 99–104); `message: "HTTPError"` → `detail: "HTTPError"` na linha 350, mantendo `unhandled: true`. Em `test/router.test.ts` (110–112): `message` → `detail`. Em `test/body.test.ts` (457): `statusText` → `title`, mantendo `stack` (458). Em `test/body-limit.test.ts` (120–122): `message` → `detail`. Conferir `test/handler.test.ts` (206–402) e `test/validate.test.ts` (55–70, 160–200, 233, 335) e alterar só onde a asserção é sobre o corpo da resposta. Não remover asserções de status, cabeçalhos extras ou mascaramento de erro não tratado. `test/json-rpc.test.ts` não muda (D-08 e formato de protocolo). Rodar `pnpm vitest run test/errors.test.ts test/router.test.ts test/body.test.ts test/body-limit.test.ts test/handler.test.ts test/validate.test.ts` e confirmar que passam.

**Arquivos:** `test/errors.test.ts`, `test/router.test.ts`, `test/body.test.ts`, `test/body-limit.test.ts`, `test/handler.test.ts`, `test/validate.test.ts`

---

### T-07 — Verificação completa e build

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05

**Depende de:** T-06

**Aceite:** `pnpm test` passa (lint, typecheck e cobertura). `pnpm build` gera o bundle com o novo arquivo interno em `utils/internal`, e `test/dist.test.ts` passa. Conferir manualmente que `Content-Type` das respostas de erro é `application/problem+json` e que o corpo de um erro não tratado não contém a mensagem interna. Se algum teste falhar, o relatório da tarefa informa a saída do teste, sem marcar como concluída. Se `pnpm build` ou `pnpm test` não rodarem no ambiente, registrar o motivo.

**Arquivos:** nenhum arquivo novo; verificação de `package.json` (scripts), `test/dist.test.ts`

---

### T-08 — Changelog com antes e depois

**Cobre:** RF-01

**Depende de:** T-07

**Aceite:** adicionar entrada no changelog do projeto (ou no local que o projeto usar para notas de versão) descrevendo a mudança como quebra de contrato (`Content-Type` e forma do corpo de erro), com exemplo do corpo antes e depois, conforme R-01 da techspec. A versão e o tipo de release (major ou minor) dependem da resposta à Q1; a entrada fica como rascunho se Q1 não estiver confirmada.

**Arquivos:** `CHANGELOG.md` (ou o arquivo de notas de versão existente no repositório)
