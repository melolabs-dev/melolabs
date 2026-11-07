# Especificação técnica: várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato enxuto #1050-b), `sdd/prd.md` (RF-01 a RF-10, premissas P1 a P5, riscos R1 a R5) e issue h3js/h3#1050.

Este documento define **como** implementar o PRD. Não repete o "o quê". Quando houver dúvida de comportamento, vale o PRD. Quando houver dúvida de implementação, vale esta especificação.

## Resumo

- `SessionConfig` ganha `extraUnsealPasswords?: string[]`. É a única mudança de API pública.
- `unsealSession` tenta, nesta ordem, `password` e depois cada item de `extraUnsealPasswords`. Para cada senha, mantém o fallback legado de 1 iteração.
- `getSession` regrava a sessão quando ela só abriu com senha extra, reaproveitando o ramo de reseal que já existe.
- `getSession` valida `extraUnsealPasswords` antes de ler cookie ou header.
- Nenhuma mudança em `sealSession`, em `iron-crypto.ts`, em `src/index.ts` ou em `docs/`.

## Estado atual do código (base para esta spec)

| Ponto | Arquivo:linha | Fato relevante |
|---|---|---|
| Campo `password` | `src/utils/session.ts:48` | Única senha da config. Abre e sela. |
| Campo `legacySealFallback` | `src/utils/session.ts:95` | Desliga o fallback de 1 iteração. Deprecated. |
| Leitura da sessão | `src/utils/session.ts:149-153` | `getSession` começa aqui. Antes de `context` ser lido (`:155`) não há estado mutado. |
| Leitura do header ou do cookie | `src/utils/session.ts:178-193` | `sessionFromCookie` vale `true` só para o cookie. |
| Chamada de `unsealSession` | `src/utils/session.ts:196-198` | Erros são engolidos com `.catch(() => {})`. |
| Marcação e limpeza de `kLegacySeal` | `src/utils/session.ts:199-201` | Padrão a ser repetido para o novo marcador. |
| `Object.assign` na sessão | `src/utils/session.ts:208` | Copia símbolos enumeráveis. Por isso o marcador precisa ser apagado antes. |
| Condição de reseal | `src/utils/session.ts:214` | `session.id && sessionFromCookie && (legacySeal \|\| shouldSlide(...))`. |
| Selagem | `src/utils/session.ts:300` | Usa só `config.password`. RF-02 já vale por construção. |
| `unsealSession` (exportada) | `src/utils/session.ts:312-367` | Chamada `unseal` em `:324`. Fallback legado em `:325-348`. Checagens de expiração em `:350-365`. |
| Fallback legado | `src/utils/session.ts:332-344` | Só para `"Bad hmac value"`, e não se `legacySealFallback === false` ou se as iterações atuais são 1. |
| Símbolos internos | `src/utils/internal/session.ts:3-9` | `kGetSession`, `kSessionNew`, `kLegacySeal`. |
| Export público | `src/index.ts:209` | `unsealSession` é exportada. Assinatura fica igual. |
| Erro "Bad hmac value" | `src/utils/internal/iron-crypto.ts:135-137` | Única falha tratada como "senha errada". |
| Erro "Expired seal" | `src/utils/internal/iron-crypto.ts:115-117` | Checado antes do HMAC. Idêntico para todas as senhas. |
| Derivação antes do HMAC | `src/utils/internal/iron-crypto.ts:133` e `:206` | Cada senha que não bate custa um PBKDF2 completo. |
| Mínimo de caracteres | `src/utils/internal/iron-crypto.ts:22` e `:28` | `minPasswordlength: 32` para encryption e integrity. |
| Scripts | `package.json:46`, `:53`, `:54` | `lint`, `test` e `typecheck` (`tsc --noEmit`). |
| Suíte | `test/session.test.ts:15` | `describeMatrix`. Config base em `:21-25`. Teste de selo legado em `:134-159`. Teste de expiração em `:344-373`. Bloco `lazy creation` em `:692`. |

## Decisões de arquitetura

### D-01 — Tentar as senhas dentro de `unsealSession`, uma a uma

**Escolha.** Extrair um helper interno `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)` com o conteúdo atual do bloco `try`/fallback de `src/utils/session.ts:322-348`, parametrizado pela senha. Um segundo helper interno, `unsealWithPasswords`, percorre `[config.password, ...(config.extraUnsealPasswords ?? [])]` na ordem do array.

Regra do laço: para cada senha, chama `unsealWithPassword`. Se der certo, para e devolve a senha que abriu. Se o erro for `"Bad hmac value"` e não for a última senha, passa para a próxima. Qualquer outro erro, ou o erro da última senha, é relançado. Isso cumpre P2 (ordem), P3 (outro erro interrompe) e RF-06 (fallback por senha, nessa ordem).

**Alternativas consideradas.**
- *Passar um objeto `PasswordHash` para o iron.* Descartada: o iron resolve senhas por `id` (`src/utils/internal/iron-crypto.ts:121-128`), e o selo atual grava `id` vazio. Usar ids mudaria o formato do selo, o que o PRD proíbe.
- *Tentar no `getSession` com `try`/`catch` em volta de `unsealSession`.* Descartada: duplicaria a lógica de expiração e de fallback, e `unsealSession` é exportada, então ela precisa aceitar extras sozinha.
- *Tentar qualquer erro e não só `"Bad hmac value"`.* Descartada: uma sessão expirada seria tentada de novo com cada extra, multiplicando PBKDF2 sem ganho (contra P3 e R2).

### D-02 — Marcar "aberta por senha extra" com um símbolo interno, igual a `kLegacySeal`

**Escolha.** Novo símbolo `kSealedWithExtra` em `src/utils/internal/session.ts`, com `Symbol.for("h3.internal.session.extra-password")`. `unsealSession` o define como `true` só quando a senha vencedora não é a primeira. `getSession` o lê e apaga antes do `Object.assign`, exatamente como `kLegacySeal` (`src/utils/session.ts:199-201`).

Só marcar quando for extra mantém o caminho normal sem nenhum símbolo extra, o que ajuda RF-04.

**Alternativas consideradas.**
- *Devolver `{ unsealed, extra }` de `unsealSession`.* Descartada: mudaria o retorno da função exportada (`src/index.ts:209`), o que quebra o contrato público e vai contra RF-09.
- *Comparar o cookie com um reseal da senha atual dentro de `getSession`.* Descartada: custa um PBKDF2 extra e é mais difícil de testar.
- *Símbolo não enumerável via `Object.defineProperty`.* Descartada por divergir do padrão de `kLegacySeal`. O custo é que quem chama `unsealSession` diretamente vê o símbolo no objeto. É o mesmo custo que `kLegacySeal` já tem.

### D-03 — Regravar sessões extra pelo ramo de reseal já existente

**Escolha.** Em `src/utils/session.ts:214`, a condição vira `session.id && sessionFromCookie && (legacySeal || sealedWithExtra || shouldSlide(session, config))`. O reseal chama `updateSession(event, config)` (`:215`), que sela com `config.password` (`:300`). RF-03 e RF-02 saem daí sem código novo de selagem.

`sessionFromCookie` continua sendo o que impede regravar sessão lida do header (RF-08). Não é preciso condição nova.

**Alternativas consideradas.**
- *Regravar só quando a sessão for escrita.* Descartada: o PRD exige a migração na leitura (RF-03, P1).
- *Regravar em `unsealSession`.* Descartada: `unsealSession` não tem o `event` útil nem o contexto, e misturaria leitura com escrita.
- *Regravar a cada leitura com senha extra mesmo que o cookie já esteja na senha atual.* Não se aplica: senhas extras só entram quando a atual falhou, então a condição já é exata.

### D-04 — Validar `extraUnsealPasswords` no início de `getSession`

**Escolha.** Função interna `assertExtraUnsealPasswords(config)` chamada em `getSession` logo depois de `sessionName` (`src/utils/session.ts:153`), antes de `context.sessions` ser criado (`:158-160`). `useSession` chama `getSession` primeiro (`:115`), então ela já fica coberta. `updateSession` chama `getSession` quando não há sessão no contexto (`:251`), então também fica coberta.

Regras, nessa ordem:
1. Se `extraUnsealPasswords === undefined`, não faz nada. RF-04.
2. Se não for array, lança erro.
3. Para cada item, lança erro se não for `string` ou se `length` for menor que o mínimo.

O mínimo é o que o iron aplica à `password`: o maior entre `encryption.minPasswordlength` e `integrity.minPasswordlength` de `config.seal ?? sealDefaults`. Assim, quem sobrescreve `seal` vê a mesma regra nas duas senhas. String vazia cai no mesmo teste, porque `0 < mínimo`.

A mensagem identifica o índice e **não** repete o conteúdo da senha, porque é segredo.

**Alternativas consideradas.**
- *Constante fixa de 32.* Descartada: diverge da `password` se `config.seal` mudar `minPasswordlength`, o que quebra "mesma regra de password" (RF-07).
- *Validar em `useSession`.* Descartada: deixaria `getSession` e `updateSession` sem a validação.
- *Validar também `password`.* Fora do escopo (ver R-3).

### D-05 — Nenhum limite de quantidade no código

**Escolha.** O código não impõe limite para `extraUnsealPasswords`. A JSDoc recomenda uma lista curta e explica o custo, como pede R2.

**Alternativas consideradas.**
- *Limite fixo (por exemplo, 5 itens) com erro.* Descartada: o PRD não pede, e um número arbitrário viraria contrato público difícil de mudar depois.

### D-06 — Ordem e erros: a expiração continua depois do laço

**Escolha.** As checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:349-365`) ficam depois do laço, sem mudança de código. Como o laço só devolve uma sessão já aberta, a expiração não é mascarada (RF-05).

O erro `"Expired seal"` do iron (`src/utils/internal/iron-crypto.ts:115-117`) sai na primeira tentativa, porque é checado antes do HMAC. É idêntico para todas as senhas e não depende de qual senha selou.

### D-07 — Superfície pública e arquivos

**Escolha.** Só o campo novo em `SessionConfig`. Nenhum export novo. `src/index.ts` não muda. Os helpers novos ficam no fim de `src/utils/session.ts`, como manda `AGENTS.md` ("Internal helpers go at the end of files"). Não se cria arquivo novo. O arquivo já tem 464 linhas, acima da meta de 200 de `AGENTS.md`, mas dividi-lo é outra mudança e fica fora do escopo.

**Alternativas consideradas.**
- *Mover o unseal para `src/utils/internal/`.* Descartada agora: aumenta o diff e não é exigido pelo PRD. Pode virar tarefa separada.

## Arquivos a alterar

| Arquivo | Onde | O que muda |
|---|---|---|
| `src/utils/session.ts` | `:48` (após `password`) | Novo campo `extraUnsealPasswords?: string[]` com JSDoc (ver contrato). |
| `src/utils/session.ts` | `:153` (após `sessionName`) | Chamar `assertExtraUnsealPasswords(config)`. |
| `src/utils/session.ts` | `:199-201` | Ler e apagar `kSealedWithExtra`, ao lado de `kLegacySeal`. |
| `src/utils/session.ts` | `:214` | Acrescentar `sealedWithExtra` à condição de reseal. |
| `src/utils/session.ts` | `:312-348` | `unsealSession` passa a chamar `unsealWithPasswords`. O bloco de fallback sai para `unsealWithPassword`. Expiração em `:349-365` fica igual. |
| `src/utils/session.ts` | fim do arquivo | Helpers `unsealWithPassword`, `unsealWithPasswords`, `isBadHmac` e `assertExtraUnsealPasswords`. |
| `src/utils/internal/session.ts` | `:7-9` (após `kLegacySeal`) | Novo símbolo `kSealedWithExtra`. |
| `test/session.test.ts` | antes de `:692` (`describe("lazy creation"`) | Novo bloco `describe("extraUnsealPasswords")` dentro de `describeMatrix`. |

Não alterar: `src/index.ts`, `src/utils/internal/iron-crypto.ts`, `src/_deprecated.ts`, `docs/`, e nenhum teste existente além de inserir o bloco novo. RF-04 exige que a suíte atual passe sem mudança de expectativa.

## Contratos e assinaturas

### Config pública

```ts
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that only open sessions sealed with them. `password`
   * is the one used to seal. Each entry must be at least as long as `password`
   * (32 characters by default). Each extra password costs one full PBKDF2
   * derivation per request that presents a cookie it does not open, so keep the
   * list short, and remove an entry once every session sealed with it has
   * expired (`maxAge` or `idleTimeout`).
   */
  extraUnsealPasswords?: string[];
  // ... demais campos sem mudança
}
```

### Símbolo interno

```ts
// src/utils/internal/session.ts
export const kSealedWithExtra: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-password",
);
```

### Helpers internos (`src/utils/session.ts`, não exportados)

```ts
/** One password: full iterations, then the 1-iteration legacy retry when allowed. Throws the last error. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>>;

/** Tries each password in order. Returns the session and whether it was opened by a non-first password. */
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<{ unsealed: Partial<Session>; extra: boolean }>;

/** Only `"Bad hmac value"` means "wrong password, try the next one". */
function isBadHmac(error: unknown): boolean;

/** Throws if `extraUnsealPasswords` has an entry the seal would not accept. */
function assertExtraUnsealPasswords(config: SessionConfig): void;
```

### Forma esperada do laço (referência, não é cópia literal)

```ts
async function unsealWithPasswords(sealed, passwords, sealOptions, legacySealFallback) {
  for (const [index, password] of passwords.entries()) {
    try {
      const unsealed = await unsealWithPassword(sealed, password, sealOptions, legacySealFallback);
      return { unsealed, extra: index > 0 };
    } catch (error) {
      if (index === passwords.length - 1 || !isBadHmac(error)) throw error;
    }
  }
  // Unreachable: `passwords` always has at least `config.password`.
  throw new Error("No password to unseal with");
}
```

`unsealSession` mantém a assinatura `(_event, config, sealed): Promise<Partial<Session>>`. Dentro, ela chama `unsealWithPasswords([config.password, ...(config.extraUnsealPasswords ?? [])], ...)`, define `kSealedWithExtra` quando `extra` for `true`, e então executa as checagens de expiração de `:349-365` sem mudança.

### Erro de validação

- Mensagem para item inválido: ``Invalid session config: `extraUnsealPasswords[${index}]` must be a string of at least ${minLength} characters.``
- Mensagem para tipo errado: ``Invalid session config: `extraUnsealPasswords` must be an array of strings.``
- Tipo: `Error` comum, como `"Session expired!"` (`src/utils/session.ts:353`). Não é `HTTPError`, porque é erro de programação.

### Comportamento de `getSession` (resumo)

1. Valida `extraUnsealPasswords`. Se inválido, lança antes de qualquer leitura.
2. Lê header ou cookie como hoje.
3. Chama `unsealSession`. Erros são engolidos como hoje (`:197`).
4. Se a sessão abriu, lê e apaga `kLegacySeal` e `kSealedWithExtra`.
5. Se `session.id && sessionFromCookie && (legacySeal || sealedWithExtra || shouldSlide(...))`, chama `updateSession`.

## Estratégia de testes

Tudo em `test/session.test.ts`, dentro de `describeMatrix` (`:15`), para rodar em `web` e `node`. Antes de implementar, escrever os testes e confirmar que falham (AGENTS, "Bug Fix Workflow", aplicado a comportamento novo).

Passwords de teste: `sessionConfig.password` (`:23`) como atual, mais duas constantes de 32+ caracteres para a antiga (`oldPassword`) e uma terceira para outros casos. Selar com `seal(...)` direto, como o teste de legado em `:135-145`, ou com `sealSession` de outra config.

| Teste | RF | Montagem | Verifica |
|---|---|---|---|
| abre sessão selada com senha extra | RF-01 | Rota `getSession`. Cookie selado com `oldPassword`. Config `password: sessionConfig.password`, `extraUnsealPasswords: [oldPassword]`. | `data` e `id` originais, sem erro. |
| sessão selada com a senha atual não regrava | RF-01, RF-03 | Cookie selado com `sessionConfig.password`, extras `[oldPassword]`, sem `idleTimeout`. | Dados originais e nenhum `Set-Cookie`. Garante que o marcador só é ligado para senha extra. |
| sela sempre com a senha atual | RF-02 | Rota `updateSession` com config nova. | Cookie abre com a atual e falha com `oldPassword`. |
| regrava sessão aberta por senha extra | RF-03 | Rota `getSession` com cookie selado com `oldPassword`. | `Set-Cookie` presente. Novo cookie abre com a atual e não com `oldPassword`. |
| sem extras, sessão de outra senha é nova | RF-04 | Duas configs: sem campo e com `[]`. | Sessão nova (id diferente), sem `Set-Cookie`. |
| expiração não é mascarada | RF-05 | Chamar `unsealSession({} as HTTPEvent, config, sealed)` com `createdAt` antigo, `maxAge` e extra. | Lança `Session expired!`. Usar `vi.useFakeTimers` com `toFake: ["Date"]`, como `:344-373`. |
| legado de 1 iteração com senha extra | RF-06 | Selo legado com `oldPassword`, sem `legacySealFallback`. | Abre e regrava com a atual. |
| legado com fallback desligado | RF-06 | Mesmo selo, `legacySealFallback: false`. | Não abre. Sessão nova. |
| rejeita extra curta ou vazia | RF-07 | Rota que chama `getSession` dentro de `try`/`catch` e devolve `error.message`. Casos: `["curta"]`, `[""]`, `"não é array"`. | Mensagem contém `extraUnsealPasswords`. Não contém a senha. |
| header com senha extra | RF-08 | Header `x-h3-test-session` com selo de `oldPassword`. | Dados retornados. Nenhum `Set-Cookie` de sessão. |
| header expirado com senha extra | RF-05, RF-08 | Mesmo header, `createdAt` antigo. | Sessão nova (erro engolido). Sem `Set-Cookie`. |

Atenção ao item de RF-07: `ctx.errors` (`test/_setup.ts`) registra erros não tratados e são asserted em `afterEach` (AGENTS). Por isso o erro é capturado dentro da rota e devolvido no corpo, sem vazar para `ctx.errors`.

Verificação final, nesta ordem:
1. `pnpm vitest run test/session.test.ts`. A suíte existente tem que passar **sem mudança de expectativa** (RF-04).
2. `pnpm typecheck`.
3. `pnpm lint`. Inclui `oxfmt --check`.
4. Opcional: `pnpm test` completo, para checar a cobertura do caminho novo em `src/utils/session.ts`.

## Riscos

- **R-1 — Símbolo vazando para `Object.assign`.** Se `kSealedWithExtra` não for apagado antes de `src/utils/session.ts:208`, ele entra no objeto retornado por `getSession`. O efeito é pequeno (JSON ignora símbolos), mas o marcador deixaria de ser "só para uso interno". Mitigação: apagar em `:199-201` e checar isso na revisão de código, porque o teste de RF-03 observa só o cookie.
- **R-2 — Custo de PBKDF2 por requisição (R2 do PRD).** Cada senha extra que não bate custa um PBKDF2 completo, e o `legacy` é 1 iteração (barato). Um cliente com cookie inválido paga `1 + N` derivações por requisição. Mitigação: sem extras por padrão, aviso na JSDoc, e sem nova tentativa por senha. Não há limite no código (D-05). Risco aceito; monitorar se a lista crescer.
- **R-3 — `password` curta é engolida em silêncio.** Hoje a senha atual sem 32 caracteres dispara `Password string too short` dentro do iron (`src/utils/internal/iron-crypto.ts:193`), e `getSession` a descarta com `.catch(() => {})` (`src/utils/session.ts:197`). RF-07 cobre só as extras. Não é objetivo deste PRD corrigir isso. Recomendo abrir issue separada.
- **R-4 — Regravação concorrente (R4 do PRD).** Duas requisições com a mesma sessão antiga emitem dois `Set-Cookie`, ambos selados com a senha atual. O teste de RF-03 não deve depender de ordem entre cookies: ler o último `Set-Cookie` e verificar a senha.
- **R-5 — Expiração que parece "Expired seal".** Quando o selo em si expira pelo `ttl` do iron (`src/utils/internal/iron-crypto.ts:115-117`), o erro não é `Session expired!`. Isso já acontece hoje e não muda. O teste de RF-05 deve usar `createdAt` antigo com selo de `ttl` zero, como em `:344-373`, para exercitar a checagem certa.
- **R-6 — Símbolo visível em `unsealSession` pública.** Como em `kLegacySeal`, quem chama a função exportada vê o símbolo. É consistente com o código atual. Aceito (D-02).
- **R-7 — Crescimento de `session.ts`.** O arquivo passa de 464 linhas e fica mais longo. Dividir é tarefa separada (D-07).
- **R-8 — Documentação de `docs/` não atualizada.** Fora do escopo do PRD. O campo fica documentado só na JSDoc. Pode virar tarefa separada.
