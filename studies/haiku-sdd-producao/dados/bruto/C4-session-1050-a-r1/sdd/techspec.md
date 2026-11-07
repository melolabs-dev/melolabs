# Especificação técnica: várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-09), issue h3js/h3#1050 (segunda alternativa).

## Contexto

`useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession` leem uma única `password`. Hoje ela sela e abre o cookie (`src/utils/session.ts:48`, `src/utils/session.ts:300`, `src/utils/session.ts:324`). A mudança aceita `string | string[]`: o primeiro item sela, os demais só abrem.

Pontos do código que condicionam o desenho:

- A biblioteca de selagem aceita uma senha por chamada quando ela é `string`. Nesse caso o `passwordId` gravado no cookie é ignorado na leitura: `src/utils/internal/iron-crypto.ts:120-123` (`pass = password`). A selagem grava `id = ""` para senhas em string (`src/utils/internal/iron-crypto.ts:68`). Logo o cookie não guarda nada que identifique a senha, como premissa o PRD.
- A verificação de integridade vem antes da descriptografia e lança `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:133-137`). É o único erro que indica "senha errada". Os demais (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`) não dependem da senha.
- Cada tentativa de abertura chama `generateKey`, que faz PBKDF2 com 8192 iterações (`src/utils/internal/iron-crypto.ts:21`, `src/utils/internal/iron-crypto.ts:206`).
- `getSession` engole qualquer erro de `unsealSession` com `.catch(() => {})` (`src/utils/session.ts:196-197`). Um erro de configuração lançado ali viraria sessão nova em silêncio.
- O fallback legado (1 iteração) é tratado no `catch` de `unsealSession` (`src/utils/session.ts:325-347`) e é marcado com `kLegacySeal` (`src/utils/session.ts:345-347`, `src/utils/internal/session.ts:7-9`).
- O reselamento na leitura acontece em `getSession` quando `legacySeal` ou `shouldSlide` (`src/utils/session.ts:214-216`).

## Decisões de arquitetura

### D-01 — Tipo público `string | string[]`, normalizado por helper privado

**Escolha:** `SessionConfig.password` vira `string | string[]`. Um helper privado `resolvePasswords(config)` converte para `string[]`, valida a lista e é usado em todos os pontos de entrada.

**Alternativas consideradas:**
- Tipo tupla `[string, ...string[]]`: impede lista vazia em tempo de compilação. Rejeitada: o contrato pede `string | string[]` literalmente, e RF-05 exige erro em tempo de execução de qualquer forma (JS e chamadas com `as any` não passam pelo tipo).
- Campo separado `extraUnsealPasswords` (primeira alternativa da issue): rejeitado, está fora de escopo (PRD, "Fora de escopo").

**Justificativa:** uma única mudança de tipo cobre a API pública, e a normalização fica em um ponto só. Strings continuam valendo como lista de um item (RF-04).

### D-02 — Sem metadado no cookie: tentativas sequenciais com senhas em string

**Escolha:** `unseal` é chamado uma vez por senha, cada uma como `string`, na ordem da lista.

**Alternativas consideradas:**
- Mapa de ids do iron (`PasswordHash`, `{ "0": nova, "1": antiga }`): permite localizar a senha pelo id em O(1), mas o id é gravado em texto plano no cookie (`src/utils/internal/iron-crypto.ts:68`, `:103`). Muda o formato selado e contradiz o PRD ("Não há metadado no cookie"). Rejeitada.

**Justificativa:** o formato do cookie não muda (PRD, "Fora de escopo"), e a lista de senhas é pequena por premissa. O custo é linear no número de senhas, documentado em D-03 e nos riscos.

### D-03 — Duas passadas: senhas atuais primeiro, depois legado

**Escolha:** `unsealWithPasswords` tenta todas as senhas com as opções atuais. Só se nenhuma abrir, e o fallback legado estiver habilitado, ele faz uma segunda passada com todas as senhas e as opções de 1 iteração.

**Alternativas consideradas:**
- Por senha, tentando atual e depois legado antes de passar para a próxima: mesmo pior caso, mas um cookie resselado com a senha antiga (o caso comum durante a rotação) pagaria uma tentativa legada desnecessária por senha que vem antes na lista.

**Justificativa:** durante a rotação a maioria dos cookies é moderna. Com duas passadas, um cookie moderno aberto pela segunda senha custa uma tentativa falha e uma bem-sucedida, todas com 8192 iterações, sem nenhuma tentativa de 1 iteração.

### D-04 — Validação antecipada de lista vazia e de tamanho mínimo

**Escolha:** `resolvePasswords(config)` é chamado no início de `getSession`, `sealSession` e `unsealSession`. Ele lança `Error` se:
- a lista estiver vazia (RF-05);
- algum item tiver menos caracteres que o mínimo efetivo, calculado como `Math.max(seal.encryption.minPasswordlength, seal.integrity.minPasswordlength)` a partir de `{ ...sealDefaults, ...config.seal }`. O mínimo padrão é 32 (`src/utils/internal/iron-crypto.ts:22`, `:28`).

**Alternativas consideradas:**
- Deixar a validação para o próprio `unseal`: rejeitada. Uma senha curta na posição 2 só falharia depois que a posição 1 não abrisse o cookie. Nesse caso o erro sobe até o `.catch(() => {})` de `src/utils/session.ts:197` e a sessão some sem aviso.
- Validar só em `sealSession`/`unsealSession`: rejeitada. `getSession` chama `unsealSession` dentro do `.catch` silencioso, e um `password: []` ali viraria sessão nova em silêncio em toda leitura.

**Justificativa:** configuração inválida falha de forma determinística e visível, antes de qualquer leitura de cookie. O custo é um laço curto por requisição, desprezível perto do PBKDF2.

### D-05 — Marcador interno `kRotatedSeal` para forçar o reselamento

**Escolha:** `unsealSession` marca o objeto retornado com `kRotatedSeal` quando a senha que abriu não é a primeira (índice > 0). `getSession` lê o marcador, remove-o antes de `Object.assign` e inclui a condição no reselamento (`legacySeal || rotatedSeal || shouldSlide`). O padrão segue o de `kLegacySeal`.

**Alternativas consideradas:**
- Retornar o índice da senha pela `unsealSession`: muda a assinatura de uma função exportada (`src/index.ts:209`), o que quebra RF-08.
- Comparar com `config.password[0]` dentro de `getSession`: não há como saber, sem o marcador, qual senha abriu o cookie.
- Resselar em toda leitura: custo de PBKDF2 em toda requisição, contrário ao PRD (RF-06 e riscos).

**Justificativa:** segue um padrão já usado no arquivo, não altera nenhuma assinatura pública e só reselar quando há rotação em andamento.

### D-06 — Sessões lidas do header não são resseladas

**Escolha:** a condição de reselamento continua exigindo `sessionFromCookie` (`src/utils/session.ts:214`). Uma sessão lida do header com a senha antiga é aberta, mas não recebe `Set-Cookie`.

**Alternativas consideradas:**
- Resselar também sessões de header: rejeitada, muda um comportamento que hoje não existe e vai além do escopo. O header não é um cookie de navegador, então o `Set-Cookie` não teria efeito útil.

**Justificativa:** é o mesmo limite que já existe para legado e para `idleTimeout` (`src/utils/session.ts:63-65`). Para sessões de header, a rotação só termina quando elas expiram.

## Arquivos a alterar

Nenhum arquivo do projeto foi alterado nesta etapa. Lista para a implementação:

1. **`src/utils/session.ts`**
   - `src/utils/session.ts:39-48`: `SessionConfig.password` vira `string | string[]`. Atualizar o JSDoc (`:40-47`) para dizer que a primeira senha sela, as demais só abrem, que cada item precisa do tamanho mínimo, e que cada senha extra aumenta o custo de leitura.
   - `src/utils/session.ts:149-153` (início de `getSession`): chamar `resolvePasswords(config)` antes de qualquer outra coisa (D-04).
   - `src/utils/session.ts:196-197`: o `.catch(() => {})` continua igual. A validação ocorre antes dele.
   - `src/utils/session.ts:199-203`: ler também `kRotatedSeal` e removê-lo antes de `Object.assign` (`:208`). Sem essa remoção o símbolo é copiado para a sessão, porque `Object.assign` copia símbolos enumeráveis.
   - `src/utils/session.ts:214-216`: incluir `rotatedSeal` na condição de reselamento (D-05, D-06).
   - `src/utils/session.ts:300-304`: `seal(session, resolvePasswords(config)[0], ...)`.
   - `src/utils/session.ts:312-347`: `unsealSession` passa a usar `unsealWithPasswords` nas duas passadas (D-03). A condição do fallback (`:332-339`) é trocada por `isBadHmac(error)`, com o mesmo comportamento de hoje. Após abrir, marcar `kRotatedSeal` se o índice for maior que zero.
   - Fim do arquivo (após `src/utils/session.ts:464`): `resolvePasswords`, `unsealWithPasswords` e `isBadHmac`, como helpers privados. As convenções do `AGENTS.md` permitem helpers no fim do arquivo. O arquivo já passa de 200 linhas (464 hoje), então a divisão em outro módulo fica como opção, não como exigência desta mudança.
2. **`src/utils/internal/session.ts:7-9`**: adicionar `kRotatedSeal`, com `Symbol.for("h3.internal.session.rotated-seal")`, logo após `kLegacySeal`.
3. **`test/session.test.ts`**: novo bloco `describe("password rotation", ...)` dentro de `describeMatrix` (`test/session.test.ts:15`), depois de `describe("lazy creation")` (`test/session.test.ts:692`). Usar o estilo de `sessionConfig` (`test/session.test.ts:21-25`), com duas senhas de 51 caracteres.
4. **`docs/4.examples/handle-session.md`**: o texto do `password` em `docs/4.examples/handle-session.md:37` ganha a menção à lista. Nova seção "Rotate the password" entre "Options" (`:120`) e "Expiration" (`:151`). O documento está em inglês, então a seção também fica em inglês. Conteúdo: a primeira senha sela, as demais só abrem; manter a senha antiga até o maior prazo de vida da sessão (`maxAge`, ou `idleTimeout` para sessões de header); reselamento só ocorre em cookies; custo por senha extra.

Não alterar:
- `src/utils/internal/iron-crypto.ts`: usado como está. O comportamento relevante já foi conferido (`:120-137`).
- `src/index.ts:207-212`: a lista de exports não muda (RF-08).
- `src/types/context.ts:32`: o `password` ali é de outro recurso.
- `test/bench/session.ts:20`: usa string, continua válido.

## Contratos e assinaturas

```ts
// src/utils/session.ts: único tipo público alterado
export interface SessionConfig {
  /**
   * ... (JSDoc atualizado: primeira senha sela, demais só abrem)
   */
  password: string | string[];
  // demais campos inalterados
}

// src/utils/session.ts: helpers privados, no fim do arquivo
/**
 * Valida `password` e devolve a lista em ordem.
 * Lança Error se a lista estiver vazia ou se algum item for menor que o mínimo
 * efetivo das opções de selagem.
 */
function resolvePasswords(config: SessionConfig): string[];

/**
 * Tenta abrir `sealed` com cada senha, na ordem. Avança apenas em "Bad hmac value";
 * qualquer outro erro sobe imediatamente. `index` é a posição da senha que abriu.
 */
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  opts: SealOptions,
): Promise<{ unsealed: Partial<Session>; index: number }>;

function isBadHmac(error: unknown): boolean;

// src/utils/internal/session.ts: novo marcador interno
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.rotated-seal",
);
```

Comportamento esperado por entrada:

| `password`              | Selar                         | Abrir                                                        |
| ----------------------- | ----------------------------- | ------------------------------------------------------------ |
| `"senha"` (string)      | igual à versão atual          | igual à versão atual, sem marcador de rotação                |
| `["nova", "antiga"]`    | com `"nova"`                  | com `"nova"`: sem marcador; com `"antiga"`: `kRotatedSeal`   |
| `[]`                    | `Error` (RF-05)               | `Error` (RF-05), inclusive dentro de `getSession`            |
| lista com item curto    | `Error` (D-04)                | `Error` (D-04)                                               |

Cookie legado (1 iteração) aberto por qualquer senha da lista: `kLegacySeal` e, se o índice for maior que zero, também `kRotatedSeal`. Em ambos os casos `getSession` reselá-lo com `"nova"`.

## Estratégia de testes

Seguir o `AGENTS.md`: a feature é nova, então os testes são escritos antes da implementação e devem falhar nela. Todos usam `describeMatrix`, rodando em `web` e `node`.

Casos em `test/session.test.ts`, mapeados para o PRD:

1. **RF-01 (aceita lista):** `useSession` com `[NOVA, ANTIGA]` responde sem erro e emite um `Set-Cookie`.
2. **RF-02 (primeira senha sela):** cookie emitido por `useSession` abre com `unseal(cookie, NOVA, sealDefaults)` e falha com `unseal(cookie, ANTIGA, sealDefaults)` usando a mensagem `"Bad hmac value"`.
3. **RF-03 e RF-06 (abre com antiga e reselar):** cookie gerado por `seal(..., ANTIGA, ...)` é lido pela rota. A resposta traz os mesmos `id` e `data`, e exatamente um `Set-Cookie` que abre com `NOVA` e não abre com `ANTIGA`.
4. **Regressão RF-06 negativa:** cookie gerado com `NOVA` não gera `Set-Cookie` na leitura, porque a rotação não é necessária.
5. **RF-04 (string igual à versão atual):** repetir o caso de leitura com `password` em string e confirmar que não há `Set-Cookie` no caminho feliz.
6. **RF-05 (lista vazia):** a rota chama `useSession` com `password: []` e a resposta é de erro. O teste limpa `t.errors` como em `test/errors.test.ts:116`, para que a auditoria de `afterEach` (`test/_setup.ts:145-155`) não falhe. Verificar a mensagem.
7. **RF-07 (legado com senha extra):** cookie com `seal(..., ANTIGA, { iterations: 1 })` é lido, mantém `data`, e o `Set-Cookie` abre com `NOVA` usando `sealDefaults`. Espelha o teste de `test/session.test.ts:134-159`.
8. **Três senhas:** cookie selado com a terceira senha abre, e a ordem da lista é respeitada (ex.: `[A, B, C]` com cookie de `C` e de `B`).
9. **Nenhuma senha abre:** cookie selado com chave desconhecida gera uma sessão nova, sem erro e sem `Set-Cookie`. Cobre a saída do laço com `throw error`.
10. **Legado com `legacySealFallback: false`:** com lista, cookie legado é rejeitado mesmo que a senha esteja na lista. Espelha `test/session.test.ts:161-186`.
11. **Sessão de header:** cookie antigo enviado pelo header abre, mas não gera `Set-Cookie` (D-06).
12. **Sem vazamento do marcador:** a sessão lida tem as mesmas chaves que a sessão de senha única. Verificar que nenhum símbolo interno sobra no objeto.

Regressão: os testes existentes em `test/session.test.ts` devem passar sem alteração. O teste de legado (`:134-159`) espera exatamente um `Set-Cookie` (`:154`), e continua válido com senha única.

Verificação:
- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/iron-crypto.test.ts` (sem mudança, confirma a base)
- `pnpm lint` e `pnpm typecheck` (`package.json:53-54`)
- `pnpm test` (suíte completa com cobertura; `vitest.config.mjs` só inclui `src/**/*.ts` e não define limite de cobertura, mas os ramos novos devem ficar cobertos pelos casos acima)

## Riscos

1. **Amplificação de trabalho com cookies forjados (novo):** o `Bad hmac` ocorre antes de qualquer checagem de autenticidade, e a verificação exige PBKDF2. Um cookie com formato válido, mas sem a chave, custa uma derivação por senha da lista, mais uma passada de legado se o fallback estiver ativo. O custo da requisição cresce com N. Mitigação: manter listas curtas (recomendar até 3 na documentação), e a própria lista é configuração de servidor, não entrada do usuário.
2. **Erros engolidos pelo `.catch` (existente, `src/utils/session.ts:197`):** erros de abertura que não sejam `Bad hmac` também viram sessão nova em silêncio. D-04 cobre a configuração, mas não outros erros de `unseal`. Fora de escopo corrigir isso aqui.
3. **Vazamento do marcador para a sessão (novo):** se `kRotatedSeal` não for removido antes de `Object.assign` (`src/utils/session.ts:208`), ele vai para `session` e pode ser copiado para o cookie seguinte. Mitigação: a remoção e o caso 12 da estratégia de testes.
4. **Reselamento em leitura (PRD):** leituras com senha antiga passam a emitir `Set-Cookie`. Pode afetar caches ou respostas que não esperam esse cabeçalho. Durante a rotação, requisições concorrentes com o mesmo cookie antigo podem emitir vários `Set-Cookie` válidos; o último vence no navegador. Não é um erro de segurança, porque todos abrem com a senha atual.
5. **Senha antiga removida cedo demais (PRD):** o código não detecta sessões ainda seladas com ela. A documentação deve dizer para manter a senha até o maior prazo de vida da sessão.
6. **Sessões de header não rotacionam (D-06):** elas continuam com a senha antiga até expirar. Documentar.
7. **Superfície de ataque (PRD):** senhas antigas aceitas ampliam o alvo até serem removidas. Documentar.
8. **Mudança de tipo público (novo):** `SessionConfig.password` deixa de ser `string`. Quem chamava `config.password` esperando `string` quebra no typecheck. Quem só passa strings não é afetado.
9. **Dependência da mensagem `"Bad hmac value"` (existente):** `isBadHmac` compara a string, como o código atual já faz (`src/utils/session.ts:336`). Uma mudança na mensagem da biblioteca de selagem quebraria o fallback e a rotação ao mesmo tempo. Os testes 2 e 9 detectam isso.
