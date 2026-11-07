# Especificação técnica — várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-08). Esta especificação não altera código; as citações `arquivo:linha` foram conferidas no estado atual do repositório (branch `master`, commit `5ab0897`).

## Visão geral

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Na leitura (`unsealSession`), H3 tenta `password` e depois cada senha extra, com as mesmas opções de seal de hoje. A primeira que abre o selo é usada. Se a sessão foi aberta por uma senha extra, `getSession` a regrava com `password`, pelo mesmo caminho que já regrava selos legados. A selagem (`sealSession`) não muda e continua usando só `password`.

Tudo acontece dentro de `src/utils/session.ts`, com um símbolo interno novo em `src/utils/internal/session.ts`. Nenhuma função, export ou assinatura pública é criada ou alterada.

---

## Decisões de arquitetura

### D-01 — Forma do campo: `extraUnsealPasswords?: string[]` em `SessionConfig`

- **Escolha:** campo opcional novo em `SessionConfig`, ao lado de `password`, sem alterar o tipo de `password` (`src/utils/session.ts:48`).
- **Alternativa 1:** aceitar `password: string | string[]`, a segunda alternativa da issue #1050. Rejeitada: o PRD a exclui do escopo e ela muda o tipo de um campo existente, o que quebra quem já lê `config.password` como string.
- **Alternativa 2:** um objeto `keys` com `{ current, previous }`. Rejeitada: introduz um novo formato de configuração, e o pedido exige que `password` continue string.
- **Justificativa:** é a forma que o pedido e o PRD descrevem. É aditiva, então a configuração existente continua válida sem mudanças.

### D-02 — Estratégia de tentativas: duas fases (opções atuais, depois legado)

- **Escolha:** `unsealSession` roda primeiro todas as senhas com as opções atuais. Só se nenhuma abrir, e se `legacySealFallback` estiver ativo, roda todas as senhas de novo com `iterations: 1`.
- **Alternativa:** para cada senha, tentar as opções atuais e depois as legadas, antes de passar para a senha seguinte. Rejeitada: viola RF-08 ("só é tentado depois que nenhuma senha abre a sessão com as opções atuais"). Também faria uma sessão atual sob a senha extra pagar tentativas legadas inúteis.
- **Justificativa:** segue RF-08 literalmente e mantém o caminho comum (sessão atual, primeira senha) idêntico ao de hoje.

### D-03 — Erros: capturar por senha, lançar o primeiro erro

- **Escolha:** cada tentativa com senha captura seu erro e segue para a próxima. Se nenhuma abrir, lança-se o erro da **primeira** senha (a `password`). Assim, sem extras o erro lançado é exatamente o de hoje (RF-04).
- **Alternativa 1:** interromper na primeira falha, como hoje. Rejeitada: uma senha extra curta (`< 32`) lança `Password string too short` em `generateKey` (`src/utils/internal/iron-crypto.ts:192-196`) e bloquearia as demais, o que RF-06 proíbe.
- **Alternativa 2:** lançar um `AggregateError` com todos os erros. Rejeitada: muda o erro observável e revela quantas senhas foram tentadas, o que o PRD (RF-05, riscos "Erros mascarados") pede para evitar.
- **Justificativa:** preserva o comportamento de hoje quando não há extras e não revela informação extra.
- **Consequência:** a condição do fallback legado continua sendo "o primeiro erro é `Bad hmac value`", como no código atual (`src/utils/session.ts:332-337`). Um caso não coberto é `password` curta com extra legada; ver R-04.

### D-04 — Sinalizar a senha extra com um símbolo interno, não com o retorno de `unsealSession`

- **Escolha:** novo símbolo `kExtraPasswordSeal` em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). `unsealSession` marca o objeto quando a senha que abriu não é a primeira; `getSession` lê e apaga a marca antes do `Object.assign` (como faz com `kLegacySeal` em `src/utils/session.ts:199-201`).
- **Alternativa:** `unsealSession` retornar `{ session, passwordIndex }`. Rejeitada: `unsealSession` é exportada (`src/index.ts:209`) e aparece no snapshot de exports (`test/unit/package.test.ts:149`). Mudar o retorno quebraria a API pública.
- **Justificativa:** o padrão já existe e não altera nenhuma assinatura pública. A marca precisa ser apagada antes de `Object.assign` porque símbolos enumeráveis são copiados (`src/utils/session.ts:208`).

### D-05 — Regravação ao abrir com senha extra: mesmo caminho do selo legado, só para cookie

- **Escolha:** `getSession` regrava quando `legacySeal || extraPasswordSeal || shouldSlide(...)`, dentro da mesma condição que já exige `session.id && sessionFromCookie` (`src/utils/session.ts:214`).
- **Alternativa 1:** não regravar. Rejeitada: RF-07 pede a regravação para que a rotação migre as sessões conforme são usadas.
- **Alternativa 2:** regravar também sessões vindas pelo header `x-{name}-session`. Rejeitada: o código já não regrava esse caso (`src/utils/session.ts:214`, `sessionFromCookie`), e o PRD (Riscos) pede documentar essa limitação, não mudá-la.
- **Justificativa:** o selo legado já usa essa rota. A regravação chama `updateSession`, que sela com `config.password` (`src/utils/session.ts:267` e `:300-304`). Por isso RF-03 vale sem mudança em `sealSession`.

### D-06 — Selagem inalterada

- **Escolha:** `sealSession` (`src/utils/session.ts:282-307`) continua usando só `config.password`. Nenhuma linha dela muda.
- **Justificativa:** RF-03. Sessões novas e regravadas ficam acessíveis só com `password`.

### D-07 — Sem deduplicação nem validação de configuração

- **Escolha:** a lista de tentativas é `[config.password, ...(config.extraUnsealPasswords ?? [])]`, sem remover duplicatas e sem validar a lista na configuração. Senhas extras vazias ou curtas falham dentro de `unseal` e são ignoradas.
- **Alternativa:** validar a lista ao criar a sessão e lançar erro na configuração inválida. Rejeitada: RF-06 exige que uma senha extra inválida não impeça as demais, e o PRD diz para não criar novas APIs de validação.
- **Justificativa:** o código fica mínimo. Uma duplicata só custa uma derivação extra; a documentação deve dizer que a lista é para senhas antigas, sem repetições.

---

## Arquivos a alterar

### 1. `src/utils/session.ts`

| Local | Mudança |
| --- | --- |
| `src/utils/session.ts:48` (após `password: string;`) | Adicionar `extraUnsealPasswords?: string[];` com JSDoc (ver contrato). |
| `src/utils/session.ts:196-221` (`getSession`, promise de `unsealSession`) | Ler `kExtraPasswordSeal` junto de `kLegacySeal` (`:199`), apagá-lo (`:200-202`), e incluir `extraPasswordSeal` na condição de regravação (`:214`). |
| `src/utils/session.ts:312-348` (`unsealSession`) | Substituir as duas chamadas diretas a `unseal` (`:324` e `:340-344`) por `unsealWithPasswords` (D-02, D-03). Marcar `kExtraPasswordSeal` quando o índice for maior que zero. |
| `src/utils/session.ts:349-365` (checagens de `maxAge` e `idleTimeout`) | Sem mudança. Rodam uma vez, depois da tentativa bem-sucedida. |
| Novo helper no fim do arquivo (após `sessionExpires`, `:455-464`) | `unsealWithPasswords`, conforme a seção de contratos. |
| `src/utils/session.ts:282-307` (`sealSession`) | Sem mudança (D-06). |

Limite de tamanho: o arquivo tem 465 linhas e já passa da meta de 200 do `AGENTS.md`. O helper pode ficar no próprio arquivo, ao final, como manda a convenção de helpers internos. Mover `unsealWithPasswords` para `src/utils/internal/` também é aceitável; ver R-05.

### 2. `src/utils/internal/session.ts`

- Adicionar `kExtraPasswordSeal` após `kLegacySeal` (`:7-9`), com o mesmo padrão `Symbol.for`.

### 3. `test/session.test.ts`

- Acrescentar casos novos (ver estratégia de testes). Os casos existentes não usam `extraUnsealPasswords` e não mudam (`test/session.test.ts:134-159` e `:161-186` continuam válidos).

### 4. `docs/4.examples/handle-session.md`

- `:37` (aviso sobre `password`): acrescentar que `extraUnsealPasswords` só abre sessões e que, enquanto estiver na lista, a senha continua válida para abrir cookies. Remover a senha da lista exige novo deploy (PRD, Riscos).
- `:143` ("Every option is optional except `password`"): incluir `extraUnsealPasswords` na descrição das opções e a recomendação de listas curtas (custo de PBKDF2 por tentativa).
- `:180` (nota sobre o header): acrescentar que sessões lidas pelo header com senha extra não são regravadas e continuam com a senha antiga até expirar.
- `docs/2.utils/4.security.md:60` (`unsealSession`): sem mudança de assinatura; a descrição pode mencionar que tenta as senhas extras. Esta seção é gerada por automd (`pnpm fmt`), então editar o texto pede cuidado com o bloco `<!-- automd -->`.

Não alterar `CHANGELOG.md`; ele é gerado na publicação.

### 5. Não alterar

- `src/index.ts:203-211`: nenhum export novo.
- `test/unit/package.test.ts:149`: o snapshot de exports continua igual.
- `src/utils/internal/iron-crypto.ts`: a regra de senha curta (`:192-196`) e o `Bad hmac value` (`:135-137`) continuam como estão.

---

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (novo campo, após `password`)
export interface SessionConfig {
  /** ...documentação existente... */
  password: string;
  /**
   * Previous passwords, tried in order after `password` when unsealing. They
   * only open existing sessions: sessions are always sealed with `password`, and
   * a session opened with one of them is resealed with `password` on read.
   * Same entropy rules as `password`. Keep the list short: each entry costs a
   * PBKDF2 derivation per request that presents an old cookie.
   */
  extraUnsealPasswords?: string[];
  // ...restante inalterado...
}
```

```ts
// src/utils/internal/session.ts
export const kExtraPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-password-seal",
);
```

```ts
// src/utils/session.ts — helper interno (não exportado)
/**
 * Try `unseal` with each password in order and return the first that opens the
 * seal, with its index in `passwords`. When none does, throw the error from the
 * first password, so that without extra passwords the error is the same as before.
 */
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<{ unsealed: Partial<Session>; index: number }> {
  let firstError: unknown;
  for (const [index, password] of passwords.entries()) {
    try {
      const unsealed = (await unseal(sealed, password, options)) as Partial<Session>;
      return { unsealed, index };
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}
```

Assinatura de `unsealSession` (inalterada): `unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>`.

Esboço do corpo de `unsealSession`:

```ts
const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
let attempt: { unsealed: Partial<Session>; index: number };
try {
  attempt = await unsealWithPasswords(sealed, passwords, sealOptions);
} catch (error) {
  // ...mesma condição de hoje (src/utils/session.ts:332-337), inclusive sobre o primeiro erro...
  attempt = await unsealWithPasswords(sealed, passwords, {
    ...sealOptions,
    encryption: { ...sealOptions.encryption, iterations: 1 },
    integrity: { ...sealOptions.integrity, iterations: 1 },
  });
  if (attempt.unsealed) (attempt.unsealed as any)[kLegacySeal] = true;
}
const { unsealed, index } = attempt;
if (index > 0 && unsealed) (unsealed as any)[kExtraPasswordSeal] = true;
// ...checagens de maxAge e idleTimeout inalteradas...
return unsealed;
```

Observações do esboço:

- A condição do `catch` continua usando o erro da primeira senha, então o fallback legado só roda quando a primeira senha falha com `Bad hmac value`.
- `unsealed` pode ser `null` (`src/utils/internal/iron-crypto.ts:149`). Por isso os guardas `if (... && unsealed)`, como os que já existem em `:345` e `:205`.
- Se as checagens de expiração lançarem, o erro sai como hoje (`src/utils/session.ts:353`, `:363`).

Em `getSession` (`src/utils/session.ts:198-216`):

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const extraPasswordSeal = unsealed && (unsealed as any)[kExtraPasswordSeal];
if (legacySeal) delete (unsealed as any)[kLegacySeal];
if (extraPasswordSeal) delete (unsealed as any)[kExtraPasswordSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || extraPasswordSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

---

## Estratégia de testes

Seguindo `AGENTS.md`, os testes novos usam `describeMatrix` em `test/session.test.ts` (roda em web e node) e o fluxo de bug fix (teste de regressão antes da implementação).

Casos (mapeados aos RFs):

1. **RF-02 / RF-07 — abre com extra e regrava:** sessão selada com `B`; config `password = A`, `extraUnsealPasswords = [B]`. Esperado: dados retornados, um `Set-Cookie` novo. Esse cookie abre com `A` e não abre com `B` (`unseal` direto, como em `test/session.test.ts:155-158`).
2. **RF-02 — ordem:** duas extras `[B, C]` com sessão selada em `C`; sessão selada em `B` também abre. Confirma a ordem sem depender de contagem de PBKDF2.
3. **RF-03 — selagem:** `useSession` + `update` com config `A + [B]` gera cookie que não abre com `B`.
4. **RF-04 — compatibilidade:** sem extras e com `extraUnsealPasswords: []`, sessão selada com outra senha vira sessão nova (`id` diferente), igual ao caso atual. Os testes existentes de `legacySealFallback` (`test/session.test.ts:134-186`) rodam sem alteração.
5. **RF-05 — nenhuma senha abre:** selada com `C`; config `A + [B]`. Esperado: sessão nova, `data` vazio, sem vazar dados, sem mensagem que mencione as senhas.
6. **RF-06 — extra curta:** `extraUnsealPasswords = ["curta", B]`, sessão selada com `B`. Esperado: abre com `B`.
7. **RF-08 — legado com extra:** sessão legada (1 iteração) selada com `B`; config `A + [B]`. Esperado: abre, regrava com `A`; a próxima leitura abre só com `A` e não gera `Set-Cookie`.
8. **Ordem do fallback:** sessão legada selada com `A` e sessão atual selada com `B` nunca se confundem: a sessão atual com extra abre sem passar pelo caminho legado (pode ser checado com `vi.spyOn` em `unseal`, se a equipe quiser o teste de custo).
9. **Header:** sessão selada com `B` enviada pelo header `x-h3-test-session` abre, mas não gera `Set-Cookie` (documenta D-05).
10. **Expiração:** sessão com `B` expirada por `maxAge` ainda é descartada (checagens inalteradas). Usar `vi.useFakeTimers` como em `test/session.test.ts:188-230`.
11. **API pública:** `unsealSession(event, config, sealed)` com extras abre sessões com a senha extra, sem nenhum `kExtraPasswordSeal` visível no retorno para quem chama (o símbolo não aparece em `Object.keys`).
12. **Tipo (RF-01):** `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` em `test/unit/types.test-d.ts`, que já existe.

Comandos de verificação:

```bash
pnpm vitest run test/session.test.ts      # casos novos e existentes
pnpm vitest run test/unit/types.test-d.ts # tipo
pnpm vitest run test/unit/package.test.ts # snapshot de exports (deve continuar igual)
pnpm lint                                  # oxlint + oxfmt --check + typecheck
pnpm test                                  # suíte completa com cobertura
```

Ajustes em testes existentes: a análise do código não identifica nenhum teste existente que dependa do que a mudança altera, porque nenhum deles usa `extraUnsealPasswords` e o caminho sem extras não muda. Se algum teste falhar, o ajuste só pode ser feito depois de confirmar que a falha vem da mudança e não de uma regressão.

---

## Riscos

- **R-01 — Custo de CPU.** Cada tentativa falha faz uma derivação PBKDF2 de integridade (8192 iterações), porque o HMAC é verificado antes da decifragem (`src/utils/internal/iron-crypto.ts:133-137`). Uma tentativa bem-sucedida faz duas. Com N extras, uma requisição com cookie antigo pode fazer até N+1 derivações nas opções atuais, e mais N+1 com `iterations: 1` se o fallback legado for necessário. Ou seja, o custo é N+1 por fase, e não N×2 como diz o PRD; o número exato precisa ser medido. Mitigação: documentação recomendando listas curtas (D-07) e, se necessário depois, um limite de tamanho.
- **R-02 — Senha vazada continua válida.** Enquanto uma senha estiver na lista, quem a tiver abre sessões. Remover exige nova configuração e deploy. Documentar (PRD, Premissas).
- **R-03 — Sessões por header não são regravadas.** Sessões enviadas por header com senha extra continuam com a senha antiga até expirar. Documentar em `docs/4.examples/handle-session.md:180` (D-05).
- **R-04 — Senha primária curta com extra legada.** Se `password` for curta, o primeiro erro é `Password string too short` e o fallback legado não roda, mesmo que uma extra abra sessões legadas. Isso é configuração inválida e o comportamento é igual ao de hoje, mas vale um teste ou nota.
- **R-05 — Tamanho de arquivo.** `src/utils/session.ts` já passa de 200 linhas (465). Adicionar cerca de 30 linhas aumenta o problema que a convenção quer evitar. Alternativa: mover `unsealWithPasswords` para `src/utils/internal/session.ts` (ou um arquivo novo em `src/utils/internal/`). Decisão pendente, sem impacto funcional; recomendado manter no arquivo principal para não criar um módulo só para um helper.
- **R-06 — Erros mascarados.** Uma senha extra mal digitada some sem aviso (RF-06). Isso é aceito pelo PRD; a alternativa de avisar exigiria API nova, que está fora de escopo.
- **R-07 — Regravação em concorrência.** Duas requisições simultâneas com o mesmo cookie antigo regravam duas vezes. É o mesmo comportamento que o selo legado já tem, e a última resposta vence (ver `docs/4.examples/handle-session.md:183`). Sem mudança.
- **R-08 — Símbolo interno vazando.** Se `kExtraPasswordSeal` não for apagado antes de `Object.assign` (`src/utils/session.ts:208`), ele entra no objeto de sessão em memória. Não é serializado (símbolos não entram em `JSON.stringify`), mas o teste 11 cobre o retorno de `unsealSession`.

---

## Pontos em aberto

Nenhum bloqueia a implementação. Já assumidos nesta especificação:

- Regravação ao abrir com extra (RF-07): assumida como desejada, conforme o PRD.
- Sem validação nem deduplicação de extras (D-07).
- Caminho do helper (R-05): no arquivo principal, a menos que a revisão peça outro lugar.
