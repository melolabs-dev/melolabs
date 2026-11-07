# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Origem: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-07).
Área afetada: `src/utils/session.ts` e `src/utils/internal/iron-crypto.ts`.
Todas as referências `caminho:linha` foram conferidas no código deste clone (branch `master`).

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Ao abrir um cookie, a biblioteca tenta `password` e, em seguida, cada senha extra, na ordem do array, até uma abrir o cookie. Ao selar, usa sempre `password`. A única mudança de comportamento é que um cookie que antes falhava com "Bad hmac value" pode agora abrir com uma senha extra. Sem o campo, o caminho de execução é o mesmo de hoje.

---

### D-01 — Campo novo `extraUnsealPasswords` em vez de `password: string | string[]`

**Decisão:** adicionar `extraUnsealPasswords?: string[]` a `SessionConfig`, mantendo `password: string`.

**Alternativas consideradas:**
1. `password` aceitar um array, em que o primeiro elemento sela e os demais só abrem (alternativa 2 da issue #1050).
2. `extraUnsealPasswords` (escolhida), conforme a alternativa 1 da issue.

**Justificativa:** `password` é `string` hoje (`src/utils/session.ts:48`) e é o campo que o usuário já conhece. Mudar seu tipo quebraria a API pública e exigiria um contrato de "primeiro sela, demais abrem" que a issue deixou em aberto. O PRD marca a alternativa 1 como fora de escopo, e o campo novo não impede uma evolução futura nesse sentido: a API atual pode ser mantida como sinônimo de `password: [x]`.

### D-02 — Tentar as senhas em um loop por senha, com fallback legado dentro de cada tentativa

**Decisão:** a leitura passa a ser um loop sobre `new Set([config.password, ...(config.extraUnsealPasswords || [])])`. Para cada senha, faz-se a tentativa atual (com as iterações configuradas) e, se ela falhar com `"Bad hmac value"` e o fallback legado estiver ativo, a tentativa legada com 1 iteração (RF-07). Só passa para a próxima senha se a falha for `"Bad hmac value"`. Qualquer outro erro sobe imediatamente. Se nenhuma senha abrir, relança-se o último erro `"Bad hmac value"`.

**Alternativas consideradas:**
1. Tentar todas as senhas com as iterações atuais, e só depois todas com 1 iteração.
2. Tentar por senha, com tentativa atual e legada (escolhida).

**Justificativa:**
- A opção 2 mantém o raciocínio local: "esta senha abre este cookie, de qualquer forma". Ela também produz o mesmo custo de falha que a opção 1, que é de `2 × (N + 1)` derivações PBKDF2 quando o fallback está ativo.
- O erro final é o mesmo de hoje (`"Bad hmac value"`), o que cumpre RF-05 sem revelar qual senha foi tentada.
- Erros que não são `"Bad hmac value"` (`"Expired seal"`, prefixo errado, componentes inválidos, senha curta) não dependem da senha. Parar nesses casos evita tentativas inúteis.

### D-03 — Selar somente com `password`; nenhuma regravação nova

**Decisão:** `sealSession` continua usando `config.password` (`src/utils/session.ts:300`). Não há regravação forçada. Uma sessão aberta com senha extra é regravada somente nas condições que já existem em `getSession`: `legacySeal` ou `shouldSlide` (`src/utils/session.ts:214`).

**Justificativa:** isso cumpre RF-02 e a premissa "Regravação com a senha atual" do PRD. Como o `kLegacySeal` já é marcado pelo `unsealSession` (`src/utils/session.ts:346`), a regravação de sessões legadas abertas com extra usa `password` sem nenhuma alteração adicional.

**Ponto em aberto (do PRD):** o dono da feature precisa confirmar que a regravação com `password` é aceita. A alternativa é regravar apenas o que já é regravado hoje, o que a implementação escolhida já faz.

### D-04 — Validação das senhas extras pela mesma regra de tamanho, extraída para uma função

**Decisão:**
- Extrair de `generateKey` a checagem de tamanho (`src/utils/internal/iron-crypto.ts:191-196`) para uma função exportada `assertPasswordLength(password, minPasswordlength)` no mesmo arquivo. `generateKey` passa a chamá-la, com a mesma mensagem.
- Validar as extras antes de qualquer tentativa, tanto em `unsealSession` quanto em `sealSession`, chamando `assertPasswordLength` com `sealOptions.encryption.minPasswordlength` e `sealOptions.integrity.minPasswordlength`. O `generateKey` checa os dois limites, então a validação precisa cobrir os dois.

**Alternativas consideradas:**
1. Deixar a checagem preguiçosa, como acontece com `password`: a senha curta só falha quando é tentada.
2. Validar eagerly (escolhida).

**Justificativa:**
- Com a checagem preguiçosa, uma senha extra vazia ou curta faria o loop parar com erro não-`"Bad hmac value"` (ou acertar uma senha anterior e nunca ser testada). O resultado dependeria da ordem e da sorte, e o RF-06 pede rejeição uniforme.
- Validar eagerly em `sealSession` faz a escrita falhar, como acontece hoje com `password` curta (`generateKey` lança em `seal`). Isso cumpre "mesmo tratamento que uma password inválida recebe hoje" para os dois sentidos.
- Usar a mesma função mantém a regra em um único lugar e evita duplicar a mensagem de erro.

**Efeito no caso de leitura:** `getSession` engole o erro de `unsealSession` (`src/utils/session.ts:197`), então um cookie lido com config inválida vira sessão nova, igual a uma `password` curta hoje.

### D-05 — Deduplicar as senhas e manter `unsealSession` com a mesma assinatura

**Decisão:**
- `new Set(...)` remove a repetição de uma senha em `password` e em `extraUnsealPasswords` (RF-03), e evita uma derivação PBKDF2 desperdiçada.
- A assinatura de `unsealSession` e de `sealSession` não muda (`src/utils/session.ts:282-285`, `312-316`). `src/index.ts:208-209` continua exportando as duas sem alteração.
- As opções de selagem, que hoje estão repetidas em `sealSession` (`src/utils/session.ts:300-304`) e `unsealSession` (`src/utils/session.ts:317-321`), passam a vir de uma função interna `sealOptionsFor(config)`. Isso evita divergência entre leitura e escrita na validação de D-04.

### D-06 — Onde o código fica

**Decisão:** as funções novas são internas (`unsealWithPasswords`, `unsealWithPassword`, `isBadHmac`, `assertExtraPasswords`, `sealOptionsFor`) e ficam no fim de `src/utils/session.ts`, seguindo a convenção de "helpers internos ao final do arquivo" de `AGENTS.md`. A única função pública nova é `assertPasswordLength`, em `iron-crypto.ts`, que é um módulo interno (`utils/internal/`) e não é reexportado por `src/index.ts`.

**Alternativa:** mover o loop para `src/utils/internal/session.ts`. Não foi escolhida porque o arquivo `session.ts` já tem 464 linhas e a mudança é pequena. Ela vira candidata a extração se o arquivo continuar crescendo.

---

## Arquivos a alterar

### 1. `src/utils/session.ts`

| Trecho atual | Mudança |
| --- | --- |
| `src/utils/session.ts:39-48` (`SessionConfig`, campo `password: string`) | Adicionar, logo após `password` (`:48`), o campo `extraUnsealPasswords?: string[]` com JSDoc (ver contrato). |
| `src/utils/session.ts:149-232` (`getSession`) | Sem mudança de código. Continua engolindo erro de `unsealSession` em `:197` e regravando em `:214`. |
| `src/utils/session.ts:282-307` (`sealSession`) | Usar `sealOptionsFor(config)` (`:300-304`) e chamar `assertExtraPasswords(config, sealOptions)` antes de `seal`. Continua selando com `config.password`. |
| `src/utils/session.ts:312-367` (`unsealSession`) | Substituir a chamada direta a `unseal` (`:324`) e o bloco `try/catch` com fallback legado (`:322-348`) por `unsealWithPasswords`. As checagens de `maxAge` e `idleTimeout` (`:349-365`) ficam como estão, depois do loop. |

Esboço da nova `unsealSession` (apenas a parte que muda):

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = sealOptionsFor(config);
  assertExtraPasswords(config, sealOptions);
  const unsealed = await unsealWithPasswords(sealed, config, sealOptions);
  // Absolute lifetime, counted from when the session was created
  if (config.maxAge) {
    /* ...inalterado, src/utils/session.ts:349-355 */
  }
  // Idle window...
  if (config.idleTimeout) {
    /* ...inalterado, src/utils/session.ts:356-365 */
  }
  return unsealed;
}
```

Helpers internos (no fim de `session.ts`):

```ts
function sealOptionsFor(config: SessionConfig): SealOptions {
  return {
    ...sealDefaults,
    ttl: (config.maxAge || config.idleTimeout || 0) * 1000,
    ...config.seal,
  };
}

function assertExtraPasswords(config: SessionConfig, sealOptions: SealOptions): void {
  for (const password of config.extraUnsealPasswords || []) {
    assertPasswordLength(password, sealOptions.encryption.minPasswordlength);
    assertPasswordLength(password, sealOptions.integrity.minPasswordlength);
  }
}

async function unsealWithPasswords(
  sealed: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>> {
  const passwords = new Set([config.password, ...(config.extraUnsealPasswords || [])]);
  let lastError: unknown;
  for (const password of passwords) {
    try {
      return await unsealWithPassword(sealed, password, config, sealOptions);
    } catch (error) {
      if (!isBadHmac(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>> {
  try {
    return (await unseal(sealed, password, sealOptions)) as Partial<Session>;
  } catch (error) {
    // TODO: Remove this fallback (and `legacySealFallback`) in v3. (comentário atual, :326-331)
    if (
      config.legacySealFallback === false ||
      sealOptions.integrity.iterations === 1 ||
      !isBadHmac(error)
    ) {
      throw error;
    }
    const unsealed = (await unseal(sealed, password, {
      ...sealOptions,
      encryption: { ...sealOptions.encryption, iterations: 1 },
      integrity: { ...sealOptions.integrity, iterations: 1 },
    })) as Partial<Session>;
    if (unsealed) {
      (unsealed as any)[kLegacySeal] = true;
    }
    return unsealed;
  }
}

function isBadHmac(error: unknown): boolean {
  return error instanceof Error && error.message === "Bad hmac value";
}
```

Observações sobre o esboço:
- `unseal` já tem o tipo de retorno `Promise<unknown>` (`src/utils/internal/iron-crypto.ts:87-91`). O cast para `Partial<Session>` é o mesmo que existe hoje.
- O `if (unsealed)` de `:345` precisa ser preservado, porque `unseal` pode retornar `null` (`src/utils/internal/iron-crypto.ts:149`).
- A semântica do `try/catch` atual é preservada: sem extras, `unsealWithPasswords` executa uma única tentativa, e qualquer erro sai com o mesmo objeto e a mesma mensagem.
- `SealOptions` já é exportado como tipo de `iron-crypto.ts:350` e `session.ts:9` o importa.

### 2. `src/utils/internal/iron-crypto.ts`

| Trecho atual | Mudança |
| --- | --- |
| `src/utils/internal/iron-crypto.ts:191-196` (checagem de tamanho dentro de `generateKey`) | Trocar o bloco `if (password.length < options.minPasswordlength) { throw ... }` por `assertPasswordLength(password, options.minPasswordlength);`. A mensagem não muda. |
| após `src/utils/internal/iron-crypto.ts:198` (fim de `generateKey`) ou em outro ponto do arquivo | Adicionar a função exportada `assertPasswordLength` (ver contrato). |

Valores padrão usados pela validação: `minPasswordlength: 32` em `src/utils/internal/iron-crypto.ts:22` (encryption) e `:28` (integrity).

### 3. `test/session.test.ts`

Adicionar testes novos dentro de `describeMatrix("session", ...)` (`test/session.test.ts:15`), seguindo o padrão de `t.app.all(...)` com `Cookie` header já usado em `:134-159` e `:161-186`. Nenhum teste existente é removido.

### 4. `test/unit/iron-crypto.test.ts`

Adicionar um caso para `assertPasswordLength` próximo de `test/unit/iron-crypto.test.ts:121-125`, que já testa a mensagem "Password string too short (min 32 characters required)".

### Arquivos que não mudam

- `src/index.ts:208-209`: exports de `sealSession` e `unsealSession` permanecem iguais.
- `src/utils/internal/session.ts:7-9` (`kLegacySeal`) e `:11-18` (constantes de cookie): não mudam.
- `src/types/context.ts`: não relacionado.
- Formato do cookie, algoritmo de selagem e `SealOptions` padrão: não mudam (PRD, "Fora de escopo").

---

## Contratos e assinaturas

Público (único símbolo público novo):

```ts
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that are only used to open sessions sealed with them.
   * `password` is still the only one used to seal. Tried in order after
   * `password`; the first that opens the session wins. Each must be at least
   * 32 characters, like `password`.
   *
   * Keep a retired password here only for as long as sessions sealed with it
   * may still be in use: anyone holding it can forge sessions the application
   * accepts. Remove it from this list once the rotation window has passed.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}
```

Interno (não exportado por `src/index.ts`):

```ts
// src/utils/internal/iron-crypto.ts
/** Throws the same error `generateKey` has always thrown for a string password shorter than the minimum. */
export function assertPasswordLength(password: string, minPasswordlength: number): void;

// src/utils/session.ts (helpers privados)
function sealOptionsFor(config: SessionConfig): SealOptions;
function assertExtraPasswords(config: SessionConfig, sealOptions: SealOptions): void;
function unsealWithPasswords(sealed: string, config: SessionConfig, sealOptions: SealOptions): Promise<Partial<Session>>;
function unsealWithPassword(sealed: string, password: string, config: SessionConfig, sealOptions: SealOptions): Promise<Partial<Session>>;
function isBadHmac(error: unknown): boolean;
```

Assinaturas inalteradas:

```ts
export async function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export async function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;
```

Comportamento contratual:

| Entrada | Resultado |
| --- | --- |
| `extraUnsealPasswords` ausente ou `[]` | Idêntico ao código atual (mesma tentativa única, mesmos erros). |
| Cookie selado com `password` | Aberto na primeira tentativa. |
| Cookie selado com uma extra `B` | Aberto na tentativa de `B`; senhas depois de `B` não são tentadas. |
| Cookie selado com `C`, que não está na lista | `unsealSession` lança `"Bad hmac value"`; `getSession` trata como sessão nova (RF-05). |
| Extra vazia ou curta | `unsealSession` e `sealSession` lançam `"Password string too short (min 32 characters required)"`. Em leitura, `getSession` trata como sessão nova. Em escrita, `updateSession` propaga o erro (RF-06). |
| Mesma senha em `password` e em extras | Tentada uma vez (RF-03). |
| Cookie legado (1 iteração) selado com extra `B`, `legacySealFallback` padrão | Aberto; marcado com `kLegacySeal`; regravado com `password` pelas condições existentes (RF-07). |
| Mesmo cookie com `legacySealFallback: false` | Não aberto (RF-07). |
| Cookie selado com `B` e `maxAge` vencido | Lança `"Session expired!"` (checagem de expiração continua depois do loop). |

---

## Estratégia de testes

Os testes são de integração em `test/session.test.ts` (matriz web/node, por `describeMatrix`), e de unidade para `assertPasswordLength`.

Cada teste novo usa uma config própria (`{ ...sessionConfig, extraUnsealPasswords: [...] }`) e uma rota dedicada, como em `test/session.test.ts:161-186`. Senhas de teste com pelo menos 32 caracteres.

| Requisito | Teste | Como verificar |
| --- | --- | --- |
| RF-01 | Cookie selado com `B` é lido por `useSession` com `password = A`, `extraUnsealPasswords = [B]`. | `t.fetch` com `Cookie` e checar `session.data`. |
| RF-02 | Após `update`, o cookie novo abre com `A` (`unseal(..., A, sealDefaults)` resolve) e não abre com `B` (`rejects`). | Ler `Set-Cookie`, como em `:156-158`. |
| RF-03 (ordem) | `B` abre; `C` não precisa ser tentada. | Cookie com `B` e lista `[B, C]`. Sem spy sobre `unseal` (módulo ESM); verificar pelo resultado. |
| RF-03 (repetida) | `password` igual a uma extra: sessão aberta sem erro. | `extraUnsealPasswords: [A]`. |
| RF-04 | Sem extras: suíte existente passa sem alteração. Adicionar um teste de cookie sealed com senha desconhecida, que resulta em sessão nova. | Suíte atual inteira, incluindo `:134-186`. |
| RF-05 | Cookie com `C` (fora da lista) gera sessão nova, sem mensagem que identifique a senha. | `body.session.id` diferente e `data` vazio. |
| RF-06 | Extra `""` e extra com 31 caracteres: leitura gera sessão nova; `update` lança erro. | Verificar o status do `t.fetch` de escrita e o conteúdo do erro. |
| RF-07 (aberto) | Cookie legado selado com `B` é aberto, e o `Set-Cookie` resultante abre com `A`. | Mesmo padrão de `:134-159`. |
| RF-07 (fechado) | Cookie legado com `B` e `legacySealFallback: false` não é aberto. | Mesmo padrão de `:161-186`. |
| Expiração | Cookie selado com `B` e `maxAge` vencido: sessão nova. | Forjar `createdAt` antigo com `seal` e `B`. |
| `assertPasswordLength` | Lança a mesma mensagem para curta; não lança para tamanho exato. | `test/unit/iron-crypto.test.ts`. |

Comandos:

```bash
pnpm vitest run test/session.test.ts
pnpm vitest run test/unit/iron-crypto.test.ts
pnpm lint          # oxlint + oxfmt --check
pnpm typecheck     # tsc --noEmit
pnpm test          # suíte completa com cobertura
```

Regra de `AGENTS.md` ("Bug Fix Workflow") não se aplica diretamente, porque é uma feature. Ainda assim, a ordem recomendada é escrever primeiro os testes RF-01, RF-05 e RF-07 e confirmar que falham, depois implementar.

---

## Riscos

| # | Risco | Origem | Mitigação |
| --- | --- | --- | --- |
| R-01 | Senha antiga mantida indefinidamente permite forjar sessões válidas. | PRD, Riscos | Documentação no JSDoc do campo (contrato acima). Guia de migração fica fora desta entrega (PRD). |
| R-02 | Custo de CPU: falha com cookie forjado custa `N + 1` derivações, e `2 × (N + 1)` quando o fallback legado está ativo. | PRD, Riscos; D-02 | Dedup (D-05); listas curtas; documentação. Não há limite imposto pela biblioteca (PRD). Confirmar com o dono se há teto (ponto em aberto do PRD). |
| R-03 | Erro de loop no fallback legado faz sessões legadas com extra deixarem de abrir. | PRD, Riscos | RF-07 tem teste dedicado nos dois sentidos (`legacySealFallback` padrão e `false`). |
| R-04 | Erro não-`"Bad hmac value"` numa extra interrompe o loop e impede abrir uma senha que viria depois. | D-02, D-04 | Validação eager de extras (D-04) elimina senhas inválidas antes do loop. Erros pós-validação que não dependem da senha (expiração, formato) param o loop de propósito. |
| R-05 | Tempo de resposta cresce com a posição da senha que abre o cookie. | PRD, Riscos | Aceito. Não vaza o segredo. Documentar na guia de migração (fora desta entrega). |
| R-06 | Regressão silenciosa em todas as sessões. | PRD, Riscos | Sem extras, o loop executa uma única tentativa com a mesma exceção. A suíte atual (`test/session.test.ts`) é a proteção principal. |
| R-07 | `session.ts` continua acima das 200 linhas recomendadas em `AGENTS.md`. | D-06 | Aceito nesta entrega. Extrair para `utils/internal/` se crescer mais. |
| R-08 | `sealSession` passa a validar extras, o que pode quebrar escritas de configs que já tinham extras inválidas. | D-04 | Caso novo: não existe campo hoje, então não há config antiga afetada. |
| R-09 | `assertPasswordLength` alterar a mensagem ou o momento do erro de `generateKey`. | D-04 | Teste existente em `test/unit/iron-crypto.test.ts:121-125` cobre a mensagem. A mudança é só extração de função. |
| R-10 | Checagem de tamanho usa `minPasswordlength` de `encryption` e de `integrity`. Se `seal` sobrescreve só um dos dois, a validação continua coerente, porque valida pelos dois. | D-04 | Validar pelos dois limites (esboço de `assertExtraPasswords`). |

## Pontos em aberto (herdados do PRD)

1. Confirmar que a regravação com `password` de sessões abertas com extra é aceita pelo dono da feature (PRD, RF-07).
2. Confirmar se há limite máximo para `extraUnsealPasswords` antes de publicar (PRD).
