# PRD — Várias senhas de unseal nas sessões (`extraUnsealPasswords`)

- Referência: issue h3js/h3#1050 (primeira alternativa) e contrato `sdd/pedido.md`
- Data: 2026-11-06
- Escopo de código: `src/utils/session.ts`, `src/utils/internal/iron-crypto.ts` (somente leitura, sem mudança prevista), `test/session.test.ts`, `docs/2.utils/4.security.md`

## Problema e objetivo

Quem gira a senha de selagem das sessões (`password` de `SessionConfig`) hoje invalida todas as sessões seladas com a senha anterior: essas usuárias são deslogadas no primeiro request após a troca. Não há como fazer uma rotação gradual.

**Objetivo:** permitir que `SessionConfig` declare senhas anteriores que **só abrem** sessões. `password` continua sendo a única senha usada para selar. Sem a nova opção, o comportamento é idêntico ao atual.

Motivação de negócio: rotação de segredos sem logout em massa, com possibilidade de retirar a senha antiga depois que as sessões migrarem.

## Requisitos funcionais

### RF-01 — Campo público `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com JSDoc explicando que são senhas anteriores usadas apenas para abrir sessões. `password` permanece `string` e obrigatória. Nenhum outro nome público é adicionado (nenhum export novo em `src/index.ts`).

**Critério de aceite**
- **Dado** um `SessionConfig` com `password` e `extraUnsealPasswords: ["senha-antiga-com-32-caracteres-ou-mais"]`
- **Quando** o objeto é passado a `useSession` ou `getSession` em TypeScript
- **Então** o tipo-check passa sem `as any`, e um `SessionConfig` sem o campo continua válido.

### RF-02 — Senha primária tem precedência e ordem de tentativa fixa

Ao ler uma sessão, `password` é sempre tentada primeiro. As senhas de `extraUnsealPasswords` são tentadas depois, na ordem do array, e só quando a anterior falha com a verificação de integridade (`Bad hmac value`). Uma sessão aberta pela `password` não dispara nenhuma tentativa extra.

**Critério de aceite**
- **Dado** uma sessão selada com `password` atual e `extraUnsealPasswords` com duas senhas
- **Quando** a sessão é lida
- **Então** ela é aberta na primeira tentativa, e nenhuma derivação com as senhas extras é executada (verificável com um espião sobre `unseal` ou contando chamadas a `crypto.subtle.deriveBits`).

### RF-03 — Sessão selada com senha anterior é aberta

Uma sessão selada com qualquer senha de `extraUnsealPasswords` é lida com sucesso. `id`, `createdAt`, `lastSeenAt` (quando existir) e `data` ficam iguais aos da sessão original.

**Critério de aceite**
- **Dado** uma sessão criada com `password: "A…"` (32+ caracteres) e `data: { user: 1 }`
- **Quando** a configuração muda para `password: "B…"` com `extraUnsealPasswords: ["A…"]` e a requisição envia o mesmo cookie
- **Então** `getSession(...)` retorna o mesmo `id` e `data.user === 1`.

Vale para cookie e para o header de sessão (`x-{name}-session`).

### RF-04 — Senha não listada continua rejeitada

Uma sessão selada com uma senha que não está em `password` nem em `extraUnsealPasswords` não é aberta. O comportamento é o mesmo de hoje para uma senha errada: a leitura não lança erro para o handler, e a sessão é tratada como nova.

**Critério de aceite**
- **Dado** uma sessão selada com `"C…"`, e a configuração com `password: "B…"` e `extraUnsealPasswords: ["A…"]`
- **Quando** `getSession(...)` é chamado
- **Então** o `data` retornado está vazio, o `id` é novo e a chamada não rejeita.

### RF-05 — Expiração vale independentemente da senha usada

As regras de `maxAge` e `idleTimeout` (checadas em `unsealSession` sobre o payload já aberto) se aplicam a sessões abertas por senha extra. Uma sessão expirada aberta por senha extra é rejeitada como uma expirada aberta pela primária.

**Critério de aceite**
- **Dado** uma sessão selada com `"A…"`, `maxAge: 60`, e `createdAt` há 120 segundos
- **Quando** a configuração tem `password: "B…"`, `extraUnsealPasswords: ["A…"]`, `maxAge: 60`
- **Então** a sessão não é aberta (o `data` vem vazio e o `id` é novo), exatamente como no caso de uma sessão expirada selada com `"B…"`.

### RF-06 — Migração: sessão de cookie aberta por senha extra é resselada com `password`

Quando uma sessão vinda de **cookie** é aberta por uma senha de `extraUnsealPasswords`, `getSession` reseleia a sessão com `password` na mesma leitura, reescrevendo o cookie. Assim a senha antiga pode ser removida depois. Sessões abertas pela `password` atual não são resseladas por esse motivo (somente pela lógica já existente de legado e de `idleTimeout`).

Sessões vindas de header não são resseladas, porque não há cookie para gravar. Elas continuam sendo abertas pelas senhas extras enquanto a configuração as contiver.

**Critério de aceite**
- **Dado** uma sessão de cookie selada com `"A…"` e a configuração `password: "B…"`, `extraUnsealPasswords: ["A…"]`
- **Quando** a requisição é processada por `getSession` (sem `updateSession` pelo handler)
- **Então** a resposta contém `Set-Cookie` da sessão, e uma nova leitura com a configuração `password: "B…"` **sem** `extraUnsealPasswords` abre a sessão com o mesmo `id`.
- **E** a mesma leitura com uma sessão selada com `"B…"` não gera `Set-Cookie` extra por causa desta regra.

### RF-07 — Selagem usa sempre `password`

`sealSession` e `updateSession` usam somente `password`. Nenhuma senha de `extraUnsealPasswords` é usada para selar, mesmo depois que uma sessão foi aberta por uma delas.

**Critério de aceite**
- **Dado** uma sessão aberta por `"A…"` com a configuração `password: "B…"`, `extraUnsealPasswords: ["A…"]`
- **Quando** o handler chama `updateSession(event, config, { x: 1 })`
- **Então** o cookie gravado abre com `"B…"` e **não** abre com `"A…"` (`unseal` com `"A…"` lança `Bad hmac value`).

### RF-08 — Senha extra inválida é erro de configuração, não silêncio

Cada item de `extraUnsealPasswords` deve ter pelo menos `minPasswordlength` caracteres, com o mesmo critério já aplicado a `password` (padrão 32, ou o valor de `seal.encryption.minPasswordlength` quando sobrescrito). Uma string vazia ou curta lança `Error` com a mesma mensagem de `generateKey` (`Password string too short (min N characters required)`) durante `getSession`/`useSession`, antes de qualquer tentativa de unseal. O erro **não** pode ser engolido pelo `.catch` de `getSession` que trata falhas de unseal.

**Critério de aceite**
- **Dado** `extraUnsealPasswords: ["curta"]`
- **Quando** `useSession(event, config)` é chamado, com ou sem cookie na requisição
- **Então** a promessa rejeita com `Error` cuja mensagem contém `too short`.

### RF-09 — Fallback de legado é aplicado a cada senha candidata

O fallback de 1 iteração PBKDF2 (`legacySealFallback`, já existente) passa a valer para cada senha candidata, na mesma ordem: primeiro a `password` com as opções atuais, depois o fallback legado da `password`, depois cada extra com as opções atuais e então o fallback legado dela. Com `legacySealFallback: false`, o fallback não roda para nenhuma delas.

**Critério de aceite**
- **Dado** uma sessão legada selada com 1 iteração usando `"A…"`, e a configuração `password: "B…"`, `extraUnsealPasswords: ["A…"]`, `legacySealFallback` em padrão
- **Quando** a sessão é lida
- **Então** ela é aberta e resselada (RF-06) com as opções atuais.
- **E** com `legacySealFallback: false` a mesma leitura não abre a sessão.

### RF-10 — Sem extras, nada muda

Quando `extraUnsealPasswords` está ausente ou é `[]`, o comportamento observável (cookies, headers, erros, payload selado) é idêntico ao da versão atual. A suíte existente passa sem alteração de asserções.

**Critério de aceite**
- **Dado** o código após a mudança
- **Quando** `pnpm vitest run test/session.test.ts test/unit/` é executado
- **Então** todos os testes existentes passam sem que nenhuma asserção existente seja removida ou enfraquecida.

### RF-11 — Testes em ambos os alvos

Os novos casos ficam em `test/session.test.ts`, usando `describeMatrix` (web e node). Cobrem: RF-02 (ordem e não-derivação), RF-03, RF-04, RF-05, RF-06, RF-07, RF-08 e RF-09.

**Critério de aceite**
- **Dado** a suíte nova
- **Quando** `pnpm vitest run test/session.test.ts` é executado
- **Então** os casos aparecem para os dois alvos (`web` e `node`) e passam.

### RF-12 — Documentação

`docs/2.utils/4.security.md` descreve a rotação com `extraUnsealPasswords`, o procedimento recomendado (adicionar a nova senha como `password`, mover a antiga para `extraUnsealPasswords`, retirá-la após o período de migração) e o efeito de RF-06 sobre sessões de header.

**Critério de aceite**
- **Dado** a documentação alterada
- **Quando** lida por quem usa `useSession`
- **Então** ela informa que a senha extra só abre sessões, que a selagem continua com `password`, e que sessões de header não migram.

### RF-13 — Qualidade do repositório

`pnpm lint` e `pnpm typecheck` passam. Os arquivos de código alterados continuam com menos de 200 linhas, quando possível, conforme AGENTS.md; se `session.ts` ultrapassar esse limite, a extração de helpers internos vai para o fim do arquivo ou para `src/utils/internal/`.

**Critério de aceite**
- **Dado** a branch com a mudança
- **Quando** `pnpm lint` e `pnpm typecheck` são executados
- **Então** ambos terminam com código 0.

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue #1050).
- Identificação de chave por id (`kid`/`passwordId` do iron) e gestão automática de chaves.
- Migração de sessões de header (não há cookie para regravar).
- Remoção automática de senhas antigas ou prazo de expiração das senhas extras.
- Mudança de algoritmo, iterações ou formato do selo; mudança em `SealOptions`.
- Remoção do fallback legado (`legacySealFallback`), que está previsto para v3.
- Mudanças em `iron-crypto.ts` além de leitura; a API `seal`/`unseal` interna não muda.
- Benchmarks em `test/bench/session.ts`.

## Premissas

- **P-01:** A verificação de integridade do iron falha com `Bad hmac value` quando a senha está errada. O código atual já depende disso para o fallback legado, então a troca de senha segue o mesmo caminho.
- **P-02:** `seal` com um `string` como senha não grava id de senha no payload (a parte `passwordId` fica vazia), então não é preciso mudar o formato selado.
- **P-03:** Os nomes de sessão, o cookie e o header continuam os mesmos entre a configuração antiga e a nova.
- **P-04:** O custo de uma derivação PBKDF2 com 8192 iterações é aceitável por tentativa, porque só ocorre em leituras que falharam na senha primária.
- **P-05:** A migração de RF-06 é uma decisão de produto que assumi, porque o pedido não a menciona e ela é necessária para a rotação terminar. Se não for desejada, RF-06 deve ser removido e a documentação de RF-12 ajustada.

## Riscos

- **R-01 — Custo de CPU em leituras com senha errada:** cada senha extra adiciona uma derivação completa (e uma legada, se aplicável) em cada leitura de uma sessão não reconhecida. Mitigação: ordem fixa com a primária primeiro, documentar que a lista deve ser curta e removida após a migração.
- **R-02 — Erro de configuração engolido:** o `.catch` de `getSession` transforma falha de unseal em sessão nova, o que esconderia uma senha extra mal configurada. Mitigação: RF-08 valida antes do unseal.
- **R-03 — Escrita de cookie em leitura:** RF-06 faz `getSession` escrever `Set-Cookie` em requisições que só leem. Isso segue o padrão já usado para legado e `idleTimeout`, mas aumenta o número de respostas com cookie durante a janela de migração.
- **R-04 — Segredo antigo em memória:** as senhas antigas ficam na configuração do processo enquanto estiverem listadas. Quem usa `extraUnsealPasswords` deve tratá-las como segredos.
- **R-05 — Sessões de header presas à senha antiga:** como elas não são resseladas, só saem do sistema quando expiram ou quando a senha extra é removida.
- **R-06 — Dois caminhos de leitura divergentes:** o fallback legado e o de senhas extras precisam ser compostos com cuidado em `unsealSession`. Mitigação: os testes de RF-09 cobrem a combinação.
