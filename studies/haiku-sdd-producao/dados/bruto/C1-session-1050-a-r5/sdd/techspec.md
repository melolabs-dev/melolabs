# Especificação técnica — Várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-08) e issue h3js/h3#1050 (segunda alternativa).

## Resumo

`SessionConfig.password` passa a aceitar `string | string[]`. A primeira senha sela; as demais só abrem. A desselagem tenta as senhas em ordem, uma por vez, mantendo o fallback de selo legado por senha. A validação das senhas passa a acontecer antes do `catch` que hoje engole erros de leitura. A mudança fica em `src/utils/session.ts`, com um módulo interno novo, e não cria nenhum nome público.

## Situação atual (conferida no código)

- `SessionConfig.password` é `string` — `src/utils/session.ts:48`. O tipo não tem restrição de tamanho; a validação mora em `generateKey`.
- `getSession` desseleja dentro de uma promise com `.catch(() => {})` — `src/utils/session.ts:196-197`. Por isso qualquer erro de desselagem (inclusive senha curta ou vazia) vira sessão nova em silêncio na leitura. **O RF-06 pede erro explícito na leitura e isso não existe hoje para a string única.** Ver D-04.
- `sealSession` sela com `config.password` — `src/utils/session.ts:300`. Erros aqui propagam (não há `catch`).
- `unsealSession` chama `unseal` com `config.password` — `src/utils/session.ts:324`. O fallback legado está em `src/utils/session.ts:325-347`: só tenta de novo quando o erro é exatamente `"Bad hmac value"` (`:336`), o fallback não é `false` (`:333`) e as iterações atuais não são 1 (`:334`).
- `unseal` escolhe a senha: se a senha for string, usa direto; `passwordId` vazio cai em `"default"` — `src/utils/internal/iron-crypto.ts:120-128`. Com senha string, o `id` do selo é sempre `""` (`src/utils/internal/iron-crypto.ts:68`, `:79`). Logo, a lista de strings não altera o formato do cookie.
- Senha curta: `generateKey` lança `Password string too short` quando `password.length < options.minPasswordlength` — `src/utils/internal/iron-crypto.ts:191-196`. O mínimo padrão é 32 (`src/utils/internal/iron-crypto.ts:22`, `:28`).
- Número de derivações PBKDF2: `unseal` calcula primeiro o HMAC (uma `deriveBits`, `src/utils/internal/iron-crypto.ts:133`); só se o HMAC bater calcula a chave de cifra. Uma tentativa com senha errada custa 1 derivação de 8192 iterações; uma tentativa com fallback legado custa 1 derivação de 1 iteração.
- Não há outro uso de `config.password` como string no repositório: `test/bench/session.ts:20` passa a senha por `useSession` e não lê o campo. `src/types/context.ts:32` e `src/utils/auth.ts` referem-se a `basicAuth`, não a sessões.
- Exports de sessão em `src/index.ts:200-213`. A lista de exports é conferida por `test/unit/package.test.ts:125` e `:149`.
- O fallback legado já reselá sessões com `updateSession` em `src/utils/session.ts:214-215`, e o deslizamento de `idleTimeout` também reselá (`shouldSlide`, `src/utils/session.ts:214`, `:414-421`). Ambos usam `sealSession`, portanto com a primeira senha da lista.

## Decisões de arquitetura

### D-01 — Tipo de `password`: `string | string[]`

**Escolha:** `password: string | string[]` em `src/utils/session.ts:48`, exatamente como o PRD (RF-01). `[]` passa no tipo e é rejeitado em tempo de execução (RF-06).

**Alternativas consideradas:**
- `[string, ...string[]]` (tupla não vazia): o compilador já rejeitaria `[]`. Descartada porque o PRD fixa o tipo `string | string[]`, e a validação em tempo de execução continua necessária para chamadas JS e `as any`.
- Nova opção `extraUnsealPasswords` (alternativa 1 da issue): descartada porque cria nome público novo, o que o RF-07 proíbe.

### D-02 — Selar sempre com a primeira senha

**Escolha:** `sealSession` usa `resolvePasswords(config)[0]` no lugar de `config.password`. Nada mais muda no caminho de escrita (`updateSession`, `src/utils/session.ts:241-277`).

**Alternativas consideradas:**
- Gravar um `kid` no selo para identificar a senha: descartada, porque altera o formato do cookie (fora de escopo, PRD).
- Selar com a última senha: descartada por contrariar o RF-02 e a convenção "primeira senha sela".

### D-03 — Desselagem sequencial, uma senha por vez, fallback legado por senha

**Escolha:** `unsealWithPasswords` percorre as senhas na ordem da lista. Para cada senha:
1. tenta `unseal` com as opções atuais;
2. se falhar com `"Bad hmac value"` e o fallback legado estiver permitido, tenta com 1 iteração;
3. se ainda falhar com `"Bad hmac value"`, passa para a próxima senha.

Qualquer outro erro (formato inválido, `Wrong mac prefix`, `Expired seal`, `Empty password` etc.) é relançado de imediato, como hoje. Esses erros não dependem da senha, então tentar as outras seria desperdício. Se todas falharem, relança o último `"Bad hmac value"`, o que preserva o erro que `getSession` já engole.

**Alternativas consideradas:**
- Duas passadas (todas as senhas com iterações atuais, depois todas com 1 iteração): custo total parecido, porque a tentativa legada custa uma derivação de 1 iteração. Descartada por adicionar um laço a mais sem ganho de corretude.
- Tentar a próxima senha em qualquer erro: descartada, porque mascararia erros que não têm relação com a senha.

### D-04 — Validação antecipada, fora do `catch` de `getSession`

**Escolha:** `resolvePasswords(config)` valida a configuração e é chamada no começo de `getSession`, antes de `context.sessions` receber a sessão vazia (`src/utils/session.ts:158-173`). Assim, uma configuração inválida lança erro explícito na leitura (RF-06) e não deixa estado parcial no contexto. `sealSession` e `unsealSession` também chamam `resolvePasswords`.

A validação usa o mesmo mínimo que `generateKey` aplicaria: o maior `minPasswordlength` entre `encryption` e `integrity`, considerando o override de `config.seal` (`src/utils/session.ts:302-303`, `:319-320`).

**Mudança de comportamento para a string única (precisa de confirmação):** hoje, uma string curta ou vazia é ignorada em silêncio na leitura, e a requisição recebe sessão nova. Com D-04, a leitura passa a lançar erro. Justificativa: essa configuração nunca funcionou, e o silêncio faz o usuário ser desconectado sem diagnóstico. O RF-05 diz "como hoje", mas o RF-06 diz "como ocorre com a string única", e o código atual não lança na leitura. Se preferirmos preservar o silêncio para a string, a validação de leitura fica restrita à lista, o que é inconsistente e precisa de justificativa própria.

### D-05 — Limite de 4 entradas na lista

**Escolha:** `MAX_SESSION_PASSWORDS = 4`. Uma lista com mais itens lança erro na validação (D-04). O limite é interno, não exportado.

**Justificativa:** cada senha extra custa uma derivação de 8192 iterações por requisição quando o cookie não abre (ver "Situação atual"). Sem limite, a lista controla o custo de CPU que um cliente malicioso consegue forçar. Quatro cobre rotações normais (atual, anterior e uma ou duas de margem).

**Alternativa:** sem limite, documentando o custo. Descartada porque o PRD pede a decisão antes da implementação, e a documentação sozinha não protege contra configuração acidental com dezenas de entradas.

### D-06 — Migração: nenhuma reselagem nova

**Escolha:** não há lógica nova de migração. As sessões abertas com senha antiga são reseladas pelos caminhos que já existem, sempre com a primeira senha:
- o fallback legado (`src/utils/session.ts:214`, condição `legacySeal`);
- o deslizamento de `idleTimeout` (`src/utils/session.ts:214`, `shouldSlide`);
- qualquer gravação (`updateSession`).

**Ponto a registrar:** com `idleTimeout` configurado, uma sessão aberta com a senha antiga é migrada no primeiro deslizamento, o que é mais cedo do que "quando gravada de novo" (PRD, fora de escopo). Isso não é código novo; é o comportamento existente. Impedir o deslizamento para senhas que não são a primeira exigiria condição extra e enfraqueceria a janela de ociosidade, então descartei.

### D-07 — Local do código: módulo interno novo

**Escolha:** `src/utils/internal/session-passwords.ts`, com `MAX_SESSION_PASSWORDS`, `resolvePasswords` e `unsealWithPasswords`. Não exportado por `src/index.ts`.

**Justificativa:** `src/utils/session.ts` já tem 465 linhas, acima da meta de 200 do `AGENTS.md`. As helpers ocupam ~60 linhas. A convenção do projeto manda "internal helpers" em `utils/internal/` (`AGENTS.md`, seção Code Conventions). Não toco em `src/utils/internal/iron-crypto.ts`, porque o PRD exclui mudanças nos objetos `Password` com `id`.

**Alternativa:** helpers no fim de `src/utils/session.ts`, como `clearSession`, `shouldSlide` e `sessionExpires` já estão. Descartada pelo tamanho do arquivo.

### D-08 — Testes: arquivo novo e asserção de tipo

**Escolha:**
- `test/session-passwords.test.ts`, com `describeMatrix` (web e node), cobrindo RF-01 a RF-06 e D-04/D-05.
- `test/unit/types.test-d.ts`: `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`, cobrindo RF-07.
- `test/session.test.ts` fica intacto. Ele já cobre a string única (`:134-186`, `:722-735`), e o RF-05 exige que continue passando sem alteração.

**Alternativa:** adicionar os casos em `test/session.test.ts`. Descartada porque o arquivo já é grande e o novo conjunto tem configuração própria.

## Arquivos a alterar

| Arquivo | Mudança | Referências |
| --- | --- | --- |
| `src/utils/session.ts` | tipo de `password`; `resolvePasswords` em `getSession`, `sealSession`, `unsealSession`; `unsealSession` delega à helper | `:48`, `:158-173`, `:300`, `:312-347` |
| `src/utils/internal/session-passwords.ts` | arquivo novo (D-07) | — |
| `test/session-passwords.test.ts` | arquivo novo (D-08) | — |
| `test/unit/types.test-d.ts` | asserção de tipo de `SessionConfig["password"]` | — |

Não mudam: `src/index.ts` (exports), `src/utils/internal/iron-crypto.ts`, `test/session.test.ts`, `test/unit/package.test.ts`, `test/bench/session.ts`, `README.md` (não menciona sessões).

## Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. Each must be at least 32 characters.
   * The first entry seals new sessions; the others only open sessions sealed before a rotation.
   * ...
   */
  password: string | string[];
  // demais campos inalterados
}

// src/utils/internal/session-passwords.ts (interno)
import type { Session, SessionConfig } from "../session.ts";
import type { SealOptions } from "./iron-crypto.ts";

export const MAX_SESSION_PASSWORDS = 4;

/**
 * Normaliza e valida `config.password`. Lança erro se a lista estiver vazia,
 * tiver mais de MAX_SESSION_PASSWORDS itens, ou algum item for curto demais.
 * Retorna sempre uma lista com pelo menos um item; a primeira sela.
 */
export function resolvePasswords(config: Pick<SessionConfig, "password" | "seal">): string[];

/**
 * Tenta desselar `sealed` com cada senha, na ordem. Só avança para a próxima
 * senha quando o erro é "Bad hmac value". Relança qualquer outro erro.
 * `legacyAllowed` controla a tentativa de 1 iteração por senha.
 */
export function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  sealOptions: SealOptions,
  legacyAllowed: boolean,
): Promise<Partial<Session>>;
```

Mensagens de erro (texto exato, para os testes):
- lista vazia: `Session password list is empty`
- lista longa: `Too many session passwords (max 4)`
- senha curta: a mesma de `generateKey`, `Password string too short (min 32 characters required)`

Esboço do fluxo em `src/utils/session.ts`:

```ts
// getSession, antes de context.sessions[sessionName] = session
resolvePasswords(config);

// sealSession
const [sealPassword] = resolvePasswords(config);
const sealed = await seal(session, sealPassword, { ... });

// unsealSession, no lugar de `try { unseal(...) } catch { ... }`
const passwords = resolvePasswords(config);
const legacyAllowed = config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1;
const unsealed = await unsealWithPasswords(sealed, passwords, sealOptions, legacyAllowed);
// checagens de maxAge e idleTimeout continuam iguais (src/utils/session.ts:349-365)
```

A marcação `kLegacySeal` continua sendo feita dentro de `unsealWithPasswords`, quando o sucesso veio do fallback legado. O import de `kLegacySeal` vem de `src/utils/internal/session.ts`.

Imports de tipo entre `session.ts` e a helper formam um ciclo, mas só de tipos (`import type`), que é apagado na compilação. `verbatimModuleSyntax` aceita isso.

## Estratégia de testes

Regra do `AGENTS.md` (Bug Fix Workflow): escrever os testes antes da implementação e vê-los falhar. A mudança é de funcionalidade, mas o mesmo critério serve.

Casos em `test/session-passwords.test.ts`, com `describeMatrix`. Para criar cookies com uma senha específica, usar `useSession` com a configuração daquela senha, e não `seal` direto, para cobrir o fluxo real:

1. **RF-01:** `password: [A, B]` é aceito por `useSession` e `getSession` sem erro de tipo (com `expectTypeOf` no arquivo de tipos) nem de execução.
2. **RF-02:** cookie gerado com `[A, B]` abre com `unseal(cookie, A, sealDefaults)` e falha com `unseal(cookie, B, ...)` (`toThrow("Bad hmac value")`).
3. **RF-03:** cookie gerado com `[B]` lido com `[A, B]` devolve o mesmo `id` e `data`.
4. **RF-04:** cookie gerado com `[C]` lido com `[A, B]` devolve `id` diferente, `data` vazio, sem erro (o erro é capturado dentro do handler e a resposta é inspecionada).
5. **Ordem:** cookie gerado com `[A, B]` e lido com `[B, A]` continua abrindo; a reselagem após leitura de sessão legada usa a primeira senha da lista.
6. **Legado:** cookie legado (1 iteração) selado com `B` e lido com `[A, B]` abre, é reselado com `A` (o cookie resultante abre com `unseal(..., A, sealDefaults)`), como em `test/session.test.ts:134-159`.
7. **`legacySealFallback: false`:** o mesmo cookie legado de B é rejeitado com `[A, B]`, como em `test/session.test.ts:161-186`.
8. **RF-06 lista vazia:** `password: []` faz `useSession` e `getSession` lançarem `Session password list is empty` (capturado no handler).
9. **RF-06 senha curta na lista:** `["senha-curta", A]` lança erro de senha curta tanto na leitura quanto na gravação. Este é o caso que exige D-04.
10. **D-05 limite:** cinco senhas válidas lançam `Too many session passwords (max 4)`.
11. **D-03 custo:** com `vi.spyOn(crypto.subtle, "deriveBits")` (padrão de `test/session.test.ts:722-735`), um cookie que nenhuma senha abre produz 1 derivação de 8192 iterações por senha, mais as tentativas legadas. O teste fixa o comportamento para que uma mudança futura de custo seja vista.
12. **Regressão:** `test/session.test.ts` inteiro passa sem alteração (RF-05). `test/unit/package.test.ts` passa sem alteração (RF-07).

Verificação final: `pnpm lint` (inclui `oxlint` e `oxfmt --check`), `pnpm typecheck` (`tsc --noEmit`), `pnpm vitest run test/session-passwords.test.ts test/session.test.ts test/unit/`, e `pnpm test` antes de concluir.

## Riscos

1. **CPU em cookies inválidos.** Com N senhas, um cookie que nenhuma abre custa N derivações de 8192 iterações, mais N de 1 iteração se o fallback legado estiver ativo. Mitigação: limite de 4 (D-05). Restante: o custo é linear e não há cache de chave; aceito.
2. **Senha antiga válida por tempo indeterminado.** Enquanto ela estiver na lista, cookies com ela abrem. Mitigação: documentar que a senha só sai da lista depois de `maxAge` ou `idleTimeout` (o que for maior) sem sessões antigas ativas (PRD, riscos).
3. **Ordem da lista trocada por engano.** Sessões novas passam a ser seladas com a senha antiga. Mitigação: documentação no JSDoc. Não há validação de ordem em tempo de execução, porque nenhuma senha é "a nova" de forma verificável. Teste 5 fixa o comportamento.
4. **Mudança de comportamento na leitura de configuração inválida (D-04).** Uma string curta passa de sessão silenciosamente nova para erro. Pode surgir em produção como erro 500 em rotas que antes funcionavam sem sessão. Mitigação: confirmação do usuário (ver abaixo) e menção no changelog.
5. **Quebra de tipo para código do usuário.** Código que lê `config.password` como string deixa de compilar. No repositório não há esse caso (ver "Situação atual"). Mitigação: documentar.
6. **Custo de tempo nos testes.** Cada caso de senha executa PBKDF2 de 8192 iterações nos dois modos (web e node). O conjunto novo deve ficar na mesma ordem de grandeza de `test/session.test.ts`. Se ficar lento, reduzir casos repetidos.
7. **Erros silenciados.** `getSession` continua engolindo erros de desselagem de cookie inválido, o que é intencional. A validação de D-04 fica antes desse `catch`, então não é engolida.

## Pontos para confirmação

Estas decisões mudam o que o PRD descreve ou fixam um número que o PRD deixou em aberto:

1. **D-04:** aceitar que a leitura de string curta ou vazia passe a lançar erro (mudança de comportamento para configuração que já não funcionava). Recomendação: aceitar.
2. **D-05:** limite de 4 entradas. Recomendação: aceitar; ajustar a constante se o uso real pedir outro valor.
3. **D-06:** a migração pelo deslizamento de `idleTimeout` acontece antes da próxima gravação. Recomendação: aceitar, porque é o comportamento existente e não cria código novo.
