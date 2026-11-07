# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-08). Esta especificação não altera código; descreve a mudança a implementar.

## 1. Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Só `unsealSession` muda de comportamento: tenta `password` e depois cada senha extra. `sealSession` permanece intocada (já sela só com `config.password`). Uma sessão aberta com senha extra é marcada com `kLegacySeal`, e o `getSession` existente a resela com `password` quando ela veio de cookie. Nenhum nome público novo, nenhuma mudança em `iron-crypto`.

## 2. Decisões de arquitetura

### D-01 — Campo separado `extraUnsealPasswords`, `password` continua `string`
- **Alternativas:** (a) `password: string | string[]` (segunda alternativa da issue); (b) campo novo `extraUnsealPasswords`.
- **Escolha:** (b). É o que o pedido e o PRD exigem (RF-01, "Fora de escopo"). Além disso, mantém o tipo de `password` estável para quem lê `config.password` (`sealSession` em `src/utils/session.ts:300` e `unsealSession` em `src/utils/session.ts:324`) e evita estreitar tipos em código de usuário. O campo é inserido em `SessionConfig` logo após `password` (`src/utils/session.ts:48`), com JSDoc: só abre sessões, ordem de tentativa, lista curta (custo de PBKDF2 por senha), remover após a migração, mesma exigência de 32+ caracteres.

### D-02 — Laço de tentativas dentro de `unsealSession`, sem função pública nova
- **Alternativas:** (a) novo helper exportado `unsealWithPasswords`; (b) laço dentro de `unsealSession`, com helper interno não exportado no fim do arquivo; (c) mudar `unseal` de `iron-crypto.ts` para aceitar lista.
- **Escolha:** (b). (a) viola "nenhum outro nome público novo" (e `test/unit/package.test.ts:125/149` lista os exports públicos). (c) viola "não alterar `iron-crypto`" e sua API já aceita `PasswordHash` com semântica diferente (ids de senha no selo). O helper interno segue a convenção "helpers internos no fim do arquivo" do AGENTS.md.

### D-03 — Só avança para a próxima senha em `"Bad hmac value"`
- **Alternativas:** (a) tentar a próxima senha após qualquer erro; (b) só após HMAC inválido.
- **Escolha:** (b), igual ao critério já usado no fallback legado (`src/utils/session.ts:336`, comparando `error.message`). Erros como `"Expired seal"`, `"Incorrect number of sealed components"`, `"Wrong mac prefix"` e a expiração `"Session expired!"` (`src/utils/session.ts:353`, `:363`) saem imediatamente, sem mascaramento (RF-04). Consequência aceita: uma senha extra inválida (curta ou vazia) lança `"Password string too short"`/`"Empty password"`, que não é HMAC; propaga, e `getSession` descarta a sessão (`.catch(() => {})`, `src/utils/session.ts:197`). É erro de configuração que deve aparecer em vez de ser engolido silenciosamente (ver R-05).

### D-04 — Ordem: iterações atuais em todas as senhas, depois iterações legadas em todas
- **Alternativas:** (a) para cada senha, tentar atual e depois legado; (b) fase 1 = todas as senhas com as opções atuais; fase 2 (só se permitido) = todas com 1 iteração.
- **Escolha:** (b). Sessões legadas são minoria e transitórias, e (b) preserva o RF-07: sem extras, a sequência é exatamente a de hoje (1 tentativa atual, depois 1 legada se couber). Com (a) a senha atual pagaria um PBKDF2 legado antes de tentar as extras em iterações atuais, que é o caso comum de rotação. A fase 2 mantém as condições atuais (`src/utils/session.ts:333-336`): `legacySealFallback !== false`, `sealOptions.integrity.iterations !== 1` e último erro HMAC. Isso cobre RF-06.

### D-05 — Reselagem reaproveitando `kLegacySeal`
- **Alternativas:** (a) novo símbolo (ex.: `kResealNeeded`) em `src/utils/internal/session.ts`; (b) reutilizar `kLegacySeal`.
- **Escolha:** (b). O consumidor (`src/utils/session.ts:199-201` remove a marca; `:214` chama `updateSession` apenas se `session.id && sessionFromCookie`) já faz exatamente o que o RF-05 pede, inclusive não reselar sessões vindas do header. Um símbolo novo exigiria alterar `getSession` sem ganho funcional; o símbolo é interno (`src/utils/internal/session.ts:7`), então o nome `legacy` é apenas semântico. Registrar isso em comentário no ponto onde a marca é aplicada. `updateSession` → `sealSession` sela com `config.password` e opções atuais, logo a sessão passa a abrir só com `"nova"` e mantém `id`.

### D-06 — Marca também para senha extra com iterações atuais
Qualquer sucesso com índice de senha > 0, ou na fase legada, marca `kLegacySeal`. Sucesso com `password` em iterações atuais não marca (comportamento de hoje, RF-07). A marca é aplicada antes das verificações de `maxAge`/`idleTimeout` (`src/utils/session.ts:350-365`), que continuam inalteradas e valem para qualquer senha.

## 3. Arquivos a alterar

| Arquivo | Local | Mudança |
| --- | --- | --- |
| `src/utils/session.ts:39-99` | `SessionConfig` | Adiciona `extraUnsealPasswords?: string[]` após `password` (`:48`), com JSDoc. |
| `src/utils/session.ts:312-348` | `unsealSession` | Substitui o `try/catch` único (`:322-348`) pelo laço de D-02 a D-06. As verificações de expiração (`:349-366`) ficam como estão. |
| `src/utils/session.ts:300` | `sealSession` | **Sem mudança** (já usa `config.password`). Citado para registrar que RF-02 é satisfeito por construção. |
| `src/utils/session.ts:194-216` | `getSession` | **Sem mudança**: consome `kLegacySeal` e reseala. |
| `test/session.test.ts` | dentro de `describeMatrix("session", ...)`, após `:186` | Novos testes (seção 5). Imports já existem (`seal`, `unseal`, `sealDefaults`, `:12`). |

Não tocam: `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts`, `src/index.ts:203-209`, `docs/`, `package.json`.

Testes existentes: nenhum deve precisar de ajuste. Os que contam chamadas criptográficas (`test/session.test.ts:414` com `encrypt` e `:723` com `deriveBits`) usam configs sem `extraUnsealPasswords`, cujo número de tentativas permanece igual. Se algum falhar na execução, ajustar apenas o necessário, sem enfraquecer a asserção.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (acréscimo)
export interface SessionConfig {
  password: string; // inalterado: única senha que sela
  /**
   * Previous passwords that can only open sessions, never seal them. Tried in
   * order after `password`; the first that verifies wins. A session opened with
   * one is resealed with `password` on the same request (cookie sessions only).
   * Keep this list short: each entry costs one more PBKDF2 derivation per
   * invalid cookie. Remove an entry once its sessions have been migrated.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// assinaturas públicas inalteradas
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Pseudocódigo do núcleo (helper interno, não exportado, no fim do arquivo):

```ts
// retorna o objeto aberto; marca kLegacySeal se houve fallback legado ou senha extra
async function unsealWithPasswords(config, sealed, sealOptions): Promise<Partial<Session>> {
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let error: unknown;
  // fase 1: opções atuais
  for (const [i, password] of passwords.entries()) {
    try {
      const unsealed = await unseal(sealed, password, sealOptions);
      if (unsealed && i > 0) unsealed[kLegacySeal] = true;
      return unsealed;
    } catch (e) {
      if (!isBadHmac(e)) throw e;
      error = e;
    }
  }
  // fase 2: iterações legadas (mesmas condições de hoje)
  if (config.legacySealFallback === false || sealOptions.integrity.iterations === 1) throw error;
  for (const password of passwords) {
    try {
      const unsealed = await unseal(sealed, password, legacyOptions);
      if (unsealed) unsealed[kLegacySeal] = true;
      return unsealed;
    } catch (e) {
      if (!isBadHmac(e)) throw e;
      error = e;
    }
  }
  throw error;
}
```

Invariantes: (1) `password` sempre é a primeira tentativa; (2) `unsealed` nulo (`iron-crypto.ts:149`) não recebe marca, igual ao `if (unsealed)` atual (`session.ts:345`); (3) com `extraUnsealPasswords` ausente ou `[]` a sequência de chamadas a `unseal` e os erros lançados são idênticos aos de hoje; (4) o erro lançado ao esgotar tudo é um `"Bad hmac value"`, tratado em `getSession` como sessão inválida.

## 5. Estratégia de testes

Todos em `test/session.test.ts` com o `describeMatrix` existente (web e node), usando o `t.fetch` e cookies `h3-test=...` como no teste de legado (`:134-159`). Constantes: `OLD = "old-password-old-password-old-password-1"` e `NEW = sessionConfig.password` (ambas ≥ 32 caracteres). Config via spread: `{ ...sessionConfig, password: NEW, extraUnsealPasswords: [OLD] }`, em rota própria (como `/strict`, `:172`). O reselo é lido de `Set-Cookie` e verificado com `unseal` direto.

| Teste | Requisito | Verifica |
| --- | --- | --- |
| tipo: `extraUnsealPasswords: ["x"]` compila; `// @ts-expect-error` em `password: ["x"]` | RF-01 | `pnpm typecheck` (o `tsconfig.json` inclui `test`) |
| sela só com `password` | RF-02 | resultado do `Set-Cookie` abre com `NEW`; `unseal` com `OLD` falha |
| abre sessão selada com `OLD` | RF-03 | `id` e `data` originais retornados |
| ordem: com `[A, B]`, selo de `B` abre | RF-03 | segunda extra funciona |
| nenhuma senha serve | RF-04 | cookie selado com `"desconhecida"…`: novo `id`, `data` `{}`, status 200, sem `Set-Cookie` de reselo do id antigo |
| erro não-HMAC não é mascarado | RF-04 | sessão expirada (`maxAge` + timers `Date` falsos, como `:190`) selada com `OLD` → descartada, nova sessão, mesmo com `OLD` configurada |
| reselagem | RF-05 | `Set-Cookie` único, abre só com `NEW`, mesmo `id`; segunda requisição com o novo cookie não reseala |
| header de sessão com `OLD` | RF-05 | sessão abre, sem `Set-Cookie` de reselo |
| legado + senha extra | RF-06 | selo com `OLD` e iterações 1 abre e é reselado com `NEW` em iterações atuais; com `legacySealFallback: false` é descartada |
| sem extras (`undefined` e `[]`) | RF-07 | contagem de `deriveBits` para cookie inválido igual à de uma config sem o campo |

RF-07 é validado também pela suíte existente intacta. Execução: `pnpm vitest run test/session.test.ts`, depois `pnpm lint` e `pnpm typecheck`; por fim `pnpm vitest run` para regressões. Seguir o fluxo de bug/feature do AGENTS.md: escrever os testes antes e confirmar que falham sem a implementação.

## 6. Riscos

- **R-01 — Custo de CPU.** Cada senha extra adiciona uma derivação PBKDF2 (2 por tentativa: encryption + integrity) por cookie inválido, e o fallback legado multiplica por `1 + extras`. Mitigação: `password` primeiro, fase legada por último (D-04), JSDoc pedindo lista curta.
- **R-02 — Mascarar erros.** Mitigado por D-03; coberto por teste de expiração.
- **R-03 — Sessões de header não são reseladas** (`src/utils/session.ts:214`): continuam dependendo da senha antiga até o cliente renovar. Documentar no JSDoc; sem mudança de código.
- **R-04 — Acoplamento semântico de `kLegacySeal`.** O nome sugere só selo legado. Mitigação: comentário no ponto de uso; se um terceiro motivo de reselo surgir, renomear o símbolo interno.
- **R-05 — Senha extra inválida (curta/vazia) interrompe o laço** e descarta a sessão, inclusive as que a senha seguinte abriria. Aceito como erro de configuração visível (D-03); alternativa de pular silenciosamente foi descartada por esconder o erro. Documentar a exigência de 32+ caracteres.
- **R-06 — Segredos antigos em configuração:** a remoção após a migração é responsabilidade da aplicação.
- **R-07 — Condição de corrida do `getSession` concorrente:** inalterada, pois a promessa `kGetSession` (`:219`) já serializa o unseal por sessão; o laço roda dentro dela.
- **R-08 — Linhas citadas** refletem `src/utils/session.ts` no commit `e8781ed`; reconferir após qualquer edição prévia.
