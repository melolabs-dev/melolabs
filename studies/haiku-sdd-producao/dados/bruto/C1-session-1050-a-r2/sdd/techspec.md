# Tech spec — Várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-07), issue h3js/h3#1050 (segunda alternativa).

## Resumo

`SessionConfig.password` passa a aceitar `string | string[]`. A primeira senha da lista sela; todas as senhas da lista, na ordem declarada, abrem sessões. Uma string (ou lista de um item) produz exatamente o token de hoje. A mudança fica concentrada em `src/utils/session.ts`, com um helper de normalização em `src/utils/internal/session.ts`. `src/utils/internal/iron-crypto.ts` não muda.

## Correção de premissa do PRD

O PRD (seção "Premissas", item "Formato do token") diz que selar com string usa o identificador `default`. Isso não procede:

- `src/utils/internal/iron-crypto.ts:68` — `normalizePassword` de uma string não devolve `id`, e `seal` usa `id = ""` (`src/utils/internal/iron-crypto.ts:68`).
- `src/utils/internal/iron-crypto.ts:79` — o id vazio entra no token como `Fe26.2**...`.
- `src/utils/internal/iron-crypto.ts:121` — `passwordId || "default"` só existe para a busca em mapa `{ id: senha }`.

A conclusão do PRD (RF-04: token idêntico) vale, pelo motivo de que a primeira senha é selada como string, sem id. Sugiro corrigir a premissa no PRD.

## Decisões de arquitetura

### D-01 — Tentativas em laço em `session.ts`, sem mapa de ids do iron

**Alternativas consideradas**

1. Passar um mapa de ids ao `unseal` do iron (`{ default: p1, ... }`), que o iron já suporta (`src/utils/internal/iron-crypto.ts:124-126`).
2. Alterar `iron-crypto.ts` para aceitar um array de senhas.
3. Laço em `unsealSession`, chamando `unseal` uma vez por senha.

**Escolha: 3.**

Motivo da rejeição da 1: tokens selados com string têm id vazio, e a busca cai em `"default"` (`src/utils/internal/iron-crypto.ts:121`). Só uma chave pode ser `"default"`, então o mapa não expressa uma lista de senhas sem mudar o formato do token (quebra RF-04). Motivo da rejeição da 2: muda uma API interna usada também pelos testes unitários de `iron-crypto` (`test/unit/iron-crypto.test.ts`) sem ganho real. A 3 é a menor mudança e não toca o formato.

### D-02 — Tipo `string | string[]`, sem tupla não vazia

**Alternativas consideradas**

1. `[string, ...string[]]`, que garante em tempo de compilação que a lista não é vazia.
2. `string | string[]`, como o contrato pede, com checagem em tempo de execução.

**Escolha: 2.**

O contrato (`sdd/pedido.md`, "Nomes públicos") fixa `string | string[]`. A tupla obrigaria quem monta a lista a dados como `string[]` (por exemplo, uma variável de ambiente separada por vírgula) a fazer uma asserção, e o erro de lista vazia de RF-05 continua necessário mesmo com ela, porque JavaScript puro não passa pelo tipo.

### D-03 — Normalização e validação da lista antes do `try`

**Alternativas consideradas**

1. Validar só dentro de `unsealSession`.
2. Validar no início de `getSession`, `sealSession` e `unsealSession`, via helper comum.

**Escolha: 2.**

`getSession` chama `unsealSession` dentro de `.catch(() => {})` (`src/utils/session.ts:196-197`). Um erro de configuração lançado lá seria engolido e a requisição receberia uma sessão nova, sem sinal algum. Por isso a checagem de lista vazia precisa acontecer antes da cadeia `try`, no topo de `getSession` (`src/utils/session.ts:149-153`), antes de qualquer mutação de `context.sessions` (`src/utils/session.ts:158-173`). `sealSession` e `unsealSession` também chamam o helper, porque são exportados (`src/index.ts:208-209`) e podem ser usados diretamente.

Para preservar o comportamento atual de `password: undefined` em JavaScript puro (hoje cai em `Empty password` no `seal`, `src/utils/internal/iron-crypto.ts:65-66`), o helper só lança para lista vazia; qualquer outro valor não-array vira `[valor]` e segue o caminho de hoje.

### D-04 — Ordem de tentativas: por senha, estrita antes da legada

**Alternativas consideradas**

1. Para cada senha, tentar a estrita e depois a legada (1 iteração).
2. Tentar todas as senhas com a estrita; depois todas com a legada.

**Escolha: 1.**

RF-07 fala em tentar o fallback "para cada senha da lista" e em "a primeira senha é tentada primeiro". A opção 1 segue essa leitura. O custo total é parecido nos dois casos: a derivação legada tem 1 iteração (`src/utils/session.ts:342`), então é barata.

O laço só continua quando o erro é `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:136`), que é a única falha dependente de senha. Qualquer outro erro (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `Invalid expiration`) não depende da senha e é relançado na hora. Isso preserva o comportamento atual de `src/utils/session.ts:332-339`.

Se nenhuma senha abrir o token, o laço relança o último erro `"Bad hmac value"`. `getSession` o engole (`src/utils/session.ts:197`), e a requisição recebe uma sessão nova (RF-03).

### D-05 — Selagem sempre com a primeira senha

`sealSession` usa `toPasswordList(config.password)[0]` (hoje `src/utils/session.ts:300` passa `config.password`). Uma lista de um item sela com a mesma string e portanto gera o mesmo formato de token (RF-04). `updateSession` (`src/utils/session.ts:267`) não muda, porque já delega a `sealSession`.

Sessões abertas com senha secundária são regravadas com a primeira assim que houver `update`, `clear`, a renovação de `idleTimeout` (`src/utils/session.ts:214`) ou o fallback legado (`src/utils/session.ts:214`, condição `legacySeal`). Isso é a migração de RF-06, sem código novo.

### D-06 — Expiração e marcação legada aplicadas uma vez, ao resultado

As checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) ficam depois do laço, sobre o objeto já aberto. Como não dependem da senha, RF-07 vale sem código específico. A marcação `kLegacySeal` (`src/utils/session.ts:346`) é aplicada só quando a abertura veio pelo caminho legado, como hoje.

### D-07 — Duplicatas na lista: sem tratamento

**Alternativas consideradas**

1. Rejeitar duplicatas com erro.
2. Remover duplicatas silenciosamente.
3. Não tratar: a duplicata só repete uma tentativa.

**Escolha: 3.**

Rotação de volta (`["A", "B", "A"]`) é um caso legítimo; rejeitar quebraria esse uso. Remover duplicatas adiciona código por um ganho de uma derivação em caso de falha. O PRD deixou a decisão em aberto (`sdd/prd.md`, "Riscos", "Ambiguidade de senha repetida"); esta spec a fecha como "sem efeito funcional, sem erro".

### D-08 — Sem novos nomes públicos e sem mudança no iron

Os únicos símbolos novos são internos. `toPasswordList` fica em `src/utils/internal/session.ts` (que já reúne helpers internos de sessão). `src/index.ts` e `test/unit/package.test.ts:125,149` não mudam. `iron-crypto.ts` não muda.

### D-09 — Documentação na mesma mudança

Atualizar o comentário de `SessionConfig.password` (`src/utils/session.ts:41-48`) e o aviso em `docs/4.examples/handle-session.md:36-43`, com: a ordem da lista, a necessidade de remover senhas antigas depois da expiração das sessões, o custo por tentativa e o aviso de ordem errada. Esses são os itens que o PRD manda documentar (`sdd/prd.md`, "Riscos").

## Arquivos a alterar

| Arquivo | O que muda | Referência atual |
|---|---|---|
| `src/utils/session.ts` | Tipo de `password`; `getSession`, `sealSession` e `unsealSession` chamam o helper; laço de unseal substitui a chamada única e o fallback | `src/utils/session.ts:48` (tipo), `:149-153` (topo de `getSession`), `:196-197` (chamada com `.catch`), `:300` (`seal`), `:312-348` (`unsealSession` e fallback) |
| `src/utils/internal/session.ts` | Novo helper `toPasswordList` | `src/utils/internal/session.ts:1-18` (arquivo curto, já reúne helpers internos) |
| `test/session.test.ts` | Constante `password` extraída de `sessionConfig`; três usos de `sessionConfig.password` em `seal`/`unseal` trocados pela constante; novos casos | `test/session.test.ts:21-25`, `:137`, `:157`, `:164`; novos casos depois de `:186` |
| `test/unit/` (arquivo novo `session-password.test.ts`) | Testes unitários de `toPasswordList` | — |
| `docs/4.examples/handle-session.md` | Seção sobre rotação de senhas | `docs/4.examples/handle-session.md:36-43` |

Não mudam: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `src/utils/cookie.ts`, `src/utils/auth.ts`, `test/bench/session.ts` (usa string, continua válido).

Nota de tamanho: `src/utils/session.ts` já tem 464 linhas, acima da meta de 200 do `AGENTS.md`. Esta mudança acrescenta cerca de 30. Não dividir o arquivo aqui, para não misturar refatoração com a feature; fica registrado como dívida.

## Contratos e assinaturas

### Tipo público (único contrato alterado)

```ts
// src/utils/session.ts:39-48
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. Each must be at least 32 characters.
   * A list seals with its first password and unseals with any of them, in order.
   * ...
   */
  password: string | string[];
  // demais campos inalterados
}
```

### Helper interno

```ts
// src/utils/internal/session.ts
/**
 * Normalize `SessionConfig.password` into the list of passwords tried in order.
 * The first password seals; the rest only unseal.
 * @throws if the list is empty.
 */
export function toPasswordList(password: string | string[]): string[];
```

Comportamento:

- `toPasswordList("x")` → `["x"]`.
- `toPasswordList(["a", "b"])` → `["a", "b"]` (mesma referência é aceitável; não copiar).
- `toPasswordList([])` → lança `Error("The session password list is empty: provide at least one password")`.
- Valor não-array que não seja string (JavaScript puro, `undefined`) → `[valor]`, para o `seal`/`unseal` do iron falharem como hoje.

### Funções exportadas (assinaturas inalteradas)

```ts
export function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;
export function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
```

### Laço de abertura (interno, `src/utils/session.ts`)

```ts
// novo, perto de unsealSession
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  sealOptions: SealOptions,
  legacyFallback: boolean,
): Promise<Partial<Session>>;
```

Esboço do comportamento (para a implementação, não obrigatório à letra):

```ts
// por senha: estrita; se "Bad hmac value" e legacyFallback, legada (iterations: 1) com kLegacySeal;
// outros erros são relançados; se a lista acabar, relança o último "Bad hmac value".
```

`unsealSession` passa a chamar `toPasswordList(config.password)` no início, depois `unsealWithPasswords(...)`, e mantém as checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) sem mudança.

`legacyFallback` vale `config.legacySealFallback !== false` e continua sendo ignorado quando `sealOptions.integrity.iterations === 1`, como em `src/utils/session.ts:334`.

### Fluxo de abertura

1. `getSession` valida a lista (D-03).
2. Lê o cookie ou o header (`src/utils/session.ts:178-193`).
3. `unsealSession` tenta cada senha, na ordem (D-04).
4. Aplica expiração (D-06).
5. Se a sessão for legada, ou precisar deslizar a janela (`src/utils/session.ts:214`), regrava com a primeira senha (D-05).

## Estratégia de testes

Seguir `AGENTS.md`: `describeMatrix`, que roda cada teste em `web` e `node`.

Casos novos em `test/session.test.ts` (depois de `:186`):

1. **Abre sessão com senha antiga** (RF-02). Criar sessão com `password` antiga; repetir a requisição com `["nova", "antiga"]`; esperar o mesmo `id` e `data`.
2. **Sela com a primeira senha** (RF-01, RF-06). Com `["nova", "antiga"]`, gravar com `update`; `unseal(cookie, "nova", sealDefaults)` abre; `unseal(cookie, "antiga", sealDefaults)` lança `"Bad hmac value"`.
3. **Senha fora da lista vira sessão nova** (RF-03). Selar com `"desconhecida"`; a requisição com `["nova", "antiga"]` recebe `id` diferente e `data` vazio.
4. **Lista de um item tem o mesmo formato** (RF-04). Selar com `["x"]` e com `"x"`; em ambos, `split("*")` tem 8 partes e a parte do id é vazia; `unseal` aberto com `"x"` funciona.
5. **Lista vazia lança erro claro** (RF-05). Duas rotas, uma com `useSession` e outra com `getSession`, usando `password: []`. Afirmar `t.errors[0].message` contém "empty" e resetar com `t.errors = []`, no padrão de `test/errors.test.ts:114-116`.
6. **Legado com senha antiga é regravado com a primeira** (RF-07, segundo critério). `seal` com 1 iteração e `"antiga"`; requisição com `["nova", "antiga"]`; `Set-Cookie` abre com `"nova"`. Espelha `test/session.test.ts:134-159`.
7. **`maxAge` vale para senha antiga** (RF-07, primeiro critério). Relógio falso como em `test/session.test.ts:188-191`; sessão criada com `"antiga"`, avançar além de `maxAge`, esperar sessão nova.
8. **Legado com `legacySealFallback: false` e senha secundária** (regressão do fallback por senha). Sessão legada com `"antiga"` e lista `["nova", "antiga"]` com fallback desligado → sessão nova.

Testes unitários em `test/unit/session-password.test.ts`: `toPasswordList` nos quatro casos listados em "Contratos".

Ajustes em testes existentes (sem perda do que verificam):

- `test/session.test.ts:21-25`: extrair `const password = "1234567...";` e usar em `sessionConfig`.
- `test/session.test.ts:137`, `:157`, `:164`: trocar `sessionConfig.password` por `password`. Esses são os únicos pontos onde o tipo novo quebra a compilação (`seal`/`unseal` recebem `RawPassword`).
- Os demais `password: sessionConfig.password` (`:195`, `:238`, etc.) atribuem a `SessionConfig` e continuam compilando.

Invariantes que devem continuar valendo:

- `test/session.test.ts:410-435`: "throttles idleTimeout reseals" conta `subtle.encrypt`. A mudança não adiciona selagens; a contagem precisa ficar igual. Se a contagem mudar, a regressão está em D-05.

Verificação (comandos do projeto, `package.json`):

- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/`
- `pnpm typecheck` (`tsc --noEmit`)
- `pnpm lint` (`oxlint . && oxfmt --check .`)
- `pnpm test` (suíte completa com cobertura) antes de fechar.

Seguindo o fluxo de bug/feature do `AGENTS.md`, escrever primeiro os casos 1, 2 e 5 e confirmar que falham antes da implementação.

## Riscos

| # | Risco | Severidade | Tratamento |
|---|---|---|---|
| R1 | **Custo por tentativa.** Cada tentativa estrita falha consome uma derivação PBKDF2 de 8192 iterações, porque `unseal` verifica o HMAC antes de decriptar (`src/utils/internal/iron-crypto.ts:133-137`). Uma requisição com cookie inválido custa N derivações estritas, mais N derivações legadas de 1 iteração (baratas). O PRD estimava "até 2N"; o custo pesado é N, não 2N. Sessões abertas com senha secundária pagam i derivações por requisição até serem regravadas. | Média | Documentar (D-09) e recomendar listas curtas. Medir antes de fechar, com `pnpm bench:node` só se houver regressão evidente, como o PRD manda. |
| R2 | **Falha de configuração engolida.** `getSession` engole qualquer erro de `unsealSession` (`src/utils/session.ts:197`). Uma senha secundária curta (menos de 32 caracteres) faz o iron lançar `Password string too short` (`src/utils/internal/iron-crypto.ts:192-194`) dentro do laço; o erro é engolido e as sessões dessa senha viram anônimas sem aviso. | Alta | Não validar comprimento na lista: isso mudaria o comportamento de uma senha única curta, que hoje também é engolida no `unseal` (RF-04 proíbe). Documentar com destaque e cobrir com um teste que a lista não quebra sessões de outras senhas. Validar lista vazia (D-03) fica dentro de RF-05. |
| R3 | **Senha antiga que nunca sai.** Enquanto a senha antiga estiver na lista, as sessões que ela selou continuam válidas. | Média | Documentar: remover a senha depois de `maxAge` (ou `idleTimeout`) de tempo decorrido. |
| R4 | **Ordem errada.** Se a senha nova estiver depois da antiga, as sessões continuam sendo seladas com a antiga, sem erro. | Alta (silenciosa) | Não há detecção em tempo de execução sem regras extras; destacar na documentação (D-09). |
| R5 | **Mudança de tipo para quem lê `config.password`.** Código de terceiros que trata o campo como string quebra em compilação. | Baixa | Documentar a mudança. Quem só passa a configuração não muda nada. |
| R6 | **Premissa errada no PRD** (id `default` na selagem por string). | Baixa | Corrigir o PRD; a conclusão não muda (ver seção "Correção de premissa"). |
| R7 | **Duplicatas.** Repetir uma senha não tem efeito funcional, só custa uma tentativa extra por falha. | Baixa | Decisão D-07. |
| R8 | **Ordem de tentativas e timing.** Tentar senhas em sequência por `await` mantém o código simples, mas torna o tempo de resposta dependente da posição da senha. Um atacante que mede o tempo pode inferir a posição de uma senha, não o seu valor. | Baixa | Aceito. A ordem já é pública (está na configuração). |
| R9 | **Tamanho de `session.ts`.** O arquivo passa de 464 linhas. | Baixa | Registrado como dívida (ver "Arquivos a alterar"). |
