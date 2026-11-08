# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

### Problema

Hoje `SessionConfig.password` é uma única string, usada tanto para selar quanto para abrir sessões (`sealSession`/`unsealSession` em `src/utils/session.ts`). Ao rotacionar a senha, todas as sessões seladas com a senha anterior deixam de abrir (falham no unseal e são substituídas por uma sessão nova), deslogando todos os usuários de uma vez.

### Objetivo

Permitir rotação de senha sem invalidar sessões existentes: `SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com senhas anteriores usadas **apenas para abrir** sessões. `password` continua string e continua sendo a única senha que sela (primeira alternativa da issue #1050). Sem o campo, o comportamento é idêntico ao atual.

### Métricas de sucesso

- Sessão selada com senha antiga é aceita após a rotação, enquanto a senha antiga constar em `extraUnsealPasswords`.
- Nenhuma regressão na suíte existente; `pnpm lint` e `pnpm typecheck` passam.

## Requisitos funcionais

### RF-01 — Novo campo opcional `extraUnsealPasswords`

`SessionConfig` expõe `extraUnsealPasswords?: string[]`, documentado em JSDoc (só abre sessões; nunca sela). Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** um `SessionConfig` com `password` e `extraUnsealPasswords: ["antiga"]`
- **Quando** o código é compilado com `pnpm typecheck`
- **Então** a configuração é aceita sem erro de tipo, e `extraUnsealPasswords` é opcional (omiti-lo também compila).

### RF-02 — Selagem usa somente `password`

`sealSession` (e, por consequência, `updateSession`) sela sempre com `config.password`, nunca com uma senha extra.

**Critério de aceite**

- **Dado** uma config com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** uma sessão é criada/atualizada e o cookie resultante é aberto
- **Então** o cookie abre com `password: "nova"` e **não** abre usando apenas `"antiga"` como `password`.

### RF-03 — Unseal aceita senhas extras

`unsealSession` tenta `password` primeiro e, se falhar por senha incorreta (HMAC inválido), tenta cada item de `extraUnsealPasswords` em ordem. A primeira que abrir vence.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` e uma config com `password: "nova"`, `extraUnsealPasswords: ["antiga"]`
- **Quando** a requisição chega com esse cookie e `getSession`/`useSession` é chamado
- **Então** o `id` e os `data` originais da sessão são preservados (não é criada sessão nova).

### RF-04 — Senha desconhecida continua rejeitada

Se nenhuma senha (principal ou extra) abrir a sessão, o comportamento é o atual: a sessão é descartada e uma nova é iniciada. Erros que não são de senha (por exemplo expiração) não disparam novas tentativas com senhas extras e continuam propagando como hoje.

**Critério de aceite**

- **Dado** uma sessão selada com `"outra"` e uma config com `password: "nova"`, `extraUnsealPasswords: ["antiga"]`
- **Quando** `getSession` é chamado com esse cookie
- **Então** a sessão retornada tem `id` diferente do original e `data` vazio.

### RF-05 — Resselagem com a senha atual (rotação efetiva)

Uma sessão aberta com senha extra é reselada com `password` na mesma resposta, emitindo novo `Set-Cookie`, de modo que a senha antiga possa ser removida da config depois. O mecanismo reaproveita o padrão já existente de resselagem de selos legados (`kLegacySeal`) em `getSession`, sem criar nome público novo.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` e a config `password: "nova"`, `extraUnsealPasswords: ["antiga"]`
- **Quando** `getSession` carrega a sessão a partir do cookie
- **Então** a resposta contém `Set-Cookie` cujo valor abre com `password: "nova"` e preserva `id` e `data`; e, removida a senha antiga da config, uma requisição seguinte com o novo cookie continua válida.

### RF-06 — Interação com o fallback de selo legado

A tentativa com senhas extras coexiste com `legacySealFallback` (1 iteração PBKDF2): cada senha candidata pode ser testada também no modo legado quando `legacySealFallback !== false`, e `legacySealFallback: false` continua rejeitando selos legados para todas as senhas.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` e 1 iteração PBKDF2, e config com `extraUnsealPasswords: ["antiga"]`
- **Quando** `getSession` é chamado com `legacySealFallback` omitido, e depois com `legacySealFallback: false`
- **Então** no primeiro caso a sessão é aceita e reselada com `password`; no segundo, é rejeitada e uma nova sessão é criada.

### RF-07 — Compatibilidade retroativa

Sem `extraUnsealPasswords` (ou com `[]`), o comportamento, os erros e as saídas permanecem idênticos aos atuais. Os caminhos que leem sessão pelo header (`sessionHeader`) também aceitam as senhas extras, pois compartilham `unsealSession`.

**Critério de aceite**

- **Dado** a suíte de testes existente de sessões, sem uso do novo campo
- **Quando** `pnpm vitest run test/session.test.ts` (e a suíte completa) é executado
- **Então** todos os testes passam sem perder nenhuma verificação existente; ajustes em testes existentes só ocorrem onde dependam do que a mudança altera.

### RF-08 — Cobertura de testes e qualidade

Testes de regressão cobrem RF-02 a RF-06 usando `describeMatrix` (web e node), seguindo o fluxo de bug fix do AGENTS.md (teste falha antes da mudança e passa depois).

**Critério de aceite**

- **Dado** os novos testes adicionados em `test/session.test.ts`
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos passam, e os novos testes de rotação falham se a implementação for revertida.

## Fora de escopo

- Aceitar `password` como `string[]` (segunda alternativa da issue) ou qualquer outra mudança no tipo de `password`.
- Qualquer nome público novo além de `SessionConfig.extraUnsealPasswords`.
- Mudanças em `iron-crypto`, nos algoritmos/iterações de selo ou nas opções `seal`.
- Rotação automática, armazenamento ou gestão de segredos; aplicar senhas extras a outros recursos que usem `password` fora de sessões.
- Mudanças em cookies, `maxAge`/`idleTimeout` ou na semântica de expiração.
- Alterações de documentação fora do JSDoc do novo campo (salvo decisão posterior).

## Premissas e riscos

### Premissas

- Quem rotaciona mantém a senha antiga em `extraUnsealPasswords` por pelo menos o tempo de vida das sessões (`maxAge`), e a remove depois.
- Cada senha tem entropia adequada (exigência do iron já existente, mínimo de 32 caracteres, a ser confirmado em `iron-crypto.ts`).
- A ordem do array é a ordem de tentativa; listas curtas (poucas senhas) são o caso de uso.

### Riscos

- **Custo de CPU:** cada tentativa falha executa PBKDF2 (8192 iterações) e, com fallback legado, outra de 1 iteração. Cookies inválidos custam até `(1 + N) × 2` derivações — vetor de amplificação para requisições forjadas. Mitigação: ordem fixa, limitar tentativas ao erro de senha (`Bad hmac value`) e documentar que a lista deve ser curta.
- **Distinção de erros:** só falhas de HMAC devem levar à próxima senha; tratar qualquer erro como "tentar outra" poderia mascarar expiração ou payload corrompido. Mitigação: reaproveitar a checagem de `error.message` já usada no fallback legado.
- **Segurança da senha antiga:** senha comprometida em `extraUnsealPasswords` continua abrindo sessões enquanto estiver listada; a resselagem (RF-05) reduz essa janela, mas não a elimina.
- **Resselagem via header:** sessões lidas por `sessionHeader` não são reseladas (comportamento atual); continuam dependendo da senha extra até expirarem.
- **Acoplamento com a lógica legada:** combinar candidatos de senha com o fallback de 1 iteração aumenta a complexidade de `unsealSession`; manter o arquivo curto (< 200 LoC, conforme AGENTS.md) pode exigir extrair um helper interno (não exportado).
