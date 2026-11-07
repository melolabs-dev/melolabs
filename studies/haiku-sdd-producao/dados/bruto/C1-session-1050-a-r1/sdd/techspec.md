# Especificação técnica — Várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-08) e issue h3js/h3#1050 (segunda alternativa).

## Visão geral

`SessionConfig.password` passa a aceitar `string | string[]`. A lista é normalizada internamente para uma tupla não vazia: o primeiro item sela, e todos tentam desselar, nessa ordem. Com uma string, o caminho fica equivalente ao atual. A mudança fica concentrada em `src/utils/session.ts` e em um helper novo em `src/utils/internal/session.ts`. O formato do cookie e o algoritmo de selo não mudam.

## Decisões de arquitetura

### D-01 — Tipo público de `password`: `string | string[]`

- **Escolha:** união direta no campo existente, `password: string | string[]`, com JSDoc atualizado para dizer que a lista é não vazia e que a primeira senha sela.
- **Alternativas consideradas:**
  - Campo novo `passwords` ao lado de `password`: cria um nome público novo, o que o pedido proíbe.
  - Objeto `{ seal, unseal }`: muda a forma da configuração e obriga a migrar quem já usa string.
  - Sobrecargas de função: não resolvem o tipo de `SessionConfig`, que é o contrato público.
- **Justificativa:** é o único formato que cumpre "nenhum outro nome público novo" e mantém a string como caso de uso comum.

### D-02 — Selar com a primeira senha, sem `id` no selo

- **Escolha:** `sealSession` usa `passwords[0]` como string, sem `id`. `seal` então grava `passwordId = ""` no selo, igual ao comportamento atual.
- **Alternativas consideradas:**
  - Usar o mapa de senhas do iron (`PasswordHash`, `{ id, secret }`, `src/utils/internal/iron-crypto.ts:87-91`, `:120-127`): grava um `id` no segmento `passwordId` do selo e muda o formato do cookie. Viola a restrição "sem mudança de formato" do PRD.
  - Guardar o índice da senha no selo: também muda o formato.
- **Justificativa:** sessões novas continuam indistinguíveis das atuais no formato, e a rotação não depende de identificadores.

### D-03 — Desselar tentando cada senha em ordem; avançar só em `Bad hmac value`

- **Escolha:** o laço continua somente quando o erro é exatamente `"Bad hmac value"`. Qualquer outro erro (`Expired seal`, `Incorrect number of sealed components`, `Empty password`, `Password string too short`, erro de JSON) é relançado de imediato.
- **Alternativas consideradas:**
  - Capturar qualquer erro e seguir para a próxima senha: esconde erros de configuração e faz a senha curta bloquear ou mascarar o restante.
  - Tentar todas as senhas em paralelo com `Promise.all`: multiplica o custo de CPU de uma vez e não ajuda a latência.
- **Justificativa:** `Bad hmac value` é o único erro que significa "esta senha não é a deste selo". `Expired seal` é verificado antes do HMAC (`src/utils/internal/iron-crypto.ts:110-118`), então independe da senha e não deve gerar tentativas extras.

### D-04 — Fallback legado dentro do mesmo laço, por senha

- **Escolha:** para cada senha, tenta-se primeiro o selo atual e, se o erro for `Bad hmac value` e o fallback estiver ativo, tenta-se o selo com 1 iteração. Mantém-se a guarda atual `legacySealFallback !== false` e `sealOptions.integrity.iterations !== 1` (`src/utils/session.ts:332-339`).
- **Alternativas consideradas:**
  - Tentar todas as senhas com o selo atual e só depois todas com o legado: mesmo custo de pior caso e mais código para a mesma coisa.
  - Legado só para a primeira senha: não cumpre RF-06.
- **Justificativa:** a tentativa legada usa 1 iteração contra 8192 do padrão (`src/utils/internal/iron-crypto.ts:22`, `:28`), então custa uma fração desprezível de uma tentativa normal. Um laço único é mais simples e cobre RF-06 sem custo perceptível.

### D-05 — Validar a configuração na entrada, antes do `.catch`

- **Escolha:** um helper `resolveSessionPasswords(password)` é chamado no início de `getSession` (antes de tocar em `context.sessions`), e também em `sealSession` e `unsealSession`. Ele:
  1. rejeita lista vazia com mensagem clara (RF-05);
  2. rejeita entrada vazia (`""`);
  3. remove duplicadas preservando a ordem (evita tentativas redundantes, item de risco do PRD);
  4. verifica o tamanho mínimo de cada entrada, usando `config.seal?.encryption.minPasswordlength ?? sealDefaults.encryption.minPasswordlength` (ver pendência P-1).
- **Por que no início de `getSession`:** `unsealSession` é chamada dentro de `.catch(() => {})` (`src/utils/session.ts:196-197`). Um erro de configuração lançado ali seria engolido e a sessão viraria anônima sem aviso. Validar antes do `.catch` faz o erro chegar ao chamador.
- **Alternativas consideradas:**
  - Validar só dentro de `unsealSession`: erro silencioso, como descrito acima.
  - Não validar: a lista vazia cairia em `Empty password` do iron (`src/utils/internal/iron-crypto.ts:94-96`), uma mensagem que não atende RF-05.

### D-06 — Reselo: manter os gatilhos atuais

- **Escolha:** nenhum reselo novo. A sessão passa para a senha nova quando já é resselada por qualquer gatilho existente: escrita (`updateSession`, `src/utils/session.ts:241-277`), desselo de selo legado (`src/utils/session.ts:214-215`) ou deslizamento de `idleTimeout` (`src/utils/session.ts:414-421`). Isso cumpre RF-08 tal como escrito no PRD.
- **Alternativas consideradas:**
  - Resselar em toda leitura quando a sessão foi aberta por uma senha que não é a primeira: faria a rotação terminar mesmo sem `idleTimeout` e sem escrita, mas adiciona estado por requisição e um selo extra por sessão antiga. Fica como pendência P-2.
- **Justificativa:** o escopo do PRD exclui rotação controlada por tempo e pede o mínimo de mudança. Os gatilhos atuais já cobrem o caso previsto.

### D-07 — Helpers em `src/utils/internal/session.ts`

- **Escolha:** `resolveSessionPasswords` e `unsealWithPasswords` vão para `src/utils/internal/session.ts`, que já concentra símbolos e constantes internas da sessão (`src/utils/internal/session.ts:1-18`). `src/utils/session.ts` já passa de 460 linhas, e o `AGENTS.md` pede arquivos curtos e helpers internos em `utils/internal/`.
- **Alternativas consideradas:**
  - Helpers no fim de `src/utils/session.ts`: aumenta um arquivo que já está acima do limite.
  - Arquivo novo `src/utils/internal/session-password.ts`: separação limpa, mas um arquivo a mais para duas funções. Pode ser preferível se o helper crescer.

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | Tipo de `password` (`:48`), JSDoc (`:41-47`), validação no início de `getSession` (`:149-153`), `sealSession` com a primeira senha (`:300-304`), `unsealSession` com o helper (`:324`, `:340-344`). O TODO de `:326-331` e a guarda de `:332-339` permanecem. |
| `src/utils/internal/session.ts` | Novos helpers `resolveSessionPasswords` e `unsealWithPasswords`. Reutiliza `kLegacySeal` (`:7-9`). |
| `test/session.test.ts` | Novo bloco de testes com `describeMatrix`, após o teste de `legacySealFallback: false` (`:161-186`). Os testes existentes ficam como estão. |
| `docs/4.examples/handle-session.md` | Nota sobre rotação com lista de senhas, junto ao aviso de entropia (`:37`). Opcional, mas recomendado. |

Não é preciso alterar `src/index.ts` (exportações em `:201-212`, incluindo `sealSession` e `unsealSession` em `:208-209`), porque as assinaturas públicas dessas funções não mudam. O `test/bench/session.ts:10` passa uma string e continua válido.

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig
/**
 * Private key(s) used to seal session tokens. Must be at least 32 characters.
 * A list must not be empty: the first password seals new sessions and every
 * password is tried, in order, to unseal existing ones.
 * ...
 */
password: string | string[];
```

```ts
// src/utils/internal/session.ts

/**
 * Normalizes `SessionConfig.password` into a non-empty, deduplicated tuple.
 * Throws if the list is empty, an entry is empty, or an entry is shorter than
 * the minimum password length.
 */
export function resolveSessionPasswords(password: string | string[]): [string, ...string[]];

/**
 * Tries each password in order. Only `Bad hmac value` moves on to the next one;
 * any other error is rethrown. With `legacyFallback`, each password also gets
 * the 1-iteration attempt. Marks the result with `kLegacySeal` when the legacy
 * seal opened it. If no password matches, rethrows the last `Bad hmac value`.
 */
export async function unsealWithPasswords(
  sealed: string,
  passwords: [string, ...string[]],
  sealOptions: SealOptions,
  legacyFallback: boolean,
): Promise<Partial<Session>>;
```

Sem alteração em `sealSession(event, config)`, `unsealSession(event, config, sealed)`, `getSession`, `useSession`, `updateSession` e `clearSession`. Os parâmetros continuam os mesmos. Só o tipo do campo `config.password` muda.

Esboço do desselo em `unsealSession`:

```ts
const passwords = resolveSessionPasswords(config.password);
const legacyFallback = config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1;
const unsealed = await unsealWithPasswords(sealed, passwords, sealOptions, legacyFallback);
// maxAge / idleTimeout checks seguem como estão (src/utils/session.ts:349-365)
```

Como `unsealSession` já é envolvida pelo `.catch` de `getSession`, o desselo continua falhando em silêncio para senhas fora da lista, como em RF-07.

## Estratégia de testes

Todos os testes novos usam `describeMatrix` (web e node), no mesmo padrão de `test/session.test.ts:15-25`. Os testes do PRD mapeiam assim:

| Teste | Cobre |
| --- | --- |
| Sela com a primeira senha: o cookie abre com a nova e não abre com a antiga (via `unseal` direto, como em `test/session.test.ts:157`). | RF-01, RF-02 |
| Cookie selado com a senha antiga é lido por `getSession`, mantém o `id` e não cria sessão nova. | RF-03 |
| Cookie legado (1 iteração) com a senha antiga é aberto, marcado como legado e resselado com a nova. Espelha `test/session.test.ts:134-159`. | RF-06 |
| Cookie com senha fora da lista vira sessão nova, como senha errada hoje. | RF-07 |
| Desselo com `idleTimeout` ou escrita resela com a senha nova (cookie da resposta abre só com a nova). | RF-08 |
| `password: []` rejeita `useSession`, `getSession` e `sealSession` com erro de mensagem clara. | RF-05 |
| Entrada vazia e lista com duplicadas: erro na entrada vazia; duplicadas se comportam como lista única. | D-05 |
| Sessão expirada continua expirada com lista de senhas (`Expired seal` não avança o laço). | D-03 |
| Suíte existente sem alteração passa (`test/session.test.ts`, incluindo `:134-186` e `:692-`). | RF-04 |

Testes unitários opcionais em `test/unit/`: `resolveSessionPasswords` (lista vazia, duplicadas, tupla de retorno) e `unsealWithPasswords` com senhas erradas seguidas de uma correta.

Comandos para validar:

- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit`
- `pnpm lint` e `pnpm typecheck`, que o pedido exige que passem. Confirmar o nome do script de tipos em `package.json`, que não foi lido nesta especificação.

Seguindo o fluxo de bug do `AGENTS.md`, os testes de RF-03 e RF-06 devem falhar antes da mudança. Para isso, basta rodá-los contra `password: ["senha-nova", "senha-antiga"]` na versão atual, que hoje lança erro de tipo.

## Riscos

- **Custo de CPU.** Cada senha errada custa uma derivação PBKDF2 de integridade com 8192 iterações (`src/utils/internal/iron-crypto.ts:133` chama `hmacWithPassword`, que chama `generateKey` em `:171-216`). O HMAC é checado antes da decifragem (`:133-137`), então uma tentativa errada não paga o custo de decifrar. Com N senhas, o pior caso é N tentativas completas mais N tentativas legadas, que custam bem menos. Medir com `test/bench/session.ts` e uma lista de 3 a 5 senhas.
- **Senha curta bloqueia o laço.** Uma entrada com menos de 32 caracteres lança `Password string too short` (`src/utils/internal/iron-crypto.ts:192-196`). Esse erro não é `Bad hmac value`, então pararia o laço antes das senhas seguintes. A validação de D-05 evita isso.
- **Senha antiga esquecida.** Uma sessão sem `maxAge` nem `idleTimeout`, que não é escrita nem resselada, continua aberta com a senha antiga indefinidamente. Com `maxAge` ou `idleTimeout`, a senha antiga expira junto com a sessão. Isso precisa ir para a documentação (ver P-2).
- **Mudança de tipo pública.** Código externo que lê `config.password` como `string` passa a receber `string | string[]`. Dentro do repositório, só `src/utils/session.ts` lê o campo. Vale registrar como mudança de tipo no changelog.
- **Erros engolidos.** `getSession` ignora erros de `unsealSession` (`src/utils/session.ts:197`). Erros novos de configuração só aparecem se forem validados antes do `.catch`, como em D-05.
- **Ordem da lista.** A ordem define a prioridade. Trocar a ordem muda qual senha sela, e isso não tem aviso. Documentar.

## Pendências (decisões para o usuário)

- **P-1 — Tamanho mínimo em todas as entradas.** D-05 recomenda validar o tamanho de cada entrada também quando a configuração é uma única string. Isso só muda o comportamento de configurações que já violam o mínimo de 32 caracteres documentado, mas faz `getSession` lançar mesmo sem cookie. Confirmar se é aceitável, ou restringir a checagem às listas.
- **P-2 — Reselo em leitura para senha não primária.** D-06 mantém os gatilhos atuais. Se a rotação precisar terminar sem `maxAge`, sem `idleTimeout` e sem escrita, é preciso marcar a sessão aberta por senha não primária e resselá-la na leitura. Isso adiciona um selo por sessão antiga, uma vez só.
