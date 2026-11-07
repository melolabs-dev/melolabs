# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050, variante B)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-08). Todas as citações foram conferidas no código atual (`master`, commit `b86d880`).

## Visão geral

`useSession`/`getSession` leem o cookie com `unsealSession` (`src/utils/session.ts:312`), que chama o `unseal` do iron com uma única `config.password`. A mudança:

1. adiciona `extraUnsealPasswords?: string[]` a `SessionConfig`;
2. faz `unsealSession` tentar `password` e depois cada extra, em ordem, parando na primeira que valida;
3. valida o tamanho das extras antes de qualquer leitura;
4. marca sessões abertas com uma extra para serem resealadas com `password` logo após a leitura.

A selagem continua exclusivamente com `config.password` (`src/utils/session.ts:300`), sem alteração nessa linha.

---

### D-01 — Onde fica o laço de tentativas

**Escolha:** dentro de `unsealSession` (`src/utils/session.ts:312`), que é a função que já encapsula o `unseal` e o fallback legado.

**Alternativas:**
- Laço dentro de `getSession`, em volta de `unsealSession` (`src/utils/session.ts:196`). Descartada: `unsealSession` é exportada publicamente (`src/index.ts:209`), e quem a chama diretamente deixaria de ganhar o recurso.
- Laço em `src/utils/internal/iron-crypto.ts` (ex.: `unseal` aceitando lista). Descartada pelo PRD (fora de escopo, salvo o estritamente necessário) e porque o iron já tem o ponto certo para a tentativa: `unseal` recebe uma senha por chamada.

**Justificativa:** a mudança fica restrita a `session.ts`, e o comportamento com lista vazia ou ausente é idêntico ao atual (um único `unseal`).

### D-02 — Não alterar `iron-crypto.ts`

**Escolha:** nenhuma alteração em `src/utils/internal/iron-crypto.ts`.

**Alternativa considerada:** usar o suporte a `PasswordHash` (ids de senha) do próprio iron (`src/utils/internal/iron-crypto.ts:427`, lookup em `:124-128`). Descartada: o id do token é o que `seal` grava em `normalizePassword` (`:68`, `:306`). Com `password` como string o id é `""`, então todas as sessões seladas hoje trazem o mesmo id e não há como distinguir a senha pelo token. O laço por senha é o único caminho sem mudar o formato selado.

**Consequência:** `iron-crypto.ts` continua intocado e os testes unitários dele (`test/unit/iron-crypto.test.ts`) não mudam.

### D-03 — Critério de "senha errada" para continuar o laço

**Escolha:** continuar para a próxima senha somente quando o erro for exatamente `"Bad hmac value"`. Qualquer outro erro é relançado.

**Alternativas:**
- Continuar em qualquer erro. Descartada: `"Session expired!"` (`src/utils/session.ts:353`, `:363`) e erros de formato (`iron-crypto.ts:100`, `:112`) indicam que a senha certa já foi usada ou que o cookie é inválido. Continuar só gastaria PBKDF2 sem mudar o resultado.
- Tipar o erro (classe ou código) no iron. Descartada: exige mudar `iron-crypto.ts`, contra D-02. A comparação por mensagem já é o padrão do arquivo (`src/utils/session.ts:336`).

**Justificativa:** para senha errada, o `unseal` falha antes de qualquer decriptação em `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:135-137`), tanto na tentativa normal quanto no retry legado.

### D-04 — Extrair a tentativa por senha, com o fallback legado dentro dela

**Escolha:** separar em uma função interna `unsealWithPassword(sealed, password, config, sealOptions)` o bloco `try { unseal } catch { legado }` que hoje está em `src/utils/session.ts:322-348`. `unsealSession` passa a iterar sobre `[config.password, ...extras]` e aplica as checagens de expiração (`:349-365`) uma única vez, sobre o resultado já validado.

**Alternativa:** repetir o bloco legado para cada senha dentro do próprio laço, inline. Descartada por duplicação.

**Justificativa:** RF-06 pede que o fallback legado valha para cada senha candidata. Colocar o legado dentro de `unsealWithPassword` garante isso sem código extra. Expiração fora do laço evita reexecutá-la a cada senha.

### D-05 — Validação das extras (RF-08) antes do `catch` silencioso

**Escolha:** validar as extras no início de `getSession`, antes de ler o cookie (perto de `src/utils/session.ts:153`). A função lança `Error` se alguma extra for curta. Como `getSession` é chamada por `useSession` (`:115`) e por `updateSession` (`:251`), a validação cobre criação e leitura.

**Por que não dentro de `unsealSession`:** a leitura roda em `unsealSession(...).catch(() => {})` (`src/utils/session.ts:196-198`). Um erro de configuração lançado ali seria engolido e a sessão trataria como inexistente, o que contraria RF-08.

**Por que não só na leitura de cookie:** RF-08 diz "criada ou lida". Sem cookie, a validação precisa rodar mesmo assim.

**Comportamento sem a validação:** o iron já recusa senha curta, mas só em `generateKey` (`src/utils/internal/iron-crypto.ts:192-196`), e no caminho de leitura isso seria engolido pelo `.catch`. Por isso a validação explícita é necessária, e não é um detalhe de cosmética.

### D-06 — Mínimo de 32 caracteres derivado das opções de selagem

**Escolha:** o mínimo vem de `minPasswordlength` das opções efetivas: `max(encryption.minPasswordlength, integrity.minPasswordlength)`, usando `sealDefaults` (`src/utils/internal/iron-crypto.ts:22` e `:28`, ambos 32) mesclados com `config.seal`.

**Alternativa:** constante fixa 32. Descartada: se a aplicação elevar o mínimo via `config.seal`, a extra precisa seguir a mesma regra que o iron aplica à `password`.

**Premissa do PRD confirmada:** a regra de 32 caracteres já vale para `password`, mas no momento da selagem/leitura, não na configuração (`src/utils/internal/iron-crypto.ts:192-196`). Por isso RF-08 exige código novo (D-05).

### D-07 — Migração ativa: reselar após leitura com senha extra

**Escolha:** quando a sessão só abriu com uma extra, `getSession` reseala o cookie com `password` na própria leitura, pelo mesmo caminho que hoje já reselas sessões legadas (`src/utils/session.ts:214-216`). A flag vem de um símbolo interno, no padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`).

**Desvio deliberado do PRD:** RF-07 fala em "na próxima escrita de cookie que o H3 já faz". A leitura literal deixa a sessão com a senha antiga até a próxima escrita, que sem `idleTimeout` pode nunca acontecer antes de `maxAge`. Isso impede remover a senha antiga da lista com segurança, e o próprio PRD (riscos, "Segurança") depende dessa remoção.

**Alternativa (literal):** só reselar quando já houver escrita ou `shouldSlide` (`src/utils/session.ts:414`). Fica como plano B se a equipe preferir não emitir `Set-Cookie` em leituras.

**Custo:** um `Set-Cookie` extra, uma única vez por sessão antiga, porque o cookie novo já está com `password`.

**Limite:** sessões lidas por header (`sessionFromCookie` falso, `src/utils/session.ts:189-193`) não são resealadas, como hoje. Isso é coerente com a própria doc de `idleTimeout` (`src/utils/session.ts:64-65`).

### D-08 — Campo público único

**Escolha:** `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig` (`src/utils/session.ts:48`), com JSDoc no estilo dos campos vizinhos. Nenhum export novo em `src/index.ts`. O símbolo interno de D-07 fica em `src/utils/internal/session.ts`, que não é reexportado.

### D-09 — Ordem e semântica de tentativa

**Escolha:** `password` primeiro, depois `extraUnsealPasswords` na ordem da lista; a primeira que valida vence (RF-03). Lista ausente ou vazia não altera nada (RF-04). Duplicatas e iguais a `password` não são removidas: custam uma tentativa a mais, e a aplicação controla a lista.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:39-99` | Campo `extraUnsealPasswords` em `SessionConfig` (após `password`, `:48`). |
| `src/utils/session.ts:149-232` | `getSession`: chamar validação no topo; reselar também quando a flag de extra estiver setada (`:199-216`); apagar a flag antes de `Object.assign` (`:208`). |
| `src/utils/session.ts:312-367` | `unsealSession` vira laço; legado movido para `unsealWithPassword`. |
| `src/utils/internal/session.ts:7-9` | Novo símbolo `kExtraUnsealPassword` (ex.: `Symbol.for("h3.internal.session.extra-unseal-password")`). |
| `test/session.test.ts` | Novo bloco `describe("extraUnsealPasswords")` dentro de `describeMatrix`. Imports (`:1-13`) ganham o que for usado. |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/utils/cookie.ts`, `src/index.ts` (exports já corretos), `test/unit/iron-crypto.test.ts`, asserções de testes existentes.

Opcional, sem mudança de comportamento: extrair `resolveSealOptions(config)` para unificar `{...sealDefaults, ttl, ...config.seal}`, hoje duplicado em `src/utils/session.ts:300-304` e `:317-321`. Só fazer se a validação de D-06 precisar do mesmo cálculo; caso contrário, manter a duplicação atual para o diff ficar menor.

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig
export interface SessionConfig {
  /** ... (existente) */
  password: string;
  /**
   * Previous passwords still accepted to unseal sessions sealed before a
   * rotation. Never used to seal. Tried in order after `password`; each must be
   * at least 32 characters. Remove them once sessions sealed with them have
   * expired (`maxAge`/`idleTimeout`).
   */
  extraUnsealPasswords?: string[];
  // ... restante inalterado
}

// src/utils/session.ts — interno
function assertExtraUnsealPasswords(config: SessionConfig): void;
// Lança Error: `extraUnsealPasswords[${i}] is too short (min ${min} characters required)`

async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
// Contém o try/catch legado atual (src/utils/session.ts:323-348).

// src/utils/session.ts — público, assinatura inalterada
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
// Laço: para cada candidato, unsealWithPassword; continua só se o erro for "Bad hmac value".
// Depois: checagens de maxAge/idleTimeout (inalteradas). Marca kExtraUnsealPassword quando o índice > 0.

// src/utils/internal/session.ts
export const kExtraUnsealPassword: unique symbol;
```

Comportamento de `getSession` (contrato, não assinatura):
- Sem extras: idêntico ao atual.
- Com extras, leitura por extra: `session.id` e `createdAt` preservados; `Set-Cookie` com cookie selado por `password`.
- Sem nenhuma senha válida: sessão nova em memória, sem exceção (RF-05), exatamente como um cookie inválido hoje.
- Extra curta: exceção antes de qualquer I/O de cookie (RF-08).

Pseudocódigo do laço:

```ts
const candidates = [config.password, ...(config.extraUnsealPasswords || [])];
let unsealed: Partial<Session> | undefined;
for (let i = 0; i < candidates.length; i++) {
  try {
    unsealed = await unsealWithPassword(sealed, candidates[i], config, sealOptions);
    if (i > 0) (unsealed as any)[kExtraUnsealPassword] = true;
    break;
  } catch (error) {
    if (i === candidates.length - 1 || !(error instanceof Error) || error.message !== "Bad hmac value") throw error;
  }
}
```

---

## Estratégia de testes

Seguir `AGENTS.md`: `describeMatrix` (web e node), `ctx.app`/`t.fetch`, `generateId` com contador (`test/session.test.ts:21-26`) para provar que o id não muda.

Casos (um `it` por critério do PRD):

1. **RF-03 / RF-07 — leitura com extra:** cookie selado com `OLD` (via `seal` com `sessionConfig.password` trocado); config `{password: NEW, extraUnsealPasswords: [OLD]}`. Esperar dados retornados, mesmo `id`, `Set-Cookie` presente.
2. **RF-02 / RF-07 — reselagem:** o cookie do item 1 é aberto com `NEW` via `unseal` (`sealDefaults`) e **falha** com `OLD`.
3. **RF-03 — ordem:** duas extras `[X, OLD]`; sessão selada com `OLD` abre; sessão selada com `X` também abre sem retry extra (validar que a primeira extra não é a errada, pelo id/dados).
4. **RF-04 — regressão:** sessão selada com `password` atual, com extras presentes, sem idle: nenhum `Set-Cookie` na leitura. Os testes existentes (`test/session.test.ts:134`, `:161`, `:188`, `:311`, `:375`, `:410`, `:476`) passam sem mudar asserções.
5. **RF-05 — senha desconhecida:** cookie com `UNKNOWN`; esperar resposta sem dados, id novo, status 200.
6. **RF-06 — legado:** cookie com 1 iteração de PBKDF2 sob `OLD`; config com extra `OLD`; esperar dados e reselagem com `NEW`. Copiar o padrão de `test/session.test.ts:134-159`.
7. **RF-08 — extra curta:** `extraUnsealPasswords: ["curta"]`; `useSession` sem cookie e `getSession` com cookie devem falhar com a mensagem. Como erro no handler vira 500 (verificar em `test/_setup.ts:127-155` que erros tratados não contam como `unhandled`), o teste pode checar o status e a mensagem do erro lançado chamando `getSession` diretamente, se for mais claro.
8. **Expiração:** sessão selada com `OLD` e `maxAge` vencido: continua expirada (extras não estendem a vida). Reusa o padrão de `test/session.test.ts:375`.
9. **Header:** sessão selada com `OLD` enviada via header: aberta, sem `Set-Cookie` (D-07, limite).
10. **Selagem:** sessão nova com extras presentes é selada com `password` (decodificar e tentar abrir só com `password`).

Verificação:
- `pnpm vitest run test/session.test.ts` (inclui os casos novos e os existentes).
- `pnpm vitest run test/unit/` (garante que `iron-crypto` não mudou de comportamento).
- `pnpm test` (lint + typecheck + coverage). Typecheck cobre RF-01 (`tsc --noEmit`, `package.json`).

Antes da implementação, rodar os casos 1, 2 e 6 contra o código atual para confirmar que falham (fluxo "Bug Fix" de `AGENTS.md`). O caso 4 deve passar antes e depois.

---

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Senha antiga comprometida continua aberta enquanto estiver na lista | Segurança | Documentar no JSDoc (contrato acima) e no PR. Com D-07, a lista pode ser esvaziada depois de `maxAge`, sem esperar a próxima escrita. |
| Custo de PBKDF2: cada extra é uma tentativa de 8192 iterações para sessão com senha antiga, e também para cookie inválido (todas as candidatas falham) | Latência de leitura | Documentar; recomendar poucas extras. Lista vazia não custa nada. |
| Erro engolido pelo `.catch(() => {})` (`src/utils/session.ts:198`) | Logout silencioso em bug do laço | D-05 valida antes; caso 5 e caso 7 cobrem; o laço relança erros diferentes de "Bad hmac value" (D-03). |
| Mudança no caminho de leitura de todas as sessões | Regressão | Lista vazia: caminho idêntico ao atual; suíte existente sem mudança de asserção (RF-04). |
| Dependência de mensagem de erro do iron (`"Bad hmac value"`) | Quebra silenciosa em upgrade do iron | Já é dependência do fallback legado (`src/utils/session.ts:336`); caso 5 falha se a mensagem mudar. |
| Reselagem de leitura emite `Set-Cookie` em GET | Cache intermediário / tráfego | Mesmo efeito já existente para sessões legadas; uma vez por sessão antiga. Documentar. |
| Sessões por header com senha antiga nunca migram | Senha antiga pode ficar necessária até `maxAge` | Limite conhecido, igual a `idleTimeout` com header (`src/utils/session.ts:64-65`). Documentar. |
| Extra igual a `password` ou duplicada | Uma tentativa a mais | Aceito (D-09). |
| Alterar `unsealSession` (exportada) | Chamadores diretos veem o símbolo `kExtraUnsealPassword` no retorno | Mesmo padrão de `kLegacySeal` hoje (`src/utils/session.ts:346`). Sem efeito quando não há extras. |
| Reselagem eager (D-07) diverge da letra de RF-07 | Revisão de escopo | Decisão explícita neste documento; reversível removendo uma condição em `src/utils/session.ts:214`. |
