# TechSpec — Várias senhas de unseal nas sessões (h3js/h3#1050)

- Data: 2026-11-06
- Origem: [`sdd/prd.md`](prd.md) (RF-01 a RF-12) e [`sdd/pedido.md`](pedido.md)
- Código afetado: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`
- Não afetado: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/package.test.ts` (sem export novo)

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. A leitura de sessão passa a tentar `password` e depois cada extra, na mesma ordem, e aceita a primeira que verificar o HMAC. Sessões abertas por extra, ou pelo fallback legado, são reseladas com `password` no cookie. A selagem continua usando só `password`. O token não muda.

## Estado atual do código (verificado)

- `SessionConfig.password` é `string` e é a única chave de abertura: `src/utils/session.ts:48`. `legacySealFallback` em `src/utils/session.ts:95`.
- `getSession` lê o selo do header (`src/utils/session.ts:178-187`) ou do cookie (`src/utils/session.ts:190-193`), e chama `unsealSession` dentro de `.catch(() => {})` (`src/utils/session.ts:196-198`). Um erro de unseal vira sessão nova (`src/utils/session.ts:225-229`).
- A resposta é resselada só quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`src/utils/session.ts:214-216`).
- O marcador de legado `kLegacySeal` é removido antes do `Object.assign` (`src/utils/session.ts:199-208`). Esse padrão é o que a nova marcação deve seguir.
- `unsealSession` tenta uma senha, e só faz o fallback legado (1 iteração) quando recebe `"Bad hmac value"` (`src/utils/session.ts:322-348`, condição em `src/utils/session.ts:332-339`). Depois checa `maxAge` (`src/utils/session.ts:349-355`) e `idleTimeout` (`src/utils/session.ts:356-365`).
- `sealSession` monta as opções de selo em `src/utils/session.ts:300-304`. `unsealSession` monta as mesmas em `src/utils/session.ts:317-321`. São duas cópias da mesma expressão.
- No iron, senha string recebe `id` vazio, e a abertura usa a chave `"default"`: `src/utils/internal/iron-crypto.ts:68` e `src/utils/internal/iron-crypto.ts:121`. Por isso o token atual não tem `passwordId` e não há como saber qual senha o selou sem tentar.
- A checagem de expiração do selo (`"Expired seal"`) acontece antes do HMAC: `src/utils/internal/iron-crypto.ts:110-118`, e o HMAC só é verificado em `src/utils/internal/iron-crypto.ts:133-137` (`"Bad hmac value"`).
- Senha com menos caracteres que `minPasswordlength` lança `"Password string too short ..."` dentro de `generateKey`: `src/utils/internal/iron-crypto.ts:192-196`. Esse erro não é `"Bad hmac value"`, então não avança para a próxima senha.
- Os mínimos estão em `src/utils/internal/iron-crypto.ts:22` (encryption) e `src/utils/internal/iron-crypto.ts:28` (integrity), ambos 32.
- `kLegacySeal` está em `src/utils/internal/session.ts:7-9`.
- `unsealSession` e `sealSession` são exportados publicamente: `src/index.ts:208-209`. Assinatura não muda.

---

## Decisões de arquitetura

### D-01 — Onde ficam as tentativas de senha

**Decisão:** o laço sobre `[config.password, ...config.extraUnsealPasswords]` fica dentro de `unsealSession` (`src/utils/session.ts:312`). `getSession` continua chamando `unsealSession` como hoje.

**Alternativas consideradas:**
1. Laço dentro de `getSession`. Duplicaria a lógica de `maxAge`/`idleTimeout` e do legado, e `unsealSession` (público, `src/index.ts:209`) continuaria só com `password`. Descartada.
2. Usar o `PasswordHash` do iron (`iron-crypto.ts:427`, objeto id → senha). Exigiria que o token carregue um `passwordId`, o que muda o formato do token e quebra as premissas P1 do PRD. Descartada.
3. Tentar todas as senhas em paralelo. Gasta CPU sem ganho, porque o caso comum é uma tentativa só. Descartada.

**Escolha:** laço sequencial dentro de `unsealSession`. Ele mantém a API pública, não muda o token e segue a ordem da RF-10.

### D-02 — Critério de avanço e parada

**Decisão:** para cada senha, a sequência é: unseal moderno; se falhar com `"Bad hmac value"` e o legado estiver ativo, unseal com 1 iteração. Só `"Bad hmac value"` (depois de esgotar o legado daquela senha) faz o laço ir para a próxima. Qualquer outro erro (`"Expired seal"`, `"Incorrect number of sealed components"`, `"Password string too short"`, etc.) é relançado na hora. Ao sucesso, o laço para. As checagens de `maxAge` e `idleTimeout` ficam **depois** do laço, sobre o resultado já aberto.

**Alternativas consideradas:**
1. Checar expiração dentro do laço, por senha. Expiração é propriedade da sessão, não da senha (RF-08). Descartada.
2. Tentar todas as senhas no modo moderno antes de qualquer legado. Quebra a ordem de RF-10. Descartada.
3. Avançar para qualquer erro. Faria `"Expired seal"` ser "contornado" pela próxima senha, o que RF-08 proíbe. Descartada.

**Escolha:** critério estrito, descrito acima. Se todas as senhas falharem com `"Bad hmac value"`, relança o último erro. Assim a RF-05 continua exatamente como hoje, porque `getSession` captura o erro.

### D-03 — Como `getSession` sabe que a sessão veio de uma extra

**Decisão:** novo símbolo interno `kSealedWithExtra` em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). `unsealSession` o marca no resultado quando a senha que abriu é uma extra. `getSession` o lê e o remove, **incondicionalmente**, antes do `Object.assign` (`src/utils/session.ts:208`). O reseal passa a incluir essa condição.

**Alternativas consideradas:**
1. Retornar `{ session, sealedWithExtra }` de `unsealSession`. Mudaria o tipo de retorno de uma função pública. Descartada.
2. Identificar a senha pelo token. Impossível, pois senha string não grava id (ver "Estado atual").
3. Comparar o resultado com uma segunda abertura usando só `password`. Custa uma derivação extra de 8192 iterações. Descartada.

**Escolha:** símbolo marcado, mesmo padrão de `kLegacySeal`. O símbolo não vaza para a sessão porque é removido antes da mesclagem.

### D-04 — Validação de tamanho das extras

**Decisão:** nova função interna `assertExtraUnsealPasswords(config)`, chamada como primeira instrução de `getSession` (antes de `src/utils/session.ts:155`, que cria a entrada em `context.sessions`). `useSession` chama `getSession` na primeira linha (`src/utils/session.ts:115`), então a validação cobre os dois. O mínimo é `Math.max(encryption.minPasswordlength, integrity.minPasswordlength)` das opções resolvidas (D-05). A mensagem cita o índice e **não** cita o valor da senha.

**Alternativas consideradas:**
1. Validar em `unsealSession`. Qualquer erro lá é engolido pelo `.catch(() => {})` de `src/utils/session.ts:197`, então a configuração errada ficaria silenciosa. Descartada.
2. Validar só em `useSession`. `getSession` é exportado e usado sozinho (`docs/2.utils/4.security.md`). Descartada.
3. Validar também `password`. Fora do escopo do PRD (R4 registra a inconsistência). Descartada.

**Escolha:** validação em `getSession`, sem custo quando `extraUnsealPasswords` é vazio ou ausente (retorno antecipado).

### D-05 — Helper para as opções de selo

**Decisão:** extrair `resolveSealOptions(config: SessionConfig): SealOptions` (função interna, no fim de `src/utils/session.ts`). Ela retorna `{ ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal }`. `sealSession` e `unsealSession` passam a usá-la, e a validação de D-04 também.

**Alternativas consideradas:**
1. Manter as cópias e adicionar uma terceira. Três lugares para manter a mesma regra de `ttl`. Descartada.

**Escolha:** extração. É uma mudança sem efeito de comportamento: as duas cópias atuais são idênticas (`src/utils/session.ts:300-304` e `src/utils/session.ts:317-321`).

### D-06 — Selagem continua só com `password`

**Decisão:** nenhuma mudança em `sealSession` além de usar `resolveSealOptions`. `seal(session, config.password, ...)` (`src/utils/session.ts:300`) permanece. Isso cobre RF-02, RF-06 e RF-10 (o reseal de sessão aberta por extra usa `updateSession` → `sealSession`, `src/utils/session.ts:267`).

**Alternativas consideradas:**
1. Selar com a primeira extra ou com um id. Quebra RF-02 e exige mudança de token. Descartada.

### D-07 — Forma do campo público

**Decisão:** `extraUnsealPasswords?: string[]` logo depois de `password` (`src/utils/session.ts:48`). TSDoc em inglês, como o resto de `SessionConfig` (`src/utils/session.ts:40-47`, `src/utils/session.ts:49-54`), dizendo que são senhas anteriores usadas só para abrir sessões, que a selagem usa `password`, e que cada item precisa do tamanho mínimo.

**Alternativas consideradas:**
1. `password: string | string[]` (segunda alternativa da issue). Fora do escopo do PRD. Descartada.

### D-08 — Documentação

**Decisão:** sem alteração em `docs/`. As páginas `docs/2.utils/4.security.md` são geradas pelo automd a partir de funções, não de campos de `SessionConfig`. O guia `docs/4.examples/handle-session.md:143` lista as opções em prosa. O PRD diz que basta o TSDoc. Opcionalmente, uma frase nova nesse parágrafo pode ser incluída em outro PR.

---

## Contratos e assinaturas

### `src/utils/session.ts` — campo público

```ts
export interface SessionConfig {
  /** ...existente... */
  password: string;
  /**
   * Previous passwords, used only to open sessions sealed with them. `password`
   * is still the only one used to seal. Each entry must be at least as long as
   * the seal's minimum password length (32 characters by default).
   */
  extraUnsealPasswords?: string[];
  // ...restante inalterado
}
```

### `src/utils/internal/session.ts` — novo símbolo

```ts
export const kSealedWithExtra: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.sealed-with-extra",
);
```

### `src/utils/session.ts` — funções internas (não exportadas)

```ts
/** Options passed to iron, shared by sealing and unsealing. */
function resolveSealOptions(config: SessionConfig): SealOptions;

/** Throws if an extra password is shorter than the seal minimum. */
function assertExtraUnsealPasswords(config: SessionConfig): void;

/** One unseal attempt with `password`, including the legacy 1-iteration fallback. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  config: SessionConfig,
): Promise<Partial<Session>>;
```

`unsealWithPassword` é o corpo atual do `try/catch` de `src/utils/session.ts:323-348`, com `password` no lugar de `config.password` (linhas 324, 340). A condição de fallback é a mesma (`src/utils/session.ts:332-339`).

### `src/utils/session.ts` — `unsealSession` (assinatura inalterada)

Esboço da nova lógica. A parte de expiração não muda de comportamento.

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = resolveSealOptions(config);
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let unsealed: Partial<Session> | undefined;
  for (const [index, password] of passwords.entries()) {
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, config);
    } catch (error) {
      // Only a wrong password moves on to the next one
      const wrongPassword = error instanceof Error && error.message === "Bad hmac value";
      if (wrongPassword && index < passwords.length - 1) {
        continue;
      }
      throw error;
    }
    if (index > 0) {
      (unsealed as any)[kSealedWithExtra] = true;
    }
    break;
  }
  // ...maxAge e idleTimeout inalterados, sobre `unsealed`
  return unsealed!;
}
```

Atenção: `unsealed` pode ser `null` quando o JSON decifrado é falsy (`iron-crypto.ts:149`). Isso já acontece hoje e não muda. Não introduza uma checagem nova aqui.

### `src/utils/session.ts` — `getSession`

Ordem das mudanças dentro do fluxo atual:

1. Primeira linha: `assertExtraUnsealPasswords(config);`.
2. Em `src/utils/session.ts:199-202`, após tratar `kLegacySeal`, tratar `kSealedWithExtra` da mesma forma (ler e apagar). Apagar mesmo quando a sessão veio do header.
3. Em `src/utils/session.ts:214`, a condição passa a ser:

```ts
if (
  session.id &&
  sessionFromCookie &&
  (legacySeal || sealedWithExtra || shouldSlide(session, config))
) {
  await updateSession(event, config);
}
```

Atualizar o comentário de `src/utils/session.ts:211-213` para dizer que também se reselam sessões abertas por senha extra.

### Não muda

- `sealSession`, `updateSession`, `useSession`, `clearSession` e as funções de expiração (`sessionExpires`, `shouldSlide`).
- `src/utils/internal/iron-crypto.ts` inteiro.
- `src/index.ts` (sem export novo, RF-12).
- Formato do token.

---

## Fluxo de leitura resultante

| Caso | Tentativas | Resultado |
|---|---|---|
| Cookie com `password` | P moderno | Igual a hoje |
| Cookie com `A` (extra) | P moderno ("Bad hmac value") → A moderno | Sessão retornada, marcador, reseal com P |
| Cookie legado com `A` | P moderno → P legado → A moderno (falha) → A legado | Sessão retornada, reseal com P e seal atual |
| Cookie com `X` (nenhuma) | P → A... todas "Bad hmac value" | Erro relançado, `getSession` cria sessão nova (RF-05) |
| Selo expirado por `ttl` com `A` | P → "Expired seal" | Relança já na primeira, sem tentar A (RF-08) |
| Sessão com `maxAge` vencido, aberta por A | A moderno → sucesso → checagem de maxAge | "Session expired!", sessão nova (RF-08) |
| Header com selo de `A` | P → A | Sessão retornada, sem reseal (RF-07) |

---

## Arquivos a alterar

| Arquivo | Mudança | Referências |
|---|---|---|
| `src/utils/session.ts` | Campo em `SessionConfig`; `assertExtraUnsealPasswords` no início de `getSession`; marcador e condição de reseal; laço em `unsealSession`; `unsealWithPassword`; `resolveSealOptions` usado em `sealSession` e `unsealSession` | `:39-54`, `:155`, `:199-216`, `:300-304`, `:312-348`, `:317-321` |
| `src/utils/internal/session.ts` | Novo `kSealedWithExtra` | `:7-9` (padrão de `kLegacySeal`) |
| `test/session.test.ts` | Novos testes dentro de `describeMatrix` (ver estratégia) | `:21-25` (config base), `:134-186` (padrão de legado), `:188-229` (padrão de fake timers) |
| `docs/...` | Nenhuma | D-08 |

Nenhum outro arquivo do projeto muda.

---

## Estratégia de testes

Seguir AGENTS.md: testes dentro de `describeMatrix` (web e node). Escrever primeiro os testes que devem falhar (RF-02 a RF-10), rodar e confirmar que falham pelo motivo certo (hoje, abrir com extra cai em sessão nova), depois implementar.

Testes novos, em `test/session.test.ts`, dentro do bloco principal (antes de `describe("lazy creation")`, linha 692). Usar `seal` e `sealDefaults` já importados (`test/session.test.ts:12`). Para cookies de senha A, usar `seal({ id, createdAt, data }, A, sealDefaults)`. Para o legado, usar a mesma forma de `test/session.test.ts:134-146`.

| Teste | RF | Verificação |
|---|---|---|
| `extraUnsealPasswords: []` e ausente geram cookie do mesmo formato | RF-01 | Mesmo número de partes (8), prefixo `Fe26.2`, `passwordId` vazio, e ambos abrem com `{ password }`. **Não** comparar bytes: `iron` usa salt e IV aleatórios (`iron-crypto.ts:201`, `:223`), então o cookie nunca é idêntico byte a byte. |
| Sessão criada com `{P, [A]}` abre com `{P}` sozinho | RF-02 | `unseal(cookie, P, sealDefaults)` retorna o mesmo `id` e `data`. |
| Cookie com `A` lido com `{P, [A]}` | RF-03 | `id` e `data` originais. |
| Cookie com `B` lido com `{P, [A, B]}` | RF-04 | `id` e `data` originais. |
| Cookie com `X` lido com `{P, [A]}` | RF-05 | Sem erro; `data` vazio; `id` novo. |
| Sessão aberta por A: `Set-Cookie` abre com `{P}` | RF-06 | `unseal(setCookie, P, sealDefaults)` tem o mesmo `id` e `createdAt`. |
| Header com selo de A: sem `Set-Cookie` | RF-07 | `res.headers.getSetCookie()` vazio; `data` retornado. |
| Selo de A com `maxAge` vencido | RF-08 | Fake timers como em `test/session.test.ts:188-229` (`toFake: ["Date"]`). `data` vazio; `id` novo. |
| Extra com 31 caracteres | RF-09 | Rota chama `useSession` sem cookie. Erro na mensagem com `extraUnsealPasswords[0]`; sem `Set-Cookie`. Ver tratamento de erro abaixo. |
| Cookie legado com `A`, lido com `{P, [A]}` | RF-10 | `data` e `id` originais; `Set-Cookie` abre com `{P}` no seal atual (`sealDefaults`). |
| Legado com `A` e `legacySealFallback: false` | RF-10 (borda) | Sem sessão original; mesma regra de hoje. |
| Selo com `ttl` vencido, cookie de `A` | D-02 | Sessão nova, sem tentar a próxima senha. Pode ser verificado com um `seal` com `ttl` curto e tempo avançado. |
| Símbolo `kSealedWithExtra` não vaza para a sessão | D-03 | `Reflect.ownKeys(session)` do `getSession` não contém símbolo com essa descrição. |
| Sessão de extra conta `createdAt` e `id` após o reseal | RF-06 | Já coberto acima; manter na mesma asserção. |

**Tratamento de erro no teste de RF-09.** Um erro lançado por handler vira `unhandled` e faz o `afterEach` de `test/_setup.ts:145-156` falhar. Antes de escrever o teste, ver como `test/errors.test.ts:114-115` trata erro esperado e como `opts.allowUnhandledErrors` é usado em `test/_setup.ts:146`. Ou consumir `t.errors` na própria asserção.

**Regressão de API.** `test/unit/package.test.ts` (snapshot de exports, linhas 125 e 149) deve continuar passando sem alteração.

**Comandos de verificação:**

```bash
pnpm vitest run test/session.test.ts      # RF-01 a RF-11, web e node
pnpm vitest run test/unit/package.test.ts # sem export novo
pnpm lint                                  # oxlint + oxfmt --check
pnpm typecheck                             # tsc --noEmit
pnpm test                                  # suíte completa com cobertura
```

Critério para aceitar: todos os comandos passam, e os testes do PRD aparecem em web e node.

---

## Riscos

**R1 — Custo de CPU (correção ao PRD).** O PRD fala em `(1 + extras) × 2` derivações. O código faz o seguinte para cada senha que não abre: uma derivação de 8192 iterações do HMAC (`iron-crypto.ts:133` chama `hmacWithPassword` → `generateKey`, `iron-crypto.ts:206`), que falha antes da decifragem; e, com o legado ativo, uma derivação de 1 iteração. Ou seja, um cookie que não abre custa cerca de `(1 + extras)` derivações caras, mais uma barata por senha. O risco de amplificação é o mesmo descrito no PRD. Mitigação: documentar o custo; limite de extras fica para decisão posterior (PRD, fora de escopo).

**R2 — Senha vazada continua aceita** enquanto estiver na lista (PRD R2). Sem mudança técnica.

**R3 — Sessões por header não migram** (PRD R3, RF-07). Elas expiram pelo seal original.

**R4 — Erro silencioso para `password`.** Senha curta em `password` continua falhando só na escrita (via `generateKey`), e a leitura cai em sessão nova (`src/utils/session.ts:197`). Só as extras são validadas (D-04). Registrado no PRD R4.

**R5 — O marcador vazar para a sessão.** Se `kSealedWithExtra` não for removido antes de `Object.assign` (`src/utils/session.ts:208`), ele entra no objeto de sessão e pode ser copiado para `updateSession`. O passo 2 de `getSession` cobre isso, e o teste do símbolo (acima) trava o comportamento.

**R6 — Marcador visível em `unsealSession` público.** Quem chama `unsealSession` direto recebe o símbolo no objeto, como já acontece com `kLegacySeal`. Não é um dado sensível e segue o precedente.

**R7 — Extra igual a `password`.** Não quebra nada, mas gasta uma derivação a mais em cada cookie que não abre. Não será deduplicado nesta entrega.

**R8 — Ambiguidade de RF-01.** "Cookie idêntico" no PRD não pode ser byte a byte, porque `iron` gera salt e IV aleatórios a cada selagem (`iron-crypto.ts:201`, `:223`). Interpretado aqui como mesmo formato e mesmas chaves de abertura, que é o que o teste de RF-01 verifica.

**R9 — Erro de `password` inválido não validado em `unsealSession`.** Se alguém chamar `unsealSession` direto com extra curta, o erro de tamanho vem do `generateKey` ("Password string too short") e não é "Bad hmac value", então é relançado sem tentar outras senhas. Comportamento aceitável: a validação pública fica em `getSession`.

**R10 — Concorrência.** `getSession` já guarda o `kGetSession` em `src/utils/session.ts:219`. O reseal por extra acontece dentro dessa promise, então requisições concorrentes não geram dois resealos. Sem mudança.

---

## Fora desta especificação

- Aceitar `password` como array (segunda alternativa da issue).
- Limite de quantidade de extras.
- Remoção do `legacySealFallback` (v3).
- Qualquer mudança em `sessionHeader` além de não reselar.
