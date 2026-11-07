# Especificação técnica — várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-07), issue h3js/h3#1050.

## Visão geral

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Ao ler um cookie, `unsealSession` tenta `password` e depois cada senha extra. Ao selar, `sealSession` continua usando só `password`. Quando o cookie é aberto com uma senha extra, `getSession` reselá o cookie com `password`, do mesmo jeito que já faz com cookies legados.

A mudança fica em `src/utils/session.ts`, com um símbolo interno novo em `src/utils/internal/session.ts`. Não muda `iron-crypto.ts`, o formato do cookie, o algoritmo nem as iterações padrão.

Estado atual relevante:

- `src/utils/session.ts:48` — `password: string` é a única senha usada hoje.
- `src/utils/session.ts:312-367` — `unsealSession` chama `unseal` uma vez com `config.password` (`:324`). Se falhar com `"Bad hmac value"` e o fallback estiver ativo, tenta de novo com 1 iteração (`:332-347`).
- `src/utils/session.ts:196-221` — `getSession` chama `unsealSession`, e o `.catch(() => {})` de `:197` transforma qualquer erro em sessão vazia.
- `src/utils/session.ts:300` — `sealSession` sela sempre com `config.password`. Por isso RF-02 já vale sem mudança nessa função.

## Decisões de arquitetura

### D-01 — Onde tentar as senhas: loop em `unsealSession`

**Escolha:** `unsealSession` (`src/utils/session.ts:312`) monta a lista de senhas e itera sobre ela. `unseal` em `src/utils/internal/iron-crypto.ts:87` continua recebendo uma senha por vez.

**Alternativas consideradas:**

- *Mudar `unseal` para aceitar lista.* O iron já aceita `PasswordHash` (`iron-crypto.ts:427`), mas a escolha é por `id` do cookie. Isso exigiria ids no cookie, que estão fora de escopo (PRD, "Fora de escopo"). Também espalharia a lógica pela camada de criptografia.
- *Loop dentro de `getSession`.* Misturaria tentativa de senha com a lógica de carregamento e reseal, e `unsealSession` é API pública (`src/index.ts:209`), que ficaria sem as senhas extras.

**Justificativa:** é a menor mudança que mantém `unsealSession` como a única função que sabe abrir cookies, e não altera nenhuma assinatura pública.

### D-02 — Ordem das tentativas: duas passadas (atual, depois legado)

**Escolha:** primeiro tenta todas as senhas com as iterações atuais; só se nenhuma abrir e o fallback estiver ativo, tenta todas as senhas com 1 iteração.

```
passadas = [ (config.sealOptions atuais), (iterações = 1, se fallback ativo) ]
para cada passada:
  para cada senha em [password, ...extras] (sem duplicatas):
    tenta unseal; se "Bad hmac value", vai para a próxima senha; outro erro propaga
```

**Alternativas consideradas:**

- *Intercalar por senha:* para cada senha, tentar atual e depois legado. Cuidado: o custo total é o mesmo (2 derivações por senha em cookie inválido), mas um cookie atual sob a senha da posição *k* custaria `2k` derivações, contra `k` na escolha feita.
- *Recursão ou fallback em cada tentativa:* gera o crescimento multiplicativo que o PRD cita como risco. Com duas passadas o custo é linear.

**Justificativa:** o caso comum depois da rotação é cookie com iterações atuais, e ele fica mais barato. Com `extraUnsealPasswords` ausente, a lista tem um item e a sequência de tentativas é exatamente a de hoje (RF-05).

### D-03 — Sinalizar reseal com símbolo próprio, `kExtraSeal`

**Escolha:** `unsealSession` marca o objeto aberto com `kExtraSeal` (novo, em `src/utils/internal/session.ts`) quando a senha que abriu não é `config.password`. `getSession` lê e remove a marca antes de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`), e a condição de reseal de `:214` passa a incluí-la.

**Alternativas consideradas:**

- *Reusar `kLegacySeal`.* Menos código, mas o nome e o significado ficariam confusos: legado é sobre iterações, não sobre senha.
- *Mudar o retorno de `unsealSession`.* Quebraria a API pública.
- *Recalcular em `getSession`.* Não há como saber, sem a flag, qual senha abriu o cookie.

**Justificativa:** segue o padrão já existente (`kLegacySeal`, `src/utils/internal/session.ts:7`), sem mudar assinatura pública.

### D-04 — Deduplicar a lista de senhas

**Escolha:** `new Set([config.password, ...(config.extraUnsealPasswords ?? [])])`. O conjunto preserva a ordem de inserção, então `password` é sempre a primeira.

**Alternativas consideradas:** documentar e não deduplicar (o PRD aceita as duas opções). Deduplicar custa uma linha e evita derivações repetidas quando a senha antiga foi copiada para a lista, o que é um erro comum na rotação.

### D-05 — Só `"Bad hmac value"` avança para a próxima senha

**Escolha:** o único erro que faz a tentativa seguir para a próxima senha é `"Bad hmac value"`, a mesma condição que já ativa o fallback legado (`src/utils/session.ts:336`). Erros independentes da senha (`"Incorrect number of sealed components"`, `"Wrong mac prefix"`, `"Invalid expiration"`, `"Expired seal"`, `iron-crypto.ts:100-117`) propagam na primeira tentativa, como hoje.

**Justificativa:** `"Bad hmac value"` é o único erro que significa "esta senha não abre este cookie". Os outros não dependem da senha, então tentar de novo só gastaria CPU.

### D-06 — Sem validação nova de tamanho ou formato das senhas extras

**Escolha:** nenhuma validação adicional. As senhas extras passam pelas mesmas regras de `iron-crypto.ts` que `password` já passa (mínimo de 32 caracteres, `iron-crypto.ts:22` e `:191-196`). Ver o risco R-02.

### D-07 — Superfície pública

**Escolha:** só `extraUnsealPasswords?: string[]` com TSDoc, em `SessionConfig` (`src/utils/session.ts:39-99`). `src/index.ts:201-212` não muda, porque o tipo já é reexportado. Não entram exports novos.

### D-08 — Sessões lidas pelo header não são resseladas

**Escolha:** cookie aberto com senha extra é resselado só se veio do cookie (`sessionFromCookie`, `src/utils/session.ts:214`). Sessão via header continua com a senha antiga até que o cliente receba um cookie novo.

**Justificativa:** é o mesmo tratamento que o fallback legado já tem (sessões do header não podem ser resseladas). Está alinhado com RF-03, que fala de cookie.

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | Campo novo em `SessionConfig` (`:39`, junto de `password` em `:48`). `getSession`: ler e apagar `kExtraSeal` (`:199-201`) e incluir na condição de reseal (`:214`). `unsealSession` (`:312-367`): lista de senhas, duas passadas, marca `kExtraSeal`. |
| `src/utils/internal/session.ts` | Novo símbolo `kExtraSeal` ao lado de `kLegacySeal` (`:7-9`). |
| `test/session.test.ts` | Testes novos (ver seção de testes). Os existentes não mudam. |

Arquivos que **não** mudam: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `sealSession` (`:282-307`), `clearSession`, `shouldSlide`, `sessionExpires`.

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig
export interface SessionConfig {
  password: string;                       // inalterado: sela e abre
  /**
   * Senhas anteriores, usadas só para abrir sessões seladas antes de uma rotação.
   * Tentadas em ordem depois de `password`. Sessões abertas com uma delas são
   * resseladas com `password`. Cada senha segue as mesmas regras de `password`
   * (mínimo de 32 caracteres).
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}
```

```ts
// src/utils/internal/session.ts
export const kExtraSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-seal",
);
```

```ts
// src/utils/session.ts — assinatura de unsealSession: INALTERADA
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Helper interno (não exportado) para uma passada:

```ts
// src/utils/session.ts — interno
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<{ unsealed: unknown; password: string }>;
// Para em "Bad hmac value" com a próxima senha. Qualquer outro erro propaga.
// Se nenhuma senha abrir, relança o último "Bad hmac value".
```

Comportamento de `unsealSession`, por passada:

1. `passwords = [...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])]`
2. `unsealWithPasswords(sealed, passwords, sealOptions)`
3. Se der `"Bad hmac value"`, o fallback não estiver desativado (`legacySealFallback !== false`) e as iterações atuais não forem 1, repetir com `iterations: 1` (como hoje) e marcar `kLegacySeal`.
4. Se a senha que abriu não for `config.password`, marcar `kExtraSeal`.
5. Checagens de `maxAge` e `idleTimeout` (`:349-365`) inalteradas, aplicadas uma vez, depois que o cookie abriu.

Garantia de compatibilidade: sem `extraUnsealPasswords`, `passwords` tem um item e as passadas são as mesmas de hoje.

## Estratégia de testes

Testes em `test/session.test.ts`, dentro de `describeMatrix`, para rodar em web e node. Os cookies de teste são selados diretamente com `seal` de `src/utils/internal/iron-crypto.ts`, como já faz o teste de legado (`test/session.test.ts:134-159`).

**Atenção:** as senhas `"A"`, `"B"` e `"C"` dos critérios do PRD não servem, porque o iron exige 32 caracteres (`iron-crypto.ts:191-196`). Os testes devem usar três senhas de 32 ou mais caracteres, no mesmo estilo de `test/session.test.ts:23`.

| Teste | Cobre | Verificação |
| --- | --- | --- |
| Cookie selado com A; config `password: B, extra: [A]` | RF-01 | `GET` devolve os dados, sem erro e sem sessão vazia |
| `useSession` + `update` com config `B, [A]` | RF-02 | o `Set-Cookie` abre com `B` e não abre com `A` (`unseal` direto, `expect(...).rejects`) |
| Cookie aberto com A gera `Set-Cookie` | RF-03 | o novo cookie abre com `B` sem usar `A` |
| Cookie selado com C, fora da config | RF-04 | sessão vazia, `data` vazio, sem erro |
| Cookie legado (1 iteração) selado com A; config `B, [A]` | D-02 | dados devolvidos e cookie resselado com `B` com iterações atuais |
| Cookie legado sob A com `legacySealFallback: false` | D-02 | rejeitado, sessão vazia |
| `extraUnsealPasswords: [B]` com `password: B` | D-04 | funciona e não repete a tentativa (opcional: contar `deriveBits` como em `test/session.test.ts:722-735`) |
| `extraUnsealPasswords: []` | RF-05 | comportamento igual ao atual |
| Cookie sealed com A e `extraUnsealPasswords: [X, A]` | D-01 e D-02 | abre na segunda posição |
| Cookie com senha extra válida mas `Expired seal` | D-05 | propaga o erro e a sessão fica vazia, sem tentar as outras senhas |

Testes existentes que precisam atenção:

- `test/session.test.ts:722-735` ("seals once when updateSession creates the session") conta `deriveBits` sem cookie. Não deve mudar.
- `test/session.test.ts:134-186` (legado) deve passar sem mudança. A configuração não tem senhas extras, então as passadas são as mesmas.

Validação final: `pnpm vitest run test/session.test.ts`, depois `pnpm lint` e `pnpm typecheck`, e por fim `pnpm vitest run test/` (RF-07). Se algum teste de legado falhar, a causa está em D-02, não em ajuste de teste.

Medição de custo (R-01): usar `test/bench/session.ts` ou um script local para medir o tempo de `getSession` com um cookie inválido, com 0, 1 e 5 senhas extras. Isso confirma o custo linear.

## Riscos

**R-01 — CPU com cookie inválido.** Cada senha tentada custa uma derivação PBKDF2 de 8192 iterações (a checagem HMAC acontece antes da descriptografia, `iron-crypto.ts:130-137`, então uma tentativa errada não chega a derivar a chave de criptografia). Com a passada legada, cada senha extra custa mais uma derivação de 1 iteração. Um cookie inválido custa, portanto, cerca de `2 × (1 + N)` derivações, com `N` senhas extras. O custo é linear, não multiplicativo, pela D-02. Mitigação: medir (ver seção de testes) e documentar. Se o custo for alto, o próximo passo é limitar o tamanho da lista, o que o PRD deixou fora de escopo.

**R-02 — Senha curta vira logout silencioso.** Uma senha extra com menos de 32 caracteres faz `generateKey` lançar `"Password string too short"` (`iron-crypto.ts:191-196`). Esse erro não é `"Bad hmac value"`, então propaga (D-05). Como `getSession` engole erros (`src/utils/session.ts:197`), todo cookie que chegar a essa posição vira sessão vazia sem aviso. Mitigação: TSDoc com a regra e um teste que fixa o comportamento. Decisão a confirmar com o usuário: validar o tamanho das extras no início de `unsealSession` e lançar erro claro, ou manter a regra igual à de `password`.

**R-03 — Senha antiga esquecida.** Manter senhas antigas indefinidamente enfraquece a rotação. O PRD diz que a remoção é responsabilidade de quem mantém a lista. Nenhuma mudança de código cobre isso.

**R-04 — Sessões via header não migram.** Cookies lidos pelo header continuam com a senha antiga até que o cliente receba um cookie novo (D-08). Sessões que só usam header podem ficar com a senha antiga por mais tempo.

**R-05 — Ordem e duplicatas.** Coberto por D-04. A ordem da lista importa só para o custo, não para o resultado.

**R-06 — Interação com `idleTimeout` e `maxAge`.** As checagens de expiração rodam uma vez, depois que o cookie abriu (D-01, passo 5). Uma senha extra não estende a sessão. Não há teste novo específico, mas o fluxo fica coberto pelos testes de `idleTimeout` existentes (`test/session.test.ts:188-510`).

**R-07 — Erros não relacionados à senha em `unseal`.** O erro de expiração do iron (`"Expired seal"`, `iron-crypto.ts:115-117`) é checado antes da senha. Por isso propaga sem tentar as outras, e isso é o correto. Se a ordem das checagens mudar no iron, o loop continua funcionando, mas faria trabalho extra.
