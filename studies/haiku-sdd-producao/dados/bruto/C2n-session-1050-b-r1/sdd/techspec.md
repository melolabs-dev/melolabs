# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (requisitos RF-01 a RF-10), issue h3js/h3#1050.

As citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `c06a21d`) na versão anterior deste documento. Esta revisão não as reconferiu com ferramentas: reconferir antes de implementar, porque os números de linha mudam com qualquer edição.

## 1. Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. A abertura de sessão passa a tentar `password` e depois cada extra, na ordem, parando na primeira que abre. A selagem continua usando só `password`. Uma sessão aberta com extra é regravada com `password`, pelo mesmo caminho que já regrava o selo legado. A mudança fica concentrada em `src/utils/session.ts`, com um símbolo interno novo em `src/utils/internal/session.ts`. `iron-crypto.ts`, os tipos públicos de `useSession`/`getSession` e o snapshot de exports ficam intactos.

## 2. Estado atual relevante (verificado no código)

- `SessionConfig.password` é `string` e é o único segredo usado hoje: `src/utils/session.ts:48`. O campo `legacySealFallback` está em `src/utils/session.ts:95`.
- `getSession` decide a leitura: cookie ou header em `src/utils/session.ts:178-193`. Chama `unsealSession` em `src/utils/session.ts:196`, com `.catch(() => {})` em `src/utils/session.ts:197`. Por isso uma falha de abertura já vira sessão vazia, sem erro para o usuário.
- A regravação ao ler acontece em `src/utils/session.ts:214-216`: `session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config))`. Sessões vindas por header nunca são regravadas, porque não há como devolver cookie.
- `Object.assign(session, unsealed)` em `src/utils/session.ts:208` copia também chaves-símbolo. Por isso o marcador `kLegacySeal` é removido antes da cópia, em `src/utils/session.ts:199-201`. Um marcador novo precisa do mesmo tratamento.
- `sealSession` já sela com `config.password`: `src/utils/session.ts:300-304`. Nenhuma mudança é necessária para RF-03.
- `unsealSession` é a função de abertura. Usa `unseal` com `config.password` em `src/utils/session.ts:324`, tem o fallback legado em `src/utils/session.ts:325-348` e as checagens de `maxAge`/`idleTimeout` em `src/utils/session.ts:349-365`. É exportada publicamente (`src/index.ts:209`) e aparece no snapshot de `test/unit/package.test.ts:149`.
- O fallback legado só é tentado quando o erro é `"Bad hmac value"` e as iterações atuais não são 1: `src/utils/session.ts:332-337`. Um TODO marca a remoção para a v3 em `src/utils/session.ts:326-331`.
- Em `src/utils/internal/iron-crypto.ts`, o padrão é 8192 iterações de PBKDF2 para encriptação e integridade (`src/utils/internal/iron-crypto.ts:21` e `:27`). A senha precisa de no mínimo 32 caracteres (`src/utils/internal/iron-crypto.ts:192-196`). A validação do HMAC vem antes da derivação da chave de decriptação, em `src/utils/internal/iron-crypto.ts:135-137`. Por isso uma tentativa com senha errada custa uma derivação, e uma abertura bem-sucedida custa duas (integridade e decriptação).
- Derivação PBKDF2 passa por `crypto.subtle.deriveBits` em `src/utils/internal/iron-crypto.ts:249`. É o ponto que os testes de contagem vão observar.
- Símbolos internos seguem o padrão `Symbol.for("h3.internal.session.…")` em `src/utils/internal/session.ts:3-9`.
- Observação fora de escopo: a documentação de `iterations` em `src/utils/internal/iron-crypto.ts:377` diz "Defaults to 1", mas o padrão real é 8192. O PRD pede para conferir esse número, e a conferência confirma 8192.

## 3. Decisões de arquitetura

### D-01 — Onde a tentativa com várias senhas acontece

**Escolha:** o laço de tentativas fica dentro de `unsealSession` (`src/utils/session.ts:312`). `iron-crypto.ts` não muda.

**Alternativas consideradas:**

- *Usar `PasswordHash` do `unseal`* (`src/utils/internal/iron-crypto.ts:427`), com um id por senha. Rejeitada: o cookie selado com string tem id vazio, que cai na chave `"default"` (`src/utils/internal/iron-crypto.ts:121`). Dar ids às senhas exigiria um identificador no cookie, o que o PRD proíbe (ver "Fora de escopo", `prd.md:141`).
- *Passar uma lista de senhas para `unseal`.* Rejeitada: PRD limita mudanças em `iron-crypto.ts` ao estritamente necessário (`prd.md:145`), e uma função interna nova aumentaria a superfície sem ganho.
- *Laço em `getSession`.* Rejeitada: duplicaria a lógica de expiração e deixaria `unsealSession`, que é público, com comportamento diferente do de `getSession`.

**Justificativa:** `unsealSession` já é o ponto que lê a configuração e devolve a sessão. Colocar o laço ali faz com que o caminho público e o interno usem a mesma regra.

### D-02 — Ordem das tentativas e fallback legado

**Escolha:** tentativas por senha. Para cada senha, primeiro o selo atual; se falhar com `"Bad hmac value"` e o fallback estiver permitido, o selo legado com 1 iteração. Só então a próxima senha.

**Alternativas consideradas:**

- *Duas passagens*: todas as senhas com o selo atual, depois todas com o legado. Rejeitada: o custo caro (derivação de 8192 iterações) é o mesmo nas duas opções, e o legado com 1 iteração custa cerca de 1/8192 de uma tentativa completa. Não há ganho que justifique um laço a mais.

**Justificativa:** segue o texto literal do RF-07 ("aplicado a cada senha da lista, na mesma ordem"). Com uma senha só, a sequência é idêntica à atual: selo atual, depois legado. Duas passagens não economizam derivações de 8192 iterações: as duas opções fazem o mesmo número delas. A única diferença seria a ordem das tentativas legadas, e ela não muda o resultado, porque um cookie abre com uma senha só. O risco de dobrar tentativas citado no PRD (`prd.md:170`) é pequeno em CPU, porque a tentativa legada custa cerca de 1/8192 de uma tentativa completa. A medição fica fora da suíte, como o PRD pede.

### D-03 — Erros durante as tentativas e resultado de falha

**Escolha:** qualquer erro de uma tentativa só faz o laço seguir para a próxima. Se nenhuma senha abrir, `unsealSession` lança o **primeiro** erro. As checagens de `maxAge`/`idleTimeout` rodam só depois que uma senha abriu.

**Alternativas consideradas:**

- *Parar no primeiro erro que não seja HMAC.* Rejeitada: o erro `"Password string too short"` (`src/utils/internal/iron-crypto.ts:193`) é específico de uma senha. Se ele parasse o laço, uma extra curta esconderia as extras seguintes.
- *Lançar o erro da última tentativa.* Rejeitada: para configuração com uma senha só, o primeiro erro é o mesmo que a versão atual lança, então RF-05 fica garantido.
- *Repetir as checagens de expiração para cada senha.* Rejeitada: se uma senha abriu o selo e ele está expirado, outra senha não vai mudar o resultado. Tentar de novo só gastaria CPU.

**Justificativa:** `getSession` engole qualquer erro (`src/utils/session.ts:197`), então o resultado de falha é a sessão vazia, como em RF-06. O primeiro erro preserva a mensagem atual para quem chama `unsealSession` diretamente.

### D-04 — Sinalização da abertura com extra e migração

**Escolha:** um símbolo interno novo `kUnsealedWithExtra`, definido em `src/utils/internal/session.ts` seguindo o padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`). `unsealSession` o marca quando a senha que abriu não é `config.password`. `getSession` lê o marcador, remove-o antes de `Object.assign`, e inclui a condição na regravação existente (`src/utils/session.ts:214`).

**Alternativas consideradas:**

- *Devolver um objeto `{ session, usedExtra }` de `unsealSession`.* Rejeitada: mudaria o tipo de retorno de uma função pública, o que vai contra RF-08.
- *Comparar a senha usada dentro de `getSession`.* Rejeitada: `getSession` não sabe qual senha abriu o selo. Só `unsealSession` sabe.

**Justificativa:** reaproveita o mecanismo que o selo legado já usa, sem tocar na assinatura pública. A regravação passa por `updateSession` → `sealSession`, que já sela com `password` (D-05).

### D-05 — Selagem sempre com `password`

**Escolha:** nenhuma mudança em `sealSession` (`src/utils/session.ts:282`). O teste de RF-03 garante o comportamento.

**Justificativa:** `sealSession` já usa `config.password` (`src/utils/session.ts:300`). Mudar a origem da senha de selagem seria risco sem ganho.

### D-06 — Deduplicação das senhas

**Escolha:** a lista de tentativas é `[...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])]`. O `Set` mantém a primeira ocorrência, então `password` fica sempre na frente. Uma extra igual à atual some sem derivação extra e sem erro. Extras repetidas também são removidas.

**Alternativas consideradas:** ignorar a extra igual com um `filter`, sem tirar as repetidas entre extras. Rejeitada, porque o `Set` resolve os dois casos com uma linha.

**Justificativa:** é a decisão 1 do PRD (`prd.md:154`).

### D-07 — Migração só para sessões vindas por cookie

**Escolha:** a regravação de RF-04 vale só para sessões lidas do cookie, igual à regravação do selo legado (`src/utils/session.ts:214`, `sessionFromCookie`). Sessões lidas do header com senha extra continuam abrindo com a extra até expirar.

**Alternativas consideradas:** regravar também no header. Rejeitada: a resposta não tem como devolver o header de sessão. O próprio `docs/4.examples/handle-session.md:180` diz que sessões de header não deslizam.

**Justificativa:** RF-04 pede "todo caminho de leitura", mas também manda seguir o mesmo modo do selo legado, e nesse modo o header não entra. **Ponto a confirmar:** a leitura mais literal do RF-04 não é implementável para header. Recomendo a paridade com o legado e registrar a limitação no PR. Essa limitação também tem custo de desempenho: uma sessão de header com extra paga a derivação extra em toda requisição até expirar, sem nunca ser regravada.

### D-08 — Sem validação nova das extras

**Escolha:** nenhuma validação além da que `generateKey` já faz (tamanho mínimo de 32 caracteres, `src/utils/internal/iron-crypto.ts:192-196`).

**Justificativa:** é a decisão 3 do PRD (`prd.md:156`). A consequência é que uma extra curta nunca abre sessão e o erro some no `.catch` de `getSession` (`src/utils/session.ts:197`). Registrado em "Riscos".

## 4. Arquivos a alterar

| Arquivo | Mudança | Referência |
| --- | --- | --- |
| `src/utils/session.ts` | Novo campo `extraUnsealPasswords` com JSDoc (RF-09), logo após `password` | campo `password` em `src/utils/session.ts:48`; inserir antes do JSDoc de `maxAge` em `src/utils/session.ts:49` |
| `src/utils/session.ts` | Importar `kUnsealedWithExtra` | `src/utils/session.ts:5` |
| `src/utils/session.ts` | `getSession`: ler e remover o marcador; incluir na condição de regravação | `src/utils/session.ts:199-201` e `src/utils/session.ts:214` |
| `src/utils/session.ts` | `unsealSession`: laço de senhas, fallback por senha, marcação, checagens depois do laço | `src/utils/session.ts:317-348` |
| `src/utils/internal/session.ts` | Definir o símbolo `kUnsealedWithExtra` | após `src/utils/internal/session.ts:9` |
| `test/session.test.ts` | Bloco novo de testes (seção 6) | inserir depois dos testes de legado em `test/session.test.ts:186`, dentro de `describeMatrix` |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/package.test.ts`, `docs/`, `sdd/pedido.md`.

## 5. Contratos e assinaturas

### 5.1 Campo público (único nome novo)

```ts
export interface SessionConfig {
  /** … */
  password: string;
  /**
   * Previous passwords that only open sessions and are never used to seal them.
   * H3 tries `password` first, then each extra in order, and stops at the first one that opens the session.
   * Each extra password adds one key derivation to every request whose cookie does not open with `password`, so a cookie that opens with none of them costs one derivation per entry in the list.
   * Remove an extra only after its cookie sessions have been resealed on read or have expired under `maxAge`/`idleTimeout`, and only when one of those options is set, since otherwise unread sessions never expire.
   * Sessions opened with an extra are resealed with `password` when read from a cookie, so responses carry a `Set-Cookie` during the rotation window; sessions read from a header are not resealed.
   */
  extraUnsealPasswords?: string[];
  maxAge?: number;
  // …
}
```

O JSDoc tem cinco frases, uma para cada item de RF-09 (`prd.md:116-122`). O `automd` só renderiza JSDoc de funções em `docs/2.utils/4.security.md:44-63`, então o campo não muda a documentação gerada.

### 5.2 Símbolo interno

```ts
// src/utils/internal/session.ts
export const kUnsealedWithExtra: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-unseal",
);
```

### 5.3 Funções públicas: assinaturas inalteradas

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

`useSession`, `getSession`, `updateSession`, `sealSession` e `clearSession` mantêm a assinatura atual.

### 5.4 Esboço do corpo de `unsealSession` (não é o código final)

```ts
const passwords = [...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])];
const legacyAllowed = config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1;
let firstError: unknown;
let unsealed: Partial<Session> | undefined;
let usedExtra = false;
let usedLegacy = false;

outer: for (const password of passwords) {
  try {
    unsealed = await unseal(sealed, password, sealOptions);
  } catch (error) {
    firstError ??= error;
    if (!legacyAllowed || !(error instanceof Error) || error.message !== "Bad hmac value") continue;
    try {
      unsealed = await unseal(sealed, password, legacyOptions);
      usedLegacy = true;
    } catch {
      continue;
    }
  }
  usedExtra = password !== config.password;
  break;
}
if (!unsealed) throw firstError;
if (usedLegacy) (unsealed as any)[kLegacySeal] = true;
if (usedExtra) (unsealed as any)[kUnsealedWithExtra] = true;
// … checagens de maxAge e idleTimeout inalteradas
```

`legacyOptions` é o mesmo objeto que hoje é montado em `src/utils/session.ts:340-344`. O rótulo `outer:` é só ilustrativo; a implementação pode usar outra forma de sair do laço.

### 5.5 Mudança em `getSession`

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const extraSeal = unsealed && (unsealed as any)[kUnsealedWithExtra];
if (legacySeal) delete (unsealed as any)[kLegacySeal];
if (extraSeal) delete (unsealed as any)[kUnsealedWithExtra];
// … Object.assign(session, unsealed) continua igual, sem os marcadores
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

## 6. Estratégia de testes

Seguindo `AGENTS.md`, os testes são escritos antes da implementação e precisam falhar nesse estado. Ficam em `test/session.test.ts`, com `describeMatrix`, para rodar em `web` e `node`. Para testes com contagem, usar `vi.spyOn(globalThis.crypto.subtle, "deriveBits")` e restaurar com `mockRestore()` no `finally`, como o teste de throttle já faz com `encrypt` (`test/session.test.ts:413-414`).

**Senhas de teste com 32 caracteres ou mais.** Uma senha curta lança erro e some no `.catch`, então o teste passaria por motivo errado (D-08).

**Contagem de derivações.** Uma abertura com a senha atual faz duas derivações (integridade e decriptação). Uma tentativa com HMAC inválido faz uma. Os testes comparam contagens relativas à mesma requisição sem extras, e não números absolutos, para não depender de detalhes internos.

| Requisito | Teste | Como verificar |
| --- | --- | --- |
| RF-01 | Configuração com `extraUnsealPasswords` e sem o campo compila | Tipo `SessionConfig` em uma constante tipada; `pnpm typecheck` cobre `test/` (`tsconfig.json:25`) |
| RF-02 | Cookie com `"senha-antiga"` abre com `password: "senha-nova"` + extra | Corpo igual ao de uma sessão aberta só com a antiga |
| RF-02 | Com a senha atual correta, a extra não é tentada | Contagem de `deriveBits` igual à de uma requisição sem extras |
| RF-02 | Extra certa depois de extra errada | Contagem = baseline + uma tentativa com HMAC inválido |
| RF-03 | Cookie novo abre com `"senha-nova"` e não abre com `"senha-antiga"` | `unseal` direto nas duas senhas (`test/session.test.ts:157` mostra o padrão) |
| RF-04 | `getSession` com cookie antigo devolve `Set-Cookie` que abre com a nova | Cookie da resposta decodificado e aberto só com a nova |
| RF-04 | Segunda leitura do cookie regravado não gera `Set-Cookie` | `headers.getSetCookie()` vazio |
| RF-04 | Sessão lida do header com extra não gera `Set-Cookie` | Decisão D-07 |
| RF-05 | `undefined`, `[]` e ausente produzem a mesma resposta (corpo, cookies, erros) | Comparação entre as três configurações e com valores de referência (corpo, cabeçalhos, erros) capturados no código anterior à mudança. Sem esses valores, o teste não prova que o comportamento não mudou |
| RF-06 | Cookie selado com terceira senha: sessão vazia, sem erro, sem cookie novo | Corpo, cabeçalhos, `console.*` (espiados) e qualquer outro canal de log que o H3 use não contêm nenhuma das três senhas |
| RF-04 | Resposta com cabeçalhos já enviados: sessão válida, sem exceção, migração adiada | Simular o caso e checar corpo e ausência de erro |
| D-03 | Nenhuma senha abre com `unsealSession` direto: o erro é o mesmo da versão atual com uma senha | Comparar tipo e mensagem com o valor de referência capturado antes da mudança |
| RF-07 | Cookie legado (1 iteração) com a extra: aberto e regravado com a nova | Padrão de `test/session.test.ts:134-159` com senha extra |
| RF-07 | Legado com `legacySealFallback: false` e extra: rejeitado | Padrão de `test/session.test.ts:161-186` |
| D-06 | Extra igual a `password`: sem erro e sem derivação extra | Contagem igual à de requisição sem extras |
| D-03 | `maxAge` expirado com extra: sessão vazia e sem regravação | Corpo vazio e sem `Set-Cookie` |
| RF-08 | Snapshot de exports não muda | `test/unit/package.test.ts` passa sem alteração no snapshot |
| RF-08 | Diferença de tipos gerados | Manual: `pnpm build` antes e depois, comparar `dist/*.d.mts` |
| RF-09 | JSDoc com as cinco frases | Revisão de leitura |

**Ordem de execução (RF-10).** Os testes são escritos primeiro e rodados contra o código atual. Espera-se falha antes da mudança nos testes de abertura com extra (RF-02, RF-07), de regravação (RF-04) e de tipo (RF-01, que não compila sem o campo). Os demais são de preservação ou de limite e passam antes; por isso precisam de valores de referência capturados antes de qualquer edição, como RF-05 e D-03 indicam. Um teste de preservação que passa antes não prova a mudança, só que o comportamento antigo foi mantido.

**Suíte completa.** `pnpm lint`, `pnpm typecheck`, `pnpm vitest run test/session.test.ts` e depois `pnpm test`. Nenhum teste existente é removido. Se algum teste existente depender de comportamento que muda, a alteração precisa manter o que ele verifica e ser descrita no PR (`prd.md:130`).

**Desempenho.** Medição de custo do fallback e das extras fica fora da suíte, como pede `prd.md:170`.

## 7. Riscos

1. **Custo de CPU por extra.** Cada tentativa com HMAC inválido custa uma derivação PBKDF2 de 8192 iterações. Um cliente com cookies inválidos de propósito paga isso por extra, em toda requisição. O PRD trata isso com documentação e a decisão 2 (`prd.md:155`). **Mitigação:** manter o JSDoc (RF-09) e medir em uso real.
2. **Senha extra curta falha em silêncio.** Abaixo de 32 caracteres, `generateKey` lança (`src/utils/internal/iron-crypto.ts:192-196`), o erro some em `getSession` (`src/utils/session.ts:197`) e a sessão aparece vazia sem aviso. RF-06 proíbe log. **Mitigação:** teste que documenta o comportamento e recomendação de validação como item à parte. Ver D-08.
3. **Senha antiga válida enquanto estiver na configuração.** Quem vazou a senha antiga abre ou forja sessões até ela ser removida. **Mitigação:** RF-09 manda documentar a remoção, e a regravação (RF-04) acelera a saída das sessões antigas.
4. **Migração em cookie não cobre header.** Ver D-07. Sessões de header com extra continuam válidas até expirar e pagam a derivação extra em toda requisição nesse período.
5. **Testes de contagem dependem de detalhes internos.** Se `iron-crypto.ts` passar a derivar de outra forma, os números de contagem mudam. **Mitigação:** comparações relativas (seção 6), e não valores absolutos.
6. **Regravação gera `Set-Cookie` durante a janela de rotação.** Esperado e documentado (RF-09). Afeta cache de respostas nessa janela.
7. **Mudança de comportamento de `unsealSession` para quem chama direto.** Quem passa `extraUnsealPasswords` ao chamar a função pública passa a ter a nova regra. É o comportamento pretendido.
8. **Documentação do `iterations` desatualizada** em `src/utils/internal/iron-crypto.ts:377`. Fora de escopo deste trabalho; vale um item separado.

## 8. Pendências para confirmar

- **D-07:** confirmar que a migração fica restrita a sessões de cookie, como o legado. O texto literal do RF-04 pede "todo caminho de leitura".
- **D-08:** confirmar que extras não ganham validação própria nesta entrega.
- **useSession:** confirmar que `useSession` chama `getSession` e não tem caminho próprio de abertura. Se tiver, a marcação de D-04 e a regravação de RF-04 precisam ser replicadas ali (`prd.md:63`). A spec ainda não verificou isso.
- **Resposta já enviada:** confirmar o que `updateSession` faz quando o cookie não pode ser definido (RF-04, `prd.md:65`). A seção 5.5 ainda não cobre esse caminho.
- **Remoção de extras:** decidir se a documentação aceita que, sem `maxAge` nem `idleTimeout`, uma senha antiga fica ativa para sempre, ou se exige uma regra de corte. O JSDoc da seção 5.1 hoje só diz que a remoção depende de regravação ou expiração.
- **Citações:** reconferir os `arquivo:linha` desta versão antes de implementar (ver seção 2).
- **Números de custo do RF-09:** a afirmação "uma derivação por requisição com cookie que não abre com a atual" vale para a tentativa com o selo atual. A tentativa legada é quase gratuita (1 iteração), então não entra na conta de custo.
