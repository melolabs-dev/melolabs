# Tarefas de implementação — Problem details (RFC 9457)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08, R-01 a R-09).

Ordem de trabalho: os testes são escritos primeiro (T-01) e precisam falhar antes de qualquer mudança em `src/` (fluxo de bug fix do `AGENTS.md`).

## Tarefas

### T-01 — Escrever os testes novos de problem details

Cobre: RF-01, RF-02, RF-04, RF-05, RF-06, RF-07
Depende de: nenhuma
Aceite: `test/problem-details.test.ts` existe, usa `describeMatrix` e cobre os casos da techspec seção 7 (404 com `application/problem+json`; 403 com `title`, `detail` e `type: "about:blank"`; 404 sem `statusText` com `title: "Not Found"`; ausência da chave `instance`; erro `unhandled` sem a string "senha do banco inválida", sem `stack`, sem `data` e com status 500; `stack` só com `debug`; 429 com `retry-after`; `data` e membros de `body` no topo com `message` igual a `detail`). Rodando `pnpm vitest run test/problem-details.test.ts` antes das mudanças em `src/`, os casos de formato devem falhar. A guarda de sucesso (`return { a: 1 }` com `application/json;charset=UTF-8`) deve passar.
Arquivos: `test/problem-details.test.ts`

### T-02 — Teste unitário e módulo de frases de status

Cobre: RF-02
Depende de: nenhuma
Aceite: `src/utils/internal/status-text.ts` exporta `getReasonPhrase(status: number): string | undefined`, com frases RFC 9110 para 4xx e 5xx e sem nenhum import (evita ciclo, techspec D-05). Um teste em `test/unit/status-text.test.ts` verifica `getReasonPhrase(404) === "Not Found"` e `getReasonPhrase(499) === undefined`. `pnpm vitest run test/unit/status-text.test.ts` passa.
Arquivos: `src/utils/internal/status-text.ts`, `test/unit/status-text.test.ts`

### T-03 — Campos `type` e `instance` em `ErrorBody` e `HTTPError`

Cobre: RF-03
Depende de: T-01
Aceite: `ErrorBody` tem `type?: string` e `instance?: string` com JSDoc. A classe `HTTPError` tem `readonly type` e `readonly instance`, preenchidos no construtor com `details` e com fallback para `details.cause`, como `statusText` e `headers` (techspec D-06, seção 5). Os testes de RF-03 em `test/problem-details.test.ts` passam, incluindo a herança por `cause`. Nenhum outro nome público novo é criado. O JSDoc que diz que `message` vai "under `message` key" e o TIP de `statusText` são atualizados (techspec seção 4).
Arquivos: `src/error.ts`, `test/problem-details.test.ts`

### T-04 — `toJSON()` devolve o corpo problem details

Cobre: RF-02, RF-04, RF-07
Depende de: T-02, T-03
Aceite: `HTTPError.toJSON()` monta o objeto com `...this.body` primeiro e os membros do h3 depois (D-04), na ordem `type`, `title`, `status`, `detail`, `instance`, `message`, `statusText`, `unhandled`, `data` (techspec seção 5). `title` vem de `statusText` ou de `getReasonPhrase(status)`. Para `unhandled`, `detail` e `message` valem `"HTTPError"`, `data` e `body` somem e `title` cai na frase padrão (D-07). `instance` é omitido quando ausente. Os testes de RF-02, RF-04, RF-07 e D-04 em `test/problem-details.test.ts` passam. Os testes existentes de `test/errors.test.ts` que leem `status`, `statusText`, `message`, `data`, `topLevel` e `unhandled` continuam passando (techspec seção 7).
Arquivos: `src/error.ts`, `test/problem-details.test.ts`

### T-05 — `Content-Type` `application/problem+json` em `errorResponse()`

Cobre: RF-01, RF-05, RF-06
Depende de: T-01
Aceite: `src/response.ts` declara `problemHeaders` com `content-type: application/problem+json` (sem charset, D-02), logo após `jsonHeaders`. `errorResponse()` usa `problemHeaders` no lugar de `jsonHeaders` e mantém a mesclagem de `error.headers` e o `stack` apenas com `debug` (D-08). O caminho de sucesso (`src/response.ts:311`) não muda. Os testes de RF-01, RF-05 e RF-06 em `test/problem-details.test.ts` passam.
Arquivos: `src/response.ts`, `test/problem-details.test.ts`

### T-06 — Ajustar os testes existentes que checam o formato antigo

Cobre: RF-08
Depende de: T-05
Aceite: em `test/errors.test.ts`, a linha 44 passa a esperar `application/problem+json` no lugar de `application/json;charset=UTF-8`, e a linha 140 passa a usar `toMatch("application/problem+json")` no lugar de `toMatch("application/json")`. Nenhuma outra asserção é removida. Os demais testes listados na techspec seção 7 passam sem mudança.
Arquivos: `test/errors.test.ts`

### T-07 — Verificação final da suíte, lint, typecheck e build

Cobre: RF-08
Depende de: T-04, T-05, T-06
Aceite: `pnpm vitest run` passa por completo. `pnpm lint` passa. `pnpm typecheck` passa, porque `pnpm lint` não roda `tsc` (techspec R-09). `pnpm build` passa e `test/dist.test.ts` passa sobre o build. Opcional: `pnpm bench:node` para medir o impacto do payload de erro (PRD, riscos; techspec R-05). Qualquer falha é reportada com a saída, sem ser omitida.
Arquivos: nenhum arquivo de código; só execução de comandos (scripts do manifesto do projeto como referência)

## Pendências fora das tarefas

Estas decisões não bloqueiam a implementação, mas precisam de resposta do responsável antes do merge (techspec seção 9):

- Aceitar a quebra de `content-type` para clientes que checam `application/json` (R-01, RF-01).
- Aprovar a precedência de `body` (D-04, R-03) e a mudança de `toJSON()` (D-01, R-02).
- Registrar no changelog a mudança de `JSON.stringify(httpError)`, a precedência de `body` e o novo `content-type`.
- Confirmar se o projeto tem changelog; a techspec não diz onde ele fica.
