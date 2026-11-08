# Techspec — `problem()` (RFC 9457) via utilitário explícito

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-08). Citações `arquivo:linha` conferidas no código atual (commit `18bcde0`).

## 1. Resumo

`problem(input)` cria um `HTTPError` normal e o marca com os dados extras de problem details (`type`, `instance`, `detail`). A marca é uma propriedade não enumerável `~problem` na instância. `errorResponse` (`src/response.ts:358`) é o único ponto que muda: se a marca existe, serializa no formato RFC 9457 com `content-type: application/problem+json`. `HTTPError`, `toJSON()` e a configuração global não são alterados.

## 2. Decisões de arquitetura

### D-01 — Marca na instância, não subclasse nem novo campo público de `HTTPError`

`problem()` devolve um `HTTPError` comum e define nele `~problem` via `Object.defineProperty` (não enumerável).

- **Alternativa A — subclasse `ProblemError extends HTTPError`:** cria um novo nome público (viola o contrato: só `problem` e o tipo da entrada) e `HTTPError.isError` testa `name === "HTTPError"` (`src/error.ts:129-133`), então teria de sobrescrever `name`. Rejeitada.
- **Alternativa B — novos campos `type`/`instance` em `HTTPError` e `ErrorBody`:** altera a API pública de `HTTPError` (fora de escopo, PRD §3) e o construtor (`src/error.ts:162`). Rejeitada.
- **Alternativa C — símbolo exportado:** nome público a mais. Rejeitada.
- **Escolha:** propriedade `~problem`. Segue a convenção `~` para privado/não enumerável do `AGENTS.md`, não aparece em `Object.keys`, e o erro continua passando por `HTTPError.isError`, hooks (`onError`, `src/response.ts:159-165`) e tracing sem mudança.

### D-02 — Serialização decidida em `errorResponse`, `toJSON()` intocado

- **Alternativa A — alterar `HTTPError.toJSON()` (`src/error.ts:226`):** muda a saída de todo consumidor de `toJSON` (risco do PRD §4). Rejeitada.
- **Alternativa B — serializar em `problem()` devolvendo `Response`:** o contrato exige devolver `HTTPError`. Rejeitada.
- **Escolha:** em `errorResponse` (`src/response.ts:358-380`), ramificar por `error["~problem"]`. O caminho atual fica byte a byte igual quando a marca não existe (RF-06). A lógica nova fica em função interna de `src/utils/internal/problem.ts` (`problemBody`), para manter `response.ts` curto.

### D-03 — `detail` vem da `message` informada, guardada na marca

`HTTPError.message` sempre tem valor (fallback `"HTTPError 404"`, `src/error.ts:187-193`), então `error.message` não distingue "informada" de "default". RF-03 pede `detail` só quando houver `message`.

- **Alternativa:** usar `error.message` sempre. Geraria `detail: "HTTPError 404"` sem ter sido pedido. Rejeitada.
- **Escolha:** `problem()` captura `input.message` (string não vazia) e a guarda como `detail` na marca. Não se usa `cause.message`.

### D-04 — `title` = `error.statusText`; omitido se ausente

`statusText` já é sanitizado no construtor (`src/error.ts:180-185`) e aceita o legado `statusMessage`. Sem `statusText`, `title` é omitido (premissa do PRD).

### D-05 — Precedência dos membros e extensões

Ordem de montagem do objeto: primeiro `...body`, depois os membros padrão (`type`, `title`, `status`, `detail`, `instance`) e por último `data` (somente se definido, para `data: undefined` não apagar um `body.data`). Assim extensões nunca sobrescrevem membros padrão (RF-05), e `status` é sempre `error.status`. `JSON.stringify` descarta chaves `undefined`, o que implementa a omissão.

- **Alternativa:** filtrar chaves de `body` com lista de reservadas. Mais código e o mesmo resultado; rejeitada.
- **Observação:** `data` fica com precedência sobre `body.data`, por ser o campo documentado ("sob a chave `data`").

### D-06 — Modo `unhandled`

Se `error.unhandled` for verdadeiro, o corpo é só `{ title, status }` (mesma exposição de `statusText`/`status` de hoje em `toJSON`), sem `detail`, `type`, `instance`, `data` nem `body`. O `content-type` continua `application/problem+json`. `stack` em `debug` continua sendo acrescentado depois (RF-07), igual ao código atual (`src/response.ts:369`). Como o `message` original nunca entra no corpo, "segredo interno" não vaza.

- **Alternativa:** emitir `detail: "HTTPError"` como o `toJSON` atual faz com `message`. Rejeitada: um `detail` sem informação é ruído e o PRD pede para não expor `detail`.

### D-07 — Content-Type

Nova constante `problemHeaders` (`FrozenHeaders` com `application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders` (`src/response.ts:270`). `errorResponse` escolhe a base conforme a marca e mantém a mesma mesclagem (`mergeHeaders`, `src/response.ts:243`): headers do erro e `errHeaders` sobrescrevem o content-type (RF-04). Escolher o header na base em vez de `set` depois preserva a regra "o do handler prevalece".

### D-08 — Local do código e nomes

- `problem()` em `src/utils/problem.ts` (pasta de utilitários públicos), com o tipo `ProblemInput`. Exportados em `src/index.ts` sem barrel (um `export { problem, type ProblemInput }`).
- Helper interno (leitura da marca e `problemBody`) em `src/utils/internal/problem.ts`, importado por `response.ts` e por `problem.ts`.
- **Alternativa:** pôr tudo em `src/error.ts` (237 linhas, já acima da meta de 200 LoC do `AGENTS.md`). Rejeitada.
- O nome `problem` não colide com nenhum export atual (há `proxy`, mas não `problem`; ver `test/unit/package.test.ts:104-105`).

## 3. Arquivos a alterar

| Arquivo                                | Alteração                                                          |
| -------------------------------------- | ------------------------------------------------------------------ |
| `src/utils/problem.ts` (novo)          | `problem()` e `ProblemInput`                                       |
| `src/utils/internal/problem.ts` (novo) | `kProblem = "~problem"`, tipo `ProblemMark`, `problemBody()`       |
| `src/response.ts:358-380`              | `errorResponse`: base de headers e corpo por marca                 |
| `src/response.ts:270-272`              | nova constante `problemHeaders` abaixo de `jsonHeaders`            |
| `src/index.ts:72`                      | novo export após o bloco `// Error` (ou na seção de utils)         |
| `test/unit/package.test.ts:104-105`    | inserir `"problem"` entre `"parseCookies"` e `"proxy"` no snapshot |
| `test/problem.test.ts` (novo)          | testes de RF-01 a RF-08                                            |
| `test/unit/types.test-d.ts`            | testes de tipo de `ProblemInput` (RF-02)                           |
| `docs/1.guide/1.basics/6.error.md:11`  | seção curta documentando `problem()` (opcional, sem custo de API)  |

Não mudam: `src/error.ts` (`HTTPError`, `toJSON`, `status`), `src/h3.ts`, `src/adapters.ts`, rules, nitro.

Ponto de leitura dos erros em `prepareResponse`: `src/response.ts:146-174`. O erro `problem()` é `HTTPError.isError` verdadeiro (`src/response.ts:147`), logo reaproveita o mesmo fluxo, inclusive `onError` (`:161-165`) e o log de `unhandled` (`:156-158`).

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI reference identifying the problem type (RFC 9457 `type`). */
  type?: string;
  /** URI reference identifying this occurrence (RFC 9457 `instance`). */
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

Implementação (esboço):

```ts
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT> {
  const { type, instance, ...details } = input;
  const error = new HTTPError<DataT>(details);
  Object.defineProperty(error, kProblem, {
    value: { type, instance, detail: input.message || undefined } satisfies ProblemMark,
  });
  return error;
}
```

- `ErrorInput` já traz `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled` e legados (`src/error.ts:6-26`, `:30-69`). Com `isolatedDeclarations`, o retorno é anotado explicitamente.
- `HTTPError<DataT>` aceita `ErrorDetails` com `ErrorInput` sem genérico; se o tipo `ErrorInput<DataT>` não for atribuível a `ErrorDetails` (que usa `ErrorInput<unknown>`), usar `new HTTPError(details) as HTTPError<DataT>` — verificar em `pnpm typecheck`.
- `ProblemMark = { type?: string; instance?: string; detail?: string }`.
- `type`/`instance` vindos de JS não string: o tipo bloqueia em TS; em runtime, `problemBody` só inclui valores `typeof === "string"` (evita serializar lixo).

```ts
// src/utils/internal/problem.ts
export const kProblem = "~problem";
export function getProblem(error: HTTPError): ProblemMark | undefined;
export function problemBody(error: HTTPError, mark: ProblemMark): Record<string, unknown>;
```

`problemBody`:

```ts
if (error.unhandled) return { title: error.statusText, status: error.status };
return {
  ...error.body,
  type: mark.type,
  title: error.statusText,
  status: error.status,
  detail: mark.detail,
  instance: mark.instance,
  ...(error.data === undefined ? undefined : { data: error.data }),
};
```

`errorResponse` (esboço): `const mark = getProblem(error)`; base = `mark ? problemHeaders : jsonHeaders`; corpo = `{ ...(mark ? problemBody(error, mark) : error.toJSON()), stack }`.

Exemplo de saída (RF-03): `{"type":"https://example.com/probs/saldo","title":"Forbidden","status":403,"detail":"Saldo insuficiente","instance":"/contas/123"}`.

## 5. Estratégia de testes

Novo `test/problem.test.ts` com `describeMatrix` (web e node), no padrão de `test/errors.test.ts:6`. Cada caso registra a rota em `t.app` e usa `t.fetch`.

| Caso                                                                                                        | RF    |
| ----------------------------------------------------------------------------------------------------------- | ----- |
| `problem({status:404})` é `HTTPError.isError` e `instanceof HTTPError`, `status` 404                        | 01    |
| `throw` e `return` de `problem()` geram a mesma resposta                                                    | 01    |
| corpo completo com `type`, `title`, `status`, `detail`, `instance` (exemplo RF-03)                          | 03    |
| só `status`: corpo `{status}` sem `type`, `title`, `detail`, `instance`                                     | 03    |
| `message` omitida: sem `detail` (não aparece `"HTTPError 400"`)                                             | 03    |
| `content-type` começa com `application/problem+json`; `headers` próprio de content-type prevalece           | 04    |
| `body` na raiz; `body.status: 200` não sobrescreve; `body.type` não sobrescreve; `data` sob `data`          | 05    |
| `HTTPError` direto, `HTTPError.status`, 404 de rota, `kNotFound`: formato e `application/json` inalterados  | 06    |
| `unhandled: true` sem debug: sem `segredo interno`, sem `detail`, `type`, `instance`, `data`, `body`        | 07    |
| `unhandled` com `debug` (config): `stack` presente, mensagem ausente                                        | 07    |
| headers do erro e `event.res.errHeaders` mesclados; `set-cookie` sem duplicar, com e sem `onError`          | 04/08 |
| HEAD com `problem()`: sem corpo e sem `content-length`                                                      | 08    |
| `Object.keys(problem({status:400}))` não contém `~problem`; `JSON.stringify(error)` igual ao de `HTTPError` | 01/06 |

Outros:

- `test/unit/types.test-d.ts`: `problem({status, message, headers, data, type, instance})` compila; `type: 1` e `instance: 1` com `// @ts-expect-error`; `problem(...)` retorna `HTTPError`.
- `test/unit/package.test.ts:104`: único teste existente que muda (snapshot de exports). Ele continua verificando o conjunto exato de exports; só ganha `"problem"`. `ProblemInput` é só tipo e não aparece no snapshot.
- Ordem (AGENTS.md, fluxo de bug fix): escrever os testes primeiro, ver falhar, implementar, ver passar. Depois `pnpm vitest run test/problem.test.ts test/errors.test.ts test/unit`, e por fim `pnpm lint` e `pnpm test`.
- Conferir que a suíte de `errors.test.ts` passa sem edição (RF-06).

## 6. Riscos

| Risco                                                                         | Mitigação                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alterar saída dos erros existentes                                            | `toJSON` e `HTTPError` intocados; ramo novo só com marca; teste de regressão (RF-06)                                                                                                                                                   |
| Exports a mais                                                                | só `problem` e `ProblemInput` em `src/index.ts`; snapshot de `package.test.ts` confirma; `kProblem` fica em `internal/` e não é reexportado                                                                                            |
| Marca perdida em cópias (ex.: `new HTTPError({cause: problemErr})` ou spread) | Aceito: o novo erro segue o formato atual, como previsto no PRD §4 para erros de outros módulos. Documentar                                                                                                                            |
| Marca perdida com `onError` que devolve novo erro                             | Comportamento esperado: o hook decide a resposta. Teste cobre `onError` que retorna `undefined` (marca preservada)                                                                                                                     |
| `isolatedDeclarations`/genéricos reclamarem no typecheck                      | anotar retorno; fallback `as HTTPError<DataT>` descrito em §4                                                                                                                                                                          |
| `body` não serializável (ciclo, BigInt)                                       | já cai no pipeline 500 existente (`test/errors.test.ts:372-389`); sem tratamento novo                                                                                                                                                  |
| `data` e `body.data` colidirem                                                | `data` prevalece (D-05); documentado em teste                                                                                                                                                                                          |
| Tree-shaking/tamanho: `response.ts` passa a importar `internal/problem.ts`    | helper pequeno, sem dependências; `problem.ts` só entra no bundle se o usuário importar a função; `rules/headers.ts` evita importar `error.ts` de propósito (`src/rules/handlers/headers.ts:38`), e esta mudança não toca esse arquivo |
| Windows/CRLF e formato                                                        | rodar `pnpm fmt` antes do lint                                                                                                                                                                                                         |

## 7. Pendências e não escopo

Sem negociação por `Accept`, sem config global, sem `application/problem+xml`, sem helpers por status, sem mudança em nitro (PRD §3).
