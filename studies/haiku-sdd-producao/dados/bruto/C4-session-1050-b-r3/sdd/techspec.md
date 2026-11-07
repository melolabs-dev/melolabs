# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (requisitos RF-01 a RF-08), issue h3js/h3#1050.

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `5d88fc4`).

## Visão geral

Hoje `unsealSession` (`src/utils/session.ts:312`) abre o selo com uma única senha, `config.password`, e qualquer falha de HMAC vira "Bad hmac value". A mudança acrescenta `SessionConfig.extraUnsealPasswords?: string[]`, que só é usada para **abrir** selos, em ordem, depois de `password`. Selagem (`sealSession`, `src/utils/session.ts:282`) continua usando somente `password`. Não há mudança no formato do token (iron), nem novo export público.

Fluxo resultante na leitura de um cookie:

1. `getSession` valida `extraUnsealPasswords` (falha alta se inválido) — D-03.
2. `unsealSession` tenta `password`, depois cada extra. Só continua para a próxima senha se o erro for "Bad hmac value" — D-01.
3. Cada tentativa mantém o fallback de selo legado atual — D-02.
4. Depois da abertura, `maxAge` e `idleTimeout` são aplicados ao resultado, sem nova tentativa — D-05.
5. Se a sessão abriu com uma senha extra, `getSession` a resela com `password`, como já faz com sessões legadas — D-04.

---

### D-01 — Ordem de tentativa e critério de continuação

**Decisão:** em `unsealSession`, percorrer `[config.password, ...extraUnsealPasswords]` em ordem sequencial. Continuar para a próxima senha **apenas** quando o erro for exatamente `"Bad hmac value"`. Qualquer outro erro (`"Expired seal"`, `"Wrong mac prefix"`, `"Incorrect number of sealed components"`, `"Invalid expiration"`, `"Empty password"`, `"Password string too short..."`) é relançado imediatamente. Se a última senha também falhar, relança o último erro, que é `"Bad hmac value"`.

**Por quê:**
- O HMAC é a única resposta de "senha errada" que o iron dá. Os demais erros não dependem da senha: `Expired seal` é checado em `iron-crypto.ts:116`, antes da seleção de senha (`iron-crypto.ts:120-130`), então tentar as outras senhas seria só custo de PBKDF2 sem chance de sucesso.
- Erros de validação de extras (vazia, curta) precisam aparecer e não serem engolidos pelo laço (RF-05).
- Com uma senha só, o laço executa uma vez e o comportamento é o atual.

**Alternativas consideradas:**
- *`try/catch` genérico em cada senha:* mais simples, mas tentaria N derivações para um selo expirado e mascararia erros de validação de extras.
- *Usar o formato de hash de senhas do iron (`PasswordHash`, com `id`):* o iron suporta IDs de senha (`iron-crypto.ts:89`, `:124-128`). Exigiria IDs no token e mudança no formato, o que está fora do contrato ("Nenhum outro nome público novo", "Mudanças no formato do selo" fora de escopo).
- *Pré-derivar as chaves no `useSession`:* cache de chaves é otimização que o PRD não pede; acrescenta estado.

**Consequência:** para um token inválido, o custo é `1 + N` derivações PBKDF2 (ver riscos).

---

### D-02 — Fallback de selo legado por senha

**Decisão:** mover o bloco `try/catch` atual de `unsealSession` (`src/utils/session.ts:323-348`) para uma função interna `unsealWithPassword(sealed, password, sealOptions, allowLegacy)`. Ela faz exatamente o que o bloco faz hoje, aplicado a **uma** senha: tenta o selo com as iterações atuais; se der "Bad hmac value" e o fallback estiver ativo, tenta com 1 iteração e marca `kLegacySeal`. O laço de D-01 chama essa função para cada senha. Assim o fallback vale para extras (RF-06) sem lógica nova.

**Por quê:** mantém a semântica por senha ("uma sessão legada selada com B abre como se fosse com A"). Não há ganho em fazer duas passadas (todas as senhas com iterações atuais, depois todas com 1).

**Alternativas consideradas:**
- *Duas passadas (todas as senhas com iterações atuais, depois todas com 1):* uma sessão legada selada com C seria aberta só depois de falhar com A, B e D nas iterações atuais, e a ordem de RF-03 deixaria de valer para elas. Além disso, dobra o número de derivações em caso de falha. Não há ganho que compense.
- *Fallback só para `password`:* contraria RF-06.

**Regra de manutenção:** `allowLegacy` vale `config.legacySealFallback !== false`, e a condição `sealOptions.integrity.iterations === 1` (`src/utils/session.ts:334`) continua na função.

---

### D-03 — Validação das extras: eager e antes do `try` de `getSession`

**Decisão:**
- Validar cada item de `extraUnsealPasswords` **antes** de qualquer tentativa, com as mesmas regras de `password` no iron: string vazia lança `"Empty password"` e string menor que `minPasswordlength` lança `"Password string too short (min N characters required)"` (`iron-crypto.ts:172-174` e `:191-196`). O mínimo é `(config.seal ?? sealDefaults).integrity.minPasswordlength`, o mesmo valor que o iron usa para `password` (o `seal` substitui `integrity` por inteiro, então o mínimo vem daí).
- A validação roda **no início de `getSession`**, antes de `context.sessions` ser criado (`src/utils/session.ts:158`), porque o `.catch(() => {})` de `src/utils/session.ts:197` engoliria qualquer erro vindo de `unsealSession`. Também roda no início de `unsealSession` (para chamadas diretas da API pública).
- Para não duplicar as mensagens, extrair de `generateKey` uma função interna `assertPassword(password, minLength)` em `src/utils/internal/iron-crypto.ts` e fazer `generateKey` chamá-la. Comportamento idêntico.

**Por quê:**
- RF-05 exige que a validação não seja pulada silenciosamente. Com validação preguiçosa (só quando a senha é alcançada), `extraUnsealPasswords = ["", "B"]` com a sessão selada com `A` nunca acusaria o erro. A validação eager cobre isso.
- Uma configuração inválida que não lança fica invisível: todo usuário com cookie apareceria anônimo, sem sinal. Lançar em `getSession` faz a requisição falhar, que é o sinal que se quer.

**Alternativas consideradas:**
- *Validar só dentro de `unsealSession`:* o `.catch` de `getSession` transforma o erro em sessão nova. Descartado.
- *Validação preguiçosa:* não atende RF-05 (ver acima).
- *Duplicar as duas checagens em `session.ts`:* sem tocar em `iron-crypto.ts`, mas duas cópias das mensagens que podem divergir. A função compartilhada é a escolha, com a ressalva de que mexe em um arquivo de selo (ver "Pendências").

**Trade-off a registrar:** um valor inválido em `extraUnsealPasswords` derruba todas as requisições com sessão (500) em vez de deslogar silenciosamente. É o comportamento desejado, mas deve estar no JSDoc.

---

### D-04 — Reselar sessões abertas com senha extra

**Decisão:** quando a sessão é aberta por uma senha extra, `getSession` a resela com `password`, pela mesma condição de sessões legadas (`src/utils/session.ts:214`), acrescentando a nova sinalização. A sinalização é um símbolo interno `kExtraPasswordSeal` em `src/utils/internal/session.ts`, marcado em `unsealSession` quando o índice da senha é maior que zero e removido em `getSession` antes de `Object.assign`, do mesmo jeito que `kLegacySeal` (`src/utils/session.ts:199-201`).

**Por quê:**
- É a única forma de a rotação terminar: sem reselagem, uma sessão ativa continua selada com a senha antiga até expirar, e o usuário da biblioteca não consegue remover a senha antiga com segurança antes do TTL. Ver o risco "Janela de comprometimento" no PRD.
- O PRD diz "Reselar em massa ... fora do fluxo normal de leitura/escrita" está fora de escopo. Reselar na leitura **é** o fluxo normal, e RF-02 já diz que a reselagem usa `password`.
- Aplica-se só a sessões de cookie (`sessionFromCookie`), pela mesma razão do código atual: a sessão de header não tem como receber `Set-Cookie`.

**Alternativas consideradas:**
- *Não resselar:* mais simples, sem custo extra na leitura. Rotação só completa quando as sessões expiram ou são escritas. Descartado pela razão acima.
- *Resselar sempre que houver extras configuradas:* custo de uma selagem por requisição. Descartado.

**Custo:** uma derivação PBKDF2 extra e um `Set-Cookie` extra por sessão, uma única vez por sessão após a rotação.

**Não-alteração:** `sealSession` (`src/utils/session.ts:282-307`) continua usando `config.password` sem mudança. RF-02 é satisfeito por construção.

---

### D-05 — Expiração aplicada depois da abertura, sem nova tentativa

**Decisão:** as verificações de `maxAge` (`src/utils/session.ts:350-355`) e `idleTimeout` (`src/utils/session.ts:359-365`) ficam **depois** do laço, aplicadas ao objeto que foi aberto. Uma sessão aberta por uma extra e expirada lança `"Session expired!"` e não volta a tentar senhas.

**Por quê:** RF-07. Como o HMAC já validou a sessão, a expiração é uma propriedade dela, não da senha. Colocar as checagens dentro do laço faria a expiração depender da ordem das senhas.

---

### D-06 — Tipo público e documentação

**Decisão:** em `SessionConfig` (`src/utils/session.ts:39`), adicionar após `password` (`src/utils/session.ts:48`):

```ts
/**
 * Previous passwords that can still open sessions sealed with them. They are
 * tried in order after `password` and are never used to seal: every new seal
 * (writes, reseals, legacy reseals) uses `password`.
 *
 * Each extra password costs one more PBKDF2 derivation per request that cannot
 * be opened by `password`, so keep the list short. Remove a password only after
 * every session sealed with it has expired (`maxAge` / `idleTimeout`); until
 * then it keeps those sessions valid.
 *
 * An invalid entry (empty or shorter than the seal's `minPasswordlength`) throws
 * on every session read, so a bad value fails loudly instead of signing users out.
 */
extraUnsealPasswords?: string[];
```

Nenhum export novo em `src/index.ts:200-212` nem em `src/utils/session.ts`. `unsealSession` mantém a assinatura `(_event, config, sealed): Promise<Partial<Session>>`. O símbolo `kExtraPasswordSeal` é interno (não exportado em `src/index.ts`).

**Documentação a atualizar:**
- `docs/4.examples/handle-session.md`: subseção em "Expiration" (`:156-180`) ou após a nota sobre `password` (`:37`), explicando rotação com `extraUnsealPasswords` e a regra de remoção pelo TTL.
- `docs/2.utils/4.security.md:60-62`: nenhuma mudança de assinatura; opcional, uma frase sobre as senhas extras.

---

### D-07 — Ajuste de testes existentes

**Decisão:** nenhum teste existente precisa mudar. O laço com uma senha tem o mesmo resultado do código atual, e os testes de legado (`test/session.test.ts:134` e `:161`) continuam valendo. Se algum ajuste for necessário durante a implementação, deve manter o que o teste verifica (`pedido.md`, restrições).

---

## Contratos e assinaturas

### Públicos

```ts
// src/utils/session.ts — SessionConfig
password: string;                 // inalterado: sela e é tentada primeiro
extraUnsealPasswords?: string[];  // novo: só abre, na ordem declarada

// src/utils/session.ts — assinaturas exportadas, inalteradas
export async function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export async function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;
export async function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
```

### Internos

```ts
// src/utils/internal/iron-crypto.ts (novo export interno, usado também por generateKey)
export function assertPassword(password: string, minLength: number): void;
// lança "Empty password" se !password.length
// lança `Password string too short (min ${minLength} characters required)` se password.length < minLength

// src/utils/internal/session.ts (novo símbolo interno)
export const kExtraPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.extra-password");

// src/utils/session.ts (funções não exportadas)
function assertExtraPasswords(config: SessionConfig): void;
// usa (config.seal ?? sealDefaults).integrity.minPasswordlength
// chama assertPassword para cada item de config.extraUnsealPasswords ?? []

function isBadHmac(error: unknown): boolean;
// error instanceof Error && error.message === "Bad hmac value"

async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  allowLegacy: boolean,
): Promise<Partial<Session>>;
// corpo atual de src/utils/session.ts:323-348, com `password` no lugar de config.password
// e `allowLegacy` no lugar de `config.legacySealFallback !== false`
```

### Esboço de `unsealSession`

```ts
export async function unsealSession(_event, config, sealed) {
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  assertExtraPasswords(config);
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let unsealed: Partial<Session> | undefined;
  for (const [index, password] of passwords.entries()) {
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback !== false);
      if (index > 0) (unsealed as any)[kExtraPasswordSeal] = true;
      break;
    } catch (error) {
      if (!isBadHmac(error) || index === passwords.length - 1) throw error;
    }
  }
  // maxAge e idleTimeout inalterados (src/utils/session.ts:349-366), aplicados a `unsealed`
  return unsealed!; // o laço garante atribuição antes do break; ver nota de tipo abaixo
}
```

Nota de tipo: o TypeScript não prova a atribuição após o laço. A implementação deve escolher uma forma que passe em `tsc --noEmit` sem `!` solto (por exemplo, retornar de dentro do laço e lançar após ele).

### Esboço de `getSession` (trechos alterados)

- No início, antes de `context.sessions` (`src/utils/session.ts:158`): `assertExtraPasswords(config);`
- Em `src/utils/session.ts:199-201`: ler e apagar também `kExtraPasswordSeal`.
- Em `src/utils/session.ts:214`: `if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config)))`.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | `SessionConfig` ganha `extraUnsealPasswords` (`:48`, JSDoc de D-06). `getSession` valida (`:158`), trata o novo símbolo (`:199-201`) e amplia a condição de reselagem (`:214`). `unsealSession` (`:312-367`) vira laço sobre `unsealWithPassword`. Novas funções internas no fim do arquivo, conforme AGENTS.md. |
| `src/utils/internal/iron-crypto.ts` | Extrair `assertPassword` de `generateKey` (`:172-174`, `:191-196`) e reutilizá-la. Único ponto fora do fluxo de sessão (ver Pendências). |
| `src/utils/internal/session.ts` | Novo símbolo `kExtraPasswordSeal`, ao lado de `kLegacySeal` (`:7-9`). |
| `test/session.test.ts` | Novo `describe` com os testes de "Estratégia de testes", após o bloco `lazy creation` (`:692`), ou antes do fim do `describeMatrix`. |
| `test/session-unseal-order.test.ts` (novo) | Teste de ordem com `vi.mock` de `iron-crypto.ts` (ver testes). Arquivo separado porque o mock vale para o módulo inteiro. Confirmar que `vitest.config.mjs` inclui `test/*.test.ts`. |
| `test/unit/types.test-d.ts` | Verificação de tipo de `extraUnsealPasswords` (opcional). |
| `docs/4.examples/handle-session.md` | Subseção de rotação (D-06). |

Não alterar: `src/index.ts` (sem novos exports; `test/unit/package.test.ts:149` lista exports e deve continuar passando), `sealSession`, `shouldSlide`, `sessionExpires`, `stageSessionErrCookies`.

---

## Estratégia de testes

Seguir o fluxo de correção de bug do AGENTS.md: escrever os testes, confirmar que os novos falham no código atual, implementar, confirmar que passam, depois rodar a suíte completa.

Usar `describeMatrix` (web e node) em `test/session.test.ts`. Para gerar cookies com outra senha, usar `seal` com `sealDefaults`, como o teste de legado (`test/session.test.ts:134-160`). Para chamar `unsealSession` diretamente, criar uma rota que a chame e devolva a mensagem de erro.

| Teste | Requisito | Verificação |
| --- | --- | --- |
| Abre sessão selada com a extra | RF-01 | cookie selado com `"B"`, config `password: "A"`, `extraUnsealPasswords: ["B"]` → `session.data` retornado. |
| Reselagem com `password` | RF-02, D-04 | depois da leitura, o `Set-Cookie` abre com `"A"` e não abre com `"B"` (`unseal` direto). |
| Sessão de header não é resselada | D-04 | sessão enviada por `x-h3-test-session` com a extra → abre, sem `Set-Cookie`. |
| Erro igual ao de hoje | RF-03 | cookie selado com `"Z"`: resposta idêntica à de uma config sem extras; `unsealSession` lança `"Bad hmac value"` em ambos os casos. |
| Ordem de tentativa | RF-03, D-01 | teste de `test/session-unseal-order.test.ts`: `extraUnsealPasswords: ["B","C","D"]`, selo com `"C"`; a spy de `unseal` recebe `A, B, C` nessa ordem e não recebe `D`. |
| Erro não-HMAC para o laço | D-01 | selo com `Expired seal` (ttl negativo ou `timestampSkewSec` ajustado) → spy de `unseal` chamado uma vez só. |
| Extra vazia | RF-05, D-03 | `extraUnsealPasswords: [""]`, sessão válida com `password`: `unsealSession` lança `"Empty password"`; `getSession` lança (não vira sessão nova). |
| Extra curta | RF-05, D-03 | `extraUnsealPasswords: ["curta"]` → lança `"Password string too short (min 32 characters required)"`. |
| Sem extras é idêntico | RF-04 | `extraUnsealPasswords` ausente e `[]` produzem o mesmo resultado; a suíte atual passa sem alteração. |
| Legado com extra | RF-06 | selo legado (1 iteração) com `"B"` e `legacySealFallback` ausente → abre, marcado como legado e resselado com `"A"`. |
| Legado com extra e fallback desligado | RF-06 | mesmo cenário com `legacySealFallback: false` → rejeitado. |
| Expiração com extra | RF-07, D-05 | `maxAge: 60`, selo com `"B"` criado há 120 s → `unsealSession` lança `"Session expired!"`. |
| Tipo | RF-08 | `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` em `test/unit/types.test-d.ts`. |
| Exports | RF-08 | `pnpm vitest run test/unit/package.test.ts` passa sem alteração. |

Comandos de verificação ao final:

```bash
pnpm vitest run test/session.test.ts test/session-unseal-order.test.ts test/unit/package.test.ts
pnpm vitest run test/iron-crypto.test.ts test/unit/iron-crypto.test.ts   # se assertPassword for extraída
pnpm lint        # oxlint + oxfmt --check + typecheck (conforme AGENTS.md)
pnpm test        # suíte completa com cobertura
```

Obs.: `pnpm typecheck` é o script `tsc --noEmit` (`package.json:54`); `pnpm lint` do AGENTS.md não inclui typecheck pelo script atual (`package.json:46`), então rodar os dois.

---

## Riscos

| Risco | Severidade | Mitigação |
| --- | --- | --- |
| **Custo de CPU.** Cada senha tentada é uma derivação PBKDF2 (padrão 8192 iterações, `iron-crypto.ts:14-31`). Token inválido custa `1 + N`. | Média | JSDoc (D-06); D-01 para o laço não tentar em erros não-HMAC; lista curta documentada. |
| **Janela de comprometimento.** Senha antiga na lista mantém válidas as sessões seladas com ela até expirarem. | Média | D-04 faz as sessões ativas migrarem na leitura; JSDoc pede remover só após o TTL. |
| **Erro engolido por `getSession`.** `.catch(() => {})` (`src/utils/session.ts:197`) transforma erro de unseal em sessão nova. Validação fora do `try` evita isso para extras, mas erros de unseal continuam silenciosos como hoje. | Baixa | Comportamento atual preservado. |
| **Vazamento por tempo.** Ordem e tempo de resposta podem indicar qual senha abriu a sessão. | Baixa | Erro idêntico para todas as falhas (RF-03). Tempo fora do contrato (PRD). |
| **Reselagem muda o cookie.** Requisições paralelas com o cookie antigo continuam sendo abertas pela extra. | Baixa | Sem erro, só troca de valor (PRD). |
| **Erro de configuração derruba tudo.** Extra inválida faz toda requisição com sessão falhar. | Média | Intencional (D-03). Coberto por teste; documentado no JSDoc. |
| **Mudança em arquivo de selo.** `assertPassword` mexe em `iron-crypto.ts`, fora do fluxo de sessão. | Baixa | Refatoração sem mudança de comportamento; `iron-crypto.test.ts` cobre `generateKey`. |
| **Ordem e tipagem do laço.** Atribuição dentro de `try` e `break` pode não passar no `tsc`. | Baixa | Forma de retorno explícita (ver nota de tipo). |

---

## Pendências para confirmação

1. **D-04 (reselar na leitura).** A escolha altera o caminho de leitura de sessões abertas por extra (uma selagem e um `Set-Cookie` extra, uma vez por sessão). Confirmar que isso é desejado; a alternativa é não resselar, e então a rotação só termina por expiração ou escrita.
2. **D-03 (`assertPassword` em `iron-crypto.ts`).** Confirmar que a extração é aceitável dentro do escopo, ou preferir a duplicação das duas checagens em `session.ts`.
3. **D-03 (erro alto).** Confirmar que uma extra inválida deve falhar cada requisição com sessão, em vez de só deslogar.
