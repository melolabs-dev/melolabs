# Tarefas de implementação — Respostas de erro em problem details (RFC 9457)

Referências: `sdd/prd.md` (RF-01 a RF-08), `sdd/techspec.md` (D-01 a D-08, seções 3 a 5), issue h3js/h3#1384.

Ordem sugerida: T-01 e T-02 em paralelo → T-03 → T-04 e T-05 em paralelo → T-06 e T-07 → T-08.
Seguindo `AGENTS.md` (Bug Fix Workflow), os testes das tarefas T-01 e T-02 são escritos e vistos falhando antes da implementação.

### T-01 — Escrever testes de matriz de regressão (vermelho)

**Cobre:** RF-01, RF-02, RF-04, RF-05, RF-06

**Depende de:** nenhuma

**Aceite:**
- `pnpm vitest run test/problem-details.test.ts` roda nos dois alvos (web e node) e os casos de formato falham no estado atual (Content-Type antigo e ausência de `type`/`title`/`instance`).
- Os casos de preservação (`status`, `statusText`, `unhandled`, `message`, `data` de RF-04; ocultação de erro não tratado de RF-05; `headers` de RF-06 com precedência de D-04) podem já passar antes da mudança e devem continuar passando depois.
- Casos cobertos, conforme `sdd/techspec.md` seção 5.1: 404 com problem+json; `kNotFound`; validação de JSON inválido com `readBody` (400); exemplo do PRD (422); `title` padrão quando não há `statusText`; `about:blank` e ausência de `instance`; campos legados com `data: { campo: "slug" }`; erro não tratado com debug desligado e ligado (`stack` só com debug); `Retry-After` em 429; `content-type` informado pelo app prevalece; `onError` que devolve `undefined` e que devolve `Response` própria; erro de `proxyRequest` com corpo upstream repassado sem conversão (D-08).
- Opcional, conforme R-10: caso com `BodyTooLargeError` do `srvx` (erro com `name === "HTTPError"`), se for viável montá-lo no teste.

**Arquivos:**
- `test/problem-details.test.ts` (novo)

### T-02 — Escrever testes unitários de HTTPError e getStatusText (vermelho)

**Cobre:** RF-02, RF-03, RF-05

**Depende de:** nenhuma

**Aceite:**
- `pnpm vitest run test/unit/problem-details.test.ts` falha antes de T-03 e T-04 (import inexistente e propriedades `type`/`instance` ausentes).
- Casos conforme `sdd/techspec.md` seção 5.2: `type` e `instance` informados e ausentes (`undefined`); leitura de `type` e `instance` a partir de `cause` quando ausentes em `details` (D-06); `toJSON()` com `unhandled: true` (`detail === "HTTPError"`, sem `data`, sem `body`); `toJSON()` com `body: { trace: "abc" }` mantendo `trace` no corpo; `getStatusText` para 404, 422, 299, 499 e 599.

**Arquivos:**
- `test/unit/problem-details.test.ts` (novo)

### T-03 — Criar tabela de frases padrão RFC 9110

**Cobre:** RF-02

**Depende de:** T-02

**Aceite:**
- `getStatusText(404) === "Not Found"`, `getStatusText(422) === "Unprocessable Content"`, e `undefined` para 299, 499 e 599.
- A tabela contém somente códigos definidos na RFC 9110 (sem códigos de extensão).
- O módulo não importa `src/utils/response.ts` nem `src/error.ts` (sem ciclo de importação), e não reutiliza `STATUS_TEXT` (D-03).
- Os testes de `getStatusText` de T-02 passam.

**Arquivos:**
- `src/utils/internal/status-text.ts` (novo)

### T-04 — Estender HTTPError com type e instance e montar o corpo RFC 9457 em toJSON

**Cobre:** RF-02, RF-03, RF-04, RF-05

**Depende de:** T-01, T-02, T-03

**Aceite:**
- `ErrorInput` aceita `type?: string` e `instance?: string`. A classe expõe `readonly type` e `readonly instance`, lidos de `details` e, na falta, de `details.cause` (D-06). Nenhum outro nome público novo.
- `toJSON()` monta o corpo na ordem da D-05: membros RFC (`type` com fallback `"about:blank"`, `title` com `statusText` ou `getStatusText`, `status`, `detail`, `instance`), depois os legados (`statusText`, `unhandled`, `message`, `data`) e por fim `...body`. Conforme `sdd/techspec.md` seção 4.
- Com `unhandled`, `detail` e `message` valem `"HTTPError"`, e `data` e `body` ficam fora (D-07).
- `JSON.stringify(new HTTPError({ status: 400 }))` não tem a chave `instance`.
- O tipo `ProblemDetails` fica interno (não exportado) e com anotação de retorno explícita, por causa de `isolatedDeclarations`.
- Os casos de T-01 e T-02 relativos a `HTTPError` passam. `pnpm typecheck` passa.

**Arquivos:**
- `src/error.ts`

### T-05 — Trocar o Content-Type padrão de erro para application/problem+json

**Cobre:** RF-01, RF-06

**Depende de:** T-01

**Aceite:**
- Em `errorResponse`, o padrão passa a ser `problemHeaders` (`application/problem+json`), no lugar de `jsonHeaders`. A ordem de merge fica igual: `error.headers` e depois `errHeaders` sobrescrevem o padrão (D-04).
- `jsonHeaders` não muda. Respostas de sucesso continuam `application/json;charset=UTF-8`, o que a suíte existente deve confirmar.
- Os casos de T-01 de RF-01, RF-06 e D-04 passam (404, validação, `kNotFound`, `Retry-After` com problem+json, `content-type` do app prevalece).

**Arquivos:**
- `src/response.ts`

### T-06 — Ajustar as asserções de formato antigo em test/errors.test.ts

**Cobre:** RF-07

**Depende de:** T-04, T-05

**Aceite:**
- Em `test/errors.test.ts`, a linha 44 passa a esperar `"application/problem+json"`, e a linha 140 passa a usar `toMatch("application/problem+json")` (D-04 e seção 5.3 do techspec).
- O diff de `test/errors.test.ts` toca só essas duas asserções.
- `pnpm vitest run test/errors.test.ts` passa.
- Se outro teste falhar por Content-Type ou corpo exato (por exemplo `test/proxy.test.ts:1531`), o ajuste é feito caso a caso, só na asserção de formato, e registrado no relatório final.

**Arquivos:**
- `test/errors.test.ts`
- Outro arquivo de teste somente se a execução mostrar falha de formato (ver aceite)

### T-07 — Registrar utils/internal/status-text.ts na árvore do AGENTS.md

**Cobre:** nenhum RF diretamente (manutenção exigida por `AGENTS.md` quando há mudança arquitetural)

**Depende de:** T-03

**Aceite:**
- O bloco `utils/internal/` da árvore em `AGENTS.md` lista `status-text.ts` com comentário curto, mantendo o alinhamento do bloco.
- `pnpm lint` não acusa formatação no arquivo.
- Nenhum outro trecho de `AGENTS.md` muda. Documentação externa (`docs/`, README) não é alterada (PRD, "Fora de escopo").

**Arquivos:**
- `AGENTS.md`

### T-08 — Verificação final: suíte completa, lint e typecheck

**Cobre:** RF-07, RF-08

**Depende de:** T-06, T-07

**Aceite:**
- `pnpm vitest run` termina sem falhas.
- `pnpm lint` e `pnpm typecheck` terminam sem erros (RF-08).
- A lista de arquivos de teste alterados é só a das seções 5.1, 5.2 e 5.3 do techspec (RF-07).
- Se `pnpm test` (com coverage) for executado, o relatório informa o resultado.
- Se a verificação revelar falha, a correção é mínima e o relatório final diz o que foi corrigido. Se algo não passar, o relatório diz o que falhou, com a saída.

**Arquivos:**
- Nenhum arquivo novo. Ajustes pontuais somente se a verificação exigir, e registrados no relatório.

---

## Decisões em aberto assumidas nas tarefas

As tarefas seguem as recomendações do `sdd/techspec.md`. Se o responsável decidir de outro jeito, as tarefas afetadas mudam:

- **R-01 (body sobrescreve membros RFC):** T-04 mantém `...body` por último, como hoje.
- **R-05 (title ausente fora da tabela):** T-03 e T-04 deixam `title` ausente nesse caso. Usar `"Unknown Status"` altera RF-02.
- **R-06 e PRD, "Riscos" (changelog):** T-07 e T-08 não editam `CHANGELOG.md`, que é gerado pelo fluxo de release. Se o responsável quiser a nota de mudança no arquivo, vira uma tarefa própria.
- **Tensão de contrato (PRD, "Riscos"):** a troca do Content-Type como padrão, sem opção de configuração, segue o PRD. Se o responsável preferir release major, isso não altera as tarefas de código, só a nota de release.

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-05 |
| RF-02 | T-01, T-02, T-03, T-04 |
| RF-03 | T-02, T-04 |
| RF-04 | T-01, T-04 |
| RF-05 | T-01, T-02, T-04 |
| RF-06 | T-01, T-05 |
| RF-07 | T-06, T-08 |
| RF-08 | T-08 |
