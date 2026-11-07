# Especificação técnica — Respostas de erro em problem details (RFC 9457)

Origem: `sdd/pedido.md` (contrato enxuto #1384-B) e `sdd/prd.md` (RF-01 a RF-08).

## Visão geral

Hoje todo erro vira JSON próprio em `errorResponse` (`src/response.ts:358-380`), montado a partir de `HTTPError.toJSON()` (`src/error.ts:226-236`), com `Content-Type: application/json;charset=UTF-8` (`src/response.ts:270-272`). A mudança faz três coisas:

1. `HTTPError.toJSON()` passa a produzir o corpo RFC 9457 (`type`, `title`, `status`, `detail`, `instance`) e mantém, como membros de extensão, os campos atuais (`statusText`, `message`, `data`, `unhandled`, `body`).
2. `errorResponse` passa a enviar `Content-Type: application/problem+json;charset=UTF-8` sempre.
3. `HTTPError` aceita e expõe `type` e `instance`. Nenhum outro nome público é criado.

O formato é único e sem configuração. O caminho de JSON-RPC (`src/utils/json-rpc.ts`) não muda, porque usa envelope próprio do protocolo.

---

## Decisões de arquitetura

### D-01 — Formato único de problem details, sem opção nem negociação

**Escolha:** todo erro gerado pelo h3 sai como `application/problem+json`. Não há flag, não há leitura do `Accept`.

**Alternativas consideradas:**
- Opção `errorFormat: "problem" | "json"` no `H3Config`. Descartada: o pedido proíbe gatilho de configuração, e o PRD exclui essa opção.
- Negociar pelo `Accept` (responder `application/json` quando o cliente pedir). Descartada: está fora de escopo no PRD, e exigiria tocar em todo caminho de erro.
- Manter os dois formatos em paralelo. Descartada: duplica a lógica de erro e contradiz o objetivo de formato padrão.

**Justificativa:** é o que o pedido pede. A compatibilidade fica por conta dos membros de extensão (D-03), não de um segundo formato.

### D-02 — `HTTPError.toJSON()` é a única fonte do corpo

**Escolha:** a montagem do corpo fica em `HTTPError.toJSON()` (`src/error.ts:226`). `errorResponse` só acrescenta `stack` em debug, como hoje (`src/response.ts:369`).

**Alternativas consideradas:**
- Montar o corpo dentro de `errorResponse` e deixar `toJSON()` com o formato antigo. Descartada: RF-06 exige que `toJSON()` preserve os campos atuais, e isso fica mais simples com uma fonte só. Dois lugares com o mesmo mapeamento divergiriam com o tempo.
- Criar uma função `toProblemDetails(error)` interna. Descartada: não há ganho, e `toJSON()` já é o ponto que o `JSON.stringify` consome.

**Justificativa:** `toJSON()` é o contrato que consumidores já chamam (`error.toJSON()`), e `errorResponse` já o usa. Uma fonte só mantém os dois alinhados.

### D-03 — Membros padrão vencem as extensões

**Escolha:** em `toJSON()`, `body` e as extensões entram primeiro no objeto; os membros padrão (`type`, `title`, `status`, `detail`, `instance`) e os legados (`statusText`, `message`, `data`, `unhandled`) entram depois, e por isso prevalecem em caso de colisão.

**Alternativas consideradas:**
- Manter a ordem atual, em que `...this.body` vem por último (`src/error.ts:234`). Descartada: hoje um `body: { status: 1 }` sobrescreve o status no JSON. Isso viola RF-05 e abre espaço para o corpo de erro dizer um status diferente do status HTTP.
- Remover `body` do corpo. Descartada: quebra RF-05 e a API atual.

**Justificativa:** RF-05 exige que membros de extensão não sobrescrevam os padrões. Também evita que `body` contradiga o status real.

### D-04 — `Content-Type` do h3 é aplicado por último

**Escolha:** `errorResponse` monta os headers como `new Headers(error.headers)`, mescla `errHeaders` e então faz `headers.set("content-type", "application/problem+json;charset=UTF-8")`. O `Content-Type` do h3 vence qualquer `content-type` vindo de `HTTPError.headers` ou de `event.res.errHeaders`.

**Alternativas consideradas:**
- Manter a precedência atual, em que `error.headers` sobrescreve o `jsonHeaders` (`src/response.ts:360`). Descartada: permitiria a um handler (ou a uma regra de `headers`) responder um erro com outro `Content-Type`, e RF-01 diz que toda resposta de erro envia `problem+json`.
- Aplicar o `Content-Type` só se o usuário não tiver definido um. Descartada: é o mesmo problema com outro nome, e exige um caso especial.

**Justificativa:** RF-01 e RF-07 pedem explicitamente que o `Content-Type` do h3 não se perca. **Trade-off:** quem definia `content-type` em `HTTPError.headers` deixa de conseguir isso. O uso é raro, e vai para o changelog (ver Riscos).

### D-05 — `type` e `instance` vêm só da entrada direta, não de `cause`

**Escolha:** o construtor lê `type` e `instance` apenas de `details` (`(details as ErrorBody)?.type`), sem o fallback para `details.cause` que `status`, `statusText` e `unhandled` têm.

**Alternativas consideradas:**
- Usar o mesmo fallback para `cause` (padrão de `status`, `statusText`, `headers` e `unhandled`). Descartada: `cause` costuma ser um erro de terceiros. Parsers e bibliotecas usam a propriedade `type` para outra coisa; por exemplo, erros de body-parser trazem `type: "entity.too.large"`. Herdar isso faria o h3 publicar um URI de problema que não é dele.

**Justificativa:** segurança e correção. `type` e `instance` são identificadores que o próprio desenvolvedor define no `HTTPError`. Propagar um valor de um erro externo seria erro silencioso. O caso `new HTTPError(rawError)` (`src/response.ts:148`, `src/utils/middleware.ts:48`) continua coberto pela regra de D-06, porque esses erros são sempre `unhandled`.

### D-06 — Erros `unhandled` mascaram `type` e `instance`

**Escolha:** quando `unhandled` é verdadeiro, o corpo usa `type: "about:blank"` e omite `instance`. Isso segue a regra que já mascara `message`, `data` e `body` (`src/error.ts:232-234`) e a regra de RF-04.

**Alternativas consideradas:**
- Expor `type` e `instance` mesmo em erros não tratados. Descartada: `instance` costuma carregar caminho, id ou dado de requisição, e `type` de um erro não tratado pode vir de biblioteca (ver D-05). RF-04 manda manter a privacidade atual.

**Justificativa:** consistência com o modelo de privacidade já existente. Na prática, `detail` continua sendo `"HTTPError"` nesses casos, como `message` hoje.

### D-07 — Frase padrão de status em tabela interna

**Escolha:** `title` usa `statusText` quando presente (já sanitizado, e `""` vira `undefined` em `src/error.ts:200`). Se ausente, usa uma tabela interna em `src/utils/internal/status.ts` (nova), com as frases registradas na IANA. Status fora da tabela recebe `"Unknown Error"`.

**Alternativas consideradas:**
- `STATUS_CODES` de `node:http`. Descartada: o h3 roda em Workers, navegadores e Deno, e importar `node:http` no módulo de erro quebra o entry `h3/generic`. Também viola "preferir APIs de web standard".
- `title` vazio ou omitido quando não há `statusText`. Descartada: RF-02 exige a frase padrão.
- Colocar a tabela em `src/error.ts`. Descartada: o arquivo fica grande, e a tabela é um detalhe interno. Um arquivo em `utils/internal/` segue a convenção do `AGENTS.md`.

**Justificativa:** `title` sempre preenchido, sem dependência de runtime. A tabela não entra no bundle de `h3/rules` porque `headers.ts` evita importar `error.ts` (`src/rules/handlers/headers.ts:38-41`).

### D-08 — `charset` mantido no `Content-Type`

**Escolha:** `application/problem+json;charset=UTF-8`.

**Alternativas consideradas:**
- `application/problem+json` puro. Descartada: o PRD diz "com charset, se o h3 já enviar charset hoje" (RF-01), e hoje o h3 envia.

**Justificativa:** mantém o padrão já usado pelo h3 e não cria diferença desnecessária. A RFC não define `charset` para `problem+json`, mas também não o proíbe, e JSON é UTF-8 por definição.

### D-09 — Sem nomes públicos novos

**Escolha:** o tipo de retorno de `toJSON()` é escrito inline. A tabela e a constante de content-type ficam internas, sem `export` em `src/index.ts`.

**Alternativas consideradas:**
- Exportar um tipo `ProblemDetails`. Descartada: o PRD proíbe nomes públicos além de `type` e `instance`, e o teste `test/unit/package.test.ts` compara o snapshot das exportações.

**Justificativa:** respeitar o contrato do PRD. O snapshot de exportações falha se algo novo vazar, então isso é verificado automaticamente.

### D-10 — Escopo fora da troca: JSON-RPC e `onError`

**Escolha:** `src/utils/json-rpc.ts` não muda. Respostas geradas por `onError` que devolvem `Response` próprio também não mudam, porque não passam por `errorResponse`.

**Justificativa:** JSON-RPC tem envelope próprio (`createJsonRpcError`) e não é uma resposta de erro HTTP do h3. Quem usa `onError` controla a própria resposta.

---

## Arquivos a alterar

### `src/error.ts`

- `src/error.ts:1`: adicionar `import { getReasonPhrase } from "./utils/internal/status.ts";` ao lado do import existente de `sanitize`.
- `src/error.ts:68`: depois de `body?: Record<string, unknown>;` (fim de `ErrorBody`, linha 30), adicionar `type?: string;` e `instance?: string;`, com JSDoc citando RFC 9457 §3.1.1 e §3.1.5. `ErrorInput` herda os campos porque estende `Partial<ErrorBody>` (`src/error.ts:6`).
- `src/error.ts:119`: depois de `readonly unhandled: boolean | undefined;`, adicionar `readonly type: string | undefined;` e `readonly instance: string | undefined;`.
- `src/error.ts:209`: depois de `this.body = (details as ErrorBody)?.body;`, adicionar `this.type = (details as ErrorBody)?.type;` e `this.instance = (details as ErrorBody)?.instance;` (D-05: sem `cause`).
- `src/error.ts:226-236`: reescrever `toJSON()` (ver contrato abaixo).

### `src/response.ts`

- `src/response.ts:270-272`: `jsonHeaders` continua existindo para respostas de sucesso. Não mexer.
- Adicionar, junto de `jsonHeaders`, a constante `const problemContentType = "application/problem+json;charset=UTF-8";`.
- `src/response.ts:358-380`: reescrever `errorResponse` (ver contrato abaixo). Hoje ela monta os headers a partir de `jsonHeaders` (`src/response.ts:360-361`) e os headers de erro vão por `mergeHeaders` (`src/response.ts:243`).
- `src/response.ts:146-174`: o fluxo de erro em `prepareResponse` não muda. Ele chama `errorResponse` em `src/response.ts:173`.

### `src/utils/internal/status.ts` (novo)

- Exporta apenas `getReasonPhrase(status: number): string`. A tabela é um `Map<number, string>` com as frases IANA. Ver contrato.

### `docs/1.guide/1.basics/6.error.md`

- Linhas 39-48: o exemplo de JSON passa a mostrar o corpo problem details (`type`, `title`, `status`, `detail`, `instance` quando houver, e os membros de extensão).
- Linhas 51-60: incluir `type` e `instance` na lista de campos de `HTTPError`.
- Linha 90: a dica de campos ocultos em erros `unhandled` passa a citar também `type` e `instance`, e o `Content-Type` passa a ser `application/problem+json`.
- `CHANGELOG.md` não é editado à mão: o projeto gera o changelog no release (`package.json`, script `release`). A nota de quebra vai para o texto de release.

### Testes

- `test/errors.test.ts:44`: `expect(res.headers.get("content-type")).toBe("application/json;charset=UTF-8");` passa a comparar com `"application/problem+json;charset=UTF-8"`. O que o teste verifica (headers de erro, `set-cookie`, `x-error-own`) não muda.
- `test/errors.test.ts:140`: `toMatch("application/json")` passa a `toMatch("application/problem+json")`.
- `test/errors.test.ts:53-57` e demais `toMatchObject` de corpo: continuam valendo, porque os campos legados foram mantidos. Não remover.
- Novo `test/problem-details.test.ts` (ver estratégia).
- `test/unit/types.test-d.ts`: adicionar asserções de tipo para `HTTPError.type`, `HTTPError.instance` e para `ErrorInput`.

### Não alterar

- `src/index.ts:72`: exportações não mudam (D-09).
- `src/utils/json-rpc.ts:478-491`: fora de escopo (D-10).
- `src/utils/middleware.ts:47-55` e `src/adapters.ts`: continuam criando `HTTPError` com `unhandled: true`, e a regra de D-06 cobre o resultado.

---

## Contratos e assinaturas

### `HTTPError` (`src/error.ts`)

```ts
export interface ErrorBody<DataT = unknown> {
  // ...campos existentes...
  /** URI reference do tipo do problema (RFC 9457 §3.1.1). Padrão no corpo: `about:blank`. */
  type?: string;
  /** URI reference da ocorrência (RFC 9457 §3.1.5). Omitido do corpo quando ausente. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ...campos existentes...
  /** Valor informado em `type`. `undefined` quando ausente (o corpo usa `about:blank`). */
  readonly type: string | undefined;
  /** Valor informado em `instance`. */
  readonly instance: string | undefined;

  toJSON(): {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance?: string;
    statusText?: string;
    unhandled?: boolean;
    message: string;
    data?: unknown;
    [key: string]: unknown;
  };
}
```

Comportamento de `toJSON()`, em ordem de montagem (D-03):

```ts
toJSON() {
  const unhandled = this.unhandled;
  const message = unhandled ? "HTTPError" : this.message;
  return {
    ...(unhandled ? undefined : this.body), // 1. extensões primeiro
    statusText: this.statusText,            // 2. legados (RF-06)
    unhandled,
    message,
    data: unhandled ? undefined : this.data,
    type: unhandled ? "about:blank" : (this.type ?? "about:blank"), // 3. padrões vencem (RF-05)
    title: this.statusText ?? getReasonPhrase(this.status),
    status: this.status,
    detail: message,
    instance: unhandled ? undefined : this.instance,
  };
}
```

Regras que essa montagem garante:
- `status` = status HTTP da resposta (RF-02).
- `title` = `statusText` ou frase padrão (RF-02).
- `detail` = `message`, ou `"HTTPError"` quando `unhandled` (RF-04).
- `instance` omitido do JSON quando `undefined` (JSON.stringify descarta a chave).
- `statusText`, `unhandled` e `data` aparecem quando definidos, como hoje (RF-06).

### `errorResponse` (`src/response.ts`)

```ts
const problemContentType = "application/problem+json;charset=UTF-8";

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  let headers: Headers = new Headers(error.headers);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  headers.set("content-type", problemContentType); // D-04: vence headers do usuário
  return new FastResponse(
    JSON.stringify(
      {
        ...error.toJSON(),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

### `getReasonPhrase` (`src/utils/internal/status.ts`, novo)

```ts
const reasonPhrases: Map<number, string> = new Map([
  [400, "Bad Request"],
  [401, "Unauthorized"],
  // ...demais códigos registrados na IANA, com a grafia do registro...
  [418, "I'm a teapot"],
  [500, "Internal Server Error"],
  // ...
]);

/** Frase padrão do status (RFC 9110), usada quando o erro não tem `statusText`. */
export function getReasonPhrase(status: number): string {
  return reasonPhrases.get(status) ?? "Unknown Error";
}
```

Sem exportação em `src/index.ts`, e o arquivo não é alcançável pelos entries públicos além de `src/error.ts`.

---

## Exemplos de resposta esperada

Entrada: `new HTTPError({ status: 422, statusText: "Unprocessable Content", message: "Campo inválido", data: { campo: "email" } })`

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json;charset=UTF-8
```
```json
{
  "statusText": "Unprocessable Content",
  "message": "Campo inválido",
  "data": { "campo": "email" },
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Campo inválido"
}
```
(`unhandled` e `instance` não aparecem: são `undefined`, e `JSON.stringify` descarta a chave.)

Entrada: `new Error("segredo do banco")` sem modo debug. A resposta é `status: 500`, `title: "Internal Server Error"`, `type: "about:blank"`, `detail: "HTTPError"`, `message: "HTTPError"`, `unhandled: true`, e o corpo não contém a string `segredo do banco`.

Entrada: `throw 404` (`src/response.ts:78`). `title: "Not Found"`, `type: "about:blank"`.

---

## Estratégia de testes

Seguindo `AGENTS.md` (fluxo de bug fix): escrever primeiro os testes que devem falhar, confirmar a falha, depois implementar.

### Testes novos — `test/problem-details.test.ts`

Todos com `describeMatrix` (web e node):

| Teste | Cobre |
|---|---|
| `throw new HTTPError({ status: 404 })` → status 404 e `content-type` = `application/problem+json;charset=UTF-8` | RF-01 |
| Corpo exato do exemplo 422 (`type`, `title`, `status`, `detail`) | RF-02 |
| `throw 404` e `new HTTPError({ status: 418 })` sem `statusText` → `title` com a frase padrão | RF-02, D-07 |
| `status` fora da tabela (ex.: 599 sem texto) → `title: "Unknown Error"` | D-07 |
| `error.type` e `error.instance` expostos; valores no corpo | RF-03 |
| `new HTTPError({ cause: { type: "x" }, status: 400 })` → corpo com `type: "about:blank"` | D-05 |
| `new Error("segredo do banco")` sem debug → 500, `problem+json`, corpo sem a string secreta, `detail: "HTTPError"` | RF-04 |
| Erro `unhandled` com `type` e `instance` → corpo com `about:blank` e sem `instance` | D-06 |
| `body: { status: 1, type: "x", title: "y", detail: "z" }` e `data` → padrões prevalecem, `campo` no nível superior | RF-05, D-03 |
| `toJSON()` contém `status`, `statusText`, `message`, `data`, `unhandled` | RF-06 |
| `headers: { "www-authenticate": "Basic" }` → 401, header presente, `content-type` do h3 | RF-07 |
| `headers: { "content-type": "text/plain" }` em `HTTPError` → `content-type` continua `problem+json` | D-04 |
| `event.res.errHeaders.set("x-err", "1")` → header presente na resposta de erro | RF-07 |
| Modo debug → `stack` presente; sem debug → ausente | RF-04 |
| HEAD com erro → sem corpo, `content-type` problem+json | regressão |

### Testes existentes a ajustar

Só os dois pontos listados em "Arquivos a alterar" (`test/errors.test.ts:44` e `:140`). O restante da suíte deve passar sem mudança. Qualquer outro teste que falhe é sinal de regressão, não de ajuste.

### Testes de tipo — `test/unit/types.test-d.ts`

- `expectTypeOf(new HTTPError({ status: 400, type: "x" }).type).toEqualTypeOf<string | undefined>()`.
- `ErrorInput` aceita `type` e `instance` (sem erro de compilação).

### Comandos de verificação

```bash
pnpm vitest run test/problem-details.test.ts test/errors.test.ts   # novos e ajustados
pnpm vitest run test/unit/package.test.ts                          # snapshot de exports: sem nomes novos
pnpm vitest run test/rules/treeshake.test.ts                       # orçamento de bundle
pnpm typecheck
pnpm lint
pnpm test                                                          # suíte completa com cobertura
```

---

## Riscos

1. **Quebra de `Content-Type` (alto).** Clientes que checam `application/json` em respostas de erro deixam de reconhecê-las. Mitigação: nota de quebra no release e aval de versão (ver pendências). O PRD já aponta isso.
2. **Precedência de `content-type` (médio, D-04).** Quem definia `content-type` em `HTTPError.headers` perde essa possibilidade. Mitigação: documentar em `docs/1.guide/1.basics/6.error.md`.
3. **Colisão de chaves de `body` (médio).** Antes, `body` podia sobrescrever `status` (`src/error.ts:234`). Agora `title`, `type`, `detail`, `instance` e `status` do `body` são sempre sobrescritos pelos padrões (D-03). Quem usava essas chaves em `body` perde o valor. Mitigação: nota de quebra.
4. **Sem negociação por `Accept` (médio).** Clientes que pedem JSON clássico não têm alternativa. Está fora de escopo (PRD), e fica registrado.
5. **Vazamento por membros de extensão (baixo, já existente).** `data` e `body` continuam indo ao cliente em erros tratados, como hoje. A mudança não adiciona campo automático. `type` e `instance` são fornecidos pelo desenvolvedor (D-05), e são mascarados em erros `unhandled` (D-06).
6. **`type` de erros de terceiros (baixo, mitigado por D-05).** Sem o fallback para `cause`, um `type` de biblioteca não vaza para o corpo como problem type.
7. **Bundle (baixo).** A tabela de frases entra em `error.ts`, que o `h3/rules` evita (`src/rules/handlers/headers.ts:38-41`). O teste `test/rules/treeshake.test.ts` cobre o orçamento. Se ele falhar, mover a tabela para carregamento sob demanda ou reduzi-la aos códigos usados.
8. **Desempenho (baixo).** `errorResponse` cria um `Headers` a mais e monta o corpo com mais chaves. Erros não estão no caminho de sucesso. Se houver regressão, verificar com `pnpm bench:node`.
9. **Status sem frase (baixo).** Status fora da tabela recebem `"Unknown Error"` (D-07). Status válidos e não registrados são raros, e o `title` continua presente.
10. **`statusText` vazio.** `""` vira `undefined` em `src/error.ts:200`, então `title` usa a frase padrão. Comportamento intencional.

---

## Pendências

- **Aval de versão (bloqueante para o release, não para a implementação).** O PRD (premissa e risco de quebra) pede confirmação de quem mantém o projeto de que a mudança vai para uma versão que aceita quebra de contrato de erro. Esta especificação não decide a versão.
- **Confirmação de D-04.** A precedência do `content-type` do h3 sobre `HTTPError.headers` é a leitura literal de RF-07. Se o mantenedor preferir manter a precedência do usuário, muda uma linha em `errorResponse`, e o teste de D-04 muda junto.
- **Nota de release.** Falta redigir o texto da quebra (Content-Type, colisão de `body`, precedência de headers) para o release.
