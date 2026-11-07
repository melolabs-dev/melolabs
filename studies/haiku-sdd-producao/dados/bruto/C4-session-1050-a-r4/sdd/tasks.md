# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (decisões D-01 a D-08).

Decisões em aberto no techspec: D-06 (validar senha única curta na leitura), D-07 (reselar ao abrir com senha antiga) e limite de tamanho da lista. Este arquivo segue as escolhas padrão do techspec (D-06 e D-07 adotadas, limite só documentado). Se o time mudar alguma delas, as tarefas T-02, T-05 e T-08 precisam ser ajustadas.

### T-01 — Tipo e JSDoc de `SessionConfig.password`

**Cobre:** RF-01, RF-07
**Depende de:** nenhuma
**Aceite:** `password` aceita `string | string[]` sem erro de tipo em `useSession` com lista e com string. O JSDoc descreve a ordem (primeira sela, demais só abrem), a ordem de tentativa para abrir (R5), o limite recomendado de 2 ou 3 senhas (R1) e a recomendação de remover senhas antigas só depois de `maxAge`/`idleTimeout` (R3). `pnpm typecheck` passa.
**Arquivos:** `src/utils/session.ts`

### T-02 — Validação da lista de senhas (`sessionPasswords`)

**Cobre:** RF-06
**Depende de:** T-01
**Aceite:** função interna `sessionPasswords(config)` retorna `string[]`; uma string vira `[string]`. Lista vazia lança `Session password list is empty`. Senha curta lança `Session password at position N is too short (min M characters required)`, sem o valor da senha na mensagem. O mínimo M vem de `{ ...sealDefaults, ...config.seal }`, com o maior entre `encryption.minPasswordlength` e `integrity.minPasswordlength`. `getSession` chama a função antes de gravar a sessão em `context.sessions`, para que o erro não vire sessão nova em silêncio. Verificação por leitura e pelos testes da T-07.
**Arquivos:** `src/utils/session.ts`

### T-03 — Selar sempre com a primeira senha

**Cobre:** RF-02, RF-05
**Depende de:** T-02
**Aceite:** `sealSession` usa `seal(session, passwords[0], …)` com a assinatura pública inalterada. Um cookie criado com `[A, B]` abre com `A` e não abre com `B` isoladamente. Com senha única, o cookie gerado é o mesmo de antes (sem id do iron). `updateSession` e a renovação de cookie passam por esse caminho.
**Arquivos:** `src/utils/session.ts`

### T-04 — Abrir com o laço de senhas e `unsealWithPassword`

**Cobre:** RF-03, RF-04, RF-05
**Depende de:** T-02
**Aceite:** o corpo atual do `try`/`catch` de `unsealSession` vai para a função interna `unsealWithPassword(sealed, password, config, sealOptions)`, com o fallback legado de 1 iteração preservado dentro dela. `unsealSession` percorre `sessionPasswords(config)` na ordem declarada. Em `"Bad hmac value"` passa para a próxima senha. Qualquer outro erro sobe na hora. Se nenhuma senha abrir, sobe o último `"Bad hmac value"`. `getSession` então cria sessão nova, como hoje. `src/utils/internal/iron-crypto.ts` não muda. A suíte existente continua passando.
**Arquivos:** `src/utils/session.ts`

### T-05 — Reselar sessão aberta com senha que não é a primeira (D-07)

**Cobre:** RF-02, RF-03
**Depende de:** T-04
**Aceite:** quando `unsealWithPassword` abre o selo com uma senha que não é `passwords[0]`, a sessão recebe a marca de reselagem. O `getSession` reseala com a primeira senha na próxima escrita ou renovação, como já faz hoje. A marca `kLegacySeal` passa a se chamar `kResealNeeded` (ou é estendida), e os usos em `:199-201`, `:214-216` e `:346` são atualizados. Comportamento coberto pela T-08.
**Arquivos:** `src/utils/session.ts`

### T-06 — Trocar a senha das chamadas diretas de `seal`/`unseal` nos testes existentes

**Cobre:** RF-05, RF-08
**Depende de:** T-01
**Aceite:** as três chamadas em `test/session.test.ts:137`, `:157` e `:164` usam uma constante string de senha, porque `seal`/`unseal` aceitam só string. Nenhuma asserção existente é removida. `pnpm typecheck` passa com `test/session.test.ts` incluído.
**Arquivos:** `test/session.test.ts`

### T-07 — Testes de selagem, abertura, senha desconhecida e validação

**Cobre:** RF-02, RF-03, RF-04, RF-06, RF-08
**Depende de:** T-02, T-03, T-04, T-06
**Aceite:** dentro de `describeMatrix("session", …)`, em `test/session.test.ts` após `:186`, com cobertura nos modos `web` e `node`:
1. selagem com a primeira senha (`[A, B]`): `unseal` com `A` resolve e com `B` rejeita com `"Bad hmac value"`;
2. abertura com senha antiga (selar com `B`, ler com `[A, B]`): mesmo `id` e dados originais;
3. abertura com a primeira senha: mesmo `id`;
4. senha desconhecida (`C`): `id` diferente e `data` vazio;
5. lista vazia (`password: []`): erro com `/empty/i`, também em `getSession` sem cookie;
6. senha curta (`[A, "curta"]`): mensagem com `position 2`, sem o texto `curta` nem o valor de `A`.

`pnpm vitest run test/session.test.ts` passa com esses testes.
**Arquivos:** `test/session.test.ts`

### T-08 — Testes de legado, reselagem e contagem de tentativas

**Cobre:** RF-02, RF-03, RF-05, RF-08
**Depende de:** T-05, T-06
**Aceite:** dentro de `describe("lazy creation")` ou no mesmo bloco de sessão, em `test/session.test.ts`, com cobertura nos modos `web` e `node`:
1. legado com senha antiga (selar com `B` com 1 iteração, como em `test/session.test.ts:134-159`, ler com `[A, B]`): sessão carregada;
2. reselagem na abertura (cookie selado com `B`, requisição sem escrita): `Set-Cookie` presente, abre com `A` e não abre com `B`;
3. escrita não faz tentativas extras: com config de duas senhas, `deriveBits` é chamado 2 vezes (padrão de `test/session.test.ts:722-735`).

`pnpm vitest run test/session.test.ts` passa com esses testes.
**Arquivos:** `test/session.test.ts`

### T-09 — Regenerar a documentação a partir do JSDoc

**Cobre:** RF-07
**Depende de:** T-01
**Aceite:** `pnpm exec automd` atualiza `docs/2.utils/4.security.md` com o texto novo do JSDoc de `password`. Não rodar `pnpm fmt`, porque ele reformata o repositório inteiro. O diff fica restrito a esse arquivo.
**Arquivos:** `docs/2.utils/4.security.md` (gerado pelo automd)

### T-10 — Verificação final do ciclo

**Cobre:** RF-05, RF-08
**Depende de:** T-05, T-07, T-08, T-09
**Aceite:** `pnpm vitest run test/session.test.ts` passa com as 58 linhas de base e os testes novos. `pnpm typecheck` e `pnpm lint` passam. `pnpm vitest run --coverage` cobre `sessionPasswords` e o laço de `unsealSession`. `src/utils/internal/iron-crypto.ts`, `src/index.ts` e `test/bench/session.ts` não têm alterações no diff. Se algo falhar, o resultado é relatado com a saída, sem marcar como concluído.
**Arquivos:** nenhum (somente execução de verificação)
