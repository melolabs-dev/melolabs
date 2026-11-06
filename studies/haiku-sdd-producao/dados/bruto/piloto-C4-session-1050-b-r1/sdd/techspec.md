# Especificação técnica: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (RF-01 a RF-09). Esta especificação não altera código; ela fixa as decisões, os pontos de mudança e a estratégia de teste para a implementação.

## 1. Achados do código que ajustam o PRD

Conferidos em `src/utils/session.ts`, `src/utils/internal/iron-crypto.ts` e `src/utils/cookie.ts`:

1. **`minPasswordlength` não existe em `SessionConfig`.** A premissa do PRD (`sdd/prd.md:157`) está imprecisa. O campo fica em `SealOptions`, em `src/utils/internal/iron-crypto.ts:22` e `:28` (padrão 32), com o tipo em `:380-381`. O valor efetivo é `{...sealDefaults, ttl, ...config.seal}`, lido em `src/utils/session.ts:300-304` e `:317-321`. A validação deve usar `resolvedSealOptions.encryption.minPasswordlength`. Não se cria campo público novo (RF-09).
2. **`clearSession` não abre sessões.** Em `src/utils/session.ts:372-386` ela só apaga o cache do contexto e grava os cookies de expiração. RF-07 para `clearSession` vale sem mudança de código.
3. **`unseal` verifica o HMAC antes de decifrar.** Em `src/utils/internal/iron-crypto.ts:133-137` o HMAC é derivado com PBKDF2 e comparado; só depois vem a decifragem (`:147`). Tentar uma senha errada custa uma derivação de `iterations` mais, no fallback legado, uma derivação de 1 iteração (cheap). O custo por senha tentada é, portanto, uma derivação completa.
4. **`Object.assign` copia símbolos enumeráveis.** Em `src/utils/session.ts:208` o objeto aberto é copiado para `session`. Qualquer marcador interno precisa ser removido antes desse ponto, como `kLegacySeal` já é em `:199-201`.
5. **A mensagem de senha curta usa "Password" com maiúscula.** `src/utils/internal/iron-crypto.ts:193-195` diz `Password string too short ...`. O RF-06 pede que a mensagem contenha "password". Para as senhas extras, a validação terá mensagem própria (D-05).
6. **Não há documentação de `SessionConfig` no repositório.** Uma busca por `legacySealFallback` e `minPasswordlength` só retorna `CHANGELOG.md:134` (gerado) além de código e `sdd/`. Não há doc a atualizar.
7. **Leitura pode disparar re-selagem com configuração inválida.** O caminho `getSession` → `updateSession` (`src/utils/session.ts:214-216`) já existe para sessões legadas. Com a validação de D-04, uma configuração inválida faz essa leitura rejeitar. Isso está coberto em D-10.

## 2. Decisões de arquitetura

### D-01 — Abertura com a lista de senhas fica dentro de `unsealSession`

**Contexto.** `unsealSession` (`src/utils/session.ts:312`) é o ponto único que chama `unseal`, e `getSession` a usa para cookies, chunks e cabeçalho (`src/utils/session.ts:191-196`). `unsealSession` também é exportada (`src/index.ts:209`).

**Alternativas.**
- (a) Laço de senhas dentro de `unsealSession`.
- (b) Novo helper interno chamado por `getSession`, com `unsealSession` mantida como estava.
- (c) Laço em `getSession`.

**Escolha: (a).** Todos os caminhos (cookie, chunks, cabeçalho e a função pública) herdam o comportamento (RF-07) sem duplicação. A assinatura pública não muda (RF-09). A opção (b) duplicaria a lógica de legado e expiração. A opção (c) deixaria `unsealSession` pública com comportamento diferente do de `getSession`.

### D-02 — Fallback legado aplicado por senha, em sequência

**Contexto.** Há duas formas de combinar o fallback de 1 iteração (`legacySealFallback`) com a lista de senhas: (i) para cada senha, tentar as iterações atuais e depois o legado; (ii) tentar todas as senhas com as iterações atuais e só depois todas com o legado.

**Alternativas.**
- (i) Por senha: `password` (atual, legado), depois cada extra (atual, legado).
- (ii) Duas passadas: todas atuais, depois todas legadas.

**Escolha: (i).** O contrato (`sdd/pedido.md:27`, RF-03 em `sdd/prd.md:51-53`) exige que, quando `password` abre a sessão, nenhuma extra seja tentada. Isso vale também para sessões legadas seladas com `password`. A passada (ii) quebraria essa regra. O custo extra fica restrito a sessões legadas seladas com senhas extras, que é a janela de migração. Isso entra em risco R-01.

### D-03 — Marcador interno para "aberta com senha extra"

**Contexto.** `getSession` precisa saber se a sessão foi aberta por uma senha extra, para re-selar com `password` (RF-05). Hoje o mesmo problema é resolvido para legado com o símbolo `kLegacySeal` (`src/utils/internal/session.ts:7-9`), que `unsealSession` marca (`src/utils/session.ts:346`) e `getSession` remove (`:199-201`).

**Alternativas.**
- (a) Símbolo interno `kUnsealedWithExtra`, no mesmo padrão de `kLegacySeal`.
- (b) Mudar o retorno de `unsealSession` para uma tupla ou objeto. Quebra a API pública exportada (`src/index.ts:209`).
- (c) Comparar o cookie de entrada com a re-selagem. Caro e frágil.
- (d) Flag no `context`. Mistura estado de requisição com o de abertura e deixa o marcador disponível para mais de uma sessão.

**Escolha: (a).** Mantém a assinatura pública e segue um padrão já usado no arquivo. O símbolo é removido antes de `Object.assign` (ver achado 4).

### D-04 — Validação das senhas extras nas operações que selam

**Contexto.** RF-06 pede rejeição em `updateSession`, `sealSession` e na criação de sessão por `useSession`, mesmo sem cookie. `updateSession` (`src/utils/session.ts:241`) só chama `sealSession` se `config.cookie !== false` e `event.res` existir (`:266-267`). Portanto a validação não pode depender desse caminho.

**Alternativas.**
- (a) Função `assertSealPasswords(config)` chamada no início de `sealSession` e de `updateSession`. `useSession` herda por chamar `updateSession` na criação (`src/utils/session.ts:116-118`).
- (b) Validar só dentro de `seal`, em `src/utils/internal/iron-crypto.ts`. Ele não conhece a lista e não cobre o caso sem `event.res`.
- (c) Validar em `getSession` também. Viola a intenção de RF-06 de que só operações de escrita rejeitem, e tornaria leituras inválidas em 500.

**Escolha: (a).** Ponto único, antes de qualquer selagem. Leituras não validam as extras; uma extra inválida simplesmente não abre (ver D-09). A validação da própria `password` continua pelo caminho atual (`generateKey`), para preservar o comportamento (RF-06).

### D-05 — Mensagens de erro sem o valor da senha

**Contexto.** RF-06 exige que a mensagem contenha "password". Riscos R-05 e o item de vazamento em `sdd/prd.md:167` exigem que o valor nunca apareça.

**Escolha.** Mensagens próprias com o índice, no formato `Session extra password at index ${i} is too short (min ${min} characters required)` e `Session extra password at index ${i} must be a non-empty string`. A palavra "password" aparece em minúsculas; o valor não aparece. Erros de `password` continuam vindo de `generateKey` e `seal` como hoje.

### D-06 — Mínimo de tamanho vem de `seal`, não de campo novo

**Escolha.** `assertSealPasswords` usa `resolvedSealOptions.encryption.minPasswordlength`, com a mesma construção de `sealSession` (`src/utils/session.ts:300-304`). Isso respeita `config.seal` quando informado e não cria opção pública nova. Como `generateKey` compara `.length` (`src/utils/internal/iron-crypto.ts:192`), a validação usa o mesmo critério.

### D-07 — Lista vazia e ausência são idênticas

**Escolha.** `const extras = config.extraUnsealPasswords ?? []`. Com `extras.length === 0` o laço tem uma iteração, e o caminho é o atual: sem marcador, sem validação extra, mesmo erro da primeira tentativa (`firstError`).

### D-08 — Tipo do campo

**Escolha.** `extraUnsealPasswords?: string[]` em `SessionConfig`, com JSDoc dizendo que as senhas só abrem, nunca selam, e que a lista deve ser curta (custo, R-01). `password: string` fica como está.

### D-09 — Parar na primeira abertura e tratar expiração depois do laço

**Escolha.** O laço para no primeiro `unseal` bem-sucedido. As checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) são feitas uma vez, sobre a sessão já aberta. Assim uma sessão expirada não dispara novas tentativas de senha. Uma extra que falha por qualquer erro (senha curta, HMAC errado, formato) é pulada, e a próxima é tentada. Erros de formato (`Incorrect number of sealed components`, `Wrong mac prefix`) se repetem a cada senha; o custo é pequeno porque ocorrem antes do PBKDF2.

### D-10 — Re-selagem com configuração inválida propaga erro

**Contexto.** Em `src/utils/session.ts:214-216`, a re-selagem por legado ou por janela ociosa chama `updateSession`, que agora valida (D-04). Com extra inválida, `getSession` rejeita nesse caso.

**Escolha.** Propagar. É o mesmo comportamento que já existe hoje com `password` inválida nesse caminho, e a falha de configuração fica visível (R-03). Sessões sem re-selagem continuam lendo normalmente.

## 3. Arquivos a alterar

Não há mudança fora de `src/utils/session.ts`, `src/utils/internal/session.ts` e testes.

| Arquivo | Linhas atuais | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-99` `SessionConfig` | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (D-08). |
| `src/utils/session.ts` | `:199-201` | Remover também `kUnsealedWithExtra` antes de `Object.assign` (`:208`). |
| `src/utils/session.ts` | `:214-216` | Incluir `openedWithExtra` na condição de re-selagem (RF-05). |
| `src/utils/session.ts` | `:241-251` | Chamar `assertSealPasswords(config)` no início de `updateSession` (D-04). |
| `src/utils/session.ts` | `:282-307` | Chamar `assertSealPasswords(config)` no início de `sealSession`. Sem outra mudança: `seal` continua usando `config.password`. |
| `src/utils/session.ts` | `:312-367` | Laço de senhas (D-01, D-02, D-09) e marcador `kUnsealedWithExtra` (D-03). |
| `src/utils/session.ts` | novo, após `:386` ou junto aos helpers | `assertSealPasswords` e `resolveSealOptions` (D-04, D-06). |
| `src/utils/internal/session.ts` | `:7-9` | Novo símbolo `kUnsealedWithExtra` com `Symbol.for("h3.internal.session.unsealed-with-extra")`. |
| `test/session.test.ts` | `:21-25` configuração de teste; `:134-186` testes de legado | Novos casos (seção 5). |

Observação de convenção: `AGENTS.md` pede arquivos com menos de 200 linhas, e `src/utils/session.ts` já tem 464. Esta mudança adiciona cerca de 60 linhas. Dividir o arquivo fica fora do escopo do PRD (`sdd/prd.md:150`), então a divisão não entra nesta entrega. Registrado como R-07.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (novo campo)
/**
 * Previous passwords, used only to open sessions sealed before a rotation.
 * Never used to seal. Tried in order after `password`. Empty or absent means none.
 */
extraUnsealPasswords?: string[];
```

```ts
// src/utils/internal/session.ts (novo símbolo)
export const kUnsealedWithExtra: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.unsealed-with-extra",
);
```

```ts
// src/utils/session.ts — helpers internos (não exportados)

/** Resolved seal options, the same merge used by sealSession and unsealSession. */
function resolveSealOptions(config: SessionConfig): SealOptions {
  return {
    ...sealDefaults,
    ttl: (config.maxAge || config.idleTimeout || 0) * 1000,
    ...config.seal,
  };
}

/**
 * Throws if any extra password is not a non-empty string of at least
 * `encryption.minPasswordlength` characters. Called before any sealing.
 * The password itself is still validated by `seal`.
 */
function assertSealPasswords(config: SessionConfig): void;
```

```ts
// src/utils/session.ts — assinatura pública inalterada
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
// Comportamento novo: tenta [config.password, ...extraUnsealPasswords] em ordem (D-09).
// Em caso de sucesso com extra, o retorno traz kUnsealedWithExtra = true.
// Se nenhuma abrir, lança o erro da primeira tentativa (firstError).
```

```ts
// src/utils/session.ts — assinaturas públicas inalteradas
export function clearSession(event: HTTPEvent, config: Partial<SessionConfig>): Promise<void>;
export async function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export async function updateSession<T>(event: HTTPEvent, config: SessionConfig, update?: SessionUpdate<T>): Promise<Session<T>>;
export async function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export async function useSession<T>(event: HTTPEvent, config: SessionConfig): Promise<SessionManager<T>>;
```

Esboço do laço em `unsealSession`:

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
let unsealed: Partial<Session> | undefined;
let firstError: unknown;
let openedWithExtra = false;
for (const [i, password] of passwords.entries()) {
  try {
    unsealed = await openWith(sealed, password, sealOptions, config); // atual try/catch, parametrizado por senha
    openedWithExtra = i > 0;
    break;
  } catch (error) {
    if (i === 0) firstError = error;
  }
}
if (!unsealed) throw firstError;
// checagens de maxAge e idleTimeout como hoje (src/utils/session.ts:350-365)
if (openedWithExtra) (unsealed as any)[kUnsealedWithExtra] = true;
return unsealed;
```

Esboço da condição em `getSession` (`src/utils/session.ts:194-216`):

```ts
const extra = unsealed && (unsealed as any)[kUnsealedWithExtra];
if (extra) delete (unsealed as any)[kUnsealedWithExtra]; // antes de Object.assign
// ...
if (session.id && sessionFromCookie && (legacySeal || extra || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

## 5. Estratégia de testes

Base: `describeMatrix` em `test/session.test.ts` (roda em `web` e `node`, conforme `AGENTS.md`). Para sessões seladas com outra senha, usar `seal` de `src/utils/internal/iron-crypto.ts` como nos testes de legado (`test/session.test.ts:135-143`). Cada caso abaixo cobre um RF.

| Teste | RF | Verificação |
| --- | --- | --- |
| Sem `extraUnsealPasswords` e com `[]` produzem a mesma resposta | RF-01, RF-09 | Mesma sessão, mesmo número de `Set-Cookie`. |
| Selar sempre com `password` | RF-02 | Cookie de `useSession` e `updateSession` abre com `P1`, não abre só com `P0`. |
| Abertura pela segunda extra `[P9, P0]` | RF-03 | `id`, `createdAt` e dados preservados. Tentativas: `P1`, `P9`, `P0` (espiar com spy em `unseal` ou via contagem de chamadas). |
| Sessão com `password` não tenta extras | RF-03 | Nenhuma chamada extra a `unseal` (spy). |
| Senha desconhecida | RF-04 | `getSession` não lança; sessão nova e vazia. |
| Re-selagem em leitura por extra | RF-05 | `Set-Cookie` com sessão selada por `P1`; `id` e dados preservados. |
| Sem re-selagem para `password` | RF-05 | Nenhum `Set-Cookie`. |
| Sem re-selagem pelo cabeçalho de sessão com extra | RF-05, RF-07 | Nenhum `Set-Cookie`; sessão aberta. |
| Validação: extra vazia, extra de 10 caracteres, extra inválida no meio | RF-06 | `updateSession`, `sealSession` e `useSession` (criação) rejeitam; mensagem contém "password"; mensagem não contém o valor. Também sem cookie. |
| Validação respeita `seal.encryption.minPasswordlength` | RF-06, D-06 | Com mínimo maior, extra antes válida passa a ser rejeitada. |
| Chunks com extra | RF-07 | Cookie grande (padrão de `test/session.test.ts:656`) selado com `P0`; `getSession` e `unsealSession` abrem. |
| `clearSession` com extra | RF-07 | Não lança; cookies de expiração presentes. |
| Legado com extra e fallback ativo | RF-08 | Sessão com 1 iteração selada com `P0`: aberta, re-selada com `P1` e opções atuais (padrão de `test/session.test.ts:134-159`). |
| Legado com extra e `legacySealFallback: false` | RF-08 | Sessão nova e vazia (padrão de `test/session.test.ts:161-186`). |
| Expiração após abertura por extra | D-09 | Sessão expirada aberta por `P0` lança "Session expired!" e vira sessão nova, sem tentar senhas seguintes. |
| Regressão: `password` inválida continua errando | RF-06 | Mesma mensagem de hoje. |

Suíte existente: `test/session.test.ts` e `test/unit/iron-crypto.test.ts` (que já cobre `minPasswordlength`, `:145` e `:155`) não devem mudar expectativas.

Verificação final: `pnpm vitest run test/session.test.ts`, depois `pnpm test` (lint, typecheck e coverage, conforme `AGENTS.md`). Conferir a lista de exports de `src/index.ts` antes e depois (RF-09); a única diferença esperada é o campo novo, que não é export.

Teste de regressão de bug não se aplica: é funcionalidade nova, não correção.

## 6. Riscos

- **R-01 — Custo de CPU.** Cada tentativa é uma derivação PBKDF2 completa (`src/utils/internal/iron-crypto.ts:206`). Sessões com a última de N extras custam até N+1 derivações. Com legado, cada senha pode custar mais uma de 1 iteração (barata). Mitigação: lista curta, documentada no JSDoc (D-08). Alternativa (ii) de D-02 foi descartada por quebrar RF-03.
- **R-02 — Set-Cookie em leituras.** Leituras com extra geram `Set-Cookie`. Mitigação: testes de RF-05; documentar no JSDoc de `extraUnsealPasswords`.
- **R-03 — Falha de escrita e de re-selagem.** Extra inválida derruba `updateSession`, `sealSession`, criação por `useSession` e a re-selagem em leitura (D-10). Mitigação: mensagem clara com índice (D-05), validação cedo, e teste.
- **R-04 — Sessões que nunca são lidas.** Sessões seladas com senha antiga só migram quando `getSession` as abre. Sessões paradas continuam com a senha antiga até `maxAge`. Isso é coerente com a rotação progressiva (RF-05), mas a remoção da senha antiga pode invalidá-las antes disso. Mitigação: procedimento operacional, fora do escopo (`sdd/prd.md:145-149`).
- **R-05 — Vazamento de senhas.** Nenhuma mensagem de erro novo contém valor de senha (D-05). Erros de `generateKey` também não incluem valor. Logs de aplicação que capturam o `config` inteiro continuam expostos; isso já é verdade para `password`.
- **R-06 — Marcador vazando para `session`.** Se `kUnsealedWithExtra` não for removido antes de `Object.assign` (`src/utils/session.ts:208`), ele passa a constar em `session`. Mitigação: remover antes e teste que verifica `Object.getOwnPropertySymbols` ausente em `getSession`.
- **R-07 — Tamanho de `src/utils/session.ts`.** O arquivo ultrapassa a convenção de 200 linhas de `AGENTS.md`. Aceito nesta entrega; divisão posterior.
- **R-08 — Diferenças entre formatos.** Chunks e cabeçalho usam o mesmo `unsealSession`, mas são caminhos distintos em `getSession`. Mitigação: testes específicos (seção 5).
