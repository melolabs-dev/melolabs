# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A), `sdd/prd.md` (RF-01 a RF-07) e issue h3js/h3#1384.

Esta especificação não altera código. Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `13e23a2`).

## Resumo

- A opção `problemDetails` entra em `H3Config` (`src/types/h3.ts:28`) e chega à renderização de erro pelo `config` que o `H3` já repassa (`src/h3.ts:99`).
- `HTTPError` ganha `type` e `instance` como campos somente leitura, vindos apenas do objeto de entrada (`ErrorInput`).
- O corpo em problem details é montado por uma função interna de `src/response.ts`. `HTTPError.toJSON()` não muda, então o formato padrão fica idêntico.
- Nenhum nome público novo além de `problemDetails`, `type` e `instance`.

## Decisões de arquitetura

### D-01 — Opção `problemDetails` em `H3Config`, lida do `config` da aplicação

**Escolha:** adicionar `problemDetails?: boolean` em `H3Config`, logo após `allowMalformedURL` (`src/types/h3.ts:46`), com JSDoc no mesmo estilo de `debug` e `allowMalformedURL`. O valor é lido em `errorResponse` a partir do `config` que já chega em `toResponse` (`src/response.ts:13`). `H3CoreConfig` é `Omit<H3Config, "plugins">` (`src/types/h3.ts:55`), então a opção herda o tipo sem mudança extra.

**Alternativas:**
- Opção nova em `H3Config` com nome diferente (ex.: `errorFormat: "problem"`). Rejeitada: o PRD e o contrato fixam `problemDetails`, e um booleano é o gatilho pedido.
- Ler a opção de `event.app` ou de um contexto por request. Rejeitada: `config` já é a fonte das demais opções de erro (`debug`, `silent`, `onError`).

**Justificativa:** segue o padrão das opções existentes e não cria caminho novo de configuração.

### D-02 — `type` e `instance` vêm somente do objeto de entrada, não de `cause`

**Escolha:** em `HTTPError`, `type` e `instance` são lidos apenas de `details as ErrorInput`, sem o fallback `details.cause` que `status`, `statusText` e `headers` têm (`src/error.ts:172-203`).

**Alternativas:**
- Ler também de `cause`, como `headers`. Rejeitada: `cause` costuma ser um erro de outra biblioteca, e muitas delas usam `type` com outro significado (ex.: erros de parser de body). Um `type` assim viraria URI de problema.
- Não expor `type` e `instance` na classe, e recebê-los só no corpo. Rejeitada: o PRD exige `error.type` e `error.instance` (RF-02) e que `onError` os receba (RF-07).

**Justificativa:** a origem é explícita. Um `HTTPError` construído com outro `HTTPError` como entrada ainda copia `type` e `instance`, porque a entrada tem essas propriedades.

### D-03 — `HTTPError.toJSON()` permanece inalterado; o corpo problem é montado à parte

**Escolha:** `toJSON()` (`src/error.ts:226-236`) não muda. Em `errorResponse` (`src/response.ts:358`), o corpo problem é construído por uma função interna nova, e o corpo padrão continua sendo `error.toJSON()` (`src/response.ts:368`).

**Alternativas:**
- Acrescentar `type` e `instance` em `toJSON()`. Rejeitada: `toJSON()` é público e é o corpo padrão. Mudá-lo quebra consumidores silenciosamente (risco do PRD), mesmo que `undefined` não apareça no `JSON.stringify`. Também mudaria o contrato de quem chama `toJSON()` diretamente.
- Trocar o corpo padrão por uma serialização única. Rejeitada: viola RF-04 e o contrato "não quebrar o que já existe".

**Justificativa:** a mudança fica restrita ao caminho ligado pela opção, e o caminho padrão não é tocado.

### D-04 — `errorResponse` recebe o `config` inteiro, em vez de `debug` booleano

**Escolha:** assinatura passa de `errorResponse(error, debug?, errHeaders?)` para `errorResponse(error, config, errHeaders?)`. O único chamador é `src/response.ts:173`, que hoje passa `config.debug`.

**Alternativas:**
- Acrescentar um quarto parâmetro booleano `problemDetails`. Rejeitada: o AGENTS pede objeto de opções para funções com mais de um argumento, e a lista de flags cresceria a cada opção nova.

**Justificativa:** alinha com a convenção do projeto ("Options object as second param") e deixa `debug` e `problemDetails` lidos da mesma fonte.

### D-05 — Erros `unhandled` ficam com `type` "about:blank" e sem `instance`

**Escolha:** em problem details, se `error.unhandled` for verdadeiro, o membro `type` vira `"about:blank"` mesmo que o erro tenha `type`, e `instance` é omitido. `detail` e `title`, quando aplicável, seguem a regra do RF-06 (`detail` oculto, `title` ← `statusText`, como já é exibido hoje em `toJSON()`).

**Alternativas:**
- Seguir a tabela do RF-03 sem exceção. Rejeitada: um erro não tratado é, por construção, produzido pelo framework a partir de um `cause` arbitrário (`src/response.ts:146-152`). Um `type` vindo daí revelaria detalhes internos, e o RF-06 pede que nada sensível apareça.

**Justificativa:** é uma exceção consciente à tabela do RF-03. **Precisa ser confirmada pelo time** antes da implementação, porque o PRD não a prevê.

### D-06 — `Content-Type` `application/problem+json;charset=UTF-8`, com a mesma ordem de merge de headers

**Escolha:** constante `problemHeaders` ao lado de `jsonHeaders` (`src/response.ts:270-272`), com `"content-type": "application/problem+json;charset=UTF-8"`. A ordem de merge atual é mantida: primeiro a base (`jsonHeaders` ou `problemHeaders`), depois `error.headers`, depois `errHeaders` (`src/response.ts:358-365`).

**Alternativas:**
- `application/problem+json` sem `charset`. Aceitável pela RFC, mas diverge do padrão atual do arquivo, que usa `charset=UTF-8`. O PRD usa "começando com", então ambas atendem.

**Justificativa:** mantém a consistência com `jsonHeaders`. O comportamento de `error.headers` sobrescrever `content-type` continua o mesmo que hoje.

### D-07 — `stack` em modo debug continua como membro de extensão

**Escolha:** com `debug` ligado, o corpo problem recebe `stack` como hoje (`src/response.ts:369`). A RFC permite membros de extensão.

**Alternativas:**
- Remover `stack` no formato problem. Rejeitada: o PRD diz que o comportamento de debug não muda, e remover o stack reduziria a informação para quem depende do modo debug.

**Justificativa:** preserva o comportamento de debug. **Ponto a confirmar:** o PRD marca "membros de extensão" como fora de escopo, mas `stack` já existe hoje e não é um membro novo.

### D-08 — `defineHandler(...).fetch` não recebe `config`; fica fora de escopo

**Escolha:** `src/handler.ts:122` e `src/handler.ts:124` chamam `toResponse` sem `config`. Isso já faz com que `debug`, `silent`, `onError` e `onResponse` do app não se apliquem nesse caminho. A opção `problemDetails` também não se aplica. Não se altera esse comportamento.

**Alternativas:**
- Passar config também nesse caminho. Rejeitada: é uma mudança de comportamento que afeta mais do que o contrato pede, e o `fetch` de handler não tem acesso à config do app.

**Justificativa:** mantém o escopo do PRD. O comportamento fica documentado em riscos (R-03).

### D-09 — Sem nomes públicos novos

**Escolha:** `ProblemDetails` (se existir como tipo) e a função `toProblemDetails` ficam sem `export`, no fim de `src/response.ts`, seguindo a convenção "Internal helpers go at the end of files". Nada novo é adicionado em `src/index.ts`.

**Justificativa:** cumpre a restrição do contrato ("Nenhum outro nome público novo").

## Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/types/h3.ts` | `src/types/h3.ts:46` | Acrescentar `problemDetails?: boolean` com JSDoc depois de `allowMalformedURL`. |
| `src/error.ts` | `src/error.ts:15` | Em `ErrorInput`, acrescentar `type?: string` e `instance?: string` com JSDoc (RFC 9457). |
| `src/error.ts` | `src/error.ts:112` | Declarar `readonly type: string \| undefined` e `readonly instance: string \| undefined`, com JSDoc. Depois de `body`. |
| `src/error.ts` | `src/error.ts:209` | Atribuir `this.type = (details as ErrorInput)?.type;` e `this.instance = (details as ErrorInput)?.instance;`, depois de `this.body`. |
| `src/response.ts` | `src/response.ts:173` | `errorResponse(error, config, errHeaders)` no lugar de `errorResponse(error, config.debug, errHeaders)`. |
| `src/response.ts` | `src/response.ts:270-272` | Acrescentar `problemHeaders` (FrozenHeaders) ao lado de `jsonHeaders`. |
| `src/response.ts` | `src/response.ts:358-380` | Ajustar `errorResponse`: base de headers por `config.problemDetails`, e corpo por `toProblemDetails` quando ligado. |
| `src/response.ts` | fim do arquivo | Acrescentar `toProblemDetails(error, debug)` (interna, não exportada). |
| `test/problem-details.test.ts` | novo | Testes de integração com `describeMatrix` (ver estratégia). |
| `test/unit/types.test-d.ts` | existente | Asserções de tipo para `H3Config["problemDetails"]`, `HTTPError["type"]` e `HTTPError["instance"]`. |

`src/h3.ts` **não precisa de alteração**: o construtor já guarda `config` (`src/h3.ts:53-55`) e `fetch` já o repassa a `toResponse` (`src/h3.ts:99`).

## Contratos e assinaturas

```ts
// src/types/h3.ts — dentro de H3Config
/**
 * When enabled, H3 renders error responses as RFC 9457 problem details
 * (`application/problem+json`). Disabled by default.
 */
problemDetails?: boolean;

// src/error.ts — ErrorInput
/** RFC 9457 `type` URI. Read only from the input object, not from `cause`. */
type?: string;
/** RFC 9457 `instance` URI reference for this occurrence. */
instance?: string;

// src/error.ts — HTTPError
/** RFC 9457 `type` URI, when provided. */
readonly type: string | undefined;
/** RFC 9457 `instance`, when provided. */
readonly instance: string | undefined;
// toJSON(): inalterado (D-03)

// src/response.ts — interno
const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json;charset=UTF-8",
});

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;

function toProblemDetails(error: HTTPError, debug?: boolean): Record<string, unknown> {
  // unhandled: nada sensível sai (D-05)
  const hidden = error.unhandled;
  return {
    type: (!hidden && error.type) || "about:blank",
    title: error.statusText,
    status: error.status,
    detail: hidden ? undefined : error.message || undefined,
    instance: hidden ? undefined : error.instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}
```

Pontos de contrato:

- `title`, `detail` e `instance` valem `undefined` quando omitidos. `JSON.stringify` descarta `undefined`, então o membro não aparece no corpo. Não usar `null`, porque `null` seria serializado.
- `title` usa `error.statusText`, que já passa por `sanitizeStatusMessage` no construtor (`src/error.ts:180-185`). Isso cobre RF-05 sem nova sanitização.
- `status` usa `error.status`, já sanitizado por `sanitizeStatusCode` (`src/error.ts:172-178`).
- Os headers de `error.headers` (ex.: `retry-after`) seguem por `mergeHeaders` (`src/response.ts:243`), igual ao caminho atual.
- `errHeaders` segue o mesmo fluxo, incluindo o comentário sobre merge duplicado em `src/response.ts:167-173`.

## Estratégia de testes

Seguindo o AGENTS: teste de regressão antes da mudança, confirmar que falha, depois implementar.

### Antes da implementação (devem falhar)

- **RF-02** (`test/problem-details.test.ts`, ou `test/unit/` se for só classe): `new HTTPError({ status: 404, message: "Not found", type, instance })` deve expor `error.type` e `error.instance`. Hoje ambos são `undefined`, então falha.
- **RF-03**: com `app.config.problemDetails = true` (ou `new H3({ problemDetails: true })`), `GET /orders/42` que lança o erro do PRD deve responder `application/problem+json` e o corpo exato. Falha hoje por content-type e corpo.
- **RF-07**: `onError` deve receber `error.type`. Falha hoje.
- **RF-06**: erro não tratado com `problemDetails` ligado deve ter status 500 e content-type problem, sem "senha do banco" nem stack. A parte do conteúdo passa hoje; a do content-type falha.

### Antes da implementação (devem passar, e continuam passando)

- **RF-04 (guarda de regressão)**: uma rota que lança `HTTPError` com e sem `type`/`instance` deve produzir o mesmo corpo e o mesmo `Content-Type` com a opção desligada. Passa antes e depois. É o teste que trava D-03.
- **RF-01 (runtime)**: `app.config.problemDetails` é `undefined` por padrão. Passa antes e depois.
- Suíte existente: `test/errors.test.ts` inteira, principalmente o bloco `error response bodies` (`test/errors.test.ts:9`) e "error headers" (`test/errors.test.ts:202`).

### Após a implementação

- **Matriz web/node**: todos os casos de RF-03 a RF-07 com `describeMatrix` (`ctx.fetch`).
- **Headers**: `retry-after: 120` presente e `statusText` com caractere de controle sai sanitizado no `title` (RF-05).
- **errHeaders em problem details**: um `event.res.errHeaders.set("x-error", "1")` aparece uma vez no header de resposta. Verifica que o merge duplicado de `src/response.ts:167-173` não se repete no novo caminho.
- **Unhandled com `type` em HTTPError**: `new HTTPError({ status: 500, unhandled: true, type: "https://x/y", instance: "/a" })` deve sair com `about:blank` e sem `instance`. Testa D-05.
- **Corpo com debug**: com `debug` e `problemDetails`, o corpo inclui `stack` (D-07) e segue JSON com indentação.
- **Tipos** (`test/unit/types.test-d.ts`): `expectTypeOf<H3Config["problemDetails"]>().toEqualTypeOf<boolean | undefined>()`, `expectTypeOf<HTTPError["type"]>().toEqualTypeOf<string | undefined>()`, e o mesmo para `instance`.
- **Sem novos exports**: `src/index.ts` não muda, e o teste de pacote (`test/unit/package.test.ts`) continua passando.

### Comandos de verificação

```bash
pnpm vitest run test/problem-details.test.ts
pnpm vitest run test/errors.test.ts
pnpm typecheck            # tsc --noEmit
pnpm lint                 # oxlint + oxfmt --check
pnpm vitest run           # suíte completa
```

`test/dist.test.ts` depende do build. Se falhar por falta de `dist/`, rodar `pnpm build` antes e registrar isso no relatório.

## Riscos

- **R-01 — Quebra silenciosa de consumidores.** Mudar `toJSON()` ou o corpo padrão afetaria quem depende do formato atual. **Mitigação:** D-03 e o teste de guarda RF-04.
- **R-02 — Vazamento em erros não tratados.** O caminho novo é paralelo ao antigo e pode esquecer uma regra de ocultação. **Mitigação:** D-05 (o `type` e o `instance` também são ocultados) e o teste de RF-06. Vale comparar com a regra de `toJSON()` (`src/error.ts:226-236`) e com `src/utils/json-rpc.ts:483`, que já mascara erros não tratados de forma parecida.
- **R-03 — Caminhos sem `config`.** `defineHandler(...).fetch` (`src/handler.ts:122,124`), o `onResponse` middleware (`src/utils/middleware.ts:26`) e o cache de ocache (`src/rules/cache.ts:314`) chamam `toResponse` sem config. Nesses caminhos, `problemDetails` não se aplica, da mesma forma que `debug` não se aplica hoje. **Mitigação:** D-08 e documentação. Confirmar com o time se é aceitável.
- **R-04 — `type` vindo de erros de outras bibliotecas.** Erros como os de parser de body costumam ter `type` com significado próprio. **Mitigação:** D-02 (nunca vem de `cause`) e D-05 (erros não tratados ficam com `about:blank`).
- **R-05 — `data` e `body` somem do corpo problem.** O PRD deixa isso como decisão a confirmar. Quem depende de `data` ou `body` perde essas informações ao ligar a opção. **Ação:** confirmar com o time antes de implementar, porque afeta o formato de quem ligar a opção.
- **R-06 — `title` omitido sem `statusText`.** Algumas implementações usam o texto padrão do status. **Ação:** documentar, como pede o PRD.
- **R-07 — `error.headers` sobrescreve `content-type`.** Já é o comportamento atual com `jsonHeaders`. Com problem details, um handler que definir `content-type` nos headers do erro troca o tipo da resposta. **Ação:** manter por consistência e documentar, ou bloquear só nesse caminho se o time preferir.
- **R-08 — `isolatedDeclarations`.** As novas propriedades e a função interna precisam de tipos explícitos. Os exemplos acima já têm tipo de retorno e de propriedade.
- **R-09 — Não executado.** Esta especificação não rodou testes, porque não há código alterado. Os comandos da seção de testes ainda não foram executados.
