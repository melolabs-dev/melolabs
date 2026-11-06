# Especificação técnica: várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato enxuto #1050-b), `sdd/prd.md` (RF-01 a RF-11) e issue h3js/h3#1050 (primeira alternativa).

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `unsealSession` passa a tentar `password` e, em seguida, cada senha extra, na ordem declarada, até uma abrir a sessão. `sealSession` e `updateSession` continuam selando só com `password`. Uma sessão aberta por senha extra é regravada com `password` na leitura, pelo mesmo caminho que já reseala sessões legadas. Não há novo export público.

Estado atual, em uma frase: uma única chave, sem fallback para outra. Ao trocar `password`, toda sessão selada com a chave antiga vira "sessão nova" em `getSession` (o erro é engolido em `src/utils/session.ts:197`).

---

## Estado atual (conferido no código)

| Ponto | Onde | O que faz hoje |
| --- | --- | --- |
| Campo `password` | `src/utils/session.ts:48` | `string`, documentado em `src/utils/session.ts:40-47`. Única chave usada para selar e abrir. |
| Leitura da sessão | `src/utils/session.ts:194-221` | Chama `unsealSession` (`:196`), engole qualquer erro (`:197`), trata `kLegacySeal` (`:199-201`), faz `Object.assign(session, unsealed)` (`:208`) e reseala só se `legacySeal` ou `shouldSlide` (`:214`), e só para sessões vindas do cookie (`sessionFromCookie`). |
| Nova sessão | `src/utils/session.ts:223-229` | Sem id válido, gera `id` e marca `kSessionNew`. |
| Selagem | `src/utils/session.ts:282-307` | `seal(session, config.password, ...)` em `:300`. |
| Abertura | `src/utils/session.ts:312-367` | `sealOptions` em `:317-321`. `unseal` com `config.password` em `:324`. Em caso de `Bad hmac value`, retry com 1 iteração PBKDF2 em `:332-344`, marcando `kLegacySeal` em `:345-347`. Checagens de `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`). |
| Símbolo legado | `src/utils/internal/session.ts:7-9` | `kLegacySeal = Symbol.for("h3.internal.session.legacy-seal")`. |
| Iron: ordem de checagem | `src/utils/internal/iron-crypto.ts:110-118` | Expiração do selo é checada antes do HMAC. Por isso `Expired seal` não depende da senha. |
| Iron: senha | `src/utils/internal/iron-crypto.ts:124-128` | String vira a chave usada. Não há `kid` relevante: o selo é gerado com id vazio. |
| Iron: HMAC | `src/utils/internal/iron-crypto.ts:135-137` | Senha errada gera `Bad hmac value`. Esse é o único erro que indica "chave errada". |
| Iron: tamanho mínimo | `src/utils/internal/iron-crypto.ts:191-196` | String com menos de `minPasswordlength` (32, `:22` e `:28`) lança erro na geração da chave. |
| Iron: senha vazia | `src/utils/internal/iron-crypto.ts:94-96` | `Empty password` para `""`. |
| Exports | `src/index.ts:199-212` | `sealSession`, `unsealSession`, `getSession`, `updateSession`, `useSession` já são públicos. |
| Lista de exports | `test/unit/package.test.ts:125,149,152` | Snapshot de nomes exportados. Não muda se nenhum export novo for criado. |
| Testes atuais | `test/session.test.ts:21-25` | `sessionConfig` com `password` de 49 caracteres. |
| Testes atuais | `test/session.test.ts:134-159` | Legado com 1 iteração é resselado com a senha atual. Esse teste precisa continuar passando. |
| Testes atuais | `test/session.test.ts:161-186` | `legacySealFallback: false` rejeita legado. |
| Testes atuais | `test/session.test.ts:722-735` | Espiona `crypto.subtle.deriveBits` para contar derivações. Padrão reaproveitável no RF-04/RF-05. |
| Fake timers | `test/session.test.ts:189`, `:227` | `vi.useFakeTimers({ toFake: ["Date"], now })` seguido de `vi.useRealTimers()`. |
| Benchmark | `test/bench/session.ts:20` | `useSession` sem extras. Usado para medir regressão de custo. |
| Scripts | `package.json:46,53,54` | `lint` = `oxlint . && oxfmt --check .`. `test` = lint + typecheck + vitest. `typecheck` = `tsc --noEmit`. |

Observação sobre o PRD: a estimativa de custo "2 × (N + 1) derivações" (`sdd/prd.md:149`) mistura dois custos. Cada candidata custa uma derivação de HMAC com as iterações atuais (8192, `iron-crypto.ts:21,27`). A derivação de criptografia só acontece depois do HMAC passar (`iron-crypto.ts:147`), então não entra no custo de senha errada. O retry legado custa uma derivação de 1 iteração, desprezível. Portanto o custo caro de uma leitura com cookie inválido é (N + 1) derivações de 8192 iterações, e não 2 × (N + 1). Correção registrada em R-01.

---

## Decisões de arquitetura

### D-01 — Onde fica a tentativa de múltiplas senhas

**Escolha:** dentro de `unsealSession` (`src/utils/session.ts:312`), sem mudar a assinatura. O loop passa a percorrer `[password, ...extras]`.

**Alternativas consideradas:**
- *Nova função exportada, por exemplo `unsealSessionWithKeys`.* Rejeitada: o RF-10 e a restrição do pedido proíbem nomes públicos novos.
- *Loop dentro de `getSession`.* Rejeitada: o RF-04 é escrito contra `unsealSession` diretamente, e `unsealSession` é exportada (`src/index.ts:209`). Deixar a lógica só em `getSession` deixaria quem chama `unsealSession` com comportamento diferente.
- *Loop em `unsealSession`, com o retry legado por senha em função interna.* **Escolhida.**

### D-02 — Ordem, critério de avanço e erro lançado

**Escolha:**
1. Candidatas: `config.password` primeiro, depois `config.extraUnsealPasswords` na ordem declarada, sem strings vazias (`.filter(Boolean)` só nas extras).
2. Qualquer erro de uma candidata passa para a próxima.
3. Se todas falharem, lança-se o erro da primeira candidata (a `password`).
4. Sucesso: a primeira candidata que abrir vence. Nenhuma extra é tentada depois.
5. A checagem de "sucesso" usa uma flag `found`, não `if (!unsealed)`, porque `unseal` pode legitimamente devolver `null` (`iron-crypto.ts:149`) e hoje esse caso não lança erro quando não há `maxAge` nem `idleTimeout`.

**Alternativas consideradas:**
- *Avançar só em `Bad hmac value`.* Rejeitada. Uma extra malformada (vazia, curta, com erro de formato) bloquearia as extras seguintes. Além disso, o erro de senha errada é o único que indica chave errada, mas o custo de avançar nos demais é pequeno: `Expired seal` (`iron-crypto.ts:116`) e `Wrong mac prefix` (`:107`) acontecem antes do HMAC, então não custam PBKDF2.
- *Lançar o último erro.* Rejeitada: o erro da `password` é o que hoje chega a quem chama, e manter isso preserva RF-05 ("mesmo tratamento de erro").

**Efeito em RF-05:** sem extras, a lista tem um único item e o código faz exatamente o que faz hoje.

### D-03 — Como `getSession` sabe que deve regravar

**Escolha:** um símbolo interno `kExtraPasswordSeal`, no mesmo modelo de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). `unsealSession` marca o resultado quando a senha que abriu não é a primeira. `getSession` lê, apaga antes de `Object.assign` (`session.ts:208`) e entra no caminho de reselagem (`session.ts:214`).

**Alternativas consideradas:**
- *Comparar a senha usada.* Impossível sem mudar o retorno de `unsealSession`, que é público.
- *Retornar `{ session, passwordIndex }`.* Muda o tipo de retorno de uma função exportada. Quebra quem chama.
- *Símbolo de marcador.* **Escolhida.** É o padrão já usado no arquivo.

**Cuidado:** o símbolo precisa ser removido antes de `Object.assign(session, unsealed)`, senão ele entra no objeto de sessão. O `kLegacySeal` já segue essa ordem (`session.ts:199-201` antes de `:208`).

### D-04 — Selagem sempre com `password`

**Escolha:** nenhuma mudança em `sealSession` (`session.ts:282`) nem em `updateSession` (`session.ts:241`). Ambos já usam `config.password` (`session.ts:300`). O RF-02 vale por construção.

**Alternativa:** passar a selar com a última senha da lista. Rejeitada: o PRD exige que `password` seja a única chave de selagem.

### D-05 — Regravação ao ler (RF-03)

**Escolha:** reaproveitar o caminho existente de reselagem (`session.ts:214`), mantendo a restrição a `sessionFromCookie`. Assim, sessões do header (`sessionHeader`) continuam sem reselagem, como exige o PRD (`sdd/prd.md:135`).

**Alternativa:** não regravar. A sessão continuaria selada com a senha antiga até expirar, e a senha antiga teria que ficar na lista por `maxAge` ou `idleTimeout` inteiro. Rejeitada como padrão porque o objetivo do PRD é que "a rotação se complete sem ação do usuário" (`sdd/prd.md:39`). O PRD marca essa decisão como recusável (`sdd/prd.md:143`); se for recusada, basta não inserir o bloco de reselagem de D-03 e o restante continua válido.

### D-06 — Forma do campo em `SessionConfig`

**Escolha:** `extraUnsealPasswords?: string[]` logo depois de `password` (`src/utils/session.ts:48`). A JSDoc deve explicar: (a) é só para abrir; (b) a senha antiga deve ser removida quando a janela de compatibilidade acabar; (c) sessões seladas com a extra continuam válidas enquanto ela estiver na lista, e isso é um risco operacional se a rotação foi motivada por vazamento; (d) recomendar de uma a três entradas.

**Alternativa:** `password: string | string[]` (alternativa 2 da issue). Fora de escopo (`sdd/prd.md:129`).

### D-07 — Validação de senhas extras

**Escolha:** nenhuma validação nova em `useSession`/`getSession`. A regra de tamanho mínimo continua sendo aplicada pelo iron, de forma preguiçosa (`iron-crypto.ts:191-196`), como já acontece com `password`.

**Motivo:** o erro de `unsealSession` já é engolido em `session.ts:197`. Validar em outro ponto não apareceria para quem usa a lib. Isso é uma limitação conhecida, registrada em R-04.

**Alternativa considerada:** validar eagerly e lançar. Não resolve o silêncio, então fica para uma decisão posterior, se o usuário quiser.

### D-08 — Limite de número de senhas

**Escolha:** nenhum limite no código. A recomendação de uma a três entradas vai na JSDoc (D-06) e em R-01.

**Alternativa:** lançar erro acima de N. Rejeitada: o PRD trata o custo como aceitável para listas pequenas (`sdd/prd.md:144`) e não pede limite obrigatório.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | (1) campo `extraUnsealPasswords` em `SessionConfig`, após `:48`. (2) `getSession`: ler e apagar `kExtraPasswordSeal` junto de `kLegacySeal` (`:199-201`) e incluir no reseal (`:214`). (3) `unsealSession`: loop sobre as candidatas (`:312-348`). (4) helper interno `unsealWithPassword` ao final do arquivo, com o try/catch legado atual (`:323-348`) por senha. |
| `src/utils/internal/session.ts` | novo símbolo `kExtraPasswordSeal` depois de `:9`. |
| `test/session.test.ts` | novo bloco `describe("extra unseal passwords", ...)` dentro do `describeMatrix`, junto de "lazy creation" (`:692`). |
| `test/bench/session.ts` | sem mudança obrigatória. Pode ganhar uma variante com extras para medir custo (ver Testes). |
| `docs` | nenhuma mudança. O PRD limita a documentação à JSDoc (`sdd/prd.md:137`). |

Não alterar: `src/index.ts` (sem export novo), `src/utils/internal/iron-crypto.ts` (nenhuma mudança de selo), `test/unit/package.test.ts` (lista de exports não muda).

**Tamanho do arquivo:** `src/utils/session.ts` já tem 464 linhas, acima do guia de ~200 (`AGENTS.md`, "Short files"). A mudança adiciona cerca de 35 linhas. Não é objetivo deste trabalho dividir o arquivo; registrado em R-08.

---

## Contratos e assinaturas

Propostas, não aplicadas. Os nomes seguem as convenções de `AGENTS.md` (`k` para símbolos, helper interno no fim do arquivo).

### Tipo público

```ts
// src/utils/session.ts, dentro de SessionConfig, logo após `password` (:48)
/**
 * Previous passwords that still open sessions sealed with them. They are only
 * tried when `password` fails, in declared order, and sessions opened this way
 * are resealed with `password` on read. Remove an entry once its sessions
 * should stop working. ...
 */
extraUnsealPasswords?: string[];
```

### Símbolo interno

```ts
// src/utils/internal/session.ts, após :9
export const kExtraPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-password-seal",
);
```

### `unsealSession` (assinatura inalterada)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Corpo (esboço):

```ts
const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
const passwords = [config.password, ...(config.extraUnsealPasswords || []).filter(Boolean)];
let unsealed: Partial<Session> | undefined;
let found = false;
let firstError: unknown;
for (const [index, password] of passwords.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, sealOptions, config);
    found = true;
    if (index > 0) {
      (unsealed as any)[kExtraPasswordSeal] = true;
    }
    break;
  } catch (error) {
    firstError ??= error;
  }
}
if (!found) {
  throw firstError;
}
// maxAge e idleTimeout inalterados (:349-365)
return unsealed!;
```

Observação: `unsealed` pode ser `null` quando `found` é verdadeiro. A checagem de maxAge já existente (`:351`) não lê `unsealed` se `maxAge` não estiver configurado, então o comportamento atual é preservado.

### Helper interno (nova função, no fim de `src/utils/session.ts`)

```ts
/**
 * Unseal with one password, falling back to the legacy 1-iteration seal.
 * Throws the original error when the fallback does not apply.
 */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  config: SessionConfig,
): Promise<Partial<Session>>;
```

Corpo: o try/catch atual de `:323-348`, trocando `config.password` por `password`. Mantém o comentário TODO sobre v3 e a marcação de `kLegacySeal` em `:345-347`.

### `getSession` (trecho de `:199-214`)

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
if (legacySeal) {
  delete (unsealed as any)[kLegacySeal];
}
const extraPasswordSeal = unsealed && (unsealed as any)[kExtraPasswordSeal];
if (extraPasswordSeal) {
  delete (unsealed as any)[kExtraPasswordSeal];
}
// ... Object.assign(session, unsealed) permanece aqui (:208)
if (
  session.id &&
  sessionFromCookie &&
  (legacySeal || extraPasswordSeal || shouldSlide(session, config))
) {
  await updateSession(event, config);
}
```

### Inalterados

- `sealSession(event, config): Promise<string>` (`session.ts:282`), selando com `config.password`.
- `updateSession`, `useSession`, `clearSession`, `getSession`: assinaturas e comportamento externo.
- `src/index.ts:199-212`: lista de exports.

---

## Estratégia de testes

Seguir o Bug Fix Workflow de `AGENTS.md`: escrever os testes antes da implementação e confirmar que os novos falham (exceto os de regressão, que devem passar antes e depois).

**Arquivo:** `test/session.test.ts`, bloco `describe("extra unseal passwords")` dentro do `describeMatrix` (cobre `web` e `node`, RF-11). Usar `seal` de `src/utils/internal/iron-crypto.ts` para criar cookies com P0, como já faz `test/session.test.ts:135-143`.

Constantes: `P1` (atual) e `P0` (anterior), ambas com 48+ caracteres, para passar `minPasswordlength` (`iron-crypto.ts:22`). `P9` para RF-06.

| Teste | RF | Como verificar |
| --- | --- | --- |
| abre sessão selada com extra | RF-01 | cookie com P0; `getSession` com `{password: P1, extraUnsealPasswords: [P0]}` devolve mesmo `id`, `createdAt` e `data`. |
| sela sempre com `password` | RF-02 | `updateSession` com a config nova; cookie resultante abre com P1 e lança `Bad hmac value` com P0 (`unseal` direto). |
| regrava ao ler sessão com extra | RF-03 | resposta tem `Set-Cookie`; o cookie abre com P1 e não com P0. |
| tenta `password` primeiro | RF-04 | comparar `deriveBits` com cookie de P1 usando extras versus sem extras: mesma contagem. Espiar `crypto.subtle.deriveBits` como em `test/session.test.ts:722-735`. Não afirmar "uma única chamada de unseal" (ver nota abaixo). |
| sem extras, comportamento idêntico | RF-05 | cookie com outra senha e config sem extras: sessão nova, sem `data` herdada. Contagem de `deriveBits` igual à medida antes da mudança (calibrar na fase vermelha). |
| senha não listada vira sessão nova | RF-06 | cookie com P9: `id` novo, `data` vazia, sem erro no handler. |
| legado com senha extra | RF-07 | cookie com P0 e 1 iteração; `getSession` carrega dados; regravado com P1. |
| expiração vale para extra | RF-08 | `vi.useFakeTimers({ toFake: ["Date"] })` como em `:189`, `createdAt` além de `maxAge`, cookie com P0: sessão nova. Limpar com `vi.useRealTimers()`. |
| retirar senha invalida | RF-09 | cookie com P0; config sem P0: sessão nova. |
| `unsealSession` direto ordena tentativas | RF-04 | `unsealSession` com `password` P1 e cookie de P1 com extras: sucesso na primeira tentativa (mesma contagem de `deriveBits` do caso sem extras). |
| entrada vazia é ignorada | D-02 | `extraUnsealPasswords: ["", P0]` com cookie de P0 abre a sessão. Teste adicional, não está no PRD. |
| header não é regravado | exclusão do PRD | cookie de P0 enviado por `sessionHeader`: sem `Set-Cookie`, sessão abre. Teste adicional. |
| tipo aceita string[] e omissão | RF-10 | `pnpm typecheck` (`package.json:54`). Opcional: `expectTypeOf` em `test/unit/`, se já houver padrão. |

**Nota sobre RF-05:** o PRD diz "a única tentativa de unseal foi com `password`" (`sdd/prd.md:65`). Com `legacySealFallback` ligado (padrão), uma senha errada já gera duas chamadas a `unseal` (a original e a legada, `session.ts:324,340`). O teste deve afirmar que nenhuma derivação usa outra chave, comparando a contagem de `deriveBits` com a medida antes da mudança, e não o número literal de chamadas. Sugiro ajustar o texto do PRD nesse ponto.

**Suíte existente:** todos os testes atuais de `test/session.test.ts` devem passar sem alteração. Em especial `:134-159` (legado resselado), `:161-186` (`legacySealFallback: false`), `:692-772` (lazy creation) e `:722-735` (contagem de derivações). Nenhum teste existente deve ser enfraquecido.

**Comandos de verificação:**

```bash
pnpm vitest run test/session.test.ts      # RF-01 a RF-11 e regressões, web e node
pnpm vitest run test/unit/package.test.ts # lista de exports sem mudança
pnpm lint                                  # oxlint + oxfmt --check
pnpm typecheck                             # tsc --noEmit (RF-10)
pnpm test                                  # suíte completa com cobertura
pnpm bench:node                            # custo sem extras (sem regressão esperada)
```

**Benchmark de custo com extras:** `test/bench/session.ts` usa só `password`. Para medir R-01, sugiro uma variante temporária (não commitada) com `extraUnsealPasswords` de 1 a 3 entradas e cookie inválido, comparando com o cenário sem extras. Não é necessário adicionar ao repositório.

---

## Riscos

**R-01 — Amplificação de CPU em cookies inválidos.** Cada candidata custa uma derivação de HMAC com 8192 iterações (`iron-crypto.ts:21,27`). Um cookie que não abre com nenhuma chave custa (N + 1) dessas derivações, onde N é o número de extras. O retry legado adiciona (N + 1) derivações de 1 iteração, desprezíveis. Correção ao PRD (`sdd/prd.md:149`): o número "2 × (N + 1)" mistura um custo caro com um barato. Cookies válidos de senha extra custam (k + 1) derivações, onde k é a posição da senha. Mitigação: recomendar até três extras (D-08), documentar na JSDoc e medir com a variante de benchmark.

**R-02 — Sessões comprometidas continuam válidas.** Se a rotação foi motivada por vazamento de `P0`, manter `P0` na lista mantém vivas as sessões que ela selou, até expirarem ou até a senha sair da lista. Não há código que resolva isso, por design (RF-09 e fora de escopo de invalidação em massa). Mitigação: JSDoc (D-06).

**R-03 — Mais `Set-Cookie` em leituras.** A regravação de D-05 faz uma selagem extra na primeira leitura de cada sessão com extra (e de cada legado). Como o reseal já é feito em `GET` para legado, não é um padrão novo. Custo pontual, mas visível para caches e proxies que observam `Set-Cookie`.

**R-04 — Erros silenciosos.** `getSession` engole qualquer erro de `unsealSession` (`session.ts:197`). Uma extra malformada (vazia, curta, ou com caractere inválido) faz as sessões dela caírem como "sessão nova", sem log. Isso já acontece com `password`, mas fica mais provável com listas. Mitigação: testes de D-02 e documentação. Pendência de decisão (ver abaixo): validar extras de forma eager e expor o erro.

**R-05 — Ambiguidade de diagnóstico.** Senha errada, senha removida e sessão expirada viram "sessão nova" nos três casos (`session.ts:197`). Esse é o comportamento atual (`sdd/prd.md:152`) e não muda. Dificulta investigar falhas de rotação.

**R-06 — Regressão em `unsealSession` exportada.** O retorno de sucesso não muda para configs sem extras. Para configs com extras, o retorno ganha o símbolo `kExtraPasswordSeal` em sessões abertas por extra, como já acontece com `kLegacySeal`. Quem compara o objeto com `toEqual` pode ver o símbolo. Mitigação: `getSession` remove o símbolo; testes diretos de `unsealSession` cobrem o caso.

**R-07 — Testes frágeis por contagem de derivação.** A contagem de `deriveBits` depende de detalhes internos do `crypto.subtle` no Node e no runtime `web`. Mitigação: comparar contagens relativas (com e sem extras) em vez de números absolutos. O número absoluto só é calibrado na fase vermelha.

**R-08 — Tamanho de `src/utils/session.ts`.** O arquivo já passa do guia de ~200 linhas (`AGENTS.md`). A mudança adiciona cerca de 35 linhas. Dividir o arquivo é trabalho à parte.

**R-09 — Entrada de `password` duplicada na lista.** Se `P1` aparecer também em `extraUnsealPasswords`, a tentativa extra é redundante e só custa uma derivação a mais em cookies inválidos. Não é um erro de segurança. Opcional: remover duplicatas no mesmo `.filter`.

---

## Pendências de decisão

1. **Regravação ao ler (D-05).** Está no PRD como padrão, mas recusável (`sdd/prd.md:143`). Confirmar antes de implementar.
2. **Validação eager de extras (D-07).** Aceitar o silêncio de R-04 ou lançar erro no primeiro uso.
3. **Texto de RF-05.** Ajustar "única tentativa de unseal" para "nenhuma derivação com outra chave" (ver nota de testes), ou manter e aceitar que o retry legado conta como tentativa com `password`.

Nenhuma dessas pendências bloqueia a implementação. As decisões acima seguem o PRD ou a alternativa mais conservadora, e podem ser trocadas sem reescrever o restante.
