# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

Hoje `SessionConfig` aceita uma única `password`, usada para selar e abrir o cookie de sessão (`src/utils/session.ts`). Ao rotacionar a senha, todas as sessões seladas com a senha anterior deixam de abrir e os usuários perdem a sessão.

**Objetivo:** permitir configurar senhas anteriores que apenas abrem sessões, por meio do campo opcional `extraUnsealPasswords: string[]` em `SessionConfig`. `password` continua string e continua sendo a única senha que sela. Sem o campo, o comportamento é idêntico ao atual. Referência: primeira alternativa da issue h3js/h3#1050.

## Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords`

`SessionConfig` ganha `extraUnsealPasswords?: string[]`, documentado como senhas anteriores usadas só para abrir sessões. Nenhum outro nome público novo é criado.

**Critério de aceite:**

- Dado uma configuração de sessão com `password` e sem `extraUnsealPasswords`
- Quando uma requisição com cookie selado com essa `password` é processada
- Então a sessão é lida exatamente como hoje, sem mudança de comportamento.

### RF-02 — Abrir sessões seladas com senha anterior

Se o unseal com `password` falhar, as senhas de `extraUnsealPasswords` são tentadas, em ordem, até uma funcionar.

**Critério de aceite:**

- Dado um cookie selado com a senha antiga A e uma configuração com `password` B e `extraUnsealPasswords: [A]`
- Quando a sessão é lida
- Então os dados e o `id` da sessão original são recuperados.

### RF-03 — Selar sempre com `password`

Toda selagem (criação, atualização, reseal) usa somente `password`, nunca uma senha extra.

**Critério de aceite:**

- Dado uma sessão aberta com a senha extra A, com `password` B
- Quando a sessão é atualizada ou resselada e o novo cookie é emitido
- Então o novo cookie abre com B sozinho e não abre com A sozinha.

### RF-04 — Migração para a nova senha

Uma sessão aberta por senha extra é reselada com `password` na mesma requisição em que for lida, para que a senha antiga possa ser removida depois.

**Critério de aceite:**

- Dado um cookie selado com a senha extra A
- Quando a sessão é lida por `getSession`/`useSession`
- Então a resposta traz `Set-Cookie` selado com `password`, preservando `id`, `createdAt` e `data`.

### RF-05 — Rejeitar senhas desconhecidas

Cookies selados com senha que não esteja em `password` nem em `extraUnsealPasswords` continuam sendo rejeitados como hoje (nova sessão criada).

**Critério de aceite:**

- Dado um cookie selado com uma senha C ausente da configuração
- Quando a sessão é lida
- Então ele é descartado e uma nova sessão, sem os dados antigos, é criada.

### RF-06 — Regras de expiração e seal preservadas

As senhas extras respeitam `maxAge`, `idleTimeout`, `seal` e o fallback legado de 1 iteração PBKDF2 (`legacySeal`) como na senha principal.

**Critério de aceite:**

- Dado um cookie expirado (além de `maxAge`) selado com senha extra
- Quando a sessão é lida
- Então ele é rejeitado como seria com `password`.

### RF-07 — Qualidade

Testes cobrem RF-01 a RF-06. A suíte existente passa (ajustando apenas testes/código que dependam do que mudou, sem perder o que verificam), assim como `pnpm lint` e `pnpm typecheck`.

**Critério de aceite:**

- Dado a implementação concluída
- Quando `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- Então todos terminam sem falhas.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue).
- Novas funções, exports ou opções públicas além de `extraUnsealPasswords`.
- Gestão/armazenamento de segredos, agendamento ou automação da rotação.
- Mudanças em `src/types/context.ts` (`password?` do contexto) além do necessário para compilar.
- Alterações em outros módulos (cookies, auth, CORS etc.).

## Premissas e riscos

**Premissas**

- `extraUnsealPasswords` é ordenada da mais recente para a mais antiga; vazio ou ausente equivale a hoje.
- As senhas extras têm as mesmas exigências da principal (mínimo de 32 caracteres).
- O unseal em `unsealSession` é o ponto único de leitura, então a mudança fica concentrada em `src/utils/session.ts`.

**Riscos**

- **Custo:** cada senha tentada repete PBKDF2; uma lista longa e cookies inválidos aumentam a CPU (risco de DoS leve). Mitigação: documentar que a lista deve ser curta.
- **Distinguir erro de senha de erro de dados:** tentar a próxima senha em qualquer falha pode mascarar outros erros (expiração). A expiração deve ser avaliada só após um unseal bem-sucedido.
- **Interação com o fallback legado:** combinar senhas extras com a tentativa de 1 iteração pode multiplicar as tentativas; a ordem deve ser definida e testada.
- **Senha antiga vazada:** manter senhas extras amplia a janela de risco; o RF-04 reduz o tempo de permanência.
