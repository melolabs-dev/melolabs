# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md`. Escopo de código: `src/utils/session.ts` e `src/utils/internal/session.ts`. `src/utils/internal/iron-crypto.ts` não muda. As citações `arquivo:linha` foram conferidas no código atual (commit `7b8d849`).

## 1. Estado atual (resumo)

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`, JSDoc em `:40-47`).
- `sealSession` sela com `config.password` (`src/utils/session.ts:300`).
- `unsealSession` (`src/utils/session.ts:312-367`) chama `unseal` uma vez (`:324`). Se falhar com `"Bad hmac value"`, e o fallback legado estiver ligado e as iterações forem diferentes de 1, repete com 1 iteração (`:332-347`) e marca o resultado com `kLegacySeal` (`:346`).
- `getSession` remove `kLegacySeal` do objeto (`:199-202`) antes do `Object.assign(session, unsealed)` (`:208`). Depois reressala se `legacySeal || shouldSlide` e a origem for cookie (`:214-216`).
- `unseal` em `iron-crypto.ts` aceita uma senha (`:87-91`). A falha de senha/integridade é `Error("Bad hmac value")` (`:135-137`). Expiração é `"Expired seal"` (`:115-117`). Senha curta é `"Password string too short (min N characters required)"` (`:192-195`). Senha vazia é `"Empty password"` (`:65-67`, `:94-96`). `minPasswordlength` padrão é 32 (`:21`, `:28`).
- `getSession` engole qualquer erro de unseal (`.catch(() => {})`, `src/utils/session.ts:197`) e cria uma sessão nova.

## 2. Decisões de arquitetura

### D-01 — Tipo público: `string | string[]` com validação em runtime
- **Alternativas:** (a) `string | [string, ...string[]]`, que impõe a lista não vazia no tipo; (b) `string | string[]` com validação em runtime; (c) `string | readonly string[]`.
- **Escolha: (b).** Um `string[]` vindo de `env.split(",")` ou de configuração tem tipo `string[]` e não compilaria com (a) sem cast. O PRD (premissas) admite validação em runtime. A lista vazia é rejeitada por D-04. Não aceitamos `readonly string[]` (c) para manter o tipo simples; `readonly string[]` não é atribuível a `string[]`, então quem usa `as const` precisaria de cast. Isso fica como risco aceito (R-05). Nenhum nome público novo é criado (RF-01); `SessionConfig` já é exportado, e `src/index.ts:208-209` não muda.

### D-02 — Sem mudanças em `iron-crypto.ts`; o laço de senhas fica em `unsealSession`
- **Alternativas:** (a) estender `unseal` para receber uma lista; (b) usar o `PasswordHash` já existente de `unseal` (`iron-crypto.ts:120-128`); (c) laço em `unsealSession`.
- **Escolha: (c).** O `PasswordHash` casa a senha pelo *id* gravado no token (`passwordId`). Os tokens atuais têm id vazio (`seal` grava `id = ""`, `:68-79`), então todos cairiam em `default` e não haveria rotação. (a) mudaria o contrato interno de uma cópia vendorizada de iron, coberta por `test/unit/iron-crypto.test.ts`. (c) mantém `seal`/`unseal` intactos, e o PRD diz que `unseal` pode ser chamado uma vez por senha.

### D-03 — A primeira senha sela; as demais só abrem (`sealSession`)
- `sealSession` passa a usar `passwords[0]` no lugar de `config.password` (`src/utils/session.ts:300`). `updateSession` (`:267`) herda isso sem mudança, o que cobre RF-02.
- **Alternativa:** escolher a senha de selagem por um campo novo. Rejeitada pelo pedido ("nenhum outro nome público novo").

### D-04 — Normalização e validação única da lista (`resolvePasswords`)
- **Alternativas:** (a) validar só quando cada senha for tentada, e deixar o `iron-crypto` lançar; (b) validar a lista inteira antes de qualquer seal/unseal.
- **Escolha: (b).** Com (a), uma senha secundária curta só falharia depois que as anteriores falhassem, e o erro dependeria do token. O RF-06 exige erro ao selar ou abrir.
- Um helper interno novo `resolvePasswords(password, minLength)` fica em `src/utils/internal/session.ts` (arquivo interno, sem export em `src/index.ts`):
  - converte `string` em `[string]`;
  - lança `Error("Empty password")` para lista vazia ou elemento que não seja string não vazia, a mesma mensagem de `iron-crypto.ts:66`;
  - lança `Error("Password string too short (min N characters required)")` para elemento menor que `N`, a mesma mensagem de `iron-crypto.ts:193`. `N` é o maior entre `sealOptions.encryption.minPasswordlength` e `sealOptions.integrity.minPasswordlength`, para respeitar `config.seal` customizado.
- É chamado no início de `sealSession` e de `unsealSession`, com as `sealOptions` já montadas (`:317-321`; em `sealSession` o objeto é montado inline em `:300-304` e passa a ser extraído para uma constante local).
- Com uma `string`, as mensagens e as condições de erro são as de hoje. A única diferença é a ordem: o erro de senha curta sai antes de erros de formato do token (R-04).

### D-05 — Laço de unseal: iterações por fora, senhas por dentro
- **Alternativas:** (a) senhas por fora, `[atual, legado]` por dentro; (b) iterações por fora, senhas por dentro: todas as senhas com as iterações atuais, e só se todas falharem todas com 1 iteração.
- **Escolha: (b).** O caso comum de rotação é um token moderno selado com a senha antiga. Com (a), a senha 0 falharia duas vezes (atual e legado) antes de a senha 1 ser tentada, e o custo de PBKDF2 do caminho comum dobraria. Com (b), o custo é no máximo N derivações no caminho moderno, e o legado só é tentado depois. Com uma senha só, a sequência de chamadas a `unseal` é idêntica à atual (RF-07).
- **Quando continuar para a próxima senha:** só se o erro for `error instanceof Error && error.message === "Bad hmac value"`. É o mesmo teste do fallback legado (`:333-336`), extraído para um predicado local. Qualquer outro erro (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `Invalid expiration`, falha de decrypt, JSON inválido) independe da senha e é relançado na hora. Isso evita mascarar erros reais ao tentar várias senhas e evita PBKDF2 inútil.
- **Fim das tentativas:** se todas as senhas falharem com `Bad hmac value` nas iterações atuais, segue-se a condição do fallback legado, que não muda (`legacySealFallback === false`, `iterations === 1`; o teste de `Error`/mensagem passa a ser feito na falha da última senha, que é sempre `Bad hmac value` nesse ponto). Se o legado também falhar em todas, o último erro é relançado, igual ao comportamento de hoje.
- Esboço (assinaturas e fluxo, não código final):

```ts
// src/utils/session.ts (dentro de unsealSession)
const passwords = resolvePasswords(config.password, minPasswordLength(sealOptions));
const attempt = (opts: SealOptions) => unsealWithAny(sealed, passwords, opts);
//   -> Promise<{ unsealed: unknown; index: number }>   // relança o 1º erro que não for "Bad hmac value"
//   -> se todas falharem com "Bad hmac value", relança o último
```

### D-06 — Reressalar proativamente sessões abertas com senha secundária
- **Contexto:** o RF-04 exige que o ressalo (por escrita, `idleTimeout` ou legado) use a primeira senha, o que D-03 já garante. O PRD não obriga a reselar numa simples leitura.
- **Alternativas:** (a) reselar só nos gatilhos existentes; (b) reselar também em toda leitura de cookie aberto com senha secundária, como já se faz com o legado (`src/utils/session.ts:214`).
- **Escolha: (b).** Sem isso, a senha antiga só poderia ser removida depois que todo usuário ativo escrevesse na sessão ou deslizasse o `idleTimeout`, e o objetivo da rotação (aposentar a antiga) ficaria sem prazo. O custo é um seal por sessão migrada, uma única vez, igual ao do legado. Para sessões lidas pelo header não há reseal (`sessionFromCookie` é falso), como hoje.
- **Mecanismo:** um símbolo interno novo `kSecondarySeal`, ao lado de `kLegacySeal` em `src/utils/internal/session.ts:7-9`, com `Symbol.for("h3.internal.session.secondary-seal")`. `unsealSession` o define no objeto quando `index > 0`; `getSession` o lê e o **apaga** no mesmo lugar em que apaga `kLegacySeal` (`:199-202`), antes do `Object.assign` (`:208`), porque `Object.assign` copia símbolos próprios enumeráveis e o marcador vazaria para o `session` e, depois, para o seal (o `JSON.stringify` ignora símbolos, mas o objeto ficaria sujo em `context.sessions`). A condição em `:214` passa a ser `legacySeal || secondarySeal || shouldSlide(...)`.
- **Alternativa de implementação rejeitada:** reutilizar `kLegacySeal` com significado ampliado. Mistura duas causas e confunde a leitura do código (o nome diz "legacy"). Não é nome público (símbolo interno, não exportado em `src/index.ts`).

### D-07 — `getSession` continua engolindo erros de unseal
- Manter `.catch(() => {})` (`src/utils/session.ts:197`). Um token com senha fora da lista (RF-05) cai no caminho já existente de token inválido: `session.id` vazio, nova sessão em `:225-229`.
- Consequência: uma configuração inválida (lista vazia ou senha curta) lança em `unsealSession`/`sealSession`, que são públicas (RF-06), mas em `getSession` o erro de unseal ainda é engolido, como já é hoje com senha curta. O erro explícito aparece no primeiro seal (`useSession` força `updateSession` para sessão nova, `:116-118`). Ver R-03.

### D-08 — Documentação e JSDoc
- Reescrever o JSDoc de `password` (`src/utils/session.ts:40-48`) com: a semântica de rotação (índice 0 sela; os demais só abrem; a ordem importa); lista não vazia; mínimo de 32 caracteres por senha; recomendação de lista curta (custo PBKDF2, R-01); remover a senha antiga após a janela de rotação (R-06).
- Acrescentar uma seção curta "Rotating the password" em `docs/4.examples/handle-session.md`, depois do aviso `[!WARNING]` de `:36-43`.

## 3. Arquivos a alterar

| Arquivo | Linhas hoje | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:40-48` | Tipo `password: string \| string[]` e novo JSDoc (D-01, D-08). |
| `src/utils/session.ts` | `:199-202`, `:214` | Ler e apagar `kSecondarySeal`; incluí-lo na condição de reseal (D-06). |
| `src/utils/session.ts` | `:282-307` (`:300`) | Validar a lista e selar com `passwords[0]` (D-03, D-04). |
| `src/utils/session.ts` | `:312-367` (`:324`, `:340-347`) | Laço de senhas, com iterações por fora; marcar `kLegacySeal` e `kSecondarySeal` (D-05, D-06). |
| `src/utils/session.ts` | `:1-5` | Importar `resolvePasswords` e `kSecondarySeal`. |
| `src/utils/internal/session.ts` | `:7-9` (novo símbolo depois), fim do arquivo | `kSecondarySeal` e `resolvePasswords` (D-04, D-06). |
| `docs/4.examples/handle-session.md` | `:36-43` | Seção de rotação (D-08). |
| `test/session.test.ts` | `:21-25`, `:134-186`, bloco novo | Ajuste dos usos tipados de `password` e testes novos (seção 5). |
| `test/unit/types.test-d.ts` | `:35` (bloco `describe("types")`) ou novo `describe` | Teste de tipo do RF-01. |

Sem alteração: `src/utils/internal/iron-crypto.ts`, `src/index.ts:208-209`, `test/bench/session.ts:20` (passa uma `string`, ainda válida).

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. ...
   * With an array, the first password seals and every password can unseal.
   */
  password: string | string[];
  // demais campos inalterados
}
// Assinaturas públicas inalteradas:
export function useSession<T>(event: HTTPEvent, config: SessionConfig): Promise<SessionManager<T>>;
export function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export function updateSession<T>(event: HTTPEvent, config: SessionConfig, update?: SessionUpdate<T>): Promise<Session<T>>;
export function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export function unsealSession(event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;

// src/utils/internal/session.ts (interno, não exportado em src/index.ts)
export const kSecondarySeal: unique symbol;
export function resolvePasswords(password: string | string[], minLength: number): [string, ...string[]];
```

Comportamento (tabela de verdade para `unsealSession`):

| Token selado com | Config `password` | Resultado |
| --- | --- | --- |
| `nova` | `[nova, antiga]` | Abre; sem marcador. |
| `antiga` | `[nova, antiga]` | Abre; `kSecondarySeal`; `id` e dados originais preservados. |
| `antiga`, 1 iteração | `[nova, antiga]` | Abre pelo fallback legado; `kLegacySeal` e `kSecondarySeal`. |
| `outra` | `[nova, antiga]` | Lança `Bad hmac value`; em `getSession`, nova sessão. |
| `antiga` | `nova` | Igual ao anterior (RF-05). |
| qualquer | `[]` | Lança `Empty password`. |
| qualquer | `[nova, "curta"]` | Lança `Password string too short (min 32 characters required)`. |
| `antiga` expirada por ttl | `[nova, antiga]` | Lança `Expired seal`, sem tentar outras senhas. |

`sealSession` com `[nova, antiga]` produz um token que só abre com `nova` (RF-02).

## 5. Estratégia de testes

Seguir `AGENTS.md`: `describeMatrix` (web e node); fluxo de correção de bug: escrever os testes novos, confirmá-los vermelhos antes da implementação, implementar, confirmá-los verdes e rodar a suíte.

**Ajuste obrigatório de testes existentes.** `test/session.test.ts:137`, `:157` e `:164` passam `sessionConfig.password` a `seal`/`unseal` de `iron-crypto.ts`, cujo parâmetro aceita `string` mas não `string[]` (`iron-crypto.ts:60`, `:89`). Com o tipo novo, o typecheck quebra. Correção: extrair `const password = "1234567123456712345671234567123456712345671234567"` no topo do `describeMatrix` e usá-lo em `sessionConfig` (`:23`) e nesses três pontos. O que os testes verificam (reseal legado com iterações atuais, rejeição com `legacySealFallback: false`) não muda. Os demais usos `password: sessionConfig.password` (`:195`, `:238`, `:272`, ...) continuam válidos e ficam como estão.

**Testes novos** (novo `describe("password rotation")` em `test/session.test.ts`, usando `seal` direto para forjar tokens da senha antiga, no estilo de `:134-159`; senhas de 32+ caracteres):
- **RF-02:** com `[nova, antiga]`, escrever na sessão; o cookie abre com `unseal(..., nova)` e falha com `unseal(..., antiga)`.
- **RF-03:** token selado com `antiga` e config `[nova, antiga]` devolve o `id` e os dados originais, sem criar sessão nova (`generateId` não é chamado), tanto por cookie quanto por header `x-h3-test-session`.
- **RF-04:** a mesma requisição devolve `Set-Cookie` (reseal proativo, D-06) que abre com `nova` isolada e não abre com `antiga`. Variante com escrita (`POST`). Variante com `idleTimeout` com `Date` falso, no estilo de `:188-200`. Variante por header: não há `Set-Cookie`.
- **RF-05:** token com senha ausente da lista resulta em nova sessão (`id` diferente, dados vazios); também com config de string única apontando para `nova` e token da `antiga`.
- **RF-06:** `unsealSession` e `sealSession` com `[]` e com `[nova, "curta"]` rejeitam com a mensagem esperada; `useSession` com `[]` rejeita.
- **RF-07:** `password: [nova]` e `password: nova` se comportam igual (casos existentes de `:39-132`); token legado (1 iteração) selado com a senha secundária abre e é reressalado com `nova` em iterações atuais; com `legacySealFallback: false`, é rejeitado.
- **Não mascarar erros:** token da senha secundária com ttl vencido (`maxAge` ou `seal.ttl` com `Date` falso) é rejeitado e a requisição recebe sessão nova. Usar `vi.spyOn` em `crypto.subtle.deriveBits` para provar que o erro de expiração não gera tentativas extras de PBKDF2 (opcional, só se for estável nos dois alvos).
- **Ordem do legado (D-05):** token moderno selado com a secundária não dispara tentativas com 1 iteração (contagem de chamadas de `deriveBits`; opcional, mesma ressalva).
- **Marcador não vaza:** após abrir com a secundária, `Object.getOwnPropertySymbols(session)` não contém `kSecondarySeal` nem `kLegacySeal`.

**Teste de tipo** (`test/unit/types.test-d.ts`): `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`, e `useSession`/`getSession`/`updateSession`/`sealSession`/`unsealSession` aceitam `{ password: string }` e `{ password: string[] }`.

**Verificação final:** `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck`, e depois `pnpm test` para regressão geral.

## 6. Riscos

- **R-01 — Custo de PBKDF2.** Cada tentativa (inclusive de token inválido) custa 1 derivação para a HMAC (a falha ocorre na integridade, antes da derivação da chave de encriptação), então um token inválido custa N derivações, mais N no legado. Mitigação: iterações atuais antes do legado (D-05); falha imediata em erros que não são de senha; recomendação de listas curtas no JSDoc e na documentação. Um atacante que envia cookies lixo multiplica o custo por N em relação a hoje, e isso fica documentado.
- **R-02 — Vazamento do marcador para a sessão.** `Object.assign(session, unsealed)` (`:208`) copia símbolos próprios. Mitigação: apagar `kSecondarySeal` junto com `kLegacySeal` (`:199-202`) e testar `getOwnPropertySymbols`.
- **R-03 — Erros de configuração engolidos em `getSession`.** `.catch(() => {})` (`:197`) esconde lista vazia ou senha curta na leitura. O erro aparece no primeiro seal. É o comportamento atual para senha curta; não será mudado, para não alterar o contrato do caminho de token inválido (RF-05).
- **R-04 — Ordem de erros com senha única.** Como a validação (D-04) roda antes do `unseal`, uma senha única curta combinada com token malformado passa a lançar o erro de senha curta, e não o de formato. O resultado final para `getSession` é o mesmo (erro engolido, nova sessão); só quem chama `unsealSession` diretamente vê a mensagem diferente.
- **R-05 — Tipos.** Quem lê `config.password` como `string` passa a ver `string | string[]` (compilação quebra em código de terceiros). Também `readonly string[]` não é aceito. Está registrado no PRD como risco aceito; vale uma linha no changelog da release.
- **R-06 — Senha antiga comprometida.** Manter a antiga na lista a mantém válida para abrir sessões. A documentação deve dizer para removê-la depois da janela de rotação; o reseal proativo (D-06) encurta essa janela.
- **R-07 — Testes de contagem de `deriveBits` frágeis.** Dependem de detalhes de implementação do crypto nos dois alvos (web e node). Ficam como opcionais; se instáveis, trocar por asserções de comportamento.

## 7. Fora de escopo (reafirmado)

Novo parâmetro público (`extraUnsealPasswords`), rotação automática de segredos, mudanças em `SealOptions`/iterações/TTL, remoção do fallback legado e alterações em cookie/chunking.
