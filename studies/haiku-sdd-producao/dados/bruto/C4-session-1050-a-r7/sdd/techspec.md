# Especificação técnica — Múltiplas senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-08) e a issue h3js/h3#1050, segunda alternativa.

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `af7f3e2`).

## Visão geral

`SessionConfig.password` passa a aceitar `string | string[]`. Internamente, a configuração é normalizada para uma lista de senhas:

- **selagem** (`sealSession`) usa só a primeira senha;
- **abertura** (`unsealSession`) tenta as senhas em ordem, e a primeira que valida o HMAC vence;
- **regravação**: uma sessão aberta com qualquer senha que não seja a primeira é regravada na leitura, da mesma forma que o caminho legado já faz hoje.

Nenhum nome público novo é criado. O formato do cookie não muda: `iron` continua gravando `id` vazio quando a senha é uma string, e a abertura continua usando a senha de `iron` sem identificador.

Fluxo de leitura (novo):

```
getSession
 ├─ resolvePasswords(config)          → valida a lista (lança fora do catch)
 ├─ unsealSession(...)                → tenta senha[0], senha[1], ...
 │    └─ marca kRotatedSeal se abriu com índice > 0
 └─ se sessionFromCookie && (legacy || rotated || shouldSlide) → updateSession (regrava com senha[0])
```

---

## Decisões de arquitetura

### D-01 — Forma do campo `password`: lista de strings, não objetos com id

**Contexto.** O PRD fixa `string | string[]` e proíbe identificadores por senha (`pedido.md`, "Fora de escopo"; PRD "Fora de escopo"). Ainda assim, `iron` já aceita um objeto `PasswordHash` indexado por id (`src/utils/internal/iron-crypto.ts:87-128`), e isso precisaria de um id no cookie.

**Alternativas consideradas.**

1. `{ id, secret }[]` com busca por id: o cookie passaria a carregar o id da senha. Quebra "o formato do cookie selado não muda" (PRD, Premissas) e é o que o PRD exclui.
2. Novo campo `extraUnsealPasswords`: é a primeira alternativa da issue, descartada pelo PRD.
3. `string | string[]`, lista ordenada: o formato do cookie não muda e o contrato pedido é cumprido.

**Escolha.** Opção 3. A ordem é o único critério. Não é possível passar a lista direto para `iron`: a chave `default` do `PasswordHash` só comporta uma senha, então a iteração fica em `src/utils/session.ts`.

### D-02 — Normalização e validação em um único helper interno

**Contexto.** Hoje não há validação de `password` em `src/utils/session.ts`. A única verificação de senha vazia está dentro de `iron`: `src/utils/internal/iron-crypto.ts:65-67` (seal) e `:94-96` (unseal). A verificação de tamanho mínimo está em `generateKey`, `src/utils/internal/iron-crypto.ts:191-196`, e só acontece quando a senha é usada.

Isso não basta para RF-06. Se `[novaSenha, ""]` for lido, a senha vazia nunca é tentada, porque `novaSenha` abre a sessão antes. Por isso a validação precisa cobrir todos os itens, antes de qualquer tentativa.

**Alternativas consideradas.**

1. Validar só no ponto de uso: não cumpre RF-06 para leituras que abrem na primeira senha.
2. Validar cada item chamando `generateKey`: custa um PBKDF2 por item, a cada requisição.
3. Helper `resolvePasswords(config)` que normaliza para `string[]` e valida todos os itens com a mesma mensagem que `iron` produz hoje, usando uma asserção de tamanho compartilhada com `generateKey`.

**Escolha.** Opção 3. Mensagens:

| Caso | Erro |
| --- | --- |
| lista vazia, `undefined`, ou item não-string | `Session password is missing or invalid` |
| item `""` | `Empty password` (mesma mensagem de `iron` hoje) |
| item abaixo do tamanho mínimo | `Password string too short (min N characters required)` |

O tamanho mínimo vem de `{ ...sealDefaults, ...config.seal }`, como em `src/utils/session.ts:300-304`. Com `defaults` (`iron-crypto.ts:14-30`), o mínimo é 32 nos dois blocos.

Para não duplicar a mensagem de tamanho, extraio de `generateKey` (`iron-crypto.ts:191-196`) uma função interna exportada `assertPasswordLength`. Ela é usada pelos dois lugares. A API pública de `iron-crypto` não muda, porque o módulo é interno (PRD, Fora de escopo).

### D-03 — Tentativa em ordem, por senha, com o fallback legado dentro de cada tentativa

**Contexto.** Hoje `unsealSession` tenta a senha única, e se falhar com `"Bad hmac value"` tenta de novo com 1 iteração (`src/utils/session.ts:324-347`). O PRD (RF-08) pede que o fallback seja aplicado a cada senha, "na mesma ordem".

**Alternativas consideradas.**

1. Todas as senhas em modo normal, depois todas em modo legado.
2. Por senha: normal, depois legado; passa à próxima senha só se as duas falharem.

**Escolha.** Opção 2. É a leitura literal de RF-08, e o custo é o mesmo nos dois casos, porque o legado usa 1 iteração e é barato. Erros que não são `"Bad hmac value"` são propagados imediatamente (PRD, Riscos: detecção por texto). Isso inclui `"Expired seal"` e `"Incorrect number of sealed components"`, que acontecem antes de qualquer senha ser usada.

Se nenhuma senha abrir a sessão, lança-se o último erro `"Bad hmac value"` (RF-04). Isso é a mesma mensagem de senha errada hoje.

### D-04 — Marcar a sessão aberta com senha não primária, no mesmo padrão de `kLegacySeal`

**Contexto.** `unsealSession` é exportada (`src/index.ts:209`) e devolve `Partial<Session>`. Não há como saber, pelo retorno, com qual senha a sessão foi aberta. `getSession` já usa um símbolo interno para sinalizar selagem legada (`src/utils/session.ts:199-201`, `src/utils/internal/session.ts:7-9`).

**Alternativas consideradas.**

1. Mudar a assinatura de `unsealSession` para devolver `{ session, index }`: quebra a API exportada.
2. Chamar `unseal` de novo com a primeira senha só, para descobrir se abre: custa um PBKDF2 a mais por leitura de sessão antiga.
3. Símbolo interno `kRotatedSeal`, marcado em `unsealSession` quando o índice da senha é maior que zero, e lido e apagado em `getSession` antes do `Object.assign`.

**Escolha.** Opção 3. O `Object.assign(session, unsealed)` copiaria o símbolo para a sessão viva (`src/utils/session.ts:208`). Por isso o símbolo deve ser apagado antes da atribuição, exatamente como `kLegacySeal` é apagado em `src/utils/session.ts:200-202`.

### D-05 — Regravar na leitura quando a senha não for a primária (RF-05)

**Contexto.** O PRD pergunta se a regravação segue o caminho de `getSession`. Confirmei: `getSession` regrava a sessão em um só caso, `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`src/utils/session.ts:214-216`). Regravar uma sessão só com a primeira senha é automático, porque `sealSession` sempre usa a primeira (`src/utils/session.ts:300`). Mas sem regravar na leitura, a janela só fecha quando o usuário escreve na sessão.

**Alternativas consideradas.**

1. Não regravar na leitura: RF-05 é cumprida só quando há escrita. A janela pode ficar aberta por muito tempo para quem só lê.
2. Regravar na leitura com `kRotatedSeal` no mesmo `if` do legado.

**Escolha.** Opção 2. É o que o PRD descreve ("a janela de compatibilidade se fecha sozinha conforme os usuários navegam"). O custo é uma regravação por sessão antiga, porque a sessão regravada já abre com a primeira senha. A condição fica:

```ts
if (session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))) {
```

Sessões lidas por header não são regravadas nessa etapa, pela mesma regra que já vale para o deslizamento (`src/utils/session.ts:61-65`). Se o header for usado e a sessão não for escrita, ela continua aberta com a senha antiga até a próxima escrita.

### D-06 — Erros de configuração escapam do `catch` de `getSession`

**Contexto.** `getSession` engole qualquer erro de `unsealSession` com `.catch(() => {})` (`src/utils/session.ts:196-197`). Isso significa que, hoje, uma senha errada na leitura não aparece como erro: a requisição recebe uma sessão nova e vazia. RF-04 diz que o erro "é propagado", mas o comportamento atual de `getSession` é outro. O texto do RF-04 só se sustenta se for lido como "o mesmo erro que `unsealSession` produz", que é `"Bad hmac value"`.

**Decisão.**

- Erro de senha errada continua sendo engolido por `getSession` (comportamento de hoje). `unsealSession` lança `"Bad hmac value"`, e `getSession` devolve sessão nova. Isso cumpre RF-04 no sentido "mesmo erro que hoje".
- Erro de configuração (`resolvePasswords`) é chamado no início de `getSession`, fora do `try`/`catch`, e aparece para quem chama. Isso cumpre RF-06 ("falha de forma explícita").

**Efeito colateral aceito.** Uma configuração inválida passa a falhar também em leituras sem cookie. Hoje, `password: ""` só falha quando há um cookie para abrir. Isso só muda para configurações inválidas, que é o objetivo de RF-06.

### D-07 — Sem limite de tamanho da lista no código

**Contexto.** PRD, Riscos: cada senha extra multiplica o custo de PBKDF2 em cookies mal formados. A mitigação "a avaliar" é limitar a lista ou medir.

**Análise.** O custo cresce com o tamanho da lista, e o tamanho é escolhido pelo operador, não pelo cliente. Um atacante não aumenta N; ele só consegue disparar mais requisições, e cada uma já custa duas derivações hoje (normal e legado). O limite no código seria arbitrário, e o PRD pede que a lista seja simples.

**Escolha.** Sem limite no código. Documentar no JSDoc de `password` que a lista deve ser curta, e que cada item acrescenta até duas derivações PBKDF2 por cookie inválido. Medir o custo na estratégia de testes (seção "Estratégia de testes", item 9).

### D-08 — Documentação: só o JSDoc do campo

**Escolha.** Ajustar o JSDoc de `SessionConfig.password` (`src/utils/session.ts:40-48`), cobrindo: a ordem da lista, a selagem com a primeira, o fato de a senha antiga não ter prazo (decisão operacional), e o custo por item. O PRD exclui documentação extensa; `docs/4.examples/handle-session.md:37` e `:143` ficam como estão.

---

## Arquivos a alterar

| Arquivo | Trecho | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:5` | importar `kRotatedSeal` |
| `src/utils/session.ts` | `:40-48` | tipo `string \| string[]` e JSDoc (D-08) |
| `src/utils/session.ts` | `:149-155` | chamar `resolvePasswords(config)` no início de `getSession` (D-06) |
| `src/utils/session.ts` | `:199-201` | ler e apagar `kRotatedSeal` ao lado de `kLegacySeal` (D-04) |
| `src/utils/session.ts` | `:214-216` | incluir `rotatedSeal` na condição de regravação (D-05) |
| `src/utils/session.ts` | `:300` | `seal(session, passwords[0], ...)` (D-02) |
| `src/utils/session.ts` | `:312-348` | `unsealSession` passa a iterar as senhas (D-03) e marcar `kRotatedSeal` (D-04) |
| `src/utils/session.ts` | fim do arquivo | `resolvePasswords` como função interna (D-02) |
| `src/utils/internal/session.ts` | `:7-9` | novo símbolo `kRotatedSeal` |
| `src/utils/internal/iron-crypto.ts` | `:191-196` | extrair `assertPasswordLength`, usada também por `resolvePasswords` (D-02) |
| `test/session.test.ts` | `:21-25` | extrair `const password = "..."` e usar `sessionConfig = { password, ... }` |
| `test/session.test.ts` | `:137`, `:157`, `:164` | trocar `sessionConfig.password` por `password` nas chamadas diretas a `seal`/`unseal` (não aceitam lista) |
| `test/session-rotation.test.ts` | novo | casos de RF-01 a RF-08 (seção de testes) |

Os trechos de `src/utils/session.ts:312-348` não mudam a assinatura: `sealSession` e `unsealSession` continuam exportadas com os mesmos parâmetros (`src/index.ts:208-209`).

Os três usos em `test/session.test.ts:137`, `:157` e `:164` precisam mudar porque `seal` e `unseal` aceitam só `string` (`src/utils/internal/iron-crypto.ts:58-61` e `:87-91`). Sem essa mudança, `pnpm typecheck` falha. As verificações desses testes não mudam.

---

## Contratos e assinaturas

### Tipo público (`src/utils/session.ts:39`)

```ts
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. ...
   * A list is tried in order when unsealing; the first entry seals.
   */
  password: string | string[];
  // demais campos inalterados
}
```

Nenhum outro campo público muda. `sealSession`, `unsealSession`, `getSession`, `updateSession`, `useSession` e `clearSession` mantêm assinatura.

### Símbolo interno (`src/utils/internal/session.ts`)

```ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.rotated-seal",
);
```

### Helper interno de validação (`src/utils/session.ts`, não exportado)

```ts
/**
 * Normalizes `config.password` to a non-empty list of valid passwords.
 * Throws before any unseal attempt, so invalid entries never go unchecked.
 */
function resolvePasswords(config: SessionConfig): string[];
```

Comportamento:

1. `Array.isArray(config.password)` → usa a lista; senão `[config.password]`.
2. Lista vazia, ou algum item que não seja string → `Error("Session password is missing or invalid")`.
3. Para cada item, na ordem: `""` → `Error("Empty password")`; depois `assertPasswordLength(item, min)`, com `min = Math.max({...sealDefaults, ...config.seal}.encryption.minPasswordlength, ...integrity.minPasswordlength)`.
4. Devolve a lista.

### Helper interno de tamanho (`src/utils/internal/iron-crypto.ts`)

```ts
/** Throws the same error `generateKey` throws for a password below `minLength`. */
export function assertPasswordLength(password: string, minLength: number): void;
```

### `unsealSession` (comportamento, assinatura inalterada)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Pseudocódigo do corpo:

```ts
const passwords = resolvePasswords(config);
const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
const legacyAllowed = config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1;
let unsealed: Partial<Session> | undefined;
let lastError: unknown;

for (const [index, password] of passwords.entries()) {
  try {
    unsealed = (await unseal(sealed, password, sealOptions)) as Partial<Session>;
  } catch (error) {
    if (!isBadHmac(error)) throw error;
    lastError = error;
    if (legacyAllowed) {
      try {
        unsealed = (await unseal(sealed, password, legacyOptions(sealOptions))) as Partial<Session>;
        (unsealed as any)[kLegacySeal] = true;
      } catch (legacyError) {
        if (!isBadHmac(legacyError)) throw legacyError;
        lastError = legacyError;
      }
    }
  }
  if (unsealed) {
    if (index > 0) (unsealed as any)[kRotatedSeal] = true;
    break;
  }
}
if (!unsealed) throw lastError;
// verificações de maxAge e idleTimeout inalteradas (src/utils/session.ts:350-365)
```

Observações sobre o pseudocódigo:

- `isBadHmac(error)` é `error instanceof Error && error.message === "Bad hmac value"`, o mesmo critério de `src/utils/session.ts:335-336`.
- `kLegacySeal` e `kRotatedSeal` são marcados só quando a senha abriu a sessão; se o legado falhar e a próxima senha abrir em modo normal, a marca legada não se aplica.
- A verificação de expiração (`src/utils/session.ts:350-365`) continua depois do laço, como hoje.

### `sealSession` (linha 300)

```ts
const sealed = await seal(session, resolvePasswords(config)[0]!, { ...sealDefaults, ttl, ...config.seal });
```

`resolvePasswords` é chamado aqui também, para que uma lista inválida falhe na selagem com a mesma mensagem.

### `getSession` (linhas 149-216)

Início, antes de `context.sessions`:

```ts
resolvePasswords(config); // throws on invalid configuration; not swallowed by the unseal catch
```

No bloco de leitura do cookie:

```ts
const rotatedSeal = unsealed && (unsealed as any)[kRotatedSeal];
if (rotatedSeal) delete (unsealed as any)[kRotatedSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

---

## Estratégia de testes

Os casos novos vão em `test/session-rotation.test.ts`, com `describeMatrix` (web e node), para manter `test/session.test.ts` (777 linhas) focado. Todos os casos seguem o padrão `ctx.app`/`ctx.fetch` de `AGENTS.md`.

Regra de bug fix (`AGENTS.md`, "Bug Fix Workflow"): escrever os casos antes da implementação e confirmar que os de RF-01 a RF-05 falham antes de mudar o código.

Casos, por requisito:

1. **RF-01** — `useSession` com `password: [nova, antiga]` não lança, e devolve `Set-Cookie`.
2. **RF-02** — selagem com a primeira: `unseal(cookie, nova, sealDefaults)` abre; `unseal(cookie, antiga, sealDefaults)` lança `"Bad hmac value"`. Caso de ordem invertida: `[antiga, nova]` gera cookie que não abre com `nova`; esse teste protege contra inversão da lista.
3. **RF-03** — cookie selado com `antiga`, lido com `[nova, antiga]`: os dados voltam sem erro.
4. **RF-04** — cookie selado com `desconhecida`, lido com `[nova, antiga]`: `getSession` devolve sessão nova (id diferente, dados vazios), e `unsealSession` lança `"Bad hmac value"`.
5. **RF-05** — cookie antigo lido com `[nova, antiga]` gera `Set-Cookie`; o novo cookie abre com `nova` sozinha. Também: sessão antiga lida por header não gera `Set-Cookie` na leitura (D-05).
6. **RF-06** — `[]` lança em `sealSession` e em `getSession` sem cookie; `[nova, ""]` lança `"Empty password"` em selagem e em leitura, mesmo com cookie que abre com `nova`; `[nova, "curta"]` lança a mensagem de tamanho; `password: 42` (JS) lança `"missing or invalid"`.
7. **RF-07** — a suíte existente passa sem mudança de verificação. Caso extra: `password: "x"` e `password: ["x"]` produzem o mesmo resultado de `useSession`.
8. **RF-08** — cookie legado (1 iteração) selado com `antiga`, lido com `[nova, antiga]`: abre, é marcado como legado, e é regravado com `nova`. Também: `legacySealFallback: false` com lista rejeita o cookie legado.
9. **Custo** — teste de regressão de contagem de derivações (modelo de `test/session.test.ts:722-735`): nova sessão com lista de 2 senhas faz exatamente 2 `deriveBits` por selagem. Opcional: `test/bench/session.ts` com cookie inválido e lista de 1 vs 3 senhas, para registrar o custo citado no D-07.
10. **Propagação** — erro `"Expired seal"` com lista não tenta a segunda senha (`unsealSession` lança esse erro, e não `"Bad hmac value"`).

Comandos:

```bash
pnpm vitest run test/session.test.ts test/session-rotation.test.ts
pnpm vitest run test/unit/
pnpm lint        # oxlint + oxfmt --check + typecheck
pnpm typecheck
pnpm test        # suíte completa, com cobertura
```

`test/unit/package.test.ts` confere a lista de exports (`:125`, `:149`). Como nenhum export é adicionado, ele deve continuar passando sem mudança.

---

## Riscos

| # | Risco | Efeito | Mitigação |
| --- | --- | --- | --- |
| R-01 | Lista com ordem trocada | Sessões novas seladas com a senha antiga; sem erro visível | JSDoc; teste de RF-02 com ordem invertida (item 2) |
| R-02 | Custo de CPU cresce com N | Até 2N derivações PBKDF2 por cookie bem formado e inválido | Lista curta documentada (D-07); bench de custo (item 9) |
| R-03 | Regravação extra na leitura | Uma escrita de cookie por sessão antiga; o próximo acesso já abre direto | Custo único por sessão (D-05) |
| R-04 | Símbolo `kRotatedSeal` vaza para a sessão viva | `Object.assign` copia símbolos próprios | Apagar antes da atribuição, como `kLegacySeal` (D-04) |
| R-05 | Configuração inválida passa a falhar em leituras sem cookie | Mudança de comportamento para `password: ""` | Só afeta configuração inválida; coberto por teste (item 6) |
| R-06 | Quem lê `config.password` como string quebra na compilação | Código de terceiros que faz `config.password.length` | `SessionConfig` é tipo de entrada; anotar como mudança compatível no changelog |
| R-07 | Detecção de erro por texto (`"Bad hmac value"`) | Erro de outro tipo cairia no caminho "próxima senha" | `isBadHmac` estrito; só esse erro avança o laço (D-03, item 10) |
| R-08 | Senha antiga sem prazo | Janela de compatibilidade aberta para sempre | Decisão operacional, anotada no JSDoc (D-08) |
| R-09 | `unsealSession` exportada passa a devolver o símbolo `kRotatedSeal` | Consumidores que chamam `unsealSession` direto veem a marca | Mesmo padrão já existente para `kLegacySeal`; símbolo não enumerável por string |
| R-10 | Mensagem de tamanho duplicada | Divergência entre `generateKey` e `resolvePasswords` | Função compartilhada `assertPasswordLength` (D-02) |
| R-11 | Teste de derivações em `test/session.test.ts:722` | Falha se a selagem passar a fazer trabalho extra | Teste de regressão do item 9 cobre o mesmo ponto |

## Pendências

Nenhuma pendência bloqueante. Duas decisões são tomadas aqui e podem ser revertidas se você preferir o contrário:

- **D-05**: regravação na leitura (RF-05). A alternativa é só regravar na escrita, sem código extra.
- **D-07**: sem limite de tamanho da lista no código. A alternativa é um teto fixo, por exemplo 4 senhas.
