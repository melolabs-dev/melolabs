# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (issue h3js/h3#1384 e contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-05).

Estado de partida conferido nesta data: `pnpm vitest run` passa com 71 arquivos (1 pulado), 3091 testes passando (69 pulados) e "Type Errors: no errors". `pnpm lint` não foi executado nesta etapa.

## 1. Visão geral

Hoje toda resposta de erro é gerada por `errorResponse()` (`src/response.ts:358-380`), que serializa `HTTPError.toJSON()` com `Content-Type: application/json;charset=UTF-8` (`src/response.ts:270-272`). A mudança fica concentrada nesse ponto:

1. `errorResponse()` passa a responder `application/problem+json` com um corpo RFC 9457.
2. `HTTPError` aceita e expõe `type` e `instance`.
3. `HTTPError.toJSON()` e a API pública permanecem como estão (ver D-02).

Nada novo é exportado publicamente além de `type` e `instance` em `ErrorInput` e `HTTPError`.

## 2. Decisões de arquitetura

### D-01 — Formato único, sem opção de configuração

**Contexto.** O contrato #1384-B pede que o formato problem details seja o padrão, sem gatilho novo (`sdd/pedido.md`, seção "Nomes públicos").

**Alternativas consideradas.**
- (a) Opção em `H3Config` (ex.: `errorFormat: "problem" | "legacy"`) para manter o formato antigo.
- (b) Negociação por `Accept` (problem+json quando o cliente aceita, JSON antigo caso contrário).
- (c) Formato único padrão, sem opção (escolhida).

**Escolha: (c).** A opção (a) contraria o contrato, que proíbe nomes públicos novos. A negociação (b) muda a resposta conforme o cabeçalho da requisição e não atende RF-01, que exige o media type sempre. A quebra para quem depende do formato antigo fica registrada em "Riscos" e precisa ser aceita pelo time antes da implementação (`sdd/prd.md`, seção "Riscos").

### D-02 — Renderização interna; `toJSON()` preservado

**Contexto.** `HTTPError.toJSON()` (`src/error.ts:226-236`) é o único ponto que monta o corpo hoje. O PRD diz que ele "pode continuar existindo como base".

**Alternativas consideradas.**
- (a) Mudar `toJSON()` para devolver o formato RFC. Afeta `JSON.stringify(err)` e qualquer chamada direta de quem usa a API pública: quebra além do necessário.
- (b) Criar um método público novo (ex.: `toProblem()`). Proibido pela restrição "nenhum outro nome público novo" (`sdd/pedido.md`).
- (c) Função interna `toProblemDetails(error)` em `src/response.ts`, usada só por `errorResponse()`. `toJSON()` fica intacto (escolhida).

**Escolha: (c).** Preserva a API pública e mantém um único ponto de renderização de erros HTTP. Custo aceito: a regra de mascaramento de erros `unhandled` existe em `toJSON()` e em `toProblemDetails()`. Os testes de D-07 cobrem as duas.

### D-03 — Media type exato `application/problem+json`

**Contexto.** RF-01 pede `Content-Type` igual a `application/problem+json`. A RFC 9457 define o media type sem parâmetros; o JSON já é UTF-8 por RFC 8259.

**Alternativas consideradas.**
- (a) Manter `;charset=UTF-8`, como `jsonHeaders` (`src/response.ts:270-272`). Coerente com o resto, mas diverge do media type da RFC.
- (b) `application/problem+json` exato (escolhida).

**Escolha: (b).** Segue a RFC e o texto literal de RF-01. Um novo `FrozenHeaders` `problemHeaders` é criado ao lado de `jsonHeaders`. `jsonHeaders` continua sendo usado nas respostas de sucesso.

### D-04 — Mapeamento de campos

**Contexto.** RF-02 define `statusText` → `title`, `message` → `detail`, `type` padrão `about:blank`, e `data`/`body` como extensões que não sobrescrevem membros da RFC.

**Alternativas consideradas.**
- (a) Manter as chaves antigas (`statusText`, `message`) e acrescentar as da RFC. Corpo com duas formas de dizer a mesma coisa; contraria "statusText vira title" do PRD.
- (b) Renomear, emitindo só membros da RFC e as extensões `data`, `body` e `stack` (escolhida).

**Regras de precedência (escolha b).**
- `type`: `error.type` ou `"about:blank"`.
- `title`: `error.statusText` ou, se ausente, `REASON_PHRASES[status]` (D-05). Omitido se nenhum existir.
- `status`: `error.status`.
- `detail`: `error.message`, omitido para erros `unhandled` (D-07).
- `instance`: `error.instance`, omitido quando ausente.
- `data` e `body` entram primeiro; os membros acima entram por último e portanto têm precedência sobre `body` (RF-02). Observação: `body.data` ainda sobrescreve `error.data`, como hoje.

### D-05 — Título padrão via tabela completa de frases RFC 9110

**Contexto.** RF-02 exige o texto padrão do status quando `title` não existe. A tabela `STATUS_TEXT` em `src/utils/response.ts:347-354` tem só 6 códigos (204, 301, 302, 303, 307, 308) e é intencionalmente restrita por comentário ("Any other status gets no phrase rather than one that belongs to a different code"). Não serve para erros.

**Alternativas consideradas.**
- (a) Reaproveitar `STATUS_TEXT` de `utils/response.ts`. Não cobre 404, 500 etc.
- (b) Omitir `title` quando não há `statusText`. Viola RF-02.
- (c) Usar `node:http` `STATUS_CODES`. Viola multi-runtime (AGENTS.md, "Core Design").
- (d) Nova tabela interna com as frases da RFC 9110, em `src/utils/internal/status-text.ts` (escolhida).

**Escolha: (d).** Arquivo interno, sem exportação pública. Mantém `utils/response.ts` como estava. O custo é um mapa de cerca de 60 entradas, aceitável para o núcleo.

### D-06 — `type` e `instance` em `ErrorInput`, expostos como `readonly`

**Contexto.** RF-03 pede os dois campos no `ErrorInput` e como propriedades `readonly`.

**Alternativas consideradas.**
- (a) Adicionar em `ErrorBody` (que o `ErrorInput` herda via `Partial`). Aumenta a superfície do tipo que descreve o corpo, sem necessidade.
- (b) Adicionar só em `ErrorInput` e declarar as propriedades em `HTTPError` (escolhida).
- (c) Herdar `type`/`instance` do `cause`, como `status` e `headers` fazem (`src/error.ts:172-178`, `:202`). Rejeitada: `instance` descreve a ocorrência; herdá-lo de uma causa pode carregar a identificação de outra requisição.

**Escolha: (b), sem fallback por `cause`.** Validação de URI: nenhuma. A RFC permite URI reference, e validar exigiria regras novas fora do escopo.

### D-07 — Erros `unhandled` continuam ocultos; `unhandled` sai do corpo

**Contexto.** RF-04 pede que `detail`, `stack` e dados fiquem ocultos para erros não tratados fora do modo debug. Hoje `toJSON()` mascara `message` (vira `"HTTPError"`), `data` e `body` (`src/error.ts:232-234`), e o corpo expõe a flag `unhandled` (`src/error.ts:231`).

**Regra escolhida para o corpo de erros `unhandled`:**
- `type`: `"about:blank"` (ignora `error.type`).
- `title`: mantém `statusText` ou a frase padrão, como para erros tratados. Isso preserva o que `toJSON()` já expõe hoje (`statusText` não é mascarado).
- `status`: mantido.
- `detail`, `instance`, `data`, `body`: omitidos.
- `stack`: só em debug, como hoje (`src/response.ts:369`).
- Flag `unhandled`: removida do corpo. Não é membro da RFC, é um detalhe interno de classificação e o PRD não pede para mantê-la.

**Alternativas consideradas.**
- (a) Manter `unhandled: true` como extensão, para reduzir a quebra. Expõe a classificação interna sem necessidade.
- (b) Remover (escolhida). **Ponto a confirmar pelo time** (ver Riscos).

### D-08 — Estratégia de ajuste dos testes existentes

**Escolha.** A suíte nova é escrita antes da implementação (fluxo de AGENTS.md, "Bug Fix Workflow": teste vermelho primeiro). Os testes existentes são ajustados um a um, trocando só a forma e preservando o que verificam (RF-05). Cada ajuste está listado na seção 5 com o mapeamento antigo → novo.

### D-09 — Documentação

**Escolha.** Atualizar os comentários JSDoc em `src/error.ts` (`:37-43`, `:49`) e `docs/1.guide/1.basics/6.error.md` (exemplo JSON e lista de campos). `CHANGELOG.md` é gerado pelo `changelogen` e não é editado.

## 3. Arquivos a alterar

| Arquivo | Alteração | Referência verificada |
| --- | --- | --- |
| `src/error.ts` | Campos `type?`/`instance?` em `ErrorInput`; `readonly type`/`readonly instance` em `HTTPError`; atribuição no construtor; atualizar JSDoc de `statusText` e `message` | `src/error.ts:6-26` (ErrorInput), `:42` (TIP sobre `message`), `:49` (`message` "under `message` key"), `:82-119` (campos readonly), `:207-209` (atribuições do construtor), `:226-236` (`toJSON`, mantido) |
| `src/response.ts` | Novo `problemHeaders`; `toProblemDetails()`; `errorResponse()` usa ambos | `src/response.ts:260-264` (`FrozenHeaders`), `:270-272` (`jsonHeaders`, mantido), `:358-380` (`errorResponse`), `:173` (chamada) |
| `src/utils/internal/status-text.ts` | **Novo.** Mapa `REASON_PHRASES` com frases RFC 9110 | — |
| `src/index.ts` | Sem alteração: `ErrorInput`/`ErrorBody`/`HTTPError` já exportados | `src/index.ts:72` |
| `test/problem-details.test.ts` | **Novo.** Suíte de regressão dos RF-01 a RF-04 | ver seção 5 |
| `test/errors.test.ts` | Ajustes de formato (lista abaixo) | `:44`, `:53-57`, `:79-85`, `:99-104`, `:140`, `:144-150`, `:257`, `:309`, `:350`, `:384`, `:420`, `:442` |
| `test/body.test.ts` | `statusText` → `title` | `:457` |
| `test/body-limit.test.ts` | `message` → `detail` | `:120-122` |
| `test/validate.test.ts` | `statusText`/`message` → `title`/`detail` em corpos de erro | `:182-183`, `:194-196`, `:279-280`, `:288-290`, `:379-381` |
| Demais testes que leem corpo de erro | Varredura pela execução da suíte (ver seção 6) | candidatos: `test/json-rpc.test.ts` (ex.: 415 em `src/utils/json-rpc.ts:176`), `test/app.test.ts`, `test/handler.test.ts`, `test/middleware.test.ts`, `test/proxy.test.ts`, `test/route.test.ts`, `test/mount.test.ts` |
| `docs/1.guide/1.basics/6.error.md` | Exemplo JSON, lista de campos, TIP de campos ocultos | `:19-31`, `:36-52` (exemplo), `:54-60` (campos), `:76` (TIP sobre `message`), `:90` (TIP sobre campos ocultos) |

**Não alterar:** `src/utils/response.ts:347-354` (tabela restrita, D-05); `src/utils/json-rpc.ts:479-489` (respostas JSON-RPC são protocolo, não erro HTTP; a lógica de mascaramento dele é independente); `src/adapters.ts`, `src/_entries/*` (fora de escopo, PRD).

**Observação de tamanho.** `src/response.ts` já tem 380 linhas, acima da meta de 200 do AGENTS.md. A função nova é pequena e a tabela vai em arquivo próprio, então não há split obrigatório nesta entrega. Registrar como dívida, não como pré-requisito.

## 4. Contratos e assinaturas

### 4.1 `ErrorInput` e `HTTPError` (`src/error.ts`)

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  /** URI reference que identifica o tipo do problema (RFC 9457 §3.1.1). Sem valor, o corpo usa `about:blank`. */
  type?: string;
  /** URI reference que identifica esta ocorrência do problema (RFC 9457 §3.1.5). */
  instance?: string;
  // ...campos existentes sem alteração
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  /** URI reference do tipo do problema, ou `undefined`. */
  readonly type: string | undefined;
  /** URI reference desta ocorrência do problema, ou `undefined`. */
  readonly instance: string | undefined;
  // ...
}
```

Atribuição no construtor, após `this.body` (`src/error.ts:209`), sem fallback por `cause` (D-06):

```ts
this.type = (details as ErrorInput)?.type || undefined;
this.instance = (details as ErrorInput)?.instance || undefined;
```

`toJSON()` não muda (D-02).

### 4.2 Tabela de frases (`src/utils/internal/status-text.ts`, novo)

```ts
/** RFC 9110 reason phrases: the default RFC 9457 `title` for an error without `statusText`. */
export const REASON_PHRASES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  // ...todos os códigos de 4xx e 5xx da RFC 9110, mais os de 1xx-3xx com frase
  500: "Internal Server Error",
};
```

Escopo do mapa: os códigos definidos na RFC 9110 (sem extensões). Códigos sem entrada geram `title` omitido.

### 4.3 Renderização (`src/response.ts`)

```ts
const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

/**
 * RFC 9457 problem details for `error`. The RFC members are set last, so `data` and `body`
 * (extension members) can never override them. Unhandled errors expose no `detail`,
 * `instance`, `data` or `body`.
 */
function toProblemDetails(error: HTTPError): Record<string, unknown> {
  const hidden = !!error.unhandled;
  return {
    data: hidden ? undefined : error.data,
    ...(hidden ? undefined : error.body),
    type: hidden ? "about:blank" : (error.type ?? "about:blank"),
    title: error.statusText ?? REASON_PHRASES[error.status],
    status: error.status,
    detail: hidden ? undefined : error.message,
    instance: hidden ? undefined : error.instance,
  };
}

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

Nota de ordem: `problemHeaders` precisa ficar depois da declaração de `FrozenHeaders` (`src/response.ts:260`), como `jsonHeaders` (`:270`).

### 4.4 Exemplo de resposta (`HTTPError.status(404, "Not Found", { message: "Usuário não existe" })`)

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{"type":"about:blank","title":"Not Found","status":404,"detail":"Usuário não existe"}
```

Com `debug: true`, o corpo ganha `stack` como hoje.

## 5. Estratégia de testes

### 5.1 Suíte nova — `test/problem-details.test.ts`

Escrita antes da implementação e vermelha antes dela. Usa `describeMatrix` (AGENTS.md), então cada caso roda em `web` e `node`.

| Caso | Requisito | Verificação |
| --- | --- | --- |
| `HTTPError.status(404, "Not Found", {message})` | RF-01 | status 404, `content-type` exato `application/problem+json`, corpo `{type:"about:blank", title, status, detail}` |
| Erro sem `type` com `data: {campo: "email"}` | RF-02 | `type === "about:blank"`, `data.campo === "email"` |
| `body` com chaves `status`, `title`, `type` | RF-02 | membros da RFC permanecem os do erro |
| `new HTTPError({status: 404})` sem `statusText` | RF-02 | `title === "Not Found"` |
| Status sem entrada no mapa e sem `statusText` | RF-02 | `title` ausente no corpo |
| `new HTTPError({status: 403, type, instance})` | RF-03 | propriedades `error.type`/`error.instance` na instância e no corpo |
| `instance` ausente | RF-03 | chave `instance` ausente no corpo |
| `throw new Error("segredo do banco")` com debug desligado | RF-04 | 500, `application/problem+json`, `detail` e `stack` ausentes, texto secreto ausente do corpo |
| `unhandled` com `type` e `instance` definidos | RF-04 | `type === "about:blank"`, `instance` ausente |
| Modo debug ligado | RF-04 | `stack` presente como array de strings |
| `headers` do erro e `errHeaders` | compatibilidade | `x-error-own` e `x-error` presentes, `content-type` do problema mantido |
| HEAD em erro | compatibilidade | corpo vazio, sem `content-length` |
| `onError` que devolve `Response` própria | compatibilidade | resposta da hook devolvida sem alteração |
| `new HTTPError(...).toJSON()` | D-02 | retorno idêntico ao atual (snapshot do formato antigo) |

### 5.2 Ajustes de testes existentes (mapeamento 1:1)

Regra: troca só a forma, mantém o que o teste verifica (RF-05).

| Arquivo:linha | Antes | Depois | Intenção preservada |
| --- | --- | --- | --- |
| `test/errors.test.ts:44` | `toBe("application/json;charset=UTF-8")` | `toBe("application/problem+json")` | media type de erro |
| `test/errors.test.ts:53-57` | `statusText: "Unprocessable"` | `title: "Unprocessable"` | título |
| `test/errors.test.ts:79-85` | `statusText`, `message` | `title`, `detail` | título e detalhe; `data` e `topLevel` mantidos |
| `test/errors.test.ts:99-104` | `statusText`, `message` | `title`, `detail` | idem |
| `test/errors.test.ts:140` | `toMatch("application/json")` | `toMatch("application/problem+json")` | media type. Atenção: a substring antiga não bate com a nova |
| `test/errors.test.ts:144-150` | `statusText` | `title` | título; `data.message` mantido |
| `test/errors.test.ts:257`, `:309`, `:384`, `:420`, `:442` | `toMatchObject({status: 500, unhandled: true})` | `toMatchObject({status: 500})` + `detail` ausente + `title` `"Internal Server Error"` | o teste verifica que o erro é mascarado; a verificação agora é a ausência de `detail` |
| `test/errors.test.ts:350` | `toMatchObject({unhandled: true, message: "HTTPError"})` | `toMatchObject({status: 500})` + `detail` ausente | idem |
| `test/body.test.ts:457` | `resultJson.statusText` | `resultJson.title` | título; `stack` (`:458`) mantido |
| `test/body-limit.test.ts:120-122` | `message` | `detail` | detalhe |
| `test/validate.test.ts:182-183`, `:194-196`, `:279-280`, `:288-290`, `:379-381` | `statusText`, `message` (topo do corpo) | `title`, `detail` | título e detalhe; `data.*` não mexe |

Não alterar: `test/security.test.ts:556` (é resposta 200 de eco, não erro) e asserts sobre `res.statusText` (linha de status HTTP, não corpo), como em `test/status.test.ts`.

Os candidatos listados na seção 3 são uma varredura inicial. A lista exata sai da execução da suíte com a implementação: cada falha é um assert de formato antigo e deve ser tratada pela regra da tabela acima. Falha que não seja de formato é bug e não se ajusta.

### 5.3 Gates de verificação

1. `pnpm vitest run test/problem-details.test.ts` falha antes da implementação, pelos motivos esperados (teste vermelho confirmado).
2. `pnpm vitest run test/problem-details.test.ts` passa após a implementação.
3. `pnpm vitest run` completo: mesma cobertura de baseline (71 arquivos, 3091 testes), com apenas os asserts de formato alterados.
4. `pnpm typecheck` sem erros.
5. `pnpm lint` sem erros.
6. Diff revisado: nenhum teste removido; cada alteração de teste corresponde a uma linha da tabela da seção 5.2.

## 6. Riscos

1. **Quebra para consumidores (principal).** O formato padrão muda sem opção de volta (PRD, "Riscos"). Quem lê `statusText`, `message` ou `unhandled` do JSON quebra. **Pré-condição:** o time aceita explicitamente a quebra e decide se ela entra como mudança major ou com nota de release. Se não aceitar, a alternativa é D-01 (a), que contraria o contrato.
2. **Conflito "não quebrar" × "trocar o padrão".** A restrição só se cumpre se "quebrar" for lido como "mudar o formato padrão, mantendo a API de `HTTPError` compatível". Esta spec adota essa leitura (D-02). Confirmar com o time.
3. **`unhandled` removido do corpo (D-07).** Quem lia essa flag do JSON perde a informação. Confirmar; a alternativa é manter como extensão.
4. **`toJSON()` continua com o formato antigo (D-02).** `JSON.stringify(err)` e `err.toJSON()` não batem com a resposta HTTP. Documentar no JSDoc de `toJSON()`, se o time quiser.
5. **Colisão de extensões.** `body.data` sobrescreve `error.data` (comportamento atual preservado). Membros da RFC não podem ser sobrescritos por `body` (D-04).
6. **Content-Type estrito.** Clientes que checam `application/json` deixam de reconhecer o erro como JSON. `res.json()` do fetch não checa o media type, então os testes não detectam esse caso. Verificar clientes conhecidos fora do repo.
7. **Título herdado de `cause` em erros `unhandled`.** `statusText` é herdado do `cause` (`src/error.ts:183`) e, pelo D-07, é exposto como `title` mesmo para erros `unhandled`. Isso já acontece hoje, via `statusText` no `toJSON()`. Não é novo, mas o PRD fala em ocultação e o time pode querer fechar essa brecha separadamente.
8. **`instance` e `type` sem validação.** O valor é passado como informado. Quem cria `instance` com dados da requisição pode vazar informação; fica como responsabilidade de quem cria o erro.
9. **Consumidores fora do repositório não verificados.** Nitro e outros consumidores (PRD, "Fora de escopo") não foram lidos nem testados, por restrição de escopo do trabalho. Risco de quebra nesses pacotes não foi medido.
10. **Enfraquecimento dos testes.** Trocar `unhandled: true` por `detail` ausente pode esconder uma regressão se o masking deixar de existir por outro caminho. Mitigação: a suíte nova cobre `detail`, `stack` e o texto secreto em `web` e `node`.
11. **Documentação.** `docs/1.guide/1.basics/6.error.md` precisa refletir o novo formato. Outros arquivos do `docs/` casaram com a busca por `statusText|unhandled|toJSON|application/json` (`docs/1.guide/1.basics/5.response.md`, `docs/2.utils/2.response.md`, `docs/1.guide/900.api/1.h3.md`, `docs/1.guide/900.api/2.h3event.md`, `docs/5.migration/0.index.md`), mas não foram lidos um a um: verificar se tratam de erro HTTP antes de alterar. `MIGRATION.md` só casou com `getResponseStatusText`, não com o formato de erro.
12. **Tamanho de `src/response.ts`.** Já acima da meta (seção 3). A mudança não piora a situação de forma relevante.
