# Especificação técnica — Múltiplas senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-08, R-01 a R-06), issue h3js/h3#1050.

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `adf8e61`, branch `master`).

## Resumo

- `SessionConfig` ganha `extraUnsealPasswords?: string[]`. `password` continua selando, sozinha.
- A abertura de cookie passa a tentar `password` e depois as extras, em ordem, dentro de `unsealSession`. A assinatura pública dela não muda.
- O fallback legado (1 iteração PBKDF2) é uma segunda passagem sobre a mesma lista, executada só depois que a passagem normal falha em todas as senhas.
- Abrir um cookie com uma senha extra dispara o reselo, que já existe em `getSession`. Assim a rotação migra as sessões sem depender de `idleTimeout`.
- Senhas são validadas com a mesma regra e a mesma mensagem de iron (`minPasswordlength`), no ponto em que a sessão é selada ou aberta.
- Nenhum nome público novo além do campo. Nenhuma mudança no formato do seal, em `iron-crypto` além de uma função auxiliar interna, ou em cookies chunked.

## Premissas revisadas

Lendo o código, três premissas do PRD mudam ou ganham nuance:

- **P-01 (parcialmente incorreta).** O seal tem um slot de identificador de senha: `iron-crypto.ts:68` lê `id` de `normalizePassword`, e `iron-crypto.ts:103` separa `passwordId` na posição 2 do seal. Para `password` em string, esse slot fica vazio (`""`, `iron-crypto.ts:68` e `:79`). No unseal, com senha em string, o `passwordId` não é conferido (`iron-crypto.ts:121-122`). Na prática a conclusão do PRD vale: a biblioteca não sabe qual senha selou e precisa tentar em sequência. Mas o slot existe, e um futuro `kid` poderia reaproveitá-lo sem mudar o formato. Isso fica fora de escopo.
- **P-03 (decisão tomada).** O PRD deixa em aberto se a migração só ocorre pelo gatilho existente. Ver D-05: abrir com senha extra passa a ser um gatilho de reselo.
- **P-04 (confirmada, com ressalva).** A regra de comprimento está em `iron-crypto.ts:191-196`, dentro de `generateKey`, e usa `options.minPasswordlength`. Esse valor vem de `sealOptions`, que pode ser sobrescrito por `config.seal` (`session.ts:88`). A validação nova deve usar o valor efetivo, não o padrão `sealDefaults`.

## Decisões de arquitetura

### D-01 — Onde fica a tentativa de senhas: `unsealSession`

**Escolha.** A lista de senhas é tratada em `src/utils/session.ts`, dentro de `unsealSession` (`session.ts:312-367`), que já é o ponto onde o fallback legado acontece. `iron-crypto.ts` continua recebendo uma senha por chamada.

**Alternativas.**
- *Forma de hash do iron* (`unseal(sealed, { [id]: senha })`, `iron-crypto.ts:124-125`). Rejeitada. O iron escolhe uma chave pelo `passwordId` do seal, e o seal atual grava `""` para senhas em string. Um hash com `default` só aceita uma senha. Usar várias exigiria gravar um `kid` no seal, que está fora de escopo (PRD, "Fora de escopo").
- *Loop dentro de `iron-crypto.ts`*. Rejeitada. Espalharia regra de sessão (contrato de `SessionConfig`, fallback legado) por uma camada que hoje é só criptografia, e o PRD pede mudança mínima nela.

**Justificativa.** Mantém a mudança numa única função, que já tem a lógica de fallback e de expiração, e deixa `iron-crypto.ts` intocado além da função auxiliar de D-02.

### D-02 — Campo e validação das senhas extras

**Escolha.**
- Campo `extraUnsealPasswords?: string[]` em `SessionConfig`, logo após `password` (`session.ts:48`).
- Uma função interna `unsealPasswords(config)` devolve `[password, ...extras]` sem duplicatas (ver D-06).
- Validação eager: `sealSession` (`session.ts:282`) e `unsealSession` (`session.ts:312`) chamam `assertPasswordLength` para cada item da lista, antes de qualquer trabalho criptográfico.
- `assertPasswordLength` é extraída de `generateKey` (`iron-crypto.ts:191-196`) para `iron-crypto.ts`, com a mesma mensagem: `Password string too short (min N characters required)`. `generateKey` passa a chamá-la, então a mensagem continua vindo de um único lugar.

**Alternativas.**
- *Validar só quando a senha é usada*. Rejeitada. Uma extra inválida só falharia se nenhuma senha anterior abrisse o cookie. Isso viola RF-08 e faz o erro depender da ordem.
- *Duplicar a mensagem em `session.ts`*. Rejeitada. Dois lugares com a mesma mensagem tendem a divergir, e o teste de RF-08 ficaria acoplado a um texto.

**Justificativa.** RF-08 pede o mesmo erro que uma `password` curta produz. Validando a lista inteira nos dois caminhos, o efeito é idêntico ao da `password` hoje: leitura silenciosa (o `.catch` de `getSession`, `session.ts:198`) e erro na escrita (`seal` em `sealSession`).

### D-03 — Ordem do fallback legado: duas passagens

**Escolha.** `unsealSession` faz:
1. Passagem normal: tenta cada senha de `unsealPasswords(config)` em ordem.
2. Só se a passagem 1 falhar com `Bad hmac value` em todas, e se o fallback legado estiver habilitado, passagem 2: tenta cada senha de novo, com as opções legadas (1 iteração).

**Alternativas.**
- *Por senha*: para cada senha, normal e depois legado. Rejeitada. Uma sessão atual aberta pela segunda senha passaria pela tentativa legada de todas as senhas antes de chegar lá, e a lógica do fallback ficaria entrelaçada com a lista.

**Justificativa.** O caso comum (sessão atual, selada com alguma das senhas) fica sem tentativas legadas. O caminho legado fica isolado em uma passagem, o que torna a remoção na v3 (já anunciada em `session.ts:326-327`) é a remoção de um bloco só. Com lista de uma senha, a sequência de chamadas é idêntica à de hoje: normal com `password`, depois legado com `password`.

### D-04 — Como `getSession` sabe que uma extra abriu o cookie

**Escolha.** Um símbolo interno novo, `kExtraUnseal`, em `src/utils/internal/session.ts` (junto de `kLegacySeal`, `:7-8`), com `Symbol.for("h3.internal.session.extra-unseal")`. `unsealSession` marca o objeto devolvido quando a senha que abriu não é a primeira da lista. `getSession` lê, apaga e decide o reselo, do mesmo jeito que já faz com `kLegacySeal` (`session.ts:199-201`).

**Alternativas.**
- *Mudar `unsealSession` para devolver uma tupla ou `{ session, usedExtra }`*. Rejeitada. `unsealSession` é exportada (`src/index.ts:209`) e aparece no snapshot de exports (`test/unit/package.test.ts:149`). Mudar o retorno quebraria a API pública.
- *Comparar o cookie com o resultado de `sealSession` para decidir*. Rejeitada. Custaria um seal extra, que é o que o código tenta evitar (`session.ts:400-407`).

**Justificativa.** Segue o padrão já usado para o fallback legado, sem mudar nenhuma assinatura pública.

**Cuidado.** `getSession` faz `Object.assign(session, unsealed)` (`session.ts:208`), e `Object.assign` copia símbolos próprios enumeráveis. Por isso o símbolo `kExtraUnseal` precisa ser apagado de `unsealed` antes desse `Object.assign`, exatamente como `kLegacySeal` é apagado em `session.ts:200-202`.

### D-05 — Abrir com senha extra dispara o reselo

**Escolha.** Em `getSession`, a condição de reselo (`session.ts:214`):

```ts
if (session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config))) {
```

passa a ser:

```ts
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
```

onde `extraSeal` vem de `kExtraUnseal`.

**Alternativas.**
- *Não disparar (leitura literal de P-03)*. Rejeitada. Sem `idleTimeout`, uma sessão aberta com a senha antiga ficaria com ela até expirar, e a senha antiga nunca poderia sair da lista sem invalidar essas sessões. Isso contraria o objetivo do PRD (migração à medida que as sessões são usadas).
- *Reselar em toda leitura com senhas extras configuradas*. Rejeitada. Custa um seal por requisição (o caminho mais caro, segundo o próprio comentário em `session.ts:400-407`), quando só as sessões abertas com extra precisam migrar.

**Justificativa.** RF-05 pede que o cookie emitido abra com `password` quando a sessão foi aberta com extra. O custo é um reselo por sessão, uma única vez por rotação, porque o cookie novo já está selado com `password`.

**Limite.** Só cookies migram. Sessões lidas do header (`sessionFromCookie === false`, `session.ts:189-193`) nunca são reseladas, como já acontece com `idleTimeout` (`session.ts:64-65`). Elas continuam com a senha antiga até expirar. Isso deve ir para a documentação de rotação, que o PRD deixou para outro PR.

### D-06 — Deduplicação

**Escolha.** `unsealPasswords` remove duplicatas com `new Set`, preservando a ordem da primeira ocorrência.

**Justificativa.** Uma senha repetida em `password` e em `extraUnsealPasswords` (R-04) custa uma derivação completa a mais em cada cookie inválido. A deduplicação custa uma linha e não muda o resultado.

### D-07 — Quais erros continuam a iteração

**Escolha.** Na lista, só `Bad hmac value` avança para a próxima senha. Qualquer outro erro (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `Invalid expiration`, senha curta) é relançado na hora, igual a hoje. Se a lista se esgota, relança o último `Bad hmac value`.

**Justificativa.** Com HMAC verificado antes da decifragem (`iron-crypto.ts:133-137`), senha errada sempre produz `Bad hmac value` e nunca chega a `decrypt`. Os outros erros não dependem da senha, então tentar outra não ajuda. A mensagem final não contém senha (R-06).

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (acrescentar após `password`, linha 48)
/**
 * Previous passwords that can still open sessions sealed with them. They are
 * tried in declaration order after `password`, which is the only one used to
 * seal. Each must meet the same minimum length as `password`.
 *
 * Duplicates are ignored. A session opened with one of these is resealed with
 * `password` on the same request.
 */
extraUnsealPasswords?: string[];
```

```ts
// src/utils/session.ts — interno, não exportado
function unsealPasswords(config: Pick<SessionConfig, "password" | "extraUnsealPasswords">): string[];
```

```ts
// src/utils/session.ts — assinatura pública INALTERADA
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Comportamento de `unsealSession` (sequência, não código final):

```ts
const sealOptions = { ...sealDefaults, ttl: ..., ...config.seal };   // inalterado
const passwords = unsealPasswords(config);
for (const p of passwords) assertPasswordLength(p, sealOptions.encryption.minPasswordlength);

// passagem 1: normal
// passagem 2 (só se Bad hmac na 1, legacySealFallback !== false, iterations !== 1): legado
// marca kLegacySeal na passagem 2, e kExtraUnseal se o índice que abriu for > 0 (em qualquer passagem)
// checagens de maxAge e idleTimeout: inalteradas
```

Auxiliar interna sugerida, que roda uma passagem sobre a lista:

```ts
// src/utils/session.ts — interno
async function unsealWithAny(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<{ unsealed: Partial<Session>; index: number }>;
// Tenta em ordem. Avança só em "Bad hmac value". Se esgota, relança o último erro.
```

```ts
// src/utils/internal/session.ts — novo símbolo interno
export const kExtraUnseal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-unseal",
);
```

```ts
// src/utils/internal/iron-crypto.ts — nova função interna, usada por generateKey
export function assertPasswordLength(password: string, minLength: number): void;
// lança: `Password string too short (min ${minLength} characters required)`
```

Mudanças em `getSession` (`src/utils/session.ts:199-216`): ler `kExtraUnseal` junto de `kLegacySeal`, apagar os dois antes de `Object.assign`, e incluir `extraSeal` na condição de reselo (D-05).

Nada muda em `sealSession` além da validação de D-02. Ele continua selando com `config.password` (`session.ts:300-304`), o que atende RF-02 sem código novo.

## Arquivos a alterar

| Arquivo | Trecho atual | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:48` (`password: string;`) | Acrescentar `extraUnsealPasswords?: string[]` com documentação (contrato acima). |
| `src/utils/session.ts` | `:1-5` (imports) | Importar `assertPasswordLength` e `kExtraUnseal`. |
| `src/utils/session.ts` | `:196-220` (`getSession`, `.then`) | Ler e apagar `kExtraUnseal`; incluir `extraSeal` no reselo. |
| `src/utils/session.ts` | `:282-307` (`sealSession`) | Validar a lista antes do `seal`. |
| `src/utils/session.ts` | `:312-348` (`unsealSession`) | Substituir o `try/catch` de uma senha pelas duas passagens sobre a lista; marcar `kLegacySeal` e `kExtraUnseal`. |
| `src/utils/session.ts` | `:388-421` (perto de `shouldSlide`) | Acrescentar `unsealPasswords` e `unsealWithAny` como funções internas no final do arquivo, conforme AGENTS.md ("helpers internos ao final do arquivo"). |
| `src/utils/internal/session.ts` | `:7-8` | Acrescentar `kExtraUnseal`. |
| `src/utils/internal/iron-crypto.ts` | `:191-196` | Extrair a verificação de comprimento para `assertPasswordLength` e chamá-la de `generateKey`. |
| `test/session.test.ts` | `:15`, `:23-27` (setup) e `:186-187` (depois dos testes legados) | Novos testes de integração, dentro de `describeMatrix`. |
| `test/unit/iron-crypto.test.ts` | `:116-126` (`generateKey()`) | Teste unitário de `assertPasswordLength`. |

Não alterar: `src/index.ts` (nenhum export novo), `test/unit/package.test.ts` (o snapshot de exports fica igual), `CHANGELOG.md` (gerado no release), `docs/4.examples/handle-session.md` (guia de rotação fica para PR separado, conforme o PRD).

Tamanho: `src/utils/session.ts` já tem 464 linhas, acima da meta de 200 do AGENTS.md. Esta mudança acrescenta cerca de 40 linhas. A divisão do arquivo fica fora deste escopo, e deve ser feita em PR próprio.

## Estratégia de testes

Seguir o AGENTS.md: escrever o teste de regressão primeiro, confirmar que falha, depois implementar.

**Integração (`test/session.test.ts`, `describeMatrix`, roda em web e node):**

1. *Abre sessão selada com a senha extra e retorna os dados* (RF-03). Cookie selado com `"senha-antiga"`, configuração com nova `password` e `extraUnsealPasswords: ["senha-antiga"]`. Espera `session.id` e `data` do cookie, sem novo `id`.
2. *Migra a sessão aberta com senha extra* (RF-05, D-05). Mesmo cenário, sem `idleTimeout`. Espera um `Set-Cookie` cujo valor abre com `"senha-nova"` e não com `"senha-antiga"`.
3. *Sela sempre com `password`* (RF-02). Sessão nova com extras configuradas: o cookie abre com `password` e falha com cada extra.
4. *Legado com senha extra* (RF-04). Selo com 1 iteração e senha antiga. Espera dados retornados e reselo com `password`.
5. *Senha extra em posição não-primeira* (RF-03, ordem). Duas extras, a segunda abre o cookie. Espera dados retornados.
6. *Senha desconhecida* (RF-07). Cookie selado com senha fora da lista. Espera `session.id` diferente do cookie, sem `Set-Cookie` nesta leitura, sem exceção, e corpo da resposta sem nenhuma senha.
7. *Sem extras, nada muda* (RF-06). A suíte existente roda sem alteração de asserção. É a verificação de regressão.
8. *Duplicatas* (D-06). `password` repetida em `extraUnsealPasswords`: a sessão abre normalmente. (O número de derivações não é observável por integração; a verificação de custo é benchmark, abaixo.)

**Unitários:**

9. `test/unit/iron-crypto.test.ts`: `assertPasswordLength("curta", 32)` lança `Password string too short (min 32 characters required)`, e `assertPasswordLength` com 32 caracteres não lança.
10. `unsealSession` direto (exportada): com `extraUnsealPasswords: ["curta"]`, rejeita com a mesma mensagem de `password: "curta"` (RF-08). Os dois caminhos (`sealSession` e `unsealSession`) são cobertos.
11. Um teste de tipo, se o projeto já tiver padrão para `SessionConfig` em `test/unit/types.test-d.ts`: confirmar que `extraUnsealPasswords` aceita `string[]` e é opcional (RF-01). Não verifiquei se esse arquivo cobre `SessionConfig`; checar antes de escrever.

**Verificação do conjunto:**

- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/`
- `pnpm lint` (inclui `tsc --noEmit` via `pnpm typecheck` no `pnpm test`)
- `pnpm bench:node` antes e depois, com um cookie inválido e N = 0, 1 e 3 extras, para medir o custo de R-01. Os números devem ir para o PR.

## Riscos

- **R-01 — Custo de CPU (com correção).** Cada senha tentada na passagem normal custa duas derivações PBKDF2 de 8192 iterações (`iron-crypto.ts:14-29`). Um cookie inválido custa N+1 dessas. A passagem legada usa 1 iteração (`session.ts:340-344`), então custa uma fração pequena do caminho normal, não "dobra a conta" como diz o PRD. A exposição real é N+1 derivações normais por cookie inválido. Mitigação: limite máximo de senhas extras, documentado, e a medição do benchmark acima.
- **R-02 — Senhas antigas ativas por tempo indefinido.** Comportamento pedido. Documentar na orientação de rotação (PR separado).
- **R-03 — Tempo de resposta.** Abrir com a senha de posição k leva k derivações a mais que abrir com a primeira. Mantida a ordem declarada, o atacante só aprende a posição de uma senha que já conhece parcialmente. Impacto baixo; registrar na documentação.
- **R-04 — Duplicatas e ordem.** Resolvido por D-06 (deduplicação). A ordem declarada vira prioridade, e isso deve estar na documentação do campo.
- **R-05 — Fallback legado na v3.** Resolvido por D-03: a remoção fica restrita à segunda passagem de `unsealSession`.
- **R-06 — Vazamento de senha em erros.** Os erros novos são só os de iron, que não incluem a senha. O único erro novo, da validação, é o mesmo texto de hoje. A mensagem final de falha é `Bad hmac value`, sem índice (D-07). Coberto pelo teste 6.
- **R-07 — Símbolo interno vazando para a sessão.** Se `kExtraUnseal` não for apagado antes de `Object.assign`, ele aparece em `session` e, se o objeto for serializado, pode interferir em `updateSession`. Mitigação: apagar antes do `Object.assign` (D-04), com teste de que `session` não tem símbolos próprios extras após a leitura.
- **R-08 — Sessões no header não migram.** Limite de D-05. Documentar.
- **R-09 — Extra inválida silenciosa na leitura.** Uma extra curta faz a leitura agir como sessão vazia, igual a uma `password` curta hoje. A escrita falha com o mesmo erro (D-02). Não é uma regressão, mas é fácil de passar despercebido em rotação. Se o time quiser erro na leitura, isso é um requisito novo, fora deste contrato.
- **R-10 — Passagem legada e erros de validação.** Se a validação eager não rodar antes da passagem legada, uma senha curta pode gerar erro diferente. Mitigação: a validação roda antes das duas passagens (D-02).

## Pontos não verificados

- Não rodei os testes nem o lint: este trabalho só escreveu a especificação, sem alterar código. A suíte base (`test/session.test.ts`) deve ser executada antes da implementação para confirmar que está verde no ponto de partida.
- Não verifiquei se `test/unit/types.test-d.ts` cobre `SessionConfig` (item 11).
