# Especificação técnica: várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1050.

Os `arquivo:linha` citados foram conferidos na revisão anterior (branch `master`, commit `d5baeed`). Esta revisão não os reconferiu. Antes de implementar, conferir de novo, porque a implementação vai mudar essas linhas.

## Visão geral

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. Na leitura, a sessão é aberta com `password` e, se falhar, com cada senha extra, na ordem informada, parando na primeira que verifica o HMAC. Se a senha que abriu foi uma extra, `getSession` reseila o cookie com `password` na mesma requisição. Selagem (`sealSession`, `updateSession`) não muda.

Nenhum nome público novo além de `extraUnsealPasswords`. Não há símbolo novo: a informação "aberta com extra" é devolvida por uma função interna, sem tocar no retorno de `unsealSession` (ver D-05).

## Arquivos a alterar

| Arquivo                                   | Mudança                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/session.ts`                    | Campo novo e JSDoc em `SessionConfig`; helpers internos de senha e abertura; `getSession` passa a usar a função interna; `unsealSession` vira um invólucro fino. |
| `test/session.test.ts`                    | Novo bloco `describeMatrix` para os cenários de integração (web e node).                                                                                         |
| `test/unit/session-unseal.test.ts` (novo) | Testes que precisam espiar `unseal`/`seal` (ordem de tentativa, parada na primeira, falha de reselagem).                                                         |
| `test/unit/types.test-d.ts`               | Bloco `describe("SessionConfig")` com a checagem de tipo de RF-01.                                                                                               |
| `docs/4.examples/handle-session.md`       | Parágrafo sobre rotação, após a nota de entropia em `:37`, e ajuste de `:43`.                                                                                    |

Arquivos que **não** mudam: `src/index.ts` (já exporta `unsealSession` em `src/index.ts:209`, assinatura e retorno preservados), `src/utils/internal/session.ts`, `src/utils/internal/iron-crypto.ts`, `src/types/context.ts`.

### Pontos de alteração em `src/utils/session.ts`

- `src/utils/session.ts:39-48`: `SessionConfig`. O campo novo entra logo após `password` (`:48`). A JSDoc de `password` (`:40-47`) ganha uma referência ao novo campo.
- `src/utils/session.ts:196-197`: `getSession` troca a chamada a `unsealSession` por `unsealCandidates(config, sealed).catch(() => undefined)`, guardando também `openedWithExtra`. Continua valendo: qualquer falha de abertura vira sessão nova.
- `src/utils/session.ts:199-201`: remoção do marcador `kLegacySeal` continua aqui, sem mudança de lugar. Passa a agir sobre `session` (o objeto que veio de `unsealCandidates`).
- `src/utils/session.ts:214-216`: condição de reselagem. Passa a tratar o caso `openedWithExtra` (ver D-04).
- `src/utils/session.ts:312-367`: `unsealSession` vira um invólucro de `unsealCandidates`. A lógica de `maxAge` (`:350-355`) e `idleTimeout` (`:359-365`) sai do lugar e fica dentro de `unsealCandidates`, sem alteração de conteúdo.
- `src/utils/session.ts:322-348`: o bloco atual de `unseal` + fallback legado vira um helper por senha (`unsealWithPassword`), com o corpo quase igual.
- `src/utils/session.ts:300`: `seal(session, config.password, ...)` em `sealSession`. Não muda (RF-03).
- `src/utils/session.ts:267`: `updateSession` chama `sealSession`. Não muda (RF-03).

## Decisões de arquitetura

### D-01 — Loop de senhas em uma função interna, sem mudar a assinatura pública

**Alternativas consideradas**

1. Mudar `unsealSession` para receber uma lista de senhas, ou para retornar `{ session, passwordIndex }`.
2. Fazer o loop em `getSession`, chamando `unsealSession` uma vez por senha.
3. Manter `unsealSession(event, config, sealed)` como está e fazer o loop numa função interna (`unsealCandidates`) que ela envolve.

**Escolha: 3.**

`unsealSession` é exportada (`src/index.ts:209`), então mudar a assinatura ou o retorno quebra quem a usa diretamente. A opção 2 duplicaria as checagens de expiração e a lógica de `kLegacySeal`, e exigiria que `unsealSession` rejeitasse senhas erradas sem contexto. Com a opção 3, a informação extra que `getSession` precisa (qual senha abriu) sai pela função interna, não pela API pública (D-05).

### D-02 — Ordem de tentativa e normalização das senhas

**Alternativas consideradas**

1. Tentar todas as senhas e escolher a última que abre.
2. Validar `extraUnsealPasswords` ao criar a configuração e lançar erro para senha vazia, curta ou duplicada.
3. Filtrar silenciosamente vazias, remover duplicadas e remover a repetição de `password`, depois tentar na ordem.

**Escolha: 3.**

Alinha com `sdd/prd.md` (Decisões e RF-02, RF-04, RF-08): vazias e duplicatas não geram erro. A opção 2 contraria essa decisão e o item "fora de escopo" do PRD sobre validação de senha em tempo de execução. Vazias são descartadas com `filter(Boolean)`. Duplicadas e a repetição de `password` são eliminadas com `Set`, o que evita PBKDF2 desnecessário.

```ts
// src/utils/session.ts (helper no fim do arquivo, como manda AGENTS.md)
function unsealPasswords(config: SessionConfig): string[] {
  const extras = (config.extraUnsealPasswords ?? []).filter(Boolean);
  return [...new Set([config.password, ...extras])];
}
```

A primeira senha da lista é sempre `config.password`, porque `Set` preserva a ordem de inserção. A lista tem pelo menos um item, então o loop de `unsealCandidates` sempre tenta `password`.

### D-03 — Erro por candidato e erro final

**Alternativas consideradas**

1. Parar no primeiro erro, como hoje.
2. Capturar o erro de cada candidato, seguir para o próximo e, se nenhum abrir, relançar o erro do primeiro candidato.
3. Relançar o erro do último candidato.

**Escolha: 2.**

Um candidato pode falhar por motivo próprio, por exemplo `Password string too short` (`src/utils/internal/iron-crypto.ts:192-195`), e isso não deve impedir a tentativa das outras. Relançar o erro do primeiro candidato preserva a mensagem atual quando só existe uma senha, porque aí o primeiro é o único. Falhas que não dependem da senha (`Incorrect number of sealed components`) acontecem antes do HMAC e são baratas, então tentar as extras não tem custo relevante. `Expired seal` é a exceção: vem do `ttl` do selo, então se repete em cada candidato (ver Riscos, item 1).

```ts
// src/utils/session.ts
async function unsealCandidates(
  config: SessionConfig,
  sealed: string,
): Promise<{ session: Partial<Session>; openedWithExtra: boolean }> {
  const sealOptions = {
    ...sealDefaults,
    ttl: (config.maxAge || config.idleTimeout || 0) * 1000,
    ...config.seal,
  };
  let session: Partial<Session> | undefined;
  let openedWithExtra = false;
  let firstError: unknown;
  for (const [index, password] of unsealPasswords(config).entries()) {
    try {
      session = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback);
      openedWithExtra = index > 0;
      break;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (!session) {
    throw firstError;
  }
  // maxAge (:350-355) e idleTimeout (:359-365) inalterados, a partir daqui
  // ...
  return { session, openedWithExtra };
}

export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const { session } = await unsealCandidates(config, sealed);
  return session;
}
```

As checagens de expiração ficam fora do `try`. Se ficassem dentro, um cookie expirado seria tratado como "senha errada" e dispararia as tentativas com as extras sem motivo.

`unsealWithPassword` recebe o corpo atual de `:322-348` com `password` no lugar de `config.password`. Mantém a lógica de `legacySealFallback`, o marcador `kLegacySeal` e o retry com 1 iteração (RF-05).

### D-04 — Reselagem de sessões abertas com senha extra

**Alternativas consideradas**

1. Reselar só quando `shouldSlide` for verdadeiro, como hoje.
2. Reselar em toda leitura com senha extra, sem depender de `shouldSlide` nem de `sessionFromCookie`.
3. Reselar em toda leitura com senha extra, mas só para sessões vindas de cookie, e fazer a falha de reselagem não propagar.

**Escolha: 3.** Esta escolha restringe RF-07 (que fala em "uma sessão aberta com uma senha extra", sem distinguir a origem). A restrição é inevitável: sessões vindas do cabeçalho `x-h3-session` não podem ser reseladas porque o cliente não recebe o cookie (`src/utils/session.ts:191-193` e o comentário em `:63-65`). O PRD precisa registrar essa exceção (ver Perguntas em aberto e Riscos, item 3).

A falha de reselagem não pode propagar para o handler (PRD, "Riscos", item de reselagem sob falha). Por isso a reselagem de rotação tem `.catch` próprio, e o caminho de legado sem extra continua igual, sem `.catch`, conforme RF-04.

```ts
// src/utils/session.ts, em getSession (substitui :214-216)
if (session.id && sessionFromCookie) {
  if (openedWithExtra) {
    // RF-07. A falha aqui não pode rejeitar a leitura (PRD, Riscos).
    await updateSession(event, config).catch(() => {});
  } else if (legacySeal || shouldSlide(session, config)) {
    await updateSession(event, config);
  }
}
```

Se a sessão é legada e foi aberta com extra, `openedWithExtra` tem precedência e há uma única reselagem, com `password`, cobrindo RF-05.

**Pré-requisito antes de implementar:** confirmar se `updateSession` sela o objeto `session` já carregado ou se relê o cookie chamando `getSession`. Se ele chamar `getSession`, esse bloco entra em reentrada e a reselagem acontece duas vezes. A especificação assume que sela o objeto em memória.

### D-05 — Como `getSession` sabe que uma senha extra abriu o cookie

**Alternativas consideradas**

1. Campo público em `Session` (por exemplo, `session.rotated`). Cria um nome público novo, proibido pelo contrato.
2. Comparar, em `getSession`, o cookie com uma selagem nova para descobrir a senha. Exige selar de novo.
3. Símbolo interno (`kUnsealedWithExtra`) anexado ao objeto que `unsealSession` devolve. Funciona, mas o retorno público passa a carregar um símbolo (que `{ ...result }` copia), e o `as any` para anexá-lo quebra a regra de tipo do projeto.
4. Função interna `unsealCandidates` que devolve `{ session, openedWithExtra }`. `unsealSession` a envolve e devolve só `session`.

**Escolha: 4.** O retorno público de `unsealSession` fica idêntico ao de hoje, não há símbolo novo, não há `as any`, e `src/utils/internal/session.ts` não muda. O risco de vazamento de símbolo para o objeto de sessão deixa de existir por construção.

### D-06 — Tipo do campo e JSDoc

**Alternativas consideradas**

1. `password: string | string[]` (segunda alternativa da issue).
2. Campo novo `extraUnsealPasswords?: string[]`.

**Escolha: 2.** O PRD marca a alternativa 1 como fora de escopo, e `password` continua `string` (RF-01).

```ts
// src/utils/session.ts, em SessionConfig
/**
 * Private key used to seal session tokens. Must be at least 32 characters.
 * ...
 * Rotate it by moving the old key to {@link SessionConfig.extraUnsealPasswords}.
 */
password: string;
/**
 * Previous keys that only open sessions sealed with them. Never used to seal.
 *
 * Each sealed cookie is tried against `password` first, then against these in
 * order, and the first one that verifies is used. A cookie opened with one of
 * these keys is resealed with `password` in the same request, so remove a key
 * from this list once every session sealed with it has been resealed or has
 * expired: the maximum session lifetime plus the time until each user's next
 * request. Sessions read from the `x-h3-session` header are not resealed, since
 * the client never receives a cookie; they keep working with the old key until
 * they expire.
 *
 * Keys shorter than 32 characters fail to unseal and are skipped. Each key adds
 * a sealing attempt to every request whose cookie is not sealed with `password`,
 * so keep the list to two or fewer.
 */
extraUnsealPasswords?: string[];
```

O texto acima é a versão de referência. A redação final deve seguir o RF-10 do PRD e ficar em português, como o restante do JSDoc de `session.ts`. A menção ao cabeçalho depende da decisão pendente do risco 3: se a decisão for exigir `maxAge`/`idleTimeout`, o parágrafo muda.

### D-07 — Documentação para o usuário

**Alternativas consideradas**

1. Documentar só na JSDoc.
2. Documentar também em `docs/4.examples/handle-session.md`.

**Escolha: 2.** O guia já repete a regra de entropia em `docs/4.examples/handle-session.md:37` e a de comprimento em `:43`. Um desenvolvedor que rotaciona a senha vai ler o guia, não o código-fonte. O parágrafo novo fica depois de `:37` e descreve o passo a passo da rotação (adicionar a senha antiga em `extraUnsealPasswords`, trocar `password`, remover a antiga após o prazo), o limite de duas senhas extras e a exceção das sessões do cabeçalho. Essa é uma resposta à pergunta em aberto do PRD sobre documentação.

## Contratos e assinaturas

```ts
// src/utils/session.ts — campo novo
export interface SessionConfig {
  password: string; // inalterado: única senha de selagem
  extraUnsealPasswords?: string[]; // novo: só abre; ordem de tentativa = ordem do array
  // ...demais campos inalterados
}

// src/utils/session.ts — assinaturas públicas inalteradas
export async function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export async function updateSession<T>(
  event: HTTPEvent,
  config: SessionConfig,
  update?: SessionUpdate<T>,
): Promise<Session<T>>;
export async function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

// src/utils/session.ts — internos novos (não exportados)
async function unsealCandidates(
  config: SessionConfig,
  sealed: string,
): Promise<{ session: Partial<Session>; openedWithExtra: boolean }>;
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>>;
function unsealPasswords(config: SessionConfig): string[];
```

Garantias de contrato:

- Sem `extraUnsealPasswords` (ou vazio), o caminho de execução é o mesmo de hoje: uma tentativa com `password`, mesmo fallback legado, mesmos erros (RF-04).
- `unsealSession` lança o mesmo erro de hoje quando nenhuma senha abre. Com uma só senha, é exatamente o erro de hoje.
- `unsealSession` devolve o mesmo tipo de objeto de hoje, sem propriedades novas, inclusive quando aberto com extra.
- `sealSession` e `updateSession` nunca usam uma senha extra (RF-03).
- O cookie emitido não muda de formato, nome nem atributos (`:266-272`).

## Estratégia de testes

Esta entrega segue o padrão de teste-primeiro de `AGENTS.md`, que é escrito para correção de bug. Aqui o recurso é novo, então a escolha é deliberada: os testes de RF-02 e RF-07 são escritos antes do código e precisam falhar antes da mudança.

### Testes de integração (`test/session.test.ts`, `describeMatrix`, web e node)

Um novo `describe("extraUnsealPasswords", ...)` no fim do arquivo, usando `sessionConfig` (`:21-25`) como base e `seal` com `sealDefaults` (como em `:134-143`). Senhas de teste com 32 ou mais caracteres.

| Cenário                                                                                | RF           | Como verificar                                                                                    |
| -------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| Cookie selado com a senha antiga abre com `password` + extra; mesmo `id` e dados       | RF-02        | `t.fetch` com o cookie antigo; corpo com `id` e `data` originais.                                 |
| Escrita com `updateSession` após abrir com extra gera cookie que não abre com a antiga | RF-03        | Desselar o `Set-Cookie` com `unseal` usando só `password`, e com a antiga, esperando erro.        |
| Handler lê com extra e depois grava com `updateSession`                                | RF-03, RF-07 | Confirmar qual `Set-Cookie` o cliente recebe (ver Riscos, item 7); ele deve abrir com `password`. |
| Legado (iterations: 1) aberto com extra é resselado com `password`                     | RF-05        | Mesmo padrão de `:134-159`, com `extraUnsealPasswords`.                                           |
| `maxAge` vencido com extra: não carrega                                                | RF-06        | `vi.useFakeTimers({ toFake: ["Date"] })` como em `:188-190`.                                      |
| `idleTimeout` vencido com extra (dentro de `maxAge`): não carrega                      | RF-06        | Idem.                                                                                             |
| Leitura sem escrita com extra gera `Set-Cookie` com `password`                         | RF-07        | `getSetCookie()` com comprimento 1, desselado só com `password`.                                  |
| Leitura sem extra e sem escrita não gera `Set-Cookie`                                  | RF-04        | Garante que a reselagem só acontece no caminho de rotação.                                        |
| Nenhuma senha abre: sessão nova, sem erro                                              | RF-08        | Corpo com `id` diferente e `data` vazio, status 200.                                              |
| Sem `extraUnsealPasswords`: comportamento de hoje                                      | RF-04        | A suíte existente (`:134-186`) continua passando sem alteração.                                   |
| Sessão vinda do cabeçalho com extra: sem `Set-Cookie`                                  | D-04         | Documenta a exceção de não reselar header.                                                        |

### Testes unitários com espionagem (`test/unit/session-unseal.test.ts`, novo)

Precisam de `vi.mock("../../src/utils/internal/iron-crypto.ts", ...)` com `unseal` e `seal` envolvidos por `vi.fn` (`orig` via `importOriginal`). Ficam num arquivo próprio para não afetar a matriz de integração. Os testes usam só as funções públicas (`getSession`, `unsealSession`), porque `unsealCandidates` não é exportada.

| Cenário                                                                           | RF               | Como verificar                                                                         |
| --------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| Ordem de tentativa: `password`, depois extras na ordem                            | RF-02            | `unseal.mock.calls` com as senhas na ordem.                                            |
| Parada na primeira que abre                                                       | RF-02            | Com `extraUnsealPasswords: ["a", "b"]` e cookie da primeira extra, `b` não é chamada.  |
| Extra igual a `password`, vazia e duplicada                                       | RF-09            | `unseal` chamado uma vez por senha distinta não vazia.                                 |
| Erro de candidato (senha curta) não impede a tentativa seguinte                   | D-03             | Extra curta antes da correta; sessão carregada.                                        |
| Nenhuma abre: erro do primeiro candidato em `unsealSession`                       | D-03             | Com uma senha, mensagem igual à de hoje.                                               |
| `unsealSession` devolve objeto sem propriedades novas, inclusive aberto com extra | D-05             | `Object.getOwnPropertySymbols` e `Object.keys` iguais aos da abertura com senha atual. |
| Falha de `seal` na reselagem de rotação não rejeita a leitura                     | D-04, PRD Riscos | `seal.mockRejectedValueOnce(...)`; `getSession` resolve com a sessão.                  |
| Legado + extra: uma reselagem só                                                  | D-04             | `seal.mock.calls.length === 1`.                                                        |
| Modern + extra: uma reselagem só                                                  | D-04             | `seal.mock.calls.length === 1`.                                                        |

### Tipos (`test/unit/types.test-d.ts`)

Novo bloco após `:543`, com o mesmo estilo do bloco `basicAuth context` (`:519-543`):

```ts
describe("SessionConfig", () => {
  it("accepts extraUnsealPasswords as string[] and keeps password a string", () => {
    expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string>();
    expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>();
  });
});
```

Requer `import type { SessionConfig } from "../../src/utils/session.ts"` no topo do arquivo.

### Ordem de execução

1. Rodar `pnpm bench:node` **antes de qualquer alteração**, para ter a linha de base de leitura com cookie inválido.
2. Escrever os testes de RF-02 e RF-07 (integração e unitário); confirmar que falham.
3. Implementar `unsealPasswords`, `unsealWithPassword` e `unsealCandidates`; `unsealSession` vira invólucro. Rodar a suíte existente: tem que passar sem alteração.
4. Alterar `getSession` (D-04) e confirmar o pré-requisito sobre `updateSession`.
5. Escrever os demais testes da tabela e o de tipo.
6. JSDoc e documentação.
7. Verificação final.

### Verificação final

- `pnpm vitest run test/session.test.ts test/unit/session-unseal.test.ts`
- `pnpm lint` (oxlint e oxfmt, com checagem de tipo)
- `pnpm test` (suíte completa com cobertura)
- `pnpm bench:node` depois da mudança, comparado com a linha de base do passo 1. `test/bench/session.ts` já existe.

## Riscos

1. **Custo de CPU.** Hoje, cada cookie que não abre custa uma abertura (duas derivações PBKDF2, `src/utils/internal/iron-crypto.ts:206`, mais o retry legado quando habilitado). Com N extras, cada cookie que não abre com `password` custa até `1 + N` aberturas. Há dois casos extras:
   - **Cookie expirado.** O `ttl` do selo faz cada candidato falhar com `Expired seal`, então uma sessão vencida também custa `1 + N` aberturas, mesmo que a senha esteja certa.
   - **Amplificação sem autenticação.** Um cliente não autenticado pode enviar cookies inválidos de propósito, e cada um custa `1 + N` vezes o custo de hoje. O PRD não impõe limite em código (de propósito), e limitação de taxa está fora do escopo desta entrega.

   Mitigação: limite de duas senhas na documentação (D-06 e D-07) e medição com o benchmark (passos 1 e 7). O benchmark deve confirmar a ordem de grandeza, `1 + N` vezes o custo atual, e não um valor fixo. Um limite numérico de aceitação precisa ser definido antes da implementação; esta especificação não define um.

2. **Falha silenciosa.** Senha extra com menos de 32 caracteres não dá erro: `unseal` lança `Password string too short` (`src/utils/internal/iron-crypto.ts:192-195`), `getSession` captura com `.catch(() => {})` (`src/utils/session.ts:197`) e o usuário vira sessão nova. Um erro de digitação na configuração desloga todos os usuários daquela senha, sem sinal algum. Mitigação: a documentação diz o limite de 32 caracteres (D-06). Validação em tempo de execução está fora de escopo no PRD.

3. **Sessões do cabeçalho não são rotacionadas.** Como não há reselagem para sessões lidas do cabeçalho (D-04), elas continuam dependendo da senha antiga até expirar. Sem `maxAge` nem `idleTimeout`, esse prazo é indefinido, e o prazo previsível do PRD (premissas, primeiro item) não vale para elas. Isso também torna o critério de sucesso "remover a senha antiga depois da transição" falso para esses clientes.
   **Decisão (T-01):** aceitar e documentar (JSDoc e guia), sem validação nova, e corrigir o PRD para dizer que RF-07 e o prazo de remoção valem para sessões de cookie. A alternativa, exigir `maxAge`/`idleTimeout` quando `extraUnsealPasswords` estiver configurado, é uma validação em tempo de execução que o PRD exclui.

4. **A premissa de 32 caracteres no PRD estava imprecisa.** O PRD dizia que "o código não impõe essa regra hoje". O código impõe o comprimento mínimo de 32 caracteres para senhas em string (`src/utils/internal/iron-crypto.ts:22` e `:28`, aplicado em `:191-196`), não entropia. O PRD foi corrigido (T-01).

5. **Reselagem falha em silêncio.** Pelo `.catch` de D-04, uma falha de `seal` deixa o cookie antigo no cliente. A próxima requisição depende da senha antiga de novo. Isso é o comportamento pedido no PRD, mas nenhum log é emitido porque h3 não tem logger. Mitigação: teste unitário do caso de falha.

6. **Senha antiga vazada.** Enquanto a senha estiver na configuração, cookies com ela continuam válidos até serem resselados ou expirarem. Já descrito no PRD; sem mitigação técnica adicional nesta entrega.

7. **Dois `Set-Cookie` na mesma resposta.** Se o handler chamar `updateSession` depois da leitura com extra, a resposta pode levar dois cookies com o mesmo nome: o da reselagem de D-04 e o da escrita do handler. Ambos são selados com `password`, então o efeito de segurança é correto, mas o cliente só deve ficar com um. **Pré-requisito:** confirmar como `setCookie` trata um cookie de mesmo nome já emitido na resposta (substituir ou acrescentar). Se acrescentar, a última escrita precisa vencer e o teste da tabela de integração cobre isso.

8. **Multiplicação com `legacySealFallback`.** Com legado e extras, cada candidato pode fazer duas tentativas, então o custo cresce como `2 × (1 + N)`. O teste de RF-05 precisa cobrir o caso (ver estratégia).

9. **Tamanho do arquivo.** `src/utils/session.ts` já passa de 200 linhas (AGENTS.md pede menos de 200 por arquivo) e esta entrega adiciona cerca de 40. **Decisão:** manter em `session.ts`. Mover os helpers para `src/utils/internal/session.ts` exigiria mover também o fallback legado e `kLegacySeal`, o que amplia a mudança além do escopo desta entrega. Registrar como dívida.

## Perguntas em aberto

Respondidas na implementação (T-01), com a verificação no código de `d5baeed`:

- **Sessões do cabeçalho (risco 3):** decidido: aceitar e documentar, sem validação nova. O PRD foi corrigido (RF-07 e Decisões).
- **`updateSession` (D-04):** sela o objeto em memória. `updateSession` lê `context.sessions[sessionName]` (`src/utils/session.ts:249-251`) e `sealSession` faz o mesmo (`:289-291`). Só chama `getSession` se a sessão ainda não estiver no contexto, o que não acontece na reselagem. Sem reentrada.
- **`setCookie` com mesmo nome (risco 7):** substitui. `setCookie` remove o cookie de mesmo nome e de mesma chave distinta antes de acrescentar (`src/utils/cookie.ts:99-123`). Assim, a última escrita vence e só fica um `Set-Cookie` por nome.
- **`useSession`:** chama `getSession` (`src/utils/session.ts:115`) e não tem leitura própria de cookie. Não precisa de mudança.
- **Premissa do PRD (risco 4):** corrigida. O código impõe comprimento mínimo de 32 caracteres (`src/utils/internal/iron-crypto.ts:22`, `:28`, `:191-196`), não entropia.
- **`sdd/pedido.md`:** conferido. Os requisitos do PRD batem com o contrato #1050-b.
- **Documentação:** o parágrafo em `docs/4.examples/handle-session.md` (D-07) fica, como recomendado.
