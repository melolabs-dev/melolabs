# Especificação técnica — várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-09). Todas as referências `caminho:linha` foram conferidas no código em `master` (commit `00165ec`).

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Na leitura, `unsealSession` tenta `password` e depois cada extra, na ordem. Abrir com uma extra marca a sessão para regravação selada com `password`, feita pelo caminho de reselagem que já existe em `getSession`. Nada muda no formato do cookie, nem na selagem, nem nos nomes públicos além do campo novo.

Estado atual que a mudança toca:

- `password` é usado em três pontos: selagem (`src/utils/session.ts:300`) e duas chamadas de `unseal` (`src/utils/session.ts:324`, `src/utils/session.ts:340`).
- Uma única tentativa de `unseal` com fallback legado (`src/utils/session.ts:322-348`).
- Erros de leitura são engolidos por `.catch(() => {})` em `getSession` (`src/utils/session.ts:196-198`), por isso uma sessão que não abre vira sessão vazia (RF-06).

---

## Decisões de arquitetura

### D-01 — Onde fica o laço de tentativas

**Escolha:** o laço de tentativas fica em `unsealSession` (`src/utils/session.ts:312`). Um helper interno novo, `unsealWithPassword`, encapsula a tentativa atual com o fallback legado de hoje. `unseal` em `src/utils/internal/iron-crypto.ts:87` não muda.

**Alternativas consideradas:**

1. **Suporte nativo do iron (`PasswordHash` com `passwordId`).** `unseal` já aceita um mapa `id → senha` (`src/utils/internal/iron-crypto.ts:121-127`). Descartada porque exige que `sealSession` passe a gravar um `id` no cookie. Isso muda o formato do cookie, que o PRD proíbe (fora de escopo), e obrigaria a manter o mapeamento de ids entre versões.
2. **Laço dentro de `iron-crypto.ts`.** Descartada: o módulo é uma cópia de iron-webcrypto e não conhece a política de sessão (fallback legado, expiração do H3). Misturar as duas coisas espalha a regra em dois arquivos.

**Justificativa:** `unsealSession` já concentra a política de leitura (fallback legado, expiração). Colocar o laço ali mantém a regra em um lugar e não toca o módulo copiado.

### D-02 — Critério de avanço entre senhas e erro final

**Escolha:**

- Para cada senha, `unsealWithPassword` roda com as duas tentativas de hoje (iterações atuais, depois legado de 1 iteração, se `legacySealFallback !== false`). Assim o RF-07 vale para as extras sem regra nova.
- O laço só avança para a próxima senha quando o erro é exatamente `"Bad hmac value"`, a assinatura de senha errada (`src/utils/internal/iron-crypto.ts:135-137`). Qualquer outro erro (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `Invalid expiration`) é relançado na hora.
- Se nenhuma senha abre, relança o **primeiro** erro, que é o da senha principal. Assim o caso sem extras continua com o mesmo erro de hoje (RF-05) e a mensagem não indica qual senha foi tentada (RF-06).

**Por que o erro não depende da senha:** os campos verificados antes do HMAC (prefixo, número de componentes, expiração) estão em texto claro no próprio token (`src/utils/internal/iron-crypto.ts:98-118`). Eles dão o mesmo resultado com qualquer senha, então parar nesses erros não perde nenhuma senha válida.

**Alternativas consideradas:**

1. **Duas passagens:** todas as senhas com iterações atuais e só depois todas com legado. Descartada: quebra a ordem "senha por senha" do RF-02 e do RF-07. O custo ganho é pequeno, pois o legado só dispara para sessões antigas.
2. **Tentar todas e pegar o último erro.** Descartada: a mensagem final dependeria da última extra, o que daria a um atacante uma pista sobre a configuração.

### D-03 — Sinalização da migração (RF-04) e escopo ao cookie (RF-09)

**Escolha:** novo símbolo interno `kRotatedSeal`, em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). `unsealSession` o marca quando a senha que abriu não é a primeira. `getSession` o consome junto de `kLegacySeal` (`src/utils/session.ts:199-201`) e o inclui na condição de regravação (`src/utils/session.ts:214`).

A condição de regravação continua exigindo `sessionFromCookie`. Por isso a leitura pelo cabeçalho (RF-09) não regrava, como já acontece com sessões legadas nesse caminho.

**Alternativas consideradas:**

1. **Reaproveitar `kLegacySeal` com outro significado.** Descartada: o nome mentiria no código, e a regra de "legado" (1 iteração) é diferente de "senha antiga".
2. **Comparar a senha usada com `config.password` em `getSession`.** Descartada: `unsealSession` devolve só o objeto. Exigiria mudar a assinatura pública, ou expor o índice da senha. Um símbolo interno não muda nada público.

### D-04 — Validação de `extraUnsealPasswords`

**Escolha:** uma função interna `assertExtraUnsealPasswords(config)`, chamada no **início** de `getSession`, antes de qualquer mudança em `context.sessions` (`src/utils/session.ts:155-165`). Ela verifica cada extra:

- vazia → `Error("Empty password")`, a mesma mensagem de `seal`/`unseal` (`src/utils/internal/iron-crypto.ts:65-66`, `:94-95`), cumprindo RF-08;
- curta → `Error("Password string too short (min N characters required)")`, a mesma mensagem de `generateKey` (`src/utils/internal/iron-crypto.ts:192-195`). O mínimo vem de `{ ...sealDefaults, ...config.seal }.encryption.minPasswordlength`, o mesmo cálculo de `unsealSession` (`src/utils/session.ts:317-321`).

**Por que validar o tamanho aqui:** sem essa checagem, uma extra curta lançaria "too short" dentro de `unseal`. Esse erro não é `"Bad hmac value"`, então o laço (D-02) pararia ali e as extras depois dela nunca seriam tentadas. Além disso, o `.catch` de `getSession` esconderia o problema, e a sessão só pararia de abrir sem nenhum aviso. Validar antes evita os dois efeitos.

**Ponto a confirmar com a equipe:** o PRD (premissa de entropia) assume o mínimo de 32 caracteres também para as extras. Esta spec adota esse requisito. Se a equipe preferir só a vacuidade (RF-08 puro), basta remover o ramo `too short`.

**Alternativas consideradas:**

1. **Validar dentro de `unsealSession`.** Descartada: roda dentro do `.catch(() => {})` de `getSession`, então o erro some.
2. **Validar só na primeira escrita, como `password`.** Descartada: o PRD (RF-08) pede erro "ao criar a sessão" / "na primeira uso". Além disso, a extra só é usada na leitura, então a checagem da escrita não a alcançaria.

**Assimetria aceita:** `password: ""` continua falhando só na escrita (`src/utils/session.ts:300`), porque RF-05 manda manter o comportamento atual. Só as extras falham na leitura.

### D-05 — Superfície pública

**Escolha:** o único nome público novo é `SessionConfig.extraUnsealPasswords?: string[]` (`src/utils/session.ts:39-99`). `kRotatedSeal` e os helpers ficam internos. Nenhuma função exportada muda de assinatura. `sealSession`/`unsealSession` continuam com a mesma forma.

### D-06 — Expiração vale para a senha que abriu

**Escolha:** `maxAge` e `idleTimeout` continuam sendo conferidos depois que alguma senha abriu o cookie (`src/utils/session.ts:349-365`). Não há conferência por senha.

**Justificativa:** a expiração já é a mesma para qualquer senha, então as checagens continuam válidas para a senha que abriu.

---

## Arquivos a alterar

### `src/utils/session.ts`

| Trecho atual | Mudança |
|---|---|
| `src/utils/session.ts:39-48` (`SessionConfig`, campo `password`) | Acrescentar `extraUnsealPasswords?: string[]` com JSDoc (ver contrato). |
| `src/utils/session.ts:5` (import de símbolos internos) | Importar `kRotatedSeal`. |
| `src/utils/session.ts:149-153` (início de `getSession`) | Chamar `assertExtraUnsealPasswords(config)` antes de qualquer mudança no contexto. |
| `src/utils/session.ts:196-198` (chamada de `unsealSession` no `.then`) | Sem mudança na chamada; o `.catch` continua. |
| `src/utils/session.ts:199-201` | Ler e apagar `kRotatedSeal` do objeto desbloqueado, como `kLegacySeal`. |
| `src/utils/session.ts:214` (condição de regravação) | `(legacySeal \|\| rotatedSeal \|\| shouldSlide(session, config))`. |
| `src/utils/session.ts:312-348` (`unsealSession`) | Trocar a tentativa única pelo laço de D-01/D-02. O bloco de fallback legado (`:326-347`) vai para `unsealWithPassword`. |
| `src/utils/session.ts:349-365` | Sem mudança; passa a valer para a senha que abriu. |
| Novo, ao fim do arquivo (após `sessionExpires`, `:455-464`) | `assertExtraUnsealPasswords` e `unsealWithPassword`, conforme a convenção de helpers internos no fim do arquivo. |

### `src/utils/internal/session.ts`

- Acrescentar `export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.rotated-seal");` após `kLegacySeal` (`src/utils/internal/session.ts:7-9`).

### `test/session.test.ts`

- Novos casos dentro de `describeMatrix` (`test/session.test.ts:15`), após o teste de `legacySealFallback: false` (`test/session.test.ts:161-186`), que serve de modelo. Ver estratégia de testes.

### Não alterar

- `src/utils/internal/iron-crypto.ts` (D-01).
- `docs/4.examples/handle-session.md` (fora de escopo do PRD; o JSDoc do campo é a documentação entregue).
- `CHANGELOG.md` (gerado a partir de commits).

---

## Contratos e assinaturas

```ts
// src/utils/session.ts — campo novo em SessionConfig
/**
 * Previous passwords that can still open sessions sealed before a rotation.
 * Tried after `password`, in order; the first one that opens a session is
 * used. Sessions opened with one of these are resealed with `password` on the
 * same request (cookie-based sessions only). Never used to seal.
 *
 * Each extra password costs one more key derivation for every cookie that
 * does not open with `password`, so keep the list short and remove entries
 * once the rotation window has passed. Subject to the same minimum length as
 * `password`.
 */
extraUnsealPasswords?: string[];

// src/utils/session.ts — comportamento de unsealSession (assinatura pública inalterada)
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
// Ordem: [config.password, ...(config.extraUnsealPasswords || [])]
// Para cada senha: unsealWithPassword(). Continua só em "Bad hmac value".
// Erro final: o primeiro erro capturado (da senha principal).
// Senha com índice > 0: marca unsealed[kRotatedSeal] = true.

// src/utils/session.ts — helpers internos (não exportados)
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
// Contém o bloco try/catch com fallback legado de hoje (src/utils/session.ts:322-348).
// Marca kLegacySeal quando usa o legado, como hoje.

function assertExtraUnsealPasswords(config: SessionConfig): void;
// Lança Error("Empty password") para extra vazia.
// Lança Error(`Password string too short (min ${n} characters required)`) para extra curta.
// n = { ...sealDefaults, ...config.seal }.encryption.minPasswordlength (padrão 32).

// src/utils/internal/session.ts
export const kRotatedSeal: unique symbol;
```

**Comportamento observável:**

| Entrada | Resultado |
|---|---|
| Sem `extraUnsealPasswords` | Idêntico ao atual (RF-05). |
| Cookie aberto por `password` | Nenhuma regravação extra por causa da rotação. |
| Cookie aberto por extra (cookie, não cabeçalho) | Uma resposta com `Set-Cookie` selado com `password`. |
| Cookie aberto por extra (cabeçalho de sessão) | Dados retornados, sem `Set-Cookie`. |
| Nenhuma senha abre | Sessão vazia (`id` `""`, `data` vazio), sem erro na aplicação. |
| Extra vazia ou curta | Erro lançado em `getSession` com a mensagem de D-04. |

---

## Estratégia de testes

Os testes ficam em `test/session.test.ts`, com `describeMatrix` (`test/session.test.ts:15`), e rodam nos modos `web` e `node`. Pelo fluxo de correção de bug do `AGENTS.md`, os casos novos são escritos primeiro e devem **falhar** no código atual antes da mudança.

Padrões a reaproveitar:

- Selar uma sessão com outra senha ou com iterações legadas: `seal(...)` de `src/utils/internal/iron-crypto.ts`, como em `test/session.test.ts:134-143` e `:161-170`.
- Rota de teste com configuração própria: `t.app.all("/rota", ...)` com `useSession(event, { ...sessionConfig, password, extraUnsealPasswords })`, como em `test/session.test.ts:172-178`.
- Tempo controlado: `vi.useFakeTimers({ toFake: ["Date"], now: t0 })` com `try/finally`, como em `test/session.test.ts:311-342`.
- Erro tratado dentro da rota (`try/catch` retornando `{ message }`). `ctx.errors` (`test/_setup.ts:144-155`) falharia o teste se a exceção ficasse sem tratamento.

Casos:

| # | Caso | Verifica | Falha hoje? |
|---|---|---|---|
| T1 | Cookie selado com `B` (extra), configuração `password: A`, `extra: [B]` | Dados retornados; `Set-Cookie` único; `unseal(…, A)` abre; `unseal(…, B)` não abre (RF-03, RF-04) | Sim |
| T2 | Cookie regravado de T1 lido de novo sem extras | Mesmo `id` e dados; nenhum `Set-Cookie` (sem loop de regravação, RF-04 e risco de regravação) | Sim |
| T3 | Extras `[X, B]`, cookie com `B` | Abre com o segundo item (RF-02) | Sim |
| T4 | Cookie com `A` (primária), extras `[B]` | Abre sem tentar `B` e sem `Set-Cookie` (ordem, RF-02) | Não (regressão) |
| T5 | Cabeçalho `x-h3-test-session` com `B` | Dados retornados e nenhum `Set-Cookie` (RF-09) | Sim |
| T6 | Cookie com `B` em 1 iteração PBKDF2, extras `[B]` | Abre e regrava com iterações atuais (RF-07) | Sim |
| T7 | Mesmo cookie de T6, com `legacySealFallback: false` | Não abre; sessão vazia (RF-07) | Não (regressão, passa hoje sem extras) |
| T8 | Cookie com `C`, configuração `password: A`, `extra: [B]` | Sessão vazia, sem erro propagado, sem mencionar senhas (RF-06) | Não |
| T9 | `extraUnsealPasswords: [""]` | Erro `Empty password` na leitura, capturado pela rota (RF-08) | Sim |
| T10 | `extraUnsealPasswords: ["curta"]` | Erro `too short` na leitura (D-04) | Sim |
| T11 | Cookie com `B` expirado por `maxAge` | Sessão vazia, sem regravação (D-06) | Não |
| T12 | Tipagem: `SessionConfig` com `extraUnsealPasswords: string[]` | `pnpm typecheck` compila (RF-01). `tsconfig.json` inclui `test`. | Sim (erro de tipo hoje) |

Após a mudança:

1. `pnpm vitest run test/session.test.ts`: todos os casos existentes passam sem alterar asserções (RF-05).
2. `pnpm vitest run test/`: suíte completa, para pegar regressões em outros usos de sessão (`test/` tem integração de cookies).
3. `pnpm typecheck` e `pnpm lint` (RF final).
4. Opcional: `pnpm test` (lint + typecheck + coverage) antes do PR.

---

## Riscos

| Risco | Origem | Mitigação |
|---|---|---|
| Custo de CPU: cada extra custa uma derivação PBKDF2 em cada cookie que não abre com `password`; com fallback legado, o custo dobra. | PRD | Documentado no JSDoc (contrato). Lista curta e remoção após a janela. Medir com `pnpm bench:node` se a lista crescer. |
| Vazamento de sinal de tempo: o número de derivações revela em qual posição a senha abriu. | Esta spec | Impacto baixo: o atacante já precisa de um cookie selado. Não tratar nesta entrega; registrar. |
| Extra inválida silenciosa: uma extra curta ou vazia desligaria a rotação sem aviso. | D-04 | Validação antes do `.catch` de `getSession`; erro na leitura. |
| Laço de regravação: a regravação dispara a cada requisição. | PRD | Regravar só com `kRotatedSeal` ou legado. A regravação sempre usa `password`, então o cookie seguinte não tem a marca (T2). |
| Símbolo copiado para a sessão: `Object.assign` copia símbolos enumeráveis. | Esta spec | Apagar `kRotatedSeal` do objeto desbloqueado antes do `Object.assign` (como `kLegacySeal`, `src/utils/session.ts:199-201`). |
| Requisições concorrentes regravando a mesma sessão. | Esta spec | Mesmo comportamento já existente para sessões legadas. O resultado é o mesmo cookie selado com `password`; a escrita extra é inofensiva. |
| Erro de senha revelar qual senha foi tentada. | PRD | Sempre relançar o erro da primeira senha (D-02). Teste T8 confere que não há menção a senhas. |
| Sessões nunca lidas de novo continuam seladas com a senha antiga. | PRD | Comportamento esperado da rotação. Registrar no JSDoc, como a remoção da lista. |
| Mudar `getSession` para lançar erro em configuração inválida muda o caminho sem cookie. | Esta spec | Só afeta extras inválidas, que hoje não existem. Não há mudança para quem não usa o campo. |

---

## Questões em aberto

1. **Tamanho mínimo das extras (D-04).** Esta spec aplica o mesmo mínimo de `password`, por causa da premissa do PRD. Se a equipe quiser só a vacuidade, remover o ramo `too short` e aceitar que extras curtas interrompem o laço.
2. **Erro na leitura para extra inválida.** Esta spec faz a rota lançar (500 para o usuário). A alternativa é logar e ignorar a extra. Ignorar esconderia a configuração errada, por isso a spec não adota essa opção.
