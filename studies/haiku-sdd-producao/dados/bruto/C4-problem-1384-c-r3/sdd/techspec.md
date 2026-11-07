# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

Origem: `sdd/pedido.md` (contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-11).
Escopo: adicionar `problem(input)` ao pacote `h3`. Só respostas de erros criados por `problem` mudam. `HTTPError`, `toJSON()` e o formato JSON atual ficam intactos.

## Contexto do código atual

- `HTTPError` (`src/error.ts:74`) guarda `status`, `statusText`, `message`, `data`, `body`, `unhandled` e `headers` (`src/error.ts:82-119`). O construtor aceita `ErrorDetails` (`src/error.ts:160-161`), e `ErrorInput` já traz `statusText`, `message`, `data`, `body` e `unhandled` (`src/error.ts:6`, `src/error.ts:30-68`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) é o formato atual: mascara `message` como `"HTTPError"` e omite `data` e `body` quando `unhandled` (`src/error.ts:232-234`).
- O tratamento de erro acontece em `prepareResponse` (`src/response.ts:146-174`). Erros que não são `HTTPError` são convertidos com `unhandled = true` (`src/response.ts:149-155`). A resposta de erro é montada por `errorResponse` (`src/response.ts:173`, definição em `src/response.ts:358-380`).
- `errorResponse` monta `Content-Type` a partir de `jsonHeaders`, um `FrozenHeaders` com `application/json;charset=UTF-8` (`src/response.ts:270-272`, uso em `src/response.ts:359-361`). Os `error.headers` e os `errHeaders` são mesclados por cima (`src/response.ts:359-364`).
- Já existe um padrão de marca interna por `Symbol.for`, para não ser forjável a partir de JSON: `kHTTPResponse` (`src/response.ts:94`, com a justificativa em `src/response.ts:86-93`).
- O pacote público vem de `src/index.ts`. A seção de erros exporta `HTTPError` e os tipos de entrada em `src/index.ts:70-72`. `src/_entries/generic.ts:7` faz `export * from "../index.ts"`.
- O snapshot dos exports do pacote está em `test/unit/package.test.ts:4-6`. Ele lista `parseCookies` em `test/unit/package.test.ts:104` e `proxy` em `test/unit/package.test.ts:105`.
- O harness `describeMatrix` (`test/_setup.ts`) cria um `H3` com `debug: true` por teste (`test/_setup.ts:117-137`) e, no `afterEach`, lança erro se algum erro `unhandled` foi registrado (`test/_setup.ts:153`). Testes com erro `unhandled` precisam limpar `t.errors` ou usar `allowUnhandledErrors`.
- Dependências de runtime são só `rou3` e `srvx` (`package.json`, seção `dependencies`). Não há tabela de frases de status (reason phrases) disponível em nenhuma delas.

## Decisões de arquitetura

### D-01 — Gatilho: função `problem` em arquivo próprio, que devolve `HTTPError`

**Escolha:** criar `src/problem.ts` com `problem(input: ProblemInput): HTTPError`. A função cria `new HTTPError(input)` e anexa a marca descrita em D-02.

**Alternativas consideradas:**
- Método estático `HTTPError.problem(...)`. Rejeitado: aumenta a superfície pública da classe, e o pedido quer o gatilho como função exportada.
- Nova classe `ProblemError extends HTTPError`. Rejeitado: `HTTPError.isError` exige `name === "HTTPError"` (`src/error.ts:129-133`), e uma subclasse com outro `name` quebraria o caminho atual de `prepareResponse` (`src/response.ts:147`). Também cria um tipo público novo, contra RF-08.
- Opção `format: "problem"` no construtor de `HTTPError`. Rejeitado: muda o tipo público `ErrorInput` e a classe, contra RF-08 e RF-06.

**Justificativa:** a função é a menor superfície possível. Ela devolve um `HTTPError` comum, então o caminho de lançar, retornar e `onError` continua o mesmo (RF-01).

### D-02 — Marca interna: símbolo `Symbol.for("h3.problem")` como propriedade não enumerável

**Escolha:** `problem` guarda `{ type, instance }` em `error[kProblem]`, com `Object.defineProperty` e sem `enumerable`. `kProblem` é exportado só para uso interno (`src/response.ts`), não de `src/index.ts`.

**Alternativas consideradas:**
- `WeakMap` em nível de módulo. Rejeitado: duas cópias do h3 no mesmo processo teriam dois `WeakMap` distintos, e a marca não seria reconhecida.
- Campos públicos `type` e `instance` em `HTTPError`. Rejeitado: muda o tipo público da classe, e `Object.keys` e spreads passariam a ver os campos.
- Propriedade enumerável. Rejeitado: vazaria em `{...error}` e em qualquer serialização feita por usuário.
- Símbolo sem `Symbol.for`. Rejeitado: não sobrevive a cópias duplicadas do módulo, o mesmo problema do `WeakMap`.

**Justificativa:** `Symbol.for` segue `kHTTPResponse` (`src/response.ts:94`). Propriedade não enumerável não aparece em `toJSON`, em spreads nem na superfície pública do tipo. Um JSON não consegue produzir um símbolo, então a marca não pode ser forjada por corpo de requisição (mesma razão documentada em `src/response.ts:86-93`).

### D-03 — Renderização: ramo em `errorResponse`, `HTTPError.toJSON()` fica intacto

**Escolha:** `errorResponse` (`src/response.ts:358`) escolhe o corpo e o `Content-Type` a partir de `error[kProblem]`. Se houver marca, usa `toProblemJSON` (definido em `src/problem.ts`). Se não houver, usa `error.toJSON()` como hoje.

**Alternativas consideradas:**
- Mudar `HTTPError.prototype.toJSON` para checar a marca. Rejeitado: `toJSON` não controla headers, então o `Content-Type` continuaria errado. Além disso mudaria o método público de `HTTPError`, contra RF-06.
- Um segundo caminho em `prepareResponse`. Rejeitado: duplicaria a lógica de `errHeaders`, de `onError` e de `kEventRes` (`src/response.ts:159-173`).

**Justificativa:** um único ponto de decisão. Erros sem marca passam pelo mesmo código de hoje, então RF-06 fica garantido pela estrutura e não só por teste.

### D-04 — Mapeamento de campos

**Escolha:**

| Membro RFC 9457 | Origem |
|---|---|
| `type` | `input.type`, ou `"about:blank"` se ausente (`??`) |
| `title` | `error.statusText`, ou a frase padrão do status (D-05). Se não houver nenhuma, o membro é omitido |
| `status` | `error.status` |
| `detail` | `error.message` |
| `instance` | `input.instance`, omitido se ausente |

**Alternativas consideradas:**
- `title` = `message` e `detail` = `statusText`. Rejeitado: contraria o uso comum da RFC, em que `title` é curto e estável por tipo, e `detail` é específico da ocorrência.
- Sempre enviar `title` com a frase padrão, ignorando `statusText`. Rejeitado: o exemplo de RF-03 espera `title` "Forbidden" vindo de `statusText`.

**Justificativa:** segue o que `prd.md` (premissa 1) descreve. **Pendente de confirmação** antes da implementação, como a própria premissa pede.

### D-05 — Frases padrão de status: tabela interna

**Escolha:** tabela `DEFAULT_TITLE` em `src/problem.ts`, com as frases do IANA HTTP Status Code Registry para os códigos 4xx e 5xx. Para outros códigos sem `statusText`, `title` é omitido.

**Alternativas consideradas:**
- Importar de `node:http` (`STATUS_CODES`). Rejeitado: `node:http` não existe nos entries genéricos e não é Web Standard (`AGENTS.md`, "Web standards first").
- Adicionar dependência npm. Rejeitado: `AGENTS.md` limita dependências de produção a duas, e esta mudança não justifica uma terceira.
- Tabela completa com todos os códigos. Rejeitado: maior do que o necessário para o caso de erro. Os códigos 2xx e 3xx não são erros.

**Justificativa:** cobre os erros que um handler realmente lança, dentro da regra de arquivos curtos (`AGENTS.md`, menos de 200 linhas). **Risco:** a tabela precisa ser mantida em sincronia com o registro IANA. Ver Riscos.

### D-06 — Membros de extensão: `body` espalhado, `data` como membro próprio

**Escolha:** `error.body` vira membros de nível superior. `error.data` vira o membro `data` (não é espalhado). Os membros padrão são colocados depois dos de extensão, então prevalecem em caso de colisão (RF-05).

**Alternativas consideradas:**
- Espalhar `data` também. Rejeitado: `data` pode ser qualquer valor, e espalhar um não-objeto não produz nada útil.
- Manter tudo dentro de `data`. Rejeitado: contraria RF-05 e a recomendação da RFC 9457 (seção 3.2).

**Justificativa:** segue RF-05. Um detalhe de implementação: `data` só entra quando `error.data !== undefined`. Caso contrário, `{ ...body, data: undefined }` apagaria um `body.data` existente.

**Pendente de confirmação:** o pedido não distingue os dois casos. Ver Riscos.

### D-07 — Erros `unhandled`: detalhes ocultos com a mesma regra de segurança

**Escolha:** quando `error.unhandled` é verdadeiro, `toProblemJSON` omite `detail`, `data` e os membros de `body`. Mantém `type`, `title`, `status` e `instance`. `errorResponse` mantém o campo `stack` apenas em modo debug, como hoje.

**Alternativas consideradas:**
- Manter `detail` com o texto `"HTTPError"`, como faz `toJSON` (`src/error.ts:232`). Rejeitado: é um valor sem significado, e a RFC pede dados úteis. Omitir é mais limpo e não vaza nada.
- Expor `message` mesmo em `unhandled`. Rejeitado: contraria RF-07 e a documentação de `unhandled` (`src/error.ts:53-57`).

**Justificativa:** RF-07 exige só que a mensagem interna não apareça. Omitir `detail` atende isso sem inventar um valor.

### D-08 — `Content-Type`: `application/problem+json` como base, com headers do usuário por cima

**Escolha:** `errorResponse` usa, como base para erros com marca, um `FrozenHeaders` com `content-type: application/problem+json`, no mesmo molde de `jsonHeaders` (`src/response.ts:270-272`). `error.headers` e `errHeaders` continuam sobrescrevendo, como hoje (`src/response.ts:359-364`).

**Alternativas consideradas:**
- Acrescentar `; charset=UTF-8`. Rejeitado: RF-03 pede o valor exato, e JSON é UTF-8 por definição (RFC 8259).
- Proibir `content-type` vindo do usuário em erros de problema. Rejeitado: cria um caso especial sem necessidade, e o comportamento atual já permite sobrescrever.

**Justificativa:** o comportamento de sobrescrita continua o mesmo de hoje, então não há regra nova para ensinar.

### D-09 — Escopo da marca: só o erro que recebe a marca

**Escolha:** a marca vale apenas para o `HTTPError` devolvido por `problem`. Um `new HTTPError({ cause: erroDeProblema })` herda `status` e `statusText` do `cause` (`src/error.ts:172-193`), mas não herda a marca.

**Alternativas consideradas:**
- Propagar a marca pela cadeia de `cause`. Rejeitado: é mágica implícita, e o pedido não pede isso.
- Ler a marca de `cause` na renderização. Rejeitado pelo mesmo motivo.

**Justificativa:** comportamento previsível e fácil de explicar. Erros que envolvem um problema continuam no formato atual. Documentar isso no JSDoc de `problem`.

## Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `src/problem.ts` | **Novo.** `ProblemInput`, `kProblem`, `problem()`, `toProblemJSON()`, `DEFAULT_TITLE`. |
| `src/response.ts` | Importar `kProblem`, `toProblemJSON`. Ramo em `errorResponse` (`src/response.ts:358-380`) para o corpo e a base de headers. Um `FrozenHeaders` novo ao lado de `jsonHeaders` (`src/response.ts:270-272`). |
| `src/index.ts` | Exportar `problem` e `type ProblemInput` na seção `// Error` (`src/index.ts:70-72`). |
| `test/problem.test.ts` | **Novo.** Testes de integração com `describeMatrix` (ver Estratégia). |
| `test/unit/problem.test.ts` | **Novo.** Testes unitários de `problem()` e da propriedade não enumerável. |
| `test/unit/package.test.ts` | Inserir `"problem",` entre `"parseCookies"` (`test/unit/package.test.ts:104`) e `"proxy"` (`test/unit/package.test.ts:105`). Ajuste único exigido por RF-08. |
| `test/unit/types.test-d.ts` | Opcional: `expectTypeOf` para `ProblemInput`, cobrindo `type` e `instance` (RF-02). |

**Não alterar:** `src/error.ts` (D-03 e D-09) e `test/errors.test.ts`. O teste existente em `test/errors.test.ts:140` continua válido, porque erros sem marca mantêm `application/json`.

## Contratos e assinaturas

```ts
// src/problem.ts
import { HTTPError, type ErrorInput } from "./error.ts";

/**
 * Entrada de `problem`: os campos de `ErrorInput` mais os membros opcionais da RFC 9457.
 */
export interface ProblemInput extends ErrorInput {
  /** URI que identifica o tipo do problema. Padrão: `"about:blank"`. */
  type?: string;
  /** URI reference que identifica esta ocorrência do problema. */
  instance?: string;
}

/** Marca interna. Registro global, para funcionar com cópias duplicadas do módulo. */
export const kProblem: symbol = /* @__PURE__ */ Symbol.for("h3.problem");

/** Membros guardados na marca. Não exportado. */
export interface ProblemMembers {
  type: string;
  instance: string | undefined;
}

export function problem(input: ProblemInput): HTTPError;

export function toProblemJSON(error: HTTPError, members: ProblemMembers): Record<string, unknown>;
```

Comportamento de `problem`:

- Cria `new HTTPError(input)`. `input` não é mutado.
- Define `error[kProblem] = { type: input.type ?? "about:blank", instance: input.instance }` com `Object.defineProperty`, `enumerable: false`, `writable: false`, `configurable: false`.
- Devolve o erro. Não faz nada além disso (RF-01, RF-02).

Comportamento de `toProblemJSON`, na ordem:

1. `unhandled = error.unhandled`.
2. Extensões: `unhandled ? {} : { ...error.body, ...(error.data !== undefined ? { data: error.data } : {}) }`.
3. Retorno: `{ ...extensões, type: members.type, title: error.statusText || DEFAULT_TITLE[error.status], status: error.status, detail: unhandled ? undefined : error.message, instance: members.instance }`. `undefined` é descartado pelo `JSON.stringify`.

Alteração em `errorResponse`, em forma de esboço:

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const members = (error as any)[kProblem] as ProblemMembers | undefined;
  let headers: Headers = error.headers
    ? mergeHeaders(members ? problemHeaders : jsonHeaders, error.headers)
    : new Headers(members ? problemHeaders : jsonHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  const body = members ? toProblemJSON(error, members) : error.toJSON();
  return new FastResponse(
    JSON.stringify(
      { ...body, stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

`problemHeaders` é um `FrozenHeaders` com `content-type: application/problem+json`, criado ao lado de `jsonHeaders` (`src/response.ts:270-272`).

Exports: `src/index.ts` ganha exatamente `problem` (valor) e `ProblemInput` (tipo). `kProblem`, `toProblemJSON` e `ProblemMembers` não são exportados (RF-08).

## Estratégia de testes

Seguir o fluxo de correção do `AGENTS.md`: primeiro os testes de regressão, confirmar que falham, depois implementar.

### Testes primeiro (devem falhar antes da implementação)

`test/problem.test.ts`, com `describeMatrix` (cobre `web` e `node`, RF-10):

1. **RF-03, forma e content-type.** Handler lança `problem({ status: 403, statusText: "Forbidden", message: "Token expirado" })`. Espera status 403, `content-type` igual a `application/problem+json`, e corpo com `status: 403`, `title: "Forbidden"`, `detail: "Token expirado"`, `type: "about:blank"`.
2. **RF-03, retorno em vez de lançamento.** Mesmo caso, com `return problem(...)`.
3. **RF-04.** `problem({ status: 500, message: "Falha" })` sem `type`. Espera `type: "about:blank"` e `title: "Internal Server Error"`.
4. **RF-02, `type` e `instance`.** Espera os valores informados no corpo.
5. **RF-05, extensões.** `problem({ status: 422, message: "Dados inválidos", body: { campo: "email" } })`. Espera `campo: "email"` no topo.
6. **RF-05, colisão.** `body: { status: 999, type: "x", title: "y" }`. Espera que `status`, `type` e `title` sejam os padrão.
7. **RF-05, `data`.** `data: { a: 1 }` vai para a chave `data`. Caso `body: { data: "x" }` sem `data`: a chave `data` do corpo sobrevive.
8. **RF-06.** `HTTPError.status(404, "Not Found")` mantém `application/json` e o corpo atual (comparar com `toJSON`).
9. **RF-07.** Com `t.app.config.debug = false`, `problem({ status: 500, message: "senha do banco: x", unhandled: true })`. Espera corpo sem a string `senha do banco: x`. Este teste precisa limpar `t.errors` (ou usar `allowUnhandledErrors`) e silenciar `console.error`, senão `afterEach` falha (`test/_setup.ts:153`).
10. **Headers do usuário.** `problem({ ..., headers: { "x-erro": "1" } })` mantém `x-erro`. `headers: { "content-type": "text/plain" }` sobrescreve, como hoje.
11. **HEAD.** Requisição HEAD com erro de problema retorna sem corpo e com o mesmo content-type.
12. **`onError`.** `onError` configurado e que retorna `undefined` ainda entrega o formato de problema.

`test/unit/problem.test.ts`:

13. **RF-01.** `problem({ status: 404, message: "Usuário não encontrado" })` é `instanceof HTTPError`, com `status` 404 e `message` correto. `HTTPError.isError` devolve `true`.
14. **D-02.** `Object.keys(err)` e `JSON.stringify(err)` não contêm `type` nem `instance`. A marca existe via `Object.getOwnPropertySymbols`.
15. **D-09.** `new HTTPError({ cause: problem({ status: 404 }) })` não produz formato de problema.

`test/unit/package.test.ts`:

16. **RF-08.** O snapshot de exports passa a ter `"problem"` e nada mais. Este é o único ajuste em teste existente, e só adiciona uma linha.

### Regressão

- `pnpm vitest run test/errors.test.ts test/unit/package.test.ts`: deve continuar passando sem edições fora do snapshot.
- `pnpm test`: lint, typecheck e suíte completa com cobertura. Esse é o critério de RF-09 e RF-11.
- `pnpm build` seguido de `pnpm vitest run test/dist.test.ts`: confirma que o bundle não remove `problem` nem `kProblem` por tree-shaking. O `dist.test.ts` existente cobre exatamente esse tipo de problema (`test/dist.test.ts:4-8`). Vale adicionar um caso para `problem` ali, se a suíte de dist for mantida.

## Riscos

1. **Mapeamento de `title` e `detail` (premissa 1 do PRD).** Se o time esperar outro mapeamento, a mudança é pequena, mas a especificação e os testes 1 a 3 precisam ser ajustados. **Confirmar antes de implementar.**
2. **Semântica de `data` (D-06).** O PRD diz "membros de extensão no nível superior", e a leitura de `data` como chave própria é uma interpretação. Se o time quiser espalhar `data`, a mudança é só em `toProblemJSON`, mas os testes 5 e 7 mudam. **Confirmar.**
3. **Omissão de `detail` em `unhandled` (D-07).** A alternativa é manter `"HTTPError"`, como `toJSON`. **Confirmar se o time prefere consistência com `toJSON` ou ausência do campo.**
4. **Tabela de frases padrão (D-05).** É código a manter e pode ficar defasada em relação ao registro IANA. Mitigação: incluir só 4xx e 5xx e um teste que compara a tabela com um conjunto fixo de códigos usados em `src/`.
5. **Marca perdida em `cause` ou em `onError`.** Um erro de problema envolvido em outro `HTTPError` (D-09), ou substituído por `onError` que devolve outro erro, sai no formato atual. É o comportamento esperado, mas deve estar na documentação de `problem`.
6. **Colisão de membros de extensão.** `body` com chaves `status`, `type`, `title`, `detail` ou `instance` é sobrescrito pelos membros padrão (D-06). Mitigação: teste 6.
7. **Vazamento em modo debug.** Com `debug: true`, `stack` aparece também nas respostas de problema, igual às respostas atuais. Não é mudança de segurança, mas é fácil de confundir com vazamento novo. Mitigação: teste 9 roda com `debug: false`.
8. **Testes existentes com `t.errors`.** Testes de `unhandled` precisam limpar `t.errors` (`test/_setup.ts:153`). Esquecer isso gera falha em `afterEach` e não no teste em si. Mitigação: seguir o padrão de `test/errors.test.ts:116`.
9. **Quebra silenciosa de `HTTPError.toJSON()`.** Não há mudança prevista, mas o teste 8 existe para garantir isso.
10. **Crescimento de escopo.** Pedidos como "converter todos os erros", "catálogo de tipos" ou `application/problem+xml` estão fora do escopo do PRD. Manter a seção "Fora de escopo" como referência em revisão.
