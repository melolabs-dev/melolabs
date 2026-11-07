# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## 1. Problema e objetivo

### Problema
Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita uma única `string`, usada tanto para selar quanto para abrir a sessão. Ao rotacionar o segredo, todas as sessões seladas com a senha anterior deixam de abrir e os usuários perdem a sessão de uma só vez. A issue h3js/h3#1050 pede uma forma de continuar aceitando sessões seladas com senhas anteriores.

### Objetivo
Permitir que `password` seja uma lista não vazia de senhas (segunda alternativa da issue): a primeira sela, e todas (a primeira e as demais) podem abrir. Isso permite rotacionar segredos sem invalidar as sessões existentes. Uma `string` continua com o comportamento atual.

### Métricas de sucesso
- Uma sessão selada com uma senha antiga, ainda presente na lista, é lida normalmente após a rotação.
- Nenhum teste existente perde cobertura, e `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — `password` aceita `string | string[]`
O tipo `SessionConfig.password` passa a ser `string | string[]`. Uma lista deve ser não vazia, e o tipo deve expressar isso quando possível.

**Critério de aceite**
- **Dado** uma configuração com `password` como `string` ou como lista com ao menos uma senha
- **Quando** ela é passada a `useSession`, `getSession`, `updateSession`, `sealSession` ou `unsealSession`
- **Então** o código compila e a configuração é aceita sem erro de tipo.

### RF-02 — Compatibilidade com senha única
Com uma `string`, ou com uma lista de um só elemento, o comportamento deve ser idêntico ao atual: selagem, abertura, expiração, `idleTimeout`, reseal e fallback legado.

**Critério de aceite**
- **Dado** uma sessão criada com `password: "<senha>"`
- **Quando** ela é lida com `password: "<senha>"` ou com `password: ["<senha>"]`
- **Então** os dados da sessão são os mesmos e a suíte de testes existente passa sem perder verificações.

### RF-03 — A primeira senha sela
Toda selagem de sessão (criação, atualização, reseal) usa somente a primeira senha da lista.

**Critério de aceite**
- **Dado** `password: ["nova...", "antiga..."]`
- **Quando** uma sessão é criada ou atualizada
- **Então** o cookie gerado só abre com `"nova..."` (por exemplo, `password: "nova..."` o abre e `password: "antiga..."` não).

### RF-04 — Todas as senhas da lista abrem sessões
Ao abrir uma sessão, as senhas são tentadas em ordem (primeira, depois as demais) até uma delas abrir o cookie.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga..."` e `password: ["nova...", "antiga..."]`
- **Quando** a requisição seguinte traz esse cookie
- **Então** `getSession` devolve o mesmo `id` e os mesmos `data`, sem criar uma sessão nova.

### RF-05 — Senha desconhecida é rejeitada
Se nenhuma senha da lista abrir o cookie, a sessão é tratada como hoje: inválida, descartada e substituída por uma nova.

**Critério de aceite**
- **Dado** uma sessão selada com `"outra..."`, que não está na lista
- **Quando** a requisição chega com `password: ["nova...", "antiga..."]`
- **Então** o cookie não é aceito e `getSession` devolve uma sessão nova, com `id` diferente e sem os dados anteriores.

### RF-06 — Validação da lista
Uma lista vazia é erro de configuração. A regra existente de mínimo de 32 caracteres vale para cada senha da lista, e não só para a primeira.

**Critério de aceite**
- **Dado** `password: []`, ou uma lista com alguma senha menor que 32 caracteres
- **Quando** a sessão é selada ou aberta
- **Então** a operação falha com o mesmo tipo de erro que hoje uma senha inválida produz, sem aceitar a configuração em silêncio.

### RF-07 — Regras de sessão valem para qualquer senha
Expiração (`maxAge`, `seal.ttl`), `idleTimeout` e o fallback legado de 1 iteração PBKDF2 valem igualmente para sessões abertas com senhas não primárias.

**Critério de aceite**
- **Dado** uma sessão expirada, selada com uma senha não primária da lista
- **Quando** ela é lida
- **Então** é rejeitada exatamente como seria se tivesse sido selada com a primeira senha.

### RF-08 — Nenhuma outra API pública nova
A única mudança de superfície pública é o tipo de `SessionConfig.password`. Não são criados novos nomes exportados, opções ou parâmetros.

**Critério de aceite**
- **Dado** a API pública antes e depois da mudança
- **Quando** os exports de `src/index.ts` são comparados
- **Então** não há novos nomes exportados além da alteração de tipo em `SessionConfig`.

### RF-09 — Testes e documentação
Os testes cobrem RF-03 a RF-07. Os testes existentes que dependam do tipo antigo são ajustados sem perder o que verificam. A documentação da opção `password` descreve o novo formato.

**Critério de aceite**
- **Dado** o código final
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos passam e existem testes para rotação (RF-03, RF-04), senha desconhecida (RF-05), lista inválida (RF-06) e expiração (RF-07).

## 3. Fora de escopo
- Parâmetro separado como `extraUnsealPasswords` (primeira alternativa da issue).
- Reseal automático com a senha nova ao ler uma sessão selada com uma senha antiga. A sessão passa a ser regravada só pelos mecanismos existentes (escrita, `idleTimeout`, legado).
- Rotação automática ou gerenciamento de segredos, por exemplo leitura de cofres ou variáveis de ambiente.
- Mudanças no formato do cookie, nos algoritmos de `iron-crypto` ou nos valores padrão de `seal`.
- Remoção do fallback legado (prevista para v3).

## 4. Premissas e riscos

### Premissas
- Cada senha da lista é uma `string` com no mínimo 32 caracteres, como hoje.
- A ordem da lista define a prioridade: a primeira sela, e todas abrem.
- Quem rotaciona o segredo é responsável por retirar senhas antigas da lista depois que as sessões correspondentes expirarem.
- `sealSession` e `unsealSession` são exportadas e passam a aceitar o novo tipo via `SessionConfig`.

### Riscos
- **Custo de CPU:** o PBKDF2 é caro, e um cookie inválido ou muito antigo percorre todas as senhas (e, no caso legado, também o fallback de 1 iteração). Mitigação: documentar que a lista deve ser curta e tentar as senhas em ordem, parando na primeira que abrir.
- **Erros mascarados:** distinguir "senha errada" de "cookie corrompido ou expirado". Expiração deve ser verificada depois do unseal, uma única vez, para não ser confundida com senha errada, e um cookie expirado não deve ser reaceito por outra senha.
- **Segurança:** manter senhas antigas na lista amplia a janela de exposição de um segredo vazado. Deve ser documentado que a lista é transitória.
- **Tipos:** consumidores que leem `config.password` como `string` (por exemplo, código próprio ou plugins) quebram na compilação. Mitigação: mudança aditiva no tipo, com verificação por `pnpm typecheck` e por busca de usos no repositório.
- **Cache em memória por sessão:** garantir que a promessa de unseal em `context.sessions` não retenha resultados de uma tentativa com senha incorreta.
