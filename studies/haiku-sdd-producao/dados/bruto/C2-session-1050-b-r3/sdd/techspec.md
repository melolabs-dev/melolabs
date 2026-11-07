# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-08, P-01 a P-05, R-01 a R-06) e a issue h3js/h3#1050.

Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `8a62389`).

## Resumo

- `SessionConfig` ganha `extraUnsealPasswords?: string[]`. É o único nome público novo.
- `unsealSession` passa a tentar `password` e depois cada senha extra, em ordem, até uma validar a sessão. Só o erro de HMAC (senha errada) avança para a próxima senha. Qualquer outro erro é propagado na hora.
- A selagem continua exclusivamente com `password`, como já é hoje.
- Sessão aberta com senha extra é marcada internamente e regravada em `getSession` com a senha atual, pelo mesmo gatilho que já existe para o fallback legado.
- Extras inválidos (não-string, vazio ou abaixo do tamanho mínimo) geram erro explícito em `getSession` e em `unsealSession`, fora do `.catch` que engole falhas de unseal.
- `src/utils/internal/iron-crypto.ts` não muda. O `unseal` já aceita uma senha por chamada.

---

### D-01 — Onde implementar a tentativa de várias senhas

**Contexto.** O unseal com uma senha está em `unsealSession` (`src/utils/session.ts:312-367`), que chama `unseal(sealed, config.password, sealOptions)` em `src/utils/session.ts:324`. Essa função é exportada publicamente (`src/index.ts:209`, verificada também em `test/unit/package.test.ts:149`).

**Alternativas consideradas.**

1. **Usar o `PasswordHash` nativo do iron** (`unseal(sealed, { [id]: senha, ... })`, `src/utils/internal/iron-crypto.ts:124-127`). Rejeitada. O iron escolhe a senha pelo `passwordId` gravado no cookie. Os cookies atuais têm id vazio, que vira `"default"`. Usar esse caminho exigiria gravar ids nos cookies, o que muda o formato e contraria P-01 e a restrição "sem mudar o formato do cookie" do PRD.
2. **Nova função pública** (ex.: `unsealWithPasswords`). Rejeitada. O PRD proíbe qualquer outro nome público novo.
3. **Loop dentro de `unsealSession`, com a lógica de uma senha extraída para um helper interno** (`unsealWithPassword`, não exportado). **Escolhida.** Não cria nome público, não muda a assinatura de `unsealSession` e mantém o fallback legado exatamente como está, agora por senha.

**Escolha.** Helper interno `unsealWithPassword` com o `try/catch` do fallback legado atual (`src/utils/session.ts:325-347`), e `unsealSession` percorre a lista de senhas.

### D-02 — Critério para avançar para a próxima senha e erro propagado

**Contexto.** No código atual, o único erro que depende da senha é `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:136`). Os outros erros de `unseal` são independentes da senha: `"Incorrect number of sealed components"`, `"Wrong mac prefix"`, `"Invalid expiration"`, `"Expired seal"` (`src/utils/internal/iron-crypto.ts:100-117`). Eles acontecem antes do HMAC.

**Alternativas consideradas.**

1. Avançar para a próxima senha em qualquer erro. Rejeitada. Repetiria trabalho de PBKDF2 para erros que não dependem da senha e pode mascarar erros reais.
2. Avançar só em `"Bad hmac value"`, mesmo critério do fallback legado (`src/utils/session.ts:332-337`). **Escolhida.**

**Escolha.**

- Avança para a próxima senha somente se `error instanceof Error && error.message === "Bad hmac value"`.
- Qualquer outro erro é lançado imediatamente.
- Se nenhuma senha validar, lança o erro da primeira tentativa. A mensagem é a mesma de hoje.
- Use uma flag (`found`) e não `if (!unsealed)`. `unseal` pode retornar `null` com payload vazio, e esse caso precisa continuar se comportando como hoje.

### D-03 — Fallback legado por senha, não global

**Contexto.** Hoje, o fallback de 1 iteração do PBKDF2 (`src/utils/session.ts:340-344`) é tentado depois do 8192 falhar.

**Alternativas consideradas.**

1. Tentar 8192 com todas as senhas e só depois 1 iteração com todas. Mais barato para sessões legadas com senha extra, mas exige reescrever a lógica de fallback e torna o código mais difícil de ler.
2. Para cada senha, rodar o ciclo completo (8192, depois 1 se `legacySealFallback !== false`). **Escolhida.** Mantém o fallback como está, só dentro de `unsealWithPassword`. O custo máximo passa a ser 2 por senha (R-02 do PRD).

### D-04 — Marcador interno de "aberta com senha extra"

**Contexto.** `getSession` já usa o símbolo interno `kLegacySeal` para marcar a sessão que precisa ser regravada (`src/utils/session.ts:199-201`, `:214`, `:346`). O símbolo é definido em `src/utils/internal/session.ts:7-9`.

**Alternativas consideradas.**

1. Reusar `kLegacySeal` com outro significado. Rejeitada. Mistura dois motivos diferentes e dificulta a leitura.
2. Retornar tupla `[session, passwordIndex]` de `unsealSession`. Rejeitada. `unsealSession` é API pública (`src/index.ts:209`), e mudar o retorno quebraria quem já a usa.
3. Novo símbolo interno `kRotatedSeal`, espelhando `kLegacySeal`. **Escolhida.**

**Escolha.**

- Adicionar em `src/utils/internal/session.ts` (após a linha 9):
  ```ts
  export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
    "h3.internal.session.rotated-seal",
  );
  ```
- Em `getSession`, remover o símbolo antes de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`), no mesmo ponto em que `kLegacySeal` é removido (`:199-201`). Sem isso, o símbolo entra no objeto da sessão em memória. O `Object.assign` copia símbolos enumeráveis.

### D-05 — Gatilho de regravação (RF-04)

**Contexto.** A condição de reseal está em `src/utils/session.ts:214`: `session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config))`.

**Escolha.** Acrescentar `rotatedSeal` a essa condição. `sessionFromCookie` continua obrigatório, porque sessões de header não podem regravar cookie (`src/utils/session.ts:64-65`, JSDoc de `idleTimeout`). A regravação usa `updateSession`, que chama `sealSession` com `config.password`, então RF-03 e RF-04 valem sem código novo na selagem.

Sessões de header que abrem com senha extra não convergem enquanto o cliente usar só o header. Isso segue P-04 e deve ir para a documentação de migração (fora do escopo).

### D-06 — Validação das senhas extras (RF-07)

**Contexto.** A regra de tamanho mínimo está no iron, em `src/utils/internal/iron-crypto.ts:191-196`, e vale só para senhas `string`. O mínimo padrão é 32 (`src/utils/internal/iron-crypto.ts:22` para criptografia e `:28` para integridade). Em `getSession`, todo unseal fica dentro de `.catch(() => {})` (`src/utils/session.ts:196-198`). Um extra curto cairia nesse `catch` e seria ignorado em silêncio. Por isso a validação precisa acontecer antes, fora da cadeia de promises.

**Alternativas consideradas.**

1. Deixar o iron lançar `"Password string too short"` na tentativa. Rejeitada. Viola RF-07 (erro engolido) e não identifica qual extra está errado.
2. Validar só em `unsealSession`. Rejeitada. `getSession` a chama dentro do `.catch`, então o erro seria engolido.
3. Validar em `getSession`, antes de criar a sessão no contexto, e também no início de `unsealSession` para quem usa a API pública diretamente. **Escolhida.**

**Escolha.**

- Limite efetivo = `Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)`. É o valor que o unseal exige para passar nas duas etapas. Usa as opções efetivas, então um `config.seal` customizado é respeitado.
- Mensagem sem o conteúdo da senha (R-05): `Invalid session extra password at extraUnsealPasswords[${index}]: must be a string of at least ${min} characters`.
- Não-array em `extraUnsealPasswords` também gera erro.

### D-07 — Senha extra igual a `password` (R-04)

**Alternativas consideradas.**

1. Lançar erro de configuração. Rejeitada. Durante a rotação, a aplicação pode manter a senha atual na lista de extras para facilitar o deploy, e o erro atrapalharia.
2. Ignorar silenciosamente. **Escolhida.** Filtra no momento de montar a lista de tentativas, então não gasta PBKDF2 duplicado.

### D-08 — Ordem de tentativas e custo

Cada tentativa de senha com cookie inválido custa pelo menos um PBKDF2 de 8192 iterações (o HMAC é verificado antes da decriptação). Com `N` extras, um cookie inválido passa a custar `1 + N` PBKDF2, e até `2 × (1 + N)` com o fallback legado. Isso é o R-01 do PRD. Não criamos limite rígido. Recomendamos documentar um número pequeno de extras e medir com `pnpm bench:node` antes de fechar.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | Campo `extraUnsealPasswords` com JSDoc em `SessionConfig` (após `src/utils/session.ts:48`). Validação em `getSession` antes de `src/utils/session.ts:167`. Remoção de `kRotatedSeal` antes de `src/utils/session.ts:208`. Condição de reseal em `src/utils/session.ts:214`. Refatoração de `unsealSession` (`src/utils/session.ts:312-367`) com `unsealWithPassword` e o loop. Helpers internos ao final do arquivo. |
| `src/utils/internal/session.ts` | Novo símbolo `kRotatedSeal` após `src/utils/internal/session.ts:9`. |
| `test/session.test.ts` | Novos testes matriciais (ver estratégia). Os testes existentes não mudam. |

Não alterar:

- `src/utils/internal/iron-crypto.ts`: o `unseal` já aceita uma senha por chamada. Mudança aqui só se o bench indicar necessidade.
- `src/index.ts:208-209`: nenhum export novo.
- `test/unit/package.test.ts:125,149`: a lista de exports não muda.

Fora do escopo, mas a registrar: `docs/2.utils/4.security.md:56-60` documenta `sealSession` e `unsealSession`. Com a mudança, `unsealSession` passa a usar as senhas extras quando estiverem no `config`. O PRD exclui documentação fora do JSDoc, então isso fica pendente.

## Contratos e assinaturas

Público (única adição):

```ts
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords, used only to unseal sessions sealed before a rotation.
   * ...each must be at least as long as `password`. Sessions opened with one of
   * them are resealed with `password` on their next write or read.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}
```

Internos (`src/utils/session.ts`, não exportados):

```ts
/** Senhas tentadas por `unsealSession`, na ordem. `password` primeiro, sem duplicatas. */
function unsealPasswords(config: SessionConfig): string[];

/** Lança erro se algum item de `extraUnsealPasswords` for inválido. */
function assertExtraUnsealPasswords(config: SessionConfig, sealOptions: SealOptions): void;

/** Uma tentativa com uma senha, incluindo o fallback legado de 1 iteração. */
function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>>;
```

Comportamento de `unsealSession` (assinatura pública inalterada):

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Esboço do loop:

```ts
const sealOptions = { ...sealDefaults, ttl: ..., ...config.seal };
assertExtraUnsealPasswords(config, sealOptions);

let unsealed: Partial<Session> | undefined;
let found = false;
let firstError: unknown;
for (const [index, password] of unsealPasswords(config).entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback);
    if (index > 0) (unsealed as any)[kRotatedSeal] = true;
    found = true;
    break;
  } catch (error) {
    if (index === 0) firstError = error;
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
  }
}
if (!found) throw firstError;
// maxAge / idleTimeout checks: inalterados
```

`unsealSession` continua aplicando `maxAge` e `idleTimeout` depois do loop (RF-06).

Em `getSession`, dentro do `.then`, depois de remover `kLegacySeal`:

```ts
const rotatedSeal = unsealed && (unsealed as any)[kRotatedSeal];
if (rotatedSeal) delete (unsealed as any)[kRotatedSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

## Estratégia de testes

Seguir o fluxo de correção de bug do `AGENTS.md`: escrever os testes novos antes da implementação e confirmar que eles falham.

Arquivo: `test/session.test.ts`, com `describeMatrix` (web e node). Padrão a seguir: os testes de legado (`test/session.test.ts:134-186`). Configuração base: `sessionConfig` (`test/session.test.ts:21-25`). Selagem de cookies antigos com `seal` de `src/utils/internal/iron-crypto.ts` e `sealDefaults`, como nos testes existentes.

Casos (cada um mapeia para o PRD):

1. **Abre com senha extra e regrava com a atual** (RF-02, RF-04): cookie selado com `senhaAntiga`. Config `password: senhaNova`, `extraUnsealPasswords: [senhaAntiga]`. Verificar dados preservados, `Set-Cookie` presente, `unseal(resealed, senhaNova)` ok e `unseal(resealed, senhaAntiga)` lança `"Bad hmac value"`.
2. **Sessão nova é selada só com `password`** (RF-03): com extras configurados, criar sessão, verificar que o cookie não abre com a senha extra.
3. **Senha desconhecida é tratada como sessão inválida** (RF-02, falha): cookie com uma terceira senha. A resposta traz id novo, como com senha errada hoje.
4. **Sessão legada (1 iteração) com senha extra** (R-02): abre com a senha extra e é regravada com 8192 iterações.
5. **Expiração independe da senha** (RF-06): `createdAt` antigo com `maxAge` curto, cookie com senha extra. Deve falhar com `"Session expired!"`, como no teste de `maxAge` existente.
6. **Header de sessão** (RF-08): sessão selada com `senhaAntiga` enviada em `x-h3-test-session`. Dados lidos, sem `Set-Cookie`.
7. **Extra inválido falha antes de abrir cookie** (RF-07): `extraUnsealPasswords: ["curta"]`. `getSession` rejeita com mensagem que cita `extraUnsealPasswords[0]` e não contém o valor `"curta"`. Repetir para extra não-string.
8. **Senha extra igual a `password` é ignorada** (D-07): sessão selada com `password` abre normalmente e o número de tentativas não muda.
9. **Sem extras: comportamento inalterado** (RF-05): a suíte existente passa sem alteração de asserções. Os testes de legado e de `legacySealFallback: false` (`test/session.test.ts:134-186`) são o principal guarda-corpo.
10. **Erro não relacionado à senha não avança** (D-02): cookie malformado (`"a*b"`) com extras lança `"Incorrect number of sealed components"` e não tenta as extras. Testar via `unsealSession` direto, já que `getSession` engole o erro.
11. **Tipo** (RF-01): `pnpm typecheck` com `SessionConfig` com e sem `extraUnsealPasswords`.

Verificação final: `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test`. Opcional: `pnpm bench:node` antes e depois, para medir o custo de cookies inválidos com N extras (R-01).

## Riscos

- **R-01 — Custo de CPU em cookies inválidos** (D-08). Cada extra adiciona um PBKDF2 de 8192 iterações por requisição com cookie que não abre. Como o cookie vem do cliente sem autenticação, isso é uma superfície de amplificação. Mitigação: documentar poucas extras e medir com o bench.
- **R-02 — Combinação com o fallback legado** (D-03). Até 2 tentativas por senha. Coberto pelo caso 4 de testes.
- **R-03 — Retenção de senhas antigas**. Se as extras ficarem para sempre, senhas vazadas continuam valendo para sessões não regravadas. Mitigação: documentação (fora do escopo desta entrega).
- **R-04 — Duplicata**. Resolvido por D-07.
- **R-05 — Vazamento em erro**. A mensagem de validação não inclui o valor (D-06). A mensagem de tamanho do iron (`src/utils/internal/iron-crypto.ts:193-195`) também não inclui o valor. Revisar na revisão de código.
- **R-06 — Regressão silenciosa**. Qualquer erro no loop afeta todas as sessões. Mitigação: o caso 9 e a suíte matricial.
- **R-07 — Símbolo vazando para a sessão em memória**. Se `kRotatedSeal` não for removido antes de `Object.assign` (`src/utils/session.ts:208`), ele aparece no objeto da sessão. Coberto por D-04. Vale verificar que `session` não tem o símbolo nos testes de rotação.
- **R-08 — Erro de validação engolido**. Se a validação for colocada dentro do `.catch` de `src/utils/session.ts:197`, o erro some e o extra inválido é ignorado. D-06 posiciona a validação antes da cadeia. O caso 7 cobre isso.
- **R-09 — Convergência limitada a cookies**. Clientes que só usam header continuam com a senha antiga até a expiração (P-04). Aceitável, mas precisa estar na documentação.
- **R-10 — Estado parcial em `getSession`**. Se a validação lançar depois de `context.sessions[sessionName] = session` (`src/utils/session.ts:173`), o contexto fica com uma sessão vazia. Por isso D-06 exige validar antes de `src/utils/session.ts:167`.
- **R-11 — Mudança de comportamento em `unsealSession` pública**. Quem chama `unsealSession` com um `config` que já tiver `extraUnsealPasswords` passa a abrir sessões com as senhas extras. É o comportamento desejado, mas precisa ir para o changelog ou a documentação.
