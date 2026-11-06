# Especificação técnica: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-09). Esta especificação não altera código; as citações abaixo foram conferidas nos arquivos atuais do clone.

## Visão geral

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Toda selagem usa `password`. Toda abertura tenta `password` e depois cada extra, em ordem, parando na primeira que abre. Uma sessão aberta por extra é re-selada com `password` no mesmo `Set-Cookie` de `getSession`, pelo mesmo mecanismo que já re-sela sessões legadas. Não há mudança de API pública além do campo novo.

Pontos de código afetados:

- `src/utils/session.ts`: tipo `SessionConfig`, `getSession`, `updateSession`, `sealSession`, `unsealSession` e um helper de resolução de opções de selo.
- `src/utils/internal/session.ts`: novo símbolo interno para marcar sessões abertas por extra.
- `src/utils/internal/iron-crypto.ts`: sem mudança. `unseal` já aceita uma senha string por chamada e já lança `"Bad hmac value"` quando a senha não confere.
- `src/index.ts`: sem mudança de exports.

---

## Decisões de arquitetura

### D-01 — Forma da configuração: campo `extraUnsealPasswords` em `SessionConfig`

**Escolha.** Campo opcional `extraUnsealPasswords?: string[]` ao lado de `password`, em `src/utils/session.ts:48`. `password` continua `string`. Ausente e `[]` são equivalentes (`config.extraUnsealPasswords ?? []`).

**Alternativas.**
- Aceitar array em `password` (variante a do issue). Rejeitada: o contrato escolheu a variante b e proíbe mudar o tipo de `password`.
- Mapa de ids do iron (`{ id, secret }` como `PasswordHash`, `iron-crypto.ts:427`). Rejeitada: exigiria gravar um id no token selado, mudando o formato de sessões já existentes, e o contrato não permite nomes públicos novos.

### D-02 — Algoritmo de abertura: tentativa sequencial por senha

**Escolha.** Uma função interna `unsealOne` faz o `unseal` com uma senha (incluindo o fallback legado daquela senha). Um laço percorre `[password, ...extraUnsealPasswords]`. Só `"Bad hmac value"` faz o laço seguir para a próxima senha. Qualquer outro erro (`"Expired seal"`, `"Incorrect number of sealed components"`, senha extra vazia ou curta, etc.) interrompe o laço e é relançado. Ao primeiro sucesso o laço para. Sem extras, o laço tem uma única iteração e lança o mesmo erro de hoje, então o comportamento é idêntico.

**Por que.** Atende RF-03 ("uma de cada vez", parar no primeiro que abre, nenhuma extra tentada quando `password` abre). Cada tentativa falha antes da decifragem, no HMAC, então o custo de uma tentativa errada é uma derivação PBKDF2 de 8192 iterações (`iron-crypto.ts:133`, `hmacWithPassword`). A decifragem (`iron-crypto.ts:147`) só acontece na tentativa que abre.

**Alternativas.**
- `Promise.any` sobre todas as senhas em paralelo. Rejeitada: multiplica o trabalho criptográfico em paralelo, viola "uma de cada vez" e não preserva "password primeiro sem tentar extras".
- Tentar todas as senhas normais e só depois todas as legadas. Custo equivalente, mais difícil de ler. Rejeitada em favor do fallback por senha (D-03).

### D-03 — Fallback legado por senha

**Escolha.** O fallback legado (`legacySealFallback`, `session.ts:326-347`) fica dentro de `unsealOne`, então vale para cada senha da lista antes de passar para a próxima. A condição de retry continua exatamente a mesma: `legacySealFallback !== false`, `integrity.iterations !== 1`, erro é `Error` com mensagem `"Bad hmac value"`.

**Efeito.** Uma sessão legada selada com a senha extra 2 é aberta na tentativa 2, com `kLegacySeal` marcado, e re-selada com `password` e as opções atuais (RF-08). Com `legacySealFallback: false`, a tentativa legada não ocorre e a sessão é tratada como inexistente.

### D-04 — Rotação progressiva: marcador interno e re-selagem em `getSession`

**Escolha.** Novo símbolo `kRotatedSeal` em `src/utils/internal/session.ts` (depois de `kLegacySeal`, linhas 7-9), no mesmo padrão de `kLegacySeal`. `unsealSession` marca o objeto retornado quando a sessão abriu com uma senha que não é a primeira. Em `getSession`, o marcador é removido antes de `Object.assign(session, unsealed)` (`session.ts:208`) e entra na condição de re-selagem (`session.ts:214`):

```ts
if (session.id && sessionFromCookie && (legacySeal || rotated || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

**Por que remover o marcador antes do `Object.assign`.** `Object.assign` copia símbolos enumeráveis próprios. O código atual já remove `kLegacySeal` pelo mesmo motivo (`session.ts:199-202`). Sem remover, o símbolo vazaria para a sessão em memória.

**Efeitos.**
- Sessão por cookie aberta por extra: re-selada e enviada em `Set-Cookie`, mesmo se o handler só lê (RF-05). `updateSession` já chama `stageSessionErrCookies` (`session.ts:273`), então respostas de erro também levam o cookie novo.
- Sessão por `password`: sem marcador, sem re-selagem por rotação (RF-05).
- Sessão por cabeçalho: `sessionFromCookie` é `false` (`session.ts:189-192`), então nunca é re-selada (RF-05).

**Alternativas.**
- Retornar `{ session, passwordIndex }` de `unsealSession`. Rejeitada: `unsealSession` é exportada (`src/index.ts:209`) e mudar o retorno quebra a API pública.
- Comparar a senha usada com `password` dentro de `getSession`. Rejeitada: `getSession` não sabe qual senha abriu.

### D-05 — Validação das senhas extras só nas operações que selam

**Escolha.** Helper interno `assertSealPasswords(config)` em `session.ts`. Ele valida cada item de `extraUnsealPasswords`: deve ser string não vazia, com `length >=` o mínimo efetivo. Como `generateKey` (`iron-crypto.ts:192`) aplica `minPasswordlength` de `encryption` e de `integrity`, o helper usa o maior dos dois valores (normalmente 32, padrão de `iron-crypto.ts:22` e `:28`). A mensagem cita o índice, nunca o valor:

`Invalid extra session password at extraUnsealPasswords[2]: must not be empty and must have at least 32 characters`

A mensagem contém "password" (RF-06) e não ecoa a senha.

Chamadas: no início de `sealSession` (`session.ts:282`) e no início de `updateSession` (`session.ts:241`), antes de `getSession`. Assim a validação ocorre mesmo sem sessão no pedido (RF-06). `useSession` (`session.ts:108`) rejeita de forma indireta, porque ao criar sessão nova chama `updateSession` (`session.ts:116-118`). Para uma sessão já existente lida por cookie, `useSession` não chama `updateSession`, então não valida; isso segue a redação "ao criar a sessão" do RF-06.

**Por que não validar na leitura.** Se `getSession` lançasse por configuração inválida, toda requisição com cookie viraria erro 500. Além disso, validar antes de tentar as extras impediria "password abre, nenhuma extra tentada" de ser observável: com uma extra inválida na lista, uma sessão aberta por `password` teria que falhar. A leitura não valida; a configuração inválida aparece como erro (a) na primeira operação de selagem, que é o caminho de login, e (b) como falha de abertura nas leituras (ver Riscos).

**Alternativas.**
- Validar também em `getSession` e `unsealSession`. Rejeitada pelos motivos acima.
- Validar `password` com o mesmo helper. Rejeitada: RF-06 exige que `password` continue como hoje.

### D-06 — Um único ponto de resolução das opções de selo

**Escolha.** Helper `resolveSealOptions(config: SessionConfig): SealOptions` que devolve `{ ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal }`. Hoje essa expressão aparece duas vezes (`session.ts:300-304` em `sealSession` e `session.ts:317-321` em `unsealSession`). Substituir as duas por uma chamada evita divergência entre selar e abrir. O resultado é idêntico ao atual.

### D-07 — `clearSession` não abre a sessão

**Escolha.** Sem mudança. `clearSession` (`session.ts:372-386`) não chama `unseal`; só apaga o cookie e o contexto. O requisito RF-07 ("clearSession abre sem erro") é satisfeito trivialmente. Ver "Pontos em aberto".

---

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (novo campo, após `password`, linha 48)
/**
 * Previous session passwords. Used only to open sessions, tried in order after
 * `password`, which alone seals. Sessions opened with one of these are resealed
 * with `password`. Each entry follows the same rules as `password`.
 */
extraUnsealPasswords?: string[];
```

```ts
// src/utils/internal/session.ts — novo símbolo
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.rotated-seal",
);
```

```ts
// src/utils/session.ts — helpers internos (não exportados)

/** Effective seal options, shared by seal and unseal. */
function resolveSealOptions(config: SessionConfig): SealOptions;

/** Throws if an extra password is empty or shorter than the minimum. Never includes the value. */
function assertSealPasswords(config: SessionConfig): void;

/** One unseal attempt with one password, including the per-password legacy fallback. */
function unsealOne(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<{ unsealed: Partial<Session>; legacy: boolean }>;
```

Assinaturas públicas que não mudam:

- `getSession<T>(event, config): Promise<Session<T>>`
- `useSession<T>(event, config): Promise<SessionManager<T>>`
- `updateSession<T>(event, config, update?): Promise<Session<T>>`: passa a lançar se as extras forem inválidas.
- `sealSession<T>(event, config): Promise<string>`: passa a lançar se as extras forem inválidas.
- `unsealSession(_event, config, sealed): Promise<Partial<Session>>`: mesma assinatura. Com extras, abre pela primeira senha que funcionar. Marca `kRotatedSeal` quando a senha que abriu não é `password`.
- `clearSession(event, config): Promise<void>`: sem mudança.

Esboço do `unsealSession` (pseudocódigo para guiar a implementação):

```ts
const sealOptions = resolveSealOptions(config);
const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
let attempt: { unsealed: Partial<Session>; legacy: boolean } | undefined;
let rotated = false;
let lastError: unknown;
for (const [index, password] of passwords.entries()) {
  try {
    attempt = await unsealOne(sealed, password, config, sealOptions);
    rotated = index > 0;
    break;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
    lastError = error;
  }
}
if (!attempt) throw lastError;
// marcar kLegacySeal / kRotatedSeal, depois as checagens de maxAge e idleTimeout (session.ts:350-365) sem mudança
```

Atenção: a validação de senhas extras não acontece nesse caminho (D-05). Uma extra inválida lança `"Password string too short"` ou `"Empty password"` dentro de `unseal`, que não é `"Bad hmac value"` e interrompe o laço.

Mudança em `getSession` (`session.ts:194-221`): remover `kRotatedSeal` do objeto antes de `Object.assign`, guardar em `const rotated`, e acrescentá-lo à condição de re-selagem (D-04).

---

## Arquivos a alterar

| Arquivo | Onde | Mudança |
|---|---|---|
| `src/utils/session.ts` | `:39-48` (`SessionConfig`) | Novo campo `extraUnsealPasswords?: string[]` com JSDoc. |
| `src/utils/session.ts` | `:108-118` (`useSession`) | Sem mudança de código. Rejeição de extras inválidas chega por `updateSession`. |
| `src/utils/session.ts` | `:194-221` (`getSession`, bloco de `unsealSession`) | Remover `kRotatedSeal` antes do `Object.assign` (`:208`); ler o marcador; ampliar a condição de re-selagem (`:214`). |
| `src/utils/session.ts` | `:241-245` (`updateSession`) | Chamar `assertSealPasswords(config)` no início. |
| `src/utils/session.ts` | `:282-304` (`sealSession`) | Chamar `assertSealPasswords(config)` no início; trocar `:300-304` por `resolveSealOptions(config)`. |
| `src/utils/session.ts` | `:312-367` (`unsealSession`) | Laço de senhas (D-02); `unsealOne` com fallback legado (D-03); `:317-321` trocados por `resolveSealOptions`; marcar `kRotatedSeal`. |
| `src/utils/session.ts` | fim do arquivo | Adicionar `resolveSealOptions`, `assertSealPasswords` e `unsealOne`. |
| `src/utils/internal/session.ts` | `:7-9` | Novo símbolo `kRotatedSeal` após `kLegacySeal`. |
| `test/session.test.ts` | fim da suíte `describeMatrix` | Novos casos (ver Estratégia de testes). Os testes existentes não mudam. |

Limite de linhas (AGENTS.md: "aim for < 200 LoC per file"): `session.ts` já tem 464 linhas. Esta mudança acrescenta cerca de 60 a 80. Vale considerar mover os helpers de validação e de abertura para `src/utils/internal/session-passwords.ts`, com a `unsealSession` e a `getSession` permanecendo em `session.ts`. Isso é opcional e não muda contratos.

---

## Estratégia de testes

Arquivo principal: `test/session.test.ts`, dentro de `describeMatrix`, rodando em web e node. Para criar sessões seladas com senhas antigas, usar `seal` de `src/utils/internal/iron-crypto.ts` com `sealDefaults`, como o teste de legado já faz (`test/session.test.ts:134-159`).

Casos, por requisito:

- **RF-01.** `extraUnsealPasswords: []` e campo ausente produzem o mesmo `Set-Cookie` e o mesmo payload em criação, leitura e atualização.
- **RF-02.** Com `password = A` e extra `B`, `sealSession` e `useSession` criam sessões que `unseal(…, A)` abre e `unseal(…, B)` rejeita.
- **RF-03.** Sessão selada com a extra da posição 2 é lida com `id`, `createdAt` e dados preservados. Com lista `[X, Y, Z]` em que Y abre a sessão e Z é inválida (curta), a leitura tem sucesso; isso prova que Z não é tentada. Com sessão selada por `password` e lista `[curta]`, a leitura tem sucesso e sem erro.
- **RF-04.** Sessão selada com senha desconhecida: `getSession` e `useSession` não lançam, a sessão está vazia, e não há dado da sessão original.
- **RF-05.** Cookie com sessão por extra: `useSession` sem escrita gera `Set-Cookie` cujo valor abre com `password` e não com a extra. Cookie com sessão por `password`: nenhum `Set-Cookie`. Sessão por cabeçalho `x-h3-session` com extra: nenhum `Set-Cookie`.
- **RF-06.**
  - `sealSession` e `updateSession` sem cookie no pedido, com extra de 10 caracteres na posição 3: rejeitam, a mensagem contém "password" e não contém o valor da senha.
  - `useSession` criando sessão nova com extra `""`: rejeita com "password".
  - `password` inválida continua provocando erro como hoje.
- **RF-07.**
  - Sessão com extra dividida em chunks (`cookie.chunkMaxLength` pequeno, ver `src/utils/cookie.ts:154` e `:188`): `getSession` e `useSession` leem corretamente.
  - `unsealSession` com sessão por extra: abre sem erro.
  - `clearSession` com sessão por extra: não lança e apaga o cookie.
  - Sessão por extra vinda do cabeçalho: abre.
- **RF-08.** Sessão legada (`iterations: 1`) selada com extra: aberta e re-selada com `password` e opções atuais. Mesma sessão com `legacySealFallback: false`: tratada como inexistente.
- **RF-09.** Suíte existente sem alterações passa. `test/unit/package.test.ts` (listas de exports) continua passando, porque nenhum export novo é criado.

Verificação geral, pelos comandos do `AGENTS.md`: `pnpm vitest run test/session.test.ts` durante o desenvolvimento, depois `pnpm test` (lint, typecheck e cobertura). O `AGENTS.md` diz que `pnpm lint` já inclui typecheck, então o `pnpm typecheck` citado no contrato é coberto por ele. Antes de implementar, rodar os casos novos e confirmar que falham (o fluxo de bug do `AGENTS.md` serve de modelo mesmo sendo uma funcionalidade).

---

## Riscos

1. **Custo criptográfico.** Cada extra tentada e falha custa uma derivação PBKDF2 de 8192 iterações. Uma sessão aberta pela última extra de uma lista de N custa N derivações de falha mais a de sucesso (2 derivações). Mitigação: lista curta; remover senhas antigas assim que possível (PRD, premissas e riscos).
2. **Re-selagem em leituras.** Handlers que só leem passam a emitir `Set-Cookie` para sessões por extra. Caches intermediários que ignoram `Set-Cookie` em respostas com sessão podem reter o cookie antigo. Mitigação: já assumido nas premissas do PRD; coberto por teste (RF-05).
3. **Configuração inválida silenciosa em leituras.** Uma extra inválida não é validada na leitura (D-05). Quando a sessão atual é aberta por `password`, nada muda. Quando a sessão só abre por uma extra posterior à inválida, o laço para na inválida, `getSession` engole o erro e a sessão aparece vazia (logout silencioso). Mitigação: o primeiro `useSession` que cria sessão ou qualquer `updateSession` falha com erro explícito; documentar no JSDoc. Essa é a principal troca de D-05.
4. **Validação mais cedo.** `updateSession` e `sealSession` agora falham sem sessão e sem cookie quando a configuração de extras é inválida. Fluxos que dependiam dessa tolerância passam a falhar (é o comportamento pedido em RF-06).
5. **Vazamento de senhas antigas.** Enquanto uma senha estiver na lista, sessões seladas com ela continuam válidas. Mitigação: orientação de remoção da lista, fora do escopo do h3.
6. **Exposição de segredos.** As mensagens de validação citam índice e tamanho mínimo, nunca o valor. Coberto por teste (RF-06).
7. **Pontos de contato com `getSession` reentrante.** `updateSession` dentro de `getSession` usa `context.sessions` já preenchido, como a re-selagem legada, então não há recursão. Vale confirmar com teste de chunks.
8. **Symbol vazando para a sessão em memória.** Se o `kRotatedSeal` não for removido antes do `Object.assign`, ele entra em `session` e pode ir para `data` ou para as sessões seguintes. Mitigação: remoção explícita e teste que compare `session` com `toEqual` sem símbolos extras.

---

## Pontos em aberto

- **`clearSession` (RF-07).** O contrato pede que `clearSession` abra sessões com extras, mas a função atual não abre sessão (`src/utils/session.ts:372-386`). Proposta: manter sem mudança e registrar que o requisito é satisfeito por não haver abertura. Confirmar com quem escreveu o contrato se a intenção era outra.
- **Validação na leitura (D-05).** Confirmar que "silencioso na leitura, erro na selagem" é aceitável, em vez de falhar alto em `getSession`.
- **Mínimo de tamanho.** O helper usa o maior `minPasswordlength` entre `encryption` e `integrity`. Os padrões são iguais (32), então a escolha só importa se alguém sobrescrever `seal`.
