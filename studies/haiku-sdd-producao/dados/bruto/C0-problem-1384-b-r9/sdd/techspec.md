# Techspec — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (issue h3js/h3#1384, variante #1384-B) e `sdd/prd.md`. Todas as citações `arquivo:linha` foram conferidas no código atual (commit `a38fe8e`).

## 1. Visão geral

Hoje há um único ponto de serialização de erro: `errorResponse` (`src/response.ts:358`), chamado de `prepareResponse` (`src/response.ts:173`) para todo `Error`, inclusive `kNotFound` (`src/response.ts:139-144`) e erros genéricos embrulhados como `unhandled` (`src/response.ts:148-155`). O corpo vem de `HTTPError#toJSON()` (`src/error.ts:226`) e o content-type de `jsonHeaders` (`src/response.ts:270`).

A mudança é cirúrgica: (1) `HTTPError` ganha `type` e `instance`; (2) `toJSON()` passa a emitir os membros RFC 9457 além dos campos legados; (3) `errorResponse` troca o content-type padrão para `application/problem+json`. Nenhuma API pública nova além de `type` e `instance`.

## 2. Decisões de arquitetura

### D-01 — Corpo é superconjunto: campos RFC 9457 + campos legados

**Contexto.** O pedido diz "substitui o formato atual" e "não quebrar o que já existe" (tensão registrada no PRD §4).

**Alternativas**
- A. Substituir o corpo pelo formato puro da RFC (remover `statusText`, `message`, `unhandled`).
- B. Superconjunto: manter os campos legados e acrescentar `type`, `title`, `detail` (e `instance`).
- C. Duplicar o formato atrás de uma flag.

**Escolha: B.** A quebra consumidores existentes e contradiz "não quebrar"; C é proibida pelo pedido (sem gatilho). B satisfaz RF-06 e o corpo continua válido pela RFC, que permite membros de extensão. O custo é redundância (`message`/`detail`, `statusText`/`title`), documentada.

### D-02 — Montagem do corpo em `HTTPError#toJSON()`

**Alternativas**
- A. Montar o problem details dentro de `errorResponse` e deixar `toJSON()` como está.
- B. Estender `toJSON()` e deixar `errorResponse` só com `JSON.stringify`.

**Escolha: B.** O PRD (RF-06) exige que `toJSON()` ganhe as chaves novas, e o comentário em `src/utils/json-rpc.ts:480-483` já trata `toJSON()` como a fonte da máscara de `unhandled`. Manter a lógica de mascaramento num só lugar evita divergência. `errorResponse` continua acrescentando `stack` só em debug (`src/response.ts:369`).

Ordem de composição (precedência crescente): campos legados → extensões de `body` → membros padrão. Assim as extensões não sobrescrevem `type`, `title`, `status`, `detail`, `instance` (RF-05). Os campos legados fora dessa lista (`message`, `statusText`, `unhandled`, `data`) continuam sobrescrevíveis por `body`, como hoje (`src/error.ts:234`), para não ampliar a quebra além do que o RF-05 pede.

### D-03 — Mapeamento dos membros

| Membro | Valor | Observação |
| --- | --- | --- |
| `type` | `this.type ?? "about:blank"` | `unhandled` ⇒ sempre `"about:blank"` (D-05) |
| `title` | `this.statusText ?? frase padrão do status` | omitido se não houver frase (RFC permite) |
| `status` | `this.status` | igual ao status da resposta |
| `detail` | mesmo valor de `message` | `unhandled` ⇒ `"HTTPError"`, como `message` (`src/error.ts:232`) |
| `instance` | `this.instance` | omitido se ausente ou `unhandled` |

`detail` reaproveita o valor já mascarado de `message` em vez de ser omitido nos `unhandled`: é a opção "genérica" aceita no RF-07, mantém consistência e evita ramificação extra.

### D-04 — `title` sem `statusText`: tabela interna mínima

**Alternativas**
- A. Omitir `title` quando não há `statusText`.
- B. Tabela interna com as frases padrão (RFC 9110) dos erros 4xx/5xx.
- C. Reusar `STATUS_TEXT` de `src/utils/response.ts:347`.

**Escolha: B.** O RF-02 exige a frase padrão. C não serve: aquela tabela cobre só 204/30x e o comentário em `src/utils/response.ts:345-346` diz de propósito que outros status ficam sem frase; ampliá-la mudaria `noContent`/`redirect` (`src/utils/response.ts:44,79`). A tabela nova fica em `src/utils/internal/status-text.ts` (interna, sem export público, sem entrar em `src/index.ts`), com 4xx e 5xx registrados; status fora da tabela (ex.: 2xx/3xx lançados como erro) ⇒ `title` omitido (A como fallback). Custo: ~50 linhas, dentro da regra de arquivo curto.

### D-05 — `type` e `instance` nunca vêm de erro não tratado nem de `cause`

**Risco real.** `prepareResponse` faz `new HTTPError(val)` para qualquer `Error` (`src/response.ts:148`), e o construtor lê campos de `details`. Erros de bibliotecas costumam ter `type` (ex.: `body-parser` usa `type: "entity.too.large"`) e `instance`. Se o construtor copiasse isso, o `unhandled` vazaria informação que hoje fica oculta (RF-07).

**Escolha.** (a) O construtor lê `type`/`instance` só de `details`, nunca de `details.cause` (diferente de `status`/`headers`, `src/error.ts:172-206`), e só aceita `typeof === "string"`; (b) `toJSON()` mascara os dois quando `unhandled` — o flag é atribuído depois da construção (`src/response.ts:150-151`), então a máscara tem de estar no `toJSON()`, não no construtor. Alternativa descartada: não ler `type`/`instance` de `Error` genérico no construtor — exigiria distinguir `Error` de `ErrorInput` em runtime, frágil.

### D-06 — Content-type `application/problem+json` sem `charset`

**Alternativas.** (A) `application/problem+json`; (B) `application/problem+json;charset=UTF-8`, simétrico a `jsonHeaders`.

**Escolha: A.** A RFC 9457 §6.1 registra o tipo sem parâmetros e JSON é sempre UTF-8; o PRD aceita as duas formas. Define-se `problemHeaders` (`FrozenHeaders`) ao lado de `jsonHeaders` em `src/response.ts:270` e `errorResponse` passa a usá-lo nas linhas 360-361. Não se exporta nada. Headers do usuário (`error.headers`) e `errHeaders` continuam aplicados depois via `mergeHeaders`, logo mantêm precedência, inclusive sobre o content-type (RF-08).

### D-07 — Não negociar conteúdo nem tocar caminhos fora do `HTTPError`

Fora de escopo (PRD §3): sem `Accept`, sem XML. Respostas de `onError` customizado que não sejam `HTTPError` seguem inalteradas, porque `errorResponse` só roda quando não há `onError` ou quando ele devolve o erro de volta (`src/response.ts:161-173`). JSON-RPC (`src/utils/json-rpc.ts:484-498`) monta o próprio envelope e não passa por `errorResponse`; não muda.

## 3. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/error.ts` | 30-69 (`ErrorBody`) | adicionar `type?: string` e `instance?: string` com JSDoc; `ErrorInput` (`:6`) herda via `Partial<ErrorBody>` |
| `src/error.ts` | 74-119 (campos de `HTTPError`) | `readonly type: string \| undefined`, `readonly instance: string \| undefined` (a classe `implements ErrorBody`, `:74`) |
| `src/error.ts` | 162-210 (construtor) | atribuir `type`/`instance` a partir de `details` (string apenas), junto a `data`/`body` (`:208-209`); cobre `new HTTPError(msg, details)` e `(details)` |
| `src/error.ts` | 144-150 (`HTTPError.status`) | sem mudança de código: já faz spread de `details` (`:149`), logo `type`/`instance` passam; só adicionar teste |
| `src/error.ts` | 226-236 (`toJSON`) | novo corpo conforme D-02/D-03/D-05 e novo tipo de retorno |
| `src/response.ts` | 270-272 | acrescentar `problemHeaders` |
| `src/response.ts` | 358-361 | `errorResponse` usa `problemHeaders` no lugar de `jsonHeaders` |
| `src/utils/internal/status-text.ts` | novo | tabela interna e helper `getStatusPhrase(status)` (D-04) |
| `docs/1.guide/1.basics/6.error.md` | 37-49, 51-60, 90 | novo exemplo de resposta, campos `type`/`instance`, nota sobre content-type e sobre os campos ocultos em `unhandled` |
| `test/errors.test.ts` | 44, 140 | ajustar content-type (ver §6) |

Sem mudança: `src/index.ts:72` (já exporta `ErrorBody`/`ErrorInput`/`HTTPError`), `src/_deprecated.ts:22-32` (`createError`/`H3Error` repassam ao construtor), `test/unit/package.test.ts:4-13` (snapshot de exports não muda, pois não há export novo).

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorBody<DataT = unknown> {
  status: number;
  statusText?: string;
  message: string;
  unhandled?: boolean;
  data?: DataT;
  body?: Record<string, unknown>;
  /** RFC 9457 `type`: URI de referência do tipo de problema. */
  type?: string;
  /** RFC 9457 `instance`: URI de referência da ocorrência. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  // construtores e HTTPError.status(...) inalterados
  toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"] & { title?: string; detail: string };
}
```

`isolatedDeclarations` exige o tipo de retorno explícito; o literal `{ title?: string; detail: string }` evita criar nome público novo. Como `ErrorBody["body"]` é `Record<string, unknown>`, o `&` já admite extensões.

Corpo de `toJSON()` (esboço):

```ts
const unhandled = this.unhandled;
return {
  status: this.status,
  statusText: this.statusText,
  unhandled,
  message: unhandled ? "HTTPError" : this.message,
  data: unhandled ? undefined : this.data,
  ...(unhandled ? undefined : this.body),
  // membros padrão por último: extensões não os sobrescrevem
  type: (!unhandled && this.type) || "about:blank",
  title: this.statusText || getStatusPhrase(this.status),
  status: this.status,
  detail: unhandled ? "HTTPError" : this.message,
  instance: unhandled ? undefined : this.instance,
};
```

(`status` duplicado é só no esboço; na implementação ele sai da primeira parte e fica só na parte final, preservando a posição de chave por inserção.) `JSON.stringify` descarta `undefined`, então `instance`, `title` sem frase e `data` ausente somem do corpo (RF-04).

Exemplo de saída (`status: 404, statusText: "Not Found", message: "Usuário 42 não existe"`):

```json
{"status":404,"statusText":"Not Found","message":"Usuário 42 não existe","type":"about:blank","title":"Not Found","detail":"Usuário 42 não existe"}
```

```ts
// src/utils/internal/status-text.ts
export function getStatusPhrase(status: number): string | undefined;
```

## 5. Compatibilidade

- Corpo: nenhuma chave existente some; `status` de extensão deixa de vencer o status real (mudança pedida no RF-05).
- Content-type de erro muda de `application/json;charset=UTF-8` para `application/problem+json`: quebra clientes que comparam igualdade exata. Inerente ao pedido; documentar em `docs/` (§3).
- Chaves de `body` chamadas `type`, `title`, `detail`, `instance` passam a ser ignoradas (padrão prevalece).
- `error.type` novo numa classe que estende `Error`: não colide com `name`, `message`, `cause`, `stack`.

## 6. Estratégia de testes

**Existentes a ajustar (só o que depende da mudança)**
- `test/errors.test.ts:44`: `toBe("application/json;charset=UTF-8")` ⇒ `toBe("application/problem+json")`; mantém a verificação de que o content-type de erro é o do erro (e não o de sucesso).
- `test/errors.test.ts:140`: `toMatch("application/json")` ⇒ `toMatch("application/problem+json")`.
- Os demais testes de erro usam `toMatchObject` (`test/errors.test.ts:53,79,99,119,144`, `test/handler.test.ts:220,236`, `test/router.test.ts:108`) e continuam passando porque o corpo é superconjunto. `test/security.test.ts:556` e `test/router.test.ts:422` checam respostas de sucesso: sem mudança. Validar com `pnpm test` se algum `toEqual` de corpo de erro escapou (a busca por `toEqual` com `status`/`message` achou só `test/rules/rules.test.ts:1308`, que não é erro).

**Novos** (em `test/errors.test.ts` ou `test/problem-details.test.ts`, com `describeMatrix`, web e node), um por requisito:
- RF-01: `HTTPError({status:400})` ⇒ status 400 e content-type problem+json; erro não tratado (`throw new Error`) e `kNotFound` também.
- RF-02: exemplo do PRD (404 com `statusText` e `message`) ⇒ `type: "about:blank"`, `title`, `status`, `detail`; sem `statusText` ⇒ `title` é a frase padrão (ex.: 409 ⇒ "Conflict"); status sem frase ⇒ sem `title`.
- RF-03: `error.type`/`error.instance` via `new HTTPError(details)`, `new HTTPError(msg, details)` e `HTTPError.status(...)`; ausentes ⇒ `undefined`; valor não string ignorado.
- RF-04: `type`/`instance` aparecem no corpo; sem `instance` a chave não existe.
- RF-05: `body: { code, status: 999, type: "x", title: "y" }` + `data` ⇒ `code` e `data` presentes, `status` real, `type`/`title` padrão.
- RF-06: corpo traz `statusText`, `message`, `status` além de `type`/`title`/`detail`; teste unitário de `toJSON()` com `toEqual` das chaves.
- RF-07: `throw new Error("segredo interno")`, `debug` desligado ⇒ 500, problem+json, sem "segredo interno" nem `stack`; erro com `type: "entity.too.large"` e `instance` próprios (simulando lib) ⇒ `type` fica `about:blank` e sem `instance`; `HTTPError` com `unhandled: true`, `data`, `body` ⇒ nada exposto; `debug` ligado ⇒ `stack` presente.
- RF-08: `headers: {"x-custom":"1"}` preservado, `statusText` na linha de status, HEAD com corpo vazio e content-type problem+json, header do usuário `content-type` ainda vence, `errHeaders` ainda aplicados; 204/304 sem corpo.
- Tipos: em `test/unit/types.test-d.ts`, `expectTypeOf<HTTPError["type"]>().toEqualTypeOf<string | undefined>()`, idem `instance`, e `ErrorInput`/`ErrorBody` aceitando os campos como `string` opcional, rejeitando `number`.

**Comandos:** `pnpm vitest run test/errors.test.ts`, depois `pnpm test` (lint + typecheck + cobertura). Seguir o fluxo do AGENTS.md: escrever os testes novos primeiro e confirmar que falham antes de alterar `src/`.

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Clientes que exigem `application/json` exato | Quebra de parsing de erro | Documentar; headers de erro do usuário seguem podendo sobrescrever |
| Vazamento de `type`/`instance` via `unhandled` ou `cause` | Divulgação de detalhes internos | D-05: leitura só de `details`, só strings, máscara em `toJSON()`; teste dedicado |
| Extensões em `body` colidindo com membros padrão | Mudança sutil para quem usava `type`/`title`/`detail` em `body` | Padrão vence (RF-05); registrar na documentação |
| Corpo redundante (`message`/`detail`, `statusText`/`title`) | Payload maior | Aceito por compatibilidade (D-01); remoção exigiria confirmação do solicitante |
| Tabela de frases cresce o bundle | Pouco código no core minimalista | Só 4xx/5xx, arquivo interno, sem export; avaliar tamanho no `pnpm build` |
| `toJSON()` usado fora do h3 (consumidores que comparam chaves) | Chaves novas | Só acrescenta chaves (RF-06) |
| `status` de extensão antes sobrescrevia o do corpo | Comportamento anterior alterado de propósito | Coberto por teste de RF-05 |
| Ordem das chaves no JSON muda | Snapshots de terceiros | Legados mantêm a ordem; novas vão ao fim |

## 8. Fora de escopo

Flag/opção de ativação, `Accept`/XML, publicação de URIs de `type`, mudanças no nitro, alterações em handlers `onError` do usuário, validação de que `type`/`instance` são URIs.
