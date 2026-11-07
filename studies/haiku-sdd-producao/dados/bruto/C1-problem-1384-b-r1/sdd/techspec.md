# Especificação técnica — Respostas de erro em problem details (RFC 9457)

Referências: `sdd/pedido.md` (contrato #1384-B), `sdd/prd.md` (RF-01 a RF-08), issue h3js/h3#1384.

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `39dd28e`).

## 1. Resumo

Toda resposta de erro gerada pelo h3 passa a ter `Content-Type: application/problem+json` e corpo com os membros da RFC 9457 (`type`, `title`, `status`, `detail`, `instance`), mantendo os campos atuais (`statusText`, `unhandled`, `message`, `data`, `body`) como membros de extensão. A mudança concentra-se em duas funções existentes: `HTTPError.toJSON()` (monta o corpo) e `errorResponse()` (monta a resposta). Não há opção nova de configuração.

Fluxo atual, que não muda: todo erro lançado, retornado ou criado pelo framework (`kNotFound`, número, validação, `onError`, `unhandled`) passa por `prepareResponse` → `errorResponse` (`src/response.ts:146-174`, `src/response.ts:173`). Por isso a troca em `errorResponse` cobre RF-01 para todas as origens.

## 2. Decisões de arquitetura

### D-01 — Formato padrão em `errorResponse`, sem opção de configuração

**Escolha:** trocar o cabeçalho padrão de erro de `application/json;charset=UTF-8` para `application/problem+json` dentro de `errorResponse()` (`src/response.ts:358-380`). O cabeçalho de sucesso (`jsonHeaders`, `src/response.ts:270-272`) não muda.

**Alternativas consideradas:**
- *Middleware padrão via `onError`* (`src/utils/middleware.ts:37-63`): exigiria registrar algo em toda app, e o `onError` do usuário passaria a competir com ele. Descartado: o pedido quer padrão sem configuração.
- *Opção `config.problemDetails` em `H3Config`*: fora de escopo (PRD, "Fora de escopo", primeiro item).
- *Negociar pelo `Accept`* (devolver `application/json` quando o cliente não aceita `application/problem+json`): a RFC permite, mas exige lógica de negociação em todo erro e contradiz "formato padrão". Descartado.

**Justificativa:** `errorResponse` é o único ponto de saída de erros do h3; uma troca ali atende RF-01 sem duplicar lógica.

### D-02 — O corpo RFC é montado em `HTTPError.toJSON()`

**Escolha:** `toJSON()` (`src/error.ts:226-236`) passa a retornar os membros RFC 9457 além dos legados. `errorResponse` continua chamando `error.toJSON()` (`src/response.ts:368`) e só acrescenta `stack` em debug, como hoje.

**Alternativas consideradas:**
- *Função interna separada em `response.ts`* (ex.: `toProblemBody(error)`), deixando `toJSON()` como está. Evita mudar `JSON.stringify(err)` para quem usa a classe diretamente. Descartado porque deixa duas fontes de verdade para o mesmo corpo, e `toJSON()` já é o contrato de serialização da classe.

**Justificativa:** uma fonte única. A mudança em `JSON.stringify(err)` é apenas aditiva (novos campos) e não remove nada. `defineJsonRpcHandler` não usa `toJSON()` (`src/utils/json-rpc.ts:480-491`), então o protocolo JSON-RPC não é afetado.

### D-03 — `title` padrão a partir de uma tabela completa de reason phrases em módulo interno novo

**Escolha:** criar `src/utils/internal/status-text.ts` com a tabela de frases padrão RFC 9110 para os códigos conhecidos e uma função `getStatusText(status)`. `toJSON()` usa `this.statusText ?? getStatusText(this.status)` como `title`.

**Alternativas consideradas:**
- *Reutilizar `STATUS_TEXT`* de `src/utils/response.ts:347-354`. Descartado por dois motivos: (a) a tabela existente contém apenas 204 e 301/302/303/307/308 de propósito ("Any other status gets no phrase rather than one that belongs to a different code", comentário em `src/utils/response.ts:347`), e exportá-la mudaria `noContent`/`redirect`; (b) importá-la em `error.ts` cria ciclo `error.ts → utils/response.ts → response.ts → error.ts`.
- *Omitir `title` quando não há `statusText`*. Mais simples, mas contraria RF-02 ("ou o texto padrão do status HTTP, quando ausente"). Descartado.
- *Usar `new Response(null, { status }).statusText`*. Não é confiável: os runtimes não preenchem a frase de forma uniforme. Descartado.

**Justificativa:** a tabela é dados puros, sem dependência, e fica isolada em `utils/internal/` como manda `AGENTS.md`. O custo é de bytes no bundle; a tabela deve ter só os códigos definidos em RFC 9110 e nenhum código de extensão.

### D-04 — Precedência de cabeçalhos: Content-Type da RFC é o padrão, cabeçalhos do erro e `errHeaders` sobrescrevem

**Escolha:** em `errorResponse`, o padrão passa a ser `problemHeaders` (`application/problem+json`). A ordem de merge atual é preservada: `error.headers` (`src/response.ts:359-361`) e depois `errHeaders` (`src/response.ts:362-364`) sobrescrevem o padrão.

**Alternativas consideradas:**
- *Forçar `application/problem+json` sempre*, ignorando um `Content-Type` informado pelo app em `HTTPError.headers`. Descartado: quebra quem já define o cabeçalho de propósito e muda a regra de precedência que existe hoje (o padrão `jsonHeaders` já podia ser sobrescrito).

**Justificativa:** RF-06 exige que `headers` continue sendo enviado. Manter a precedência atual evita mudança de comportamento não pedida.

### D-05 — Ordem de montagem do corpo: RFC primeiro, legados depois, `body` por último

**Escolha:** `toJSON()` monta o objeto nesta ordem: membros RFC (`type`, `title`, `status`, `detail`, `instance`), membros legados (`statusText`, `unhandled`, `message`, `data`) e por fim `...body`, como hoje (`src/error.ts:226-236`).

**Alternativas consideradas:**
- *`body` antes dos membros RFC*, para que os membros padrão não possam ser sobrescritos. Descartado: mudaria o comportamento atual em que `body` sobrescreve `status`, `message` etc., e o pedido manda não quebrar o que existe.

**Justificativa:** preserva o comportamento atual dos campos já existentes. Consequência registrada em R-01.

### D-06 — `type` e `instance` entram em `ErrorInput` e são propagados de `cause`, como os demais campos

**Escolha:** `ErrorInput` (`src/error.ts:6-26`) ganha `type?: string` e `instance?: string`. A classe ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, preenchidos no construtor (`src/error.ts:162-210`) com o mesmo padrão de `headers` e `unhandled`: lidos de `details` e, na falta, de `details.cause` (`src/error.ts:202-206`).

**Alternativas consideradas:**
- *Não ler de `cause`*. Descartado: `status`, `statusText`, `headers`, `unhandled` e `data` já são lidos de `cause` (`src/error.ts:172-178`, `:180-185`, `:202`, `:205-206`); ser diferente geraria surpresa.

**Justificativa:** consistência com o restante do construtor. `ErrorInput` é a única superfície pública nova, e não há nome público novo além de `type` e `instance` (RF-03).

### D-07 — Erros não tratados seguem a máscara atual

**Escolha:** em `toJSON()`, `detail` recebe `"HTTPError"` quando `unhandled` (o mesmo valor que `message` recebe hoje em `src/error.ts:232`). `data` e `body` continuam omitidos (`src/error.ts:233-234`). `stack` continua só em debug (`src/response.ts:369`).

**Alternativas consideradas:** nenhuma; RF-05 e o contrato fixam o comportamento. A decisão é só não mexer na máscara, e o teste de vazamento (seção 5) cobre o caso.

### D-08 — Respostas repassadas de upstream não são convertidas

**Escolha:** nada muda em `proxy`. Respostas de upstream são repassadas como `HTTPResponse` com o corpo original (`src/utils/proxy.ts:458-467`) e não passam por `errorResponse`. Apenas os `HTTPError` que o próprio h3 cria (`src/utils/proxy.ts:355` e `:380`) viram problem details.

**Justificativa:** o corpo upstream não é de responsabilidade do h3 e converter seria reescrever conteúdo alheio. O PRD pede que isso seja verificado na implementação; a verificação está no teste da seção 5.

## 3. Arquivos a alterar

| Arquivo | Alteração | Referências no código atual |
| --- | --- | --- |
| `src/error.ts` | Adicionar `type?`/`instance?` em `ErrorInput`; propriedades readonly `type`/`instance`; leitura no construtor; novo `toJSON()` com o corpo RFC; tipo interno não exportado `ProblemDetails`. | `ErrorInput` `src/error.ts:6-26`; campos readonly `src/error.ts:92-119`; construtor `src/error.ts:162-210`; `toJSON` `src/error.ts:226-236` |
| `src/response.ts` | Nova constante `problemHeaders`; `errorResponse` usa `problemHeaders` no lugar de `jsonHeaders`. | `FrozenHeaders` `src/response.ts:260-264`; `emptyHeaders` `src/response.ts:266-268`; `jsonHeaders` `src/response.ts:270-272`; `errorResponse` `src/response.ts:358-380` (uso em `:360` e `:361`) |
| `src/utils/internal/status-text.ts` | **Novo.** Tabela RFC 9110 e `getStatusText(status: number): string \| undefined`. | — |
| `test/errors.test.ts` | Ajustar as duas asserções de formato antigo (seção 5.3). | `test/errors.test.ts:44`, `test/errors.test.ts:140` |
| `test/problem-details.test.ts` | **Novo.** Testes de matriz (web/node) para RF-01 a RF-06 e RF-05. | `describeMatrix` `test/_setup.ts:11`; debug em `test/_setup.ts:136` |
| `test/unit/problem-details.test.ts` | **Novo.** Testes unitários de `HTTPError` (`type`, `instance`, `toJSON`) e de `getStatusText`. | pasta `test/unit/` |
| `AGENTS.md` | Uma linha na árvore de `utils/internal/` com `status-text.ts` (o próprio arquivo pede manter a árvore atualizada). | `AGENTS.md` seção "Project Structure", bloco `utils/internal/` |

**Verificados e sem mudança:**
- `src/utils/internal/validate.ts:217-233` (`createValidationError`): cria `HTTPError` com `status` 400 e `statusText` "Validation failed" (`:223`); o erro passa por `errorResponse`, então RF-01 cobre a validação sem tocar nesse arquivo.
- `src/utils/middleware.ts:37-63` (`onError`) e `src/adapters.ts:117-152` (`unhandled`): criam `HTTPError` e seguem para `prepareResponse`; sem mudança.
- `src/utils/json-rpc.ts:480-491`: protocolo próprio, fora de escopo (PRD).
- `src/index.ts:72`: `ErrorInput`, `ErrorBody`, `ErrorDetails` e `HTTPError` já são exportados; nenhuma exportação nova.

**Não alterar:**
- `CHANGELOG.md`: o arquivo segue o formato do standard-version (`CHANGELOG.md:1-3`) e é gerado pelas releases. Editar à mão conflita com esse fluxo. Ver R-06.
- `docs/1.guide/1.basics/6.error.md`: documentação externa, fora de escopo (PRD).

## 4. Contratos e assinaturas

Tudo abaixo está em `src/error.ts`, salvo indicação. Nenhum tipo novo é exportado.

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  // ...campos existentes (cause, headers, statusCode, statusMessage)...

  /**
   * URI que identifica o tipo do problema (RFC 9457 `type`).
   * Ausente no corpo vira `"about:blank"`.
   */
  type?: string;

  /**
   * Identificador da ocorrência (RFC 9457 `instance`), URI ou caminho relativo.
   * Omitido do corpo quando ausente.
   */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ...campos existentes...

  /** URI que identifica o tipo do problema. `undefined` quando não informado. */
  readonly type: string | undefined;

  /** Identificador da ocorrência. `undefined` quando não informado. */
  readonly instance: string | undefined;

  /**
   * Corpo serializado do erro, no formato RFC 9457 com os campos legados como extensão.
   * Usado por `errorResponse` e por `JSON.stringify(error)`.
   */
  toJSON(): ProblemDetails<DataT>;
}

/**
 * Forma do corpo de erro. Interna ao módulo: não é exportada.
 * `[key: string]: unknown` cobre os membros de `body`, que são espalhados por último (D-05).
 */
interface ProblemDetails<DataT = unknown> {
  type: string;
  title: string | undefined;
  status: number;
  detail: string;
  instance: string | undefined;
  statusText: string | undefined;
  unhandled: boolean | undefined;
  message: string;
  data: DataT | undefined;
  [key: string]: unknown;
}
```

`toJSON()` deve ser exatamente:

```ts
toJSON(): ProblemDetails<DataT> {
  const unhandled = this.unhandled;
  return {
    type: this.type ?? "about:blank",
    title: this.statusText ?? getStatusText(this.status),
    status: this.status,
    detail: unhandled ? "HTTPError" : this.message,
    instance: this.instance,
    statusText: this.statusText,
    unhandled: unhandled,
    message: unhandled ? "HTTPError" : this.message,
    data: unhandled ? undefined : this.data,
    ...(unhandled ? undefined : this.body),
  };
}
```

Observações sobre o contrato:
- `instance: undefined` é omitido por `JSON.stringify`, então o corpo não tem a chave quando ausente (RF-03).
- `title` vira `undefined` apenas para códigos fora da tabela, e aí é omitido (R-05).
- O `ProblemDetails` interno exige anotação de retorno explícita por causa de `isolatedDeclarations` (`AGENTS.md`, seção TypeScript).

`src/response.ts`:

```ts
// Logo após `jsonHeaders` (src/response.ts:270-272)
const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

// Assinatura inalterada; só a constante usada muda
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
```

`src/utils/internal/status-text.ts`:

```ts
/**
 * Frase de status padrão (RFC 9110) para um código HTTP, ou `undefined` quando o código não está na tabela.
 */
export function getStatusText(status: number): string | undefined;
```

Os códigos da tabela são os de RFC 9110 (faixas 4xx e 5xx completas, e os de 2xx, 3xx e 1xx definidos na RFC). Códigos de extensão ficam de fora de propósito.

## 5. Estratégia de testes

Seguindo `AGENTS.md`: primeiro os testes de regressão que falham, depois a implementação, depois a suíte completa.

### 5.1 Testes novos de matriz — `test/problem-details.test.ts`

Usar `describeMatrix` (`test/_setup.ts:11`) para rodar em web e node. Cada caso cobre um requisito:

| Caso | Requisito |
| --- | --- |
| `throw new HTTPError({ status: 404 })` responde `application/problem+json` | RF-01 |
| `kNotFound` (rota inexistente) responde 404 com `application/problem+json` | RF-01 |
| Validação com `readBody` de JSON inválido responde 400 com `application/problem+json` | RF-01 |
| Exemplo do PRD (422, `statusText`, `message`, `type`, `instance`): corpo tem `type`, `title`, `status`, `detail`, `instance` com os valores esperados | RF-02 |
| `HTTPError` sem `statusText` tem `title` igual à frase padrão (ex.: 404 → "Not Found") | RF-02 |
| `HTTPError` com `status: 400` sem `type`/`instance`: corpo tem `type: "about:blank"` e não tem a chave `instance` (checar com `"instance" in body === false`) | RF-03 (ausência) |
| `status`, `statusText`, `unhandled`, `message` e `data` continuam com os valores de hoje (409, `data: { campo: "slug" }`) | RF-04 |
| Erro não tratado (`new Error("senha do banco: 123")`, debug desligado): status 500, `application/problem+json`, corpo não contém "senha do banco" nem chave `stack` | RF-05 |
| Mesmo caso com debug ligado: chave `stack` presente como hoje | RF-05 (complemento) |
| `headers: { "Retry-After": "30" }` em 429: header presente e `Content-Type` continua problem+json | RF-06 |
| `headers: { "content-type": "text/plain" }` no erro: o valor informado prevalece (D-04) | D-04 |
| `onError` que devolve `undefined` (erro é renderizado pelo h3) responde problem+json; `onError` que devolve `Response` própria não é alterada | D-01, D-08 |
| Erro de `proxyRequest` com upstream 4xx/5xx: corpo do upstream repassado sem conversão (D-08) | D-08 |

### 5.2 Testes unitários — `test/unit/problem-details.test.ts`

- `new HTTPError({ status: 400, type: "x", instance: "/y" })`: `err.type === "x"` e `err.instance === "/y"`.
- `new HTTPError({ status: 400 })`: `err.type` e `err.instance` são `undefined`.
- `type` e `instance` vêm de `cause` quando ausentes em `details` (D-06).
- `toJSON()` com `unhandled: true`: `detail === "HTTPError"`, sem `data`, sem `body`.
- `toJSON()` com `body: { trace: "abc" }`: `trace` aparece no corpo ao lado dos membros RFC. O caso de colisão de chaves (R-01) não é testado como comportamento desejado.
- `getStatusText(404) === "Not Found"`, `getStatusText(422) === "Unprocessable Content"`, `getStatusText(599)` é `undefined`, `getStatusText(299)` é `undefined` (não definido na RFC 9110), e `getStatusText(499)` é `undefined`.

### 5.3 Ajustes em testes existentes — `test/errors.test.ts`

Só as asserções de formato, como RF-07 permite:

- `test/errors.test.ts:44`: `expect(res.headers.get("content-type")).toBe("application/json;charset=UTF-8")` vira `toBe("application/problem+json")`.
- `test/errors.test.ts:140`: `expect(result.headers.get("content-type")).toMatch("application/json")` vira `toMatch("application/problem+json")`. Atenção: `toMatch` com string checa substring, e `"application/problem+json"` **não** contém `"application/json"`, então a asserção antiga falha.

Os demais testes do arquivo (`test/errors.test.ts:124-151`, `:252-309`, `:339-384`) checam campos do corpo com `toMatchObject` e devem continuar passando sem alteração. Confirmar na execução.

Outros arquivos citados pelo grep (`test/app.test.ts:198-205`, `test/body.test.ts:440-458`, `test/proxy.test.ts:1024-1029`) usam campos legados com `toMatchObject` ou `JSON.parse`, então não precisam de ajuste. Se a execução mostrar falha em `test/proxy.test.ts:1531` ou em outro teste de content-type, tratar caso a caso e registrar no relatório.

### 5.4 Comandos de verificação

```bash
pnpm vitest run test/problem-details.test.ts test/unit/problem-details.test.ts test/errors.test.ts
pnpm vitest run                    # suíte completa
pnpm lint                          # oxlint + oxfmt --check
pnpm typecheck                     # tsc --noEmit
```

Critério de pronto: todos os comandos acima terminam sem erro, e a lista de testes alterados é só a das seções 5.1, 5.2 e 5.3.

## 6. Riscos

- **R-01 — `body` pode sobrescrever membros RFC.** Como `...body` é espalhado por último (D-05), um `body` com a chave `type`, `title`, `detail` ou `instance` substitui o valor padrão. É o mesmo comportamento que já existe para `status` e `message`, e o pedido proíbe quebrar o que existe. Decisão a confirmar com o responsável: manter (recomendado, sem quebra) ou fazer os membros RFC prevalecerem (muda o comportamento de `body`).
- **R-02 — `JSON.stringify(err)` e `err.toJSON()` mudam de forma.** A mudança é aditiva (novos campos `type`, `title`, `detail`, `instance`), mas quem serializa `HTTPError` diretamente recebe campos novos. Mitigação: registrar no changelog de release (R-06).
- **R-03 — Clientes com verificação estrita de `application/json`.** Consumidores que checam o `Content-Type` deixam de reconhecer o erro. É a consequência direta do pedido (PRD, "Riscos"). Confirmar com o responsável se a troca como padrão é aceitável ou se deve ser release major (já apontado no PRD).
- **R-04 — Tabela de reason phrases duplicada.** `src/utils/internal/status-text.ts` e `STATUS_TEXT` (`src/utils/response.ts:347-354`) coexistem com propósitos diferentes (D-03). Aceitável; a unificação é possível depois, mas mudaria `noContent`/`redirect` e fica fora deste escopo.
- **R-05 — `title` ausente para códigos fora da tabela.** Um `HTTPError` com código fora da tabela e sem `statusText` não tem `title`. A RFC 9457 trata os membros como opcionais, e a tabela cobre os códigos padrão. Se o responsável preferir `title` sempre presente, a saída é usar `"Unknown Status"` como último recurso, o que altera RF-02 e deve ser combinado antes.
- **R-06 — Changelog.** O PRD pede documentar a mudança no changelog (PRD, "Riscos", mitigação), mas `CHANGELOG.md` é gerado pelo fluxo de release (`CHANGELOG.md:1-3`) e editá-lo à mão conflita com ele. Recomendação: não editar; a mudança entra na nota de release pelo mesmo fluxo. Decisão a confirmar.
- **R-07 — `statusText` de erro não tratado vaza para `title`.** Um erro não tratado criado por `fromNodeHandler` pode carregar `statusText` do `cause` (`src/adapters.ts:122-152`), e `title` passa a repetir esse valor. Isso já acontece hoje em `statusText` no corpo e no reason phrase da resposta (`src/response.ts:376`), então não é regressão. Registrar para revisão.
- **R-08 — Ocultação de erros não tratados.** Qualquer mudança em `toJSON()` pode vazar mensagem interna se a máscara de D-07 não for preservada. Mitigação: o teste de vazamento da seção 5.1 cobre `data`, `message`, `detail` e `stack`.
- **R-09 — Volume de ajustes em testes.** O risco do PRD se confirma pouco: só duas asserções em `test/errors.test.ts` dependem do formato antigo, pela leitura do código. A execução completa pode mostrar outros casos (ver 5.3).
- **R-10 — Compatibilidade com `HTTPError` de outros pacotes.** `HTTPError.isError` aceita erros de outros pacotes com `name === "HTTPError"` e `status` (`src/error.ts:129-133`). Esses erros passam a ser renderizados em problem details como qualquer `HTTPError`. Sem risco de segurança, mas vale checar um caso de teste com erro de `srvx` (`BodyTooLargeError`), que o próprio comentário cita (`src/error.ts:127`).
