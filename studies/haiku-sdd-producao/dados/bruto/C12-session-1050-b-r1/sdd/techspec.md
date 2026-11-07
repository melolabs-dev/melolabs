# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

**Fontes:** `sdd/pedido.md`, `sdd/prd.md`
**Arquivos de código:** `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`
**Status:** rascunho para implementação

Comentários e JSDoc no código seguem o inglês já usado no projeto; esta especificação é em português.

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `password` continua sendo a única senha que sela. Na leitura, o selo é aberto com a primeira senha da lista `[password, ...extraUnsealPasswords]` que passa na verificação de HMAC. Quando a senha que abriu o selo é uma extra, o cookie é resealado com `password` na mesma requisição. Nenhum outro nome público é criado.

---

## Decisões de arquitetura

### D-01 — Campo novo em `SessionConfig`, `password` continua `string`

**Escolha:** adicionar `extraUnsealPasswords?: string[]` a `SessionConfig`.

**Alternativas consideradas:**
1. Aceitar `password: string | string[]`, com a primeira senha selando (alternativa 2 da issue #1050).
2. Campo novo `extraUnsealPasswords` (escolhida).

**Justificativa:** a alternativa 1 muda o tipo de `password`, que hoje é usado em `seal`, `unseal` e nas validações de `iron-crypto.ts` (`src/utils/internal/iron-crypto.ts:94`, `:120`). Ela também torna ambíguo qual valor sela. O campo novo é aditivo: quem não passa o campo recebe o comportamento atual (RF-05). A alternativa 1 está fora do escopo do PRD.

### D-02 — Ordem fixa e primeira que verifica vence; só "Bad hmac value" avança

**Escolha:** o conjunto de senhas é `new Set([config.password, ...(config.extraUnsealPasswords ?? [])])`, que preserva a ordem e remove repetições. Cada senha é tentada em sequência com as opções atuais de seal. Só o erro `"Bad hmac value"` faz a busca seguir para a próxima senha. Qualquer outro erro é relançado na hora. Se nenhuma senha abrir, o fallback legado (1 iteração PBKDF2) roda sobre a lista inteira, na mesma ordem.

**Alternativas consideradas:**
1. Intercalar, por senha: tentar a senha atual e depois a legada antes de passar para a próxima senha. Fica mais barato para cookies legados selados com a senha primária, que é o caso mais comum durante a migração.
2. Ordem de RF-06 do PRD: todas as senhas com as opções atuais, depois todas com o fallback legado (escolhida).

**Justificativa:** o RF-06 do PRD pede a ordem 2 de forma explícita. Ela é um ajuste pequeno, sem mudança de API, e pode ser trocada depois por uma alteração localizada no helper `unsealWithPasswords` (D-06). O custo extra recai só sobre cookies legados durante a janela de rotação, e o cookie é resealado uma vez.

### D-03 — Sinal de "aberto com senha extra" por símbolo interno, não pelo retorno público

**Escolha:** `unsealSession` marca o objeto aberto com o símbolo interno `kPreviousPasswordSeal` quando o índice da senha que abriu é maior que zero. `getSession` lê o símbolo, remove-o antes do `Object.assign` e força o reseal. Isso segue o mesmo padrão de `kLegacySeal`.

**Alternativas consideradas:**
1. Mudar o retorno de `unsealSession` para `{ session, index }`.
2. Símbolo interno (escolhida).

**Justificativa:** `unsealSession` é exportada publicamente (`src/index.ts:209`) e aparece na lista de exports verificada por `test/unit/package.test.ts:149`. Mudar o retorno quebraria a API. O símbolo não aparece em serialização JSON e não altera a assinatura.

### D-04 — Validação antecipada em `getSession`, antes de qualquer mutação de contexto

**Escolha:** `getSession` chama `assertExtraUnsealPasswords(config)` como primeira instrução, antes de criar `context.sessions` e de gravar o placeholder da sessão. Se a validação falhar, o erro propaga para o handler (`useSession` e `getSession` não o capturam).

**Regra de tamanho:** cada entrada precisa ser `string` com pelo menos `Math.max(encryption.minPasswordlength, integrity.minPasswordlength)` caracteres, lidos das opções efetivas `{ ...sealDefaults, ...config.seal }`. O padrão é 32 (`src/utils/internal/iron-crypto.ts:22` e `:28`), o mesmo mínimo que `generateKey` já impõe a `password` (`src/utils/internal/iron-crypto.ts:191-196`). Não é uma regra nova.

**Alternativas consideradas:**
1. Deixar o `iron` rejeitar entradas inválidas durante o unseal. Rejeitada: `getSession` engole qualquer erro de `unsealSession` (`src/utils/session.ts:197`, `.catch(() => {})`), então a entrada seria ignorada em silêncio. O RF-08 proíbe isso.
2. Validar só vazio e não-string. Rejeitada: uma entrada curta passaria pela validação e cairia no mesmo silêncio.
3. Validar com o mínimo de `password` na mesma função (escolhida, com o mínimo efetivo).

**Observação sobre `password`:** a validação não se aplica a `password`. Ela continua sendo checada pelo `seal`, como hoje (RF-05).

### D-05 — Reseal só para cookies, na mesma condição do legado

**Escolha:** o reseal por senha extra usa exatamente a condição que já existe para o legado (`src/utils/session.ts:214`), acrescida de um flag: `session.id && sessionFromCookie && (legacySeal || previousSeal || shouldSlide(session, config))`.

**Justificativa:** sessões lidas do header não podem ser resealadas, porque o header é enviado pelo cliente (RF-10). Ao resealar, `updateSession` restampa `lastSeenAt` quando `idleTimeout` está configurado. Isso é o comportamento desejado, porque a requisição é uma atividade real do usuário.

### D-06 — Helpers internos ao fim de `session.ts`

**Escolha:** `isBadHmacError`, `assertExtraUnsealPasswords` e `unsealWithPasswords` ficam ao fim de `src/utils/session.ts`, conforme o AGENTS.md ("internal helpers go at the end of files").

**Alternativas consideradas:**
1. Mover o loop de unseal para `src/utils/internal/session.ts`. Descartada agora: o arquivo `session.ts` já tem 464 linhas, acima da meta de 200 do AGENTS.md, e dividi-lo é refatoração fora do escopo. Fica registrado como dívida (ver Riscos).

### D-07 — Remoção e duplicatas

- Remover uma senha de `extraUnsealPasswords` invalida só os selos feitos com ela (RF-11). Nenhum estado extra é mantido.
- Uma entrada igual a `password`, ou repetida dentro da lista, não gera tentativa extra. O `Set` de D-02 cobre os dois casos.
- `sealSession` não muda: ele sempre usa `config.password` (`src/utils/session.ts:300`). RF-02 vale por construção.

---

## Contratos e assinaturas

### `SessionConfig` (`src/utils/session.ts`, perto da linha 48)

```ts
export interface SessionConfig {
  /**
   * Private key used to seal session tokens. ... (texto atual, sem alteração)
   */
  password: string;
  /**
   * Previous passwords that can still unseal sessions, tried after `password`
   * in this order. They never seal: sessions opened with one of them are
   * resealed with `password` on the same request, so an entry can be removed
   * once `maxAge` (or `idleTimeout`) has passed since the rotation.
   *
   * Each entry follows the same minimum length as `password`. Every extra
   * password costs one more PBKDF2 derivation for each request whose cookie
   * does not open with an earlier password, so keep the list short.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos sem alteração
}
```

### Constantes internas (`src/utils/internal/session.ts`, após a linha 9)

```ts
export const kPreviousPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.previous-password-seal",
);
```

### Helpers internos (`src/utils/session.ts`, ao fim do arquivo)

```ts
/** Whether an unseal failure means "this password is not the one that sealed it". */
function isBadHmacError(error: unknown): boolean;

/**
 * Throws if `extraUnsealPasswords` is set but not an array of strings with at
 * least the minimum length of a seal password. Messages cite the field name.
 */
function assertExtraUnsealPasswords(config: SessionConfig): void;

/**
 * Tries each password in order and returns the first that opens the seal,
 * with its index in `passwords`. Non-HMAC errors are rethrown immediately.
 * When every password fails HMAC, the last HMAC error is rethrown.
 */
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<{ unsealed: Partial<Session>; index: number }>;
```

Esboço de `unseal`:

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  const passwords = [...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])];
  let unsealed: Partial<Session>;
  let index: number;
  try {
    ({ unsealed, index } = await unsealWithPasswords(sealed, passwords, sealOptions));
  } catch (error) {
    // TODO comment mantido
    if (
      config.legacySealFallback === false ||
      sealOptions.integrity.iterations === 1 ||
      !isBadHmacError(error)
    ) {
      throw error;
    }
    ({ unsealed, index } = await unsealWithPasswords(sealed, passwords, {
      ...sealOptions,
      encryption: { ...sealOptions.encryption, iterations: 1 },
      integrity: { ...sealOptions.integrity, iterations: 1 },
    }));
    if (unsealed) {
      (unsealed as any)[kLegacySeal] = true;
    }
  }
  if (unsealed && index > 0) {
    (unsealed as any)[kPreviousPasswordSeal] = true;
  }
  // maxAge e idleTimeout: sem alteração (src/utils/session.ts:349-365)
  ...
  return unsealed;
}
```

Esboço de `getSession`:

```ts
export async function getSession<T extends SessionData = SessionData>(event, config) {
  assertExtraUnsealPasswords(config); // first: no context mutation on failure
  const sessionName = config.name || DEFAULT_SESSION_NAME;
  // ...
  // in the unseal promise, next to the legacy handling (src/utils/session.ts:199-201):
  const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
  if (legacySeal) delete (unsealed as any)[kLegacySeal];
  const previousSeal = unsealed && (unsealed as any)[kPreviousPasswordSeal];
  if (previousSeal) delete (unsealed as any)[kPreviousPasswordSeal];   // before Object.assign
  // ...
  if (session.id && sessionFromCookie && (legacySeal || previousSeal || shouldSlide(session, config))) {
    await updateSession(event, config);
  }
}
```

Atenção: `Object.assign` copia também propriedades com chave de símbolo. Por isso o símbolo precisa ser removido antes de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`). É o mesmo cuidado que já existe para `kLegacySeal`.

### Validação (esboço)

```ts
function assertExtraUnsealPasswords(config: SessionConfig): void {
  const extra = config.extraUnsealPasswords;
  if (extra === undefined) return;
  const { encryption, integrity } = { ...sealDefaults, ...config.seal };
  const minLength = Math.max(encryption.minPasswordlength, integrity.minPasswordlength);
  if (!Array.isArray(extra) || extra.some((p) => typeof p !== "string" || p.length < minLength)) {
    throw new Error(
      `\`extraUnsealPasswords\` must be an array of strings with at least ${minLength} characters`,
    );
  }
}
```

`null` cai em `!Array.isArray` e é rejeitado. Não há tratamento de `null` como ausente, porque o tipo não o permite.

---

## Arquivos a alterar

| Arquivo | Alteração | Referências verificadas |
| --- | --- | --- |
| `src/utils/session.ts` | Campo `extraUnsealPasswords` em `SessionConfig`; validação em `getSession`; loop em `unsealSession`; reseal em `getSession`; helpers ao fim | `:39-99` (SessionConfig), `:48` (`password`), `:89-95` (`legacySealFallback`), `:149-153` (início de `getSession`), `:194-220` (caminho de cookie), `:199-201` (legado), `:208` (`Object.assign`), `:214` (condição de reseal), `:300` (`seal` com `config.password`), `:312-348` (`unsealSession` e fallback), `:324` (unseal único), `:332-339` (condição do legado), `:340-346` (retry legado), `:349-365` (maxAge/idle), `:414-421` (`shouldSlide`) |
| `src/utils/internal/session.ts` | Símbolo `kPreviousPasswordSeal` | `:7-9` (`kLegacySeal`, padrão a seguir) |
| `test/session.test.ts` | Novos casos (ver estratégia) | `:12` (imports de `seal`/`unseal`), `:15` (`describeMatrix`), `:134` e `:161` (testes legados), `:311` (sessão de header), `:414` e `:723` (espiões de `subtle`) |

Não alterar: `src/index.ts` (nenhum export novo; `:209` mantém `unsealSession`), `src/utils/internal/iron-crypto.ts`, `src/_entries/*`, `package.json`.

`test/unit/package.test.ts:149` lista os exports públicos. Ela deve continuar passando sem alteração. Se falhar, a implementação criou export indevido.

---

## Estratégia de testes

Todos os casos novos ficam dentro de `describeMatrix("session", ...)` em `test/session.test.ts`, para rodar nos alvos `web` e `node`. Cada caso de comportamento precisa ser visto falhando antes da implementação, conforme o AGENTS.md ("Bug Fix Workflow").

Os testes que precisam contar derivações PBKDF2 usam `vi.spyOn(crypto.subtle, "deriveBits")` com `mockRestore` ao fim, como em `test/session.test.ts:723-735`. Contagens esperadas, verificadas pela análise de `iron-crypto.ts`:

- Uma tentativa que falha no HMAC: 1 `deriveBits` (`src/utils/internal/iron-crypto.ts:160`, `:206`).
- Uma tentativa que abre o selo: 2 `deriveBits` (HMAC e decifragem). O teste em `:733` confirma 2 para um `seal`.
- Expiração (`"Expired seal"`) é lançada antes de qualquer tentativa: 0 `deriveBits` (`src/utils/internal/iron-crypto.ts:110-118`).

Para isolar o unseal dos efeitos colaterais de `getSession`, os testes de ordem chamam `unsealSession` diretamente com um evento mínimo (`{} as HTTPEvent`), porque o parâmetro `_event` não é usado.

| Caso | RF | Como verificar |
| --- | --- | --- |
| Selo com `password` continua no formato atual e abre sem extras | RF-05 | Os testes existentes em `:134` e `:161` passam sem alteração de expectativa |
| `updateSession` e `sealSession` selam com `password` mesmo com extras | RF-02 | Cookie gerado abre com `unseal(cookie, password)` e falha com a extra (`"Bad hmac value"`) |
| Ordem de tentativa: selo com `A`, `B` e `C` com extras `[B, C]` | RF-03 | `unsealSession({} as HTTPEvent, cfg, sealedWith)` com spy: selo `B` → 3 derivações; selo `C` → 4 |
| Senha repetida na lista não gera tentativa extra | D-07 | Selo com `A`, extras `[A]` → 2 derivações |
| Sessão aberta com extra é resealada com `password` na mesma requisição | RF-04 | `Set-Cookie` presente; cookie novo abre com `password`; `id`, `createdAt` e `data` preservados |
| Segunda leitura com o cookie resealado não gera novo reseal | RF-04 | Requisição seguinte sem `Set-Cookie` |
| Legado (1 iteração) com senha extra é aberto, marcado e resealado | RF-06 | Como `:134`, com a senha no extra; `Set-Cookie` com `password` |
| Legado com senha extra e `legacySealFallback: false` é rejeitado | RF-06 | Como `:161`, com a senha no extra; sessão nova |
| Selo expirado com senha extra falha sem tentar senhas | RF-07 | `seal(..., "antiga", { ttl: -120000 })`; `unsealSession` rejeita com `"Expired seal"`; 0 derivações |
| `maxAge` vencido com senha extra cria sessão nova | RF-07 | `createdAt` antigo; resposta com `id` diferente |
| Validação: `""`, número, string curta, `null` e não-array | RF-08 | Handler captura o erro e devolve `e.message`; a mensagem contém `extraUnsealPasswords`. Não usar `throw` em handler: `test/_setup.ts:127-153` registra erros não tratados e falha o teste |
| Validação não altera `password` | RF-05 | `password` curta continua sendo rejeitada pelo `seal`, como hoje |
| Sessão de header com senha extra é aberta e não resealada | RF-10 | Header `x-h3-test-session` com selo `"antiga"`; `data` correto; sem `Set-Cookie` |
| Remover a senha antiga invalida só os selos dela | RF-11 | Cookie com `"antiga"` → sessão nova; cookie com `"B"` (extra mantida) → sessão preservada |

Execução: `pnpm vitest run test/session.test.ts test/unit/package.test.ts`. Ao final, `pnpm lint` (oxlint, oxfmt --check), `pnpm typecheck` e `pnpm vitest run`. A linha de base medida antes da mudança é de 59 testes passando nesses dois arquivos.

---

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Custo de CPU: um cookie inválido passa por N+1 tentativas PBKDF2 (N extras) | Mais CPU por requisição com cookies inválidos | JSDoc avisa para manter a lista curta; o PRD aceita o custo |
| Legado sob a senha primária paga as extras antes do fallback (D-02) | Latência maior só na janela de migração, uma vez por cookie | Aceito pelo RF-06; intercalar é mudança localizada (D-02) |
| Ordem de `getSession`: esquecer de remover o símbolo antes de `Object.assign` | A sessão ganharia um símbolo de reseal indevido | Teste de reseal (RF-04) e comentário no código |
| Validação fora de `getSession` deixa `updateSession` sem checagem | Config inválida só falha no caminho de leitura | `updateSession` chama `getSession` quando não há sessão no contexto; a validação roda ali |
| `"Bad hmac value"` é o sinal de senha errada, e o código depende da mensagem | Se a mensagem mudar no `iron`, as tentativas param na primeira senha | Testes de ordem (RF-03) e de legado falham se isso acontecer |
| Símbolo `kPreviousPasswordSeal` aparece no resultado de `unsealSession` chamado diretamente | Quem usa a função exportada vê uma chave de símbolo a mais | Mesmo padrão de `kLegacySeal`; não é serializado |
| Sinal de tempo: o número de tentativas revela qual senha da lista abriu o selo | Vazamento de posição na lista, não do segredo | Aceito; o selo já é dado do cliente |
| `session.ts` continua com 464+ linhas, acima da meta de 200 do AGENTS.md | Dívida de organização | Fora de escopo; registrar para a próxima refatoração (D-06) |
| Senha antiga esquecida continua valendo | Sessões antigas seguem válidas além da rotação | JSDoc orienta remover após `maxAge`; decisão da aplicação (PRD) |
