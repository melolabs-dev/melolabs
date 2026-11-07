# Tarefas de implementação — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/prd.md` (RF-01 a RF-05) e `sdd/techspec.md` (D-01 a D-09, seções 3 a 5).

Ordem geral: a suíte nova (T-01) é escrita e confirmada vermelha antes de qualquer alteração em `src/` (fluxo "Bug Fix Workflow" do AGENTS.md).

Mapa de cobertura:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-04, T-06 |
| RF-02 | T-01, T-02, T-04 |
| RF-03 | T-01, T-03, T-06 |
| RF-04 | T-01, T-04 |
| RF-05 | T-05, T-07 |

---

### T-01 — Suíte de regressão de problem details (vermelha)

**Cobre:** RF-01, RF-02, RF-03, RF-04

**Depende de:** nenhuma

**Aceite:**
- `test/problem-details.test.ts` existe e usa `describeMatrix`, então cada caso roda em `web` e `node`.
- Cobre os casos da tabela da seção 5.1 do techspec: status 404 com `application/problem+json` exato e corpo `{type, title, status, detail}`; erro sem `type` com `data`; `body` com chaves `status`, `title`, `type` que não sobrescrevem a RFC; `title` padrão quando não há `statusText`; ausência de `title` para status sem frase; `type` e `instance` na instância e no corpo; ausência de `instance`; `unhandled` com `Error("segredo do banco")` sem vazar `detail` nem `stack`; `unhandled` sem `type` e `instance` no corpo; `stack` apenas em debug; `headers` e `errHeaders` mantidos; HEAD sem corpo; `onError` que devolve `Response` própria; snapshot de `toJSON()` igual ao formato atual (D-02).
- Antes de qualquer mudança em `src/`, `pnpm vitest run test/problem-details.test.ts` falha pelos motivos esperados (formato antigo, `type`/`instance` inexistentes). Os casos de compatibilidade e de `toJSON()` podem passar desde já; isso é esperado e deve ser anotado.

**Arquivos:** `test/problem-details.test.ts`

---

### T-02 — Tabela interna de frases RFC 9110

**Cobre:** RF-02

**Depende de:** nenhuma

**Aceite:**
- `src/utils/internal/status-text.ts` exporta `REASON_PHRASES` como `Readonly<Record<number, string>>`, sem exportação pública em `src/index.ts`.
- O mapa cobre os códigos 4xx e 5xx definidos na RFC 9110 (ex.: `404: "Not Found"`, `500: "Internal Server Error"`), com as frases exatas da RFC.
- `src/utils/response.ts` (tabela `STATUS_TEXT`, D-05) não é alterado.
- O arquivo tem menos de 200 linhas e segue as convenções do AGENTS.md (sem barrel, import com `.ts`).
- `pnpm typecheck` passa.

**Arquivos:** `src/utils/internal/status-text.ts`

---

### T-03 — `type` e `instance` em `ErrorInput` e `HTTPError`

**Cobre:** RF-03

**Depende de:** T-01

**Aceite:**
- `ErrorInput` aceita `type?: string` e `instance?: string`, com JSDoc citando RFC 9457 §3.1.1 e §3.1.5.
- `HTTPError` declara `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor após `this.body`, sem fallback por `cause` (D-06).
- `new HTTPError({ status: 403, type: "https://example.com/probs/sem-permissao", instance: "/pedidos/42" })` expõe os dois valores na instância.
- Nenhum outro nome público novo é criado; `toJSON()` não muda (D-02).
- `pnpm typecheck` passa.

**Arquivos:** `src/error.ts`

---

### T-04 — Renderização RFC 9457 em `errorResponse()`

**Cobre:** RF-01, RF-02, RF-04

**Depende de:** T-02, T-03

**Aceite:**
- Existe `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, sem `charset`) ao lado de `jsonHeaders`, que continua usado nas respostas de sucesso (D-03).
- `toProblemDetails(error)` é função interna em `src/response.ts`, não exportada (D-02, opção c). Os membros da RFC são atribuídos por último, então `data` e `body` não os sobrescrevem (D-04).
- `type` padrão `about:blank`; `title` vem de `statusText` ou de `REASON_PHRASES`, e fica ausente se nenhum existir; `instance` e `detail` ficam ausentes para `unhandled`; `data` e `body` ficam ausentes para `unhandled`; `unhandled` sai do corpo (D-07).
- `stack` aparece só com `debug`, como hoje.
- `errorResponse()` aplica `problemHeaders` e mescla `error.headers` e `errHeaders` como antes.
- `pnpm vitest run test/problem-details.test.ts` passa em `web` e `node`.
- `pnpm typecheck` passa.

**Arquivos:** `src/response.ts`, `src/utils/internal/status-text.ts` (uso)

---

### T-05 — Ajuste dos testes existentes que assertam o formato antigo

**Cobre:** RF-05

**Depende de:** T-04

**Aceite:**
- Cada alteração segue a tabela da seção 5.2 do techspec (troca só a forma: `statusText` → `title`, `message` → `detail`, `unhandled: true` → ausência de `detail`, `application/json` → `application/problem+json`), sem remover asserts nem casos de teste.
- Ajustes previstos: `test/errors.test.ts` (linhas 44, 53-57, 79-85, 99-104, 140, 144-150, 257, 309, 350, 384, 420, 442); `test/body.test.ts` (457); `test/body-limit.test.ts` (120-122); `test/validate.test.ts` (182-183, 194-196, 279-280, 288-290, 379-381).
- Falhas de outros arquivos (ex.: `test/json-rpc.test.ts`, `test/app.test.ts`, `test/handler.test.ts`, `test/middleware.test.ts`, `test/proxy.test.ts`, `test/route.test.ts`, `test/mount.test.ts`) são ajustadas só se forem de formato. Falha que não seja de formato é tratada como bug, não ajustada.
- `test/security.test.ts:556` e asserts sobre `res.statusText` não são alterados.
- `pnpm vitest run test/errors.test.ts test/body.test.ts test/body-limit.test.ts test/validate.test.ts` passa.

**Arquivos:** `test/errors.test.ts`, `test/body.test.ts`, `test/body-limit.test.ts`, `test/validate.test.ts`, e demais testes de erro que a execução da suíte apontar

---

### T-06 — Documentação e JSDoc do novo formato

**Cobre:** RF-01, RF-03

**Depende de:** T-03, T-04

**Aceite:**
- JSDoc de `statusText` e `message` em `src/error.ts` (linhas 37-49) descreve o novo mapeamento: `statusText` vira `title`, `message` vira `detail`.
- `docs/1.guide/1.basics/6.error.md` mostra o exemplo JSON em `application/problem+json`, lista os campos da RFC (`type`, `title`, `status`, `detail`, `instance`) e `data`/`body` como extensões, e atualiza a TIP sobre campos ocultos.
- Os outros arquivos de `docs/` apontados no techspec (riscos, item 11) são lidos e alterados só se tratarem de erro HTTP.
- `CHANGELOG.md` não é editado (gerado pelo changelogen).
- Opcional, se o time quiser: nota no JSDoc de `toJSON()` de que a resposta HTTP usa o formato RFC 9457 (techspec, risco 4).

**Arquivos:** `src/error.ts`, `docs/1.guide/1.basics/6.error.md`, e demais arquivos de `docs/` que tratem de erro HTTP

---

### T-07 — Verificação final da suíte, tipos e lint

**Cobre:** RF-05

**Depende de:** T-05, T-06

**Aceite:**
- `pnpm vitest run` completo: sem falhas. Número de arquivos e testes em relação ao baseline (71 arquivos, 1 pulado; 3091 testes passando, 69 pulados) mais os casos novos de T-01; nenhum teste removido.
- `pnpm typecheck` sem erros.
- `pnpm lint` sem erros (oxlint e oxfmt --check).
- Revisão do diff: cada alteração em teste existente corresponde a uma linha da tabela 5.2 do techspec.
- Riscos de aceite pendentes registrados para o time, não resolvidos nesta tarefa: quebra de consumidores que leem `statusText`, `message` ou `unhandled` (techspec, risco 1); confirmação de que "não quebrar" significa API de `HTTPError` compatível (risco 2); remoção de `unhandled` do corpo (risco 3).

**Arquivos:** nenhum (somente verificação; ajustes pontuais voltam para a tarefa responsável)
