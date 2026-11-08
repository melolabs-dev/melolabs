# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-11).
Status: proposta para revisão. Nenhum arquivo do projeto foi alterado.

Todas as citações `arquivo:linha` foram conferidas na árvore atual (`master`, commit `83a28ec`).

---

## 1. Resumo

- A renderização de erro passa a ser um único ponto: `errorResponse` (`src/response.ts:358`). Ela troca `error.toJSON()` por um helper interno, `toProblemDetails()`, e troca o `Content-Type` por `application/problem+json`.
- `HTTPError` ganha as propriedades readonly `type` e `instance` (únicas adições à API pública).
- `HTTPError.toJSON()` não muda. Ele continua sendo o contrato de `JSON.stringify(error)` para o código do usuário.
- Decisão que precisa de confirmação: manter `message` e `statusText` como membros de extensão na raiz do corpo (D-03). Isso reduz a quebra de clientes e de testes, e é o mitigador previsto no PRD (R1).

---

## 2. Estado atual (fatos do código)

| Fato | Onde |
| --- | --- |
| `toJSON()` monta `status`, `statusText`, `unhandled`, `message` (mascarada para `"HTTPError"` em erro não tratado), `data` e espalha `body` | `src/error.ts:226-236` |
| `errorResponse` monta o corpo com `...error.toJSON()` e acrescenta `stack` só em modo debug | `src/response.ts:358-380` (corpo em `:368`) |
| Content-Type de erro vem de `jsonHeaders`, `application/json;charset=UTF-8` | `src/response.ts:270-272` (usado em `:360-361`) |
| `kNotFound` vira `HTTPError` 404 com a mensagem "Cannot find any route matching ..." e passa por `errorResponse` | `src/response.ts:139-144`, `:173` |
| Erro não `HTTPError` vira `unhandled` (`status` 500, `message` mascarada) | `src/response.ts:146-155`, `:73-83` |
| Com `onError`, o valor retornado passa de novo por `prepareResponse` com `nested = true` | `src/response.ts:159-166` |
| Limpeza de `kEventRes` antes de renderizar, para não duplicar `set-cookie` | `src/response.ts:167-173` (comentário em `:167-171`) |
| `ErrorBody` define o formato de entrada; `ErrorInput` estende `Partial<ErrorBody>` | `src/error.ts:6`, `:30-69` |
| `data` e `body` são lidos só de `details`; `unhandled`, `headers` e `status` também caem para `cause` | `src/error.ts:208-209` (`data`/`body`), `:205-206` (`unhandled`) |
| `HTTPError` não tem tabela de frases de status; `statusText` é `undefined` quando ausente | `src/error.ts:200`; não existe tabela no `src` |
| `HTTPError` de nível HTTP lançado pelo JSON-RPC: 405, 415 e 403 | `src/utils/json-rpc.ts:168`, `:176`, `:235` |
| O envelope de erro JSON-RPC é montado à parte, sem `toJSON()` | `src/utils/json-rpc.ts:478-498` |
| Validação: `createValidationError` usa `statusText` e `message` no `HTTPError`, e `data.issues` | `src/utils/internal/validate.ts:220-228` |
| Erro de WebSocket 426 é texto puro, fora de `errorResponse` | `src/utils/ws.ts:157` |
| API pública exporta `HTTPError`, `ErrorBody`, `ErrorInput`, `ErrorDetails` | `src/index.ts:72` |
| `dist.test.ts` só roda com `dist/` gerado por `pnpm build` (é pulado se não existir) | `test/dist.test.ts:13-19` |

Testes existentes que dependem do formato atual:

| Teste | O que verifica | Impacto |
| --- | --- | --- |
| `test/errors.test.ts:44` | `content-type` exato `application/json;charset=UTF-8` em erro com `errHeaders` | **Quebra**. Ajustar para `application/problem+json;charset=UTF-8`, mantendo a verificação de merge de headers. |
| `test/errors.test.ts:140` | `content-type` com `toMatch("application/json")` | **Quebra**, porque `application/problem+json` não contém a substring `application/json`. Ajustar para `application/problem+json`. |
| `test/errors.test.ts:79-84`, `:99-103`, `:119-121`, `:144-150`, `:350` | corpo com `message`, `statusText`, `status`, `data`, `topLevel`, `unhandled` | Passam se `message` e `statusText` continuarem na raiz (D-03). |
| `test/app.test.ts:205`, `test/handler.test.ts` (validação), `test/body.test.ts:457`, `test/proxy.test.ts:1025` | `statusText` ou `message` no corpo de erro | Passam pelo mesmo motivo. |
| `test/json-rpc.test.ts:382`, `:894`, `:904`, `:944` | só `status` de 405, 415 e 403 | Passam (não leem o corpo). |
| `test/proxy.test.ts:1531` | `content-type` de resposta **de sucesso** | Não é afetado. |
| `test/security.test.ts:556` | `content-type` de resposta **de sucesso** | Não é afetado. |

---

## 3. Decisões de arquitetura

### D-01 — Ponto único de geração: helper interno; `toJSON()` inalterado

**Alternativas**

1. Mudar `HTTPError.toJSON()` para devolver problem details.
2. Criar um helper interno `toProblemDetails(error)` chamado só por `errorResponse`, e deixar `toJSON()` como está.
3. Montar o corpo direto dentro de `errorResponse`, sem helper.

**Escolha: 2.**

**Por quê:** `toJSON()` é o contrato de `JSON.stringify(error)` no código do usuário. Mudá-lo (opção 1) altera a API de código, o que o PRD (P2) proíbe. A opção 3 mistura a regra de formato com a montagem de headers e de `stack`, e tira da função a única coisa que precisa ser testada isoladamente. O helper aproveita `toJSON()` para a máscara de erro não tratado, então a regra de mascaramento continua em um lugar só.

### D-02 — `Content-Type: application/problem+json;charset=UTF-8`

**Alternativas**

1. Manter `application/json`.
2. Negociar por `Accept` (responder JSON ou problem details conforme o cliente).
3. Usar sempre `application/problem+json`, no mesmo formato de `jsonHeaders`.

**Escolha: 3.** O PRD (RF-01) exige o tipo fixo. A opção 2 é mais complexa e não foi pedida. O charset segue o que o h3 já envia hoje (`jsonHeaders`, `src/response.ts:271`).

### D-03 — Membros do corpo: RFC 9457 + extensões

Membros da RFC: `type`, `title`, `status`, `detail`, `instance`.

Membros de extensão, mantidos na raiz: `data`, o conteúdo de `body`, `unhandled` (PRD RF-06) e, por decisão aqui, `message` e `statusText`. A RFC 9457 §3.2 permite extensões.

**Alternativas**

1. Corpo só com membros da RFC. Remove `message` e `statusText`.
2. Corpo com membros da RFC mais as extensões atuais. Mantém `message` e `statusText`.

**Escolha: 2, a confirmar.** Remover `message` e `statusText` quebra consumidores que leem esses campos e exige reescrever os asserts em `test/errors.test.ts`, `test/app.test.ts`, `test/handler.test.ts` e `test/proxy.test.ts`, o que foge da restrição "não quebrar o que já existe" do pedido. Se o responsável preferir o corpo limpo (P3 do PRD), a mudança é localizada: remover as duas chaves de `toProblemDetails` e ajustar os testes citados.

**Por quê:** é o mitigador previsto em R1, e minimiza a mudança para os clientes que hoje leem `message` e `statusText`.

Custo: `detail` e `message` repetem o mesmo texto, e `title` e `statusText` também. Isso é aceitável e deve ser documentado.

### D-04 — `title`: `statusText` ou frase padrão interna

`title = error.statusText ?? defaultStatusText(error.status)` (PRD P4).

`defaultStatusText` usa uma tabela interna com as frases do RFC 9110 e do registro IANA. Exemplo: `422 → "Unprocessable Content"`, `500 → "Internal Server Error"`.

**Alternativas**

1. Omitir `title` quando não há `statusText`. Viola RF-02 e RF-05.
2. Usar `http.STATUS_CODES` do Node. Viola "web standards first" (AGENTS.md) e não funciona em Workers.
3. Tabela interna pequena, só com os códigos usados pelo próprio h3.
4. Tabela interna com todo o registro 1xx a 5xx.

**Escolha: 4**, com um fallback. Códigos fora da tabela não recebem `title`, para não inventar frase. A tabela custa pouco (uns 60 registros) e evita que o `title` dependa do que o código do app usa.

### D-05 — `type` e `instance`: campos de `ErrorBody` e de `HTTPError`

- `type` e `instance` entram em `ErrorBody` como opcionais. Isso faz `ErrorInput`, `HTTPError.status(...)` e o construtor aceitarem os dois sem tipos novos.
- Em `HTTPError`, são `readonly` e lidos só de `details`, como `data` e `body` (`src/error.ts:208-209`).
- `instance` não recebe valor automático (PRD P5).

**Alternativas**

1. Colocar `type` e `instance` dentro de `body`. Não atende RF-03, porque não viram propriedades da instância.
2. Ler também de `details.cause`, como `status` e `statusText`. Mais magia, sem necessidade.

**Escolha: campos em `ErrorBody` lidos só de `details`.**

Não há validação de URI em `type` e `instance`. Eles são serializados como string JSON, e o PRD não pede validação.

### D-06 — Membros da RFC vencem colisões com `body`

Se `body` tiver chaves `type`, `title`, `status`, `detail` ou `instance`, os membros da RFC prevalecem. Implementação: `{ ...error.toJSON(), type, title, status, detail, instance }`. As chaves do `body` com esses nomes são sobrescritas.

**Alternativas:** deixar `body` vencer (como hoje, em `toJSON()`: `body` é espalhado por último, `src/error.ts:234`), ou remover silenciosamente.

**Escolha:** RFC vence. Hoje `body.status` sobrescreve `status` no corpo, o que deixa o corpo inconsistente com o status da resposta. Isso é uma mudança de comportamento pequena e deve constar do changelog.

### D-07 — Erros HTTP do JSON-RPC viram problem details; envelope JSON-RPC não muda

`json-rpc.ts` lança `HTTPError` de nível HTTP (405, 415, 403, em `src/utils/json-rpc.ts:168`, `:176`, `:235`). Esses erros passam por `errorResponse` e passam a sair como `application/problem+json`. O envelope JSON-RPC (`src/utils/json-rpc.ts:478-498`) não é tocado.

**Alternativas**

1. Excluir esses erros da mudança, com um caminho especial em `errorResponse`.
2. Deixar sair como problem details (escolhido).

**Escolha: 2, a confirmar.** O PRD exclui "erros do JSON-RPC" mas não fala de 405, 415 e 403. Esses são respostas HTTP geradas pelo h3, por isso entram em RF-01. A opção 1 exigiria exceção no código por conta de uma rota. Se o responsável quiser a exclusão, a mudança é restrita a `errorResponse`.

### D-08 — Fora de escopo, sem mudança

- `src/utils/ws.ts:157` (426 em texto puro), SSE e erros de WebSocket que não passam por `errorResponse`, conforme PRD.
- `src/utils/internal/validate.ts` continua criando `HTTPError` com `statusText` e `data`; o formato muda só na renderização.

---

## 4. Arquivos a alterar

| Arquivo | Linhas de referência | Mudança |
| --- | --- | --- |
| `src/error.ts` | `:6`, `:30-69`, `:47-49`, `:112-119`, `:199-209`, `:226` | Adicionar `type?` e `instance?` em `ErrorBody` (após `body`, `:68`). Atualizar o doc de `message` (`:47-49`), que hoje cita só a chave `message`. Adicionar `readonly type` e `readonly instance` na classe (após `body`, `:112`). Atribuir os dois no construtor (após `:209`). Em `toJSON()` (`:226`), trocar o retorno para `Omit<ErrorBody, "body" \| "type" \| "instance"> & ErrorBody["body"]`, para não expor campos que `toJSON()` não emite. |
| `src/utils/internal/problem.ts` | novo | `toProblemDetails()`, interface `ProblemDetails` e a tabela `defaultStatusText()`. Fica em `utils/internal/`, conforme AGENTS.md. |
| `src/response.ts` | `:1-8` (imports), `:270-272`, `:358-380` | Importar `toProblemDetails`. Adicionar `problemHeaders` (FrozenHeaders, `application/problem+json;charset=UTF-8`) logo após `jsonHeaders` (`:270-272`). Em `errorResponse` (`:358-380`), trocar `jsonHeaders` por `problemHeaders` (`:360-361`) e `error.toJSON()` por `toProblemDetails(error)` (`:368`). `stack` continua igual (`:369`). |
| `docs/1.guide/1.basics/6.error.md` | `:19-31`, `:42-44`, `:54-60`, `:90` | Atualizar o exemplo de corpo para problem details, descrever `type` e `instance`, e trocar "`message`" por "`detail`" na nota de campos ocultos (`:90`). |
| `AGENTS.md` | `:89-90` | Atualizar a listagem de `utils/internal/` com `problem.ts`, conforme a nota de manutenção no topo do arquivo. |
| `test/errors.test.ts` | `:44`, `:140` | Ajustar o `content-type` esperado, conforme a seção 2. |
| `test/problem-details.test.ts` | novo | Testes de integração com `describeMatrix` (seção 6). |
| `test/unit/problem-details.test.ts` | novo | Testes unitários de `toProblemDetails` e da tabela. |

Não alterar: `src/index.ts` (o único export novo é o de campos, não de símbolos), `src/utils/json-rpc.ts`, `src/utils/ws.ts`, `src/h3.ts`.

---

## 5. Contratos e assinaturas

### 5.1 `ErrorBody` e `HTTPError` (`src/error.ts`)

```ts
export interface ErrorBody<DataT = unknown> {
  // ... campos existentes, sem mudança ...
  body?: Record<string, unknown>;

  /**
   * URI que identifica o tipo do problema (RFC 9457 §3.1.1).
   * Sem valor, o corpo de erro usa `"about:blank"`.
   */
  type?: string;

  /**
   * URI que identifica esta ocorrência do problema (RFC 9457 §3.1.5).
   * Não recebe valor automático.
   */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ... campos existentes ...
  /** Tipo do problema (RFC 9457). `undefined` quando não informado. */
  readonly type: string | undefined;
  /** Ocorrência do problema (RFC 9457). `undefined` quando não informada. */
  readonly instance: string | undefined;

  toJSON(): Omit<ErrorBody, "body" | "type" | "instance"> & ErrorBody["body"]; // sem mudança de comportamento
}
```

Atribuições no construtor (ao lado de `this.data` e `this.body`, `src/error.ts:208-209`):

```ts
this.type = (details as ErrorBody)?.type;
this.instance = (details as ErrorBody)?.instance;
```

`HTTPError.status(status, statusText?, details?)` (`src/error.ts:144-150`) não muda de assinatura. Ele já repassa `details` ao construtor, então aceita `type` e `instance` por tipo.

### 5.2 Helper interno (`src/utils/internal/problem.ts`)

```ts
import type { HTTPError } from "../../error.ts";

/** Corpo de erro no formato RFC 9457, com as extensões de D-03. Uso interno. */
export interface ProblemDetails {
  type: string;
  title?: string;
  status: number;
  detail: string;
  instance?: string;
  [member: string]: unknown;
}

/**
 * Monta o corpo de problem details de um `HTTPError`.
 *
 * Membros da RFC vencem colisões com `body` (D-06). Erro não tratado é mascarado
 * por `toJSON()`, então `detail` herda a máscara (`"HTTPError"`).
 */
export function toProblemDetails(error: HTTPError): ProblemDetails {
  const json = error.toJSON();
  return {
    ...json,
    type: error.type ?? "about:blank",
    title: error.statusText ?? defaultStatusText(error.status),
    status: error.status,
    detail: json.message,
    instance: error.instance,
  };
}

/** Frase padrão do status (RFC 9110 / IANA). `undefined` para código fora da tabela. */
export function defaultStatusText(status: number): string | undefined;
```

`defaultStatusText` é `function` privada ao arquivo, com a tabela como `const` no fim do arquivo, conforme AGENTS.md. A tabela não é exportada no `src/index.ts`.

Observação sobre `title` de erro não tratado: `statusText` é `undefined` (`src/error.ts:200`), então o `title` cai na frase de 500 (RF-05).

### 5.3 `errorResponse` (`src/response.ts`)

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json;charset=UTF-8",
});

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  let headers: Headers = error.headers
    ? mergeHeaders(problemHeaders, error.headers)
    : new Headers(problemHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  return new FastResponse(
    JSON.stringify(
      {
        ...toProblemDetails(error),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

Os headers continuam sendo copiados para um `Headers` novo (`mergeHeaders` e `new Headers`), então `problemHeaders` nunca é mutado. Isso preserva a regra do comentário em `src/response.ts:167-171`.

### 5.4 Tabela de status

```ts
const STATUS_TEXTS: Readonly<Record<number, string>> = {
  100: "Continue",
  // ... 1xx a 5xx do registro IANA, frases do RFC 9110 ...
  422: "Unprocessable Content",
  500: "Internal Server Error",
  // ...
};
```

Nomes do RFC 9110 (ex.: "Content Too Large" para 413, "Unprocessable Content" para 422). Frases devem respeitar a regra de caracteres de `sanitizeStatusMessage` (`src/utils/sanitize.ts:10-12`), o que é verdade para todas as frases ASCII.

### 5.5 Corpo final (exemplo, 422 com `message`, `data` e `body`)

```json
{
  "status": 422,
  "statusText": "Unprocessable Content",
  "message": "Campo email inválido",
  "data": { "field": "email" },
  "topLevel": "works",
  "type": "about:blank",
  "title": "Unprocessable Content",
  "detail": "Campo email inválido"
}
```

(Campos `undefined`, como `unhandled` ou `instance` ausentes, não aparecem no JSON. `unhandled: true` aparece só em erro não tratado. `stack` só aparece com `debug: true`.)

---

## 6. Estratégia de testes

### 6.1 Ordem

Seguir o fluxo de correção do AGENTS.md, mesmo sendo feature: escrever os testes de RF-01 a RF-09 antes da implementação e confirmar que falham. Só então mudar `src/`.

### 6.2 `test/problem-details.test.ts` (novo, `describeMatrix`)

`describeMatrix` roda cada teste em `web` e `node` (`test/_setup.ts:11-38`), o que cobre RF-01 em ambos os modos (R5 do PRD).

| Teste | Requisito | Verificação |
| --- | --- | --- |
| Erro `HTTPError.status(400, "Bad Request")` | RF-01 | `res.status` 400, `content-type` `application/problem+json;charset=UTF-8` |
| `HTTPError` 422 com `statusText` e `message` | RF-02 | Corpo com `type: "about:blank"`, `title`, `status: 422`, `detail` |
| `type` e `instance` no construtor | RF-03 | `error.type`, `error.instance` e corpo com os dois valores |
| `HTTPError.status(404, "Not Found")` sem `type` | RF-04 | Corpo com `type: "about:blank"`; `error.type` é `undefined` |
| `new Error("senha do banco: 123")` | RF-05 | Status 500, content-type, `detail !== "senha do banco: 123"`, sem `stack` no corpo (sem `debug`) |
| `body` e `data` com `message: "Conflito"` | RF-06 | `detail: "Conflito"`, `data`, `motivo` na raiz |
| `headers` com `retry-after` | RF-07 | Status 429, header `retry-after: 30`, corpo problem details |
| `onError` retornando `HTTPError.status(418, "I'm a teapot")` | RF-08 | Status 418, content-type, `title: "I'm a teapot"` |
| Rota inexistente `GET /inexistente` | RF-09 | Status 404, content-type, `detail` contendo `Cannot find any route matching [GET]` |

Notas de implementação dos testes:

- `setupBaseTest` instala um `onError` mock (`test/_setup.ts:135-141`), que só registra o erro e devolve `undefined`. O `errors.test.ts` desliga o hook com `t.app.config.onError = undefined` quando precisa.
- O `afterEach` falha se houver erro `unhandled` registrado (`test/_setup.ts:152-157`). O teste de RF-05 deve limpar `t.errors = []` ao fim, como `test/errors.test.ts:116` e `:185` já fazem.
- Para RF-08, o `onError` deve ser configurado com `t.app.config.onError = ...`, como em `test/errors.test.ts:203`.

### 6.3 `test/unit/problem-details.test.ts` (novo)

- `toProblemDetails` com `unhandled: true` devolve `detail: "HTTPError"` e não tem `data` nem `body`.
- `body` com `type`, `title`, `status`, `detail` e `instance` não altera os membros da RFC (D-06).
- `defaultStatusText(422) === "Unprocessable Content"`, `defaultStatusText(500) === "Internal Server Error"`, `defaultStatusText(599)` é `undefined`.
- Cada entrada da tabela tem código de 3 dígitos e frase sem caracteres fora de `sanitizeStatusMessage`.
- `HTTPError.toJSON()` continua com o formato antigo (regressão de D-01): `Object.keys(error.toJSON())` não inclui `type`, `title` nem `detail`.

### 6.4 Tipos

- Opcional, em `test/unit/types.test-d.ts`: `expectTypeOf(error.type).toEqualTypeOf<string | undefined>()` e o mesmo para `instance`. Também confirmar que `HTTPError.status(403, "Forbidden", { type: "..." })` compila.

### 6.5 Testes existentes

- Ajustar apenas `test/errors.test.ts:44` e `:140`, como descrito na seção 2. Manter a verificação original de cada um.
- Não alterar asserts de corpo que continuam válidos (D-03).
- Previsão: nenhum outro teste existente quebra. Confirmar com a suíte completa, não só com a previsão.

### 6.6 Comandos

```bash
pnpm vitest run test/problem-details.test.ts test/unit/problem-details.test.ts   # antes: deve falhar
pnpm vitest run test/errors.test.ts test/app.test.ts test/handler.test.ts test/json-rpc.test.ts
pnpm build                                                                        # para test/dist.test.ts
pnpm test                                                                         # lint + typecheck + coverage
```

`pnpm build` antes da suíte completa: `test/dist.test.ts` só roda com `dist/` gerado (`test/dist.test.ts:13-19`). Ele confirma que os entries do build expõem o novo formato.

Cobertura: `vitest.config.mjs` mede `src/**/*.ts`, então `src/utils/internal/problem.ts` entra no relatório. Os testes unitários cobrem os ramos de `title` e de `type`.

---

## 7. Riscos

| # | Risco | Impacto | Mitigação |
| --- | --- | --- | --- |
| R-1 | Clientes ou proxies que filtram por `application/json` deixam de tratar o erro como JSON. | Alto para quem filtra por tipo | Mudança intencional (P1). Testes de RF-01 nos dois modos. Documentar no changelog. |
| R-2 | Consumidores que leem `message` ou `statusText` do corpo. | Médio | Mantidos na raiz (D-03). Confirmar a decisão. |
| R-3 | `body` com chave `status`, `title`, `type`, `detail` ou `instance` deixa de ser vista no corpo. | Baixo | D-06. Documentar. |
| R-4 | Erro não tratado vaza texto no `detail` (PRD R3). | Alto (segurança) | `detail` vem de `toJSON().message`, que já mascara. RF-05 com teste de segredo e de stack. |
| R-5 | Duplicação de `set-cookie` com `onError` (PRD R6). | Médio | `kEventRes` continua limpo antes de `errorResponse` (`src/response.ts:172`). O teste `errors.test.ts:24-63` cobre o caminho com e sem `onError`. |
| R-6 | Tabela de frases desatualizada ou com erro de grafia. | Baixo | Frases do RFC 9110, teste unitário da tabela (6.3). Código fora da tabela não recebe `title`. |
| R-7 | Erros HTTP do JSON-RPC (405, 415, 403) mudam de content-type. | Médio | Decisão D-07, a confirmar. |
| R-8 | `type` e `instance` aceitam qualquer string, sem validação de URI. | Baixo | Sem validação, por não estar no PRD. Pode ser endurecido depois. |
| R-9 | `ErrorBody` ganha campos, e tipos derivados (`ErrorInput`, `toJSON`) mudam. | Baixo | `toJSON` com `Omit` explícito (5.1). `typecheck` cobre o resto. |
| R-10 | Contradição do pedido: "não quebrar" versus "substitui o formato" (PRD R2). | Escopo | Seguido P1 e P2. Confirmar antes de implementar. |
| R-11 | Custo extra por erro: um objeto a mais e uma chamada a `toJSON()`. | Desprezível | Caminho de erro, não é hot path. Sem benchmark previsto. |

---

## 8. Pontos a confirmar

1. D-03: manter `message` e `statusText` na raiz do corpo (recomendado) ou corpo limpo.
2. D-07: erros HTTP do JSON-RPC (405, 415, 403) saem como problem details (recomendado) ou ficam de fora.
3. P1 e P2 do PRD (leitura de "não quebrar" versus "formato padrão").
