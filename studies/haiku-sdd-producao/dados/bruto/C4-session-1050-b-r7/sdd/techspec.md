# Especificação técnica: várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-09), issue h3js/h3#1050.

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `4dacd38`).

## Visão geral

Hoje `getSession`, `updateSession`, `sealSession` e `unsealSession` usam uma única senha, `config.password`. A mudança adiciona `SessionConfig.extraUnsealPasswords?: string[]`:

- **Selagem** continua exclusivamente com `config.password`. Nenhuma linha de `sealSession` passa a usar as extras.
- **Abertura** tenta, em ordem, `password` e depois cada extra. Para cada senha, mantém o fallback legado de 1 iteração que já existe. A primeira que verifica o HMAC abre o cookie.
- **Expiração** (`maxAge`, `idleTimeout`) é avaliada uma vez, sobre o resultado da senha que abriu, como hoje.
- **Validação**: cada senha extra com menos caracteres que o mínimo do seal lança erro claro em `getSession`, em vez de sumir em silêncio.

O impacto fica concentrado em `src/utils/session.ts`. `src/utils/internal/iron-crypto.ts` não muda.

---

## Decisões de arquitetura

### D-01 — Forma do campo: `extraUnsealPasswords?: string[]` em `SessionConfig`

**Escolha.** Campo opcional novo, lista de strings, ao lado de `password`. `password` continua `string`. Isso segue o contrato em `sdd/pedido.md` (seção "Nomes públicos") e o RF-01.

**Alternativas.**
- *`password: string | string[]`* (segunda alternativa da issue). Quebra a semântica de `password` como senha que sela, exige narrowing em todo o código e está fora de escopo (`sdd/prd.md`, "Fora de escopo").
- *Objeto `{ password, unseal: [...] }`* ou `passwords` com ids. Introduz nome público novo, contra a restrição de `pedido.md`.

**Justificativa.** Campo aditivo e opcional não quebra nenhuma configuração existente, e o tipo continua simples.

### D-02 — Abertura por tentativa sequencial, não por id

**Escolha.** Tentar cada senha em ordem até o HMAC bater.

**Por quê.** Com senha `string`, o iron sela com id vazio (`src/utils/internal/iron-crypto.ts:68`, `const { id = "" ...}`), e o `unseal` ignora o id do cookie quando a senha é string (`src/utils/internal/iron-crypto.ts:121-123`: `_passwordId` só é usado com objeto de senhas). Não há identificador no cookie para escolher a senha. Já o HMAC cobre o cookie inteiro, então só uma senha passa.

**Alternativas.** Usar o objeto de senhas do iron com ids (`{ id: secret }`) e gravar um `kid` no cookie. Isso muda o formato selado e as sessões já emitidas, e está fora de escopo (`sdd/prd.md`, "Fora de escopo").

### D-03 — O loop mora dentro de `unsealSession`, com assinatura inalterada

**Escolha.** A lógica de múltiplas senhas fica em `unsealSession` (`src/utils/session.ts:312`). Assinatura e retorno não mudam.

**Por quê.** `unsealSession` é exportado (`src/index.ts:209`) e é a única função que chama `unseal` para sessões. Quem chama `unsealSession` diretamente também ganha o comportamento, e `getSession` (`src/utils/session.ts:196`) não precisa saber das extras.

**Alternativas.** Loop em `getSession`. Duplica a lógica para o caminho de header e para chamadas diretas, e espalha a regra de abertura em dois lugares.

### D-04 — Nova tentativa só em "Bad hmac value"

**Escolha.** Dentro do loop, só erros `Bad hmac value` (`src/utils/internal/iron-crypto.ts:136`) disparam a próxima senha. Qualquer outro erro é relançado na hora: formato inválido (`:100`), `Expired seal` (`:117`), erro de decrypt, etc.

**Por quê.** `Bad hmac value` é o único erro que indica "senha errada". Os outros são independentes da senha, então tentar de novo só mascara o problema e gasta CPU. Esse é o mesmo critério que o fallback legado já usa (`src/utils/session.ts:332-337`).

**Expiração.** `maxAge` e `idleTimeout` são verificados depois do loop, uma única vez, sobre o resultado da senha que abriu (`src/utils/session.ts:350-365`). Assim, uma sessão expirada aberta por uma extra é rejeitada como as demais (RF-07), sem nova tentativa.

**Alternativa rejeitada.** Tentar a próxima senha em qualquer erro. Faria uma sessão expirada ser testada contra todas as senhas e mascararia erros reais.

### D-05 — Fallback legado aplicado a cada senha, na mesma ordem

**Escolha.** Para cada senha, na ordem `[password, ...extras]`, o código tenta a abertura normal e depois o fallback de 1 iteração (o bloco atual de `src/utils/session.ts:322-347`, movido para uma função que recebe a senha). Só então passa para a próxima senha.

**Por quê.** Mantém o bloco atual quase verbatim e torna os casos fáceis de testar: uma sessão legada selada com extra é aberta e regravada (RF-03 + RF-08). O custo do fallback é uma derivação de 1 iteração, desprezível.

**Alternativa.** Tentar todas as senhas normais primeiro e só depois o fallback. Mesmo resultado, código um pouco mais longo. Rejeitada por simplicidade.

### D-06 — Validação de tamanho das extras em `getSession`, antes do bloco que engole erros

**Escolha.** Antes de qualquer escrita em `context.sessions` e antes do bloco de carga, `getSession` valida cada senha extra contra o mínimo de caracteres, e lança `Error` com mensagem clara se alguma for curta. O mínimo é `sealOptions.integrity.minPasswordlength`, que é o valor que `generateKey` checa primeiro na abertura (`src/utils/internal/iron-crypto.ts:160`, `:191-196`).

**Por quê.** Hoje `getSession` captura qualquer erro de `unsealSession` com `.catch(() => {})` (`src/utils/session.ts:197`). Se a validação ficasse dentro de `unsealSession`, uma extra curta faria a sessão dela sumir sem aviso (risco R-02 em `sdd/prd.md`). Lançando antes do `try`, o erro aparece na primeira requisição.

**Por que só as extras.** Validar também `password` mudaria o comportamento atual de `password` curta, que hoje é engolido na carga e falha só na selagem. Isso violaria RF-06 ("sem senhas extras, o comportamento não muda").

**Alternativas.**
- Validar em `unsealSession`: engolido pelo `.catch` (`src/utils/session.ts:197`). Rejeitada.
- Validar em `useSession`: não cobre quem usa `getSession` ou `updateSession` direto. Rejeitada.
- Validar `password` também: muda RF-06. Rejeitada.

### D-07 — Sem limite de quantidade de extras; custo documentado

**Escolha.** Nenhum teto no código. A lista é definida pelo desenvolvedor, não pelo cliente. Documentar o custo (R-01).

**Por quê.** Um cookie forjado custa hoje uma derivação de 8192 iterações (o HMAC é verificado antes do decrypt, `src/utils/internal/iron-crypto.ts:132-137`). Com N extras, custa N+1 derivações, mais N tentativas de 1 iteração. Um teto arbitrário não resolve, e o caminho real é manter a lista curta e remover as extras assim que a janela de rotação acabar.

**Alternativa.** Limitar a N (por exemplo, 3) com erro na validação. Adicionaria um número mágico sem base medida. Fica como ajuste futuro se os benchmarks mostrarem problema (`pnpm bench:node`).

### D-08 — Mesmas opções de seal para as extras

**Escolha.** As senhas extras são abertas com os mesmos `SealOptions` da senha atual (`config.seal` mais defaults). Isso é consequência direta do modelo atual: as opções vêm de `config.seal` e valem para toda sessão.

**Consequência a documentar.** Trocar `seal.encryption.iterations` ou `seal.integrity.iterations` junto com a rotação de senha torna as sessões antigas ilegíveis, porque o HMAC é derivado com as iterações novas. O fallback legado cobre só o caso de 1 iteração. Isso fica fora de escopo, mas deve constar na documentação (ver D-10).

### D-09 — Nenhuma API nova de selagem

**Escolha.** `sealSession` e `updateSession` mudam só para usar uma função interna de opções (`getSealOptions`, ver contratos). O `seal` continua recebendo `config.password` (`src/utils/session.ts:300-301`). Isso cumpre RF-04 e RF-08 sem código novo de selagem.

### D-10 — Documentação

**Escolha.**
- JSDoc de `extraUnsealPasswords` em `SessionConfig`, dizendo que são só para abrir, que a remoção é manual, e que a lista deve ser curta (custo, R-01/R-03).
- Parágrafo novo em `docs/4.examples/handle-session.md` depois de `:143`, seguindo o tom das outras notas.
- `CHANGELOG.md` não é editado à mão. Ele tem links de commit, sinal de geração automática. Assumido, não verificado no pipeline de release.

---

## Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:40-48` (`SessionConfig.password`) | Novo campo `extraUnsealPasswords?: string[]` logo após `password`, com JSDoc. |
| `src/utils/session.ts` | `:149-153` (início de `getSession`) | Chamar `assertUnsealPasswords(config)` antes de qualquer escrita em `context.sessions` (D-06). |
| `src/utils/session.ts` | `:282-304` (`sealSession`) | Trocar o objeto de opções inline (`:300-304`) por `getSealOptions(config)`. Comportamento igual. |
| `src/utils/session.ts` | `:312-347` (`unsealSession`, bloco `try/catch`) | Extrair o bloco atual para `unsealWithFallback(sealed, password, config, sealOptions)` e chamar pelo loop `unsealWithAnyPassword` (D-03, D-04, D-05). |
| `src/utils/session.ts` | `:317-321` | Opções de seal passam por `getSealOptions(config)`. |
| `src/utils/session.ts` | `:350-365` | Sem mudança de lógica. Continua depois do loop. |
| `test/session.test.ts` | `:15` (`describeMatrix`), fim do arquivo (~`:777`) | Novo `describe("extraUnsealPasswords", ...)` dentro do matrix (casos na seção "Estratégia de testes"). |
| `docs/4.examples/handle-session.md` | depois de `:143` | Parágrafo sobre rotação com `extraUnsealPasswords`. |

**Não alterar:**
- `src/utils/internal/iron-crypto.ts`. O `unseal` e o `seal` existentes bastam.
- `src/index.ts`. `SessionConfig` já é exportado (`src/index.ts:210`), e nenhum nome novo é exportado.
- `src/utils/internal/session.ts`. Nenhuma constante nova.
- Algoritmos, PBKDF2, opções de `seal`, `legacySealFallback` (fica para v3, `src/utils/session.ts:93-94`).
- `_deprecated.ts` e v1.

---

## Contratos e assinaturas

### Tipo público (único nome público novo)

```ts
// src/utils/session.ts
export interface SessionConfig {
  /** ... */
  password: string;
  /**
   * Previous passwords, used only to open sessions sealed with them. Each must
   * meet the same minimum length and entropy requirements as `password`.
   * Sessions opened with one of these are resealed with `password` on their
   * next write. Remove an entry once its sessions have expired or been
   * rewritten: keeping it keeps that old secret valid.
   *
   * Opening tries `password` first, then these in order. The list should stay
   * short, because every extra password adds one PBKDF2 derivation to each
   * request carrying an unknown cookie.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}
```

### Funções internas (não exportadas)

```ts
// src/utils/session.ts — assinaturas novas, não exportadas

/** Opções de seal efetivas. Extraída de sealSession e unsealSession, sem mudar o valor. */
function getSealOptions(config: SessionConfig): SealOptions;

/** Lança Error se alguma extra for menor que o mínimo do seal. Chamada no início de getSession. */
function assertUnsealPasswords(config: SessionConfig, sealOptions: SealOptions): void;

/** Tenta a senha; fallback legado de 1 iteração se permitido. Mesmo comportamento do bloco atual. */
async function unsealWithFallback(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session> & { [kLegacySeal]?: true }>;

/** Percorre [password, ...extraUnsealPasswords]. Continua só em "Bad hmac value". */
async function unsealWithAnyPassword(
  sealed: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

### Assinaturas que **não** mudam

```ts
export async function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export async function updateSession<T>(event, config, update?): Promise<Session<T>>;
export async function sealSession<T>(event, config): Promise<string>;
export async function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;
```

### Esboço de `unsealSession`

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = getSealOptions(config);
  const unsealed = await unsealWithAnyPassword(sealed, config, sealOptions);
  // Expiração: bloco atual, sem mudança (maxAge e idleTimeout)
  // ...
  return unsealed;
}

async function unsealWithAnyPassword(sealed, config, sealOptions) {
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let error: unknown;
  for (const password of passwords) {
    try {
      return await unsealWithFallback(sealed, password, config, sealOptions);
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "Bad hmac value") throw err;
      error = err;
    }
  }
  throw error;
}
```

`passwords` tem sempre pelo menos um item, então `error` está definido quando o laço termina.

### Comportamento observável

| Situação | Resultado |
| --- | --- |
| Sem `extraUnsealPasswords` ou `[]` | Idêntico ao atual (RF-06). |
| Cookie selado com `password` | Aberto na primeira tentativa. |
| Cookie selado com uma extra | Aberto na tentativa correspondente. Sessão aberta é regravada com `password` se houver escrita ou deslizamento (RF-03, RF-08). |
| Cookie com senha desconhecida | Todas tentadas, todas "Bad hmac value". Erro relançado, engolido por `getSession`, sessão nova em memória (RF-05). |
| Extra com menos de `minPasswordlength` caracteres | `getSession` lança `Error` na primeira chamada, antes de qualquer cookie ser lido (D-06). |
| Sessão aberta por extra e expirada | Rejeitada como expirada (RF-07). |

---

## Estratégia de testes

Seguir o fluxo de `AGENTS.md` ("Bug Fix Workflow" adaptado): escrever os testes primeiro e confirmar que falham antes de implementar.

### Infraestrutura

- Arquivo: `test/session.test.ts`, dentro do `describeMatrix` (`:15`), para rodar em `web` e `node`.
- Selar sessões com senhas específicas usando `seal` e `sealDefaults` de `src/utils/internal/iron-crypto.ts`, como os testes legados já fazem (`test/session.test.ts:135-141`).
- Verificar o cookie resultante com `unseal`, como em `test/session.test.ts:157`. Para provar que a senha antiga não sela, `unseal(resealed, "senha-antiga", sealDefaults)` deve lançar `Bad hmac value`.
- Tempo: `vi.useFakeTimers({ toFake: ["Date"], now: t0 })` com `vi.setSystemTime` e `vi.useRealTimers` no `finally`, como em `test/session.test.ts:190-227` e `:265-270`.

### Casos (um `it` por linha)

| ID | Caso | Cobre |
| --- | --- | --- |
| T-01 | Sessão selada com `password` lida com `extraUnsealPasswords: ["antiga"]`. Mesmos `id`, `createdAt`, `data`. | RF-02 |
| T-02 | Sessão selada com `"antiga"` lida com `password: "nova"`, `extraUnsealPasswords: ["antiga"]`. Dados disponíveis. | RF-03 |
| T-03 | Sessão selada com `"antiga"` lida, depois `update` na requisição. Cookie resultante abre com `"nova"` e **não** abre com `"antiga"`. | RF-04, RF-08 |
| T-04 | Sessão selada com senha desconhecida. Nova sessão em memória, `data` vazio, sem dados da sessão anterior. | RF-05 |
| T-05 | `extraUnsealPasswords: []` e campo ausente produzem o mesmo resultado. | RF-06 |
| T-06 | Sessão selada com extra, `createdAt` além de `maxAge`. Rejeitada. | RF-07 |
| T-07 | Sessão selada com extra, `lastSeenAt` além de `idleTimeout`. Rejeitada. | RF-07 |
| T-08 | Sessão legada (1 iteração) selada com extra. Aberta e regravada com `password`. | D-05 |
| T-09 | Extra com menos de 32 caracteres. `getSession` rejeita com mensagem que cita o tamanho, sem criar sessão. | D-06 |
| T-10 | Sessão selada com extra e lida pelo header `x-h3-test-session` (sem cookie). Aberta. | D-03, caminho do header |
| T-11 | Sessão selada com extra, `idleTimeout` ativo, sessão ociosa além da metade da janela. Deslizamento reseleia com `password`. | RF-08 |

Os testes de T-01 a T-08 e T-10 a T-11 rodam nos dois modos pelo `describeMatrix`. T-09 é independente de runtime, mas pode ficar no mesmo `describe`.

### Regressão

- Os testes existentes de sessão (`test/session.test.ts`, incluindo legado em `:134-186`, idle/maxAge em `:188-410`, lazy creation em `:692+`) devem passar sem alterar asserções (RF-06).
- `test/unit/` e `test/rules/` não usam sessão. Rodar a suíte completa uma vez antes do PR.

### Comandos de verificação

```bash
pnpm vitest run test/session.test.ts
pnpm typecheck
pnpm lint
pnpm test          # lint + typecheck + cobertura, antes do PR
pnpm bench:node    # opcional: medir o custo com 0, 1 e 3 extras (R-01)
```

---

## Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | **Custo de CPU com cookies forjados.** Um cookie com senha desconhecida custa N+1 derivações PBKDF2 de 8192 iterações, mais N de 1 iteração. Pode ser usado como amplificação. | D-07: lista curta, custo documentado no JSDoc e em `handle-session.md`. Medir com `pnpm bench:node`. Teto no código fica como próximo passo se necessário. |
| R-02 | **Falha silenciosa com extra curta.** `getSession` engole erros de `unsealSession` (`src/utils/session.ts:197`). | D-06: validação em `getSession` antes do `try`. Teste T-09. |
| R-03 | **Segredo antigo que nunca sai.** Uma extra na configuração mantém válido um segredo possivelmente vazado. | Documentar que a remoção é manual e que é o fim da janela. Ver JSDoc (D-10). |
| R-04 | **Interação com `legacySealFallback`.** O fallback hoje vale só para a senha atual. | D-05: fallback por senha, testado em T-08. `legacySealFallback: false` continua desligando o fallback para todas. |
| R-05 | **Regressão na leitura de sessões existentes.** A extração de `unsealWithFallback` mexe no caminho de todas as leituras. | Mover o bloco verbatim, sem mudar lógica. Suíte existente (RF-06) é a rede de segurança. |
| R-06 | **Mudança de iterações junto com a rotação.** Sessões antigas deixam de abrir (D-08). | Documentar. Fora de escopo. Para rotacionar senha sem mudar iterações, não há problema. |
| R-07 | **Ordem de tentativa.** Afeta só a latência, não o resultado, porque só uma senha valida o HMAC. | Documentar a ordem (`password` primeiro). |

---

## Pendências e pontos a confirmar

- Confirmar se `CHANGELOG.md` é gerado no release (D-10). Se for manual, adicionar entrada.
- Decidir com o time se o teto de N extras (D-07) entra já ou depois de medir R-01.
- `sdd/prd.md` lista a validação de extras como mitigação. Esta spec a implementa em `getSession` (D-06), e não em `unsealSession`, por causa do `.catch` existente.
