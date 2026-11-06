# Tarefas de implementação: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Referências: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-07).

Convenções para todas as tarefas:

- Seguir o fluxo de correção de bug do `AGENTS.md` também nas funcionalidades: escrever primeiro os casos novos em `test/session.test.ts`, confirmar que falham, depois implementar.
- Os testes existentes não são alterados (RF-09).
- Testes novos dentro de `describeMatrix`, rodando em web e node.
- Verificação durante o desenvolvimento: `pnpm vitest run test/session.test.ts`. Ao final: `pnpm test`.

---

### T-01 — Campo `extraUnsealPasswords` e validação na selagem

Adicionar `extraUnsealPasswords?: string[]` em `SessionConfig`, com JSDoc explicando que as senhas só abrem sessões, que são tentadas após `password` e que sessões abertas por elas são re-seladas com `password`. Criar o helper interno `assertSealPasswords(config)`, que rejeita cada item vazio ou com menos caracteres que o mínimo efetivo (maior `minPasswordlength` entre `encryption` e `integrity`, padrão 32). A mensagem cita o índice e o mínimo, nunca o valor, por exemplo `Invalid extra session password at extraUnsealPasswords[2]: must not be empty and must have at least 32 characters`. Chamar o helper no início de `updateSession` e de `sealSession`, antes de qualquer leitura de cookie.

Cobre: RF-01, RF-06

Depende de: nenhuma

Aceite:
- Com `extraUnsealPasswords` ausente ou `[]`, criação, leitura e atualização produzem o mesmo `Set-Cookie` e o mesmo payload de hoje.
- Com uma extra de 10 caracteres na posição 3, `sealSession` e `updateSession` rejeitam mesmo sem cookie no pedido. A mensagem contém "password" e não contém o valor da senha.
- Com uma extra `""`, `useSession` ao criar sessão nova rejeita com erro que contém "password".
- Com `password` inválida, o erro continua o mesmo de hoje.

Arquivos: `src/utils/session.ts`, `test/session.test.ts`

---

### T-02 — Resolução única das opções de selo

Criar o helper interno `resolveSealOptions(config)`, que devolve `{ ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal }`. Substituir as duas expressões duplicadas, em `sealSession` e em `unsealSession`, pela chamada ao helper. Esta tarefa não muda comportamento. Decidir, sem obrigação, se os helpers novos vão para `src/utils/internal/session-passwords.ts` para manter `session.ts` abaixo de 200 linhas (AGENTS.md); a decisão deve ser registrada na descrição da entrega.

Cobre: RF-09

Depende de: nenhuma

Aceite:
- `pnpm vitest run test/session.test.ts` passa sem alterar nenhum teste existente.
- Os valores de `ttl` e das opções de selo usados em selagem e em abertura são iguais aos de antes (coberto pelos testes existentes de `maxAge` e `idleTimeout`).

Arquivos: `src/utils/session.ts` (e, se a decisão for mover, `src/utils/internal/session-passwords.ts`)

---

### T-03 — Abertura sequencial com as senhas extras

Criar a função interna `unsealOne(sealed, password, config, sealOptions)`, que faz uma tentativa de abertura com uma senha. Por enquanto ela só encapsula o `unseal` atual, sem fallback legado (o fallback entra na T-05). Em `unsealSession`, percorrer `[config.password, ...(config.extraUnsealPasswords ?? [])]` em ordem. Só o erro com mensagem `"Bad hmac value"` faz o laço seguir; qualquer outro erro é relançado. Parar na primeira senha que abrir. Se nenhuma abrir, relançar o último erro `"Bad hmac value"`. Criar o símbolo interno `kRotatedSeal` em `src/utils/internal/session.ts`, após `kLegacySeal`, e marcar o objeto retornado por `unsealSession` quando a senha que abriu não for a primeira (não marcar ainda é necessário para `getSession`; o marcador só é consumido na T-05).

Cobre: RF-03, RF-04

Depende de: T-02

Aceite:
- Sessão selada com a extra da posição 2 é lida por `getSession`, com `id`, `createdAt` e dados preservados.
- Com lista `[X, Y, Z]` em que Y abre a sessão e Z é curta (inválida), a leitura tem sucesso. Isso prova que Z não é tentada.
- Sessão selada com `password` e lista `[curta]` é lida sem erro, sem tentar a extra.
- Sessão selada com senha que não está na configuração: `getSession` e `useSession` não lançam, a sessão retornada está vazia e não traz dados da sessão original.
- Sem extras, o erro lançado para senha errada é o mesmo de hoje.

Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`

---

### T-04 — Selagem sempre com a senha atual

Garantir que toda selagem (sessão nova em `useSession`, `updateSession`, `sealSession` e re-selagem automática) use somente `config.password`. Nenhuma senha de `extraUnsealPasswords` pode entrar no caminho de selagem. Esta tarefa deve ser pequena, porque a estrutura de D-02 já separa selagem de abertura, mas precisa de teste dedicado.

Cobre: RF-02

Depende de: T-01, T-02

Aceite:
- Com `password = "A"` e extra `"B"`, `sealSession` e `useSession` (sessão nova) criam uma sessão que `unseal(…, "A")` abre e `unseal(…, "B")` rejeita.
- Com a mesma configuração, `updateSession` regrava a sessão com `"A"`, não com `"B"`.

Arquivos: `src/utils/session.ts`, `test/session.test.ts`

---

### T-05 — Re-selagem progressiva e sessões legadas com extras

Em `getSession`, remover `kRotatedSeal` do objeto antes de `Object.assign(session, unsealed)`, guardar o valor em uma constante e incluí-lo na condição de re-selagem: `if (session.id && sessionFromCookie && (legacySeal || rotated || shouldSlide(session, config))) await updateSession(event, config);`. Esta é a mesma remoção que já é feita para `kLegacySeal`, e serve para que o símbolo não vaze para a sessão em memória. Incluir o fallback legado por senha (D-03): mover o fallback de `unsealSession` para dentro de `unsealOne`, para que valha para cada senha da lista antes de passar para a próxima. A condição de retry continua igual (`legacySealFallback !== false`, `integrity.iterations !== 1`, erro `"Bad hmac value"`).

Cobre: RF-05, RF-08

Depende de: T-03, T-04

Aceite:
- Cookie com sessão aberta por extra: `useSession` sem escrita gera `Set-Cookie` cujo valor abre com `password` e não abre com a extra. `id`, `createdAt` e dados são mantidos.
- Cookie com sessão aberta por `password`: nenhum `Set-Cookie` de re-selagem.
- Sessão por cabeçalho `x-h3-session` aberta por extra: nenhum `Set-Cookie` de re-selagem.
- Sessão legada (`iterations: 1`) selada com extra, `legacySealFallback` ativo: é aberta, a resposta traz `Set-Cookie` com a sessão re-selada com `password` e as opções de selo atuais.
- A mesma sessão legada com `legacySealFallback: false`: é tratada como inexistente.
- A sessão retornada por `getSession` é comparada com `toEqual` sem símbolos extras (nenhum `kRotatedSeal` ou `kLegacySeal` em `data` ou nas sessões seguintes).

Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`

---

### T-06 — Chunks, cabeçalho de sessão, `unsealSession` e `clearSession`

Cobrir os formatos e as funções restantes do RF-07. Os caminhos de código devem já funcionar após as tarefas anteriores; esta tarefa adiciona os testes e corrige o que falhar.

Pendência de decisão, registrada no techspec ("Pontos em aberto"): o RF-07 pede que `clearSession` abra sessões com extras, mas `clearSession` hoje não abre a sessão (`src/utils/session.ts:372-386`). O techspec propõe manter `clearSession` sem mudança e considerar o requisito satisfeito por não haver abertura. Confirmar essa interpretação antes de fechar a tarefa.

Cobre: RF-07

Depende de: T-03, T-05

Aceite:
- Sessão com extra dividida em chunks (`cookie.chunkMaxLength` pequeno): `getSession` e `useSession` leem os dados corretamente.
- `unsealSession` com sessão aberta por extra: abre sem erro e devolve os dados.
- `updateSession` com sessão aberta por extra: regrava com `password`.
- `clearSession` com sessão aberta por extra: não lança e apaga o cookie (ou o comportamento confirmado na pendência de decisão).
- Sessão por extra vinda do cabeçalho `x-h3-session`: abre sem erro.

Arquivos: `test/session.test.ts`, e `src/utils/session.ts` somente se algum teste revelar falha

---

### T-07 — Regressão e verificação final

Rodar a verificação completa e conferir que a mudança é aditiva. Confirmar que nenhum teste existente foi editado (diff apenas com inclusões em `test/session.test.ts`). Confirmar que nenhum export novo foi criado, de modo que `test/unit/package.test.ts` continua passando. Confirmar que nenhum valor de senha aparece em mensagens de erro (teste da T-01 cobre isso). Revisar `src/utils/session.ts` após a implementação para garantir que o JSDoc do campo novo descreve o risco de configuração inválida na leitura (techspec, risco 3).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09

Depende de: T-01, T-02, T-03, T-04, T-05, T-06

Aceite:
- `pnpm vitest run test/session.test.ts` passa com todos os casos novos e existentes.
- `pnpm test` (lint, typecheck e cobertura) passa.
- `test/unit/package.test.ts` passa sem alteração.
- `git diff` nos testes existentes está vazio.
- A suíte de sessão com `extraUnsealPasswords` ausente ou `[]` gera os mesmos cabeçalhos e payloads da versão anterior (RF-01 e RF-09).

Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts` (e, se a T-02 tiver movido helpers, `src/utils/internal/session-passwords.ts`)
