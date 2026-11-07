# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## Problema e objetivo

**Problema.** Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita uma única `string`. Ao rotacionar a senha, todas as sessões seladas com a senha anterior deixam de abrir e os usuários perdem a sessão.

**Objetivo.** Permitir a rotação de senha sem invalidar as sessões existentes. O campo `password` passa a aceitar `string | string[]` (lista não vazia): a primeira senha sela; as demais só abrem sessões. Nenhum outro nome público novo é criado (segunda alternativa da issue h3js/h3#1050). Com uma senha só, o comportamento permanece idêntico ao atual.

## Requisitos funcionais

### RF-01 — `password` aceita string ou lista de strings
**Critério de aceite**
- **Dado** uma `SessionConfig` com `password` como `string` ou como `string[]` não vazio
- **Quando** o código é compilado (typecheck) e usado em `useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession`
- **Então** ambos os formatos são aceitos pelo tipo e nenhum outro nome público novo é exportado.

### RF-02 — A primeira senha da lista sela
**Critério de aceite**
- **Dado** `password: [nova, antiga]`
- **Quando** uma sessão é criada ou atualizada e selada
- **Então** o token só pode ser aberto com `nova`; abrir com `antiga` isoladamente falha.

### RF-03 — Todas as senhas da lista abrem sessões
**Critério de aceite**
- **Dado** uma sessão selada com `antiga` e a configuração `password: [nova, antiga]`
- **Quando** a requisição chega com esse cookie (ou header) de sessão
- **Então** a sessão é aberta com seus dados e `id` originais, sem ser descartada nem recriada.

### RF-04 — Sessão aberta com senha secundária é ressalada com a primeira
**Critério de aceite**
- **Dado** uma sessão selada com `antiga` e a configuração `password: [nova, antiga]`
- **Quando** a sessão é lida e ressalada (por escrita, `idleTimeout` ou reseal legado)
- **Então** o novo token é selado com `nova` e passa a abrir com `[nova]` apenas.

### RF-05 — Senha fora da lista é rejeitada
**Critério de aceite**
- **Dado** uma sessão selada com uma senha ausente da lista configurada
- **Quando** a requisição é processada
- **Então** a sessão não é aceita e o comportamento é o já existente para token inválido (nova sessão criada).

### RF-06 — Validação da lista de senhas
**Critério de aceite**
- **Dado** `password` igual a lista vazia, ou contendo uma senha com menos de 32 caracteres
- **Quando** a sessão é selada ou aberta
- **Então** é lançado erro explícito, consistente com a exigência atual de senha de ao menos 32 caracteres.

### RF-07 — Compatibilidade com senha única e com o seal legado
**Critério de aceite**
- **Dado** `password` como `string` (ou lista de um elemento), inclusive com sessões seladas com 1 iteração PBKDF2 (fallback legado)
- **Quando** as sessões são criadas, lidas e ressaladas
- **Então** o comportamento é idêntico ao atual, e o fallback legado também tenta cada senha da lista.

### RF-08 — Testes e documentação
**Critério de aceite**
- **Dado** a mudança implementada
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** a suíte existente passa (ajustes apenas onde dependem do que mudou, sem perder o que verificam), há testes novos para RF-02 a RF-07 e o JSDoc de `password` descreve a semântica de rotação.

## Fora de escopo

- Novo parâmetro público (ex.: `extraUnsealPasswords`) — a primeira alternativa da issue não é adotada.
- Rotação automática de segredos ou gestão/armazenamento de senhas.
- Mudanças em algoritmos, iterações ou TTL do seal (`SealOptions`).
- Remoção do fallback legado (previsto para v3).
- Alterações em cookies, chunking ou outras utilidades fora de `src/utils/session.ts` e `internal/iron-crypto.ts`, salvo o estritamente necessário.

## Premissas e riscos

**Premissas**
- A ordem da lista é significativa: índice 0 sela, os demais só abrem.
- A lista tem de ser não vazia; o tipo pode expressá-lo (`[string, ...string[]]`) ou a validação ocorre em runtime.
- `unseal` em `internal/iron-crypto.ts` pode ser chamado várias vezes, uma por senha, até uma ter sucesso.

**Riscos**
- **Desempenho:** cada tentativa de unseal usa PBKDF2 (custoso); listas longas e tokens inválidos multiplicam o custo. Mitigação: recomendar listas curtas; tentar na ordem da lista.
- **Combinação com o fallback legado:** tentativas de senha × iterações (atual e 1) podem dobrar as tentativas; a ordem deve ser definida para não alterar o resultado com senha única.
- **Mascarar erros:** ao tentar várias senhas, só falhar ao esgotar todas, sem engolir erros que não sejam de integridade/senha (ex.: expiração por TTL).
- **Quebra de tipos:** quem lê `config.password` como `string` em código próprio passa a ver `string | string[]`.
- **Senha antiga comprometida:** manter uma senha antiga na lista a mantém válida para abrir sessões; deve ser removida após a janela de rotação.
