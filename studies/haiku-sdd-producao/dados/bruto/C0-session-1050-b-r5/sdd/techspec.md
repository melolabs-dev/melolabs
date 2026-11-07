# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-08). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `390ee4a`).

## 1. Resumo

Adicionar `SessionConfig.extraUnsealPasswords?: string[]`. `unsealSession` tenta `password` primeiro e depois cada senha extra, em ordem. Uma sessão de cookie aberta por senha extra é regravada por `getSession` com `password`. Selagem (`sealSession`/`updateSession`) não muda. Nenhum outro nome público é criado; o único símbolo novo é interno (`src/utils/internal/session.ts`, não exportado em `src/index.ts`).

## 2. Estado atual (conferido)

- `SessionConfig.password: string` — `src/utils/session.ts:39-48`; último campo antes de `crypto`: `legacySealFallback` em `src/utils/session.ts:95`.
- `getSession` carrega header → cookie (`src/utils/session.ts:176-193`), chama `unsealSession(...).catch(() => {})` (`:196-197`), lê e remove o marcador `kLegacySeal` (`:199-202`), e regrava com `updateSession` quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config))` (`:214-216`).
- `sealSession` sela com `config.password` (`src/utils/session.ts:300`); `updateSession` chama `sealSession` (`:267`).
- `unsealSession` (`src/utils/session.ts:312-367`): monta `sealOptions` (`:317-321`), chama `unseal(sealed, config.password, ...)` (`:324`), e no `catch` faz o fallback legado só se o erro for `Bad hmac value` (`:332-339`), reabrindo com 1 iteração e marcando `kLegacySeal` (`:340-347`). Depois valida `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`).
- `unseal` valida expiração do seal e formato antes do HMAC (`src/utils/internal/iron-crypto.ts:98-118`) e só lança `Bad hmac value` na verificação de integridade (`:135-137`); senha vazia lança `Empty password` (`:94-96`).
- Marcadores internos: `kLegacySeal` em `src/utils/internal/session.ts:7-9`. Exports públicos de sessão em `src/index.ts:199-212` (nenhum símbolo interno é exportado).

## 3. Decisões de arquitetura

### D-01 — Onde implementar a tentativa de múltiplas senhas
- **Alternativas:** (a) laço em `getSession`, chamando `unsealSession` uma vez por senha; (b) laço dentro de `unsealSession`; (c) mudar `iron-crypto.unseal` para aceitar lista.
- **Escolha: (b).** `unsealSession` é pública e usada diretamente (RF-01, RF-02 citam-na); colocar o laço nela garante o mesmo comportamento para chamadas diretas e via `getSession`/`useSession`. (a) deixaria `unsealSession` sem suporte. (c) viola o fora de escopo (sem mudanças em `iron-crypto.ts`). A lógica de uma senha (incluindo fallback legado) é extraída para um helper interno de arquivo, no fim de `src/utils/session.ts` (convenção: helpers internos ao final), por exemplo `unsealWithPassword(sealed, password, sealOptions, config)`; ele não é exportado.

### D-02 — Ordem de tentativas e fallback legado
- **Alternativas:** (a) por senha, com fallback legado dentro de cada senha; (b) primeiro todas as senhas com iterações atuais, depois todas com 1 iteração.
- **Escolha: (a)**, como o PRD define. Ordem: `password` (atual → legado), `extra[0]` (atual → legado), `extra[1]`… Mantém o caso sem extras idêntico ao código de hoje (`:324-347` movido sem alterar a lógica) e é simples de testar (RF-06). Custo no pior caso: `(1+N)×2` verificações de HMAC; documentado em D-07.

### D-03 — Que erros disparam a próxima senha
- **Alternativas:** (a) qualquer erro; (b) só `Bad hmac value` da tentativa com `password` (incluindo seu retry legado).
- **Escolha: (b)** para o gatilho. Erros de formato, `Expired seal`, `Wrong mac prefix` etc. são independentes da senha (ocorrem antes do HMAC, `iron-crypto.ts:98-118`) e se repetiriam; tentar extras seria custo inútil (risco de CPU do PRD). O gatilho reaproveita a mesma checagem já usada no fallback legado (`error instanceof Error && error.message === "Bad hmac value"`, hoje em `:335-336`), que vira uma pequena função interna `isBadHmac(error)` reutilizada pelos dois pontos.
  Nas tentativas com senhas extras, qualquer erro apenas passa para a próxima senha (ex.: uma senha extra `""` lança `Empty password` e é pulada). Se todas falharem, **relança-se o erro da tentativa com `password`** (RF-05). Sem extras (ausente, `undefined` ou `[]`) o laço não executa e o erro é exatamente o de hoje (RF-07).

### D-04 — Como sinalizar "aberta com senha extra" para `getSession`
- **Alternativas:** (a) reutilizar `kLegacySeal`; (b) novo símbolo interno; (c) mudar o tipo de retorno de `unsealSession`; (d) `getSession` reabrir a sessão por conta própria para descobrir a senha.
- **Escolha: (b).** Novo `kExtraPasswordSeal` (nome interno, mesmo estilo `Symbol.for("h3.internal.session.extra-password")`) em `src/utils/internal/session.ts` ao lado de `kLegacySeal` (`:7-9`), definido como propriedade simbólica no objeto retornado, como o mecanismo existente (`:346`). (a) mistura semânticas (formato legado vs. senha antiga) e dificulta leitura; (c) quebraria a assinatura pública; (d) duplica custo de PBKDF2. Por ser símbolo, não aparece em `JSON.stringify` nem em `Object.keys`; `getSession` o remove antes de `Object.assign(session, unsealed)` — na prática o `Object.assign` copia símbolos enumeráveis próprios, então a remoção (como já é feita com `kLegacySeal`, `:199-202`) é obrigatória para o marcador não vazar para `session`.

### D-05 — Regravação (RF-04) sem dupla gravação
- **Alternativas:** (a) segundo `updateSession` dedicado; (b) estender a condição existente.
- **Escolha: (b).** A condição em `src/utils/session.ts:214` passa a `session.id && sessionFromCookie && (legacySeal || extraPassword || shouldSlide(session, config))`. Uma única chamada a `updateSession` (`:215`) cobre as três razões, então não há dupla regravação com `idleTimeout` (risco "estado compartilhado" do PRD). Sessões de header têm `sessionFromCookie === false` (`:189-193`) e nunca regravam; sessões abertas por `password` não ganham custo extra. `updateSession` sela com `config.password` (RF-03), de modo que a migração é automática.
  Regravação acontece dentro do `.then` guardado por `kGetSession` (`:219`), logo chamadas concorrentes a `getSession`/`useSession` aguardam a mesma promessa e só regravam uma vez (comportamento já testado em "gets same session back (concurrent)", `test/session.test.ts:99`).

### D-06 — Selagem e validações de tempo
- **Escolha:** `sealSession` (`src/utils/session.ts:300`) não muda: usa só `config.password` (RF-03). As validações `maxAge`/`idleTimeout` (`:350-365`) continuam **depois** do laço, aplicadas ao objeto desselado independentemente da senha (RF-06). `ttl`/`seal` vêm de `sealOptions`, o mesmo para todas as tentativas. Alternativa rejeitada: validar expiração dentro de cada tentativa — sem ganho, e arriscaria divergir por senha.

### D-07 — Validação de entrada e documentação de custo/segurança
- **Alternativas:** validar tamanho mínimo/entropia das extras vs. só documentar.
- **Escolha: só documentar** (fora de escopo no PRD). O TSDoc de `extraUnsealPasswords` e a seção de docs avisam: lista curta (cada senha extra custa um PBKDF2 por cookie inválido), colocar as mais recentes primeiro, remover senhas comprometidas, sessões de header não migram, e as extras exigem a mesma entropia/32 caracteres de `password`.

### D-08 — Superfície pública
- **Escolha:** somente o campo `extraUnsealPasswords` em `SessionConfig`. O helper e o símbolo ficam internos (não entram em `src/index.ts:199-212`). `clearSession` recebe `Partial<SessionConfig>` (`:372`) e não precisa de mudança.

## 4. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-48` / `:95` | Adicionar `extraUnsealPasswords?: string[]` com TSDoc (entre `password` e `maxAge`, ou após `legacySealFallback`; preferir logo após `password` por afinidade) |
| `src/utils/session.ts` | `:5` | Importar `kExtraPasswordSeal` junto de `kLegacySeal` |
| `src/utils/session.ts` | `:199-202` | Ler e remover `kExtraPasswordSeal` do objeto desselado |
| `src/utils/session.ts` | `:214` | Estender a condição de regravação (D-05) |
| `src/utils/session.ts` | `:312-348` | `unsealSession`: laço sobre `[password, ...extras]` com helper; marcar `kExtraPasswordSeal` quando uma extra abre; `:349-366` inalterado |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | Helpers internos `unsealWithPassword` e `isBadHmac` |
| `src/utils/internal/session.ts` | `:7-9` | Novo símbolo `kExtraPasswordSeal` |
| `test/session.test.ts` | após `:186` (testes legados) | Novos testes (seção 6) |
| `docs/4.examples/handle-session.md` | entre `:188` e `:190` | Nova seção `## Password Rotation` (a doc existente tem `## Expiration` em `:151` e `## Use Multiple Sessions` em `:190`; a de utilidades `docs/2.utils/4.security.md` só cita `password` do basic auth, `:21`/`:35`, e não muda) |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `sealSession`, `updateSession`, `clearSession`. Nenhum teste existente deve precisar de alteração (o caminho sem extras é preservado); se algum quebrar, ajustar só o estritamente necessário.

## 5. Contratos e assinaturas

```ts
// src/utils/session.ts — única adição pública
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that may only unseal sessions, never seal them. Tried in
   * order after `password`, to rotate it without signing users out. Same
   * entropy / 32-character requirements as `password`. Keep it short ...
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// assinaturas públicas inalteradas
export function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;

// src/utils/internal/session.ts
export const kExtraPasswordSeal: unique symbol;

// src/utils/session.ts — internos (não exportados)
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  config: SessionConfig,
): Promise<Partial<Session>>; // inclui fallback legado e marca kLegacySeal
function isBadHmac(error: unknown): boolean;
```

Pseudocódigo de `unsealSession`:

```ts
const sealOptions = { ...sealDefaults, ttl: ..., ...config.seal };
let unsealed: Partial<Session>;
try {
  unsealed = await unsealWithPassword(sealed, config.password, sealOptions, config);
} catch (error) {
  // só integridade (após o legado) dispara extras; demais erros relançam
  if (!config.extraUnsealPasswords?.length || !isBadHmac(error)) throw error;
  const opened = await tryExtras(...) // percorre em ordem; erros de extras são ignorados
  if (!opened) throw error;           // erro da tentativa com `password`
  unsealed = opened; unsealed[kExtraPasswordSeal] = true;
}
// validações de maxAge / idleTimeout inalteradas
```

Observação: no caminho sem extras, o erro propagado continua sendo o que `unsealWithPassword` lançaria hoje (o do retry legado, `:340`), preservando RF-07.

## 6. Estratégia de testes

Arquivo: `test/session.test.ts` (`describeMatrix`, linha `15`; reutilizar `sessionConfig` `:21-25`, `seal`/`sealDefaults` importados em `:12`, e o padrão de relógio falso de `:188-190`). Segue o fluxo de bug-fix do AGENTS.md: escrever os testes primeiro, confirmar que falham (`pnpm vitest run test/session.test.ts`), implementar, confirmar que passam. Senhas de teste com ≥32 caracteres (A, B, C distintas), selando com `seal(..., A, sealDefaults)` e enviando como `Cookie: h3-test=...`.

| Teste | Cobre |
| --- | --- |
| cookie selado com A, config `password: B, extra: [A]` → `getSession`/`useSession` devolve `id` e `data` originais | RF-02 |
| mesmo cenário via header `x-h3-test-session` | RF-02 (header) |
| ordem: `extra: [X, A]` abre; e `password` correto não consulta extras (só `password` abre sem `Set-Cookie`) | RF-02, RF-04 |
| `updateSession` com `password: B, extra: [A]` → cookie abre com `{password: B}` e **não** abre com `{password: A}` (`rejects.toThrow`) | RF-03 |
| cookie de A: resposta traz `Set-Cookie` selado com B; selado com B: nenhum `Set-Cookie` | RF-04 |
| header selado com A: sessão aceita e nenhum `Set-Cookie` | RF-04 |
| com `idleTimeout` e janela > metade: um único `Set-Cookie` (`toHaveLength(1)`) | RF-04, risco de dupla regravação |
| cookie com senha C (fora da lista) → `id` novo, `data` `{}` | RF-05 |
| `unsealSession` direto: falha com `Bad hmac value` quando nenhuma abre (erro da tentativa com `password`) | RF-05 |
| sessão de A com `createdAt` além de `maxAge` (relógio falso) e `extra: [A]` → substituída | RF-06 |
| sessão legada (1 iteração) selada com A, `extra: [A]` → aceita e regravada com B no formato atual; com `legacySealFallback: false` → rejeitada | RF-06 |
| `extra` ausente e `extra: []` → mesmo resultado dos testes legados existentes (parametrizar o teste de rejeição de senha errada) | RF-07 |
| `extra: [""]` não derruba a requisição e a senha vazia é pulada | D-03 |

Regressão: `pnpm vitest run test/session.test.ts`, depois `pnpm vitest run` (suíte completa), `pnpm lint` e `pnpm typecheck` (RF-07/RF-08). Cobertura de tipo: o próprio `pnpm typecheck` já compila os testes com `extraUnsealPasswords` (RF-01); opcionalmente adicionar uma asserção `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` em `test/unit/types.test-d.ts` (arquivo existente, verificado por `grep`: hoje só trata `password` do basic auth em `:523-539`).

## 7. Riscos

| Risco | Mitigação |
| --- | --- |
| CPU: cookie forjado custa `(1+N)` unseals (×2 com fallback legado) | Tentar `password` primeiro; extras só após `Bad hmac value`; documentar lista curta (D-03, D-07) |
| Marcador simbólico vazar para `session` via `Object.assign` (`:208`) | Removê-lo antes, como `kLegacySeal` (`:199-202`); teste afirma que a resposta JSON não o contém e `data` é prototype-free |
| Alterar acidentalmente o erro/ordem do caminho sem extras | Mover o código de `:324-347` sem mudar a lógica; testes legados existentes (`test/session.test.ts:134-186`) servem de rede |
| Dupla regravação com `idleTimeout` | Condição única em `:214` (D-05) + teste de `Set-Cookie` único |
| Senha extra comprometida segue válida | TSDoc e docs orientam a remoção (D-07) |
| Sessões de header dependem da extra até expirar | Documentado; sem regravação por design |
| Mensagem `Bad hmac value` é string em `iron-crypto.ts:136` (acoplamento por texto, já existente) | Centralizar em `isBadHmac`; um teste cobre o gatilho, então uma mudança de texto quebra o teste em vez de silenciosamente desligar a rotação |
| Senha extra duplicada ou igual a `password` | Inofensivo (tentativa redundante); não deduplicar para manter o código simples |
