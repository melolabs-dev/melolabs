# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050, variante 2)

## Problema e objetivo

Hoje `useSession` / `SessionConfig.password` aceita uma única senha. Ela sela e abre todas as sessões. Quando o time troca o segredo de sessão (rotação), todas as sessões seladas com a senha anterior passam a ser inválidas, e os usuários são deslogados.

O objetivo é permitir a rotação sem invalidar sessões existentes. Nesta variante, a rotação é configurada no próprio campo `password`: uma lista não vazia de senhas, em que a primeira sela e as demais só abrem sessões. Uma string continua funcionando como hoje.

Referência: issue h3js/h3#1050, segunda alternativa proposta nela.

### Restrições

- Nenhum nome público novo. A mudança se restringe ao tipo de `SessionConfig.password`.
- Com uma senha só, o comportamento deve ser idêntico ao atual.
- A suíte existente continua passando. Só código e testes que dependem do que muda podem ser ajustados, sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.

## Requisitos funcionais

### RF-01 — `password` aceita string ou lista não vazia

O tipo `SessionConfig.password` passa de `string` para `string | string[]`. Uma lista vazia é inválida.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password: ["senha-nova-com-32-caracteres-ou-mais", "senha-antiga-com-32-caracteres-ou-mais"]`,
- **Quando** o tipo é verificado pelo TypeScript,
- **Então** a configuração compila sem erro.

- **Dado** uma configuração com `password: []`,
- **Quando** a sessão é selada ou aberta pela primeira vez,
- **Então** um erro claro indica que a lista de senhas não pode ser vazia.

### RF-02 — A primeira senha sela

Ao selar uma sessão, só a primeira senha da lista é usada. As demais nunca são usadas para selar.

**Critério de aceite**

- **Dado** `password` como lista de duas senhas `[A, B]`,
- **Quando** uma sessão é selada com `useSession`,
- **Então** o cookie é aberto com a configuração `[A, B]`, e não é aberto com a configuração `[B]`.

### RF-03 — Abertura tenta todas as senhas, em ordem

Ao abrir uma sessão, cada senha da lista é tentada na ordem em que foi declarada. A primeira que validar a integridade é usada.

**Critério de aceite**

- **Dado** uma sessão selada com `B`, a senha antiga, e uma configuração `password: [A, B]`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é lida com os dados originais, sem erro e sem deslogar o usuário.

- **Dado** uma sessão selada com uma senha `C` que não está na lista,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é tratada como inválida, do mesmo jeito que hoje uma senha errada é tratada.

### RF-04 — Compatibilidade com uma senha

Quando `password` é uma string, o comportamento é o mesmo de hoje, incluindo o formato selado e o fallback legado de iterações.

**Critério de aceite**

- **Dado** uma configuração com `password` como string e uma sessão selada pela versão atual,
- **Quando** a sessão é lida e regravada com a nova versão,
- **Então** os dados, o formato do cookie e o resultado são iguais aos da versão atual.

### RF-05 — Fallback legado funciona com cada senha

O fallback de iterações legadas (`legacySealFallback`) deve valer para cada senha da lista. Uma sessão antiga, selada com a senha antiga e com 1 iteração, precisa abrir mesmo sendo a segunda senha da lista.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `B` usando 1 iteração de PBKDF2, e uma configuração `password: [A, B]` com `legacySealFallback` ativo (padrão),
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é aberta e o indicador de selagem legada é marcado, como acontece hoje com uma senha só.

- **Dado** a mesma sessão e `legacySealFallback: false`,
- **Quando** a requisição chega,
- **Então** a sessão é tratada como inválida.

### RF-06 — Limites de vida da sessão continuam valendo

`maxAge` e `idleTimeout` são verificados da mesma forma, independentemente de qual senha abriu a sessão.

**Critério de aceite**

- **Dado** uma sessão selada com a senha antiga `B` e `maxAge` vencido,
- **Quando** a requisição chega com `password: [A, B]`,
- **Então** a sessão é recusada com `Session expired!`, do mesmo jeito que com uma senha só.

## Fora de escopo

- Regravar automaticamente, na leitura, sessões abertas com uma senha que não é a primeira. Essas sessões continuam válidas, e são regravadas com a senha de selagem só quando a sessão já é regravada pelo fluxo normal (escrita ou reseal por `idleTimeout`).
- Identificar a senha pelo id dentro do cookie (por exemplo, usando o sistema de ids de senha do iron). A ordem da lista é o único critério de tentativa.
- Rotação automática de senhas, leitura de segredos de variáveis de ambiente ou qualquer integração com gerenciadores de segredo.
- Novas opções públicas, como `extraUnsealPasswords`, que a issue descreve como primeira alternativa.
- Validação de força mínima das senhas além do que a biblioteca já faz.
- Mudanças em `basicAuth`, `requireBasicAuth` ou outros módulos que usam `password` com outro sentido.

## Premissas e riscos

### Premissas

- A lista é tentada em ordem, e a primeira senha que abre a sessão vence. Com senhas distintas, a chance de colisão é desprezível.
- `src/utils/session.ts` é o único ponto que usa `config.password` para selar e abrir. A verificação feita antes da implementação indicou três usos nesse arquivo (selagem em `sealSession` e duas chamadas de abertura em `unsealSession`). A implementação deve confirmar isso.
- Os testes de sessão ficam em `test/session.test.ts`, com a bancada em `test/bench/session.ts`.
- O requisito de tamanho de 32 caracteres descrito na documentação de `password` continua sendo orientação de uso, não uma validação nova. Este PRD não adiciona essa validação.

### Riscos

- **Custo de desempenho:** cada tentativa de abertura com senha errada gasta PBKDF2 completo. Com N senhas, uma sessão de senha antiga pode custar até N tentativas. Como a lista é curta, o impacto esperado é pequeno, mas precisa ser medido na bancada.
- **Combinação com o fallback legado:** cada senha pode disparar duas tentativas (iterações atuais e legadas). Isso multiplica o custo do pior caso. A ordem de tentativas deve evitar a duplicação desnecessária.
- **Senha antiga para sempre:** sem regravação automática, a senha antiga continua aceita enquanto a lista a tiver. Quem configura a rotação precisa remover a senha antiga da lista no momento certo, e a documentação deve dizer isso.
- **Vazamento de tempo:** a ordem das tentativas pode revelar, por tempo de resposta, qual senha da lista foi usada. O risco é baixo, pois o atacante precisa do cookie e o segredo é a senha, mas deve ser mencionado na documentação.
- **Mudança de tipo:** `string | string[]` pode quebrar código que lê `config.password` como string em outro lugar. A verificação de tipos deve cobrir isso, e a mudança deve ser tratada como compatível para quem só passa string.
