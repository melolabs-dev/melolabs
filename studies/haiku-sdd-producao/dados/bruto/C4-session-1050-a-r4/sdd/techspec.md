# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-a) e `sdd/prd.md` (RF-01 a RF-08, premissas P1 a P4, riscos R1 a R6).

Esta especificação não altera código. As citações `arquivo:linha` foram conferidas no código do commit `2ad8f3f`.

## 1. Estado atual

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`), com JSDoc em `src/utils/session.ts:39-47`.
- `sealSession` sela com a senha única (`src/utils/session.ts:300-304`). `updateSession` chama `sealSession` em `src/utils/session.ts:267`.
- `unsealSession` abre com a senha única (`src/utils/session.ts:324`). Se falhar com `"Bad hmac value"`, tenta de novo com 1 iteração PBKDF2, que é o fallback legado (`src/utils/session.ts:325-344`). Sessões assim recebem a marca `kLegacySeal` (`src/utils/session.ts:346`).
- `getSession` chama `unsealSession` dentro de `.catch(() => {})` (`src/utils/session.ts:196-197`). Qualquer erro de leitura vira sessão nova, sem aviso.
- No iron (`src/utils/internal/iron-crypto.ts`):
  - O id do selo é gravado em texto no `macBaseString` (`iron-crypto.ts:79`).
  - Na abertura, o id vazio vira `"default"` (`iron-crypto.ts:121`).
  - Quando `password` é um objeto, a senha vem de `password[_passwordId]` (`iron-crypto.ts:122-128`).
  - Senha em string é validada quanto ao tamanho em `generateKey` (`iron-crypto.ts:191-196`), com mínimo de 32 (`iron-crypto.ts:22` e `iron-crypto.ts:28`).
- `seal`/`unseal` recusam senha vazia com `"Empty password"` (`iron-crypto.ts:65-67` e `iron-crypto.ts:94-96`). Um array vazio é truthy, então ele passa essa checagem e cai em outro erro genérico, sem mensagem clara.

## 2. Decisões de arquitetura

### D-01 — `password` aceita `string | string[]`, com validação em tempo de execução

**Escolha.** O tipo passa a ser `password: string | string[];` (`src/utils/session.ts:48`). A regra de lista não vazia e de tamanho mínimo é checada em runtime, pela função interna descrita em D-05.

**Alternativas.**
- *Tupla `[string, ...string[]]`.* Garantiria em tipo que a lista não é vazia. Rejeitada porque o RF-01 fixa `string | string[]`, e a tupla rejeita arrays dinâmicos, como os que vêm de `process.env.X.split(",")`. Quem configura a lista a partir de ambiente seria forçado a fazer asserção de tipo.
- *Campo novo, como `passwords` ou `extraUnsealPasswords`.* Rejeitada: o contrato proíbe novos nomes públicos (`sdd/pedido.md`, seção "Restrições").

### D-02 — Selar sempre com a primeira senha, sem id do iron

**Escolha.** `sealSession` chama `seal(session, passwords[0], {...})`. A assinatura de `sealSession` não muda.

Com uma string, `passwords[0]` é a própria string. O selo sai sem id, byte a byte igual ao de hoje. Isso garante RF-05.

**Alternativas.**
- *Selar com `{ id, secret }` (`PasswordSecret`, `iron-crypto.ts:413-417`) para marcar qual senha selou.* Rejeitada. O id vai em texto no selo (`iron-crypto.ts:79`), então muda o formato do cookie para quem usa lista. Além disso, cookies antigos, selados sem id, caem em `"default"` (`iron-crypto.ts:121`), e isso conflita com D-03.

### D-03 — Abrir tentando cada senha em ordem, sem mapa indexado por id (fecha P1)

**Escolha.** `unsealSession` percorre a lista na ordem declarada e chama `unseal` com uma string de cada vez. Para em `"Bad hmac value"`, que é o único erro específico de senha. Qualquer outro erro sobe imediatamente: `"Expired seal"`, `"Incorrect number of sealed components"` e erros de formato não dependem da senha. Se nenhuma senha abrir, sobe o último `"Bad hmac value"`. `iron-crypto.ts` não muda.

**Alternativas.**
- *Passar o mapa `PasswordHash` (`iron-crypto.ts:427`) ao `unseal`, como sugere P1.* Rejeitada. O lookup usa o id gravado no selo, e os cookies antigos têm id vazio, portanto caem em `"default"`. Com `["NOVA", "ANTIGA"]` e um mapa `{ default: NOVA }`, um cookie selado com `ANTIGA` nunca abre. Para o mapa funcionar seria preciso gravar ids por índice, o que volta ao problema de formato de D-02.
- *Escolher a senha pelo id do selo, sem tentar todas (mitigação de R1).* Adiada. Continua válida como otimização futura, sem mudar contratos. Não serve como solução única, porque cookies legados têm id vazio e precisam do laço de qualquer forma.

**Consequência.** P1 fica resolvida como "não reaproveitar o mapa". A PRD pede que isso seja confirmado, então fica registrado aqui.

### D-04 — Fallback legado por senha, reaproveitando o código existente

**Escolha.** O corpo atual do `try`/`catch` de `unsealSession` (`src/utils/session.ts:323-348`) vai para uma função interna `unsealWithPassword`, que recebe uma senha. O laço de D-03 chama essa função para cada senha. Assim, cada senha tenta primeiro as iterações atuais e depois o fallback de 1 iteração.

**Alternativas.**
- *Duas fases: todas as senhas com iterações atuais, depois todas com 1 iteração.* Faz uns poucos PBKDF2 a menos em alguns casos, mas duplica a lógica do fallback.

**Medição (R2).** Com 8192 iterações, uma derivação leva cerca de 2,8 ms. Com 1 iteração, cerca de 0,05 ms. Medido com `node v24.18.0` via `crypto.subtle` no ambiente deste projeto. A tentativa extra de 1 iteração por senha é desprezível, então a escolha por senha é segura.

### D-05 — Validar a lista antes do `catch` de `getSession`

**Escolha.** Uma função interna `sessionPasswords(config)` retorna `string[]`, valida e normaliza. Uma string vira `[string]`. Ela é chamada:
- no início de `getSession`, antes de `context.sessions![sessionName] = session` (`src/utils/session.ts:173`). Assim um erro de configuração não deixa sessão vazia no contexto;
- em `sealSession` (`src/utils/session.ts:282`);
- em `unsealSession` (`src/utils/session.ts:312`), para os chamadores diretos da API exportada (`src/index.ts:208-209`).

Erros:
- lista vazia: `Session password list is empty`;
- senha curta: `Session password at position N is too short (min M characters required)`. A mensagem nunca inclui o valor da senha.

O mínimo M usa `{ ...sealDefaults, ...config.seal }`, com o maior entre `encryption.minPasswordlength` e `integrity.minPasswordlength`.

**Alternativas.**
- *Validar só dentro de `unsealSession` e `sealSession`.* Rejeitada. `getSession` engole o erro em `src/utils/session.ts:197`, então lista vazia ou senha curta viraria sessão nova em toda requisição. É exatamente o que RF-06 proíbe.

### D-06 — Validar a senha curta também na senha única (decisão para confirmar)

**Escolha.** A validação de D-05 vale para toda configuração, inclusive senha única curta.

**Motivo.** Uma senha única curta já falha no caminho de escrita. `updateSession` chama `sealSession`, que chega ao `generateKey` com erro em `iron-crypto.ts:192-195`. O que muda é o caminho de leitura: `getSession` que hoje cria sessão nova em silêncio passa a lançar erro. Isso altera um comportamento observável de RF-05, que pede preservar o comportamento com senha única.

**Alternativa.** Validar só listas, deixando o caminho de leitura de senha única intacto. Mantém RF-05 pela letra, mas deixa um erro de configuração silencioso. **Pergunta ao time:** confirmar a escolha. Se preferirem a alternativa, a mudança é restringir `sessionPasswords` a `Array.isArray(config.password)` na validação de tamanho.

### D-07 — Reselar a sessão aberta com senha que não é a primeira (decisão para confirmar)

**Escolha.** Quando `unsealWithPassword` abre o selo com uma senha que não é `passwords[0]`, a sessão recebe a marca de reselagem. O `getSession` existente a reselá com a senha primária na próxima escrita ou renovação (`src/utils/session.ts:214-216`). Na prática, o cookie migra no primeiro acesso após a rotação.

Para isso, o uso de `kLegacySeal` (`src/utils/session.ts:199-201` e `src/utils/session.ts:346`) passa a cobrir também este caso, ou o símbolo é renomeado para algo como `kResealNeeded`. A renomeação é preferível, por clareza.

**Motivo.** Sem isso, uma sessão de senha antiga só migra quando escrever, quando o slide disparar ou quando expirar. Isso adia a remoção da senha antiga (R3). O PRD diz que "re-selagem forçada de todas as sessões" está fora de escopo. Esta decisão não é forçada: só reseala quem já é aberto com a senha antiga e só quando há requisição. Ainda assim, vai além do texto do PRD. **Pergunta ao time:** confirmar a escolha.

**Alternativa.** Não reselar na abertura. Mais simples, sem escrita extra. A rotação fica dependente de `maxAge` ou `idleTimeout`, como diz R3.

### D-08 — Documentação vem do JSDoc

**Escolha.** O texto de RF-07 vai no JSDoc de `SessionConfig.password` (`src/utils/session.ts:39-47`). Precisa cobrir: a ordem (primeira sela, demais só abrem), a ordem de tentativa para abrir (R5), e a recomendação de remover senhas antigas após `maxAge` ou `idleTimeout`.

`docs/2.utils/4.security.md:44` é gerado pelo automd a partir desse JSDoc. Ao final, rodar só o automd (`pnpm exec automd`), e não `pnpm fmt`, que também roda `oxlint --fix` e `oxfmt` em todo o repositório.

## 3. Arquivos a alterar

| Arquivo | Onde | Mudança |
|---|---|---|
| `src/utils/session.ts` | `:39-48` | `password: string \| string[]` e JSDoc (D-01, D-08) |
| `src/utils/session.ts` | `:149-153` | chamar `sessionPasswords(config)` antes de criar a sessão no contexto (D-05) |
| `src/utils/session.ts` | `:282-307` | `seal(session, passwords[0], …)` em `:300-304` (D-02) |
| `src/utils/session.ts` | `:312-367` | laço sobre as senhas e função interna `unsealWithPassword` com o corpo de `:323-348` (D-03, D-04); reselagem (D-07) |
| `src/utils/session.ts` | fim do arquivo | funções internas `sessionPasswords` e `unsealWithPassword` (D-05), antes do bloco de helpers já existente |
| `src/utils/session.ts` | `:199-201`, `:214-216`, `:346` | renomear ou estender a marca de reselagem (D-07) |
| `test/session.test.ts` | `:137`, `:157`, `:164` | trocar `sessionConfig.password` por uma constante de senha string. Estas três chamadas passam a senha direto a `seal`/`unseal` (`test/session.test.ts:12`), que aceitam só string. Sem isso, o typecheck quebra (`tsconfig.json` inclui `test`) |
| `test/session.test.ts` | após `:186` e dentro de `describe("lazy creation")` | testes novos (seção 5) |
| `docs/2.utils/4.security.md` | `:44` | regenerado pelo automd, sem edição manual (D-08) |

Não mudam: `src/utils/internal/iron-crypto.ts` (D-03), `src/index.ts` (exports públicos iguais), `updateSession` (`src/utils/session.ts:241-277`), `clearSession` e `test/bench/session.ts`.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (:48)
password: string | string[];
```

Interna, sem export, então não entra em `isolatedDeclarations`:

```ts
/** Senhas na ordem de tentativa. A primeira sela. Lança se a lista estiver vazia ou tiver senha curta. */
function sessionPasswords(config: SessionConfig): string[];
```

Interna, sem export:

```ts
/** Tenta abrir o selo com uma senha, com o fallback legado de 1 iteração. Lança "Bad hmac value" se a senha não confere. */
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Sem mudança nas assinaturas públicas `useSession`, `getSession`, `updateSession`, `sealSession(event, config)` e `unsealSession(_event, config, sealed)`. Sem mudança em `seal`/`unseal` do iron.

Comportamento de `unsealSession`:
- percorre `sessionPasswords(config)` na ordem;
- em `"Bad hmac value"`, passa à próxima senha;
- qualquer outro erro sobe imediatamente;
- se todas falharem, sobe o último `"Bad hmac value"`;
- depois do sucesso, aplica as checagens de expiração de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`), que não mudam.

Mensagens de erro (D-05):
- lista vazia: `Session password list is empty`;
- senha curta: `Session password at position N is too short (min M characters required)`, sem o valor.

## 5. Estratégia de testes

Todos os testes novos usam `describeMatrix`, então rodam em `web` e `node` (R6). A suíte existente fica intacta, com a exceção de substituir a constante de senha nas três chamadas de `seal`/`unseal`.

Testes novos, dentro de `describeMatrix("session", …)` em `test/session.test.ts`:

1. **Selagem com a primeira senha (RF-02).** Config `[A, B]`. Um `useSession` grava dados. Esperar `unseal(cookie, A, sealDefaults)` resolvendo e `unseal(cookie, B, sealDefaults)` rejeitando com `"Bad hmac value"`.
2. **Abertura com senha antiga (RF-03).** Selar com `B` via `seal`, depois `getSession` com `[A, B]`. Esperar mesmo `id` e dados originais.
3. **Abertura com a primeira senha (RF-03).** Cookie selado com `A`, config `[A, B]`. Esperar mesmo `id`.
4. **Senha desconhecida (RF-04).** Cookie selado com `C`, config `[A, B]`. Esperar `id` diferente e `data` vazio.
5. **Lista vazia (RF-06).** Config `password: []`. Como um erro em handler vira `ctx.errors` e falha o `afterEach` (`test/_setup.ts:144-155`), o handler captura o erro e devolve a mensagem. Esperar mensagem casando `/empty/i`. Também cobrir `getSession` sem cookie.
6. **Senha curta na lista (RF-06).** Config `[A, "curta"]`. Esperar mensagem com `position 2` e sem o texto `curta`, nem o valor de `A`.
7. **Legado com senha antiga (R2).** Selar com `B` com 1 iteração (mesmo padrão de `test/session.test.ts:134-159`), config `[A, B]`. Esperar a sessão carregada. Se D-07 for adotada, esperar também que o `Set-Cookie` abra só com `A`.
8. **Reselagem na abertura com senha antiga (D-07, se adotada).** Cookie selado com `B` e requisição sem escrita. Esperar um `Set-Cookie` que abre com `A` e não abre com `B`. Se D-07 não for adotada, esperar que não há `Set-Cookie`.
9. **Escrita não faz tentativas extras.** Repetir o padrão de `test/session.test.ts:722-735` com config de duas senhas. Esperar `deriveBits` chamado 2 vezes.

Ajustes em testes existentes (sem remover asserção):
- `test/session.test.ts:137`, `:157` e `:164`: usar uma constante string para a senha.

Verificações de ciclo:
- `pnpm vitest run test/session.test.ts`: linha de base medida antes desta especificação, com 58 testes passando (`Type Errors: no errors`). Depois da mudança, todos devem passar, mais os novos.
- `pnpm typecheck`: linha de base limpa. Depois, deve continuar limpa, incluindo `test/session.test.ts` (RF-01).
- `pnpm lint`: `oxlint` e `oxfmt --check` devem passar.
- Cobertura: `vitest --run --coverage` cobre `sessionPasswords` e o laço de `unsealSession`.

## 6. Riscos

- **R1 — custo de CPU (medido).** Cada tentativa de abertura custa uma derivação HMAC de 8192 iterações, cerca de 2,8 ms neste ambiente. Uma lista de N senhas custa até N tentativas. Um cookie inválido custa N × 2,8 ms, mais N × 0,05 ms de fallback legado. Um cookie de senha antiga custa `i × 2,8 ms`, onde `i` é a posição na lista. Não há limite de tamanho no código, para não criar nome público nem regra nova. A documentação deve recomendar listas curtas, de no máximo 2 ou 3 senhas. Mitigação futura possível: escolher a senha pelo id do selo, como em D-03.
- **R2 — fallback legado.** Coberto em D-04. A tentativa de 1 iteração é quase de graça, e o teste 7 cobre a combinação.
- **R3 — senha comprometida.** Enquanto uma senha estiver na lista, cookies selados com ela continuam válidos. Com D-07, a migração acontece no primeiro acesso, o que encurta essa janela. Remover a senha antes disso derruba as sessões dela. Essa decisão é do time, e a documentação deve dizer isso.
- **R4 — entropia.** Coberto por D-05: cada senha da lista passa pelo mínimo de 32 caracteres.
- **R5 — ordem.** A ordem só importa para selar, mas o JSDoc precisa dizer também a ordem de tentativa (D-08).
- **D-06 — mudança observável na leitura de senha única curta.** Ver D-06. Precisa de confirmação.
- **Tipo `string[]` aceita `[]`.** O compilador não protege contra lista vazia. A checagem em runtime (D-05) cobre isso, e o teste 5 verifica.
- **Vazamento de tempo.** O número de tentativas revela em qual posição a senha casou. A lista é configuração do servidor e o cookie vem do cliente, então o ganho para um atacante é pequeno. Não tratado.
- **`pnpm fmt` reformata o repositório.** Usar `pnpm exec automd` (D-08).
- **Interação com `sessionHeader`.** O caminho de header passa pelo mesmo `unsealSession`. O comportamento de expiração não muda, e o header nunca é reselado (`src/utils/session.ts:214` já exclui isso).

## 7. Fora de escopo

Igual ao PRD: `extraUnsealPasswords`, gerenciamento automático de chaves, rotação agendada, re-selagem forçada, mudanças no formato do cookie, no header de sessão ou no algoritmo de selo, e remoção do `legacySealFallback`.

## 8. Perguntas para o time

1. **D-06:** validar senha única curta também na leitura, com erro explícito, ou manter o comportamento silencioso?
2. **D-07:** reselar a sessão ao abri-la com senha que não é a primeira? É o único ponto que vai além do texto do PRD.
3. **Limite de tamanho da lista:** documentar apenas, como está aqui, ou impor um limite no código?
