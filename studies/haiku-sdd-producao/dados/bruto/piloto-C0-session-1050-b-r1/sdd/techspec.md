# Techspec — Várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Todas as citações `arquivo:linha` foram conferidas no código atual (antes de qualquer alteração).

## 1. Resumo da solução

`SessionConfig` ganha `extraUnsealPasswords?: readonly string[]`. A abertura de sessões (`unsealSession`) passa a tentar `password` e depois cada senha extra, em sequência, parando na primeira que abrir. Quando uma senha extra abriu a sessão, `unsealSession` marca o resultado com um símbolo interno e `getSession` reaproveita o mecanismo de re-selagem das sessões legadas para regravar o cookie com `password`. A selagem (`sealSession`) continua usando só `password` e passa a validar as senhas extras antes de selar.

Nada muda em `iron-crypto.ts`, em `cookie.ts` nem na API pública além do campo novo.

## 2. Decisões de arquitetura

### D-01 — O laço de senhas vive em `unsealSession`

**Contexto.** A abertura acontece em um único ponto: `unsealSession` (`src/utils/session.ts:312-367`), chamado por `getSession` (`src/utils/session.ts:196`) e exportado publicamente. `updateSession`, `useSession` e `clearSession` não abrem nada diretamente: `useSession` e `updateSession` chamam `getSession` (`:115`, `:251`); `clearSession` (`:372`) só apaga cookie.

**Alternativas.**

1. Laço em `getSession`, chamando `unsealSession` uma vez por senha (clonando `config` com outra `password`). Descartada: `unsealSession` público ficaria sem suporte a extras (RF-07 exige) e cada chamada reaplicaria validações de expiração.
2. Laço em `unsealSession`, internamente.
3. Nova função pública para abrir com várias senhas. Descartada: viola "nenhum nome público novo".

**Escolha: 2.** Cobre `getSession`, `useSession`, `updateSession` (via `getSession`), `unsealSession`, cookie simples, chunks (o `getChunkedCookie` já devolve a string selada, `:191`) e cabeçalho (`:183-186`) sem tocar nesses caminhos. `clearSession` não precisa de mudança (não abre sessão); o teste de RF-07 só garante que continua funcionando com a config nova.

### D-02 — Ordem das tentativas: por senha, e dentro de cada senha "atual" antes de "legado"

**Contexto.** Hoje, por senha, há até 2 tentativas: opções atuais (`:324`) e, se falhar com "Bad hmac value", 1 iteração de PBKDF2 (`:332-344`).

**Alternativas.**

1. Todas as senhas no modo atual, depois todas no modo legado. Descartada: uma sessão legada selada com `password` faria tentativas com as extras antes de ser aberta, contrariando "quando `password` abre a sessão, nenhuma extra é tentada" (RF-03 + RF-08).
2. Por senha: `password` (atual, depois legado), depois extra[0] (atual, depois legado), etc.

**Escolha: 2.** Mantém `password` com prioridade total, ordem determinística (risco "interação com legado" do PRD) e reaproveita o bloco legado quase intacto, movido para um helper interno `unsealWithPassword`. Sem extras, as chamadas a `unseal` são exatamente as de hoje (mesma sequência, mesmos argumentos): equivalência com o comportamento atual.

### D-03 — Só "Bad hmac value" avança para a próxima senha

**Contexto.** `unseal` falha antes do HMAC com erros independentes da senha (`Incorrect number of sealed components`, `Wrong mac prefix`, `Invalid expiration`, `Expired seal`: `src/utils/internal/iron-crypto.ts:98-117`) e com `Bad hmac value` (`:136`) quando a senha está errada. O código atual já usa a mensagem `"Bad hmac value"` como critério (`session.ts:336`).

**Alternativas.**

1. Avançar em qualquer erro. Descartada: tentaria PBKDF2 inutilmente em cookies malformados/expirados (amplifica o vetor de DoS do PRD) e esconderia erros de configuração.
2. Avançar só em "Bad hmac value"; qualquer outro erro é relançado imediatamente.

**Escolha: 2.** Se todas as senhas falharem, relança o erro da primeira tentativa de `password` (o primeiro erro capturado), de modo que o erro observável sem extras é idêntico ao atual. Em `getSession` o erro continua engolido por `.catch(() => {})` (`:197`), resultando em sessão nova e vazia (RF-04). As checagens de `maxAge`/`idleTimeout` (`:349-365`) continuam depois do laço, uma vez, sobre a sessão aberta.

Detalhe: o helper preserva as condições atuais de relançar sem tentar legado (`legacySealFallback === false`, `iterations === 1`, não-`Error`, mensagem diferente: `:332-337`). Nota: para o erro final, o primeiro erro guardado é o de `password` (modo atual ou legado, conforme o helper lançar), igual ao hoje.

### D-04 — Sinal de re-selagem: novo símbolo interno `kExtraPassword`

**Contexto.** `getSession` re-sela quando `legacySeal || shouldSlide(...)` e a sessão veio do cookie (`session.ts:199-202`, `:214-216`). O marcador `kLegacySeal` é posto em `unsealed` (`:345-347`) e definido em `src/utils/internal/session.ts:7-9`.

**Alternativas.**

1. Reaproveitar `kLegacySeal` para "senha extra". Descartada: o nome mente e confunde manutenção; legado e extra são condições independentes (podem ocorrer juntas).
2. `getSession` comparar qual senha abriu (retornando índice). Descartada: exigiria mudar a assinatura pública de `unsealSession`.
3. Novo símbolo interno `kExtraPassword` (mesmo estilo de `kLegacySeal`: `Symbol.for("h3.internal.session.extra-password")`), posto em `unsealed` quando a senha que abriu não é `password`.

**Escolha: 3.** Nome público novo? Não: o símbolo fica em `internal/session.ts`, não exportado pelo `index.ts`. Em `getSession`, ler e apagar o marcador junto com `kLegacySeal` (como em `:199-202`) para que `Object.assign(session, unsealed)` (`:208`) não o copie para a sessão viva, e re-selar com `legacySeal || extraPassword || shouldSlide(...)` (`:214`). A condição `sessionFromCookie` (`:214`) já exclui o cabeçalho (RF-05). Como `updateSession` sela sempre com `password` (D-05), a regravada usa a senha atual e as opções de selo atuais (RF-02, RF-08). Sessões abertas por `password` não recebem o marcador e não são re-seladas por esse motivo.

Observação: o `session.id` precisa existir (`:214`), garantido para sessões abertas com sucesso; mantém o comportamento "sessão que falhou não é re-selada".

### D-05 — Validação em `sealSession`, com mensagem própria

**Contexto.** Hoje a senha inválida só falha dentro de `seal()` (`session.ts:300`): vazia → "Empty password" (`iron-crypto.ts:65-67`), curta → "Password string too short..." (`:192-195`). `useSession` (cria via `updateSession`, `:116-118`), `updateSession` (`:267`) e `sealSession` passam todas por `sealSession` quando há cookie.

**Alternativas.**

1. Validar em `getSession`/`useSession` ao entrar. Descartada: PRD diz que a validação é tardia ("só ao selar, não ao ler") e leitura com extra inválida não pode falhar.
2. Validar em `sealSession`, antes de `seal(...)`, com uma função interna `assertExtraUnsealPasswords(config, sealOptions)`.

**Escolha: 2.** Ponto único para as três operações que selam, e funciona "mesmo sem sessão no pedido" (a sessão em memória sempre existe nesse ponto). Regras por senha extra `p` no índice `i`: erro se `typeof p !== "string"`, `p === ""` ou `p.length < min`, onde `min = Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)` (valores efetivos após o merge com `config.seal`, `:300-304`; ambos 32 por padrão, `iron-crypto.ts:22,28`). Mensagem: `Invalid session password in extraUnsealPasswords[${i}]: must be a non-empty string of at least ${min} characters` (contém "password", minúsculo). Validar todas as posições (inclusive a última) antes de selar. `password` inválida segue como hoje, pelo erro do `seal()`. Limitação conhecida: se `config.cookie === false` ou não há `event.res`, `updateSession` não sela (`:266`) e portanto não valida; é o comportamento já existente para `password` e fica documentado.

### D-06 — Senhas extras inválidas são ignoradas na leitura

**Contexto.** Se uma extra for curta/vazia, `unseal` lançaria "Password string too short" (`iron-crypto.ts:192-195`) ou "Empty password" (`:94-96`), erro que D-03 relançaria, escondendo extras válidas posteriores e quebrando a leitura.

**Alternativas.** (1) Tratar como erro na leitura: contraria o PRD (validação só ao selar). (2) Pular extras inválidas ao montar a lista de candidatas, sem trabalho criptográfico, usando o mesmo predicado de D-05.

**Escolha: 2.** Uma senha inválida nunca selou nada (selar com ela falha), logo pulá-la é seguro. Predicado compartilhado (`isValidPassword(p, min)`) em `internal/session.ts`... ver D-08 para localização. `password` não é filtrada: se for inválida, o erro atual é preservado.

### D-07 — Tipo do campo: `readonly string[]`

`extraUnsealPasswords?: readonly string[]` em `SessionConfig` (`src/utils/session.ts`, junto a `password`, `:48`). Aceita `string[]` e arrays `as const`; o tipo de `password` não muda (`:48`). Ausente, `undefined` e `[]` são tratados igualmente (lista de candidatas = `[config.password]`). Tem JSDoc explicando: só abre, nunca sela; ordem importa; manter curta (cada tentativa custa PBKDF2); remover entradas antigas invalida as sessões delas; validação ocorre ao selar.

### D-08 — Localização dos helpers e tamanho de arquivo

`session.ts` já tem 464 linhas (convenção do AGENTS.md: preferir < 200 LoC por arquivo, dividir quando grande). Para não inchar mais, os helpers novos (`kExtraPassword`, `isValidSealPassword`) vão para `src/utils/internal/session.ts` (hoje 18 linhas). O helper `unsealWithPassword` fica em `session.ts`, pois depende de `unseal`, `kLegacySeal` e do tipo `Session`. Sem barrel files; imports explícitos com `.ts`.

### D-09 — Sem paralelismo nem cache

Alinhado ao PRD (fora de escopo): `await` sequencial em `for...of`. Isso é o que garante que `unseal` não seja chamado para extras quando `password` abre (RF-03).

## 3. Arquivos a alterar

| Arquivo                                                          | Alteração                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/session.ts:39-99`                                     | Novo campo `extraUnsealPasswords` em `SessionConfig`, logo após `password` (`:48`), com JSDoc.                                                                                                                                              |
| `src/utils/session.ts:5`                                         | Importar também `kExtraPassword` e `isValidSealPassword` de `./internal/session.ts` (hoje a linha 5 importa `kGetSession, kLegacySeal, kSessionNew`; a linha 3 já importa de `./internal/session.ts`, aproveitar para não duplicar import). |
| `src/utils/session.ts:196-218`                                   | No `.then` de `getSession`: ler/apagar `kExtraPassword` junto de `kLegacySeal` (`:199-202`) e incluir na condição de re-selagem (`:214`). Atualizar o comentário `:210-213`.                                                                |
| `src/utils/session.ts:282-307`                                   | `sealSession`: montar `sealOptions` uma vez (hoje inline em `:300-304`), chamar `assertExtraUnsealPasswords` antes de `seal(...)`. Selagem continua com `config.password` (`:300`).                                                         |
| `src/utils/session.ts:312-367`                                   | `unsealSession`: substituir o `try/catch` de `:322-348` pelo laço sobre candidatas (D-02, D-03, D-06), usando o helper `unsealWithPassword` com o bloco legado (`:326-347`) movido. Checagens de expiração `:349-365` intactas.             |
| `src/utils/internal/session.ts:7-9`                              | Adicionar `kExtraPassword` (estilo de `kLegacySeal`) e `isValidSealPassword`.                                                                                                                                                               |
| `docs/4.examples/handle-session.md:143`                          | Documentar `extraUnsealPasswords` e o procedimento de rotação (parágrafo após "Every option is optional except `password`").                                                                                                                |
| `docs/2.utils/4.security.md:56-60`                               | Mencionar na entrada de `sealSession`/`unsealSession` que extras só abrem. (Verificar se o arquivo é gerado por automd; se for, editar o JSDoc de origem e não o markdown gerado.)                                                          |
| `test/session.test.ts` (ou novo `test/session-rotation.test.ts`) | Testes da seção 5.                                                                                                                                                                                                                          |

Nenhum outro arquivo de `src/` é alterado. Não há mudança em `src/index.ts`, em `iron-crypto.ts` nem em `cookie.ts`.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (adição)
export interface SessionConfig {
  password: string; // inalterado
  /**
   * Previous passwords accepted only to unseal sessions (never to seal), tried in
   * order after `password`. A session opened with one of them is resealed with
   * `password` when read from a cookie. ...
   */
  extraUnsealPasswords?: readonly string[];
  // ...demais campos inalterados
}

// Assinaturas públicas: INALTERADAS
export function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export function useSession<T>(event: HTTPEvent, config: SessionConfig): Promise<SessionManager<T>>;
export function updateSession<T>(
  event: HTTPEvent,
  config: SessionConfig,
  update?: SessionUpdate<T>,
): Promise<Session<T>>;
export function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
export function clearSession(event: HTTPEvent, config: Partial<SessionConfig>): Promise<void>;
```

```ts
// src/utils/internal/session.ts (adições, não exportadas pelo index)
export const kExtraPassword: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-password",
);
export function isValidSealPassword(password: unknown, minLength: number): password is string;
```

```ts
// src/utils/session.ts (internas, fim do arquivo)
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // contém o try + fallback legado atuais; marca kLegacySeal

function assertExtraUnsealPasswords(config: SessionConfig, sealOptions: SealOptions): void;
```

Esqueleto do laço em `unsealSession`:

```ts
const candidates = [config.password];
for (const p of config.extraUnsealPasswords || []) {
  if (isValidSealPassword(p, minLength)) candidates.push(p); // D-06
}
let unsealed: Partial<Session> | undefined;
let firstError: unknown;
for (const [i, password] of candidates.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, config, sealOptions);
    if (i > 0) (unsealed as any)[kExtraPassword] = true;
    break;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error; // D-03
    firstError ??= error;
  }
}
if (!unsealed) throw firstError;
```

Observação de borda: `candidates` precisa conter `password` na posição 0 mesmo se vazia/curta (preserva o erro atual: `unseal` lança "Empty password" ou "Password string too short", não-hmac, relançado de imediato). `unsealWithPassword` já devolve só em sucesso; se a sessão unsealed vier `null`/falsy (JSON `null`), o código atual `if (unsealed)` (`:345`) e o acesso a `unsealed.createdAt` (`:351`) continuam como hoje; manter essa semântica ao mover o bloco.

Comportamento observável resumido: ver RF-01..RF-08 do PRD; a seção 5 mapeia cada um a testes.

## 5. Estratégia de testes

Seguir o fluxo de bug/feature do `AGENTS.md`: escrever os testes primeiro e confirmar que falham; implementar; rodar `pnpm vitest run test/session.test.ts`, depois `pnpm test` (lint + typecheck + cobertura). Os testes de integração usam `describeMatrix` (`test/session.test.ts:15`) e rodam em `web` e `node`. Selar fixtures com `seal`/`defaults` de `src/utils/internal/iron-crypto.ts`, como em `test/session.test.ts:134-142`. Senhas de teste com 32+ caracteres (P0, P1, P2 distintas).

Casos (integração, `describeMatrix`):

1. RF-01: config sem o campo e com `[]` produzem comportamento idêntico (criar, reabrir, não re-selar ao só ler, rejeitar cookie de outra senha).
2. RF-02: com `password` P2 e `[P1]`, `updateSession`, `sealSession` e sessão nova selam algo que abre com P2 e **não** abre com P1 (`unseal` direto lança "Bad hmac value").
3. RF-03: cookies selados com P2, P1, P0 (`extra: [P1, P0]`) abrem com `id`, `createdAt`, `data` preservados.
4. RF-04: cookie de senha desconhecida → resposta 200, sessão nova/vazia (id diferente do selado).
5. RF-05: cookie selado com P1, handler que só lê (`getSession`) → exatamente um `Set-Cookie` cujo valor abre com P2; cookie selado com P2 → nenhum `Set-Cookie`; sessão vinda do cabeçalho `x-h3-test-session` selada com P1 → abre e **sem** `Set-Cookie`.
6. RF-06: `extraUnsealPasswords` com vazia/curta na primeira, no meio e na última posição → `useSession` (pedido sem cookie), `updateSession` e `sealSession` rejeitam com mensagem casando `/password/i`; `password` inválida continua rejeitando. Caso de leitura: com extra inválida e cookie válido de `password`, a leitura não falha (validação tardia), e uma extra inválida antes de uma válida não impede abrir com a válida (D-06).
7. RF-07: matriz {`getSession`, `useSession`, `updateSession`, `unsealSession`, `clearSession`} x {cookie simples, cookie em chunks (`cookie: { chunkMaxLength }` pequeno), cabeçalho} com sessão selada com extra; `clearSession` apenas apaga o cookie sem erro.
8. RF-08: sessão legada (iterations 1) selada com P1 (extra) abre e é re-selada com P2 e opções atuais (`unseal(resealed, P2, sealDefaults)` ok); legada selada com P2 também; `legacySealFallback: false` → tratada como inexistente.
9. Regressão de expiração: sessão selada com extra e `maxAge` vencido → tratada como inexistente; erro de expiração não tenta novas senhas.

Contagem de tentativas (RF-03, "nenhuma extra tentada"): arquivo próprio `test/session-rotation.test.ts` (ou `test/unit/`) com `vi.mock("../src/utils/internal/iron-crypto.ts", async (orig) => ({ ...(await orig()), unseal: vi.fn(actual.unseal) }))`, afirmando as senhas recebidas por `unseal` na ordem: sessão de P2 → `[P2]`; de P1 → `[P2, (P2 legado se aplicável), P1]` e P0 nunca; senha desconhecida → todas as candidatas uma vez cada (mais legado). Sem extras: chamadas idênticas às de hoje.

Tipos: acrescentar em `test/unit/types.test-d.ts` a verificação de que `password` continua `string` e `extraUnsealPasswords` aceita `string[]` e `readonly string[]`, mas rejeita `string`.

Verificações finais: `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## 6. Riscos

| Risco                                                                                                          | Impacto                 | Mitigação                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custo PBKDF2 por tentativa: cookie inválido custa (1 + nº de extras) x até 2 (atual + legado) derivações (DoS) | Alto para listas longas | Parada na primeira que abrir; só "Bad hmac value" avança (D-03); `password` primeiro; JSDoc e docs recomendam lista curta; teste de contagem de tentativas.                                                                                                      |
| Regressão sem extras ao mover o bloco legado para helper                                                       | Médio                   | Sequência de chamadas a `unseal` e erros preservados; testes de equivalência (caso 1) e testes legados existentes (`test/session.test.ts:134-186`) devem passar sem alteração.                                                                                   |
| `kExtraPassword` vazar para a sessão viva via `Object.assign(session, unsealed)` (`session.ts:208`)            | Baixo                   | Apagar o marcador antes do `assign`, como é feito com `kLegacySeal` (`:199-202`); teste afirma que `session` retornada não tem o símbolo. Nota: chamadores diretos de `unsealSession` recebem o marcador no retorno, igual ao que ocorre hoje com `kLegacySeal`. |
| Re-selagem indevida (sessão por `password` ou por cabeçalho) gerando `Set-Cookie`                              | Médio                   | Marcador só quando índice > 0; `sessionFromCookie` já filtra cabeçalho (`:214`); testes negativos (caso 5).                                                                                                                                                      |
| Re-selagem por extra interagindo com `idleTimeout` (`shouldSlide`, `:414`)                                     | Baixo                   | Condição é um OR; `updateSession` carimba `lastSeenAt` uma única vez; teste com `idleTimeout` + extra confirma um só `Set-Cookie`.                                                                                                                               |
| Validação tardia: extra inválida não aparece até selar; em `cookie: false` nunca aparece                       | Baixo                   | Comportamento especificado; documentado no JSDoc; testes explícitos (caso 6).                                                                                                                                                                                    |
| Dependência da mensagem literal `"Bad hmac value"` (já existente em `session.ts:336`)                          | Baixo                   | Mantida a convenção atual; se `iron-crypto.ts:136` mudar, os testes de rotação falham.                                                                                                                                                                           |
| Tamanho de `session.ts` (464 linhas) crescer mais                                                              | Baixo                   | Helpers pequenos em `internal/session.ts` (D-08).                                                                                                                                                                                                                |
| Atualização de docs geradas por automd divergir do fonte                                                       | Baixo                   | Conferir `docs/2.utils/4.security.md` e o fonte antes de editar; rodar `pnpm fmt` se aplicável.                                                                                                                                                                  |
