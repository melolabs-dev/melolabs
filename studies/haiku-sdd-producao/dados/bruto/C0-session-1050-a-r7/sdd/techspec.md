# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md`. Esta especificação não altera código; descreve a mudança a ser feita.

## 1. Resumo da abordagem

`SessionConfig.password` passa a ser `string | string[]`. Toda a lógica de lista fica em `src/utils/session.ts`, em torno das chamadas existentes a `seal`/`unseal` de `src/utils/internal/iron-crypto.ts`, que continuam recebendo uma senha por chamada e não mudam. A selagem usa a primeira senha. A abertura percorre a lista em ordem. Uma sessão aberta com senha que não é a primeira é re-selada por `getSession`, reaproveitando o mecanismo que hoje re-sela os seals legados.

## 2. Decisões de arquitetura

### D-01 — Tipo público: `string | string[]`

- **Alternativas:** (a) `string | [string, ...string[]]` (tupla não vazia); (b) `string | string[]`; (c) opção nova `extraUnsealPasswords`.
- **Escolha: (b).**
- **Justificativa:**
  - (c) está fora de escopo (PRD, "Fora de escopo"; pedido, "Nenhum outro nome público novo").
  - (a) rejeitaria em tempo de compilação o array vazio, mas quem monta a lista a partir de variável de ambiente (`secrets.split(",")`) tem `string[]` e não consegue passá-lo sem cast.
  - Com (a) o RF-05 ainda exigiria a checagem em tempo de execução, então o ganho de tipo seria pequeno e o custo de uso, alto.
  - (b) é um alargamento do tipo, compatível com todo código que passa `string`.
- **Efeito:** só muda `src/utils/session.ts:48`. Nenhum export novo em `src/index.ts` (o tipo `SessionConfig` já é exportado em `src/index.ts:203`).

### D-02 — Normalização e validação em um helper interno não exportado

- **Alternativas:** (a) repetir a normalização em `sealSession`, `unsealSession` e `getSession`; (b) helper local no fim de `session.ts`; (c) helper em `src/utils/internal/session.ts`.
- **Escolha: (b)**, função local `resolvePasswords(config: SessionConfig): string[]`.
  - Devolve `[config.password]` para `string`.
  - Devolve o array para lista não vazia.
  - Lança `Error("Session password list must not be empty")` (mensagem final a critério de quem implementa, mas explícita) para `[]`.
- **Justificativa:**
  - O arquivo já mantém helpers privados no fim (`shouldSlide` em `src/utils/session.ts:414`, `sessionExpires` em `:455`), e AGENTS.md manda manter helpers internos no fim do arquivo. Só `session.ts` os usa, então (c) não se justifica.
  - Não é exportado, logo não cria nome público.
  - O tipo de erro segue o de `iron-crypto.ts` (`new Error("Empty password")`, `src/utils/internal/iron-crypto.ts:65-67`, `:94-96`), que também é `Error` simples.
- **Onde valida (RF-05):**
  - `sealSession` (`src/utils/session.ts:300`) e `unsealSession` (`:324`) chamam o helper antes de qualquer trabalho.
  - **`getSession` também chama o helper logo no início**, antes do bloco `try` de carga (`:175-221`). Sem isso o erro seria engolido: a cadeia `unsealSession(...).catch(() => {})` em `:196-197` descarta qualquer falha de unseal, e uma requisição sem cookie nem chegaria a selar. A validação antecipada impede a falha silenciosa que o RF-05 proíbe. Ela roda depois do retorno antecipado da sessão em cache (`:163-165`), o que mantém o custo de uma chamada por requisição e por sessão.
- **Strings vazias dentro da lista:** não são tratadas à parte. `seal` e `unseal` já lançam "Empty password" (`iron-crypto.ts:65`, `:94`), e o limite de 32 caracteres vale por senha em `generateKey` (`iron-crypto.ts:192`), como o PRD pede.

### D-03 — Selagem usa só a primeira senha

- **Alternativas:** (a) selar com a primeira; (b) selar com a última ou com a mais forte (descartada: contradiz o pedido).
- **Escolha: (a).** `sealSession` (`src/utils/session.ts:300`) passa `resolvePasswords(config)[0]` a `seal`.
- **Consequência:** `updateSession` (`:267`), o reseal de `getSession` (`:214-216`) e `useSession` (`:116-118`) herdam o comportamento sem alteração. Isso cobre o RF-02.

### D-04 — Abertura tenta senha por senha; só "senha errada" avança

Este é o núcleo da mudança, em `unsealSession` (`src/utils/session.ts:312-348`).

- **Estrutura escolhida:** um laço `for` sobre as senhas, em ordem. Para cada senha:
  1. tenta `unseal` com as opções atuais;
  2. se falhar com `"Bad hmac value"`, aplica o mesmo fallback legado de hoje (1 iteração PBKDF2) **com essa senha**, respeitando `legacySealFallback === false` e `iterations === 1`;
  3. se o legado também falhar com `"Bad hmac value"`, ou se o fallback não se aplica, passa para a próxima senha.
- **Quais erros avançam para a próxima senha:** somente `Error` com `message === "Bad hmac value"`. Qualquer outro erro é relançado na hora. Os outros erros que `unseal` produz independem de qual senha foi tentada:
  - `"Incorrect number of sealed components"`;
  - `"Wrong mac prefix"`;
  - `"Invalid expiration"` e `"Expired seal"`, todos lançados antes da checagem de HMAC, em `iron-crypto.ts:99-118`;
  - `"Empty password"` e o erro de senha curta, que são erro de configuração.
- **Erro final:** se todas as senhas falharem com "Bad hmac value", relança o erro da **primeira** senha (o erro original, como hoje). Quem chama continua vendo a mesma mensagem de antes para senha única.
- **Alternativas consideradas:**
  - (a) `try/catch` por senha engolindo qualquer erro e tentando a próxima. Descartada: mascara "Expired seal", formato inválido e senha curta, e multiplica o custo de PBKDF2 em seals expirados ou malformados, que hoje falham antes de derivar qualquer chave.
  - (b) Tentar todas as senhas no modo atual e só então todas no modo legado. Descartada: altera a prioridade (uma senha antiga no modo atual venceria a senha nova no modo legado) e foge do RF-07, que pede o fallback "com cada senha". Como o legado custa 1 iteração, a ordem por senha não encarece o pior caso de forma relevante.
  - (c) Escolher a senha por prefixo do selo (`passwordId`). Fora de escopo, e o formato do selo não muda.
- **Condição do fallback legado (`:332-338`):** continua com a mesma checagem `error.message === "Bad hmac value"`. Com o laço, o `error` testado é o do `unseal` da senha corrente, então a condição segue correta. O fallback usa a senha do laço, não mais `config.password` (`:340`).
- **Expiração:** `"Session expired!"` (`:350-365`) continua **depois** do laço, aplicada ao resultado já aberto. Não dispara nova tentativa de senha, como o PRD pede (RF-07 e risco "Erros mascarados").
- **Marca de senha antiga:** ver D-05.

### D-05 — Reseal de sessão aberta com senha antiga: novo símbolo interno

- **Alternativas:**
  - (a) reaproveitar `kLegacySeal` (`src/utils/internal/session.ts:7-9`) para os dois casos;
  - (b) novo símbolo interno `kStalePassword` ao lado dele;
  - (c) o `getSession` descobrir sozinho qual senha abriu, tentando de novo;
  - (d) devolver a posição da senha no retorno de `unsealSession`.
- **Escolha: (b).**
- **Justificativa:**
  - (a) mistura duas causas com nomes que passariam a mentir.
  - (c) refaz PBKDF2.
  - (d) muda a assinatura pública de `unsealSession`, exportada em `src/index.ts:209`.
  - (b) segue o padrão existente: `unsealSession` marca o objeto devolvido com um símbolo (`session.ts:345-347`), e `getSession` lê e apaga a marca antes de copiar o objeto para a sessão (`:199-202`). O símbolo fica em `internal/session.ts`, que não é reexportado pelo índice, então não é nome público.
- **Mudanças:**
  - `src/utils/internal/session.ts`: adicionar `export const kStalePassword`, no mesmo estilo de `kLegacySeal` (`Symbol.for("h3.internal.session.stale-password")`).
  - `unsealSession`: se a sessão abriu com senha de índice > 0, define `(unsealed as any)[kStalePassword] = true`, com a mesma guarda `if (unsealed)` de `:345` (o iron devolve `null` quando o conteúdo decifrado é vazio, `iron-crypto.ts:149`).
  - `getSession` (`:199-202`): ler e apagar também `kStalePassword`.
  - `getSession` (`:214`): a condição passa a ser `session.id && sessionFromCookie && (legacySeal || stalePassword || shouldSlide(session, config))`.
- **Efeito sobre os casos do PRD:**
  - Sessão de header não é re-selada, porque `sessionFromCookie` é `false`.
  - Sessão aberta com a primeira senha não gera `Set-Cookie` extra, porque a marca não é definida.
  - Sessão aberta com senha antiga **e** seal legado gera um único reseal, já que `updateSession` sela uma vez com a primeira senha e as opções atuais.
  - O `Set-Cookie` do reseal é deduplicado quando o handler também grava a sessão, como no reseal legado.

### D-06 — Ajuste mínimo nos testes existentes

- **Problema:** com `password: string | string[]`, três usos em `test/session.test.ts` passam `sessionConfig.password` direto a `seal`/`unseal`, que exigem `string` (`RawPassword`/`Password` em `iron-crypto.ts:60`, `:89`). Isso quebra o `typecheck`. Os usos estão em `test/session.test.ts:137`, `:157` e `:164`.
- **Escolha:** extrair uma constante local (por exemplo `const password = "1234567123456712345671234567123456712345671234567"` no topo do `describeMatrix`, `test/session.test.ts:15-25`), usá-la em `sessionConfig` (`:23`) e nesses três pontos. O valor, as opções de seal e as asserções ficam iguais, então os testes verificam o mesmo de antes.
- **Alternativas descartadas:** cast `as string` (esconde o problema); trocar a asserção (perderia o que o teste verifica).
- **Não precisam mudar:** as ocorrências `password: sessionConfig.password` dentro de objetos `SessionConfig` (`:195`, `:238`, `:272`, `:318`, `:351`, `:382`, `:418`, `:483`, `:515`, `:544`, `:586`, `:622`), porque o tipo alargado é aceito ali. A senha literal do `lazyConfig` (`:695`) também não muda.

### D-07 — Documentação

- JSDoc de `password` em `src/utils/session.ts:40-48`: descrever a lista, a ordem (primeira sela, as demais só abrem), o fluxo de rotação (`"nova"` + `"antiga"`, aposentar a antiga depois), o aviso de segurança (senha vazada deve sair da lista) e o custo (cada senha extra pode custar uma derivação PBKDF2 em cookie inválido; manter a lista curta). Isso cobre o RF-09.
- Opcional, mas recomendado: um parágrafo em `docs/4.examples/handle-session.md`, logo após a nota de entropia da linha 37. Não é exigido pelo PRD e pode ser deixado de fora sem afetar os critérios de aceite.

## 3. Arquivos a alterar

| Arquivo | Linhas (estado atual) | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:5` | importar também `kStalePassword` |
| `src/utils/session.ts` | `:40-48` | JSDoc e tipo de `password` (D-01, D-07) |
| `src/utils/session.ts` | `:175` (antes do bloco de carga em `getSession`) | chamar `resolvePasswords(config)` para falhar cedo (D-02) |
| `src/utils/session.ts` | `:199-202`, `:214` | ler e apagar `kStalePassword`; incluí-lo na condição de reseal (D-05) |
| `src/utils/session.ts` | `:300` | `seal` com a primeira senha (D-03) |
| `src/utils/session.ts` | `:312-348` | laço por senha com fallback legado por senha e marca de senha antiga (D-04, D-05) |
| `src/utils/session.ts` | fim do arquivo (depois de `:464`) | helper `resolvePasswords` (D-02) |
| `src/utils/internal/session.ts` | `:7-9` | novo símbolo `kStalePassword` (D-05) |
| `test/session.test.ts` | `:21-25`, `:137`, `:157`, `:164` | constante de senha (D-06) |
| `test/session.test.ts` | novos testes | ver seção 5 |
| `docs/4.examples/handle-session.md` | `:37` | parágrafo de rotação (opcional, D-07) |

Não mudam: `src/utils/internal/iron-crypto.ts` (apenas referenciado), `src/index.ts` e `src/types/context.ts`. Em `src/types/context.ts:32`, `password` é o campo de `basicAuth`, sem relação com sessão.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /** (JSDoc ampliado: lista, ordem, rotação, segurança, custo) */
  password: string | string[];
  // demais campos inalterados
}

// Assinaturas públicas inalteradas:
export function useSession<T>(event: HTTPEvent, config: SessionConfig): Promise<SessionManager<T>>;
export function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export function updateSession<T>(event: HTTPEvent, config: SessionConfig, update?: SessionUpdate<T>): Promise<Session<T>>;
export function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export function unsealSession(event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;

// Interno (não exportado):
function resolvePasswords(config: SessionConfig): string[]; // lança Error se a lista for vazia

// src/utils/internal/session.ts (interno, não reexportado pelo índice):
export const kStalePassword: unique symbol;
```

**Comportamento observável:**

| Entrada | Resultado |
| --- | --- |
| `password: "x"` | igual a hoje |
| `password: ["nova", "antiga"]`, selo feito com `"nova"` | aceito, sem `Set-Cookie` extra |
| idem, selo feito com `"antiga"` (cookie) | aceito (mesmo `id` e `data`) e re-selado com `"nova"` via `Set-Cookie` |
| idem, selo feito com `"antiga"` (header) | aceito, sem reseal |
| idem, selo feito com `"removida"` | descartado; nova sessão (novo `id`), sem erro ao handler |
| `password: []` | `Error` explícito em `getSession`, `sealSession` e `unsealSession`; nenhuma sessão criada ou aceita |
| selo expirado (`maxAge`/`idleTimeout`) em qualquer senha da lista | `"Session expired!"`; nova sessão |

Mudança de tipo a registrar nas notas de versão: código de terceiros que lê `config.password` como `string` passa a ver `string | string[]`.

## 5. Estratégia de testes

Todos os testes novos ficam em `test/session.test.ts`, dentro de um novo `describe("password rotation", ...)` no `describeMatrix` existente (`:15`), assim rodam nos modos `web` e `node` (AGENTS.md). Constantes: `oldPassword`, `newPassword` e `removedPassword` com 32 ou mais caracteres. Selos antigos são gerados com `seal(...)` direto, como nos testes legados (`:135-143`). O fluxo de bug do AGENTS.md vale: escrever os testes antes da implementação e confirmar que falham.

| Requisito | Teste |
| --- | --- |
| RF-02 | sessão nova com `[new, old]`: o cookie abre com `unseal(..., new)` e **lança** com `unseal(..., old)`. Repetir após `update()` |
| RF-03 | cookie selado com `old`, config `[new, old]`: `getSession` devolve o mesmo `id` e `data`, sem sessão nova. Variante com a senha antiga em terceiro lugar (`[new, mid, old]`) para provar a ordem e a continuação |
| RF-04 | cookie selado com `removed`, config `[new, old]`: novo `id` (via `generateId`), `data` vazio, resposta 200 (sem erro ao handler) |
| RF-05 | `password: []` com `useSession`, `getSession`, `sealSession` e `unsealSession`: cada um rejeita com a mensagem esperada; sem `Set-Cookie`. Cobrir também requisição **com** cookie, para provar que o erro não é engolido pelo `.catch(() => {})` de `:197` |
| RF-06 | cookie selado com `old`: resposta traz exatamente um `Set-Cookie`, que abre com `new` isolada e **não** abre com `old`. Cookie selado com `new`: nenhum `Set-Cookie`. Header de sessão selado com `old`: aceito, nenhum `Set-Cookie` |
| RF-07 | (a) seal legado (1 iteração) com `old`, config `[new, old]`: aceito e re-selado com `new` nas opções atuais (um só `Set-Cookie`); (b) idem com `legacySealFallback: false`: rejeitado; (c) `maxAge` e `idleTimeout` com `vi.useFakeTimers({ toFake: ["Date"] })`, como em `:189-190`: dentro do prazo aceito, fora dele "Session expired!" e nova sessão, para selo com senha antiga; (d) `seal` customizado (`SealOptions`) com senha antiga; (e) cookie em partes (dados grandes, como em `:656`) selado com senha antiga |
| RF-08 | a suíte existente inteira passa após o ajuste de D-06 |
| Tipos | em `test/unit/types.test-d.ts`, `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()` (arquivo já usa `expectTypeOf`, `:530`) |

**Execução:**
1. `pnpm vitest run test/session.test.ts`
2. `pnpm vitest run test/unit/`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test` ao final

## 6. Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| **Custo de CPU:** cada senha que falha custa uma derivação PBKDF2 de 8192 iterações, mais uma rodada barata de 1 iteração no legado. Um cookie forjado válido no formato amplifica o custo para N senhas | Só "Bad hmac value" avança (D-04), então seals malformados ou expirados continuam falhando antes de qualquer PBKDF2. Documentar que a lista deve ser curta (D-07). Sem limite rígido no código, já que a lista é configuração do operador |
| **Erros mascarados** | Erros diferentes de "Bad hmac value" são relançados na hora. A expiração é checada depois do laço e não repete tentativas. Se nenhuma senha serve, o erro final é o da primeira senha |
| **Fallback legado com a condição `error.message === "Bad hmac value"`** | A condição é mantida e avaliada por senha, sobre o erro daquela tentativa (D-04) |
| **Reseal novo gera `Set-Cookie` em leituras** | Só ocorre com `sessionFromCookie` e marca `kStalePassword` (D-05). O teste de RF-06 cobre os três casos (primeira senha, senha antiga por cookie, senha antiga por header) |
| **Falha silenciosa com `[]`** | Validação antecipada em `getSession` (D-02), com teste que usa cookie presente |
| **Senha curta ou inválida no meio da lista** | O erro de `generateKey` interrompe o laço e é relançado. Em `getSession` ele é engolido pelo `.catch` existente (`:197`) e a sessão vira nova. O efeito é visível (usuários deslogados) e não silenciosamente inseguro, mas pode ser confuso. Fica registrado como limitação conhecida; validar tamanho em `resolvePasswords` duplicaria a opção `seal.minPasswordlength` (`iron-crypto.ts:380`) e foi evitado |
| **Segurança:** senha antiga na lista mantém válidas as sessões feitas com ela | Documentar no JSDoc que senha vazada deve sair da lista. O reseal de RF-06 existe para acelerar a aposentadoria |
| **Quebra de tipos em código de terceiros** que lê `config.password` como `string` | Alargamento aceito (PRD). Mencionar nas notas de versão |
| **Divergência entre `kStalePassword` e `kLegacySeal`** (dois marcadores com a mesma ação) | Os dois são lidos e apagados no mesmo ponto de `getSession` e entram na mesma condição, então não há estado residual. O teste combinado (RF-07a) cobre os dois ao mesmo tempo |
