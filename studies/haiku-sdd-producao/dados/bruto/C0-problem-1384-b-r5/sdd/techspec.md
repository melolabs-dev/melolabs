# Techspec — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-09). Esta especificação não altera código; descreve a implementação a ser feita.

## 1. Visão geral

Todo erro do h3 é renderizado em um único ponto: `errorResponse` (`src/response.ts:358`), chamado por `prepareResponse` (`src/response.ts:173`). O corpo vem de `HTTPError.toJSON()` (`src/error.ts:226`) e o `Content-Type` vem de `jsonHeaders` (`src/response.ts:270`). Mudar esses dois pontos cobre handler, middleware, hook `onError` (que cai no mesmo `prepareResponse`, linhas 161–165), 404 (`kNotFound`, linha 139) e erros não tratados (linha 148–155). Não é preciso tocar em adaptadores nem em `src/_entries/*`.

Fora do caminho da mudança, de propósito: `src/utils/json-rpc.ts:476-498` (o erro JSON-RPC é um envelope próprio, não uma resposta de erro HTTP do h3) e respostas `Response` devolvidas manualmente (PRD §3).

## 2. Decisões de arquitetura

### D-01 — Onde montar o corpo: dentro de `HTTPError.toJSON()`

- **Alternativas:** (a) montar os membros da RFC em `errorResponse`, deixando `toJSON()` intacto; (b) estender `toJSON()`.
- **Escolha: (b).** RF-06 exige que `toJSON()` "continue retornando esses membros (acrescidos dos novos)". Em (a) `toJSON()` e a resposta divergiriam, e `JSON.stringify(error)` feito por usuários não teria os membros novos. A regra de máscara de erros `unhandled` já mora em `toJSON()` (`src/error.ts:227-234`); manter a regra de RF-07 no mesmo lugar evita duas implementações do mesmo filtro de segurança.

### D-02 — Precedência entre `body` e membros da RFC

Hoje `...this.body` é espalhado por último (`src/error.ts:234`), então `body.status` pode sobrescrever `status` no JSON, divergindo do status line. RF-06 proíbe isso.

- **Alternativas:** (a) apenas mover `...this.body` para o início do literal; (b) montar o objeto legado como hoje e sobrepor os membros da RFC por cima; (c) filtrar as chaves reservadas de `body`.
- **Escolha: (b).** (a) mudaria a precedência de `body` sobre `message`, `data` e `statusText`, que são membros legados e devem seguir "as mesmas regras de hoje" (RF-06). (c) é mais código e mais ramos. Em (b) o legado fica byte a byte como antes, e só `type`, `title`, `status`, `detail`, `instance` são reafirmados depois do spread. Efeito colateral intencional: `body.status` deixa de alterar o JSON. Isso é uma correção exigida por RF-06, não um efeito colateral acidental.

Forma resultante (pseudo-código, ordem de chaves: RFC primeiro por legibilidade, mas a sobreposição é o que importa):

```ts
const legacy = {
  status, statusText, unhandled, message: unhandled ? "HTTPError" : this.message,
  data: unhandled ? undefined : this.data,
  ...(unhandled ? undefined : this.body),
};
return {
  ...legacy,
  type: unhandled ? "about:blank" : (this.type ?? "about:blank"),
  title: unhandled ? defaultTitle : (this.statusText ?? defaultTitle),
  status: this.status,
  detail: unhandled ? undefined : this.message,
  instance: unhandled ? undefined : this.instance,
};
```

### D-03 — Erros `unhandled`: o que sai

RF-07: `type`, `title`, `status` permanecem; `detail`, `data`, `body`, `instance` e o `type` fornecido pela aplicação não saem.

- **Alternativas:** (a) `detail: "HTTPError"` espelhando o `message` mascarado; (b) omitir `detail`.
- **Escolha: (b).** `detail` é opcional na RFC e RF-07 diz que não é exposto. `message` continua `"HTTPError"` como hoje (compatibilidade, RF-06). `type` fixo em `"about:blank"` e `title` sempre a frase padrão do status, nunca `statusText`, porque o `statusText` de um erro `unhandled` pode ter vindo de `cause` arbitrária. O campo legado `statusText` continua saindo como hoje; essa exposição já existe e está fora do escopo.
- **Observação:** o teste `test/errors.test.ts:166-183` cria um erro `unhandled` com status 400 herdado da `cause`; `title` será "Bad Request" e `status` 400, coerente.

### D-04 — Origem de `title`: tabela interna completa de frases de status

RF-02 exige a frase padrão quando não há `statusText`. A tabela existente `STATUS_TEXT` (`src/utils/response.ts:347-354`) tem só 6 códigos e um propósito oposto, documentado no comentário da linha 345: "Any other status gets no phrase rather than one that belongs to a different code".

- **Alternativas:** (a) ampliar `STATUS_TEXT` e reutilizá-la; (b) nova tabela interna em `src/utils/internal/status-text.ts`; (c) usar `new Response(null, {status}).statusText` do runtime (vazio na maioria dos runtimes, não portável).
- **Escolha: (b).** (a) mudaria o comportamento de `noContent`/`redirect` (`src/utils/response.ts:44`, `:79`), que hoje deliberadamente não preenchem frase para outros códigos. (c) não é portável. A nova tabela é um `Record<number, string>` não exportado pelo índice público (`src/index.ts` não a reexporta), com os códigos 4xx e 5xx da RFC 9110 mais os usuais de 1xx a 3xx, sem dependências. Função interna `statusTitle(status: number): string | undefined` no mesmo arquivo.
- **Status sem frase conhecida** (por exemplo 599 ou 499): `title` fica `undefined` e some do JSON, em vez de inventar uma frase que contradiga o status. `title` é opcional na RFC. Isso é uma exceção à métrica "100% têm `title`"; registrada em R-04.
- **`title` com `statusText` do erro:** `statusText` do erro prevalece (RF-02, RF-08). O valor já é sanitizado no construtor (`src/error.ts:180`).

### D-05 — `type` e `instance` em `ErrorBody` (não só em `ErrorInput`)

- **Alternativas:** (a) declarar só em `ErrorInput` (`src/error.ts:6`); (b) declarar em `ErrorBody` (`src/error.ts:30`), que `ErrorInput` herda via `Partial<ErrorBody>` (linha 6) e que `HTTPError` implementa (linha 74).
- **Escolha: (b).** Um único lugar, e `toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"]` (linha 226) já passa a tipar os campos. Sem nomes públicos novos: são membros de tipos existentes. `HTTPError.status(...)` (`src/error.ts:144-150`) e `new HTTPError(message, details)` (linha 160) repassam sem mudança, pois espalham/leem `details`.

### D-06 — Leitura de `type`/`instance` no construtor: só de `details`, sem herdar de `cause`

O construtor herda `status`, `statusText`, `headers`, `unhandled` de `details.cause` (`src/error.ts:172-206`).

- **Alternativas:** (a) herdar também de `cause`; (b) ler só de `details` e exigir `typeof === "string"`.
- **Escolha: (b).** Erros de bibliotecas costumam ter `type` próprio e sem relação com a RFC (por exemplo erros de body parsers). Herdá-los publicaria um `type` arbitrário em erros "tratados" criados com `new HTTPError(libError)`. Com (b), só o que o código da aplicação passou explicitamente chega à resposta. Valores não string viram `undefined`. Sem validação de URI (PRD §3).

### D-07 — Content-Type: nova constante congelada ao lado de `jsonHeaders`

- **Alternativas:** (a) reutilizar `jsonHeaders` e sobrescrever `content-type` dentro de `errorResponse`; (b) nova `FrozenHeaders` `problemHeaders` com `application/problem+json;charset=UTF-8`.
- **Escolha: (b).** Segue o padrão do arquivo (`jsonHeaders`, `emptyHeaders`, linhas 266-272), evita um `set` por requisição e mantém `jsonHeaders` imutável para o caminho JSON normal. O `charset=UTF-8` replica o formato atual (RF-01). `errorResponse` troca `jsonHeaders` por `problemHeaders` nas duas ramificações (`src/response.ts:359-361`).
- **Headers do erro:** `mergeHeaders(problemHeaders, error.headers)` e depois `errHeaders` continuam sobrescrevendo (`set`), como hoje. Logo, um `content-type` explícito em `HTTPError.headers` ou em `event.res.errHeaders` ainda vence. RF-08 diz que o problem details "prevalece sobre o JSON padrão", o que é verdade para o default; a precedência de headers explícitos é mantida "como hoje". Ver R-03.

### D-08 — Sem negociação, sem flag

RF-05. `errorResponse` não lê `Accept` nem `H3Config` (`src/types/h3.ts`). Nada a adicionar em `H3Config`. Alternativa de manter o JSON antigo como opção está fora de escopo (PRD §3).

### D-09 — Documentação do repositório

`docs/1.guide/1.basics/6.error.md` (linhas 37-60 e 90) descreve o JSON de erro e os campos de `HTTPError`. O PRD exclui "documentação externa", e esse arquivo está no repositório. **Escolha:** atualizar só essa página (exemplo de resposta, `Content-Type`, `type`/`instance`, e a nota de erros não tratados); não tocar em outras. Se a equipe preferir manter o escopo mínimo, este item pode ser cortado sem afetar o resto.

## 3. Arquivos a alterar

Linhas conferidas no código atual.

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/error.ts` | 30-69 (`ErrorBody`) | acrescentar `type?: string` e `instance?: string`, com JSDoc |
| `src/error.ts` | 74-119 (campos de `HTTPError`) | acrescentar `readonly type: string \| undefined` e `readonly instance: string \| undefined` |
| `src/error.ts` | 205-209 (fim do construtor) | atribuir `type`/`instance` a partir de `details` (D-06) |
| `src/error.ts` | 226-236 (`toJSON`) | montar corpo conforme D-02/D-03 |
| `src/error.ts` | 1 (imports) | importar `statusTitle` de `./utils/internal/status-text.ts` |
| `src/utils/internal/status-text.ts` | novo | tabela e `statusTitle` (D-04); fica ao lado de `internal/*` conforme AGENTS.md |
| `src/response.ts` | 270-272 | acrescentar `problemHeaders` |
| `src/response.ts` | 358-380 (`errorResponse`) | usar `problemHeaders` (linhas 359-361); o resto igual |
| `test/errors.test.ts` | 44, 140 | ajustar a asserção de `content-type` (ver §5) |
| `test/errors.test.ts` | fim do arquivo | testes novos |
| `docs/1.guide/1.basics/6.error.md` | 37-60, 90 | D-09 |

Conferidos e **sem alteração**: `src/index.ts:72` (já exporta `ErrorBody`, `ErrorInput`, `HTTPError`; sem nome novo), `src/response.ts:139-174` (fluxo de erro já converge em `errorResponse`), `src/utils/json-rpc.ts:476-498`, `src/utils/internal/validate.ts` e `src/utils/body.ts` (só constroem `HTTPError`).

`pnpm build` usa `isolatedDeclarations`: as novas propriedades e `statusTitle` precisam de anotação de tipo explícita.

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorBody<DataT = unknown> {
  // ...membros atuais...
  /** RFC 9457 `type`: URI que identifica o tipo do problema. Padrão na resposta: "about:blank". */
  type?: string;
  /** RFC 9457 `instance`: URI-reference da ocorrência. Só aparece na resposta se informado. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"]; // assinatura inalterada
}

// src/utils/internal/status-text.ts (interno, não reexportado)
export function statusTitle(status: number): string | undefined;
```

Corpo da resposta (`application/problem+json;charset=UTF-8`):

| Membro | Erro tratado | Erro `unhandled` |
| --- | --- | --- |
| `type` | `error.type ?? "about:blank"` | `"about:blank"` |
| `title` | `statusText ?? statusTitle(status)` | `statusTitle(status)` |
| `status` | `error.status` | `error.status` |
| `detail` | `error.message` | ausente |
| `instance` | `error.instance` (ausente se não informado) | ausente |
| legados | `statusText`, `unhandled`, `message`, `data`, chaves de `body` (como hoje) | `statusText`, `unhandled`, `message: "HTTPError"` |
| `stack` | só com `config.debug` (inalterado, `src/response.ts:369`) | idem |

Chaves `undefined` somem na serialização (`JSON.stringify`), o que garante a ausência de `instance`.

## 5. Estratégia de testes

Todos com `describeMatrix` (web e node), em `test/errors.test.ts`, seguindo o estilo de `t.app` / `t.fetch` do arquivo.

**Regressão primeiro** (fluxo de bug fix do AGENTS.md): escrever os testes novos e confirmar que falham antes da implementação (`pnpm vitest run test/errors.test.ts`), depois implementar e ver passar.

Testes novos, um por requisito:

- RF-01: erro 400 → `content-type` começa com `application/problem+json`; também 404 de rota inexistente, erro de middleware e `throw 404`.
- RF-02: 404 com `message` → `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail`. Com `statusText` customizado → `title` igual a ele.
- RF-03: unitário (`test/unit/h3.test.ts` ou o próprio `errors.test.ts`) de `error.type`/`error.instance` com `new HTTPError({...})`, `HTTPError.status(403, undefined, { type, instance })`, `new HTTPError("m", { type, instance })`; ambos `undefined` quando omitidos; valor não string vira `undefined`; `type` em `cause` não é herdado.
- RF-04: `type` e `instance` na resposta; `instance` ausente (`not.toHaveProperty`) quando não informado.
- RF-05: sem `Accept` e com `Accept: text/html`, mesmo formato; app sem configuração.
- RF-06: o exemplo do PRD (422, `data`, `body.codigo`) mantém `message`, `data`, `codigo` e traz `detail`, `status`, `title`. Colisão: `body: { status: 200, title: "x", detail: "x" }` não altera `status`, `title`, `detail`. `body.message` continua sobrescrevendo `message` como hoje.
- RF-07: `throw new Error("segredo do banco")` → 500, `problem+json`, `title: "Internal Server Error"`, corpo sem a string, sem `stack`, sem `detail`/`instance`; com `debug: true`, `stack` presente. Variante: `HTTPError` com `unhandled: true`, `type` e `instance` informados → ambos não vazam.
- RF-08: o exemplo 401 do PRD (`statusText`, `www-authenticate`, `title`). Manter também o caso de `errHeaders` e `set-cookie` já coberto em `errors.test.ts:31-61`.
- Status sem frase conhecida (ex.: 599): `title` ausente, sem exceção.
- `onError` configurado que relança/devolve erro: continua `problem+json`.

**Testes existentes a ajustar (apenas o necessário):**

- `test/errors.test.ts:44`: `toBe("application/json;charset=UTF-8")` passa a `toBe("application/problem+json;charset=UTF-8")`. As demais asserções do teste (headers `x-error`, `set-cookie`, corpo `toMatchObject`) ficam.
- `test/errors.test.ts:140`: `toMatch("application/json")` não casaria `application/problem+json` (a string é um substring literal); passa a `toMatch("application/problem+json")`.
- Não precisam de mudança: `test/security.test.ts:556` e `test/proxy.test.ts:1531` (respostas de sucesso/proxy, não de erro); os `toEqual` de `test/validate.test.ts` (corpos de sucesso); os `toMatchObject({ status, unhandled, message })` de `test/errors.test.ts:257,309,350,384,420,442` (continuam válidos porque os legados são preservados).
- Se a suíte completa revelar outro teste dependente do `Content-Type` de erro, ajustar só a asserção.

**Verificação final:** `pnpm vitest run test/errors.test.ts`, `pnpm vitest run` completo, `pnpm lint`, `pnpm typecheck`. `pnpm build` para validar `isolatedDeclarations`. Conferir que os testes novos falham ao reverter `src/error.ts` e `src/response.ts` (RF-09).

## 6. Riscos

- **R-01 — Consumidores com checagem estrita de MIME.** Quem exige `application/json` em erros quebra. Mitigação: corpo continua JSON válido com todos os campos antigos; mudança documentada (D-09). A mudança é intencional e pedida pelo contrato.
- **R-02 — Contradição do contrato** ("substitui o formato atual" vs. "não quebrar"). Resolvida como no PRD §4: Content-Type e membros novos mudam, legados ficam. Se a intenção for remover legados, é decisão a confirmar antes de implementar; o ponto de mudança seria só o literal `legacy` de D-02.
- **R-03 — `content-type` explícito em `HTTPError.headers`/`errHeaders` ainda vence** o `problem+json` (D-07). Um erro com `Content-Type` próprio deixa de ser problem details. Tratado como comportamento existente de headers explícitos; alterar exigiria decisão do solicitante.
- **R-04 — `title` ausente em status sem frase conhecida** (ex.: 599). Foge da métrica "100% com `title`", mas evita contradizer o status. Os status usuais ficam cobertos pela tabela.
- **R-05 — Vazamento em erros `unhandled`.** Mitigado por D-03 e teste obrigatório de RF-07, incluindo `HTTPError` com `unhandled: true` e `type`/`instance` informados.
- **R-06 — `body.status` deixa de sobrescrever o status do JSON** (D-02). É exigência de RF-06; quem dependia disso para divergir do status line verá mudança. Coberto por teste.
- **R-07 — Tamanho do bundle.** Tabela de ~60 entradas. Mantida mínima, sem dependências; verificar a diferença de tamanho no `pnpm build` (o core deve continuar enxuto).
- **R-08 — Nitro e adaptadores** que leem o formato de erro não foram verificados neste repositório (PRD §4); validar em integração futura.
- **R-09 — Erros entregues por `onError` como `Response` própria** ficam como o usuário montou (fora de escopo, PRD §3).
