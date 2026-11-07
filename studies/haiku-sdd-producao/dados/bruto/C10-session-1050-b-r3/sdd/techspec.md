# Especificação técnica: múltiplas senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato enxuto #1050-b), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1050.

Escopo: adicionar `SessionConfig.extraUnsealPasswords?: string[]`. Senhas extras só abrem sessões. A selagem continua sempre com `password`. Nenhum outro export público novo.

## Estado atual (conferido no código)

- `src/utils/session.ts:39` declara `SessionConfig`. `password: string` está na linha 48 e `legacySealFallback` na linha 95.
- `src/utils/session.ts:149-153`: `getSession` lê `config.name` e cria o placeholder `context.sessions` nas linhas 157-173. Qualquer validação colocada depois de 173 deixaria uma sessão meio construída no contexto.
- `src/utils/session.ts:194-198`: a leitura do selo chama `unsealSession(...).catch(() => {})`. Um erro lançado dentro de `unsealSession` é engolido e o visitante recebe uma sessão nova. Por isso validação em `unsealSession` não serve para RF-08.
- `src/utils/session.ts:199-201`: `getSession` lê e remove o marcador `kLegacySeal` antes do `Object.assign`.
- `src/utils/session.ts:214`: a reselagem acontece com `legacySeal || shouldSlide(session, config)` e só para sessões vindas do cookie (`sessionFromCookie`).
- `src/utils/session.ts:300-304`: `sealSession` sela com `config.password`. Não precisa mudar.
- `src/utils/session.ts:312-348`: `unsealSession` chama `unseal(sealed, config.password, sealOptions)` na linha 324. O fallback legado (`legacySealFallback`) está em 332-347 e só age quando o erro é `"Bad hmac value"`. A linha 326-331 tem o TODO da v3.
- `src/utils/session.ts:350-365`: verificações de `maxAge` e `idleTimeout`, feitas sobre o objeto já aberto.
- `src/utils/internal/session.ts:7-9`: símbolo `kLegacySeal` (`Symbol.for("h3.internal.session.legacy-seal")`). É o padrão a seguir para o novo marcador.
- `src/utils/internal/iron-crypto.ts:87-91`: `unseal(sealed, password, opts)`. Com `password` em string, o identificador do selo é ignorado (122-123). A ausência de HMAC válido lança `"Bad hmac value"` (135-137). `"Expired seal"` é lançado antes do HMAC (115-117), então é igual para todas as chaves.
- `src/utils/internal/iron-crypto.ts:14-30`: `defaults` com `minPasswordlength: 32` em `encryption` e `integrity`. A checagem de tamanho acontece em `generateKey` (191-196).
- `src/index.ts:203` exporta `type SessionConfig`. `src/index.ts:208-209` exporta `sealSession` e `unsealSession`. `test/unit/package.test.ts` mantém a lista de exports e falha se algum export novo aparecer.
- `test/session.test.ts:15` abre `describeMatrix("session", ...)`, que roda cada teste em web e node. `sessionConfig` está em 21-25. Os testes de legado estão em 134-186 e os de idle em 188-229. `seal`, `unseal`, `defaults as sealDefaults`, `getSession`, `updateSession` já são importados (1-13).
- `tsconfig.json` inclui `src` e `test`, então `pnpm typecheck` também verifica os testes.
- `docs/2.utils/4.security.md` é gerado por automd a partir do JSDoc das funções. `SessionConfig` não aparece nele, então não precisa editar. `docs/4.examples/handle-session.md` é manual: a seção "Options" está em 120-150 e "Expiration" começa em 151.

## Decisões de arquitetura

### D-01 — Laço de tentativas dentro de `unsealSession`, por senha: atual e depois legado

Ordem: `password`, depois cada item de `extraUnsealPasswords` na ordem do array. Para cada senha, primeiro tenta o selo atual e, se falhar com `"Bad hmac value"` e o fallback estiver ativo, tenta o legado com 1 iteração. Só `"Bad hmac value"` avança para a próxima senha. Qualquer outro erro (`"Expired seal"`, `"Wrong mac prefix"`, `"Incorrect number of sealed components"`, `"Password string too short"`) é relançado na hora, porque ele não depende da chave.

Se nenhuma senha abrir, relança o erro da primeira senha (`password`). Sem extras, o laço tem uma única iteração e o erro é o mesmo de hoje.

Alternativas:
- (a) Tentar todos os selos atuais e só depois todos os legados. Reduz o trabalho de sessões legadas abertas pela última senha, mas diverge do "mesma ordem de RF-03" do RF-06.
- (b) Avançar para a próxima senha em qualquer erro. Rejeitada: repetiria o custo de `"Expired seal"` N vezes e mascararia erros de configuração, como uma `password` curta.

Escolhida: o literal do RF-06. O custo extra da intercalação é pequeno: uma tentativa legada faz uma única iteração PBKDF2 e falha antes da decifragem.

### D-02 — Marcador interno `kExtraSeal` para "aberta por senha extra"

`unsealSession` marca o objeto aberto com `kExtraSeal` quando a senha que abriu não é a de índice 0. `getSession` lê o marcador, remove-o antes do `Object.assign` (como faz com `kLegacySeal`, `src/utils/session.ts:199-201`) e o usa na condição de reselagem.

Alternativas:
- (a) Mudar o retorno de `unsealSession` para `{ session, extraSeal }`. Rejeitada: `unsealSession` é export público (`src/index.ts:209`) e a mudança quebraria quem a chama.
- (b) Comparar o selo recebido com um selo recalculado. Rejeitada: custo de uma selagem extra por requisição.

Escolhida: símbolo interno, com o mesmo padrão já usado para `kLegacySeal`.

### D-03 — Validação de `extraUnsealPasswords` no início de `getSession`

A função `assertExtraUnsealPasswords(config)` roda como primeira instrução de `getSession`, antes do retorno da sessão já existente (`src/utils/session.ts:158-165`) e antes do placeholder (173). Assim:
- a validação acontece antes de qualquer leitura de cookie (RF-08);
- um erro não deixa sessão meio criada no contexto;
- `useSession` e `updateSession` herdam a validação, porque chamam `getSession` quando a sessão não existe no contexto.

Alternativas:
- (a) Validar dentro de `unsealSession`. Rejeitada: o erro cairia no `.catch(() => {})` de `src/utils/session.ts:197` e seria engolido.
- (b) Validar em `useSession`, `updateSession` e `getSession`. Rejeitada: três cópias e cobertura igual à de `getSession` sozinho.

Escopo: só `extraUnsealPasswords`. `password` continua sem validação (PRD, Premissas). O tamanho mínimo vem das mesmas opções de selo usadas para abrir: `max(encryption.minPasswordlength, integrity.minPasswordlength)` de `{ ...sealDefaults, ...config.seal }`. Com os defaults, isso dá 32.

### D-04 — Reselagem: estender a condição existente de `getSession`

A condição de `src/utils/session.ts:214` passa a ser `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))`. Sessões lidas pelo header (`sessionFromCookie === false`) nunca são resseladas, como hoje. A reselagem usa `updateSession`, que sela com `config.password` (`src/utils/session.ts:267` chama `sealSession`, que usa `password` em 300).

Alternativa: resselar dentro de `unsealSession`. Rejeitada: a função não tem acesso a `updateSession` nem ao contexto da requisição.

### D-05 — Selagem e expiração sem mudança

`sealSession` (`src/utils/session.ts:282-307`) e `updateSession` (241-277) não mudam. As checagens de `maxAge` e `idleTimeout` (350-365) continuam sobre o objeto aberto depois do laço, então RF-09 vale para qualquer senha sem código novo.

### D-06 — Superfície pública: só o campo novo

Nenhum helper novo é exportado. `assertExtraUnsealPasswords` e `unsealWithPassword` ficam como funções de módulo não exportadas, no fim de `src/utils/session.ts`, como `shouldSlide` (414). `unsealSession` mantém a assinatura. O símbolo `kExtraSeal` fica em `src/utils/internal/session.ts`, que não é exportado publicamente.

## Contratos e assinaturas

### Campo público

```ts
// src/utils/session.ts, inserir após a linha 48 (depois de `password: string;`)
  /**
   * Previous passwords that can still open sessions sealed with them. They are
   * tried after `password`, in array order, and are never used to seal: new and
   * resealed sessions always use `password`. Sessions opened with one of them
   * are resealed with `password` when read from the cookie. Each entry needs the
   * same entropy as `password` (at least 32 random characters). Remove an entry
   * once the sessions it sealed have expired, since it stays valid until then.
   */
  extraUnsealPasswords?: string[];
```

### Símbolo interno

```ts
// src/utils/internal/session.ts, após a linha 9
export const kExtraSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-seal",
);
```

Importar em `src/utils/session.ts:5`: `import { kGetSession, kLegacySeal, kExtraSeal, kSessionNew } from "./internal/session.ts";`

### Helpers internos (não exportados)

```ts
/** Lança Error se alguma senha extra for inválida. Erro cita o índice e o mínimo. */
function assertExtraUnsealPasswords(config: SessionConfig): void;

/**
 * Abre `sealed` com uma senha em string. Contém o try/catch atual de
 * unsealSession (src/utils/session.ts:322-348), trocando `config.password` pela
 * senha recebida. Marca `kLegacySeal` quando abriu pelo fallback. Relança
 * "Bad hmac value" se nem o selo atual nem o legado abrirem.
 */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean,
): Promise<Partial<Session>>;
```

`SealOptions` já é importado como tipo em `src/utils/session.ts:9`.

### Corpo de `unsealSession` (assinatura inalterada)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let unsealed: Partial<Session> | undefined;
  let firstError: unknown;
  for (const [index, password] of passwords.entries()) {
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback !== false);
      if (index > 0 && unsealed) (unsealed as any)[kExtraSeal] = true;
      break;
    } catch (error) {
      firstError ??= error;
      if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
    }
  }
  if (!unsealed) throw firstError;
  // maxAge e idleTimeout: sem mudança (src/utils/session.ts:350-365)
  return unsealed;
}
```

Observação: `unsealed` pode ser `null` quando o JSON decifrado é `null` (`iron-crypto.ts:149`). Hoje isso já quebra em `unsealed.createdAt`. A versão nova mantém esse comportamento e não deve ser "corrigida" nesta entrega.

### Trecho de `getSession` (src/utils/session.ts:199-214)

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const extraSeal = unsealed && (unsealed as any)[kExtraSeal];
if (legacySeal) {
  delete (unsealed as any)[kLegacySeal];
}
if (extraSeal) {
  delete (unsealed as any)[kExtraSeal];
}
// ... Object.assign(session, unsealed) sem os marcadores ...
// comentário de 211-213 atualizado: também reselar quando aberta por senha extra
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

O `delete` é obrigatório. Sem ele, `Object.assign` copiaria o símbolo para a sessão.

### Erros

| Situação | Erro |
| --- | --- |
| `extraUnsealPasswords[i]` com menos que o mínimo, ou não string | `Error("extraUnsealPasswords[${i}] must be at least ${minLength} characters")` |
| Nenhuma senha abre | `"Bad hmac value"` (como hoje, da primeira senha); `getSession` trata como sessão ausente |

Formato do token: inalterado (`Fe26.2`, 8 partes, identificador de senha vazio).

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:5` | Importar `kExtraSeal`. |
| `src/utils/session.ts:48` | Campo `extraUnsealPasswords` em `SessionConfig` (após `password`). |
| `src/utils/session.ts:149-153` | Chamar `assertExtraUnsealPasswords(config)` como primeira instrução de `getSession`. |
| `src/utils/session.ts:196-221` | Ler e remover `kExtraSeal`; ampliar a condição da linha 214; atualizar o comentário 211-213. |
| `src/utils/session.ts:312-348` | Substituir o try/catch único pelo laço de D-01 e pelo helper `unsealWithPassword`. |
| `src/utils/session.ts` (fim do arquivo) | Helpers `assertExtraUnsealPasswords` e `unsealWithPassword`. |
| `src/utils/internal/session.ts:9` | Novo símbolo `kExtraSeal`. |
| `test/session.test.ts:186` | Novo bloco de testes (descrito abaixo), inserido após o teste de `legacySealFallback: false`. |
| `docs/4.examples/handle-session.md:151` | Nova subseção "Rotate the password" antes de "## Expiration". |

Não mudam: `src/index.ts`, `src/utils/internal/iron-crypto.ts`, `sealSession`, `updateSession`, `CHANGELOG.md` (gerado pelo changelogen).

Atenção de tamanho: `src/utils/session.ts` já tem 464 linhas, acima da meta de 200 do AGENTS.md. A mudança adiciona cerca de 50. Não dividir o arquivo nesta entrega, para manter o diff focado. Registrar como dívida.

## Estratégia de testes

Todos os testes novos vão dentro de `describeMatrix("session", ...)`, para rodar em web e node. Usar `seal` e `unseal` de `src/utils/internal/iron-crypto.ts` para produzir cookies com `P`, `A` e `B`. Usar `vi.useFakeTimers({ toFake: ["Date"] })` para expiração, no mesmo padrão de `test/session.test.ts:188-190`.

Mapeamento para os critérios de aceite do PRD:

| Teste | Requisitos |
| --- | --- |
| Sessão nova emite cookie que abre com `P` e falha com `A` | RF-02 |
| Cookie selado com `B` (de `[A, B]`) carrega `id`, `createdAt` e `data` originais; com `P`, o mesmo; com chave desconhecida, sessão nova | RF-03 |
| Header `x-h3-session` com `A` carrega dados; `updateSession` com cookie `A` mantém dados antigos e novos e emite cookie que abre com `P` | RF-04 |
| Token sem extras tem 8 partes, `[0] === "Fe26.2"`, `[1] === ""` | RF-05 |
| Legado com `A`: carrega e reselar com `P`; com `legacySealFallback: false`, sessão ausente | RF-06 |
| Cookie com `A` gera `Set-Cookie` que abre com `P`; reler sem extras carrega os dados; header com `A` não gera `Set-Cookie` | RF-07 |
| `["curta"]` e `[""]` lançam em `getSession` citando `[0]` e `32`; `[]` não lança; validação ocorre mesmo sem cookie | RF-08 |
| `maxAge: 60` com `A` expira aos 61 s; `idleTimeout: 60` com `A` expira após 61 s ociosos | RF-09 |
| `extraUnsealPasswords: "uma-string"` com `@ts-expect-error` compila; sem o campo, compila | RF-01 |
| Exports: `test/unit/package.test.ts` continua igual | RF-10 |

Teste extra recomendado: chamar `unsealSession` direto com um selo expirado e extras configuradas. Deve lançar `"Expired seal"` sem tentar as extras. Isso protege D-01.

Ordem de trabalho (AGENTS.md, "Bug Fix Workflow", aplicado a feature): escrever os testes novos primeiro, rodar `pnpm vitest run test/session.test.ts` e confirmar que os novos falham. Depois implementar.

Comandos de verificação:
- `pnpm vitest run test/session.test.ts`: sessão completa.
- `pnpm vitest run test/unit/`: inclui `package.test.ts`.
- `pnpm typecheck`.
- `pnpm lint`.
- `pnpm test` antes de fechar: lint, typecheck e cobertura completa.

Os testes existentes em `test/session.test.ts` devem passar sem alteração de expectativa, em especial os de concorrência (`:99`), lazy creation (`:692`) e legado (`:134-186`).

## Riscos

1. **Amplificação de custo sob requisições forjadas (DoS).** Um cookie inválido, sem nenhuma senha válida, custa `N + 1` derivações PBKDF2 de 8192 iterações, mais `N + 1` tentativas legadas de 1 iteração. Hoje custa 1 e 1. Uma sessão aberta pela última de `N` extras custa `N + 2`, contra 2 hoje. Qualquer cliente anônimo pode disparar isso. Mitigação: documentar que a lista deve ser curta (2 ou 3 no máximo) e medir o custo antes de liberar. Não há limite rígido no PRD; se o time quiser, a alternativa é limitar o tamanho da lista na validação.
2. **Senha antiga vazada.** Enquanto estiver na lista, ela abre sessões. Mitigação: documentação em `handle-session.md` e RF-07 (cookies ativos migram).
3. **`password` curta interrompe o laço.** Se `password` tiver menos de 32 caracteres, `generateKey` lança `"Password string too short"` (`src/utils/internal/iron-crypto.ts:192-194`). Esse erro não é `"Bad hmac value"`, então o laço para e as extras nunca são tentadas. Hoje a configuração já falha para todas as sessões, então o efeito é o mesmo. Fica fora do escopo porque `password` não é validado nesta entrega (PRD, Premissas).
4. **Erros de `password` continuam engolidos.** `getSession` mantém `.catch(() => {})` (`src/utils/session.ts:197`). Só as extras têm erro explícito (RF-08). Mitigação: documentar; mudança para `password` fica para outra entrega.
5. **Concorrência.** Toda a lógica nova roda dentro da promise de `kGetSession`, sem `await` novo fora dela. A validação precede o placeholder (D-03), então duas chamadas concorrentes com config inválida falham juntas e não deixam estado parcial. Os testes de concorrência existentes devem continuar passando.
6. **Compatibilidade com `legacySealFallback: false`.** Sem extras, o comportamento é idêntico, com o mesmo erro. Com extras, uma sessão legada sob `A` agora é aberta (RF-06). É o comportamento pedido.
7. **Tamanho do arquivo.** Ver "Arquivos a alterar". É dívida, não bloqueio.
8. **Senhas duplicadas.** `extraUnsealPasswords` não deduplica nem compara com `password`. Não causa erro, só custo extra. Documentado no TSDoc como lista de senhas anteriores.
