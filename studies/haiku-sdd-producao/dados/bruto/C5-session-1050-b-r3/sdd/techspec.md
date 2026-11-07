# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-08). Esta spec define como implementar o campo `extraUnsealPasswords` em `SessionConfig`. Todas as citações `arquivo:linha` foram conferidas no código atual da branch `master`.

## Resumo

A mudança fica concentrada em `src/utils/session.ts`. `unsealSession` passa a tentar a senha atual e, se ela não abrir o cookie, cada senha extra, nessa ordem. A checagem de expiração continua depois da abertura, como hoje. `sealSession`, `updateSession` e `getSession` não mudam: como selam sempre com `config.password`, a migração acontece sozinha quando a sessão é reescrita ou deslizada (RF-03, RF-06). Não há mudança em `src/utils/internal/iron-crypto.ts` nem nos entries.

## Premissas verificadas no código

- **A validação de tamanho já existe, mas roda só no uso.** `generateKey` rejeita senha string com menos de `minPasswordlength` caracteres (`src/utils/internal/iron-crypto.ts:191-196`). O padrão é 32 (`iron-crypto.ts:22` e `:28`, documentado em `:380`). Não há um ponto de inicialização onde validar: `SessionConfig` é passado a cada chamada de `useSession`/`getSession`.
- **Erros de abertura são engolidos.** `getSession` faz `unsealSession(...).catch(() => {})` (`src/utils/session.ts:196-197`). Uma senha extra inválida, ou um cookie que não abre, vira sessão nova sem aviso. Isso é o comportamento atual e continua assim.
- **A ordem de validação do iron favorece o custo baixo.** `unseal` checa prefixo, número de componentes e expiração do seal antes de qualquer derivação (`iron-crypto.ts:98-118`). O HMAC, que custa uma derivação PBKDF2 completa, vem depois (`iron-crypto.ts:133-137`). Logo, uma senha extra tentada só custa PBKDF2 quando o seal tem formato válido e não expirou.
- **O fallback legado usa 1 iteração, não o dobro.** Quando o HMAC falha com as iterações padrão, `unsealSession` tenta de novo com 1 iteração (`src/utils/session.ts:332-344`). Essa segunda tentativa é barata. Isso corrige o PRD, que fala em "o dobro" de custo: para um cookie que não abre com nenhuma senha, o custo é de cerca de `1 + N` derivações completas, mais `1 + N` derivações de 1 iteração.
- **Os exemplos do PRD não são válidos como senha.** `"senha-nova"` e `"senha-antiga"` têm menos de 32 caracteres. Com elas, `seal` lança erro e o teste de RF-02 passaria por motivos errados. Os testes desta spec devem usar senhas de pelo menos 32 caracteres (a senha dos testes atuais, `test/session.test.ts:23`, tem 51).
- **Divergência no script de lint.** `AGENTS.md` diz que `pnpm lint` inclui o typecheck, mas `package.json:46` define `lint` como `oxlint . && oxfmt --check .`, e o typecheck é `tsc --noEmit` em `package.json:54`. A verificação deve rodar `pnpm lint` e `pnpm typecheck` separadamente, como o PRD pede.

---

## Decisões de arquitetura

### D-01 — Onde fica a tentativa com várias senhas

**Escolha:** dentro de `unsealSession` (`src/utils/session.ts:312`), por um helper interno que envolve a abertura com uma senha.

**Alternativas consideradas:**

1. **Laço em `getSession`.** Rejeitada. `unsealSession` é exportada (`src/index.ts:209`) e é o único ponto que sabe das opções de seal. Além disso, a checagem de expiração (RF-05) precisa acontecer em `unsealSession`.
2. **Aceitar array em `iron-crypto.ts` `unseal`.** Rejeitada. O PRD proíbe mudanças nesse módulo, e a mudança exigiria escrever um id de senha no cookie, alterando o formato de todos os cookies.
3. **Usar o mecanismo de ids do iron (`Password` como registro, `iron-crypto.ts:89`, `:124-125`).** Rejeitada pelo mesmo motivo da alternativa 2: o id é gravado no seal (`iron-crypto.ts:68-70`, `:310`), então o formato do cookie mudaria.

**Justificativa:** é a menor mudança que preserva o formato dos cookies, mantém a expiração no mesmo lugar e não toca no módulo criptográfico.

### D-02 — Ordem de tentativa e erro devolvido

**Escolha:** tentar `config.password` com a lógica atual (inclusive o fallback legado, por senha). Se nenhuma senha abrir, lançar o erro da **senha atual**, não o da última tentativa.

**Alternativas consideradas:**

1. **Lançar o último erro.** Rejeitada. Com uma lista vazia, o erro mudaria de forma sutil, o que quebra RF-04.
2. **Tentar só em `"Bad hmac value"`.** Rejeitada. Os outros erros de formato e expiração ocorrem antes de qualquer derivação (ver premissas), então tentar as extras nesses casos custa quase nada. Filtrar por mensagem acoplaria o código a textos de erro do iron, sem ganho real de desempenho.

**Justificativa:** com lista vazia, o laço tem uma iteração e lança exatamente o erro de hoje, o que garante RF-04 por construção. O fallback legado fica dentro da tentativa de cada senha, como o PRD exige (premissa 3).

### D-03 — Representação das senhas extras

**Escolha:** `extraUnsealPasswords?: string[]` em `SessionConfig` (`src/utils/session.ts:39`). Nenhum outro nome público.

**Alternativas consideradas:** `password: string | string[]` (segunda alternativa da issue). Rejeitada: o PRD a coloca fora de escopo, e mudaria o tipo de `SessionConfig.password`, que todo chamador de `useSession`/`getSession` usa. O campo novo mantém `password` como `string` e não exige mudança em código existente.

### D-04 — Tratamento de senhas extras inválidas

**Escolha:** ignorar em silêncio entradas vazias, duplicadas ou iguais à senha atual. Entradas curtas demais não são filtradas explicitamente: o próprio iron as rejeita (`iron-crypto.ts:191-196`), e o laço trata o erro como "essa senha não abriu".

**Alternativas consideradas:**

1. **Lançar erro em `unsealSession` para entradas inválidas.** Rejeitada. O erro seria engolido por `getSession` (`session.ts:197`), então não aparece para o operador. Também faria a senha atual deixar de funcionar por causa de uma extra mal configurada.
2. **Validar na inicialização.** Não é possível, pelo motivo da premissa 1.
3. **Avisar com `console.warn`.** Não há precedente de log no caminho de sessão. Fica como pergunta aberta para o usuário (ver "Decisões a confirmar").

**Justificativa:** uma extra inválida nunca abre sessão alguma, porque nenhuma sessão pode ter sido selada com ela. Ignorá-la não altera o comportamento de nenhum cookie válido, e a deduplicação evita derivações repetidas.

### D-05 — Selagem e resselagem sem mudança

**Escolha:** nenhuma alteração em `sealSession` (`src/utils/session.ts:282`, com `seal` em `:300-304`), `updateSession` (`:241`) ou na lógica de reselagem de `getSession` (`:214-216`).

**Justificativa:** `sealSession` já usa `config.password` (RF-03). Como o cookie aberto com extra só é resselado por esses caminhos, RF-06 vale sem código novo. A condição de `getSession` não deve forçar reselagem ao abrir com extra. Isso já é verdade: a condição só dispara para fallback legado ou deslizamento de `idleTimeout`.

### D-06 — Expiração depois da abertura, fora do laço

**Escolha:** o laço devolve o `unsealed` já aberto, e as checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam no corpo de `unsealSession`, sem alteração.

**Alternativa rejeitada:** checar expiração dentro do laço. Uma sessão expirada aberta pela senha atual lançaria `Session expired!`, e o laço continuaria, derivando de novo com cada extra. Isso desperdiça PBKDF2 e não muda o resultado (RF-05).

### D-07 — Limite do tamanho da lista

**Escolha:** nenhum teto no código. A lista é documentada como curta, e o custo por requisição é documentado no JSDoc.

**Alternativa considerada:** um limite fixo, como 4 extras, com erro se passar. Fica como pergunta aberta: impõe um valor que o PRD não definiu.

### D-08 — Localização dos helpers

**Escolha:** os helpers ficam no fim de `src/utils/session.ts`, junto de `shouldSlide` (`:414`) e `sessionExpires` (`:455`), seguindo `AGENTS.md`, que manda pôr helpers internos no fim do arquivo.

**Alternativa considerada:** mover para um novo `src/utils/internal/session-unseal.ts`. Seria melhor para o limite de 200 linhas do `AGENTS.md`, mas `session.ts` já tem 464 linhas e a mudança é pequena. Pode ser feita depois, separadamente.

### D-09 — Documentação

**Escolha:**

- JSDoc de `extraUnsealPasswords` em `src/utils/session.ts:39-99`, com o custo e a exigência de expiração.
- Uma seção de rotação em `docs/4.examples/handle-session.md`, após as opções (`:122-141`) e junto de "Expiration" (`:151-156`). Deve dizer o procedimento e os riscos da seção seguinte.

---

## Arquivos a alterar

| Arquivo | Trecho atual | Mudança |
|---|---|---|
| `src/utils/session.ts` | `SessionConfig.password` em `:48`; `SessionConfig` até `:99` | Adicionar `extraUnsealPasswords?: string[]` com JSDoc. |
| `src/utils/session.ts` | `unsealSession` em `:312-367`; bloco de `unseal` e fallback em `:323-348` | Trocar a chamada direta por `unsealWithPasswords`. O corpo da tentativa com uma senha vira `unsealWithPassword`. Expiração em `:350-365` fica igual. |
| `src/utils/session.ts` | Fim do arquivo, após `sessionExpires` em `:455-464` | Acrescentar `unsealWithPasswords`, `unsealWithPassword` e `extraPasswords`. |
| `test/session.test.ts` | Bloco `describeMatrix` em `:15`; testes de legado em `:134-186`; teste de tempo com `vi.useFakeTimers` em `:189-190`; `lazy creation` em `:692` | Novo `describe("extraUnsealPasswords")`, dentro do `describeMatrix`. |
| `test/bench/session.ts` | Benchmark com uma senha em `:10` e `:20` | Acrescentar um caso com lista de 3 extras e um caso de cookie inválido, para medir o custo (RF-05, premissa do PRD). |
| `docs/4.examples/handle-session.md` | Aviso de senha em `:36-43`; opções em `:122-141`; expiração em `:151-156` | Seção de rotação de senhas. |

**Não alterar:** `src/utils/internal/iron-crypto.ts`, `src/_entries/*`, `src/index.ts` (`SessionConfig` já é exportado em `:203`, e não há nome novo a exportar), `src/utils/auth.ts`.

---

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (acrescentar após `password`, linha 48)
export interface SessionConfig {
  /** ...sem alteração... */
  password: string;
  /**
   * Previous passwords, used only to open sessions sealed before a rotation.
   * `password` is still the one used to seal. Each entry must satisfy the same
   * rules as `password` (at least `seal.minPasswordlength` characters); invalid,
   * empty, or duplicate entries are ignored. Keep the list short: every extra
   * costs one more PBKDF2 derivation per request carrying an unopenable cookie.
   * Remove an entry only after every session sealed with it has reached `maxAge`
   * or `idleTimeout` (or has been resealed), or those sessions are signed out.
   */
  extraUnsealPasswords?: string[];
  // ...restante inalterado...
}

// src/utils/session.ts — unsealSession (contrato público: sem mudança de assinatura)
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

// Internos (no fim de src/utils/session.ts, não exportados)

/** Tenta `config.password` e depois cada senha extra. Lança o erro da senha atual se nenhuma abrir. */
async function unsealWithPasswords(
  sealed: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;

/** Uma senha, com o fallback de seal legado (corpo atual de `session.ts:323-348`). Marca `kLegacySeal` quando usa o fallback. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean | undefined,
): Promise<Partial<Session>>;

/** Senhas extras válidas: sem vazias, sem duplicadas, sem a senha atual. */
function extraPasswords(config: SessionConfig): string[];
```

Esboço de implementação, para guiar o código (não é a versão final):

```ts
async function unsealWithPasswords(sealed, config, sealOptions) {
  let firstError: unknown;
  for (const password of [config.password, ...extraPasswords(config)]) {
    try {
      return await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback);
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}

function extraPasswords(config) {
  const extra = new Set(config.extraUnsealPasswords ?? []);
  extra.delete(config.password);
  return [...extra].filter(Boolean);
}
```

Observações sobre o contrato:

- `unsealWithPassword` recebe `legacySealFallback` em vez do `config` inteiro, para não depender do resto da configuração. A lógica legada usa `config.legacySealFallback === false` (`session.ts:333`), então o valor passado é o mesmo.
- O marcador `kLegacySeal` (`src/utils/internal/session.ts:7`) continua sendo gravado no objeto aberto, então `getSession` (`session.ts:199-201`) reseleva sem mudança.
- `SealOptions` já está importado como tipo em `src/utils/session.ts:9`.

---

## Estratégia de testes

Seguir `AGENTS.md`: reproduzir antes de mudar o código, quando aplicável. Como é uma funcionalidade nova, os testes de RF-02 a RF-07 devem falhar antes da implementação.

**Testes em `test/session.test.ts`, dentro de `describeMatrix`** (rodam em `web` e `node`). Usar senhas de 32+ caracteres, e gerar cookies com `seal` de `src/utils/internal/iron-crypto.ts`, como o teste de legado (`test/session.test.ts:134-143`).

| Teste | Requisito | Como |
|---|---|---|
| Abre sessão selada com senha anterior | RF-02 | Selar com `OLD`, configurar `password: NEW`, `extraUnsealPasswords: [OLD]`. Esperar `id`, `createdAt` e `data` originais. |
| Selagem nunca usa extra | RF-03 | `sealSession` com a config; `unseal` com `NEW` funciona, com `OLD` falha. |
| Sem extras, cookie de outra senha vira sessão nova | RF-04 | Novo teste: cookie selado com outra senha, sem `extraUnsealPasswords`, deve gerar id novo. Usar `legacySealFallback: false` como em `:161-186` para isolar o caso. |
| Expirada mesmo com senha extra | RF-05 | Usar `vi.useFakeTimers({ toFake: ["Date"], now })` como em `:189-190`. Chamar `unsealSession` diretamente e esperar `Session expired!`. Passar `undefined as any` como evento, já que `_event` não é usado. |
| Resselagem com `updateSession` usa `NEW` | RF-06 | Após abrir com `OLD`, chamar `update`; o `Set-Cookie` abre com `NEW` e não com `OLD`. |
| Header `x-h3-test-session` | RF-07 | Enviar o cookie no header (o nome padrão para `name: "h3-test"` é `x-h3-test-session`). Esperar sessão carregada e nenhum `Set-Cookie`. |
| Legado com senha extra | Premissa 3 | Selar com `OLD` e 1 iteração; abrir com `extraUnsealPasswords: [OLD]`; esperar sessão e reselagem com `NEW`. Este é o teste que cobre o fallback por senha. |
| Extras inválidas são ignoradas | D-04 | Lista com `""`, a própria `NEW` e uma string de 10 caracteres. Cookie selado com `NEW` continua abrindo. |
| Senha atual tem prioridade | D-02 | Cookie selado com `NEW`, com `OLD` também na lista: sessão carregada com os dados corretos e cookie resselado com `NEW`. Só observa o resultado; a ordem em si não é visível por teste de comportamento (ver riscos). |

**Testes de tipo:** conferir se o `tsconfig` inclui `test/` (não verificado nesta spec). Se incluir, `expectTypeOf<SessionConfig["extraUnsealPasswords"]>()` cobre RF-01. Se não, a verificação de RF-01 fica como `pnpm typecheck` sobre a própria mudança em `src/`.

**Benchmark:** acrescentar em `test/bench/session.ts` um caso com 3 extras e um cookie que não abre com nenhuma. Não rodar como parte dos testes. Usar para medir a média antes e depois, conforme o PRD.

**Verificação final:**

```bash
pnpm vitest run test/session.test.ts    # RF-08
pnpm vitest run test/unit/              # regressão de unidades
pnpm lint                               # oxlint + oxfmt --check
pnpm typecheck                          # tsc --noEmit
pnpm test                               # suíte completa, se o tempo permitir
```

---

## Riscos

1. **Custo de CPU amplificado por cookie inválido.** Um cookie com formato válido e HMAC errado custa `1 + N` derivações PBKDF2 completas por requisição. Como o PRD diz, isso pode virar vetor de negação de serviço com listas longas. Mitigação: documentação (D-07) e o benchmark. Corrigindo o PRD: o fallback legado não dobra o custo, pois usa 1 iteração (ver premissas).
2. **Rotação sem fim quando a sessão não tem `maxAge` nem `idleTimeout`.** Sem esses limites, o seal não expira (`ttl` vale 0, `session.ts:302` e `:319`), e a sessão só é resselada se alguém escrever nela. Uma sessão nunca reescrita fica válida com a senha antiga para sempre, e o operador não consegue remover a senha antiga sem derrubá-la. Esse risco não aparece no PRD. Mitigação: o procedimento na documentação deve exigir `maxAge` ou `idleTimeout`. Decisão a confirmar: rejeitar a combinação em código, o que seria uma validação nova.
3. **Falha silenciosa.** `getSession` engole todo erro de abertura (`session.ts:197`). Uma extra curta demais, ou digitada errada, não gera nenhum sinal: os usuários só percebem quando são deslogados. Mitigação: documentação e o teste de D-04. Aviso em log é pergunta aberta.
4. **Senha antiga comprometida continua válida** enquanto estiver na lista (PRD, riscos). Só a documentação pode tratar isso.
5. **Remoção prematura** derruba sessões não resseladas (PRD). A documentação deve dizer para manter a senha antiga até todas as sessões terem passado do `maxAge` ou `idleTimeout`, ou terem sido escritas.
6. **Ordem de tentativa não observável por teste de comportamento.** O teste de D-02 só confirma o resultado, não quantas derivações ocorreram. A ordem deve ser checada com o benchmark, ou com um espião sobre `unseal` se o projeto já usar esse padrão (não verificado).
7. **Arquivo passa de 500 linhas.** Ver D-08. Não afeta o comportamento.

---

## Decisões a confirmar

1. **Entradas inválidas:** ignorar em silêncio (D-04, recomendado) ou avisar com log?
2. **Teto de tamanho da lista:** sem teto, só documentação (D-07, recomendado), ou um limite fixo?
3. **Rotação sem `maxAge` nem `idleTimeout`:** só documentar (recomendado, por ser o menor escopo) ou rejeitar na abertura da sessão?
