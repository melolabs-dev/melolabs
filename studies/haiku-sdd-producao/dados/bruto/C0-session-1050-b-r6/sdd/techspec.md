# Techspec — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md`. Este documento não altera código; descreve a mudança a implementar.

## 1. Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `unsealSession` tenta `password` e depois cada senha extra, na ordem. `sealSession` e `updateSession` não mudam: selam só com `password`. Uma sessão de cookie aberta com senha extra é resselada por `getSession`, reaproveitando o marcador `kLegacySeal`. Não há novo nome público (`test/unit/package.test.ts:125` e `:149` listam as exportações e não mudam).

## 2. Decisões de arquitetura

### D-01 — Campo novo `extraUnsealPasswords` em `SessionConfig`, `password` continua `string`
- **Alternativas:** (a) `password: string | string[]`, a segunda opção da issue; (b) campo novo `extraUnsealPasswords`; (c) um callback `resolvePassword(sealed)`.
- **Escolha:** (b). O pedido e o PRD §3 fixam a primeira alternativa da issue e proíbem outros nomes públicos. (a) alteraria o tipo de `password`, que `sealSession` e os testes usam como string (`test/session.test.ts:137`, `:157`). (c) seria um nome público a mais e exigiria um identificador de senha no seal, que está fora de escopo.
- **Consequência:** a mudança de tipo é só aditiva. Um array em `password` continua sendo erro de tipo (RF-01).

### D-02 — Unseal por tentativa e erro, na ordem `password`, depois as extras
- **Alternativas:** (a) identificar a senha pelo `id` do seal iron (o campo `passwordId` que `unseal` lê em `iron-crypto.ts:103`); (b) passar um `PasswordHash` (`Record<id, senha>`) para `unseal`; (c) tentar cada senha em sequência.
- **Escolha:** (c). `seal` grava `id = ""` quando a senha é uma string (`iron-crypto.ts:68`, `:79`), então os cookies já emitidos não têm identificador. (a) e (b) não abririam esses cookies e mudariam o formato do seal, o que o PRD §3 exclui. A senha atual vai primeiro, então o caso comum custa uma só tentativa.
- **Consequência:** um cookie inválido custa N+1 derivações PBKDF2 (risco R-01).

### D-03 — Extrair a lógica atual de `unsealSession` para uma função interna por senha
- **Alternativas:** (a) duplicar o `try/catch` com o fallback legado dentro de um laço; (b) extrair `unsealWith(sealed, password, config, sealOptions)`, com o corpo atual das linhas 322–348 de `src/utils/session.ts`, e fazer `unsealSession` iterar sobre ela.
- **Escolha:** (b). Mantém o fallback legado (`legacySealFallback`, 1 iteração) numa só cópia e deixa o laço legível. A função fica no fim de `src/utils/session.ts` (convenção: helpers internos no fim do arquivo) e não é exportada.
- **Consequência:** as validações de `maxAge`/`idleTimeout` (`session.ts:349-365`) ficam em `unsealSession`, depois do laço, e valem para qualquer senha (RF-06).

### D-04 — Fallback legado tentado por senha, dentro da função interna
- **Alternativas:** (a) duas passadas: todas as senhas com as iterações atuais, depois todas com 1 iteração; (b) por senha: atual, depois legado, então a próxima senha.
- **Escolha:** (b). Reaproveita o código existente sem mudanças, e uma sessão legada selada com uma senha extra também é aceita (RF-06). O custo extra é desprezível, porque a tentativa legada usa 1 iteração de PBKDF2 e só ocorre depois de `Bad hmac value`. Um HMAC não valida com a senha errada, então a ordem não cria falso positivo.

### D-05 — Quando passar para a próxima senha e qual erro propagar
- **Alternativas:** (a) passar para a próxima senha em qualquer erro; (b) passar só em `Bad hmac value` (a mensagem que `session.ts:336` já usa para detectar a falha de senha); outros erros são lançados na hora; (c) juntar os erros num `AggregateError`.
- **Escolha:** (b), com um ajuste: guarda-se o erro da primeira falha (a de `password`, já incluindo o fallback legado) e é ele que se lança quando todas as senhas falham. Assim o tipo e a mensagem de erro públicos de `unsealSession` ficam idênticos aos de hoje (RF-07). Erros que não dependem da senha (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `iron-crypto.ts:99-118`) não justificam mais tentativas caras. (a) multiplicaria o custo e poderia trocar o erro por um enganoso. (c) mudaria o tipo do erro público.
- **Consequência:** um erro que não seja `Bad hmac value` numa senha extra (por exemplo `Password string too short`, vindo de `iron-crypto.ts:193`) é lançado como está, e `getSession` o descarta (`session.ts:197`) como qualquer falha de unseal. A validação de tamanho mínimo continua sendo a do `iron-crypto`, e a implementação deve confirmar que ela alcança as extras com um teste.

### D-06 — Resselo ao abrir com senha extra, reaproveitando `kLegacySeal`
- **Alternativas:** (a) novo símbolo interno `kExtraSeal` em `src/utils/internal/session.ts`; (b) reaproveitar `kLegacySeal` (`src/utils/internal/session.ts:7`), que `getSession` já lê e apaga em `session.ts:199-202` e que dispara `updateSession` em `session.ts:214`; (c) comparar senhas dentro de `getSession`.
- **Escolha:** (b). O PRD §4 diz que o resselo "pode se apoiar" no mecanismo existente. O símbolo marca "reselar com a configuração atual", e isso cobre os dois casos (seal legado e senha extra). `unsealWith` devolve o objeto com `kLegacySeal = true` quando o índice da senha é maior que 0. O comentário do símbolo e o de `session.ts:210-213` devem ser atualizados para dizer que o marcador também cobre senhas extras. (a) acrescenta código sem ganho funcional. (c) obrigaria `getSession` a conhecer a ordem de tentativa.
- **Consequência:** `getSession` não muda de lógica. O resselo é feito por `updateSession`, que sela com `config.password` (`session.ts:300`) e cumpre RF-03 e RF-04. Uma sessão do cabeçalho de sessão não é resselada, porque `sessionFromCookie` é `false` (`session.ts:189-193`, `:214`).

### D-07 — Senhas extras duplicadas ou vazias: sem tratamento especial
- **Alternativas:** deduplicar e filtrar itens vazios antes do laço, ou não tratar.
- **Escolha:** não tratar. Uma extra igual a `password` só repete uma tentativa e falha igual, e uma extra vazia lança `Empty password` (`iron-crypto.ts:94`), erro que aponta a má configuração em vez de escondê-la. O TSDoc deve pedir uma lista curta e sem repetição.

## 3. Arquivos a alterar

| Arquivo | Linha | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-99` (`SessionConfig`) | Inserir `extraUnsealPasswords?: string[]` depois de `password` (`:48`), com TSDoc (D-01). |
| `src/utils/session.ts` | `:312-348` (`unsealSession`) | Substituir o `try/catch` por um laço sobre `[config.password, ...(config.extraUnsealPasswords ?? [])]` que chama `unsealWith` (D-02 a D-05). |
| `src/utils/session.ts` | `:349-366` | Manter, sem mudança, as validações de `maxAge` e `idleTimeout`. |
| `src/utils/session.ts` | `:210-213` | Atualizar só o comentário sobre o resselo (D-06). |
| `src/utils/session.ts` | fim do arquivo (depois de `:464`) | Nova função interna `unsealWith`. |
| `src/utils/session.ts` | `:300` (`sealSession`) | **Sem mudança**: sela só com `config.password` (RF-03). |
| `src/utils/internal/session.ts` | `:7-9` | Só o comentário/JSDoc de `kLegacySeal`, se existir; sem novo símbolo. |
| `test/session.test.ts` | depois de `:186` | Novos testes (seção 5). Os existentes (`:134`, `:161`) não devem precisar de ajuste. |
| `test/unit/types.test-d.ts` | fim do arquivo | Teste de tipo de RF-01. |
| `docs/4.examples/handle-session.md` | depois de `:149` (seção "Options") ou antes de `:151` (`## Expiration`) | Seção "Rotate the password" com exemplo e aviso de segurança (RF-08). |
| `docs/2.utils/4.security.md` | `:44-74` | Bloco `automd:jsdocs` gerado; o `pnpm fmt` o regenera se o TSDoc de uma função mudar. Nenhuma edição manual. |

Fora de `src/utils/session.ts` não há mudança de código de produção. `src/index.ts:203` já exporta o tipo `SessionConfig`, que cresce sozinho.

## 4. Contratos e assinaturas

```ts
export interface SessionConfig {
  password: string; // continua string; é a única que sela
  /**
   * Previous passwords that can still open sessions, tried in order after
   * `password`. They never seal: a session opened with one is resealed with
   * `password` (cookie sessions only). Same requirements as `password`
   * (32+ random characters). Keep it short: each entry costs one PBKDF2
   * attempt for a cookie that does not match. Remove an entry once cookies
   * sealed with it have migrated.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// Assinaturas públicas inalteradas:
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

Esboço da função interna (não exportada, com tipos explícitos por causa de `isolatedDeclarations`):

```ts
async function unsealWith(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // corpo atual de session.ts:322-348, parametrizado por `password`
```

Comportamento de `unsealSession`:
1. Monta `sealOptions` como hoje (`session.ts:317-321`).
2. Para cada senha, na ordem `[password, ...extras]`, chama `unsealWith`.
3. Sucesso na posição `i > 0`: marca `kLegacySeal = true` no resultado. Sucesso na posição 0: devolve como hoje, com o marcador só se o seal era legado.
4. Falha: se a mensagem for `Bad hmac value` e houver outra senha, guarda o primeiro erro e continua. Qualquer outro erro é lançado na hora. Esgotadas as senhas, lança o primeiro erro guardado.
5. Aplica `maxAge`/`idleTimeout` sobre o resultado, como hoje.

Invariantes: sem extras (ausente ou `[]`), o laço tem uma só iteração e o fluxo é o atual, byte a byte nas mensagens de erro. O resultado nunca vaza `kLegacySeal` para fora de `getSession` (que o apaga em `:199-202`); chamadas diretas a `unsealSession` já podem vê-lo hoje para seals legados.

## 5. Estratégia de testes

Seguindo o fluxo de correção de bug do AGENTS.md: escrever primeiro o teste de rotação (RF-02), confirmar que **falha** sem a mudança, implementar e confirmar que passa. Todos em `test/session.test.ts` dentro de `describeMatrix`, usando `seal`/`unseal`/`sealDefaults` (já importados em `:12`) e o padrão de rota com configuração própria de `:172`. As senhas de teste têm 32+ caracteres.

| Teste | Cobre | Verificação |
| --- | --- | --- |
| Sessão selada com A, config `password: B, extra: [A]` | RF-02 | `id` e `data` originais; `id` não é gerado por `generateId`. |
| Mesmo caso pelo cabeçalho `x-h3-test-session` | RF-02 | Sessão carregada; **sem** `Set-Cookie` (sem resselo). |
| `update` após abrir com A | RF-03 | O `Set-Cookie` abre com `{password: B}` e **não** abre com `{password: A}` (`unseal` lança). |
| Resselo na leitura (cookie com A) | RF-04 | A resposta traz 1 `Set-Cookie` que abre só com B; `id` preservado. |
| Senha C fora da lista | RF-05 | `id` novo, `data` vazio, nada da sessão antiga. |
| Senha removida da lista depois do resselo | RF-05 | O cookie antigo com A passa a ser rejeitado. |
| Ordem: `password` vence quando ambas abrem | RF-02 | Caso com o seal de B e extras `[A]`: sem `kLegacySeal`, sem resselo. |
| `maxAge` vencido com A | RF-06 | Usa `vi.useFakeTimers({ toFake: ["Date"] })` como em `:190`; sessão substituída. |
| `idleTimeout` com A | RF-06 | Resselo único, com `lastSeenAt`; sem `Set-Cookie` duplicado. |
| Seal legado (1 iteração) selado com A | RF-06 | Aceito e resselado com B nas iterações atuais; com `legacySealFallback: false` é rejeitado. |
| `extraUnsealPasswords` ausente e `[]` | RF-07 | Os testes existentes passam sem mudança; `unsealSession` com senha errada rejeita com `Bad hmac value`, como antes. |
| Extra curta (< 32 caracteres) | D-05 | O erro de tamanho mínimo é lançado por `unsealSession`; confirma que a validação do `iron-crypto` alcança as extras. |
| Tipo (`test/unit/types.test-d.ts`) | RF-01 | `extraUnsealPasswords: string[]` é aceito; `password: ["x"]` com `// @ts-expect-error`. |

Verificação final: `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck`. Checar que remover o laço de extras faz o teste de RF-02 falhar (RF-08). Rodar também `pnpm vitest run test/unit/package.test.ts` para confirmar que a lista de exportações não mudou.

## 6. Riscos

- **R-01 — CPU/DoS:** um cookie inválido custa N+1 tentativas de PBKDF2 (8192 iterações por padrão), além das tentativas legadas de 1 iteração. Mitigação: a senha atual vem primeiro, o TSDoc e a documentação pedem lista curta, e erros que não dependem da senha interrompem o laço (D-05).
- **R-02 — Fallback legado:** a tentativa legada por senha (D-04) não pode mascarar o erro. Mitigação: o erro propagado é o da primeira senha (D-05), e há teste de legado com senha extra e com `legacySealFallback: false`.
- **R-03 — Senha antiga vazada:** uma extra comprometida mantém válidas as sessões antigas até sair da lista. Mitigação: o resselo na leitura (D-06) migra os cookies ativos, e a documentação manda remover a extra depois disso. Cookies de cabeçalho não são resselados e só migram quando o cliente obtiver um novo seal.
- **R-04 — Reuso de `kLegacySeal`:** o nome sugere só "legado". Mitigação: comentário explícito; se a leitura ficar confusa, um renome interno é possível, sem tocar na API pública.
- **R-05 — Regressão em testes existentes:** o refator de `unsealSession` mantém o fluxo para uma só senha. Se algum teste de `test/session.test.ts` falhar, o ajuste não pode enfraquecer o que ele verifica. Não se prevê ajuste.
- **R-06 — `isolatedDeclarations`:** a função interna e o campo novo precisam de tipos explícitos para o `pnpm typecheck` passar (`tsconfig` estrito, AGENTS.md).
- **R-07 — Concorrência de sessões em cookie:** o resselo na leitura se soma ao de `idleTimeout`. Um só `updateSession` roda por requisição (`session.ts:214`), mas a sobreposição de requisições segue o aviso já documentado em `docs/4.examples/handle-session.md:183`.
