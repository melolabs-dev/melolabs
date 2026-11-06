# Especificação técnica — `extraUnsealPasswords` nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-09). Todas as citações `arquivo:linha` foram conferidas no código atual (commit `ec55929`). Nenhum código do projeto é alterado por este documento.

## 1. Estado atual (resumo verificado)

- `SessionConfig.password: string` é declarado em `src/utils/session.ts:48`; a interface começa em `src/utils/session.ts:39`.
- O seal usa `config.password` em `src/utils/session.ts:300` (`sealSession`).
- O unseal está em `unsealSession` (`src/utils/session.ts:312-367`):
  - primeira tentativa com `config.password` e as iterações atuais, em `src/utils/session.ts:324`;
  - o `catch` (`src/utils/session.ts:325`) decide o fallback legado: relança se `legacySealFallback === false`, se `integrity.iterations === 1`, se o erro não é `Error` ou se a mensagem não é `"Bad hmac value"` (`src/utils/session.ts:332-339`);
  - segunda tentativa com 1 iteração, em `src/utils/session.ts:340-344`, que marca `kLegacySeal` em `src/utils/session.ts:345-347`;
  - depois vêm as checagens de `maxAge` (`src/utils/session.ts:350-355`) e de `idleTimeout` (`src/utils/session.ts:359-364`), ambas lançando `"Session expired!"`.
- `getSession` chama `unsealSession` em `src/utils/session.ts:196`, engole qualquer erro em `src/utils/session.ts:197` e lê o marcador em `src/utils/session.ts:199-202`.
- O reseal de migração só ocorre para cookie, em `src/utils/session.ts:214-216`: `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))`. `sessionFromCookie` é definido em `src/utils/session.ts:189-193`.
- O erro de senha errada nasce em `src/utils/internal/iron-crypto.ts:135-137` (`"Bad hmac value"`).
- Os erros de política ou formato (`"Expired seal"` em `iron-crypto.ts:115-117`, `"Wrong mac prefix"` em `:106-108`, número de componentes em `:99-101`) são anteriores à derivação de chave e não dependem da senha.
- A validação de tamanho mínimo e de senha vazia está em `iron-crypto.ts:172-174` e `:192-196`.
- `kLegacySeal` é definido em `src/utils/internal/session.ts:7-9`.
- `SessionConfig` já é exportado como tipo em `src/index.ts:203`; `sealSession` e `unsealSession` estão em `src/index.ts:208-209`.
- A API pública é travada por `test/unit/package.test.ts` (menções em `:125` e `:149`), então não pode ganhar nome novo.

## 2. Decisões de arquitetura

### D-01 — Superfície pública: só o campo `extraUnsealPasswords?: string[]`

- **Alternativas:**
  - (a) `password` aceitar `string | string[]` (segunda alternativa da issue);
  - (b) novo campo opcional em `SessionConfig`;
  - (c) nova função ou opção em `unsealSession`.
- **Escolha:** (b).
- **Justificativa:** o pedido e o PRD (RF-01, "Fora de escopo") fixam `password: string` e proíbem outros nomes públicos. (a) alteraria o tipo de `password` e quebraria quem o lê, como `config.password` em `test/session.test.ts:137`. (c) criaria API nova. Com (b) o campo é aditivo e o tipo `string` não muda.

### D-02 — Selar sempre com `config.password`; nenhuma mudança em `sealSession`

- **Alternativas:**
  - (a) manter `src/utils/session.ts:300` como está;
  - (b) introduzir um helper que escolha a senha de seal.
- **Escolha:** (a).
- **Justificativa:** RF-02 já é satisfeito pelo código atual. `sealSession` é chamado por `updateSession` (`src/utils/session.ts:267`) e por `useSession` via `updateSession` (`src/utils/session.ts:117`), e todos usam `config.password`. Um helper adicionaria indireção sem ganho. O teste de RF-02 protege contra regressão futura.

### D-03 — Abrir tentando senhas em sequência dentro de `unsealSession`

- **Alternativas:**
  - (a) iterar as senhas em `unsealSession`, que já concentra o unseal e o fallback legado;
  - (b) iterar em `getSession`, chamando `unsealSession` uma vez por senha;
  - (c) passar um objeto de senhas por id ao `unseal` do iron (`Record<id, senha>`, suportado em `iron-crypto.ts:124-125`).
- **Escolha:** (a).
- **Justificativa:**
  - (b) repetiria as checagens de `maxAge` e `idleTimeout` e espalharia a lógica; `unsealSession` é exportado e tem de funcionar sozinho (RF-03).
  - (c) não serve: o selo gerado com string tem `passwordId` vazio (`"default"`, `iron-crypto.ts:121`). Seria preciso trocar o formato do selo, e o PRD proíbe mudar o formato do cookie.
  - Em (a) o header e o cookie passam pelo mesmo caminho, e `getSession` não muda quanto a unseal e erros.

### D-04 — Ordem de tentativa: fases por iterações, e dentro de cada fase `password` primeiro e os extras na ordem informada

- **Alternativas:**
  - (a) para cada senha: iterações atuais e depois legadas (produto senha × iteração, senha por senha);
  - (b) fase 1: todas as senhas com as iterações atuais; fase 2 (só se permitida): todas com 1 iteração.
- **Escolha:** (b).
- **Justificativa:**
  - O caso comum da rotação é "sessão selada com a senha antiga em iterações atuais". Em (b) ele custa 2 derivações (`password` e depois o extra). Em (a) custaria 3, porque a `password` seria tentada também com 1 iteração antes do extra.
  - Sem extras, (b) executa exatamente as chamadas de hoje: `password` atual e depois `password` legada (RF-08).
  - O pior caso (cookie forjado ou de senha desconhecida) custa o mesmo nas duas: `2 × (1 + N)` derivações de HMAC.
  - A fase legada só roda se `legacySealFallback !== false` e `sealOptions.integrity.iterations !== 1`, as mesmas condições de `src/utils/session.ts:333-334`.
  - Cada tentativa para no primeiro sucesso.

### D-05 — Só `"Bad hmac value"` avança para a próxima senha; qualquer outro erro é relançado

- **Alternativas:**
  - (a) capturar todo erro e tentar a próxima senha;
  - (b) avançar só em `"Bad hmac value"`, a mesma checagem do fallback legado (`src/utils/session.ts:336`).
- **Escolha:** (b).
- **Justificativa:** RF-04 e a premissa do PRD exigem que erros de política (`"Expired seal"`, `"Session expired!"`) e de formato não disparem novas derivações. Isso evita custo de CPU desnecessário e mascaramento de erros reais. O HMAC é verificado antes da decriptação (`iron-crypto.ts:133-137`), então senha errada aparece sempre como `"Bad hmac value"`. Uma extra inválida (curta ou vazia) lança outro erro e interrompe a busca, igual a uma `password` inválida hoje; ver R-05.
- **Observação:** `"Session expired!"` é lançado depois do unseal (`src/utils/session.ts:353` e `:363`) e nunca entra no laço de tentativas. O `ttl` do iron (`"Expired seal"`) também é anterior à derivação de chave e se repete igual para toda senha, por isso não faz sentido reavaliá-lo.

### D-06 — Migração reaproveitando `kLegacySeal`, sem novo símbolo

- **Alternativas:**
  - (a) marcar com `kLegacySeal` quando a sessão abrir com senha extra;
  - (b) criar `kExtraSeal` (ou similar) em `src/utils/internal/session.ts` e tratá-lo em `getSession`;
  - (c) comparar no `getSession` qual senha abriu.
- **Escolha:** (a).
- **Justificativa:** o PRD (RF-05) manda reaproveitar o mecanismo. `getSession` já remove o marcador e dispara `updateSession` apenas para cookie (`src/utils/session.ts:199-202`, `:214-216`), e `updateSession` sela com `config.password` (D-02). Zero mudança em `getSession`. O nome `kLegacySeal` passa a significar "selo a ser renovado com a configuração atual"; isso exige ajustar o comentário em `src/utils/session.ts:210-213`, mas não o símbolo, que é interno. O `createdAt` não é tocado, então RF-06 se mantém (o reseal só reescreve `lastSeenAt` quando há `idleTimeout`, comportamento já existente). O header não migra, porque `sessionFromCookie` é `false` (`src/utils/session.ts:189`).

### D-07 — Sem validação nova das extras e sem limite de tamanho da lista

- **Alternativas:**
  - (a) reaproveitar a validação do iron (mínimo 32 caracteres, não vazia);
  - (b) validar `extraUnsealPasswords` antecipadamente em `getSession`/`useSession`;
  - (c) limitar o tamanho da lista (por exemplo, 5).
- **Escolha:** (a), sem (c).
- **Justificativa:** o PRD assume que a validação do iron basta. Um erro antecipado mudaria o contrato de `getSession`, que hoje engole erros de unseal (`src/utils/session.ts:197`). Sobre o limite (decisão aberta no PRD): a lista é escrita pelo operador, não por input do atacante, e o custo é linear e documentado. Um limite arbitrário seria só mais uma configuração. A TSDoc orienta manter 1 a 3 itens.

### D-08 — Detalhe de implementação: extrair a tentativa de unseal para um helper interno

- **Alternativas:**
  - (a) aninhar laços no corpo de `unsealSession`;
  - (b) função interna `unsealWithPasswords` no fim de `src/utils/session.ts`, que retorna o objeto aberto e o indicador de migração.
- **Escolha:** (b).
- **Justificativa:** a convenção do repositório manda pôr helpers internos no fim do arquivo ou em `utils/internal/`, e `AGENTS.md` pede arquivos curtos. O arquivo já tem cerca de 465 linhas, então o helper deve ser pequeno e não exportado. Isso mantém `unsealSession` legível e não cria export público.

## 3. Arquivos a alterar

| Arquivo                             | Linha(s)                     | Alteração                                                                                                    |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/utils/session.ts`              | `39-48`                      | Adicionar `extraUnsealPasswords?: string[]` com TSDoc logo após `password` (`:48`).                          |
| `src/utils/session.ts`              | `312-348`                    | Substituir o bloco `try/catch` de unseal pelo helper de D-08 (D-03, D-04, D-05, D-06).                       |
| `src/utils/session.ts`              | `210-213`                    | Atualizar o comentário do reseal ("legacy cookies" passa a incluir cookies de senha extra).                  |
| `src/utils/session.ts`              | fim do arquivo (após `:464`) | Novo helper interno não exportado, `unsealWithPasswords`.                                                    |
| `src/utils/session.ts`              | `326-331`                    | Manter o TODO do v3 junto da fase legada.                                                                    |
| `test/session.test.ts`              | após `:186`                  | Novos testes `describeMatrix` (seção 5).                                                                     |
| `docs/4.examples/handle-session.md` | após `:43`                   | Nova subseção "Rotating the password" (exemplo com `extraUnsealPasswords`).                                  |
| `docs/2.utils/4.security.md`        | `:44-66`                     | Regerado por `automd` (`pnpm fmt`); o texto de `sealSession`/`unsealSession` só muda se a TSDoc deles mudar. |

**Não mudam:** `src/index.ts` (o tipo `SessionConfig` já é exportado em `:203`), `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts` e `getSession`/`updateSession`/`sealSession`. Os testes existentes não dependem do que muda: eles usam `seal`/`unseal` direto e `sessionConfig.password` (`test/session.test.ts:135-186`). Nenhum deve precisar de ajuste; se `pnpm vitest run test/session.test.ts` mostrar o contrário, o ajuste deve manter o que o teste verifica.

## 4. Contratos e assinaturas

### 4.1 Tipo público

```ts
export interface SessionConfig {
  password: string; // inalterado
  /**
   * Previous passwords used only to unseal sessions, tried in order after
   * `password`. Sessions are always sealed with `password`; a session opened with
   * one of these is resealed with `password` (cookie sessions only — a session
   * read from the session header cannot be resealed).
   *
   * Same requirements as `password` (at least 32 characters, random). Each
   * entry costs one more key derivation on a miss, so keep the list short and
   * remove an entry once `maxAge` has passed since the rotation. A compromised
   * extra password keeps opening sessions until it is removed.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}
```

### 4.2 Funções exportadas

As assinaturas não mudam: `unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>` e as demais.

Contrato de `unsealSession` (comportamento):

1. Fase 1: para `p` em `[config.password, ...(config.extraUnsealPasswords ?? [])]`, tenta `unseal(sealed, p, sealOptions)` e para na primeira que abrir.
2. Falha com `Error("Bad hmac value")`: próxima senha. Qualquer outro erro: relança.
3. Esgotadas as senhas e permitido o legado (`legacySealFallback !== false` e `sealOptions.integrity.iterations !== 1`): fase 2, igual à fase 1, com `iterations: 1` em `encryption` e `integrity`.
4. Marca `kLegacySeal = true` se abriu na fase 2 **ou** com uma senha de índice > 0.
5. Aplica `maxAge` e `idleTimeout` como hoje.
6. Esgotadas todas as tentativas, relança o último `"Bad hmac value"`.

### 4.3 Helper interno (não exportado)

```ts
async function unsealWithPasswords(
  sealed: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Esboço (tipos de `SealOptions` já importados em `src/utils/session.ts:9`):

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
let lastError: unknown;
for (const legacy of [false, true]) {
  if (legacy && (config.legacySealFallback === false || sealOptions.integrity.iterations === 1))
    break;
  const options = legacy ? {/* iterations: 1 em encryption e integrity */} : sealOptions;
  for (const [index, password] of passwords.entries()) {
    try {
      const unsealed = (await unseal(sealed, password, options)) as Partial<Session>;
      if (unsealed && (legacy || index > 0)) (unsealed as any)[kLegacySeal] = true;
      return unsealed;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
      lastError = error;
    }
  }
}
throw lastError;
```

Invariantes a preservar: `unsealed` pode ser `null` (`iron-crypto.ts:149`); a guarda `if (unsealed && ...)` replica `src/utils/session.ts:345`. O objeto devolvido não vaza o símbolo para o usuário, porque `getSession` o remove em `:199-202`. A mensagem de erro final para o chamador de `unsealSession` continua `"Bad hmac value"`, como hoje quando nada abre.

## 5. Estratégia de testes

Arquivo: `test/session.test.ts`, usando `describeMatrix` (já em `:15`), sem arquivo novo. Usar `seal`/`unseal`/`sealDefaults` já importados em `:12`. Padrão: criar cookie com `seal(...)` (como em `:135-143`) e fazer `t.fetch("/", { headers: { Cookie: ... } })`, com uma rota própria que use a config de rotação (como `/strict` em `:172`). Duas senhas fixas de pelo menos 32 caracteres (`P0`, `P1`, `P2`, `P3`).

| Teste                                    | RF          | Verifica                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| aceita sessão selada com senha extra     | RF-03       | mesmo `id`, `createdAt` e `data` via cookie; vale também via header `x-h3-test-session`.                                                                                                                                                                           |
| sela só com `password`                   | RF-02       | após criar e atualizar a sessão, o cookie abre com P2 e **não** abre com P1 (`rejects.toThrow("Bad hmac value")`).                                                                                                                                                 |
| migra sessão de senha extra              | RF-05       | `Set-Cookie` presente, abre com P2, preserva `id`, `createdAt` e `data`; via header não há `Set-Cookie`.                                                                                                                                                           |
| rejeita senha desconhecida               | RF-04       | selo de P0: `id` novo, `data` vazio, sem erro no handler (`ctx.errors` vazio).                                                                                                                                                                                     |
| ordem e várias extras                    | RF-03/RF-09 | `[P3, P1]` abre sessão de P1; sessão selada com P2 e P1 em ambas as posições escolhe a primeira que abrir; a `password` atual tem prioridade.                                                                                                                      |
| `maxAge`/`idleTimeout` com senha extra   | RF-06       | com `vi.useFakeTimers({ toFake: ["Date"] })` (padrão de `:313`), sessão vencida selada com P1 é rejeitada e substituída; a migrada mantém `createdAt`.                                                                                                             |
| legado com senha extra                   | RF-07       | selo com 1 iteração e P1 é aceito e resselado com P2 e iterações atuais (`unseal(resealed, P2, sealDefaults)`); com `legacySealFallback: false` é rejeitado.                                                                                                       |
| `seal` customizado com senha extra       | RF-07       | com `config.seal` de iterações diferentes das padrão, sessão de P1 selada com essas opções abre.                                                                                                                                                                   |
| sem regressão                            | RF-08       | `extraUnsealPasswords: []` e ausente se comportam como hoje; os testes existentes seguem passando sem mudança.                                                                                                                                                     |
| erro de política não tenta outras senhas | D-05        | espionar `unseal` não é viável (import direto); verificar que uma sessão expirada selada com P2 (`password`) é rejeitada sem consultar P1, por exemplo medindo que a rejeição não depende de P1 ser válida. Se o sinal for fraco, aceitar a cobertura por revisão. |

Regras do repositório (Bug Fix Workflow de `AGENTS.md`): escrever os testes **antes** da implementação, confirmar que os de RF-02 a RF-07 falham (o teste "sela só com `password`" passa sem mudança, pois documenta RF-02) e depois implementar. Passos de validação:

1. `pnpm vitest run test/session.test.ts` (web e node).
2. `pnpm vitest run test/unit/package.test.ts` (API pública intacta).
3. `pnpm lint` e `pnpm typecheck`.
4. `pnpm fmt` para regenerar `docs/2.utils/4.security.md` via `automd`, conferindo que o diff é só o esperado.
5. `pnpm test` completo ao final.

## 6. Riscos

| ID   | Risco                                                                                                                                                           | Mitigação                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Custo de CPU (PBKDF2): cada senha extra adiciona uma derivação por tentativa que falha.                                                                         | D-04: `password` primeiro, para no primeiro sucesso, só `"Bad hmac value"` avança (D-05). TSDoc recomenda poucas extras. Pior caso por requisição com cookie inválido: `2 × (1 + N)` derivações de HMAC. |
| R-02 | Cookie forjado ou de senha desconhecida amplifica o custo (superfície de DoS) linearmente em N.                                                                 | N é controlado pelo operador. Já existe amplificação 2× do fallback legado. Documentar; sem limite artificial (D-07).                                                                                    |
| R-03 | Mensagem `"Bad hmac value"` usada como discriminador (string frágil).                                                                                           | Reaproveita a checagem existente em `src/utils/session.ts:336`; o teste de RF-04 e o de ordem quebram se a mensagem mudar no iron.                                                                       |
| R-04 | Reuso de `kLegacySeal` pode confundir leitores.                                                                                                                 | D-06: ajustar o comentário em `src/utils/session.ts:210-213`. O símbolo é interno.                                                                                                                       |
| R-05 | Uma extra inválida (curta ou vazia) só falha quando as anteriores não abriram o selo, e `getSession` engole o erro (`:197`): a sessão é descartada em silêncio. | Mesmo comportamento de uma `password` inválida hoje. Documentar o requisito de 32 caracteres na TSDoc. Validação antecipada foi descartada (D-07).                                                       |
| R-06 | Sessões via header não migram e continuam seladas com a senha antiga até expirar.                                                                               | Aceito pelo PRD; documentar na TSDoc e em `docs/4.examples/handle-session.md`.                                                                                                                           |
| R-07 | Remover a extra cedo demais invalida sessões ainda ativas.                                                                                                      | Documentar: manter até passar `maxAge` (ou `idleTimeout`) desde a rotação. Sem esses limites configurados, o operador decide.                                                                            |
| R-08 | Senha extra comprometida continua abrindo sessões e, pela migração, as renova com a senha nova.                                                                 | Documentar que deve ser removida assim que possível. Fora de escopo: revogação em tempo de execução.                                                                                                     |
| R-09 | `src/utils/session.ts` passa de ~465 linhas, contra a meta de `AGENTS.md` (< 200 LoC).                                                                          | O arquivo já excede a meta. O helper é pequeno e fica no fim do arquivo (D-08); dividir o arquivo é refatoração fora do escopo.                                                                          |
| R-10 | O teste de "não tenta outras senhas após erro de política" tem sinal fraco sem espionar `unseal`.                                                               | Cobrir RF-06 por comportamento; se necessário, aceitar revisão de código para essa garantia.                                                                                                             |
