# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Referências: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-07, premissas P1 a P4, riscos R1 a R4).

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `sealSession` continua selando só com `password`. `unsealSession` tenta `password` e depois cada extra, na ordem, e para na primeira que valida. A assinatura pública de `unsealSession` e de todas as funções exportadas não muda. O código de `iron-crypto.ts` não muda.

## Premissas verificadas no código

- **P1 confirmada.** Senha errada gera `Bad hmac value`: `src/utils/internal/iron-crypto.ts:135-137` compara o HMAC e lança esse erro. O teste `test/unit/iron-crypto.test.ts:269` fixa essa mensagem.
- **Ordem interna do `unseal`.** A expiração (`Expired seal`, `src/utils/internal/iron-crypto.ts:110-118`) é checada antes do HMAC (`:133-137`). Uma sessão expirada falha da mesma forma com qualquer senha.
- **Custo por tentativa falha (correção ao R1 do PRD).** Uma tentativa falha deriva só a chave de integridade, com 8192 iterações PBKDF2 (`iron-crypto.ts:133`). A derivação de criptografia (`:147`) só roda depois do HMAC válido. O fallback legado soma uma derivação com 1 iteração. Uma sessão aberta pela senha `k` custa `k` derivações de integridade falhas antes dela, mais 2 derivações de sucesso.
- **Senha curta.** `generateKey` rejeita senha com menos de `minPasswordlength` antes de qualquer PBKDF2 (`iron-crypto.ts:191-196`). O mínimo vem de `opts.integrity` no `unseal` (`iron-crypto.ts:133`, padrão 32 em `:22` e `:28`).
- **`getSession` engole erros de unseal.** `src/utils/session.ts:197` tem `.catch(() => {})`. Por isso RF-04 (não expor a senha tentada) já vale sem código novo.

## Decisões de arquitetura

### D-01 — Onde fica a lógica de múltiplas senhas

**Escolha:** a tentativa em lista fica dentro de `src/utils/session.ts`, em uma função interna que `unsealSession` chama. `iron-crypto.ts` não muda.

**Alternativas consideradas:**
1. Passar a lista para `unseal` do iron e deixar o iron escolher. O iron só escolhe a senha pelo `passwordId` gravado no selo (`iron-crypto.ts:121-128`). O `seal` grava id vazio (`:68`, `:79`), então isso exigiria mudar o formato do selo, o que o PRD proíbe (fora de escopo).
2. Tentativa em lista dentro de `session.ts`. Reaproveita `unseal` como está.

**Justificativa:** a opção 2 não muda formato, não muda `iron-crypto.ts` e fica no módulo que já trata o fallback legado.

### D-02 — Quais erros permitem tentar a próxima senha

**Escolha:** só `Bad hmac value` avança para a próxima senha. Qualquer outro erro é relançado na hora.

**Alternativas consideradas:**
1. Tentar a próxima senha para qualquer erro. Uma sessão expirada custaria uma derivação por senha da lista antes de falhar. Erros de formato também seriam mascarados.
2. Só `Bad hmac value`.

**Justificativa:** é a mesma condição que o fallback legado já usa (`src/utils/session.ts:332-337`). Com a opção 2, `Expired seal` falha na primeira tentativa, e um selo corrompido não é retentado com outras senhas.

### D-03 — Ordem entre senha e fallback legado

**Escolha:** para cada senha, na ordem `[password, ...extraUnsealPasswords]`, tenta primeiro a iteração padrão e depois o fallback legado (1 iteração), se `legacySealFallback !== false`. Só então passa para a senha seguinte.

**Alternativas consideradas:**
1. Primeiro tentar todas as senhas com a iteração padrão e só depois todas com a legada. Uma sessão legada selada com uma senha extra custaria todas as derivações padrão antes de chegar ao fallback.
2. Por senha, padrão e legado juntos (escolhida).

**Justificativa:** a opção 2 mantém o trecho do fallback legado como está, só trocando `config.password` pela senha da iteração. Com ela, uma sessão legada com senha extra custa uma derivação completa falha por senha anterior e uma derivação legada falha por senha, sem refazer tentativas com a iteração padrão. (Atende R3 do PRD.)

### D-04 — Validação das senhas extras (RF-06)

**Escolha:** antes de qualquer tentativa, `unsealSession` valida cada item de `extraUnsealPasswords` com o mesmo mínimo que o iron usa (`sealOptions.integrity.minPasswordlength`) e lança `Password string too short (min N characters required)`. A validação não inclui `password`.

**Alternativas consideradas:**
1. Deixar o iron lançar quando a senha curta for alcançada. Isso depende da posição: uma extra curta antes de uma válida bloquearia a válida.
2. Validar todas as senhas, inclusive `password`, no início. Mudaria a mensagem de `password = ""`: hoje o iron lança `Empty password` (`iron-crypto.ts:94-95`), e com a validação viraria `too short`.
3. Validar só as extras, no início (escolhida).

**Justificativa:** a opção 3 é determinística (uma extra curta sempre gera erro, sem depender de qual senha abriu a sessão) e não altera o comportamento de `password`. Como a mensagem é igual à do iron, a regra fica igual à de `password` (R4 do PRD).

### D-05 — Selagem

**Escolha:** `sealSession` não muda. Usa `config.password` (`src/utils/session.ts:300`). Senhas extras nunca selam.

**Justificativa:** é o RF-02 e o contrato do pedido.

### D-06 — Regravar sessões abertas com senha extra (P3)

**Escolha:** não regravar dentro de `getSession` nesta entrega. Uma sessão aberta por senha extra continua com o selo antigo até ser resselada por escrita (`updateSession`) ou pelo deslizamento de `idleTimeout` (`src/utils/session.ts:214-216`, `shouldSlide` em `:414-421`).

**Alternativas consideradas:**
1. Regravar com `password` assim que a sessão for aberta por senha extra. Exige que `unsealSession` informe qual senha funcionou. Isso pode ser feito com um símbolo interno, como `kLegacySeal` já faz (`src/utils/session.ts:346`), sem mudar a assinatura pública. Mesmo assim, o PRD põe isso fora de escopo.
2. Não regravar (escolhida).

**Justificativa:** mantém o escopo do PRD. A migração acontece sozinha com o uso normal, e a alternativa 1 fica como acompanhamento.

### D-07 — Tipo e documentação do campo

**Escolha:** `extraUnsealPasswords?: string[]` logo depois de `password` em `SessionConfig` (`src/utils/session.ts:39-99`), com JSDoc no mesmo tom de `password`: tamanho mínimo, que só desselam, que a lista deve ser curta e que a remoção é responsabilidade de quem configura (R2).

**Justificativa:** o PRD exige o campo como `string[]` opcional e nenhum outro nome público novo (RF-01). Um trecho de exemplo em `docs/4.examples/handle-session.md` pode ser incluído, mas é opcional.

### D-08 — Compatibilidade

**Escolha:** sem `extraUnsealPasswords` (ausente ou `[]`), o fluxo de `unsealSession` é o mesmo de hoje: uma tentativa com `password`, mesmo fallback legado, mesma mensagem de erro. `test/unit/package.test.ts:149` continua válido porque não há exportação nova.

## Arquivos a alterar

| Arquivo | Trecho atual | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `SessionConfig.password` em `:48` | Adicionar `extraUnsealPasswords?: string[]` e JSDoc (D-07). |
| `src/utils/session.ts` | `unsealSession` em `:312-367`; `unseal` em `:324`; fallback legado em `:325-348`; checagens de expiração em `:350-365` | Validar extras (D-04), tentar a lista (D-01/D-02/D-03), isolar o fallback legado em função por senha. As checagens de `maxAge`/`idleTimeout` ficam depois, sem mudança (P4). |
| `src/utils/session.ts` | Helpers no fim do arquivo, a partir de `:388` | Adicionar `isBadHmac` (usado também pelo fallback) e a validação das extras (ou manter a validação dentro de `unsealSession`). Os helpers `shouldSlide` (`:414`) e `sessionExpires` (`:455`) não mudam. |
| `test/session.test.ts` | `describeMatrix` em `:15`; `sessionConfig` em `:21-25`; casos de legado em `:134-186`; bloco `lazy creation` em `:692` | Novos casos de rotação (ver Estratégia de testes). |
| `docs/4.examples/handle-session.md` | exemplo de configuração em `:29` | Opcional: mencionar o campo (D-07). |

`src/utils/internal/iron-crypto.ts`, `src/index.ts` e `test/unit/package.test.ts` não mudam.

## Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /** ... (sem mudança) */
  password: string;
  /**
   * Previous passwords accepted only to unseal sessions, tried in order after
   * `password`. Each must be at least 32 characters. Sessions are always sealed
   * with `password`. Keep the list short and remove old entries once the
   * rotation window has passed: each one adds a failed key derivation to every
   * request that carries an invalid cookie.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos sem mudança
}

// Assinaturas públicas: sem mudança
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

export async function sealSession<T extends SessionData = SessionData>(
  event: HTTPEvent,
  config: SessionConfig,
): Promise<string>;
```

Esboço da lógica interna (não exportada):

```ts
export async function unsealSession(_event, config, sealed) {
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  assertUnsealPasswords(config.extraUnsealPasswords || [], sealOptions); // D-04
  const unsealed = await unsealWithAnyPassword(sealed, config, sealOptions);
  // checagens de maxAge e idleTimeout: sem mudança
}

async function unsealWithAnyPassword(sealed, config, sealOptions) {
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let lastError: unknown;
  for (const password of passwords) {
    try {
      return await unsealWithPassword(sealed, password, config, sealOptions); // D-03: padrão, depois legado
    } catch (error) {
      if (!isBadHmac(error)) throw error; // D-02
      lastError = error;
    }
  }
  throw lastError;
}

function isBadHmac(error: unknown): boolean {
  return error instanceof Error && error.message === "Bad hmac value";
}

function assertUnsealPasswords(passwords: string[], sealOptions: SealOptions): void {
  const min = sealOptions.integrity.minPasswordlength;
  for (const password of passwords) {
    if (password.length < min) {
      throw new Error(`Password string too short (min ${min} characters required)`);
    }
  }
}
```

Observações sobre o esboço:
- `unsealWithPassword` é o corpo atual do `try/catch` (`:323-348`), com `password` no lugar de `config.password` nas duas chamadas de `unseal`. A condição do fallback legado passa a usar `isBadHmac`.
- `return` de `null` (quando `unseal` devolve `null`) segue o caminho de hoje. Não se usa `if (!unsealed)` para decidir, porque isso mudaria esse caso.

## Estratégia de testes

Todos os casos vão em `test/session.test.ts`, dentro de `describeMatrix`, então rodam nos modos web e node (RF-07). Para selos de teste, usar `seal` de `src/utils/internal/iron-crypto.ts`, como os testes de legado já fazem (`test/session.test.ts:135-143`). Para a contagem de derivações, usar o mesmo `vi.spyOn(crypto.subtle, "deriveBits")` do teste de `seal-count` (`:722-735`).

| Caso | Como | Cobre |
| --- | --- | --- |
| Sessão selada com senha antiga é aceita | Selar com `OLD`, configurar `password: NEW` e `extraUnsealPasswords: [OLD]`, ler a sessão, esperar o `id` e os dados. | RF-03 |
| Sessão com senha desconhecida é rejeitada | Selar com `UNKNOWN`, ler com a configuração acima. Esperar `id` diferente e `data` vazio. | RF-04 |
| Selagem só com a senha nova | Criar sessão com a configuração de rotação, extrair o cookie e checar que `unseal(cookie, OLD, sealDefaults)` rejeita com `Bad hmac value`, e que `unseal(cookie, NEW, sealDefaults)` funciona. | RF-02 |
| Lista vazia ou ausente | Repetir o caso "sessão antiga" com `[]` e com o campo ausente: a sessão antiga é rejeitada, como hoje. Os testes existentes não mudam de expectativa. | RF-05 |
| Senha extra curta | Configurar `extraUnsealPasswords: ["curta"]`, ler uma sessão válida com `password`. Esperar a resposta da sessão nova e, por `unsealSession` direto, a mensagem `too short`. | RF-06, R4 |
| Ordem e parada no primeiro acerto | Com `password: NEW`, `extraUnsealPasswords: [OTHER, OLD]`, sessão selada com `OLD`: `deriveBits` deve ser chamado 3 vezes (uma falha com `NEW`, duas de sucesso com `OLD`). Se `OTHER` fosse tentado, seriam 4. | RF-03, D-02 |
| Sessão legada com senha extra | Selar com `OLD` em 1 iteração, configurar com extra `OLD`. Esperar os dados, e que o cookie de resposta foi resselado com `NEW` nas iterações padrão. | R3, D-03 |
| Legado com `legacySealFallback: false` e extra | Mesmo selo, com `legacySealFallback: false`. Esperar sessão nova. | D-03 |
| Sessão expirada com extras | Selar com `OLD` e `ttl` curto, avançar o tempo, ler com extras. Esperar sessão nova e que `deriveBits` não foi chamado mais de uma vez (sem tentar as demais senhas). | D-02 |

Comandos:

```bash
pnpm vitest run test/session.test.ts
pnpm vitest run test/unit/iron-crypto.test.ts test/unit/package.test.ts
pnpm lint        # oxlint + oxfmt --check + tsc, conforme AGENTS.md
pnpm typecheck   # tsc --noEmit
```

Ordem de trabalho (AGENTS.md, "Bug Fix Workflow"): escrever os casos novos primeiro e confirmar que falham nos casos de rotação; depois implementar; depois rodar a suíte completa.

## Riscos

| # | Risco | Impacto | Mitigação |
| --- | --- | --- | --- |
| 1 | Custo de CPU por cookie inválido cresce com o número de extras (R1, com o custo corrigido em "Premissas verificadas"). | Requisições não autenticadas ficam mais caras. | JSDoc pede lista curta (D-07); documentar. Não adicionar limite de tamanho nesta entrega. |
| 2 | Senha vazada que continua na lista continua abrindo sessões (R2). | Segurança depende de quem configura. | JSDoc deixa claro que a remoção é responsabilidade de quem configura. |
| 3 | Sessões antigas só migram quando são escritas ou deslizam (P3, D-06). | Uma senha antiga precisa ficar na lista até o último uso normal da sessão. | Decisão a confirmar com o time; regravação imediata fica como acompanhamento (D-06). |
| 4 | Diferença de tempo de resposta mostra em qual posição da lista a sessão foi aberta. | Vazamento leve sobre a ordem da lista. | Aceito; a lista não é segredo e a tentativa de qualquer senha já é pública no tempo de resposta. |
| 5 | Interação com `legacySealFallback` (R3). | Tentativas redundantes ou selo aceito fora da regra. | D-03 e o caso de legado com extra nos testes. |
| 6 | Quebra silenciosa da regra de tamanho (R4). | Extra curta aceita. | D-04 e o caso de senha extra curta. |
| 7 | `session.ts` já tem 465 linhas, acima da meta de 200 do AGENTS.md. | Mudança de revisão maior. | Não dividir o arquivo nesta entrega; a mudança adiciona cerca de 40 linhas. Divisão em arquivo próprio fica como acompanhamento. |
| 8 | Mudança de mensagem para senha vazia em `unsealSession` direto. | Nenhuma se a validação só cobrir as extras (D-04). | D-04, opção 3. |

## Pendências para confirmação

- P3 (D-06): confirmar que a regravação imediata fica fora desta entrega.
- Se o time quiser o limite de tamanho da lista como barreira (risco 1), isso é outra decisão, fora do PRD.
