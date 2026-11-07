# Especificação técnica: várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-07) e a issue h3js/h3#1050.

## Resumo

`SessionConfig.password` passa a aceitar `string | string[]`. A primeira entrada sela. As demais entram apenas na tentativa de abertura, em ordem. A mudança fica concentrada em `src/utils/session.ts`, com um helper de validação e de iteração de senhas em `src/utils/internal/session.ts`. O formato do token selado, o algoritmo e as iterações do PBKDF2 não mudam, e nenhum nome público novo é criado.

## Estado atual

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`). O JSDoc diz que a chave precisa ter pelo menos 32 caracteres (`src/utils/session.ts:41-47`).
- A selagem usa `config.password` diretamente em `sealSession` (`src/utils/session.ts:300`).
- A abertura é feita em `unsealSession`, que passa `config.password` para `unseal` (`src/utils/session.ts:324`). Se falhar com `"Bad hmac value"` e o fallback legado estiver ativo, tenta de novo com 1 iteração (`src/utils/session.ts:332-347`).
- `unseal` do iron aceita um hash de senhas indexado por id, mas um token sem id usa a chave `"default"` (`src/utils/internal/iron-crypto.ts:121-128`). Por isso um hash não consegue testar todas as senhas para tokens que hoje não têm id.
- `unseal` valida o formato, a expiração e só depois o HMAC (`src/utils/internal/iron-crypto.ts:99-137`). Uma tentativa com senha errada custa uma derivação PBKDF2 (a da chave de integridade), e a chave de cifra só é derivada depois do HMAC bater (`src/utils/internal/iron-crypto.ts:133-147`).
- `getSession` engole qualquer erro de `unsealSession` com `.catch(() => {})` (`src/utils/session.ts:196-197`). Por isso uma validação de configuração colocada dentro desse fluxo nunca seria vista pelo chamador.
- Uma senha curta como string só falha hoje na selagem, com `Password string too short` (`src/utils/internal/iron-crypto.ts:192-196`). Na leitura ela é silenciosamente ignorada.
- O reselamento de sessões legadas e o de deslizamento do `idleTimeout` passam por `updateSession` e, portanto, por `sealSession` (`src/utils/session.ts:214-216`). Eles já vão usar a primeira senha sem código extra.
- Sessões lidas do header nunca são reseladas (`src/utils/session.ts:214`, `src/utils/session.ts:64-65`).
- A suíte usa `password` como string em `test/session.test.ts:23` e `test/session.test.ts:695`. Os testes de legado estão em `test/session.test.ts:134-186`. Nenhum teste usa senha curta.

## Decisões de arquitetura

### D-01 — Tipo público `string | string[]`, sem tupla

**Alternativas**
- `[string, ...string[]]`: garante em compilação que a lista não é vazia. Mas `process.env.X.split(",")` produz `string[]` e não atribui a esse tipo, o que obrigaria casts nos usuários.
- `string | string[]` com validação em runtime (escolhida).

**Escolha**: `string | string[]`. O RF-05 já exige a checagem em runtime, então a tupla não elimina a validação. Ela só acrescenta fricção de tipo. Fica como pendência de confirmação do usuário, porque o PRD a deixou em aberto.

### D-02 — Tentar as senhas por iteração, não selecionar por id

**Alternativas**
- Usar o `PasswordHash` do iron com ids (`{ "0": p0, "1": p1 }`). Isso exige que o token carregue o id, o que muda o formato selado, algo fora do escopo. Também não resolve os tokens existentes, que não têm id e caem na chave `"default"` (`src/utils/internal/iron-crypto.ts:121`). Uma sessão selada com a senha antiga, que hoje é `password` e passará a ser o índice 1, não seria encontrada.
- Tentar cada senha em ordem, capturando só o erro `"Bad hmac value"` (escolhida).

**Escolha**: iterar sobre a lista com `unseal` em cada senha. Erros que não sejam `"Bad hmac value"` (formato inválido, `Expired seal`, prefixo errado) são relançados na hora, porque não dependem da senha. A custo, o número de derivações cresce com N, o que é tratado em D-06 e nos riscos.

### D-03 — Ordem de tentativas: todas as senhas com as iterações atuais, depois o legado

**Alternativas**
- Para cada senha, tentar as iterações atuais e depois as legadas.
- Tentar todas as senhas com as iterações atuais; só se nenhuma abrir, tentar todas com 1 iteração (escolhida).

**Escolha**: a segunda. O caso comum, uma sessão selada com a senha atual, custa uma derivação, qualquer que seja o índice. O fallback legado é raro e está marcado como deprecated (`src/utils/session.ts:90-93`), então o custo extra dele não pesa. Com a primeira alternativa, uma sessão legada com a senha no índice 1 custaria mais.

### D-04 — Selar sempre com a primeira senha

**Escolha**: `sealSession` usa `passwords[0]`. `updateSession`, o reselamento de legado e o de deslizamento seguem o mesmo caminho (`src/utils/session.ts:214-216`, `src/utils/session.ts:267`), então não há novo mecanismo. Atende RF-02.

### D-05 — Validação centralizada e feita antes de qualquer leitura

**Alternativas**
- Validar só quando a lista é um array, mantendo o comportamento antigo da string.
- Validar strings e listas do mesmo jeito, no começo de `getSession`, `sealSession` e `unsealSession` (escolhida).

**Escolha**: a segunda. A validação roda antes de `context.sessions` ser alterado (`src/utils/session.ts:155-160`), para que um erro de configuração não deixe uma sessão pela metade no contexto. Ela também roda antes do `try` de `getSession`, para não ser engolida. Assim `getSession` lança mesmo sem cookie, e `useSession` lança porque chama `getSession` primeiro (`src/utils/session.ts:115`).

Essa escolha muda um comportamento: hoje uma string curta é ignorada na leitura. Depois, lança já em `getSession`. A suíte não tem nenhum teste com senha curta, então nenhuma asserção existente quebra. Fica registrado como mudança de comportamento para confirmação do usuário.

### D-06 — Limite de tamanho da lista (pendente de confirmação)

**Recomendação**: `MAX_SESSION_PASSWORDS = 4` (uma de selagem e até três de abertura), validado em `resolvePasswords` como erro de configuração.

**Motivo**: com N senhas, uma cookie inválida custa até N derivações de integridade e, com fallback legado, até 2N. Com o limite, o pior caso fica em 8, contra 2 hoje. O PRD deixou a decisão em aberto, então a implementação só inclui o limite se o usuário confirmar. Sem confirmação, a constante não entra e o restante da especificação continua válido.

### D-07 — Erro final preservado

Quando nenhuma senha abre o token, `unsealWithPasswords` relança o último `"Bad hmac value"`. Assim a mensagem de erro não muda nem na lista nem na senha única, e o risco do PRD sobre mensagens de erro fica resolvido sem teste novo de texto.

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:48` | `password: string` vira `password: string \| string[]`. Atualizar o JSDoc em `src/utils/session.ts:41-47` com a ordem das senhas e a regra de 32 caracteres por entrada. |
| `src/utils/session.ts:149-153` | Chamar `resolvePasswords(config.password)` no início de `getSession`, antes de `context.sessions` ser tocado (`src/utils/session.ts:155-160`). |
| `src/utils/session.ts:300` | `sealSession` usa `resolvePasswords(config.password)[0]`. A validação roda antes de `session.lastSeenAt` ser alterado (`src/utils/session.ts:293-298`). |
| `src/utils/session.ts:324`, `src/utils/session.ts:340-344` | `unsealSession` chama `unsealWithPasswords` no lugar de `unseal` direto. A lógica de fallback legado (`src/utils/session.ts:332-339`) e `kLegacySeal` (`src/utils/session.ts:346`) não mudam. |
| `src/utils/session.ts:464` (fim do arquivo) | Novo helper privado `unsealWithPasswords` e `isBadHmac`, no fim do arquivo como manda o AGENTS.md. |
| `src/utils/session.ts:3-5` | Importar `resolvePasswords` de `./internal/session.ts`. |
| `src/utils/internal/session.ts` (18 linhas hoje) | Novo `MAX_SESSION_PASSWORDS` (se D-06 for confirmado) e `resolvePasswords`. Fica aqui, não em `session.ts`, para não aumentar um arquivo que já tem 464 linhas (AGENTS.md pede menos de 200). |
| `test/session.test.ts` | Novo bloco `describe("multiple passwords")` depois de `test/session.test.ts:186`, dentro de `describeMatrix`. Nenhum teste existente é alterado. |
| `test/unit/types.test-d.ts` | Asserção de tipo `SessionConfig["password"]` igual a `string \| string[]`. |
| `docs/2.utils/4.security.md:74` | Parágrafo manual depois do `<!-- /automd -->`, com a rotação. O bloco automd de `:44-74` só gera as funções a partir do JSDoc, então o parágrafo não pode ficar dentro dele. |
| `docs/4.examples/handle-session.md:36-43` | Nova subseção "Rotacionar a senha" depois do aviso, com exemplo `password: [nova, antiga]` e a ordem explicada. |

Não alterar `src/utils/internal/iron-crypto.ts`. O iron já faz o que é preciso para cada senha isolada.

## Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. ...
   * The first entry seals; the rest only open older sessions.
   */
  password: string | string[];
  // demais campos inalterados
}
```

```ts
// src/utils/internal/session.ts
import { defaults as sealDefaults } from "./iron-crypto.ts";

export const MAX_SESSION_PASSWORDS = 4; // somente se D-06 for confirmado

/**
 * Normalize and validate `password`. Returns a non-empty list whose first
 * entry seals. Throws on an empty list, a too-short entry or too many entries.
 */
export function resolvePasswords(password: string | string[]): string[] {
  const passwords = typeof password === "string" ? [password] : password;
  if (passwords.length === 0) {
    throw new Error("Session password list must not be empty");
  }
  if (passwords.length > MAX_SESSION_PASSWORDS) {
    throw new Error(`Session password list accepts at most ${MAX_SESSION_PASSWORDS} entries`);
  }
  const min = sealDefaults.encryption.minPasswordlength;
  for (const entry of passwords) {
    if (entry.length < min) {
      throw new Error(`Session password must be at least ${min} characters`);
    }
  }
  return passwords;
}
```

```ts
// src/utils/session.ts (privado, no fim do arquivo)
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<unknown> {
  let lastError: unknown;
  for (const password of passwords) {
    try {
      return await unseal(sealed, password, options);
    } catch (error) {
      if (!isBadHmac(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

function isBadHmac(error: unknown): boolean {
  return error instanceof Error && error.message === "Bad hmac value";
}
```

`unsealSession` e `sealSession` mantêm as assinaturas públicas. O corpo muda como descrito na tabela. `unsealSession` passa a chamar `resolvePasswords(config.password)`, e depois usa `unsealWithPasswords(sealed, passwords, sealOptions)` e, no legado, `unsealWithPasswords(sealed, passwords, legacyOptions)`.

Conformidade com `isolatedDeclarations`: `resolvePasswords` e `unsealWithPasswords` têm tipo de retorno explícito. O `unseal` do iron já é exportado com retorno `Promise<unknown>`.

## Estratégia de testes

Seguir o fluxo de correção do AGENTS.md: escrever primeiro os testes que falham, confirmar a falha, depois implementar.

Os testes novos entram em `describeMatrix`, então rodam em `web` e `node`. Eles reutilizam `t.app`, `t.fetch` e os helpers de `seal`/`unseal` que o arquivo já importa (`test/session.test.ts:12`).

| Teste | RF | Verificação |
| --- | --- | --- |
| Cookie selado só com a senha antiga é lido | RF-01 | `getSession` retorna os dados. |
| Header `x-h3-test-session` selado só com a antiga é lido | RF-01 | Mesmo resultado. O nome do header vem de `src/utils/session.ts:179-182`. |
| `sealSession` abre com a nova e não com a antiga | RF-02 | Usar `unseal` do iron nas duas senhas. |
| `updateSession` sobre cookie de senha antiga reseala com a nova | RF-02 | O `Set-Cookie` abre com a primeira senha e não com a segunda. |
| Cookie selado com senha fora da lista vira sessão nova, sem dados | RF-03 | `data` vazio e nenhum erro lançado. |
| Sessão legada (1 iteração) com a senha antiga no índice 1 abre com `kLegacySeal` | RF-06 | `unsealSession` retorna o objeto com a marca. Importar `kLegacySeal` de `src/utils/internal/session.ts`. |
| Mesmo caso com a senha no índice 2 da lista | RF-06 | Idem. |
| `legacySealFallback: false` com lista rejeita legado | RF-06 | Sessão nova, sem dados antigos. |
| Lista de uma entrada se comporta como a string | RF-04 | Repetir uma das asserções existentes com `[senha]`. |
| `password: []` lança em `getSession`, `useSession` e `sealSession`, sem cookie | RF-05 | `rejects.toThrow`. Sem cookie prova que a validação roda antes da leitura. |
| `[novaValida, "curta"]` lança nas mesmas funções | RF-05 | Idem. |
| Lista com mais de `MAX_SESSION_PASSWORDS` lança | D-06 | Só se D-06 for confirmado. |
| Sessão antiga além de `maxAge` continua rejeitada com lista | Regressão | `Expired seal` ou `Session expired!` não é mascarado pela iteração. |
| `unsealSession` com senha desconhecida lança `"Bad hmac value"` | D-07 | Mensagem igual à da senha única. |
| `SessionConfig["password"]` é `string \| string[]` | D-01 | `expectTypeOf` em `test/unit/types.test-d.ts`. |

Verificação final, nessa ordem:
1. `pnpm vitest run test/session.test.ts`. A suíte existente tem que passar sem alteração de asserção (RF-04).
2. `pnpm vitest run test/unit`.
3. `pnpm typecheck` e `pnpm lint`.
4. `pnpm test` completo, com cobertura.
5. `pnpm bench:node` antes e depois, para confirmar que a senha única não ficou mais lenta. A diferença esperada é só o array de uma posição.

Um teste de bench com N = 1, 2 e 4 pode entrar em `test/bench/session.ts` como opcional, para medir o custo de cookies inválidos (D-06). Não é requisito.

## Riscos

1. **Amplificação de CPU.** Cada tentativa é uma derivação PBKDF2 de 8192 iterações. Com N senhas, uma cookie inválida custa N, ou 2N com fallback legado (D-03). Mitigações: limite de tamanho (D-06), rate limit na borda, medição com o bench.
2. **Senha antiga que nunca sai.** Se ela ficar na lista, continua aceita. A documentação precisa dizer quando é seguro remover.
   - Com `maxAge`, toda sessão expira em `createdAt + maxAge` no máximo. Depois desse prazo, a senha antiga pode sair.
   - Com só `idleTimeout`, uma sessão ativa é reselada com a senha nova no deslizamento (`src/utils/session.ts:214`). Depois de `idleTimeout` sem requisições, ela expira. A senha antiga pode sair depois desse prazo.
   - **Sem nenhum dos dois, a sessão não expira**, e remover a senha antiga desloga quem ainda tem cookie antigo. A doc deve dizer isso.
   - **Sessões via header não são reseladas** (`src/utils/session.ts:64-65`, `src/utils/session.ts:214`). Elas continuam com a senha antiga até `maxAge` ou `idleTimeout` contado do selo original. A doc deve dizer isso também.
3. **Ordem trocada.** Se a senha nova ficar em segundo lugar, as sessões novas são seladas com a antiga, sem erro. Mitigação: testes de RF-02 e explicação na doc.
4. **Mudança de comportamento para senha curta** (D-05). Uma string curta hoje é ignorada na leitura e passa a lançar. Pendente de confirmação.
5. **Vazamento de posição por tempo.** Quem mede o tempo de resposta pode saber em que índice a senha casou. Esse dado não é secreto, e o efeito é pequeno. Não justifica mudança.
6. **Arquivo grande.** `src/utils/session.ts` já passa de 200 linhas. Por isso o helper de validação foi para `src/utils/internal/session.ts`, e só o helper de iteração fica no próprio arquivo.
7. **Testes existentes.** Nenhuma asserção existente deve mudar. Se algum teste quebrar, a causa precisa ser investigada antes de qualquer ajuste, porque o RF-04 exige o contrário.

## Pendências para o usuário

- **D-06:** confirmar o limite de 4 entradas, ou dispensar o limite.
- **D-01:** confirmar `string | string[]` (recomendado) em vez de tupla.
- **D-05:** confirmar que strings curtas passam a lançar já em `getSession`.
