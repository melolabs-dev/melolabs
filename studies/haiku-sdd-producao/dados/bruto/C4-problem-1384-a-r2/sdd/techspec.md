# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-09). Este documento não altera código; as referências `arquivo.ts:linha` foram conferidas no clone em `master` (commit `2c83bcf`).

## 1. Visão geral

A opção `problemDetails` (booleana, padrão `false`) em `H3Config` faz com que os erros gerados pelo h3 sejam serializados como `application/problem+json`. O ponto de mudança é a função interna `errorResponse` em `src/response.ts`, que já recebe o `config` do app por `toResponse`. Nada muda quando a opção está desligada.

Fluxo atual de um erro (para referência):

1. `H3Core["~request"]` chama `toResponse(handlerRes, event, this.config)` (`src/h3.ts:99`).
2. `prepareResponse` normaliza o erro em `HTTPError` (`src/response.ts:146-148`), executa `onError` (`src/response.ts:159-166`) e, sem retorno de `onError`, chama `errorResponse(error, config.debug, errHeaders)` (`src/response.ts:173`).
3. `errorResponse` monta o corpo com `error.toJSON()` + `stack` (`src/response.ts:358-380`).

A mudança substitui apenas o passo 3 quando `config.problemDetails` é verdadeiro, e acrescenta `type`/`instance` a `HTTPError`.

## 2. Decisões de arquitetura

### D-01 — Leitura da opção pelo `config` já existente

- **Escolha:** a opção é lida em `errorResponse` via `config.problemDetails`, usando o `config` que `toResponse` já recebe. Não há estado novo em `H3Core`, `H3Event` nem em `app.config`.
- **Alternativas:** (a) guardar a flag em `H3Event` a cada requisição; (b) ler `event.app.config` dentro de `errorResponse`.
- **Justificativa:** `config` já chega a `prepareResponse` e a `errorResponse` recebe `config.debug` pelo mesmo caminho (`src/response.ts:173`). Seguir o padrão existente é a mudança de menor superfície. A opção (b) não funciona para `toResponse` chamado sem app (ver D-09).

### D-02 — Renderização em função interna, sem método público novo

- **Escolha:** uma função não exportada `problemDetailsBody(error, debug)` no fim de `src/response.ts`, seguindo a convenção "helpers internos no fim do arquivo" (`AGENTS.md`, seção Style).
- **Alternativas:** (a) método `HTTPError.prototype.toProblemJSON()`; (b) export público do serializador.
- **Justificativa:** `prd.md` (RF-05 e Fora de escopo) proíbe nomes públicos novos além de `type` e `instance`. Um método em `HTTPError` seria um nome público.

### D-03 — `type` e `instance` como campos opcionais de entrada e readonly na instância

- **Escolha:** `type?: string` e `instance?: string` em `ErrorInput` (não em `ErrorBody`); na classe, `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor como `statusText`/`data`.
- **Alternativas:** (a) pôr em `ErrorBody`, que é a base de `toJSON()`; (b) aceitar os campos só como extensão do tipo `ErrorDetails`.
- **Justificativa:** `ErrorBody` define o tipo de retorno de `toJSON()` (`src/error.ts:226`). Colocar `type`/`instance` lá faria o formato atual (com a opção desligada) passar a ter chaves tipadas que não emite. `ErrorInput` já é o lugar dos campos de entrada que não vão para o JSON atual (`headers`, `cause`, `statusCode`).

### D-04 — `type`/`instance` lidos só do objeto de entrada

- **Escolha:** `this.type = (details as ErrorInput)?.type` e o mesmo para `instance`, sem fallback para `details.cause`.
- **Alternativas:** seguir o padrão de `status`/`statusText`, que cai em `details.cause` (`src/error.ts:172-185`).
- **Justificativa:** `pedido.md` e `prd.md` (RF-05) falam do "objeto de entrada do construtor". Fallback para `cause` faria um erro envolvido herdar `type` sem que o autor do `throw` o tenha pedido. Esta é uma escolha minha; se quiserem o fallback, é uma linha.

### D-05 — `Content-Type` exato `application/problem+json`

- **Escolha:** cabeçalho base `application/problem+json`, sem `;charset=UTF-8`.
- **Alternativas:** reaproveitar `jsonHeaders` (`application/json;charset=UTF-8`, `src/response.ts:270-272`) só trocando o media type.
- **Justificativa:** RF-03 pede igualdade com `application/problem+json`. JSON é UTF-8 por definição (RFC 8259), então o parâmetro é desnecessário.

### D-06 — Mapeamento dos membros e precedência

- **Escolha:**
  - `type` = `error.type ?? "about:blank"` (RFC 9457 §4.2.1);
  - `title` = `error.statusText` (omitido quando indefinido). Não há tabela de frases padrão no projeto (busca por `STATUS_CODES`/`statusMessages` sem resultado em `src/`), então não há fallback;
  - `status` = `error.status`; `detail` = `error.message`; `instance` = `error.instance` (omitido quando indefinido);
  - membros de extensão: `error.body` e `data` (quando não `unhandled`), e `stack` quando `debug` (mesma regra de `src/response.ts:369`);
  - precedência: membros de extensão são espalhados **antes** dos membros padrão, então um `body` com chave `status` ou `type` não sobrescreve o membro padrão.
- **Alternativas:** (a) membros padrão antes da extensão (a extensão sobrescreveria `type`/`status`); (b) manter `unhandled` no corpo, como `toJSON()` faz hoje.
- **Justificativa:** (a) permitiria a um `body` mudar o status lógico do erro no corpo — inaceitável. (b) `unhandled` não é membro da RFC; é flag interna, e o `detail: "HTTPError"` já sinaliza a mascaragem (`src/error.ts:232`). Omitido.

Forma final do objeto (ordem de chaves = ordem de inserção):

```ts
function problemDetailsBody(error: HTTPError, debug?: boolean): Record<string, unknown> {
  const unhandled = error.unhandled;
  return {
    ...(unhandled ? undefined : error.body),
    ...(unhandled ? undefined : { data: error.data }),
    ...(debug && error.stack ? { stack: error.stack.split("\n").map((l) => l.trim()) } : undefined),
    type: error.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? "HTTPError" : error.message,
    instance: error.instance,
  };
}
```

Observação: `JSON.stringify` omite `undefined`, então `title` e `instance` somem sozinhos quando ausentes.

### D-07 — Erros não tratados e debug

- **Escolha:** `unhandled` segue a regra atual de `toJSON()` (`src/error.ts:232-234`): `detail` vira `"HTTPError"`, `data` e `body` saem. `stack` aparece só com `debug: true`, como hoje (`src/response.ts:369`). A indentação segue `debug ? 2 : undefined` (`src/response.ts:372`).
- **Justificativa:** RF-06 e RF-07; é o ponto de maior risco de vazamento (`prd.md`, Riscos).

### D-08 — Quais erros recebem o formato

- **Escolha:** todo erro que chega a `errorResponse` recebe o formato problem details. Isso inclui: erros lançados, `kNotFound` (que vira `HTTPError` 404 em `src/response.ts:139-144`), erros lançados por `onError` (`.catch(toError)` e `nested` em `src/response.ts:162-165`) e erros promovidos a 500 não tratados. Valores retornados por `onError` que **não** são erro seguem o caminho normal de `prepareResponseBody` (não são "erros gerados pelo h3").
- **Justificativa:** é o comportamento que `prd.md` (Premissas) descreve, e não exige nenhum desvio no código além de `errorResponse`.

### D-09 — Chamadas de `toResponse` sem `config` (cache e middleware)

- **Escolha:** em três pontos, `toResponse` é chamado sem o `config` do app. Passo a passar apenas a flag, sem o `config` inteiro:
  - `src/rules/cache.ts:314` (dentro do `toResponse` do `ocacheDefineCachedHandler`);
  - `src/utils/middleware.ts:26` (`onResponse`).
  - `src/handler.ts:122` não tem app (`new H3Event(req)` sem terceiro argumento, `src/handler.ts:120`); fica como está.
  Forma: `toResponse(value, event, { problemDetails: event.app?.config.problemDetails })`.
- **Alternativas:** (a) passar `event.app.config` inteiro — executaria `onResponse` e `onError` do app uma segunda vez, dentro do cache; (b) não mexer — um `kNotFound` retornado (não lançado) por handler cacheado sairia no formato antigo e ficaria gravado no cache.
- **Justificativa:** (a) é inaceitável; (b) quebra a garantia de RF-01/RF-03 em rotas com cache. `prd.md` (Riscos, "Caminhos de cache") pede para confirmar e cobrir por teste.
- **Observação:** `debug` continua não sendo passado nesses pontos, como hoje. Não é escopo deste trabalho.

### D-10 — `errHeaders` e `set-cookie`

- **Escolha:** sem mudança de lógica. `errorResponse` continua mesclando `errHeaders` uma única vez e `prepareResponse` continua limpando `event.res` antes (`src/response.ts:172`), o que impede a duplicação de `set-cookie` (`src/response.ts:167-171`).
- **Justificativa:** RF-08. O novo formato usa a mesma função de cabeçalho.

### D-11 — Precedência de cabeçalhos do erro

- **Escolha:** mantém a ordem atual: `error.headers` (`HTTPError`) sobrescreve o cabeçalho base, e `errHeaders` vem por último. Com a opção ligada, a base é `application/problem+json`, então `error.headers` pode trocar o `content-type`, como já acontece com o JSON atual.
- **Justificativa:** consistência com o comportamento atual; não é um novo vetor de risco.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/types/h3.ts` | Adicionar `problemDetails?: boolean` em `H3Config` com JSDoc (padrão `false`). Ver `src/types/h3.ts:28-53`, inserir após `allowMalformedURL` (`src/types/h3.ts:46`). |
| `src/error.ts` | `ErrorInput` ganha `type?`/`instance?` (`src/error.ts:6-26`); classe ganha `readonly type`/`readonly instance` (após `readonly body`, `src/error.ts:112`); construtor atribui (após `src/error.ts:209`). `toJSON()` (`src/error.ts:226-236`) **não muda**. |
| `src/response.ts` | `errorResponse` (`src/response.ts:358-380`) recebe `config` em vez de `debug` e escolhe corpo/cabeçalho; chamada em `src/response.ts:173` muda para `errorResponse(error, config, errHeaders)`. Novo `problemDetailsBody` e `problemHeaders` (`new FrozenHeaders({ "content-type": "application/problem+json" })`, junto de `jsonHeaders` em `src/response.ts:270-272`). |
| `src/rules/cache.ts` | `src/rules/cache.ts:314` passa `{ problemDetails }` (D-09). |
| `src/utils/middleware.ts` | `src/utils/middleware.ts:26` passa `{ problemDetails }` (D-09). |
| `test/problem-details.test.ts` | Novo arquivo (ver seção 5). |
| `test/rules/cache.test.ts` | Um caso para D-09. |
| `docs/1.guide/1.basics/6.error.md` | Seção curta sobre `problemDetails` e a diferença de mapeamento (`message` → `detail`, `statusText` → `title`). Não é obrigatório para o contrato, mas `prd.md` (Riscos) pede documentar. |

Não há alteração em `src/_entries/*`, `src/index.ts` (já exporta `HTTPError` e `ErrorInput`, `src/index.ts:72`) nem em `package.json`.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts — H3Config (novo campo)
/**
 * When enabled, errors generated by H3 are rendered as RFC 9457 problem details
 * (`application/problem+json`). Disabled by default.
 */
problemDetails?: boolean;

// src/error.ts — ErrorInput (novos campos)
type?: string;      // RFC 9457 `type` URI reference
instance?: string;  // RFC 9457 `instance` URI reference

// src/error.ts — HTTPError (novas propriedades públicas, somente leitura)
readonly type: string | undefined;
readonly instance: string | undefined;

// src/response.ts — internos, não exportados
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
function problemDetailsBody(error: HTTPError, debug?: boolean): Record<string, unknown>;
const problemHeaders: Headers; // FrozenHeaders
```

Contratos observáveis (com `problemDetails: true`):

- Status: o do erro (`error.status`), igual ao atual.
- `Content-Type`: `application/problem+json`, exato.
- Corpo: `{ type, title?, status, detail, instance? }` + extensões (`body`, `data`, `stack` em debug).
- Com `problemDetails` ausente ou `false`: nenhuma linha de `toJSON()` ou de `errorResponse` muda de saída.

Tipo de `ErrorDetails` (`src/error.ts:28`) já aceita `ErrorInput`, então `new HTTPError({ status, type, instance })` compila sem mudança adicional. O `isolatedDeclarations` exige anotação explícita nas novas propriedades (já incluída acima).

## 5. Estratégia de testes

Seguindo `AGENTS.md` (Bug Fix Workflow adaptado a feature): escrever os testes antes da implementação e confirmar que falham com `pnpm vitest run test/problem-details.test.ts`.

**Arquivo novo `test/problem-details.test.ts`**, com `describeMatrix` (web e node, `AGENTS.md` Testing):

1. Padrão: `app.config.problemDetails` é `undefined`/`false` (RF-01).
2. Desligada: erro 404 com `message: "x"` gera `Content-Type: application/json;charset=UTF-8` e o mesmo corpo que `toJSON()` (RF-02). Usar `toEqual` com o corpo esperado, não só `toMatchObject`, para pegar regressão de chave.
3. Ligada: `HTTPError.status(400, "Bad Request")` → 400 e `application/problem+json` (RF-03).
4. Corpo completo: o exemplo de RF-04 (403, `type`, `instance`) deve sair como `toEqual({ type, title: "Forbidden", status: 403, detail: "Sem permissão", instance: "/pedidos/42" })`.
5. `type` ausente → `"about:blank"`; `instance` ausente → chave ausente (`not.toHaveProperty`); `statusText` ausente → `title` ausente.
6. Não tratado (`new Error("segredo do banco")`): `status: 500`, `detail: "HTTPError"`, string secreta ausente do corpo (RF-06). Também verificar que `body`/`data` de um `HTTPError` `unhandled` não saem.
7. `debug: true`: corpo contém `stack` (array) e está indentado (RF-07). Com `debug` desligado, `stack` não existe.
8. `onError` + cookie em `event.res.errHeaders.append("set-cookie", ...)` + erro 401: `headers.getSetCookie()` tem o cookie uma única vez e `onError` foi chamado (RF-08). Espelhar o caso de `test/errors.test.ts:27-36` e `:203-210`.
9. `kNotFound` (rota inexistente) → 404 em problem details.
10. Colisão: `body: { status: 999, type: "x" }` não sobrescreve `status` nem `type` padrão (D-06).
11. Erro lançado pelo `onError` (hook que lança) → 500 em problem details (D-08).
12. `HEAD` → sem corpo, `Content-Type` ainda problem+json (`nullBody`, `src/response.ts:350-356`).
13. Unitário de `HTTPError`: `type` e `instance` são lidos da entrada e ficam `undefined` quando ausentes (RF-05). Pode ser em `test/unit/error.test.ts` (novo) ou no mesmo arquivo.

**`test/rules/cache.test.ts`:** handler cacheado que retorna `kNotFound` (não lança) com `problemDetails: true` → resposta em problem details (D-09). Ver o arquivo para o helper de cache já usado.

**Não alterar** `test/errors.test.ts`. O assert de `content-type` em `test/errors.test.ts:44` depende de a opção estar desligada, e não deve mudar. Se algum teste existente quebrar, a suposição deste documento está errada e deve ser investigada antes de ajustar o teste (RF-09 exige não enfraquecer verificações).

**Tipos:** `pnpm typecheck` cobre os novos campos. Se houver `test/unit/types.test-d.ts` para `HTTPError`, incluir `expectTypeOf(err.type).toEqualTypeOf<string | undefined>()` (não verificado: o arquivo existe em `test/unit/`, mas não li seu conteúdo).

**Comandos de verificação:** `pnpm vitest run test/problem-details.test.ts`, `pnpm vitest run test/errors.test.ts test/rules/cache.test.ts`, `pnpm lint`, `pnpm typecheck`, depois `pnpm test` completo.

## 6. Riscos

| Risco | Probabilidade | Mitigação |
| --- | --- | --- |
| Clientes que leem `message`/`statusText` deixam de encontrá-los ao ligar a opção. | Alta, quando ligada | Opção desligada por padrão; documentar o mapeamento em `6.error.md`. |
| Vazamento de detalhes internos em erros não tratados ou em debug. | Média | D-07; testes 6 e 7. |
| `body` com chaves colidindo com membros padrão mudaria o erro lógico. | Baixa | D-06 (padrão vence); teste 10. |
| `set-cookie` duplicado. | Baixa (lógica não muda) | D-10; teste 8. |
| Erro retornado (não lançado) por handler cacheado sai no formato antigo e fica gravado no cache. | Média | D-09; teste de `test/rules/cache.test.ts`. |
| `HTTPError.isError` aceitar erros de outras bibliotecas. | Nenhuma alteração | `src/error.ts:129-133` não muda; a nova renderização usa `HTTPError.isError` como hoje (`src/response.ts:147`). |
| Sub-app montado com `problemDetails` diferente do app raiz. | Baixa | Erros são renderizados pelo `config` do app que despachou a requisição (`src/h3.ts:99`). Documentar: a opção vale para o app que recebe a requisição. |
| `title` ausente quando `statusText` não foi informado. | Média (comportamento, não bug) | RFC 9457 torna `title` opcional. Se quiserem sempre `title`, é preciso adicionar a tabela de frases padrão, que hoje não existe no projeto. |
| `type`/`instance` aceitos como strings sem validação de URI. | Baixa | Não validar (RFC aceita URI-reference; validação é escopo fora). Mencionar na documentação. |
| `pnpm` e dependências não instaladas neste clone. | Não verificado | Rodar `corepack enable && pnpm install` antes da implementação. Nada foi executado nesta etapa. |

## 7. Itens em aberto para confirmação

1. D-04: `type`/`instance` sem fallback para `cause` — confirmar.
2. D-06: `unhandled` não aparece no formato problem details — confirmar.
3. D-09: passar só `problemDetails` (e não `debug`) nos pontos de cache/middleware — confirmar que é aceitável ficar sem stack nesses casos, como já é hoje.
