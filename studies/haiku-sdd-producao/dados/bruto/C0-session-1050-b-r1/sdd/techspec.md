# Especificação técnica — `extraUnsealPasswords` nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Todo o código afetado está em `src/utils/session.ts`, além de um símbolo interno em `src/utils/internal/session.ts`, testes e documentação. Nenhum nome público novo além de `SessionConfig.extraUnsealPasswords`.

## 1. Estado atual (conferido no código)

- `SessionConfig.password: string` em `src/utils/session.ts:48`; o último campo da interface é `generateId` (`src/utils/session.ts:98`).
- `getSession` chama `unsealSession(...).catch(() => {})` (`src/utils/session.ts:196`), remove o marcador `kLegacySeal` (`src/utils/session.ts:199-202`) e reseala quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`src/utils/session.ts:214-216`). Sessão do header tem `sessionFromCookie = false` (`src/utils/session.ts:189-193`), portanto nunca é resselada.
- `sealSession` sela só com `config.password` (`src/utils/session.ts:300`). `updateSession` chama `sealSession` (`src/utils/session.ts:267`).
- `unsealSession` (`src/utils/session.ts:312-367`): tenta `unseal(sealed, config.password, sealOptions)` (`:324`); em `"Bad hmac value"` tenta de novo com 1 iteração (`:332-344`) e marca `kLegacySeal` (`:346`); só depois valida `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`).
- `unseal` em `src/utils/internal/iron-crypto.ts:87-150` valida prefixo (`:106`), expiração do selo (`:115-117`, `"Expired seal"`) e só então deriva a chave e compara o HMAC (`:133-137`, `"Bad hmac value"`). Ou seja: senha errada ⇒ exatamente `Bad hmac value`; expiração, formato e prefixo falham **antes** de olhar a senha. Senha string menor que 32 caracteres lança `Password string too short` em `generateKey` (`src/utils/internal/iron-crypto.ts:192-195`).
- Símbolos internos de sessão: `src/utils/internal/session.ts:3-9`.
- Testes de sessão: `test/session.test.ts` (`sessionConfig` em `:21-25`; legado em `:134-186`; bloco "lazy creation" em `:692`). O arquivo termina na linha 777.
- Docs: guia em `docs/4.examples/handle-session.md` (seção "Options" `:120`, "Expiration" `:151`, "Use Multiple Sessions" `:190`); `docs/2.utils/4.security.md:42-72` é gerado por automd a partir dos JSDoc (`pnpm fmt`).

## 2. Decisões de arquitetura

### D-01 — Tipo do campo: `extraUnsealPasswords?: string[]`

- **Alternativas**: (a) `readonly string[]`; (b) aceitar `string | string[]`; (c) `string[]` simples.
- **Escolha**: (c), como exige o pedido e o RF-01. Um `readonly string[]` aceitaria também arrays mutáveis, mas diverge do contrato literal (`string[]`) e do estilo do restante da interface; `string | string[]` cria uma forma extra de configurar não pedida. `password` permanece `string`.
- **Efeito**: o campo entra em `SessionConfig` logo após `password` (`src/utils/session.ts:48`), com JSDoc dizendo: só abrem sessões; `password` é a única que sela; mesma exigência de entropia (≥ 32 caracteres, aleatória); ordem = ordem de tentativa, mais recente primeiro; cada senha extra custa uma derivação PBKDF2 em cookie inválido.

### D-02 — Onde fica o loop: dentro de `unsealSession`

- **Alternativas**: (a) loop em `getSession` chamando `unsealSession` com um `config` clonado por senha; (b) loop dentro de `unsealSession`; (c) mudar `iron-crypto` para aceitar lista (proibido: fora de escopo).
- **Escolha**: (b). `unsealSession` já é o ponto único de abertura (cookie, chunks e header passam por ele) e é exportado, então usuários que a chamam diretamente também ganham a rotação. (a) duplicaria `maxAge`/`idleTimeout` e perderia a distinção entre erro de senha e de expiração.
- **Forma**: extrair um helper interno (final do arquivo, sem export) `unsealWithPassword(sealed, password, config, sealOptions): Promise<Partial<Session>>` com o corpo atual das linhas 322-348 (tentativa normal + fallback legado). `unsealSession` fica: montar `sealOptions` → iterar candidatos → validar expiração (`:349-366`, inalterado) → retornar.

### D-03 — Ordem e critério de parada das tentativas

- **Alternativas**: (a) tentar qualquer erro seguinte com a próxima senha; (b) continuar só em `"Bad hmac value"`; (c) pré-filtrar por `kid` no selo (fora de escopo).
- **Escolha**: (b). Candidatos = `[config.password, ...(config.extraUnsealPasswords ?? [])]`, na ordem. Para cada um, `unsealWithPassword` (normal e, se aplicável, legado, nesta ordem: senha por senha, cada uma com o fallback legado — requisito do risco "interação com selo legado"). Se lançar erro cuja `message === "Bad hmac value"` e houver próximo candidato, continua; **qualquer outro erro é relançado imediatamente**.
- **Justificativa**: `Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components` e `Invalid expiration` independem da senha (ocorrem antes do HMAC, `iron-crypto.ts:98-118`); repeti-los só gastaria CPU. Mais importante, o PRD proíbe tentar outras senhas depois que uma abriu o selo e proíbe mascarar `Session expired!`: a validação de `maxAge`/`idleTimeout` ocorre depois do loop, com o resultado da senha que abriu, e seu erro nunca volta ao loop.
- **Erro final**: se todas falharem por HMAC, relança-se o **primeiro** erro (o da `password`), preservando mensagem e tipo de hoje (RF-05/RF-06). Guardar `firstError` e relançá-lo ao esgotar.
- **Consequência aceita**: uma senha extra curta/inválida só dispara `Password string too short` se for alcançada (selo não abriu com as anteriores); o erro sobe e `getSession` o descarta (`.catch(() => {})`, `:197`), tratando a sessão como inexistente. Documentar no JSDoc que a validação de entropia vale para elas.
- **Não validar a lista na configuração**: não há ponto de validação de config hoje; adicionar um criaria comportamento novo. `password` vazia/curta segue como está.

### D-04 — Sinalizar "aberta por senha extra": novo símbolo interno `kRotatedSeal`

- **Alternativas**: (a) reutilizar `kLegacySeal` como "precisa resselar"; (b) novo símbolo interno; (c) mudar o retorno de `unsealSession` para uma tupla ou objeto (quebra a API pública).
- **Escolha**: (b), em `src/utils/internal/session.ts` ao lado de `kLegacySeal` (`:7-9`), com `Symbol.for("h3.internal.session.rotated-seal")`, anotado `/* @__PURE__ */` como os demais. (a) misturaria dois significados (um sessão legada com `password` atual vs. aberta por senha antiga) e dificultaria testar RF-05. (c) quebraria `unsealSession`, que é exportada (`src/index.ts`). Não é um nome público: fica em `internal/` e não é reexportado.
- **Uso**: `unsealSession` seta `unsealed[kRotatedSeal] = true` quando o candidato vencedor tem índice > 0. Em sessão legada aberta por senha extra, ficam `kLegacySeal` e `kRotatedSeal` e há um único resselo.

### D-05 — Resselo em `getSession` (RF-04)

- **Alternativas**: (a) resselar em `unsealSession` (efeito colateral numa função de leitura, sem acesso ao evento: o parâmetro é `_event`); (b) em `getSession`, junto ao padrão de `kLegacySeal`; (c) resselar também sessões do header.
- **Escolha**: (b). Em `src/utils/session.ts:199-202` ler e apagar os dois marcadores (`kLegacySeal`, `kRotatedSeal`) **antes** do `Object.assign(session, unsealed)` — `Object.assign` copia símbolos enumeráveis próprios, e por isso o `delete` precisa vir antes (hoje já é assim para `kLegacySeal`); assim nenhum marcador vaza para `session` nem para `data`. A condição em `:214` passa a `(legacySeal || rotatedSeal || shouldSlide(session, config))`. Header: `sessionFromCookie` é `false`, então nada é resselado (c descartada, igual ao comportamento do selo legado e do `idleTimeout`).
- **Efeito de selo**: `updateSession` → `sealSession` sela com `config.password` e opções atuais; `createdAt`, `id` e `data` ficam intactos; com `idleTimeout`, `sealSession` restampa `lastSeenAt` (comportamento já existente).
- **Cookie em chunks**: `getChunkedCookie`/`setChunkedCookie` já cobrem o resselo; nenhuma mudança.
- **Limites conhecidos**: se `config.cookie === false` ou `event.res` não existe, `updateSession` não emite cookie (`src/utils/session.ts:266`); sem efeito colateral novo.

### D-06 — `sealSession`/`updateSession` não mudam (RF-03)

- **Escolha**: nenhuma alteração; `src/utils/session.ts:300` já usa só `config.password`. A garantia é coberta por teste, não por código novo.

### D-07 — Ajustes em testes e docs existentes

- **Testes existentes**: nenhum conta `Set-Cookie` de forma que a mudança afete (sem `extraUnsealPasswords`, o fluxo é idêntico); a expectativa é que a suíte atual passe sem edição. Se algum falhar, ajustar só o que a mudança alterar. A mensagem de erro do caminho sem extras é a mesma (`firstError`).
- **Docs**: `docs/4.examples/handle-session.md` ganha a seção "Rotate the Password" depois de "Expiration" (`:151-188`) e antes de "Use Multiple Sessions" (`:190`). `docs/2.utils/4.security.md` é regenerado por automd com `pnpm fmt` e não é editado à mão.

## 3. Arquivos a alterar

| Arquivo                                           | Local           | Mudança                                                       |
| ------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| `src/utils/session.ts:48`                         | `SessionConfig` | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (D-01)  |
| `src/utils/session.ts:199-202`                    | `getSession`    | Ler/apagar `kRotatedSeal` junto de `kLegacySeal`              |
| `src/utils/session.ts:214`                        | `getSession`    | Incluir `rotatedSeal` na condição de resselo                  |
| `src/utils/session.ts:312-348`                    | `unsealSession` | Loop de candidatos + helper `unsealWithPassword` (D-02, D-03) |
| `src/utils/session.ts:5`                          | imports         | Importar `kRotatedSeal`                                       |
| `src/utils/internal/session.ts:7-9`               | símbolos        | Novo `kRotatedSeal` (D-04)                                    |
| `test/session.test.ts` (após `:186`)              | testes          | Novo `describe("password rotation")` (seção 5)                |
| `docs/4.examples/handle-session.md` (após `:188`) | guia            | Seção de rotação, nota sobre custo de CPU e header (RF-08)    |
| `docs/2.utils/4.security.md:42-72`                | gerado          | Regenerar via `pnpm fmt`                                      |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/index.ts` (nenhum export novo; `test/unit/package.test.ts` não deve mudar), cookies, `sealSession`.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that may only open sessions, never seal them. `password`
   * is tried first, then each entry in order; the first that opens the seal
   * wins. A cookie session opened by one of these is resealed with `password`.
   * Same requirements as `password` (>= 32 chars, random). Each extra entry adds
   * one PBKDF2 derivation (two with `legacySealFallback`) for a cookie that does
   * not open, so keep the list short and drop old passwords once sessions migrated.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// assinaturas públicas inalteradas
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

// interno (final do arquivo, não exportado)
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // normal + fallback legado; seta kLegacySeal
```

```ts
// src/utils/internal/session.ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.rotated-seal",
);
```

Pseudocódigo de `unsealSession`:

```ts
const candidates = [config.password, ...(config.extraUnsealPasswords || [])];
let unsealed!: Partial<Session>, firstError: unknown;
for (const [index, password] of candidates.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, config, sealOptions);
    if (index > 0) (unsealed as any)[kRotatedSeal] = true;
    firstError = undefined;
    break;
  } catch (error) {
    firstError ??= error;
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
  }
}
if (firstError) throw firstError;
// validação de maxAge/idleTimeout inalterada
```

(Implementação final: ao relançar por erro não-HMAC, relançar o erro **atual**; ao esgotar a lista por HMAC, relançar o **primeiro**. `unsealed` nulo — `unseal` retorna `null` para payload vazio — mantém o tratamento atual de `unsealed &&` ao marcar.)

Invariantes: ausência ou `[]` ⇒ um único candidato ⇒ fluxo idêntico ao atual; `Session` não ganha campos; os marcadores nunca chegam a `session`/`data`.

## 5. Estratégia de testes

Arquivo: `test/session.test.ts`, novo `describe("password rotation", ...)` dentro de `describeMatrix` (roda em `web` e `node`). Helpers locais: `OLD = "a".repeat(8)+...` — senhas de ≥ 32 caracteres distintas (A, A2, B); `sealWith(password, payload, opts?)` usando `seal` e `sealDefaults` já importados (`:12`); rota própria com `useSession`/`getSession` e `name` próprio para isolar cookies (padrão das linhas `:172-178`).

| RF    | Teste                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-01 | Teste de tipo (`expectTypeOf`/`@ts-expect-error`) em `test/unit/types.test-d.ts` ou no próprio arquivo: `string[]` compila, `extraUnsealPasswords: "x"` é erro. Validado por `pnpm typecheck`.                                                                                                                                                                                                                                                                                 |
| RF-02 | Cookie selado com A, config `{password: B, extraUnsealPasswords: [A]}` ⇒ mesmos `id`, `createdAt`, `data`; idem via header `x-<name>-session`; idem cookie em chunks (payload grande com `cookie.chunkMaxLength` pequeno); e selo com a 2ª extra de `[A1, A2]` abre; ordem: com duas extras abrindo, vence a primeira (observável por um spy em `unseal` se necessário, senão por resselo).                                                                                    |
| RF-03 | Após `updateSession`/`sealSession` com `{password: B, extra: [A]}`: `unseal(sealed, B)` abre e `unseal(sealed, A)` rejeita (`Bad hmac value`).                                                                                                                                                                                                                                                                                                                                 |
| RF-04 | Cookie com A ⇒ resposta traz 1 `Set-Cookie` que abre com B e preserva `id`/`createdAt`/`data`; segunda requisição com o novo cookie e `extraUnsealPasswords` ausente e `[]` continua autenticada; o JSON de `session` não contém chaves-símbolo (`Object.getOwnPropertySymbols(session.data)` vazio) e header não resseala (`getSetCookie()` vazio).                                                                                                                           |
| RF-05 | Selo com `password` e extras ausente/`[]`/preenchido ⇒ sessão carregada e `getSetCookie()` com tamanho 0; spy garante que `unseal` é chamado 1 vez (sem extras tentadas). Mais a suíte existente intacta.                                                                                                                                                                                                                                                                      |
| RF-06 | Selo com A, config sem A ⇒ `id` diferente, `data` `{}`; também com `extraUnsealPasswords: []`.                                                                                                                                                                                                                                                                                                                                                                                 |
| RF-07 | Fake timers (`vi.useFakeTimers({ toFake: ["Date"] })`, padrão de `:189-190`): sessão com A vencida por `maxAge` e por `idleTimeout` ⇒ rejeitada; HMAC adulterado (trocar um caractere do último segmento) com A e com B ⇒ rejeitado; selo expirado (`ttl`) ⇒ rejeitado sem tentar extras; legado (1 iteração) selado com A ⇒ abre e é resselado com B e iterações atuais (`unseal(resealed, B, sealDefaults)` passa); `legacySealFallback: false` com legado de A ⇒ rejeitado. |

Execução: `pnpm vitest run test/session.test.ts`, depois `pnpm lint`, `pnpm typecheck` e `pnpm test`. Seguir o fluxo de correção do AGENTS.md: escrever os testes antes e vê-los falhar (campo/comportamento ausentes) antes de implementar.

## 6. Riscos

- **CPU em cookie inválido**: custo vai de 1 para `1 + N` aberturas (dobra com legado). Mitigação: `password` primeiro; parar em erro não-HMAC (D-03); JSDoc e docs recomendam lista curta.
- **Dependência da mensagem `"Bad hmac value"`**: o critério de continuar usa a mensagem, igual ao fallback legado existente (`src/utils/session.ts:336`). Se `iron-crypto` mudar o texto, ambos quebram juntos; o teste de RF-02 e o de legado detectariam. Mitigar com teste que força o caminho.
- **Mascarar expiração**: coberto por D-03/RF-07; a validação de `maxAge`/`idleTimeout` fica fora do loop.
- **Vazamento do marcador**: `Object.assign` copia símbolos. Ordem obrigatória: apagar `kRotatedSeal` antes do `Object.assign` (D-05); teste de RF-04 verifica.
- **Senha extra curta/inválida**: lança erro não-HMAC só quando alcançada, e a sessão é descartada. Documentado, sem validação extra (fora de escopo).
- **Header não resselado**: continua abrindo com a senha antiga enquanto ela estiver na lista; documentar.
- **Senha comprometida na lista**: continua abrindo sessões; docs orientam a retirar após a migração. `maxAge` limita a janela.
- **Docs geradas**: `docs/2.utils/4.security.md` vem do automd; só `pnpm fmt` deve alterá-lo, e isso pode gerar diff em trechos não relacionados — conferir antes de manter.
