# Especificação técnica — `extraUnsealPasswords` nas sessões

- Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-13), issue h3js/h3#1050
- Escopo de código: `src/utils/session.ts`, `src/utils/internal/session.ts`, novo `src/utils/internal/session-unseal.ts`, `test/session.test.ts`, `docs/2.utils/4.security.md`
- Sem mudança: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/package.test.ts`

## Visão geral

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `password` continua sendo a única senha de selagem. Na leitura, `password` é tentada primeiro e cada senha extra depois, só quando a anterior falha com `Bad hmac value`. Uma sessão de cookie aberta por senha extra é resselada com `password` na mesma leitura. Sem a opção, o comportamento não muda.

Nota de idioma: o código, o JSDoc, os nomes de teste e a doc de `docs/` ficam em inglês, como o restante do repositório. Esta especificação fica em português.

---

## Decisões de arquitetura

### D-01 — Nome público e forma do campo

Adicionar `extraUnsealPasswords?: string[]` a `SessionConfig`, logo após `password`, e nenhum outro símbolo público.

- **Alternativa A (escolhida):** campo opcional `string[]` ao lado de `password`, como o contrato pede.
- **Alternativa B:** `password: string | string[]` (segunda alternativa da issue). Rejeitada: é fora de escopo (PRD, "Fora de escopo") e altera o tipo de um campo existente, o que quebra a retrocompatibilidade de tipos.
- **Alternativa C:** nome novo como `unsealPasswords` ou `previousPasswords`. Rejeitada: o pedido fixa `extraUnsealPasswords`.

`string[]` segue o contrato. `readonly string[]` aceitaria mais entradas sem quebrar ninguém, mas não foi pedido.

### D-02 — Ordem de tentativa e critério de repetição

A tentativa é um laço sobre `[password, ...extraUnsealPasswords]`, em ordem. Só há nova tentativa quando o erro é exatamente `Bad hmac value`. Qualquer outro erro encerra o laço e é relançado. Se todas as senhas falharem, relança o erro da última tentativa.

Justificativa: `unseal` verifica a expiração do selo (`iron-crypto.ts:110-118`) e o formato antes do HMAC. Erros como `Expired seal` ou `Wrong mac prefix` não dependem da senha, então repeti-los só gasta derivações PBKDF2. Erros como `Password string too short` também não devem ser repetidos.

- **Alternativa A (escolhida):** laço sequencial, repetir só em `Bad hmac value`.
- **Alternativa B:** repetir em qualquer erro. Rejeitada: gasta derivações à toa e mascara erros de configuração.
- **Alternativa C:** tentar todas as senhas em paralelo. Rejeitada: custa CPU em toda leitura e não reduz a latência de forma útil.

Com `extraUnsealPasswords` ausente ou `[]`, o laço tem uma única tentativa e o erro final é o mesmo de hoje (RF-10).

### D-03 — Fallback legado aplicado a cada candidata (RF-09)

Para cada senha candidata, na ordem: (1) `unseal` com as opções atuais; (2) se falhar com `Bad hmac value`, e o fallback estiver ativo e `integrity.iterations !== 1`, `unseal` com 1 iteração. Só depois passa à próxima candidata. Uma falha de HMAC no fallback também conta como falha da candidata e segue para a próxima.

O código atual já faz isso para uma senha (`session.ts:332-344`). A mudança é só repetir o mesmo passo por candidata. `legacySealFallback: false` desliga o passo 2 para todas.

### D-04 — Onde fica a lógica nova

Lógica nova em `src/utils/internal/session-unseal.ts` (arquivo novo), e `unsealSession` em `src/utils/session.ts` continua exportada com a mesma assinatura e as mesmas checagens de `maxAge`/`idleTimeout`.

- **Alternativa A (escolhida):** helpers internos em arquivo próprio.
- **Alternativa B:** inserir tudo em `session.ts`. Rejeitada: o arquivo já tem 464 linhas (AGENTS.md pede < 200); colocar mais código nele piora o problema. Reduzir `session.ts` abaixo de 200 linhas é uma refatoração separada e fora deste escopo.

A convenção de `internal/` (AGENTS.md, "Internal helpers") é respeitada: nada desse arquivo é exportado por `src/index.ts`.

### D-05 — Como `getSession` sabe que a sessão foi aberta por senha extra

Usar um símbolo interno novo, `kExtraPasswordSeal`, no mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). `unsealSession` marca o objeto devolvido; `getSession` lê a marca, a remove antes do `Object.assign` e usa o resultado para decidir a releitura (D-08).

- **Alternativa A (escolhida):** símbolo interno, mesmo padrão já usado.
- **Alternativa B:** mudar o tipo de retorno de `unsealSession` para uma tupla ou objeto `{ session, fromExtra }`. Rejeitada: `unsealSession` é API pública (`src/index.ts:209`, `test/unit/package.test.ts:149`), e mudar o retorno quebra quem a usa.
- **Alternativa C:** descobrir a senha pelo `passwordId` do selo. Rejeitada: `seal` com string não grava id (P-02 do PRD; `iron-crypto.ts:68-71`), então a informação não existe no selo.

A marca precisa ser removida antes de `Object.assign(session, unsealed)` (`session.ts:208`). Esse `Object.assign` copia símbolos próprios e enumeráveis, então uma marca não removida entraria na sessão. `JSON.stringify` não serializa símbolos, então não vaza para o cookie.

### D-06 — Validação de `extraUnsealPasswords` antes de qualquer leitura (RF-08)

`getSession` chama `assertExtraUnsealPasswords(config)` como primeira instrução, antes de consultar o contexto e antes de ler cabeçalho ou cookie. Essa função lança `Error` com a mensagem de `generateKey` quando uma senha extra é menor que o mínimo.

O mínimo usado é `Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)`. **Isto é um desvio do PRD**, que fala só em `seal.encryption.minPasswordlength`. Motivo: `unseal` checa o HMAC com `integrity.minPasswordlength` (`iron-crypto.ts:133`, `:192`). Se `integrity` exigir mais caracteres que `encryption`, uma extra aprovada só por `encryption` falharia dentro do `unseal` e o `.catch` de `getSession` engoliria o erro, que é o problema R-02 do PRD. Com os padrões (32 e 32) o resultado é o mesmo.

- **Alternativa A (escolhida):** validar no início de `getSession`, com o máximo dos dois mínimos.
- **Alternativa B:** validar só dentro do laço. Rejeitada: não roda sem cookie (viola RF-08) e roda só se a primária falhar; além disso o `.catch` engole o erro.
- **Alternativa C:** validar só em `useSession`. Rejeitada: `getSession` é público e também lê sessões.

Vazia (`""`) cai no mesmo caminho porque `"".length < min` para qualquer `min >= 1`. Com `minPasswordlength: 0` configurado, `""` passa a validação e `generateKey` lança `Empty password`, que o `.catch` engole. É um caso de configuração absurda e fica registrado em R-07.

### D-07 — Selagem não muda (RF-07)

`sealSession` (`session.ts:300-304`) e `updateSession` (`session.ts:241-277`) continuam usando `config.password`. Nenhuma linha dessas funções muda. RF-07 se cumpre por não tocar nelas, e os testes de RF-07 verificam o resultado.

### D-08 — Releitura de cookie aberto por senha extra (RF-06)

Em `getSession`, a condição de releitura (`session.ts:214`) ganha um terceiro termo:

```
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config)))
```

Isso reaproveita o caminho já existente (`updateSession(event, config)`), que sela com `config.password`. Sessões de cabeçalho não são resseladas porque não há cookie para gravar (`sessionFromCookie`).

- **Alternativa A (escolhida):** reaproveitar a releitura existente, com um termo a mais.
- **Alternativa B:** não migrar. Descartada aqui porque a rotação não termina sem migração. Se o produto preferir não migrar, RF-06 sai e a doc (RF-12) muda (P-05 do PRD). Deixo isso como pendência para quem decide o produto.

### D-09 — Documentação

- O bloco entre `<!-- automd:jsdocs src="../../src/utils/session.ts" -->` e `<!-- /automd -->` (`docs/2.utils/4.security.md:44-74`) é regenerado por `pnpm fmt` a partir do JSDoc. Então o JSDoc de `extraUnsealPasswords` vai para lá sozinho, e o procedimento de rotação **não pode** ficar dentro desse bloco, porque seria apagado.
- O procedimento de rotação e o aviso sobre sessões de cabeçalho vão como prosa em inglês, depois de `<!-- /automd -->` (linha 74) e antes de `## Fingerprint` (linha 76).

---

## Arquivos a alterar

### 1. `src/utils/session.ts`

- **:48** — inserir o campo `extraUnsealPasswords` logo após `password`, antes de `maxAge` (:49). JSDoc em inglês (ver contratos).
- **:149-153** — `getSession`: inserir `assertExtraUnsealPasswords(config);` entre `:153` (`sessionName`) e `:155` (contexto). Como fica antes do `context.sessions` ser preenchido, uma configuração inválida não deixa sessão parcial no contexto.
- **:196-198** — o `.catch(() => {})` continua. Ele já engole falhas de leitura, e a validação de D-06 garante que configuração inválida não chegue até aqui.
- **:199-201** — além de `kLegacySeal`, ler e remover `kExtraPasswordSeal` do objeto desembrulhado antes de `:208`:
  ```ts
  const extraSeal = unsealed && (unsealed as any)[kExtraPasswordSeal];
  if (extraSeal) {
    delete (unsealed as any)[kExtraPasswordSeal];
  }
  ```
- **:214** — adicionar `extraSeal` à condição de releitura (D-08).
- **:282-307** — `sealSession`: sem alteração (D-07).
- **:312-348** — `unsealSession`: substituir a declaração `let unsealed` (:322) e o bloco `try/catch` (:323-348) por uma chamada ao helper de `session-unseal.ts`, mantendo a mesma ordem de argumentos e marcando o retorno:
  ```ts
  const attempt = await unsealWithPasswords(
    sealed,
    config.password,
    config.extraUnsealPasswords ?? [],
    sealOptions,
    config.legacySealFallback !== false,
  );
  const unsealed = attempt.unsealed as Partial<Session>;
  if (attempt.legacy && unsealed) {
    (unsealed as any)[kLegacySeal] = true;
  }
  if (attempt.fromExtra && unsealed) {
    (unsealed as any)[kExtraPasswordSeal] = true;
  }
  ```
  As checagens de `maxAge` (:350-355) e `idleTimeout` (:359-365) não mudam e continuam sobre `unsealed`.
- **:317-321** — `sealOptions` continua sendo montado aqui, como hoje.
- Imports: adicionar `kExtraPasswordSeal` à importação de `./internal/session.ts` (:5) e `unsealWithPasswords`, `assertExtraUnsealPasswords` de `./internal/session-unseal.ts`. Os imports têm extensão `.ts`.

### 2. `src/utils/internal/session.ts`

- **:7-9** — após `kLegacySeal`, adicionar:
  ```ts
  export const kExtraPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for(
    "h3.internal.session.extra-password-seal",
  );
  ```

### 3. `src/utils/internal/session-unseal.ts` (novo)

Helpers internos. Nada aqui é exportado por `src/index.ts`. Ver contratos.

### 4. `test/session.test.ts`

- Novo bloco `describe("extraUnsealPasswords", ...)` dentro do `describeMatrix` (:15), após o bloco `describe("lazy creation")` (começa em :692). Usa `it`/`expect` do callback, como o resto do arquivo.
- Imports: `seal` e `defaults as sealDefaults` já existem (:12). Não há import novo além de `vi` (já importado, :2).

### 5. `docs/2.utils/4.security.md`

- Prosa nova entre `<!-- /automd -->` (:74) e `## Fingerprint` (:76). Ver contratos (texto a seguir o esqueleto abaixo).

### Sem alteração

- `src/utils/internal/iron-crypto.ts`: `seal`/`unseal` e `generateKey` (:87-196) são usados como estão.
- `src/index.ts:208-212`: nenhum export novo.
- `test/unit/package.test.ts:125-149`: a lista de exports não muda.

---

## Contratos e assinaturas

### `SessionConfig` (`src/utils/session.ts`)

```ts
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that are only accepted to open sessions sealed before a
   * rotation. Sessions are always sealed with `password`. The list is tried in
   * order after `password` fails integrity verification. Each entry must be at
   * least as long as `password`'s minimum. Remove entries once their sessions
   * have migrated: every extra password costs a PBKDF2 derivation on each read
   * that no earlier password matches.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}
```

### `src/utils/internal/session-unseal.ts` (novo)

```ts
import type { SealOptions } from "./iron-crypto.ts";
import type { SessionConfig } from "../session.ts";

export interface UnsealAttempt {
  /** Payload as returned by `unseal`, before expiration checks. */
  unsealed: unknown;
  /** Opened with the legacy 1-iteration fallback. */
  legacy: boolean;
  /** Opened with a password from `extraUnsealPasswords`. */
  fromExtra: boolean;
}

/**
 * Throws `Error` ("Password string too short ...") if an extra password is
 * shorter than the minimum that `unseal` enforces. Runs before any read.
 */
export function assertExtraUnsealPasswords(config: SessionConfig): void;

/**
 * Tries `primary`, then each of `extra`, in order. Each candidate gets the
 * current options and then the legacy 1-iteration fallback (if enabled and
 * `integrity.iterations !== 1`). Only `Bad hmac value` moves to the next
 * candidate; any other error is rethrown. If every candidate fails, rethrows
 * the last error.
 */
export function unsealWithPasswords(
  sealed: string,
  primary: string,
  extra: readonly string[],
  sealOptions: SealOptions,
  legacySealFallback: boolean,
): Promise<UnsealAttempt>;
```

Esqueleto de `unsealWithPasswords` (para orientar a implementação; não é o código final):

```ts
const candidates = [primary, ...extra];
let lastError: unknown;
for (const [index, password] of candidates.entries()) {
  try {
    const { unsealed, legacy } = await unsealOne(sealed, password, sealOptions, legacySealFallback);
    return { unsealed, legacy, fromExtra: index > 0 };
  } catch (error) {
    if (!isBadHmac(error)) throw error;
    lastError = error;
  }
}
throw lastError;
```

`unsealOne` faz `unseal` com `sealOptions`; se falhar com `Bad hmac value` e o fallback estiver ativo (e `sealOptions.integrity.iterations !== 1`), refaz com `encryption.iterations` e `integrity.iterations` iguais a 1, como hoje (`session.ts:340-344`). `isBadHmac(error)` é `error instanceof Error && error.message === "Bad hmac value"`.

`assertExtraUnsealPasswords` calcula `sealOptions` como `unsealSession` (`{ ...sealDefaults, ttl: 0, ...config.seal }`). Como só o mínimo importa, `ttl` não entra no cálculo. Mínimo = `Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)`. Para cada extra com `length < min`, lança `new Error(\`Password string too short (min ${min} characters required)\`)`. A mensagem tem de conter `too short`.

### `getSession` (`src/utils/session.ts`)

Mudanças listadas em "Arquivos a alterar", item 1. A assinatura pública não muda.

### `unsealSession` (`src/utils/session.ts`)

Assinatura inalterada: `(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>`. Passa a aceitar as senhas extras. Objetos devolvidos podem trazer os símbolos `kLegacySeal` e `kExtraPasswordSeal`, que não aparecem em JSON.

### Texto da doc (prosa em inglês, fora do bloco automd)

Esqueleto (o texto final pode ser ajustado, mas deve cobrir os quatro pontos abaixo):

```md
### Rotating the seal password

Set the new secret as `password` and move the previous one to `extraUnsealPasswords`. Sessions sealed with the old password keep working. Sessions are always sealed with `password`. Cookie sessions are resealed with the new password on their next read, so they migrate by themselves. Sessions read from the session header are not migrated (there is no cookie to rewrite): they keep working while the old password is listed, and expire normally. Once the migration window has passed, remove the old password from the list.
```

Procedimento de rotação (incluir): (1) nova senha vira `password`, antiga vai para `extraUnsealPasswords`; (2) esperar o período em que as sessões de cookie são lidas; (3) remover a antiga.

---

## Estratégia de testes

Todos os casos novos vão para `test/session.test.ts`, dentro de `describeMatrix`, portanto rodam em `web` e `node`. Títulos em inglês.

Base: `sessionConfig` (`:21-25`) tem `password` de 49 caracteres. Senhas extras de teste têm 32 ou mais caracteres. Para criar sessões com uma senha antiga, usar `seal()` diretamente, como o teste de legado (`:134-143`), ou criar a sessão com uma configuração que tenha a senha antiga e `updateSession` (rota de teste em `t.app`, como em `:54`).

| Requisito | Título sugerido | Como verificar |
|---|---|---|
| RF-02 | `opens with password without trying extras` | Espiar `crypto.subtle.deriveBits` (padrão de `:723-733`). Leitura com a senha atual: exatamente 2 chamadas. |
| RF-02 | `tries extras in order and stops at the first match` | Sessão selada com a 2ª extra: contar derivações. Deve ser 1 falha (ou 2 com fallback legado ligado, ver nota) + 2 de sucesso. Validar a contagem rodando o teste, não assumir. |
| RF-03 | `opens session sealed with an extra password (cookie and header)` | Cookie e header `x-h3-test-session` (nome derivado de `name: "h3-test"`). `id` e `data` iguais. |
| RF-04 | `ignores session sealed with an unlisted password` | Selo com "C…": `data` vazio, `id` novo, não rejeita. |
| RF-05 | `rejects expired session opened by an extra password` | `seal()` com `createdAt` há 120 s e `maxAge: 60`, senha extra. `data` vazio, `id` novo. |
| RF-06 | `reseals cookie session opened by an extra password` | Resposta tem `Set-Cookie`. Depois, leitura só com `password` atual abre o mesmo `id`. |
| RF-06 | `does not reseal cookie session sealed with the current password` | Leitura com selo da primária: sem `Set-Cookie` extra. |
| RF-06 | `does not reseal header session opened by an extra password` | Header com selo antigo: sem `Set-Cookie`; leituras seguintes continuam abrindo enquanto a extra estiver listada. |
| RF-07 | `seals with password only after opening with an extra` | `updateSession` após leitura com extra: cookie abre com `password`; `unseal` com a extra lança `Bad hmac value`. |
| RF-08 | `throws for a too short extra password, with or without cookie` | `extraUnsealPasswords: ["curta"]`; `getSession` e `useSession` rejeitam com `too short`, com e sem cookie. |
| RF-08 | `validates extras against the stricter of the two minimums` | Configurar `seal.integrity.minPasswordlength` maior que `encryption`; extra entre os dois tamanhos deve rejeitar com `too short`. |
| RF-09 | `opens legacy session sealed with an extra password and reseals it` | Selo com 1 iteração e senha extra; cookie resselado. |
| RF-09 | `does not open legacy extra-sealed session with legacySealFallback: false` | Mesma entrada, fallback desligado: sessão nova. |
| RF-10 | (suíte existente) | `pnpm vitest run test/session.test.ts test/unit/` sem alterar asserções existentes. |

Nota sobre contagem de `deriveBits`: cada `unseal` que chega ao HMAC faz 1 derivação; quando o HMAC acerta, a decriptação faz mais 1. Uma candidata que falha no HMAC custa 1 derivação, ou 2 quando o fallback legado está ligado (a tentativa de 1 iteração também deriva). Esperado: primária certa = 2; primária errada + extra certa = 1 + 2 com fallback desligado (3), ou 2 + 2 com fallback ligado (4). Confirmar rodando o teste antes de fixar os números.

Teste de regressão de API (RF-10, RF-11): `test/unit/package.test.ts` deve continuar passando sem edição.

Sequência de verificação recomendada (AGENTS.md, "Bug Fix Workflow" adaptado a feature):
1. Escrever os casos de RF-02 a RF-09 antes da implementação. Confirmar que falham.
2. Implementar (D-01 a D-08).
3. `pnpm vitest run test/session.test.ts test/unit/`.
4. `pnpm typecheck` (`tsc --noEmit`, em `package.json`).
5. `pnpm lint` (inclui `oxfmt --check`).
6. `pnpm test` (suíte completa com cobertura), se o tempo permitir.
7. `pnpm fmt` deve ser executado com cuidado: rodar `automd` regenera o bloco da doc. Conferir `git diff docs/` depois.

---

## Riscos

- **R-01 — Custo de CPU por leitura inválida.** Cada cookie que nenhuma senha abre custa uma derivação de 8192 iterações por candidata, mais uma de 1 iteração por candidata se o fallback estiver ligado. Com N extras, a conta é de (1+N) derivações completas por requisição inválida. Mitigação atual: ordem fixa (primária primeiro) e a doc pede lista curta. **Pendência para quem decide:** definir um limite máximo de extras (por exemplo, 4). Não foi implementado porque não está no contrato.
- **R-02 — Erro de configuração engolido.** O `.catch` em `getSession` (`session.ts:196-198`) transforma qualquer falha de unseal em sessão nova. Mitigação: D-06, validação antes de qualquer leitura, com o mínimo correto (máximo dos dois). Teste em RF-08.
- **R-03 — Escrita de cookie em leitura.** RF-06 faz `getSession` emitir `Set-Cookie` em requisições que só leem, durante a janela de migração. Segue o padrão já existente para legado e `idleTimeout`. Aceito.
- **R-04 — Segredo antigo em memória.** Enquanto estiver listada, a senha antiga fica na configuração do processo. Registrado no JSDoc do campo.
- **R-05 — Sessões de cabeçalho presas à senha antiga.** Elas não migram. Saem do sistema só quando expiram ou quando a extra é removida. Registrado na doc.
- **R-06 — Dois caminhos de leitura divergentes.** Fallback legado e senhas extras compartilham o mesmo helper (D-04), o que reduz o risco. Os testes de RF-09 cobrem a combinação.
- **R-07 — Mínimo zero.** Se `seal.*.minPasswordlength` for `0`, `""` passa na validação e falha em `generateKey` (`Empty password`), que o `.catch` engole. É configuração fora de uso razoável; não tratado.
- **R-08 — Sinal de tempo.** O número de derivações numa leitura revela se a sessão foi selada com uma senha antiga. O cookie já está nas mãos de quem o envia, e isso não revela a senha. Risco considerado baixo.
- **R-09 — Ordem de expiração no iron.** `unseal` verifica a expiração do selo antes do HMAC. Um selo expirado nunca dispara as extras, e isso é o correto, porque expiração não depende da senha. Não é um defeito, mas os testes de RF-05 devem cobrir a expiração com a senha extra certa.
- **R-10 — Decisão de produto (RF-06).** A releitura que escreve cookie é uma assunção (P-05 do PRD). Se não for desejada, retirar o termo `extraSeal` de D-08 e ajustar a doc.
