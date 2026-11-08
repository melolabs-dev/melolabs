# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Baseada em `sdd/pedido.md` e `sdd/prd.md`. Todas as citações `arquivo:linha` foram conferidas no código atual (commit `a528d64`).

## 1. Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `sealSession` continua selando só com `password`. `unsealSession` tenta `password` e, se o HMAC não bater, cada senha extra em ordem. Quando uma sessão abre com senha extra, `getSession` a resela com `password` pelo mesmo mecanismo que já resela selos legados. Só `src/utils/session.ts` muda no código de produção, além dos testes.

## 2. Estado atual (conferido)

- `SessionConfig` está em `src/utils/session.ts:39-99`. `password: string` fica em `:48` e `legacySealFallback` em `:95`.
- `sealSession` sela com `config.password` em `src/utils/session.ts:300`.
- `unsealSession` está em `src/utils/session.ts:312-367`:
  - A tentativa principal é `unseal(sealed, config.password, sealOptions)` em `:324`.
  - O `catch` em `:325-348` decide o fallback legado. Ele relança o erro se `legacySealFallback === false`, se `iterations === 1`, se o erro não for `Error` ou se `message !== "Bad hmac value"` (`:332-339`).
  - A segunda tentativa, com 1 iteração, fica em `:340-344`. Em caso de sucesso, ela marca `unsealed[kLegacySeal] = true` (`:345-347`).
  - A checagem de `maxAge` está em `:350-355` e a de `idleTimeout` em `:359-364`. Ambas lançam `"Session expired!"`.
- `getSession` chama `unsealSession(...).catch(() => {})` em `src/utils/session.ts:196`.
  - Lê e remove o marcador em `:199-202`.
  - Reseala com `updateSession` quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`:214-216`).
  - A sessão lida pelo header (`:178-187`) tem `sessionFromCookie = false` (`:189`), então nunca é reselada.
- `kLegacySeal` é `Symbol.for("h3.internal.session.legacy-seal")` em `src/utils/internal/session.ts:7-9`. Não é exportado por `src/index.ts`.
- `unseal` em `src/utils/internal/iron-crypto.ts:87-137`:
  - Falha de senha vira `Error("Bad hmac value")` em `:135-137`.
  - A expiração do selo (`"Expired seal"`, `:115-117`) e o formato (`:99-108`) são validados antes do HMAC, então não dependem da senha.
  - Senha vazia lança `"Empty password"` (`:94-96`).
  - Senha curta lança `"Password string too short..."` em `generateKey` (`:191-195`).
- `src/index.ts:203` reexporta o tipo `SessionConfig`, então o campo novo fica público sem tocar em `index.ts`.
- Testes: `test/session.test.ts` usa um único `describeMatrix("session", ...)` (`:15`) com `sessionConfig` (`:21-25`) e os testes legados em `:134-186`.
- Docs: `docs/2.utils/4.security.md:60-62` é gerado por automd a partir do JSDoc das funções. Como o JSDoc das funções não muda, não há alteração de docs.

## 3. Decisões de arquitetura

### D-01 — Campo `extraUnsealPasswords?: string[]` em `SessionConfig`, sem mudar `password`

- **Alternativas:** (a) `password: string | string[]`, a segunda alternativa da issue; (b) campo novo opcional; (c) callback `resolvePassword`.
- **Escolha:** (b).
- **Justificativa:** (a) está fora de escopo no PRD e quebraria o tipo de `password`, usado também em `session.test.ts` como `sessionConfig.password` (`:137`, `:157`). (c) cria superfície pública maior que a pedida. (b) é aditivo, opcional e não altera nenhum caller existente. É o único nome público novo.

### D-02 — Selagem inalterada

- **Alternativas:** (a) selar com `extraUnsealPasswords[0]` quando existir; (b) manter `config.password`.
- **Escolha:** (b).
- **Justificativa:** RF-02 exige selar só com `password`. `src/utils/session.ts:300` não muda.

### D-03 — Laço de candidatas dentro de `unsealSession`, com helper interno não exportado

- **Alternativas:** (a) inserir o laço no `try/catch` existente; (b) extrair a tentativa por senha (modo atual e depois legado) para um helper interno no fim de `session.ts`, e `unsealSession` itera sobre as candidatas; (c) helper em `utils/internal/`.
- **Escolha:** (b).
- **Justificativa:**
  - (a) aninharia dois níveis de `try/catch` numa função que já mistura selo e expiração.
  - AGENTS.md pede helpers internos no fim do arquivo ou em `internal/`. (c) obrigaria `internal/session.ts`, hoje só com constantes e tipos, a importar `iron-crypto`. Isso aumentaria o acoplamento sem ganho.
  - O arquivo já passa de 200 LoC (465). Não vale criar um módulo novo para um helper de cerca de 30 linhas.
  - O helper não é exportado, então não cria nome público.

### D-04 — Ordem de tentativa: por senha, modo atual e depois legado

- **Alternativas:** (a) todas as senhas no modo atual e depois todas no legado; (b) para cada senha, modo atual e depois legado.
- **Escolha:** (b).
- **Justificativa:**
  - Preserva o comportamento atual para `password` (atual e depois legado, `:324` e `:340`).
  - A ordem do array é a ordem de tentativa (premissa do PRD).
  - A tentativa legada custa 1 iteração, contra 8192 no modo atual, então o custo extra de (b) é desprezível. O pior caso fica em `(1+N)` derivações de 8192 iterações (ver a estimativa do PRD na seção de riscos).
  - (a) reordenaria a precedência entre senha e modo e dificultaria raciocinar sobre RF-06.

### D-05 — Só `Bad hmac value` avança para a próxima senha

- **Alternativas:** (a) qualquer erro tenta a próxima senha; (b) só `error instanceof Error && error.message === "Bad hmac value"`, o mesmo critério já usado em `:335-336`.
- **Escolha:** (b).
- **Justificativa:** RF-04 e o risco "distinção de erros". Expiração e payload malformado não dependem da senha e não devem custar PBKDF2 extra. O erro final propagado é o da primeira tentativa (`password`), então sem extras o erro é idêntico ao atual (RF-07).
- **Consequência:** uma senha extra inválida, como vazia ou com menos de 32 caracteres, lança `"Empty password"` ou `"Password string too short"`. Esse erro propaga se for alcançada, ou seja, só depois de `password` e das extras anteriores falharem por HMAC. Em `getSession` ele é engolido pelo `.catch(() => {})` (`:196`) e a sessão é descartada. Isso é aceitável e evita mascarar configuração errada em chamadas diretas a `unsealSession`.

### D-06 — Resselagem reaproveitando `kLegacySeal`

- **Alternativas:** (a) criar um símbolo interno novo, por exemplo `kResealSession`; (b) reaproveitar `kLegacySeal`, setando-o também quando a sessão abriu com senha extra, e ajustar o comentário em `:210-213`; (c) comparar no `getSession` com `config.password` por uma nova tentativa de unseal.
- **Escolha:** (b).
- **Justificativa:**
  - RF-05 manda reaproveitar o padrão sem criar nome público. O símbolo é interno, e o efeito em `getSession` (apagar o marcador e resselar quando `sessionFromCookie`) é exatamente o desejado, sem tocar na lógica de `:199-216`.
  - (a) é limpo semanticamente, mas é um símbolo novo (o PRD pede para não criar um) e mexe em `internal/session.ts`.
  - (c) dobraria o custo de PBKDF2.
  - O nome fica ligeiramente impreciso ("legacy"). Mitigação: comentário em `getSession` e no helper dizendo que o marcador significa "selo que precisa ser reselado com `password` e as opções atuais".

### D-07 — `legacySealFallback` valendo para todas as candidatas

- **Alternativas:** (a) fallback legado só para `password`; (b) para todas.
- **Escolha:** (b), como pede RF-06.
- **Justificativa:** o critério de `:332-339` (flag `false`, `iterations === 1`, tipo/mensagem do erro) é avaliado dentro do helper por candidata. Com `legacySealFallback: false`, nenhuma candidata é testada no modo legado.

### D-08 — Sem mudança de cookie, header, expiração ou iron-crypto

- **Justificativa:** `maxAge` e `idleTimeout` (`:350-364`) rodam sobre o resultado, independentemente de qual senha abriu. O header (`sessionHeader`) compartilha `unsealSession`, então aceita as senhas extras (RF-07), mas não é reselado (`:189`, limitação documentada). `iron-crypto.ts` fica intacto (fora de escopo).

## 4. Arquivos a alterar

| Arquivo                | Linhas atuais                                      | Mudança                                                                                                                                                  |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/session.ts` | `:39-99` (`SessionConfig`), logo após `:48`        | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (só abre sessões, nunca sela, lista curta, remover após `maxAge`, cada senha com ≥ 32 caracteres). |
| `src/utils/session.ts` | `:312-367` (`unsealSession`)                       | Substituir o `try/catch` de `:322-348` pela iteração sobre candidatas, chamando o helper. Manter `:349-366` (expiração) intactos.                        |
| `src/utils/session.ts` | fim do arquivo, após `:464`                        | Novo helper interno não exportado `unsealWithPassword` (assinatura abaixo).                                                                              |
| `src/utils/session.ts` | `:199-202`, `:210-214`                             | Só comentário: o marcador também cobre "aberta com senha extra". Sem mudança de lógica.                                                                  |
| `test/session.test.ts` | após `:186`, dentro de `describeMatrix("session")` | Novos testes (seção 6).                                                                                                                                  |

Sem alteração: `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts`, `src/index.ts:203`, `docs/` e `CHANGELOG.md` (gerados).

## 5. Contratos e assinaturas

```ts
// SessionConfig (src/utils/session.ts)
export interface SessionConfig {
  password: string; // inalterado: única senha que sela
  /**
   * Previous passwords that may only open (never seal) sessions, tried in order
   * after `password`. A session opened with one is resealed with `password`.
   * Keep the list short ... remove entries once sessions sealed with them expired.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// Assinatura pública inalterada
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

// Interno, não exportado, no fim de session.ts
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

**Comportamento de `unsealWithPassword`:**

- Tenta `unseal` no modo atual.
- Se lançar `Bad hmac value` e valer a condição do fallback legado (D-07), tenta com 1 iteração e marca `kLegacySeal`.
- Qualquer outro erro, ou HMAC inválido sem fallback possível, é relançado.

**Comportamento de `unsealSession` (pseudo-código):**

```ts
const candidates = [config.password, ...(config.extraUnsealPasswords || [])];
let unsealed, firstError;
for (const [i, password] of candidates.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, config, sealOptions);
    if (i > 0 && unsealed) unsealed[kLegacySeal] = true; // reseal com `password`
    break;
  } catch (error) {
    firstError ??= error;
    if (!isBadHmac(error)) throw i === 0 ? error : firstError; // D-05
  }
}
if (!unsealed) throw firstError;
// expiração (maxAge/idleTimeout) como hoje
```

**Invariantes:**

- Sem `extraUnsealPasswords`, ou com `[]`, há um único candidato e as mesmas chamadas, erros e saídas de hoje.
- `sealSession` e `updateSession` não leem `extraUnsealPasswords`.
- Nenhum export novo em `src/index.ts`. `package.test.ts:149` lista exports e continua passando.

## 6. Estratégia de testes

Todos em `test/session.test.ts`, com `describeMatrix` (web e node). Os testes usam `seal` com `sealDefaults`, como os legados em `:134-186`, e um segundo `password` de 32 ou mais caracteres. Seguem o fluxo de bug fix do AGENTS.md: escrever primeiro, confirmar que falham sem a implementação e depois implementar.

| Teste                                                                                                                                                                                                                                      | RF    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Config com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`: o cookie criado abre com `nova` (`unseal`) e **não** abre só com `antiga`.                                                                                             | RF-02 |
| Cookie selado com `antiga` preserva `id` e `data`.                                                                                                                                                                                         | RF-03 |
| Cookie selado com `outra` gera `id` diferente e `data` vazio.                                                                                                                                                                              | RF-04 |
| Selo expirado (`ttl` vencido) com extras configuradas: sessão nova, e `vi.spyOn(crypto.subtle, "deriveBits")` com 0 chamadas, provando que não há tentativas extras para erro que não é de senha. O padrão do spy já existe em `:722-734`. | RF-04 |
| Cookie com `antiga`: `Set-Cookie` único que abre com `nova` e preserva `id` e `data`. Remover `antiga` da config e repetir com o novo cookie: sessão válida.                                                                               | RF-05 |
| Ordem das extras: duas extras, a sessão é selada com a segunda e abre.                                                                                                                                                                     | RF-03 |
| Selo legado (1 iteração) com `antiga`, `legacySealFallback` omitido: aceito e reselado com `nova`. Com `legacySealFallback: false`: rejeitado e sessão nova.                                                                               | RF-06 |
| Sessão via header `x-h3-test-session` selada com `antiga`: aceita; sem `Set-Cookie` de resselagem.                                                                                                                                         | RF-07 |
| `extraUnsealPasswords: []` e campo omitido: comportamento idêntico. Já coberto pelos testes existentes, mais um caso explícito com `[]`.                                                                                                   | RF-07 |
| Verificação de tipo: config sem o campo e com o campo compilam (os testes novos o usam).                                                                                                                                                   | RF-01 |

**Testes existentes:** nenhum deve precisar de ajuste, porque o comportamento sem o campo não muda. O teste do spy de `deriveBits` (`:722-734`) conta 2 derivações por selagem e continua válido, já que `sealSession` não muda.

**Verificação final:**

- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/package.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- Suíte completa antes de fechar.
- Para RF-08, reverter a implementação e confirmar que os testes de rotação falham.

## 7. Riscos

| Risco                                                                                                                         | Mitigação                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Amplificação de CPU:** cookie forjado custa até `(1+N)` derivações PBKDF2 de 8192 iterações, mais as legadas de 1 iteração. | Ordem fixa (D-04), avanço só em `Bad hmac value` (D-05), JSDoc pedindo lista curta. Erros pré-HMAC, como expiração do selo e formato, não geram tentativas extras.                                                                                                                                                           |
| **Mascarar erros que não são de senha.**                                                                                      | D-05 reaproveita a checagem existente e propaga o erro da primeira tentativa.                                                                                                                                                                                                                                                |
| **Senha antiga comprometida** continua abrindo sessões enquanto estiver listada.                                              | A resselagem (D-06) reduz a janela. O JSDoc orienta remover a senha depois de `maxAge`.                                                                                                                                                                                                                                      |
| **Sessão por header não é reselada** (`:189`).                                                                                | Limitação já existente, documentada no PRD. Continua dependendo da senha extra até expirar.                                                                                                                                                                                                                                  |
| **Nome `kLegacySeal` impreciso** para o caso de senha extra.                                                                  | Comentário em `getSession` e no helper. Renomear está fora de escopo.                                                                                                                                                                                                                                                        |
| **Senha extra inválida** (vazia ou curta) derruba a sessão em `getSession`, porque o erro é engolido.                         | Só ocorre depois das tentativas anteriores falharem. Está documentado em D-05 e coberto por teste de configuração inválida, opcional.                                                                                                                                                                                        |
| **Tamanho de `session.ts`** (já 465 linhas, acima do guia de 200).                                                            | O helper é pequeno e interno. Dividir o arquivo é refatoração fora de escopo.                                                                                                                                                                                                                                                |
| **Estimativa de custo do PRD** (`(1+N)×2` derivações).                                                                        | Em `unseal`, o HMAC é verificado antes de derivar a chave de encriptação (`iron-crypto.ts:133-137`). Uma tentativa que falha por senha faz só 1 derivação de integridade, então o pior caso é `(1+N)` derivações de 8192 iterações, mais `(1+N)` de 1 iteração do fallback legado. A estimativa do PRD é um limite superior. |
