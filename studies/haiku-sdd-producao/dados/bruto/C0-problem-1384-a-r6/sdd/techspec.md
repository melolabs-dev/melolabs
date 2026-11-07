# Techspec — Problem details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-08). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `b0153b0`).

## 1. Estado atual (resumo do código)

- Toda resposta de erro passa por `prepareResponse`, que converte o `Error` em `HTTPError` e chama `errorResponse(error, config.debug, errHeaders)` em `src/response.ts:173`. Com `onError` configurado, o hook roda antes (`src/response.ts:159-166`) e o resultado reentra em `prepareResponse` com `nested = true`; a renderização do erro padrão continua sendo o mesmo ponto (`src/response.ts:173`).
- `errorResponse` (`src/response.ts:358-380`) monta os headers a partir de `jsonHeaders` (`src/response.ts:270-272`, `content-type: application/json;charset=UTF-8`), mescla `error.headers` e `errHeaders` com `mergeHeaders` (`src/response.ts:243-252`) e serializa `{ ...error.toJSON(), stack }` com indentação 2 quando `debug`.
- `HTTPError.toJSON()` (`src/error.ts:226-236`) mascara erros `unhandled` (`message: "HTTPError"`, sem `data` nem `body`) e espalha `body` depois de `data`, de modo que chaves de `body` sobrescrevem as anteriores.
- O construtor lê campos de `details` e de `details.cause` (`src/error.ts:172-209`); `data`/`body` vêm só de `details` (`src/error.ts:208-209`). Para erros comuns, `prepareResponse` faz `new HTTPError(val)` e marca `unhandled = true` (`src/response.ts:146-155`), então o `cause` do `HTTPError` é um `Error` arbitrário do usuário/biblioteca.
- `ErrorInput` estende `Partial<ErrorBody>` (`src/error.ts:6`); `ErrorBody` está em `src/error.ts:30-69` e é implementado por `HTTPError` (`src/error.ts:74`). Ambos são exportados em `src/index.ts:72`.
- `H3Config` está em `src/types/h3.ts:28-53`; `debug` e `silent` em `:32` e `:37`. A config chega a `toResponse`/`prepareResponse` como `this.config` (`src/h3.ts:99`).
- Não existe mapa completo de frases de status: `STATUS_TEXT` em `src/utils/response.ts:347-354` cobre só 204/3xx e é privado de outro módulo (não serve para `title`).
- `HTTPError.toJSON()` também é lido como contrato de mascaramento em `src/utils/json-rpc.ts:484` (comentário); o JSON-RPC não usa `toJSON()` e está fora de escopo.

## 2. Decisões de arquitetura

### D-01 — Ponto único de alteração: `errorResponse` recebe `config`

**Contexto.** RF-02 a RF-07 exigem trocar content-type e corpo só no caminho de erro.

**Alternativas.**
1. Manter `errorResponse(error, debug, errHeaders)` e adicionar um 4º parâmetro `problemDetails`.
2. Trocar `debug` por `config: H3Config` (`errorResponse(error, config, errHeaders)`).
3. Converter para problem details em um pós-processamento da `Response` (em `toResponse`).

**Escolha: 2.** É a opção que menos cresce com novas flags e segue "lida de `app.config` como `debug` e `silent`". A 1 acumula booleanos posicionais (contra "options object" do AGENTS.md); a 3 exigiria reparsear o corpo JSON e quebraria o fluxo de `onError`/`nested`. `errorResponse` é privada (não exportada), então a mudança de assinatura não afeta a API pública. Único chamador: `src/response.ts:173`.

### D-02 — Opção `problemDetails?: boolean` em `H3Config`, sem normalização

Adicionar em `src/types/h3.ts`, após `silent` (linha 37), com TSDoc (ligar muda o `content-type` para `application/problem+json` e o formato do corpo de erro; padrão desligado). Lida como `config.problemDetails` no momento da resposta (sem cache em construtor), igual a `debug`.

**Alternativas.** (a) Enum/objeto de opções (`{ ... }`) — descartado: contrato pede booleano e proíbe novos nomes públicos. (b) Ler em `H3Core` e guardar em campo — descartado: duplica estado e não pegaria mudança em `app.config` feita depois (os testes mutam/lêem `ctx.app.config`).

`H3CoreConfig` (`src/types/h3.ts:55`) herda a opção automaticamente (só omite `plugins`).

### D-03 — `type` e `instance` em `ErrorBody` (herdados por `ErrorInput`)

Adicionar `type?: string` e `instance?: string` a `ErrorBody` (`src/error.ts:30-69`), com TSDoc (RFC 9457 §3.1.1 e §3.1.5; URI reference). `ErrorInput` os herda via `Partial<ErrorBody>`; não é preciso editar `ErrorInput` (`src/error.ts:6`). Em `HTTPError`:

- campos `readonly type: string | undefined` e `readonly instance: string | undefined` (anotação explícita por causa de `isolatedDeclarations`, como `statusText` em `src/error.ts:92`);
- atribuição no construtor depois de `this.body` (`src/error.ts:209`), lendo de `details` e depois de `details.cause`, no mesmo estilo de `unhandled` (`src/error.ts:205-206`): `details?.type ?? details?.cause?.type`. Só aceita `typeof === "string"`; qualquer outro valor vira `undefined` (um `cause` com `type` não string, como em erros de bibliotecas, não pode estourar o tipo).

**Alternativas.** Declarar só em `ErrorInput`: descartado porque `HTTPError implements ErrorBody` e o RF-04 pede os campos expostos na instância; manter ambos os tipos alinhados evita divergência. Aceitar `URL` em `type`: descartado (RF-04 diz string; validação fora de escopo).

### D-04 — `toJSON()` inclui `type`/`instance` só quando definidos e não `unhandled`

Em `src/error.ts:226-236`, inserir antes do spread de `body`:
`...(!unhandled && this.type !== undefined ? { type: this.type } : undefined)` e análogo para `instance`. Posição antes do `body` preserva a regra atual: uma chave igual em `body` continua vencendo.

**Por que omitir quando `unhandled`.** No `new HTTPError(val)` de um erro comum, o `cause` pode ter `type` (ex.: erros do `body-parser` usam `type: "entity.parse.failed"`) e vazaria no JSON padrão e quebraria o "byte a byte" do RF-01; erros `unhandled` ficam mascarados como hoje. Alternativa (não tocar `toJSON()`) descartada: RF-08 pede os campos no `toJSON()` quando definidos.

Risco residual (ver R-02): erro **não** `unhandled` com `cause` que tenha `type` string passa a mostrar `type` no JSON padrão.

### D-05 — Construção do corpo em módulo interno novo `src/utils/internal/problem.ts`

`errorResponse` já tem ~20 linhas e o mapa de frases de status é grande; ambos vão para `src/utils/internal/problem.ts` (padrão de helpers internos, ex. `src/utils/internal/cors.ts`; nenhum export público novo, `src/index.ts` não muda). Conteúdo:

```ts
export function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Montagem, nesta ordem (RF-03, RF-05, RF-06):

1. Membros padrão: `type: error.type ?? "about:blank"`, `title: error.statusText || STATUS_PHRASES[error.status]` (omitido se ambos faltarem), `status: error.status`, `detail: json.message`, `instance` só se definido.
2. Extensões, só se `!error.unhandled`: `data` (se `!== undefined`) e cada chave de `error.body`, **ignorando** as chaves reservadas `type`, `title`, `status`, `detail`, `instance`. Assim o membro padrão sempre vence (RF-05) e a ordem das chaves fica "padrão primeiro".
3. `stack` (somente `debug && error.stack`), como extensão, por último — igual ao `errorResponse` atual.

`detail` vem de `error.toJSON().message`, reaproveitando o mascaramento existente (`"HTTPError"` quando `unhandled`), que é o único ponto que decide o que é segredo. Para `unhandled`, `type`/`instance` também são ignorados (usa `about:blank`), pelo motivo de D-04.

Chaves herdadas do JSON padrão que **não** são emitidas no modo novo: `statusText` (vira `title`), `message` (vira `detail`) e `unhandled`. Ver R-03.

**Alternativas.** (a) Transformar o resultado de `toJSON()` renomeando chaves — descartado: precisaria de deletes e deixaria vazar `unhandled`/`statusText`; (b) manter tudo inline em `src/response.ts` — descartado pelo limite de ~200 linhas por arquivo do AGENTS.md e porque o mapa de frases é ~60 linhas.

### D-06 — Mapa de frases de status interno e completo (RFC 9110)

`STATUS_PHRASES: Record<number, string>` privado em `problem.ts`, com as frases padrão IANA para 1xx–5xx usuais (400–418, 421–426, 428–429, 431, 451, 500–508, 510–511 etc.). Não reutilizar o mapa de `src/utils/response.ts:347` (cobre só 6 códigos, comentário diz explicitamente que outros códigos não devem ganhar frase) e não usar `http.STATUS_CODES` do Node (viola "web standards first"/multi-runtime). Status sem frase conhecida: `title` cai em `statusText` ou é omitido (premissa do PRD).

Precedência de `title`: `statusText` do erro primeiro (RF-03: "`statusText` do erro, ou a frase padrão quando ausente").

### D-07 — Content-Type via novo `problemHeaders` congelado

Em `src/response.ts`, ao lado de `jsonHeaders` (`:270-272`), criar `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` com `/* @__PURE__ */`. `errorResponse` escolhe `config.problemDetails ? problemHeaders : jsonHeaders` como base de `mergeHeaders`/`new Headers`, mantendo a mesma lógica de mesclagem de `error.headers` e `errHeaders` (RF-07: headers do erro e de `event.res` seguem mesclados, e um `content-type` explícito do usuário continua prevalecendo como hoje).

**Alternativa.** Setar o content-type depois de mesclar: descartado, pois removeria a capacidade atual de o erro sobrescrever `content-type`.

### D-08 — `debug`, `onError`, status e `statusText` HTTP

- `debug`: `stack` continua emitido (D-05 passo 3) e a indentação 2 permanece (`src/response.ts:372`).
- `onError`: sem alteração; a decisão de renderizar continua em `src/response.ts:159-173`. Se o hook devolver outra resposta, ela substitui o problem details como hoje.
- Status/`statusText` da `Response` seguem `error.status`/`error.statusText` (`src/response.ts:375-376`); só o corpo/`content-type` mudam.
- `kNotFound` (rota inexistente) vira `HTTPError` 404 em `src/response.ts:139-144` e entra no mesmo caminho, então também sai como problem details (RF-02), com `detail: "Cannot find any route matching [GET] ..."`.

### D-09 — Não alterar WebSocket, JSON-RPC, SSE nem `h3/rules`

Conforme "Fora de escopo" do PRD; nenhum arquivo em `src/utils/json-rpc.ts`, `src/utils/ws.ts`, `src/utils/event-stream.ts` ou `src/rules/**` muda.

## 3. Arquivos a alterar

| Arquivo | Linha(s) | Alteração |
| --- | --- | --- |
| `src/types/h3.ts` | `:28-37` (inserir após `:37`) | Opção `problemDetails?: boolean` com TSDoc (D-02). |
| `src/error.ts` | `:30-69` | `type?` e `instance?` em `ErrorBody` (D-03). |
| `src/error.ts` | `:99-119` (campos), `:202-209` (construtor) | Campos `type`/`instance` e leitura de `details`/`cause` (D-03). |
| `src/error.ts` | `:226-236` | `toJSON()` com `type`/`instance` quando definidos e não `unhandled` (D-04). |
| `src/response.ts` | `:173` | Chamar `errorResponse(error, config, errHeaders)` (D-01). |
| `src/response.ts` | `:270-272` | Novo `problemHeaders` (D-07). |
| `src/response.ts` | `:358-380` | `errorResponse` escolhe headers e corpo conforme `config.problemDetails` (D-01, D-05, D-07). |
| `src/response.ts` | `:1-8` | Import de `problemBody` de `./utils/internal/problem.ts`. |
| `src/utils/internal/problem.ts` | novo | `problemBody` e `STATUS_PHRASES` (D-05, D-06). |
| `test/problem-details.test.ts` | novo | Testes RF-01 a RF-07 (seção 5). |

Não alteram: `src/index.ts:72` (os tipos já são exportados; nenhum nome novo), `package.json` (sem export novo), `src/_entries/*`.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts
export interface H3Config {
  /**
   * When enabled, error responses use RFC 9457 problem details
   * (`application/problem+json` with `type`, `title`, `status`, `detail`, `instance`).
   * Defaults to `false`.
   */
  problemDetails?: boolean;
  // ...demais opções inalteradas
}

// src/error.ts
export interface ErrorBody<DataT = unknown> {
  type?: string;      // RFC 9457 "type" (URI reference)
  instance?: string;  // RFC 9457 "instance" (URI reference)
  // ...membros atuais
}
export class HTTPError<DataT = unknown> /* ... */ {
  readonly type: string | undefined;
  readonly instance: string | undefined;
}

// src/utils/internal/problem.ts (interno, não exportado em src/index.ts)
export function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;

// src/response.ts (privado)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
```

Corpo de saída (exemplos):

```jsonc
// new HTTPError("Sem saldo", { status: 403 })
{ "type": "about:blank", "title": "Forbidden", "status": 403, "detail": "Sem saldo" }

// new HTTPError({ status: 422, body: { errors: ["x"] }, data: { campo: "a" } })
{ "type": "about:blank", "title": "Unprocessable Content", "status": 422,
  "detail": "HTTPError 422", "data": { "campo": "a" }, "errors": ["x"] }

// throw new Error("segredo interno") com silent
{ "type": "about:blank", "title": "Internal Server Error", "status": 500, "detail": "HTTPError" }
```

(A frase de 422 segue o registro IANA atual, "Unprocessable Content".)

## 5. Estratégia de testes

Convenções do projeto: `describeMatrix` (web e node), `t.app` novo por teste, `t.fetch`. O app de teste já nasce com `debug: true` e `onError` espiando erros (`test/_setup.ts:135-141`); o `afterEach` exige `t.errors` vazio, então testes com erros `unhandled` devem limpar `t.errors = []` (padrão em `test/errors.test.ts:259-261`). Para ligar a opção, cada teste faz `t.app.config.problemDetails = true` (o objeto `config` é o mesmo lido em `src/h3.ts:99`); para `silent`/`debug: false`, também por `t.app.config`.

**Novo arquivo `test/problem-details.test.ts`** (um `it` por critério):

- RF-01: sem a opção, `HTTPError.status(404)` → `content-type` `application/json;charset=UTF-8` e corpo com `status`, `statusText`, `message` (e variante com `problemDetails: false`).
- RF-02: com a opção, `HTTPError`, `Error` comum e rota inexistente → `content-type` começa com `application/problem+json` e `JSON.parse` do corpo funciona.
- RF-03: `new HTTPError("Sem saldo", { status: 403 })` com `debug = false` → `toEqual({ type: "about:blank", title: "Forbidden", status: 403, detail: "Sem saldo" })` (sem `instance`); `statusText` explícito vira `title`; status sem frase conhecida (ex.: 599) → `title` omitido.
- RF-04: unitário `new HTTPError({ status: 400, type, instance })` expõe `error.type`/`error.instance`, `undefined` quando ausentes, leitura via `cause`, valor não string ignorado; resposta HTTP traz os mesmos valores; `toJSON()` só contém as chaves quando definidas (`Object.keys` sem `type`/`instance` por padrão).
- RF-05: `body`/`data` emitidos como extensões; `body: { status: 1, title: "x", errors: [...] }` não sobrescreve membros padrão.
- RF-06: `throw new Error("segredo interno")` com `silent: true` → 500, `application/problem+json`, `text` sem "segredo interno"; variante com `cause` carregando `type`/`data`/`body` e variante `throw { ... }` não objeto Error.
- RF-07: `debug: true` + `HTTPError({ status: 401, headers: { "www-authenticate": "Bearer" } })` → 401, header, content-type e `stack` array no corpo; `event.res.headers` mesclados (incluindo `set-cookie` não duplicado com `onError` configurado, como em `test/errors.test.ts:48`); `onError` que devolve `Response` própria substitui o problem details; `statusText` HTTP da resposta preservado.
- Invariante default: sem a opção, uma `HTTPError` com `type`/`instance` de `cause` em erro `unhandled` não os mostra (D-04).

**Testes existentes.** Nenhum deve precisar de ajuste, porque o padrão é desligado e `toJSON()` só muda quando `type`/`instance` estão definidos. `test/errors.test.ts:44` e `:257` (e demais `toMatchObject`) continuam válidos. Verificar na execução; se algum teste comparar `Object.keys`/`toEqual` exato do `HTTPError`, ajustar sem perder a asserção.

**Execução final** (RF-08): `pnpm vitest run test/problem-details.test.ts`, depois `pnpm vitest run`, `pnpm lint` (oxlint + oxfmt, inclui formatar o novo arquivo) e `pnpm typecheck` (`tsc --noEmit`, `package.json:54`). Seguir o fluxo de bugfix do AGENTS.md: escrever os testes antes e vê-los falhar.

## 6. Riscos

- **R-01 — Vazamento em `unhandled`.** Mitigado por D-05: `detail` vem do `toJSON()` mascarado, extensões e `type`/`instance` ignorados; coberto pelos testes de RF-06 com `cause` malicioso. `title` ainda usa `statusText` do erro (como o JSON atual expõe `statusText`); aceitável, mas se o `cause` tiver `statusText` livre ele aparecerá em `title` (já ocorre hoje em `statusText`).
- **R-02 — "Byte a byte" no modo padrão.** `type`/`instance` lidos de `cause` em erro não `unhandled` aparecem em `toJSON()`. É consequência direta de RF-04/RF-08; o risco é baixo (exige `cause` com `type` string num `HTTPError` explícito). Se quiser garantia total, a alternativa é só emitir nos problem details e não em `toJSON()` — exige alinhar com o PRD.
- **R-03 — Perda de chaves no modo novo.** `unhandled`, `statusText` e `message` não aparecem; clientes/testes que checam `unhandled: true` no corpo (como `test/errors.test.ts:257`) não valem com a opção ligada. Decisão consciente: a RFC define `title`/`detail`, e `status` HTTP/`statusText` da resposta continuam disponíveis.
- **R-04 — Colisão de nomes em `body`/`data`.** Chaves `type`, `title`, `status`, `detail`, `instance` de `body` são descartadas silenciosamente (RF-05). Um `data` de topo (`data`) não é reservado, mas `body.data` ainda sobrescreve `data` como hoje.
- **R-05 — Tipos.** `isolatedDeclarations` exige anotação explícita nos novos campos e no retorno de `problemBody`; `ErrorBody` ganhar propriedades opcionais não quebra consumidores que implementam a interface.
- **R-06 — Clientes que só entendem `application/json`.** Mitigado pelo opt-in (padrão desligado).
- **R-07 — Frases de status.** O mapa precisa ser conferido contra o registro IANA (ex.: 422 "Unprocessable Content", 413 "Content Too Large"); um erro de digitação só afeta `title`.
- **R-08 — Mudança de assinatura de `errorResponse`.** Função privada com um único chamador (`src/response.ts:173`); o risco é só de esquecer de atualizar essa chamada, o que `pnpm typecheck` detecta.
- **R-09 — Documentação.** Não verifiquei se existe documentação em `docs/` sobre erros/config que deva citar `problemDetails`; checar na implementação (fora do escopo desta techspec).
