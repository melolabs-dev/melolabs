# Tarefas — Problem Details (RFC 9457) por opção de configuração (h3js/h3#1384, variante A)

Derivado de `sdd/prd.md` e `sdd/techspec.md`. Ordem sugerida: T-01 → T-07. Seguir o fluxo de correção do AGENTS.md: o teste de regressão vem primeiro e deve falhar antes do código.

### T-01 — Escrever os testes de regressão (devem falhar)

Criar `test/problem-details.test.ts` com `describeMatrix` (modos `web` e `node`), conforme a tabela da techspec §5. Habilitar com `ctx.app.config.problemDetails = true` por teste. Como o setup liga `debug: true`, desligar `debug` nos testes de corpo exato (RF-03, RF-05, RF-06). Para erros não tratados, seguir o padrão de `t.errors = []` de `test/errors.test.ts`. Casos:

- Opção ausente e `false`: content-type `application/json;charset=UTF-8` e corpo antigo comparado como texto bruto.
- 404 lançado com `application/problem+json`.
- 422 com `statusText` e `message`: `toEqual` exato, sem `instance`, `statusText`, `message` nem `unhandled`.
- `title` padrão (404 → "Not Found") e status desconhecido → "Error".
- `type`/`instance` por propriedade, por `cause` e por `HTTPError.status(...)`. Aparecem no corpo novo e não no antigo. `type` não-string é ignorado.
- `body` espalhado e `data` sob `data`. Chaves reservadas não são sobrescritas. `data` explícito vence `body.data`. Chave `__proto__` vinda de `JSON.parse` não altera o protótipo.
- `throw new Error("segredo interno")`: 500 problem+json sem o texto, sem `data`/`body`, ignorando `type`/`instance`.
- `debug: true` com `headers`: `x-id`, content-type e `stack` como lista. `content-type` do erro prevalece. `errHeaders` são mesclados. `onError` recebe o `HTTPError`, e a `Response` que ele devolver vale.
- `GET /nada`: 404 problem+json com `detail` contendo `Cannot find any route matching`.
- HEAD com a opção: sem corpo e com content-type problem+json.
- Unitário de `HTTPError`: `type`/`instance` expostos e `toJSON()` inalterado (sem essas chaves).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem-details.test.ts` roda e os testes da opção ligada e dos campos novos falham antes de qualquer mudança em `src/`. Os testes da opção desligada (RF-01) e do `toJSON()` inalterado já passam.
Arquivos: `test/problem-details.test.ts`

### T-02 — Adicionar a opção `problemDetails` em `H3Config`

Adicionar `problemDetails?: boolean` logo após `silent`, com JSDoc em inglês como as demais opções. O JSDoc diz que o padrão é desligado e que vale para respostas renderizadas pela aplicação H3 (limitação R-05). Nenhum outro nome público é criado e `src/index.ts` não muda. `H3CoreConfig` herda a opção.

Cobre: RF-01
Depende de: T-01
Aceite: `app.config.problemDetails` e `new H3({ problemDetails: true })` passam no typecheck. `pnpm typecheck` não tem novos erros.
Arquivos: `src/types/h3.ts`

### T-03 — Aceitar e expor `type` e `instance` em `HTTPError`

- Em `ErrorInput`, adicionar `type?: string` e `instance?: string` com comentário citando a RFC 9457. Não alterar `ErrorBody`.
- Na classe, declarar `readonly type: string | undefined` e `readonly instance: string | undefined`.
- No construtor, ao lado da leitura de `headers`, ler de `details` e, na ausência, de `details.cause`. Aceitar somente `typeof === "string"`.
- Não mexer em `toJSON()`.
- `HTTPError.status(...)` passa a aceitar os campos via `ErrorDetails`, sem mudança de código.

Cobre: RF-04
Depende de: T-01
Aceite: `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })` devolve esses valores em `error.type` e `error.instance`. O mesmo vale por `cause` e por `HTTPError.status(...)`. `type` não-string é ignorado e `toJSON()` não inclui as chaves. O teste unitário de T-01 passa.
Arquivos: `src/error.ts`

### T-04 — Criar o helper interno `problemBody`

Criar `src/utils/internal/problem.ts`, sem export em `src/index.ts`, com tipos de retorno explícitos (`isolatedDeclarations`). Contém a tabela interna `Record<number, string>` de frases HTTP (status IANA, sem `node:http`) e `problemBody(error, debug?)`, que monta as chaves nesta ordem:

1. `type`: `error.type ?? "about:blank"`, sempre `"about:blank"` se `unhandled`.
2. `title`: `error.statusText ?? frase do status`, ou `"Error"` se o status não estiver na tabela.
3. `status`: `error.status`.
4. `detail`: `error.toJSON().message`, que fica mascarado se `unhandled`.
5. `instance`: somente se definido e não `unhandled`.
6. Extensões, omitidas se `unhandled`: spread de uma cópia de `error.body` sem as chaves `type|title|status|detail|instance` (remover com `delete`). Depois `data` se `!== undefined`, e `data` explícito vence `body.data`.
7. `stack`, somente com `debug` e `error.stack`, no mesmo formato do ramo antigo (`split("\n").map(trim)`).

Compor com spread, para que `__proto__` não altere o protótipo. Importar com extensão `.ts`.

Cobre: RF-03, RF-05, RF-06, RF-07
Depende de: T-03
Aceite: com o T-05 aplicado, os testes de corpo exato (422), de extensões, de `__proto__`, de erro não tratado e de `stack` passam. O corpo de 422 é `{ type: "about:blank", title: "Entidade inválida", status: 422, detail: "campo x ausente" }`. Um erro não tratado devolve `detail: "HTTPError"` e nenhum `data`/`body`. `pnpm lint` não reclama do arquivo.
Arquivos: `src/utils/internal/problem.ts`

### T-05 — Ligar o formato em `errorResponse`

- Trocar a assinatura para `errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers)` e atualizar a chamada em `prepareResponse`.
- Definir `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` ao lado de `jsonHeaders`.
- Com `config.problemDetails` ligado, usar `problemHeaders` como base de `mergeHeaders` (para `error.headers` e `errHeaders` prevalecerem, inclusive o `content-type`) e `problemBody(error, config.debug)` como corpo. Indentar com 2 espaços se `debug`.
- Manter o ramo antigo literalmente igual, atrás de `!config.problemDetails`.
- `onError`, HEAD, `h3.ts`, `handler.ts` e `json-rpc.ts` ficam intocados. O 404 sem rota e o 400 de URL malformada já passam por `errorResponse`.

Cobre: RF-01, RF-02, RF-03, RF-07, RF-08
Depende de: T-02, T-04
Aceite: `pnpm vitest run test/problem-details.test.ts` passa por inteiro em `web` e `node`. O formato antigo continua byte a byte igual, `GET /nada` devolve 404 problem+json com `detail` contendo `Cannot find any route matching`, e HEAD vem sem corpo.
Arquivos: `src/response.ts`

### T-06 — Asserções de tipo (opcional)

Verificar `test/unit/types.test-d.ts`. Se o arquivo comportar, adicionar asserções de que `H3Config["problemDetails"]` é `boolean | undefined` e de que `HTTPError` expõe `type` e `instance` como `string | undefined` somente leitura.

Cobre: RF-01, RF-04
Depende de: T-02, T-03
Aceite: o typecheck passa com as asserções. Se o arquivo não comportar, registrar no resumo final que a tarefa foi dispensada.
Arquivos: `test/unit/types.test-d.ts`

### T-07 — Validação final e regressões

Rodar `pnpm lint`, `pnpm typecheck` e `pnpm vitest run`. Se algum teste existente quebrar por depender de algo que a mudança altera, ajustar sem perder o que ele verifica e registrar. Aplicar `pnpm fmt` apenas se o `oxfmt` reclamar dos arquivos tocados. Confirmar que `src/index.ts`, `toJSON()`, `src/utils/json-rpc.ts`, `src/handler.ts` e `src/h3.ts` não foram alterados (`git diff --stat`).

Cobre: RF-09
Depende de: T-05, T-06
Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` terminam sem falhas, nenhum teste existente foi editado sem justificativa, e `git diff --stat` lista apenas os arquivos previstos nas tarefas T-01 a T-06.
Arquivos: `test/problem-details.test.ts`, `src/types/h3.ts`, `src/error.ts`, `src/response.ts`, `src/utils/internal/problem.ts`, `test/unit/types.test-d.ts`

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-02, T-05, T-06 |
| RF-02 | T-01, T-05 |
| RF-03 | T-01, T-04, T-05 |
| RF-04 | T-01, T-03, T-06 |
| RF-05 | T-01, T-04 |
| RF-06 | T-01, T-04 |
| RF-07 | T-01, T-04, T-05 |
| RF-08 | T-01, T-05 |
| RF-09 | T-01, T-07 |
