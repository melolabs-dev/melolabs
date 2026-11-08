# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Escopo de código: `src/utils/session.ts`, `src/utils/internal/session.ts`, testes e docs de sessão. Nenhum export novo em `src/index.ts`.

## 1. Estado atual (conferido no código)

- `SessionConfig.password: string` — `src/utils/session.ts:48`; o campo novo entra ao lado dele.
- `getSession` lê o cookie/header e chama `unsealSession(...).catch(() => {})` — `src/utils/session.ts:196-197`. Qualquer erro vira "sem sessão" e uma nova é criada (`src/utils/session.ts:225-229`).
- O reseal pós-leitura só ocorre se `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` — `src/utils/session.ts:214-216`. O reseal é feito por `updateSession` → `sealSession`.
- `sealSession` sela sempre com `config.password` — `src/utils/session.ts:300`. RF-03 já é satisfeito por construção; basta não alterar essa linha.
- `unsealSession` (`src/utils/session.ts:312-367`): tenta `unseal` com `config.password` (`:324`); em falha, se o erro for `"Bad hmac value"` e não houver bloqueio, repete com 1 iteração PBKDF2 (`:332-344`) e marca `kLegacySeal` (`:345-347`). Expiração (`maxAge`/`idleTimeout`) é avaliada depois do unseal bem-sucedido (`:349-365`).
- `unseal` valida expiração do seal e formato antes de derivar chaves (`src/utils/internal/iron-crypto.ts:98-118`). Só então calcula o HMAC e lança `"Bad hmac value"` quando a senha não confere (`:133-137`). Esse é o único sinal de "senha errada". Senha curta lança erro diferente, em `generateKey` (`:192-195`).
- `kLegacySeal` é um símbolo interno, definido em `src/utils/internal/session.ts:7-9`.
- `password?` em `src/types/context.ts:32` pertence a `basicAuth`, não à sessão. Não será tocado.

## 2. Decisões de arquitetura

### D-01 — Onde implementar: dentro de `unsealSession`

**Alternativas:** (a) laço em `getSession` chamando `unsealSession` uma vez por senha, com `config` clonado; (b) laço dentro de `unsealSession`; (c) nova função interna de unseal usada por ambos.
**Escolha: (b).** `unsealSession` é o ponto único de leitura (`src/utils/session.ts:196`, e é exportada em `src/index.ts:209`). Assim quem a chama diretamente também ganha a rotação. A expiração (`:349-365`) continua depois do unseal, fora do laço, o que atende ao risco "mascarar expiração" do PRD. (a) repetiria a checagem de expiração e clonaria config. (c) cria nome novo sem necessidade.

### D-02 — Quando passar para a próxima senha: somente em `"Bad hmac value"`

**Alternativas:** (a) tentar a próxima em qualquer erro; (b) só em `"Bad hmac value"`.
**Escolha: (b).** Esse é o critério que o código já usa para o fallback legado (`src/utils/session.ts:336`). Erros de formato, `"Expired seal"` ou JSON inválido não dependem da senha, então repetir só gasta PBKDF2 e pode esconder o erro real. Efeito colateral aceito: uma senha extra com menos de 32 caracteres lança `"Password string too short"` (`iron-crypto.ts:192-195`) e interrompe a tentativa, e a sessão é descartada. Isso é falha visível de configuração, não silêncio; ver R-04.

### D-03 — Ordem entre senhas e fallback legado: primeiro todas as senhas com o seal atual, depois todas com 1 iteração

**Alternativas:** (a) por senha: atual, legado, próxima senha (até 2N derivações); (b) por fase: todas as senhas no seal atual, depois todas no legado (também até 2N no pior caso).
**Escolha: (b).** O pior caso é o mesmo, mas o caso comum (cookie moderno selado com senha antiga) custa 1 + k derivações em vez de 2k + 1, pois não passa pelo legado inútil. O legado é `@deprecated` (`src/utils/session.ts:93`) e deve custar o mínimo. A ordem das senhas é a da config: `password` primeiro, depois `extraUnsealPasswords` do índice 0 em diante (PRD: mais recente → mais antiga). `legacySealFallback: false` e `iterations === 1` continuam desligando a fase legada (`:333-335`).

### D-04 — Marcar a leitura por senha extra com símbolo interno novo `kExtraSeal`

**Alternativas:** (a) reaproveitar `kLegacySeal`; (b) novo símbolo interno em `src/utils/internal/session.ts`; (c) campo público no `Session`.
**Escolha: (b).** (a) mistura dois motivos de reseal e confunde a leitura; (c) viola "nenhum outro nome público". O símbolo não é reexportado por `src/index.ts`. Segue o padrão de `kLegacySeal` (`Symbol.for("h3.internal.session.*")`, prefixo `k`). `getSession` remove a marca antes de `Object.assign(session, unsealed)`, como faz com `kLegacySeal` (`:199-202`), para ela não vazar na sessão. A condição de reseal passa a ser `legacySeal || extraSeal || shouldSlide(...)` (`:214`).

### D-05 — Reseal (RF-04) reaproveita `updateSession`

**Alternativas:** (a) chamar `sealSession` e `setChunkedCookie` manualmente; (b) reutilizar o caminho já existente do reseal legado.
**Escolha: (b).** `updateSession` já sela com `config.password` (`:267` → `:300`), preserva `id`/`createdAt`/`data`, emite o cookie em chunks e espelha para `errHeaders` (`:273`). O reseal fica restrito a `sessionFromCookie`, pois a sessão vinda do header não pode ser regravada. Isso é limite documentado, igual ao de `idleTimeout` (`docs/4.examples/handle-session.md:180`). Com `cookie: false` não há Set-Cookie, também como hoje (`:266`).

### D-06 — Sem validação nova de `extraUnsealPasswords` em runtime

**Alternativas:** (a) validar tamanho/tipo na entrada e lançar; (b) confiar em `unseal` e no tipo TypeScript.
**Escolha: (b).** O PRD parte de que as extras têm as mesmas exigências (mínimo 32, vindo do iron). Validar adiciona caminho de erro sem pedido. Duas normalizações baratas e sem custo de API: tratar `undefined`/`[]` como "sem extras" (RF-01) e ignorar extras iguais a `password`, que só repetiriam a mesma derivação.

## 3. Arquivos a alterar

| Arquivo                             | Linha                   | Mudança                                                                                               |
| ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/utils/session.ts`              | `:5`                    | importar `kExtraSeal` junto de `kLegacySeal`                                                          |
| `src/utils/session.ts`              | `:48` (após `password`) | declarar `extraUnsealPasswords?: string[]` com JSDoc (só abre, ordem, lista curta, 32+ chars, reseal) |
| `src/utils/session.ts`              | `:196-216`              | em `getSession`, ler e apagar `kExtraSeal`; ampliar a condição de reseal                              |
| `src/utils/session.ts`              | `:312-348`              | reescrever o trecho de unseal de `unsealSession` conforme D-01..D-03                                  |
| `src/utils/session.ts`              | `:349-366`              | inalterado (expiração)                                                                                |
| `src/utils/session.ts`              | `:300`                  | inalterado (`seal` com `config.password`)                                                             |
| `src/utils/internal/session.ts`     | após `:9`               | `export const kExtraSeal`                                                                             |
| `test/session.test.ts`              | após `:186`             | novos casos (seção 5)                                                                                 |
| `docs/4.examples/handle-session.md` | após `:149`             | seção curta "Rotating the password"                                                                   |
| `docs/2.utils/4.security.md`        | perto de `:68`          | só se for regenerado por automd a partir do JSDoc (`pnpm fmt`); não editar à mão                      |

Os testes existentes em `test/session.test.ts:134-186` (legado) devem continuar passando sem edição: o comportamento sem extras é idêntico. `test/unit/package.test.ts:28-152` lista exports e não muda.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — única mudança de API pública
export interface SessionConfig {
  password: string; // continua selando; inalterada
  /**
   * Previous passwords that may only open sessions, never seal them. Tried in
   * order after `password` fails; most recent first. Keep it short: every
   * attempt on an invalid cookie costs a PBKDF2 derivation. Same 32 character
   * minimum as `password`. A session opened with one is resealed with
   * `password` in the same request, so an old one can be removed afterwards.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// src/utils/internal/session.ts — interno, não exportado em src/index.ts
export const kExtraSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-seal",
);
```

Assinaturas de `useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession` não mudam.

Esboço do núcleo de `unsealSession`, para fixar a ordem de D-03. Não é código aplicado:

```ts
const passwords = [
  config.password,
  ...(config.extraUnsealPasswords || []).filter((p) => p !== config.password),
];
const legacyOptions = {
  ...sealOptions,
  encryption: { ...sealOptions.encryption, iterations: 1 },
  integrity: { ...sealOptions.integrity, iterations: 1 },
};
const canTryLegacy = config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1;

let unsealed: Partial<Session> | undefined;
let lastError: unknown;
for (const [index, password] of passwords.entries()) {
  // fase 1: seal atual
  try {
    unsealed = (await unseal(sealed, password, sealOptions)) as Partial<Session>;
    if (index > 0 && unsealed) (unsealed as any)[kExtraSeal] = true;
    break;
  } catch (error) {
    if (!isBadHmac(error)) throw error;
    lastError = error;
  }
}
if (!unsealed && canTryLegacy) {
  // fase 2: legado
  for (const [index, password] of passwords.entries()) {
    /* idem com legacyOptions; marca kLegacySeal, e kExtraSeal se index > 0 */
  }
}
if (!unsealed) throw lastError;
```

`isBadHmac` é um helper local (`error instanceof Error && error.message === "Bad hmac value"`). O comportamento sem extras fica igual ao atual: uma tentativa atual, uma legada, e o erro original relançado. Um unseal que retorne `null` (payload vazio) mantém o tratamento de hoje (`:345`, `:351`).

## 5. Estratégia de testes

Novos casos em `test/session.test.ts`, dentro de `describeMatrix` (rodam em web e node). Cookies antigos são gerados com `seal`/`sealDefaults` já importados (`:12`); a leitura do cookie reselado usa `unseal` como em `:155-158`.

| Caso                                                                                                                     | RF           |
| ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Sem `extraUnsealPasswords` (ausente e `[]`), cookie com `password` abre e não emite `Set-Cookie`                         | RF-01        |
| Cookie selado com A; config `password: B, extra: [A]` devolve `id` e `data` originais                                    | RF-02        |
| A segunda e a terceira extra funcionam (ordem); lista tem A e C, cookie com C                                            | RF-02        |
| Após ler com A, `Set-Cookie` único; o cookie abre com B sozinho e `unseal` com A falha (`Bad hmac value`)                | RF-03, RF-04 |
| Reseal preserva `id`, `createdAt` e `data`; `useSession` + `update` também sela só com B                                 | RF-03, RF-04 |
| Cookie com senha C fora da config: sessão nova, `data` vazio, sem dados antigos                                          | RF-05        |
| Cookie expirado (`maxAge`, com `vi.useFakeTimers({ toFake: ["Date"] })` como em `:189-190`) selado com extra é rejeitado | RF-06        |
| `idleTimeout` vencido com cookie de extra é rejeitado                                                                    | RF-06        |
| `seal` customizado (iterações/algoritmo) vale para a extra                                                               | RF-06        |
| Cookie legado (1 iteração) selado com senha extra abre e é reselado com B moderno; `legacySealFallback: false` o rejeita | RF-06, D-03  |
| Sessão vinda do header com extra é lida, sem `Set-Cookie`                                                                | D-05         |
| Extra igual a `password` não quebra                                                                                      | D-06         |
| Extra com menos de 32 caracteres, alcançada por cookie de outra senha: sessão descartada, sem exceção ao handler         | D-02, R-04   |
| `kExtraSeal` não vaza para `session` (checagem do JSON da resposta)                                                      | D-04         |

Verificação final (RF-07): `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck`, e `pnpm vitest run` para regressão geral. Seguir o fluxo do AGENTS.md: escrever os testes antes, confirmar que falham (os de RF-02 e RF-04) e só então implementar.

## 6. Riscos

- **R-01 — Custo de CPU.** Cookie inválido gasta até 2N derivações PBKDF2 (N = 1 + extras). D-03 reduz o caso comum, mas não o pior. Mitigação: JSDoc e docs pedem lista curta. Fora de escopo: limitar tamanho, sem pedido.
- **R-02 — Mascarar erros.** Mitigado por D-02: só `"Bad hmac value"` avança. A expiração roda depois do unseal (`:349-365`), então um cookie expirado com senha extra falha como com `password`.
- **R-03 — Fallback legado.** Ordem fixada em D-03 e coberta por teste. A fase legada continua obedecendo `legacySealFallback: false`.
- **R-04 — Extra mal configurada.** Senha curta lança erro diferente e interrompe a busca para cookies que chegam até ela. `getSession` o engole (`:197`) e cria sessão nova. É um modo de falha seguro mas pouco visível; fica documentado e testado, sem validação nova (D-06).
- **R-05 — Dependência de string de erro.** Distinguir "senha errada" via `error.message === "Bad hmac value"` já é prática no arquivo (`:336`), mas é frágil a mudança em `iron-crypto.ts:136`. Os testes de RF-02/RF-05 quebram se a mensagem mudar.
- **R-06 — Reseal só para cookies.** Sessão por header aberta com senha extra não migra. Enquanto houver clientes assim, a senha antiga não pode sair. Documentado.
- **R-07 — Reseal concorrente.** Requisições simultâneas com o cookie antigo geram vários `Set-Cookie`; todos selados com `password`, então são equivalentes. Mesma ressalva que a doc já faz para `idleTimeout` (`docs/4.examples/handle-session.md:183`).
- **R-08 — Senha vazada.** Manter extras amplia a janela de risco; RF-04 encurta o tempo de permanência, e o JSDoc orienta remover a extra após a migração.
