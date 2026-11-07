# Tarefas de implementação — Problem details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-09).
Fluxo: testes primeiro (T-01), ver falhar, implementar (T-02 a T-05), ajustar testes existentes (T-06), docs (T-07) e verificação final (T-08).

### T-01 — Escrever os testes novos (devem falhar antes da implementação)

Criar um `describe` novo em `test/errors.test.ts` com `describeMatrix`, um bloco por requisito, conforme a seção 5 da techspec, e o teste unitário de `getStatusPhrase`. Rodar e confirmar que falham pelos motivos certos.

- RF-01: `HTTPError({ status: 400 })` → 400 e `content-type` começa com `application/problem+json`.
- RF-02: 404 com `statusText`/`message` → `type: "about:blank"`, `title`, `status`, `detail`; sem `statusText`, `title` vem da frase padrão.
- RF-03: `error.type`/`error.instance` na instância e no corpo; `instance` ausente quando não informado; valor não-string ignorado.
- RF-04: `message`, `data` e `body` (`codigo`) no corpo; `body` com `status/type/title/detail/instance` não sobrescreve os padrão; `undefined` omitido.
- RF-05: `throw new Error("segredo interno")` → 500 `problem+json` sem o segredo e sem `stack`; com `debug: true` há `stack`; `type`/`instance` de erro `unhandled` e `type` vindo de `cause` não vazam.
- RF-06: `headers: { "x-trace": "1" }` + `statusText: "Teapot"` (418); `content-type` explícito do erro prevalece; `event.res.errHeaders` continua mesclado.
- RF-07: `new H3()` sem opção — 404 de rota inexistente e erro de validação de corpo saem como `problem+json`; teste de tipo em `test/unit/types.test-d.ts` garantindo que `H3Config` não ganhou propriedade.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: nenhuma
Aceite: `pnpm vitest run test/errors.test.ts test/unit/` executa os testes novos e eles falham (red) por ausência da implementação, sem erros de sintaxe ou de tipo nos próprios testes.
Arquivos: `test/errors.test.ts`, `test/unit/status-text.test.ts` (novo), `test/unit/types.test-d.ts`

### T-02 — Helper interno `getStatusPhrase`

Criar `src/utils/internal/status-text.ts` com a tabela completa de frases da RFC 9110 e `getStatusPhrase(status: number): string`, com fallback `"Error"`. Não exportar em `src/index.ts`; não alterar `STATUS_TEXT` de `src/utils/response.ts` (D-04).

Cobre: RF-02
Depende de: T-01
Aceite: o teste unitário de `getStatusPhrase` passa (404 → "Not Found", 418 → "I'm a Teapot", código desconhecido → "Error"); arquivo com menos de 100 linhas; `pnpm lint` sem erros no arquivo.
Arquivos: `src/utils/internal/status-text.ts` (novo)

### T-03 — Tipos e propriedades `type` e `instance` em `HTTPError`

Em `ErrorBody` adicionar `type?: string` e `instance?: string` com JSDoc. Em `HTTPError` adicionar `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor após `this.body`, lidos só de `details` (não de `details.cause`) e aceitando apenas `typeof === "string"` (D-05). Sem default `"about:blank"` na propriedade. Nenhum outro nome público novo.

Cobre: RF-03
Depende de: T-01
Aceite: `new HTTPError({ status: 403, type, instance })` expõe `error.type` e `error.instance`; não-string vira `undefined`; `type` em `cause` não é lido; `pnpm typecheck` passa (inclui `isolatedDeclarations`).
Arquivos: `src/error.ts`

### T-04 — Novo `HTTPError.toJSON()` no formato problem details

Reescrever `toJSON()` com anotação de retorno explícita: `type` (`this.type ?? "about:blank"`), `title` (`statusText ?? getStatusPhrase(status)`), `status`, `detail` (= `message`), `instance` (só se informado), depois as extensões legadas `statusText`, `unhandled`, `message`, `data` e as chaves de `body` filtradas dos cinco nomes padrão (D-02, D-03). Para `unhandled`: `type` = `"about:blank"`, sem `instance`/`data`/`body`, `detail` e `message` = `"HTTPError"`, mantendo `title` e `status` (D-06). Importar `getStatusPhrase`.

Cobre: RF-02, RF-03, RF-04, RF-05
Depende de: T-02, T-03
Aceite: os testes de RF-02, RF-03 (corpo), RF-04 e RF-05 (corpo) da T-01 passam; `body` não sobrescreve os cinco membros padrão mas ainda pode sobrescrever `message`/`data`/`statusText`; membros `undefined` omitidos; `pnpm typecheck` passa.
Arquivos: `src/error.ts`

### T-05 — Content-Type `application/problem+json` em `errorResponse`

Em `src/response.ts` criar `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` junto de `jsonHeaders` e usá-lo em `errorResponse` no lugar de `jsonHeaders`; manter `jsonHeaders` nos demais usos. Preservar a ordem de mesclagem (`error.headers` e `errHeaders` depois), sem alterar `H3Config` nem `src/types/h3.ts` (D-07, D-08).

Cobre: RF-01, RF-05, RF-06, RF-07
Depende de: T-04
Aceite: os testes de RF-01, RF-05 (content-type), RF-06 e RF-07 da T-01 passam; `content-type` explícito do erro ou do evento ainda substitui o padrão; `git diff` não mostra mudança em `src/types/h3.ts`, `src/adapters.ts`, `src/utils/json-rpc.ts` nem `src/rules/**`.
Arquivos: `src/response.ts`

### T-06 — Ajustar testes existentes dependentes do formato

Em `test/errors.test.ts` trocar a asserção da linha 44 para `application/problem+json;charset=UTF-8` e a da linha 140 para `toMatch("application/problem+json")`. Rodar a suíte completa e ajustar apenas asserções de `content-type` de erro em outros testes (candidatos: `test/json-rpc.test.ts`, `test/proxy.test.ts`, `test/validate.test.ts`, `test/handler.test.ts`). Não editar os `toMatchObject` de corpo nem `test/security.test.ts:556` e `test/router.test.ts:422`.

Cobre: RF-01, RF-04, RF-07
Depende de: T-05
Aceite: `pnpm vitest run` passa por inteiro; o diff dos testes existentes contém somente mudanças de `content-type` esperado.
Arquivos: `test/errors.test.ts`, e, se necessário, `test/json-rpc.test.ts`, `test/proxy.test.ts`, `test/validate.test.ts`, `test/handler.test.ts`

### T-07 — Atualizar a documentação de erros

Em `docs/1.guide/1.basics/6.error.md`: novo exemplo de resposta com `application/problem+json`, lista de campos com `type` e `instance`, nota sobre erros unhandled e nota de migração do `content-type` (D-09). Deixar claro que não há opção de configuração.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-07
Depende de: T-05
Aceite: o exemplo do doc coincide com o corpo real produzido (conferir com um teste ou execução); `pnpm fmt`/`pnpm lint` não reportam problemas no arquivo.
Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-08 — Verificação final

Rodar `pnpm vitest run test/errors.test.ts`, `pnpm test` (lint + typecheck + cobertura) e `pnpm build`, conferindo `isolatedDeclarations` nos `.d.mts` (`type`/`instance` em `HTTPError`/`ErrorBody`, ausência de novos exports em `src/index.ts`). Revisar `git status`: só os arquivos listados nas tarefas anteriores foram tocados.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-06, T-07
Aceite: os três comandos terminam sem erro; nenhum nome público novo além de `type` e `instance`; `H3Config` inalterado.
Arquivos: nenhum (somente verificação)
