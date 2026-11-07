# Especificação técnica — várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-07), issue h3js/h3#1050.

## Resumo

Acrescentar `SessionConfig.extraUnsealPasswords?: string[]`. Ao abrir um cookie ou header de sessão, a biblioteca tenta `password` e depois cada item da lista, na ordem. Ao selar, usa sempre `password`. A mudança fica concentrada em `src/utils/session.ts`, com testes em `test/session.test.ts`, um teste de tipo e a documentação de sessão.

## Estado atual (conferido no código)

- `password` entra em dois pontos: selagem em `sealSession` (`src/utils/session.ts:300`) e abertura em `unsealSession` (`src/utils/session.ts:324`, e de novo em `:340` no fallback legado).
- `getSession` engole qualquer erro da abertura com `.catch(() => {})` (`src/utils/session.ts:197`). Um erro de configuração vira sessão vazia, sem aviso.
- O tamanho mínimo da senha é checado dentro do iron, em `generateKey` (`src/utils/internal/iron-crypto.ts:192-193`). Os mínimos padrão são 32 para criptografia (`src/utils/internal/iron-crypto.ts:22`) e 32 para integridade (`src/utils/internal/iron-crypto.ts:28`). Essa checagem roda dentro de `unseal`, antes da comparação do HMAC (`src/utils/internal/iron-crypto.ts:133`).
- Falha de integridade é `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:136`). Expiração do seal, `"Expired seal"` (`src/utils/internal/iron-crypto.ts:116`), é checada antes e não depende da senha.
- Fallback legado de 1 iteração: `src/utils/session.ts:332-346`, com a marca `kLegacySeal` (`src/utils/session.ts:346`; símbolo em `src/utils/internal/session.ts:7`).
- Reselagem em `getSession`: `src/utils/session.ts:214-216`, condicionada a `legacySeal || shouldSlide(...)` e a `sessionFromCookie`. Sessão lida pelo header nunca é resselada.
- Expiração: `maxAge` em `src/utils/session.ts:350-355` e `idleTimeout` em `src/utils/session.ts:359-365`, ambas depois do unseal.
- Exportações públicas de sessão: `src/index.ts:201-212`. `unsealSession` é exportada (`src/index.ts:209`).

## Decisões de arquitetura

### D-01 — As tentativas de abertura ficam dentro de `unsealSession`

Alternativas consideradas:
- (a) Usar `PasswordHash` do iron, com ids por senha (`src/utils/internal/iron-crypto.ts:427`). Rejeitada: exige um id gravado no cookie, o que muda o formato selado e entra em "identificadores de senha", fora de escopo no PRD.
- (b) Repetir o loop em `getSession` e `useSession`. Rejeitada: duplica lógica e deixa a função exportada `unsealSession` (`src/index.ts:209`) sem o recurso.
- (c) Criar uma função pública nova. Rejeitada: o contrato proíbe novos nomes públicos.

Escolha: o loop fica em `unsealSession` (`src/utils/session.ts:312`). A assinatura não muda, e `getSession` herda o comportamento sem alteração.

### D-02 — Ordem por senha, com o fallback legado dentro de cada tentativa

Para cada senha, primeiro tenta-se a abertura com as iterações atuais. Se o erro for `"Bad hmac value"` e o fallback estiver ativo, tenta-se com 1 iteração. Só depois passa-se à senha seguinte.

Alternativa: duas passadas, primeiro todas as senhas com as iterações atuais e depois todas com 1 iteração. Rejeitada: o caminho legado continua sendo tratado de forma local, e o custo extra de uma tentativa com 1 iteração é desprezível. A ordem preserva `password` como primeira tentativa, como pede o PRD (risco de CPU).

### D-03 — Só erro de HMAC avança para a próxima senha

Alternativa: avançar para a próxima senha em qualquer erro. Rejeitada: `"Expired seal"`, `"Incorrect number of sealed components"` e `"Wrong mac prefix"` não dependem da senha. Tentar de novo esconderia o erro real e multiplicaria o custo de PBKDF2.

A expiração de sessão (`maxAge` e `idleTimeout`, `src/utils/session.ts:350-365`) continua sendo checada depois do primeiro unseal bem-sucedido. Assim, uma sessão expirada nunca é retentada com outra senha.

### D-04 — Quando nenhuma senha abre, lança o erro da primeira tentativa

Sem extras, o erro lançado é o mesmo de hoje (`"Bad hmac value"`), o que preserva RF-05.

O sucesso é marcado com um sinalizador, não com `!unsealed`. `unseal` pode devolver `null` (`src/utils/internal/iron-crypto.ts:149`), e tratar `null` como falha mudaria o comportamento atual.

### D-05 — Validação das extras antes de qualquer abertura

Cada item deve ser uma `string` com comprimento de pelo menos o maior `minPasswordlength` das opções efetivas, `{ ...sealDefaults, ...config.seal }`. Assim vale a mesma regra que o iron aplica a `password`, nas duas etapas (criptografia e integridade).

A validação roda em dois lugares:
- no início de `getSession` (`src/utils/session.ts:149`), antes de `context.sessions` ser preenchido (`src/utils/session.ts:158-173`). Assim, um erro não deixa uma sessão pela metade no contexto. `useSession` chama `getSession` primeiro, então a validação cobre os dois;
- no início de `unsealSession`, para chamadas diretas da função exportada.

Alternativa: deixar o erro do iron subir até o usuário. Rejeitada: `getSession` engole o erro (`src/utils/session.ts:197`), e a senha curta apareceria como sessão inexistente, exatamente o risco de "falha silenciosa" do PRD.

`password` não recebe validação antecipada. Continua sendo validada como hoje, pelo iron. Essa assimetria fica registrada e não muda o comportamento existente.

### D-06 — Migração só pelo fluxo que já existe

Uma sessão aberta com uma senha extra não é resselada na hora. Ela migra quando passa por um dos fluxos já existentes: fallback legado (`src/utils/session.ts:214`), deslizamento de `idleTimeout` (`shouldSlide`, `src/utils/session.ts:414`), ou gravação com `updateSession`.

Alternativa: resselar sempre que a sessão for aberta com uma extra. Rejeitada: adiciona uma selagem a cada leitura até a migração. O próprio código considera a selagem a operação mais cara (`src/utils/session.ts:398-399`). O PRD também limita a migração ao fluxo existente (RF-03).

Consequência, a documentar: sem `idleTimeout`, uma sessão que é lida e nunca gravada continua com a senha antiga até `maxAge`.

### D-07 — Documentação

- JSDoc do campo novo em `SessionConfig` (`src/utils/session.ts:39`), no mesmo estilo dos campos vizinhos.
- Seção em `docs/4.examples/handle-session.md`, perto da nota sobre sessões por header (`docs/4.examples/handle-session.md:180`). Deve cobrir: rotação de senha, limite prático de extras (custo de CPU) e sessões por header que não migram.
- `CHANGELOG.md` não é editado nesta mudança.

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | (1) campo novo em `SessionConfig`, depois de `password` (`src/utils/session.ts:48`); (2) validação no início de `getSession` (`src/utils/session.ts:149`); (3) `unsealSession` com o loop (`src/utils/session.ts:312-367`); (4) dois helpers internos no fim do arquivo. |
| `test/session.test.ts` | novo `describe("extraUnsealPasswords")` dentro de `describeMatrix` (`test/session.test.ts:15`), ao lado de `describe("lazy creation")` (`test/session.test.ts:692`). |
| `test/unit/types.test-d.ts` | teste de tipo para `extraUnsealPasswords` (RF-07). Antes de editar, ver o estilo do arquivo. |
| `docs/4.examples/handle-session.md` | seção de rotação de senha (D-07). |

Nenhum outro módulo muda. `src/utils/cookie.ts` está fora de escopo.

## Contratos e assinaturas

Campo novo em `SessionConfig` (`src/utils/session.ts:39`):

```ts
export interface SessionConfig {
  /** ... (inalterado) */
  password: string;
  /**
   * Previous passwords, tried in order after `password` when a session cannot be
   * opened with it. They only open sessions: new and resealed sessions always use
   * `password`. Each item follows the same length rules as `password`.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}
```

Assinatura pública sem mudança (`src/utils/session.ts:312`):

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Helpers internos novos, no fim de `src/utils/session.ts` (convenção do AGENTS.md):

```ts
/** Lança erro se algum item de `extraUnsealPasswords` for inválido (RF-06). */
function assertExtraUnsealPasswords(config: SessionConfig, sealOptions: SealOptions): void;

/**
 * Abre `sealed` com uma senha, com o fallback legado (1 iteração) quando permitido.
 * Lança o erro original se a senha não abrir.
 */
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Mensagem de erro para extra inválida:

```
Invalid extraUnsealPasswords[<índice>]: must be a string of at least <mínimo> characters
```

Esboço do loop em `unsealSession`:

```ts
assertExtraUnsealPasswords(config, sealOptions);
const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
let unsealed: Partial<Session> | undefined;
let opened = false;
let firstError: unknown;
for (const password of passwords) {
  try {
    unsealed = await unsealWithPassword(sealed, password, config, sealOptions);
    opened = true;
    break;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
    firstError ??= error;
  }
}
if (!opened) throw firstError;
// ... maxAge e idleTimeout inalterados, depois `return unsealed`
```

`unsealWithPassword` repete o bloco atual de `src/utils/session.ts:324-347`, trocando `config.password` pelo parâmetro `password`.

## Estratégia de testes

Seguir o fluxo do AGENTS.md: escrever primeiro os testes novos, confirmar que falham, depois implementar.

Casos em `test/session.test.ts`, com `describeMatrix` (cookie `h3-rot`, header `x-h3-rot-session`):

| Caso | RF | Verificação |
| --- | --- | --- |
| Cookie selado com `A`, lido com `password: B` e `extraUnsealPasswords: [A]` | RF-01 | `id` e `data` carregados |
| Mesmo cenário pelo header `x-h3-rot-session` | RF-01 | dados carregados e nenhum `Set-Cookie` (header não é resselado) |
| `updateSession` com `B` gera cookie que não abre só com `A` | RF-02 | com config só de `A`, a sessão é nova (id diferente) |
| Sessão com `A`, `idleTimeout` configurado, metade da janela passada | RF-03 | cookie da resposta abre com `B` e não com `A`; usar `vi.useFakeTimers({ toFake: ["Date"] })` como em `test/session.test.ts:188-190` |
| Sessão legada (1 iteração) com `A` | RF-04 | dados carregados; cookie resselado abre com `B` (`unseal` com `sealDefaults`, como em `test/session.test.ts:157`) |
| Sem `extraUnsealPasswords`, cookie de `A` lido com config de `B` | RF-05 | sessão tratada como inválida (`data` vazio) |
| Extra vazia `""` ou curta (ex.: `"curta"`) | RF-06 | `getSession` chamado dentro de handler com `try/catch` devolvendo a mensagem; não deixar o erro escapar, porque `test/_setup.ts:153` falha o teste com erro não tratado |
| Senha `password` correta não tenta as extras | custo | espionar `crypto.subtle.deriveBits` como em `test/session.test.ts:722-735`: exatamente 2 chamadas com cookie de `B` e `extraUnsealPasswords: [A, C]` |
| Teste de tipo | RF-07 | `test/unit/types.test-d.ts`: aceita `string[]` e recusa `"x"` com `@ts-expect-error` |

Regressão: o teste em `test/session.test.ts:722-735` precisa continuar com 2 chamadas, porque sem extras o loop tem uma tentativa só. A suíte inteira continua sendo a referência (`pnpm test`, `package.json:53`).

Comandos:
- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit`
- `pnpm lint` (`package.json:46`)
- `pnpm typecheck` (`package.json:54`)

Atenção: o AGENTS.md diz que `pnpm lint` inclui o typecheck, mas o script `lint` não inclui (`package.json:46`). O typecheck precisa ser rodado separado.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Custo de CPU: cada tentativa roda PBKDF2 (8192 iterações, duas derivações). Um cookie inválido com N extras custa até (N+1) tentativas, e o fallback legado dobra o número. | `password` é sempre a primeira tentativa. Documentar um limite prático de extras (D-07). Não impor limite no código, por escopo do PRD. |
| Falha silenciosa: extra mal digitada faz usuários parecerem deslogados. | D-05 e o teste de RF-06. |
| Sessões por header não migram; a senha antiga vale até a expiração. | Documentar (D-07) e cobrir com teste. |
| Sessão lida e nunca gravada, sem `idleTimeout`, mantém a senha antiga até `maxAge`. | Documentar (D-06). |
| Erro de digitação na `password` nova: sessões novas não abrem com a antiga. | Nada no código. Responsabilidade de quem configura (PRD). |
| `unseal` pode devolver `null`. | Sinalizador de sucesso em vez de `!unsealed` (D-04). |
| `src/utils/session.ts` já passa da convenção de 200 linhas (465 hoje, AGENTS.md). A mudança acrescenta algo como 40 linhas. | Débito pré-existente. Não dividir nesta mudança, para respeitar o escopo do PRD. Registrar como tarefa separada. |
| `pnpm fmt` reescreve outros arquivos (automd, oxlint --fix). | Rodar só o `oxfmt` nos arquivos alterados, ou aplicar a formatação só neles. |
| Chamadas existentes de `unsealSession` mudam de comportamento. | Sem `extraUnsealPasswords`, o loop tem uma tentativa e o resultado é idêntico. Mudança aditiva. |
