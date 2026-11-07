# Especificação técnica — Várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-07), issue h3js/h3#1050.

## 1. Visão geral

A mudança fica toda em `src/utils/session.ts`, mais um símbolo interno em `src/utils/internal/session.ts`. O ponto central é `unsealSession`, que hoje tenta uma única senha (`config.password`) e, se falhar com `Bad hmac value`, repete com 1 iteração PBKDF2 (fallback legado). A mudança faz esse par de tentativas rodar para `password` e depois para cada senha de `extraUnsealPasswords`. Selagem (`sealSession`) não muda: já usa só `config.password` (`src/utils/session.ts:300`).

O reselo (RF-03) reaproveita o mecanismo que já existe para o legado: `getSession` chama `updateSession` quando a sessão veio de cookie e o unseal sinalizou que o selo está defasado (`src/utils/session.ts:199-216`).

## 2. Decisões de arquitetura

### D-01 — Lógica de múltiplas senhas dentro de `unsealSession`, num único ponto

**Alternativas**
1. Loop em `getSession` chamando `unsealSession` com um `config` por senha.
2. Loop dentro de `unsealSession`, com um helper interno que abre com uma senha (incluindo o fallback legado).
3. Duplicar a lógica em `getSession` e `unsealSession`.

**Escolha: 2.** `unsealSession` é pública (`src/index.ts:209`) e o PRD (Riscos, "Divergência entre `getSession` e `unsealSession`") exige um ponto só. A opção 1 deixaria quem chama `unsealSession` direto sem as senhas extras. A opção 3 reabre o risco de divergência. As checagens de `maxAge`/`idleTimeout` (`src/utils/session.ts:349-365`) ficam depois do loop, rodando uma única vez sobre o resultado, o que garante RF-04.

### D-02 — Ordem de tentativa: por senha, com o legado dentro de cada senha

**Alternativas**
- (a) Para cada senha: iterações atuais, depois legado. Ordem final: `password` atual, `password` legado, extra 1 atual, extra 1 legado, …
- (b) Todas as senhas com iterações atuais, depois todas com o legado.

**Escolha: (a).** É a que reaproveita o bloco atual como helper, sem reestruturar o fluxo, e mantém o caso sem extras idêntico ao de hoje (RF-05). O custo em cookie inválido é igual nas duas ordens. Uma única condição muda: o legado só é tentado se o erro daquela senha for `Bad hmac value` (condição já existente, `src/utils/session.ts:332-337`). Erros como `Expired seal`, formato inválido ou senha curta demais não disparam o legado, mas também não abortam o loop: seguem para a próxima senha.

### D-03 — Erro final é o da senha principal

Se nenhuma senha abrir o cookie, `unsealSession` relança o erro da tentativa com `password` (primeira da lista), não o da última extra. Isso mantém o erro observável idêntico ao atual quando não há extras (RF-05) e evita expor ao chamador um erro de senha extra mal formada. `getSession` já engole o erro com `.catch(() => {})` (`src/utils/session.ts:197`).

### D-04 — Marcador interno único de "selo defasado" (substitui `kLegacySeal`)

**Alternativas**
1. Reusar `kLegacySeal` também para senha extra.
2. Criar um segundo símbolo (`kExtraSeal`) e checar os dois.
3. Substituir `kLegacySeal` por um símbolo de significado mais amplo, por exemplo `kStaleSeal`: "o selo não foi feito com `password` e as opções atuais".

**Escolha: 3.** A opção 1 faz o nome mentir. A opção 2 espalha duas checagens em `getSession` sem ganho. `kLegacySeal` só é usado em `src/utils/session.ts` (linhas 5, 199, 201 e 346) e declarado em `src/utils/internal/session.ts:7`, e nenhum teste o referencia, então o rename é local. O símbolo continua interno: não vai para `src/index.ts`, o que cumpre RF-07 (nenhum nome público novo). O fluxo `delete unsealed[kStaleSeal]` em `getSession` (`:200-202`) é mantido, para o símbolo não vazar para `session`.

### D-05 — Normalização da lista: ignorar vazias e duplicatas de `password`

Antes do loop, montar `[config.password, ...extras]` descartando entradas que não sejam string não vazia ou que sejam iguais a `config.password`. Isso evita pagar PBKDF2 duas vezes pela mesma senha, caso comum durante a rotação, quando alguém deixa a senha atual na lista. Uma senha extra inválida (curta demais, rejeitada por `generateKey`, `src/utils/internal/iron-crypto.ts:192`) cai no `catch` do helper e é tratada como "não abre nada" (premissa do PRD).

### D-06 — Sem limite de tamanho da lista

**Alternativas**: (a) sem limite, só TSDoc pedindo lista curta; (b) limite fixo (ex.: 5) ignorando o excesso; (c) limite que lança erro na configuração.

**Escolha: (a).** O PRD pede apenas "avaliar". Um limite fixo é um número arbitrário que vira comportamento silencioso (b) ou uma falha nova de configuração (c), e o custo é controlado pelo desenvolvedor, que escreve a lista. O risco de DoS fica documentado no TSDoc e na seção 6. Se se quiser limite no futuro, é mudança aditiva dentro da normalização de D-05.

### D-07 — Reselo só em sessões de cookie, sem mudar a regra atual

A condição de `getSession` (`src/utils/session.ts:214`) já exige `sessionFromCookie`. Basta trocar `legacySeal` por `staleSeal`. Sessões lidas do header não são resseladas, como diz a premissa do PRD. `updateSession` sela com `password` (via `sealSession`, `:300`), então o novo cookie abre com somente `password` (RF-02 e RF-03).

### D-08 — `legacySealFallback: false` vale para todas as senhas

O teste `config.legacySealFallback === false` fica dentro do helper por senha, então vale igualmente para as extras (RF-06). Com `false`, um cookie legado selado com `B` não abre, mesmo que `B` esteja na lista.

## 3. Arquivos a alterar

| Arquivo | Linhas (conferidas) | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:5` | Trocar o import de `kLegacySeal` por `kStaleSeal`. |
| `src/utils/session.ts` | `:39-99` (`SessionConfig`; `password` em `:48`, `legacySealFallback` em `:95`) | Adicionar `extraUnsealPasswords?: string[]` com TSDoc, logo após `password`. |
| `src/utils/session.ts` | `:199-202` | Renomear a variável e a chave do símbolo (`legacySeal` → `staleSeal`). |
| `src/utils/session.ts` | `:214` | Condição de reselo usa `staleSeal`. |
| `src/utils/session.ts` | `:312-348` (`unsealSession`) | Extrair o par "iterações atuais + fallback legado" para um helper interno e iterar sobre as senhas (D-01 a D-05). |
| `src/utils/session.ts` | `:349-366` | Sem mudança: checagens de expiração rodam depois do loop (RF-04). |
| `src/utils/internal/session.ts` | `:7-9` | Renomear `kLegacySeal` para `kStaleSeal` (mesma `Symbol.for`, novo nome da chave). |
| `test/session.test.ts` | após `:186` | Novos testes (seção 5). Os testes existentes em `:134-186` não mudam. |

Não mudam: `src/index.ts` (`SessionConfig` já é exportado em `:203`; nenhuma exportação nova), `src/utils/cookie.ts`, `src/utils/internal/iron-crypto.ts`, `test/unit/package.test.ts:149` (lista de exportações públicas, que não muda) e `docs/2.utils/4.security.md:60` (gerado por `automd` só para funções; o campo novo aparece no TSDoc).

Sobre o pedido de ajustar testes existentes que dependam do que mudou: conferi `test/session.test.ts` e `test/unit/package.test.ts` e nenhum depende de `kLegacySeal` nem do formato do `unsealSession`. Os testes legados em `:134-186` continuam válidos sem edição e cobrem RF-05. Se algum falhar na implementação, o ajuste deve preservar a verificação original.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (único tipo público alterado)
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that are only used to open (unseal) existing sessions,
   * so secrets can be rotated without signing users out.
   *
   * Tried in order after `password`. Sessions are always sealed with `password`,
   * and a session opened with one of these is resealed with `password`
   * (cookie sessions only). Keep the list short and remove an entry once every
   * session sealed with it has expired (`maxAge`/`idleTimeout`): each failed
   * attempt costs a PBKDF2 derivation, and a leaked old password keeps working
   * while it is listed.
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// Assinaturas públicas inalteradas
export async function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;
export async function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
```

Interno (não exportado do pacote):

```ts
// src/utils/internal/session.ts
export const kStaleSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.stale-seal");

// src/utils/session.ts — esboço do helper
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>; // lança o erro do unseal; marca kStaleSeal se usou o fallback legado
```

Comportamento de `unsealSession`:
1. `passwords = [config.password, ...extras]` normalizada (D-05).
2. Para cada senha `p`, índice `i`: `unsealWithPassword`. Sucesso: se `i > 0` ou o fallback legado foi usado, definir `unsealed[kStaleSeal] = true`; sair do loop. Falha: guardar o erro se `i === 0` e continuar.
3. Sem sucesso: lançar o erro de `i === 0`.
4. Aplicar `maxAge` e `idleTimeout` sobre `unsealed` (código atual) e retornar.

`unsealed` pode ser `null` quando o payload é vazio (`iron-crypto.ts:149`); manter a guarda `if (unsealed)` do código atual antes de marcar o símbolo.

## 5. Estratégia de testes

Todos em `test/session.test.ts`, dentro de `describeMatrix` (roda em `web` e `node`), com um helper local para selar com senha e iterações arbitrárias, no padrão dos testes de `:134-186`. Usam `A` = `sessionConfig.password` (`:23`) e uma `B` de 32+ caracteres.

| Requisito | Teste |
| --- | --- |
| RF-01 | Cookie selado com `B`, config `{password: A, extraUnsealPasswords: [B]}`: `session.id` e `data` carregados. Variante com `B` na segunda posição de `[C, B]`. |
| RF-02 | Sessão nova com extras: `Set-Cookie` abre com `A` (`unseal` direto) e falha com `B`. |
| RF-03 | Cookie com `B`: resposta tem exatamente um `Set-Cookie` da sessão, que abre com `A` e retorna o mesmo `id`/`data`. Caso de borda: sessão grande em chunks continua resselada. |
| RF-04 | Com `vi.useFakeTimers({ toFake: ["Date"] })` (padrão de `:189-190`): selo com `B` além do `maxAge` ⇒ sessão nova e `data` vazio; idem para `idleTimeout`. |
| RF-05 | Rodar `pnpm vitest run test/session.test.ts` sem alterar os testes existentes; mais um teste com `extraUnsealPasswords: []` equivalente ao caso sem campo. |
| RF-06 | Cookie com 1 iteração e `B`: abre e resselado com `A` e iterações atuais; com `legacySealFallback: false` não abre. |
| D-03/D-05 | Cookie inválido com extras: sessão nova (sem exceção). Senha extra curta demais ou igual a `password` na lista não derruba as demais. |
| Sessão por header | Header com selo de `B` abre a sessão e não emite `Set-Cookie` (D-07). |
| `unsealSession` direto | Chamada pública com extras abre o selo de `B` (D-01). |

Verificações finais: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck`. Seguindo o fluxo do `AGENTS.md`, escrever os testes primeiro e confirmar que falham antes da implementação.

## 6. Riscos

- **Amplificação de custo (DoS).** Cookie inválido custa até `2 × (1 + N)` derivações PBKDF2 (atual e legado por senha). Mitigação: lista curta documentada no TSDoc, deduplicação e descarte de vazias (D-05); sem limite rígido (D-06). O custo do legado só aparece para erro `Bad hmac value`.
- **Senha antiga continua válida.** Enquanto listada, uma senha vazada abre sessões não expiradas. Documentado no TSDoc; remover após `maxAge`/`idleTimeout`.
- **Logout silencioso após remoção.** Remover a senha antiga antes das sessões expirarem as descarta sem aviso, como hoje.
- **Leitura que escreve cookie (RF-03).** Uma leitura passa a emitir `Set-Cookie`, como já ocorre com `idleTimeout` e legado. Há corrida com requisições concorrentes que escrevem a sessão: vale o último cookie aplicado pelo navegador, como descrito em `docs/4.examples/handle-session.md:183`. Cobrir com teste de resposta e de chunks (seção 5).
- **Divergência entre `getSession` e `unsealSession`.** Tratada por D-01: um único ponto de tentativa e uma única checagem de expiração.
- **Renomear `kLegacySeal`.** `Symbol.for` global: se código externo usasse a string antiga, não quebraria por nome de export, mas o rename da string do símbolo muda a chave. É símbolo interno e não exportado; risco baixo. Se preferir zero risco, manter a string `"h3.internal.session.legacy-seal"` e mudar só o identificador.
- **Marcador visível em `unsealSession` pública.** Quem chama direto recebe um objeto com a chave simbólica `kStaleSeal`, como já acontece hoje com `kLegacySeal`. Não é serializável nem enumerável por `Object.keys`.
- **Senha extra com comprimento menor que o mínimo.** Falha por senha, silenciosamente; o desenvolvedor só percebe pela sessão não abrir. Aceito como premissa do PRD; o TSDoc remete às mesmas regras de `password`.

## 7. Fora de escopo (reafirmado)

`password` como array, rotação automática, revogação por id, mudanças em `cookie.ts`/`iron-crypto.ts`, formato do selo, remoção do `legacySealFallback`, suporte a extras além do que o header já aceita na leitura e documentação além do TSDoc.
