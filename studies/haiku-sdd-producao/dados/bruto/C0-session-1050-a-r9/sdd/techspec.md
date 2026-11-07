# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md`. Esta spec cobre RF-01 a RF-08. Nenhum código do projeto foi alterado.

## 1. Estado atual (conferido no código)

- `SessionConfig.password: string` em `src/utils/session.ts:48` (doc em `:40-47`).
- Selagem: `sealSession` chama `seal(session, config.password, …)` em `src/utils/session.ts:300`.
- Abertura: `unsealSession` (`src/utils/session.ts:312-367`) chama `unseal(sealed, config.password, sealOptions)` em `:324`. No `catch` (`:325`), se o erro for `"Bad hmac value"` e o fallback legado estiver ligado (`:332-337`), tenta de novo com 1 iteração PBKDF2 em `:340-344` e marca `kLegacySeal` em `:346`.
- `getSession` (`src/utils/session.ts:149`) engole falha de unseal com `.catch(() => {})` (`:196`), descarta o `kLegacySeal` (`:199-202`) e reseala via `updateSession` quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`:214`). Sem `id`, cria sessão nova (`:225-229`).
- `useSession` (`:108`) e `updateSession` (`:241`) só usam a senha indiretamente (`getSession`/`sealSession`). `clearSession` (`:372`) recebe `Partial<SessionConfig>` e não lê `password`.
- `iron-crypto`: `seal` (`src/utils/internal/iron-crypto.ts:58-84`) lança `"Empty password"` (`:65-67`); `unseal` (`:87-150`) valida prefixo (`:106`), expiração do seal `"Expired seal"` (`:110-118`) **antes** de tocar na senha, e só então compara HMAC, lançando `"Bad hmac value"` (`:135-137`). Ou seja, "Expired seal" independe da senha.
- Símbolos internos: `src/utils/internal/session.ts:3-9` (`kGetSession`, `kSessionNew`, `kLegacySeal`).
- Fora de escopo e sem mudança: `src/types/context.ts:32` (`basicAuth.password`), `src/utils/auth.ts` (`password` do basic auth), `src/utils/internal/iron-crypto.ts` (já aceita `string` por chamada; não muda).
- Reexporta `SessionConfig` em `src/index.ts:203`; alargar o tipo não exige mudar o export.

## 2. Decisões de arquitetura

### D-01 — Helper interno único para normalizar `password`
**Contexto:** quatro pontos precisam da lista (`getSession`, `sealSession`, `unsealSession`, e a validação de lista vazia).
**Alternativas:**
1. Espalhar `Array.isArray(config.password) ? … : …` em cada ponto.
2. Normalizar uma vez em `useSession` e passar uma config modificada adiante.
3. Helper interno `resolveSessionPasswords(config): string[]` chamado onde a senha é usada.

**Escolha: 3.** A opção 1 duplica a regra de lista vazia; a 2 não cobre quem chama `getSession`/`sealSession`/`unsealSession` diretamente (RF-07) e obrigaria a mutar/clonar a config do usuário. O helper fica em `src/utils/internal/session.ts` (após `:18`, com o restante dos itens internos; a convenção do projeto manda helpers internos para `utils/internal/`), sem exportar pelo `src/index.ts`, logo nenhum nome público novo.

### D-02 — Tipo público: `string | string[]`, sem tupla
**Alternativas:** (a) `string | [string, ...string[]]` (não vazio no tipo); (b) `string | readonly string[]`; (c) `string | string[]`.
**Escolha: (c)**, exatamente o contrato do pedido. A tupla (a) rejeitaria `string[]` vindo de `process.env.X.split(",")`, forçando casts, e o PRD pede de qualquer forma rejeição em runtime (RF-05). `readonly` (b) é mais permissivo, mas foge do texto do contrato; fica como possível evolução. A validação de vazio é em runtime (D-05).

### D-03 — Estratégia de unseal: tentar cada senha em ordem, com o fallback legado dentro de cada tentativa
**Alternativas:**
1. Duas passadas: todas as senhas com iterações atuais, depois todas no modo legado.
2. Por senha: iterações atuais e, se der `"Bad hmac value"`, legado para a mesma senha; só então a próxima senha.
3. Detectar o id da senha no seal para escolher a senha direto.

**Escolha: 2.** Mantém o caso comum (primeira senha serve, seal atual) em 1 derivação, igual a hoje, e o fallback legado vale para senhas antigas (RF-06) sem duplicar a lógica de fallback. A 1 faria o caso "sessão antiga legada com senha antiga" pagar derivações a mais sem ganho; a 3 não serve porque o seal de sessão usa string pura, sem `id` (`src/utils/internal/iron-crypto.ts:68`, `id = ""`).

Regra de erro (resolve o risco do PRD sobre mascarar falhas):
- `"Bad hmac value"` (nas duas tentativas, atual e legada) → senha errada: segue para a próxima.
- Qualquer outro erro (`"Expired seal"`, `"Wrong mac prefix"`, `"Incorrect number of sealed components"`, `"Invalid expiration"`, `"Empty password"`, senha curta etc.) → lança na hora. Os de formato/expiração independem da senha (`iron-crypto.ts:98-118` rodam antes da senha) e os de senha indicam configuração inválida, que não deve ser mascarada tentando outra.
- Esgotadas as senhas → relança o erro da última tentativa. Com 1 senha isso é exatamente o erro de hoje (`"Bad hmac value"`), sem vazar nada novo; `getSession` já descarta o erro (`:196`).
- As validações `maxAge`/`idleTimeout` (`:349-365`) continuam depois do loop, uma vez, sobre o objeto aberto — por isso a expiração de sessão aberta com senha antiga dá `"Session expired!"` (RF-06).

### D-04 — Sela só com `passwords[0]`
`sealSession` passa a usar `resolveSessionPasswords(config)[0]`. Nada mais muda no formato (mesmo `sealDefaults`, mesmo `ttl`). Alternativa de selar com todas é inviável (iron sela com uma chave) e contradiz RF-02.

### D-05 — Lista vazia falha de forma explícita e cedo
`resolveSessionPasswords` lança `Error("Session password is required: provide at least one password")` para `[]`. É chamado:
- no início de `getSession` (antes de tocar `context.sessions`, `src/utils/session.ts:153`), para que ler a sessão falhe mesmo sem cookie na requisição — sem isso, um request sem cookie nunca chegaria em `unsealSession` e `[]` passaria despercebido até o primeiro `update`. `useSession` herda isso porque chama `getSession` (`:115`);
- em `sealSession` e `unsealSession`, que são públicas e podem ser chamadas diretamente.

Strings **não** são validadas pelo helper (inclusive `""`): o comportamento atual (`seal` lança `"Empty password"`, `iron-crypto.ts:65`) é preservado para a senha única. O erro de `getSession` se propaga porque ocorre fora do `.catch(() => {})` de `:196`.
**Alternativa descartada:** validar só em `sealSession`. Rejeitada por violar RF-05 ("lida ou selada").

### D-06 — Migração automática para a senha nova ao ler (reseal)
O PRD deixa em aberto se `getSession` reseala. **Decisão: sim, para sessões de cookie**, como já ocorre no caso legado.
- `unsealSession` marca o resultado com um novo símbolo interno `kStaleSealPassword` (em `src/utils/internal/session.ts`, ao lado de `kLegacySeal`, `:7-9`) quando a senha que abriu não é a primeira.
- `getSession` remove a marca (como faz com `kLegacySeal`, `:199-202`) e inclui a condição em `:214`: `(legacySeal || stale || shouldSlide(session, config))`.

**Alternativas:** (a) não migrar, só ao `update` (sessões só lidas ficam presas à senha antiga para sempre, atrasando a remoção dela da lista — o risco "senha antiga vazada" do PRD); (b) reaproveitar `kLegacySeal` (nome enganoso: significaria "reseal necessário", e acoplaria a semântica do fallback que será removido na v3, `:326`).
**Escolha:** símbolo próprio. É interno e não é nome público. Sessão lida via header (`sessionFromCookie === false`) não é resselada, igual ao legado: o header não tem como receber `Set-Cookie`.
**Consequência:** a primeira requisição pós-rotação de cada usuário emite um `Set-Cookie` extra (1 seal), uma vez só.

### D-07 — Ajuste dos testes existentes, não do contrato
`sessionConfig` é tipado `SessionConfig` (`test/session.test.ts:21`), então `sessionConfig.password` vira `string | string[]` e deixa de ser aceito por `seal`/`unseal`, que exigem `string` (`test/session.test.ts:137`, `:157`, `:164`). Os usos em `password: sessionConfig.password` (`:195`, `:238`, `:272`, `:318`, `:351`, `:382`, `:418`, `:483`, `:515`, `:544`, `:586`, `:622`) continuam válidos com o tipo largo.
**Alternativas:** (a) cast `as string` nesses 3 pontos; (b) extrair uma `const password = "1234567…"` no topo do `describeMatrix` e usá-la em `sessionConfig` e nas 3 chamadas diretas.
**Escolha: (b)**, sem cast e sem perder nada do que os testes verificam (mesma senha, mesmas asserções).

## 3. Arquivos a alterar

| Arquivo | Linha(s) | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:40-48` | `password: string \| string[]`; reescrever o JSDoc (primeira sela, demais só abrem, não vazia, cada senha ≥ 32 caracteres, manter lista curta e remover senhas antigas após a vida útil das sessões). |
| `src/utils/session.ts` | `:1-5` | importar o helper e `kStaleSealPassword`. |
| `src/utils/session.ts` | `:153` | primeira linha útil de `getSession`: `resolveSessionPasswords(config)` (D-05). |
| `src/utils/session.ts` | `:199-202`, `:214` | consumir/remover `kStaleSealPassword` e incluí-lo na condição de reseal (D-06). |
| `src/utils/session.ts` | `:300` | `seal(session, resolveSessionPasswords(config)[0]!, …)` (D-04). |
| `src/utils/session.ts` | `:312-348` | loop de unseal por senha (D-03), mantendo as checagens de `maxAge`/`idleTimeout` de `:349-365` intactas depois do loop. |
| `src/utils/internal/session.ts` | após `:9` / `:18` | `kStaleSealPassword` e `resolveSessionPasswords`. |
| `test/session.test.ts` | `:21-24`, `:137`, `:157`, `:164` | `const password` compartilhada (D-07). |
| `test/session.test.ts` | novo `describe("password rotation")` ao fim do `describeMatrix` | testes novos (seção 5). |
| `docs/4.examples/handle-session.md` | após o bloco de aviso de `:35-45` | seção curta "Rotating the password" com exemplo `password: [novaSenha, senhaAntiga]`. |

Não mudam: `src/index.ts:203`, `src/types/context.ts:32`, `src/utils/auth.ts`, `src/utils/internal/iron-crypto.ts`, `test/bench/session.ts:20`, `docs/2.utils/4.security.md` (gerado por automd; assinaturas de funções não mudam).

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts (público — único nome alterado)
export interface SessionConfig {
  password: string | string[];
  // demais campos inalterados
}

// src/utils/internal/session.ts (interno, não exportado em src/index.ts)
export const kStaleSealPassword: unique symbol =
  /* @__PURE__ */ Symbol.for("h3.internal.session.stale-seal-password");

/** Senhas da config como lista. Lança se `password` for um array vazio. */
export function resolveSessionPasswords(config: Pick<SessionConfig, "password">): string[];
```

Comportamento de `resolveSessionPasswords`: `string` → `[password]`; `string[]` não vazio → o próprio array; `[]` → `Error("Session password is required: provide at least one password")`. `isolatedDeclarations` exige o tipo de retorno explícito (por isso `: string[]` e `unique symbol` anotados, como em `internal/session.ts:3`).

Pseudocódigo de `unsealSession` (assinatura inalterada: `(event, config, sealed) => Promise<Partial<Session>>`):

```ts
const passwords = resolveSessionPasswords(config);
let unsealed, error;
for (const [index, password] of passwords.entries()) {
  try {
    unsealed = await unsealWithLegacyFallback(sealed, password, config, sealOptions); // lógica atual de :324-347
    if (index > 0) unsealed[kStaleSealPassword] = true;
    break;
  } catch (e) {
    if (!isBadHmac(e)) throw e;   // D-03
    error = e;
  }
}
if (!unsealed) throw error;
// checagens de maxAge/idleTimeout inalteradas
```

Para manter `unsealSession` curta (projeto prefere helpers internos no fim do arquivo), a lógica atual do `try/catch` com fallback legado é movida para uma função local não exportada no fim de `src/utils/session.ts`, sem mudar suas regras (`legacySealFallback === false`, `iterations === 1`, `error.message === "Bad hmac value"`). O resultado `null` de `unseal` (payload vazio, `iron-crypto.ts:149`) continua tratado como hoje: o `if (unsealed)` de `:345` só marca símbolos em objeto truthy, e deve-se proteger `unsealed[kStaleSealPassword] = true` do mesmo jeito.

## 5. Estratégia de testes

Todos em `test/session.test.ts` dentro do `describeMatrix` existente (roda em `web` e `node`). Dois segredos distintos de ≥ 32 caracteres (`oldPassword`, `newPassword`); sessões antigas geradas com `seal(...)` direto, como o teste legado em `:134-159`.

| Teste | RF |
| --- | --- |
| Config `password: "string"` segue criando/lendo sessão (os testes atuais já cobrem; acrescentar um caso com `password: [senha]` de um elemento, idêntico à string). | RF-01 |
| Sessão criada com `[nova, antiga]` só abre com `nova`: `unseal(valor, nova)` funciona e `unseal(valor, antiga)` rejeita `"Bad hmac value"`. | RF-02 |
| Cookie selado com `antiga` + config `[nova, antiga]` → mesma `id`/dados, sem sessão nova. Também via header `x-h3-test-session`. | RF-03 |
| Cookie selado com `outra` + `[nova, antiga]` → `id` diferente (sessão nova), sem erro propagado. | RF-04 |
| `password: []` → `getSession`/`useSession` e `sealSession` rejeitam com a mensagem de senha obrigatória, mesmo sem cookie na requisição. | RF-05 |
| Sessão expirada (`maxAge` com `createdAt` antigo) selada com senha antiga → `unsealSession` rejeita `"Session expired!"`; e seal com `ttl` vencido continua `"Expired seal"` sem tentar outras senhas. | RF-06 |
| Seal legado (`iterations: 1`) com senha antiga → aberto e resselado com `nova`; com `legacySealFallback: false` é rejeitado. | RF-06 |
| `useSession` + `session.update` após abrir sessão da `antiga`: cookie reemitido abre com `nova` (não com `antiga`) e preserva os dados. | RF-07 |
| `getSession` de cookie antigo emite `Set-Cookie` selado com `nova` (D-06); lido via header, não emite. Segunda requisição com o cookie novo não emite reseal extra. | D-06 |
| `unsealSession`/`sealSession` chamadas direto com `string[]`. | RF-07 |

Verificação final (RF-08): `pnpm vitest run test/session.test.ts`, depois `pnpm lint`, `pnpm typecheck` e a suíte completa `pnpm vitest run`. Fluxo do `AGENTS.md`: escrever os testes novos primeiro e confirmar que falham antes da implementação. Atenção a `ctx.errors` (auto-assertado em `afterEach`): nenhum teste de sessão inválida pode deixar erro não tratado.

## 6. Riscos

| Risco | Mitigação |
| --- | --- |
| **CPU:** sessão inválida custa até 2 × N derivações PBKDF2 (8192 iterações, mais 1 do legado). Pode ser usado para amplificar carga com cookie forjado. | Lista curta documentada no JSDoc e nos docs; comportamento de senha única inalterado (2 derivações, como hoje). Sem cache de chaves nesta entrega. |
| **Mascarar erros:** tratar tudo como "senha errada" esconderia expiração/config inválida. | D-03: só `"Bad hmac value"` avança; o resto lança. Dependência da mensagem já existe em `:336`; teste cobre os dois caminhos. |
| **Reseal extra:** D-06 emite `Set-Cookie` na primeira leitura pós-rotação. Cache/CDN de respostas com `Set-Cookie` pode se comportar diferente. | Só ocorre uma vez por sessão e só em cookie; documentado. É o mesmo mecanismo do legado e do `idleTimeout`. |
| **Tipagem:** consumidores externos que liam `config.password` como `string` quebram no `typecheck`. | Alargar o tipo é pedido pelo contrato; no repo, só os 3 pontos de `test/session.test.ts` (D-07). `tsc --noEmit` valida o resto (`bench` passa `string`). |
| **Lista vazia vinda de env** (`"".split(",")` dá `[""]`, não `[]`): string vazia passa pelo helper e falha em `seal` com `"Empty password"`. | Comportamento consistente com a senha única atual; não validamos strings aqui. |
| **Senha antiga vazada** continua válida enquanto estiver na lista. | Documentar remoção após a vida útil das sessões; D-06 acelera a migração. |
| **Erro de `getSession` com `[]`** muda de "silencioso" para exceção em quem hoje passa config inválida. | É uma configuração nova (antes impossível pelo tipo); RF-05 exige falha explícita. |
