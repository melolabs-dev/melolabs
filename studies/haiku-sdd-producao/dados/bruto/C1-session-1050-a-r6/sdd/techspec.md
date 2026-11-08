# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-a) e `sdd/prd.md` (RF-01 a RF-10). Este documento só define o como; o quê e o porquê estão no PRD.

## Estado atual (confirmado no código)

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`). Sua regra de tamanho mínimo e de entropia está só no JSDoc (`src/utils/session.ts:40-47`).
- A regra de tamanho mínimo existe, mas é aplicada de forma preguiçosa: `generateKey` lança `Password string too short` ao derivar a chave (`src/utils/internal/iron-crypto.ts:191-196`, mínimo vindo de `src/utils/internal/iron-crypto.ts:22`). Não há validação de entropia no código. **Resposta à premissa do PRD:** a validação de tamanho existe, a de entropia não; a lista herda a primeira e não precisa de regra nova além de aplicar esta.
- Selo: `sealSession` usa `config.password` direto (`src/utils/session.ts:300-304`).
- Abertura: `unsealSession` chama `unseal` uma vez com `config.password` (`src/utils/session.ts:324`). Se falhar com `"Bad hmac value"` e `legacySealFallback !== false`, refaz com 1 iteração PBKDF2 (`src/utils/session.ts:325-344`).
- `getSession` engole qualquer erro de `unsealSession` com `.catch(() => {})` (`src/utils/session.ts:197`), tratando a sessão como nova.
- Reselagem: ocorre quando há `kLegacySeal` ou `shouldSlide` e a sessão veio do cookie (`src/utils/session.ts:214-216`). Sessões de header não são reseladas, o que confirma a premissa do PRD.
- `Object.assign` copia símbolos enumeráveis; por isso o marcador interno é removido antes da cópia (`src/utils/session.ts:199-201`).
- `sealSession`, `unsealSession` são exportados (`src/index.ts:208-209`), então a mudança vale também para quem os chama direto.
- Teste de contagem de derivações (`test/session.test.ts:722-735`) exige exatamente 2 `deriveBits` por selo; a mudança não pode adicionar derivações no caminho de selo.

## Decisões de arquitetura

### D-01 — Tipo de `password`: `string | string[]`

**Escolha:** `password: string | string[]` em `src/utils/session.ts:48`, como pede o PRD (RF-01) e o contrato.

**Alternativas:**
- `string | [string, ...string[]]` (tupla não vazia): erra em tempo de compilação para lista vazia. Descartada porque o contrato fixa `string | string[]`, e RF-08 exige erro em tempo de execução de qualquer forma (JS puro e `as any` contornam o tipo).
- `string | readonly string[]`: mais permissivo a `as const`. Descartada para manter a forma pedida; pode ser mudança futura não quebrante.

**Consequência:** o tipo sozinho não garante lista não vazia; a validação é runtime (D-03).

### D-02 — Normalização em um único helper interno

**Escolha:** helper `sessionPasswords(config: Pick<SessionConfig, "password" | "seal">): string[]` em `src/utils/internal/session.ts`. Ele devolve sempre um array e valida (D-03). Todo acesso a `config.password` passa por ele, o que elimina o risco de uso não migrado (ver Riscos).

**Por que `utils/internal/`:** o AGENTS.md manda helpers internos em `utils/internal/` ou no fim do arquivo. `src/utils/session.ts` já tem 465 linhas, acima da meta de 200. Pôr o helper no arquivo de símbolos internos (`src/utils/internal/session.ts`) não aumenta esse arquivo.

**Alternativa descartada:** helper no fim de `src/utils/session.ts`. Funcionaria, mas piora um arquivo já acima da meta.

### D-03 — Validação da lista: explícita, antes de qualquer engolimento de erro

**Escolha:**
- `[]` lança `Error("At least one session password is required")`.
- Cada item precisa ser string não vazia com `length >= minPasswordlength` (`config.seal?.encryption.minPasswordlength ?? sealDefaults.encryption.minPasswordlength`), com a mesma mensagem de `generateKey` (`Password string too short ...`), para que a regra seja a mesma de hoje (RF-08).
- A validação roda no início de `getSession` (antes do bloco com `.catch`), em `sealSession` e em `unsealSession`.

**Por que antes do `.catch`:** sem isso, o erro de lista vazia lançado dentro de `unsealSession` seria engolido por `src/utils/session.ts:197` e a sessão viraria "nova" silenciosamente. O erro só apareceria depois, no primeiro `updateSession`, com mensagem menos clara. RF-08 pede erro na primeira utilização.

**Por que validar tamanho antes de tentar:** sem isso, um item curto no meio da lista lança `too short` só quando é tentado. Esse erro não é `"Bad hmac value"`, então para a iteração (D-05) e cai no `.catch` de `getSession`, que trata como sessão inválida. O sintoma seria "sessões somem", sem causa aparente.

**Alternativa descartada:** validar só `length > 0` e deixar o restante para `generateKey`. Mais simples, mas reproduz o problema acima.

### D-04 — Selar sempre com a primeira senha

**Escolha:** `sealSession` usa `sessionPasswords(config)[0]` em `src/utils/session.ts:300`. Nenhuma outra mudança no caminho de selo.

**Efeito:** RF-02 e RF-05 (resselagem) saem de graça, porque `updateSession` chama `sealSession`. O teste de duas derivações (`test/session.test.ts:722-735`) continua válido.

### D-05 — Abrir tentando cada senha em ordem; o erro de "nenhuma abre" é o último `Bad hmac value`

**Escolha:** o corpo atual do `try/catch` de `unsealSession` (`src/utils/session.ts:324-347`) é movido para uma função interna `unsealWithPassword(sealed, password, sealOptions, config)`, sem mudança de lógica. `unsealSession` faz um laço:

```ts
// src/utils/session.ts — esboço, não é o código final
const passwords = sessionPasswords(config);
let unsealed: Partial<Session> | undefined;
for (const [index, password] of passwords.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, sealOptions, config);
    if (index > 0) (unsealed as any)[kRotated] = true; // ver D-06
    break;
  } catch (error) {
    const isLast = index === passwords.length - 1;
    if (isLast || !(error instanceof Error) || error.message !== "Bad hmac value") {
      throw error;
    }
  }
}
```

**Regras:**
- Só `"Bad hmac value"` faz continuar para a próxima senha. Qualquer outro erro (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `Password string too short`) para o laço. Esses erros não dependem da senha, então tentar as outras seria desperdício.
- Quando nenhuma senha abre, sobe o `Bad hmac value` da última tentativa. Isso preserva a mensagem usada pelo fallback legado e o comportamento atual de sessão inválida (RF-04).
- Expiração (`maxAge`, `idleTimeout`, `src/utils/session.ts:350-365`) continua depois do laço, sobre a sessão já aberta. Um selo válido com senha antiga e expirado lança `Session expired!`, como hoje.

**Por que o fallback legado fica por senha (RF-07):** cada senha passa por "8192 iterações → 1 iteração", exatamente como hoje com uma senha. Alternativa: tentar todas as senhas com iterações atuais e só depois todas com 1 iteração. Número de tentativas igual no pior caso, mas a ordem muda. Escolhi por senha por ser o que o RF-07 descreve e o que o código já faz.

**Custo:** uma sessão inválida custa `2 × N` derivações PBKDF2 (N = tamanho da lista), porque o fallback legado também roda por senha. Ver Riscos.

### D-06 — Resselar sessões abertas com senha antiga, mesmo sem `idleTimeout`

**Escolha:** introduzir o símbolo `kRotated` em `src/utils/internal/session.ts`, ao lado de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). Em `getSession`, marcar a condição de reselagem (`src/utils/session.ts:214`) como `legacySeal || rotated || shouldSlide(session, config)` e remover o marcador antes do `Object.assign` (como em `src/utils/session.ts:199-201`).

**Por que:** sem isso, uma sessão aberta com a senha antiga só migra se houver `idleTimeout`. Sem ele, a senha antiga precisa ficar na lista até a sessão expirar por `maxAge`, o que pode ser indefinido. O objetivo da issue é rotacionar a senha, e o PRD (Riscos, "Senha antiga esquecida") já reconhece esse problema.

**Divergência do PRD a confirmar:** RF-05 descreve a resselagem sob `idleTimeout`, e a premissa do PRD diz que o mecanismo atual é suficiente. Esta decisão amplia isso: a migração acontece também sem `idleTimeout`, uma única vez por sessão. Se preferir o texto literal do PRD, basta não adicionar `rotated` à condição e não criar `kRotated`; o restante da especificação não muda.

**Custo:** um selo a mais por sessão, uma única vez, na primeira leitura após a rotação. Sessões de header continuam sem reselagem (`src/utils/session.ts:214`, `sessionFromCookie`), como diz o PRD.

### D-07 — Não usar o mapa de ids nativo do iron (`PasswordHash`)

**Escolha:** não usar `{ id: senha }` do iron (`src/utils/internal/iron-crypto.ts:87-128`, ramo `PasswordHash`).

**Motivo:** a parte `passwordId` do selo mudaria de vazia para um id. Isso altera o formato do selo, que o PRD proíbe (fora de escopo: "Mudança no formato do selo"). A lista é resolvida no nível de sessão, sem tocar o formato.

### D-08 — Nenhuma exportação nova; só o tipo muda

**Escolha:** `sessionPasswords` e `unsealWithPassword` ficam não exportados por `src/index.ts`. `kRotated` é símbolo interno. `test/unit/package.test.ts` (lista de exports, linhas 28-152) continua igual, o que cobre RF-09.

**Documentação:** atualizar o JSDoc de `password` em `src/utils/session.ts:40-48` com: a primeira senha sela; as demais só abrem; lista não vazia; cada item segue a regra de tamanho; manter a senha nova na primeira posição; e a nota sobre tempo de resposta (ver Riscos). Nada fora do JSDoc, conforme o PRD.

## Arquivos a alterar

| Arquivo | Trecho | Mudança |
|---|---|---|
| `src/utils/session.ts` | `:40-48` | Tipo `password: string \| string[]` e JSDoc |
| `src/utils/session.ts` | `:149-155` | Chamada a `sessionPasswords(config)` antes do bloco com `.catch` (D-03) |
| `src/utils/session.ts` | `:196-216` | `kRotated` na condição de reselagem e remoção do marcador (D-06) |
| `src/utils/session.ts` | `:300` | `seal` com `passwords[0]` (D-04) |
| `src/utils/session.ts` | `:312-348` | Laço em `unsealSession` e corpo movido para `unsealWithPassword` (D-05) |
| `src/utils/session.ts` | fim do arquivo | `unsealWithPassword` (helper interno) |
| `src/utils/internal/session.ts` | `:7-9` | Novo símbolo `kRotated` |
| `src/utils/internal/session.ts` | fim do arquivo | `sessionPasswords` (D-02, D-03) |
| `test/session.test.ts` | `:21-25` | Sem mudança; a config base continua com senha única |
| `test/session.test.ts` | após `:186` | Novo bloco de testes de rotação (ver Estratégia de testes) |
| `test/unit/types.test-d.ts` | seção nova após `:530` | `expectTypeOf` para `SessionConfig["password"]` |

Não alterar: `src/index.ts`, `src/utils/internal/iron-crypto.ts`, docs fora do JSDoc.

## Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /**
   * ... JSDoc atualizado (D-08) ...
   */
  password: string | string[];
  // demais campos inalterados
}

// src/utils/internal/session.ts
export const kRotated: unique symbol = Symbol.for("h3.internal.session.rotated");

/** Senhas para selar (primeira) e abrir (todas), validadas (D-03). Lança Error se a lista estiver vazia ou tiver item inválido. */
export function sessionPasswords(
  config: Pick<SessionConfig, "password" | "seal">,
): string[];

// src/utils/session.ts (não exportado)
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  config: Pick<SessionConfig, "legacySealFallback">,
): Promise<Partial<Session>>;
```

**Assinaturas públicas que não mudam:** `useSession`, `getSession`, `updateSession`, `sealSession(event, config): Promise<string>`, `unsealSession(event, config, sealed): Promise<Partial<Session>>`, `clearSession`.

**Efeitos observáveis:**
- `unsealSession` pode devolver objeto com `kRotated` (símbolo; não aparece em `Object.keys` nem em JSON).
- Erros: lista vazia e item curto lançam `Error` no primeiro uso. Sessão com senha desconhecida continua indo para `Bad hmac value` internamente e para sessão nova em `getSession`.

## Estratégia de testes

Seguir o fluxo do AGENTS.md: escrever os testes primeiro, confirmar que falham, depois implementar, depois rodar a suíte.

Testes em `test/session.test.ts`, dentro de `describeMatrix` (rodam em `web` e `node`), num bloco `describe("password rotation")` após `:186`. Helpers: `seal`, `unseal` e `sealDefaults` já são importados (`test/session.test.ts:15`).

| Teste | Cobre | Como |
|---|---|---|
| Sela só com a primeira senha | RF-02 | `getSession` + `updateSession` com `[NEW, OLD]`; `unseal(cookie, OLD)` rejeita com `Bad hmac value`; `unseal(cookie, NEW)` ok |
| Abre sessão selada com a senha antiga | RF-03 | `seal(data, OLD, sealDefaults)` no cookie; resposta traz os dados |
| Sessão com senha removida vira nova, sem erro | RF-04 | `seal(data, REMOVED)`; `ctx.errors` vazio (auto-asserido no afterEach); `session.id` diferente |
| Resela com a senha atual ao ler sessão antiga, com `idleTimeout` | RF-05 | `idleTimeout` configurado; `unseal(setCookie, NEW)` ok e `unseal(setCookie, OLD)` falha |
| Resela com a senha atual ao ler sessão antiga, sem `idleTimeout` | D-06 | sem `idleTimeout`; cookie com `Set-Cookie` após leitura; `unseal(setCookie, OLD)` falha |
| Não resela quando a senha atual abre | D-06 (regressão) | sessão com `NEW`, sem `idleTimeout`; sem `Set-Cookie` |
| Legado de 1 iteração com a senha antiga | RF-07 | `seal` com `{...sealDefaults, encryption/integrity iterations: 1}` e OLD; abre, resela com NEW |
| Lista vazia lança erro explícito | RF-08 | `await expect(getSession(event, { password: [] })).rejects.toThrow(/at least one/i)` com evento de rota (ou capturar em rota e devolver a mensagem) |
| Item curto na lista lança erro | D-03 | `password: [NEW, "curta"]`; erro de tamanho na primeira utilização |
| Senha única: comportamento inalterado | RF-06 | o conjunto atual de `test/session.test.ts` continua passando sem edição |
| Contagem de derivações no selo | D-04 | o teste existente em `:722-735` continua passando |
| Erro não-HMAC interrompe a lista | D-05 | sessão com `seal` expirado (`ttl` no passado) com senha antiga; não tenta a próxima; erro de expiração (`Expired seal` ou `Session expired!`) |

Tipos em `test/unit/types.test-d.ts` (seção nova, no padrão de `describe` do arquivo): `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()` e checagem de que `{ password: ["nova", "antiga"] }` e `{ password: "unica" }` são atribuíveis a `SessionConfig`.

Regressão: `pnpm vitest run test/session.test.ts`, depois `pnpm vitest run test/unit/`, depois `pnpm test` (lint + typecheck + coverage). `pnpm typecheck` cobre `src` e `test` (`tsconfig.json:25`).

## Riscos

1. **Custo de CPU (DoS barato).** Cada cookie com selo inválido custa `2 × N` derivações PBKDF2 de 8192 iterações (uma por tentativa e uma de fallback legado por senha). Mitigação: documentar que a lista deve ser curta (PRD). Opcional: limite duro no `sessionPasswords` (por exemplo, 5 itens). Não recomendo limite duro agora; registro como decisão para revisar.
2. **Senha antiga esquecida.** Sem D-06, sessões só migram com `idleTimeout`. Com D-06, migram na primeira leitura, mas quem tiver sessões que nunca são lidas mantém a senha antiga até expirar. Documentar.
3. **Sessões de header não migram** (`src/utils/session.ts:214`). Aceito pelo PRD; documentar.
4. **Erro engolido em `getSession`** (`src/utils/session.ts:197`). Itens inválidos na lista viram "sessão vazia" para o usuário. Mitigado por D-03 (validação antes do `.catch`).
5. **Tempo de resposta por posição** da senha que casou. Baixo risco; só documentar no JSDoc.
6. **Uso de `config.password` como string em outro lugar.** Busca feita: o único acesso em `src/` é `src/utils/session.ts:300`, `:324`, `:340`. `src/utils/auth.ts` e `src/types/context.ts:32` são outras senhas. Mitigado por D-02 (todo acesso passa pelo helper); o type-check pega os usos restantes, porque `string | string[]` não é atribuível a `string`.
7. **Custo extra de seleção de senha por requisição.** `sessionPasswords` roda a cada chamada; é um array curto e validação barata. Sem impacto medido necessário.
8. **Reselagem em massa após rotação** (D-06). Cada sessão antiga é resselada uma vez, na primeira leitura. Não é um pico controlado; aceitável para tráfego normal, mas vale mencionar em release notes.
9. **Erro para o chamador de `unsealSession`** (exportado). Mantém o mesmo tipo de erro de hoje (`Bad hmac value` ou erro de validação), então quem captura erros continua funcionando.
