# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-09). Escopo: `src/utils/session.ts`, um helper interno, testes e documentação. Nenhum nome público novo; `src/utils/internal/iron-crypto.ts` não muda.

## 1. Estado atual (conferido no código)

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`).
- `sealSession` sela com `config.password` (`src/utils/session.ts:300`).
- `unsealSession` abre com `config.password` (`src/utils/session.ts:324`). Se falhar com `"Bad hmac value"`, e o fallback legado estiver ativo e as iterações atuais não forem 1, tenta de novo com 1 iteração PBKDF2 (`src/utils/session.ts:332-344`) e marca `kLegacySeal` (`src/utils/session.ts:345-347`).
- Depois de abrir, aplica `maxAge` (`src/utils/session.ts:350-355`) e `idleTimeout` (`src/utils/session.ts:359-365`).
- `getSession` engole qualquer erro de `unsealSession` com `.catch(() => {})` (`src/utils/session.ts:196-197`). Lê e remove `kLegacySeal` (`src/utils/session.ts:199-202`). Reseala via `updateSession` se `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`src/utils/session.ts:214-216`). Token do header nunca reseala porque `sessionFromCookie` é `false` (`src/utils/session.ts:178-193`).
- `unseal` do iron checa a expiração do seal (`"Expired seal"`, `src/utils/internal/iron-crypto.ts:110-118`) **antes** do HMAC, e só lança `"Bad hmac value"` quando o HMAC não confere (`src/utils/internal/iron-crypto.ts:135-137`). Senha curta demais falha em `generateKey` (`src/utils/internal/iron-crypto.ts:191-193`), com outra mensagem.
- Os símbolos internos vivem em `src/utils/internal/session.ts` (`kLegacySeal` em `:7-9`), local natural para um helper interno.
- Em `test/session.test.ts`, `sessionConfig.password` é passado direto a `seal`/`unseal` (`test/session.test.ts:137`, `:157`, `:164`). `tsconfig.json:25` inclui `test`, então esses três usos quebram o `pnpm typecheck` quando o tipo virar `string | string[]`.

## 2. Decisões de arquitetura

### D-01 — Tipo de `password` e JSDoc
- **Alternativas:** (a) `string | string[]`, como pede o pedido; (b) tupla `[string, ...string[]]`, que rejeita lista vazia em tempo de compilação; (c) campo novo `extraUnsealPasswords`, que o PRD exclui.
- **Escolha: (a).** `string[]` é o contrato do pedido. A tupla (b) dificulta quem monta a lista dinamicamente (por exemplo, `env.split(",")`) e a validação em runtime (D-03) é necessária de qualquer forma, já que o campo vem de JS. O JSDoc descreve: primeira senha sela, todas abrem, remover as antigas após o fim de `maxAge`, manter a lista curta (custo PBKDF2), e mantém os avisos de 32 caracteres e entropia.

### D-02 — Normalização interna para lista, sem mutar a config
- **Alternativas:** (a) helper interno que devolve `string[]` novo a cada chamada; (b) normalizar `config.password` in-place; (c) cachear em `WeakMap<SessionConfig, string[]>`.
- **Escolha: (a).** Mutar a config (b) viola o risco do PRD (§4) e surpreende quem reaproveita o objeto. O cache (c) é otimização sem ganho: a normalização é trivial perto de uma derivação PBKDF2. O helper fica em `src/utils/internal/session.ts` (convenção: helpers internos fora da API pública).

### D-03 — Validação explícita e cedo (RF-07)
- **Alternativas:** (a) validar só em `sealSession`/`unsealSession`; (b) validar também no início de `getSession`; (c) deixar o iron falhar com `"Empty password"`.
- **Escolha: (b).** O `getSession` engole os erros de `unsealSession` (`src/utils/session.ts:196`). Com (a), `password: []` viraria silenciosamente "sessão nova" quando há cookie, ou nem falharia sem cookie, o que viola RF-07 (a requisição não pode seguir com senha indefinida). O helper é chamado: no início de `getSession`, **antes** de ler o contexto (`src/utils/session.ts:153`), para não deixar sessão vazia em `context.sessions` e para valer também no caminho de sessão já em cache; em `sealSession` (`src/utils/session.ts:286`); e em `unsealSession` (`src/utils/session.ts:317`). `useSession` e `updateSession` herdam por chamarem `getSession`/`sealSession`.
  - Regras: string não vazia → `[string]`; array não vazio com todos os elementos string não vazios → cópia do array; qualquer outra coisa → `throw new Error("Session `password` must be a string or a non-empty array of passwords.")`.
  - Efeito colateral aceito: `password` ausente ou `""` em JS passa a falhar já no `getSession` (antes só falhava ao selar, com `"Empty password"`). Nenhum teste existente depende disso (grep em `test/` só acha `"Empty password"` em `test/unit/iron-crypto.test.ts`, que testa o iron direto).
  - O limite mínimo de 32 caracteres continua sendo do iron, por senha, sem duplicar a regra.

### D-04 — Selar usa só `passwords[0]`
- **Alternativas:** (a) `seal(session, passwords[0], …)`; (b) passar o array ao iron.
- **Escolha: (a).** O `seal` do iron aceita só `RawPassword` (`src/utils/internal/iron-crypto.ts:58-62`) e lista/mapa são não-objetivo do PRD. Mudança em `src/utils/session.ts:300`.

### D-05 — Abrir: tentativa por ordem, avançando só em `"Bad hmac value"`
- **Alternativas:** (a) laço sobre as senhas, `catch` avança apenas se `error.message === "Bad hmac value"`; (b) avançar em qualquer erro; (c) mapa de senhas por `id` do iron (`PasswordHash`), que o iron suporta mas o token não carrega, e o PRD exclui.
- **Escolha: (a).** Como o iron valida a expiração antes do HMAC (`src/utils/internal/iron-crypto.ts:110-118`), um seal expirado lança `"Expired seal"` na primeira senha e propaga: não é mascarado por tentar outras senhas. Com (b) erros reais (token malformado, senha curta, JSON inválido) seriam escondidos e o erro final seria impreciso (risco do PRD §4). Se nenhuma senha abre, relança o último `"Bad hmac value"`, igual a hoje, e o `getSession` o trata como sessão inválida (RF-04).
- Os checks de `maxAge`/`idleTimeout` (`src/utils/session.ts:349-365`) rodam **depois** da abertura, sobre o resultado, e portanto valem igualmente para senha secundária (RF-04, segundo critério).

### D-06 — Reselagem por reuso de `kLegacySeal`
- **Alternativas:** (a) reusar `kLegacySeal` marcando também a abertura por senha não primária; (b) novo símbolo (ex.: `kResealPassword`); (c) comparar no `getSession` a senha usada.
- **Escolha: (a).** É o que o PRD manda (RF-05) e evita símbolo/lógica nova: o `getSession` já remove o símbolo (`src/utils/session.ts:199-202`) e reseala só para cookie (`src/utils/session.ts:214`), logo token de header não reseala e token da senha primária não gera `Set-Cookie` extra. `id` e `createdAt` são preservados porque o reselo reutiliza o objeto de sessão. O nome `kLegacySeal` fica ligeiramente impreciso; ajustar o comentário em `src/utils/internal/session.ts:7` ("seal that must be resealed: legacy options or non-primary password") sem renomear, para não ampliar o diff.

### D-07 — Fallback legado: esgotar a lista com as opções atuais, depois a lista com 1 iteração
- **Alternativas:** (a) passe 1 = todas as senhas com opções atuais; passe 2 = todas com 1 iteração; (b) intercalar por senha (senha 1 atual, senha 1 legada, senha 2 atual…); (c) legado só para a primeira senha.
- **Escolha: (a).** É o que o PRD define (§4) e prioriza o caso comum (token atual selado com qualquer senha da lista) sem pagar derivações legadas. (b) faria sessões atuais de senha secundária pagarem uma derivação extra por senha anterior. (c) quebra RF-06. O custo no pior caso é 2N derivações, só para tokens inválidos ou legados. As condições para o passe 2 permanecem as de hoje (`src/utils/session.ts:332-337`): `legacySealFallback !== false`, iterações atuais ≠ 1 e erro `"Bad hmac value"`. O resultado do passe 2 sempre recebe `kLegacySeal` (por si só já força reselagem com a senha primária e opções atuais).
- Implementação sugerida: função interna `unsealWithAny(sealed, passwords, options)` que devolve `{ value, index }` ou relança o último erro; `unsealSession` a chama duas vezes e marca `kLegacySeal` se `index > 0` (passe 1) ou sempre (passe 2).

### D-08 — Uma senha só: caminho idêntico ao atual
- **Escolha:** string e lista de um elemento resultam em `[p]`, com exatamente uma tentativa, mesmas opções e mesmos erros de hoje (RF-08). Sem ramo separado: o laço com um elemento é o comportamento atual.

### D-09 — Documentação
- Adicionar em `docs/4.examples/handle-session.md`, logo após a nota sobre o header (`docs/4.examples/handle-session.md:49-50`), uma seção curta "Rotating the password": exemplo `password: [NEW, OLD]`, regra de selar/abrir, reselagem automática, remover a antiga após `maxAge`, aviso de custo e de que uma senha antiga comprometida segue aceita enquanto estiver na lista. Nenhum outro doc muda (`docs/2.utils/4.security.md` só trata de auth básica).

## 3. Arquivos a alterar

| Arquivo | Referência atual | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:48` | tipo `string \| string[]` + JSDoc (D-01) |
| `src/utils/session.ts` | `:153` | validar no início de `getSession` (D-03) |
| `src/utils/session.ts` | `:282-307` (`:300`) | `sealSession` valida e usa `passwords[0]` (D-03, D-04) |
| `src/utils/session.ts` | `:312-348` | `unsealSession`: dois passes (D-05, D-07), marca `kLegacySeal` (D-06) |
| `src/utils/internal/session.ts` | `:7-9`, fim do arquivo | comentário de `kLegacySeal`; novo helper interno de normalização/validação (D-02, D-03) |
| `test/session.test.ts` | `:21-25`, `:137`, `:157`, `:164` | ajustar o uso de `sessionConfig.password` como string (ver §5) e novos testes |
| `docs/4.examples/handle-session.md` | `:49-50` | seção de rotação (D-09) |

Sem mudança: `src/utils/internal/iron-crypto.ts`, `src/index.ts` (`SessionConfig` já exportado em `:203`), `src/utils/auth.ts`, `src/types/context.ts:32` (campo `password` de basic auth, outro assunto).

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — única mudança pública
export interface SessionConfig {
  /** First password seals; every password (in order) can unseal. ... */
  password: string | string[];
  // demais campos inalterados
}
// useSession, getSession, updateSession, sealSession, unsealSession: assinaturas inalteradas.

// src/utils/internal/session.ts — interno, não exportado em src/index.ts
export function resolvePasswords(config: Pick<SessionConfig, "password">): string[];
// lança Error("Session `password` must be a string or a non-empty array of passwords.")

// src/utils/session.ts — interno
async function unsealWithAny(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<{ value: Partial<Session>; index: number }>;
// tenta em ordem; avança só em "Bad hmac value"; relança qualquer outro erro; esgotada a lista, relança o último
```

Comportamento observável:
- `sealSession` → token que abre só com `passwords[0]` (RF-02).
- `unsealSession` → sessão da primeira senha que abre (RF-03); `kLegacySeal` presente quando `index > 0` ou passe legado (RF-05, RF-06).
- `getSession` → sem mudança de fluxo além da validação inicial; erro de config é lançado (rejeita a promise) e **não** é engolido, pois ocorre fora do `.catch` de `src/utils/session.ts:196`.
- A config nunca é mutada; `unsealSession` pode lançar o erro de validação (RF-07) e continua lançando `"Session expired!"` e erros do iron como hoje.

## 5. Estratégia de testes

Seguir o fluxo do `AGENTS.md`: escrever os testes novos antes e ver falhar (hoje `string[]` falha no typecheck e em runtime), depois implementar. Tudo em `test/session.test.ts`, dentro do `describeMatrix` existente (modos `web` e `node`), reaproveitando `seal`/`unseal`/`sealDefaults` já importados (`test/session.test.ts:12`) e o padrão dos testes legados (`:134-186`).

**Ajuste de testes existentes (sem perder o que verificam):** os usos de `sessionConfig.password` em `seal`/`unseal` (`:137`, `:157`, `:164`) deixam de compilar. Extrair uma constante `const PASSWORD = "1234567123456712345671234567123456712345671234567"` e usar `password: PASSWORD` em `sessionConfig` (`:23`) e nesses três pontos, mantendo asserts e opções idênticos.

Casos novos (senhas `NEW`, `OLD` de ≥ 32 caracteres, `OTHER` fora da lista):

| RF | Teste |
| --- | --- |
| RF-02 | com `[NEW, OLD]`, o cookie criado abre com `unseal(…, NEW)` e falha com `OLD` ("Bad hmac value") |
| RF-03 | cookie selado com `OLD` + config `[NEW, OLD]` → mesmo `id`/`data`, sem sessão nova; repetir via header `x-h3-test-session`; repetir com cookie em chunks (`chunkMaxLength` pequeno) |
| RF-04 | token com `OTHER` → `id` novo e `data` vazio; token de `OLD` com `maxAge` vencido (fake timers, como no teste de `idleTimeout` em `:188`) e com `idleTimeout` vencido → rejeitado |
| RF-05 | token `OLD` por cookie → `Set-Cookie` único que só abre com `NEW`, `id` e `createdAt` preservados; token `NEW` → zero `Set-Cookie`; token `OLD` por header → zero `Set-Cookie` |
| RF-06 | token com 1 iteração e `OLD` + `[NEW, OLD]` → aberto e reselado com `NEW` e opções atuais; com `legacySealFallback: false` → rejeitado |
| RF-07 | `password: []`, `[""]` e `[123 as any]`: `useSession`, `getSession`, `sealSession`, `unsealSession` rejeitam com mensagem contendo "non-empty"; também com cookie presente (garante que o erro não é engolido) |
| RF-08 | token de `"x…"` abre com `["x…"]` e o inverso; lista de um elemento não gera `Set-Cookie` extra |

Também: um teste de tipo em `test/unit/types.test-d.ts` (ou checagem por tipo em `test/session.test.ts`) de que `SessionConfig` aceita `password: string` e `password: string[]`. Verificação final: `pnpm vitest run test/session.test.ts`, depois `pnpm test` (lint + typecheck + cobertura). Se possível, medir com `test/bench/session.ts` (`:10`, `:20`) que o caminho de senha única não regride.

## 6. Riscos

| Risco | Mitigação |
| --- | --- |
| Custo PBKDF2: N senhas × até 2 passes para tokens inválidos | Primária primeiro; legado só após esgotar a lista (D-07); documentar lista curta |
| Mascarar erros reais ao tentar outras senhas | Avançar só em `"Bad hmac value"`; expiração do seal vem antes do HMAC no iron (D-05) |
| Erro de config engolido pelo `.catch` de `getSession` | Validar antes de qualquer unseal e fora do `.catch` (D-03) |
| `password` ausente passar a falhar mais cedo (mudança de momento do erro) | Aceito e documentado em D-03; só afeta configs já inválidas |
| Reselagem excessiva | Só `index > 0` ou legado marca `kLegacySeal`; teste de "sem `Set-Cookie` extra" (RF-05/RF-08) |
| `kLegacySeal` com nome impreciso | Atualizar o comentário em `src/utils/internal/session.ts:7`; renomear fica fora do escopo |
| Senha antiga comprometida segue válida na lista | Documentar; a reselagem acelera a migração |
| Senha secundária curta lançar erro do iron e rejeitar a sessão | Só ocorre se a primária falhar antes; erro do iron mantido por senha (PRD §4); não há validação extra de tamanho |
| Quebra de typecheck em testes que passam `config.password` como string | Constante `PASSWORD` em `test/session.test.ts` (§5) |
