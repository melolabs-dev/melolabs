# Contrato: várias senhas de unseal em sessões, variante (a) (h3js/h3#1050)

> Texto para o enunciado dos modelos. Descreve o comportamento esperado; não traz valores, nomes de teste nem trechos dos testes ocultos.

## Objetivo
Permitir a rotação da senha das sessões (`src/utils/session.ts`) sem derrubar quem já está logado: depois de trocar a senha, o app continua aceitando sessões seladas com senhas anteriores, enquanto toda sessão nova ou regravada passa a ser selada com a senha atual. Nesta variante, a rotação é configurada no próprio campo `password` de `SessionConfig`.

## Comportamento esperado
1. **Configuração.** `SessionConfig.password` passa a aceitar uma string (como hoje) ou uma lista de strings não vazia. Na lista, a primeira senha é a principal; as demais são senhas anteriores, aceitas só para abrir sessões. Uma string equivale a uma lista com só essa senha.
2. **Selar.** Toda sessão selada (sessão nova, `updateSession`, `sealSession`, re-selagem automática) usa sempre a senha principal. As outras senhas nunca selam.
3. **Abrir.** Uma sessão selada com qualquer senha da lista é aberta normalmente, com `id`, `createdAt` e dados preservados. As senhas são tentadas uma de cada vez, em sequência: a principal primeiro e, se ela não abrir, as demais na ordem da lista, parando na primeira que abrir. Quando a principal abre a sessão, nenhuma outra senha é tentada (não há trabalho criptográfico extra em relação a uma configuração com uma senha só).
4. **Senha desconhecida.** Uma sessão selada com uma senha que não está na lista é tratada como inexistente, exatamente como hoje uma sessão com senha errada: o pedido segue sem erro e a sessão é nova e vazia.
5. **Rotação progressiva.** Quando `getSession` (e, portanto, `useSession`) abre uma sessão vinda do cookie com uma senha que não é a principal, a sessão é re-selada com a senha principal e enviada num novo `Set-Cookie` na mesma resposta, mesmo que o handler só leia a sessão (mesmo mecanismo que hoje re-sela sessões legadas). Sessões abertas pela senha principal não são re-seladas por isso. Sessões vindas do cabeçalho de sessão não são re-seladas.
6. **Validação.** Cada senha da lista segue a mesma regra que a senha atual: não pode ser vazia e precisa ter pelo menos o tamanho mínimo das opções de selo (`minPasswordlength`, 32 caracteres por padrão). Uma lista vazia é inválida. Com uma configuração inválida, toda operação que sela (`useSession` ao criar a sessão, `updateSession`, `sealSession`) rejeita com um erro claro cuja mensagem menciona a senha (contém a palavra "password", como as mensagens atuais), mesmo quando o pedido não traz sessão. Uma senha inválida em qualquer posição da lista provoca o erro, não só a principal.
7. **Cobertura das funções.** A abertura com senhas anteriores vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`, para sessões em cookie dividido em pedaços (chunks) e para sessões enviadas pelo cabeçalho de sessão.
8. **Sessões legadas.** O fallback atual para sessões seladas com 1 iteração de PBKDF2 (`legacySealFallback`) continua valendo e se aplica a todas as senhas da lista: uma sessão legada selada com qualquer uma delas é aberta e re-selada com a senha principal e as opções de selo atuais. `legacySealFallback: false` continua desligando o fallback.

## O que não pode mudar
- Com `password` como string, ou como lista de uma só senha, o comportamento é idêntico ao atual (inclusive não re-selar ao só ler, e rejeitar sessões de outras senhas).
- Nenhum nome público novo além da mudança de tipo de `SessionConfig.password` para `string | string[]`. Código existente (inclusive testes) que trata `config.password` como string precisa ser ajustado para que o typecheck continue passando.
- `maxAge`, `idleTimeout`, cookies em pedaços, cabeçalho de sessão, `errHeaders` e o restante do comportamento de sessão continuam como hoje.
- O conjunto de testes existente e o `pnpm lint` / `pnpm typecheck` continuam passando.
