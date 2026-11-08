# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-10). Segunda alternativa da issue: `SessionConfig.password` passa a aceitar `string | string[]`; a primeira senha sela, todas abrem.

## 1. Estado atual (conferido no código)

- `src/utils/session.ts:48` — `password: string` em `SessionConfig`; JSDoc em `:40-47`.
- `src/utils/session.ts:300` — `sealSession` chama `seal(session, config.password, …)`.
- `src/utils/session.ts:312-367` — `unsealSession`:
  - `:324` `unseal(sealed, config.password, sealOptions)` com as iterações atuais;
  - `:332-339` só segue para o fallback legado se `legacySealFallback !== false`, as iterações configuradas não forem 1 e o erro for exatamente `"Bad hmac value"`; qualquer outro erro é relançado;
  - `:340-347` repete com 1 iteração e marca `kLegacySeal`;
  - `:349-366` valida `maxAge` e `idleTimeout` depois de abrir.
- `src/utils/session.ts:196-218` — `getSession` engole o erro do unseal (`.catch(() => {})`), remove `kLegacySeal` (`:199-202`) e rassela via `updateSession` quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`:214`).
- `src/utils/internal/session.ts:7-9` — define `kLegacySeal`.
- `src/utils/internal/iron-crypto.ts:65-67` e `:94-96` — `seal`/`unseal` já lançam `"Empty password"` para senha falsy; `:135-137` lança `"Bad hmac value"` com senha errada. O selo não identifica a senha (id vazio, `:68`), então abrir é por tentativa e erro.
- Fora do escopo, apesar da palavra: `src/types/context.ts:32` (`basicAuth.password`) e `src/utils/auth.ts`.
- Testes: `test/session.test.ts:21-25` (`sessionConfig`) e `:137`, `:157`, `:164`, que passam `sessionConfig.password` direto a `seal`/`unseal`. Depois do tipo ampliado, esses três pontos deixam de compilar (`string | string[]` não é aceito por `RawPassword`/`Password`).

## 2. Decisões de arquitetura

### D-01 — Tipo público: `password: string | string[]`

- **Alternativas:** (a) `string | [string, ...string[]]` (não vazio no tipo); (b) `string | readonly string[]`; (c) `string | string[]` com validação em runtime.
- **Escolha: (c).** É o que o PRD e o pedido fixam (RF-01). (a) rejeitaria arrays vindos de `split()` ou de env e dá erro de tipo pouco claro; (b) não acrescenta nada ao contrato pedido. A não vacuidade é garantida em runtime (D-05) e documentada no JSDoc. Nenhum nome público novo.

### D-02 — Normalização por helper interno `resolvePasswords`

- **Alternativas:** (a) tratar `Array.isArray` inline em `sealSession` e `unsealSession`; (b) alterar `seal`/`unseal` de `iron-crypto.ts` para aceitarem lista; (c) helper interno compartilhado.
- **Escolha: (c).** Fica em `src/utils/internal/session.ts` (convenção: helpers internos em `utils/internal/`, não exportados pelo `index.ts`). (b) foi descartada: `iron-crypto.ts` é código adaptado de terceiros, e o PRD proíbe mudar formato/algoritmos; a rotação é política de sessão, não de selo. (a) duplicaria a validação.

### D-03 — Selagem usa só `passwords[0]`

- **Alternativas:** (a) selar com a primeira; (b) selar com todas (múltiplos selos).
- **Escolha: (a).** É o RF-02; (b) mudaria o formato do cookie (proibido). Ajuste em `src/utils/session.ts:300`.

### D-04 — Abertura sequencial, "iteração atual em todas as senhas, depois legado em todas"

- **Alternativas:** (a) por senha: atual, depois legado, depois a próxima senha; (b) fase atual em todas as senhas, depois fase legada em todas; (c) tentativas em paralelo (`Promise.any`).
- **Escolha: (b).** O caso comum após rotação é "selo atual com senha antiga": custa 2 PBKDF2 (hmac falho na nova + sucesso na antiga) nas duas ordens. Já (a) obrigaria um selo legado da senha antiga a gastar tentativas legadas inúteis com a nova antes de chegar nela, e sessões atuais da senha antiga passariam por tentativas legadas desnecessárias com a nova. Em (b) o pior caso (sessão inválida) é N + N tentativas, igual a (a), mas o caso frequente nunca toca o legado. (c) foi descartada: multiplicaria CPU por requisição e abriria amplificação de DoS (ver R-01).
- Regras:
  1. Em cada tentativa, só `Error` com `message === "Bad hmac value"` autoriza passar à próxima senha/fase. Qualquer outro erro (`Expired seal`, `Incorrect number of sealed components`, `Wrong mac prefix`, `Password string too short`, …) é relançado na hora (RF-09; é o que `:332-339` já faz hoje).
  2. A fase legada só roda se `legacySealFallback !== false` e `sealOptions.integrity.iterations !== 1` (condição atual de `:333-334`).
  3. Se todas falham por HMAC, lança-se o primeiro erro capturado (o mesmo que uma configuração de senha única produziria hoje). Com uma única senha a mensagem e a ordem das tentativas são idênticas às atuais (RF-06).

### D-05 — Validação da lista (RF-08)

- **Alternativas:** (a) validar só a senha usada; (b) validar a lista inteira antes de qualquer uso; (c) validar no tipo.
- **Escolha: (b).** `resolvePasswords` lança `new Error("Empty password")` (mesma mensagem de `iron-crypto.ts:66`/`:95`, preservando a exigência atual) se a lista for vazia ou algum item for falsy/não string. Chamado no início de `sealSession` e `unsealSession`, antes de qualquer cripto, então nenhuma sessão é emitida nem aceita com configuração inválida. (a) deixaria `["", "x"]` passar em `unsealSession` quando a primeira falhasse antes; (c) não cobre `""`. Quando a falha ocorre dentro de `getSession`, o `.catch` existente (`:197`) a engole e cria sessão nova, e o erro explícito aparece no `updateSession`/`sealSession` seguinte (que não engole).
- Comprimento mínimo (32) continua sendo verificado por `iron-crypto.ts:192`, só quando a senha é usada. Consequência: uma senha antiga curta que nunca é alcançada não gera erro. Aceito (R-05).

### D-06 — Ressel com a primeira senha reaproveita `kLegacySeal`

- **Alternativas:** (a) novo símbolo interno (ex. `kResealPassword`); (b) reaproveitar `kLegacySeal` com a semântica "este selo deve ser regravado"; (c) `getSession` comparar de novo.
- **Escolha: (b).** `getSession` já remove o símbolo (`:199-202`) e rassela via `updateSession` (`:214`) só para cookies. Quando abrir com a senha de índice > 0, `unsealSession` marca `kLegacySeal`. É a mitigação já prevista no PRD (riscos) e não adiciona símbolos. Atualizar o comentário de `src/utils/internal/session.ts:7-9` e o de `:210-213` para dizer que cobre selo legado **ou** senha antiga. (a) é mais explícito, mas duplica o caminho de `:199-214` sem ganho; (c) exigiria `unsealSession` devolver o índice, mudando a assinatura pública.
- Sessão lida do **cabeçalho** (`sessionFromCookie === false`) continua sem ressel, como já ocorre com selo legado.
- `idleTimeout`: `legacySeal || shouldSlide(...)` é um OR, então há no máximo um `updateSession` por leitura.

### D-07 — Expiração depois de abrir, independente da senha (RF-09)

Os blocos `maxAge`/`idleTimeout` (`:349-366`) ficam como estão, depois do laço de senhas. Mantém também `ttl` do selo via `sealOptions` igual para todas as senhas.

### D-08 — Compatibilidade de testes existentes

**Alternativa:** (a) `Array.isArray`/cast nos três testes; (b) extrair uma constante `password` string no topo do teste e usá-la em `sessionConfig` e nas chamadas a `seal`/`unseal`. **Escolha: (b)** — mantém o que os testes verificam (mesma senha, mesmas iterações) e não esconde o tipo com `as`.

## 3. Arquivos a alterar

| Arquivo                             | Linha(s)                         | Mudança                                                                                                                                                  |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/session.ts`              | `:40-48`                         | tipo e JSDoc de `password` (primeira sela, demais só abrem; lista não vazia; não colocar a antiga na frente; listas curtas por causa do custo de PBKDF2) |
| `src/utils/session.ts`              | `:1-5`                           | importar `resolvePasswords` de `./internal/session.ts` (já há import dali em `:3` e `:5`; unificar, sem barrel)                                          |
| `src/utils/session.ts`              | `:300`                           | `seal(session, resolvePasswords(config.password)[0], …)`                                                                                                 |
| `src/utils/session.ts`              | `:312-348`                       | reescrever o try/catch de `unsealSession` conforme D-04/D-06 (extrair `unsealWithPasswords` como função interna no fim do arquivo)                       |
| `src/utils/session.ts`              | `:210-213`                       | ajustar o comentário do ressel                                                                                                                           |
| `src/utils/internal/session.ts`     | `:7-9` e fim do arquivo          | comentário de `kLegacySeal`; novo `resolvePasswords` (não exportado em `src/index.ts`)                                                                   |
| `test/session.test.ts`              | `:21-25`, `:137`, `:157`, `:164` | D-08 e novos testes                                                                                                                                      |
| `docs/4.examples/handle-session.md` | após `:43`                       | seção curta "Rotação de senha" (opcional, não é requisito do PRD)                                                                                        |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/types/context.ts`, `src/utils/auth.ts`, `src/index.ts`.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts (única mudança pública)
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. Each must be at least 32 characters.
   *
   * A list is for rotation: the first password seals new sessions, every password
   * (in order) can open them. A session opened with a later password is resealed
   * with the first. List must be non-empty with no empty items. Put the new
   * password first; keep old ones only until sessions sealed with them expire.
   * ...entropy warning mantido...
   */
  password: string | string[];
  // demais campos inalterados
}

// src/utils/internal/session.ts (interno)
export function resolvePasswords(password: SessionConfig["password"]): string[];
// string -> [string]; array -> cópia; lança Error("Empty password") se vazio ou item falsy/não string.

// src/utils/session.ts (interno, fim do arquivo)
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Assinaturas de `useSession`, `getSession`, `updateSession`, `sealSession`, `unsealSession` não mudam. Pseudocódigo de `unsealWithPasswords`:

```ts
let firstError: unknown;
for (const [i, pass] of passwords.entries()) {            // fase atual
  try { return mark(await unseal(sealed, pass, sealOptions), i > 0); }
  catch (e) { if (!isBadHmac(e)) throw e; firstError ??= e; }
}
if (legacy habilitado) {
  for (const [i, pass] of passwords.entries()) {          // fase legada
    try { return mark(await unseal(sealed, pass, legacyOptions), true); }
    catch (e) { if (!isBadHmac(e)) throw e; }
  }
}
throw firstError;
```

`mark(u, flag)` define `kLegacySeal` apenas se `u` for truthy (igual a `:345-347`). Não mutar o array de `config.password`.

## 5. Estratégia de testes

Em `test/session.test.ts` (matriz web/node via `describeMatrix`), sem mudar o que os testes atuais verificam (D-08). Novos casos, cada um com cookie/selo montado por `seal` interno e `sessionConfig` com `name` próprio:

1. **RF-02:** com `[nova, antiga]`, o cookie emitido abre com `unseal(..., nova)` e falha (`Bad hmac value`) com `antiga`.
2. **RF-03:** sessão selada com `antiga` + `[nova, antiga]`: `getSession` devolve id, `createdAt` e `data` originais.
3. **RF-04:** mesmo cenário: há um `Set-Cookie` selado com `nova` que abre com `password: "nova"`; sessão selada com `nova` em `[nova, antiga]` **não** gera `Set-Cookie` extra (sem ressel redundante); via cabeçalho de sessão abre, sem ressel.
4. **RF-05:** selo com `outra`: sessão nova (id gerado), dados vazios.
5. **RF-06:** `"x"` e `["x"]` produzem o mesmo resultado nos cenários básicos, incluindo `maxAge`, `idleTimeout` e `seal` customizado; `legacySealFallback: false` com lista de um item rejeita o legado.
6. **RF-07:** selo legado (1 iteração) com `antiga`: restaurado e resselado com `nova` com iterações atuais; com `legacySealFallback: false`, rejeitado. Incluir selo legado com a **primeira** senha em `[nova, antiga]`.
7. **RF-08:** `password: []` e `["", "x"]` fazem `sealSession`/`unsealSession` lançarem `Empty password`; `useSession` não emite cookie.
8. **RF-09:** sessão expirada (`maxAge`, e `idleTimeout` com `vi.useFakeTimers({ toFake: ["Date"] })`, padrão já usado em `:188-191`) selada com `antiga`: tratada como expirada. Erro não-HMAC (selo malformado, `Expired seal`) não tenta outras senhas: usar `vi.spyOn` no módulo de cripto ou um selo com formato inválido e verificar que o erro propagado em `unsealSession` é o original.
9. **Ordem:** `[a, b]` com `b` sendo a que abre: confirma tentativa em ordem (primeira falha com HMAC, segunda abre).

Regressão: os testes novos devem falhar sem a implementação (rodar contra `git stash` das mudanças em `src/`). Verificação final: `pnpm vitest run test/session.test.ts`, depois `pnpm lint` e `pnpm typecheck` (conforme AGENTS.md), e `pnpm vitest run` completo para checar `test/unit/package.test.ts` (nenhum export novo).

## 6. Riscos

- **R-01 — CPU/DoS:** cada tentativa falha custa PBKDF2 (8192 iterações); cookie inválido custa até 2N (N atuais + N legadas). Mitigação: sequencial, fase legada só depois da atual, JSDoc recomenda lista curta (2 ou 3), cobrir pior caso em teste (contar chamadas) e, se necessário, medir com `test/bench/session.ts`.
- **R-02 — Mascarar erros:** passar à próxima senha só em `"Bad hmac value"` depende da mensagem do iron-crypto (`:136`), já usada hoje em `:336`. Mitigação: teste do item 8; uma constante/predicado único `isBadHmac`.
- **R-03 — Ressel com `idleTimeout`/`shouldSlide`:** OR com `kLegacySeal` limita a um ressel por leitura e preserva `createdAt`; cobertos nos itens 3 e 8. O ressel por senha antiga carimba `lastSeenAt` (efeito esperado e igual ao do slide).
- **R-04 — Quebra de tipos:** leitores de `SessionConfig["password"]` como `string` passam a ver a união; no repositório só os três usos de teste (`:137`, `:157`, `:164`) e o ajuste interno em `session.ts` são afetados; `typecheck` valida.
- **R-05 — Senha antiga curta/inválida só falha quando alcançada:** erro `Password string too short` aparece só para sessões que chegariam a ela; é propagado (não mascarado). Aceito; documentado no JSDoc (mínimo de 32 em todas).
- **R-06 — Rotação mal feita:** antiga na frente continua selando com ela; mitigado só por documentação (JSDoc e docs).
- **R-07 — Sessão por cabeçalho com senha antiga:** abre, mas não é resselada (sem como regravar); pode impedir aposentar a senha antiga para clientes que usam só o cabeçalho. Registrado na documentação.
- **R-08 — Reuso de `kLegacySeal`:** o nome passa a ser impreciso. Mitigado por comentário; renomear é possível por ser interno, mas ampliaria o diff (decisão D-06).
