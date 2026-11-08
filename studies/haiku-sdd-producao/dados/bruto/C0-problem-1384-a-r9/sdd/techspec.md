# Especificação técnica — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-08).
Todas as citações `arquivo:linha` abaixo foram conferidas no código do estado atual (commit `2f918ff`).

## 1. Estado atual relevante

- Toda resposta de erro de `HTTPError` passa por um único ponto: `errorResponse()` em `src/response.ts:358-380`, chamada em `src/response.ts:173` com `config.debug` e os `errHeaders` do evento. Ela monta os cabeçalhos a partir de `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`), mescla `error.headers` e depois `errHeaders` (`src/response.ts:359-364`) e serializa `{ ...error.toJSON(), stack }` (`src/response.ts:366-373`).
- Erros que não são `HTTPError` viram `HTTPError` com `unhandled = true` em `src/response.ts:146-155`; `toError` em `src/response.ts:73-83` também cria `unhandled: true` para valores lançados que não são `Error`.
- `HTTPError.toJSON()` (`src/error.ts:226-236`) esconde `message`, `data` e `body` quando `unhandled`. O PRD proíbe mudá-lo (seção 3 do PRD).
- `H3Config` está em `src/types/h3.ts:28-53` (`debug` na linha 32, `silent` na linha 37). `H3Core` guarda a config por referência (`src/h3.ts:55`) e passa `this.config` a `toResponse` (`src/h3.ts:99`), então mutações posteriores (`app.config.problemDetails = true`) já são visíveis em tempo de resposta. Os testes já fazem isso (`test/errors.test.ts:392`, `t.app.config.onError = undefined`).
- O construtor de `HTTPError` lê `status`, `statusText`, `headers` e `unhandled` do objeto de entrada e de `cause` (`src/error.ts:172-206`). O objeto de entrada é tipado por `ErrorInput` (`src/error.ts:6-26`) e `HTTPError.status(...)` já repassa `details` por spread (`src/error.ts:144-150`).
- Não existe tabela de textos de status no `src/` (busca por `STATUS_CODES`, `statusTexts` e equivalentes não retornou nada). O texto padrão exigido para `title` precisa ser criado, sem dependência nova nem nome público novo.
- `src/response.ts` já tem 380 linhas e `src/error.ts` tem 237, acima da meta de 200 do projeto. A lógica nova deve ficar em arquivo próprio.
- Há chamadas a `toResponse` sem `config` que renderizam erros devolvidos como valor: `src/utils/middleware.ts:26` (`onResponse` middleware) e `src/handler.ts:122-124` (`fetch` de handler avulso). Nelas `config` cai no padrão `{}` (`src/response.ts:16`).

## 2. Decisões de arquitetura

### D-01 — Onde fica o gatilho e como ele é lido
**Alternativas**
1. Ler `config.problemDetails` dentro de `errorResponse` via novo parâmetro, repassado por `prepareResponse` (que já recebe `config`).
2. Decidir em `toResponse` e trocar `errorResponse` por outra função de erro.
3. Capturar a opção na construção de `H3` e guardar em campo interno.

**Escolha: 1.** O ponto único de formatação já existe e `config` já chega a ele; ler no momento da resposta atende à premissa do PRD de que `app.config.problemDetails = true` após a criação funciona (a opção 3 quebraria isso). A opção 2 duplicaria a montagem de cabeçalhos, `statusText` e `stack`.

O valor efetivo é `config.problemDetails ?? event.app?.config.problemDetails` (mesmo padrão de `src/utils/internal/dispose.ts:176`, que lê `event.app?.config.silent`). O fallback cobre os caminhos que chamam `toResponse` sem `config` (ver D-08).

### D-02 — Os campos `type` e `instance` entram em `ErrorInput` e `HTTPError`, mas não em `ErrorBody` nem em `toJSON()`
**Alternativas**
1. Declarar em `ErrorBody` (`src/error.ts:30-69`), que `ErrorInput` estende e `HTTPError` implementa.
2. Declarar só em `ErrorInput` (`src/error.ts:6`) e como campos `readonly` da classe.

**Escolha: 2.** `ErrorBody` é o tipo de retorno de `toJSON()` (`src/error.ts:226`); pôr os campos ali sugeriria que o JSON legado os contém, e o PRD proíbe alterar `toJSON()`. Com a opção 2 o JSON legado fica byte a byte igual (RF-01). Os campos da classe seguem o padrão existente (`readonly x: T | undefined`, exigido por `isolatedDeclarations`).

### D-03 — Leitura de `type`/`instance` com `cause` e guarda de tipo
Seguindo `src/error.ts:202-206`, o construtor lê `(details as ErrorInput)?.type ?? (details?.cause as ErrorInput)?.type` (idem `instance`). Como `details` pode ser um `Error` arbitrário (erros não tratados são construídos com `new HTTPError(err)`, `src/response.ts:148`), o valor só é aceito se `typeof === "string"`; qualquer outro vira `undefined`. Isso impede que uma propriedade `type` de um erro de terceiros (ex.: objeto, número) vaze ou quebre o JSON.

### D-04 — Construção do corpo em módulo interno novo
**Alternativas**
1. Inline em `errorResponse`.
2. Novo arquivo interno `src/utils/internal/problem.ts` (convenção de helpers internos do `AGENTS.md`), não exportado em `src/index.ts`.
3. Método novo em `HTTPError` (ex.: `toProblem()`).

**Escolha: 2.** A opção 1 estoura a meta de 200 linhas de `src/response.ts`; a 3 cria nome público novo, proibido pelo contrato. O arquivo conterá: a tabela de textos de status, a constante de Content-Type e `problemBody()`.

### D-05 — `title`, `detail` e a regra de "mensagem genérica"
- `title = error.statusText ?? textoPadrao(error.status)`. Texto desconhecido cai em `"Error"`.
- `detail` é omitido quando `error.message` é só texto derivado do status. O construtor deriva `message` em `src/error.ts:187-193` de: `statusText`/`statusMessage` ou de `"HTTPError <status> <statusText>"`. Logo, `detail` é omitido se a mensagem for igual a `error.statusText`, ao texto padrão do status, ou a `["HTTPError", status, statusText].filter(Boolean).join(" ")`.
- Consequência aceita: uma mensagem explícita idêntica ao `statusText` também é omitida (seria redundante com `title`). Exemplo: `test/errors.test.ts:67-85` (`statusText: "Unprocessable"` sem `message`) não teria `detail`.

**Alternativa rejeitada:** comparar só com o texto padrão. Falharia no caso `statusText` customizado sem `message`, que geraria `detail` repetindo `title`.

### D-06 — Precedência dos membros e das chaves de extensão
Ordem de montagem (a última vence): `data` (se definido) → chaves de `body` → membros padrão `type`, `title`, `status`, `detail`, `instance` → `stack` (só com `debug`).
- Os cinco membros padrão não podem ser sobrescritos por `body` (RF-05). Isso inclui `status`, que sempre é `error.status`.
- `body` continua tendo precedência sobre `data` quando ambos usam a chave `data`, igual ao legado (`src/error.ts:230-234`, `...body` por último). O PRD diz apenas que `data` é mantido sob `data`; não muda a semântica herdada.
- `stack` vem por último e sobrescreve uma chave `stack` de `body`, igual ao legado (`src/response.ts:369`).
- Chaves legadas `statusText`, `message` e `unhandled` não entram no corpo problem+json (viram `title`/`detail`); `unhandled` não é membro da RFC.
- Valores `undefined` são descartados pelo `JSON.stringify`, então `detail` e `instance` ausentes não precisam de `delete`.

### D-07 — Erros não tratados (RF-06)
Para `error.unhandled`, `problemBody` ignora `message`, `data`, `body` e `statusText` e devolve apenas `type` (`error.type` ou `"about:blank"`), `title` (texto padrão de `error.status`), `status` e `instance` (se houver), mais `stack` quando `debug`.
- Escolha de segurança: `title` usa o texto padrão e não `statusText`, mesmo que o erro original traga um. No caso comum (`status` 500) coincide com o texto exigido pelo PRD.
- Com `debug: true` o legado já expõe `stack` de erros não tratados e `message` não (o `toJSON` esconde). Mantemos a mesma fronteira: só `stack`, nunca `message`.

### D-08 — Chamadas a `toResponse` sem `config`
`src/utils/middleware.ts:26` e `src/handler.ts:122-124` renderizam erros com `config = {}`. Hoje isso já ignora `debug` nesses caminhos.
**Alternativas**
1. Mudar o padrão de `toResponse` para `event.app?.config`: altera também `onError`, `onResponse` e `silent` nesses caminhos, o que é uma mudança de comportamento fora do escopo.
2. Aplicar o fallback `event.app?.config` somente para `problemDetails` (D-01).
3. Não tratar.

**Escolha: 2.** Cumpre RF-02 ("toda resposta de erro gerada pelo h3") sem alterar nenhum outro comportamento. O handler avulso de `src/handler.ts:113-125` cria `H3Event` sem app, então `event.app` é `undefined` e ele continua no formato legado; isso fica registrado como limitação (seção 6).

### D-09 — Content-Type e mescla de cabeçalhos (RF-02, RF-07)
Com a opção ligada, a base de cabeçalhos passa a ser `content-type: application/problem+json;charset=UTF-8` no lugar de `jsonHeaders`; o restante de `errorResponse` fica igual: `error.headers` e depois `errHeaders` mesclam por cima (`src/response.ts:359-364`), então um `Content-Type` definido pelo erro prevalece e `x-id` etc. são preservados. `statusText` da resposta segue `error.statusText` (`src/response.ts:377`). O charset mantém o padrão dos cabeçalhos JSON atuais, como pede RF-02.
Com a opção desligada o caminho de código é o atual, sem alocação extra (o custo do caminho quente não muda).

### D-10 — Tabela de textos de status
**Alternativas**
1. `http.STATUS_CODES` do Node: quebra a portabilidade (Workers, Deno, browsers); o projeto exige APIs web padrão.
2. Dependência nova: contraria "2 production deps" do `AGENTS.md`.
3. Tabela interna com os códigos IANA mais comuns em `problem.ts`.

**Escolha: 3.** Registro pequeno (~60 entradas, 1xx a 5xx) como `Record<number, string>` privado do módulo. Não é exportado e não cria nome público.

## 3. Arquivos a alterar

| Arquivo | Linha(s) | Mudança |
| --- | --- | --- |
| `src/types/h3.ts` | `src/types/h3.ts:37` (após `silent`) | Adicionar `problemDetails?: boolean` com TSDoc (padrão `false`, descreve `application/problem+json` e a troca `message`→`detail`, `statusText`→`title`). |
| `src/error.ts` | `src/error.ts:6-26` (`ErrorInput`) | Adicionar `type?: string` e `instance?: string` com TSDoc (RFC 9457 §3.1.1 e §3.1.5). |
| `src/error.ts` | `src/error.ts:102-119` (campos da classe) | Adicionar `readonly type: string \| undefined` e `readonly instance: string \| undefined`. |
| `src/error.ts` | `src/error.ts:202-210` (construtor) | Atribuir os dois campos com leitura de `details` e `details.cause` e guarda `typeof === "string"` (D-03). |
| `src/error.ts` | `src/error.ts:226-236` (`toJSON`) | **Sem alteração** (D-02). |
| `src/error.ts` | `src/error.ts:144-150` (`HTTPError.status`) | Sem alteração de código: o spread de `details` já repassa `type` e `instance`; coberto por teste. |
| `src/utils/internal/problem.ts` | novo | Tabela de status, Content-Type e `problemBody()` (D-04, D-05, D-06, D-07, D-10). |
| `src/response.ts` | `src/response.ts:173` | Passar o flag efetivo: `errorResponse(error, config.debug, errHeaders, config.problemDetails ?? event.app?.config.problemDetails)`. |
| `src/response.ts` | `src/response.ts:358-380` (`errorResponse`) | Novo 4º parâmetro; escolher base de cabeçalhos e corpo (D-09). Resto inalterado. |
| `src/response.ts` | `src/response.ts:1-8` (imports) | Importar `problemBody` e a constante de Content-Type de `./utils/internal/problem.ts`, com extensão `.ts`. |
| `docs/1.guide/900.api/1.h3.md` | `docs/1.guide/900.api/1.h3.md:111-117` | Documentar `problemDetails` na lista de opções (junto de `debug` e `silent`) e avisar sobre a mudança de chaves. |
| `docs/1.guide/1.basics/6.error.md` | `docs/1.guide/1.basics/6.error.md:51-60` e `:89-90` | Documentar `type` e `instance` em "HTTPError Fields", um exemplo de corpo problem+json e a nota de erros não tratados. |
| `test/problem-details.test.ts` | novo | Testes RF-01 a RF-07 (seção 5). |
| `test/unit/types.test-d.ts` | `test/unit/types.test-d.ts:35` (bloco `describe("types")`) | Teste de tipos para `H3Config.problemDetails` e para `ErrorInput`/`HTTPError` (`type`, `instance`). |

Nenhum nome é adicionado a `src/index.ts`; `test/unit/package.test.ts` e `test/dist.test.ts` não devem mudar.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts — dentro de H3Config
/**
 * When enabled, error responses use the RFC 9457 problem details format
 * (`application/problem+json` with `type`, `title`, `status`, `detail` and `instance`).
 *
 * @default false
 */
problemDetails?: boolean;

// src/error.ts — ErrorInput
type?: string;
instance?: string;

// src/error.ts — HTTPError
readonly type: string | undefined;
readonly instance: string | undefined;

// src/utils/internal/problem.ts (interno, não exportado em src/index.ts)
export const problemContentType: string; // "application/problem+json;charset=UTF-8"
export function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;

// src/response.ts (função interna do módulo)
function errorResponse(
  error: HTTPError,
  debug?: boolean,
  errHeaders?: Headers,
  problemDetails?: boolean,
): Response;
```

Contrato do corpo (opção ligada):

| Membro | Valor |
| --- | --- |
| `type` | `error.type` ou `"about:blank"` |
| `title` | `error.statusText` ou texto padrão do status (não tratado: sempre o texto padrão) |
| `status` | `error.status` (igual ao status HTTP da resposta) |
| `detail` | `error.message`, omitido se genérica (D-05) ou se `unhandled` |
| `instance` | `error.instance`, omitido se ausente |
| extensões | `data` e chaves de `body` (omitidos se `unhandled`), sem sobrescrever os cinco acima |
| `stack` | só com `debug`, como hoje |

Com `debug: true` a indentação de 2 espaços continua (`src/response.ts:372`).

## 5. Estratégia de testes

Novo `test/problem-details.test.ts`, com `describeMatrix` (web e node), `ctx.app` por teste e `app.config.problemDetails = true` em cada caso (o `_setup.ts:136` cria o app com `debug: true`, então os casos sem `stack` precisam ajustar `debug`; erros não tratados exigem `allowUnhandledErrors`, ver `test/_setup.ts:152-157` e o `t.errors = []` usado em `test/errors.test.ts:352`).

| RF | Casos |
| --- | --- |
| RF-01 | Sem a opção e com `false`: `Content-Type: application/json;charset=UTF-8` e as mesmas chaves (`status`, `statusText`, `message`, `data`...); `toJSON()` do erro inalterado (sem `type`/`instance`). |
| RF-02 | `new HTTPError({ status: 404 })` → 404 e tipo `application/problem+json`; também para `kNotFound` (rota inexistente) e `throw 404`. |
| RF-03 | O exemplo completo do PRD (403 com `type`, `instance`); defaults (`about:blank`, `title` padrão, `detail` omitido com `new HTTPError({ status: 404 })`); `statusText` customizado sem `message` não gera `detail`; mensagem explícita gera `detail`. |
| RF-04 | Unitário (sem matriz): `error.type`/`error.instance`; `undefined` quando ausentes; leitura via `cause`; `HTTPError.status(400, undefined, { type, instance })`; valores não-string em `cause` viram `undefined`. |
| RF-05 | `body: { errors, status: 200 }` + `data` → `status: 422`, `errors`, `data`; `body` com `type`/`title`/`detail`/`instance` não sobrescreve; `body.data` vs `data` (precedência do `body`). |
| RF-06 | `throw new Error("segredo interno")` sem `debug`: 500, problem+json, corpo sem a string; `data`/`body` de erro não tratado ausentes; `throw {…}` (via `toError`) idem; com `debug` aparece `stack` mas não `message`. |
| RF-07 | `debug: true` + `headers: { "x-id": "1" }` → `stack`, `x-id` e problem+json; `Content-Type` explícito do erro prevalece; `event.res.errHeaders` mesclado; `res.statusText` aplicado. |
| Extra | `app.config.problemDetails = true` após criar o app vale; `onResponse` middleware devolvendo `HTTPError` (D-08); erro com `data` circular continua virando 500 (mesmo caminho de `test/errors.test.ts:388-400`); `HEAD` não retorna corpo. |

Testes de tipos em `test/unit/types.test-d.ts`: `expectTypeOf<H3Config["problemDetails"]>().toEqualTypeOf<boolean | undefined>()`, `ErrorInput` aceita `type`/`instance` strings e rejeita número, `HTTPError["type"]` e `["instance"]` são `string | undefined`.

Testes existentes: com a opção desligada nenhum deve mudar. Os que inspecionam o formato do erro (`test/errors.test.ts:67-85`, `:88-105`, `:350`) usam `toMatchObject` e permanecem válidos; nenhum teste chama `toJSON()` ou compara a forma enumerável de `HTTPError`. Se `pnpm vitest run` mostrar alguma quebra, ajustar só aquele teste, mantendo a asserção original (RF-08).

Verificação final: `pnpm vitest run test/problem-details.test.ts test/errors.test.ts`, depois `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`. Seguindo o fluxo de bug do `AGENTS.md`, escrever os testes primeiro e confirmar que falham.

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Handler avulso (`src/handler.ts:113-125`) cria `H3Event` sem app e usa `config = {}` | Erros devolvidos por `.fetch` de um handler isolado ficam no formato legado mesmo que a app tenha a opção | Limitação documentada; já é o comportamento de `debug` hoje. Corrigir exigiria mudar o padrão de `toResponse` (D-08, fora de escopo). |
| `freezeApp` congela `app.config` nas entradas bun/cloudflare/deno (`src/_entries/_common.ts:3-5`) | `app.config.problemDetails = true` após o servidor iniciar lança nesses runtimes | A leitura em tempo de resposta continua válida para a opção passada no construtor; documentar que a mutação tardia só vale antes do congelamento. |
| Mudança de contrato para clientes ao ligar a opção (`message`→`detail`, `statusText`→`title`, some `unhandled`) | Clientes legados quebram | Desligada por padrão; documentação com a troca de chaves (seção 3). |
| Vazamento de informação em `detail`, `data`, `body` | Exposição de dados internos | D-07 e teste RF-06; `type`/`instance` só aceitos como `string` (D-03). |
| `detail` omitido quando a mensagem coincide com `statusText` | Mensagem explícita igual ao `statusText` some | Redundante com `title`; documentado na TSDoc e coberto por teste. |
| Divergência de comportamento de `statusText` e cabeçalhos entre `web` e `node` | Teste passa em um alvo e falha no outro | Todos os testes via `describeMatrix`; `statusText` com `sanitizeStatusMessage` já aplicado no construtor (`src/error.ts:180-185`). |
| Tabela de status incompleta | `title` genérico para códigos raros | Fallback `"Error"`; `statusText` do erro continua tendo prioridade. |
| `isolatedDeclarations` e limite de 200 linhas | Falha de typecheck/lint | Tipos explícitos nos campos novos; lógica nova em `problem.ts`. `src/error.ts` ganha ~15 linhas e `src/response.ts` ~6. |
| Erro com `body`/`data` não serializáveis | Exceção síncrona em `JSON.stringify` | Mesmo caminho do legado: `toResponse` captura e responde 500 (`src/response.ts:26-30`); coberto pelo teste "Extra". |
