# Especificação técnica — Múltiplas senhas de unseal nas sessões (h3js/h3#1050)

Base: contrato `sdd/pedido.md` (variante 1-b: campo `extraUnsealPasswords`) e requisitos RF-01 a RF-11 de `sdd/prd.md`. Esta especificação segue o código como está no branch `master` (versão 2.0.8 do pacote). Os números de linha foram conferidos no código na versão anterior desta spec. Esta revisão não os reconferiu, então devem ser checados de novo antes da implementação.

## 0. Divergências entre o PRD e o código

Antes das decisões, três pontos em que o PRD não bate com o repositório. A especificação segue o código; o PRD deve ser corrigido.

| Tema | PRD | Código | Consequência |
| --- | --- | --- | --- |
| Nome da opção de fallback legado | `rejectLegacySeal` (RF-06, RF-08, Riscos) | `legacySealFallback`, marcada como `@deprecated` em `src/utils/session.ts:95` | A spec usa `legacySealFallback`. O comportamento é o mesmo: `=== false` desliga o fallback (`src/utils/session.ts:333`). |
| Typecheck no lint | RF-10 e "Decisões pendentes" 5 dizem que `pnpm lint` inclui o typecheck, por causa do AGENTS.md | `package.json:46` define `lint` como `oxlint . && oxfmt --check .`. O typecheck é o script separado `typecheck` (`package.json:54`, `tsc --noEmit`). `AGENTS.md:18` está errado ao dizer que o lint inclui typecheck. | RF-10 deve exigir `pnpm lint` **e** `pnpm typecheck`. O AGENTS.md pode ser corrigido em mudança separada. |
| Custo do fallback legado | Riscos: "se o fallback legado também for tentado para cada senha, o pior caso dobra" | Uma tentativa legada usa 1 iteração de PBKDF2 (`src/utils/session.ts:340-344`). A tentativa normal falha no HMAC depois de derivar a chave de integridade com 8192 iterações (`src/utils/internal/iron-crypto.ts:133`). | O custo dominante é de `N + 1` derivações de 8192 iterações (`N` = número de senhas). A tentativa legada custa quase nada. O PRD deve ser corrigido. Ainda assim, medir com `pnpm bench:node`. |

Pendências do PRD, com a recomendação desta spec, estão na seção 9.

## 1. Estado atual relevante

- `SessionConfig.password` é a única senha (`src/utils/session.ts:48`). Ela sela (`sealSession`, `src/utils/session.ts:300`) e abre (`unsealSession`, `src/utils/session.ts:324`).
- `unsealSession` (`src/utils/session.ts:312-367`) é exportado publicamente (`src/index.ts:209`). Ele tenta a senha com as iterações atuais e, se o erro for `"Bad hmac value"` e o fallback não estiver desligado, tenta de novo com 1 iteração (`src/utils/session.ts:325-348`). Marca o resultado legado com `kLegacySeal` (`src/utils/session.ts:346`). Depois verifica `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`).
- `getSession` chama `unsealSession` no caminho de leitura (`src/utils/session.ts:196`). Antes de copiar o resultado para a sessão, remove o marcador legado (`src/utils/session.ts:199-201`) e copia o resto com `Object.assign` (`src/utils/session.ts:208`). Depois regrava o cookie se houver `kLegacySeal` ou se `shouldSlide` for verdadeiro (`src/utils/session.ts:214-216`).
- A regravação só acontece para sessões vindas do cookie. Sessões vindas do header (`x-{name}-session`) não podem ser regravadas (`src/utils/session.ts:190-193`, e o comentário em `src/utils/session.ts:63-65`).
- A escrita do cookie passa por `updateSession`, que só sela e grava quando `config.cookie !== false` e `event.res` existe (`src/utils/session.ts:266-274`). `H3Event.res` é um getter preguiçoso que sempre devolve um objeto (`src/event.ts:128-130`). Por isso RF-04 tem caminho de escrita em qualquer rota (resposta à pendência 3 do PRD).
- Os marcadores internos são símbolos `k*` em `src/utils/internal/session.ts:7-9` (`kLegacySeal`). Não são exportados por `src/index.ts`.
- `unseal` (`src/utils/internal/iron-crypto.ts:87`) rejeita com `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:136`) quando a senha não confere. Outros erros (`"Expired seal"`, `"Incorrect number of sealed components"`, `"Wrong mac prefix"`, senha curta ou vazia) não têm relação com a senha. A senha curta vem de `generateKey` (`src/utils/internal/iron-crypto.ts:192-194`).
- Testes: `test/session.test.ts` existe (777 linhas), usa `describeMatrix` (`test/session.test.ts:15`) e já cobre o fallback legado (`test/session.test.ts:134` e `test/session.test.ts:161`), idle (`test/session.test.ts:188`) e maxAge (`test/session.test.ts:375`). `test/unit/package.test.ts:149` verifica a lista de exports públicos, o que serve de guarda para RF-09.

## 2. Decisões de arquitetura

### D-01 — A lista de senhas fica dentro de `unsealSession`

**Escolha:** `unsealSession` percorre `[config.password, ...config.extraUnsealPasswords]` na ordem declarada e para na primeira que abrir o cookie. A assinatura pública não muda, e `getSession` continua chamando a mesma função.

**Alternativas consideradas:**
- *Loop dentro de `getSession`:* `getSession` então repetiria a lógica de tentativas, expiração e legado, e `unsealSession` (exportado) continuaria sem as senhas extras. Divergência entre os dois caminhos.
- *Usar o `PasswordHash` nativo do iron (`unseal` aceita um objeto `{ id: senha }`, `src/utils/internal/iron-crypto.ts:122-126`):* o id vem do próprio cookie selado. Os cookies atuais têm id vazio, que vira `"default"`. Com um hash só é possível uma tentativa por id, e a mudança exigiria um mapa com ids para senhas antigas que já foram selados sem id. Além disso, o formato do selo mudaria. Descartada.

**Justificativa:** `unsealSession` é o único ponto que chama `unseal` e já concentra o legado e a expiração. Colocar o loop ali deixa a expiração aplicada uma vez, sobre o resultado que abriu, e mantém a assinatura pública (RF-09).

### D-02 — Marcador interno para "aberta por senha extra"

**Escolha:** `unsealSession` marca o resultado com um símbolo interno `kOpenedByExtraPassword`, em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal`. `getSession` lê e apaga o marcador antes de `Object.assign`.

**Alternativas consideradas:**
- *Retornar uma tupla ou um objeto `{ session, resealNeeded }`:* quebra o tipo público de `unsealSession` (`Promise<Partial<Session>>`). Descartada.
- *Comparar o cookie com o selo que a senha atual produziria:* exige selar de novo só para comparar. Mais caro e sem ganho. Descartada.

**Cuidado:** o marcador precisa ser removido antes de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`). `Object.assign` copia símbolos enumeráveis, então um marcador esquecido iria para a sessão. É o mesmo cuidado que já existe para `kLegacySeal` (`src/utils/session.ts:199-201`).

### D-03 — A regravação de RF-04 entra na mesma condição do legado

**Escolha:** em `getSession`, a condição de regravação (`src/utils/session.ts:214`) passa a ser `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))`. A regravação usa `updateSession` sem nenhum código novo, o que atende RF-04 ("o usuário da biblioteca não precisa chamar nada a mais").

Sessões vindas do header ficam de fora, como já acontece com o legado (`sessionFromCookie` é falso). Elas abrem com as senhas extras, mas não recebem `Set-Cookie`. O PRD diz "a resposta" (RF-04); a spec deixa explícito que vale só para cookie.

**Alternativa:** regravar sempre que a senha aberta não for `password`, sem marcador. Descartada, porque o marcador já é o padrão e permite distinguir `extraSeal` de `legacySeal` nos testes.

### D-04 — Em cada senha, a ordem é formato atual e depois legado

**Escolha:** para cada senha da lista, primeiro tenta o formato atual e, se o HMAC falhar e `legacySealFallback !== false`, tenta o formato legado. Só então passa para a próxima senha. Isso segue RF-03 (item 1: `password` com ou sem legado; item 2: cada extra "com o mesmo critério") e RF-08.

**Custo:** pela seção 0, o legado custa uma derivação de 1 iteração. Não multiplica o custo dominante.

### D-05 — Só `"Bad hmac value"` passa para a próxima senha

**Escolha:** qualquer erro que não seja `"Bad hmac value"` é relançado na hora. Isso vale para `"Expired seal"`, formato inválido, prefixo errado e senha curta ou vazia. Um cookie que falha por esses motivos falha para qualquer senha, então tentar as outras só gastaria PBKDF2.

**Consequência:** a expiração por `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) só é checada depois que alguma senha abre, e vale para qualquer senha (RF-07). Já `Expired seal`, se vier do `ttl` do iron, é um erro que não é `"Bad hmac value"`: é relançado na primeira tentativa. Confirmar ao implementar se `sealOptions` define `ttl`. Se não define, esse erro não ocorre neste fluxo.

**Erro a evitar:** se a lista tiver uma senha vazia ou curta, `generateKey` lança antes de chegar ao HMAC de uma senha válida. Isso impediria abrir sessões seladas com as senhas que vêm depois. Ver D-06.

### D-06 — Validação de senhas extras curtas ou vazias

**Escolha:** no início de `unsealSession`, antes do loop, lançar `Error` quando alguma entrada de `extraUnsealPasswords` tiver menos de `sealOptions.encryption.minPasswordlength` caracteres (32 por padrão, `src/utils/internal/iron-crypto.ts:22`). A mensagem indica o índice. `getSession` continua engolindo o erro (`src/utils/session.ts:197`), como já faz com senha curta em `password`, então a falha aparece como sessão inválida, não como exceção.

**Alternativas consideradas:**
- *Ignorar silenciosamente as senhas curtas:* o erro de configuração some e a rotação falha sem sinal. Descartada.
- *Não validar:* a falha vira "Password string too short" no meio do loop e impede sessões válidas. Descartada.

**Limite:** é uma validação só de tamanho e de tipo (`string`). Não há como detectar senha extra igual à atual sem perguntar ao usuário. Pode ser aceitável, porque é só uma comparação de strings e não muda o resultado.

### D-07 — Sem limite de quantidade no código

**Escolha:** nenhuma validação de número máximo de senhas extras. O PRD propõe 3 (pendência 4). A spec recomenda deixar isso só na documentação do JSDoc, porque (a) RF-09 veta novas opções, (b) um limite no código seria uma regra a mais que o pedido não pediu, e (c) o custo cresce de forma linear e é documentado na seção 6.

### D-08 — A extensão da janela de inatividade por regravação é aceita

**Escolha:** quando a regravação acontece, `sealSession` grava `lastSeenAt = Date.now()` (`src/utils/session.ts:297`), mesmo que a sessão ainda estivesse dentro da metade da janela (onde `shouldSlide` não regravaria). Isso é aceito, porque a requisição é real e a janela é contada a partir dela. O `maxAge` não é estendido, porque `createdAt` não muda (`src/utils/session.ts:351`) e a data do cookie é o mínimo entre `createdAt + maxAge` e `lastSeenAt + idleTimeout` (`src/utils/session.ts:455-463`). O PRD (RF-07) precisa ser reescrito para dizer isso com essas palavras.

### D-09 — Sem mudança em `iron-crypto.ts`, `index.ts` ou `SealOptions`

**Escolha:** nenhuma mudança fora de `src/utils/session.ts` e `src/utils/internal/session.ts`. Isso atende RF-09 e evita mexer no formato do selo.

### D-10 — Rotação em duas fases, não em um deploy só

**Escolha:** o procedimento de rotação do PRD passa a ter dois deploys antes da remoção:
1. Deploy A: `password` = senha antiga, `extraUnsealPasswords` = `[senha nova]`. Nada é selado com a senha nova ainda, mas todas as instâncias passam a conseguir abri-la.
2. Esperar até todas as instâncias estarem no deploy A (o operador confirma que o deploy rolante terminou).
3. Deploy B: `password` = senha nova, `extraUnsealPasswords` = `[senha antiga]`. A partir daqui o selo muda.
4. Esperar `maxAge` desde o deploy B e remover a senha antiga (deploy C).

**Por quê:** durante um deploy rolante, uma instância com a configuração antiga não abre cookie selado com a senha nova. Com um deploy único, usuários são deslogados de forma aleatória enquanto as instâncias convivem. Esta mudança não resolve isso no código; é o procedimento que resolve. O PRD (passo 2 de "Procedimento de rotação") precisa ser reescrito.

**Custo:** dois deploys a mais, mais o tempo entre eles.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:39-99` | Adicionar `extraUnsealPasswords?: string[]` em `SessionConfig`, com JSDoc (seção 4.1). |
| `src/utils/session.ts:5` | Importar `kOpenedByExtraPassword`. |
| `src/utils/session.ts:194-221` | Em `getSession`: ler e apagar o marcador (antes de `Object.assign` em `:208`), e incluir `extraSeal` na condição de regravação em `:214`. |
| `src/utils/session.ts:312-367` | Em `unsealSession`: loop sobre as senhas, `unsealWithPassword` (novo, interno), `isBadHmac` (novo, interno), validação de tamanho (D-06). Expiração em `:350-365` fica como está. |
| `src/utils/internal/session.ts:7-9` | Novo símbolo `kOpenedByExtraPassword`. |
| `test/session.test.ts:777` | Novo `describe` com os testes da seção 5, antes do `});` final. Nenhuma asserção existente muda. |

Não alterar: `src/index.ts`, `src/utils/internal/iron-crypto.ts`, `docs/`, `AGENTS.md`, `package.json`.

## 4. Contratos e assinaturas

### 4.1 Tipo público

```ts
export interface SessionConfig {
  /** ... (sem mudança; ver JSDoc de `password` em src/utils/session.ts:41-47) */
  password: string;
  // ...
  /**
   * Previous passwords that can still open existing sessions, but never seal new ones.
   *
   * Sessions are unsealed by `password` first, then by each entry here in declared order,
   * stopping at the first one that opens the cookie. A session opened by an entry from this
   * list is resealed with `password` on that request (cookie-based sessions only).
   *
   * Remove an entry once the rotation window has passed: at least `maxAge` after the deploy
   * that made `password` the new password (deploy B of D-10, not the deploy that first added
   * it as an extra). Without `maxAge`, the window has no end, so remove it by manual decision.
   */
  extraUnsealPasswords?: string[];
  // ...
}
```

JSDoc em inglês, como o resto de `SessionConfig` (`src/utils/session.ts:41-99`). RF-11 pede que responda: a senha sela (não), a ordem (declarada) e quando remover (depois de `maxAge`). Não tem `@default`, porque o padrão é "nenhuma".

### 4.2 `unsealSession` (assinatura pública inalterada)

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Comportamento:
1. `sealOptions` igual ao atual (`src/utils/session.ts:317-321`).
2. Validar `extraUnsealPasswords` (D-06): lança `Error` com o índice da entrada curta.
3. Para cada `password` em `[config.password, ...(config.extraUnsealPasswords || [])]`, na ordem:
   - `unsealWithPassword(sealed, password, sealOptions, legacyAllowed)`.
   - Se lançar erro que não seja `isBadHmac`, relança.
   - Se for `isBadHmac`, guarda o primeiro erro e continua.
   - Se abrir, para. Se o índice for maior que 0, marca `kOpenedByExtraPassword = true`.
4. Se nenhuma abrir, relança o primeiro erro guardado. A mensagem continua sendo `"Bad hmac value"`, como hoje.
5. Expiração (`maxAge`, `idleTimeout`) sobre o resultado, sem mudança.

Usar um flag `opened: boolean` em vez de checar `unsealed` depois do loop, porque `unseal` pode devolver `null` (`src/utils/internal/iron-crypto.ts:149`, `decrypted ? JSON.parse(decrypted) : null`) e `throw undefined` seria ruim.

### 4.3 Helpers internos (não exportados, no fim de `src/utils/session.ts`)

```ts
/** One unseal attempt with `password`: current format, then the legacy 1-iteration format. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacyAllowed: boolean,
): Promise<Partial<Session>>;

/** `unseal` reports a wrong password as "Bad hmac value", the only error that moves to the next password. */
function isBadHmac(error: unknown): boolean;
```

`unsealWithPassword` contém exatamente o que hoje está em `src/utils/session.ts:325-347`, com `password` no lugar de `config.password`. A condição de legado (`src/utils/session.ts:332-339`) vira `!legacyAllowed || sealOptions.integrity.iterations === 1 || !isBadHmac(error)`. `legacyAllowed` é `config.legacySealFallback !== false`.

`SealOptions` já é importado (`src/utils/session.ts:9`).

Marcadores: `unsealWithPassword` marca `kLegacySeal`, como hoje. `unsealSession` marca `kOpenedByExtraPassword`, e só quando o índice aberto é maior que 0. Um mesmo resultado pode ter os dois marcadores.

Erro relançado: se o legado também falhar, `unsealWithPassword` deve relançar o erro do formato atual, que é `"Bad hmac value"` quando a senha não confere. Confirmar com o código atual que a mensagem final é a mesma de hoje.

### 4.4 Marcador interno

```ts
// src/utils/internal/session.ts
export const kOpenedByExtraPassword: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-unseal",
);
```

Mesmo formato de `kLegacySeal` (`src/utils/internal/session.ts:7-9`).

### 4.5 Trecho de `getSession` (esboço)

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const extraSeal = unsealed && (unsealed as any)[kOpenedByExtraPassword];
if (legacySeal) {
  delete (unsealed as any)[kLegacySeal];
}
if (extraSeal) {
  delete (unsealed as any)[kOpenedByExtraPassword];
}
// ... (linhas 205-208 sem mudança)
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

O acesso aos símbolos segue o padrão de `kLegacySeal` no código atual. Se o lint reclamar do tipo usado para acessá-los, usar a mesma solução ali.

### 4.6 Compatibilidade

- Sem `extraUnsealPasswords` (ou `[]`), a lista de tentativas tem um único item. O resultado é igual ao de hoje: mesma ordem, mesmo legado, mesma mensagem de erro, sem marcador extra (RF-06).
- O tipo de `password` continua `string` (RF-01).
- Nenhum export novo (RF-09). `test/unit/package.test.ts:149` continua válido.

## 5. Estratégia de testes

Seguir o AGENTS.md: escrever os testes primeiro, confirmar que falham, depois implementar. Todos com `describeMatrix`, para rodar em `web` e `node`. Novo `describe("extraUnsealPasswords", ...)` dentro de `describeMatrix("session", ...)`, em `test/session.test.ts`, antes do `});` final (linha 777). Usar `seal` e `sealDefaults` de `src/utils/internal/iron-crypto.ts` (já importados em `test/session.test.ts:12`) para selar com a senha antiga, como os testes de legado já fazem (`test/session.test.ts:134-158`).

| Teste | Requisito | Verificação |
| --- | --- | --- |
| Cookie selado com a senha atual, com extras configuradas | RF-02 | Dados iguais, `getSetCookie()` vazio. |
| Cookie selado com a 1ª extra | RF-03 | `getSession` devolve os dados. |
| Cookie selado com a 2ª extra, sem a 1ª casar | RF-03 (ordem) | Abre na 2ª, sem erro. |
| Cookie selado com a senha atual e também presente em extras | RF-03 (ordem) | Abre na primeira tentativa, sem regravação. |
| Cookie selado com `"C..."` (não listada) | RF-05 | Sessão vazia, sem exceção, mesmo resultado de cookie inválido. |
| Cookie aberto por extra é regravado | RF-04 | Um `Set-Cookie` com selo novo. Descriptografar com `unseal(…, password, sealDefaults)` e conferir os dados. |
| Depois da regravação, a configuração sem extras abre o cookie | RF-04 (convergência) | Segunda requisição sem extras, dados iguais, sem `Set-Cookie`. |
| `extraUnsealPasswords: []` com cookie legado | RF-06 | Mesmo resultado do teste de `test/session.test.ts:134`. |
| Cookie selado com extra e `createdAt` além de `maxAge` | RF-07 | Sessão vazia (com `vi.useFakeTimers` como em `test/session.test.ts:375`). |
| Cookie selado com extra e `lastSeenAt` além de `idleTimeout` | RF-07 | Sessão vazia. |
| Regravação de cookie extra com `idleTimeout` ativo | RF-07 (D-08) | `lastSeenAt` do novo selo igual à hora da requisição. |
| Cookie legado selado com extra, sem `legacySealFallback` | RF-08 | Aberto e regravado com as iterações atuais. |
| Cookie legado selado com extra, `legacySealFallback: false` | RF-08 | Rejeitado, sem `Set-Cookie`. |
| Cookie no header (`x-h3-test-session`) selado com extra | D-03 | Dados devolvidos, sem `Set-Cookie`. |
| Extra vazia ou curta (`""`, `"123"`) | D-06 | `unsealSession` lança `Error` com o índice; `getSession` devolve sessão vazia. |
| Duas extras, cookie da segunda, com legado | RF-03, D-04 | Abre na 2ª, regrava com a atual, sem erro. |
| Marcadores não vazam | D-02 | A sessão devolvida por `getSession` não tem símbolos `kOpenedByExtraPassword` nem `kLegacySeal`, e o JSON da resposta não contém dados internos. |
| Configuração de deploy A abre cookie da senha nova | D-10 | `password` antiga com extra nova abre cookie selado com a nova: dados devolvidos. |
| Configuração antiga não abre cookie da senha nova | D-10 | `password` antiga sem extras rejeita cookie selado com a nova: sessão vazia. Documenta por que o deploy A é necessário. |
| Cookie com prefixo inválido não tenta extras | D-05 | `unsealSession` rejeita com a mensagem de prefixo, não com `"Bad hmac value"`. Que as extras não são tentadas não aparece no resultado. A garantia vem do código (seção 10). `vi.spyOn` em export ESM não é confiável. |

Testes existentes: não mudar asserção (RF-06, RF-10). Se a suíte existente não cobrir algum caminho de unseal (risco "Regressão silenciosa" no PRD), acrescentar casos antes da mudança. Pelo que foi lido, o legado (`:134`, `:161`), idle (`:188`, `:231`, `:265`, `:311`, `:344`), maxAge (`:375`) e cabeçalho (`:311`) já estão cobertos. Sem cobertura: sessão de header com legado.

**Comandos de verificação:**
- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/package.test.ts` (superfície pública, RF-09)
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (antes do PR, inclui cobertura)
- `pnpm bench:node` (opcional nesta mudança, mas recomendado para o limite da lista: pendência 4)

## 6. Desempenho

- Custo por requisição com cookie que não abre pela senha atual: `N + 1` derivações de PBKDF2 com 8192 iterações (uma por senha), mais `N + 1` tentativas legadas de 1 iteração. Se o cookie for de senha extra `k`, o custo é `k + 1` derivações.
- Custo de cookie que abre pela senha atual: igual ao de hoje.
- Após a rotação, cada cookie é regravado uma vez. A partir daí o custo é igual ao de hoje.
- Sessões de header (D-03) nunca convergem. Cada requisição com cookie de extra paga `k + 1` derivações até a sessão expirar ou a extra sair da lista. Com API que usa header em volume, isso pesa mais que o caso do cookie.
- O bench do projeto (`test/bench/bench.ts`, via `pnpm bench:node`) deve ser executado com 0, 1 e 3 extras para documentar o custo. Não foi executado nesta especificação.

## 7. Estratégia de rollout

1. Testes novos, que falham antes da implementação (seção 5).
2. Implementação em `src/utils/session.ts` e `src/utils/internal/session.ts`.
3. `pnpm lint`, `pnpm typecheck`, `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`.
4. Sem mudança em `docs/` (RF-11 e a seção "Fora de escopo" do PRD dizem que a documentação pública fica fora de escopo). Anotar para a próxima rodada: `docs/2.utils/4.security.md:60` descreve `unsealSession` e vai precisar de uma linha sobre a lista.
5. Rollback. Voltar o código para a versão sem a feature é seguro só antes do deploy B (D-10). Depois dele, cookies selados com a senha nova não abrem no código antigo, e quem foi regravado perde a sessão. Voltar só a configuração do deploy B para a do deploy A é seguro, desde que a senha antiga continue em `extraUnsealPasswords`.
6. `pnpm test` (com cobertura) antes de abrir o PR, além dos comandos da seção 5.

## 8. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| Marcador de `kOpenedByExtraPassword` vazar para `session` via `Object.assign` | Média (fácil de esquecer) | Alto (campo indesejado na sessão e no JSON) | Apagar antes de `Object.assign` (4.5). Teste de regravação compara o objeto de sessão. |
| Senha curta ou vazia impede sessões válidas | Baixa, com D-06 | Alto | Validação no início de `unsealSession` (D-06). Teste dedicado. |
| Erro de configuração fica silencioso | Alta (`getSession` engole erros) | Médio | Documentar no JSDoc. O mesmo comportamento já existe para `password` (`src/utils/session.ts:197`). |
| Custo de CPU com muitas extras | Média | Médio | D-07, bench, JSDoc com a recomendação de remover logo. |
| Regravação por extra estende `lastSeenAt` antes da metade da janela | Certa (é o comportamento de D-08) | Baixo | Aceito (D-08). PRD precisa refletir isso em RF-07. |
| Requisições paralelas com o cookie antigo regravam várias vezes | Média | Baixo | Igual ao PRD. Os dados são os mesmos. |
| Cookie no header nunca é regravado | Certa | Baixo | Documentado (D-03). Sessões de header continuam com a senha antiga até expirar ou a extra sair da lista. |
| Remoção de extra antes do fim da janela deixa usuários deslogados | Média (depende do operador) | Alto | Procedimento de rotação no PRD. Recomendar `maxAge` definido. |
| Nome do campo do PRD (`rejectLegacySeal`) errado na documentação | Certa (já está errado) | Baixo | Corrigir o PRD (seção 0). |
| Deploy rolante com a senha nova em `password` derruba sessões nas instâncias antigas | Alta, se o procedimento for de um deploy só | Alto | Rotação em duas fases (D-10). |
| Rollback de código depois do deploy B desloga quem foi regravado | Média | Alto | Seção 7, item 5. |
| Sessões de header pagam `k + 1` derivações em toda requisição enquanto a extra estiver na lista | Alta | Médio | Medir com o bench (seção 6). Manter a lista curta e remover a extra assim que a janela acabar. |
| Diferença de tempo revela se o cookie abriu pela senha atual ou por extra | Baixa | Baixo | Só quem já tem o cookie pode medir. O HMAC impede forjar conteúdo. Aceito. |

## 9. Decisões pendentes do PRD: recomendações

| # | Pendência | Recomendação desta spec |
| --- | --- | --- |
| 1 | RF-04: confirmar regravação | Sim. Implementado em D-03. |
| 2 | Tamanho mínimo das extras | Validar no código, como descrito em D-06. Não é o mesmo que o `password` faz hoje (que só falha no seal). Confirmar se a equipe aceita. |
| 3 | Caminho de escrita | Confirmado: `updateSession` grava por `event.res` (`src/utils/session.ts:266-274`), que sempre existe em `H3Event` (`src/event.ts:128`). Vale para cookie, não para header (D-03). |
| 4 | Limite da lista e `maxAge` ausente | Sem limite no código (D-07). Recomendar 3 na documentação. Sem `maxAge` a janela não tem fim, e a remoção é manual. |
| 5 | Nomes dos comandos | `pnpm typecheck` existe (`package.json:54`). `pnpm lint` não inclui typecheck (`package.json:46`). Usar os dois. Corrigir `AGENTS.md:18` em mudança separada. `test/session.test.ts` existe. |
| 6 | Procedimento de rotação em um deploy | Trocar por duas fases (D-10). O PRD, em "Procedimento de rotação", passo 2, precisa mudar. |

Pontos novos, além dos do PRD:
- **Nome do campo de fallback legado.** A seção 0 trata da troca de `rejectLegacySeal` por `legacySealFallback`. O PRD precisa ser atualizado antes da implementação.
- **RF-07.** A redação precisa acompanhar D-08.
- **Custo do legado.** A seção 0 corrige o PRD.

## 10. Conferência

Antes de concluir a implementação, conferir:
- Nenhum export novo em `src/index.ts` e nenhum símbolo novo exportado de `src/utils/internal/session.ts`.
- Nenhuma asserção existente em `test/session.test.ts` foi alterada (diff só com adições).
- O marcador não aparece em `session` nem no JSON de resposta.
- O primeiro erro relançado é `"Bad hmac value"` quando nenhuma senha abre.
- `pnpm lint` e `pnpm typecheck` passam.
- Os testes novos foram executados antes da implementação e falharam. A saída fica anexada ao PR.
