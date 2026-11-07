# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Toda a mudança fica em `src/utils/session.ts` e `src/utils/internal/session.ts`, mais testes novos em `test/session.test.ts`. Nenhum nome público novo além de `SessionConfig.extraUnsealPasswords`.

## 1. Situação atual (conferida no código)

- `SessionConfig.password: string` em `src/utils/session.ts:48`; `legacySealFallback` em `src/utils/session.ts:95`.
- `sealSession` sela com `config.password` em `src/utils/session.ts:300`.
- `unsealSession` (`src/utils/session.ts:312-367`):
  - tenta `unseal(sealed, config.password, sealOptions)` em `:324`;
  - no `catch` (`:325-348`) só cai no fallback legado de 1 iteração se o erro for exatamente `"Bad hmac value"` (`:332-337`) e marca o resultado com `kLegacySeal` (`:345-347`);
  - depois do unseal, aplica `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`).
- `getSession` chama `unsealSession` em `src/utils/session.ts:196`, remove `kLegacySeal` do objeto (`:199-202`) e refaz o seal quando `legacySeal || shouldSlide(...)`, só para sessão vinda de cookie (`:214-216`).
- `src/utils/internal/iron-crypto.ts:87` (`unseal`) lança, nesta ordem: `"Incorrect number of sealed components"` (`:100`), `"Wrong mac prefix"` (`:107`), `"Invalid expiration"` (`:112`), `"Expired seal"` (`:116`), erros de senha vazia/curta (`:94`, `generateKey` `:172` e `:192`) e `"Bad hmac value"` (`:136`). Só o último significa "senha errada"; os anteriores não dependem da senha.
- Símbolos internos de sessão em `src/utils/internal/session.ts:3-9` (`kGetSession`, `kSessionNew`, `kLegacySeal`).
- `unsealSession`/`sealSession` são exportadas em `src/index.ts:208-209` e conferidas por `test/unit/package.test.ts:125,149`. Não são criados exports novos, então esse teste não muda.
- `docs/2.utils/4.security.md:56-62` é gerado por automd a partir do JSDoc das funções; a interface não aparece ali, então não há doc gerada para atualizar.

## 2. Decisões de arquitetura

### D-01 — Campo `extraUnsealPasswords?: string[]` em `SessionConfig`
- **Alternativas:** (a) `password: string | string[]` (2ª alternativa da issue); (b) objeto de senhas com id; (c) campo novo separado.
- **Escolha:** (c). É o que pedem o contrato e o PRD (RF-01, fora de escopo). Mantém `password: string` e deixa explícito que só ela sela. Em (a) e (b) o tipo de `password` mudaria e quebraria quem lê `config.password`.
- Contrato em `src/utils/session.ts`, logo após `password` (`:48`):

```ts
/**
 * Previous passwords, tried in order after `password` when unsealing a session.
 * They never seal: sessions opened with one are resealed with `password`
 * (cookie sessions only). Same length/entropy requirements as `password`.
 * Keep the list short (each failed attempt costs a PBKDF2 derivation) and
 * remove a password once its sessions have migrated, or when it leaks.
 */
extraUnsealPasswords?: string[];
```

### D-02 — Lógica de tentativas dentro de `unsealSession`, assinatura pública intacta
- **Alternativas:** (a) laço em `getSession` chamando `unsealSession` uma vez por senha; (b) nova função exportada; (c) laço dentro de `unsealSession` com helper interno.
- **Escolha:** (c). (a) deixaria `unsealSession`, que é pública, sem suporte às senhas extras e duplicaria a checagem de expiração. (b) cria nome público, proibido. Em (c) quem chama `unsealSession` diretamente ganha o recurso sem mudança de assinatura (`(event, config, sealed) => Promise<Partial<Session>>`, `src/utils/session.ts:312-316`).
- Helper interno no fim do arquivo (convenção "helpers internos no fim", AGENTS.md), sem `export`:

```ts
/** Unseals with `password`, then each extra password; `extra` is true when an extra one opened it. */
async function unsealWithPasswords(
  sealed: string,
  config: SessionConfig,
  options: SealOptions,
): Promise<{ unsealed: Partial<Session>; extra: boolean }>;
```

- Comportamento: monta `passwords = [config.password, ...(config.extraUnsealPasswords ?? [])]`, descartando repetidas (uma extra igual a `password` ou duplicada só gastaria PBKDF2). Para cada senha chama `unseal(sealed, pw, options)`. `extra = index > 0`.

### D-03 — Só `"Bad hmac value"` passa para a próxima senha
- **Alternativas:** (a) tentar a próxima senha em qualquer erro; (b) só em `"Bad hmac value"`; (c) validar o formato antes e tentar todas.
- **Escolha:** (b). É a mesma condição que já aciona o fallback legado (`src/utils/session.ts:336`) e é o único erro que significa "senha errada". Erros como `"Expired seal"`, `"Wrong mac prefix"` e `"Incorrect number of sealed components"` independem da senha: tentar de novo repetiria o erro e gastaria CPU à toa (e (a) esconderia a causa real, risco "erros mascarados" do PRD). (c) duplica validação do `iron-crypto`.
- Consequência aceita: uma extra mais curta que 32 caracteres lança erro de senha curta e interrompe a lista; a sessão é descartada, como acontece hoje com `password` curta (premissa do PRD). Registrado em R-05.
- Se todas as senhas terminarem em `"Bad hmac value"`, o último erro é relançado (RF-05; `getSession` já engole o erro em `:197`).

### D-04 — Ordem das tentativas: iterações atuais em todas as senhas, depois legado em todas
- **Alternativas:** (a) por senha: atual → legado, depois próxima senha; (b) por faixa de iteração: todas as senhas com as iterações atuais, depois todas com 1 iteração.
- **Escolha:** (b). No caso comum da rotação (sessão moderna selada com a senha antiga) custa 2 derivações em vez de 3 (em (a): `password` atual, `password` legado, extra atual). O legado só roda quando nenhuma senha abre com as iterações atuais, e a derivação de 1 iteração é barata. Quem não usa senhas extras percorre exatamente as mesmas etapas de hoje (RF-07).
- O legado continua condicionado a `config.legacySealFallback !== false` e a `sealOptions.integrity.iterations !== 1` (`src/utils/session.ts:333-334`), e só é tentado quando a falha das iterações atuais foi `"Bad hmac value"` em todas as senhas (RF-08). O resultado legado recebe `kLegacySeal` como hoje (`:345-347`).
- Implementação: o corpo do `catch` atual (`:325-348`) vira a segunda passada do helper com as opções de 1 iteração (as mesmas de `:340-344`).

### D-05 — Marcador interno `kExtraSeal` para o reseal (RF-04)
- **Alternativas:** (a) reutilizar `kLegacySeal` para significar "precisa de reseal"; (b) novo símbolo interno; (c) comparar `getSession` com um segundo unseal só com `password`.
- **Escolha:** (b). (a) mistura dois significados num nome que já é legível como "selo legado". (c) dobra o custo de CPU. O símbolo vai em `src/utils/internal/session.ts` ao lado de `kLegacySeal` (`:7-9`), não é exportado de `src/index.ts`:

```ts
export const kExtraSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.extra-seal");
```

- `unsealSession` seta `(unsealed as any)[kExtraSeal] = true` quando `extra` é verdadeiro (mesmo padrão de `:346`).
- `getSession` (`src/utils/session.ts:199-202`) lê e apaga os dois marcadores, para que não vazem para `session` (o `Object.assign` copia propriedades-símbolo próprias, por isso o `delete` existente), e a condição de `:214` vira `(legacySeal || extraSeal || shouldSlide(session, config))`. A guarda `sessionFromCookie` (`:214`) já garante que sessão vinda de header não é resselada.
- O reseal usa `updateSession` → `sealSession`, que sempre sela com `config.password` (D-06); `id`, `createdAt` e `data` vêm do objeto `session`, portanto são preservados (RF-04).

### D-06 — `sealSession` não muda
- `src/utils/session.ts:300` continua usando só `config.password`; a garantia de RF-03 é estrutural (nenhum código de seal lê `extraUnsealPasswords`). O teste a prova (seção 4).

### D-07 — Expiração depois de qualquer unseal bem-sucedido
- Os blocos de `maxAge`/`idleTimeout` (`src/utils/session.ts:349-365`) ficam depois do laço, comuns a qualquer senha, sem mudança (RF-06). O helper só devolve após um unseal válido; as checagens de expiração e o `kExtraSeal` nunca resseliam uma sessão expirada, pois `getSession` só resela quando `session.id` existe (`:214`) e `unsealSession` lançou antes disso.

### D-08 — Documentação
- JSDoc do campo (D-01) é a documentação. Não há alteração em `docs/` (a seção gerada por automd cobre só funções). Rodar `pnpm fmt` ao final só para confirmar que não há diff.

## 3. Arquivos a alterar

| Arquivo | Linhas de referência | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:5` | importar `kExtraSeal` junto de `kLegacySeal` |
| `src/utils/session.ts` | `:48` | novo campo `extraUnsealPasswords` com JSDoc (D-01) |
| `src/utils/session.ts` | `:199-202`, `:214` | ler/apagar `kExtraSeal`; incluí-lo na condição de reseal (D-05) |
| `src/utils/session.ts` | `:312-348` | substituir `try/catch` por chamada ao helper (D-02..D-04); manter `:349-367` |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | helper interno `unsealWithPasswords` |
| `src/utils/internal/session.ts` | `:7-9` | novo símbolo `kExtraSeal` |
| `test/session.test.ts` | após `:186` (depois do teste de `legacySealFallback: false`) | novos testes (seção 4) |

Nenhum teste existente precisa mudar: o comportamento sem `extraUnsealPasswords` é idêntico (RF-07). Se algum quebrar, o ajuste deve manter a verificação original.

## 4. Estratégia de testes

Novos casos dentro do `describeMatrix("session", ...)` existente (`test/session.test.ts:15`), reutilizando `sessionConfig` (`:21-25`), `seal`/`unseal`/`sealDefaults` (`:12`) e o padrão de cookie `h3-test=...` do teste legado (`:134-159`). Constantes: `OLD = "..."` e `OTHER = "..."` com ≥ 32 caracteres, diferentes de `sessionConfig.password`. Cada teste registra uma rota própria com `{ ...sessionConfig, extraUnsealPasswords: [OLD] }`. A sessão de semente é selada direto com `seal(..., OLD, sealDefaults)`.

| Teste | RF | Verificação |
| --- | --- | --- |
| abre sessão selada com senha extra | RF-02 | `id` e `data` do seed recuperados; `[kSessionNew]` ausente (id não é o gerado) |
| sela sempre com `password` | RF-03 | cookie emitido por `updateSession` abre com `password` e falha (`Bad hmac value`) só com a extra |
| resela cookie aberto com senha extra | RF-04 | resposta tem `Set-Cookie` que abre com `password` com mesmos `id`, `createdAt`, `data` |
| não resela sessão de header | RF-04 | com header de sessão selado com extra, resposta sem `Set-Cookie` |
| rejeita senha desconhecida | RF-05 | sessão selada com `OTHER`: `id` novo, `data` `{}`, `t.errors` vazio |
| respeita `maxAge` com senha extra | RF-06 | seed com `createdAt` antigo (fake timers só de `Date`, como `:189-190`): sessão nova |
| respeita `idleTimeout` com senha extra | RF-06 | idem com `lastSeenAt` antigo |
| legado + senha extra | RF-08 | seed com `OLD` e 1 iteração: aceito e resselado com `password` e iterações atuais (`unseal(..., password, sealDefaults)` sem fallback); com `legacySealFallback: false`: rejeitado |
| `extraUnsealPasswords: []` equivale a ausente | RF-07 | mesmo resultado do teste existente de sessão normal |
| `password` tem prioridade e não chama extras | D-02 | sessão selada com `password` abre; (opcional) espiar `subtle.deriveBits`/contador, como o teste de seal em `:413` |
| erro que não é de senha não percorre a lista | D-03 | token malformado/`Expired seal` com extras: sessão nova, sem erro registrado |

Ordem do fluxo de trabalho do AGENTS.md: escrever os testes, confirmar que falham (ao menos RF-02/04/08 falham sem a mudança), implementar, confirmar que passam. Depois: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck`.

## 5. Riscos

- **R-01 — CPU/DoS:** cada tentativa falha custa PBKDF2 (8192 iterações) por senha, mais a passada legada. Mitigações: `password` primeiro, dedupe das senhas (D-02), só `"Bad hmac value"` continua (D-03), passada legada só no fim (D-04) e JSDoc pedindo lista curta.
- **R-02 — Erros mascarados:** tratado em D-03; o último erro de senha é relançado, e erros independentes de senha saem imediatamente.
- **R-03 — Expiração:** checagens ficam depois de qualquer unseal (D-07); coberto por testes de `maxAge` e `idleTimeout` com senha extra.
- **R-04 — Segurança operacional:** senha vazada em `extraUnsealPasswords` continua abrindo sessões. Mitigação só documental (JSDoc), conforme PRD; migração por cookie (D-05) permite aposentá-la.
- **R-05 — Extra curta na frente de outra válida:** erro de senha curta interrompe a lista (D-03); equivale ao comportamento atual de `password` curta. Documentado no JSDoc ("mesmos requisitos").
- **R-06 — Vazamento do marcador:** se `kExtraSeal` não for apagado em `getSession`, ele iria para `session` e para o `seal` seguinte. Coberto pelo `delete` (D-05) e pelo teste de RF-04 (comparar o payload resselado).
- **R-07 — Regressão em `unsealSession` pública:** assinatura e erros preservados quando não há extras (mesma sequência de chamadas a `unseal`: iterações atuais e, em `"Bad hmac value"`, uma tentativa legada).
- **R-08 — Sessões só por header:** continuam com a senha antiga até o cliente regravar (premissa do PRD); sem mitigação em código.
