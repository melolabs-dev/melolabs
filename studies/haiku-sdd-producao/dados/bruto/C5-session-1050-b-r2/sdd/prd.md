# PRD — Várias senhas de unseal nas sessões (#1050-b)

## Problema e objetivo

Quem usa `useSession` / `getSession` com a opção `password` não tem como trocar a senha sem invalidar todas as sessões já emitidas. Ao rotacionar o segredo, cada cookie selado com a senha antiga passa a ser rejeitado, e o usuário é deslogado.

Issue de referência: h3js/h3#1050. Esta variante segue a primeira alternativa proposta na issue: um campo novo em `SessionConfig`, com as senhas anteriores.

**Objetivo:** permitir a rotação da senha de sessão sem perder as sessões válidas. A senha atual sela; as senhas anteriores, listadas em `extraUnsealPasswords`, só abrem sessões já existentes. Sessões abertas com uma senha anterior são reseladas com a senha atual, o que migra o cookie aos poucos.

## Requisitos funcionais

### RF-01 — Abrir sessões seladas com senha anterior

Quando `SessionConfig.extraUnsealPasswords` contém senhas, o sistema tenta abrir o cookie com `password` e, se falhar, com cada senha de `extraUnsealPasswords`, na ordem da lista.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `A`,
- **Quando** a configuração tem `password: "B"` e `extraUnsealPasswords: ["A"]` e a requisição traz esse cookie,
- **Então** `getSession` devolve os dados da sessão, sem erro e sem sessão vazia.

### RF-02 — Selar sempre com a senha atual

As senhas de `extraUnsealPasswords` nunca são usadas para selar. Toda sessão nova ou resselada usa `password`.

**Critério de aceite**

- **Dado** uma configuração com `password: "B"` e `extraUnsealPasswords: ["A"]`,
- **Quando** `useSession` cria ou atualiza uma sessão,
- **Então** o cookie resultante só abre com `"B"` e não abre com `"A"`.

### RF-03 — Migração ao abrir com senha anterior

Quando a sessão é aberta com uma senha de `extraUnsealPasswords`, o cookie é resselado com `password` na mesma leitura, como já ocorre hoje com cookies legados.

**Critério de aceite**

- **Dado** uma sessão selada com `"A"` e uma configuração com `password: "B"` e `extraUnsealPasswords: ["A"]`,
- **Quando** a sessão é lida e a resposta traz um novo cookie,
- **Então** esse cookie abre com `"B"` sem usar `"A"`.

### RF-04 — Senha inválida em todas as tentativas

Se nenhuma senha (`password` nem as de `extraUnsealPasswords`) abre o cookie, o comportamento é o mesmo de hoje para uma senha errada.

**Critério de aceite**

- **Dado** uma sessão selada com `"C"`, que não está na configuração,
- **Quando** a configuração tem `password: "B"` e `extraUnsealPasswords: ["A"]`,
- **Então** `getSession` devolve uma sessão vazia, sem dados, e não lança erro.

### RF-05 — Compatibilidade sem senhas extras

Sem `extraUnsealPasswords` (ou com lista vazia), o comportamento é idêntico ao atual, inclusive o fallback para sessões seladas com 1 iteração de PBKDF2 e a opção `seal`.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente de sessões é executada,
- **Então** todos os testes passam sem alteração de comportamento.

### RF-06 — Superfície pública restrita

O único nome público novo é o campo opcional `extraUnsealPasswords: string[]` em `SessionConfig`. `password` continua sendo `string`.

**Critério de aceite**

- **Dado** o tipo `SessionConfig` exportado,
- **Quando** o projeto passa pelo typecheck,
- **Então** `extraUnsealPasswords` é opcional, do tipo `string[]`, e nenhum outro export público novo aparece.

### RF-07 — Qualidade do projeto

A mudança mantém `pnpm lint` e `pnpm typecheck` passando, e os testes novos cobrem RF-01 a RF-04.

**Critério de aceite**

- **Dado** a branch com a mudança,
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run test/` são executados,
- **Então** os três terminam sem falhas.

## Fora de escopo

- Aceitar `password` como array, com a primeira senha selando e as demais só abrindo (segunda alternativa da issue #1050).
- Identificar a senha pelo `id` do iron (`{ id, secret }` ou mapa de senhas por id). A lista é tentada em ordem, sem ids.
- Automatizar a rotação (agendar troca de senha, remover senhas antigas, expirar a lista).
- Alterar `sealSession`, `unsealSession` ou outras APIs de sessão além do necessário para aceitar a lista.
- Mudar o formato do cookie, o algoritmo de seal ou o número de iterações padrão.
- Limitar ou validar o tamanho da lista de senhas extras.
- Mudanças em `useSession` que não sejam o suporte ao campo novo.

## Premissas

- A leitura de cookies já passa por `unsealSession`, e o reseal de `getSession` pode ser estendido para cookies abertos com senha extra (hoje ele reselá cookies legados).
- Senhas são strings, e o iron aceita strings sem id, sob o id padrão `default`. Assim, não é preciso mudar o formato selado.
- Tentar várias senhas em sequência não cria uma falha de segurança: cada tentativa só abre o cookie se a senha estiver na lista.
- A lista de senhas extras é pequena, na ordem de unidades a poucas dezenas.
- Quem mantém a lista é responsável por remover senhas antigas quando já não houver sessões com elas.

## Riscos

- **Custo de CPU:** cada senha extra é uma tentativa de PBKDF2. Uma requisição com cookie inválido paga o custo de todas as senhas. Isso pode ser usado para gastar CPU; convém medir.
- **Combinação com o fallback legado:** se o fallback de 1 iteração for aplicado a cada senha, o número de derivações cresce de forma multiplicativa. A regra exata precisa ser definida na implementação.
- **Senha antiga esquecida na lista:** manter senhas antigas por tempo indefinido enfraquece a rotação. Não há prazo previsto nesta versão.
- **Ordem de tentativa:** se a mesma senha aparecer em `password` e em `extraUnsealPasswords`, o resultado não muda, mas a tentativa é repetida. Vale deduplicar ou documentar.
- **Testes existentes:** a mudança em `unsealSession` pode exigir ajuste em testes que fixam o número de chamadas ou o formato de erro. Qualquer ajuste deve preservar o que o teste verifica.
