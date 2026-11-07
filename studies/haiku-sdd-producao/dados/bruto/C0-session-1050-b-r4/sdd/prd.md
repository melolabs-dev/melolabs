# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## 1. Problema e objetivo

### Problema
Hoje `SessionConfig` (`src/utils/session.ts`) aceita uma única `password`, usada para selar e para abrir o cookie/header de sessão. Ao rotacionar essa senha (boa prática de segurança, ou resposta a vazamento), todas as sessões já emitidas deixam de abrir: o `unseal` falha, a sessão é descartada em silêncio e cada usuário é deslogado de uma vez.

### Objetivo
Permitir a rotação de senha sem invalidar as sessões existentes. Um campo opcional novo, `extraUnsealPasswords: string[]`, em `SessionConfig`, guarda senhas anteriores que **só abrem** sessões. `password` continua sendo uma `string` e continua sendo a única senha que **sela**. Sem o campo, o comportamento é idêntico ao atual.

### Referência
Issue h3js/h3#1050, primeira alternativa proposta (campo adicional em vez de `password` como array).

## 2. Requisitos funcionais

### RF-01 — Novo campo opcional `extraUnsealPasswords`
`SessionConfig` ganha `extraUnsealPasswords?: string[]`, documentado em JSDoc (senhas anteriores, só para abrir sessões, mesmos requisitos de tamanho/entropia de `password`). Nenhum outro nome público é criado.

**Critério de aceite**
- **Dado** um `SessionConfig` com `password` e `extraUnsealPasswords: ["senha-antiga-..."]`
- **Quando** o código é compilado com `pnpm typecheck`
- **Então** a configuração é aceita; e `password` segue tipado como `string`, sem aceitar array.

### RF-02 — Abrir sessões seladas com senha extra
Ao abrir uma sessão (cookie ou header de sessão), o H3 tenta primeiro `password` e, se falhar, cada senha de `extraUnsealPasswords`, na ordem informada. A primeira que abrir com sucesso vale.

**Critério de aceite**
- **Dado** uma sessão selada com a senha A e uma config com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** o cliente envia essa sessão em uma requisição que usa `getSession`/`useSession`
- **Então** o `id` e os `data` da sessão são recuperados, sem criar sessão nova.

### RF-03 — Selar sempre com `password`
`sealSession`/`updateSession` usam exclusivamente `password`; as senhas extras nunca selam.

**Critério de aceite**
- **Dado** uma config com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** uma sessão é gravada com `updateSession`
- **Então** o token emitido abre com B isoladamente e **não** abre apenas com A.

### RF-04 — Migrar sessão aberta com senha extra para a senha atual
Quando a sessão vem de **cookie** e foi aberta com uma senha extra, ela é selada de novo com `password` na mesma requisição (mesmo mecanismo do reseal de sessões legadas), para que a senha antiga possa ser aposentada depois. Sessões vindas do header não são resseladas (já é assim hoje, pois não há cookie de resposta).

**Critério de aceite**
- **Dado** um cookie selado com a senha A e uma config com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** a requisição é processada e a sessão é lida
- **Então** a resposta traz `Set-Cookie` com a sessão selada com B, com os mesmos `id`, `createdAt` e `data`.

### RF-05 — Rejeitar sessão selada com senha desconhecida
Uma sessão que não abre com nenhuma das senhas configuradas é tratada como hoje: descartada, sem erro para o cliente, e substituída por sessão nova.

**Critério de aceite**
- **Dado** uma sessão selada com a senha C, ausente de `password` e de `extraUnsealPasswords`
- **Quando** a requisição chega
- **Então** `getSession` devolve uma sessão nova (outro `id`, `data` vazio) e nenhum erro não tratado é registrado.

### RF-06 — Expiração e demais regras valem para qualquer senha
`maxAge`, `idleTimeout`, `seal` (opções de algoritmo/iterações/ttl) e `legacySealFallback` se aplicam igualmente a sessões abertas com senha extra. Uma sessão expirada não é revivida por estar selada com senha extra.

**Critério de aceite**
- **Dado** uma sessão selada com a senha A, já além de `maxAge`, e config com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** a requisição chega
- **Então** a sessão é rejeitada como expirada e substituída por uma nova.

### RF-07 — Compatibilidade retroativa
Sem `extraUnsealPasswords` (ausente ou `[]`), nenhum comportamento muda: mesmas tentativas de unseal, mesmos erros, mesmo custo.

**Critério de aceite**
- **Dado** a suíte de testes existente de sessões
- **Quando** `pnpm vitest run test/session.test.ts` é executado
- **Então** todos os testes passam, sem perder as verificações que já faziam (ajustes só onde a mudança os afeta).

### RF-08 — Interação com o fallback legado de 1 iteração
O fallback `legacySealFallback` continua funcionando, inclusive combinado com senha extra (sessão legada selada com senha antiga é aceita e resselada com `password` e iterações atuais).

**Critério de aceite**
- **Dado** uma sessão selada com a senha A e 1 iteração PBKDF2, e config com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** a requisição chega com `legacySealFallback` não desativado
- **Então** a sessão é aceita e resselada com B e as iterações atuais; com `legacySealFallback: false` ela é rejeitada.

### RF-09 — Qualidade
Testes de regressão cobrem RF-02 a RF-06 e RF-08, escritos com `describeMatrix`. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run test/session.test.ts` são executados
- **Então** os três terminam sem falhas.

## 3. Fora de escopo
- `password` aceitar array ou objeto de senhas com id (segunda alternativa da issue).
- Qualquer outro nome público novo (funções, tipos, opções adicionais).
- Mudanças nas senhas de `iron-crypto` além do necessário (ex.: formato do token, ids de senha).
- Rotação automática, armazenamento ou geração de senhas.
- Aposentadoria automática de senhas extras ou métricas de uso.
- Remoção do fallback legado (planejada para a v3).
- Alterações em outros utilitários (`sealSession` de outros fluxos, `session` de terceiros).

## 4. Premissas e riscos

### Premissas
- Cada senha extra respeita o mesmo mínimo de 32 caracteres exigido por `iron-crypto`; senhas curtas falham ao tentar abrir, como `password` hoje.
- A ordem do array é a ordem de tentativa; quem rotaciona coloca a senha mais recente primeiro.
- O token não carrega id de senha, então a identificação da senha correta é por tentativa e erro.
- A migração para a senha atual (RF-04) depende de cookie; sessões só por header continuam com a senha antiga até serem regravadas pelo cliente.

### Riscos
- **Custo de CPU**: cada tentativa falha faz PBKDF2 (8192 iterações) e, com o fallback legado, mais uma tentativa por senha. Uma lista longa multiplica o custo por requisição, o que facilita DoS com cookies inválidos. Mitigação: documentar que a lista deve ser curta e tentar primeiro `password`.
- **Erros mascarados**: hoje o erro `"Bad hmac value"` aciona o fallback legado. Com várias senhas, é preciso distinguir "senha errada" de "sessão expirada/malformada" para não reabrir com a senha seguinte uma falha que não é de senha, nem esconder a causa real.
- **Expiração**: as checagens de `maxAge`/`idleTimeout` devem ocorrer depois de qualquer unseal bem-sucedido (RF-06); a ordem errada deixaria uma sessão expirada passar.
- **Segurança**: senha vazada que permanece em `extraUnsealPasswords` continua abrindo sessões; deve ser removida assim que as sessões migrarem (a documentação deve dizer isso).
- **Regressão**: `unsealSession` é exportada e usada por fora de `getSession`; mudar sua assinatura ou seus erros pode quebrar testes existentes. A mudança deve manter a assinatura pública atual.
