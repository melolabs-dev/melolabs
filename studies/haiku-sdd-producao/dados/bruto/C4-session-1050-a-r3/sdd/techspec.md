# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-a) e `sdd/prd.md` (RF-01 a RF-09). Esta especificação não altera código; as citações foram conferidas nos arquivos atuais.

## Resumo

`SessionConfig.password` passa a aceitar `string | string[]`. A primeira senha sela; todas são tentadas, em ordem, ao desselar. A mudança fica restrita a `src/utils/session.ts`, sem alterar `src/utils/internal/iron-crypto.ts` nem o formato do cookie. Nenhum nome público novo é exportado.

## Verificações no código atual

- `iron-crypto` ignora o `id` do token quando a senha é string: `src/utils/internal/iron-crypto.ts:121-122` (`_passwordId`, `typeof password === "string"`). Logo, um token selado com string abre com qualquer string que bata no HMAC, e o formato `Fe26.2**…` é o mesmo de hoje (`src/utils/internal/iron-crypto.ts:68`, `id = ""`).
- O erro de HMAC é `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:135-137`). É a única mensagem que o fallback legado já trata (`src/utils/session.ts:336`).
- A expiração do seal (`"Expired seal"`, `src/utils/internal/iron-crypto.ts:115-117`) é checada antes do HMAC e não depende da senha.
- Senha curta gera erro em `generateKey` (`src/utils/internal/iron-crypto.ts:191-196`), não `"Bad hmac value"`.
- `getSession` engole qualquer erro de desselagem: `src/utils/session.ts:196-198` (`.catch(() => {})`). Validação feita dentro de `unsealSession` seria silenciada; ela precisa acontecer antes, em `getSession`.
- Custo real por tentativa: `hmacWithPassword` deriva a chave com PBKDF2 de 8192 iterações (`src/utils/internal/iron-crypto.ts:155-160`, `:236-251`). O fallback legado deriva com 1 iteração (`src/utils/session.ts:340-344`), que é barato. O PRD fala em "até 2N derivações"; na prática são N derivações caras e até N baratas.
- `test/session.test.ts:137`, `:157` e `:164` passam `sessionConfig.password` direto para `seal`/`unseal`. Com o novo tipo, `unseal(…, string | string[])` não compila (`src/utils/internal/iron-crypto.ts:87-91`). Isso exige ajuste no teste, permitido por RF-04.
- `unsealSession`, `sealSession`, `useSession`, `getSession`, `updateSession` são exportados (`src/index.ts:203-211`). Helpers novos precisam ficar sem `export` para não virar nome público.

## Decisões de arquitetura

### D-01 — Tipo de `password` e normalização em um ponto só

**Escolha:** `password: string | string[]`, exatamente como pede o PRD. Uma função interna não exportada, `sessionPasswords(config)`, normaliza para `string[]` e valida. Todo o resto do código usa só essa lista.

**Alternativas consideradas:**
- Ler `config.password` em cada uso, com `Array.isArray` espalhado por `seal`/`unseal`. Descartada: duplica a lógica de validação e aumenta a chance de esquecer um caminho.
- Tipo `readonly string[]`. Descartada: o PRD fixa `string[]`, e `readonly` aceitaria o mesmo uso sem ganho prático.

**Justificativa:** um único ponto de validação garante RF-05 e a validação de tamanho (Risco 2) em todas as entradas públicas.

### D-02 — Selar sempre com a primeira senha (RF-02)

**Escolha:** `sealSession` passa `passwords[0]` ao `seal`, como string. O token gerado é idêntico ao de senha única.

**Alternativas consideradas:**
- Usar `PasswordHash` do iron (`{ [id]: secret }`) com a lista. Descartada: o iron grava o `id` no token (`src/utils/internal/iron-crypto.ts:79`), o que muda o formato do cookie (contra a premissa do PRD), e a busca por `id` não serve para tentar várias senhas com o mesmo id.

**Justificativa:** mantém RF-04 e o cookie idêntico; a rotação não exige nada do lado de quem lê o cookie.

### D-03 — Desselar com laço sequencial em `session.ts` (RF-03, RF-06, RF-08)

**Escolha:** `unsealSession` percorre `sessionPasswords(config)` na ordem. Para cada senha, tenta o unseal com as opções atuais e, se a opção de fallback legado estiver ativa, com 1 iteração. A primeira que validar vence. Os checks de expiração (`maxAge`/`idleTimeout`) continuam depois do laço, sobre o resultado.

**Alternativas consideradas:**
- Nova função `unsealAny` em `iron-crypto.ts`. Descartada: é uma função a mais no módulo interno sem ganho; o laço cabe em `session.ts` e mantém `iron-crypto.ts` intacto.
- Tentar só a primeira e, em caso de falha, a lista inteira em outra etapa. Descartada: complica o fallback legado sem benefício.

**Ordem (por senha):** primeiro o unseal atual, depois o legado, e só então a próxima senha. Para um cookie legado com a senha da cauda, o custo é uma derivação cara da primeira senha mais uma barata, e então o acerto.

### D-04 — Quais erros passam para a próxima senha

**Escolha:** só `"Bad hmac value"` avança o laço. Qualquer outro erro é relançado de imediato: `"Wrong mac prefix"`, `"Incorrect number of sealed components"`, `"Invalid expiration"`, `"Expired seal"` e erros de senha curta.

**Justificativa:** esses erros não dependem da senha (exceto a senha curta, que é coberta por D-05). Continuar o laço neles só gastaria PBKDF2.

### D-05 — Validação de configuração (RF-05, Risco 2)

**Escolha:** `sessionPasswords(config)` lança erro nestes casos:
1. lista vazia: `"At least one session password is required"`;
2. lista com mais de `MAX_SESSION_PASSWORDS` entradas (valor fixo: **4**, ver D-06);
3. qualquer entrada da lista com menos caracteres que o mínimo efetivo, que é `max(encryption.minPasswordlength, integrity.minPasswordlength)` de `config.seal ?? defaults` (`src/utils/internal/iron-crypto.ts:22`, `:28`).

A validação de tamanho vale só para listas. Uma string continua sem checagem, para preservar RF-04 (hoje uma string curta não lança em `getSession`).

A mensagem de erro não diz qual senha falhou nem seu índice, para não vazar a configuração.

**Onde é chamada:** no começo de `useSession` (`src/utils/session.ts:108`), `getSession` (`:149`, antes da leitura do cache em `:162`), `updateSession` (`:241`), `sealSession` (`:282`) e `unsealSession` (`:312`). Em `getSession` precisa ser antes de qualquer `.catch`, senão o erro some.

**Alternativas consideradas:**
- Validar só na lista vazia (RF-05) e deixar o tamanho para o iron. Descartada: a senha curta na cauda faria a sessão não abrir sem causa visível (Risco 2 do PRD).
- Validar só em `useSession`. Descartada: `getSession` e `updateSession` também são públicos e precisam falhar (RF-05).

### D-06 — Limite de tamanho da lista (Risco 1)

**Escolha:** `MAX_SESSION_PASSWORDS = 4` (senha atual mais três anteriores), constante interna do módulo.

**Justificativa:** cada entrada custa uma derivação de 8192 iterações num cookie inválido. Com 4 entradas, o pior caso é 4 derivações caras e 4 baratas por requisição. O limite é uma escolha de implementação permitida pelo PRD; quem precisa de mais janelas de rotação pode trocar a constante em revisão futura.

### D-07 — Resultado quando nenhuma senha valida (RF-03, Risco 4)

**Escolha:** o laço relança o último erro `"Bad hmac value"`. `getSession` continua engolindo o erro e devolve sessão nova e vazia, como hoje.

**Justificativa:** a mensagem é a mesma para qualquer senha, então nada vaza sobre qual senha foi tentada. Para senha única, o erro final é o mesmo de hoje.

### D-08 — Migração gradual (RF-07)

**Escolha:** nenhuma mudança no gatilho de reselagem. `getSession` (`src/utils/session.ts:214-216`) já reseala quando há fallback legado ou `shouldSlide` (`src/utils/session.ts:414-421`), e `updateSession` sela com `passwords[0]` via `sealSession`. Logo, a sessão antiga migra na primeira reselagem natural, sem varredura. Sessões que não deslizam continuam com a senha antiga até expirar.

### D-09 — Documentação (PRD: só JSDoc e nota de rotação)

**Escolha:** atualizar o JSDoc de `SessionConfig.password` (`src/utils/session.ts:40-48`) com a ordem de prioridade, o mínimo de tamanho e o limite de 4 entradas. Sem mudança no `CHANGELOG.md`, que é gerado no release.

## Arquivos a alterar

| Arquivo | Trecho | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:40-48` | `password: string \| string[]`, JSDoc com ordem, tamanho e limite |
| `src/utils/session.ts` | `:108-115` | chamar `sessionPasswords(config)` no início de `useSession` |
| `src/utils/session.ts` | `:149-165` | chamar `sessionPasswords(config)` antes do retorno de cache |
| `src/utils/session.ts` | `:241-251` | chamar `sessionPasswords(config)` no início de `updateSession` |
| `src/utils/session.ts` | `:282-304` | `seal(session, passwords[0], …)` em vez de `config.password` |
| `src/utils/session.ts` | `:312-367` | laço por senha; legado por senha; expiração depois do laço |
| `src/utils/session.ts` | final do arquivo (após `:464`) | `MAX_SESSION_PASSWORDS`, `sessionPasswords`, helpers sem `export` |
| `test/session.test.ts` | `:23`, `:137`, `:157`, `:164` | extrair `const password` string e usar em `seal`/`unseal` |
| `test/session.test.ts` | novo bloco após `:186` ou em `describe` próprio | casos de RF-01 a RF-08 (ver Estratégia de testes) |

Não mudam: `src/utils/internal/iron-crypto.ts`, `src/index.ts` (nenhum export novo), `src/utils/auth.ts` (fora de escopo), `test/bench/session.ts` (usa senha string, continua compilando).

## Contratos e assinaturas

```ts
// src/utils/session.ts — API pública (única mudança de tipo)
export interface SessionConfig {
  /**
   * ... JSDoc: a primeira senha sela; as demais só abrem sessões já emitidas.
   * Mínimo de caracteres por entrada; no máximo 4 entradas.
   */
  password: string | string[];
  // demais campos inalterados
}

// Internos (sem export)
const MAX_SESSION_PASSWORDS = 4;

/**
 * Lista de senhas da configuração, na ordem de prioridade.
 * Lança erro se a lista estiver vazia, tiver mais de MAX_SESSION_PASSWORDS
 * entradas ou alguma entrada for mais curta que o mínimo do seal.
 */
function sessionPasswords(config: SessionConfig): readonly string[];

/** Desseleia com uma senha e o fallback legado; lança "Bad hmac value" se não validar. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session> & { [kLegacySeal]?: true }>;
```

Comportamento de `unsealSession` (assinatura pública inalterada):

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
// 1. passwords = sessionPasswords(config)
// 2. para cada password: tenta unsealWithPassword; se erro !== "Bad hmac value", relança
// 3. se nenhuma valida, relança o último "Bad hmac value"
// 4. aplica maxAge e idleTimeout sobre o resultado (inalterado)
```

`sealSession`, `updateSession`, `useSession`, `getSession`: assinaturas inalteradas; mudam só o uso de `passwords[0]` e a validação no início.

## Estratégia de testes

Seguindo `AGENTS.md`, cada caso usa `describeMatrix` (web e node) em `test/session.test.ts`. Para RF-05, que exige chamar as funções sem rota, usar `mockEvent` (exportado de `src/index.ts`) e `expect(...).rejects`. Erros em handlers são registrados em `t.errors` e auto-asserted, então os casos com erro esperado devem chamar as funções direto, fora de rota.

Ordem de implementação (ciclo do AGENTS, "Bug Fix Workflow" adaptado a feature): escrever os testes de RF-02/RF-03/RF-05/RF-06/RF-07/RF-08 primeiro, confirmar que falham, implementar, confirmar que passam.

| Caso | Requisito | Verificação |
| --- | --- | --- |
| Compila com lista | RF-01 | `tsc --noEmit` (`pnpm typecheck`) cobre `test/` |
| Token selado com a primeira abre só com ela | RF-02 | `unseal(token, pw0)` ok; `unseal(token, pw1)` rejeita |
| Sessão de senha antiga é preservada | RF-03 | cookie com `pw1` → `getSession` devolve `id` e `data` originais |
| Cookie de senha desconhecida vira sessão vazia | RF-03 | sem erro propagado, `data` `{}`, id novo |
| Lista de uma entrada = string | RF-04 | token de `[pw]` abre com `pw`; suíte existente passa sem mudar asserts |
| `password: []` falha em `useSession`, `getSession`, `updateSession` | RF-05 | `rejects.toThrow` com mensagem; sem `Set-Cookie` |
| Entrada curta na cauda falha na configuração | RF-05, Risco 2 | `rejects.toThrow`, mesmo com cookie válido de outra senha |
| Mais de 4 entradas falha | D-06 | `rejects.toThrow` |
| Legado com senha da cauda, fallback ligado | RF-06 | sessão aberta; `Set-Cookie` resselado com `pw0` |
| Legado com senha da cauda, `legacySealFallback: false` | RF-06 | sessão não aberta, como hoje |
| Idle com senha antiga passando da metade | RF-07 | `Set-Cookie` com `pw0`; depois, só `pw0` abre (usar `vi.useFakeTimers`, como em `test/session.test.ts:188`) |
| Header `x-h3-session` com senha antiga | RF-08 | sessão aberta com `id` e `data` originais |
| `shouldSlide` e expiração inalterados | RF-07, D-03 | casos existentes de idle (`test/session.test.ts:188-510`) continuam passando |
| `pnpm lint` e `pnpm typecheck` | RF-09 | comandos executados |

Regressão: a suíte completa (`pnpm vitest run`) é o critério de RF-04. Opcional: `pnpm bench:node` para confirmar que o caminho de senha única não ficou mais lento (a única adição é a validação de `sessionPasswords`, que é O(1) para string).

## Riscos

1. **Amplificação de CPU (PRD Risco 1).** Um cookie inválido gasta uma derivação de 8192 iterações por entrada, mais uma barata por entrada com fallback legado. *Mitigação:* limite de 4 entradas (D-06). Medir antes de subir o limite.
2. **Senha curta na cauda some em silêncio (PRD Risco 2).** *Mitigação:* validação de tamanho por entrada (D-05), feita antes dos `.catch`. Coberta por teste.
3. **Ordem trocada (PRD Risco 3).** Senha antiga na frente faz sessões novas saírem com ela, sem erro. *Mitigação:* documentar no JSDoc (D-09). Não há como detectar pelo código.
4. **Vazamento pela mensagem de erro (PRD Risco 4).** *Mitigação:* mensagens de D-05 não citam índice nem valor; D-07 relança a mesma mensagem de HMAC.
5. **Testes que dependem do tipo string (PRD Risco 5).** Confirmado: `test/session.test.ts:137`, `:157`, `:164`. *Mitigação:* extrair `const password` string; asserts inalterados.
6. **Migração lenta (PRD Risco 6).** Sessões que não deslizam ficam com a senha antiga até expirar. Esperado (D-08). Quem remover a senha antiga precisa esperar `maxAge`/`idleTimeout`.
7. **Vazamento de posição por tempo (novo, baixo).** O tempo de resposta revela em que posição da lista a sessão foi aberta. Revela a ordem da configuração, não a senha. Aceito.
8. **Mudança de tipo para consumidores (PRD premissa).** Código externo que lê `config.password` como string deixa de compilar. Aceito pelo pedido; registrar no release notes da versão que contiver a mudança.
9. **Objeto de configuração mutado entre chamadas.** Se a lista for alterada depois de `useSession`, a validação roda de novo a cada chamada, então o efeito é o da configuração corrente. Sem mitigação necessária; não copiar a lista para cache.
