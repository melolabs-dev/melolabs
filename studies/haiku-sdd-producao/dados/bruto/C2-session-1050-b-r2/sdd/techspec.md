# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (requisitos RF-01 a RF-07), issue h3js/h3#1050.

Este documento define como implementar `extraUnsealPasswords` em `SessionConfig`. Os nomes de código ficam em inglês, como no restante do projeto; a prosa e os comentários de decisão ficam em português. Os JSDoc no código seguem o estilo em inglês dos arquivos vizinhos.

## Visão geral

- `password` continua sendo a única senha de selagem.
- `extraUnsealPasswords` é uma lista opcional de senhas que só abrem sessões, tentadas em ordem depois de `password`.
- Quando uma sessão lida de cookie abre com uma senha extra, ela é resselada com `password` na mesma leitura, usando o mecanismo que já existe para `legacySeal`.
- Nada muda no formato do selo nem em `src/utils/internal/iron-crypto.ts`.

---

## Decisões de arquitetura

### D-01 — A tentativa de senhas fica dentro de `unsealSession`

**Contexto.** Hoje `unsealSession` chama `unseal(sealed, config.password, ...)` uma vez (`src/utils/session.ts:322-325`). Precisamos tentar uma lista de senhas.

**Alternativas consideradas.**

1. Passar ao `unseal` do iron um objeto `PasswordHash` (`Record<id, password>`) e usar o `passwordId` do selo para escolher a senha. Isso exigiria gravar um id no selo ao selar. Muda o formato do cookie, o que está fora de escopo (PRD, "Fora de escopo").
2. Repetir a tentativa em `getSession`. Isso duplicaria a lógica de expiração (`maxAge`/`idleTimeout`) e de fallback legado, que hoje vive em `unsealSession`.
3. Fazer um laço sobre as senhas dentro de `unsealSession`, chamando um helper interno por senha.

**Escolha: 3.** A premissa do PRD foi conferida: com senha `string`, o `unseal` ignora o `passwordId` e apenas verifica o HMAC (`src/utils/internal/iron-crypto.ts:120-128`). Por isso, tentar senhas em sequência funciona sem tocar no formato do selo. Só `unsealSession` muda, e a assinatura pública não muda.

### D-02 — Fallback legado é aplicado por senha, antes de passar para a próxima

**Contexto.** O fallback de 1 iteração PBKDF2 (`src/utils/session.ts:326-347`) precisa valer também para as senhas extras (RF-06).

**Alternativas consideradas.**

1. Tentar todas as senhas com as iterações atuais e só depois todas com a iteração legada.
2. Para cada senha, tentar as iterações atuais, depois a legada (se permitida), e só então passar para a próxima.

**Escolha: 2.** Ela respeita a ordem declarada (RF-03) e mantém o fallback por senha no mesmo lugar do código atual.

**Correção ao risco do PRD.** O PRD (`sdd/prd.md`, "Riscos") diz que o fallback "dobra" o número de tentativas no pior caso. Isso superestima o custo. Um `unseal` com senha errada falha no HMAC, e a verificação do HMAC deriva uma chave PBKDF2 com `integrity.iterations` (8192 por padrão, `src/utils/internal/iron-crypto.ts:21` e `:27`). A tentativa legada usa 1 iteração, então custa cerca de 1/8192 de uma tentativa normal. O custo real é de **N+1 derivações completas por cookie inválido**, com N senhas extras, e não o dobro.

### D-03 — Tratamento de erros: o primário mantém o comportamento atual; as extras não interrompem a lista

**Contexto.** `unseal` lança erros de natureza diferente. Alguns não dependem da senha: `Wrong mac prefix`, `Expired seal`, `Invalid expiration` (`src/utils/internal/iron-crypto.ts:106-117`). Outros dependem dela: `Bad hmac value` (`:135-137`). Também há erros de configuração: `Empty password` (`:94-96`) e `Password string too short` (`:192-196`). Os dois últimos são lançados antes da verificação do HMAC.

**Alternativas consideradas.**

1. Qualquer erro interrompe a lista e é propagado. Uma entrada vazia ou curta em `extraUnsealPasswords` impediria a tentativa das senhas seguintes.
2. Qualquer erro em uma senha extra só significa "tente a próxima".

**Escolha.**

- Para `password` (primário), a semântica atual é mantida: se o erro não for `Bad hmac value`, ele é propagado imediatamente, sem tentar as extras. Isso evita CPU gasta e preserva o erro que quem chama `unsealSession` recebe hoje.
- Para cada senha extra, qualquer erro significa "não abre com esta, tente a próxima".
- Se nenhuma senha abrir, o erro lançado é o da tentativa com `password`. Assim, sem extras, o erro é exatamente o de hoje (RF-04).

### D-04 — Uma única flag interna marca "selado de forma diferente da atual"

**Contexto.** Hoje `getSession` reselagem quando o cookie foi aberto pelo fallback legado, via o símbolo `kLegacySeal` (`src/utils/internal/session.ts:7-9`, usado em `src/utils/session.ts:199-201` e `:346`). Precisamos reselar também quando a senha foi uma extra (RF-05).

**Alternativas consideradas.**

1. Criar um segundo símbolo, `kExtraUnsealSeal`, e uma segunda condição em `getSession`.
2. Reutilizar `kLegacySeal` para as senhas extras. O nome ficaria enganoso.
3. Renomear `kLegacySeal` para `kStaleSeal`, com o significado "selado com opções ou senha diferentes das atuais", e usá-lo para os dois casos.

**Escolha: 3.** Uma flag só, uma condição só em `getSession`. O símbolo é interno (`src/utils/internal/session.ts`) e não é exportado por `src/index.ts`, então a renomeação não altera a API pública. A flag precisa continuar sendo apagada antes de `Object.assign(session, unsealed)`, como já acontece hoje em `src/utils/session.ts:201`, porque `Object.assign` copia símbolos próprios.

### D-05 — Forma da configuração: campo novo, `string[]`, sem validação em tempo de execução

**Contexto.** O pedido exige o campo `extraUnsealPasswords: string[]` e nenhum outro nome público novo.

**Alternativas consideradas.**

1. `password: string | string[]` (segunda alternativa da issue). Fora de escopo.
2. `passwords: { current, previous }`. Introduz outro nome público e quebra `password`.
3. `extraUnsealPasswords?: string[]`, logo após `password`.

**Escolha: 3.** Não há validação extra no tempo de execução. Uma entrada curta ou vazia é ignorada em silêncio (D-03), o que é aceitável porque a configuração não é alterada. O JSDoc deve dizer que cada entrada precisa de no mínimo 32 caracteres, como `password` (`src/utils/internal/iron-crypto.ts:22` e `:28`).

### D-06 — Sessões lidas do header não são resseladas

**Contexto.** `getSession` só reselagem sessões lidas de cookie: `sessionFromCookie` (`src/utils/session.ts:189-193` e `:214`). Sessões do header `x-{name}-session` não podem ser resseladas, porque a resposta não tem como devolvê-las.

**Escolha.** Manter esse comportamento. Uma sessão que chega pelo header e foi selada com senha extra continua abrindo com a senha extra até expirar. O PRD já pede que isso fique explícito na documentação (`sdd/prd.md`, "Riscos"). A documentação entra em `docs/4.examples/handle-session.md`, na seção de `idleTimeout` (linhas 156-183), onde a regra de header já existe (linha 180).

---

## Contratos e assinaturas

### Configuração pública — `src/utils/session.ts`

```ts
export interface SessionConfig {
  /**
   * Private key used to seal session tokens. ... (texto atual, sem alteração)
   */
  password: string;
  /**
   * Previous passwords that can only open sessions sealed before a rotation.
   *
   * They are tried in the declared order after `password`, and each one that
   * opens a session causes that session to be resealed with `password` on the
   * same read. They are never used to seal. Remove an entry once every session
   * sealed with it has expired (`maxAge`, or `idleTimeout` for sessions that
   * slide), since until then it keeps opening sessions and widens the exposure
   * of an old secret. Each entry must be at least 32 characters, like `password`.
   *
   * Sessions read from the `sessionHeader` are not resealed, so they keep
   * opening with an extra password until they expire.
   */
  extraUnsealPasswords?: string[];
  maxAge?: number;
  // ... demais campos sem alteração
}
```

Tipos resultantes (RF-01): `SessionConfig["password"]` continua `string`; `SessionConfig["extraUnsealPasswords"]` é `string[] | undefined`.

### Função interna nova — `src/utils/session.ts`

```ts
/**
 * Unseal with one password, falling back to the legacy 1-iteration seal when
 * allowed. Throws the error of the last attempt.
 */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>>;
```

### Função pública — inalterada

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

`unsealSession` continua exportada por `src/index.ts:209`. O único efeito visível para quem a chama é o símbolo `kStaleSeal` a mais no objeto retornado, o que já acontece hoje com `kLegacySeal`.

### Símbolo interno — `src/utils/internal/session.ts`

```ts
// substitui kLegacySeal (src/utils/internal/session.ts:7-9)
export const kStaleSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.stale-seal",
);
```

### Corpo de `unsealSession` (pseudocódigo do contrato)

```ts
export async function unsealSession(_event, config, sealed) {
  const sealOptions: SealOptions = {
    ...sealDefaults,
    ttl: (config.maxAge || config.idleTimeout || 0) * 1000,
    ...config.seal,
  };
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let unsealed: Partial<Session> | undefined;
  let primaryError: unknown;
  for (const [index, password] of passwords.entries()) {
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback);
    } catch (error) {
      if (index === 0) {
        // Password-independent failures (wrong prefix, expired seal) stop here, as today
        if (!isBadHmac(error)) throw error;
        primaryError = error;
      }
      continue;
    }
    if (index > 0) (unsealed as any)[kStaleSeal] = true;
    break;
  }
  if (!unsealed) throw primaryError;
  // maxAge / idleTimeout checks: sem alteração (src/utils/session.ts:349-365)
  return unsealed;
}
```

`isBadHmac(error)` é o teste que já existe em `src/utils/session.ts:335-336`, reescrito como função pequena (`error instanceof Error && error.message === "Bad hmac value"`).

### Mudança em `getSession` — `src/utils/session.ts:199-216`

```ts
const staleSeal = unsealed && (unsealed as any)[kStaleSeal];
if (staleSeal) {
  delete (unsealed as any)[kStaleSeal];
}
// ...
// Proactively reseal cookies sealed with legacy options or an extra password,
// and reseal under idleTimeout to slide the window (see `shouldSlide`). ...
if (session.id && sessionFromCookie && (staleSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

Nenhuma outra função muda: `sealSession` (`src/utils/session.ts:282-307`) já sela com `config.password` (linha 300), e `updateSession` (`:241-277`) já chama `sealSession`. Por isso a migração do RF-05 reaproveita esse caminho.

---

## Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:48` | Adicionar `extraUnsealPasswords?: string[]` com JSDoc logo após `password` (RF-01, RF-07). |
| `src/utils/session.ts` | `:5` | Trocar o import de `kLegacySeal` por `kStaleSeal`. |
| `src/utils/session.ts` | `:199-201`, `:214-216` | Renomear a flag e incluí-la na condição de reselagem (D-04). |
| `src/utils/session.ts` | `:312-367` | Laço sobre as senhas e helper `unsealWithPassword`, como no contrato acima (D-01 a D-03). A checagem de expiração (`:349-365`) continua depois do laço. |
| `src/utils/session.ts` | `:9` | Já existe `import type { SealOptions }`; usar no tipo de `sealOptions`. |
| `src/utils/internal/session.ts` | `:7-9` | Renomear `kLegacySeal` para `kStaleSeal` (D-04). |
| `test/session.test.ts` | após `:186` | Novos casos de teste (ver "Estratégia de testes"). |
| `test/unit/types.test-d.ts` | — | Teste de tipo para `extraUnsealPasswords` (RF-01). Seguir o padrão que o arquivo já usa. Não li o conteúdo dele. |
| `docs/4.examples/handle-session.md` | `:37` e `:180` | Nota sobre `extraUnsealPasswords`: ordem, finalidade, remoção após a janela, e a regra das sessões de header. |

Não alterar: `src/utils/internal/iron-crypto.ts` (fora de escopo), `src/index.ts` (o campo entra por `SessionConfig`, que já é exportado em `src/index.ts:203`), `sealSession`, `updateSession`, `useSession`, `getSession` além do bloco de `:199-216`.

---

## Estratégia de testes

Seguir o AGENTS.md: escrever primeiro os testes que falham e só depois mudar a implementação. Os testes de sessão ficam em `describeMatrix`, então rodam em `web` e `node`.

Configuração de apoio em `test/session.test.ts` (ao lado de `sessionConfig`, `:19-23`):

- `oldPassword` e `newPassword`, ambas com 49 caracteres, como a senha de teste existente.
- Cookie de teste sealed com `oldPassword` via `seal(...)` de `src/utils/internal/iron-crypto.ts`, como o teste de legado já faz (`test/session.test.ts:134-143`).

| Caso | Requisito | Verificação |
| --- | --- | --- |
| Abre cookie selado com senha extra | RF-03 | `getSession` com `password: new`, `extraUnsealPasswords: [old]` devolve o mesmo `id` e `data`. |
| Migra para `password` na mesma leitura | RF-05 | A resposta tem um `Set-Cookie` novo. Esse cookie não abre com `old` (`unseal` lança), abre com `new` e recupera o mesmo `id`. Depois, uma leitura só com `password: new` recupera a sessão. |
| Selagem só com `password` | RF-02 | Após `updateSession`, o cookie abre com `new` e não abre com `old` isolada. |
| Senha desconhecida falha como hoje | RF-03 (falha) | Cookie selado com terceira senha: `id` novo e `data` vazio. |
| Ordem e entradas ruins | RF-03, D-03 | `[wrong, old]` abre; `["", old]` abre; `["curta", old]` abre. Cada caso fica em um `it` separado. |
| Fallback legado com extra | RF-06 | Cookie de 1 iteração com `old`: com `legacySealFallback: false` é rejeitado; com o padrão é aberto e resselado. |
| Sessão de header não migra | D-06 | Cookie-free request com `x-h3-test-session` e senha extra: abre, e a resposta não tem `Set-Cookie`. |
| Compatibilidade | RF-04 | `pnpm vitest run test/session.test.ts` passa sem alteração nas expectativas atuais. |
| Tipo | RF-01 | `expectTypeOf` para `extraUnsealPasswords` (`string[] | undefined`) e para `password` (`string`). |

Comandos:

```bash
pnpm vitest run test/session.test.ts    # casos novos e existentes
pnpm vitest run test/unit/              # testes de tipo e unidade
pnpm lint                               # oxlint + oxfmt --check + typecheck
pnpm test                               # suíte completa, antes de concluir
```

Não há benchmark nesta entrega (fora de escopo, `sdd/prd.md`). O custo de N+1 derivações é descrito em D-02 e nos riscos.

---

## Riscos

1. **CPU em cookies inválidos.** Um cookie que não abre com nenhuma senha custa N+1 derivações PBKDF2 de 8192 iterações, com N extras. Um atacante que mande cookies com o formato correto e HMAC errado força esse custo em cada requisição. Mitigação: a documentação pede listas curtas e remoção após a janela; não há limite no código. Se isso virar problema, a próxima etapa é um limite de quantidade validado na criação.
2. **Sessões de header não migram.** Elas continuam abrindo com a senha antiga até expirar. Mitigação: documentação (D-06).
3. **Sessões sem expiração.** Sem `maxAge` nem `idleTimeout`, uma senha extra aceita sessões indefinidamente. Mitigação: JSDoc e documentação (RF-07).
4. **Typo em uma senha extra.** Falha em silêncio: os usuários daquela senha são deslogados sem erro no log. Mitigação: a documentação recomenda conferir a lista após a rotação. Não adicionamos log, para não criar um novo canal de saída.
5. **Remoção de uma senha antiga antes da hora.** Quem ainda tem cookie com ela é deslogado. Esse é o comportamento esperado, e a documentação diz quando remover.
6. **Renomeação `kLegacySeal` → `kStaleSeal`.** Símbolo interno, não exportado. Risco baixo, mas o `grep` precisa cobrir `src/` e `test/` antes do commit. Hoje as ocorrências estão em `src/utils/session.ts:5`, `:199`, `:201`, `:346` e `src/utils/internal/session.ts:7`.
7. **Erro de `unsealSession` para quem chama diretamente.** Para configurações sem extras, o erro lançado é o mesmo de hoje (D-03). Com extras, o erro lançado quando nenhuma senha abre é o do primário, o que também preserva a forma do erro.
8. **Validação de tamanho em extras.** Uma entrada com menos de 32 caracteres nunca abre cookies e não gera erro (D-05). Está coberta pelo teste de entrada curta, mas não é corrigida em tempo de execução.

---

## Ordem de implementação

1. Escrever os testes novos em `test/session.test.ts` e o teste de tipo. Confirmar que falham.
2. Renomear `kLegacySeal` para `kStaleSeal` em `src/utils/internal/session.ts` e nos usos de `src/utils/session.ts`. Rodar `test/session.test.ts`: tudo deve continuar passando, porque é só renomeação.
3. Adicionar o campo em `SessionConfig` com JSDoc.
4. Implementar `unsealWithPassword`, o laço em `unsealSession` e a condição em `getSession`.
5. Rodar os testes novos até passarem, depois `pnpm lint` e `pnpm test`.
6. Atualizar `docs/4.examples/handle-session.md`.
