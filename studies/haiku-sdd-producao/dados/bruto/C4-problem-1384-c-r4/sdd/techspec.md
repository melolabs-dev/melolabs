# Especificação técnica — Problem details (RFC 9457) via `problem()`

Base: `sdd/pedido.md` (contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-10). Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `2acd7e4`).

## 1. Visão geral

O h3 já tem um ponto único de serialização de erros: `errorResponse` em `src/response.ts:358`, chamado por `prepareResponse` em `src/response.ts:173`. Esta feature adiciona um **ramo** nesse caminho. Um `HTTPError` criado por `problem()` leva uma marca interna; quando essa marca existe, `errorResponse` serializa no formato RFC 9457 e fixa `Content-Type: application/problem+json`. Qualquer outro erro segue o caminho atual, sem nenhuma alteração.

Fluxo:

1. Handler faz `throw problem({...})` (ou `return`).
2. `prepareResponse` (`src/response.ts:146`) recebe o `HTTPError` (já é `HTTPError`, então não é reempacotado) e passa por `onError` como hoje (`src/response.ts:161-165`).
3. `errorResponse` (`src/response.ts:358`) vê a marca `kProblem` e delega para `problemResponse`.
4. Para erros sem marca, o código atual roda sem mudança.

## 2. Decisões de arquitetura

### D-01 — Marca interna por símbolo no próprio `HTTPError`

**Escolha:** `problem()` grava, em uma propriedade não enumerável com chave `kProblem = Symbol.for("h3.problem")`, os campos `type` e `instance`. `kProblem` é declarado em `src/error.ts`, junto da classe, e **não** é exportado por `src/index.ts` (mesmo padrão de `kEventRes` em `src/event.ts:16`).

**Por que `Symbol.for`:** a mesma escolha de `kHTTPResponse` (`src/response.ts:94`) — o registro global faz a marca valer entre cópias duplicadas do módulo (múltiplas instâncias do h3 ou realms diferentes). Erros de cópias diferentes continuam sendo reconhecidos por `HTTPError.isError` (`src/error.ts:129`), e a marca vai junto.

**Alternativas consideradas:**
- *Subclasse `ProblemError extends HTTPError`.* Descartada: `instanceof` falha entre cópias do módulo, e a classe aumentaria a superfície interna sem ganho; `isError` funcionaria, mas a marca por símbolo é mais simples.
- *`WeakSet` de erros marcados.* Descartada: não atravessa cópias do módulo e exige um estado global separado.
- *Campo público (`problem: true`) em `ErrorBody`.* Descartada: muda o tipo `ErrorBody` e `HTTPError`, o que a restrição do PRD proíbe (“Mudança no `HTTPError` existente ou nos seus campos” está fora de escopo).

**Segurança:** o símbolo não aparece em JSON; um corpo de requisição não consegue forjar a marca. `toError` (`src/response.ts:73`) descarta qualquer valor que não seja `Error`, então um `throw` de objeto arbitrário nunca vira problem details.

### D-02 — Local da implementação de `problem()`

**Escolha:** novo arquivo `src/utils/problem.ts`, com `problem()` e o tipo `ProblemInput`. A serialização fica em `src/response.ts`.

**Por que:** `src/error.ts` já tem 238 linhas e a convenção do AGENTS.md pede arquivos curtos (< 200 LoC). `src/utils/` é onde ficam as APIs públicas de utilitários (`src/utils/middleware.ts`, `src/utils/response.ts`).

**Alternativa descartada:** colocar `problem()` em `src/error.ts`. Funciona, mas empurra o arquivo mais para cima do limite.

### D-03 — `toJSON()` permanece inalterado

**Escolha:** `HTTPError.toJSON()` (`src/error.ts:226-236`) não muda. O formato problem details é montado só em `problemResponse`.

**Por que:** RF-08 exige que erros existentes saiam byte a byte iguais. Além disso, `toJSON` é chamado por código do usuário (`onError` pode fazer `error.toJSON()`), e mudar seu formato afetaria quem não usa `problem()`.

**Consequência:** um `onError` que devolve `Response` com `error.toJSON()` continua recebendo o formato antigo. É esperado; documentar no changelog.

### D-04 — `Content-Type` sem parâmetro `charset`

**Escolha:** `application/problem+json`, exatamente como o RF-04 especifica.

**Alternativa considerada:** `application/problem+json;charset=UTF-8`, igual ao `jsonHeaders` do h3 (`src/response.ts:270-272`). Descartada: RFC 9457 define o media type sem parâmetro, e o JSON já é UTF-8 pela RFC 8259. O RF-04 pede a igualdade literal.

**Consequência:** `problemResponse` não reaproveita `jsonHeaders` (que é `FrozenHeaders` com `content-type` fixo para JSON); monta um `Headers` novo.

### D-05 — Precedência de membros do corpo

**Escolha:** o corpo é montado nesta ordem, com a última escrita vencendo:

1. `...error.body` (extensões do `body`, se não for `unhandled`);
2. `data` (se `error.data` estiver definido; senão `body.data` é preservado);
3. membros reservados: `type`, `title` (só se houver `statusText`), `status`, `detail` (só se não `unhandled`), `instance` (só se informado).

**Por que:** RF-05 exige que `type`, `title`, `status`, `detail` e `instance` do sistema vençam o `body`. Com a ordem acima isso vale para qualquer colisão, inclusive `body.status: 999` (`prd.md`, RF-05).

**Alternativa descartada:** reproduzir a ordem atual de `toJSON` (`...this.body` por último). Ela deixaria `body` sobrescrever `status`, o que o RF-05 proíbe.

### D-06 — `stack` em modo debug

**Escolha:** manter a paridade com `errorResponse` atual: `stack` aparece quando `debug` está ligado e o erro tem `stack`. É uma extensão, não um membro reservado, e não é `detail`/`data`.

**Alternativa:** omitir `stack` no formato problem. Descartada para não criar um comportamento de debug diferente só por causa do formato. Pode ser revista se o time preferir.

### D-07 — Erros `unhandled`

**Escolha:** quando `error.unhandled` é `true`, `problemResponse` omite `detail`, `data` e as extensões do `body`, e mantém `type`, `status`, `title` (se houver) e `instance`. A regra é a mesma de `toJSON` (`src/error.ts:231-234`), que também esconde `body` nesse caso.

**Por que:** RF-06. O `title` vem de `statusText`, que é sanitizado (`src/error.ts:180`) e não carrega detalhes internos.

### D-08 — `type` padrão `about:blank` é aplicado na serialização

**Escolha:** `problem()` guarda `type` como veio (possivelmente `undefined`). `problemResponse` emite `type ?? "about:blank"`. Não há `type` padrão na entrada.

**Por que:** o valor padrão é sempre o mesmo, então guardar `undefined` evita escrita extra. Também mantém `ProblemInput.type` opcional, como no RF-03.

### D-09 — Headers e precedência

**Escolha:** a ordem de headers em `problemResponse` é:

1. copiar `error.headers` (se houver) para um `Headers` novo (é o que `errorResponse` já faz com `mergeHeaders(jsonHeaders, error.headers)`);
2. mesclar `errHeaders` com `mergeHeaders` (`src/response.ts:243`), para preservar `set-cookie` (`append`);
3. fixar `content-type` por último com `set`, para vencer qualquer `content-type` vindo de `input.headers` ou de `errHeaders` (RF-07).

**Por que:** RF-07 exige `content-type` fixo. Fixar por último é a forma mais simples de garantir isso sem alterar `mergeHeaders`.

### D-10 — Superfície pública

**Escolha:** `src/index.ts` ganha, na seção `// Error` (`src/index.ts:70-72`), uma linha com `problem` e `type ProblemInput`. Nenhum outro export. `kProblem` e `ProblemFields` ficam internos.

**Por que:** RF-09. O snapshot de exports (`test/unit/package.test.ts:6-13`) é a barreira que garante isso; ele deve ser atualizado com exatamente o nome `problem` (o tipo não aparece em runtime).

## 3. Arquivos a alterar

| Arquivo | Tipo | Mudança |
| --- | --- | --- |
| `src/error.ts` | alterar | Declarar `kProblem` (`Symbol.for("h3.problem")`) e `ProblemFields`. A declaração entra perto da classe `HTTPError` em `src/error.ts:74`. Nenhuma mudança em `constructor` (`src/error.ts:162`), `isError` (`src/error.ts:129`) ou `toJSON` (`src/error.ts:226`). |
| `src/utils/problem.ts` | criar | `ProblemInput` e `problem()` (ver §4). |
| `src/response.ts` | alterar | Novo ramo no início de `errorResponse` (`src/response.ts:358`) e nova função `problemResponse` logo abaixo. `prepareResponse` (`src/response.ts:146-174`) não muda. |
| `src/index.ts` | alterar | Uma linha de export na seção `// Error` (`src/index.ts:72`). |
| `test/problem.test.ts` | criar | Testes de cobertura da feature (ver §5). |
| `test/unit/package.test.ts` | alterar | Adicionar `"problem"` ao snapshot inline, entre `"parseCookies"` (`test/unit/package.test.ts:104`) e `"proxy"` (`test/unit/package.test.ts:105`). |
| `test/unit/types.test-d.ts` | alterar (opcional) | Checar `ProblemInput` (aceita `type`/`instance`, rejeita chave extra em literal). |

Nenhum teste existente precisa mudar além do snapshot. Os testes de formato atual em `test/errors.test.ts:67-86` (`throw HTTPError`), `test/errors.test.ts:107-122` (`unhandled`) e `test/errors.test.ts:44` (`application/json;charset=UTF-8`) continuam válidos porque os erros deles não usam `problem()` (RF-08).

## 4. Contratos e assinaturas

### 4.1 `src/error.ts` (interno)

```ts
/** Campos RFC 9457 guardados junto do erro criado por `problem()`. */
export interface ProblemFields {
  type?: string;
  instance?: string;
}

/** Marca interna: presente só em erros criados por `problem()`. Não exportada pelo pacote. */
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");
```

### 4.2 `src/utils/problem.ts` (novo)

```ts
import { HTTPError, kProblem, type ErrorInput, type ProblemFields } from "../error.ts";

/**
 * Input of {@link problem}: the `HTTPError` input plus the RFC 9457 `type` and `instance` members.
 */
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** RFC 9457 `type` URI. Omitted from the body means `about:blank`. */
  type?: string;
  /** RFC 9457 `instance` URI. Omitted from the body when not set. */
  instance?: string;
}

/**
 * Create an `HTTPError` that is serialized as RFC 9457 problem details (`application/problem+json`).
 *
 * @example
 *
 * throw problem({ status: 404, statusText: "Not Found", message: "Pedido 42 não existe" });
 */
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT> {
  const { type, instance, ...errorInput } = input;
  const error = new HTTPError<DataT>(errorInput);
  Object.defineProperty(error, kProblem, {
    value: { type, instance } satisfies ProblemFields,
  });
  return error;
}
```

Observações:
- `new HTTPError(errorInput)` faz toda a normalização já existente (status, statusText, headers, unhandled, data, body). `problem()` não reimplementa nada disso.
- `type` e `instance` saem de `errorInput` antes do construtor, então não entram em `cause`.
- `Object.defineProperty` com `value` e sem `enumerable` deixa a marca não enumerável e somente leitura.

### 4.3 `src/response.ts` (interno)

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problemFields = (error as any)[kProblem] as ProblemFields | undefined;
  if (problemFields) {
    return problemResponse(error, problemFields, debug, errHeaders);
  }
  // ...código atual, sem alteração
}

function problemResponse(
  error: HTTPError,
  fields: ProblemFields,
  debug?: boolean,
  errHeaders?: Headers,
): Response {
  const unhandled = error.unhandled;
  const headers = mergeHeaders(error.headers ?? {}, errHeaders ?? new Headers());
  headers.set("content-type", "application/problem+json");
  const body = {
    ...(unhandled ? undefined : error.body),
    ...(unhandled || error.data === undefined ? undefined : { data: error.data }),
    type: fields.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? undefined : error.message,
    instance: fields.instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
  return new FastResponse(JSON.stringify(body, undefined, debug ? 2 : undefined), {
    status: error.status,
    statusText: error.statusText,
    headers,
  });
}
```

Notas sobre o sketch:
- `JSON.stringify` descarta chaves com `undefined`, então `title`, `detail`, `instance` e `stack` somem quando ausentes (RF-04, RF-06, D-06).
- `data` só entra quando definido; se não, um `body.data` existente é preservado (D-05).
- A ordem de `headers` segue D-09. `mergeHeaders(base, overrides)` (`src/response.ts:243`) recebe `HeadersInit` na base; `error.headers` já é `Headers | undefined` (`src/error.ts:97`), então `?? {}` cobre o caso sem header.
- Se `title` não existir, o membro é omitido (RF-04 e `prd.md` premissas).

### 4.4 Assinaturas públicas

- `problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>` (`src/utils/problem.ts`).
- `ProblemInput<DataT = unknown>` (tipo, exportado).

Nenhuma outra assinatura pública muda.

## 5. Estratégia de testes

Arquivo `test/problem.test.ts`, usando `describeMatrix` (`test/_setup.ts:11`) para rodar web e node. Cada RF do PRD vira um ou mais casos:

| Caso | RF | Verificação |
| --- | --- | --- |
| `problem` exportado e devolve `HTTPError` com `status` correto | RF-01 | `instanceof`/`HTTPError.isError` e `status`. |
| `throw problem()` chega em `onError` como `HTTPError` | RF-02 | `onError` recebe o erro; `res.status` é 422. |
| `type` e `instance` informados aparecem no corpo | RF-03 | Body `toMatchObject`. |
| `type` ausente vira `"about:blank"`; `instance` ausente não aparece | RF-03 | `"instance" in body === false`. |
| Content-Type `application/problem+json`; corpo com `type`, `title`, `status`, `detail` | RF-04 | Exato, com `res.headers.get("content-type")`. |
| `statusText` ausente → sem `title` | RF-04 | `"title" in body === false`. |
| `data` como `data`; `body` espalhado; colisão `body.status: 999` perde para `status: 409` | RF-05 | Body e `status`. Incluir também `body.type` e `body.title` colidindo. |
| `unhandled: true` sem `detail` nem `data` | RF-06 | `status: 500`, `type: "about:blank"`, sem `detail`/`data`; `message` do erro não aparece no corpo. |
| `input.headers` preserva `www-authenticate`; `content-type: text/plain` vencido | RF-07 | `res.headers`. |
| `throw HTTPError.status(404, ...)` continua `application/json;charset=UTF-8` e formato antigo | RF-08 | Comparar com corpo esperado do formato atual. |
| `errHeaders` (`event.res.headers` com `set-cookie` via `kEventResErrHeaders`) continua funcionando com `problem()` | D-09 | `getSetCookie()`. |
| `debug: true` inclui `stack`; `debug` desligado não inclui | D-06 | Presença de `stack`. |
| Um `throw` de objeto arbitrário com campos `type` e `status` continua como 500 legado | D-01 (segurança) | `status: 500`, `unhandled: true`. |

Teste de snapshot de exports: `test/unit/package.test.ts` (atualizado, ver §3).

Teste de tipos (opcional, `test/unit/types.test-d.ts`): `problem({ status: 404, type: "x" })` compila; `problem({ status: 404, extra: 1 })` falha em literal.

Comandos de verificação (AGENTS.md): `pnpm vitest run test/problem.test.ts`, `pnpm vitest run test/errors.test.ts test/unit/package.test.ts`, depois `pnpm lint` e `pnpm typecheck`, e por fim `pnpm vitest run` (suíte completa). Seguir o fluxo de bug fix do AGENTS.md: escrever os testes primeiro e confirmar que falham antes da implementação (os de `problem` falham por ausência do export; os de RF-08 devem passar antes e depois).

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Colisão de membros em `body` (`type`, `title`, `status`, `detail`, `instance`) | Corpo com valor errado | D-05 com ordem explícita; teste de colisão em §5. |
| Vazamento de `detail`/`data` em `unhandled` | Exposição de dados internos | D-07; teste de RF-06 com `message` sentinela. |
| `onError` que lê `error.toJSON()` ou reescreve o corpo | Comportamento diferente do esperado para erros de `problem()` | D-03 documenta; teste de `onError` cobre o caminho de hook (RF-02). |
| `Symbol.for("h3.problem")` pode ser lido por código que conhece o nome | Baixo: não há entrada de usuário que alcance a marca | Mesmo modelo de `kHTTPResponse`; a marca só existe em `HTTPError` criado por `problem()`. |
| `new HTTPError(problemErr)` ou `new HTTPError({ cause: problemErr })` reempacota o erro | Sai no formato legado, não problem | Documentar no JSDoc de `problem()`; aceitar como limitação (fora de escopo). |
| `Content-Type` sem charset pode confundir clientes que esperam o padrão do h3 | Baixo | D-04; decidir com o time antes de implementar (ver §7). |
| Superfície pública (RF-09) | Um export extra quebra o contrato | Snapshot de exports em `test/unit/package.test.ts`; revisão obrigatória se surgir novo nome. |
| `prepareResponse` limpa `event.res` antes de `errorResponse` (`src/response.ts:172`) | Nenhum para este caminho; `errHeaders` já é lido antes da limpeza (`src/response.ts:160`) | Coberto por teste de `errHeaders` em §5. |

## 7. Pontos a confirmar antes da implementação

1. **D-04:** `application/problem+json` sem charset (escolha desta spec) ou com `;charset=UTF-8` como o resto do h3.
2. **D-06:** incluir `stack` em modo debug no formato problem (escolha desta spec) ou omitir.
3. **D-03:** aceitar que `toJSON()` continua no formato antigo para `onError` que o chama.

Se qualquer um dos três mudar, atualizar a seção correspondente e o caso de teste em §5 antes de implementar.
