# Especificação técnica — várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato enxuto #1050-a) e `sdd/prd.md` (RF-01 a RF-10). Issue h3js/h3#1050, segunda alternativa.

Todas as citações `arquivo:linha` foram conferidas no código deste clone (branch `master`, commit `fb8821c`).

## Visão geral

`SessionConfig.password` passa a aceitar `string | string[]`. Internamente, a configuração é normalizada em uma lista de senhas. A primeira sela. As demais só são tentadas no unseal, em ordem, e a primeira que verificar o HMAC vence. Uma sessão aberta por uma senha que não é a primeira é marcada e resselada com a primeira senha. Nenhum nome público novo é exportado; `sealSession` e `unsealSession` continuam com a mesma assinatura.

Arquivos a alterar:

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | tipo de `password`, JSDoc, normalização/validação, loop de unseal, reseal de sessão aberta por senha antiga |
| `src/utils/internal/session.ts` | novo símbolo interno `kOlderPassword` |
| `test/session.test.ts` | ajuste de três usos de `sessionConfig.password` em chamadas diretas do iron; novos testes RF-01 a RF-09 |
| `docs/4.examples/handle-session.md` | aviso sobre ordem da lista, remoção de senha e custo |

Não mudam: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/package.test.ts` (a lista de exports continua igual).

---

## Decisões de arquitetura

### D-01 — Tipo público `string | string[]` normalizado para lista interna

**Escolha:** `password: string | string[]`, conforme o PRD. Uma função interna em `src/utils/session.ts` converte qualquer valor para `string[]`: uma string vira `[senha]`, e uma lista é validada e devolvida. Todo o código de selo e unseal trabalha só com a lista.

**Alternativas consideradas:**
- `[string, ...string[]]` (tupla com ao menos um item). Garante lista não vazia no tipo, mas o PRD fixa `string | string[]` e a validação em runtime (RF-07) é necessária de qualquer forma, porque chamadores JS e `as` não passam pelo tipo.
- Nova opção `extraUnsealPasswords` (alternativa 1 da issue). Fora de escopo pelo PRD.
- `password` como `{ id: secret }` (`PasswordHash` do iron). Descartada: o iron então grava o `id` no selo, o que muda o formato do cookie para a lista (RF-05 exige o mesmo formato para senha única); além disso identificadores nomeados estão fora de escopo.

**Justificativa:** mantém a superfície pública mínima, deixa a semântica "primeira sela, demais abrem" em um único lugar e não toca no formato do selo.

### D-02 — Tentativas sequenciais com senha em string; loop em `unsealSession`

**Escolha:** `unsealSession` percorre a lista e chama o `unseal` do iron uma vez por senha, com a string da senha. O bloco atual de tratamento de `"Bad hmac value"` e de fallback legado (`src/utils/session.ts:322-348`) vira o corpo de uma função interna que é aplicada a cada senha (D-05).

**Alternativas consideradas:**
- Passar um `PasswordHash` ao iron e deixar o iron escolher a senha. Exige ids no selo (ver D-01), então é descartada.
- Mudar `unseal` em `src/utils/internal/iron-crypto.ts` para aceitar um array. Espalharia a rotação para um módulo de criptografia que hoje não conhece sessões nem o fallback legado (`iron-crypto.ts:87-91`). Descartada.

**Justificativa:** o iron já ignora o `id` quando a senha é string (`iron-crypto.ts:121-122`), então a tentativa sequencial é exatamente o que o RF-02 pede, sem tocar no formato.

### D-03 — Sinal de reselagem por símbolo interno `kOlderPassword`

**Escolha:** `unsealSession` marca o objeto aberto com `kOlderPassword = true` quando a senha que abriu não é a primeira da lista. `getSession` trata esse sinal como trata `kLegacySeal` hoje: remove o símbolo antes de copiar os dados para a sessão e reselá-la com a primeira senha.

**Alternativas consideradas:**
- Comparar o selo com a primeira senha. Impossível sem tentar o unseal de novo, e o selo não tem `id` para diferenciar.
- Reselar toda sessão lida por cookie. Custa uma derivação PBKDF2 completa por requisição (o próprio código evita isso em `src/utils/session.ts:389-421`, `shouldSlide`). Descartada.
- Devolver o índice da senha em `unsealSession`. Mudaria o contrato público de retorno. Descartada.

**Justificativa:** segue o padrão já usado para `kLegacySeal` (`src/utils/internal/session.ts:7-9`), não altera nenhum tipo público e faz a migração acontecer só quando a sessão é lida por cookie e precisa ser resselada de qualquer forma (RF-04).

### D-04 — Validação da lista nas funções de cookie, não em `useSession`

**Escolha:** a lista é validada no início de `getSession`, `updateSession`, `sealSession` e `unsealSession`. `useSession` não precisa de validação própria porque chama `getSession` (`src/utils/session.ts:115`). A validação só se aplica quando `password` é array; uma string continua passando sem checagem, para manter os erros atuais (RF-05).

Erros:
- lista vazia: `Error("Session password list is empty")`.
- item que não é string não vazia: `Error("Session passwords must be non-empty strings")`.

**Alternativas consideradas:**
- Validar só em `getSession`. Não cobre `sealSession`/`unsealSession`, que são exportados e podem ser chamados diretamente, nem `updateSession` com `cookie: false`.
- Validar também strings vazias. Mudaria o comportamento de `password: ""`, que hoje falha no selo; RF-05 pede os mesmos erros para senha única, então fica de fora.

**Justificativa:** `getSession` engole erros de unseal (`src/utils/session.ts:198`). Sem validação antecipada, `password: []` viraria silenciosamente uma sessão nova, que é exatamente o que RF-07 proíbe. A validação precisa acontecer antes de `context.sessions` ser preenchido (`src/utils/session.ts:158-173`), para não deixar sessão meio inicializada no contexto.

### D-05 — Fallback legado aplicado a cada senha

**Escolha:** para cada senha, na ordem: tenta o unseal com a iteração atual; se der `"Bad hmac value"` e o fallback estiver ativo, tenta com 1 iteração (`src/utils/session.ts:332-344`). Só depois passa para a próxima senha. Erros que não são `"Bad hmac value"` (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `Invalid expiration`) são propagados na hora, porque são verificados antes do HMAC (`src/utils/internal/iron-crypto.ts:106-118`) e não dependem da senha.

**Custo:** para um cookie que nenhuma senha abre, são até `2 × N` derivações PBKDF2 (N senhas, com fallback). Aceito; ver riscos.

**Alternativa considerada:** aplicar o fallback só à primeira senha. Contradiz RF-06.

### D-06 — Erro quando nenhuma senha abre

**Escolha:** `unsealSession` relança o erro da última tentativa (normalmente `"Bad hmac value"`). Com uma senha só, o erro é exatamente o de hoje (RF-05).

**Justificativa:** mantém o contrato de erro de `unsealSession` para quem chama diretamente. `getSession` continua tratando qualquer erro como sessão inexistente (RF-03).

### D-07 — Selo sempre com a primeira senha, sem `id`

**Escolha:** `sealSession` usa `passwords[0]` como senha de `seal`, mantendo as mesmas opções de `sealDefaults` e `config.seal` (`src/utils/session.ts:300-304`). A string é passada direto, então o selo continua sem `id` (`iron-crypto.ts:121`), igual à versão atual.

**Justificativa:** RF-01 e RF-05 pedem selo verificável só com a primeira senha e formato idêntico ao atual com uma senha.

### D-08 — `maxAge` e `idleTimeout` não mudam

**Escolha:** os blocos de expiração de `unsealSession` (`src/utils/session.ts:349-365`) e `sessionExpires` (`src/utils/session.ts:455-464`) não são alterados. Eles operam sobre o payload já aberto, que é o mesmo independentemente da senha (RF-08).

---

## Arquivos a alterar

### `src/utils/session.ts`

- **`src/utils/session.ts:41-48`** — JSDoc e tipo de `password`. Vira `password: string | string[];`. O JSDoc passa a dizer: a primeira senha sela; as demais só abrem; a ordem importa; cada senha precisa de entropia de no mínimo 32 caracteres aleatórios; remover uma senha da lista invalida as sessões seladas com ela; manter a lista curta (2 ou 3) porque cada senha custa uma derivação por requisição com cookie desconhecido.
- **`src/utils/session.ts:149-153`** — início de `getSession`: chamar `sessionPasswords(config)` antes de tocar em `context.sessions`.
- **`src/utils/session.ts:196-220`** — pipeline de unseal de `getSession`. Mudanças:
  - `src/utils/session.ts:199-201`: remover também `kOlderPassword` do objeto aberto, junto de `kLegacySeal`, antes do `Object.assign` da linha 208. Sem isso o símbolo vaza para a sessão.
  - `src/utils/session.ts:214`: a condição de reseal vira `(legacySeal || olderPassword || shouldSlide(session, config))`. Continua restrita a `sessionFromCookie`, então sessões lidas por header não são resseladas (PRD, premissas).
- **`src/utils/session.ts:241-245`** — início de `updateSession`: chamar `sessionPasswords(config)`.
- **`src/utils/session.ts:282-307`** — `sealSession`: chamar `sessionPasswords(config)` no início e usar `passwords[0]` em `seal` (linha 300).
- **`src/utils/session.ts:312-348`** — `unsealSession`: reescrever a obtenção do objeto aberto como o loop da seção "Contratos". Os blocos de `maxAge` e `idleTimeout` (`src/utils/session.ts:349-365`) ficam como estão.
- **`src/utils/session.ts:389-421`** (`shouldSlide`) e **`src/utils/session.ts:423-464`** — sem mudança.

### `src/utils/internal/session.ts`

- **`src/utils/internal/session.ts:7-9`** — adicionar logo após `kLegacySeal`:

  ```ts
  export const kOlderPassword: unique symbol = /* @__PURE__ */ Symbol.for(
    "h3.internal.session.older-password",
  );
  ```

  Mantém o padrão `Symbol.for` de `kLegacySeal`, `kGetSession` e `kSessionNew` (linhas 3, 5, 7).

### `test/session.test.ts`

- **`test/session.test.ts:21-25`** — extrair a senha de teste para uma constante no mesmo bloco, por exemplo `const PASSWORD = "1234567…"`, e usá-la em `sessionConfig.password`. Assim os usos diretos do iron deixam de depender do tipo da propriedade.
- **`test/session.test.ts:137`, `:157`, `:164`** — trocar `sessionConfig.password` por `PASSWORD` nas chamadas diretas a `seal` e `unseal`. Hoje esses três pontos passam o valor para `seal`/`unseal` do iron, cujo parâmetro aceita `RawPassword`/`Password | PasswordHash` (`src/utils/internal/iron-crypto.ts:58-61`, `:87-90`). Com `string | string[]`, `tsc --noEmit` (que inclui `test`, `tsconfig.json` linha `"include": ["src", "test"]`) falha nesses três pontos. A mudança não altera o que os testes verificam.
- **Testes novos** — descritos na seção "Estratégia de testes".

### `docs/4.examples/handle-session.md`

- **`docs/4.examples/handle-session.md:37`** — o aviso sobre entropia continua. Acrescentar: a primeira senha sela, as demais só abrem.
- **Depois de `docs/4.examples/handle-session.md:143`** (parágrafo de opções) — nova subseção "Rotating the password" com um exemplo `password: [NOVA, ANTIGA]`, explicando: ordem; que sessões antigas migram só quando são lidas por cookie; que sessões de header não migram; que remover a senha antiga da lista invalida as sessões seladas com ela; e o custo de N derivações.

---

## Contratos e assinaturas

### Tipo público (sem nomes novos)

```ts
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. ... The first password seals;
   * the rest only open sessions sealed before a rotation. ...
   */
  password: string | string[];
  // demais campos inalterados
}
```

Exports de `src/index.ts:202-212` não mudam. Assinaturas de `sealSession(event, config): Promise<string>` e `unsealSession(_event, config, sealed): Promise<Partial<Session>>` (`src/utils/session.ts:282-285`, `:312-316`) não mudam.

### Internos novos em `src/utils/session.ts`

```ts
/**
 * Normalize `config.password` into the list of passwords to try, in order.
 * The first one seals. Throws for an empty list or a non-string/empty item.
 */
function sessionPasswords(config: Pick<SessionConfig, "password">): string[];

/**
 * Unseal with one password, applying the legacy 1-iteration fallback to it.
 * Throws the same errors `unseal` does for that password.
 */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean,
): Promise<Partial<Session>>;
```

`unsealWithPassword` contém o bloco atual de `try { unseal } catch { legacy }` (`src/utils/session.ts:323-348`), com `legacySealFallback` no lugar de `config.legacySealFallback === false`, e marca `kLegacySeal` como hoje.

### Forma de `unsealSession` (sketch do loop)

```ts
export async function unsealSession(_event, config, sealed) {
  const passwords = sessionPasswords(config);
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  const legacySealFallback = config.legacySealFallback !== false;

  let unsealed: Partial<Session> | undefined;
  let lastError: unknown;
  for (const [index, password] of passwords.entries()) {
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, legacySealFallback);
      if (index > 0) (unsealed as any)[kOlderPassword] = true;
      break;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
      lastError = error;
    }
  }
  if (!unsealed) throw lastError;

  // maxAge e idleTimeout: inalterados (src/utils/session.ts:349-365)
  return unsealed;
}
```

Observações sobre o sketch:
- `sealOptions.integrity.iterations === 1` continua excluindo o fallback (`src/utils/session.ts:334`); a checagem vai para dentro de `unsealWithPassword`.
- `unsealed` pode ser `null` quando o iron devolve `null` (`src/utils/internal/iron-crypto.ts:149`); hoje isso já falha em `unsealed.createdAt` (`src/utils/session.ts:351`). Sem mudança de comportamento.

### Mudança em `getSession`

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const olderPassword = unsealed && (unsealed as any)[kOlderPassword];
if (legacySeal) delete (unsealed as any)[kLegacySeal];
if (olderPassword) delete (unsealed as any)[kOlderPassword];
// ...
if (session.id && sessionFromCookie && (legacySeal || olderPassword || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

---

## Estratégia de testes

Todos os testes novos entram em `describeMatrix` em `test/session.test.ts`, para rodar em `web` e `node` (`test/_setup.ts`). Seguem o fluxo de correção de bug do AGENTS.md: primeiro escrever os testes e confirmar que falham, depois implementar.

Os selos de "versão atual" são gerados com `seal` do iron direto, como já faz `test/session.test.ts:134-139`. Não se usa `sealSession` para gerá-los, porque RF-05 e RF-06 pedem selos da versão atual, não do código novo.

| Teste | Cobre | Como |
| --- | --- | --- |
| selo novo com a primeira senha | RF-01 | `useSession` com `[NOVA, ANTIGA]` e `update`; `unseal(cookie, NOVA)` ok; `unseal(cookie, ANTIGA)` rejeita |
| sessão com senha antiga é aberta com `id` e `data` originais | RF-02 | `seal({id, createdAt, data}, ANTIGA, sealDefaults)` com cookie; `getSession` com `[NOVA, ANTIGA]` |
| senha desconhecida vira sessão nova | RF-03 | `seal(..., DESCONHECIDA)`; `id` diferente e `data` vazio |
| leitura por senha antiga reselá com a nova | RF-04 | cookie com `ANTIGA`, `useSession` ou `update`; `Set-Cookie` abre com `NOVA`, não com `ANTIGA` |
| reselagem por `idleTimeout` com senha antiga | RF-04 | igual ao anterior com `idleTimeout` e `createdAt` ultrapassando metade da janela |
| legacy 1 iteração na segunda posição | RF-06 | `seal` com 1 iteração e `ANTIGA`; `[NOVA, ANTIGA]`; resultado aberto e `Set-Cookie` aberto por `NOVA` com `sealDefaults` |
| lista vazia e itens inválidos | RF-07 | rota com `try/catch` chamando `getSession` com `[]`, `[""]`; mensagem contém "empty"/"non-empty"; usar `try/catch` para não cair no tracking de erros do `describeMatrix` |
| `maxAge` com senha antiga | RF-08 | `seal` com `createdAt` antigo e `ANTIGA`; `id` novo |
| header `x-h3-session` com senha antiga | RF-09 | header com selo de `ANTIGA`; `getSession` devolve `data`; nenhum `Set-Cookie` |
| senha única inalterada | RF-05 | os testes existentes `test/session.test.ts:134-186` continuam passando sem mudança de expectativa; adicionar um caso `password` como string com selo antigo de versão atual e reselagem idêntica |
| tipos e lint | RF-10 | `pnpm typecheck` e `pnpm lint` |

Testes existentes que devem continuar passando sem mudança de expectativa: `unseals and reseals legacy sessions sealed with iterations: 1` (`test/session.test.ts:134`), `rejects legacy sessions with legacySealFallback: false` (`:161`), todos os de `idleTimeout` (`:188-510`), e os de lazy creation (`:692-777`).

Comandos:

```bash
pnpm vitest run test/session.test.ts      # suíte de sessão
pnpm vitest run test/unit/                # unitários (inclui package.test.ts com a lista de exports)
pnpm typecheck                            # tsc --noEmit (inclui test/)
pnpm lint                                 # oxlint + oxfmt --check
pnpm test                                 # suíte completa com cobertura
```

---

## Riscos

1. **Ordem trocada na lista** (PRD). Mitigação: JSDoc e doc deixam claro que `password[0]` sela; os testes RF-01 e RF-04 fixam a ordem.
2. **Custo de CPU** (PRD). Um cookie desconhecido custa até `2 × N` derivações PBKDF2 com fallback legado. Mitigação: documentar a recomendação de 2 a 3 senhas; não há limite imposto em código (a PRD pede lista curta, não limite). Se for desejado, um limite de tamanho pode ser adicionado em `sessionPasswords` como decisão posterior.
3. **Remoção prematura de senha** (PRD). Invalida sessões sem aviso. Mitigação: documentação.
4. **Senha em log ou serialização** (PRD). Não piora com a lista, mas a lista agora tem várias senhas no mesmo objeto. Mitigação: documentação já existente; nenhum código novo loga a config.
5. **Símbolo `kOlderPassword` vazando para a sessão.** Se o símbolo não for removido antes do `Object.assign` (`src/utils/session.ts:208`), ele é copiado para `session`. Não entra no cookie (símbolos não são serializados por `JSON.stringify`), mas fica como propriedade extra do objeto de sessão. Mitigação: remover no mesmo bloco de `kLegacySeal` (D-03) e cobrir com o teste RF-04 verificando o payload do cookie resealado.
6. **Validação depois de `context.sessions` ser preenchido.** Se `getSession` validasse depois da linha 158-173, deixaria uma sessão vazia no contexto. Mitigação: validação no topo (D-04).
7. **Regressão no caminho de unseal** (PRD). Mitigação: selos gerados pela versão atual nos testes RF-05 e RF-06; os testes existentes de legacy (`:134`, `:161`) cobrem o caminho com uma senha.
8. **Migração depende de leitura por cookie.** Clientes que só mandam o header continuam com a senha antiga até a expiração (PRD, premissas). Não há código para isso; está documentado.
9. **Tipagem de testes.** Os três usos diretos do iron (`test/session.test.ts:137`, `:157`, `:164`) quebram o `tsc` com `string | string[]`. Mitigação: constante `PASSWORD` (seção "Arquivos").
10. **Não verifiquei `pnpm typecheck`, `pnpm lint` nem os testes** nesta etapa: o pedido é só a especificação e o código do projeto não foi alterado. As afirmações sobre tipos e lint são leitura do código e da configuração (`tsconfig.json`, `.oxlintrc.json`).
