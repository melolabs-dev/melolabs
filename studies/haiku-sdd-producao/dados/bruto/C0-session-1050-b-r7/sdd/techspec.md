# Techspec — `extraUnsealPasswords` para sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `d365d13`).

## 1. Estado atual (resumo)

- `SessionConfig.password: string` é a única senha (`src/utils/session.ts:48`).
- `sealSession` sela com `config.password` (`src/utils/session.ts:300`).
- `unsealSession` abre com `config.password` (`src/utils/session.ts:324`). Se o erro for `"Bad hmac value"`, tenta de novo com 1 iteração PBKDF2 e marca o resultado com `kLegacySeal` (`src/utils/session.ts:332-347`). Depois valida `maxAge` e `idleTimeout`, lançando `"Session expired!"` (`src/utils/session.ts:349-365`).
- `getSession` chama `unsealSession`, engole qualquer erro com `.catch(() => {})` (`src/utils/session.ts:196-197`) e, quando a sessão veio de cookie e é legada ou deve deslizar, chama `updateSession` uma única vez (`src/utils/session.ts:199-201`, `src/utils/session.ts:214-216`). Sessão do header nunca é resselada por causa de `sessionFromCookie` (`src/utils/session.ts:189-193`, `src/utils/session.ts:214`).
- O `unseal` do iron aceita `string` ou um mapa por id de senha (`src/utils/internal/iron-crypto.ts:87-90`, `src/utils/internal/iron-crypto.ts:122-131`). Ele lança `"Empty password"` para senha vazia (`src/utils/internal/iron-crypto.ts:92-94`). Falha de senha errada é sempre `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:141`).
- `kLegacySeal` é interno e fica em `src/utils/internal/session.ts:7`. `unsealSession` e `sealSession` são exportados em `src/index.ts:208-209`, então as assinaturas não podem mudar.

## 2. Decisões de arquitetura

### D-01 — Campo separado `extraUnsealPasswords?: string[]`, `password` continua `string`

- **Alternativas:** (a) `password: string | string[]`, a segunda opção da issue; (b) campo novo `extraUnsealPasswords`; (c) mapa de senhas por id, usando o recurso nativo do iron.
- **Escolha:** (b).
- **Justificativa:** é o contrato do pedido e do PRD (RF-01, seção 3). A opção (a) está explicitamente fora de escopo e quebraria o tipo de `password`. A opção (c) exigiria ids dentro dos selos já emitidos. As sessões existentes têm id vazio, o que obrigaria a mapear `default`, e a mudança vazaria para o formato do selo. O campo novo não altera o tipo atual, então `password` como array continua sendo erro de tipo.

### D-02 — Selagem intocada

- **Alternativas:** (a) não mexer em `sealSession`; (b) passar a lista inteira ao `seal`.
- **Escolha:** (a).
- **Justificativa:** `sealSession` já usa só `config.password` (`src/utils/session.ts:300`). `updateSession` e `useSession` herdam isso (RF-02). Não há código a alterar, apenas teste para travar o comportamento.

### D-03 — Laço de tentativas dentro de `unsealSession`, expiração fora do laço

- **Alternativas:** (a) laço em `getSession`, chamando `unsealSession` uma vez por senha; (b) laço dentro de `unsealSession`; (c) `Promise.any` com todas as senhas em paralelo.
- **Escolha:** (b), sequencial. A ordem é `password` e depois os extras na ordem do array. A primeira que abrir vence.
- **Justificativa:**
  - `unsealSession` é público e exportado (`src/index.ts:209`). Com o laço dentro dele, quem o chama direto também ganha a rotação, e `getSession` fica com o mesmo fluxo (RF-03).
  - A opção (a) duplicaria a verificação de expiração e perderia o erro original.
  - A opção (c) multiplica o custo de CPU (PBKDF2) em todo cookie válido, contra o RF-06 ("uma única tentativa" sem extras) e o risco de DoS do PRD.
  - A verificação de `maxAge` e `idleTimeout` (`src/utils/session.ts:349-365`) fica depois do laço, aplicada ao primeiro resultado que abriu. Assim `"Session expired!"` nunca é engolido por um erro de senha e nunca leva a tentar outra senha (RF-07, risco "mascarar erro de expiração").
  - Se nenhuma senha abrir, relança-se o **primeiro** erro, o da `password`. O erro visto por quem chama `unsealSession` diretamente fica idêntico ao de hoje (RF-04, RF-06).

### D-04 — Fallback legado por senha, extraído para helper interno

- **Alternativas:** (a) para cada senha, tentar iterações atuais e depois a legada; (b) tentar todas as senhas com iterações atuais e só então todas com a legada; (c) não aplicar o legado às extras.
- **Escolha:** (a), movendo o bloco `try/catch` atual (`src/utils/session.ts:322-348`) para uma função interna `unsealWithPassword(sealed, password, config, sealOptions)` no fim de `session.ts`. A convenção do projeto manda pôr helpers internos no fim do arquivo.
- **Justificativa:** o RF-07 exige o legado com cada senha e respeitando `legacySealFallback: false`. A opção (c) contraria isso. A opção (b) mudaria a ordem observável: um selo legado de `password` ainda perderia para um selo moderno de uma extra, o que não faz diferença prática, mas torna o código mais complexo sem ganho. Com (a) o caminho sem extras é literalmente o código atual, e o custo é no máximo `(1 + N) × 2` operações, como o PRD já prevê. O helper preserva as condições de `src/utils/session.ts:332-337` e o `throw error` original.

### D-05 — Marcar "selado com senha extra" por um símbolo interno novo e reutilizar o único `updateSession`

- **Alternativas:** (a) reutilizar `kLegacySeal` para os dois casos; (b) novo símbolo interno `kRotatedSeal` em `src/utils/internal/session.ts`; (c) devolver a informação por um campo público em `Session`.
- **Escolha:** (b).
- **Justificativa:**
  - A opção (a) deixaria o nome `kLegacySeal` mentindo sobre o que significa. A opção (c) criaria nome público novo, proibido pelo pedido ("Nenhum outro nome público novo").
  - O símbolo novo é interno e não é exportado por `src/index.ts`. Segue a convenção `k` do projeto.
  - Em `getSession`, a condição passa a ser `legacySeal || rotatedSeal || shouldSlide(...)`, ainda dentro do **mesmo** `if` e com uma só chamada de `updateSession` (`src/utils/session.ts:214-216`). Isso cobre RF-05 e a coexistência com o fallback legado e com o deslize do `idleTimeout`, sem selar duas vezes (RF-07).
  - A condição mantém `sessionFromCookie`, então sessões do header não são resselada (RF-05).
  - Os dois marcadores são removidos do objeto antes do `Object.assign(session, unsealed)`, como hoje com `kLegacySeal` (`src/utils/session.ts:199-202`). Símbolos não vão para o JSON selado, mas assim eles também não ficam na sessão em memória.
  - `unsealWithPassword` marca `kLegacySeal` como hoje. O laço marca `kRotatedSeal` quando o índice da senha que abriu é maior que 0.

### D-06 — Normalização da lista de senhas

- **Alternativas:** (a) usar o array como veio; (b) normalizar em `unsealSession`, ignorando `undefined`, `[]` e senhas iguais a `password`.
- **Escolha:** (b). A lista é `[config.password, ...extras]`, sem repetir senhas já presentes.
- **Justificativa:** `undefined` e `[]` valem como ausente, então o caminho sem extras faz uma tentativa só (RF-06). Uma extra igual a `password` não gera tentativa repetida nem reselagem sem necessidade. Senhas extras vazias ou inválidas falham dentro do laço com `"Empty password"` ou `"Bad hmac value"`, o erro é guardado e o laço segue. A requisição não cai (premissa do PRD).

### D-07 — Documentação

- **Alternativas:** (a) só o TSDoc; (b) TSDoc, o guia de sessões e a referência de `unsealSession`.
- **Escolha:** (b).
- **Justificativa:** o RF-08 pede um guia de rotação. A seção entra em `docs/4.examples/handle-session.md`, depois de "Expiration" (hoje `docs/4.examples/handle-session.md:151`) e antes de "Use Multiple Sessions" (`docs/4.examples/handle-session.md:190`). O texto cobre:
  - passos da rotação: nova senha em `password`, antiga em `extraUnsealPasswords`, remoção da antiga depois que as sessões migrarem por reselagem;
  - lista curta, por causa do custo de CPU;
  - remover a senha comprometida;
  - mesma exigência de entropia de `password`.
    A referência `docs/2.utils/4.security.md:60` ganha uma frase em `unsealSession`.

## 3. Arquivos a alterar

| Arquivo                             | Linhas                                                        | Mudança                                                                                        |
| ----------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/utils/session.ts`              | `src/utils/session.ts:39-99` (interface; `password` em `:48`) | Adicionar `extraUnsealPasswords?: string[]` com TSDoc, logo depois de `password`               |
| `src/utils/session.ts`              | `src/utils/session.ts:5`                                      | Importar também `kRotatedSeal`                                                                 |
| `src/utils/session.ts`              | `src/utils/session.ts:194-218`                                | Ler e remover `kRotatedSeal` junto de `kLegacySeal`; condição de reselagem em `:214`           |
| `src/utils/session.ts`              | `src/utils/session.ts:312-367`                                | `unsealSession`: laço sobre as senhas e erro da primeira falha; expiração (`:349-365`) intacta |
| `src/utils/session.ts`              | fim do arquivo (depois de `:464`)                             | Novo helper interno `unsealWithPassword` com o bloco de `:322-348`                             |
| `src/utils/internal/session.ts`     | `src/utils/internal/session.ts:7-9`                           | Novo `kRotatedSeal`, ao lado de `kLegacySeal`                                                  |
| `test/session.test.ts`              | depois de `test/session.test.ts:186`                          | Testes novos (seção 5)                                                                         |
| `docs/4.examples/handle-session.md` | `docs/4.examples/handle-session.md:151-190`                   | Seção "Rotate the Password"                                                                    |
| `docs/2.utils/4.security.md`        | `docs/2.utils/4.security.md:60-62`                            | Menção às senhas extras em `unsealSession`                                                     |

Não mudam: `sealSession` (`src/utils/session.ts:282-307`), `updateSession`, `useSession`, `src/index.ts`, `iron-crypto.ts`, cookies. Testes existentes (como `test/session.test.ts:134` e `:161`) não dependem do que muda e ficam como estão.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — única mudança pública
export interface SessionConfig {
  password: string; // sela e abre (inalterado)
  /**
   * Previous passwords that may only open sessions, never seal them.
   * Tried in order after `password`; the first that opens the session wins.
   * A cookie session opened with one of these is resealed with `password`.
   * Same entropy requirement as `password`. Keep the list short: every extra
   * password adds a PBKDF2 attempt for each invalid cookie. Remove a password
   * once sessions have migrated, or as soon as it is compromised.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// Assinaturas públicas inalteradas:
export function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
export function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
```

```ts
// src/utils/internal/session.ts — interno, não exportado em src/index.ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.rotated-seal",
);

// src/utils/session.ts — helper interno, fim do arquivo
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // marca kLegacySeal quando precisou do fallback
```

Comportamento de `unsealSession` após a mudança:

1. `passwords = [config.password, ...(config.extraUnsealPasswords ?? [])]`, sem repetir senhas.
2. Para cada senha, em ordem, chamar `unsealWithPassword`. Se abrir, parar. Se o índice for maior que 0, marcar `kRotatedSeal`. Se falhar, guardar o primeiro erro e continuar.
3. Se nenhuma abrir, lançar o primeiro erro.
4. Aplicar `maxAge` e `idleTimeout` sobre o resultado, como hoje.

## 5. Estratégia de testes

Arquivo `test/session.test.ts`, dentro do `describeMatrix("session", …)` (`test/session.test.ts:15`), que roda em `web` e `node`. Usar `seal` e `unseal` do `iron-crypto`, já importados em `test/session.test.ts:12`. Rota `/` e `sessionConfig` seguem o padrão de `test/session.test.ts:21-37`; para a configuração com extras, registrar uma rota própria como em `test/session.test.ts:171`. Os testes abaixo são todos novos e cada um deve falhar sem a implementação:

| RF    | Teste                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-02 | Config `password: P2, extraUnsealPasswords: [P1]`: cria e atualiza uma sessão. O cookie emitido abre com P2 e **não** abre só com P1 (`unseal` com P1 lança).                                                                                                                                                                                                                |
| RF-03 | Cookie com dados selado com P1: `getSession` e `useSession` devolvem `id`, `createdAt` e `data` originais, sem criar sessão nova. Variantes: cookie em chunks (dados grandes, como em `test/session.test.ts:656`), header de sessão, e senha extra na 2ª posição.                                                                                                            |
| RF-04 | Cookie selado com P0, que não está em nenhuma lista: sessão nova (outro `id`, `data` vazio) e nenhum erro exposto.                                                                                                                                                                                                                                                           |
| RF-05 | Cookie de P1: a resposta traz exatamente um `Set-Cookie` da sessão, que abre só com P2 e preserva `id`, `createdAt` e `data`. Sessão do header: nenhum `Set-Cookie`.                                                                                                                                                                                                         |
| RF-06 | Sem `extraUnsealPasswords` e com `[]`: selo de outra senha é rejeitado. Contar as chamadas de `unseal` com `vi.spyOn`, ou comparar o comportamento com o teste de legado, para checar que há uma tentativa (duas só quando há fallback legado). A suíte existente passa sem alterações.                                                                                      |
| RF-07 | `maxAge` vencido com selo de P1: sessão nova. Idem para `idleTimeout`. `legacySealFallback: false` com selo legado de P1: rejeitado. Selo legado de P1 com o fallback ligado: aberto e resselado **uma só vez** (um `Set-Cookie`), com P2 e iterações atuais. Caso combinado: selo de P1 mais `idleTimeout` com janela já usada em mais da metade, ainda um só `Set-Cookie`. |

Tipos (RF-01): se o `tsconfig` cobrir `test/`, incluir uma linha com `// @ts-expect-error` passando `password: ["x"]`. O arquivo `test/unit/types.test-d.ts` é o lugar natural, e o passo será conferido antes de escrever.

Verificação final: `pnpm vitest run test/session.test.ts`, depois `pnpm vitest run test/unit/` e a suíte completa, e `pnpm lint` e `pnpm typecheck`. Seguir o fluxo de bug do AGENTS.md: escrever os testes, ver falharem, implementar, ver passarem.

## 6. Riscos

| Risco                                                                                                                             | Mitigação                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CPU/DoS:** cookie inválido custa até `(1 + N) × 2` PBKDF2 (8192 iterações cada).                                                | Lista curta documentada (D-07). Deduplicar (D-06). Laço sequencial, sem paralelismo (D-03). Caminho sem extras idêntico ao atual.                                                                      |
| **Mascarar expiração:** tratar erro por senha poderia engolir `"Session expired!"`.                                               | A expiração roda **depois** do laço, só sobre o resultado já aberto (D-03). Testes de RF-07.                                                                                                           |
| **Regressão no `Set-Cookie`:** reselagem dupla ou cookie a mais.                                                                  | Um só `if` e um só `updateSession` (D-05). Testes que contam `getSetCookie()` (RF-05, RF-07).                                                                                                          |
| **Mudança de erro para quem chama `unsealSession` direto.**                                                                       | Relançar o primeiro erro, o da `password` (D-03).                                                                                                                                                      |
| **Senha antiga comprometida segue válida na lista.**                                                                              | Documentação manda remover após a migração. Não há revogação por senha (fora de escopo).                                                                                                               |
| **Marcador interno vazar para a sessão.**                                                                                         | `kRotatedSeal` removido antes do `Object.assign`, como `kLegacySeal` (D-05).                                                                                                                           |
| **Sessões que nunca voltam não migram:** a senha antiga só sai com segurança depois que as sessões ativas passaram por reselagem. | Documentar. O `maxAge` ou `idleTimeout` dá o prazo natural.                                                                                                                                            |
| **Extra com tipo ou valor inválido em runtime** (não-string, vazia).                                                              | Falha de unseal tratada como senha que não abriu (D-06). O `unseal` com valor vazio lança `"Empty password"` (`src/utils/internal/iron-crypto.ts:92-94`). Um caso de teste cobre senha vazia na lista. |
| **Tipos de teste não cobertos pelo `typecheck`.**                                                                                 | Conferir o `include` do `tsconfig` antes de apostar no `@ts-expect-error`. Se não cobrir, o RF-01 fica validado pelo tipo no próprio `session.ts`.                                                     |
