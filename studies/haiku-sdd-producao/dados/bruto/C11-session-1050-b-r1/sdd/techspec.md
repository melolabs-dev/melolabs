# Especificação técnica — Várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato enxuto #1050-b), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1050.

Linha de base medida: `pnpm vitest run test/session.test.ts` passa com 58 testes antes de qualquer mudança.

## 1. Visão geral

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Ao abrir um cookie ou header de sessão, `unsealSession` tenta `password` e depois cada extra, na ordem declarada, e usa a primeira que abrir o selo. Sealing continua exclusivamente com `password`. Quando uma senha extra abre a sessão, `getSession` reselá-la com `password`, o que completa a rotação para cookies. Sem a opção, o caminho de execução é o mesmo de hoje.

## 2. Decisões de arquitetura

### D-01 — Tentativa de senhas dentro de `unsealSession`

**Escolha:** `unsealSession` itera sobre `[config.password, ...(config.extraUnsealPasswords ?? [])]`. Só o erro `Bad hmac value` avança para a próxima senha. Qualquer outro erro é relançado imediatamente. Quando todas falham, lança-se o erro da primeira tentativa.

**Justificativa:**
- `Bad hmac value` é o único erro que depende da senha. Os demais (`Wrong mac prefix`, `Incorrect number of sealed components`, `Expired seal`) são iguais para qualquer senha, então tentar as outras seria desperdício de PBKDF2.
- O predicado já existe em `src/utils/session.ts:332-337` (fallback legado). Reaproveitá-lo mantém um único critério.
- Manter o erro da primeira senha preserva as mensagens de hoje (PRD, riscos).

**Alternativas consideradas:**
- *Tentar as extras em `getSession`*: duplicaria o `try/catch` e espalharia a lógica por dois pontos. Rejeitada.
- *Escolher a senha pelo `passwordId` do formato iron* (`src/utils/internal/iron-crypto.ts:103`): exigiria ids nas senhas, o que cria um esquema público novo. Viola RF-09 e não é necessário.
- *`password` como array*: fora de escopo (PRD).

### D-02 — Fallback legado aplicado por senha

**Escolha:** para cada senha, tenta-se primeiro a iteração completa e, se o erro for `Bad hmac value` e o fallback estiver ativo, tenta-se a iteração 1 com a mesma senha. Só depois passa-se à próxima senha.

**Justificativa:** mantém a semântica "a primeira senha que abrir a sessão é a usada" (RF-03) e deixa o fallback como uma função que recebe uma senha (RF-04). O custo no pior caso é o mesmo da alternativa.

**Alternativa considerada:** tentar todas as senhas com iteração completa e só depois o fallback legado para todas. Funciona, mas separa a lógica em dois laços e não muda o custo. Rejeitada por complexidade.

### D-03 — Reselar ao abrir com senha extra

**Escolha:** quando a sessão é aberta por uma senha extra, `getSession` a reseala com `password` no mesmo ponto em que já reselaria um cookie legado. A marca interna é um símbolo `kRotatedSeal`, no mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`).

**Justificativa:** sem isso, uma sessão ativa continuaria selada com a senha antiga até expirar, e a rotação não terminaria nunca enquanto a senha extra estivesse configurada. A marca precisa ser removida de `unsealed` antes de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`), porque `Object.assign` copia símbolos próprios.

**Custo:** uma reselagem por sessão na primeira leitura após a troca. Não afeta o caminho sem extras.

**Alternativa considerada:** reselar só em legado ou em `idleTimeout`, como hoje. Mais simples, mas deixa a migração dependente de `idleTimeout`. **Esta decisão pode ser revertida se o time preferir**; é a única mudança de comportamento observável além da nova opção.

### D-04 — Validação das senhas extras

**Escolha:** `assertExtraUnsealPasswords(config, sealOptions)` valida cada item (`typeof === "string"` e `length >= min`, com `min = max(encryption.minPasswordlength, integrity.minPasswordlength)`). É chamada no início de `getSession` (antes da cadeia de promises e antes de `context.sessions[sessionName]` ser preenchido) e no início de `unsealSession`.

**Justificativa:**
- Hoje o tamanho mínimo só é checado tarde, em `generateKey` (`src/utils/internal/iron-crypto.ts:191-196`), durante o seal ou o unseal.
- Dentro de `getSession`, um erro lançado no `.catch(() => {})` de `src/utils/session.ts:197` seria engolido e a sessão seria silenciosamente substituída. Por isso a validação precisa ficar fora dessa cadeia.
- Usar `resolveSealOptions(config)` (ver D-06) respeita um `config.seal` com `minPasswordlength` diferente, o mesmo que `generateKey` respeita.

**Desvio do RF-07:** o PRD pede que a rejeição ocorra "antes de qualquer requisição". Não há ponto de configuração em H3: `SessionConfig` é um objeto passado a cada chamada. Cumprir isso literalmente exigiria um novo export (uma factory), o que o RF-09 proíbe. A validação ocorre, portanto, na primeira chamada que toca a sessão, e nunca silenciosamente. **Decisão a confirmar com o usuário.**

**Alternativa considerada:** validar apenas em `useSession`. Não cobre `getSession` nem `unsealSession` chamados diretamente. Rejeitada.

### D-05 — Assinaturas públicas inalteradas

**Escolha:** só `SessionConfig` ganha um campo. Nenhuma função exportada muda de assinatura. `unsealSession` continua retornando `Partial<Session>`, com as marcas internas que já aparecem hoje (`kLegacySeal`) e, com esta mudança, `kRotatedSeal`.

**Justificativa:** RF-09 exige que a única adição de API pública seja o campo.

**Consequência conhecida:** quem chama `unsealSession` diretamente vê os símbolos internos no objeto, como já acontece com `kLegacySeal`. Não é nova classe de problema.

### D-06 — Extrair `resolveSealOptions(config)`

**Escolha:** a expressão `{ ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal }` é repetida hoje em `src/utils/session.ts:300-304` e `:317-321`. Passa a existir uma função interna que a devolve e que é usada também pela validação de D-04.

**Justificativa:** a validação precisa dos mesmos `minPasswordlength` que o seal usa. Uma quarta cópia da expressão seria pior.

**Alternativa considerada:** validar contra `sealDefaults` diretamente. Ignora overrides de `config.seal`, então rejeitada.

### D-07 — Falha com todas as senhas

**Escolha:** o comportamento do `getSession` não muda. Se nenhuma senha abre a sessão, `unsealSession` lança o erro da primeira tentativa, `.catch` o absorve e uma sessão nova é criada.

**Correção do PRD (RF-05):** o critério diz "sem id". No código, a sessão criada em `src/utils/session.ts:225-229` recebe um id novo gerado em memória e `kSessionNew`. O correto é: `data` vazio e um id diferente do cookie recebido. O teste deve afirmar isso.

## 3. Arquivos a alterar

| Arquivo | Trecho atual | Alteração |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-48` (`SessionConfig`, campo `password` em `:48`) | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (RF-10), após `password`. |
| `src/utils/session.ts` | `:149-232` (`getSession`); `:196-197` (chamada e `.catch`) | Chamar a validação no início, antes de `:158`. Ler `kRotatedSeal`, removê-lo, incluir na condição de `:214`. |
| `src/utils/session.ts` | `:199-208` (tratamento de `kLegacySeal` e `Object.assign`) | Remover `kRotatedSeal` antes de `:208`. |
| `src/utils/session.ts` | `:282-307` (`sealSession`) | Usar `resolveSealOptions(config)` em `:300-304`. Sem outra mudança. |
| `src/utils/session.ts` | `:312-367` (`unsealSession`) | Reescrever o `try/catch` de `:323-348` como o laço de D-01 com `unsealWithFallback` (D-02). Marcar `kRotatedSeal` quando o índice for > 0. Usar a flag `opened`, não `unsealed`, porque `unseal` pode devolver `null` (`src/utils/internal/iron-crypto.ts:149`). |
| `src/utils/session.ts` | (novo, após `:367`) | `resolveSealOptions`, `assertExtraUnsealPasswords`, `unsealWithFallback`, `isBadHmac` (internas, no fim do arquivo, conforme AGENTS.md). |
| `src/utils/internal/session.ts` | `:7-9` (`kLegacySeal`) | Adicionar `kRotatedSeal = Symbol.for("h3.internal.session.rotated-seal")`. |
| `test/session.test.ts` | `:15` (`describeMatrix`), `:21-25` (`sessionConfig`) | Novo `describe` com os testes de §5. Não alterar asserções existentes. |
| `docs/2.utils/4.security.md` | `:56-60` | Fora do escopo do PRD. Registrar como pendência. |

Não alterar: `src/index.ts:203-209` (exports já cobrem o tipo e as funções; RF-09), `src/utils/internal/iron-crypto.ts` (o mínimo de senha é lido, não alterado).

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig
export interface SessionConfig {
  password: string;                 // inalterado: única senha de selagem
  /**
   * Senhas anteriores, usadas apenas para abrir sessões seladas com elas.
   *
   * Tentadas depois de `password`, na ordem declarada; a primeira que abrir a
   * sessão é usada. Sessões abertas por uma senha extra são reseladas com
   * `password` na mesma leitura. Remover uma senha antiga invalida as sessões
   * que dependem dela. Cada item segue a regra de `password` (mínimo de
   * caracteres do seal).
   *
   * Para rotacionar: troque `password` pela nova e mova a antiga para cá;
   * remova a antiga depois de `maxAge` (ou `idleTimeout`).
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}

// internas (não exportadas)
function resolveSealOptions(config: SessionConfig): SealOptions;
function assertExtraUnsealPasswords(config: SessionConfig, sealOptions: SealOptions): void;
// lança Error("Invalid extraUnsealPasswords[i]: each password must be a string of at least N characters")
async function unsealWithFallback(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean,
): Promise<Partial<Session>>;   // marca kLegacySeal quando usa iteração 1
function isBadHmac(error: unknown): boolean;
```

Símbolo novo (interno):

```ts
// src/utils/internal/session.ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.rotated-seal");
```

Esboço de `unsealSession` (público, mesma assinatura):

```ts
export async function unsealSession(_event, config, sealed): Promise<Partial<Session>> {
  const sealOptions = resolveSealOptions(config);
  assertExtraUnsealPasswords(config, sealOptions);
  const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
  const legacySealFallback = config.legacySealFallback !== false;
  let unsealed: Partial<Session> | null = null;
  let opened = false;
  let firstError: unknown;
  for (const [index, password] of passwords.entries()) {
    try {
      unsealed = await unsealWithFallback(sealed, password, sealOptions, legacySealFallback);
      if (index > 0 && unsealed) (unsealed as any)[kRotatedSeal] = true;
      opened = true;
      break;
    } catch (error) {
      firstError ??= error;
      if (!isBadHmac(error)) throw error;
    }
  }
  if (!opened) throw firstError;
  // expirações (maxAge, idleTimeout) permanecem como estão em :349-365
  return unsealed as Partial<Session>;
}
```

Esboço da mudança em `getSession` (`:199-214`):

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const rotatedSeal = unsealed && (unsealed as any)[kRotatedSeal];
if (legacySeal) delete (unsealed as any)[kLegacySeal];
if (rotatedSeal) delete (unsealed as any)[kRotatedSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

Nota: `isBadHmac(error)` é `error instanceof Error && error.message === "Bad hmac value"`, o mesmo teste de `:335-336`.

## 5. Estratégia de testes

Todos os testes novos em `test/session.test.ts`, dentro de `describeMatrix`, para rodar nos alvos `web` e `node` (RF-08). Seguir o padrão de `:134-159` (selar com `seal` direto para simular legado) e de `:722-736` (espionar `crypto.subtle.deriveBits`).

| Teste | Cobre | Como |
| --- | --- | --- |
| Abre sessão selada com `A` quando `password` é `B` | RF-01 | Criar sessão com config `A`; ler com `{password: B, extraUnsealPasswords: [A]}`; `data` preservado. |
| Reseala com `B` após abrir com `A` | RF-02, D-03 | Ler o cookie resultante com `unseal(..., B)` (sucesso) e `unseal(..., A)` (falha). Ler sem `idleTimeout` e sem legado. |
| Ordem `password` → extras, primeira que abre vence | RF-03 | `password: B`, `extras: [A, C]`, cookie com `C`. Sucesso. |
| Legado (iteração 1) com senha extra | RF-04 | `seal` com iteração 1 usando `A`; ler com `{B, [A]}`; verificar que o cookie resultante abre com `B` nas iterações atuais. |
| Senha desconhecida | RF-05, D-07 | Cookie com `Z`; `data` vazio, sem exceção no handler, id diferente do cookie. Sem `errors` no contexto de teste. |
| Sem extras e `[]` | RF-06, D-05 | Suíte existente sem alteração (58 testes) + um caso com `extraUnsealPasswords: []` igual a omitido. |
| Validação | RF-07, D-04 | `unsealSession({} as HTTPEvent, cfg, sealed)` com `[""]` e com item curto: `rejects.toThrow(/extraUnsealPasswords/)`. |
| Custo com cookie inválido | Risco de DoS | Espionar `deriveBits`: com `extras` de tamanho N e cookie `Z`, esperar `2 * (1 + N)` chamadas com legado ligado e `1 + N` com `legacySealFallback: false`. Fixa o custo que a spec documenta. |
| Header de sessão | Premissa do PRD | Sessão `A` enviada no header `x-h3-test-session`; lida; sem `Set-Cookie` (header não é reselado). |
| Cookie em partes | Premissa do PRD | Sessão grande com `A`, lida com `B`; cookie resultante em partes abre com `B`. |

**Verificação final:** `pnpm vitest run test/session.test.ts`, `pnpm lint` (`package.json:46`, oxlint + oxfmt) e `pnpm typecheck` (`package.json:54`, `tsc --noEmit`). Rodar também `pnpm vitest run test/unit/` para checar exports.

**Ordem de trabalho (AGENTS.md, "Bug Fix Workflow" adaptado):** escrever primeiro os testes de RF-01/03/04 e ver falharem; depois implementar.

## 6. Riscos e correções ao PRD

**Premissas do PRD que o código corrige:**

1. **RF-07 / premissa de tamanho mínimo.** A checagem existe, mas é tardia (`src/utils/internal/iron-crypto.ts:191-196`) e é engolida pelo `.catch` de `getSession` (`src/utils/session.ts:197`). Sem D-04 a rejeição seria silenciosa.
2. **RF-05 "sem id".** A sessão substituta tem id novo (`src/utils/session.ts:225-229`). A spec e o teste foram ajustados.
3. **Custo de DoS.** O PRD fala em `2 × (1 + N)` operações PBKDF2. A conta é: `1 + N` PBKDF2 com 8192 iterações (o HMAC é verificado antes da decifragem, então não há custo de decifragem em cookie inválido) e `1 + N` com 1 iteração no fallback legado, que é barato. O custo caro cresce linearmente com N. Medir com N = 1, 3 e 5 antes de liberar, como o PRD pede.
4. **Mensagens de erro.** Não há asserção em `test/` que dependa de `Bad hmac value` (busca feita). O risco do PRD fica menor, mas o teste de RF-05 mantém o erro da primeira senha.

**Riscos residuais:**

- **Sessões em header nunca são reseladas.** Uma sessão enviada pelo header de sessão e selada com senha extra continua com a senha antiga até expirar. Documentar; não há como corrigir sem reselar cookie.
- **Senha extra que nunca sai da configuração.** Mantém sessões antigas válidas. Mitigado pela descrição no JSDoc (§4). Não há aviso automático.
- **Validação por chamada.** A validação roda a cada `getSession`. O custo é uma checagem de string, desprezível, mas o erro aparece na primeira requisição, não no boot. Deve ser comunicado no PR.
- **Símbolos internos vazam para quem chama `unsealSession` diretamente.** Já ocorre com `kLegacySeal`. Não é regressão.
- **Documentação do site.** `docs/2.utils/4.security.md:56-60` não menciona o campo. O PRD exclui a doc do site; fica como pendência.
- **Reselagem na primeira leitura pós-rotação** adiciona um `Set-Cookie` nessa requisição. Esperado, mas altera a resposta de rotas que antes não emitiam cookie. Vale um item no changelog.

## 7. Pendências para decisão do usuário

1. Confirmar D-03 (reselar ao abrir com senha extra). É o único comportamento observável além da opção.
2. Confirmar D-04: aceitar que a rejeição de configuração ocorre na primeira chamada, não antes de qualquer requisição (RF-07).
3. Confirmar se a doc do site (`docs/2.utils/4.security.md`) entra neste trabalho ou fica para depois.
