# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/pedido.md` (contrato #1050-a) e `sdd/prd.md` (RF-01 a RF-09). Todas as citações `arquivo:linha` foram conferidas no código no estado atual do repositório (commit `bcfc458`).

## 1. Resumo

`SessionConfig.password` passa a aceitar `string | string[]`. A primeira senha sela; todas, na ordem, abrem. Uma sessão aberta com senha que não é a primeira, e lida de cookie, é re-selada na mesma requisição com a primeira. A mudança de produção fica toda em `src/utils/session.ts`. Não nasce nenhum nome público: `src/utils/internal/iron-crypto.ts` e `src/index.ts` não mudam.

## 2. Estado atual (conferido)

- Único leitor de `config.password` em `src/`: `src/utils/session.ts:300` (`seal`), `:324` e `:340` (`unseal`, incluindo a repetição do fallback legado). `src/utils/auth.ts` tem outro `password`, de `requireBasicAuth`, sem relação (`src/utils/auth.ts:15`).
- O tipo hoje é `password: string` em `src/utils/session.ts:48`, com a doc em `:40-47`.
- `unsealSession` (`src/utils/session.ts:312-367`) monta `sealOptions` (`:317-321`), tenta o unseal (`:324`) e, se falhar com exatamente `Bad hmac value`, repete com 1 iteração (`:332-347`), marcando o resultado com `kLegacySeal` (`:346`). Só depois aplica `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`).
- `getSession` engole o erro do unseal (`:196-197`, `.catch(() => {})`). Se a sessão veio de cookie e há `kLegacySeal` ou `shouldSlide`, chama `updateSession` (`:199-202`, `:214-216`). O marcador é apagado antes de copiar para a sessão (`:200-202`).
- `sealSession` sela com `config.password` (`src/utils/session.ts:300-304`).
- `iron-crypto`: `seal` lança `Empty password` para senha falsy (`src/utils/internal/iron-crypto.ts:65-67`); `unseal` idem (`:94-96`) e lança `Bad hmac value` quando o HMAC não confere (`:135-137`). `generateKey` aplica `minPasswordlength` (`:191-196`) e `Empty password` para vazio (`:172-174`). Um array passado como senha seria tratado como `PasswordHash` (`:124-128`), por isso a lista nunca pode chegar ao `iron-crypto`.
- `src/index.ts:203` exporta só o tipo `SessionConfig`; nenhum helper de sessão novo precisa ser exportado.

## 3. Decisões de arquitetura

### D-01 — Normalização interna da lista em uma função privada de `session.ts`

**Alternativas**
- (a) Função privada (não exportada) `normalizePasswords(password: string | string[]): string[]` no fim de `src/utils/session.ts`.
- (b) Mesma função em `src/utils/internal/session.ts`.
- (c) Mudar `seal`/`unseal` do `iron-crypto` para aceitar lista.

**Escolha: (a).** O PRD limita as mudanças de produção a `src/utils/session.ts` e proíbe nome público novo; (b) também funcionaria, mas toca outro arquivo; (c) mexe em código vendorizado, com 62 testes próprios, e conflita com a semântica de `PasswordHash` (um array virar objeto de ids). A convenção do projeto ("helpers internos no fim do arquivo") também favorece (a).

Contrato:

```ts
// não exportada
function normalizePasswords(password: string | string[]): string[];
```

- `string` → `[password]`, sem validar o conteúdo. Um `""` continua falhando onde falha hoje, no `seal`/`unseal` (`Empty password`). Isso preserva o RF-06 byte a byte.
- `string[]` → lança `new Error("Empty password")` se a lista for vazia ou se algum elemento for falsy; senão devolve a própria lista.
- O mínimo de 32 caracteres continua sendo aplicado só pelo `iron-crypto` (`iron-crypto.ts:191-196`), por senha.

### D-02 — Tipo público: apenas ampliar `password`

**Alternativas**: (a) `string | string[]`; (b) tupla `[string, ...string[]]` para impor "não vazia" em tempo de compilação; (c) `string | readonly string[]`.

**Escolha: (a).** É literalmente o contrato (`pedido.md`, "Nomes públicos"). (b) rejeita `string[]` vindo de `process.env.X.split(",")`, que é o caso real de rotação, e a validação em runtime (D-01) é necessária de qualquer forma. (c) é mais permissivo com `as const`, mas foge do contrato e do RF-01; pode ser reavaliado depois, pois é um alargamento compatível.

Alteração em `src/utils/session.ts:40-48`: tipo `string | string[]` e doc reescrita explicando: a primeira sela, todas abrem na ordem, lista não vazia, mínimo de 32 caracteres cada, mantenha a lista curta e remova a senha antiga depois que as sessões forem re-seladas.

### D-03 — Selar usa só a primeira senha

`sealSession` (`src/utils/session.ts:300`) passa a chamar `seal(session, normalizePasswords(config.password)[0], {...})`. Isso cobre cookie (`updateSession`, `:267`), `sealSession` direto e o reseal de `idleTimeout`, porque todos passam por essa linha. Não há alternativa razoável: qualquer outra senha violaria o RF-02.

### D-04 — Abrir percorre a lista, com o fallback legado por senha

**Alternativas**
- (a) Para cada senha, em ordem: unseal com as iterações atuais e, se falhar com `Bad hmac value`, unseal legado com a mesma senha (decisão já registrada no PRD, "Interação com o fallback legado").
- (b) Primeiro todas as senhas com as iterações atuais, depois todas com 1 iteração.

**Escolha: (a).** Com uma senha só o fluxo é idêntico ao atual (RF-06); no caso comum de rotação recente, a senha antiga abre no primeiro formato, sem passar por 1 iteração com a senha nova. (b) é um pouco mais barato para selos legados da senha antiga, mas esse caso é raro e transitório, e (b) exige reestruturar o laço atual.

Implementação:

1. Extrair o `try/catch` atual (`src/utils/session.ts:322-348`) para uma função privada que recebe uma senha:

   ```ts
   async function unsealWithPassword(
     sealed: string,
     password: string,
     config: SessionConfig,
     sealOptions: SealOptions,
   ): Promise<Partial<Session>>;
   ```

   Ela mantém exatamente a lógica atual: `unseal`, condições do fallback legado (`legacySealFallback === false`, `iterations === 1`, erro que não seja `Bad hmac value`) e o `kLegacySeal`. `SealOptions` já é importado (`:9`).
2. `unsealSession` itera sobre `normalizePasswords(config.password)`:

   ```ts
   const passwords = normalizePasswords(config.password);
   let unsealed: Partial<Session> | undefined;
   let found = false;
   let firstError: unknown;
   for (const [index, password] of passwords.entries()) {
     try {
       unsealed = await unsealWithPassword(sealed, password, config, sealOptions);
       found = true;
       if (index > 0 && unsealed) (unsealed as any)[kLegacySeal] = true; // ver D-05
       break;
     } catch (error) {
       if (!isBadHmac(error)) throw error;
       firstError ??= error;
     }
   }
   if (!found) throw firstError;
   ```

   `isBadHmac` é inline (`error instanceof Error && error.message === "Bad hmac value"`), no mesmo estilo da checagem atual. Um `found` separado é necessário porque `unseal` devolve `null` quando o payload é vazio (`iron-crypto.ts:149`), e `unsealed` sozinho não distingue "abriu e veio null" de "não abriu".
3. A verificação de `maxAge`/`idleTimeout` (`:349-365`) fica após o laço, sem alteração. Ela só roda depois de um unseal bem-sucedido (RF-03).

### D-05 — Quais erros avançam para a próxima senha, e qual erro é propagado

**Alternativas**: (a) avançar só em `Bad hmac value`; (b) avançar em qualquer erro; (c) propagar o último erro em vez do primeiro.

**Escolha: (a) com propagação do primeiro erro.**
- `Bad hmac value` é o único sinal de "senha errada" (`iron-crypto.ts:135-137`). Os demais erros do `unseal` — `Incorrect number of sealed components`, `Wrong mac prefix`, `Invalid expiration`, `Expired seal` (`:99-118`) — acontecem antes de qualquer uso da senha e valem para todas as senhas. Avançar neles gastaria PBKDF2 à toa, ou nem chegaria a gastar, e isso é o que o PRD pede ao dizer que o erro de expiração não pode virar nova tentativa. Erros de configuração, como `Password string too short`, também são propagados na hora, em vez de escondidos atrás de uma senha seguinte.
- Propagar o erro da primeira senha mantém as mensagens atuais para qualquer configuração com uma senha só e para o caso "ninguém abre" (RF-04). Com (c), a mensagem dependeria de uma senha secundária, o que seria ambíguo.
- "Session expired!" (`:353`, `:363`) continua vindo depois do unseal e nunca dispara novas tentativas.

### D-06 — Reseal da senha não primária reaproveita `kLegacySeal`

**Alternativas**
- (a) Reaproveitar o marcador interno `kLegacySeal` (`src/utils/internal/session.ts:7`) como "precisa re-selar" e atualizar o comentário.
- (b) Criar um símbolo interno novo (por exemplo `kResealSeal`) em `src/utils/internal/session.ts`.
- (c) Fazer `getSession` reabrir para descobrir qual senha serviu.

**Escolha: (a).** `getSession` já faz exatamente o que o RF-05 pede com esse marcador (`src/utils/session.ts:199-202`, `:214-216`): remove-o antes de copiar para a sessão, só re-sela quando `session.id && sessionFromCookie`, e `updateSession` sela com a primeira senha (D-03). Isso dá de graça "sessões lidas do header não são re-seladas" e "`id` e dados não mudam". (b) é semanticamente mais limpo, mas exige tocar `internal/session.ts`, fora do escopo do PRD ("Mudanças fora de `src/utils/session.ts` além de testes e documentação"). (c) duplica custo de PBKDF2 sem ganho.

Consequência: o nome `kLegacySeal` fica levemente impreciso. Mitigação: comentário em `src/utils/session.ts:199` e na marcação do D-04 explicando que o marcador vale para "selo legado ou senha secundária". Se a equipe preferir (b), é um acréscimo mecânico de 2 linhas e não altera as demais decisões.

Efeito observável: um `Set-Cookie` novo em requisições que antes não o tinham, só enquanto houver sessões seladas com senha secundária. É intencional (RF-05, risco "Reseal inesperado") e será documentado.

Um selo legado (1 iteração) aberto com a senha secundária recebe o mesmo marcador, e o reseal usa a primeira senha com as iterações atuais (RF-08).

### D-07 — Validação explícita também em `getSession`

Hoje `getSession` descarta qualquer erro do unseal (`:196-197`). Com `password: []`, uma requisição com cookie viraria silenciosamente uma sessão nova em memória, e um `getSession` sem escrita nunca chegaria ao `seal`. Isso contraria o RF-07 ("erro explícito").

**Alternativas**: (a) chamar `normalizePasswords(config.password)` no início de `getSession`, antes de criar a sessão em `context.sessions` (`src/utils/session.ts:153-155`); (b) validar só em `sealSession`/`unsealSession`.

**Escolha: (a).** A chamada vem antes de `context.sessions![sessionName] = session` (`:173`) para não deixar uma sessão pela metade no contexto quando a configuração é inválida. `useSession` e `updateSession` passam por `getSession`; `sealSession` e `unsealSession` chamam `normalizePasswords` por conta própria (D-03, D-04), então as cinco funções do RF-01 falham do mesmo jeito. A custo é um laço sobre um array curto. Para `string` não há mudança de comportamento (D-01).

### D-08 — Sem alteração de formato, algoritmo ou iterações

O selo continua `Fe26.2*…` com a senha como string; `RawPassword` nunca recebe array. Objetos de senha (`{ id, secret }`), `Uint8Array` e o parâmetro `extraUnsealPasswords` ficam fora (PRD, "Fora de escopo").

## 4. Arquivos a alterar

| Arquivo | Linhas hoje | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:40-48` | Tipo `string \| string[]` e doc de rotação (D-02). |
| `src/utils/session.ts` | `:153-155` | Chamar `normalizePasswords` antes de criar a sessão (D-07). |
| `src/utils/session.ts` | `:199-202` | Comentário: `kLegacySeal` também vale para senha secundária (D-06). |
| `src/utils/session.ts` | `:300` | `seal(session, normalizePasswords(config.password)[0], …)` (D-03). |
| `src/utils/session.ts` | `:317-348` | Laço sobre as senhas e extração de `unsealWithPassword` (D-04, D-05). |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | `normalizePasswords` e `unsealWithPassword` privadas (D-01, D-04). |
| `test/session.test.ts` | `:21-25`, `:137`, `:157`, `:164` | Ajuste de tipos (seção 6.1) e novos testes (6.2). |
| `docs/4.examples/handle-session.md` | `:143` e antes de `:151` | Ajustar "Every option is optional except `password`" se necessário e nova seção "Rotate the password" (seção 7). |

Não mudam: `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts`, `src/index.ts`, `src/utils/auth.ts`, `test/bench/session.ts` (usa string, continua válido). `test/unit/types.test-d.ts` não tem nenhuma cobertura de `SessionConfig` (busca por `Session` sem resultados), então, conforme o RF-09, o type test é opcional; ver 6.3.

## 5. Contratos e assinaturas

Públicos (único nome alterado, nenhum novo):

```ts
export interface SessionConfig {
  password: string | string[]; // lista não vazia; [0] sela, todas abrem na ordem
  // demais campos inalterados
}
// useSession, getSession, updateSession, sealSession, unsealSession: assinaturas inalteradas
```

Privados em `src/utils/session.ts` (não exportados, sem entrada em `src/index.ts`):

```ts
function normalizePasswords(password: string | string[]): string[];
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Comportamento:

| Entrada | `sealSession` | `unsealSession` / `getSession` |
| --- | --- | --- |
| `"s"` ou `["s"]` | sela com `s` | idêntico ao atual |
| `[nova, antiga]` | sela com `nova` | tenta `nova`, depois `antiga`; abriu com `antiga` → `kLegacySeal` → reseal com `nova` (cookie) |
| nenhuma abre | — | `unsealSession` lança o `Bad hmac value` da primeira senha; `getSession` descarta e cria sessão nova |
| `[]` ou elemento vazio | lança `Empty password` | lança `Empty password` (também em `getSession`) |
| selo expirado/malformado | — | erro original, sem tentar outras senhas |

## 6. Estratégia de testes

Todos em `test/session.test.ts`, com `describeMatrix`, rodando em `web` e `node`. Fluxo de bug/feature do AGENTS.md: escrever os testes novos antes e confirmar que falham; implementar; confirmar que passam; rodar a suíte.

### 6.1 Ajuste dos testes existentes (só o que depende da mudança)

`sessionConfig.password` (`test/session.test.ts:23`) passa a ser `string | string[]`, e é passado como `RawPassword` a `seal`/`unseal` em `:137`, `:157` e `:164`, o que deixa de tipar. Correção: extrair uma constante local `const password = "1234567123456712345671234567123456712345671234567"` antes de `sessionConfig` (`:21`), usar `password` em `sessionConfig` e nas três chamadas. Os demais usos de `password: sessionConfig.password` (`:195` em diante) só copiam o valor para outro `SessionConfig` e continuam tipando. Nada que os testes verificam é perdido.

### 6.2 Testes novos (mapeados aos RFs)

Auxiliar local: `sealWith(password, { iterations? })` usando `seal` e `sealDefaults` (já importados em `:12`), e uma rota própria por teste com `generateId` controlável, como nos testes atuais.

- **RF-01**: com `password: [nova, antiga]` e com string, `useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession` executam sem erro.
- **RF-02**: criar sessão com `[nova, antiga]`; o cookie abre com `unseal(…, nova, sealDefaults)` e falha com `antiga` (`Bad hmac value`).
- **RF-03**: selo feito com `antiga`, config `[nova, antiga]` → mesmo `id` e dados, sem gerar `id` novo. Variante com `maxAge` mostrando que a expiração vale depois do unseal (`vi.useFakeTimers({ toFake: ["Date"] })`, como nos testes de `idleTimeout`).
- **RF-04**: selo feito com `removida` → `id` novo, dados vazios, `t.errors` vazio (assertado no `afterEach`). Chamada direta a `unsealSession` rejeita com `Bad hmac value`, mensagem igual à da primeira senha sozinha.
- **RF-05**: cookie selado com `antiga`, config `[nova, antiga]` → exatamente um `Set-Cookie`; o valor abre com `nova` sozinha (`unseal`), `id`/dados iguais. Caso do header `x-h3-test-session`: sem `Set-Cookie`. Caso com selo na senha primária: sem `Set-Cookie` (sem reseal desnecessário).
- **RF-06**: suíte existente intacta passa; teste cruzado `string` ↔ `[string]` (selo de um abre no outro).
- **RF-07**: `password: []` e `password: [nova, ""]` → `Empty password` em `sealSession`, `unsealSession`, `useSession` e `getSession`; nenhuma sessão criada nem aceita, mesmo com cookie válido na requisição. Rota que captura o erro e o devolve no corpo, para a asserção ser independente do runtime. `password: ""` (string) mantém o comportamento atual.
- **RF-08**: selo de 1 iteração com `antiga`, config `[nova, antiga]` → sessão recuperada, reseal com `nova` e iterações atuais (`unseal(resealed, nova, sealDefaults)` sem fallback). Com `legacySealFallback: false` → rejeitado (id novo). Também o selo legado com a senha primária ainda funciona.
- **Erros não avançam senha (D-05)**: selo com `expiration` vencida e `[nova, antiga]` → erro de expiração, não `Bad hmac value`; verificado via `unsealSession` direto com `seal.ttl` curto, ou com `vi.spyOn` no `unseal`, se o teste ficar difícil de estabilizar.

### 6.3 Type test

`test/unit/types.test-d.ts` não cobre `SessionConfig`; não criar um bloco só para isso é aceitável pelo RF-09. Se a revisão pedir, o mínimo é `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`.

### 6.4 Comandos de verificação

`pnpm vitest run test/session.test.ts` (novos testes falham antes do código, passam depois), `pnpm vitest run test/unit/iron-crypto.test.ts` (não deve mudar), `pnpm lint`, `pnpm typecheck` e, no fim, `pnpm test`.

## 7. Documentação

Em `docs/4.examples/handle-session.md`:
- `:143` diz "Every option is optional except `password`"; acrescentar que `password` também aceita lista.
- Nova seção `## Rotate the Password`, antes de `## Expiration` (`:151`), com: o exemplo `password: [process.env.SESSION_PASSWORD_NEW, process.env.SESSION_PASSWORD_OLD]`; a regra "primeira sela, todas abrem"; o reseal automático de cookies e a exceção do header; o passo operacional "remova a senha antiga quando o reseal acabar, e mantenha a lista curta"; e o aviso de que uma senha comprometida deixada na lista mantém sessões forjáveis.
- Nota de changelog sobre o tipo ampliado (risco R-04 abaixo). Não há changelog manual no repositório conferido; ficará como texto sugerido na PR.

## 8. Riscos

- **R-01 — Custo de CPU.** Cada tentativa roda PBKDF2 (`defaults.iterations = 8192`, `iron-crypto.ts:21`, `:27`). Um selo inválido custa até N tentativas, e com o fallback legado até 2N. Mitigação: a senha primária vai primeiro (D-04), erros que não são de senha interrompem o laço (D-05) e a doc recomenda 2–3 senhas. Não há como um atacante forçar mais do que N × 2 derivações por requisição; o custo aceito é proporcional ao tamanho da lista.
- **R-02 — Distinção de senha errada depende da mensagem do erro.** O código já se apoia em `error.message === "Bad hmac value"` (`session.ts:336`). Se o `iron-crypto` mudar essa mensagem, o fallback legado e a rotação quebram juntos. Mitigação: os testes de RF-03/RF-08 detectam isso; a checagem fica centralizada em `isBadHmac`.
- **R-03 — Senha secundária curta ou inválida.** Só é exercitada quando as anteriores falham; um `Password string too short` aparece então como erro de unseal (a sessão é descartada em `getSession`) e não na inicialização. Mitigação: documentado; a validação de vazio é imediata (D-07), a de tamanho continua do `iron-crypto` por decisão do PRD.
- **R-04 — Tipagem de terceiros.** Código que lê `config.password` como `string` deixa de compilar. É aditivo para quem configura; precisa de aviso de changelog.
- **R-05 — Reseal inesperado.** RF-05 gera `Set-Cookie` novo em leituras. Intencional, testado (6.2) e documentado (7). Combina com o `idleTimeout`: o reseal restampa `lastSeenAt`, o que já acontece em reseals legados. O aviso existente sobre requisições concorrentes em `handle-session.md:183` também se aplica a esse reseal.
- **R-06 — Nome `kLegacySeal` impreciso (D-06).** Aceito para respeitar o escopo; alternativa (b) documentada.
- **R-07 — Senha antiga esquecida na lista.** Mantém sessões forjáveis. Só documentação mitiga; não há rotação automática (fora de escopo).
- **R-08 — Mutação do array do chamador.** `normalizePasswords` devolve a própria lista e o código nunca a altera; não há cópia nem `shift`. Mitigação: manter assim e cobrir com revisão.
