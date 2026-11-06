# Especificação técnica — `extraUnsealPasswords` em sessões (h3js/h3#1050, variante b)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-08). Todas as citações `arquivo:linha` foram conferidas no código atual. Este documento não altera código.

## 1. Contexto do código atual

- `SessionConfig` está em `src/utils/session.ts:39-99`; `password: string` em `:48`, `legacySealFallback` em `:95`.
- `getSession` (`src/utils/session.ts:149-232`) lê o selo do cabeçalho (`:178-187`) ou do cookie (`:189-193`), chama `unsealSession` (`:196`) e engole qualquer erro (`.catch(() => {})`, `:196-197`). A re-selagem proativa está em `:214` (`session.id && sessionFromCookie && (legacySeal || shouldSlide(...))`), e chama `updateSession` (`:215`).
- `updateSession` (`:241-277`) sela só quando `config.cookie !== false` e há `event.res` (`:266`); o selo vem de `sealSession` (`:267`).
- `sealSession` (`:282-307`) chama `seal(session, config.password, {...})` em `:300-304`.
- `unsealSession` (`:312-367`) monta `sealOptions` (`:317-321`), faz `unseal` com `config.password` (`:324`) e, se der `"Bad hmac value"`, repete com 1 iteração (`:332-347`), marcando `kLegacySeal` (`:346`).
- `clearSession` (`:372-386`) não abre sessão: só remove do contexto e apaga o cookie.
- `kLegacySeal` está em `src/utils/internal/session.ts:7-9`.
- `iron-crypto.ts`: `unseal` falha com `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:135-137`), `"Empty password"` (`:94-96` e `:172-174`) e `"Password string too short (min N characters required)"` (`:191-196`). A validação de tamanho só acontece dentro de `generateKey`, isto é, só para a senha que de fato é usada. Padrões: `minPasswordlength: 32` em `:22` e `:28`. Pela mesma razão, uma senha extra nunca passa por validação ao selar: ela precisa ser validada explicitamente.
- Exports públicos: `src/index.ts:199-212` exporta `SessionConfig` etc. Os símbolos de `internal/session.ts` não são exportados.

## 2. Decisões de arquitetura

### D-01 — Campo `extraUnsealPasswords?: string[]` em `SessionConfig`
**Alternativas:** (a) `password: string | string[]`, primeiro elemento sela (proposta alternativa do issue); (b) novo campo `extraUnsealPasswords`; (c) callback `resolvePasswords(event)`.
**Escolha:** (b). É a variante pedida, não muda o tipo de `password` (proibido pelo contrato) e não introduz nenhum outro nome público. (a) quebra o tipo de `password`; (c) cria API nova além do campo.
Ausente e `[]` são equivalentes: o código trata ambos por `config.extraUnsealPasswords ?? []`, sem ramo distinto.

### D-02 — Lógica de abertura concentrada em `unsealSession`
**Alternativas:** (a) iterar as senhas em `getSession` e chamar `unsealSession` várias vezes com `config` clonado; (b) iterar dentro de `unsealSession`; (c) estender `unseal` de `iron-crypto.ts` para aceitar lista.
**Escolha:** (b). `unsealSession` é a função pública usada por `getSession`, `useSession` e `updateSession` (via `getSession`) e também chamada diretamente (RF-07), então a cobertura de todos os canais (cookie, chunks, cabeçalho) vem de um ponto só. (a) duplicaria maxAge/idleTimeout e o fallback legado; (c) mexeria num módulo copiado de terceiros (`iron-crypto.ts:1-9`) sem necessidade, e seu mapa `Password` por `id` não corresponde à semântica de ordem fixa e parada.
`clearSession` (`:372`) não abre sessão, então não muda; a cobertura de RF-07 para ela é apenas confirmar por teste que continua funcionando com a config nova.

### D-03 — Ordem de tentativa: por senha, depois legado dentro da mesma senha
**Alternativas:** (a) todas as senhas com iterações atuais e só depois todas com 1 iteração; (b) para cada senha, tenta iterações atuais e, se `"Bad hmac value"`, 1 iteração; depois passa à próxima.
**Escolha:** (b). Ordem efetiva: `password` atual, `password` legado, extra[0] atual, extra[0] legado, ... parando na primeira que abre. Motivo: RF-03 exige que, quando `password` abre a sessão, nenhuma extra seja tentada; em (a) uma sessão legada selada com `password` forçaria tentativas com as extras antes do legado de `password`. (b) também reaproveita sem mudança o bloco legado atual (`:332-347`), com as mesmas condições (`legacySealFallback === false`, iterações já iguais a 1, erro diferente de `"Bad hmac value"` desligam o legado). Custo aceito: sessão de senha desconhecida faz até `2 × (1 + N)` tentativas (hoje 2); as tentativas legadas só ocorrem com `legacySealFallback` ativo.

### D-04 — O que conta como "tentar a próxima senha"
**Alternativas:** (a) qualquer erro passa à próxima senha; (b) só `"Bad hmac value"` (após o legado, se aplicável) passa à próxima; os demais erros propagam.
**Escolha:** (b). Erros de formato, expiração do selo (`"Expired seal"`, checada em `iron-crypto.ts:110-118` antes de qualquer PBKDF2 e independente da senha) e senha extra curta/vazia (`generateKey`) propagam. Em (a) uma sessão expirada ou malformada gastaria PBKDF2 em todas as senhas e esconderia erros de config. Se todas falharem com hmac, relança o primeiro erro (o da `password`), mantendo a mensagem de hoje para quem não usa extras. `getSession` já descarta o erro (`:196-197`), o que dá RF-04 (sessão nova e vazia) sem mudança. Consequência assumida: uma extra inválida só é percebida no unseal se for alcançada; a validação forte é a de D-06.

### D-05 — Marcar origem por senha extra e reaproveitar o mecanismo de re-selagem
**Alternativas:** (a) reutilizar `kLegacySeal` para marcar também "aberta por extra"; (b) novo símbolo interno `kExtraSeal` em `src/utils/internal/session.ts`, ao lado de `kLegacySeal`; (c) `getSession` comparar senhas por conta própria.
**Escolha:** (b). (a) mistura duas causas e deixaria o nome enganoso; (c) duplicaria a iteração. `unsealSession` define `unsealed[kExtraSeal] = true` quando a senha que abriu é uma extra (incluindo o caso legado com senha extra, que fica com os dois marcadores). Em `getSession`, `legacySeal` na condição de `:214` vira `legacySeal || extraSeal`, e `kExtraSeal` é removido do objeto junto com `kLegacySeal` (`:199-202`) antes do `Object.assign` (`:208`). A condição `sessionFromCookie` (`:214`) já exclui o cabeçalho (RF-05), e a re-selagem já usa `password` em `sealSession`. O símbolo é interno (sem export em `src/index.ts`), logo não há nome público novo.

### D-06 — Validação das senhas extras em quem sela
**Alternativas:** (a) validar só em `getSession`/`unsealSession`; (b) validar em `sealSession` (e antecipar em `updateSession`); (c) validar em todas as funções, incluindo as que só leem.
**Escolha:** (b). Função interna `assertExtraPasswords(config, sealOptions)` em `session.ts`, chamada no início de `sealSession` (antes de buscar a sessão, para valer mesmo sem sessão no pedido, `:290-291`) e no início de `updateSession` quando for selar (`config.cookie !== false && event.res`, mesma condição de `:266`), antes de mutar `session.data` (`:254-259`). `useSession` sem sessão passa por `updateSession` (`:116-118`), então já fica coberto. Regras: cada item deve ser `string`, não vazio e com `length >= max(encryption.minPasswordlength, integrity.minPasswordlength)` de `sealOptions` (a `generateKey` aplica cada mínimo separadamente, `iron-crypto.ts:192`). Mensagem: ``Invalid session config: extraUnsealPasswords[${i}] password is empty`` / ``... password must be at least ${min} characters``, sempre com a palavra minúscula "password" (as mensagens atuais variam entre "Empty password" e "Password string too short"). `password` inválida continua falhando em `seal()` como hoje.
(c) foi rejeitada porque o contrato limita o erro às operações que selam e porque quem só lê com extras inválidas não deve cair. Limitação conhecida: quem apenas lê uma sessão aberta por `password` nunca valida as extras.

### D-07 — Helper interno para as opções de selo
**Alternativas:** manter a expressão duplicada em `sealSession` e `unsealSession` (`:300-304`, `:317-321`) ou extrair `getSealOptions(config)`.
**Escolha:** extrair função interna não exportada em `session.ts`. A validação de D-06 precisa do mesmo `sealOptions` (inclui `config.seal`); duplicar o cálculo pela terceira vez arriscaria divergência. Sem mudança de comportamento.

### D-08 — Sem mudança em `iron-crypto.ts`, `cookie.ts` e no tipo de `password`
Todo o trabalho fica em `session.ts` e `internal/session.ts`. Chunks já chegam a `unsealSession` como string única via `getChunkedCookie` (`:191`), e o cabeçalho também (`:185`).

## 3. Arquivos a alterar

| Arquivo | Linhas atuais | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-99` (`SessionConfig`) | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (só abre, nunca sela; tamanho mínimo igual a `password`; enxugar a lista após a rotação). |
| `src/utils/session.ts` | `:194-221` | Em `getSession`: ler e apagar `kExtraSeal` junto com `kLegacySeal` (`:199-202`); condição de `:214` passa a `(legacySeal \|\| extraSeal \|\| shouldSlide(...))`. |
| `src/utils/session.ts` | `:241-277` | `updateSession`: chamar `assertExtraPasswords` antes de mutar dados, quando for selar. |
| `src/utils/session.ts` | `:282-307` | `sealSession`: chamar `assertExtraPasswords` no topo; usar `getSealOptions`. |
| `src/utils/session.ts` | `:312-367` | `unsealSession`: laço sobre `[password, ...extras]` (D-02 a D-04), com o bloco legado (`:332-347`) dentro de cada iteração; marcar `kExtraSeal`; usar `getSealOptions`. As verificações de `maxAge` e `idleTimeout` (`:349-365`) ficam após o laço, inalteradas. |
| `src/utils/internal/session.ts` | `:7-9` | Novo `export const kExtraSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.extra-seal")`, junto de `kLegacySeal`. Importar em `session.ts:5`. |
| `test/session.test.ts` | ver seção 5 | Novos testes. |
| `docs/4.examples/handle-session.md` | `:120-149` (seção Options) | Subseção curta "Rotating the password" com exemplo e aviso de enxugar a lista. |
| `CHANGELOG.md` | n/a | Não editar manualmente se for gerado por release; confirmar a convenção antes. |

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts (público, apenas o campo novo)
export interface SessionConfig {
  password: string; // inalterado
  /**
   * Previous passwords still accepted to unseal sessions. Never used to seal.
   * Each must satisfy the same minimum length as `password`.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// Assinaturas públicas inalteradas:
// useSession, getSession, updateSession, sealSession, unsealSession, clearSession

// Internas (não exportadas), em src/utils/session.ts:
function getSealOptions(config: SessionConfig): SealOptions;
function assertExtraPasswords(config: SessionConfig, sealOptions: SealOptions): void; // lança Error com "password" na mensagem
// Internas, em src/utils/internal/session.ts:
export const kExtraSeal: unique symbol;
```

Esboço do laço de `unsealSession`:

```ts
const sealOptions = getSealOptions(config);
const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
let unsealed: Partial<Session> | undefined;
let firstError: unknown;
for (const [i, pass] of passwords.entries()) {
  try {
    unsealed = (await unseal(sealed, pass, sealOptions)) as Partial<Session>;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
    firstError ??= error;
    if (config.legacySealFallback === false || sealOptions.integrity.iterations === 1) continue;
    try {
      unsealed = (await unseal(sealed, pass, legacyOptions(sealOptions))) as Partial<Session>;
      if (unsealed) (unsealed as any)[kLegacySeal] = true;
    } catch (e2) {
      if (!(e2 instanceof Error) || e2.message !== "Bad hmac value") throw e2;
      continue;
    }
  }
  if (unsealed && i > 0) (unsealed as any)[kExtraSeal] = true;
  break;
}
if (!unsealed) throw firstError;
```

Detalhe de compatibilidade: hoje, com `legacySealFallback: false`, o erro original é relançado (`:333-339`); o esboço preserva isso porque `firstError` é o erro da `password`. Atenção: `unseal` pode devolver `null` (`iron-crypto.ts:149`); o código atual segue para `unsealed.createdAt` (`:351`) e lança `TypeError`, tratado como falha por `getSession`. A implementação deve manter esse efeito (não trocar `null` por "tentar próxima"), usando um indicador de sucesso separado de `unsealed` em vez de `if (!unsealed)`.

## 5. Estratégia de testes

Arquivo: `test/session.test.ts`, dentro de `describeMatrix("session", ...)` (`:15`), usando `t.fetch`, `sessionConfig` (`:21-26`) e o padrão dos testes legados (`:134-185`). Fluxo de bug-fix do AGENTS.md: escrever os testes antes, confirmar falha, implementar, confirmar passagem. Criar um helper local que sela `{ id, createdAt, data }` com uma senha dada usando `seal` e `sealDefaults` (já importados em `:10`) e um segundo `SessionConfig` com `password` nova e `extraUnsealPasswords: [antiga1, antiga2]` (senhas de 32+ caracteres).

Casos (mapeados ao PRD):
1. RF-01: sem campo e com `[]`, sessão selada por `password` abre; senha antiga é rejeitada (sessão nova); ao só ler, nenhum `Set-Cookie`.
2. RF-02: cookie gerado (sessão nova, `update`, `sealSession` direto) abre com `unseal(..., password)` e falha com cada extra isolada.
3. RF-03: selada com a 2ª extra abre com `id`, `createdAt` e dados preservados. Ordem e parada: espiar `crypto.subtle.deriveBits` (`vi.spyOn`) e conferir o número de derivações: selada com `password`, 2 derivações (HMAC + decrypt) iguais às de config sem extras; selada com a 1ª extra, mais derivações que com `password`, e menos que com a 2ª.
4. RF-04: senha fora da config gera sessão nova e vazia, sem erro (status 200).
5. RF-05: cookie com extra, handler só lê, resposta traz exatamente um `Set-Cookie` que abre com `password` e não abre com a extra; cookie com `password` não gera `Set-Cookie`; cabeçalho `x-h3-test-session` com extra abre sem `Set-Cookie`.
6. RF-06: para extra vazia, curta, e em cada posição da lista (primeira, última), `useSession` sem cookie, `updateSession` e `sealSession` rejeitam com mensagem casando `/password/i`; `password` curta continua rejeitando.
7. RF-07: `getSession`, `useSession`, `updateSession`, `unsealSession` e `clearSession` com sessão da extra, em cookie simples, cookie em chunks (`cookie: { chunkMaxLength: ... }` pequeno, cobrindo `getChunkedCookie`) e cabeçalho.
8. RF-08: sessão legada (1 iteração) selada com extra abre e é re-selada com `password` e `sealDefaults`; com `legacySealFallback: false` é tratada como inexistente; legada selada com `password` não dispara tentativas com extras (contagem de derivações).
9. Regressão: toda a suíte existente de `test/session.test.ts`, `pnpm lint` e `pnpm typecheck`.
10. Interação com `maxAge`/`idleTimeout`: sessão expirada aberta por extra continua sendo rejeitada (`Session expired!`).

Execução: `pnpm vitest run test/session.test.ts`, depois `pnpm lint`, `pnpm typecheck` e `pnpm vitest run`.

## 6. Riscos

- **Custo de PBKDF2 (8192 iterações):** cada tentativa derivada custa. Mitigado por ordem fixa, parada na primeira que abre (D-03) e propagação imediata de erros que não são hmac (D-04). Pior caso de cookie inválido: `2 × (1 + N)` pares de derivações com legado ativo; documentar que a lista deve ser curta.
- **Vazamento de senhas antigas:** extras prolongam a validade de segredos comprometidos. Documentar a remoção após o período de rotação.
- **Regressão do fallback legado:** o bloco legado muda de lugar (dentro do laço). Coberto pelos testes existentes (`test/session.test.ts:134-185`) e pelo caso 8.
- **Valor `null` do unseal:** manter o comportamento atual (seção 4, último parágrafo) para não mascarar nem alterar o resultado de payload vazio.
- **Marcador interno vazando:** `kExtraSeal`, como `kLegacySeal` hoje, fica no retorno de `unsealSession` chamado diretamente. É símbolo (não serializa em JSON nem entra no selo), mas deve ser removido em `getSession`.
- **Validação só ao selar:** extras inválidas passam despercebidas em processos que só leem sessões abertas por `password`. É o contrato (RF-06); documentado em D-06.
- **Reselagem em leitura:** sessões abertas por extra geram `Set-Cookie` em requisições só de leitura, com a mesma sobreposição possível com escritas concorrentes já descrita em `docs/4.examples/handle-session.md:183`; mencionar na documentação.
- **Mensagem de erro:** testes ocultos podem testar a palavra "password" com ou sem diferenciar maiúsculas; a mensagem proposta usa "password" em minúscula para cobrir ambos os casos.
