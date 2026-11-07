# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-08), issue h3js/h3#1050.

Linha de base: `pnpm vitest run test/session.test.ts` passa com 58 testes e 0 erros de tipo.

## Visão geral

Hoje `getSession` lê a sessão com uma única senha (`config.password`) e engole qualquer erro de `unsealSession` (`src/utils/session.ts:196`). A mudança cria um laço de tentativas em `unsealSession`: a senha atual primeiro, depois as extras em ordem. Somente a falha de HMAC (`Bad hmac value`, senha errada) passa para a próxima senha. Qualquer outro erro sai imediatamente. A selagem continua usando só `password`. A configuração inválida vira erro explícito antes de qualquer mutação do contexto.

Nenhum nome público novo além de `extraUnsealPasswords`. Nenhuma assinatura pública muda.

---

## Decisões de arquitetura

### D-01 — Campo novo `extraUnsealPasswords` em vez de `password` como array

**Escolha:** `SessionConfig` ganha `extraUnsealPasswords?: string[]`, e `password` continua `string`.

**Alternativas consideradas:**
- `password: string | string[]`, a segunda alternativa da issue. Mudaria o tipo de um campo existente, e o primeiro item precisaria carregar o papel de "selo" por convenção. Quebra quem lê `config.password` como string.
- Lista de senhas com IDs (`passwordId` do iron). Fora de escopo no pedido.

**Justificativa:** o contrato em `sdd/pedido.md` exige o campo novo. Mantém `password` com o mesmo tipo e papel, então a configuração existente continua válida sem alteração.

### D-02 — O laço só avança em `Bad hmac value`; os demais erros saem na hora

**Escolha:** em `unsealWithPasswords` (novo, ver D-06), cada tentativa que falha com `Bad hmac value` passa para a próxima senha. Qualquer outro erro é relançado imediatamente. Se todas falharem, relança o último erro de HMAC, o que preserva a mensagem de hoje.

**Alternativas consideradas:**
- `catch` genérico em cada tentativa. Mascara `Expired seal`, `Wrong mac prefix` e `Invalid expiration`, que não dependem da senha. Ainda gastaria uma derivação PBKDF2 por senha em cookies malformados.

**Justificativa:** no iron, `Wrong mac prefix`, `Incorrect number of sealed components`, `Invalid expiration` e `Expired seal` são verificados antes do HMAC (`src/utils/internal/iron-crypto.ts:100-118`). Nenhum deles depende da senha, então repetir a tentativa só custa CPU e esconde o motivo real. Isso atende ao risco do PRD sobre expiração dentro do laço.

### D-03 — Validação explícita das senhas extras no início de `getSession`

**Escolha:** `assertExtraUnsealPasswords(config)` roda como primeira instrução de `getSession`, antes de `context.sessions[sessionName]` ser preenchido (`src/utils/session.ts:155-173`). Ela também roda em `unsealSession`, porque essa função é exportada. Cada entrada precisa ser `string` com `length >= min`, onde `min = max(encryption.minPasswordlength, integrity.minPasswordlength)` do selo efetivo (`{ ...sealDefaults, ...config.seal }`, como em `src/utils/session.ts:317-321`). A mensagem identifica o índice, por exemplo `extraUnsealPasswords[0] must be at least 32 characters`, e nunca inclui o valor da senha.

**Alternativas consideradas:**
- Validar só dentro de `unsealSession` e relançar do `.catch` de `getSession`. Exige distinguir erro de configuração de erro de sessão no `.catch(() => {})` (`session.ts:196`), e a validação aconteceria depois de `context.sessions[sessionName]` já estar preenchido com uma sessão vazia. Uma exceção ali deixaria o contexto parcialmente inicializado.
- Não validar e deixar o iron lançar `Password string too short`. Essa exceção seria engolida e todas as sessões cairiam sem aviso, que é o risco que o RF-08 proíbe.

**Justificativa:** validar antes de qualquer mutação mantém o contexto limpo e transforma o erro de configuração em erro visível. Consequência assumida: com uma senha extra inválida, toda requisição que chama `getSession`/`useSession` falha, mesmo sem cookie. É o comportamento pedido pelo RF-08 e preferível a deslogar em silêncio.

Não validamos `password` aqui. Isso preserva o RF-04, pois o comportamento atual com `password` curta fica igual.

### D-04 — Selagem inalterada: sempre `password`

**Escolha:** `sealSession` não muda (`src/utils/session.ts:300`, `seal(session, config.password, ...)`).

**Justificativa:** RF-03. Nenhum caminho de escrita lê `extraUnsealPasswords`, então o cookie novo só abre com a senha atual.

### D-05 — Regravar o cookie quando ele é aberto com senha extra

**Escolha:** em `getSession`, uma sessão aberta com senha extra vinda de cookie é regravada na própria requisição, com a mesma condição já usada para o fallback legado (`src/utils/session.ts:214`). Uma flag interna `kExtraUnsealSeal`, no mesmo padrão de `kLegacySeal`, marca essa abertura.

**Alternativas consideradas:**
- Regravar só quando a requisição escreve ou desliza a janela (`shouldSlide`), que é o texto literal do RF-07. A migração fica dependente de atividade. Um cliente que só lê sessão continua na senha antiga até expirar, e quem remove a senha antiga precisa esperar o `maxAge` ou `idleTimeout` do cliente mais antigo.
- Regravar com todo acesso que use senha extra, o que é a escolha acima.

**Justificativa:** a migração acontece na primeira requisição após a rotação, então a senha antiga pode sair da configuração muito antes. Custo: um selo extra por sessão antiga, uma única vez, porque o cookie novo abre com a primeira tentativa. Isso vai além do texto do RF-07, mas não o contradiz (o RF-07 continua válido). **Ponto a confirmar pelo usuário:** se preferirem a leitura literal, basta remover `extraSeal` da condição em `session.ts:214`, e o resto da especificação continua válido.

Sessões de header (`sessionFromCookie === false`) não podem ser regravadas (`session.ts:191`, `sessionFromCookie`). Elas continuam na senha antiga até o cliente trocar o header.

### D-06 — Helpers novos em `src/utils/internal/session.ts`

**Escolha:** `assertExtraUnsealPasswords` e `unsealWithPasswords` ficam em `src/utils/internal/session.ts`, junto de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). `unsealSession` continua em `src/utils/session.ts`, com a mesma assinatura.

**Alternativas consideradas:**
- Tudo dentro de `src/utils/session.ts`. O arquivo já tem 464 linhas, bem acima do alvo de 200 do `AGENTS.md`, e o ajuste somaria ~40 linhas.

**Justificativa:** `internal/session.ts` já guarda os símbolos e constantes da sessão, e não cria dependência circular de valor: ele só importa tipos de `../session.ts`, como hoje. `iron-crypto.ts` é importado só para `unseal` e `SealOptions`.

### D-07 — Expiração continua depois da abertura, fora do laço

**Escolha:** as verificações de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) ficam no `unsealSession`, depois de `unsealWithPasswords` retornar. Não são repetidas por senha.

**Justificativa:** RF-06 e risco de expiração no laço do PRD. A expiração não depende da senha, então aplicá-la uma vez basta, e uma senha extra não estende a vida da sessão.

---

## Arquivos a alterar

| Arquivo | Trecho atual (conferido) | Mudança |
|---|---|---|
| `src/utils/session.ts` | `:39` `interface SessionConfig` | Adicionar `extraUnsealPasswords?: string[]` logo após `password` (`:48`), com JSDoc |
| `src/utils/session.ts` | `:149-155` início de `getSession` | Chamar `assertExtraUnsealPasswords(config)` como primeira instrução |
| `src/utils/session.ts` | `:199-201` leitura de `kLegacySeal` | Ler e apagar também `kExtraUnsealSeal` |
| `src/utils/session.ts` | `:214` condição de regravação | `legacySeal \|\| extraSeal \|\| shouldSlide(session, config)` |
| `src/utils/session.ts` | `:312-348` `unsealSession` e `try/catch` do fallback | Substituir o `try/catch` por `unsealWithPasswords`; manter as verificações de `maxAge`/`idleTimeout` em `:350-365` |
| `src/utils/internal/session.ts` | `:3-9` símbolos | Adicionar `kExtraUnsealSeal` |
| `src/utils/internal/session.ts` | fim do arquivo | Adicionar `assertExtraUnsealPasswords`, `unsealWithPasswords` e o `unsealWithFallback` interno (corpo do `try/catch` atual, `session.ts:323-348`) |
| `test/session.test.ts` | `:15` `describeMatrix`, `:21-25` `sessionConfig` | Novos blocos de teste (ver Estratégia de testes) |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/utils/cookie.ts`, `src/index.ts:200-212` (exportações já existentes), `docs/2.utils/4.security.md` (a seção gerada cobre só funções) e `CHANGELOG.md` (gerado no release).

---

## Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /** ... (sem alteração) */
  password: string;
  /**
   * Earlier passwords, tried in order after `password` when opening a sealed
   * session. They only open sessions: sealing always uses `password`. Each entry
   * must meet the seal's minimum password length. Keep the list short, since
   * every entry costs one PBKDF2 derivation for a cookie that no password opens.
   * Keep a retired password here at least as long as the longest `maxAge` or
   * `idleTimeout` of sessions sealed with it.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos sem alteração
}

// src/utils/session.ts — assinatura pública inalterada
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

```ts
// src/utils/internal/session.ts
import type { SealOptions } from "./iron-crypto.ts";

/** Flag set on a session opened with a password from `extraUnsealPasswords`. */
export const kExtraUnsealSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-unseal",
);

/**
 * Throws if an entry of `extraUnsealPasswords` is not a string of at least the
 * seal's minimum password length. The message names the index, never the value.
 */
export function assertExtraUnsealPasswords(config: SessionConfig): void;

/**
 * Tries `config.password`, then each `config.extraUnsealPasswords` entry, in
 * order. Only `Bad hmac value` moves on to the next password. Any other error
 * is thrown at once, and the last HMAC error is thrown if every password fails.
 * The legacy 1-iteration fallback applies to each password. A session opened
 * with an extra password gets `kExtraUnsealSeal`; a legacy one gets `kLegacySeal`.
 */
export async function unsealWithPasswords(
  sealed: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;

// interno, não exportado
async function unsealWithFallback(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // corpo atual de unsealSession, :324-347, sem alteração de lógica
```

Esboço do laço em `unsealWithPasswords`, para guiar a implementação:

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
let error: unknown;
for (const [index, password] of passwords.entries()) {
  try {
    const unsealed = await unsealWithFallback(sealed, password, sealOptions);
    if (index > 0 && unsealed) {
      (unsealed as any)[kExtraUnsealSeal] = true;
    }
    return unsealed;
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "Bad hmac value") {
      throw err;
    }
    error = err;
  }
}
throw error;
```

Mudança em `getSession` (`src/utils/session.ts:199-214`):

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const extraSeal = unsealed && (unsealed as any)[kExtraUnsealSeal];
if (legacySeal) delete (unsealed as any)[kLegacySeal];
if (extraSeal) delete (unsealed as any)[kExtraUnsealSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

Os símbolos são apagados antes de `Object.assign(session, unsealed)` (`session.ts:208`), porque o `assign` copia símbolos enumeráveis.

---

## Estratégia de testes

Seguir o padrão de `test/session.test.ts`: `describeMatrix` (web e node), cookies de senha antiga gerados com `seal` do iron, como no teste de legado (`:134-159`), e `vi.useFakeTimers({ toFake: ["Date"] })` para expiração, como nos testes de `idleTimeout`. Para contar derivações, usar `vi.spyOn(crypto.subtle, "deriveBits")`, como em `:723-733`.

Dados de teste: `A` = senha antiga e `B` = atual, ambas com 32 ou mais caracteres. `C` = outra senha antiga.

Novos casos, cada um ligado ao requisito:

1. **RF-02** — sessão selada com `A`, configuração `password: B, extraUnsealPasswords: [A]`: `getSession` retorna `id` e `data` originais.
2. **RF-02 (custo)** — cookie selado com a senha atual, com extras configuradas: `deriveBits` é chamado o mesmo número de vezes que sem extras (nenhuma tentativa extra).
3. **RF-03** — `updateSession` com a configuração acima: o `Set-Cookie` abre com `B` e não abre com `A`.
4. **RF-04** — sem `extraUnsealPasswords`, cookie selado com `A` é tratado como inválido (sessão nova, sem dados).
5. **RF-05** — sessão selada com `A` enviada em `x-h3-session`, com `A` nas extras: abre.
6. **RF-06** — `maxAge` vencido, senha extra: sessão sem dados.
7. **RF-07** — `idleTimeout` com metade já usada, senha extra: `Set-Cookie` abre com `B` e não com `A`.
8. **RF-08** — `extraUnsealPasswords: ["curta"]`: `getSession` falha com mensagem que cita `extraUnsealPasswords[0]`, também com cookie válido. A expectativa de erro fica dentro do handler (`try/catch` devolvendo a mensagem), porque `ctx.errors` é auto-verificado no `afterEach` e erro não tratado falharia o teste.
9. **D-02/D-07** — cookie expirado (`ttl` vencido) com extras `[A, C]`: `deriveBits` não é chamado, porque a expiração do iron acontece antes do HMAC.
10. **Custo de cookie forjado** — cookie sem chave válida com `extraUnsealPasswords: [A, C]`: nova sessão, sem exceção, e `deriveBits` chamado uma vez por senha (3 vezes no total com a atual). Documenta a amplificação do PRD.
11. **Tipo (RF-01)** — `tsc --noEmit` cobre `test/session.test.ts`, então a configuração com `extraUnsealPasswords: [...]` precisa compilar.

Testes existentes: a expectativa de nenhum deles deve mudar, pois sem extras o caminho executado é o mesmo (uma tentativa, mesmo erro relançado). Se algum falhar, a mudança estará errada, e não o teste. A restrição do contrato permite ajustar teste existente só se a mudança alterar o que ele verifica, o que não se espera aqui.

Verificação, nesta ordem:

1. `pnpm vitest run test/session.test.ts`: os 58 atuais mais os novos.
2. `pnpm vitest run`: suíte completa.
3. `pnpm lint` (`oxlint . && oxfmt --check .`) e `pnpm typecheck` (`tsc --noEmit`).
4. Regra do `AGENTS.md` para bug fix: os testes 1, 5 e 7 devem falhar antes da implementação e passar depois. Em particular, o teste 8 falha hoje porque o campo não existe.

---

## Riscos

| Risco | Origem | Tratamento |
|---|---|---|
| Desconexão silenciosa por configuração errada | PRD | D-03. Senha extra inválida falha todas as requisições com erro explícito, não logout silencioso. Teste 8. |
| Erro de configuração derruba requisições que não usam sessão | D-03 | Aceito e intencional. A validação roda em todo `getSession`. Deve aparecer em staging ao primeiro deploy. |
| Amplificação de CPU em cookie forjado | PRD | Uma derivação de 8192 iterações por senha extra, mais um fallback de 1 iteração por senha. A ordem HMAC-antes-de-decifrar do iron (`iron-crypto.ts:133`, `:147`) limita o custo a uma derivação de integridade por tentativa. Teste 10. Limite de uso na documentação do campo. |
| Expiração disparando novas tentativas | PRD | D-02 e D-07. Teste 9. |
| Rotação incompleta | PRD | D-05 migra clientes de cookie na primeira requisição. Clientes que só usam header continuam na senha antiga até expirar, então a senha antiga deve ficar na lista pelo tempo máximo de vida. |
| Senha antiga parada na configuração | PRD | Sem mecanismo de descarte, por escopo. Mitigação só documental. |
| Vazamento de senha por mensagem de erro | D-03 | A mensagem cita índice e tamanho mínimo, nunca o valor. Coberto pelo teste 8, que deve verificar que a senha curta não aparece na mensagem. |
| Tempo de resposta revela a posição da senha na lista | PRD | Aceito. O atacante já precisa do cookie. Entrar na revisão de segurança. |
| Entradas repetidas ou não-string em JavaScript sem tipo | D-03 | Não deduplicar; o custo é só CPU e a lista é curta. A validação usa `typeof` antes de `length`, então entrada não-string também gera erro explícito. |
| `session.ts` continua grande | D-06 | Mudança fica majoritariamente em `internal/session.ts`. Refatoração maior fica fora de escopo. |
| Regravação extra gera `Set-Cookie` em requisições que hoje não geram | D-05 | Só para sessões de cookie aberta com senha antiga, uma vez por sessão. `stageSessionErrCookies` (`session.ts:435`) já cobre respostas de erro. |

---

## Pontos a confirmar

1. **D-05**: regravar na primeira leitura com senha extra (recomendado) ou só com escrita/deslizamento, como o texto literal do RF-07.
2. **D-03**: erro de configuração derrubando todas as requisições (recomendado, conforme RF-08) ou alguma degradação mais suave.
