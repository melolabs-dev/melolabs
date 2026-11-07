# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-07, premissas P1 a P7, riscos R1 a R6).

Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `15630ea`).

## Estado atual (resumo do que muda)

- Erros são renderizados em `errorResponse()` (`src/response.ts:358-380`), com `Content-Type` vindo de `jsonHeaders` (`src/response.ts:270-272`, valor `application/json;charset=UTF-8`) e corpo `JSON.stringify({ ...error.toJSON(), stack })` (`src/response.ts:366-373`).
- O corpo vem de `HTTPError.toJSON()` (`src/error.ts:226-236`): `{ status, statusText, unhandled, message, data, ...body }`, com `message` trocado por `"HTTPError"` quando `unhandled` (`src/error.ts:232`).
- `HTTPError` não conhece `type` nem `instance`. `ErrorBody` vai de `src/error.ts:30` a `src/error.ts:69`.
- A única função que produz resposta de erro é `prepareResponse` com o ramo `val instanceof Error` (`src/response.ts:146-174`). O 404 de rota não encontrada é um `HTTPError` criado em `src/response.ts:139-144`.
- `STATUS_TEXT` existe, mas é deliberadamente curto e não tem 500 (`src/utils/response.ts:347-354`).

## Decisões de arquitetura

### D-01 — Problem details substitui o formato atual para todo erro, sem opção

**Escolha:** `errorResponse()` passa a emitir sempre o corpo de problem details e `Content-Type: application/problem+json`. Não há flag, opção do `H3` nem variável de ambiente. Isso segue P1 e a frase "sem configuração" de `sdd/pedido.md`.

**Alternativas consideradas:**
- *Opção de configuração* (`problemDetails: true` no `H3`, ou flag global). Rejeitada: o pedido proíbe explicitamente, e o PRD lista como fora de escopo.
- *Negociação por `Accept`* (problem+json só se o cliente pedir). Rejeitada: o pedido quer o formato padrão, e clientes que mandam `*/*` continuariam recebendo o formato antigo, o que não é "padrão".

**Justificativa:** é a única leitura literal de "padrão sem configuração". A quebra para quem filtra por `application/json` é aceita e vai para as notas de release (R1, P6).

### D-02 — Corpo montado por função interna, sem mudar `HTTPError.toJSON()`

**Escolha:** uma função privada `toProblemBody(error)` em `src/response.ts`, usada só por `errorResponse()`. `HTTPError.toJSON()` continua com o mesmo conteúdo em runtime. Só o tipo de retorno deixa de anunciar `type` e `instance`.

**Alternativas consideradas:**
- *Incluir `type`, `title`, `detail` e `instance` dentro de `toJSON()`.* Rejeitada: muda o resultado público de `JSON.stringify(err)` para quem serializa erros fora do h3, e `toJSON()` é o contrato de corpo de erro usado em `src/utils/json-rpc.ts:479-490` (comentário em `src/utils/json-rpc.ts:483` depende dele).
- *Exportar `toProblemDetails`.* Rejeitada: o PRD proíbe novo nome público.

**Justificativa:** a mudança fica restrita à resposta HTTP, que é onde a RFC se aplica. Não há nome público novo.

### D-03 — Título padrão vem de uma tabela completa, nova e interna

**Escolha:** criar `src/utils/internal/status-text.ts` com `HTTP_STATUS_TEXT`, a tabela de frases de razão da RFC 9110 para os códigos 4xx e 5xx (e os demais códigos usados pelo h3). Fallback quando o código não estiver na tabela: `"Error"`. `title` é `error.statusText || HTTP_STATUS_TEXT[status] || "Error"`.

**Alternativas consideradas:**
- *Reusar `STATUS_TEXT` de `src/utils/response.ts:347-354`.* Rejeitada: a tabela é curta de propósito ("Any other status gets no phrase rather than one that belongs to a different code", comentário em `src/utils/response.ts:346`), não tem 500, e reusá-la mudaria as frases de `redirect` e `noContent` (`src/utils/response.ts:44` e `:79`) para códigos fora da lista.
- *Estender `STATUS_TEXT` com a tabela completa.* Rejeitada pelo mesmo motivo: mudaria `redirect(event, to, 300)`, que hoje não tem frase.
- *Fallback com o número do status.* Rejeitada: título deve ser texto curto, não código.

**Custo aceito:** duplicação parcial de frases (as seis de `src/utils/response.ts:348-353` aparecem também na nova tabela). Registrar como dívida: unificar quando houver decisão sobre o comportamento de `redirect`.

### D-04 — `type` e `instance` vêm só da entrada direta e somem em erros não tratados

**Escolha:** `HTTPError` lê `type` e `instance` de `details` (o objeto de entrada), e não de `details.cause`. Assim como `data` e `message`, os dois campos são omitidos do corpo quando `unhandled` é verdadeiro.

**Alternativas consideradas:**
- *Herdar de `cause`, como `statusText` faz em `src/error.ts:181-184`.* Rejeitada: `cause` pode ser qualquer `Error`, e muitos erros de biblioteca já trazem `type` (por exemplo, erros de parsing de body com `type: "entity.too.large"`). Herdar isso no `type` da resposta faria o h3 publicar um identificador de problema que o app não escolheu, e `instance` poderia vazar dado interno (R3, R5).
- *Expor `type` e `instance` também em erros não tratados.* Rejeitada: viola o espírito de RF-05 (erro não tratado é opaco).

**Justificativa:** o desenvolvedor controla explicitamente os dois campos, e o h3 só repassa o que foi informado (R5).

### D-05 — `message` fica como está; `detail` recebe o mesmo valor

**Escolha:** `detail = message`, e `message` continua no corpo com o mesmo valor (P2 e P3). Para 404 de rota, a mensagem continua sendo `Cannot find any route matching [METHOD] <url completa>`, porque `event.url` é um `URL` e a interpolação gera o href completo (`src/response.ts:142`).

**Conflito com o critério RF-07:** o PRD pede que `detail` cite `[GET] /inexistente`. O texto atual cita `[GET] http://localhost/inexistente`. O teste existente `test/router.test.ts:106-113` fixa a mensagem com URL completa.

**Alternativas consideradas:**
- *Trocar a mensagem para o pathname.* Rejeitada: muda o valor de `message`, que P2 manda preservar, e quebra `test/router.test.ts:111`.

**Escolha final para o critério:** o teste de RF-07 verifica que `detail` contém `[GET]` e `/inexistente` (sem exigir a sequência literal `[GET] /inexistente`). **Pendência:** o autor do pedido precisa confirmar essa leitura (ver "Pendências").

### D-06 — `onError` que devolve valor não-erro continua em JSON comum

**Escolha:** só respostas de erro geradas pelo h3 viram problem details. Se `onError` retornar um objeto que não é `Error`, ele é serializado como hoje, com `application/json`. Se retornar um `HTTPError`, passa pelo ramo de erro e vira problem details (`src/response.ts:159-166` chama `prepareResponse` de novo com `nested=true`, e o ramo `:146-174` renderiza).

**Alternativas consideradas:**
- *Forçar `application/problem+json` em qualquer valor devolvido por `onError`.* Rejeitada: sobrescreveria respostas que o próprio app montou, e o PRD só fala em erro.

### D-07 — Ordem do corpo e precedência

**Escolha:** o corpo final tem esta ordem de chaves: `type`, `title`, `status`, `detail`, `instance`, e depois o conteúdo de `error.toJSON()` (`statusText`, `unhandled`, `message`, `data`, `...body`), seguido de `stack` quando `debug` está ativo. O `...body` continua sendo espalhado por último, como hoje (`src/error.ts:234`), então um `body` do desenvolvedor pode sobrescrever `type` ou `title`. Isso preserva o comportamento atual de `body`.

**Atenção:** `toJSON()` não emite as chaves `type`, `title`, `detail` nem `instance`, então o espalhamento não apaga os padrões. Isso precisa ser verificado em teste (ver "Estratégia de testes").

### D-08 — Headers de erro

**Escolha:** `errorResponse()` monta `Headers` a partir de uma constante nova `problemHeaders` (`new FrozenHeaders({ "content-type": "application/problem+json" })`, declarada logo após `jsonHeaders` em `src/response.ts:270-272`). `error.headers` e `errHeaders` são mesclados como hoje. `jsonHeaders` continua sendo usado para valores JSON comuns.

**Justificativa:** `FrozenHeaders` impede mutação acidental da constante, como já acontece com `jsonHeaders`. O `Set-Cookie` continua sendo acrescentado (`mergeHeaders`, `src/response.ts:243-252`), e o caminho de `onError` não duplica porque `event[kEventRes]` é limpo antes da renderização (`src/response.ts:172-173`).

## Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/error.ts` | Adicionar `type?` e `instance?` a `ErrorBody` (`src/error.ts:30-69`); declarar `readonly type` e `readonly instance` em `HTTPError` (após `src/error.ts:119`); ler os dois campos no construtor, perto de `src/error.ts:205-209`, só de `details` direto; trocar o tipo de retorno de `toJSON()` (`src/error.ts:226`) para `Omit<ErrorBody, "body" | "type" | "instance"> & ErrorBody["body"]`. Corpo de `toJSON()` não muda. |
| `src/response.ts` | Criar `problemHeaders` após `src/response.ts:272`; trocar o corpo de `errorResponse()` (`src/response.ts:358-380`) para usar `toProblemBody()`; criar `toProblemBody()` no fim do arquivo, como helper interno (AGENTS: helpers no fim do arquivo). |
| `src/utils/internal/status-text.ts` | Arquivo novo com `HTTP_STATUS_TEXT`. |
| `src/index.ts:72` | Sem mudança. `ErrorBody` já é exportado; a nova propriedade é aditiva. |
| `test/errors.test.ts:44` | Trocar `"application/json;charset=UTF-8"` por `"application/problem+json"`. |
| `test/errors.test.ts:140` | Trocar `toMatch("application/json")` por `toMatch("application/problem+json")`. |
| `test/errors.test.ts:53-57`, `:79-85`, `:99-104`, `:119-121`, `:350` | Mantêm as verificações (`status`, `statusText`, `data`, `message`, `unhandled`). Nenhuma muda de valor. |
| `test/router.test.ts:106-113` | Sem mudança. A mensagem não muda (D-05), e o teste deve continuar passando. |
| `test/problem-details.test.ts` | Arquivo novo, cobre RF-01 a RF-07 com `describeMatrix` (ver testes). |
| `test/unit/error.test.ts` | Arquivo novo, cobre `HTTPError.type`, `HTTPError.instance` e `toJSON()` sem os campos novos. |

Nenhum arquivo de `src/_entries/`, `src/utils/internal/` existente, `src/utils/json-rpc.ts`, `src/utils/response.ts` nem `src/rules/` precisa mudar. `src/utils/response.ts:347-354` continua com o `STATUS_TEXT` atual (D-03).

## Contratos e assinaturas

```ts
// src/error.ts — ErrorBody ganha dois campos opcionais (aditivo)
export interface ErrorBody<DataT = unknown> {
  // ...campos existentes...

  /**
   * URI reference that identifies the problem type (RFC 9457 `type`).
   * Only used when set directly on the input. Ignored for unhandled errors.
   */
  type?: string;

  /**
   * URI reference that identifies this occurrence of the problem (RFC 9457 `instance`).
   * Only used when set directly on the input. Ignored for unhandled errors.
   */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;

  // construtor (sem mudança de assinatura):
  // this.type = (details as ErrorBody)?.type || undefined;
  // this.instance = (details as ErrorBody)?.instance || undefined;

  toJSON(): Omit<ErrorBody, "body" | "type" | "instance"> & ErrorBody["body"];
}
```

```ts
// src/utils/internal/status-text.ts (novo, interno, não exportado por index.ts)
export const HTTP_STATUS_TEXT: Readonly<Record<number, string>>;
```

```ts
// src/response.ts (privado)
const problemHeaders: Headers; // FrozenHeaders, content-type: application/problem+json

function toProblemBody(error: HTTPError): Record<string, unknown> {
  const json = error.toJSON();
  return {
    type: (!error.unhandled && error.type) || "about:blank",
    title: error.statusText || HTTP_STATUS_TEXT[error.status] || "Error",
    status: error.status,
    detail: json.message,
    instance: error.unhandled ? undefined : error.instance,
    ...json,
  };
}

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
// mesma assinatura; corpo = JSON.stringify({ ...toProblemBody(error), stack: ... })
// headers = mergeHeaders(problemHeaders, error.headers) ou new Headers(problemHeaders)
```

Notas de contrato:

- Não há nenhum export novo. `index.ts` fica igual.
- `detail` é sempre igual a `message` do `toJSON()`, inclusive `"HTTPError"` para erros não tratados.
- `title` nunca é vazio. Se `statusText` existir (já sanitizado por `sanitizeStatusMessage`), ele tem precedência sobre a tabela.
- Para erros não tratados, `type` é `about:blank` e `instance` não aparece, mesmo que a instância de origem tenha esses campos.

## Estratégia de testes

Seguir o fluxo de correção de bug do `AGENTS.md`, mesmo sendo feature: primeiro os testes de guarda (RF-05 e Set-Cookie), que já passam hoje, depois os testes novos, que devem falhar antes da implementação.

**Antes de qualquer código (devem passar hoje):**

1. RF-05: handler que lança `new Error("senha do banco vazada")` com `debug` desligado. Verificar que a string não aparece no corpo nem nos headers. Usar `t.errors = []` depois, porque `test/_setup.ts:127-155` falha o teste se sobrar erro não tratado.
2. RF-06 (`Set-Cookie`): `onError` retornando `HTTPError` com `instance`, e `HTTPError` com header `Set-Cookie`. Hoje já não duplica; o teste garante que continue assim.

**Testes novos em `test/problem-details.test.ts` (`describeMatrix`, web e node), que devem falhar antes da mudança:**

- RF-01: `HTTPError({ status: 403, statusText: "Forbidden" })` → status 403, `application/problem+json`, corpo com `status: 403`, `title: "Forbidden"`, `type: "about:blank"`.
- RF-02: `HTTPError({ status: 404, type, instance })` → `error.type` e `error.instance` (teste unitário em `test/unit/error.test.ts`) e corpo com ambos.
- RF-02 (negativo): `type` e `instance` herdados de `cause` não aparecem no corpo.
- RF-03: `HTTPError({ status: 500 })` → `type: "about:blank"`, `title: "Internal Server Error"`. Também um código fora da tabela (por exemplo, 599 ou 499) → `title` cai no fallback `"Error"`.
- RF-04: `HTTPError({ status: 400, message: "Campo inválido", data: { campo: "email" } })` → `detail`, `message` e `data` com os valores esperados.
- RF-05 (negativo): erro não tratado não expõe `type`, `instance`, `data` nem `stack` (sem debug), e `detail` e `message` valem `"HTTPError"`.
- RF-06: `onError` que retorna `HTTPError({ status: 422, instance: "/pedidos/7" })` → 422, `application/problem+json`, `instance` presente e exatamente um `Set-Cookie`.
- RF-07: rota inexistente → 404, `application/problem+json`, `detail` contém `[GET]` e `/inexistente` (D-05).
- D-07: `body` do desenvolvedor com campo novo (`body: { foo: 1 }`) aparece no corpo; `toJSON()` não produz `type` nem `title` sem o desenvolvedor pedir.
- D-06: `onError` que retorna objeto simples continua com `application/json;charset=UTF-8`.

**Ajustes em testes existentes (P7):**

- `test/errors.test.ts:44` e `:140` (Content-Type). Demais asserts desse arquivo mantêm valor e devem continuar passando.
- Rodar `test/router.test.ts` para confirmar que a mensagem 404 continua igual.

**Regressão e suíte completa:**

- `pnpm vitest run test/problem-details.test.ts test/errors.test.ts test/router.test.ts test/unit/error.test.ts`.
- `pnpm test` (lint, typecheck e cobertura). A checagem de `pnpm typecheck` precisa passar porque `ErrorBody` e `toJSON()` mudam de tipo.
- Se algum teste fora da lista checar `application/json` em erro, aparece na suíte completa. A busca feita para este documento encontrou só os dois casos de `test/errors.test.ts`. `test/security.test.ts:556` é resposta de sucesso e não muda.
- `test/dist.test.ts` depende do build. Rodar `pnpm build` antes dele, se o time usar esse teste no CI.

## Riscos

- **R1 — Quebra de clientes por `Content-Type` (alto).** Clientes que comparam `content-type === "application/json"` deixam de reconhecer o erro. Mitigação: manter todos os campos antigos no corpo (P2), e registrar a mudança nas notas de release (P6). Se o time quiser evitar isso, a decisão precisa ser tomada antes da implementação, como diz o PRD.
- **R2 — Tensão entre "padrão sem configuração" e "não quebrar" (médio).** Mitigado pela limitação da mudança ao `Content-Type` e aos campos novos (D-01, D-07).
- **R3 — Vazamento em erro não tratado (alto).** `title`, `detail` e `instance` são novos caminhos de saída. Mitigação: `type` e `instance` são omitidos para erros não tratados (D-04), `detail` vem de `toJSON().message` (que já mascara), e o teste de RF-05 roda antes da mudança.
- **R4 — `Set-Cookie` duplicado (médio).** O caminho de `onError` renderiza duas vezes. Mitigação: RF-06 coberto por teste, e o fluxo de `kEventRes` (`src/response.ts:172-173`) não muda.
- **R5 — `type` e `instance` com dados do usuário (baixo).** O h3 só repassa o que o desenvolvedor informar. A documentação deve dizer isso. O h3 não valida que `type` seja URI, e não deve validar (decisão de escopo).
- **R6 — Matriz de testes (baixo).** Todos os testes novos usam `describeMatrix`, então rodam em web e node.
- **R7 — Duplicação da tabela de frases (baixo).** Ver D-03. Dívida registrada.
- **R8 — Critério RF-07 não bate com a mensagem atual (médio).** Ver D-05. Depende de confirmação do autor do pedido.
- **R9 — `body` pode sobrescrever campos padrão (baixo).** Comportamento já existe para `status` e `statusText` hoje. O novo é `type` e `title`. Só ocorre com `body` escrito pelo desenvolvedor. Documentar.
- **R10 — `status` no corpo pode divergir do status HTTP (baixo, pré-existente).** Se `body.status` for usado, o corpo fica diferente do status real. Não é tratado aqui, porque mudar isso quebraria P2.

## Pendências

1. **Critério RF-07.** Confirmar se o teste pode checar `[GET]` e `/inexistente` em vez da sequência literal `[GET] /inexistente` (D-05). A alternativa seria mudar `message`, o que P2 proíbe.
2. **Notas de release** para a mudança de `Content-Type` (P6, R1). Texto não escrito aqui.
3. **Documentação** de `type`, `instance` e da precedência de `body` (R5, R9). `AGENTS.md` lista os campos de `HTTPError` no conteúdo de convenções. Atualizar se o time quiser (o próprio arquivo pede isso ao mudar arquitetura).
