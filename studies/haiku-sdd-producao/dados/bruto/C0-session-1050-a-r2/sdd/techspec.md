# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md`. Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `8d0aeda`).

## 1. Resumo

`SessionConfig.password` passa de `string` para `string | string[]`. Em lista, a primeira senha sela e todas abrem, na ordem. Uma sessão aberta com senha que não é a primeira é regravada com a primeira, pelo mesmo caminho de reselagem do selo legado. Nenhum nome público novo. `iron-crypto` não muda.

## 2. Estado atual (conferido)

- `src/utils/session.ts:48` — `password: string;` e JSDoc em `:40-47` (mínimo de 32 caracteres, entropia).
- `src/utils/session.ts:300` — `sealSession` chama `seal(session, config.password, …)`.
- `src/utils/session.ts:312-367` — `unsealSession`: `unseal(sealed, config.password, sealOptions)` em `:324`; no `catch` (`:325`), o fallback legado só roda se `error.message === "Bad hmac value"` e `legacySealFallback !== false` e `iterations !== 1` (`:332-339`); a segunda tentativa usa 1 iteração (`:340-344`) e marca `kLegacySeal` (`:345-347`). Checagens de `maxAge`/`idleTimeout` vêm depois (`:349-365`).
- `src/utils/session.ts:196-216` — `getSession` chama `unsealSession`, lê e apaga `kLegacySeal` (`:199-202`) e reseala com `updateSession` quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`:214`). Erros de unseal viram sessão nova via `.catch(() => {})` (`:197`).
- `src/utils/internal/iron-crypto.ts:171-196` — `generateKey` aplica o mínimo de senha (`:191-196`, mensagem `Password string too short (min N characters required)`); `seal` rejeita senha falsa com `"Empty password"` (`:65-67`); `unseal` idem (`:94-96`). O mínimo vem de `defaults.*.minPasswordlength = 32` (`:22`, `:28`) e pode ser sobrescrito por `config.seal`.
- `unseal` interpreta objeto como mapa `id → senha` (`:122-128`): **uma `string[]` nunca pode ser repassada a `seal`/`unseal`** (`seal` trataria o array como `PasswordSecret`/`PasswordSpecific` e falharia com erro obscuro; `unseal` buscaria `"default" in array`).
- `unseal` lança `"Bad hmac value"` (`:136`) para senha errada; os demais erros (`"Expired seal"` `:116`, `"Incorrect number of sealed components"` `:100`, `"Wrong mac prefix"` `:107`, `"Invalid expiration"` `:112`) independem da senha.
- Símbolos internos: `src/utils/internal/session.ts:7-9` (`kLegacySeal`).
- Exports públicos: `src/index.ts:203-212` (sem alteração).

## 3. Decisões de arquitetura

### D-01 — Normalizar `password` num helper interno que devolve `string[]`

**Alternativas**
1. Espalhar `Array.isArray(config.password)` em `sealSession` e `unsealSession`.
2. Normalizar no início de `SessionConfig` (transformar a config) antes de usar.
3. Helper privado `getPasswords(config, sealOptions): string[]` em `src/utils/session.ts`, no fim do arquivo (convenção do AGENTS.md: helpers internos no fim).

**Escolha: 3.** Centraliza em um lugar a regra "string ≡ lista de um item", a rejeição de lista vazia e a validação de tamanho; evita duplicar o `Array.isArray`. A opção 2 muta/copia config do usuário a cada chamada sem ganho. O helper não é exportado, então não cria nome público (RF-01).

### D-02 — Validar a lista inteira antes de usar (falhar cedo), sem mudar `iron-crypto`

**Alternativas**
1. Deixar `generateKey` rejeitar senhas curtas de forma lazy (só a que for tentada).
2. Validar todas as senhas no helper, com o mesmo texto de erro do `iron-crypto`.
3. Exportar de `iron-crypto.ts` uma função de validação reutilizável.

**Escolha: 2.** Com a opção 1, `["válida", "curta"]` só falharia se a primeira não abrisse, escondendo config inválida até a rotação em produção; o PRD (RF-08) pede erro claro. A opção 3 altera um arquivo que o PRD declara fora de escopo (§3). O helper lança `Error("Empty password")` para lista vazia ou senha vazia (mesma mensagem de `iron-crypto.ts:66`) e `Error("Password string too short (min N characters required)")` para itens curtos, com `N = max(encryption.minPasswordlength, integrity.minPasswordlength)` de `sealOptions` (respeita overrides em `config.seal`). Mesmo tipo (`Error`) e mesma mensagem que hoje. Item não-string na lista também gera erro (`TypeError` não é necessário; usar `Error("Invalid password")`), pois só `string` é aceito pelo tipo.

Efeito colateral aceito: em `getSession`, esse erro continua sendo engolido por `.catch(() => {})` (`:197`) — igual a hoje com senha curta; já `sealSession`/`updateSession` propagam. Não mudamos esse tratamento.

### D-03 — A primeira senha sela

`sealSession` (`src/utils/session.ts:300`) passa `getPasswords(config, sealOptions)[0]`. Como hoje `seal` recebe `{...sealDefaults, ttl, ...config.seal}` inline, extrair esse objeto para uma const local (`sealOptions`) reaproveitável pelo helper. Sem alternativa relevante: o PRD fixa a regra (RF-02).

### D-04 — Unseal: duas fases (formato atual em todas as senhas, depois legado em todas)

**Alternativas**
1. Por senha: tentar atual, depois legado, e só então a próxima senha.
2. Duas fases: fase 1 tenta o formato atual com cada senha na ordem; fase 2 (se `legacySealFallback !== false` e `iterations !== 1`) tenta o legado com cada senha.
3. Em paralelo (`Promise.any`).

**Escolha: 2.** O caso comum de rotação é cookie no formato atual selado com a senha antiga. Com a opção 1, ele pagaria um PBKDF2 legado inútil com a senha nova antes de chegar à antiga (custo ≈ 2N−1 derivações de par; com a 2, N). O legado continua tentado para cada senha (RF-07), só depois. A opção 3 dispara N derivações PBKDF2 por requisição mesmo quando a primeira abre, contra o objetivo de mitigar custo de CPU (PRD §4); descartada. Para em primeira sucesso.

Estrutura (esboço, em `unsealSession`, `:312-348`):

```ts
const passwords = getPasswords(config, sealOptions);
let unsealed: Partial<Session> | undefined;
let rotated = false;
let legacy = false;
for (const [i, password] of passwords.entries()) {
  try { unsealed = await unseal(sealed, password, sealOptions); rotated = i > 0; break; }
  catch (error) { if (!isBadPassword(error)) throw error; lastError = error; }
}
if (!unsealed && legacyAllowed) { /* mesmo laço com iterations: 1 → legacy = true; rotated = i > 0 */ }
if (!unsealed) throw lastError;
```

`isBadPassword(error)` é `error instanceof Error && error.message === "Bad hmac value"` — a mesma condição de hoje (`:334-336`), extraída para função interna.

### D-05 — Só "senha errada" leva à próxima tentativa; os demais erros abortam

Erros de formato/expiração do selo (`Expired seal`, componentes, prefixo, expiração inválida) não dependem da senha: repetir só gasta CPU. Eles são relançados na hora, como hoje. `"Bad hmac value"` é o único erro que avança para a próxima senha (risco "erros mascarados" do PRD). Se todas falham, relança-se o erro da **primeira** tentativa de formato atual (`"Bad hmac value"`), preservando a mensagem de hoje para `string` única.

Nota de ordem: `unseal` checa a expiração do selo (`iron-crypto.ts:110-118`) antes do HMAC; logo um selo expirado falha com `Expired seal` sem testar senhas.

As checagens de `maxAge`/`idleTimeout` (`:349-365`) ficam **depois** do laço e valem para a sessão inteira, independentemente de qual senha abriu (RF/PRD §4: expiração com senha antiga).

### D-06 — Sinalizar "aberta com senha não primária" com novo símbolo interno e reaproveitar a reselagem

**Alternativas**
1. Reutilizar `kLegacySeal` para os dois casos.
2. Novo símbolo interno `kRotatedSeal` em `src/utils/internal/session.ts` (ao lado de `:7-9`), marcado em `unsealSession` e consumido em `getSession`.
3. Fazer `getSession` comparar a senha usada (precisaria vazar a senha no resultado).

**Escolha: 2.** `kLegacySeal` significa "iterações antigas"; sobrecarregá-lo confunde leitura. A opção 3 expõe segredo. O novo símbolo é interno (não exportado em `src/index.ts`), seguindo a convenção `k*`. Em `getSession` (`:199-202`, `:214`), ler e apagar ambos os símbolos antes de copiar para `session` e reselar se `session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(...))`. Reaproveita `updateSession`, que sela com a primeira senha (D-03) e as opções atuais — satisfaz RF-04 e RF-07 (legado em senha antiga: reselado com a primeira e as opções atuais).

Sessão vinda do cabeçalho (`sessionFromCookie === false`) não é reselada, como hoje para legado/slide; ela continua legível com qualquer senha da lista. Documentar na doc (D-09).

### D-07 — `clearSession` e demais assinaturas não mudam

`clearSession` recebe `Partial<SessionConfig>` (`:372`) e nunca lê `password`; `useSession`/`getSession`/`updateSession` só repassam `config`. Alterar o tipo do campo basta para RF-09; nenhuma assinatura de função muda.

### D-08 — Tipo: `string | string[]`, sem tupla não vazia

**Alternativas**
1. `[string, ...string[]]` (não vazio no tipo).
2. `string | string[]`, vazio rejeitado em runtime (D-02).

**Escolha: 2.** É o que o PRD fixa (RF-01) e permite `process.env.X.split(",")` e arrays construídos dinamicamente sem casts; a garantia de não vazio vem do runtime (RF-08). A opção 1 daria erro de compilação em código legítimo vindo de `string[]`.

### D-09 — Documentação

JSDoc de `password` em `src/utils/session.ts:40-48` descreve a lista (primeira sela, demais só abrem, ordem significativa, remover a antiga depois, listas curtas pelo custo PBKDF2, cada senha ≥ 32 caracteres). `docs/4.examples/handle-session.md`: nova subseção "Rotating the password" após o aviso de `:36-43` (ou antes de `## Expiration`, `:151`), e ajuste de `:143` ("Every option is optional except `password`") para citar a forma `string | string[]`. `docs/2.utils/4.security.md` só cita `password` de `basicAuth`, sem relação — não muda.

## 4. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:40-48` | tipo `string \| string[]` + JSDoc |
| `src/utils/session.ts` | `:196-216` | `getSession`: ler/apagar `kRotatedSeal`, incluí-lo na condição de reselagem |
| `src/utils/session.ts` | `:300-304` | `sealSession`: `sealOptions` local + primeira senha |
| `src/utils/session.ts` | `:312-348` | `unsealSession`: laço em duas fases (D-04/D-05), marca símbolos |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | helpers privados `getPasswords`, `isBadPassword` |
| `src/utils/internal/session.ts` | após `:9` | `export const kRotatedSeal` |
| `test/session.test.ts` | `:137`, `:157`, `:164` | passam `sessionConfig.password` (agora `string \| string[]`) a `seal`/`unseal`, que exigem `string`: trocar por uma const `password` (string) definida em `:23` e reutilizada em `sessionConfig`. Mantém exatamente o que verificam |
| `test/session.test.ts` | fim do `describeMatrix` | novos testes (§6) |
| `docs/4.examples/handle-session.md` | `:36-43`/`:143`/`:151` | seção de rotação |
| `CHANGELOG.md` | — | **não** editar (gerado por release); registrar a quebra de tipo nas notas de versão (risco R-04) |

Os demais usos `password: sessionConfig.password` em `test/session.test.ts` (`:195`, `:238`, … `:695`) atribuem a campo de `SessionConfig` e continuam compilando sem alteração.

Não mudam: `src/index.ts` (nenhum export novo — verificar com diff), `src/utils/internal/iron-crypto.ts`, `src/types/context.ts:32` (é `password` do `basicAuth`, não de sessão).

## 5. Contratos e assinaturas

Públicos (únicos que mudam, apenas no tipo do campo):

```ts
export interface SessionConfig {
  /** … primeira sela; as demais só abrem … */
  password: string | string[];
  // restante inalterado
}
```

`useSession`, `getSession`, `updateSession`, `sealSession`, `unsealSession`, `clearSession`: assinaturas idênticas.

Internos (não exportados em `src/index.ts`):

```ts
// src/utils/internal/session.ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.rotated-seal");

// src/utils/session.ts (privados)
function getPasswords(config: SessionConfig, sealOptions: SealOptions): string[];
function isBadPassword(error: unknown): boolean;
```

Comportamento:

- `string` ≡ `[string]`. `[]` ou senha vazia → `Error("Empty password")`. Senha curta → `Error("Password string too short (min N characters required)")`.
- Sela: sempre `passwords[0]`. Abre: ordem da lista, para na primeira que verifica.
- Falha com todas as senhas da lista (RF-05) → erro de unseal → `getSession` cria sessão nova com `id` novo, sem erro ao cliente.
- `unsealSession` pode devolver `kRotatedSeal` e/ou `kLegacySeal` no objeto (símbolos internos; `getSession` os remove antes de copiar para a sessão — mesmo contrato do legado hoje).

## 6. Estratégia de testes

Seguir `AGENTS.md`: bug/feature com teste de regressão **que falha antes** da mudança. Ordem: escrever os testes, rodar e confirmar falha (tipo/comportamento), implementar, rodar de novo. Todos em `test/session.test.ts` com `describeMatrix` (web + node), reaproveitando `seal`/`unseal`/`sealDefaults` (importados em `:12`) para fabricar cookies com senha antiga. Senhas de teste com ≥ 32 caracteres e nomes como `nova-senha-…`/`antiga-senha-…`/`senha-removida-…` (PRD).

| Teste | Cobre |
| --- | --- |
| selo com lista usa a primeira (abre só com a nova; não abre só com a antiga) | RF-02 |
| cookie selado com a antiga abre com `[nova, antiga]`, mesmo `id` e `data` | RF-03 |
| aberto com a antiga → resposta traz `Set-Cookie` que abre só com a nova, preserva `id`/`data`; cookie já na primeira senha não gera `Set-Cookie` extra | RF-04 |
| senha fora da lista → `id` diferente, `data` vazio, status 200 | RF-05 |
| `string` e lista de um item abrem o mesmo cookie; suíte existente intacta | RF-06 |
| legado (1 iteração) com a antiga em 2ª posição: aceito e reselado com a nova e opções atuais; com `legacySealFallback: false`: rejeitado | RF-07 |
| `password: []` e item curto (também em 2ª posição) → erro; `sealSession`/`updateSession` rejeitam, `getSession` cria sessão nova | RF-08 |
| `unsealSession`, `sealSession`, `updateSession`, `clearSession`, `getSession`, `useSession` com lista | RF-09 |
| `maxAge` e `idleTimeout` expirados com cookie da senha antiga → sessão nova (expiração vale com qualquer senha) | risco "erros mascarados" |
| sessão vinda do cabeçalho, selada com a antiga: lida, sem `Set-Cookie` | D-06 |
| cookie com selo expirado/malformado não tenta outras senhas (espiar `unseal` não é viável; validar só o resultado: sessão nova) | D-05 |

Teste de tipos: sem `.test-d.ts` novo; o `pnpm typecheck` já cobre os testes que usam `string[]` (RF-01). Confirmar com `git diff src/index.ts` vazio que nenhum export foi criado.

Verificação final: `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck`, e `pnpm vitest run` completo. Para RF-10 ("falham se a mudança for revertida"): rodar os novos testes com `git stash` das mudanças em `src/` e ver falhar.

## 7. Riscos

- **R-01 CPU (PBKDF2):** N senhas multiplicam o custo no pior caso (cookie inválido: N derivações atuais + N legadas, cada derivação em par encryption/integrity). Mitigação: duas fases com parada no primeiro sucesso (D-04), só "Bad hmac value" avança (D-05), recomendação de lista curta na doc. Cookie forjado de atacante paga o pior caso: aceito, proporcional a N pequeno.
- **R-02 Erros mascarados:** mitigado por D-05 e pelo teste de expiração com senha antiga.
- **R-03 Reselagem em leitura:** gera `Set-Cookie` em requisições de leitura na primeira vez após rotação; só para cookies (não cabeçalho). Reaproveita `updateSession`, inclusive o espelhamento em `errHeaders` (`:273`, `:435-449`).
- **R-04 Quebra de tipo:** código/plugins que leem `config.password` como `string` passam a ter erro de TS. Os 3 usos em `test/session.test.ts` (`:137`, `:157`, `:164`) são exatamente esse caso e serão ajustados. Registrar nas notas de versão.
- **R-05 Segurança:** senha antiga esquecida mantém sessões antigas válidas; documentar o procedimento (adicionar nova à frente → esperar `maxAge`/reselagem → remover a antiga).
- **R-06 Duplicação da mensagem de senha curta:** o texto é copiado de `iron-crypto.ts:193-195`; se mudar lá, diverge aqui. Aceito para não tocar `iron-crypto` (D-02); um teste compara a mensagem.
- **R-07 Corrida entre N tentativas e `await`:** o laço é sequencial dentro da `Promise` única de `getSession` (`:219`), então a deduplicação por `kGetSession` continua valendo; sem estado compartilhado novo.

## 8. Fora de escopo (reafirmado)

`extraUnsealPasswords` ou qualquer nome público novo; mudanças no formato do cookie, algoritmos ou padrões de `iron-crypto`; rotação automática; remoção do fallback legado; `requireBasicAuth`.
