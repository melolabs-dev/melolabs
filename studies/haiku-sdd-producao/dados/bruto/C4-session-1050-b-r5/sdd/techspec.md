# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-07, premissas P-01 a P-05, riscos R-01 a R-05).

Todas as citações `caminho:linha` foram conferidas no código atual (branch `master`, commit `f62e9c5`).

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Ao abrir um cookie, `unsealSession` tenta `password` e depois cada extra, em ordem, parando na primeira que abrir. Selagem continua exclusivamente com `password`. Uma sessão aberta com senha extra é resselada com `password` uma única vez, no mesmo ponto do fluxo em que hoje já ocorre a reselagem legada. Nada muda em `src/utils/internal/iron-crypto.ts` nem no formato do selo.

## Estado atual relevante

- `src/utils/session.ts:48` — `password: string`, a única senha de `SessionConfig`.
- `src/utils/session.ts:300-304` — `sealSession` sela com `config.password`.
- `src/utils/session.ts:312-367` — `unsealSession` chama `unseal` uma vez com `config.password` (`:324`). Se falhar com `"Bad hmac value"` e `legacySealFallback !== false` e `iterations !== 1`, repete com 1 iteração (`:332-344`) e marca o resultado com `kLegacySeal` (`:345-347`).
- `src/utils/session.ts:350-365` — checagens de `maxAge` e `idleTimeout` (lançam `"Session expired!"`).
- `src/utils/session.ts:196-197` — `getSession` chama `unsealSession(...).catch(() => {})`: qualquer falha de abertura vira sessão vazia, sem erro.
- `src/utils/session.ts:199-201` — `getSession` lê e apaga `kLegacySeal` antes de `Object.assign(session, unsealed)` (`:208`).
- `src/utils/session.ts:214-216` — reselagem em `getSession` acontece só se `session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config))`.
- `src/utils/internal/iron-crypto.ts:122-128` — `unseal` aceita `password` como string, usada diretamente.
- `src/utils/internal/iron-crypto.ts:135-137` — falha de HMAC lança `"Bad hmac value"`. É o único erro de senha errada.
- `src/utils/internal/iron-crypto.ts:192-195` — senha string com menos de `minPasswordlength` (32, `:22`) lança erro.
- `src/utils/internal/session.ts:5-7` — `kLegacySeal` (`Symbol.for("h3.internal.session.legacy-seal")`), padrão a seguir.
- `src/index.ts:209` — `unsealSession` é exportada publicamente. Nenhum nome novo deve ser exportado.

---

## Decisões de arquitetura

### D-01 — Campo público `extraUnsealPasswords?: string[]` em `SessionConfig`

**Escolha:** campo opcional no `SessionConfig`, logo após `password` (`src/utils/session.ts:48`), com JSDoc que explica que as senhas só abrem sessões, que a selagem usa `password`, e o custo de cada uma (R-01).

**Alternativas consideradas:**
- `password: string | string[]` (segunda alternativa da issue). Descartada: está em "Fora de escopo" no PRD e muda o tipo de um campo existente.
- Objeto aninhado, por exemplo `unseal: { passwords: [...] }`. Descartada: cria um nome público além de `extraUnsealPasswords`, o que o contrato proíbe.

**Justificativa:** é o nome exato do contrato, é aditivo (sem o campo, o tipo e o comportamento são os de hoje) e é uma interface com tipo explícito, então `isolatedDeclarations` não exige nada extra.

### D-02 — Selagem sempre com `password`; nenhuma mudança em `sealSession`

**Escolha:** `sealSession` continua chamando `seal(session, config.password, ...)` (`src/utils/session.ts:300`). Nenhuma alteração.

**Alternativas consideradas:**
- Usar o `PasswordHash` do iron (`{ [id]: secret }`), com ids por senha. Descartada: o iron procura a senha pelo id gravado no token (`iron-crypto.ts:121-127`), e tokens existentes têm id vazio, que vira `"default"`. Isso exigiria mudar o formato do selo, o que o PRD proíbe, e só permitiria uma senha `default`.

**Justificativa:** RF-03 é atendido sem código novo. O teste de RF-03 (seção de testes) prova que o selo não abre com a senha antiga.

### D-03 — Tentativa sequencial das senhas, com retry apenas em `"Bad hmac value"`

**Escolha:** em `unsealSession`, tentar `[config.password, ...extras]` em ordem, parando na primeira que abrir. Só erro de senha errada (`"Bad hmac value"`) avança para a próxima. Qualquer outro erro (formato, prefixo, `"Expired seal"`, senha curta) é relançado na hora. A última tentativa relança o próprio erro.

**Alternativas consideradas:**
- `Promise.any` sobre todas as senhas em paralelo. Descartada: multiplica o custo de CPU de uma vez em qualquer requisição, não respeita a ordem declarada (P-04 diz que a ordem vale como desempate) e torna o resultado não determinístico se mais de uma senha abrir.
- Retry em qualquer erro. Descartada: um erro de formato ou de expiração não depende da senha, então repetir só gasta PBKDF2 à toa, e o erro "Expired seal" precisa sair direto.

**Justificativa:** sem extras, a lista tem um item só e o laço se reduz à chamada atual, então RF-04 vale por construção. O custo de uma falha de HMAC é uma derivação PBKDF2 de 8192 iterações (`iron-crypto.ts:206` para a chave de integridade); a chave de encriptação só é derivada após o HMAC passar (`iron-crypto.ts:147`).

### D-04 — Fallback legado intercalado por senha

**Escolha:** para cada senha, tenta primeiro as iterações atuais e depois o fallback de 1 iteração. Ordem resultante: `password` atual, `password` legado, extra 1 atual, extra 1 legado, e assim por diante.

**Alternativas consideradas:**
- Todas as senhas com iterações atuais primeiro, depois todas com 1 iteração. Descartada: é mais código e não tem ganho real.

**Justificativa:** a tentativa legada usa 1 iteração, então custa cerca de 1/8192 de uma tentativa normal. Intercalar não afeta o desempenho e mantém cada senha autocontida. RF-05 é atendido porque o fallback vale para cada extra.

### D-05 — `maxAge` e `idleTimeout` continuam fora do laço

**Escolha:** as checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam depois do laço, uma única vez, sobre o resultado já aberto. Um `"Session expired!"` nunca dispara nova tentativa com outra senha.

**Alternativas consideradas:** colocar a checagem dentro do laço. Descartada: uma sessão expirada abriria com a senha extra e voltaria a ser expirada, só que mais cara.

**Justificativa:** expiração é uma propriedade da sessão, não da senha. Uma senha extra que permanece na configuração abre sessões antigas, mas `maxAge` continua limitando a vida delas (PRD, "Revogação de sessões antigas").

### D-06 — Reselagem única ao abrir com senha extra

**Escolha:** interpretação de RF-06. Quando a sessão abre com uma senha extra, o `unsealSession` marca o resultado com um símbolo novo `kExtraPasswordSeal`, mesmo padrão de `kLegacySeal`. Em `getSession`, essa marca entra na mesma condição que já dispara a reselagem legada (`src/utils/session.ts:214`), sem depender de `shouldSlide`. A reselagem usa `updateSession`, que sela com `password`.

**Alternativas consideradas:**
- (a) Reselar só pelo deslizamento de `idleTimeout`, como o texto literal do PRD sugere. Descartada: sem `idleTimeout`, a sessão nunca convergiria para a senha nova, e a rotação não terminaria sem logout, contrariando o objetivo do PRD.
- (b) Reselar a cada requisição enquanto houver extras. Descartada: viola P-03 e custa uma selagem por requisição.
- (c) **Escolhida:** uma reselagem por sessão, na primeira vez que ela abre com extra. Depois disso o cookie abre com `password` e as extras deixam de ser usadas para ela.

**Justificativa:** é a única opção que faz a rotação convergir sem logout e sem custo recorrente. A reselagem ocorre só no caminho de cookie (`sessionFromCookie`), igual ao legado.

### D-07 — Lógica nova no `session.ts`; `iron-crypto.ts` intocado

**Escolha:** o laço de senhas e o fallback legado ficam em `src/utils/session.ts`, como funções internas no fim do arquivo (convenção de `AGENTS.md`). `unseal` em `iron-crypto.ts` continua recebendo uma senha por vez.

**Alternativas consideradas:** colocar o laço em `iron-crypto.ts`. Descartada: lá não há política de sessão (legado, expiração, marcas), e a mudança espalharia responsabilidades.

**Justificativa:** isola a mudança. `test/unit/iron-crypto.test.ts` não precisa de ajuste (P-05 é atendida porque o módulo não muda).

### D-08 — Sem validação própria das senhas extras

**Escolha:** extras não passam por validação de tamanho na configuração, igual a `password` hoje. Uma extra curta lança `"Password string too short"` (`iron-crypto.ts:192-195`) quando é tentada, e `getSession` converte isso em sessão vazia (`session.ts:197`).

**Alternativas consideradas:** validar todas as senhas ao chamar `useSession`/`getSession` e lançar erro. Descartada: `getSession` engole erros de abertura, então uma validação lançada ali mudaria o comportamento de `password` (P-02 pede o mesmo tratamento para as duas).

**Justificativa:** mantém a paridade com `password`. O risco é tratado em R-03.

---

## Contratos e assinaturas

### `src/utils/session.ts` — tipo público

```ts
export interface SessionConfig {
  /** ...existente... */
  password: string;
  /**
   * Previous passwords, tried in order when a sealed session does not open with
   * `password`. They only open sessions: new seals always use `password`, and a
   * session opened with one of them is resealed with `password`. Each one costs a
   * PBKDF2 derivation for every request whose cookie does not open with the
   * earlier passwords, so keep the list short and remove old entries once the
   * rotation window has passed.
   */
  extraUnsealPasswords?: string[];
  // ...restante inalterado...
}
```

Inserir logo após `password` (`src/utils/session.ts:48`).

### `src/utils/internal/session.ts` — símbolo interno novo

```ts
export const kExtraPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-password-seal",
);
```

Inserir após `kLegacySeal` (`src/utils/internal/session.ts:5-7`). Não exportar pelo `index.ts`.

### `src/utils/session.ts` — `unsealSession` (assinatura pública inalterada)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Mudança de corpo (`src/utils/session.ts:312-367`):

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
const { unsealed, fromExtra } = await unsealWithPasswords(sealed, passwords, sealOptions, config.legacySealFallback);
if (fromExtra) {
  (unsealed as any)[kExtraPasswordSeal] = true;
}
// maxAge e idleTimeout inalterados (D-05)
return unsealed;
```

### `src/utils/session.ts` — funções internas (fim do arquivo)

```ts
/** Tries each password in order; only a wrong-password error moves on to the next one. */
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<{ unsealed: Partial<Session>; fromExtra: boolean }>;

/** Current iterations first, then the legacy 1-iteration fallback (the body of today's `unsealSession` catch). */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>>;

/** The error iron throws when the password does not match the seal. */
function isWrongPasswordError(error: unknown): boolean {
  return error instanceof Error && error.message === "Bad hmac value";
}
```

`unsealWithPassword` usa `isWrongPasswordError` no lugar da condição atual de `:335-336`, com a mesma semântica. Para `unsealWithPasswords`, o caso de erro é: se `isWrongPasswordError(error)` e ainda há senha na lista, segue para a próxima; caso contrário, relança.

`SealOptions` é o tipo já importado em `src/utils/session.ts:9`.

### `src/utils/session.ts` — `getSession` (`:196-216`)

Mudanças mínimas, sem alterar a estrutura:

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
if (legacySeal) {
  delete (unsealed as any)[kLegacySeal];
}
const extraPasswordSeal = unsealed && (unsealed as any)[kExtraPasswordSeal];
if (extraPasswordSeal) {
  delete (unsealed as any)[kExtraPasswordSeal];   // antes do Object.assign, como kLegacySeal
}
// ...
if (session.id && sessionFromCookie && (legacySeal || extraPasswordSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

A remoção do símbolo precisa vir antes de `Object.assign(session, unsealed)` (`:208`), porque o `Object.assign` copia símbolos próprios enumeráveis.

Nenhuma mudança em `sealSession` (D-02), `updateSession`, `clearSession`, `shouldSlide` nem `sessionExpires`.

### Exports e tipos

- Nenhum export novo em `src/index.ts`. `test/unit/package.test.ts:125` e `:149` listam exports e continuam passando sem edição.
- Sem mudança em `test/bench/session.ts`.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:48` | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (D-01). |
| `src/utils/session.ts:196-216` | `getSession`: ler e apagar `kExtraPasswordSeal`, incluir na condição de reselagem (D-06). |
| `src/utils/session.ts:312-367` | `unsealSession`: delegar para `unsealWithPasswords`; manter checagens de expiração (D-03, D-05). |
| `src/utils/session.ts:332-344` | Código atual de fallback legado movido para `unsealWithPassword` (D-04), mesma condição. |
| `src/utils/session.ts` (fim do arquivo, após `:464`) | Funções internas `unsealWithPasswords`, `unsealWithPassword`, `isWrongPasswordError`. |
| `src/utils/internal/session.ts:7` | Símbolo `kExtraPasswordSeal`. |
| `test/session.test.ts` | Novo `describe("extraUnsealPasswords", ...)` (ver testes). |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/iron-crypto.test.ts`, `test/bench/session.ts`, `docs/`, `README.md` (PRD, "Fora de escopo").

---

## Estratégia de testes

Seguir o fluxo de `AGENTS.md` ("Bug Fix Workflow"): escrever os testes primeiro e confirmar que os de RF-02, RF-05 e RF-06 **falham** antes da mudança.

Local: `test/session.test.ts`, dentro de `describeMatrix` (web e node), como o `describe("lazy creation", ...)` em `test/session.test.ts:692`. Usar `password` com 48+ caracteres, como em `test/session.test.ts:23`. Sessões antigas são criadas com `seal` de `src/utils/internal/iron-crypto.ts`, como em `test/session.test.ts:134-141`.

| Teste | Requisito | Verificação |
| --- | --- | --- |
| Abre cookie selado com a senha antiga | RF-02 | Com `password: nova` e `extraUnsealPasswords: [antiga]`, `getSession` retorna os dados. Falha antes da mudança. |
| Abre com a segunda extra | RF-02 | Lista `[x, antiga]`, cookie com `antiga`: abre. Garante a ordem. |
| Sela só com `password` | RF-03 | `useSession` cria sessão; o cookie abre com `nova` e **não** abre com `antiga`. |
| Sem extras e com `[]` | RF-04 | Cookie com outra senha: sessão vazia, sem erro. Mesmo resultado com `extraUnsealPasswords: []`. Os testes existentes também cobrem o caso sem o campo. |
| Legado com senha extra | RF-05 | Cookie de 1 iteração com `antiga`: sessão aberta e resselada. Verificar que o novo cookie abre com `nova` via `unseal(..., sealDefaults)`, como em `:157`. Falha antes. |
| Reselagem por idle com senha extra | RF-06 | `idleTimeout: 60`, cookie com `antiga`, `vi.useFakeTimers` com `toFake: ["Date"]` como em `:410-420`, passar do limite de meia janela: novo cookie abre com `nova` e não com `antiga`. Falha antes. |
| Reselagem ocorre uma vez | D-06 | Segunda requisição com o cookie novo não gera `Set-Cookie` sem `idleTimeout` (`:410-449` mostra o padrão do spy em `encrypt`). |
| Nenhuma senha abre | RF-07 | `password: nova`, extras `[outra]`, cookie com `desconhecida`: sessão vazia, sem erro novo, sem `Set-Cookie`. |
| `maxAge` com extra | D-05 | Cookie de senha extra expirado por `maxAge`: sessão vazia, sem reselagem. |
| Sessão por header com extra | R-04 | Sessão em `x-h3-test-session` aberta com `antiga`: abre, não ocorre reselagem. Documenta o limite. |
| Senha extra inválida | R-03 | Extra curta antes da correta: a correta ainda não é alcançada e a sessão falha. Documenta o comportamento; não é garantia de produto. |

Verificações adicionais (fora de `test/session.test.ts`):
- Tipos: `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` pode ir em `test/unit/types.test-d.ts`, se o arquivo já tiver padrão para tipos de configuração. Caso contrário, `pnpm typecheck` já cobre o uso no próprio teste.
- `pnpm vitest run test/session.test.ts` (ciclo rápido).
- `pnpm vitest run test/unit` (inclui `iron-crypto` e `package.test.ts`).
- `pnpm lint` (oxlint + oxfmt) e `pnpm typecheck`. Cobre `isolatedDeclarations` e `erasableSyntaxOnly`.
- `pnpm test` completo antes de entregar (inclui cobertura).
- Opcional: `pnpm bench:node` para comparar sessões sem extras antes e depois (esperado: sem diferença, pois o laço tem um item).

---

## Riscos

- **R-01 — Custo de desempenho e amplificação em requisições inválidas (importante).** Cada extra adiciona uma derivação PBKDF2 de 8192 iterações para cada cookie que não abre com as anteriores. Requisições com cookie inválido ou forjado pagam `N + 1` derivações, sem autenticação. Mitigação: documentar no JSDoc (feito na seção de contratos); recomendar listas curtas; considerar um limite de tamanho em uma revisão futura. Não há mitigação de código neste escopo.
- **R-02 — Senhas antigas permanentes.** Uma extra esquecida mantém sessões abertas com uma chave possivelmente vazada (PRD R-02). Mitigação: documentação; o campo ser explícito.
- **R-03 — Falha silenciosa com extra curta.** `getSession` engole o erro de senha curta (`src/utils/session.ts:197`). Se uma extra curta vier antes da senha que abre a sessão, essa sessão falha sem aviso. Mitigação: é o mesmo comportamento que `password` curta já tem hoje (D-08). Pode-se avaliar, em tarefa separada, validar `password` e extras ao configurar.
- **R-04 — Sessões por header não convergem.** Sessões lidas do header (`src/utils/session.ts:178-187`) não são resseladas (`:214`, `sessionFromCookie`). Elas continuam abertas com a senha antiga até expirar. Mitigação: documentar; testado em "Sessão por header".
- **R-05 — Reselagem única por sessão.** Na primeira requisição após a rotação, cada sessão ativa recebe um `Set-Cookie` novo. É um custo de uma selagem por sessão, não recorrente.
- **R-06 — Tamanho de `src/utils/session.ts`.** O arquivo já tem 465 linhas, acima da meta de 200 de `AGENTS.md`. A mudança adiciona cerca de 50 linhas. Decisão: manter no mesmo arquivo para um diff pequeno. Pendência: mover as funções de unseal para `src/utils/internal/` em tarefa de refatoração, se o time quiser.
- **R-07 — Divergência entre caminhos.** A combinação de legado com extra pode abrir por dois caminhos diferentes (RF-05 e RF-02). Mitigação: os testes de legado e de extra são separados, e o intercalado de D-04 é coberto pelo teste de legado com extra.
- **R-08 — Ordem de tentativas e mensagens de erro.** Se nenhuma senha abrir, o erro relançado é o da última tentativa, sempre `"Bad hmac value"`. Como `getSession` o descarta, isso não aparece para o usuário final, mas é relevante para quem chama `unsealSession` diretamente (exportada em `src/index.ts:209`).
