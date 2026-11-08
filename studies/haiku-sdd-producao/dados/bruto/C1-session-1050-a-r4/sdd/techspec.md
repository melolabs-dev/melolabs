# Especificação técnica — várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-09), h3js/h3#1050.

Esta spec descreve o trabalho. Nenhum arquivo do projeto foi alterado para escrevê-la. Os números de linha citados foram conferidos no código atual (`master`, commit `a12fb07`).

## 1. Estado atual

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`).
- A senha é usada em exatamente três pontos, confirmando a premissa P1 do PRD:
  - `sealSession` → `seal(session, config.password, …)` (`src/utils/session.ts:300`);
  - `unsealSession` → `unseal(sealed, config.password, sealOptions)` (`src/utils/session.ts:324`);
  - fallback legado → `unseal(sealed, config.password, {…iterations: 1})` (`src/utils/session.ts:340`).
- `getSession` não toca na senha. Ele chama `unsealSession` dentro de `.catch(() => {})` (`src/utils/session.ts:196-197`), então qualquer erro de unseal vira "sessão nova" sem aviso.
- `unseal` escolhe a senha pelo id do selo (`src/utils/internal/iron-crypto.ts:120-128`). Selos feitos com `seal` sem id usam a chave `"default"`. Uma senha de string nunca cai nesse caminho, porque `typeof password === "string"` vem antes (`src/utils/internal/iron-crypto.ts:122-123`).
- Senha errada gera `Bad hmac value` (`src/utils/internal/iron-crypto.ts:135-137`). É esse o erro que o fallback legado já trata (`src/utils/session.ts:336`).
- Tamanho mínimo: `minPasswordlength: 32` nos dois blocos de `defaults` (`src/utils/internal/iron-crypto.ts:22` e `:28`). A checagem fica em `generateKey` (`src/utils/internal/iron-crypto.ts:191-196`), que só roda quando a chave é derivada. Por isso uma senha curta da lista só falharia quando for usada, e não na configuração.
- `sealSession` e `unsealSession` são exportados publicamente (`src/index.ts:208-209`).

## 2. Decisões de arquitetura

### D-01 — Tentar as senhas em ordem; não usar `PasswordHash` nem ids

**Escolha:** `session.ts` converte `config.password` em uma lista de strings e passa **uma senha por vez** para `seal`/`unseal`. `iron-crypto` não muda nessa parte.

**Alternativas consideradas:**

1. Passar um `PasswordHash` (`Record<id, senha>`) para `unseal` e atribuir ids às senhas. Isso exigiria escrever um id no selo. Como o id entra no MAC (`src/utils/internal/iron-crypto.ts:79`), selos antigos (id vazio) precisariam virar a chave `"default"`, e a primeira senha teria que ser cadastrada com id também. Mudaria o formato do cookie, que o PRD proíbe (fora de escopo: "Mudança no formato do cookie selado").
2. Tentar cada senha em ordem, sem tocar no formato. Custo: uma derivação PBKDF2 por senha tentada.

**Justificativa:** a alternativa 2 não muda o formato, não exige mudança em `iron-crypto` e cabe no escopo do PRD. O custo extra só aparece para sessões que não foram seladas com a primeira senha, e isso é o caso que o recurso existe para atender (ver R1).

### D-02 — Validar a lista inteira antes de usar; deixar a string como está

**Escolha:**

- Uma string continua passando direto para `seal`/`unseal`, sem validação extra. Assim o comportamento de hoje, inclusive o erro de `""` (`Empty password`), fica idêntico (RF-06).
- Uma lista é validada antes de qualquer uso: lista vazia gera erro explícito; cada item passa pela mesma checagem de tamanho usada por `generateKey`.
- A validação roda em `getSession`, `sealSession` e `unsealSession`. Sem isso, um item curto só apareceria quando fosse usado, e `getSession` engoliria o erro (`src/utils/session.ts:197`). RF-05 pede erro explícito "quando a configuração é usada", então leituras também precisam falhar.

**Alternativas consideradas:**

1. Validar só dentro de `seal`/`unseal`. Rejeitada: um item curto nunca usado passaria em silêncio, e a leitura engoliria o erro.
2. Chamar `generateKey` para cada item como teste. Rejeitada: deriva chaves (PBKDF2) só para validar.
3. Duplicar a mensagem `Password string too short (min N characters required)` em `session.ts`. Rejeitada: duas fontes para a mesma mensagem.

**Escolha da checagem:** extrair de `generateKey` um helper `assertPasswordLength(password, minLength)` exportado de `iron-crypto.ts`. É a única mudança em `iron-crypto`, de poucas linhas, e segue a instrução "só o estritamente necessário": a mensagem fica idêntica e o teste existente de `generateKey` (`test/unit/iron-crypto.test.ts:121-126`) continua valendo.

**Mínimo usado:** `Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)`. Os dois valores podem ser sobrescritos por `config.seal`, então a checagem usa os opções efetivas e não o `defaults`.

### D-03 — Ordem de tentativas no unseal: senha externa, contagem legada interna

**Escolha:** para cada senha, em ordem, tenta-se primeiro a contagem atual (8192). Só se ela falhar com `Bad hmac value`, e se o fallback legado estiver habilitado (`config.legacySealFallback !== false` e `integrity.iterations !== 1`, como hoje em `src/utils/session.ts:332-337`), tenta-se a contagem 1 com a mesma senha. Só `Bad hmac value` avança para a próxima senha. Qualquer outro erro (`Expired seal`, `Incorrect number of sealed components`, `Wrong mac prefix`) sobe direto, porque não depende da senha.

**Alternativas consideradas:**

1. Contagem externa: tentar todas as senhas com 8192, depois todas com 1. Para sessões legadas, custa N derivações pesadas antes de chegar ao fallback.
2. Combinar senhas × contagens num único laço plano. Mesmo resultado que a escolha, com mais código.

**Justificativa:** a escolha mantém a regra "uma senha é aceita ou não" dentro de um único laço e gasta derivações pesadas só quando a senha está na lista. Para sessões legadas, as tentativas com contagem 1 são baratas.

### D-04 — Selar sempre com a primeira senha, sem rastrear qual abriu a sessão

**Escolha:** `sealSession` usa `passwords[0]`. Nada novo guarda qual senha abriu a sessão. RF-08 é atendido porque toda regravação (`updateSession`, reselagem legada e reselagem por `idleTimeout` em `src/utils/session.ts:214-216`) passa por `sealSession`.

**Alternativas consideradas:** marcar na sessão a senha usada para abri-la e regravar só se for diferente da primeira. Rejeitada: estado extra, e o PRD (R2) já aceita que uma sessão antiga só migra quando for regravada.

**Consequência:** uma sessão que só é lida continua selada com a senha antiga. Isso é intencional (R2) e vai para a documentação futura.

### D-05 — Tipo público `string | string[]`, sem nomes novos

**Escolha:** `password: string | string[]` em `SessionConfig` (`src/utils/session.ts:48`), com JSDoc explicando que o primeiro item sela e os demais só abrem. Nenhum outro símbolo é exportado (RF-01; `src/index.ts:203-212` não muda).

**Alternativa rejeitada:** `extraUnsealPasswords`, primeira alternativa da issue, fora de escopo pelo PRD.

**Efeito colateral:** quebra de tipo para quem lê `config.password` como string (R4). Fica para a descrição do PR e para o changelog de release (`changelogen`, script `release` em `package.json`).

### D-06 — Erros: lista vazia explícita; senha desconhecida continua silenciosa

- Lista vazia: `throw new Error("Session password list is empty")` no momento da validação (D-02).
- Senha desconhecida numa leitura: continua `Bad hmac value` internamente e é engolida por `getSession`, como hoje (RF-04). Nenhuma mensagem nova chega ao cliente.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:48` | `password: string \| string[]`; JSDoc (ver D-05). |
| `src/utils/session.ts:149-153` | `getSession`: chamar `getPasswords(config, getSealOptions(config))` logo após `sessionName`, antes de tocar em `context.sessions` (D-02). |
| `src/utils/session.ts:282-307` | `sealSession`: `const sealOptions = getSealOptions(config)`; `seal(session, getPasswords(…)[0]!, sealOptions)` (substitui o inline em `:300-304`). |
| `src/utils/session.ts:312-367` | `unsealSession`: usar `getSealOptions` (`:317-321`); substituir o `try/catch` de `:323-348` por `unsealWithPasswords` (D-03). Preservar o `kLegacySeal` (`:345-347`) e as checagens de `maxAge`/`idleTimeout` (`:349-365`). |
| `src/utils/session.ts` (final do arquivo, após `sessionExpires`, `:455-464`) | Helpers internos novos: `getSealOptions`, `getPasswords`, `unsealWithPasswords`, `isBadHmac`. Seguem a convenção de helpers no fim do arquivo (`shouldSlide` em `:414`, `stageSessionErrCookies` em `:435`). |
| `src/utils/internal/iron-crypto.ts:191-196` | Substituir o bloco por `assertPasswordLength(password, options.minPasswordlength)`; definir o helper exportado perto de `generateKey` (`:170`). Único ponto de `iron-crypto` que muda. |
| `test/session.test.ts` | Novos casos (seção 5). Nenhum caso existente precisa mudar: todos usam `string`. |
| `test/unit/iron-crypto.test.ts:121-126` | Opcional: teste direto para `assertPasswordLength`. O teste de `generateKey` já cobre a mensagem. |
| `docs/2.utils/4.security.md` | Gerado por automd a partir de JSDoc de funções. Não precisa de edição manual; `pnpm fmt` confere. |

Observação: `src/utils/session.ts` já tem 464 linhas, bem acima do alvo de 200 do `AGENTS.md`. Esta mudança aumenta o arquivo. Não é o momento de dividi-lo, então os helpers ficam no próprio arquivo. Se for dividir depois, `src/utils/internal/session.ts` é o destino natural.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts

export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. Each must be at least 32
   * characters. The first one seals; the others only open sessions sealed
   * before a rotation. Sessions sealed with a password that is no longer in
   * the list become invalid.
   * ...(texto atual mantido)
   */
  password: string | string[];
  // demais campos inalterados
}

// Inalterados (assinaturas públicas):
// useSession<T>(event, config): Promise<SessionManager<T>>
// getSession<T>(event, config): Promise<Session<T>>
// updateSession<T>(event, config, update?): Promise<Session<T>>
// sealSession<T>(event, config): Promise<string>
// unsealSession(_event, config, sealed): Promise<Partial<Session>>

// Internos novos (não exportados):

/** Opções de seal efetivas: defaults + maxAge/idleTimeout como ttl + overrides de config.seal. */
function getSealOptions(config: SessionConfig): SealOptions;

/**
 * Senhas para selar e abrir, na ordem de config.password.
 * String: devolve [senha] sem validar (comportamento atual).
 * Lista: lança se vazia; lança a mensagem de senha curta se algum item for menor que o mínimo.
 */
function getPasswords(config: SessionConfig, sealOptions: SealOptions): string[];

/**
 * Abre `sealed` com a primeira senha que verificar o HMAC. Só "Bad hmac value"
 * avança; a contagem legada (1) é tentada com a mesma senha antes de avançar,
 * quando o fallback está habilitado.
 */
function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  sealOptions: SealOptions,
  legacyFallback: boolean,
): Promise<{ unsealed: Partial<Session>; legacy: boolean }>;

/** Erro de HMAC: o único que indica senha errada. */
function isBadHmac(error: unknown): boolean;
```

```ts
// src/utils/internal/iron-crypto.ts

/** Lança `Password string too short (min N characters required)` se `password` for menor que `minLength`. */
export function assertPasswordLength(password: string, minLength: number): void;
```

Esboço do núcleo de `unsealWithPasswords` (ordem D-03):

```ts
let firstError: unknown;
for (const password of passwords) {
  try {
    return { unsealed: (await unseal(sealed, password, sealOptions)) as Partial<Session>, legacy: false };
  } catch (error) {
    if (!isBadHmac(error)) throw error;
    firstError ??= error;
  }
  if (!legacyFallback) continue;
  try {
    const unsealed = (await unseal(sealed, password, legacyOptions)) as Partial<Session>;
    return { unsealed, legacy: true };
  } catch (error) {
    if (!isBadHmac(error)) throw error;
  }
}
throw firstError;
```

`legacyOptions` é `sealOptions` com `iterations: 1` em `encryption` e `integrity`, como hoje (`src/utils/session.ts:340-344`). `legacyFallback` vale `config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1`, que é a condição de `:332-337` sem o `error` (agora tratado dentro do laço).

Comportamento preservado com senha única: mesma sequência de chamadas a `unseal` (uma tentativa com 8192 e, se falhar com `Bad hmac value`, uma com 1), mesmas mensagens, mesmo `kLegacySeal`.

## 5. Estratégia de testes

Regra do `AGENTS.md`: teste de regressão antes da mudança, vendo-o falhar; depois a implementação; depois a suíte ampla.

Todos os casos novos entram em `test/session.test.ts` com `describeMatrix`, para rodar em `web` e `node`. Usar `t.app` e `t.fetch`, como os testes em `test/session.test.ts:134-186`.

Casos (cada um com o RF que cobre):

1. **Sela com a primeira senha** (RF-02): `password: [NEW, OLD]` cria sessão; o cookie abre com `unseal(cookie, NEW)` e falha com `unseal(cookie, OLD)`.
2. **Abre sessão antiga** (RF-03): cookie selado com `OLD`; `useSession` com `[NEW, OLD]` devolve os dados e o id.
3. **Rejeita senha fora da lista** (RF-04): cookie selado com `OTHER`; `[NEW, OLD]` gera sessão nova (id diferente, sem dados), sem erro na resposta.
4. **Regrava com a senha atual** (RF-08): lê cookie `OLD`, chama `session.update(...)`; o `Set-Cookie` novo abre com `NEW` e não abre com `OLD`.
5. **Lista vazia** (RF-05): `password: []` faz `updateSession` lançar com a mensagem exata. Usar um handler que captura o erro e devolve `{ message }`, porque o h3 mascara erros 500.
6. **Item curto na lista** (RF-05): `[NEW, "curta"]` lança a mensagem de senha curta em `getSession`/`updateSession`, mesmo quando o cookie usa `NEW`.
7. **Fallback legado com lista** (RF-07): `seal` com contagem 1 e senha `OLD`; leitura com `[NEW, OLD]` abre, regrava com `NEW` e o novo cookie abre com `unseal(…, sealDefaults)` sem fallback. Espelhar o teste em `test/session.test.ts:134-159`.
8. **Fallback desabilitado com lista** (RF-07): mesmo cenário com `legacySealFallback: false` rejeita, como em `test/session.test.ts:161-186`.
9. **Regressão com uma senha** (RF-06): a suíte existente passa sem alteração. Os testes `throttles idleTimeout reseals…` (`:410-474`) e `seals once when updateSession creates the session` (`:722-735`) funcionam como guarda de que o número de derivações não mudou ao selar.
10. **Custo** (R1, opcional): com `deriveBits` espionado (como em `:723`), contar derivações para lista de 2 senhas lendo cookie da segunda. Esperado: 3 (uma HMAC falha com a primeira, uma HMAC e uma decriptação com a segunda). Usar como documentação, não como contrato rígido.

Unitário (opcional): `assertPasswordLength` em `test/unit/iron-crypto.test.ts`, junto ao teste de `generateKey` em `:121-126`.

Comandos de verificação:

- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/iron-crypto.test.ts`
- `pnpm lint` (oxlint + oxfmt --check)
- `pnpm typecheck`
- `pnpm test` ao final (lint, typecheck e cobertura completa)

Nenhum desses comandos foi executado nesta etapa, porque a tarefa era só a especificação.

## 6. Riscos

- **R1 — Custo de CPU e amplificação.** Uma leitura de cookie sem senha conhecida gasta uma derivação pesada (PBKDF2 com 8192 iterações) por senha da lista, mais as tentativas legadas, que são baratas. Hoje custa uma. Com N senhas, um atacante que envia cookies com MAC inválido multiplica o custo por N em cada requisição. Mitigação: documentar que a lista deve ser curta (2 ou 3); medir o custo com a suíte de benchmark (`pnpm bench:node`); decidir se vale um limite máximo de itens (pergunta em aberto 1).
- **R2 — Senha antiga que nunca sai.** Enquanto a senha antiga estiver na lista, as sessões dela continuam válidas. Retirá-la invalida as sessões que ainda não foram regravadas. Vai para a documentação futura (fora deste escopo).
- **R3 — Combinação com `legacySealFallback`.** Resolvida pela D-03: o pior caso é 2 tentativas por senha, e só `Bad hmac value` avança.
- **R4 — Quebra de tipo para terceiros.** `config.password` deixa de ser sempre `string`. Sinalizar na descrição do PR e no changelog de release.
- **R5 — Mensagens.** Lista vazia e senha curta têm mensagens próprias. Senha desconhecida continua `Bad hmac value` interno e não aparece ao cliente (D-06).
- **R6 — Mudança de comportamento em `""`.** Não há: uma string continua sem validação extra (D-02), então `""` segue `Empty password`. Só listas validam antecipadamente.
- **R7 — Validação em `getSession` muda o momento do erro.** Antes, uma configuração com senha curta só falhava ao selar. Agora falha na primeira leitura também. Isso só afeta listas, porque strings não passam pela validação extra.
- **R8 — Duplicidade de validação.** Uma lista é validada em `getSession` e de novo em `sealSession`/`unsealSession`. É barato (sem derivação), mas é trabalho repetido por requisição. Se incomodar no benchmark, a validação pode ficar só em `getSession`.

## 7. Pendências e perguntas em aberto

1. Limite máximo de itens na lista? Recomendação: não impor agora, documentar, e medir (R1).
2. Mensagens exatas: proposta `Session password list is empty` e a mensagem de senha curta existente. Confirmar o texto em inglês, que é o idioma do código.
3. A única mudança em `iron-crypto` é o helper `assertPasswordLength`. Se a restrição do PRD for lida como proibição total, a alternativa é duplicar a mensagem em `session.ts` (D-02, alternativa 3).
4. O `kLegacySeal` continua sendo marcado para qualquer contagem legada, mesmo quando a senha que abriu não é a primeira. Isso é o comportamento esperado por RF-07.
