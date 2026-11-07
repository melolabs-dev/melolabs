# Especificação técnica — Respostas de erro em problem details (RFC 9457)

Referências: `sdd/pedido.md` (contrato #1384-B), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1384.

## 1. Situação atual

- O corpo de erro é produzido por `errorResponse` (`src/response.ts:358-380`), que serializa `HTTPError.toJSON()` (`src/error.ts:226-236`) acrescido de `stack` em modo debug.
- O `Content-Type` de erro é `application/json;charset=UTF-8`, herdado do singleton `jsonHeaders` (`src/response.ts:270-272`).
- `errorResponse` é chamado a partir de um único ponto: o ramo de `Error` de `prepareResponse` (`src/response.ts:146-174`, chamada em `src/response.ts:173`). Erros lançados, retornados, `kNotFound` (`src/response.ts:139-144`) e erros não tratados (`toError`, `src/response.ts:73-83`) passam todos por ali. Assim, mudar só esse caminho cobre RF-01.
- Erros não tratados chegam como `HTTPError` com `unhandled: true` (`src/response.ts:80`, `src/response.ts:150-151`, `src/adapters.ts:122`, `src/adapters.ts:143-152`, `src/utils/middleware.ts:47-51`). `toJSON()` mascara `message` (vira `"HTTPError"`), `data` e o `body` extra (`src/error.ts:231-234`).
- Não existe tabela de reason phrases em `src/`. `statusText` é opcional (`src/error.ts:92`), e a resposta fica sem título quando não é informado.

## 2. Decisões de arquitetura

### D-01 — Corpo RFC 9457 com os membros atuais mantidos como extensão

**Escolha:** o corpo passa a conter `type`, `title`, `status`, `detail` e `instance` (membros padrão da RFC), e continua contendo `message`, `statusText`, `unhandled`, `data`, `stack` (quando debug) e os membros de `body`, como membros de extensão.

**Alternativas consideradas:**
- (A) Corpo estritamente RFC: remover `message`, `statusText` e `unhandled`. Fica mais limpo, mas quebra todo cliente que lê `message` ou `statusText` (há vários asserts desses campos na suíte, p.ex. `test/handler.test.ts:220-238`, `test/app.test.ts:205`, `test/body.test.ts:457`), e contraria "não quebrar o que já existe" do pedido.
- (B) Estrito + extensões legadas (escolhida).

**Justificativa:** a RFC permite membros de extensão, e `detail`/`title` substituem `message`/`statusText` sem perda de informação. Com (B), a única quebra inevitável é o `Content-Type` (D-04), que RF-02 exige. A suíte de corpo de erro continua válida. **Ponto a confirmar pelos mantenedores:** é a decisão marcada como risco principal no PRD.

### D-02 — `toJSON()` inalterado; formatação do problema em módulo interno

**Escolha:** `HTTPError.toJSON()` mantém o formato atual. A montagem do corpo fica em `src/utils/internal/problem.ts`, função `toProblemDetails(error, debug)`, chamada por `errorResponse`.

**Alternativas consideradas:**
- Reescrever `toJSON()` para o formato RFC: muda `JSON.stringify(httpError)` para quem serializa erros fora do h3 (logs, por exemplo), e exigiria tratar o `stack` dentro de `toJSON`, que não conhece `debug`.
- Criar método público `toProblem()`: viola "nenhum outro nome público novo" (`sdd/pedido.md`, Restrições).

**Justificativa:** mudança restrita ao caminho de resposta, sem superfície pública nova, e `response.ts` continua abaixo de 200 linhas. Observação: `response.ts` já tem 380 linhas, então o arquivo interno também evita aumentá-lo.

### D-03 — Precedência: membros do h3 vencem `body`

**Escolha:** o `body` do erro é espalhado primeiro, e os membros padrão e de extensão do h3 são escritos depois, então prevalecem em caso de chave repetida.

**Alternativas consideradas:**
- Manter a ordem atual de `toJSON()` (`src/error.ts:228-235`), em que `...this.body` vence por último e pode sobrescrever `status`, `message`, `data` etc.

**Justificativa:** `status` no corpo precisa coincidir com o status HTTP, e um `type` ou `status` forjado a partir de dados do `body` produziria um problem detail inválido. É uma mudança de comportamento para quem usa `body` com chaves reservadas, e deve constar na descrição da mudança.

### D-04 — `Content-Type: application/problem+json;charset=UTF-8`

**Escolha:** novo singleton `problemHeaders` (`FrozenHeaders`), ao lado de `jsonHeaders`, com `content-type: application/problem+json;charset=UTF-8`. `errorResponse` troca `jsonHeaders` por `problemHeaders` nas duas linhas que o usam.

**Alternativas consideradas:**
- Sem `charset`: a RFC não exige o parâmetro (JSON é UTF-8 por definição). Mas RF-02 pede que o charset siga o padrão atual do h3, que o inclui.

**Justificativa:** consistência com o resto do h3 e com RF-02. Sucesso continua com `jsonHeaders` (RF-09).

### D-05 — `type` e `instance` em `HTTPError`

**Escolha:** `type?: string` e `instance?: string` entram em `ErrorBody` (`src/error.ts:30`), e a classe ganha `readonly type` e `readonly instance` (`src/error.ts:82-119`). O construtor lê os dois valores de `details` e, na falta, de `details.cause`, como já ocorre com `headers` e `unhandled` (`src/error.ts:202-206`).

**Alternativas consideradas:**
- Adicionar só em `ErrorInput`: `HTTPError` declara `implements ErrorBody` (`src/error.ts:74`), então a classe ficaria sem os campos na tipagem de `ErrorBody`.

**Justificativa:** `ErrorInput` herda `Partial<ErrorBody>` (`src/error.ts:6`), então a entrada aceita os campos automaticamente. Herança de `cause` segue o padrão existente.

### D-06 — `detail` só com mensagem informada explicitamente

**Problema encontrado:** RF-05 pede que `new HTTPError({ status: 422, statusText: "Unprocessable Content" })` não gere `detail`. Hoje o construtor sempre preenche `message`: primeiro com `statusText` (`src/error.ts:191`), e, sem nada, com `"HTTPError 422 Unprocessable Content"` (`src/error.ts:193`). Ler `error.message` sempre produziria `detail`.

**Escolha:** o construtor grava uma flag interna não enumerável (convenção `~` do projeto, `AGENTS.md`), por exemplo `~hasMessage`, true quando `messageInput`, `details.message` ou `cause.message` foi informado. `toProblemDetails` usa `detail` somente quando essa flag é true.

**Alternativas consideradas:**
- Comparar `message` com `statusText` ou com o texto gerado: frágil, e erra quando o usuário passa a mesma string como mensagem.
- Sempre enviar `detail` com `message`: contraria RF-05 e duplica `title`.

**Justificativa:** é a única forma de cumprir RF-05 sem alterar o `message` que já existe. **Ponto a confirmar:** o PRD não percebe esse detalhe do construtor.

### D-07 — `title` com tabela interna de reason phrases

**Escolha:** `title = error.statusText || defaultStatusText(error.status)`. `defaultStatusText` vem de `src/utils/internal/status-text.ts`, uma tabela `Record<number, string>` com os códigos IANA registrados (100 a 511). Código fora da tabela cai em `"Error"`.

**Alternativas consideradas:**
- Usar `node:http.STATUS_CODES`: quebra o requisito de runtime web (AGENTS: "prefer web standard APIs").
- Deixar `title` ausente sem `statusText`: contraria RF-01 (`title` preenchido para 404 sem texto).
- Usar `"HTTPError"` como título: não é o texto do status.

**Justificativa:** tabela de dados sem dependências, interna, sem nome público. Custo estimado: cerca de 60 linhas.

### D-08 — Erros não tratados

**Escolha:** para `unhandled: true`, `detail`, `data` e os membros de `body` são omitidos. `message` continua `"HTTPError"` (teste em `test/errors.test.ts:350`). `title` usa a frase padrão do status (500 → "Internal Server Error"), pois `toError` não define `statusText`.

**Justificativa:** mantém a máscara de vazamento que já existe (`src/error.ts:117`, `src/error.ts:231-234`) e cumpre RF-01 e RF-04.

### D-09 — `stack` continua só em debug

**Escolha:** `stack` é um array de linhas trimadas quando `debug && error.stack` (mesma expressão de `src/response.ts:369`). Sem debug, a chave não existe (`JSON.stringify` descarta `undefined`).

**Justificativa:** RF-07 e a mesma proteção de hoje.

### D-10 — Documentação

**Escolha:** atualizar o exemplo de JSON em `docs/1.guide/1.basics/6.error.md:39-50` e a lista de campos (`docs/1.guide/1.basics/6.error.md:52-60`) com o novo formato e os campos `type`/`instance`.

**Justificativa:** o exemplo passa a estar incorreto sem essa mudança. Não está no PRD, mas é consequência direta; pode ser removido do escopo se os mantenedores preferirem.

## 3. Arquivos a alterar

| Arquivo | Alteração | Referência atual |
|---|---|---|
| `src/error.ts` | `type`/`instance` em `ErrorBody` e na classe; flag `~hasMessage`; herança de `cause` | `src/error.ts:30`, `src/error.ts:82`, `src/error.ts:162-210`, `src/error.ts:226-236` (mantido) |
| `src/response.ts` | `problemHeaders`; `errorResponse` usa `toProblemDetails` e `problemHeaders` | `src/response.ts:270-272`, `src/response.ts:358-380` |
| `src/utils/internal/problem.ts` (novo) | `toProblemDetails`, `ProblemDetails` (interno) | — |
| `src/utils/internal/status-text.ts` (novo) | `defaultStatusText` e tabela | — |
| `test/problem-details.test.ts` (novo) | cenários RF-01 a RF-09 com `describeMatrix` | padrão em `test/errors.test.ts:6` |
| `test/errors.test.ts` | ajustar só o `content-type` esperado | `test/errors.test.ts:44`, `test/errors.test.ts:140` |
| `docs/1.guide/1.basics/6.error.md` | exemplo e campos (D-10) | `docs/1.guide/1.basics/6.error.md:39-60` |

Não alterar: `src/adapters.ts`, `src/utils/middleware.ts`, `src/utils/internal/validate.ts` (constroem `HTTPError` e seguem válidos), `src/utils/json-rpc.ts` (protocolo próprio), `src/utils/sanitize.ts`, `src/_deprecated.ts`, `src/rules/*` (fora do escopo, PRD).

## 4. Contratos e assinaturas

```ts
// src/error.ts — ErrorBody ganha dois campos opcionais (ErrorInput herda via Partial)
export interface ErrorBody<DataT = unknown> {
  // ...campos existentes...
  /** RFC 9457 `type`. Sem valor, o corpo usa `about:blank`. */
  type?: string;
  /** RFC 9457 `instance`: referência à ocorrência do erro. */
  instance?: string;
}

// src/error.ts — HTTPError
export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  // interno, não enumerável, definido no construtor (D-06)
  declare "~hasMessage": boolean;
  // toJSON(): inalterado (D-02)
}
```

```ts
// src/utils/internal/problem.ts
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

/** Monta o corpo RFC 9457 de um erro do h3. Membros do h3 vencem `body` (D-03). */
export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails;
```

Esboço do corpo (ordem de precedência = ordem de escrita):

```ts
const unhandled = error.unhandled;
return {
  ...(unhandled ? undefined : error.body),           // extensão do usuário, perde para o h3
  type: error.type ?? "about:blank",                 // RF-04
  title: error.statusText || defaultStatusText(error.status), // RF-05, D-07
  status: error.status,
  detail: unhandled || !error["~hasMessage"] ? undefined : error.message, // RF-05, D-06, D-08
  instance: error.instance,                          // RF-03
  message: unhandled ? "HTTPError" : error.message,  // legado (D-01)
  statusText: error.statusText,                      // legado (D-01)
  unhandled,                                         // legado (D-01)
  data: unhandled ? undefined : error.data,          // RF-06
  stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined, // RF-07
};
```

```ts
// src/utils/internal/status-text.ts
export function defaultStatusText(status: number): string; // "Error" para código fora da tabela
```

```ts
// src/response.ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json;charset=UTF-8",
});

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response; // assinatura inalterada
```

Nota de tipagem: o projeto usa `isolatedDeclarations`, então toda função exportada precisa de tipo de retorno explícito. `declare` evita emitir o campo `~hasMessage` como propriedade de classe.

## 5. Fluxo

1. Handler lança ou retorna `HTTPError` (ou ocorre `kNotFound`/erro não tratado).
2. `prepareResponse` chama `errorResponse` (`src/response.ts:173`), sem mudança na lógica de `onError`, `errHeaders` ou `set-cookie`.
3. `errorResponse` monta headers a partir de `problemHeaders` mais `error.headers` e `errHeaders` (mesma ordem de hoje).
4. `toProblemDetails` produz o corpo; `JSON.stringify` com indentação só em debug (`src/response.ts:372`).
5. HEAD continua sem corpo (`nullBody`, `src/response.ts:350-356`), inalterado.

## 6. Estratégia de testes

Seguir o AGENTS (ciclo de bug fix não se aplica diretamente; é feature, mas o teste vem antes da implementação para confirmar a falha).

**Novo `test/problem-details.test.ts`**, com `describeMatrix` (web e node):

- RF-01: `throw new HTTPError({ status: 404, message: "Usuário não encontrado" })` → corpo tem `status: 404`, `title` não vazio, `detail` igual à mensagem, `type: "about:blank"`.
- RF-01 (cobertura de origem): erro retornado (`return new HTTPError`), `kNotFound` (rota inexistente) e erro não tratado (`unhandled`, `detail` ausente, `message: "HTTPError"`).
- RF-02: `content-type` exato `application/problem+json;charset=UTF-8` nos quatro cenários acima, e `application/json` continua para sucesso.
- RF-03: `new HTTPError({ status: 403, type, instance })` → propriedades e corpo; herança via `cause`.
- RF-04: sem `type` → `about:blank`.
- RF-05: `{ status: 422, statusText: "Unprocessable Content" }` sem mensagem → `title` igual ao statusText e sem `detail`; `HTTPError.status(404)` → `title: "Not Found"`; código fora da tabela → `"Error"`.
- RF-06: `data: { campo: "email" }` presente; `body: { x: 1 }` presente; `body` com `status`/`type` forjados não altera os membros do h3 (D-03).
- RF-07: `new H3({ debug: false })` sem `stack`; com `debug: true`, `stack` é array de strings. Usar app próprio, pois `_setup` ativa debug (`test/_setup.ts:136`).
- RF-08: `headers: { "retry-after": "30" }` aparece na resposta; `errHeaders` continua mesclado.
- RF-09: handler retornando `{ ok: true }` → `application/json;charset=UTF-8` e corpo `{"ok":true}`.
- D-06: mensagem explícita igual ao statusText (`new HTTPError({ status: 400, message: "Bad Request", statusText: "Bad Request" })`) ainda gera `detail`.

**Ajustes em testes existentes** (lista exigida por RF-10 para a descrição da mudança):

- `test/errors.test.ts:44`: `application/json;charset=UTF-8` → `application/problem+json;charset=UTF-8`. Motivo: RF-02.
- `test/errors.test.ts:140`: `toMatch("application/json")` → `toMatch("application/problem+json")`. Motivo: RF-02. O match por substring não casa `problem+json` com `json`, então o ajuste é necessário.

Nenhum outro teste existente deve precisar de ajuste pelas decisões D-01 a D-03: os campos `message`, `statusText`, `data`, `stack` e `unhandled` permanecem. Validar com a suíte completa (`pnpm test`), principalmente:
- `test/handler.test.ts:220-330` (validação, `statusText` e `message` no corpo);
- `test/body.test.ts:450-457` (`stack[0]` em debug);
- `test/app.test.ts:198-205`;
- `test/errors.test.ts:350`, `:384`, `:420` (`unhandled`/`message`).

Verificação final: `pnpm lint` e `pnpm typecheck` (`package.json` scripts).

Ordem sugerida: (1) escrever os testes novos e confirmar que falham; (2) ajustar os dois testes existentes; (3) implementar `error.ts`, `status-text.ts`, `problem.ts`, `response.ts`; (4) rodar `pnpm vitest run test/problem-details.test.ts test/errors.test.ts` e depois a suíte completa.

## 7. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Clientes que checam `application/json` em erros deixam de reconhecer a resposta pelo header | Quebra real para esses clientes | Inevitável pela RF-02; registrar como mudança incompatível (PRD, "Versão") |
| `body` perde precedência (D-03) | Quem usa `body: { status }` ou `{ type }` vê o valor do h3 | Registrar na descrição da mudança; caso raro |
| Vazamento de detalhes internos | `detail` com mensagem de erro não tratado | D-08 omite `detail`/`data`/`body` em `unhandled`; teste explícito |
| `~hasMessage` depende do construtor | Erro construído por outro caminho (ex.: `Object.create`) sem a flag | Ausente = `detail` omitido, falha segura; teste de `HTTPError.status` |
| Tabela de reason phrases desatualizada | `title` genérico para códigos novos | Fallback `"Error"`; a tabela segue o registro IANA |
| `HTTPError` com status < 400 (ex.: 200 lançado) recebe `application/problem+json` | Comportamento estranho, mas já era erro (ramo de `Error`) | Documentar; não mudar nesta entrega |
| Duplicação `message`/`detail`, `statusText`/`title` | Corpo maior | Aceito por D-01; remover em major futura se os mantenedores quiserem |
| Pedido e restrição se contradizem (formato padrão sem config x. não quebrar) | Decisão de produto | D-01 escolhe a leitura compatível; confirmar antes de implementar |
| Docs desatualizadas | Exemplo errado | D-10 |

## 8. Pontos a confirmar pelos mantenedores

1. Aceitar D-01 (extensões legadas mantidas) em vez de corpo estritamente RFC.
2. Aceitar a precedência do h3 sobre `body` (D-03) como mudança incompatível.
3. Confirmar D-06: `detail` só quando a mensagem é informada explicitamente.
4. Confirmar se a atualização da documentação (D-10) entra nesta mudança.
