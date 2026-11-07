# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-07).
Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `b0193a7`).

## 1. Visão geral

Toda resposta de erro do h3 passa por um único ponto: `errorResponse` (`src/response.ts:358`), chamado de `prepareResponse` (`src/response.ts:173`). Ele serializa `HTTPError.toJSON()` (`src/error.ts:226`) e fixa `jsonHeaders` (`src/response.ts:270`). A mudança fica concentrada nesses dois pontos, mais um helper interno de frase de status e a tipagem de `type`/`instance`. Nenhuma opção em `H3Config` (`src/types/h3.ts`) é criada.

## 2. Decisões de arquitetura

### D-01 — Ponto de mudança: `toJSON()` + `errorResponse`, sem novo serializador

- **Alternativas:** (a) novo módulo `problem.ts` com função `toProblemDetails(error)`; (b) alterar apenas `errorResponse`, montando o corpo ali; (c) alterar `HTTPError.toJSON()` e o header em `errorResponse`.
- **Escolha: (c).** `toJSON()` já é o contrato de serialização do erro (usado por `JSON.stringify` em `src/response.ts:366-373`) e já concentra a regra de ocultação de `unhandled`. Manter a regra ali evita duplicá-la. (a) cria nome/arquivo novo sem necessidade (restrição "nenhum outro nome público novo" e arquivos curtos); (b) espalha a regra de vazamento por dois arquivos.

### D-02 — Forma do corpo e precedência das chaves

Corpo, nesta ordem: `type`, `title`, `status`, `detail`, `instance` (só se informado), seguidos das extensões legadas `statusText`, `unhandled`, `message`, `data` e as chaves de `body`. Valores `undefined` são omitidos pelo `JSON.stringify`, como hoje.

- **Alternativas:** (a) manter `{...legado, ...body}` e acrescentar os padrão antes (body pode sobrescrever `type`/`status`); (b) `{...body, ...padrão}` (body nunca sobrescreve nada padrão ou legado); (c) padrão primeiro, legado depois, e `body` filtrado apenas dos cinco nomes padrão.
- **Escolha: (c).** O RF-04 exige que `body` não sobrescreva `type`, `title`, `status`, `detail`, `instance`, mas não proíbe sobrescrever `message`/`data`/`statusText`, que é o comportamento atual (`...(unhandled ? undefined : this.body)` por último, `src/error.ts:234`). (b) mudaria o comportamento legado de `body: { message }`; (a) viola o RF-04. Implementação: copiar `this.body` para um objeto e remover as cinco chaves antes do spread (loop sobre lista constante interna, sem alocar quando `body` é `undefined`).

### D-03 — Mapeamento dos membros

| Membro     | Valor                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| `type`     | `this.type ?? "about:blank"` (RFC 9457 §4.2.1)                          |
| `title`    | `this.statusText ?? getStatusPhrase(this.status)`                       |
| `status`   | `this.status`                                                           |
| `detail`   | `this.message` (`"HTTPError"` se `unhandled`, igual ao `message` atual) |
| `instance` | `this.instance` (omitido se ausente; omitido se `unhandled`)            |
| `message`  | igual a `detail` (compat, RF-04)                                        |

`detail` e `message` coexistem com o mesmo valor (premissa do PRD). Para `unhandled`, `detail` é o genérico `"HTTPError"` em vez de omitido: mantém a simetria com `message` e cumpre o RF-05 (alternativa "ausente" descartada por tornar o corpo menos autoexplicativo; ambas são permitidas pelo PRD).

### D-04 — Frase padrão do status (`title`) via helper interno

- **Alternativas:** (a) reutilizar `STATUS_TEXT` de `src/utils/response.ts:347`; (b) `http.STATUS_CODES` do Node; (c) novo helper interno com a tabela completa de frases da RFC 9110.
- **Escolha: (c)**, em `src/utils/internal/status-text.ts` (novo arquivo interno, não exportado em `src/index.ts`), função `getStatusPhrase(status: number): string` com fallback `"Error"` para códigos sem frase. (a) cobre só 204/3xx e seu comentário (`src/utils/response.ts:345-346`) diz de propósito que outros códigos não têm frase; ampliá-la mudaria `noContent`/`redirect` (`src/utils/response.ts:44,79`). (b) quebra a portabilidade (Workers/Deno/browser). O helper segue a convenção "internal helpers em `utils/internal/`" do AGENTS.md. Tamanho esperado < 100 linhas.

### D-05 — `type` e `instance` na instância, tipados como `string | undefined`

Em `ErrorBody` (`src/error.ts:30-69`) entram `type?: string` e `instance?: string` com JSDoc; como `ErrorInput` estende `Partial<ErrorBody>` (`src/error.ts:6`), o construtor passa a aceitá-los. Em `HTTPError` entram `readonly type: string | undefined` e `readonly instance: string | undefined` (junto dos campos em `src/error.ts:82-119`), atribuídos no construtor após `this.body` (`src/error.ts:209`).

- Leitura: só de `details` (`(details as ErrorBody)?.type`), **não** de `details.cause`, ao contrário de `statusText`/`headers` (`src/error.ts:180-185,202`). Motivo: `HTTPError` embrulha erros estrangeiros (`new HTTPError(val)` em `src/response.ts:148`), e libs como body-parser expõem `type` próprio (ex.: `"entity.too.large"`); ler da `cause` poria isso no corpo.
- Só aceita `typeof === "string"`; qualquer outro valor vira `undefined`.
- `error.type` **não** assume `"about:blank"` por padrão: o RF-03 pede os valores informados. O padrão é aplicado só na serialização (D-03).
- **Alternativa descartada:** default `"about:blank"` na propriedade — faria `error.type` nunca ser `undefined` e alteraria o `cause`/spread de `HTTPError.status()` (`src/error.ts:149`).
- `src/index.ts:72` já reexporta `ErrorBody`/`ErrorInput`/`HTTPError`; nada a mudar (nenhum nome novo).

### D-06 — Erros `unhandled` mascaram `type`/`instance`

Como o `unhandled` pode ser definido depois da construção (`src/response.ts:151`), a máscara fica no `toJSON()`: se `unhandled`, `type` = `"about:blank"`, `instance` omitido, `data`/`body` omitidos, `detail`/`message` = `"HTTPError"`. `title` e `status` permanecem (RF-05). `stack` continua só em debug, adicionado em `errorResponse` (`src/response.ts:369`), sem mudança.

- **Risco residual:** `title` usa `statusText`, que pode vir da `cause` (`src/error.ts:183-184`); comportamento já existente para `statusText`, mantido.

### D-07 — Content-Type: novo `problemHeaders` congelado

Em `src/response.ts`, junto de `jsonHeaders` (linha 270), novo `const problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })`. `errorResponse` troca `jsonHeaders` por `problemHeaders` em `src/response.ts:360-361`. `jsonHeaders` continua em uso nas linhas 312 e 318.

- **Alternativas:** (a) mutar `jsonHeaders`/parametrizar; (b) `headers.set("content-type", …)` após a mesclagem.
- **Escolha: constante separada** — preserva o `FrozenHeaders` (proteção contra mutação, `src/response.ts:260-264`) e a precedência atual: `mergeHeaders(problemHeaders, error.headers)` e depois `errHeaders` (`src/response.ts:362-364`) ainda sobrescrevem o `content-type` quando o erro/evento o define explicitamente (RF-06). (b) inverteria a precedência e violaria o RF-06.

### D-08 — Sem alterações em respostas fora de `HTTPError`

Não mudam: valores de retorno de handlers e respostas custom de `onError` (retornar `Response`/objeto continua sob controle do usuário e com `application/json` para objetos, `src/response.ts:309-313`), erros do protocolo JSON-RPC (`src/utils/json-rpc.ts:479-488`, formato próprio) e `h3/rules`. Efeito colateral aceito: `HTTPError`s lançados dentro do JSON-RPC HTTP (405/415/403, `src/utils/json-rpc.ts:168,176,235`) passam a sair como `problem+json`, pois o RF-07 vale para todo `HTTPError`.

### D-09 — Documentação

Atualizar `docs/1.guide/1.basics/6.error.md`: exemplo de resposta (linhas 37-49) para o novo corpo, lista de campos (53-60) com `type` e `instance`, nota de unhandled (90) e uma nota de migração de `content-type`. Não é código do projeto, mas evita docs desatualizadas.

## 3. Arquivos a alterar

| Arquivo                             | Linhas          | Mudança                                     |
| ----------------------------------- | --------------- | ------------------------------------------- |
| `src/error.ts`                      | 30-69           | `type?`, `instance?` em `ErrorBody`         |
| `src/error.ts`                      | 82-119          | campos `readonly type`, `readonly instance` |
| `src/error.ts`                      | 208-209         | atribuição validada no construtor           |
| `src/error.ts`                      | 226-236         | novo `toJSON()` (D-02, D-03, D-06)          |
| `src/error.ts`                      | 1               | import de `getStatusPhrase`                 |
| `src/utils/internal/status-text.ts` | novo            | tabela e `getStatusPhrase` (D-04)           |
| `src/response.ts`                   | 270-272         | `problemHeaders`                            |
| `src/response.ts`                   | 358-361         | usar `problemHeaders`                       |
| `docs/1.guide/1.basics/6.error.md`  | 37-60, 90       | documentação (D-09)                         |
| `test/errors.test.ts`               | 44, 140         | ajuste de `content-type` esperado           |
| `test/errors.test.ts`               | novo `describe` | casos RF-01…RF-07                           |

Sem mudança: `src/index.ts:72`, `src/types/h3.ts` (sem opção nova), `src/adapters.ts`, `src/utils/json-rpc.ts`, `src/rules/**`.

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorBody<DataT = unknown> {
  // ...campos atuais
  /** RFC 9457 `type`: URI reference identifying the problem type. Defaults to `about:blank` in the JSON body. */
  type?: string;
  /** RFC 9457 `instance`: URI reference identifying this occurrence. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;

  toJSON(): Omit<ErrorBody, "body"> & { title: string; detail?: string } & ErrorBody["body"];
}

// src/utils/internal/status-text.ts (interno, não exportado)
export function getStatusPhrase(status: number): string;
```

`toJSON()` precisa de anotação explícita (`isolatedDeclarations`); `title` e `detail` entram só no tipo de retorno, para não criar membros públicos novos em `ErrorBody`.

Exemplo de corpo (`new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não encontrado", data: { id: 1 } })`):

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "Usuário não encontrado",
  "statusText": "Not Found",
  "message": "Usuário não encontrado",
  "data": { "id": 1 }
}
```

Resposta: `content-type: application/problem+json;charset=UTF-8`, `statusText` da linha de status e `error.headers` preservados.

## 5. Estratégia de testes

Seguir o fluxo de bug/feature do AGENTS.md: escrever os testes novos primeiro, ver falharem, implementar, ver passarem, rodar a suíte inteira. Usar `describeMatrix` (web e node) em `test/errors.test.ts`.

**Testes novos (um por RF):**

- RF-01: `throw new HTTPError({ status: 400 })` → 400 e `content-type` começa com `application/problem+json`.
- RF-02: 404 com `statusText`/`message` → `type: "about:blank"`, `title`, `status`, `detail`; sem `statusText` → `title` vem da frase padrão (404 → "Not Found", 418 → "I'm a Teapot" conforme a tabela).
- RF-03: `type`/`instance` na instância (`error.type`, `error.instance`) e no corpo; `instance` ausente quando não informado; valor não-string ignorado.
- RF-04: `message`, `data`, `body` (`codigo`) no corpo; `body: { status: 1, type: "x", title: "x", detail: "x", instance: "x" }` não sobrescreve os padrão; `undefined` omitido.
- RF-05: `throw new Error("segredo interno")` → 500 `problem+json`, corpo sem "segredo interno" e sem `stack`; com `debug: true`, `stack` presente; `unhandled` com `type`/`instance` na entrada não os vaza; `cause` com `type` próprio não vaza.
- RF-06: `headers: { "x-trace": "1" }` + `statusText: "Teapot"` (418); erro com `content-type` próprio o substitui; `event.res.errHeaders` continua mesclado.
- RF-07: `new H3()` sem opção — 404 de rota inexistente (`src/h3.ts:187,223`), erro de validação de corpo (`src/utils/body.ts:70,101`) e `H3Config` sem propriedade nova (teste de tipo em `test/unit/types.test-d.ts`).
- Teste unitário de `getStatusPhrase` (códigos conhecidos e fallback) em `test/unit/`.

**Testes existentes a ajustar (sem perder o que verificam):**

- `test/errors.test.ts:44`: `toBe("application/json;charset=UTF-8")` → `toBe("application/problem+json;charset=UTF-8")`.
- `test/errors.test.ts:140`: `toMatch("application/json")` (não casa com `problem+json`) → `toMatch("application/problem+json")`.
- Os demais `toMatchObject` de corpo de erro (`test/errors.test.ts:53,79,99,119,144,257,309,350,384,420,442`) continuam válidos por D-02 (extensões legadas mantidas); não devem ser editados.
- `test/security.test.ts:556` e `test/router.test.ts:422` verificam respostas de sucesso: ficam como estão.
- Executar a suíte completa para achar outros dependentes de `content-type` de erro (candidatos: `test/json-rpc.test.ts`, `test/proxy.test.ts`, `test/validate.test.ts`, `test/handler.test.ts`); ajustar só a asserção de `content-type`.

**Verificação final:** `pnpm vitest run test/errors.test.ts`, depois `pnpm test` (lint + typecheck + cobertura); `pnpm build` para checar `isolatedDeclarations` nos `.d.mts`.

## 6. Riscos

| Risco                                                              | Impacto                                                                   | Mitigação                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Contradição do pedido ("substitui" × "não quebrar")                | Corpo ganha membros duplicados (`message`/`detail`, `statusText`/`title`) | Extensões legadas mantidas (D-02/D-03); confirmar com o solicitante                                     |
| Clientes que exigem `application/json` exato                       | Falha de parse/negociação no cliente                                      | Única quebra intencional; nota de migração na doc (D-09)                                                |
| Vazamento em `unhandled` via `detail`, `title`, `type`, `instance` | Segurança                                                                 | Máscara central no `toJSON()` (D-06); `type`/`instance` não lidos da `cause` (D-05); testes dedicados   |
| `body` do usuário com `type`/`title`/`status`…                     | Corpo inválido ou ambíguo                                                 | Filtro das 5 chaves padrão (D-02)                                                                       |
| `isolatedDeclarations` no tipo de retorno de `toJSON()`            | `pnpm typecheck`/`build` falham                                           | Anotação explícita; validar com `pnpm typecheck` e `pnpm build`                                         |
| Tabela de frases divergir de `statusText` de runtimes              | `title` ≠ linha de status em códigos raros                                | `title` prioriza `statusText` do erro; tabela só preenche a falta                                       |
| `HTTPError`s do JSON-RPC HTTP mudam de `content-type`              | Testes/clients JSON-RPC                                                   | Efeito aceito (D-08); rodar `test/json-rpc.test.ts`                                                     |
| Ordem das chaves no JSON muda                                      | Snapshots/comparações de string                                           | Nenhum teste existente usa snapshot de erro (verificado por grep); `toMatchObject` não depende de ordem |
| `HEAD`: corpo vazio mas `content-type` problem+json                | Nenhum (já era assim com JSON)                                            | `test/errors.test.ts:26-61` cobre HEAD; ajustar só o `content-type`                                     |
