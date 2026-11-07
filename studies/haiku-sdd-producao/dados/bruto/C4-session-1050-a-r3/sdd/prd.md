# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` / `getSession` (`src/utils/session.ts`) aceitam uma única senha, `SessionConfig.password`, usada tanto para selar quanto para desselar o cookie (e o header de sessão). Ao trocar essa senha, todas as sessões já emitidas deixam de ser aceitas e os usuários são deslogados de uma vez. Quem gira segredos de forma periódica precisa de uma janela de transição.

**Objetivo:** permitir que `password` receba uma lista de senhas. A primeira sela os cookies novos; as demais só abrem sessões já emitidas. Assim, uma rotação não invalida sessões válidas.

Esta é a segunda alternativa proposta na issue h3js/h3#1050. A primeira alternativa (um campo novo `extraUnsealPasswords`) está descartada: o pedido proíbe nomes públicos novos.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `password`

`SessionConfig.password` passa a aceitar `string | string[]`. Uma lista precisa ter pelo menos uma entrada.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password: ["senha-nova-com-32-caracteres-ou-mais", "senha-antiga-com-32-caracteres-ou-mais"]`
- **Quando** o código compila e `useSession` é chamado
- **Então** a configuração é aceita sem erro de tipo e sem erro de execução.

### RF-02 — Selar sempre com a primeira senha

Ao selar (`sealSession`), a primeira senha da lista é a única usada. Uma string é tratada como lista de um item.

**Critério de aceite**

- **Dado** `password: [senhaA, senhaB]` e uma sessão nova
- **Quando** a sessão é selada e o cookie é emitido
- **Então** o cookie só pode ser aberto com `senhaA`; abri-lo com apenas `senhaB` falha.

### RF-03 — Desselar tentando as senhas em ordem

Ao desselar (`unsealSession`), as senhas são tentadas na ordem da lista. A primeira que validar a integridade do cookie é usada. Se nenhuma validar, o resultado é o mesmo de hoje quando a senha única não bate.

**Critério de aceite**

- **Dado** `password: [senhaNova, senhaAntiga]` e um cookie selado com `senhaAntiga`
- **Quando** uma requisição chega com esse cookie
- **Então** `getSession` devolve a sessão original com `id` e `data` preservados.

- **Dado** o mesmo `password` e um cookie selado com uma terceira senha, desconhecida
- **Quando** uma requisição chega com esse cookie
- **Então** `getSession` devolve uma sessão nova e vazia, sem erro propagado, como acontece hoje com senha errada.

### RF-04 — Compatibilidade com a senha única

Com `password` como string, o comportamento deve ser idêntico ao atual: mesmo formato de cookie, mesmas opções de `seal`, mesmo fallback legado.

**Critério de aceite**

- **Dado** a suíte de testes existente e `password` como string
- **Quando** `pnpm vitest run` é executado
- **Então** todos os testes passam sem alteração de comportamento. Ajustes são permitidos apenas onde a implementação muda um detalhe interno que o teste verificava indiretamente, mantendo o que ele verifica.

### RF-05 — Rejeitar lista vazia

Uma lista vazia não tem senha para selar e precisa falhar de forma explícita.

**Critério de aceite**

- **Dado** `password: []`
- **Quando** `useSession`, `getSession` ou `updateSession` é chamado
- **Então** a chamada falha com um erro que diz que é preciso ao menos uma senha. Nenhum cookie é emitido.

### RF-06 — Fallback legado com qualquer senha da lista

O fallback de iterações PBKDF2 legadas (`legacySealFallback`, cookies selados com 1 iteração) deve funcionar para cada senha da lista, não só para a primeira.

**Critério de aceite**

- **Dado** `password: [senhaNova, senhaAntiga]`, `legacySealFallback` não desligado, e um cookie selado com `senhaAntiga` nas iterações legadas
- **Quando** a requisição chega
- **Então** a sessão é aberta, e como `legacySeal` está marcado, o cookie é resselado com `senhaNova`.

- **Dado** `legacySealFallback: false` e o mesmo cookie legado
- **Quando** a requisição chega
- **Então** a sessão não é aberta, como hoje.

### RF-07 — Migração gradual para a senha atual

Sessões abertas com uma senha antiga são resseladas com a senha atual quando o código já reselaria a sessão: fallback legado ou deslizamento de `idleTimeout`. Não é feita varredura em lote.

**Critério de aceite**

- **Dado** `idleTimeout` configurado, `password: [senhaNova, senhaAntiga]` e um cookie selado com `senhaAntiga` que passou da metade da janela ociosa
- **Quando** a requisição chega
- **Então** a resposta traz um `Set-Cookie` selado com `senhaNova`, e uma requisição seguinte só é aceita com `senhaNova` quando a senha antiga for removida da lista.

### RF-08 — Header de sessão segue a mesma regra

Quando a sessão vem pelo header (`sessionHeader`), a desselagem usa a mesma lista e a mesma ordem.

**Critério de aceite**

- **Dado** `password: [senhaNova, senhaAntiga]` e uma requisição com header `x-h3-session` contendo um valor selado com `senhaAntiga`
- **Quando** `getSession` é chamado
- **Então** a sessão é aberta com `id` e `data` originais.

### RF-09 — Qualidade do código

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** `pnpm lint` e `pnpm typecheck` são executados
- **Então** ambos passam, sem nomes públicos novos além da mudança do tipo de `SessionConfig.password`.

## Fora de escopo

- Novo campo de opções como `extraUnsealPasswords` (alternativa 1 da issue, descartada pelo pedido).
- Nomes públicos novos de qualquer tipo.
- Varredura ou migração em lote de sessões antigas. A migração é apenas gradual (RF-07).
- Invalidação explícita de sessões emitidas com uma senha específica (revogação por chave).
- Remoção do fallback legado (`legacySealFallback`), que continua previsto para a v3.
- Suporte a senhas com id (`{ id: secret }`) do `iron-crypto` na configuração de sessão.
- Mudança em outras partes que usam senha (ex.: `requireBasicAuth` em `src/utils/auth.ts`).
- Documentação extensa além do JSDoc de `SessionConfig.password` e de uma nota de rotação.
- Sinalização, log ou métrica de qual senha da lista abriu cada sessão.

## Premissas

- A lista usa a ordem como prioridade: a primeira é a atual, as demais são antigas. Quem configura a ordem errada faz as sessões serem seladas com a senha antiga; isso é responsabilidade de quem configura, não um erro detectável pelo código.
- O formato do cookie selado não muda. A primeira senha é passada ao `seal` como string, como hoje, então o token gerado é idêntico ao de uma configuração com senha única.
- O requisito mínimo de 32 caracteres (`minPasswordlength` no `iron-crypto`) vale para cada item da lista.
- O custo de CPU extra é aceitável: cada tentativa de desselagem roda PBKDF2 (padrão de 8192 iterações), então com N senhas a conta sobe para até N operações.
- Quem lê `config.password` como string em código próprio pode precisar de ajuste de tipo. Isso é aceito como mudança de tipo do pedido.

## Riscos

1. **Amplificação de CPU (DoS).** Um cookie inválido ou forjado faz o servidor tentar todas as N senhas, e com o fallback legado até 2N derivações PBKDF2. *Mitigação:* limitar o tamanho da lista na validação (ex.: poucos itens) e documentar o custo. A decisão de limite fica para a implementação.
2. **Senha curta na cauda da lista some em silêncio.** Hoje, `unsealSession` relança o erro e `getSession` o engole com `.catch`. Com a lista, uma senha antiga curta faria a sessão simplesmente não abrir, sem indicar a causa. *Mitigação:* validar o tamanho de todas as entradas na configuração, junto com a validação de lista vazia de RF-05.
3. **Ordem trocada.** Colocar a senha antiga na frente faz as sessões novas serem seladas com ela, sem erro visível. *Mitigação:* documentar a ordem no JSDoc.
4. **Mensagem de erro ambígua.** Se nenhuma senha bate, o erro precisa seguir o caminho atual, sem vazar qual senha foi tentada.
5. **Testes que assumem `password` como string.** A suíte pode ter verificações indiretas que quebram com a mudança interna. *Mitigação:* manter as verificações e ajustar só o que depender da estrutura interna, conforme RF-04.
6. **Sessões antigas podem demorar a migrar.** Sem varredura, uma sessão que nunca desliza continua com a senha antiga até expirar. Isso é esperado, mas precisa estar claro para quem planeja a remoção da senha antiga; o prazo depende de `maxAge`/`idleTimeout`.
