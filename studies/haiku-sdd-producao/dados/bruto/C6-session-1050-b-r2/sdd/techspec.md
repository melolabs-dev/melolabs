# Techspec — Várias senhas de unseal nas sessões

Referências: issue h3js/h3#1050 (primeira alternativa), `sdd/pedido.md`, `sdd/prd.md` (RF-01 a RF-09, R1 a R5).

## 1. Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `password` continua sendo a única senha que sela. A desselagem tenta `password` e depois cada extra, na ordem. Uma sessão de cookie aberta por senha extra é resselada com `password` na mesma requisição. A mudança fica em `src/utils/session.ts` e `src/utils/internal/session.ts`, mais testes e docs. `iron-crypto.ts` não muda.

## 2. Estado atual (conferido no código)

- `SessionConfig.password: string` é declarado em `src/utils/session.ts:48`. Não existe campo de senhas extras.
- `sealSession` sela com `config.password` em `src/utils/session.ts:300`.
- `unsealSession` (`src/utils/session.ts:312-367`) chama `unseal(sealed, config.password, sealOptions)` em `:324`. No `catch` (`:325-348`) faz o retry legado com 1 iteração PBKDF2. O retry só ocorre se o erro for `Error` com mensagem `"Bad hmac value"` (`:332-337`) e marca `kLegacySeal` em `:345-347`. Depois aplica `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`).
- `getSession` chama `unsealSession` em `:196` e engole o erro em `:197` (`.catch(() => {})`). Lê `kLegacySeal` em `:199-202`. Reseala em `:214-216` quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))`.
- Nome e valor dos símbolos internos: `src/utils/internal/session.ts:3-9` (`kGetSession`, `kSessionNew`, `kLegacySeal`).
- Em `unseal` (`src/utils/internal/iron-crypto.ts:87-150`), a ordem das verificações é:
  1. número de partes (`:99`);
  2. prefixo (`:106`);
  3. expiração do token, erro `"Expired seal"` (`:110-118`);
  4. HMAC, erro `"Bad hmac value"` (`:135-137`).
  Só a etapa 4 depende da senha. Com senha string, o id do iron é ignorado (`:121-123`).
- O mínimo de tamanho da senha é verificado em `generateKey` (`iron-crypto.ts:191-196`). O valor padrão é 32 (`:22` e `:28`) e `config.seal` pode sobrescrevê-lo. Esse erro (`Password string too short`) não é `"Bad hmac value"`.
- `src/index.ts:203` exporta o tipo `SessionConfig`, então o campo novo entra na API pública sem nenhuma exportação nova.
- Testes: `test/session.test.ts:15` (`describeMatrix`), `sessionConfig` em `:21-25`, legado em `:134-186`. Os testes de legado usam `seal` com `iterations: 1` e conferem o `Set-Cookie` com `unseal`.
- Docs: `docs/4.examples/handle-session.md`, seção "Options" em `:120`, e o aviso sobre a senha em `:36-47`.

## 3. Decisões de arquitetura

### D-01 — Onde fica a lógica de tentativa de senhas

- **Alternativas:**
  (a) Alterar `unseal` em `iron-crypto.ts` para aceitar lista de senhas.
  (b) Iterar dentro de `unsealSession`, chamando `unseal` uma vez por senha.
  (c) Usar o mecanismo de `PasswordHash` do iron, com ids de senha no token.
- **Escolha: (b).**
- **Justificativa:** o PRD proíbe mudar o formato do token e o iron (fora de escopo). A opção (c) exigiria ids no token selado. (a) mexe num módulo interno que não precisa mudar. (b) isola a mudança em `session.ts` e preserva P2, em que o token string não carrega id e a escolha é por tentativa.

### D-02 — Quais erros avançam para a próxima senha

- **Alternativas:**
  (a) Qualquer erro avança para a próxima senha.
  (b) Só `"Bad hmac value"` avança. Outros erros são relançados na hora.
- **Escolha: (b).**
- **Justificativa:** `"Bad hmac value"` é o único erro que diz "esta senha não abriu o token". Token malformado, prefixo errado e `"Expired seal"` (`iron-crypto.ts:99,106,117`) ocorrem antes da senha e valem igualmente para todas, então tentar de novo desperdiçaria PBKDF2 (risco R2). Com (b), um token inválido custa uma verificação como hoje, e só um HMAC que falha custa uma verificação por senha. A comparação reaproveita a mesma checagem de mensagem já usada em `session.ts:336`, extraída para um helper interno.

### D-03 — Ordem entre senhas e fallback legado

- **Alternativas:**
  (a) Para cada senha, tentar as iterações atuais e depois as legadas.
  (b) Tentar todas as senhas com as iterações atuais e depois todas com as legadas.
- **Escolha: (a).**
- **Justificativa:** RF-06 pede que o fallback valha para cada senha candidata, e RF-03 diz que a primeira senha que abrir vence, com `password` primeiro. Em (a) a precedência é determinística e a lógica atual de `:324-348` vira o corpo de um helper `unsealWith(password)`. O custo máximo é `2 × (1 + N)` derivações e só ocorre com cookie inválido. Isso fica documentado (R2). `legacySealFallback: false` e `iterations === 1` continuam desligando a segunda tentativa, como em `:333-334`.

### D-04 — Como marcar "aberta por senha extra" para a reselagem

- **Alternativas:**
  (a) Reusar `kLegacySeal` com o sentido "precisa reselar".
  (b) Novo símbolo interno em `src/utils/internal/session.ts`, por exemplo `kStaleSeal`, e `getSession` reseala se `legacySeal || staleSeal`.
  (c) Comparar a senha em `getSession`, reabrindo o token.
- **Escolha: (b).**
- **Justificativa:** (a) mistura dois motivos distintos sob um nome que fala de iterações. (c) paga PBKDF2 de novo. Em (b) o símbolo é interno, não é exportado de `src/index.ts`, então não viola "nenhum outro nome público novo". Ele segue o padrão de `kLegacySeal`: é definido em `unsealSession` e removido do objeto em `getSession` antes do `Object.assign` ao estado da sessão (`session.ts:199-208`), para não vazar em `context.sessions`. Os dois símbolos juntos entram na mesma condição de `:214`, o que resolve R4: uma única chamada a `updateSession` por requisição, mesmo quando o legado, o extra e o `shouldSlide` valem juntos.

### D-05 — Reselagem só para cookie (RF-07, R5)

- **Alternativas:** (a) reselar também a sessão vinda do header; (b) manter a condição `sessionFromCookie` de `session.ts:214`.
- **Escolha: (b).**
- **Justificativa:** `updateSession` só grava cookie, e o header não tem como ser resselado. A sessão de header aberta por senha extra continua válida até expirar, como o PRD registra em R5. Reselar nesse caso emitiria um cookie que o cliente nunca pediu.

### D-06 — Validação das senhas extras (RF-09, R1)

- **Alternativas:**
  (a) Validar só dentro de `unsealSession`.
  (b) Validar no início de `getSession`, antes de qualquer leitura, com um helper interno compartilhado com `unsealSession`.
  (c) Ignorar entradas inválidas.
- **Escolha: (b).**
- **Justificativa:** o erro de `unsealSession` seria engolido por `.catch(() => {})` em `session.ts:197` e viraria sessão descartada em silêncio, que é o que o RF-09 proíbe. `useSession` chama `getSession` primeiro (`:115`), então a validação no topo de `getSession` cobre os dois. Ela fica antes de `context.sessions![sessionName] = session` (`:173`), para um erro não deixar uma sessão vazia no contexto. Regras:
  - `extraUnsealPasswords` ausente ou `[]` é válido (RF-04).
  - Se não for array, ou se um item não for string, lança erro.
  - Item vazio, ou menor que `config.seal?.encryption.minPasswordlength ?? sealDefaults.encryption.minPasswordlength` e também que `config.seal?.integrity.minPasswordlength ?? sealDefaults.integrity.minPasswordlength`, lança erro. O limite usado é o maior dos dois, pois a senha precisa servir às duas derivações.
  - A mensagem cita `extraUnsealPasswords[i]` e o mínimo, e nunca o valor. Exemplo: ``extraUnsealPasswords[1] is empty or too short (min 32 characters required)``.
  - O tipo do erro é `Error`, igual ao de `generateKey`. `password` não ganha validação nova, para não mudar o comportamento atual.
  - O helper também é chamado no início de `unsealSession`, para quem a chama direto. Ali é inofensivo, porque `getSession` já validou antes.

### D-07 — Lista efetiva de candidatas

- **Alternativas:** (a) usar `[password, ...extra]` como está; (b) remover da lista as extras iguais a `password` ou repetidas.
- **Escolha: (b).**
- **Justificativa:** repetir uma senha só gasta PBKDF2 sem mudar o resultado. A deduplicação preserva a ordem (RF-03). Quem passa a mesma senha em `password` e `extraUnsealPasswords` não paga duas derivações, e uma extra igual a `password` nunca marca `kStaleSeal`, porque o índice da senha que abriu é o 0.

### D-08 — Selagem não muda (RF-02)

- **Escolha:** `sealSession` (`session.ts:300`) continua usando só `config.password`. Nenhuma alteração de código. O teste do RF-02 é de regressão.
- **Justificativa:** o contrato pede que `password` continue selando, e `extraUnsealPasswords` não entra em `seal`.

### D-09 — Expiração das sessões de senha extra (RF-08)

- **Escolha:** manter `maxAge` e `idleTimeout` onde estão hoje (`session.ts:349-365`), depois da escolha da senha. A reselagem de D-04 usa `sealSession`, que carimba `lastSeenAt` só quando há `idleTimeout` (`:293-298`). `createdAt` não é tocado.
- **Justificativa:** nenhuma senha tem tratamento de expiração diferente. A reselagem por senha extra não estende o `maxAge`, porque ele é contado de `createdAt`. Ela pode deslizar o `idleTimeout` como qualquer reselagem. O PRD diz que "senhas antigas não estendem a vida da sessão". Isso vale para o `maxAge` absoluto. O `idleTimeout` desliza só se a sessão ainda não expirou, e a verificação roda antes, então não há extensão indevida.

## 4. Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts:39-99` | `SessionConfig` | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (só abre, nunca sela; lista curta; remover após a rotação; cada item segue o mínimo de `password`). |
| `src/utils/session.ts:149-153` | início de `getSession` | Chamar `assertExtraUnsealPasswords(config)` antes de `getEventContext` e antes de `:173`. |
| `src/utils/session.ts:199-202` | `.then` de `getSession` | Ler e apagar `kStaleSeal` junto de `kLegacySeal`. |
| `src/utils/session.ts:214` | condição da reselagem | `(legacySeal \|\| staleSeal \|\| shouldSlide(session, config))`. |
| `src/utils/session.ts:312-348` | `unsealSession` | Iterar as candidatas (D-01, D-02, D-03); marcar `kStaleSeal` quando a vencedora não for a de índice 0. |
| `src/utils/session.ts` (fim do arquivo) | helpers internos | `unsealWith`, `candidatePasswords` e `assertExtraUnsealPasswords`, não exportados, como `shouldSlide` (`:414`) e `stageSessionErrCookies` (`:435`). O arquivo passa de 200 linhas e já está nesse estado; se ficar grande demais, mover para `src/utils/internal/session.ts`. |
| `src/utils/internal/session.ts:7-9` | símbolos | Adicionar `kStaleSeal` com `Symbol.for("h3.internal.session.stale-seal")`, no mesmo formato de `kLegacySeal`. Não exportar em `src/index.ts`. |
| `test/session.test.ts` | depois de `:186` | Novos testes (seção 6). |
| `docs/4.examples/handle-session.md:120-149` | seção "Options" | Documentar o campo e o procedimento de rotação (seção 7). |

Sem alteração: `src/index.ts`, `iron-crypto.ts`, `_deprecated.ts`, `src/types/context.ts` (o `password` de `:32` é do `basicAuth`, não da sessão).

## 5. Contratos e assinaturas

```ts
// src/utils/session.ts — única mudança pública
export interface SessionConfig {
  password: string; // sela e é a primeira a abrir
  /**
   * Previous passwords that only unseal sessions, tried in order after
   * `password`. Sessions opened by one of these are resealed with `password`.
   * Keep it short and remove an entry once its sessions have rotated out.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// Assinaturas públicas inalteradas
useSession(event, config): Promise<SessionManager<T>>;
getSession(event, config): Promise<Session<T>>;
updateSession(event, config, update?): Promise<Session<T>>;
sealSession(event, config): Promise<string>;
unsealSession(event, config, sealed): Promise<Partial<Session>>;

// src/utils/internal/session.ts
export const kStaleSeal: unique symbol;

// helpers privados em src/utils/session.ts
function candidatePasswords(config: SessionConfig): string[]; // [password, ...extras], sem repetidas
function assertExtraUnsealPasswords(config: SessionConfig): void; // lança Error sem o valor da senha
async function unsealWith(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // corpo atual de :324-348, com o retry legado
```

Algoritmo de `unsealSession`:

1. `assertExtraUnsealPasswords(config)`.
2. Calcular `sealOptions` como hoje (`:317-321`).
3. Para cada senha `p` de `candidatePasswords(config)`, com índice `i`:
   - tentar `unsealWith(p)`;
   - se der certo, `unsealed = r`; se `i > 0`, marcar `unsealed[kStaleSeal] = true`; sair do laço;
   - se falhar com `"Bad hmac value"` (o retry legado já aconteceu dentro de `unsealWith`), guardar o erro e continuar;
   - qualquer outro erro é relançado na hora (D-02).
4. Se nenhuma abrir, relançar o erro da primeira tentativa (a de `password`). Isso mantém a mensagem de hoje e não revela qual senha foi tentada por último (RF-05).
5. Aplicar `maxAge` e `idleTimeout` sobre `unsealed` (`:349-365`, inalterado).

Detalhe de `unsealWith`: se o retry legado de `p` falhar, o erro que sobe é o do retry (como hoje em `:340`). Ele também deve ser tratado como "senha não abriu" quando a mensagem for `"Bad hmac value"`, para o laço seguir para a próxima senha.

## 6. Estratégia de testes

Todos em `test/session.test.ts`, dentro do `describeMatrix` existente (roda em `web` e `node`, P5). Usam `seal`/`unseal` de `iron-crypto.ts` como os testes de legado. Senhas de teste com 32 ou mais caracteres. Configuração com `name: "h3-test"` e `generateId` determinístico.

Ordem do fluxo de correção (AGENTS.md): escrever os testes primeiro, confirmar que falham (a maioria falha por `extraUnsealPasswords` ser ignorado), implementar e rodar de novo.

| Teste | RF |
| --- | --- |
| Sessão selada com a senha antiga abre com `extraUnsealPasswords` e mantém `id`, `createdAt` e `data`, via cookie. | RF-03 |
| Mesma sessão vinda pelo header `x-h3-test-session`. | RF-03 |
| Sem extras, e com `[]`, a sessão selada com outra senha é descartada: nova sessão, status 200. | RF-04 |
| Sessão selada com senha fora da lista é descartada. | RF-05 |
| Sessão legada (1 iteração) sob senha extra: abre e é resselada; com `legacySealFallback: false` é rejeitada. | RF-06 |
| Cookie reselado após abrir por senha extra: `unseal` com `password` funciona e com a antiga falha. Uma requisição seguinte só com `password` abre a sessão. | RF-02, RF-07 |
| Contagem de `Set-Cookie` igual a 1 quando valem ao mesmo tempo legado, senha extra e `idleTimeout` (`shouldSlide`). | R4 |
| Com sessão de header aberta por senha extra, nenhum `Set-Cookie` é emitido. | R5 |
| `maxAge` vencido e `idleTimeout` vencido com senha extra: sessão descartada (usar `vi.useFakeTimers({ toFake: ["Date"] })` como em `:189-190`). | RF-08 |
| Extra vazia ou curta faz `useSession` e `getSession` rejeitarem antes de ler o cookie; a mensagem contém `extraUnsealPasswords` e não contém o valor da senha. Itens não string e valor não array também rejeitam. | RF-09, R1 |
| Cookie inválido (token malformado ou expirado) não tenta as senhas extras: espiar `crypto.subtle.deriveBits`, ou contar chamadas, e conferir que há uma tentativa só. | D-02 |
| `kStaleSeal` não aparece em `session` nem em `event.context.sessions` na resposta JSON. | D-04 |

Regressão: rodar `pnpm vitest run test/session.test.ts` e depois `pnpm test` (lint, typecheck e cobertura). Os testes existentes não deveriam precisar de ajuste, já que o comportamento sem extras é idêntico. Se algum precisar, ajustar sem perder o que ele verifica. Teste de tipo: adicionar em `test/unit/types.test-d.ts` uma asserção de que `extraUnsealPasswords` é `string[] | undefined` e `password` continua `string`. Conferir antes se esse arquivo já cobre `SessionConfig`.

## 7. Documentação

Em `docs/4.examples/handle-session.md`, na seção "Options" (`:120`), adicionar `extraUnsealPasswords` e uma nota de rotação:

1. Passar a senha nova para `password` e a antiga para `extraUnsealPasswords`.
2. Esperar o `maxAge` (ou `idleTimeout`) das sessões antigas passar.
3. Remover a senha antiga da lista.

A nota também avisa que as senhas antigas ficam válidas para forjar sessões enquanto estiverem listadas (R3), e que cada senha listada soma uma derivação PBKDF2 a cada cookie inválido (R2).

## 8. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| R1 do PRD: falha silenciosa por extra errada | Sessões derrubadas sem sinal | D-06 valida antes do `catch`; teste da mensagem. A validação só cobre formato e tamanho, não detecta senha que não corresponde a nenhuma sessão. |
| R2: amplificação de CPU por cookie inválido | Até `2 × (1 + N)` derivações por requisição | D-02 limita o custo a falhas de HMAC; D-07 deduplica; a doc pede lista curta. |
| R3: senha antiga ainda válida | Forja de sessão por quem a tiver | Documentação do procedimento de remoção; a remoção é de quem configura. |
| R4: dupla reselagem | `Set-Cookie` duplicado | Uma única condição em `session.ts:214` (D-04); `setCookie` já deduplica; teste de contagem. |
| R5: sessão por header | Continua aberta pela senha antiga | D-05; documentado. |
| Vazamento do símbolo interno em `unsealSession` público | Quem chama `unsealSession` direto recebe `kStaleSeal` no objeto, como já ocorre com `kLegacySeal` | Símbolo registrado com `Symbol.for` e não enumerável por `JSON`; `getSession` o remove. Comportamento equivalente ao atual. |
| Temporização: tempo de resposta revela qual posição da lista abriu o token | Informação sobre a idade da senha | Aceito. Só quem tem um token válido para aquela senha observa isso, e o PRD deixa fora de escopo logs e métricas. |
| `config.seal` com `minPasswordlength` maior ou menor que o padrão | Extra aceita na validação e rejeitada pelo iron, ou o contrário | D-06 usa o mesmo mínimo que `generateKey` aplicará (o maior entre encryption e integrity). |
| `session.ts` crescer além de 200 linhas (AGENTS.md) | Convenção de arquivos curtos | O arquivo já tem 465 linhas; helpers novos podem ir para `src/utils/internal/session.ts` se ficarem grandes. |

## 9. Fora de escopo (confirmado)

`password` como array, rotação automática, reselagem em massa, mudança no formato do token ou em `seal`, alterações em `legacySealFallback`, logs e métricas, `_deprecated.ts`.
