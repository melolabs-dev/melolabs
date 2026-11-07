# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md`. Esta especificação só descreve a mudança; nenhum código do projeto foi alterado.

## 1. Resumo

`SessionConfig.password` passa de `string` para `string | string[]` (lista não vazia). A primeira senha sela; as demais só abrem. O `unsealSession` tenta as senhas em ordem; o `getSession` reseala com a primeira senha a sessão de cookie aberta por uma senha antiga. Nenhum nome público novo. Todo o código novo fica em `src/utils/session.ts` e `src/utils/internal/session.ts`; `iron-crypto.ts` não muda.

## 2. Estado atual (conferido no código)

- `src/utils/session.ts:48` — `password: string;`, com JSDoc em `:40-47` (mínimo de 32 caracteres e aviso de entropia).
- `src/utils/session.ts:300` — `sealSession` chama `seal(session, config.password, …)`.
- `src/utils/session.ts:324` — `unsealSession` chama `unseal(sealed, config.password, sealOptions)`.
- `src/utils/session.ts:332-339` — o fallback legado só roda se o erro for `Bad hmac value`.
- `src/utils/session.ts:340` — segunda chamada a `unseal` com 1 iteração PBKDF2; `:345-347` marca `kLegacySeal`.
- `src/utils/session.ts:196-198` — `getSession` chama `unsealSession(...).catch(() => {})`: qualquer erro de unseal vira "sem sessão".
- `src/utils/session.ts:199-202` — lê e remove `kLegacySeal`.
- `src/utils/session.ts:214` — `if (session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config)))` reseala via `updateSession`. É o ponto de reselagem do RF-04.
- `src/utils/internal/session.ts:7-9` — define `kLegacySeal` (símbolo interno, não exportado em `src/index.ts`).
- `src/utils/internal/iron-crypto.ts:65-67` e `:94-96` — `seal` e `unseal` lançam `Empty password` quando `!password`. Um `[]` é truthy e passaria por essa checagem.
- `src/utils/internal/iron-crypto.ts:122-123` — `unseal` aceita `string` ou `Uint8Array` direto; passar `string[]` cairia no ramo de mapa por id (`:124`) e daria `Cannot find password: default`.
- `src/utils/internal/iron-crypto.ts:172-173` e `:191-195` — `generateKey` lança `Empty password` e `Password string too short (min 32 characters required)`.
- `src/utils/internal/iron-crypto.ts:22` e `:28` — `minPasswordlength: 32` em `defaults.encryption` e `defaults.integrity`.
- `src/utils/internal/iron-crypto.ts:135-136` — a falha de HMAC lança `Bad hmac value`, único erro que indica "senha errada".
- `src/types/context.ts:32` — `password?: string` é do basic auth, fora de escopo.
- `test/session.test.ts:21-25` — `sessionConfig: SessionConfig` tem o tipo da interface. Quando `password` virar união, as linhas `:137`, `:157` e `:164` (passam `sessionConfig.password` a `seal`/`unseal`, que esperam `string`) quebram o typecheck.
- `test/session.test.ts:195`, `:238`, `:272`, `:318`, `:351`, `:382`, `:418`, `:483`, `:515`, `:544`, `:586`, `:622` — reusam `sessionConfig.password` em outras configs. Continuam válidas porque o campo aceita a união.
- `docs/4.examples/handle-session.md:36-43` (aviso de entropia), `:120-149` (seção Options) e `:151` (Expiration) — local da documentação nova.

## 3. Decisões de arquitetura

### D-01 — Normalizar a senha em um único helper interno

**Contexto.** `config.password` é lido em dois pontos (`session.ts:300`, `:324`) e agora pode ser lista. O PRD aponta a regressão de tipo como risco e pede normalização em um ponto.

**Alternativas.**
1. Espalhar `Array.isArray(config.password)` em `sealSession` e `unsealSession`.
2. Um helper interno `getPasswords(config, sealOptions): string[]` no fim de `session.ts` (convenção "helpers internos no fim do arquivo"), que valida e devolve sempre uma lista.
3. Normalizar `config` uma vez em `useSession` e propagar a versão normalizada.

**Escolha: 2.** A opção 1 duplica a validação. A opção 3 não cobre quem chama `sealSession`/`unsealSession`/`getSession` diretamente, que são exports públicos. O helper é chamado no início de `sealSession` e `unsealSession`. O custo é um `Array.isArray` e, para string, um array de um item; é desprezível frente ao PBKDF2 (RF-05).

### D-02 — Validar a lista inteira antes de qualquer cripto

**Contexto.** RF-06 exige que `[]`, item vazio e item curto sejam erro de configuração. Sem validação prévia, `[]` passaria por `!password` (`iron-crypto.ts:65`), e uma senha curta que não fosse a primeira só falharia se o cookie chegasse a ela, o que deixaria a má configuração passar em silêncio.

**Alternativas.**
1. Confiar nos erros do `generateKey` (`iron-crypto.ts:172`, `:192`).
2. Validar no helper de D-01: lista vazia ou item não string/vazio lança `Empty password`; item com menos de `max(encryption.minPasswordlength, integrity.minPasswordlength)` lança `Password string too short (min N characters required)`, o mesmo texto do iron.

**Escolha: 2.** Reaproveita as mensagens atuais, então a "natureza" do erro é a mesma (`Error`), e o mínimo vem de `sealOptions` (default 32, `iron-crypto.ts:22`, `:28`) em vez de uma constante nova. A validação roda em todos os itens, não só no que seria usado. O custo é O(n) em strings curtas.

**Consequência a registrar.** `getSession` engole erros de unseal (`session.ts:197`). Com `password: []` e um cookie presente, `getSession` isolado devolve sessão nova, como hoje acontece com senha curta. A falha aparece em `useSession` (via `updateSession`, `:267`) e em `sealSession`, que é o que o RF-06 exige. Não se muda o `.catch` do `getSession`, para não alterar o comportamento de sessão inválida.

### D-03 — Selar sempre com `passwords[0]`

`sealSession` (`session.ts:300`) passa `passwords[0]` a `seal`. É o único ponto de selagem: `updateSession` (`:267`) e a reselagem de `getSession` (`:215`) passam por ele, então o RF-02 vale para legado, `idleTimeout` e rotação sem código extra.

### D-04 — Ordem de tentativa no unseal: todas as senhas na iteração atual, depois todas no legado

**Contexto.** RF-03 e RF-07 pedem tentar as senhas em ordem e manter o fallback legado, inclusive com as antigas.

**Alternativas.**
- **A.** Por senha: (atual, legado) para a senha 1, depois (atual, legado) para a senha 2.
- **B.** Fase 1: iteração atual com cada senha. Fase 2 (só se todas falharam com `Bad hmac value`): iteração 1 com cada senha.

**Escolha: B.** O caso comum durante uma rotação é um cookie moderno selado com a senha antiga, e a opção A o faria pagar um PBKDF2 legado inútil na senha nova (barato, mas desnecessário). Em B, o pior caso (cookie inválido) custa 2·n derivações, igual a A, e o custo da senha única continua o de hoje (RF-05). Sessões legadas selam-se com poucas iterações, então a fase 2 é a rara.

**Regras de erro (risco "erros mascarados").**
- Só se avança para a próxima senha quando o erro é `Error` com `message === "Bad hmac value"`, a mesma condição de `session.ts:336`.
- Qualquer outro erro (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, JSON inválido) é propagado de imediato.
- A fase 2 respeita `legacySealFallback === false` e `sealOptions.integrity.iterations === 1` (`:333-334`).
- Se todas as tentativas falharem, relança-se o primeiro `Bad hmac value`.

**Implementação sugerida.** Um helper interno `unsealWithPasswords(sealed, passwords, options): Promise<{ value; index }>` que percorre a lista e devolve também o índice da senha que abriu. `unsealSession` o chama duas vezes (atual e legado) e trata o resultado. Isso substitui o `try/catch` de `session.ts:323-348`, preservando a ordem das checagens de `maxAge` e `idleTimeout` (`:349-365`), que continuam depois do unseal e valem igualmente para qualquer senha (RF-07).

### D-05 — Sinalizar "aberta com senha antiga" por símbolo interno

**Contexto.** O RF-04 exige que `getSession` saiba que a sessão foi aberta por uma senha que não é a primeira. `unsealSession` é um export público com retorno `Promise<Partial<Session>>`, então o sinal precisa viajar sem mudar a assinatura nem criar nome público.

**Alternativas.**
1. Novo campo público em `Session` (ex.: `rotated`). Rejeitada: nome público novo, proibido.
2. Reaproveitar `kLegacySeal` para "precisa reselar". Rejeitada: mistura dois significados e dificulta a leitura dos testes.
3. Novo símbolo interno `kStaleSeal` em `src/utils/internal/session.ts`, ao lado de `kLegacySeal` (`:7-9`), não exportado em `src/index.ts`. `unsealSession` o define como propriedade não enumerável do objeto retornado (índice > 0 ou legado) e `getSession` o lê e remove, como faz com `kLegacySeal` (`:199-202`).

**Escolha: 3**, seguindo o padrão `k` e o mecanismo já existente. Para um símbolo de chave, `Object.assign(session, unsealed)` (`:208`) copiaria o símbolo para a sessão, então `getSession` deve apagá-lo antes, como já faz com `kLegacySeal`. Se o objeto retornado por `unsealSession` for serializado por quem o chamou diretamente, símbolos não entram no JSON.

### D-06 — Reselar em `getSession` com a condição existente, ampliada

A condição de `session.ts:214` passa a `session.id && sessionFromCookie && (legacySeal || stale || shouldSlide(session, config))`, em que `stale` vem de D-05. A reselagem usa o mesmo `updateSession` (`:215`), que sela com `passwords[0]` (D-03) e emite um único `Set-Cookie`. Sessões do cabeçalho (`sessionFromCookie === false`) não são reseladas (RF-04). Com cookie já selado com a primeira senha, `stale` é falso e nenhum `Set-Cookie` extra sai (RF-04, RF-05). Quando `legacySeal` e `shouldSlide` também valem, há uma só reselagem, pois o `if` é único.

### D-07 — Tipo e JSDoc de `password`

`password: string | string[];` em `session.ts:48`. O JSDoc descreve: uma string vale como hoje; numa lista não vazia a primeira sela e as demais só abrem; o mínimo de 32 caracteres e o aviso de entropia valem para cada senha; a lista deve ser curta e temporária, porque cada senha extra pode custar um PBKDF2 por requisição inválida e uma senha antiga vazada continua aceita. Não se usa tupla `[string, ...string[]]`: o PRD pede erro de configuração em runtime para `[]`, e um tipo mais estreito dificultaria quem monta a lista a partir de variáveis de ambiente. A validação de D-02 cobre o caso.

### D-08 — Sem mudança em `iron-crypto.ts`

`seal` e `unseal` recebem sempre uma `string`. As mensagens de erro são reaproveitadas copiando o texto, sem importar nada novo. Isso respeita o "fora de escopo" do PRD (nenhuma alteração em algoritmos, iterações ou formato do selo).

### D-09 — Ajuste mínimo dos testes existentes

**Problema.** Com `password` como união, `test/session.test.ts:137`, `:157` e `:164` deixam de compilar.

**Alternativas.**
1. Cast `as string` em cada uso. Rejeitada: esconde o tipo e some quando o campo mudar de novo.
2. Extrair `const password = "1234567…"` (a string de `:23`) no escopo do `describeMatrix`, usá-la em `sessionConfig` e nas três chamadas de `seal`/`unseal`.

**Escolha: 2.** Os testes continuam verificando exatamente o mesmo; só muda a origem da string. Os demais usos de `sessionConfig.password` (`:195` etc.) ficam como estão. O tipo anotado de `sessionConfig` não é alterado.

## 4. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:40-48` | Tipo e JSDoc de `password` (D-07). |
| `src/utils/session.ts` | `:196-216` | `getSession` lê `kStaleSeal`, apaga-o antes do `Object.assign` e amplia a condição de reselagem (D-05, D-06). |
| `src/utils/session.ts` | `:282-307` | `sealSession` usa `passwords[0]` (D-01, D-03). |
| `src/utils/session.ts` | `:312-348` | `unsealSession` usa os helpers de D-04 e marca `kStaleSeal`/`kLegacySeal`. As checagens `maxAge`/`idleTimeout` (`:349-365`) ficam intactas. |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | Helpers internos `getPasswords` e `unsealWithPasswords`. |
| `src/utils/internal/session.ts` | após `:9` | `export const kStaleSeal` (símbolo interno). |
| `test/session.test.ts` | `:21-25`, `:137`, `:157`, `:164` | Constante `password` extraída (D-09). Novos testes em bloco `describe("password rotation")`. |
| `docs/4.examples/handle-session.md` | após `:149` (fim de Options) | Nova subseção "Rotate the password" com exemplo. |
| `docs/2.utils/4.security.md` | `:56-62` | Só se o texto de `sealSession`/`unsealSession` citar a senha; conferir na implementação. |

Não alterar: `src/index.ts` (nenhum export novo; `test/unit/package.test.ts:125`, `:149` confere a lista de exports públicos e deve continuar igual), `src/utils/internal/iron-crypto.ts`, `src/types/context.ts:32`, `src/utils/auth.ts`.

## 5. Contratos e assinaturas

```ts
// src/utils/session.ts (público)
export interface SessionConfig {
  password: string | string[]; // lista: [0] sela; todas abrem
  // demais campos inalterados
}
// Assinaturas públicas inalteradas:
// useSession, getSession, updateSession, sealSession, unsealSession, clearSession

// src/utils/session.ts (internos, não exportados)
function getPasswords(config: SessionConfig, options: SealOptions): string[];
// Lança Error("Empty password") para [], item vazio ou não string.
// Lança Error("Password string too short (min N characters required)") para item curto.

function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<{ value: unknown; index: number }>;
// Avança de senha só em Error("Bad hmac value"); relança o primeiro se todas falharem.

// src/utils/internal/session.ts (interno)
export const kStaleSeal: unique symbol; // Symbol.for("h3.internal.session.stale-seal")
```

Comportamento observável:

| Config | Cookie selado com | Resultado |
| --- | --- | --- |
| `A` ou `[A]` | `A` | igual a hoje; sem reselagem extra |
| `[A, B]` | `A` | sessão aberta; sem `Set-Cookie` |
| `[A, B]` | `B` | sessão aberta (mesmos `id` e `data`); `Set-Cookie` selado com `A` |
| `[A, C]` | `B` | sessão nova (`id` diferente) |
| `[A, B]` | `B`, cabeçalho `x-h3-session` | sessão aberta; sem reselagem |
| `[A, B]` | `B`, `createdAt` além de `maxAge` | rejeitada por expiração |
| `[A, B]` | `B`, 1 iteração | aberta pelo fallback legado e reselada com `A` |
| `[]`, `[A, ""]`, `[A, "curta"]` | qualquer | `useSession`/`sealSession` lançam erro de senha |

## 6. Estratégia de testes

Arquivo: `test/session.test.ts`, dentro de `describeMatrix` (roda em `web` e `node`). Usar `seal` de `iron-crypto.ts` para fabricar cookies com a senha antiga, como os testes legados em `:134-159`. Senhas de teste: três strings distintas de 32+ caracteres (`A`, `B`, `C`).

| Teste | Cobre |
| --- | --- |
| Cookie criado com `[A, B]` abre com `A` e não abre só com `B` (`unseal` direto). | RF-02 |
| Cookie de `B` com `[A, B]` recupera `id` e `data`; com `[A, C]` devolve `id` novo. | RF-03 |
| Cookie de `B` gera `Set-Cookie` selado com `A` preservando `id`/`data`; cookie de `A` não gera. | RF-04 |
| Mesmo cookie de `B` via cabeçalho `x-h3-test-session`: sem `Set-Cookie`. | RF-04 |
| String e `[string]` produzem os mesmos resultados nos fluxos básicos (parametrizar o `sessionConfig`). | RF-05 |
| `[]`, `[A, ""]` e `[A, "curta"]` fazem `useSession` rejeitar com erro de senha e sem `Set-Cookie`; `sealSession` idem. | RF-06 |
| `maxAge` vencido com cookie de `B` é rejeitado; cookie legado (1 iteração) com `B` abre e é reselado com `A`; `legacySealFallback: false` o rejeita. | RF-07 |
| Cookie corrompido (formato) com lista de 2 senhas não vira erro mascarado: sessão nova, sem tentar a segunda senha após erro não HMAC (conferível espiando `unseal` com `vi.spyOn` no módulo, se viável, ou pelo comportamento). | Risco "erros mascarados" |
| Mutação: remover o laço de senhas em `unsealSession` ou o `kStaleSeal` faz pelo menos um teste falhar. | RF-08 |

Para o `idleTimeout` e `Date`, usar `vi.useFakeTimers({ toFake: ["Date"] })` como em `:190`. Verificações finais: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint` (inclui typecheck) e `pnpm typecheck`; depois `pnpm test` se o tempo permitir. Teste de tipo opcional em `test/unit/types.test-d.ts`: `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`.

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| CPU: cada senha extra custa um PBKDF2 (8192 iterações) por cookie inválido, mais a fase legado. | DoS amplificado por n. | Documentar lista curta; fase legado só após `Bad hmac value`; sem tentativa após erro não HMAC (D-04). Custo da senha única inalterado. |
| Erro de configuração engolido por `getSession` (`session.ts:197`). | `getSession` isolado com `[]` não falha. | D-02: falha em `useSession`/`sealSession`/`updateSession`; documentado. Mudar o `.catch` ficou fora de escopo. |
| Reselagem emite `Set-Cookie` em requisições de leitura. | Respostas cacheáveis ganham cookie uma vez por sessão rotacionada. | Ocorre só para cookies e uma vez (depois o cookie já está com `A`); mesmo mecanismo de `legacySeal`. Documentar. |
| Senha antiga vazada permanece aceita enquanto estiver na lista. | Cookies forjados válidos. | Documentar lista enxuta e remoção das antigas após a vida máxima das sessões. |
| `kStaleSeal` vazar para a sessão via `Object.assign` (`:208`). | Símbolo na `Session` serializada pelo handler. | Apagá-lo antes do `assign`, como `kLegacySeal`; teste verifica `Object.getOwnPropertySymbols`. |
| Mudança de tipo quebra consumidores que leem `config.password` como `string`. | Quebra de typecheck no código do usuário. | Aceito: é a mudança pedida. O tipo cresce (união), o que é compatível para quem só escreve a config. |
| Falso positivo no avanço de senha: erro `Bad hmac value` lançado por outra causa. | Tentativa extra inofensiva. | O iron só emite essa mensagem na comparação do HMAC (`iron-crypto.ts:136`). |
| Ordem de erro em `unsealSession` mudar o erro relançado para chamadores diretos. | Mensagem diferente em casos raros. | Relançar o primeiro `Bad hmac value`, igual ao erro de hoje com uma senha. |

## 8. Fora de escopo

Os do PRD §3: parâmetro `extraUnsealPasswords`, novos nomes públicos, mapa de senhas com id, `Uint8Array`, mudanças em `iron-crypto.ts`, rotação automática, revogação ativa e `requireBasicAuth`.
