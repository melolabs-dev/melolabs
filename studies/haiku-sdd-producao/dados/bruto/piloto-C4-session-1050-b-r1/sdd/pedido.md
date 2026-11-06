# Issue h3js/h3#1050: FR: Allow multiple unseal passwords for sessions

### Describe the feature

When rotating secrets for use as session passwords, we'd want to continue honoring prior sealed sessions.

For the `useSession` api, can we have an additional parameter: `extraUnsealPasswords` or something similar. Passwords to attempt are the default `password` and this `extraUnsealPasswords`.

Alternatively, we can have `password` as potentially being a non empty string array, with the first `password` being used for sealing, and the rest just for unsealing.

### Additional information

- [ ] Would you be willing to help implement this feature?


---

# Contrato: várias senhas de unseal em sessões, variante (b) (h3js/h3#1050)


## Objetivo
Permitir a rotação da senha das sessões (`src/utils/session.ts`) sem derrubar quem já está logado: depois de trocar a senha, o app continua aceitando sessões seladas com senhas anteriores, enquanto toda sessão nova ou regravada passa a ser selada com a senha atual. Nesta variante, a rotação é configurada num campo novo de `SessionConfig`.

## Comportamento esperado
1. **Configuração.** `SessionConfig` ganha o campo opcional `extraUnsealPasswords`, uma lista de strings com senhas anteriores, aceitas só para abrir sessões. `password` continua sendo uma string e continua sendo a senha principal. Campo ausente e lista vazia são equivalentes: não há senhas extras.
2. **Selar.** Toda sessão selada (sessão nova, `updateSession`, `sealSession`, re-selagem automática) usa sempre `password`. As senhas de `extraUnsealPasswords` nunca selam.
3. **Abrir.** Uma sessão selada com `password` ou com qualquer senha de `extraUnsealPasswords` é aberta normalmente, com `id`, `createdAt` e dados preservados. As senhas são tentadas uma de cada vez, em sequência: `password` primeiro e, se ela não abrir, as extras na ordem da lista, parando na primeira que abrir. Quando `password` abre a sessão, nenhuma senha extra é tentada (não há trabalho criptográfico extra em relação a uma configuração sem senhas extras).
4. **Senha desconhecida.** Uma sessão selada com uma senha que não é `password` nem está em `extraUnsealPasswords` é tratada como inexistente, exatamente como hoje uma sessão com senha errada: o pedido segue sem erro e a sessão é nova e vazia.
5. **Rotação progressiva.** Quando `getSession` (e, portanto, `useSession`) abre uma sessão vinda do cookie com uma senha extra, a sessão é re-selada com `password` e enviada num novo `Set-Cookie` na mesma resposta, mesmo que o handler só leia a sessão (mesmo mecanismo que hoje re-sela sessões legadas). Sessões abertas por `password` não são re-seladas por isso. Sessões vindas do cabeçalho de sessão não são re-seladas.
6. **Validação.** Cada senha extra segue a mesma regra que `password`: não pode ser vazia e precisa ter pelo menos o tamanho mínimo das opções de selo (`minPasswordlength`, 32 caracteres por padrão). Com uma configuração inválida, toda operação que sela (`useSession` ao criar a sessão, `updateSession`, `sealSession`) rejeita com um erro claro cuja mensagem menciona a senha (contém a palavra "password", como as mensagens atuais), mesmo quando o pedido não traz sessão. Uma senha extra inválida em qualquer posição da lista provoca o erro, e `password` inválida continua provocando erro como hoje.
7. **Cobertura das funções.** A abertura com senhas extras vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`, para sessões em cookie dividido em pedaços (chunks) e para sessões enviadas pelo cabeçalho de sessão.
8. **Sessões legadas.** O fallback atual para sessões seladas com 1 iteração de PBKDF2 (`legacySealFallback`) continua valendo e se aplica a `password` e a todas as senhas extras: uma sessão legada selada com qualquer uma delas é aberta e re-selada com `password` e as opções de selo atuais. `legacySealFallback: false` continua desligando o fallback.

## O que não pode mudar
- Sem `extraUnsealPasswords`, ou com a lista vazia, o comportamento é idêntico ao atual (inclusive não re-selar ao só ler, e rejeitar sessões de outras senhas).
- Nenhum nome público novo além do campo `extraUnsealPasswords` em `SessionConfig`. O tipo de `password` não muda.
- `maxAge`, `idleTimeout`, cookies em pedaços, cabeçalho de sessão, `errHeaders` e o restante do comportamento de sessão continuam como hoje.
- O conjunto de testes existente e o `pnpm lint` / `pnpm typecheck` continuam passando.