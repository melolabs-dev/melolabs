# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-10).
Código de referência: `src/utils/session.ts`, `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts`.

## Visão geral

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. A leitura de uma sessão tenta `password` e depois cada extra, na ordem do array. A selagem usa sempre `password`. Uma sessão aberta com uma extra é resselada com `password` quando veio de cookie. Sem o campo, o comportamento não muda.

Hoje o problema é este: `unsealSession` só conhece `config.password` (`src/utils/session.ts:324` e `:340`). Quando a senha foi trocada, o `unseal` falha com `"Bad hmac value"`, o fallback legado também falha, e `getSession` engole o erro (`src/utils/session.ts:197`, `.catch(() => {})`) e cria uma sessão nova. Esse é o logout em massa que a feature evita.

---

## Decisões de arquitetura

### D-01 — Tentativa das senhas dentro de `unsealSession`

**Contexto.** `unsealSession` é exportada (`src/index.ts:209`) e já concentra a lógica de unseal, o fallback legado e as checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:312-367`). O PRD (premissa 4) diz que ela passa a considerar as extras.

**Alternativas.**
- (a) Fazer o loop em `getSession`, chamando `unseal` diretamente para cada senha. Duplicaria o fallback legado e as checagens de expiração, que ficariam em dois lugares.
- (b) Criar uma função interna nova, `openSession`, e manter `unsealSession` como um wrapper. Mais código, e a API pública continuaria igual.
- (c) Fazer o loop dentro de `unsealSession`, com uma função auxiliar interna para uma senha só.

**Escolha: (c).** Uma única implementação das regras de abertura, sem mudar a assinatura pública. A função auxiliar fica no fim de `session.ts`, com a convenção do projeto de helpers internos ao final do arquivo (`AGENTS.md`, "Internal helpers go at the end of files").

### D-02 — Ordem de tentativa e fallback legado por senha

**Escolha.** A ordem é `[password, ...extraUnsealPasswords]`. Para cada senha, tenta primeiro os iterations atuais e, se o `"Bad hmac value"` vier e `legacySealFallback !== false`, tenta o legado de 1 iteração. Só então passa para a próxima senha.

**Alternativa rejeitada.** Testar todas as senhas com os iterations atuais e só depois todas com o legado. Ela também funciona, mas o PRD (RF-09) descreve o fallback "para cada senha da lista", e o custo fica igual: 2 derivações HMAC por senha no pior caso.

**Custo medido por desenho, não estimado.** Cada `unseal` que falha no HMAC faz exatamente 1 chamada a `crypto.subtle.deriveBits` (a de `generateKey` para o HMAC, `src/utils/internal/iron-crypto.ts:206`, e o `unseal` lança antes da decriptação). Com fallback, um cookie inválido custa `2 × (1 + N)` chamadas. Esse é o número do PRD e é o que o teste de custo (seção de testes) fixa.

### D-03 — Sinalizar "aberta com senha extra" com um símbolo interno

`getSession` precisa saber se a sessão foi aberta por uma extra para resselar (RF-06). A mesma lógica já existe para o legado: `unsealSession` marca o objeto com `kLegacySeal` (`src/utils/session.ts:346`), e `getSession` remove a marca antes de copiar os campos (`:199-201`).

**Escolha.** Um símbolo novo, `kExtraUnsealPassword`, em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal`. Ele não é público, então não cria nome novo na API. `unsealSession` retorna o objeto com a marca quando a senha que abriu não é a primeira da lista.

**Alternativa rejeitada.** Mudar o retorno de `unsealSession` para uma tupla ou um objeto `{ session, rotated }`. Quebraria a API pública exportada, que hoje retorna `Partial<Session>`.

### D-04 — Validação de `extraUnsealPasswords` ao usar a config

**Escolha.** Uma função `assertExtraUnsealPasswords(config)` é chamada no início de `getSession`, antes do retorno antecipado de sessão existente e antes de qualquer escrita em `context.sessions`. Como `useSession` chama `getSession` primeiro (`src/utils/session.ts:115`), a validação também cobre `useSession`.

**Por que no início de `getSession`, e não em `unsealSession`.** A chamada de `unsealSession` fica dentro do `.catch(() => {})` (`:196-197`). Um erro de validação lançado ali seria engolido e a sessão seria criada nova, o que é o contrário do que RF-07 pede.

**Limite.** O mínimo é o maior entre `encryption.minPasswordlength` e `integrity.minPasswordlength` das opções efetivas (`{ ...sealDefaults, ...config.seal }`). Hoje os dois são 32 (`src/utils/internal/iron-crypto.ts:22` e `:28`). Uma string vazia é rejeitada explicitamente, porque com `minPasswordlength: 0` ela passaria pela checagem de tamanho e só falharia em `"Empty password"` (`iron-crypto.ts:172`), que seria engolido.

**Consequência aceita.** `updateSession` não valida quando já há uma sessão no contexto, porque selagem não usa extras. Isso não é um problema.

### D-05 — Só `"Bad hmac value"` avança para a próxima senha

Qualquer outro erro de `unseal` (`"Expired seal"`, `"Wrong mac prefix"`, `"Empty password"`, formato inválido, `"Password string too short"`) interrompe o loop e é relançado, igual ao código atual (`src/utils/session.ts:332-339`). Isso evita que um erro de configuração, como a senha atual vazia, seja mascarado pelas extras. É a regra que impede a regressão silenciosa citada no PRD.

**Quando nenhuma senha valida**, `unsealSession` relança `new Error("Bad hmac value")`. Assim quem chama `unsealSession` diretamente vê o mesmo erro de hoje.

### D-06 — Testes em arquivo irmão

**Escolha.** Os casos novos vão em `test/session-extra-passwords.test.ts`, com `describeMatrix` (`test/_setup.ts:11`). `test/session.test.ts` fica intocado, o que cumpre RF-05 ao pé da letra: a suíte existente roda sem alteração.

**Alternativa rejeitada.** Acrescentar um `describe` a `test/session.test.ts`. Funcionaria, mas misturaria os casos novos com os 777 linhas de testes existentes e obrigaria a editar o arquivo que RF-05 quer preservar.

### D-07 — Nada de exports, nada de `iron-crypto.ts`

`src/index.ts` não ganha exports, e `test/unit/package.test.ts` (snapshot da lista de exports, `:149` para `unsealSession`) continua igual. `src/utils/internal/iron-crypto.ts` não muda: o `unseal` já aceita uma `string` por chamada, então basta chamá-lo em loop.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:48` | Campo `extraUnsealPasswords?: string[]` logo após `password`, com JSDoc que diz que só abre sessões e que `password` sela. |
| `src/utils/session.ts:149-153` | Chamada de `assertExtraUnsealPasswords(config)` como primeira instrução de `getSession`. |
| `src/utils/session.ts:196-199` | Ao lado de `kLegacySeal`, ler e apagar `kExtraUnsealPassword` antes de `Object.assign(session, unsealed)` (`:208`). |
| `src/utils/session.ts:214` | Condição de reseal vira `legacySeal \|\| extraUnsealPassword \|\| shouldSlide(session, config)`. Continua restrita a `sessionFromCookie` (RF-06). |
| `src/utils/session.ts:312-367` | `unsealSession` passa a iterar `[password, ...extras]` e usa a função auxiliar por senha. As checagens de `maxAge` (`:350`) e `idleTimeout` (`:359`) ficam depois do loop, sem mudança. |
| `src/utils/session.ts` (fim do arquivo, após `:464`) | `unsealWithPassword` e `assertExtraUnsealPasswords`, como helpers internos. |
| `src/utils/internal/session.ts:7` | Novo símbolo `kExtraUnsealPassword`, com `Symbol.for("h3.internal.session.extra-unseal-password")`. |
| `test/session-extra-passwords.test.ts` | Arquivo novo (ver seção de testes). |
| `test/unit/types.test-d.ts` | Teste de tipo para `SessionConfig["extraUnsealPasswords"]`. O arquivo hoje não referencia `SessionConfig` (verificado com grep), então é uma adição. |
| `docs/4.examples/handle-session.md:120` (seção Options) e `:151` (seção Expiration) | Descrever o campo, a ordem de tentativa, a seleção de `password` para selar e o procedimento de rotação: adicionar a nova senha em `password`, mover a antiga para `extraUnsealPasswords` e removê-la quando o último cookie antigo tiver expirado (`maxAge`). |
| `docs/2.utils/4.security.md` | Revisar: menciona `useSession` e pode precisar de uma nota sobre rotação. |

**Não alterar:** `src/index.ts`, `src/utils/internal/iron-crypto.ts`, `test/session.test.ts`, `test/unit/package.test.ts`, `CHANGELOG.md` (gerado pelo standard-version).

---

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (novo campo)
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords that still open sessions sealed with them. They are tried
   * after `password`, in order. Sessions are always sealed with `password`.
   * Remove an entry once every cookie sealed with it has expired (`maxAge`).
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}

// Assinaturas públicas inalteradas
export function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export function updateSession<T>(event, config, update?): Promise<Session<T>>;
export function sealSession<T>(event, config): Promise<string>;
export function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;
```

```ts
// src/utils/internal/session.ts
export const kExtraUnsealPassword: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-unseal-password",
);
```

```ts
// src/utils/session.ts — helpers internos (fim do arquivo)

/** Lança se alguma senha extra estiver vazia ou abaixo do mínimo da selagem. */
function assertExtraUnsealPasswords(config: SessionConfig): void {
  const { encryption, integrity } = { ...sealDefaults, ...config.seal };
  const min = Math.max(encryption.minPasswordlength, integrity.minPasswordlength);
  for (const password of config.extraUnsealPasswords || []) {
    if (!password || password.length < min) {
      throw new Error(
        `Invalid extraUnsealPasswords entry: each password must be at least ${min} characters`,
      );
    }
  }
}

/**
 * Tenta abrir com uma senha. Retorna `undefined` só para "Bad hmac value"
 * (senha errada). Qualquer outro erro é relançado.
 */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacyFallback: boolean,
): Promise<Partial<Session> | null | undefined> {
  const attempt = (options: SealOptions) =>
    unseal(sealed, password, options).catch((error) => {
      if (error instanceof Error && error.message === "Bad hmac value") {
        return undefined;
      }
      throw error;
    }) as Promise<Partial<Session> | null | undefined>;

  const current = await attempt(sealOptions);
  if (current !== undefined || !legacyFallback || sealOptions.integrity.iterations === 1) {
    return current;
  }
  const legacy = await attempt({
    ...sealOptions,
    encryption: { ...sealOptions.encryption, iterations: 1 },
    integrity: { ...sealOptions.integrity, iterations: 1 },
  });
  if (legacy) {
    (legacy as any)[kLegacySeal] = true;
  }
  return legacy;
}
```

**Nota de implementação.** `unseal` pode retornar `null` sem lançar (`iron-crypto.ts:149`, quando o plaintext é vazio). O código atual trata `null` como sucesso sem tentar o legado. Para não mudar isso, a comparação com `undefined` precisa ser explícita, como acima, e o `null` deve seguir o caminho de sucesso. A forma exata fica a critério de quem implementar, desde que `undefined` signifique só "Bad hmac value".

```ts
// unsealSession (corpo, resumido)
export async function unsealSession(_event, config, sealed) {
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  const legacyFallback = config.legacySealFallback !== false;
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];

  let unsealed: Partial<Session> | null | undefined;
  for (const [index, password] of passwords.entries()) {
    unsealed = await unsealWithPassword(sealed, password, sealOptions, legacyFallback);
    if (unsealed !== undefined) {
      if (index > 0 && unsealed) {
        (unsealed as any)[kExtraUnsealPassword] = true;
      }
      break;
    }
  }
  if (unsealed === undefined) {
    throw new Error("Bad hmac value");
  }
  // maxAge e idleTimeout: inalterados (src/utils/session.ts:349-365)
  return unsealed;
}
```

**Comportamento de `getSession` com a marca.** Antes de `Object.assign(session, unsealed)`, ler e apagar `kExtraUnsealPassword`, do mesmo jeito que `kLegacySeal` (`src/utils/session.ts:199-201`). Sem apagar, o símbolo seria copiado para `session`. A condição de reseal (`:214`) passa a incluir a marca, e `updateSession` usa `config.password` (RF-03).

---

## Estratégia de testes

Arquivo: `test/session-extra-passwords.test.ts`, com `describeMatrix` e a mesma configuração de `test/session.test.ts:21-37` (`password` de 49 caracteres, `generateId` determinístico). Cada caso roda em `web` e `node`.

Todos os casos novos devem falhar antes da implementação quando aplicável (AGENTS.md, "Bug Fix Workflow"), principalmente RF-02, RF-06 e RF-09.

| Caso | RF | O que verifica |
| --- | --- | --- |
| Cookie selado com a senha antiga abre com `password` nova e extras | RF-02 | `session.id` e `session.data` são os originais |
| `updateSession` emite cookie que abre só com `password` nova | RF-03 | `unseal` com a nova passa; com a antiga falha |
| Cookie com senha desconhecida vira sessão nova | RF-04 | `id` novo, `data` vazio, nenhum erro |
| Sem extras e com `[]`: mesmo comportamento | RF-05 | Além da suíte existente, um caso com `extraUnsealPasswords: []` |
| Cookie com senha antiga: `Set-Cookie` novo abre com a nova | RF-06 | Cookie resselado |
| Mesmo cenário via `x-h3-session` | RF-06 | Sessão carregada, nenhum `Set-Cookie` |
| `[""]` e item de 10 caracteres rejeitam | RF-07 | `getSession` e `useSession` rejeitam; a mensagem contém `extraUnsealPasswords` |
| Sessão com senha antiga além de `maxAge` vira nova | RF-08 | Usa `vi.useFakeTimers({ toFake: ["Date"] })`, como nos testes de idle |
| Legado de 1 iteração com senha antiga | RF-09 | Carregada e resselada com as opções atuais |
| Duas extras: a segunda abre a sessão | Ordem | Prova que a tentativa percorre o array |
| Com `legacySealFallback: false`, legado com senha antiga é rejeitado | Interação | Não há fallback nem por extra |
| Cookie forjado com N=2 extras e fallback: `deriveBits` chamado 6 vezes | Custo (PRD, risco 1) | `vi.spyOn(crypto.subtle, "deriveBits")`, como em `test/session.test.ts:723-733`. Valor esperado `2 × (1 + N)` |
| Sessão aberta por extra com `idleTimeout` | RF-06 + RF-08 | O reseal restampa `lastSeenAt` e a janela desliza |
| Um `unseal` que lança erro não-HMAC com a senha atual não tenta as extras | D-05 | Evita regressão silenciosa |

**Tipo (RF-01).** Em `test/unit/types.test-d.ts`, um `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()`, além da chamada de `useSession`/`getSession`/`updateSession` com o campo, para que o typecheck cubra a aceitação.

**Comandos de verificação.**
- `pnpm vitest run test/session.test.ts` (RF-05, sem alterações nos testes).
- `pnpm vitest run test/session-extra-passwords.test.ts`.
- `pnpm vitest run test/unit/package.test.ts` (snapshot de exports inalterado).
- `pnpm vitest run test/unit/iron-crypto.test.ts` (nada muda no iron, mas é a base do unseal).
- `pnpm lint` (oxlint, oxfmt e typecheck, segundo `AGENTS.md`).
- `pnpm test` antes de fechar.

---

## Riscos

1. **Custo de CPU (PRD, risco 1).** Cada extra custa uma derivação HMAC por tentativa. Um cookie forjado passa a custar `2 × (1 + N)` derivações com o fallback ligado. Mitigação: documentar um limite prático de extras (algumas, não dezenas), medir antes de publicar e manter o teste de custo para detectar aumentos.

2. **Senha antiga vazada (PRD, risco 2).** Enquanto a senha antiga estiver na lista, cookies emitidos com ela continuam válidos. A documentação deve dizer para remover a entrada quando o último cookie antigo tiver expirado (`maxAge`). Sessões só por header (`idleTimeout`, `docs/4.examples/handle-session.md:180`) continuam válidas até expirar, sem migração.

3. **Falha silenciosa por `getSession` (novo, D-05).** `getSession` engole qualquer erro de unseal (`src/utils/session.ts:197`). Um bug no novo loop que lance um erro não-HMAC faria todos os usuários serem deslogados sem nenhum sinal. Mitigação: os casos de sucesso (RF-02, RF-06, RF-09 e ordem) são o alarme, e o caso D-05 fixa o comportamento de erro.

4. **Validação em `getSession` como ponto de falha (novo, D-04).** Uma extra inválida faz `getSession` rejeitar em toda requisição, o que causa erro 500 em todas as rotas que usam sessão. É o comportamento pedido por RF-07 ("erro explícito"), mas precisa estar em release notes e documentação.

5. **Combinação com o legado (PRD, risco 5).** O pior caso é `2 × (1 + N)` derivações, já coberto pelo teste de custo.

6. **Marca interna na saída pública.** `unsealSession` retorna objetos com `kExtraUnsealPassword`, o mesmo que já acontece com `kLegacySeal`. Não é um vazamento de segredo, mas consumidores que copiam o objeto inteiro carregam o símbolo. Mesma ressalva do legado, sem mudança de contrato.

7. **Race entre respostas.** Duas requisições paralelas com o mesmo cookie antigo resselam com o mesmo `password`. O conteúdo é idêntico e o navegador fica com a última resposta, então não há perda de dados. Se a requisição também escrever, vale a ressalva já documentada em `docs/4.examples/handle-session.md:183`.

8. **Tempo de resposta.** Pelo tempo, um atacante consegue inferir quantas extras existem, mas ele já precisa ter o cookie e o custo é o mesmo de uma tentativa. Não é um vetor relevante, e não justifica tempo constante.

9. **Premissa de reseal (PRD, premissas).** RF-06 é uma decisão de design. Se o mantenedor preferir não resselar, RF-06 e o caso de teste correspondente mudam, mas a implementação de D-01 a D-05 continua valendo.
