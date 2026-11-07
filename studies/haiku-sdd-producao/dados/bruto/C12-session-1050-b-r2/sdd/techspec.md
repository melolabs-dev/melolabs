# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-12). Esta especificação decide **como** implementar; o "o quê" e os critérios de aceitação continuam no PRD. Quando um ponto aqui divergir do PRD, a divergência está marcada como tal.

## 1. Resumo

- `SessionConfig` ganha `extraUnsealPasswords?: string[]`.
- `unsealSession` (`src/utils/session.ts`) tenta abrir o selo com `password` e depois com cada extra, em ordem. A primeira que abre vence.
- `getSession` resela a sessão com `password` quando ela foi aberta com uma extra e veio do cookie (RF-04).
- Nenhuma mudança em `src/utils/internal/iron-crypto.ts`, no formato do selo, nem em `src/index.ts`.

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica de múltiplas senhas

**Escolha:** implementar o laço de senhas dentro de `unsealSession` (`src/utils/session.ts:312`), chamando o `unseal` de iron uma vez por candidata. Iron continua recebendo uma string por chamada.

**Alternativas consideradas:**

- *Aceitar `string | string[]` em `iron-crypto.ts`.* Mudaria a API interna do selo e espalharia a decisão por uma camada que não conhece sessões. Rejeitada.
- *Usar o mecanismo de ids de senha do iron (`PasswordHash`, `iron-crypto.ts:427`).* Exigiria mapear ids no cookie e uma API pública de ids, o que o PRD proíbe ("Nenhum outro nome público novo", premissa de "não é preciso mapear ids"). Rejeitada.

**Justificativa:** a mudança fica restrita ao único ponto que escolhe a senha, e o contrato do selo permanece intacto.

### D-02 — Ordem de tentativas e critério de falha

**Escolha:**

1. Candidatas = `new Set([config.password, ...(config.extraUnsealPasswords ?? [])])`. A `Set` remove duplicatas e evita pagar PBKDF2 duas vezes com a mesma senha.
2. Para cada candidata, em ordem: tenta o selo estrito; se falhar com `"Bad hmac value"` e o fallback legado estiver habilitado, tenta o selo legado (1 iteração) com a mesma candidata (PRD, premissa 127; RF-08).
3. **Qualquer** falha de uma candidata passa para a próxima. Se todas falham, lança o **erro da primeira candidata** (`config.password`), que é exatamente o erro que lança hoje.
4. Erros de estrutura (`"Wrong mac prefix"`, `"Incorrect number of sealed components"`, `"Expired seal"`) são lançados por iron antes de qualquer PBKDF2, então repetir para as extras custa pouco e termina no mesmo erro do primário.

**Alternativas consideradas:**

- *Continuar só em `"Bad hmac value"`.* Parece mais preciso, mas quebra a premissa do PRD (linha 125): uma senha extra curta (`< 32` caracteres) lança `"Password string too short"` de `generateKey` (`iron-crypto.ts:192-195`). Com esse filtro, uma extra inválida na frente da válida impediria a abertura. Rejeitada.
- *Duas passadas: estrito para todas as candidatas, depois legado para todas.* Economiza uma derivação em sessões novas que vieram de uma extra (sem tentar o legado com `password` primeiro). Porém inverte a ordem prevista no PRD (linha 127) e não ganha nada para sessões legadas com a senha atual, que é o caso mais comum de legado. Rejeitada por aderência ao PRD; o custo extra cai só em cookies de extras, e a tabela de riscos (§7) o cobre.

### D-03 — Checagens de expiração ficam depois da escolha da senha

**Escolha:** `maxAge` e `idleTimeout` (`session.ts:350-365`) continuam sendo checados **uma vez**, sobre o resultado da primeira candidata que abriu o selo. Se o resultado estiver expirado, lança `Error("Session expired!")` sem tentar as outras senhas.

**Justificativa:** é a premissa de PRD linha 127. Além disso, a expiração do selo (`Expired seal`) depende só do campo `expiration` em claro, então não muda entre candidatas.

**Nota sobre RF-06:** o erro esperado é `"Session expired!"`, não `"Expired seal"`. Isso vale porque `sealSession` usa `ttl = maxAge * 1000` a partir do momento do selo, que é ≥ `createdAt` (`session.ts:302`). A checagem da aplicação dispara antes da do iron (que só dispara em `ttl + timestampSkewSec`). O teste de RF-06 deve selar com `seal()` sem `ttl` (como o teste de legado, `test/session.test.ts:135`), para que o iron nunca expire o selo.

### D-04 — Como `getSession` descobre que a sessão veio de uma extra

**Escolha:** marcar o resultado de `unsealSession` com um símbolo interno, no mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7`). Novo símbolo: `kExtraPasswordSeal`, com `Symbol.for("h3.internal.session.extra-password-seal")`, declarado em `src/utils/internal/session.ts`.

`getSession` lê o símbolo junto com `kLegacySeal` e o apaga antes de `Object.assign(session, unsealed)` (`session.ts:208`). Se ficasse, `Object.assign` copiaria o símbolo para a sessão, e ele apareceria no objeto retornado.

**Alternativas consideradas:**

- *Função interna nova (`unsealSessionWithPassword`) que devolve `{ session, password }`, com `unsealSession` como wrapper.* Tipo mais limpo, sem símbolo. Porém obriga a duplicar a lógica de leitura do legado ou a refatorar os dois marcadores de uma vez, o que é uma tarefa maior que a pedida. Fica como alternativa se o time preferir tipos a símbolos.
- *Comparar o resultado com `config.password` em `getSession`.* Não funciona: `unsealSession` não devolve a senha usada.

**Efeito colateral aceito:** `unsealSession` é público (`src/index.ts:209`), então o símbolo aparece no retorno. É o mesmo que já acontece com `kLegacySeal`, e o símbolo não é serializado pelo `JSON.stringify` do selo.

### D-05 — Resselagem reutiliza o caminho existente

**Escolha:** adicionar `extraSeal` à condição de `session.ts:214`:

```ts
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

`updateSession` usa `sealSession`, que sempre sela com `config.password` (`session.ts:300`). Então a regra "selar usa só `password`" (RF-03) vem de graça, sem código novo de escrita.

**Alternativa rejeitada:** resselar dentro de `unsealSession`. Ela não tem o `event` com o contexto da sessão e não deve escrever cookie.

### D-06 — Tipo e validação do campo

**Escolha:** `extraUnsealPasswords?: string[]`, sem validação no construtor da config (PRD, premissa 125). A JSDoc do campo (ver §4) deve dizer: (a) só abre, nunca sela; (b) remover quando a última sessão com a senha antiga expirar (PRD, risco 133); (c) sessões lidas pelo header não são resseladas (PRD, risco 134); (d) limite sugerido de poucas entradas (questão 2 do PRD).

**Alternativas consideradas:**

- `readonly string[]`. Mais correto para um campo de entrada, mas o PRD fixa `string[]` (RF-01). Mantemos `string[]` para não divergir do contrato.
- `string | string[]` em `password`. É a segunda alternativa da issue e está fora de escopo (PRD, linha 113).

### D-07 — Sessões do header

**Escolha:** o caminho de header (`session.ts:178-187`, `sessionFromCookie = false`) já tem a guarda `sessionFromCookie` na condição de D-05. Nada muda no caminho do header além de aceitar a extra, que é o comportamento pedido em RF-09.

## 3. Contratos

```ts
// src/utils/session.ts — SessionConfig (acrescentar após `password`, linha 48)

  /**
   * Previous passwords that can still open sessions sealed with them. They are
   * tried after `password` and never seal anything: new and resealed sessions
   * always use `password`. A session opened with one of these is resealed with
   * `password` on the same request (cookie sessions only, not the session header).
   *
   * Keep the list short and remove an entry once no session sealed with it can
   * still be in use, which means after the longest `maxAge`/`idleTimeout` that was
   * in effect when it was current. Until then, the old secret stays valid for
   * whoever holds it.
   */
  extraUnsealPasswords?: string[];
```

```ts
// src/utils/session.ts — unsealSession (contrato, mesma assinatura pública)

export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Sketch do corpo (a implementação final deve seguir este fluxo):

```ts
const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
const allowLegacy = config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1;
const passwords = [...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])];

let unsealed: Partial<Session> | undefined;
let matched = false;
let firstError: unknown;
let usedPassword = config.password;
for (const password of passwords) {
  try {
    unsealed = await unsealWithPassword(sealed, password, sealOptions, allowLegacy);
    matched = true;
    usedPassword = password;
    break;
  } catch (error) {
    firstError ??= error;
  }
}
if (!matched) {
  throw firstError;
}
if (unsealed && usedPassword !== config.password) {
  (unsealed as any)[kExtraPasswordSeal] = true;
}
// ... expiração (maxAge / idleTimeout) inalterada, sobre `unsealed`
return unsealed!;
```

```ts
// src/utils/session.ts — helper interno, no fim do arquivo (regra de utils/internal se crescer)

/** Unseal with one password, retrying with the legacy 1-iteration seal when allowed. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  allowLegacy: boolean,
): Promise<Partial<Session>> {
  try {
    return (await unseal(sealed, password, sealOptions)) as Partial<Session>;
  } catch (error) {
    if (!allowLegacy || !(error instanceof Error) || error.message !== "Bad hmac value") {
      throw error;
    }
    const legacy = (await unseal(sealed, password, {
      ...sealOptions,
      encryption: { ...sealOptions.encryption, iterations: 1 },
      integrity: { ...sealOptions.integrity, iterations: 1 },
    })) as Partial<Session>;
    if (legacy) {
      (legacy as any)[kLegacySeal] = true;
    }
    return legacy;
  }
}
```

Observação para quem implementa: o `unsealSession` atual (`session.ts:322-348`) usa `unsealed` como variável de `let` que também carrega o caso `unseal` devolver `null`. Os `if (unsealed)` existentes continuam válidos. O helper acima preserva `allowLegacy` com a mesma condição de hoje (`session.ts:332-337`), agora avaliada uma vez.

```ts
// src/utils/session.ts — getSession (alterações nas linhas 199-214)

const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const extraSeal = unsealed && (unsealed as any)[kExtraPasswordSeal];
if (legacySeal) {
  delete (unsealed as any)[kLegacySeal];
}
if (extraSeal) {
  delete (unsealed as any)[kExtraPasswordSeal];
}
// ... inalterado até Object.assign(session, unsealed)
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

```ts
// src/utils/internal/session.ts — novo símbolo, após kLegacySeal (linha 9)

export const kExtraPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-password-seal",
);
```

**Não muda:** `useSession`, `updateSession`, `sealSession`, `clearSession`, `iron-crypto.ts`, `src/index.ts`, a lista de exports de `test/unit/package.test.ts`.

## 4. Arquivos a alterar

| Arquivo | Onde | Mudança |
|---|---|---|
| `src/utils/session.ts` | `:39-99` (`SessionConfig`) | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (§3). |
| `src/utils/session.ts` | `:194-221` (`getSession`, bloco de unseal) | Ler e apagar `kExtraPasswordSeal`; incluir `extraSeal` na condição de reseal (`:214`). |
| `src/utils/session.ts` | `:312-367` (`unsealSession`) | Laço sobre candidatas (`:322-348` substituídos); extrair `unsealWithPassword`; manter as checagens de expiração em `:349-365`. |
| `src/utils/session.ts` | `:300-304` (`sealSession`) | Sem mudança de código. Confirmar que continua usando `config.password`. |
| `src/utils/internal/session.ts` | `:7-9` | Declarar `kExtraPasswordSeal`. |
| `test/session-unseal-passwords.test.ts` | arquivo novo | Testes de RF-02 a RF-09 (§5). Arquivo irmão, conforme PRD RF-11, para não aumentar `test/session.test.ts` (777 linhas). |
| `test/unit/types.test-d.ts` | fim do arquivo | Teste de tipo de RF-01 (ver §5). |

Não alterar: `src/index.ts`, `test/unit/package.test.ts`, `test/session.test.ts`, `test/unit/iron-crypto.test.ts`. Estes dois últimos devem passar sem mudança (RF-05).

Arquivos de referência lidos e conferidos: `src/utils/internal/iron-crypto.ts:58` (`seal`), `:87` (`unseal`), `:124-128` (lookup por id), `:135-137` (`"Bad hmac value"`), `:192-195` (mínimo de 32 caracteres), `test/_setup.ts` (`describeMatrix`).

## 5. Estratégia de testes

**Procedimento (AGENTS.md, "Bug Fix Workflow"):**

1. Escrever primeiro os testes de RF-02 e RF-04. Rodar `pnpm vitest run test/session-unseal-passwords.test.ts` e confirmar que falham antes da implementação (hoje a sessão com extra é rejeitada e vira sessão nova).
2. Implementar §3.
3. Confirmar que os testes passam nos dois alvos (`web` e `node`).
4. Rodar `pnpm vitest run test/session.test.ts test/unit/iron-crypto.test.ts` sem alterar as asserções existentes (RF-05).

**Casos (todos com `describeMatrix`, cada um roda em `web` e `node`):**

| Caso | RF | Como montar | Asserção |
|---|---|---|---|
| Abre sessão com extra | RF-02 | `seal({id, createdAt, data}, "A", sealDefaults)`; cookie `h3-test=...`; config `{password:"B", extraUnsealPasswords:["A"]}` | `id`, `createdAt`, `data` iguais aos selados; sem erro |
| Sela só com `password` | RF-03 | `updateSession(event, config, {user:"x"})` | `unseal(cookie, "B")` ok; `unseal(cookie, "A")` lança |
| Reseala no read | RF-04 | Mesmo cookie de RF-02 | Há 1 `Set-Cookie`; o valor do cookie novo abre com `unseal(novo, "B", sealDefaults)` e não abre sem `"B"` |
| Sem extras é igual | RF-05 | `extraUnsealPasswords` ausente, `undefined` e `[]` | Read normal não emite `Set-Cookie`; payload igual ao de hoje |
| Expiração com extra | RF-06 | Selo com `A`, `createdAt = now - 120s`, `maxAge: 60`, selado sem `ttl` | `unsealSession` rejeita com `"Session expired!"`; `getSession` devolve sessão nova sem `data`; sem `Set-Cookie` |
| Senha não correspondente | RF-07 | Selo com `C` | Sem exceção no route; `id` novo; `unsealSession` rejeita com `"Bad hmac value"` |
| Legado com extra | RF-08 | Selo com 1 iteração e `A` | Com fallback (padrão): restaura e reseala. Com `legacySealFallback: false`: sessão nova |
| Header com extra | RF-09 | Header `x-h3-test-session: <selo com A>` | Restaura; nenhum `Set-Cookie` |
| Extra inválida não bloqueia | §2 D-02 | `extraUnsealPasswords: ["", "A"]` com selo `A` | Restaura com `A` |
| Ordem | D-02 | Selo com `A2`; `extraUnsealPasswords: ["A1", "A2"]` | Restaura (A1 falha, A2 abre) |
| Tipo, RF-01 | RF-01 | Em `test/unit/types.test-d.ts`: `SessionConfig` aceita `extraUnsealPasswords: ["x"]` e rejeita `"abc"` e `[1]` | Com `// @ts-expect-error` nos casos inválidos; confirmar que `tsc --noEmit` inclui `test/` |
| Exports | RF-10 | Nenhuma mudança | `test/unit/package.test.ts` passa sem alterar o snapshot |

**Verificação final:** `pnpm lint`, `pnpm typecheck`, `pnpm vitest run` (suíte completa, inclusive `test/session.test.ts`).

## 6. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Custo de CPU com cookies inválidos (PRD, risco 132) | Cada cookie que nenhuma senha abre custa (candidatas) × (1 ou 2) PBKDF2. Com a `Set` (D-02), o custo é o da lista sem duplicatas. | Documentar lista curta (JSDoc §3). Não criar limite rígido agora. Medir com benchmark antes de decidir (questão 2 do PRD). |
| Senha antiga válida indefinidamente (PRD, risco 133) | Segredo antigo continua abrindo sessões. | JSDoc do campo (§3); removê-la quando sessões antigas expirarem. |
| Cookie e header divergem (PRD, risco 134) | Sessão de header continua com a senha antiga até expirar. | Documentado na JSDoc; teste de RF-09. |
| Regressão em sessões existentes (PRD, risco 135) | A mudança toca todo caminho de leitura. | Testes existentes sem mudança de asserção (RF-05); regressão escrita antes (§5). |
| Erro trocado por causa do laço | Se o erro lançado não for o do primário, `getSession` pode se comportar diferente. | D-02, passo 4: lança `firstError` (erro do primário). Teste de RF-07 verifica `"Bad hmac value"`. |
| Símbolo vazar para a sessão | `kExtraPasswordSeal` aparece em `session`. | Apagar antes de `Object.assign` (§3); teste com `toEqual` no retorno de `getSession`. |
| Resselagem em leitura de GET | Um `Set-Cookie` a mais numa resposta de leitura. Já é o caminho do legado. | Mesmo mecanismo de D-05; aceito pelo PRD (RF-04, premissa 126). |
| Erro de RF-06 diferente do esperado | Teste pode esperar `"Expired seal"`. | Ver nota em D-03; o teste deve selar sem `ttl`. |

## 7. Questões em aberto e recomendação

1. **RF-04 (migração na leitura) entra?** Recomendação: sim, como no PRD. Se o time recusar, remover D-05 e o `extraSeal` de `getSession`; o resto continua igual.
2. **Limite de `extraUnsealPasswords`?** Recomendação: documentar, sem validação, até medir o custo real com um benchmark de cookie inválido. Se for necessário um limite, ele deve ser em `unsealSession` (tamanho da lista), não no construtor.
3. **Símbolo ou função interna (D-04)?** Recomendação: símbolo, pelo padrão de `kLegacySeal`. Trocar só se o time quiser tipos mais limpos e aceitar a refatoração.

## 8. Ordem de implementação

1. Testes de RF-02 e RF-04 (falhando).
2. `kExtraPasswordSeal` em `src/utils/internal/session.ts`.
3. Campo em `SessionConfig`, com JSDoc.
4. `unsealWithPassword` e o laço em `unsealSession`.
5. Ajustes em `getSession`.
6. Demais testes de §5, inclusive tipo.
7. `pnpm lint`, `pnpm typecheck`, `pnpm vitest run`.
