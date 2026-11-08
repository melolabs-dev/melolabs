# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Todas as citações `arquivo:linha` foram conferidas no código atual da branch `master`.

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. A leitura de sessão tenta `password` e depois cada extra, na ordem. A selagem continua usando só `password`. Sessão aberta por uma extra e lida de cookie é regravada com `password` na mesma requisição (migração). A mudança fica concentrada em `src/utils/session.ts`, com um símbolo interno novo em `src/utils/internal/session.ts`.

---

## Decisões de arquitetura

### D-01 — Onde fica o laço de tentativas

**Escolha:** o laço fica dentro de `unsealSession` (`src/utils/session.ts:312`). A tentativa para uma senha só (strict + fallback legado) sai do `try/catch` atual (`src/utils/session.ts:322-348`) para um helper interno `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`. `unsealSession` percorre `[config.password, ...extras]`.

**Por que:** `unsealSession` já é o ponto único de leitura e já é exportado (`src/index.ts:209`). Quem chama a API pública diretamente também ganha o suporte a extras sem duplicar lógica.

**Alternativas consideradas:**
- *Laço em `getSession`:* descartado. `getSession` só chama `unsealSession` dentro de `.catch(() => {})` (`src/utils/session.ts:196-198`), e a API pública `unsealSession` ficaria sem o suporte.
- *Wrapper em `iron-crypto.ts` (`unseal` com array):* descartado. O iron não conhece expiração nem o fallback legado do h3, e o formato selado não muda (PRD, fora de escopo).

### D-02 — Ordem: fallback legado por senha, não em dois passes

**Escolha:** para cada senha, tenta-se primeiro o unseal atual e, se falhar com `Bad hmac value`, o fallback de 1 iteração. Só depois passa-se para a próxima senha.

**Por que:** é a leitura mais direta de P1 ("primeira que abre vence") e reaproveita o bloco existente sem mudar sua lógica. Em custo, o pior caso é o mesmo que em dois passes: o fallback usa 1 iteração e é barato, e o custo dominante é o PBKDF2 de 8192 iterações de cada senha (ver R1).

**Alternativas consideradas:**
- *Dois passes (todas as senhas com iterações atuais, depois todas com o fallback):* mesmo custo no pior caso e mais código. Descartado.

### D-03 — Validação da RF-06 fora do `.catch`

**Escolha:** um helper `assertUnsealPasswords(config)` lança erro se alguma extra for inválida. Ele é chamado no início de `getSession`, antes de qualquer mutação de `context.sessions` (antes de `src/utils/session.ts:158`), e também no início de `unsealSession`, para quem chama a API pública.

- Critério: `typeof p !== "string" || p.length < minLength`, com `minLength = (config.seal ?? sealDefaults).encryption.minPasswordlength` (o valor efetivo, que respeita um `seal` customizado; padrão 32, `src/utils/internal/iron-crypto.ts:22`).
- Erro: `Error` simples, com mensagem que cita `extraUnsealPasswords[i]` e o mínimo.

**Por que:** a validação precisa escapar do `.catch(() => {})` de `src/utils/session.ts:198`, senão repete o problema R3 do PRD (todas as sessões somem em silêncio). Validar antes de tocar em `context.sessions` evita deixar um placeholder vazio que faria chamadas seguintes devolverem sessão inválida (`src/utils/session.ts:173`).

**Alternativas consideradas:**
- *Validar só dentro de `unsealSession`:* descartado. O erro seria engolido pelo `.catch` de `getSession`.
- *Usar o `minPasswordlength` do iron sem olhar `config.seal`:* descartado. Um `seal` customizado com mínimo diferente faria a validação divergir do que o iron aceita.

### D-04 — Como sinalizar "aberta por senha extra"

**Escolha:** um símbolo interno `kUnsealedWithExtra` (`src/utils/internal/session.ts`, junto de `kLegacySeal`, linhas 7-9), marcado em `unsealSession` quando a senha que abriu não é a primeira. Em `getSession`, ele é lido e removido **antes** de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`), igual ao que já é feito com `kLegacySeal` (`src/utils/session.ts:199-201`).

**Por que:** `Object.assign` copia símbolos enumeráveis. Sem o `delete` antes, o flag vazaria para a sessão em memória. O padrão já existe no código, então não cria um mecanismo novo.

**Alternativas consideradas:**
- *Comparar o cookie com a senha atual (ex.: tentar `unseal` de novo com `password`):* descartado. Custa outro PBKDF2 por requisição.
- *Mudar o retorno de `unsealSession` para uma tupla `{ session, sealedWith }`:* descartado. Quebra a API pública exportada (`src/index.ts:209`) e o teste de exports (`test/unit/package.test.ts:149`).

### D-05 — Regravação só para cookie, com a condição já existente

**Escolha:** a condição de regravação em `getSession` (`src/utils/session.ts:214`) passa a ser:

```ts
if (session.id && sessionFromCookie && (legacySeal || unsealedWithExtra || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

`updateSession` já sela com `config.password` (`src/utils/session.ts:267` via `sealSession`, linha 300). Nenhuma mudança é necessária no caminho de selagem (RF-03).

**Por que:** `sessionFromCookie` é `false` quando a sessão vem do header (`src/utils/session.ts:189-193`), o que atende RF-04 e P2 sem código extra. A regravação reaproveita o mecanismo do fallback legado (P3).

### D-06 — Limite de senhas extras: documentar, não impor (decisão a confirmar)

**Escolha:** o código não impõe limite de quantidade. O JSDoc do campo diz que cada extra custa uma derivação PBKDF2 em cada cookie que não abre com as senhas anteriores, e que as extras devem ser removidas depois da janela de migração (R4).

**Por que:** o PRD sugere até 3 como mitigação de R1, mas a RF-06 só pede validação de tamanho. Um limite fixo criaria um novo caminho de erro sem pedido explícito. A lista é estática e definida pelo desenvolvedor (P5), então o custo é controlado por quem configura.

**Pendência:** confirmar se o limite de 3 entra como validação (`extraUnsealPasswords` com mais de 3 itens lança erro em `assertUnsealPasswords`). Se entrar, é uma linha a mais no helper e um teste.

### D-07 — Expiração fora do laço

**Escolha:** as verificações de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam depois do laço e não fazem parte dele. "Session expired!" não dispara nova tentativa com outra senha.

**Por que:** RF-07 exige que a expiração não dependa da senha. Como as checagens ficam depois de a sessão ser aberta, o resultado é o mesmo para qualquer senha.

### D-08 — Sucesso por flag, não por truthiness

**Escolha:** o laço usa `let found = false` e marca `found = true` ao abrir, em vez de testar `if (unsealed)`. Se a senha abrir e o `unseal` devolver `null` (`src/utils/internal/iron-crypto.ts:149`), o laço não continua para a próxima senha. Ao final, `if (!found) throw firstError`, para que o erro lançado com uma só senha seja o mesmo de hoje.

### D-09 — Tipo e JSDoc do campo

**Escolha:** `extraUnsealPasswords?: string[]`, logo após `password` (`src/utils/session.ts:48`), com JSDoc em português ou inglês conforme o arquivo (o arquivo está em inglês; manter em inglês). O JSDoc diz: senhas anteriores que só abrem sessões; a selagem usa `password`; o custo por requisição; e a remoção depois da migração.

---

## Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-99` (`SessionConfig`) | Campo novo `extraUnsealPasswords?: string[]` após `password` (`:48`), com JSDoc. |
| `src/utils/session.ts` | `:149-153` (`getSession`) | `assertUnsealPasswords(config)` como primeira linha. |
| `src/utils/session.ts` | `:196-216` | Leitura do flag `kUnsealedWithExtra` junto de `kLegacySeal` (`:199-201`), `delete` antes de `Object.assign` (`:208`), condição de regravação (`:214`). |
| `src/utils/session.ts` | `:312-367` (`unsealSession`) | Laço sobre as senhas, `unsealWithPassword` (helper interno com o `try/catch` de `:322-348`), marcação do flag, `assertUnsealPasswords` no início. |
| `src/utils/session.ts` | fim do arquivo | Helpers internos `assertUnsealPasswords`, `unsealWithPassword`. |
| `src/utils/internal/session.ts` | `:7-9` | Símbolo `kUnsealedWithExtra`, no mesmo formato de `kLegacySeal` (`Symbol.for("h3.internal.session.unsealed-with-extra")`). |
| `test/session.test.ts` | antes de `:777` (fim do `describeMatrix`) | Novo `describe("extraUnsealPasswords", ...)`, ver estratégia de testes. |

**Não alterar:**
- `src/index.ts:203-211`: `SessionConfig` já é exportado como tipo; nenhum símbolo runtime novo.
- `test/unit/package.test.ts:125,149`: lista de exports runtime. Nenhum export runtime novo, então a lista não muda.
- `src/utils/internal/iron-crypto.ts`: formato e algoritmo não mudam (PRD).
- `src/utils/cookie.ts:188-218`: `setChunkedCookie` já apaga chunks anteriores (`:215-218`), então a regravação com tamanho diferente é segura.
- Testes existentes em `test/session.test.ts`: nenhuma expectativa muda. RF-05 exige isso, e o caminho sem extras é o mesmo código.

---

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (novo campo)
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that can still open existing sessions, tried in order
   * after `password`. Never used to seal: new cookies are always sealed with
   * `password`, and a cookie opened with one of these is resealed with
   * `password` on read. Remove them once the migration window has passed.
   * Each one costs an extra PBKDF2 derivation for every request whose cookie
   * no earlier password opens.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// interno (não exportado)
function assertUnsealPasswords(config: SessionConfig): void;
// Lança Error se alguma extra não for string ou tiver length < minLength.

function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions & { ttl: number },
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>>;
// Corpo = o try/catch atual de unsealSession, com config.password -> password
// e config.legacySealFallback -> legacySealFallback. Mesmos erros.

// público — assinatura inalterada
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
// Comportamento:
// 1. assertUnsealPasswords(config)
// 2. for (i, password) of [config.password, ...extras]:
//      try { unsealed = await unsealWithPassword(...); found = true; break; }
//      catch (e) { firstError ??= e; }
// 3. if (!found) throw firstError;
// 4. if (i > 0) unsealed[kUnsealedWithExtra] = true;   // senha extra
// 5. maxAge / idleTimeout inalterados (lançam "Session expired!")
// 6. return unsealed;

// internal/session.ts
export const kUnsealedWithExtra: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.unsealed-with-extra",
);
```

**Comportamento observável (contrato para os testes):**

| Entrada | Resultado |
| --- | --- |
| Cookie selado com `password` | Igual a hoje. Sem `Set-Cookie` extra. |
| Cookie selado com uma extra (cookie) | Sessão com os dados originais; `Set-Cookie` selado com `password`. |
| Cookie selado com uma extra (header) | Sessão com os dados originais; sem `Set-Cookie`. |
| Cookie selado com senha fora da lista | Sessão inexistente (novo `id`), sem erro. |
| `extraUnsealPasswords: []` ou ausente | Igual a hoje, incluindo `legacySealFallback`. |
| Extra com menos de 32 caracteres | `getSession`/`useSession` rejeitam com `Error` que cita o campo. |
| Cookie selado com extra e `createdAt` vencido | Sessão rejeitada como expirada (novo `id`). |
| Cookie legado (1 iteração) selado com extra | Abre; regravado com `password`. Com `legacySealFallback: false`, rejeitado. |

---

## Estratégia de testes

Todos os casos novos vão para `test/session.test.ts`, dentro de `describe("extraUnsealPasswords", ...)` no `describeMatrix` (`test/session.test.ts:15`), para rodar nos modos web e node (`test/_setup.ts:41,61`).

Padrão: criar cookies com `seal(payload, senha, sealDefaults)` de `src/utils/internal/iron-crypto.ts` (já importado, `test/session.test.ts:12`), igual ao teste de legado (`test/session.test.ts:134-159`). Verificar Set-Cookie com `unseal` e com `decodeURIComponent(setCookie.match(...))`, como em `test/session.test.ts:157`.

Senhas de teste: `A = "1234567123456712345671234567123456712345671234567"` (a de `sessionConfig`, `:23`), `B` e `C` com 50+ caracteres distintos.

| # | Caso | Como verificar | RF |
| --- | --- | --- | --- |
| 1 | Abre cookie selado com extra | Cookie com `B`; `getSession` retorna `data` original, sem `error` | RF-02 |
| 2 | Senha fora da lista vira sessão nova | Cookie com `C`; `id` diferente do selado, sem erro | RF-02 |
| 3 | Selagem só com `password` | `updateSession` grava; `unseal(cookie, A)` ok; `unseal(cookie, B)` rejeita `Bad hmac value` | RF-03 |
| 4 | Migração por Set-Cookie | Cookie com `B`; resposta tem 1 `Set-Cookie`; abre com `A`, não abre com `B` | RF-04 |
| 5 | Sem Set-Cookie pelo header | Sessão com `B` enviada em `x-{name}-session`; abre; `getSetCookie()` vazio | RF-04 |
| 6 | Expiração por maxAge | Cookie com `B` e `createdAt` vencido; `maxAge` ativo; sessão nova | RF-07 |
| 7 | Validação de extra inválida | Handler com `try/catch` que devolve a mensagem; mensagem cita `extraUnsealPasswords` | RF-06 |
| 8 | Legado com extra | Cookie legado (1 iteração) com `B`; abre, regravado com `A` | R2 |
| 9 | Legado com extra e `legacySealFallback: false` | Mesmo cookie; rejeitado (sessão nova) | R2 |
| 10 | Lista vazia equivale a ausente | Mesma resposta com `[]` e sem o campo | RF-05 |

Notas:
- Para o caso 7, o erro não deve virar `unhandled` (`src/error.ts:205-206`), senão o `afterEach` de `test/_setup.ts:152-156` falha. O handler precisa capturar o erro e devolvê-lo no corpo.
- Para o caso 6, use `createdAt` no passado em vez de fake timers. Assim o teste não depende de `vi.useFakeTimers` (como em `test/session.test.ts:311`).
- A suíte atual (`test/session.test.ts`, incluindo legado e lazy creation) precisa passar sem alteração de expectativa (RF-05).

**Verificações de projeto:**
- `pnpm vitest run test/session.test.ts`: todos os casos, web e node.
- `pnpm typecheck` (`package.json:54`, `tsc --noEmit`).
- `pnpm lint` (`package.json:46`, `oxlint . && oxfmt --check .`).
- `pnpm vitest run test/unit/` para confirmar que a lista de exports não mudou.

Observação: esta etapa é só de especificação. Nenhum desses comandos foi executado, porque nenhum código do projeto foi alterado.

---

## Riscos e mitigações

| ID | Risco | Mitigação |
| --- | --- | --- |
| R1 | Amplificação de CPU: cada cookie que não abre dispara `1 + N` derivações PBKDF2 de 8192 iterações (`src/utils/internal/iron-crypto.ts:22,27`). Qualquer requisição anônima pode enviar um cookie inválido. | Documentado no JSDoc (D-06). Limite de quantidade a confirmar (pendência de D-06). |
| R2 | Interação com `legacySealFallback`: o fallback de 1 iteração roda por senha. | Fallback por senha (D-02). Casos 8 e 9 cobrem a combinação. |
| R3 | Erro engolido em `getSession` (`src/utils/session.ts:198`) faz todas as sessões sumirem sem aviso se a extra for inválida. | Validação antes do `.catch` (D-03), com teste (caso 7). |
| R4 | Extra esquecida depois da rotação enfraquece a rotação. | JSDoc pede a remoção (D-09). Sem código de aviso. |
| R5 | Sessões de header não migram e ficam com a senha antiga até expirar. | Comportamento aceito pelo PRD (P2, RF-04). Documentado no JSDoc (D-09) e no caso 5. |
| R6 | Campo novo muda o tipo exportado. Quem usa `SessionConfig` como tipo exato pode notar. | Mudança aditiva e opcional. Risco baixo (PRD R6). |
| R7 | Flag `kUnsealedWithExtra` copiado para a sessão via `Object.assign` (`src/utils/session.ts:208`). | `delete` antes do assign (D-04). Adicionar uma asserção no caso 4 de que `Object.getOwnPropertySymbols(...)` da sessão não contém `kUnsealedWithExtra` (a sessão é devolvida por `getSession`, e o símbolo não deve aparecer nela). |
| R8 | Chamada direta de `unsealSession` (API pública) recebe o símbolo `kUnsealedWithExtra` no objeto retornado, como já acontece com `kLegacySeal`. | Mesmo padrão existente. Não é documentado como API. Aceito. |
| R9 | Mesma senha listada em `password` e em `extraUnsealPasswords` faz trabalho duplicado em cookies que não abrem. | Não tratado. É erro de configuração sem efeito de segurança. Pode ser filtrado depois se necessário. |

---

## Pendências para confirmar

1. **Limite de extras (D-06):** impor o máximo de 3 como validação, ou só documentar?
2. **Símbolo público (R8):** aceitar o símbolo extra no retorno público de `unsealSession`, como já ocorre com `kLegacySeal`?
