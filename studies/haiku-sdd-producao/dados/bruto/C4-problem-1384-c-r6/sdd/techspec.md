# Tech spec — Problem details (RFC 9457) por utilitário explícito

Fontes: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-09). Esta spec fixa as decisões técnicas e mapeia os arquivos que o código atual exige.

## Contexto técnico

Todo erro que chega ao cliente passa por `prepareResponse` (`src/response.ts:129`), que, no ramo de erro (`src/response.ts:146-174`), normaliza o valor em `HTTPError` e chama `errorResponse` (`src/response.ts:173`). `errorResponse` (`src/response.ts:358-380`) é o único ponto que serializa erros em resposta. Ele usa `error.toJSON()` (`src/response.ts:368`) e os cabeçalhos `jsonHeaders` (`src/response.ts:270-272`).

Hoje `HTTPError.toJSON` (`src/error.ts:226-236`) monta `status`, `statusText`, `unhandled`, `message`, `data` e espalha `body` por último (`src/error.ts:234`). Isso significa que `body.status` sobrescreve o status do JSON. O RF-05 exige o contrário, mas só para erros de `problem`. Por isso `toJSON` não pode mudar.

O ramo de `onError` (`src/response.ts:161-166`) reentra em `prepareResponse` com `nested = true`. Um `problem(...)` devolvido por `onError` também passa por `errorResponse`. Ambos os caminhos são cobertos sem código extra.

## Decisões de arquitetura

### D-01 — Ponto de serialização: `errorResponse`, sem tocar em `HTTPError.toJSON`

**Escolha.** `errorResponse` (`src/response.ts:358`) escolhe entre `error.toJSON()` e uma nova função `toProblemJSON(error, meta)` quando o erro traz a marca interna de `problem` (D-02). Os cabeçalhos também mudam só nesse ramo (D-07).

**Alternativas.**
- Alterar `HTTPError.toJSON` para detectar a marca. Rejeitada: `toJSON` é usado por `JSON.stringify` em qualquer lugar e é lido por hooks e logs. Mudar seu formato afetaria erros que não usam `problem`, o que o RF-07 e a seção "fora de escopo" do PRD proíbem.
- Criar uma subclasse `ProblemError`. Rejeitada: `HTTPError.isError` (`src/error.ts:129-133`) já reconhece por `name` e `status`, mas uma subclasse cria tipo público implícito e um segundo caminho de serialização.

**Por que.** Uma única mudança, em um único ponto, que só dispara para erros marcados.

### D-02 — Marca interna: símbolo `Symbol.for("h3.problem")` definido com `Object.defineProperty`

**Escolha.** `problem` grava os metadados (`type`, `instance`) no erro sob o símbolo `kProblem`, criado com `Symbol.for("h3.problem")`, como as marcas `kHTTPResponse` (`src/response.ts:94`) e `kEventRes` (`src/event.ts:16`). A propriedade é não enumerável (`Object.defineProperty`), então não aparece em `Object.keys` nem em spreads comuns.

**Alternativas.**
- `WeakMap` em módulo. Rejeitada: duas cópias do h3 no mesmo processo (dupla instalação, realms diferentes) teriam mapas separados. `Symbol.for` resolve esse caso, o mesmo motivo do comentário em `src/response.ts:88-93`.
- Propriedade string enumerável (`__problem`). Rejeitada: vaza para `Object.keys` de quem captura o erro em `onError`.
- Campo público no `HTTPError`. Rejeitada: cria nome público, o que o PRD veda.

**Por que.** Não cria nome público (RF-02), é imune a duplicação de módulo e não muda `toJSON` nem `isError`.

**Consequência.** Como a marca fica no próprio objeto, `throw problem(...)`, `onError` e o retorno de `onError` preservam o formato sem nenhum código adicional.

### D-03 — Divisão de arquivos: utilitário público separado do serializador interno

**Escolha.**
- `src/utils/problem.ts` (novo): exporta `problem` e `type ProblemInput`. Segue o padrão de `src/utils/*.ts` como API pública (`src/utils/response.ts`).
- `src/utils/internal/problem.ts` (novo): exporta `kProblem`, `interface ProblemMeta` e `toProblemJSON`. Usado só por `src/response.ts`.

**Alternativas.** Colocar tudo em `src/error.ts`. Rejeitada: o arquivo já tem 237 linhas, acima do limite de ~200 LoC do AGENTS.md, e o serializador não pertence ao modelo do erro.

**Por que.** AGENTS.md pede helpers internos em `utils/internal/` e arquivos curtos. Não há ciclo: `utils/internal/problem.ts` importa só o tipo `HTTPError`.

### D-04 — Forma de `ProblemInput`: `ErrorInput` sem os campos deprecated, mais `type` e `instance`

**Escolha.**
```ts
export type ProblemInput = Omit<ErrorInput, "statusCode" | "statusMessage"> & {
  type?: string;
  instance?: string;
};
```

**Alternativas.** Herdar `ErrorInput` por completo. Rejeitada: o PRD (Riscos) pede que `statusCode`/`statusMessage` sejam cobertos ou excluídos de forma explícita. Excluir no tipo é a forma explícita mais simples. Um nome novo para o tipo cumpre RF-02.

**Limite conhecido.** Em runtime, `new HTTPError(input)` ainda lê `statusCode`/`statusMessage` (`src/error.ts:174`, `:182`, `:192`) para quem chamar sem TypeScript. Não é alterado: não é API documentada e mudar o construtor afetaria o que já existe.

### D-05 — Membros de `body` reservados são removidos, não apenas sobrepostos

**Escolha.** Em `toProblemJSON`, as chaves de `error.body` com nomes `type`, `title`, `status`, `detail` e `instance` são descartadas. Elas nunca vão para o JSON, mesmo quando o membro padrão correspondente não existe (por exemplo, `body.instance` sem `instance` informado). O RF-05 diz que o body "não sobrescreve" os membros padrão. Descartar cobre também o caso em que o membro está ausente.

**Alternativas.** Montar primeiro os membros padrão e depois espalhar `body`, como `toJSON` faz hoje. Rejeitada: deixa `body.instance` aparecer quando `instance` não foi informado, o que contraria a RFC (o membro `instance` é do erro, não do body).

### D-06 — Precedência de `data`

**Escolha.** `data` é gravado como membro `data` quando `error.data !== undefined` e o erro não é `unhandled`. Quando `data` é `undefined`, `body.data` continua como extensão. Não há regra no PRD para esse caso; esta é a escolha.

### D-07 — `Content-Type` fixo em `application/problem+json`

**Escolha.** Para erros de `problem`, `errorResponse` parte de um cabeçalho `problemHeaders` (novo `FrozenHeaders`, ao lado de `jsonHeaders` em `src/response.ts:270`) com `content-type: application/problem+json`. Depois de mesclar `error.headers` e `errHeaders`, o `content-type` é reatribuído com `headers.set`. Assim nem `headers` nem `event.res.errHeaders` trocam o tipo de mídia (RF-03 exige o valor exato). Os demais cabeçalhos informados são aplicados normalmente.

**Alternativas.** Deixar o usuário sobrescrever `content-type` via `headers`. Rejeitada: quebra o contrato RF-03, e o usuário pode informar `application/json` por engano.

### D-08 — Erros `unhandled`

**Escolha.** Com `unhandled: true`, `detail` vale `"HTTPError"` (igual a `error.toJSON`, `src/error.ts:232`), `data` e `body` não são serializados (RF-06). `title` (`statusText`) e `type`/`instance` são mantidos. `type` e `instance` são definidos pelo desenvolvedor e não são dados internos.

**Risco associado.** `instance` pode conter um caminho interno se o app o montar a partir de dados sensíveis. Ver Riscos.

### D-09 — `title` e tabela de frases

**Escolha.** `title` é `error.statusText` (já sanitizado em `src/error.ts:200`). Sem `statusText`, a chave é omitida, porque `JSON.stringify` descarta `undefined`. Nenhuma tabela de frases padrão. Conforme o PRD.

### D-10 — `stack` em modo debug

**Escolha.** O campo `stack` continua sendo adicionado em modo debug (`src/response.ts:369`), o mesmo que hoje. A RFC 9457 permite extensões. O teste de RF-04 roda sem debug, então o corpo exato não muda.

### D-11 — Fora de escopo confirmado no código

- JSON-RPC (`src/utils/json-rpc.ts:483-488`) monta o próprio envelope. Um `problem` lançado dentro de um handler JSON-RPC não vira RFC 9457. Fica de fora, conforme o PRD.
- `_deprecated.ts` não muda.
- `CHANGELOG.md` é gerado pelo `changelogen` no release. Não editar.

### D-12 — Exports e snapshot

**Escolha.** `src/index.ts:72` ganha uma linha de export para `problem` e `ProblemInput`. Como `src/_entries/generic.ts:6` faz `export * from "../index.ts"`, todos os entries recebem o novo nome. `test/unit/package.test.ts` tem um snapshot de nomes exportados (`:5-6`). Ele precisa receber `"problem"` em ordem alfabética, antes de `"proxy"` (`:105`). `ProblemInput` é tipo e não aparece no snapshot. Esse é o único teste existente que muda, e a mudança é só adicionar a linha.

## Contratos e assinaturas

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";
import { kProblem } from "./internal/problem.ts";

export type ProblemInput = Omit<ErrorInput, "statusCode" | "statusMessage"> & {
  /** URI que identifica o tipo do problema (RFC 9457 §3.1.1). Padrão na serialização: "about:blank". */
  type?: string;
  /** URI que identifica a ocorrência do problema (RFC 9457 §3.1.5). */
  instance?: string;
};

/**
 * Create an HTTPError that is rendered as an RFC 9457 problem details response.
 */
export function problem(input: ProblemInput): HTTPError {
  const error = new HTTPError(input);
  Object.defineProperty(error, kProblem, {
    value: { type: input.type, instance: input.instance },
  });
  return error;
}
```

```ts
// src/utils/internal/problem.ts
import type { HTTPError } from "../../error.ts";

export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

export interface ProblemMeta {
  type?: string;
  instance?: string;
}

/** Membros padrão da RFC 9457; chaves homônimas de `body` são descartadas (D-05). */
const kReservedMembers: ReadonlySet<string> = new Set(["type", "title", "status", "detail", "instance"]);

export function toProblemJSON(error: HTTPError, meta: ProblemMeta): Record<string, unknown> {
  const unhandled = error.unhandled;
  const extensions = Object.entries(unhandled ? {} : (error.body ?? {})).filter(
    ([key]) => !kReservedMembers.has(key),
  );
  return {
    type: meta.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? "HTTPError" : error.message,
    instance: meta.instance,
    ...Object.fromEntries(extensions),
    ...(!unhandled && error.data !== undefined ? { data: error.data } : undefined),
  };
}
```

```ts
// src/response.ts — alteração em errorResponse (assinatura inalterada)
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problem = (error as any)[kProblem] as ProblemMeta | undefined;
  // ...mesclagem atual de error.headers e errHeaders, com base problemHeaders | jsonHeaders...
  // Ao final: if (problem) headers.set("content-type", "application/problem+json");
  // Corpo: problem ? toProblemJSON(error, problem) : error.toJSON(), mais stack em debug.
}
```

Observação de tipo: `problem` e `toProblemJSON` são exportados e precisam de tipo de retorno explícito por causa de `isolatedDeclarations` (`tsconfig.json`, AGENTS.md).

Comportamento observável (corpo, sem debug):

| Entrada | Status | Content-Type | Corpo |
|---|---|---|---|
| `problem({ status: 422, message: "Campo 'nome' inválido" })` | 422 | `application/problem+json` | `{"type":"about:blank","status":422,"detail":"Campo 'nome' inválido"}` |
| `problem({ status: 500, message: "senha…", unhandled: true, data: {…} })` | 500 | `application/problem+json` | sem `data`, `detail: "HTTPError"` |
| `new HTTPError(...)` (não usa `problem`) | conforme erro | `application/json;charset=UTF-8` | `toJSON()` atual (sem mudança) |

## Arquivos a alterar

Novos:
- `src/utils/problem.ts`: `problem`, `ProblemInput` (D-03, D-04).
- `src/utils/internal/problem.ts`: `kProblem`, `ProblemMeta`, `toProblemJSON` (D-02, D-03, D-05, D-06, D-08).
- `test/problem.test.ts`: testes com `describeMatrix` (`test/_setup.ts:11`).

Alterados:
- `src/response.ts:8`: importar `kProblem`, `ProblemMeta` e `toProblemJSON` de `./utils/internal/problem.ts`.
- `src/response.ts:270-272`: adicionar `problemHeaders` ao lado de `jsonHeaders` (D-07).
- `src/response.ts:358-380`: `errorResponse` escolhe entre `toProblemJSON` e `toJSON`, e aplica `content-type` ao final (D-01, D-07, D-10).
- `src/index.ts:72`: adicionar `export { problem, type ProblemInput } from "./utils/problem.ts";` na seção `// Error` (D-12).
- `test/unit/package.test.ts:105`: adicionar `"problem",` antes de `"proxy",` no snapshot (D-12).

Opcional (fora do mínimo, recomendado em PR separado):
- `docs/1.guide/1.basics/6.error.md`: documentar `problem`.

Não alterar: `src/error.ts` (incluindo `toJSON`, `:226-236`), `src/utils/middleware.ts`, `src/utils/json-rpc.ts`, `src/_deprecated.ts`.

## Estratégia de testes

Seguindo AGENTS.md: testes com `describeMatrix`, para rodar nos modos `web` e `node` (RF-08). Como é funcionalidade nova e não correção de bug, a regra "teste falhando antes" não se aplica diretamente. Ainda assim, cada teste deve falhar antes da implementação, porque a funcionalidade não existe.

`test/problem.test.ts`, um caso por requisito:

1. **RF-01**: `problem({status: 404, message})` devolve `HTTPError.isError(e) === true`, com `status` e `message` corretos.
2. **RF-02**: `type` e `instance` aparecem no JSON.
3. **RF-03**: status, `content-type` exato `application/problem+json`, `x-motivo` aplicado. Também: `headers: { "content-type": "text/plain" }` não altera o tipo de mídia (D-07).
4. **RF-04**: corpo igual a `{type: "about:blank", status: 422, detail}` (`toEqual`, sem `title`). Com `statusText`, `title` aparece.
5. **RF-05**: `body: { saldo: 10, status: "x", type: "y", instance: "z" }` não sobrescreve nem vaza os membros padrão; `data` aparece em `data`. Cobrir o caso `body.instance` sem `instance` informado (D-05).
6. **RF-06**: `unhandled: true` não expõe `message`, `data` nem `body`; `detail === "HTTPError"`.
7. **RF-07**: `HTTPError.status(404, "Not Found", {message})` continua com `application/json;charset=UTF-8` e o JSON atual. Basear no padrão de `test/errors.test.ts:44`.
8. **onError**: erro de `problem` passa pelo hook e continua no formato (`onError` com `hook` que não devolve nada). Também: `onError` que devolve `problem(...)` é renderizado no formato.
9. **HEAD**: a resposta não tem corpo e mantém o `content-type` (`nullBody`, `src/response.ts:350`).
10. **Erro sem status**: `problem({ message: "x" })` vira 500, como `HTTPError`.

Testes unitários opcionais: `toProblemJSON` com `unhandled`, com `data` `undefined` e com `body.data` (D-06).

`test/unit/package.test.ts`: snapshot atualizado com `"problem"` (D-12).

Tipos: `test/unit/types.test-d.ts` ganha `expectTypeOf<ProblemInput>().toHaveProperty("type")` e um `// @ts-expect-error` para `statusCode`, cobrindo D-04.

Comandos de verificação:
- `pnpm vitest run test/problem.test.ts`
- `pnpm vitest run test/unit/package.test.ts`
- `pnpm vitest run` (suíte completa, sem alterar `test/errors.test.ts`)
- `pnpm lint` (oxlint + oxfmt)
- `pnpm typecheck`

Atenção: AGENTS.md descreve `pnpm lint` como "lint + typecheck", mas `package.json:46` define `lint` só como `oxlint . && oxfmt --check .`. O typecheck é o script `typecheck` (`package.json:54`) e precisa ser rodado separadamente. O PRD pede os dois, então ambos rodam.

## Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Colisão de nomes entre `body` e membros padrão (PRD, Riscos) | D-05, testes do item 5 |
| R2 | `instance` com caminho interno exposto em erro `unhandled` | `instance` é definido pelo desenvolvedor (D-08). Documentar. Se o app montar `instance` a partir de dados sensíveis, a responsabilidade é dele. |
| R3 | `statusCode`/`statusMessage` aceitos em runtime por JS (`src/error.ts:174-192`) | Excluídos do tipo (D-04). Sem teste de runtime, porque não é API. |
| R4 | `Symbol.for` permite que outra cópia do h3 reconheça a marca | É o comportamento desejado (D-02). Um objeto JSON não consegue criar símbolo, então não há forja a partir de entrada não confiável. Mesmo padrão de `kHTTPResponse` (`src/response.ts:88-94`). |
| R5 | Efeito em `onError` e logs (PRD, Riscos) | A marca fica não enumerável e não altera `toJSON` nem `isError` (D-01, D-02). Coberto pelo teste 8. |
| R6 | Cliente que compara `Content-Type` exato (PRD, Riscos) | Opt-in, só para `problem` (D-07). |
| R7 | JSON-RPC não usa o formato RFC (D-11) | Fora de escopo. Documentar que `problem` não afeta o envelope JSON-RPC. |
| R8 | `isolatedDeclarations` exige tipos explícitos em exports novos | Tipos de retorno explícitos em `problem` e `toProblemJSON`. Se o `tsc` reclamar, o erro aparece em `pnpm typecheck`. |
| R9 | Snapshot de exports quebra | Atualização de uma linha em `test/unit/package.test.ts:105` (D-12). É o único ajuste em teste existente, dentro do que o RF-09 permite. |
