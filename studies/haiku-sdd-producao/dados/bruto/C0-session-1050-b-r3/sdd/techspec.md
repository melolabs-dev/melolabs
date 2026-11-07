# Techspec — Várias senhas de unseal nas sessões (`extraUnsealPasswords`)

Referência: issue h3js/h3#1050 (primeira alternativa), contrato enxuto #1050-b, `sdd/prd.md` (RF-01 a RF-09).
Escopo de código: somente `src/utils/session.ts`, mais testes e uma nota de documentação. Nenhuma mudança em `iron-crypto.ts`, no formato do token ou em `src/index.ts`.

## 1. Estado atual (conferido no código)

- `SessionConfig.password: string` é a única senha (`src/utils/session.ts:48`).
- `getSession` lê header e depois cookie (`src/utils/session.ts:178-193`), chama `unsealSession(...).catch(() => {})` (`src/utils/session.ts:196-197`) e reseala quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`src/utils/session.ts:214-216`). O marcador `kLegacySeal` é lido e removido em `src/utils/session.ts:199-202`.
- `sealSession` sela com `config.password` (`src/utils/session.ts:300`); `updateSession` sela via `sealSession` (`src/utils/session.ts:267`).
- `unsealSession` (`src/utils/session.ts:312-367`) faz `unseal(sealed, config.password, sealOptions)` (`src/utils/session.ts:324`). Se o erro for exatamente `"Bad hmac value"` e o fallback legado estiver ligado, repete com 1 iteração (`src/utils/session.ts:332-344`) e marca `kLegacySeal` (`src/utils/session.ts:345-347`). Depois valida `maxAge` (`src/utils/session.ts:350-355`) e `idleTimeout` (`src/utils/session.ts:359-365`), lançando `"Session expired!"`.
- Erros do `unseal` (`src/utils/internal/iron-crypto.ts:87-150`), em ordem de ocorrência:
  - independentes da senha: `"Incorrect number of sealed components"` (`:99-101`), `"Wrong mac prefix"` (`:106-108`), `"Invalid expiration"` (`:112`), `"Expired seal"` (`:116`), todos antes de qualquer PBKDF2;
  - dependentes da senha: `"Empty password"` (`:94-96`, e `generateKey` em `:172-174`), `"Password string too short (min N characters required)"` (`:192-195`) e `"Bad hmac value"` (`:135-137`).
  - A decifragem (`:147`) só roda depois do HMAC válido, então uma senha errada nunca chega nela.
- O marcador interno está em `src/utils/internal/session.ts:7`. `SessionConfig`, `unsealSession` e `getSession` já são exportados por `src/index.ts:203-209`; nada novo precisa ser exportado.

## 2. Decisões de arquitetura

### D-01 — Campo `extraUnsealPasswords?: string[]` em `SessionConfig`
- **Alternativas:** (a) `password: string | string[]`, a segunda alternativa da issue (fora de escopo, mudaria o tipo de `password`); (b) objetos `{ id, secret }` no estilo iron (nome público novo, fora de escopo); (c) campo novo opcional.
- **Escolha: (c).** É o que o contrato fixa. Não quebra tipos existentes, e `password` segue `string` e única senha de selagem. O TSDoc ao lado de `password` (`src/utils/session.ts:48`) deve dizer: senhas anteriores, só abrem sessões, mesmo mínimo de 32 caracteres e mesma exigência de entropia, tentadas na ordem da lista (as mais recentes primeiro), lista curta e a ser esvaziada depois da janela de rotação (riscos R-01 e R-02).

### D-02 — Lista de candidatas calculada num helper interno
- **Alternativas:** (a) montar `[password, ...extra]` inline em `unsealSession`; (b) helper interno `unsealPasswords(config)` no fim do arquivo; (c) normalizar na entrada de `getSession`.
- **Escolha: (b).** O AGENTS.md pede helpers internos no fim do arquivo. A lista é `[config.password, ...(config.extraUnsealPasswords ?? [])]`. Com extras ausentes ou `[]` ela tem um único item e o fluxo é idêntico ao atual (RF-08). A normalização em `getSession` (c) não cobriria `unsealSession` chamada diretamente.

### D-03 — Loop de tentativas dentro de `unsealSession`
- **Alternativas:** (a) fazer o loop em `getSession` e deixar `unsealSession` só com `password`; (b) loop em `unsealSession`.
- **Escolha: (b).** O RF-02 exige o comportamento em `getSession`, `useSession` e `unsealSession`, e `unsealSession` é pública. Assim, `getSession` não muda no ponto de chamada (`src/utils/session.ts:196`).
- **Estrutura:**
  1. Extrair o trecho atual `unseal` + retry legado (`src/utils/session.ts:322-348`) para um helper interno `unsealWith(sealed, password, config, sealOptions)`, que devolve a sessão (com `kLegacySeal` se o seal era legado) ou lança.
  2. `unsealSession` percorre as candidatas na ordem. A primeira que abre vale.
  3. Só depois do sucesso aplica `maxAge` e `idleTimeout` (`src/utils/session.ts:349-365`, inalterados). Assim o RF-06 vale para qualquer senha e a expiração nunca dispara outra tentativa.

### D-04 — Quando passar para a próxima senha (distinção de erro)
- **Alternativas:** (a) `catch` genérico e tentar a próxima; (b) tentar a próxima só em erro dependente da senha.
- **Escolha: (b).** Passa-se para a próxima candidata somente quando o erro é `"Bad hmac value"` (a senha não bate). Esse é o mesmo critério do fallback legado atual (`src/utils/session.ts:336`). Para as extras, passa-se também em `"Empty password"` e `"Password string too short"`, pois o PRD manda que uma extra inválida "simplesmente não abra" a sessão. Erros independentes da senha (`Wrong mac prefix`, `Incorrect number of sealed components`, `Expired seal`, `Invalid expiration`) são relançados na hora, sem gastar PBKDF2 nas demais.
- **Erro final:** se nenhuma abrir, relança o erro da **primeira** candidata (`password`), para que sem extras a saída seja a mesma de hoje (RF-08), inclusive para `Password string too short` quando `password` é curta.
- **Detecção:** por `error.message`, como já faz o código (`src/utils/session.ts:335-336`), sem mudar `iron-crypto.ts` (fora de escopo). Risco R-04.

### D-05 — Fallback legado por senha (RF-07)
- **Alternativas:** (a) tentar todas as senhas com iterações atuais e depois todas com 1 iteração; (b) por senha, tentar iterações atuais e depois 1 iteração antes de ir à próxima.
- **Escolha: (b).** Reaproveita sem mudança a lógica de `src/utils/session.ts:332-347` dentro de `unsealWith`, e respeita `legacySealFallback: false` e `iterations === 1` do mesmo jeito. A ordem só afeta o custo no caso de falha total, já descrito em R-01. A ordem (a) exigiria separar a lógica legada em dois pontos e não traz ganho funcional.

### D-06 — Resselagem proativa via marcador existente (RF-05)
- **Alternativas:** (a) novo símbolo interno `kStaleSeal` em `src/utils/internal/session.ts`; (b) reaproveitar `kLegacySeal` (`src/utils/internal/session.ts:7`) para "aberta com algo diferente do seal atual", ou seja, seal legado **ou** senha extra; (c) comparar senhas dentro de `getSession`.
- **Escolha: (b).** `getSession` já faz `delete` do marcador e reseala só para sessão de cookie (`src/utils/session.ts:199-202,214`), exatamente o comportamento pedido (sessões de header não são resseladas, o `id`, o `createdAt` e o `data` são preservados porque `updateSession` sela o objeto da sessão). Quando a senha que abriu não é a primeira da lista, `unsealWith`/`unsealSession` marca `kLegacySeal`. O custo é só semântico, então ajusta-se o comentário de `src/utils/session.ts:210-213` e de `src/utils/internal/session.ts:7`. Se a leitura do nome incomodar, um renome interno é opção futura; não é nome público.
- O reseal usa `sealSession`, que sela com `config.password` e as opções atuais (`src/utils/session.ts:300-304`), então vale também para o caso "extra + seal legado" (RF-07).

### D-07 — Selagem inalterada (RF-04)
`sealSession` (`src/utils/session.ts:300`) e `updateSession` não mudam: nunca leem `extraUnsealPasswords`. O critério do RF-04 é protegido por teste (seção 5), não por código novo.

### D-08 — Documentação
O PRD permite atualizar a documentação se já houver página de sessões e a mudança for trivial. Existe `docs/4.examples/handle-session.md`, com a nota sobre a entropia da `password` em `docs/4.examples/handle-session.md:37`. Acrescentar ali um parágrafo curto "Rotating the password" com um exemplo de `extraUnsealPasswords`. A seção `unsealSession` de `docs/2.utils/4.security.md:60` não muda de assinatura. Se o `pnpm fmt`/automd regenerar essa página, não editar à mão o trecho gerado.

## 3. Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:48` (interface `SessionConfig`) | Novo campo `extraUnsealPasswords?: string[]` com TSDoc (D-01). |
| `src/utils/session.ts` | `:210-213` | Comentário da resselagem passa a citar senha extra. |
| `src/utils/session.ts` | `:312-348` (`unsealSession`) | Loop sobre as candidatas e extração do helper `unsealWith` (D-03 a D-05). |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | Helpers internos `unsealPasswords`, `unsealWith` e `isPasswordMismatch` (D-02 a D-04). |
| `src/utils/internal/session.ts` | `:7` | Só comentário sobre o novo significado do marcador (D-06). |
| `test/session.test.ts` | novo bloco dentro de `describeMatrix("session", ...)`, depois de `:186` | Testes novos (seção 5). |
| `docs/4.examples/handle-session.md` | perto de `:37` | Parágrafo curto (D-08). |

Não mudam: `src/utils/internal/iron-crypto.ts`, `src/index.ts:203-209` (nenhum export novo), `test/unit/package.test.ts:149` (lista de exports).

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — único acréscimo público
export interface SessionConfig {
  password: string; // continua string; única senha que sela
  /**
   * Previous passwords, used only to unseal sessions (never to seal), tried in
   * order after `password`. Same requirements as `password`. Keep it short and
   * remove entries once the rotation window has passed.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// Assinaturas públicas inalteradas
export function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

// Internos (não exportados)
function unsealPasswords(config: SessionConfig): string[];
function unsealWith(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // pode marcar kLegacySeal
function isPasswordMismatch(error: unknown, isExtra: boolean): boolean;
```

Semântica de `unsealSession`:
1. Para cada senha `p` de `unsealPasswords(config)`, na ordem: `unsealWith(sealed, p, ...)`.
2. Sucesso: se `p` não for a primeira, marca `kLegacySeal` no resultado. Segue para `maxAge`/`idleTimeout`.
3. Erro: se `isPasswordMismatch`, guarda o primeiro erro e continua. Caso contrário, relança.
4. Esgotadas as senhas, relança o primeiro erro guardado.

Comportamento observável: sem extras, nada muda (D-04, D-02). Com extras, `getSession` continua engolindo a falha (`.catch(() => {})`, `src/utils/session.ts:197`) e criando sessão nova (RF-03).

## 5. Estratégia de testes

Todos em `test/session.test.ts`, dentro de `describeMatrix` (roda em `web` e `node`), usando `seal`/`unseal` de `iron-crypto.ts` para fabricar cookies, como em `test/session.test.ts:134-159`. Usar `name` próprio por teste para não colidir com o estado compartilhado de `cookie`.

Seguir o fluxo do projeto: escrever primeiro e rodar sem a mudança em `src/utils/session.ts` (`pnpm vitest run test/session.test.ts`). O vitest não checa tipos, então a falha esperada vem do comportamento em runtime.

| Teste | RF | Esperado sem a implementação |
| --- | --- | --- |
| Sessão selada com A, config `password: B, extraUnsealPasswords: [A]` mantém `id`, `createdAt`, `data` e não cria sessão nova | RF-02 | **falha** |
| `unsealSession` chamada direta com extra abre a sessão | RF-02 | **falha** |
| Ordem: com `[A1, A2]`, sessão selada com A2 abre | RF-02 | **falha** |
| Selada com C (nem `password` nem extra): dados descartados, novo `id` | RF-03 | passa (guarda de regressão) |
| `sealSession`/`updateSession` geram token que abre com B e não abre com A (via `unseal` direto) | RF-04 | passa (guarda de regressão) |
| Cookie selado com A: resposta traz `Set-Cookie` selado por B (abre só com B), mesmo `id`; header não é resselado | RF-05 | **falha** |
| `maxAge` e `idleTimeout` expirados com seal por A: rejeitada, nova sessão | RF-06 | passa (guarda de regressão) |
| Seal legado (1 iteração) com A, `legacySealFallback` indefinido: carrega e reressela com B e iterações atuais | RF-07 | **falha** |
| Mesmo caso com `legacySealFallback: false`: rejeitada | RF-07 | passa (guarda de regressão) |
| `extraUnsealPasswords: []` e ausente: sessão selada com outra senha segue rejeitada | RF-08 | passa |
| Extra curta ou vazia na lista não derruba a sessão selada com a extra seguinte válida | D-04 | **falha** |

Os testes que "passam" sem implementação são guardas contra regressão. O PRD só exige que RF-02, RF-05 e RF-07 falhem antes (RF-09).

**Testes existentes:** nenhum fixa o erro lançado ou a contagem de chamadas de `unseal` (conferido por busca em `test/session.test.ts`; os `spyOn` estão em `:414` e `:723`, e contam `encrypt` e `deriveBits` só na selagem, que não muda). Devem passar sem ajuste, e o RF-08 se verifica rodando `pnpm vitest run test/session.test.ts`. Se algum precisar de ajuste, preservar o que ele verifica.

**Gates finais:** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` (inclui o tipo `string` de `password`; um `password: ["x"]` deve continuar sendo erro de tipo).

## 6. Riscos

- **R-01 — CPU.** Cada tentativa falha custa 2 derivações PBKDF2 de 8192 iterações (encriptação e integridade; o HMAC é checado antes e a decifragem nunca roda numa senha errada) e, com o fallback legado, mais uma rodada. Um cookie forjado custa até 2·(N+1) rodadas com N extras. Mitigação: TSDoc e doc dizendo para manter a lista curta; erros independentes da senha saem antes do PBKDF2 (D-04).
- **R-02 — Segurança.** Uma senha vazada continua valendo enquanto estiver na lista. Mitigação: documentar; a resselagem proativa (D-06) permite retirá-la.
- **R-03 — Sessões por header.** Não são resseladas e dependem da senha extra até expirarem (comportamento já existente para o seal legado). Documentar.
- **R-04 — Detecção de erro por mensagem.** Depende do texto `"Bad hmac value"` e das mensagens de senha curta ou vazia em `iron-crypto.ts`. Se mudarem, a rotação deixa de funcionar de forma silenciosa. Mitigação: os testes de RF-02 e D-04 quebram, e o próprio fallback legado já depende dessa mensagem (`src/utils/session.ts:336`).
- **R-05 — Semântica do marcador `kLegacySeal`.** Passa a significar "reselar", o que pode confundir quem ler o código. Mitigação: comentários atualizados (D-06).
- **R-06 — Extra igual a `password`.** Duplicata só gasta uma tentativa a mais; não é erro. Aceitar sem tratamento especial.
