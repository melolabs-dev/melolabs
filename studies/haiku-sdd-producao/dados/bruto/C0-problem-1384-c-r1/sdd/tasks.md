# Tarefas — `problem()` (RFC 9457) no h3

Referências: `sdd/prd.md` (RF-01…RF-08) e `sdd/techspec.md` (D-01…D-07).
Ordem segue o fluxo do AGENTS.md: testes primeiro (devem falhar), depois implementação.

### T-01 — Escrever testes de integração de `problem()` (devem falhar)

Criar `test/problem.test.ts` com `describeMatrix` (web + node), importando `problem` de `../src/index.ts`. Casos: retorno `instanceof HTTPError`/`HTTPError.isError` com `throw` e `return` (RF-01); exemplo completo do PRD com `statusText: "Não encontrado"` e `toEqual` no JSON (RF-03); 422 com `x-request-id`, `content-type` iniciando com `application/problem+json` e `content-type` customizado prevalecendo (RF-04); `problem({})`, só `status`, e `unhandled: true` sem `detail`/`data`/extensões/`instance`/`segredo` (RF-05); defaults de `title` (404 → "Not Found", status fora da tabela → "Unknown Error"), `detail` ausente sem `message` explícito e colisão de chaves (`body: { status: 1, title: "x" }`); `HTTPError` comum inalterado (`application/json;charset=UTF-8`) e `toJSON()` igual ao de um `HTTPError` equivalente (RF-06); `onError` global e `config.onError` recebendo a instância, handler assíncrono e middleware lançando `problem({ status: 409 })`, e `onError` devolvendo `Response` própria (RF-07); extras: `HEAD` e `debug: true`.

Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/problem.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` falha (por `problem` inexistente) antes da implementação; a falha é registrada como prova de regressão do RF-08.

### T-02 — Escrever testes de tipos de `ProblemInput` (devem falhar)

Em `test/unit/types.test-d.ts`, novo `describe` no padrão existente: `expectTypeOf(problem).returns.toEqualTypeOf<HTTPError<unknown>>()`; chamada válida do RF-02 (`status`, `message`, `headers`, `type`, `instance`) compila; `// @ts-expect-error` para campo desconhecido e para `type: 42`; `ProblemInput` estende `ErrorInput`.

Cobre: RF-02, RF-08
Arquivos: `test/unit/types.test-d.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` falha antes da implementação (imports/símbolos inexistentes) e passa após T-06.

### T-03 — Criar a tabela de texto de razão HTTP

Criar `src/utils/internal/status-text.ts` com `Record<number, string>` dos códigos IANA comuns (2xx/3xx/4xx/5xx) e `getStatusText(status): string | undefined`, sem APIs específicas de runtime (D-05). Fallback `"Unknown Error"` é aplicado por quem chama. Manter < 200 LoC.

Cobre: RF-03, RF-05
Arquivos: `src/utils/internal/status-text.ts`
Depende de: nenhuma
Aceite: `getStatusText(404)` retorna `"Not Found"` e status fora da tabela retorna `undefined`; `pnpm lint` passa no arquivo.

### T-04 — Criar o helper interno de serialização (`problemBody`)

Criar `src/utils/internal/problem.ts` com `kProblem = "~problem"`, `ProblemMeta` e `problemBody(error, meta, debug?)`, sem importar `response.ts` (evita ciclo). Montagem conforme D-04: extensões de `body` e `data` (ocultos com `unhandled`), `stack` apenas com `debug`, e membros padrão por último (`type`, `title`, `status`, `detail?`, `instance?`) para prevalecerem em colisões. Com `unhandled: true` emitir só `type`, `title`, `status` (sem `instance` nem `stack`, exceto `stack` em `debug`, como hoje). Tipos de retorno explícitos (`isolatedDeclarations`).

Cobre: RF-03, RF-05
Arquivos: `src/utils/internal/problem.ts`
Depende de: T-03
Aceite: `pnpm typecheck` passa; os casos de corpo, colisão e `unhandled` de T-01 passam após T-07.

### T-05 — Implementar `problem()` e `ProblemInput`

Criar `src/utils/problem.ts`: `ProblemInput<DataT>` estende `ErrorInput<DataT>` com `type?: string` e `instance?: string`; `problem(input?)` cria `new HTTPError(input)` e define `~problem` não enumerável via `Object.defineProperty`. `meta` usa `statusText ?? statusMessage` crus (não vazios após `trim`, senão `getStatusText(status)` ou `"Unknown Error"`), `message` explícito só se string não vazia, `type` padrão `"about:blank"` e `instance` só se informado. `problem()` sem argumento deve funcionar (500). Sem novas classes.

Cobre: RF-01, RF-02, RF-03, RF-05
Arquivos: `src/utils/problem.ts`
Depende de: T-03, T-04
Aceite: `pnpm typecheck` passa; `problem({ status: 404 })` é `instanceof HTTPError`; `toJSON()` do erro fica igual ao de um `HTTPError` equivalente.

### T-06 — Exportar `problem` e `ProblemInput` em `src/index.ts`

No bloco `// Error` de `src/index.ts`, acrescentar `export { problem, type ProblemInput } from "./utils/problem.ts"`. Nenhum outro nome público novo.

Cobre: RF-01, RF-02
Arquivos: `src/index.ts`
Depende de: T-05
Aceite: `import { problem, type ProblemInput } from "h3"` (via `src/index.ts`) compila; `pnpm vitest run test/unit/types.test-d.ts` passa após T-02.

### T-07 — Ramificar `errorResponse` para `application/problem+json`

Em `src/response.ts`: adicionar `FrozenHeaders` local com `content-type: application/problem+json;charset=UTF-8` ao lado de `jsonHeaders`; em `errorResponse`, se `error["~problem"]` existir, serializar com `JSON.stringify(problemBody(...))` usando esse header base e o mesmo `mergeHeaders` com `error.headers` e `errHeaders` (content-type do chamador prevalece). Sem marca, o caminho atual permanece idêntico; `toJSON()` e `src/error.ts` não mudam; a chamada em `prepareResponse` não muda (hooks `onError` continuam antes).

Cobre: RF-04, RF-05, RF-06, RF-07
Arquivos: `src/response.ts`
Depende de: T-04, T-05
Aceite: `pnpm vitest run test/problem.test.ts test/errors.test.ts` passa em `web` e `node`; `test/errors.test.ts` segue sem alteração.

### T-08 — Documentar o utilitário em `docs/`

Em `docs/1.guide/1.basics/6.error.md`, nova seção "Problem Details (RFC 9457)" (entre as seções existentes, após ~`:60` e antes de ~`:78`) com exemplo de `throw problem(...)`, mapeamento (`statusText`→`title`, `message`→`detail`, `body`→extensões, `data`→`data`), padrão `about:blank`, precedência dos membros padrão em colisões, comportamento com `unhandled` e a nota de que `problem()` deve ser lançado diretamente (a marca se perde se for reembrulhado em `new HTTPError({ cause })`).

Cobre: RF-08
Arquivos: `docs/1.guide/1.basics/6.error.md`
Depende de: T-07
Aceite: a seção existe, o exemplo corresponde ao comportamento testado e `pnpm lint` (formatação) passa.

### T-09 — Verificação final e regressão

Executar `pnpm vitest run test/problem.test.ts test/errors.test.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` (conferir ciclos de import e tamanho do bundle). Se algum teste existente depender do que mudou, ajustar sem perder a asserção; nenhum ajuste é previsto. Fechar a pendência da techspec sobre `instance` em `unhandled` (mantida a omissão, conforme RF-05).

Cobre: RF-06, RF-08
Arquivos: nenhum (somente verificação; eventuais ajustes em `test/*.test.ts` existentes)
Depende de: T-01, T-02, T-06, T-07, T-08
Aceite: `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam; os testes novos falham se `problem` for removida (comprovado em T-01).
