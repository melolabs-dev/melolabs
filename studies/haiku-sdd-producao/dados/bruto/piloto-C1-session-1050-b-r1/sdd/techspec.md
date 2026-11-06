# Especificação técnica — Várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (RF-01 a RF-09). Esta spec define como implementar. Todas as citações `arquivo:linha` foram conferidas no código atual da pasta do clone.

## 1. Visão geral

Hoje `unsealSession` abre a sessão com uma única senha, `config.password` (`src/utils/session.ts:324`). A mudança:

1. `SessionConfig` ganha `extraUnsealPasswords` (`src/utils/session.ts:48`, perto de `password`).
2. `unsealSession` passa a tentar `[password, ...extras válidas]` em sequência, uma por vez. Cada tentativa segue o mesmo caminho de hoje: HMAC, decifragem e, se for `"Bad hmac value"`, o fallback legado com 1 iteração (`src/utils/session.ts:325-347`). Erros que não são de HMAC (formato, expiração do selo) continuam sendo lançados na hora.
3. A checagem de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continua sendo feita uma única vez, depois que alguma senha abriu a sessão, e fica fora do laço de tentativas.
4. Se a sessão abriu com uma senha extra, `unsealSession` marca o resultado com um símbolo interno (`kExtraSeal`, mesmo padrão de `kLegacySeal`). `getSession` usa esse marcador para re-selar com `password` (RF-05), no mesmo ponto em que hoje re-sela sessões legadas (`src/utils/session.ts:214`).
5. `sealSession` valida as senhas extras antes de selar (RF-06). Como `useSession` (criação), `updateSession` e a re-selagem passam por `sealSession`, a validação cobre todas as operações que selam.
6. A assinatura pública de `unsealSession`, `sealSession`, `getSession`, `useSession`, `updateSession` e `clearSession` não muda. Não há nenhum export novo em `src/index.ts`.

## 2. Decisões de arquitetura

### D-01 — Onde fica o laço de tentativas de abertura

**Alternativas**
- (a) Laço dentro de `unsealSession`, reaproveitando o `try/catch` atual, com o marcador `kExtraSeal`.
- (b) Função interna nova que devolve `{ session, senhaIndex }`, com `unsealSession` como casca. Evita o marcador, mas exige um caminho paralelo para `getSession`.
- (c) Laço no próprio `getSession`. Quebra a promessa de que `unsealSession` abre sessões com todas as senhas (RF-07 cobre `unsealSession` diretamente) e duplica lógica.

**Escolha: (a).** É o menor diff e segue o padrão já usado para `kLegacySeal`. A opção (b) só se justificaria se o marcador ficasse ambíguo, o que não acontece aqui.

### D-02 — Validação das senhas extras (RF-06)

**Alternativas**
- (a) Validar só ao tentar abrir, deixando o erro cair de `generateKey` (`src/utils/internal/iron-crypto.ts:191-196`). Não atende RF-06: se `password` abre a sessão, a extra inválida nunca é tocada e nenhum erro aparece.
- (b) Função `assertExtraPasswords(config)` chamada no início de `sealSession`, antes de qualquer selagem. Valida todas as posições da lista, independentemente da senha que abrir a sessão.
- (c) Validar na criação do `SessionConfig` (wrapper em `useSession` e nas demais funções). Muda a superfície e não cobre quem chama `sealSession` direto.

**Escolha: (b).** Validação em um ponto só, que é o único lugar onde se sela. O limite mínimo usado é `Math.max(minPasswordlength de encryption, minPasswordlength de integrity)` das opções efetivas (`{ ...sealDefaults, ...config.seal }`), porque `seal` aplica `opts.encryption` e `opts.integrity` separadamente (`src/utils/internal/iron-crypto.ts:74`, `:81`). Mensagens no formato `Invalid extra password at index N: must not be empty` e `Invalid extra password at index N: must be at least M characters`. Nenhuma inclui o valor.

Observação: `sealSession` só é chamado quando há cookie e `res` (`src/utils/session.ts:266`). Com `cookie: false`, nada é selado e não há validação. Isso é coerente com "operações que selam".

### D-03 — Ordem de tentativa: legado por senha ou legado no fim

**Alternativas**
- (a) Para cada senha, tenta a normal e depois a legada (1 iteração), e só então passa para a próxima senha.
- (b) Tenta todas as senhas com as opções atuais e só no fim tenta as legadas, cada uma.

**Escolha: (a).** Mantém a ordem "uma de cada vez" do contrato (`pedido.md` item 3) e a re-selagem legada vale para qualquer senha (RF-08). O custo extra é desprezível, porque a tentativa legada usa 1 iteração (`src/utils/session.ts:341-342`).

### D-04 — Marcador de abertura por senha extra e limpeza antes do merge

**Alternativas**
- (a) Símbolo `kExtraSeal` em `src/utils/internal/session.ts`, definido ao lado de `kLegacySeal` (`src/utils/internal/session.ts:7-9`).
- (b) Campo público no retorno. Viola "nenhum nome público novo".
- (c) Comparar o `password` usado. Não é possível, porque `unseal` não devolve qual senha abriu.

**Escolha: (a).** Como `Object.assign(session, unsealed)` copia símbolos próprios (`src/utils/session.ts:208`), o marcador deve ser removido de `unsealed` antes da cópia, como `kLegacySeal` já é (`src/utils/session.ts:199-203`). `JSON.stringify` não serializa símbolos, então o marcador não vaza para o cookie.

### D-05 — Extras inválidas durante a abertura

**Alternativas**
- (a) Lançar erro na abertura. Um laço com extra inválida em uma posição interrompe a tentativa das demais, e um erro de configuração quebra leituras que não dependem dela.
- (b) Ignorar as extras inválidas na abertura, tratando-as como senhas desconhecidas. A validação de D-02 continua rejeitando na selagem.

**Escolha: (b).** Abertura usa só as extras válidas (`filter` com a mesma regra de D-02). Assim, uma configuração ruim não impede a abertura pela senha correta nem pelas extras válidas. A consequência é que um erro de configuração só aparece na primeira escrita. Está listado em riscos.

### D-06 — `clearSession` e chunks não mudam

**Fatos verificados**
- `clearSession` não chama `unseal`. Ele apenas remove o cookie principal e os chunks (`src/utils/session.ts:372-386`, `src/utils/cookie.ts:251-265`). Logo RF-07 é cumprido sem código novo; o teste apenas confirma.
- Chunks: `setChunkedCookie` remove chunks antigos quando o novo valor tem menos pedaços (`src/utils/cookie.ts:215-225`). A re-selagem da D-04 passa por `updateSession` e aproveita essa limpeza. Não é preciso lógica nova.

**Escolha:** nenhuma mudança nessas duas funções. Testes cobrem o caminho.

### D-07 — Sessões do cabeçalho não são re-seladas

**Fatos verificados:** `sessionFromCookie` é `false` quando a sessão vem do cabeçalho (`src/utils/session.ts:189`, `:192`), e a condição de re-selagem exige `sessionFromCookie` (`src/utils/session.ts:214`). RF-05 já é atendido com a condição nova `(legacySeal || extraSeal || shouldSlide(...))` mantendo `sessionFromCookie`.

### D-08 — Tipo do campo

**Escolha:** `extraUnsealPasswords?: readonly string[]`. Aceita arrays mutáveis e imutáveis, não muda o tipo de `password` (`src/utils/session.ts:48`) e não cria nome público além do campo.

## 3. Arquivos a alterar

| Arquivo | Alteração |
|---|---|
| `src/utils/session.ts:48` | Adicionar `extraUnsealPasswords?: readonly string[]` após `password`, com JSDoc (aceitas só para abrir; nunca selam; lista curta e temporária). |
| `src/utils/session.ts:95` | Documentar, no JSDoc de `legacySealFallback`, que o fallback vale para todas as senhas. |
| `src/utils/session.ts:196` | Nada muda na chamada de `unsealSession`. |
| `src/utils/session.ts:199-203` | Remover também o marcador `kExtraSeal` de `unsealed` antes de `Object.assign`. |
| `src/utils/session.ts:214` | Condição passa a ser `session.id && sessionFromCookie && (legacySeal \|\| extraSeal \|\| shouldSlide(session, config))`. |
| `src/utils/session.ts:300` (dentro de `sealSession`, antes de `seal`) | Chamar `assertExtraPasswords(config)`, primeira instrução após a obtenção da sessão (`:291`) ou antes dela. |
| `src/utils/session.ts:324-347` | Substituir o `try/catch` único por um laço sobre `[config.password, ...validExtras]`, mantendo o fallback legado por senha e o `throw` original quando nenhuma abre. |
| `src/utils/session.ts:350-365` | Sem mudança de lógica; continua depois do laço. |
| `src/utils/internal/session.ts:7-9` | Novo `export const kExtraSeal: unique symbol = Symbol.for("h3.internal.session.extra-seal")`. |
| `test/session-extra-passwords.test.ts` | Novo arquivo de testes (ver seção 5). Mantém `test/session.test.ts` intacto (RF-09). |

Não alterar: `src/index.ts` (exports de `sealSession` e `unsealSession` em `:208-209` permanecem), `src/utils/cookie.ts`, `src/utils/internal/iron-crypto.ts`. `CHANGELOG.md` é gerado e não deve ser editado. Não verifiquei se existe documentação fora de `src` e `sdd` que descreva `SessionConfig`; se existir, deve receber o novo campo (AGENTS.md pede manter a documentação atualizada).

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — campo público novo
export interface SessionConfig {
  password: string;                       // inalterado (src/utils/session.ts:48)
  extraUnsealPasswords?: readonly string[]; // novo: só abre sessões
  // ... demais campos inalterados
}

// src/utils/internal/session.ts — símbolo interno novo
export const kExtraSeal: unique symbol;

// src/utils/session.ts — helpers internos (não exportados)
function assertExtraPasswords(config: SessionConfig): void;
// lança Error se alguma extra for vazia ou menor que o mínimo; mensagem contém "password", nunca o valor.

function validExtraPasswords(config: SessionConfig): string[];
// extras que passam na mesma regra de assertExtraPasswords, sem lançar (usado na abertura, D-05).

async function unsealOnce(sealed: string, password: string, sealOptions: SealOptions): Promise<{ data: Partial<Session>; legacy: boolean }>;
// uma senha: unseal normal; em "Bad hmac value" tenta o legado com 1 iteração (se legacySealFallback !== false).
// Lança o erro original se não abrir; outros erros são propagados sem tentar a próxima senha.
```

Contrato de comportamento de `unsealSession` (assinatura pública inalterada):

- Ordem de tentativa: `config.password`, depois cada extra válida na ordem da lista.
- Para no primeiro sucesso. Se `password` abre, nenhuma extra é tentada.
- Se nenhuma abre com `"Bad hmac value"`, lança o erro da primeira tentativa, para que `getSession` (que engole o erro em `src/utils/session.ts:197`) se comporte como hoje.
- Erros que não são `"Bad hmac value"` (`"Wrong mac prefix"`, `"Incorrect number of sealed components"`, `"Invalid expiration"`, `"Expired seal"`, `"Empty password"`) são propagados imediatamente.
- Se a sessão abriu por uma extra, marca o retorno com `kExtraSeal = true`.
- Depois da abertura, aplica `maxAge` e `idleTimeout` como hoje (`src/utils/session.ts:350-365`).

Contrato de `sealSession`: se `assertExtraPasswords` lançar, a função rejeita antes de qualquer `seal`. Usa sempre `config.password`.

Contrato de `getSession`: se a sessão veio de cookie e `kExtraSeal` está marcado, chama `updateSession` (que re-sela com `password`), gerando um `Set-Cookie`. Erros de `updateSession` nesse caminho propagam, como já acontece com a re-selagem legada (`src/utils/session.ts:215`, dentro do `.then`, fora do `.catch`).

Nenhuma mudança em `updateSession` e `clearSession`.

## 5. Estratégia de testes

Seguir `AGENTS.md`: `describeMatrix` (web e node), `ctx.app` novo por teste, `Bug Fix Workflow` não se aplica diretamente, mas a regra de escrever os testes antes da implementação vale. Os testes novos ficam em `test/session-extra-passwords.test.ts`. Senhas de teste com 32 ou mais caracteres, como `sessionConfig.password` em `test/session.test.ts:23`.

Casos, mapeados aos RFs:

| Caso | RF | Como verificar |
|---|---|---|
| Config sem extras e com `[]` produzem o mesmo cookie, `id`, `createdAt` e dados | RF-01, RF-09 | Comparar resposta com e sem o campo |
| `sealSession` com `P1` e extra `P0` gera cookie aberto só por `P1` | RF-02 | `unseal` direto com `P1` ok e `P0` falha |
| Cookie selado com `P0` abre em `getSession`, preservando `id`, `createdAt` e dados | RF-03 | Handler retorna `session` |
| Cookie selado com `P1` não tenta `P0` (sem trabalho extra) | RF-03 | `vi.spyOn(crypto.subtle, "deriveBits")` contando chamadas; confirmar que o método é interceptável no runtime de cada target da matriz |
| Cookie com `P9` (desconhecida) resulta em sessão vazia, sem `Set-Cookie` | RF-04, RF-09 | Resposta sem `set-cookie` |
| `useSession` com cookie `P0` e handler só de leitura gera `Set-Cookie` com `P1` | RF-05 | `unseal` do cookie novo com `P1` |
| Cookie `P1` com handler só de leitura não gera `Set-Cookie` | RF-05 | `getSetCookie()` vazio |
| Sessão do cabeçalho com `P0` não gera `Set-Cookie` | RF-05, RF-07 | Header `x-h3-test-session` |
| Extras inválidas (vazia, 31 caracteres, em posição 0 e em posição 2) fazem `updateSession`, `sealSession` e `useSession` (criação) rejeitar; mensagem casa com `/password/i` e não contém o valor | RF-06 | `rejects.toThrow` com checagem de mensagem |
| Extra inválida com `password` válida, em leitura que abre por `password`, não lança | RF-06, D-05 | Leitura sem erro |
| Cookie em chunks (`chunkMaxLength` pequeno) aberto por `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession` | RF-07 | Cada função; para `clearSession`, cookie principal e chunks recebem `Max-Age=0` |
| Re-selagem de cookie em chunks com `P1` remove chunks antigos quando o número de pedaços diminui | RF-07, risco de chunks | Procurar `Max-Age=0` para `name.N` sobrando |
| Sessão legada (1 iteração) selada com `P0` abre e re-sela com `P1` | RF-08 | `unseal` com opções padrão |
| Legado com `P0` e `legacySealFallback: false` vira sessão vazia | RF-08 | Resposta sem id |
| Extras em ordem: cookie com a segunda extra abre; nenhuma extra antes dela é aberta com sucesso | RF-03 | Contar `deriveBits` ou validar só o resultado |
| `clearSession` com config que só tem extras limpa o cookie | RF-07 | `Max-Age=0` no cookie |

Regressão: `pnpm vitest run test/session.test.ts` deve passar sem alterações. Depois, `pnpm vitest run test/session-extra-passwords.test.ts`, `pnpm lint` (que inclui typecheck, segundo `AGENTS.md`) e `pnpm test` (lint, typecheck e cobertura). O benchmark `test/bench/session.ts` não é exigido, mas vale rodar se houver dúvida de custo.

Não há validação real contra o sistema de cookies de um navegador; os testes usam `t.fetch` e inspeção de `Set-Cookie`, que é o mesmo padrão de `test/session.test.ts`.

## 6. Riscos

1. **Custo de CPU por senha tentada.** Cada tentativa que falha custa uma derivação PBKDF2 de 8192 iterações, porque `unseal` calcula o HMAC antes de decifrar (`src/utils/internal/iron-crypto.ts:133-137`). Uma senha extra no fim da lista custa quase o dobro de abrir pela primária. Mitigação: documentar que a lista deve ser curta e temporária (já é o que o PRD diz, `prd.md` riscos).
2. **Escrita em GET.** A re-selagem por extra gera `Set-Cookie` em requisições de leitura. É o mesmo efeito da re-selagem legada de hoje. Sem mitigação além da documentação.
3. **Erro de configuração silencioso na leitura (D-05).** Uma extra inválida é ignorada na abertura. Se o app só lê, o erro não aparece. Mitigação: a validação de D-02 dispara na primeira escrita, e um teste cobre a regra.
4. **Erro na re-selagem de leitura.** Se uma extra inválida existe e a sessão abre por extra válida, a re-selagem chama `sealSession` e a leitura falha. É o comportamento desejado (configuração inválida não deve passar em silêncio ao selar), mas muda a resposta de uma leitura. Vale registrar.
5. **Mensagem de senha curta existente.** `generateKey` lança `"Password string too short..."` com `P` maiúsculo (`src/utils/internal/iron-crypto.ts:194`). Não casa com `/password/` minúsculo. A regra nova de D-02 usa mensagens próprias com `password` minúsculo, então o caminho de validação não depende dessa mensagem. A mensagem existente para `password` não muda, como exige o PRD.
6. **Vazamento do marcador ou da senha.** O símbolo `kExtraSeal` precisa ser removido antes de `Object.assign` (D-04). Caso contrário, a sessão em memória carrega o marcador, e a próxima re-selagem poderia repetir a re-selagem. Teste de re-selagem sem repetição cobre isso.
7. **Erros de expiração depois de falha.** `"Expired seal"` é lançado antes do HMAC (`src/utils/internal/iron-crypto.ts:110-117`). Com a ordem de D-03, o primeiro erro não-HMAC interrompe o laço. Como o `ttl` é o mesmo para todas as senhas, o resultado é igual ao de hoje.
8. **Erro de HMAC mascarado.** Se `password` falhar com HMAC e uma extra falhar com outro erro (por exemplo, `"Wrong mac prefix"` de um selo malformado), o erro propagado é o da primeira tentativa, sem a causa da segunda. Para `getSession` o efeito é o mesmo (sessão vazia). Para `unsealSession` chamado direto, a mensagem pode ser menos informativa.
9. **Convenção de tamanho.** `src/utils/session.ts` já tem 465 linhas, acima da meta de 200 do `AGENTS.md`. Os helpers novos podem ir para `src/utils/internal/` (regra de `AGENTS.md`). Isso é opcional e não bloqueia a entrega.
10. **Premissa do PRD sobre cabeçalho.** Sessões do cabeçalho não são re-seladas (D-07). O PRD marca como "ambiguidade a confirmar" se o cliente precisa de outro sinal para migrar. Esta spec mantém o contrato e não resolve o ponto.
