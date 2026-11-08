# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Entradas: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (requisitos RF-01 a RF-09).
Código conferido na branch `master` (commit `de2519f`). Todas as citações `arquivo:linha` foram lidas no código atual.

## 1. Visão geral

Hoje `unsealSession` abre o cookie com uma única senha, `config.password` (`src/utils/session.ts:324`). A mudança:

1. `unsealSession` passa a tentar a lista `[password, ...extraUnsealPasswords]`, na ordem declarada, e para na primeira que abre o cookie.
2. `sealSession` continua usando só `password` (`src/utils/session.ts:300-302`). Nada muda na selagem.
3. Se a sessão abriu com uma senha extra, `unsealSession` marca o payload com um símbolo interno. `getSession` lê essa marca e reselas o cookie, na mesma resposta, com `password`. Essa condição já existe para cookies legados (`src/utils/session.ts:214`), então a migração é uma extensão dela.

O formato do cookie não muda. O iron gera `passwordId` vazio quando a senha é uma string (`src/utils/internal/iron-crypto.ts:68`, `const { id = "" ...}`), e a leitura trata id vazio como `"default"` (`src/utils/internal/iron-crypto.ts:121`). Cookies novos saem idênticos aos atuais.

## 2. Decisões de arquitetura

### D-01 — Loop de tentativas em `session.ts`; `iron-crypto.ts` intocado

**Escolha:** o loop de senhas fica em `unsealSession`, dentro de `src/utils/session.ts`. `src/utils/internal/iron-crypto.ts` não muda (RF-09).

**Alternativas consideradas:**
- **A) Usar a API de senhas com id do iron.** O iron aceita um `PasswordHash` e escolhe a senha pelo `passwordId` gravado no cookie (`src/utils/internal/iron-crypto.ts:89`, `:124-125`). Para isso, `seal` precisaria gravar um id, o que muda o formato do cookie novo e a forma de `password`. Viola o PRD (formato do cookie e `iron-crypto.ts` estão fora de escopo). **Rejeitada.**
- **B) Loop em `session.ts`.** Não exige mudança no iron, mantém o cookie idêntico e deixa as tentativas perto do fallback legado, que já está nesse arquivo. **Escolhida.**

### D-02 — Qualquer erro de uma senha passa para a próxima; o erro da primeira é o que se propaga

**Escolha:** cada tentativa que lança erro (qualquer erro) passa para a próxima senha. Se nenhuma abrir o cookie, `unsealSession` relança o erro da tentativa com `password`, que é a primeira da lista.

**Alternativas consideradas:**
- **A) Continuar só em `"Bad hmac value"`**, como o fallback legado (`src/utils/session.ts:336`). **Rejeitada.** O iron lança outros erros para senhas inválidas, antes de chegar ao HMAC: `Password string too short` para senha com menos de `minPasswordlength` = 32 caracteres (`src/utils/internal/iron-crypto.ts:192-196`) e `Empty password` para string vazia (`src/utils/internal/iron-crypto.ts:172-173`). Com a regra A, uma senha extra curta ou vazia encerraria o loop antes das extras válidas que viessem depois. A sessão cairia sem aviso, o que é o pior tipo de falha numa rotação de segredos.
- **B) Continuar em qualquer erro, propagar o primeiro.** **Escolhida.** Atende RF-04 (o erro propagado é o da tentativa com `password`) e preserva a mensagem `"Bad hmac value"` que o PRD manda manter (PRD, seção Riscos). O custo extra é desprezível: os erros de formato e de expiração do seal (`src/utils/internal/iron-crypto.ts:99-117`) acontecem antes de qualquer derivação PBKDF2.
- **C) `AggregateError` com todos os erros.** **Rejeitada.** Muda a mensagem e o tipo do erro que o PRD quer preservar.

### D-03 — Fallback legado é tentado por senha

**Escolha:** para cada senha, a ordem é: iterações atuais, depois o fallback de 1 iteração (`src/utils/session.ts:340-344`). Só então passa para a próxima senha.

**Alternativas consideradas:**
- **A) Todas as senhas com iterações atuais, depois o legado de todas.** **Rejeitada.** Fica mais complexa e não traz ganho relevante. O legado custa uma derivação de 1 iteração, bem mais barata que as 8192 do padrão (`src/utils/internal/iron-crypto.ts:14-30`). RF-06 também pede o fallback por senha.

### D-04 — Migração por símbolo interno; reselagem só para cookie

**Escolha:**
- `unsealSession` marca o objeto com `kRotatedSeal` quando abriu com uma senha extra (índice > 0).
- `getSession` reselas se `legacySeal || rotatedSeal || shouldSlide(...)`, e somente quando `sessionFromCookie` (`src/utils/session.ts:214`, condição já existente).
- A marca é removida antes do `Object.assign`, do mesmo jeito que `kLegacySeal` (`src/utils/session.ts:199-208`). Assim o símbolo não vaza para `event.context.session`.

**Alternativas consideradas:**
- **A) Reselar dentro de `unsealSession`.** **Rejeitada.** `unsealSession` não tem acesso à resposta, é exportado (`src/index.ts:209`) e não distingue cookie de header.
- **B) Gravar no cookie qual senha foi usada.** **Rejeitada.** Exige mudar o formato do cookie.
- **C) Reusar `kLegacySeal` com o sentido "precisa resselar".** **Rejeitada.** O nome descreve o formato antigo, e misturaria dois motivos diferentes. Um símbolo novo mantém cada nome exato. O símbolo fica em `src/utils/internal/session.ts`, que não é reexportado, então não entra na API pública.

**Premissa do PRD confirmada:** sessões lidas pelo header não são resseladas (`src/utils/session.ts:189-193` marca `sessionFromCookie`, e `:214` só reselas quando é `true`). Continuam válidas até expirar, como hoje.

### D-05 — Expiração (`maxAge`/`idleTimeout`) é verificada uma vez, depois de abrir o cookie

**Escolha:** as checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) ficam depois do loop, aplicadas sobre o payload que abriu.

**Motivo:** o payload é o mesmo, seja qual for a senha que o abriu. Checar dentro de cada tentativa só repetiria trabalho. Uma sessão expirada continua rejeitada com `"Session expired!"`, quer tenha sido aberta pela senha principal ou por uma extra.

### D-06 — Tipo do campo: `extraUnsealPasswords?: string[]`, sem limite de tamanho no código

**Escolha:** campo opcional, `string[]`. `password` continua `string`. Não há limite de quantidade no código. O custo por senha extra é documentado no JSDoc.

**Alternativas consideradas:**
- **A) `password: string | string[]`** (segunda alternativa da issue). **Rejeitada.** Fora de escopo pelo PRD.
- **B) Limite máximo de senhas extras, validado em tempo de execução.** **Rejeitada nesta entrega.** O PRD deixa a mitigação para avaliação. Um limite arbitrário não resolve o custo, que cresce linearmente com a lista, e a remoção de senhas antigas já é decisão operacional. O JSDoc deixa o custo explícito.

### D-07 — Sem tentativas em tempo constante

**Escolha:** o loop para na primeira senha que abre o cookie.

**Alternativa considerada:** sempre tentar todas as senhas, para que o tempo não revele a posição da senha que casou. **Rejeitada.** Custaria `N+1` derivações em toda leitura bem-sucedida, inclusive quando a senha principal é a correta. O risco é baixo (ver seção 6) e fica registrado.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/session.ts` | `SessionConfig` ganha `extraUnsealPasswords` (após `password`, `src/utils/session.ts:48`). `getSession` passa a ler `kRotatedSeal` (`src/utils/session.ts:199-214`). `unsealSession` vira o loop de senhas (`src/utils/session.ts:312-367`). Helper interno `unsealWithPassword` vai no fim do arquivo, conforme a convenção do `AGENTS.md`. |
| `src/utils/internal/session.ts` | Novo símbolo `kRotatedSeal`, ao lado de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). |
| `test/session.test.ts` | Novos casos dentro de `describeMatrix("session", ...)` (`test/session.test.ts:15`). |

**Não alterar:**
- `src/utils/internal/iron-crypto.ts` (RF-09).
- `src/index.ts` (`src/index.ts:201-212`). Nenhum export novo.
- `test/unit/package.test.ts`. A lista de exports é um snapshot (`test/unit/package.test.ts:149`), e um export novo quebraria o teste.

**Nota:** `src/utils/session.ts` já tem 465 linhas, acima da meta de 200 do `AGENTS.md`. Esta mudança adiciona cerca de 30. Não vale dividir o arquivo nesta entrega, porque o diff ficaria maior que a funcionalidade.

## 4. Contratos e assinaturas

### 4.1 `SessionConfig` (público)

```ts
export interface SessionConfig {
  /** ...sem alteração (src/utils/session.ts:40-48) */
  password: string;
  /**
   * Previous passwords that are still accepted to unseal sessions. They are
   * tried in order after `password`, and never used to seal. A session opened
   * with one of them is resealed with `password` on the response that reads it
   * (cookie-based sessions only; header sessions keep their seal until it
   * expires). Each extra password adds one key derivation to every invalid
   * cookie, so keep the list short and remove entries once the sessions sealed
   * with them have expired.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos sem alteração
}
```

O JSDoc fica em inglês, como os demais campos de `SessionConfig`. O PRD pede "mesmo estilo dos demais campos".

### 4.2 Símbolo interno (não público)

```ts
// src/utils/internal/session.ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.rotated-seal",
);
```

### 4.3 `unsealSession` (assinatura inalterada, comportamento novo)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Fluxo do corpo:

```ts
const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
let unsealed: Partial<Session> | undefined;
let opened = false;
let firstError: unknown;
for (const [index, password] of passwords.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback);
    opened = true;
    if (unsealed && index > 0) (unsealed as any)[kRotatedSeal] = true;
    break;
  } catch (error) {
    firstError ??= error;
  }
}
if (!opened) throw firstError;
// maxAge e idleTimeout, sem alteração (src/utils/session.ts:349-365)
return unsealed!;
```

`opened` é uma flag, não um teste de truthiness, para não tratar um payload `null` como falha. O `unseal` pode devolver `null` quando o JSON decifrado é `null`, e isso é um comportamento de hoje que não muda.

### 4.4 Helper interno `unsealWithPassword`

```ts
/** Opens the seal with one password, falling back to the legacy 1-iteration seal. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>> {
  try {
    return (await unseal(sealed, password, sealOptions)) as Partial<Session>;
  } catch (error) {
    // O TODO e o comentário de src/utils/session.ts:326-331 passam para cá, sem alteração de lógica
    if (
      legacySealFallback === false ||
      sealOptions.integrity.iterations === 1 ||
      !(error instanceof Error) ||
      error.message !== "Bad hmac value"
    ) {
      throw error;
    }
    const legacy = (await unseal(sealed, password, {
      ...sealOptions,
      encryption: { ...sealOptions.encryption, iterations: 1 },
      integrity: { ...sealOptions.integrity, iterations: 1 },
    })) as Partial<Session>;
    if (legacy) (legacy as any)[kLegacySeal] = true;
    return legacy;
  }
}
```

O corpo do `catch` é o do `src/utils/session.ts:325-347`, movido sem mudança. Só o escopo das variáveis muda.

### 4.5 `getSession` (trecho alterado)

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
if (legacySeal) {
  delete (unsealed as any)[kLegacySeal];
}
const rotatedSeal = unsealed && (unsealed as any)[kRotatedSeal];
if (rotatedSeal) {
  delete (unsealed as any)[kRotatedSeal];
}
// ...
if (session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

`sealSession` não muda. Ele já usa `config.password` (`src/utils/session.ts:300`), e é isso que garante RF-02.

## 5. Estratégia de testes

### 5.1 Ordem

Seguir o fluxo de correção do `AGENTS.md`, adaptado a uma funcionalidade: escrever primeiro os casos novos e rodá-los contra o `master`. Eles devem falhar, porque a opção ainda é ignorada. Só depois implementar. Assim fica provado que os testes verificam a mudança.

### 5.2 Constantes e helper

- Senhas de teste com pelo menos 32 caracteres. Senhas menores disparam `Password string too short` (`src/utils/internal/iron-crypto.ts:192-196`). Os exemplos `"nova"` e `"antiga"` do PRD precisam ser alongados nos testes (ex.: `"nova-" + "x".repeat(43)`).
- Helper dentro do bloco: `sealWith(password, data, iterations?)`, usando `seal` já importado (`test/session.test.ts:12`). Com `iterations: 1` ele produz o cookie legado, como em `test/session.test.ts:134-143`.

### 5.3 Casos (todos dentro de `describeMatrix`, então rodam em `web` e `node`)

| Caso | RF | Verificação |
| --- | --- | --- |
| Config com `extraUnsealPasswords` compila e roda | RF-01 | `useSession` aceita a config; `pnpm typecheck` passa. |
| Lista vazia ou ausente se comporta como hoje | RF-05 | Mesmo resultado do cookie atual; a suíte existente passa sem alteração de asserção. |
| Selagem usa só `password` | RF-02 | Cookie criado com `password: nova` abre com `nova` e não abre com `antiga` (`unseal` lança). |
| Senha principal abre sem tentar extras | RF-03 | Cookie com `nova` abre; opcionalmente contar chamadas a `crypto.subtle.deriveBits` (ver 5.4). |
| Senha extra abre | RF-03 | Cookie com `antiga` retorna os dados originais em `session.data`. |
| Ordem das extras | RF-03 | `["errada-…", "antiga-…"]` abre o cookie com `antiga`. |
| Nenhuma senha abre | RF-04 | Cookie com `outra`: `id` ausente ou novo, `data` vazio, `ctx.errors` vazio (a asserção automática de `test/_setup.ts:152-157` cobre isso). |
| Erro propagado é o da senha principal | RF-04 | `unsealSession` direto, cookie com `outra`: rejeita com `"Bad hmac value"`. |
| Fallback legado por senha extra | RF-06 | Cookie `iterations: 1` com `antiga`: abre e recebe `kLegacySeal`. Reproduz `test/session.test.ts:134-159` com senha extra. |
| Migração | RF-07 | Cookie com `antiga` gera exatamente um `Set-Cookie`, que abre com `nova`. |
| Sessão lida pelo header não é resselada | Premissa do PRD | Header com `antiga`: dados retornados, nenhum `Set-Cookie`. |
| Senha curta não bloqueia as seguintes | D-02 | `["curta", "antiga-…"]` abre o cookie com `antiga`. Teste de regressão para a escolha do critério de parada. |
| Senha extra não ignora expiração | D-05 | Cookie `antiga` com `maxAge` vencido: sessão vazia. |
| Senha repetida | Premissa do PRD | `["nova-…"]` com cookie `nova` continua funcionando. |

### 5.4 Contagem de derivações (opcional)

Para RF-03 ("as tentativas seguintes não são feitas"), dá para espionar `crypto.subtle.deriveBits` e contar chamadas. Cada tentativa que falha deriva uma chave de integridade. Uma tentativa que abre deriva duas (integridade e decifragem). O número exato deve ser medido na implementação, e a asserção deve usar o número medido, não uma conta de cabeça. Se a espionagem ficar frágil entre `web` e `node`, cai-se para a asserção de resultado.

### 5.5 Comandos

```bash
pnpm vitest run test/session.test.ts      # novos casos e suíte existente
pnpm vitest run test/unit/package.test.ts # snapshot de exports, deve continuar igual
pnpm lint                                 # oxlint + oxfmt --check
pnpm typecheck                            # tsc --noEmit
pnpm test                                 # suíte completa com cobertura, antes de concluir
```

## 6. Riscos

- **Custo de CPU sob ataque (PRD, Riscos).** Cada cookie inválido custa `1 + N` derivações PBKDF2 de 8192 iterações, uma por senha (N = número de extras). O fallback legado acrescenta `1 + N` derivações de 1 iteração, que são baratas. Isso não cria custo novo por requisição válida: uma sessão aberta pela principal continua custando uma abertura. Mitigação: sem limite no código (D-06), e custo documentado no JSDoc. Medir com o `N` real antes de liberar.
- **Vazamento por tempo (PRD, Riscos).** O tempo de resposta cresce com a posição da senha que casou. Como a tentativa exige um cookie já emitido, o impacto é baixo. Não há mitigação nesta entrega (D-07).
- **Falha silenciosa por senha extra inválida.** Uma senha extra curta ou vazia é ignorada sem aviso (D-02). A sessão de quem ainda usa essa senha cai, e nada no log aponta a causa. Mitigação possível em uma etapa seguinte: validar as extras na criação de `useSession`. Fica fora desta entrega, porque o PRD não pede.
- **Erro de digitação na senha nova ou nas extras.** A reselagem usa `password`. Se `password` mudar por engano, todas as sessões ativas caem. Isso já é verdade hoje e não muda.
- **Opções de seal iguais para todas as senhas.** `config.seal` vale para todas as tentativas. Não é possível rotacionar algoritmo ou iterações por senha. Fora do escopo do PRD.
- **Símbolo vazando para o usuário.** `unsealSession` é exportado (`src/index.ts:209`). Um chamador direto vê `kRotatedSeal` no objeto retornado, como já acontece com `kLegacySeal`. Não é um efeito colateral novo, e o símbolo é interno.
- **Migração gera um `Set-Cookie` extra por sessão antiga.** É o efeito esperado de RF-07. O custo é uma reselagem por sessão, feita uma vez.
- **Senha antiga esquecida (PRD, Riscos).** A lista de extras só cresce se ninguém limpar. Decisão operacional, fora do código.
