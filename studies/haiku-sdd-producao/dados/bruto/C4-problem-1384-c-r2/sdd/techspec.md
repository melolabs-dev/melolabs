# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

Base: `sdd/pedido.md` (contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-08).

Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `d462000`).

## 1. Visão geral

Um novo utilitário `problem(input)` cria um `HTTPError` marcado internamente. Quando esse erro é renderizado (`prepareResponse` → `errorResponse`), o corpo segue a RFC 9457 e o `Content-Type` passa a ser `application/problem+json`. Erros criados de outra forma seguem exatamente o caminho atual.

Fluxo:

```
problem({ status, message, type, instance, ... })
  └─ new HTTPError(input)                       // mesmos campos e sanitização de hoje
  └─ marca interna (símbolo kProblem) com { type, instance, detail }

handler lança/retorna o erro
  └─ prepareResponse (src/response.ts:146)
       └─ errorResponse (src/response.ts:358)
            ├─ sem marca  → headers jsonHeaders + error.toJSON()          (inalterado)
            └─ com marca  → headers problemHeaders + toProblemJSON(error)  (novo)
```

## 2. Decisões de arquitetura

### D-01 — Marca interna por símbolo na instância de `HTTPError`

**Escolha:** `problem()` grava os campos extras em uma propriedade com o símbolo `kProblem = Symbol.for("h3.problem")` na instância. O símbolo não é exportado.

**Por que:** o PRD exige que o sinal de origem fique interno (`sdd/prd.md:127`). O projeto já usa esse padrão para marcas internas: `kHTTPResponse` usa `Symbol.for` por causa de duplicação de módulos (`src/response.ts:94`), e `kEventRes`/`kEventResErrHeaders` fazem o mesmo para o evento (`src/event.ts:16-19`). Um símbolo não aparece em `JSON.stringify`, então não há como uma marca vir do corpo de uma requisição.

**Alternativas consideradas:**
- *Subclasse `ProblemError extends HTTPError`:* daria `instanceof` limpo, mas cria um nome de classe. `HTTPError.isError` checa `name` e `status` (`src/error.ts:129`), então funcionaria, porém a classe precisaria ser exportada ou ficaria órfã entre cópias do pacote. Rejeitada.
- *`WeakSet` de erros:* sem propriedade extra, mas o estado fica fora do objeto e não sobrevive a múltiplas cópias de `h3`. Rejeitada.
- *Campo público ou `~problem` enumerável:* aparece no objeto e pode ser serializado ou documentado sem querer. O `~` do `AGENTS.md` marca propriedades privadas não enumeráveis, mas o símbolo é mais simples e mantém o formato do `HTTPError` intacto. Rejeitada.

### D-02 — Código novo em `src/problem.ts`, não em `src/error.ts`

**Escolha:** criar `src/problem.ts` com `problem`, `ProblemInput`, `kProblem`, `ProblemFields`, `toProblemJSON` e `getProblemFields`. `src/error.ts` não muda.

**Por que:** `src/error.ts` já tem 237 linhas (`src/error.ts:237`), acima da meta de menos de 200 linhas por arquivo (`AGENTS.md`, seção Style). Um arquivo separado também evita que `src/response.ts` dependa de mais código de `error.ts`. Não há ciclo: `problem.ts` importa `error.ts`, e `response.ts` importa `problem.ts`.

**Alternativa:** colocar tudo em `src/error.ts`. Rejeitada pelo tamanho do arquivo.

### D-03 — Renderização: ramificação em `errorResponse`, não override de `toJSON`

**Escolha:** `errorResponse` (`src/response.ts:358`) escolhe headers e corpo conforme a presença da marca. `HTTPError.toJSON` (`src/error.ts:226`) não muda.

**Por que:** o `Content-Type` é definido em `errorResponse`, não no `toJSON`. Mexer no `toJSON` deixaria o cabeçalho de fora. Além disso, `toJSON` é público e sua forma já é conhecida pelos usuários.

**Alternativa:** pôr `application/problem+json` em `error.headers` dentro de `problem()`. Rejeitada porque `error.headers` é campo público e o cabeçalho apareceria como se fosse uma escolha do usuário.

### D-04 — `Content-Type` exato `application/problem+json`, sem `charset`

**Escolha:** `problemHeaders = { "content-type": "application/problem+json" }`.

**Por que:** RF-03 (`sdd/prd.md:49`) pede o valor exato. O media type da RFC 9457 não define parâmetro `charset`, e JSON é UTF-8 por definição (RFC 8259). Os erros comuns usam `application/json;charset=UTF-8` (`src/response.ts:271`), mas esse caso precisa do valor sem parâmetro.

**Alternativa:** `application/problem+json;charset=UTF-8`, por consistência com `jsonHeaders`. Rejeitada porque contraria o critério de aceite literal.

### D-05 — Mapeamento e precedência dos campos

**Escolha:**
- `status` ← `error.status` (já sanitizado por `HTTPError`).
- `title` ← `error.statusText`. Ausente vira campo omitido.
- `detail` ← `input.message`, guardado na marca. **Não** usa `error.message`: o construtor preenche `message` automaticamente com `"HTTPError 404 Not Found"` quando nada foi passado (`src/error.ts:187-193`), então `error.message` nunca fica vazio. Se `input.message` estiver vazio, `detail` é omitido.
- `type` ← `input.type ?? "about:blank"`.
- `instance` ← `input.instance`. Ausente vira campo omitido.
- `data` ← `error.data`, como membro de extensão.
- Campos de `error.body` são espalhados antes dos membros RFC, então `type`, `title`, `status`, `detail`, `instance` e `data` sempre vencem em colisão.

**Por que:** a regra "omitir se vazio" do PRD (`sdd/prd.md:125`) só funciona se o valor vier da entrada, não do `message` gerado. Guardar `input.message` na marca torna isso explícito. Ordem de precedência resolve o risco de colisão de chaves (`sdd/prd.md:132`).

**Alternativa:** `detail ← error.message` sempre. Rejeitada porque sempre exibiria o texto gerado automaticamente.

**Ponto a confirmar:** o PRD diz "omitido se vazio", e esta escolha segue isso. Se o time preferir `detail` sempre presente, muda só `ProblemFields.detail`.

### D-06 — Erros `unhandled` em `problem()`

**Escolha:** `unhandled: true` é respeitado (já é tratado por `HTTPError`, `src/error.ts:205`). Nesse caso o corpo omite `detail`, `data` e o `body` extra, mantém `status`, `title`, `type` e `instance`, e não inclui `unhandled` no corpo.

**Por que:** RF-06 (`sdd/prd.md:82`) pede que detalhes não apareçam. `type`, `title` e `instance` são valores escritos pelo próprio app, então não são detalhes sensíveis. Isso segue a mesma linha de `HTTPError.toJSON`, que também oculta `message`, `data` e `body` em erros `unhandled` (`src/error.ts:231-234`).

**Ressalva herdada:** em modo `debug`, `errorResponse` já inclui `stack` (`src/response.ts:369`), inclusive em erros `unhandled`. O comportamento de `problem()` é o mesmo, e não é alterado aqui.

### D-07 — `problem()` não propaga a marca por `cause`

**Escolha:** se um erro de `problem()` for embrulhado em outro `HTTPError` (`new HTTPError({ cause: err })`), a marca não passa para o externo. O externo é renderizado no formato atual.

**Por que:** o construtor copia `status` e `statusText` do `cause` (`src/error.ts:172-185`), mas não copia outros campos. Propagar a marca exigiria lógica nova no construtor, que é o núcleo do projeto. O caso é raro, e o resultado (formato padrão do h3) é seguro.

### D-08 — Tipo público `ProblemInput`

**Escolha:** `export interface ProblemInput extends ErrorInput { type?: string; instance?: string }`, em `src/problem.ts`.

**Por que:** `ErrorInput` já tem todos os campos de entrada de `HTTPError` (`src/error.ts:6`). Estender evita repetir a lista. Os campos deprecados `statusCode` e `statusMessage` continuam aceitos, como em `HTTPError`.

**Nome:** `ProblemInput` é o nome sugerido em `sdd/prd.md:126`, marcado como "a confirmar". Esta especificação usa esse nome.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/problem.ts` | **Novo.** `problem`, `ProblemInput`, `kProblem`, `ProblemFields`, `toProblemJSON`, `getProblemFields`. |
| `src/response.ts` | Importar `getProblemFields`, `toProblemJSON` de `./problem.ts` (após `src/response.ts:4`). Novo `problemHeaders` ao lado de `jsonHeaders` (`src/response.ts:270-272`). `errorResponse` ramificado (`src/response.ts:358-380`). |
| `src/index.ts` | Exportar `problem` e `type ProblemInput` ao lado da exportação de erros (`src/index.ts:70-72`). |
| `test/unit/package.test.ts` | Incluir `"problem"` no snapshot de exportações, entre `"parseCookies"` (linha 104) e `"proxy"` (linha 105). Essa é a única mudança em teste existente. |
| `test/problem.test.ts` | **Novo.** Testes de comportamento com `describeMatrix` (seção 5). |
| `test/unit/types.test-d.ts` | Opcional: `expectTypeOf` para `ProblemInput` (aceita `type`/`instance`, rejeita chave desconhecida). |
| `test/dist.test.ts` | Opcional mas recomendado: um caso no bloco `describe` (linha 19) que confere o corpo e o `Content-Type` no build. |
| `docs/1.guide/1.basics/6.error.md` | Nova seção "Problem Details (RFC 9457)" antes de `## Unhandled Errors` (linha 78). |
| `AGENTS.md` | Acrescentar `problem.ts` na árvore de `src/` (perto de `src/error.ts`, linha 63), conforme a nota do próprio arquivo. |

Arquivos que **não** mudam: `src/error.ts`, `src/utils/middleware.ts`, `src/adapters.ts`, `test/errors.test.ts`. Os testes existentes de `test/errors.test.ts` (ex.: `:44` e `:140`) continuam válidos, porque só erros sem marca são usados neles.

## 4. Contratos e assinaturas

```ts
// src/problem.ts

import { HTTPError, type ErrorInput } from "./error.ts";

/** Entrada de `problem()`: os campos de `HTTPError` mais os campos RFC 9457 `type` e `instance`. */
export interface ProblemInput extends ErrorInput {
  /** URI que identifica o tipo do problema. Se omitido, o corpo usa `"about:blank"`. */
  type?: string;
  /** URI-reference que identifica esta ocorrência do problema. */
  instance?: string;
}

/**
 * Create an `HTTPError` rendered as RFC 9457 problem details when thrown or returned.
 */
export function problem(input: ProblemInput): HTTPError {
  const error = new HTTPError(input);
  const fields: ProblemFields = {
    type: input.type,
    instance: input.instance,
    detail: input.message || undefined,
  };
  (error as ProblemError)[kProblem] = fields;
  return error;
}

// Internos (não exportados pelo pacote)

export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

interface ProblemFields {
  type?: string;
  instance?: string;
  detail?: string;
}

type ProblemError = HTTPError & { [kProblem]?: ProblemFields };

/** Retorna os campos de problem details se o erro veio de `problem()`, senão `undefined`. */
export function getProblemFields(error: HTTPError): ProblemFields | undefined {
  return (error as ProblemError)[kProblem];
}

/** Corpo JSON RFC 9457. Valores `undefined` somem na serialização, então campos ausentes são omitidos. */
export function toProblemJSON(error: HTTPError, fields: ProblemFields): Record<string, unknown> {
  const unhandled = error.unhandled;
  return {
    ...(unhandled ? undefined : error.body),
    type: fields.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? undefined : fields.detail,
    instance: fields.instance,
    data: unhandled ? undefined : error.data,
  };
}
```

Observações sobre os contratos:
- `problem()` tem tipo de retorno explícito, exigido por `isolatedDeclarations` (`AGENTS.md`, seção TypeScript).
- `ProblemError` é um tipo interno; não aparece na API pública.
- `kProblem` segue a convenção `k` (`AGENTS.md`, seção Naming).

```ts
// src/response.ts — alterações

import { getProblemFields, toProblemJSON } from "./problem.ts";

const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problemFields = getProblemFields(error);
  const baseHeaders = problemFields ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers
    ? mergeHeaders(baseHeaders, error.headers)
    : new Headers(baseHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  return new FastResponse(
    JSON.stringify(
      {
        ...(problemFields ? toProblemJSON(error, problemFields) : error.toJSON()),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

Os demais caminhos de `prepareResponse` (`src/response.ts:129-241`) não mudam. Erros `problem()` passam pelo mesmo `onError`, `errHeaders`, `HEAD` e `event.res` que os outros.

```ts
// src/index.ts — alteração (src/index.ts:70-72)

export { problem, type ProblemInput } from "./problem.ts";
```

## 5. Estratégia de testes

Seguir `AGENTS.md` (seção Testing) e o fluxo de correção de bug de forma adaptada: escrever os testes antes da implementação e confirmar que falham.

**`test/problem.test.ts` (novo, `describeMatrix`, roda em `web` e `node`):**

| Teste | Requisito |
| --- | --- |
| `problem()` retorna `HTTPError` (`HTTPError.isError` verdadeiro) com `status` e `message` corretos | RF-01 |
| lançado e retornado de handler produzem a mesma resposta | RF-01 |
| `type` e `instance` aparecem no corpo | RF-02 |
| sem `type`, corpo tem `"about:blank"` e sem `instance` | RF-02 |
| `Content-Type` é exatamente `application/problem+json` (status 422) | RF-03 |
| `statusText` vira `title`; `message` vira `detail`; `data` fica como extensão | RF-04 |
| `problem({ status: 500 })` sem `message` não tem `detail` | D-05 |
| `message` fica como `detail` mesmo com `cause` de `Error` (sem vazar a mensagem do cause) | D-05 |
| `unhandled: true` oculta `detail`, `data` e `body`, mantém `status` | RF-06 |
| campos de `body` com chave `title`/`status`/`type` não sobrescrevem os membros RFC | D-05 (risco de colisão) |
| `headers` de `problem()` são mesclados e podem sobrescrever `Content-Type` | D-03 |
| `onError` recebe o `HTTPError` e pode substituir a resposta | integração |
| `HTTPError` sem marca mantém `application/json` e as chaves atuais | RF-05 (regressão) |
| em modo `debug`, `stack` aparece como antes | regressão |

Testes de `HTTPError` comum já existentes em `test/errors.test.ts` servem como regressão do RF-05 e do RF-08 e não mudam.

**`test/unit/package.test.ts`:** atualizar o snapshot inline com `"problem"` (`:104`). Verificar com `pnpm vitest run test/unit/package.test.ts`.

**`test/unit/types.test-d.ts` (opcional):** `expectTypeOf<ProblemInput>` aceita `{ status, message, type, instance }` e recusa chave desconhecida. Cobre RF-07. Verificar com `pnpm typecheck`.

**`test/dist.test.ts` (recomendado):** um caso que chama `problem()` no build (`dist/_entries/*.mjs`) e confere `Content-Type` e corpo. Motivo: o projeto já teve regressão em que o bundler removeu código considerado puro (comentário em `test/dist.test.ts`, linhas 4-16). Se `kProblem` ou a ramificação de `errorResponse` sumirem no build, o teste pega. Requer `pnpm build` antes.

**Comandos de verificação:**

```bash
pnpm vitest run test/problem.test.ts test/errors.test.ts test/unit/package.test.ts
pnpm typecheck
pnpm lint
pnpm build && pnpm vitest run test/dist.test.ts
pnpm vitest run                     # suíte completa (RF-08)
```

## 6. Riscos

| Risco | Origem | Mitigação |
| --- | --- | --- |
| **Colisão de chaves** em `body` sobrescrever membros RFC | PRD `sdd/prd.md:132` | Ordem fixa em `toProblemJSON` (D-05) e teste dedicado. |
| **`Content-Type` perdido** em adaptadores Node/web | PRD `sdd/prd.md:133` | Verificado: o `srvx` só define `content-type` padrão quando o cabeçalho está ausente (`node_modules/srvx/dist/adapters/node.mjs:606-609`). Teste em `describeMatrix` cobre `node` e `web`. |
| **Vazamento em erro `unhandled`** | PRD `sdd/prd.md:134` | Regra de D-06 e teste. `stack` em debug continua como hoje (ressalva de D-06). |
| **Marca perdida por `cause`** | D-07 | Documentado. Formato padrão, sem vazamento. |
| **`detail` omitido vs. preenchido** | D-05 | Ponto a confirmar com o time. Mudança localizada em `ProblemFields.detail`. |
| **Nome `ProblemInput`** | D-08, `sdd/prd.md:126` | Confirmar antes do merge. Mudar o nome afeta `src/index.ts` e os testes de tipo. |
| **Testes existentes** dependentes de `application/json` | PRD `sdd/prd.md:135` | Nenhum teste existente usa `problem()`, então nenhum precisa mudar, exceto o snapshot de exportações. |
| **Integração com JSON-RPC** | `src/utils/json-rpc.ts:484-488` | Um `problem()` lançado dentro de método JSON-RPC aparece no envelope JSON-RPC, não no formato RFC. Fora de escopo, mas vale documentar. |
| **Campos `type`/`instance` sem validação** | PRD fora de escopo | Sem validação de URI, como pede o PRD. |
| **Ajuste de `AGENTS.md` e docs** | `AGENTS.md`, seção de manutenção | Incluído na tabela da seção 3. |

## 7. Pendências

- Confirmar o nome `ProblemInput` (D-08).
- Confirmar a regra de `detail` omitido (D-05).
- Confirmar `Content-Type` sem `charset` (D-04).
- Nenhum código do projeto foi alterado nesta etapa; a verificação de build, testes e lint não foi executada, pois a tarefa pede apenas a especificação.
