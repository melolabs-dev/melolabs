# PRD — Várias senhas de unseal nas sessões

Referência: h3js/h3#1050 (primeira alternativa proposta na issue), contrato `sdd/pedido.md`.

## Problema e objetivo

Hoje `useSession`, `getSession` e `updateSession` (em `src/utils/session.ts`) usam uma única senha, `SessionConfig.password`, tanto para selar quanto para abrir o cookie. Quando o time troca essa senha, todas as sessões seladas com a senha anterior passam a ser inválidas: `unsealSession` falha, `getSession` descarta a sessão e o usuário é deslogado de forma silenciosa.

O objetivo é permitir a rotação de segredos sem deslogar os usuários: `password` continua sendo a única senha usada para selar, e uma nova lista opcional de senhas anteriores passa a ser aceita apenas para abrir sessões já existentes.

## Requisitos funcionais

### RF-01 — Abrir sessões seladas com uma senha extra

O `SessionConfig` aceita o campo opcional `extraUnsealPasswords: string[]`. Ao abrir um cookie de sessão, o sistema tenta primeiro `password` e, em seguida, cada senha da lista, até uma funcionar.

**Critério de aceite**

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B"]`, e um cookie de sessão selado com `B`
- **Quando** a requisição chega e a sessão é lida com `getSession` ou `useSession`
- **Então** os dados da sessão são carregados normalmente e `session.id` corresponde ao id original

### RF-02 — Selar sempre com a senha atual

Toda nova selagem (`updateSession`, `sealSession`, resselagem de sessão) usa exclusivamente `password`. `extraUnsealPasswords` nunca é usada para selar.

**Critério de aceite**

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B"]`
- **Quando** `updateSession` grava dados em uma sessão nova
- **Então** o cookie resultante é aberto por uma configuração com somente `password` = `A`, e falha com somente `password` = `B`

### RF-03 — Resselar sessões abertas com senha extra

Quando uma sessão de cookie é aberta com uma senha extra, o sistema emite um novo `Set-Cookie` selado com `password`, para que a sessão deixe de depender da senha antiga.

**Critério de aceite**

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B"]`, e um cookie selado com `B` que chega em uma requisição de leitura
- **Quando** `getSession` é chamado
- **Então** a resposta contém um `Set-Cookie` da sessão, e abrir esse novo cookie com somente `password` = `A` retorna a mesma sessão

### RF-04 — Expiração independente da senha usada

`maxAge` e `idleTimeout` são aplicados da mesma forma, qualquer que seja a senha que abriu o cookie.

**Critério de aceite**

- **Dado** uma sessão selada com `B`, cujo `maxAge` já foi ultrapassado
- **Quando** a sessão é lida com uma configuração de `password` = `A` e `extraUnsealPasswords` = `["B"]`
- **Então** a sessão é tratada como expirada: não há dados carregados e uma nova sessão é iniciada

### RF-05 — Compatibilidade sem senhas extras

Sem `extraUnsealPasswords` (campo ausente ou lista vazia), o comportamento é idêntico ao atual, e a suíte existente passa sem alterar as verificações dos testes.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`
- **Quando** `pnpm vitest run test/session.test.ts` é executado
- **Então** todos os testes existentes passam, e os que dependem do comportamento antigo continuam verificando o mesmo resultado

### RF-06 — Interação com o fallback de selo legado

As senhas extras também são testadas com o fallback de 1 iteração PBKDF2 (`legacySealFallback`). A opção `legacySealFallback: false` continua rejeitando qualquer selo legado, inclusive os feitos com senhas extras.

**Critério de aceite**

- **Dado** um cookie selado com `B` usando 1 iteração PBKDF2, e uma configuração com `password` = `A`, `extraUnsealPasswords` = `["B"]` e `legacySealFallback` não definido
- **Quando** a sessão é lida
- **Então** a sessão é aberta e resselada com `A`
- **E** se `legacySealFallback: false` for definido, a mesma leitura não abre a sessão

### RF-07 — Contrato público

A única mudança na API pública é o campo `extraUnsealPasswords?: string[]` em `SessionConfig`, com TSDoc explicando que as senhas só abrem sessões. Nenhum outro nome público é criado.

**Critério de aceite**

- **Dado** o código do projeto após a mudança
- **Quando** `pnpm lint` e `pnpm typecheck` são executados
- **Então** ambos passam, e `SessionConfig` expõe `extraUnsealPasswords` como `string[]` opcional, sem nenhuma exportação nova em `src/index.ts`

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue).
- Rotação automática, agendada ou por tempo; a troca de senha continua sendo feita pelo desenvolvedor na configuração.
- Lista de revogação ou invalidação de sessões antigas por id.
- Mudanças em `cookie.ts`, `iron-crypto.ts` ou em outras utilidades de sessão além do necessário para RF-01 a RF-06.
- Mudança no formato do cookie selado ou no algoritmo de selagem.
- Remoção do `legacySealFallback` (continua previsto para a v3, conforme o TODO já existente).
- Suporte a `extraUnsealPasswords` no transporte por header (`sessionHeader`), além do que já é aceito hoje para leitura de header.
- Documentação em site ou guia de migração além do TSDoc do campo.

## Premissas

- A `password` atual é uma string, então o selo usa o id `default`, como hoje.
- As senhas extras obedecem às mesmas regras de `password` (comprimento mínimo e validação feita por `iron-crypto`). Uma senha inválida na lista é tratada como senha que não abre nada, sem derrubar as demais.
- Sessões lidas do header não são resseladas (regra já existente); para elas, RF-03 não se aplica, e a sessão continua válida até expirar pelo selo original.
- Reselar sessões abertas com senha extra (RF-03) é desejado para que a rotação termine de fato. Se o time preferir manter as sessões antigas até expirarem, RF-03 pode ser removido sem afetar os demais requisitos.
- A lista de senhas extras é pequena (poucas entradas por rotação).

## Riscos

- **Amplificação de custo (DoS):** cada tentativa de abrir um cookie inválido custa uma derivação PBKDF2 por senha, e o fallback legado dobra esse custo. Uma lista longa ou cookies forjados podem aumentar o custo por requisição. Mitigação: documentar que a lista deve ser curta e removida após a rotação; avaliar um limite de tamanho da lista na validação.
- **Senha antiga continua válida:** enquanto a senha antiga estiver na lista, quem a tiver vazada pode abrir sessões que ainda não expiraram. A remoção da senha antiga deve ser feita depois do prazo de `maxAge`/`idleTimeout`.
- **Logout silencioso após remoção:** se a senha antiga sair da lista antes das sessões expirarem, essas sessões voltam a ser descartadas sem aviso, como hoje.
- **Escrita em requisições de leitura:** RF-03 faz uma leitura emitir `Set-Cookie`, o que pode afetar caches intermediários e o tamanho do cookie em chunks. O padrão já existe para `idleTimeout` e legado, mas precisa ser coberto por teste.
- **Divergência entre `getSession` e `unsealSession`:** a lógica de tentativa com várias senhas precisa ficar em um único ponto, para que o fallback legado e as checagens de expiração sejam aplicados de forma idêntica a cada senha.
