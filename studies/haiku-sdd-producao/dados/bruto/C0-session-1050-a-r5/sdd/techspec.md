# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` e `sdd/prd.md`. Todas as mudanças ficam em `src/utils/session.ts`, nos testes e na documentação. `iron-crypto` não muda (fora de escopo no PRD §3).

## 1. Estado atual (conferido no código)

- `SessionConfig.password: string` — `src/utils/session.ts:48`.
- `sealSession` sela com `config.password` — `src/utils/session.ts:300`.
- `unsealSession` (`src/utils/session.ts:312-367`):
  - tenta `unseal(sealed, config.password, sealOptions)` — `:324`;
  - se falhar com `Bad hmac value` e o legado estiver habilitado, repete com 1 iteração PBKDF2 — `:332-344`, marcando `kLegacySeal` — `:346`;
  - só depois da abertura verifica `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`).
- `getSession` chama `unsealSession` e engole o erro com `.catch(() => {})` — `src/utils/session.ts:196-197`. Uma sessão sem `id` é substituída por uma nova — `:225-229`. A promessa fica em `context.sessions[name][kGetSession]` — `:219`, e é removida em `:209`.
- `unseal` do `iron-crypto` — `src/utils/internal/iron-crypto.ts:87-150`:
  - `Expired seal` (`:115-117`) e `Incorrect number of sealed components` (`:99-101`) são lançados **antes** de qualquer derivação de chave;
  - senha errada só aparece como `Bad hmac value` (`:135-137`);
  - senha curta lança `Password string too short…` em `generateKey` (`:191-195`), com `minPasswordlength` 32 vindo de `defaults` (`:22`, `:28`);
  - `Empty password` — `:94-96` e `:172-174`.
- `RawPassword` (`:429`) não aceita `string[]`. Por isso o `seal`/`unseal` interno não muda: recebe sempre uma `string`.
- Exports públicos: `SessionConfig`, `sealSession`, `unsealSession` em `src/index.ts:203-209`. A lista de nomes exportados é verificada em `test/unit/package.test.ts:125,149`.

## 2. Decisões de arquitetura

### D-01 — Tipo de `SessionConfig.password`
- **Alternativas:**
  (a) `string | string[]`;
  (b) `string | [string, ...string[]]` (não vazia no tipo);
  (c) `string | readonly string[]`.
- **Escolha: (a).** O contrato (`pedido.md`) fixa `string | string[]`. A forma (b) rejeitaria na compilação um `string[]` vindo de `env.split(",")`, que é o caso mais comum de rotação. A forma (c) também aceitaria `as const`, mas foge do contrato textual. A não-vacuidade é garantida em runtime (D-03) e documentada no JSDoc. O PRD pede a expressão no tipo só "quando possível"; aqui o custo de ergonomia não compensa.
- Mudança de superfície pública: apenas este tipo (RF-08).

### D-02 — Onde a lista é resolvida: helper interno, sem tocar `iron-crypto`
- **Alternativas:**
  (a) passar a lista ao `unseal`/`seal` do `iron-crypto`;
  (b) helper interno em `src/utils/session.ts` (final do arquivo, conforme AGENTS.md "helpers internos no fim") que normaliza e valida, e `seal`/`unseal` continuam recebendo uma `string`;
  (c) novo arquivo `utils/internal/…`.
- **Escolha: (b).** (a) altera algoritmos/contratos de `iron-crypto`, vetado no PRD §3. (c) não se justifica, pois são poucas linhas e o arquivo atual tem ~465 linhas, já acima da meta de 200 (a meta é "aim", não bloqueia). Se o autor preferir, o helper pode ir para `src/utils/internal/session.ts`, que já existe e hospeda constantes de sessão. Essa troca não altera nenhuma decisão.
- Assinatura (não exportada):
  ```ts
  function resolvePasswords(config: SessionConfig, options: SealOptions): string[]
  ```
  Devolve `[config.password]` quando for `string`, ou a própria lista. Antes disso valida (D-03).

### D-03 — Validação da lista (RF-06): antecipada e para todas as senhas
- **Alternativas:**
  (a) validar apenas quando uma senha for usada (erro "lazy" de `generateKey`);
  (b) validar a lista inteira antes de selar/abrir.
- **Escolha: (b).** Com (a), uma lista `["boa…", "curta"]` abriria cookies da primeira senha e nunca reportaria a curta. Isso aceitaria a configuração "em silêncio", contra RF-06. Com (b) o erro é determinístico e independe do cookie.
- Regras, em `resolvePasswords`:
  - lista vazia → `throw new Error("Empty password")` (mesma mensagem de `iron-crypto:66/95`);
  - senha com `length < minPasswordlength` → `throw new Error(\`Password string too short (min ${n} characters required)\`)`, mesma mensagem de `iron-crypto:193-195`. `n` é o maior entre `options.encryption.minPasswordlength` e `options.integrity.minPasswordlength`, para respeitar overrides de `config.seal`;
  - elemento que não é `string` ou é vazio → `Empty password`.
- Tipo de erro: `Error` simples, como hoje. Em `sealSession` o erro propaga. Em `getSession` o `.catch(() => {})` (`:197`) o engole e cria sessão nova, como já ocorre hoje com senha curta no cookie. Isso é aceitável porque o PRD pede "o mesmo tipo de erro que hoje uma senha inválida produz". `unsealSession`/`sealSession` chamadas diretamente lançam.
- Uma `string` única segue pelo caminho existente: a validação de `string` continua delegada a `generateKey` (mensagem idêntica, comportamento idêntico, RF-02). O helper só valida comprimento quando recebe lista, para não duplicar a regra no caso antigo. Lista de um elemento recebe a mesma validação que uma lista maior, com a mesma mensagem que a `string` produziria.

### D-04 — Selagem usa só a primeira senha (RF-03)
- `sealSession` passa a chamar `seal(session, resolvePasswords(config, opts)[0], opts)` — troca em `src/utils/session.ts:300`.
- As `opts` (`{...sealDefaults, ttl, ...config.seal}`) são hoje montadas inline em `:300-304`; devem ser extraídas para uma constante local antes da chamada, para a validação usar as mesmas opções.
- Como `updateSession` (`:267`) e o reseal de `getSession` (`:214-216`, via `updateSession`) passam por `sealSession`, criação, atualização e reseal ficam cobertos sem mudança neles.

### D-05 — Abertura: tentar em ordem, parar na primeira que abrir (RF-04, RF-07)
- **Alternativas:**
  (a) `Promise.any` em paralelo;
  (b) sequencial, em ordem, parando na primeira que abrir;
  (c) extrair o `passwordId` do cookie para escolher a senha.
- **Escolha: (b).** (a) multiplica o custo de PBKDF2 (risco de CPU no PRD §4) e torna a ordem não determinística. (c) exigiria mudar o formato do cookie (vetado).
- Algoritmo em `unsealSession`, substituindo `:322-348`:
  1. `passwords = resolvePasswords(config, sealOptions)`.
  2. Para cada senha, em ordem, chamar `unsealWith(sealed, password, config, sealOptions)`: o bloco atual try/legado, reaproveitado como função interna que devolve `unsealed` ou lança.
  3. Se lançar `Error` com `message === "Bad hmac value"`, guardar o erro e seguir para a próxima senha.
  4. Qualquer outro erro (`Expired seal`, `Incorrect number of sealed components`, `Wrong mac prefix`, `Invalid expiration`, falha de decrypt/JSON) é relançado de imediato, sem tentar as demais senhas. Esses erros não dependem da senha (os três primeiros são lançados antes da derivação de chave). Retentar só desperdiçaria PBKDF2 e poderia mascarar corrupção como "senha errada".
  5. Esgotada a lista, lançar o último `Bad hmac value`.
  6. Só depois de obter `unsealed` rodar uma única vez as verificações de `maxAge` e `idleTimeout` (código atual de `:349-365`, intacto, fora do laço). Assim um cookie expirado selado com qualquer senha é rejeitado igualmente (RF-07), e a expiração não é confundida com senha errada nem reaceita por outra senha (PRD §4, "Erros mascarados").
- Fallback legado (RF-07): fica **dentro** de `unsealWith`, por senha. Ordem de tentativa para cada senha: iterações atuais, depois 1 iteração (se `legacySealFallback !== false` e `iterations !== 1`). O custo extra do legado é 1 iteração, desprezível. Um cookie legado selado com a senha secundária é aberto com `kLegacySeal` marcado e é regravado por `getSession` (`:199-201`, `:214`) com a **primeira** senha. Esse reseal já existe e não é o "reseal de rotação" excluído no PRD §3. É apenas o reseal legado atual e ocorre com a senha primária por causa de D-04.
- Sem reseal automático ao ler com senha antiga não primária (PRD §3): não há código novo em `getSession`. A sessão só migra por escrita, `idleTimeout` ou legado.
- Efeito colateral aceito: com lista, um cookie inválido faz `N` derivações PBKDF2 de iterações atuais (mais `N` de 1 iteração se o legado estiver ativo). Mitigação: documentar lista curta (D-07).

### D-06 — Cache `context.sessions` (PRD §4)
- Nenhuma mudança em `getSession`. O laço de tentativas vive inteiro dentro de `unsealSession`. A promessa em `context.sessions[name][kGetSession]` (`:219`) só resolve com o resultado final, ou rejeita (engolida em `:197`). Nenhum resultado parcial de senha errada é visível ou retido. Isso será verificado por teste (§4, T-08).

### D-07 — Documentação
- JSDoc de `SessionConfig.password` (`src/utils/session.ts:40-48`): formato lista, primeira sela, todas abrem, lista não vazia, cada senha ≥ 32 caracteres, manter curta (custo de CPU), transitória (janela de exposição), responsável por retirar senhas antigas.
- `docs/4.examples/handle-session.md`: nova subseção "Rotating the password" depois do aviso de entropia (`:36-43`) ou após "Initialize a Session". Exemplo com `[process.env.SESSION_PASSWORD_NEW, process.env.SESSION_PASSWORD_OLD]`.
- `docs/2.utils/4.security.md`: seção "Session" é gerada por `automd:jsdocs` (`:44-74`) e lista só funções, sem a interface. Não há edição manual; `pnpm fmt` regenera se necessário.

## 3. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-48` | Tipo e JSDoc de `password` (D-01, D-07) |
| `src/utils/session.ts` | `:293-307` | `sealSession`: extrair `opts`, selar com `resolvePasswords(...)[0]` (D-04) |
| `src/utils/session.ts` | `:312-367` | `unsealSession`: laço de senhas + `unsealWith`, expiração fora do laço (D-05) |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | Helpers internos `resolvePasswords` e `unsealWith` (D-02, D-03, D-05) |
| `test/session.test.ts` | `:21-24`, `:137`, `:157`, `:164` | Ajuste de tipo (ver §4) e novos testes |
| `test/unit/types.test-d.ts` | fim | Teste de tipo para `SessionConfig["password"]` (opcional, RF-01) |
| `docs/4.examples/handle-session.md` | `:36-45` | Seção de rotação (D-07) |

Sem alteração: `src/index.ts` (nenhum nome novo, RF-08; `test/unit/package.test.ts:125,149` continua válido), `iron-crypto.ts`, `src/types/context.ts:32` (`password` ali é de `requireBasicAuth`, não de sessão), `test/bench/session.ts:10` (usa `string`).

## 4. Contratos e assinaturas

```ts
export interface SessionConfig {
  /** … primeira sela; todas abrem … */
  password: string | string[];
  // demais campos inalterados
}

// Assinaturas públicas inalteradas:
export function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;

// Internas (não exportadas):
function resolvePasswords(config: SessionConfig, options: SealOptions): string[];
function unsealWith(sealed: string, password: string, config: SessionConfig, options: SealOptions): Promise<Partial<Session>>;
```

Comportamento observável:

| Entrada | Resultado |
| --- | --- |
| `password: "x…"` | Idêntico ao atual |
| `["a…"]` | Idêntico a `"a…"` |
| `["nova…","antiga…"]`, sela | Só `"nova…"` abre o cookie |
| Cookie de `"antiga…"` | Abre; mesmo `id` e `data`; sem sessão nova |
| Cookie de senha fora da lista | `getSession` devolve sessão nova (`id` novo, `data` vazio) |
| `[]` ou senha curta na lista | `sealSession`/`unsealSession` lançam; `getSession` cria sessão nova (erro engolido em `:197`) |
| Expirado, selado com senha secundária | Rejeitado como se fosse a primária |

## 5. Estratégia de testes

Ajuste dos testes existentes (sem perder o que verificam):
- `test/session.test.ts:137`, `:157`, `:164` passam `sessionConfig.password` ao `seal`/`unseal` do `iron-crypto`, que só aceitam `RawPassword`. Com o novo tipo isso não compila. Extrair `const password = "1234567123456712345671234567123456712345671234567"` (`:23`) no topo do `describeMatrix`, usar `password` em `sessionConfig` e nessas três chamadas. Os demais usos de `sessionConfig.password` (`:195` em diante) vão para `SessionConfig`, onde o tipo largo é aceito, e ficam como estão.
- Rodar `pnpm typecheck` para achar outros usos de `config.password` como `string` (a busca no repositório só encontrou os acima em `src`).

Novos testes em `test/session.test.ts` (no `describeMatrix`, mesmo estilo; relógio com `vi.useFakeTimers({ toFake: ["Date"] })` como nos testes de `idleTimeout`). Constantes `OLD`, `NEW`, `OTHER` com ≥ 32 caracteres:

- T-01 (RF-02) `["senha"]` lê sessão criada com `"senha"`; mesmos `id` e `data`.
- T-02 (RF-03) Com `[NEW, OLD]` criar e atualizar sessão. Abrir o cookie com `unseal(…, NEW, sealDefaults)` funciona; com `OLD` lança `Bad hmac value`.
- T-03 (RF-04) Cookie selado com `OLD` e `password: [NEW, OLD]`: `getSession` devolve o mesmo `id`/`data` e `generateId` não é chamado.
- T-04 (RF-04) Senha na 3ª posição abre; primeira e segunda falham antes.
- T-05 (RF-05) Cookie selado com `OTHER`, lista `[NEW, OLD]`: `id` diferente, `data` vazio.
- T-06 (RF-06) `password: []` e `["boa…", "curta"]` (a curta como segundo elemento, para provar a validação antecipada): `sealSession` e `unsealSession` rejeitam (`Empty password` / `Password string too short`). `getSession` devolve sessão nova.
- T-07 (RF-07) Expiração com senha secundária:
  - `maxAge`: cookie selado com `OLD` e `createdAt` antigo é rejeitado com `[NEW, OLD]` e aceito dentro do prazo;
  - `idleTimeout`: idem;
  - legado (1 iteração) selado com `OLD`: aberto com `[NEW, OLD]` e regravado, e o novo cookie só abre com `NEW`.
- T-08 (PRD §4, cache) Chamadas concorrentes de `getSession`/`useSession` com cookie de `OLD`: todas as respostas coincidem (mesmo `id`, mesmos `data`).
- T-09 Expiração não é reaceita por outra senha: cookie expirado selado com `NEW` e lista `[NEW, OLD]` é rejeitado e `unseal` com `OLD` não é tentado. Verificar espiando `unseal` ou observando que o erro é `Session expired!`.
- T-10 (RF-01, tipo) em `test/unit/types.test-d.ts`: `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`.

Execução: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck`, e por fim `pnpm test`. Seguir o fluxo do AGENTS.md: escrever T-02..T-07 e confirmar que falham antes da implementação.

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Custo de CPU: cookie inválido percorre `N` senhas (+ legado) | DoS amplificado por cookies forjados | Parar na primeira que abrir; erros não relacionados à senha não retentam (D-05.4); documentar lista curta |
| Mascarar erros: `Bad hmac value` também ocorre com cookie adulterado | Diagnóstico mais difícil | Só `Bad hmac value` avança; expiração checada uma vez após o unseal (D-05.6) |
| Lista com senha curta só falhava quando usada | Configuração aceita em silêncio | Validação antecipada de todas (D-03), teste T-06 |
| Consumidores leem `config.password` como `string` | Quebra de compilação | Busca no repositório (nenhum uso fora de `session.ts`); `pnpm typecheck`; mudança é só alargamento do tipo na escrita, mas estreita a leitura por terceiros. Registrar nas notas da versão |
| `string[]` vazio passa no tipo | Erro só em runtime | Validação D-03 + JSDoc; alternativa tipada rejeitada em D-01 |
| Janela de exposição de senhas antigas | Segredo vazado continua válido | JSDoc e docs afirmam que a lista é transitória |
| Reseal só pela senha primária no legado | Sessão legada de senha antiga migra de uma vez | Comportamento desejado (RF-03); coberto por T-07 |
| Alterar mensagem de erro de `Empty password`/senha curta | Consumidores que casam por texto | Reutilizar o texto exato de `iron-crypto` (D-03) |
| `session.ts` já excede 200 linhas | Convenção de arquivos curtos | Helpers pequenos; opção de mover para `internal/session.ts` (D-02) |
