# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Referências: `sdd/pedido.md` (contrato enxuto #1050-b) e `sdd/prd.md` (RF-01 a RF-07, premissas P1–P5, riscos R1–R4).

Resumo: `SessionConfig` ganha `extraUnsealPasswords?: string[]`. A leitura de sessão (`unsealSession`) tenta `password` e depois cada extra, na ordem declarada. A escrita continua usando só `password`. Nenhuma função pública nova é criada.

---

## Decisões de arquitetura

### D-01 — Campo opcional `extraUnsealPasswords` em `SessionConfig`

**Escolha.** Adicionar `extraUnsealPasswords?: string[]` a `SessionConfig`, com JSDoc dizendo que essas senhas só abrem sessões. `password` continua `string` e continua sendo a única senha usada por `sealSession`.

**Alternativas.**
- *`password: string | string[]`, primeira para selar e as demais para abrir* (segunda alternativa da issue). Rejeitada: muda o tipo de `password`, quebra quem lê o campo como string (P5 do PRD) e torna implícita a regra de qual senha sela.
- *Função pública nova* (`rotatePassword()`, tipo `SessionPasswords`). Rejeitada pelo pedido: "nenhum outro nome público novo".

**Justificativa.** O campo é opcional, aditivo e não toca no tipo existente. Sem o campo, `[config.password]` é o comportamento de hoje.

### D-02 — Ponto único de mudança: `unsealSession`

**Escolha.** Toda a lógica nova fica em `unsealSession` (`src/utils/session.ts:312`). `getSession` chama essa função tanto para o cookie (com chunks, via `getChunkedCookie`) quanto para o header `x-{name}-session`. Assim o RF-07 é coberto sem mudança em `getSession`.

**Alternativas.**
- *Laço em `getSession`, em volta da chamada a `unsealSession`.* Rejeitada: duplica a lógica nos dois caminhos (header e cookie) e espalha o fallback legado.

**Justificativa.** `unsealSession` já concentra o fallback legado (`session.ts:324-347`) e as checagens de expiração (`session.ts:350-365`). A assinatura `(event, config, sealed)` e o retorno não mudam, então `src/index.ts:209` (export público) continua válido.

### D-03 — O laço só avança em `Bad hmac value`

**Escolha.** Dentro do laço, só o erro `Bad hmac value` faz a tentativa passar para a próxima senha. Qualquer outro erro é relançado na hora.

**Alternativas.**
- *Avançar em qualquer erro.* Rejeitada: `Expired seal` (iron-crypto.ts:115-117) não depende da senha, então avançar só repetiria o mesmo erro com mais custo de PBKDF2. Erros de configuração também seriam mascarados.

**Justificativa.** É o mesmo critério que o fallback legado já usa (`session.ts:336`). Mantém o comportamento de hoje quando não há extras: o erro de primeira tentativa é relançado como antes.

### D-04 — Fallback legado pareado por senha

**Escolha.** Para cada senha, tenta primeiro a iteração completa e, se der `Bad hmac value`, tenta a iteração legada (1). Só depois passa para a senha seguinte. Isso segue a redação de RF-06 ("tentado para cada senha, na mesma ordem de RF-02").

**Alternativas.**
- *Todas as senhas com iteração completa, depois todas com a legada.* Custo equivalente no pior caso (N PBKDF2 completos), mas exige dois laços e separa a lógica do fallback do par senha/iteração. Rejeitada por complexidade, sem ganho de CPU.

**Justificativa.** A iteração legada custa uma iteração de PBKDF2, então o custo extra por senha é desprezível. Mantém a lógica do fallback em um helper que trata uma senha por vez.

### D-05 — Validação do tamanho mínimo das extras, na abertura

**Escolha.** Antes do laço, `unsealSession` rejeita qualquer item de `extraUnsealPasswords` com menos caracteres que o mínimo do iron, com a mesma mensagem de `generateKey` (iron-crypto.ts:193-195). O mínimo vem de `sealOptions.integrity.minPasswordlength`, que é 32 por padrão (iron-crypto.ts:28).

**Confirmação da premissa P1.** Procede. `generateKey` lança `Password string too short` para strings abaixo de `options.minPasswordlength` (iron-crypto.ts:191-196). `unseal` chama `hmacWithPassword` (iron-crypto.ts:133), que chama `generateKey`. Logo, uma extra curta lança erro ao ser usada. Esse erro não é `Bad hmac value`, então pelo D-03 interromperia o laço antes da senha certa, se ela viesse depois. A validação antecipada torna o problema explícito e evita que ele dependa da posição na lista.

**Alternativas.**
- *Pular silenciosamente extras curtas.* Rejeitada: esconde erro de configuração.
- *Deixar o iron lançar.* Rejeitada pelo motivo acima (depende da ordem).

**Consequência.** Uma extra curta faz toda leitura de sessão falhar, e `getSession` engole o erro (session.ts:197). Isso é um risco, tratado em "Riscos" (R-A).

### D-06 — Reseal do `idleTimeout` continua usando `password`

**Escolha.** Não mudar `shouldSlide` (session.ts:414-421) nem o bloco de reseal em `getSession` (session.ts:214). Quando `idleTimeout` está ativo e mais da metade da janela já passou, a leitura de uma sessão aberta por senha extra reselá-la com `password`. Na prática, a sessão migra na leitura, e não só na escrita.

**Conflito com o PRD.** O PRD diz, em "Fora de escopo", que a migração acontece só na gravação. Isso não bate com o `shouldSlide` existente. Não há como manter a regra literal sem bloquear o slide para sessões de senha extra, o que faria essas sessões expirarem mais cedo que as outras.

**Alternativas.**
- *Bloquear o reseal para sessões abertas por extra.* Exige saber, em `getSession`, qual senha abriu o selo. Mais código e expiração antecipada para os usuários da rotação.

**Recomendação.** Manter a escolha e corrigir a redação do PRD. Confirmar com quem pediu antes de implementar.

### D-07 — Escrita e formato do selo sem mudança

**Escolha.** `sealSession` (session.ts:282-307), `seal` e `SealOptions` não mudam. O cookie continua selado com `password`, o formato é o mesmo, e o selo `Fe26.2` não ganha campo novo.

**Justificativa.** RF-01 e a restrição "sem mudança de formato" do PRD se cumprem sem código novo na escrita. Os testes de RF-01 servem como guarda.

---

## Contratos e assinaturas

### `SessionConfig` (`src/utils/session.ts:39`)

```ts
export interface SessionConfig {
  /* ... password, maxAge, idleTimeout, name, cookie, sessionHeader, seal (sem mudança) ... */
  password: string;

  /**
   * Previous passwords still accepted to open existing sessions. They are never
   * used to seal: `password` is the only one that seals. Tried in order after
   * `password`, so keep the list short — each one adds a PBKDF2 attempt to reads
   * of sessions sealed with it. Each must be at least 32 characters.
   *
   * Remove a password once every session sealed with it has expired (`maxAge`
   * or `idleTimeout`), or the old password stays usable for that long.
   */
  extraUnsealPasswords?: string[];

  /* legacySealFallback, crypto, generateId (sem mudança) */
}
```

Inserir o campo logo após `password` (session.ts:48). O JSDoc de `password` (session.ts:40-47) não muda.

### `unsealSession` (assinatura pública, inalterada)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

### Helpers internos (não exportados)

```ts
// Só `Bad hmac value` avança o laço (D-03).
function isBadHmac(error: unknown): boolean;

// Uma senha: iteração completa e, se permitido, a legada (D-04).
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean,
): Promise<Partial<Session>>;
```

`isolatedDeclarations` exige tipo explícito só em exports, então os helpers podem ser não exportados sem anotação extra. `SealOptions` já é importado como tipo em `session.ts:9`.

### Esboço de `unsealSession` (referência, não é o código final)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = {
    ...sealDefaults,
    ttl: (config.maxAge || config.idleTimeout || 0) * 1000,
    ...config.seal,
  };
  const extraUnsealPasswords = config.extraUnsealPasswords || [];
  const minLength = sealOptions.integrity.minPasswordlength;
  for (const password of extraUnsealPasswords) {
    if (password.length < minLength) {
      throw new Error(`Password string too short (min ${minLength} characters required)`);
    }
  }

  let unsealed: Partial<Session> | undefined;
  let firstError: unknown;
  for (const password of [config.password, ...extraUnsealPasswords]) {
    try {
      unsealed = await unsealWithPassword(
        sealed,
        password,
        sealOptions,
        config.legacySealFallback !== false,
      );
      break;
    } catch (error) {
      if (!isBadHmac(error)) {
        throw error;
      }
      firstError ??= error;
    }
  }
  if (!unsealed) {
    throw firstError;
  }

  // maxAge e idleTimeout: sem mudança (session.ts:350-365)
  return unsealed;
}
```

`unsealWithPassword` recebe o corpo atual do `try`/`catch` de `session.ts:323-348` e troca `config.password` pelo parâmetro `password`. A condição de fallback continua a mesma (`legacySealFallback === false`, `iterations === 1`, `Bad hmac value`) e a marca `kLegacySeal` continua sendo aplicada.

---

## Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `src/utils/session.ts` | Campo `extraUnsealPasswords` em `SessionConfig` (linha 48 para inserir). `unsealSession` vira o laço (linhas 312-367). Helpers `isBadHmac` e `unsealWithPassword` ao final do arquivo, junto com os demais helpers (após a linha 464, como em `session.ts:388-464`). |
| `test/session.test.ts` | Novos casos após `session.test.ts:186` (fim de "rejects legacy sessions with legacySealFallback: false"), dentro do `describeMatrix`. |

### Arquivos que não mudam (e por quê)

- `src/utils/internal/iron-crypto.ts` — sem mudança. Só é lido para confirmar P1 (linhas 22, 28, 191-196) e o erro de HMAC (linhas 135-137).
- `src/index.ts:200-214` — nenhum export novo. `SessionConfig` e `unsealSession` já são exportados (linhas 203 e 209).
- `test/unit/package.test.ts:149` — lista de exports. Sem export novo, nada muda.
- `docs/2.utils/4.security.md:60-62` — lista só nomes de funções, sem opções de `SessionConfig`. A documentação do campo fica no JSDoc (`session.ts`).

### Correção de redação no PRD

RF-07 cita o header `x-h3-session`. Esse nome vale para o nome padrão `h3`. O nome real é `x-{name}-session`, em minúsculas (`session.ts:179-182`). O teste usa `name: "h3-test"`, então o header é `x-h3-test-session`.

---

## Estratégia de testes

Seguir `AGENTS.md`: teste de regressão primeiro, `describeMatrix` (web e node), e confirmar que o teste de RF-02 falha antes da implementação.

Os casos novos ficam em `test/session.test.ts`, depois de `session.test.ts:186`. Usar `seal` e `sealDefaults` já importados (`session.test.ts:12`) e a config `sessionConfig` (linhas 21-25) como base.

| Teste (nome sugerido) | Requisito | Verificação |
|---|---|---|
| `opens sessions sealed with an extra password` | RF-02 | Selar com `"antiga"` via `seal(…, sealDefaults)`. Requisição com o cookie e config `password: "nova"`, `extraUnsealPasswords: ["antiga"]`. `session.id`, `createdAt` e `data` iguais aos originais. **Deve falhar antes da mudança** (hoje cria sessão nova). |
| `seals with the current password only` | RF-01 | Mesma config. Chamar `update` em uma requisição e checar que `unseal(cookie, "nova")` abre e `unseal(cookie, "antiga")` lança `Bad hmac value`. Passa antes e depois (guarda). |
| `tries extra passwords in declared order` | RF-02 | Duas extras, a sessão sealed com a segunda. Abre. Teste extra: sessão sealed com `password` abre mesmo com extras erradas listadas antes. |
| `replaces sessions sealed with an unknown password` | RF-04 | Selar com `"desconhecida"`. `getSession` devolve `id` diferente do cookie e não lança. |
| `expires sessions opened by an extra password` | RF-05 | Selar com `"antiga"` e `createdAt` mais antigo que `maxAge`. Sessão nova, sem erro. |
| `unseals legacy sessions sealed with an extra password` | RF-06 | Selar com `"antiga"` e 1 iteração. Com fallback padrão: aberta e resselada com `"nova"` (verificar com `unseal(resealed, "nova", sealDefaults)`). Com `legacySealFallback: false`: sessão nova. |
| `reads extra-password sessions from the session header` | RF-07 | Header `x-h3-test-session` com sessão sealed com `"antiga"`. Sessão original. |
| `keeps the current behavior when extraUnsealPasswords is empty` | RF-03 | `extraUnsealPasswords: []` com cookie sealed com `password`: mesmo resultado do caso sem o campo. A suíte existente cobre o resto. |
| `rejects extra passwords shorter than 32 characters` | D-05 / P1 | `unsealSession({} as HTTPEvent, cfg, sealed)` com extra de 10 caracteres rejeita com `too short`. |

**Ordem de execução.**
1. Escrever os testes de RF-02 e D-05 e rodar `pnpm vitest run test/session.test.ts`. RF-02 precisa falhar.
2. Implementar em `session.ts` (D-01 a D-05).
3. Rodar `pnpm vitest run test/session.test.ts` e confirmar que os casos novos passam e que os existentes continuam verdes (RF-03).
4. Rodar `pnpm vitest run test/unit/` e `pnpm vitest run test/cookies.test.ts` (chunks).
5. `pnpm lint` (`oxlint . && oxfmt --check .`) e `pnpm typecheck` (`tsc --noEmit`).

Nenhum teste existente deve ser alterado. Se algum precisar de ajuste, o motivo tem que ser uma mudança de comportamento intencional, o que este plano não prevê.

---

## Riscos

- **R-A — Erro silencioso de configuração.** `getSession` engole o erro de `unsealSession` (session.ts:197). Uma extra curta, ou uma extra vazia, faz as sessões antigas serem tratadas como novas sem aviso. *Mitigação:* D-05 com teste; documentação do campo. Um log ou hook de erro está fora desta versão.
- **R-B — Migração na leitura com `idleTimeout`.** Ver D-06. O PRD diz que a migração ocorre só na escrita. Com `idleTimeout` ela também ocorre no slide. *Mitigação:* decisão a confirmar; documentar.
- **R-C — Senha antiga ativa por tempo indeterminado (PRD R1).** A sessão não é resselada sem `idleTimeout` ou sem escrita. *Mitigação:* JSDoc do campo (acima) manda remover a senha depois de `maxAge` ou `idleTimeout`.
- **R-D — Custo de CPU (PRD R2 e P4).** Cada extra é uma tentativa de PBKDF2 completa em cada requisição com sessão sealed com ela. Uma sessão aberta pela última extra paga N tentativas. Requisições sem cookie não são afetadas. *Mitigação:* documentação. Limite de tamanho da lista fica fora desta versão.
- **R-E — Regressão no caminho de erro (PRD R4).** Reordenar o `try`/`catch` pode mudar o caso de senha desconhecida ou o fallback legado. *Mitigação:* D-03 mantém o erro relançado quando não há extras; RF-04 e RF-06 têm testes próprios; a suíte existente roda sem mudança.
- **R-F — Vazamento de senha antiga (PRD R3).** Quem tiver a senha antiga abre sessões até ela sair da lista. *Mitigação:* documentação, como em R-C.
- **R-G — Tempo de leitura observável.** O número de tentativas de PBKDF2 revela em que posição da lista a senha foi encontrada. A informação é pouco sensível, porque o atacante ainda precisa do cookie e da senha correta. *Aceito.*
- **R-H — Mínimo de 32 caracteres depende de `seal.integrity.minPasswordlength`.** Se o desenvolvedor sobrescrever `seal`, o mínimo muda para as extras, como já muda para `password`. *Aceito, consistente com o comportamento atual.*

---

## Pontos para confirmar com quem pediu

1. **D-06** — aceitar a migração no slide com `idleTimeout` (recomendado) ou bloquear o reseal para sessões de senha extra.
2. **D-05** — aceitar que uma extra curta invalida as leituras de sessão (recomendado, por ser explícito) ou pular a extra com um aviso.
3. Redação de RF-07 (`x-{name}-session`) e da regra de migração em "Fora de escopo" do PRD.
