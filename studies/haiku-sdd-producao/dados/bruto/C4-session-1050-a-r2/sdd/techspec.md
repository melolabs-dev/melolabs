# Especificação técnica — Múltiplas senhas de unseal nas sessões (h3js/h3#1050, variante B)

Base: `sdd/pedido.md` (contrato #1050-a) e `sdd/prd.md` (RF-01 a RF-09). Esta spec só descreve como implementar; o código não foi alterado.

Convenções de citação: `caminho:linha` relativo à raiz do projeto, conferido no código atual.

## 1. Resumo

`SessionConfig.password` passa a aceitar `string | string[]`. A primeira senha sela; todas são tentadas, em ordem, para desselar. A lógica de tentativas fica em um helper interno novo; `iron-crypto.ts` não muda. Nenhum nome público novo é exportado.

## 2. Decisões de arquitetura

### D-01 — Formato de `password`: `string | string[]`

- **Alternativas:**
  - (a) `extraUnsealPasswords` (novo campo) — proibido pelo contrato #1050-a ("nenhum outro nome público novo").
  - (b) Tupla não vazia `[string, ...string[]]` — o compilador recusaria `password: []`, mas RF-06 exige erro de runtime com mensagem clara, e a tupla obrigaria casts em testes e em listas vindas de configuração (ex.: `split`).
  - (c) `string | string[]` com validação de runtime — escolhida.
- **Justificativa:** cumpre o contrato, mantém `password: "x"` idêntico (RF-05) e deixa a validação de lista vazia para RF-06 ser testável com `password: []` sem cast.

### D-02 — Como desselar: tentativa sequencial sobre a lista

- **Alternativas:**
  - (a) Usar o suporte nativo do iron a `PasswordHash` (`src/utils/internal/iron-crypto.ts:87-89`, `:121-127`): o cookie carregaria um id de senha. Hoje o id de senha vai vazio para strings (`seal` sem id, `:68`), então isso mudaria o formato selado de novas sessões e exigiria ids por senha — contraria "sem mudanças no formato selado" (PRD, fora de escopo) e a premissa de que a ordem da lista é a única fonte de verdade.
  - (b) Tentar cada senha em ordem com `unseal` de uma senha só — escolhida.
- **Justificativa:** nenhuma mudança de formato; `unseal` continua recebendo uma senha por chamada (premissa do PRD).

### D-03 — Ordem de tentativas e fallback legado

- **Alternativas:**
  - (a) Por senha: para cada senha, tentar com opções atuais e, se falhar, com 1 iteração. Custo pior (até 2N) e a senha correta pode cair no fallback caro antes de ser testada.
  - (b) Em duas fases: todas as senhas com as opções atuais; só se todas falharem com `"Bad hmac value"` e o fallback estiver ativo, todas as senhas com 1 iteração — escolhida (recomendação do PRD, premissas).
- **Justificativa:** o caminho normal (sessão atual) nunca paga o fallback; o legado mantém o comportamento de `session.ts:332-344`.

### D-04 — Erros durante as tentativas: seguir para a próxima senha e relançar o último

- **Alternativas:**
  - (a) Fail-fast: qualquer erro que não seja `"Bad hmac value"` aborta. Quebra o caso `["A-curta", "B"]` com cookie `B`, porque `generateKey` lança `Password string too short` (`src/utils/internal/iron-crypto.ts:192-196`) antes de testar `B`.
  - (b) Continuar em qualquer erro e relançar o erro da última tentativa — escolhida.
- **Justificativa:** para senha única o erro relançado é o mesmo de hoje, então RF-05 se mantém. Erros estruturais (`Expired seal`, `Incorrect number of sealed components`, `Wrong mac prefix`) são lançados antes do HMAC (`iron-crypto.ts:99-118`), então tentar as demais senhas não custa PBKDF2.
- **Regra do fallback:** o guard de `session.ts:332-339` continua olhando só o erro final. Se a última tentativa falhou com `"Bad hmac value"`, o fallback roda.

### D-05 — Validação de lista vazia antes do `catch` de `getSession`

- **Alternativas:**
  - (a) Validar dentro de `unsealSession`. Não funciona: `getSession` chama `unsealSession` dentro de `.catch(() => {})` (`src/utils/session.ts:196-197`), que engole o erro e cria uma sessão nova sem avisar.
  - (b) Chamar `toPasswordList(config.password)` no início de `getSession`, antes do cache e antes de qualquer `try`, e de novo em `sealSession` e `unsealSession` (porque são exportadas, `src/index.ts:208-209`) — escolhida.
- **Justificativa:** o erro de configuração sobe para `useSession`/`getSession`/`updateSession` (RF-06) e não é confundido com cookie inválido.

### D-06 — Selagem sempre com a primeira senha; sem marcar a senha no cookie

- Toda selagem usa `passwords[0]`: `src/utils/session.ts:300` (`sealSession`), que é o único ponto de selagem usado por `updateSession` (`:266-267`) e pelos resels de `getSession` (`:214-215`).
- **Alternativa rejeitada:** gravar o índice ou id da senha no cookie. Mudaria o formato selado e a premissa do PRD (ordem como única fonte de verdade).

### D-07 — Sem validação de tamanho mínimo na configuração

- **Alternativas:**
  - (a) Validar cada entrada no `toPasswordList` com `minPasswordlength`. Mudaria o comportamento de senha única: hoje `getSession` com senha curta gera sessão nova em silêncio (`:197`), e a validação lançaria em toda leitura — viola RF-05.
  - (b) Manter a regra onde ela já está: `generateKey` (`src/utils/internal/iron-crypto.ts:192-196`) valida por tentativa. Senha curta em `password[0]` falha na selagem, como hoje; senha curta nas demais só falha quando é tentada — escolhida.
- **Consequência documentada:** uma senha curta fora da primeira posição nunca abre sessões, e isso não gera erro de configuração. Registrar isso na documentação do campo.

### D-08 — Expiração e resel legado: nenhuma mudança

- `maxAge` e `idleTimeout` são aplicados sobre o payload já desselado (`src/utils/session.ts:350-365`), que não depende da senha. RF-07 vale por construção.
- O resel legado (`src/utils/session.ts:214`) e o resel por deslizamento continuam chamando `updateSession`, que sela com `passwords[0]` (D-06).

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/session.ts` | Tipo de `password` (`:48`); doc do campo (`:41-47`); validação no início de `getSession` (antes de `:158`); `sealSession` usa `passwords[0]` (`:300-304`); `unsealSession` troca `unseal` por `unsealWithPasswords` (`:317-344`). Demais trechos sem mudança. |
| `src/utils/internal/session.ts` | Adicionar `toPasswordList` e `unsealWithPasswords` no fim do arquivo (`:18`), com `import type { SealOptions }` e `import { unseal }` de `./iron-crypto.ts`. Sem ciclo: o arquivo já importa de `../session.ts` apenas por tipo (`:1`). |
| `test/session.test.ts` | Novo bloco `describe("password list")` após `:186` (usa `sessionConfig` de `:21-25`, `seal` de `:12`). |
| `test/unit/types.test-d.ts` | Novo `expectTypeOf` para `SessionConfig["password"]` no fim do arquivo (padrão do `:530`). |
| `docs/4.examples/handle-session.md` | Nota sobre rotação, perto de `:37`. |
| `docs/2.utils/4.security.md` | Gerado pelo `automd` a partir do JSDoc de `session.ts` (`:44`); atualizar com `pnpm fmt`, não à mão. |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/index.ts` (nenhum export novo; `SessionConfig` já é exportado em `:203`), `src/types/context.ts` (o `password` de `:32` é do basic auth), `test/bench/session.ts`.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig
/**
 * Private key(s) used to seal session tokens. Must be at least 32 characters.
 * ... (texto atual)
 * A list seals with its first entry and unseals with any of them, in order.
 * Removing an entry makes the sessions sealed with it invalid.
 */
password: string | string[];
```

```ts
// src/utils/internal/session.ts
import { unseal } from "./iron-crypto.ts";
import type { SealOptions } from "./iron-crypto.ts";

/**
 * Normalize `SessionConfig.password` into a non-empty list.
 * @throws Error("Session password list is empty") when given `[]`.
 */
export function toPasswordList(password: string | string[]): string[];

/**
 * Try `unseal` with each password in order; return the first success.
 * If every attempt fails, rethrow the error from the last attempt.
 */
export async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  opts: SealOptions,
): Promise<unknown>;
```

Fluxo de `unsealSession` (esboço, sem mudar o restante):

```ts
export async function unsealSession(_event, config, sealed) {
  const sealOptions = { ...sealDefaults, ttl: ..., ...config.seal };
  const passwords = toPasswordList(config.password);
  let unsealed: Partial<Session>;
  try {
    unsealed = (await unsealWithPasswords(sealed, passwords, sealOptions)) as Partial<Session>;
  } catch (error) {
    // mesmo guard de hoje (session.ts:332-339)
    unsealed = (await unsealWithPasswords(sealed, passwords, { ...legacy })) as Partial<Session>;
    // ...
  }
  // maxAge e idleTimeout: sem mudança (session.ts:349-365)
}
```

Ordem garantida: `getSession` valida a lista antes do cache (`:158`) e antes do `try` interno (`:196`). Sealing: `sealSession` usa `toPasswordList(config.password)[0]`.

Nenhuma assinatura pública muda além do tipo de `password`.

## 5. Estratégia de testes

Seguir `AGENTS.md`: `describeMatrix` (web e node), `ctx.app` novo por teste.

Casos, cada um ligado a um RF:

- **RF-02 (selar com a primeira):** `useSession`/`updateSession` com `password: [A, B]`; `unseal(cookie, A)` ok e `unseal(cookie, B)` rejeita.
- **RF-03 (desselar com a segunda):** cookie selado com `B` (via `seal` de `test/session.test.ts:12`); `getSession` com `[A, B]` preserva `id` e `createdAt`.
- **RF-04 (nenhuma abre):** cookie com `C`; sessão nova (`id` diferente), sem erro não tratado (`t.errors` vazio).
- **RF-05 (senha única):** a suíte existente passa sem mudança de expectativa. Os testes de `:134-186` cobrem o legado com e sem fallback.
- **RF-06 (lista vazia):** `password: []` em `useSession` e em `getSession` gera erro não tratado com mensagem contendo "empty". Usar o padrão de `test/errors.test.ts:114-116` (`expect(t.errors[0].unhandled).toBe(true)`; `t.errors = []`).
- **RF-07 (expiração):** cookie com `B` e `createdAt` vencido por `maxAge`; com `[A, B]` a sessão é nova.
- **RF-08 (legado):** cookie com 1 iteração e `B` em `[A, B]`: carregado e resselado com `A`; com `legacySealFallback: false`: sessão nova.
- **RF-09 (rotação):** cookie com `A`; config `["B", "A"]` lê a sessão; após um write, o cookie abre com `B`. Config `"B"`: sessão nova.
- **Robustez:** cookie corrompido (bytes trocados) com lista → sessão nova, sem erro não tratado (risco de "Bad hmac" mascarado).
- **Cabeçalho de sessão:** o mesmo cenário RF-03 usando `sessionHeader` (`src/utils/session.ts:178-186`), que não ressela.
- **Tipo:** `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()` e aceitação de `password: ["a", "b"]` em `test/unit/types.test-d.ts`.
- **Opcional:** teste unitário de `toPasswordList` e `unsealWithPasswords` em `test/unit/`.

Comandos de verificação:

- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit`
- `pnpm typecheck` (script separado em `package.json:54`)
- `pnpm lint` (`package.json:46`: `oxlint` + `oxfmt --check`)
- `pnpm fmt`, para regenerar a documentação via automd.

Observação: `pnpm lint` não roda o typecheck, apesar de `AGENTS.md` dizer "lint + typecheck". Rodar os dois separadamente. `pnpm test` roda ambos.

Regra de bug fix do `AGENTS.md`: os testes de RF-03, RF-06 e RF-08 devem falhar antes da mudança. Hoje `password: [...]` não compila nem roda; a verificação da falha antes da mudança precisa ser feita por tipo (`tsc`) e pelo comportamento de runtime nos testes de senha única com a lista.

## 6. Riscos

| Risco | Origem | Mitigação |
| --- | --- | --- |
| Custo de DoS leve | Cada senha errada custa um PBKDF2 de integridade (8192 iterações). O decrypt só roda depois do HMAC (`src/utils/internal/iron-crypto.ts:133-149`), então senha errada não paga o segundo PBKDF2. Com fallback legado, o custo é até 2N. | Documentar; listas curtas. Não há mitigação adicional nesta variante. |
| Senha antiga válida enquanto estiver na lista | Vazamento de uma senha antiga permite forjar sessões. | Documentar que remover a senha é a única revogação. |
| Sessões sem `maxAge`/`idleTimeout` não expiram nunca | Sem expiração, a sessão só é resselada por escrita; remover a senha antiga desloga quem não escreveu. | Documentar o procedimento: manter a senha antiga por pelo menos `maxAge` (ou `idleTimeout`) antes de removê-la. |
| Sessões do cabeçalho nunca são resseladas | `shouldSlide` e o resel legado exigem `sessionFromCookie` (`src/utils/session.ts:214`). | Aceito; sessões de cabeçalho seguem com a senha antiga até expirar. Documentar. |
| Erros de configuração engolidos | `.catch(() => {})` em `src/utils/session.ts:197`. | D-05: validação antes do `try`. |
| Erro relançado depende da última tentativa | D-04 e a regra do fallback. | Testes de RF-08 e de cookie corrompido. |
| Senha curta fora da primeira posição | D-07: sem erro de configuração. | Documentar; considerar validação de config em versão futura. |
| Quebra de tipo em consumidores | `password` deixa de ser só `string`. Busca feita: só `src/utils/session.ts` e testes/bench leem `config.password` como string; `src/types/context.ts:32` é do basic auth. | Verificar `pnpm typecheck`. |
| Build de declarações | `isolatedDeclarations` (AGENTS.md). | Tipo explícito em `SessionConfig` e tipo de retorno explícito nas funções exportadas. |
| Vazamento de índice por tempo | O tempo de resposta revela em que posição da lista a senha está. | Baixo impacto: a ordem não é segredo. Aceito. |
| Documentação gerada | `docs/2.utils/4.security.md` vem do JSDoc via automd. | Rodar `pnpm fmt` após editar o JSDoc. |

## 7. Pendências

Nenhuma pendência bloqueante. Premissas confirmadas no código:

- Mínimo de 32 caracteres: `src/utils/internal/iron-crypto.ts:22` e `:28` (padrões) e `:192-196` (verificação em `generateKey`). A premissa do PRD está correta, mas a verificação é por tentativa (D-07).
- `unseal` e `seal` recebem uma senha por chamada (`src/utils/internal/iron-crypto.ts:58-61` e `:87-91`). A assinatura não muda.
