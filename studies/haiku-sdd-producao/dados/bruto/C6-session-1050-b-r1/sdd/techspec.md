# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `7ee00b4`).

## 1. Contexto no código

- `SessionConfig` está em `src/utils/session.ts:39-99`; `password: string` em `:48`; `legacySealFallback` em `:95`.
- `unsealSession` (`src/utils/session.ts:312-367`) monta `sealOptions` (`:317-321`), chama `unseal(sealed, config.password, …)` (`:324`) e, se falhar com `Bad hmac value` (`:336`), tenta de novo com 1 iteração PBKDF2 (`:340-344`) e marca `kLegacySeal` (`:345-347`). Depois verifica `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`).
- `sealSession` sela com `config.password` (`src/utils/session.ts:300`). É o único ponto de selagem; `updateSession` (`:267`) e o reseal por deslizamento/legado (`:214-216`) passam por ele.
- `getSession` chama `unsealSession` e engole **qualquer** erro com `.catch(() => {})` (`src/utils/session.ts:196-197`). Isso é determinante para RF-07 (ver D-04).
- `unseal` do iron: o erro de senha errada é `Bad hmac value` (`src/utils/internal/iron-crypto.ts:136`). A checagem de expiração do seal (`Expired seal`, `:115-117`) vem **antes** do HMAC; a validação de tamanho mínimo da senha (`Password string too short (min N characters required)`) é lançada em `generateKey` (`:192-195`), também durante a verificação do HMAC. `minPasswordlength` default é 32 (`:22`, `:28`).
- `unsealSession` é exportado publicamente (`src/index.ts:209`); `SessionConfig` também (`src/index.ts:203`).
- Testes existentes: `test/session.test.ts:21-25` (config base), `:134-159` (legado resealed), `:161-186` (`legacySealFallback: false`); helpers `seal`/`unseal`/`sealDefaults` já importados em `:12`. `tsconfig.json` inclui `src` e `test`, então `pnpm typecheck` verifica os testes (RF-01).

## 2. Decisões de arquitetura

### D-01 — Campo `extraUnsealPasswords?: string[]` em `SessionConfig`

- **Alternativas:** (a) `password: string | string[]` (segunda alternativa da issue) — fora de escopo no PRD e altera o tipo de `password`; (b) campo novo opcional — escolhido; (c) opção de função resolvedora `(id) => password` — nome público extra, proibido.
- **Escolha:** (b). É aditivo, não quebra nenhum chamador, e é o único nome público novo permitido. `password` continua `string` e é a única senha de selagem. O JSDoc (único lugar de documentação, conforme PRD) deve dizer: só abre sessões, ordem de tentativa, custo PBKDF2 por senha extra, tratar como segredo ativo até remover, remoção é manual, mínimo de 32 caracteres.
- **Local:** `src/utils/session.ts`, logo após `password` (`:48`).

### D-02 — Lista efetiva de senhas calculada por helper interno, com deduplicação

- **Alternativas:** (a) iterar `[config.password, ...extras]` inline no `unsealSession`; (b) helper interno `unsealPasswords(config, sealOptions)` que valida e devolve a lista deduplicada — escolhido.
- **Escolha:** (b), no fim de `src/utils/session.ts` (convenção: helpers internos no fim do arquivo; o arquivo já tem `shouldSlide`, `sessionExpires` ali). Retorna `[password, ...extras]` sem repetições (`new Set` preserva a ordem de inserção), de modo que "extra igual a `password` é aceita, mas não causa tentativa repetida" (RF-07) e a ordem é a declarada (RF-02). Não vai para `utils/internal/` porque depende de `SessionConfig`, e o arquivo continua pequeno. Sem export, logo sem nome público novo.

### D-03 — `unsealSession` itera por senha; só `Bad hmac value` avança

- **Alternativas:** (a) `try/catch` por senha e avançar em qualquer erro — rejeitado: mascara expiração/formato (RF-06, risco "erro mascarado"); (b) avançar só quando `error instanceof Error && error.message === "Bad hmac value"` — escolhido, é o mesmo critério que o código já usa em `:334-337`; (c) pré-verificar o HMAC separadamente — duplica a criptografia, rejeitado.
- **Escolha:** (b). Extrair o corpo atual de `:323-348` para um helper interno `unsealWith(sealed, password, config, sealOptions)` que faz exatamente o que o código faz hoje para **uma** senha (tentativa atual → tentativa legada, com as mesmas condições de `:332-337`, marcando `kLegacySeal`), e lança o erro se nada servir. `unsealSession` percorre a lista:

  ```
  let lastError
  for (password of passwords) {
    try { unsealed = await unsealWith(...); break }
    catch (e) { if (!isBadHmac(e)) throw e; lastError = e }
  }
  if (!unsealed) throw lastError
  ```

  Ordem por senha (RF-08): atual → legado (se `legacySealFallback !== false` e `iterations !== 1`) → próxima senha. Isso respeita RF-06: `Expired seal`, `Incorrect number of sealed components`, `Wrong mac prefix` etc. são propagados na hora, sem tentar outras senhas. Como `Expired seal` precede o HMAC (`iron-crypto.ts:115-117`), um cookie expirado selado com `B` falha com a causa real já na primeira senha.
- **Sem extras (RF-04):** a lista tem 1 elemento; o fluxo e o erro lançado são os mesmos de hoje (o erro final é o `Bad hmac value` da última tentativa, como antes). `unsealed` continua podendo ser `null` (`unseal` retorna `null` para payload vazio); o teste `if (unsealed)` de `:345` deve ser preservado ao mover o código.
- **Verificações pós-unseal** (`maxAge`, `idleTimeout`, `:350-365`) ficam depois do laço, inalteradas (premissa do PRD: independentes da senha).

### D-04 — Validação das extras antes do `.catch(() => {})` do `getSession`

- **Problema:** `getSession` engole todo erro de `unsealSession` (`src/utils/session.ts:196-197`). Se a validação de uma extra curta vivesse só dentro de `unsealSession`, `getSession` trataria a sessão como nova, violando RF-07 ("não silenciosamente tratada como nova"). Além disso, se a validação ocorresse só ao alcançar a extra (após `Bad hmac value`), uma sessão aberta com `password` nunca revelaria a extra inválida — comportamento dependente de dados.
- **Alternativas:** (a) deixar o iron lançar `too short` ao chegar na extra — rejeitado pelos dois motivos acima; (b) validar na entrada de `getSession` (antes de tocar o contexto) **e** em `unsealSession` (chamada pública direta) — escolhido; (c) validar no `useSession` apenas — rejeitado: `getSession`/`unsealSession` são públicos e independentes.
- **Escolha:** (b). O helper de D-02 valida cada extra: deve ser `string` não vazia e ter `length >= max(encryption.minPasswordlength, integrity.minPasswordlength)` de `sealOptions` (respeita `config.seal`; default 32). Mensagem no mesmo estilo do iron: `Password string too short (min N characters required)` — assim "erro indicando senha curta" (RF-07) é satisfeito por texto e o usuário reconhece o padrão. Extra vazia/não-string: `Empty password`. Em `getSession`, a chamada fica **antes** de `context.sessions![sessionName] = session` (`:173`), para um throw não deixar uma sessão vazia pendurada no contexto; fica depois do retorno antecipado de sessão já carregada (`:162-165`) para não revalidar por chamada. Como `sealOptions` é calculado em `unsealSession` (`:317-321`), extrair a montagem dele para um helper interno único `sealOptionsOf(config)` reutilizado por `sealSession` (`:300-304`) e `unsealSession`, evitando divergência — mudança mecânica, mesmo resultado.
- **`password` principal:** continua sem validação nova; uma `password` curta segue o comportamento de hoje (RF-04).

### D-05 — Selagem permanece só com `config.password`

- **Alternativas:** (a) reselar eagerly no `getSession` toda sessão aberta com extra — rejeitado: "Regravação em massa" e "nomes novos" estão fora de escopo e dobraria o custo por requisição; (b) não mexer em `sealSession` (`:300`) — escolhido.
- **Escolha:** (b). RF-03 se cumpre por construção: `sealSession` não lê `extraUnsealPasswords`. A sessão aberta com extra é regravada com `password` quando já haveria regravação hoje (`updateSession`, deslizamento `shouldSlide`, legado). O sinal `kLegacySeal` continua só para o legado de iterações; **não** se cria sinal para "senha antiga" (seria um mecanismo novo). Consequência aceita e documentada: sem escrita/deslizamento, o cookie segue aberto com a extra até expirar.

### D-06 — Sem mudança em `iron-crypto.ts`

- **Alternativas:** passar um mapa de senhas ao `unseal` do iron (`PasswordHash`, `iron-crypto.ts:427`, selecionado por `passwordId`) — rejeitado: exige `id` nos seals já emitidos (hoje o id é vazio, ver `:79`), invalida cookies existentes e muda o formato.
- **Escolha:** a lógica de rotação fica em `session.ts`; `iron-crypto.ts` é um port de terceiros e não deve ser alterado.

## 3. Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:48` (após `password`) | Novo campo `extraUnsealPasswords?: string[]` com JSDoc (D-01). |
| `src/utils/session.ts` | `:153-155` | Em `getSession`, validar extras antes de usar o contexto (D-04). |
| `src/utils/session.ts` | `:300-304` | `sealSession` usa `sealOptionsOf(config)` (sem mudar o resultado; D-04). |
| `src/utils/session.ts` | `:312-348` | `unsealSession` percorre as senhas, delegando a `unsealWith` (D-03). |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | Helpers internos não exportados: `sealOptionsOf`, `unsealPasswords`, `unsealWith`. |
| `test/session.test.ts` | após `:186` (depois dos testes de legado) | Novos testes (seção 5). |
| `test/unit/types.test-d.ts` | fim | Teste de tipo de `SessionConfig` (RF-01). |

Não alterar: `src/index.ts:203,209` (nenhum nome novo), `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts`, docs fora do JSDoc, `package.json`.

## 4. Contratos e assinaturas

Público (única adição):

```ts
export interface SessionConfig {
  password: string;                 // inalterado; única senha que sela
  extraUnsealPasswords?: string[];  // novo; só abre sessões, tentadas em ordem depois de `password`
  // ...demais campos inalterados
}
```

Assinaturas públicas de `useSession`, `getSession`, `updateSession`, `sealSession`, `unsealSession`, `clearSession` **não mudam**.

Internos (não exportados; esboço, ajustar aos tipos reais em `isolatedDeclarations` — funções não exportadas não precisam de anotação explícita, mas manter os retornos anotados por consistência):

```ts
function sealOptionsOf(config: SessionConfig): SealOptions;
function unsealPasswords(config: SessionConfig, sealOptions: SealOptions): string[]; // valida e deduplica; lança se extra inválida
async function unsealWith(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // atual → legado; lança o erro da última tentativa
```

Comportamento de erros:
- Extra inválida: `Error("Password string too short (min N characters required)")` ou `Error("Empty password")`, lançado por `getSession`/`useSession`/`unsealSession` (propaga a quem chamou, não vira sessão nova).
- Nenhuma senha serve: `getSession` → sessão nova (RF-05, via `.catch` existente em `:196`); `unsealSession` direto → lança `Bad hmac value`.

## 5. Estratégia de testes

Seguir o `AGENTS.md`: `describeMatrix` (web + node), `sessionConfig` e helpers já presentes em `test/session.test.ts`. Fluxo de bug/feature: escrever os testes primeiro e confirmar que **falham** antes de implementar. Senhas de teste com ≥ 32 caracteres (`OLD`, `NEW`, `OTHER`). Cookies montados com `seal(..., OLD, sealDefaults)` como em `:135-143`.

Novos testes em `test/session.test.ts` (um por critério do PRD):

1. **RF-02:** cookie selado com `B`, config `password: A, extraUnsealPasswords: [B]` → `id`/`createdAt`/`data` preservados.
2. **RF-02 (ordem):** com duas extras `[B, C]` e cookie selado com `C`, abre; com `password` válida, extras não são necessárias (abre na primeira).
3. **RF-03:** sessão aberta com `B` + `POST` de dados → o `Set-Cookie` resultante `unseal` com `A` funciona e com `B` lança `Bad hmac value`. Cobrir também `clear` e o deslizamento de `idleTimeout` (fake timers como em `:188-195`).
4. **RF-04:** executar a suíte existente sem alterar asserções; mais um caso com `extraUnsealPasswords: []`.
5. **RF-05:** cookie selado com `C` (fora da lista) → `id` novo ≠ id do cookie, `data` vazio.
6. **RF-06:** seal de `B` com `ttl` curto e relógio avançado (fake timers de `Date`) → `unsealSession` lança `Expired seal`; e payload mal formado propaga `Incorrect number of sealed components`. Verificar que o erro não é `Bad hmac value`. Para expiração por `maxAge` (`Session expired!`), idem.
7. **RF-07:** `extraUnsealPasswords: ["curta"]` → `getSession`/`useSession` rejeita com `/too short/`, inclusive com cookie válido selado por `password` (prova da validação antecipada) e sem cookie; extra igual a `password` aceita e, com espião no `crypto.subtle.deriveBits`/contagem de chamadas, sem tentativa repetida (alternativa mais simples: teste unitário do comportamento observável — sessão inválida falha uma vez; a contagem exata só se for barata de instrumentar).
8. **RF-08:** seal de `B` com 1 iteração → `getSession` abre e o cookie regravado abre com `A` e `sealDefaults` (espelhar `:134-159`); e `legacySealFallback: false` com extra legada → sessão nova (espelhar `:161-186`).
9. **RF-01 (tipo):** em `test/unit/types.test-d.ts`, `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` e `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string>()`; mais um literal `SessionConfig` sem o campo que continua compilando.

Execução: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/types.test-d.ts`, depois `pnpm lint`, `pnpm typecheck` e `pnpm test` (suíte completa com cobertura).

Ajuste de testes existentes: **nenhum esperado** — o caminho sem extras mantém assinaturas e erros (RF-04). Se algum teste de cobertura/snapshot do tamanho do bundle (`test/unit/package.test.ts`) reagir, ajustar apenas o necessário sem perder a verificação.

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| `getSession` engole erros (`:196-197`) e esconderia extra inválida | RF-07 falharia silenciosamente | Validação antecipada fora do `.catch` (D-04) + teste com cookie válido. |
| Refatoração do `unsealSession` mudar o erro/fluxo com uma só senha | Regressão em RF-04 / `legacySealFallback` | Mover o corpo atual para `unsealWith` sem reescrever; manter `if (unsealed)` e as 4 condições de `:332-337`; suíte existente (`:134-186`) como rede. |
| Mascarar erros ao tentar a próxima senha | Expiração/formato viram "sessão nova" | Avançar só em `Bad hmac value` (D-03); testes RF-06. |
| Latência: cookie inválido percorre N senhas × (atual + legado) = até 2N PBKDF2 (8192 it.) | Requisições com cookie inválido ficam mais lentas; vetor de custo | Lista curta; documentar no JSDoc; dedup (D-02); legado só quando aplicável. |
| `legacySealFallback` × extras dobra tentativas | Idem | Ordem fixada em RF-08 e teste explícito. |
| Extra esquecida segue válida; segredo antigo vazado continua ativo | Superfície de ataque prolongada | JSDoc: remoção manual e tratar como segredo (PRD, sem mecanismo novo). |
| Sessão aberta com extra não é regravada sem escrita/deslizamento | Rotação não "converge" sozinha | Comportamento aceito pelo PRD (fora de escopo: migração em massa). |
| `Bad hmac value` é comparação por texto (frágil se o iron mudar a mensagem) | Rotação deixaria de funcionar silenciosamente | Já é a premissa do código atual (`:336`); cobertos por testes RF-02/RF-08, que quebrariam. |
| `isolatedDeclarations` / `oxlint` em helpers novos | `pnpm lint`/`typecheck` falham | Anotar tipos de retorno; rodar ambos antes de concluir. |
| Sessões do header `x-h3-session` não são regravadas | Continuam abertas com a senha antiga até expirar | Já é o comportamento atual; fora de escopo. |
