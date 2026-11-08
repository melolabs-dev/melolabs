# PRD — Várias senhas de unseal nas sessões

Referência: h3js/h3#1050 (segunda alternativa proposta na issue). Contrato: sdd/pedido.md.

## Problema e objetivo

Hoje `useSession` sela e abre sessões com uma única senha: `SessionConfig.password: string` (`src/utils/session.ts`). Ao trocar essa senha por rotação de segredo, todas as sessões seladas com a senha anterior deixam de abrir e os usuários são desconectados.

**Objetivo:** permitir que `password` receba uma lista não vazia de senhas. A primeira senha sela as sessões novas; as demais servem apenas para abrir sessões antigas. Com uma string só, o comportamento continua igual ao de hoje.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `password`

- **Dado** uma configuração de sessão com `password` como lista não vazia de senhas,
- **Quando** a sessão é selada ou lida,
- **Então** a configuração é aceita, `SessionConfig.password` tem tipo `string | string[]` e nenhum outro nome público novo é criado.

### RF-02 — Selar sempre com a primeira senha

- **Dado** `password: ["nova", "antiga"]`,
- **Quando** uma sessão é selada,
- **Então** a sessão só pode ser aberta com `"nova"`; uma configuração com `password: "antiga"` não a abre.

### RF-03 — Abrir sessões com qualquer senha da lista

- **Dado** uma sessão selada com `"antiga"` e a configuração `password: ["nova", "antiga"]`,
- **Quando** a requisição lê a sessão,
- **Então** os dados são retornados normalmente.

### RF-04 — Rejeitar sessão selada com senha fora da lista

- **Dado** uma sessão selada com uma senha que não está na lista,
- **Quando** a requisição lê a sessão,
- **Então** a sessão é tratada como inválida, do mesmo jeito que hoje acontece com senha errada.

### RF-05 — Validar a lista de senhas

- **Dado** `password: []`,
- **Quando** a configuração é usada,
- **Então** um erro explícito é lançado.

- **Dado** uma lista com um item menor que o tamanho mínimo exigido hoje para uma senha única,
- **Quando** a configuração é usada,
- **Então** o mesmo erro de senha única é lançado.

### RF-06 — Preservar o comportamento com uma senha

- **Dado** `password` como string,
- **Quando** sessões são seladas e lidas,
- **Então** o formato do selo e o comportamento são iguais aos de hoje, e a suíte existente continua passando.

### RF-07 — Preservar o fallback de iterações legadas

- **Dado** uma sessão selada com a contagem antiga de iterações e uma lista de senhas,
- **Quando** a sessão é lida,
- **Então** ela é aberta por qualquer senha da lista, com o mesmo fallback que existe hoje para `legacySealFallback`.

### RF-08 — Regravar com a senha atual

- **Dado** uma sessão aberta com uma senha que não é a primeira da lista,
- **Quando** a sessão é escrita de novo (`updateSession` ou reselagem já existente),
- **Então** o novo cookie é selado com a primeira senha e deixa de depender da senha antiga.

### RF-09 — Cobrir os casos com testes

- **Dado** o arquivo `test/session.test.ts`, escrito com `describeMatrix` para rodar em `web` e `node`,
- **Quando** a suíte roda,
- **Então** ela cobre RF-02 a RF-08 e passa em `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck`.

## Fora de escopo

- Nova opção pública como `extraUnsealPasswords` (primeira alternativa da issue).
- Ids de senha configuráveis pelo usuário, rotação automática ou agendamento de troca de senha.
- Mudança no formato do cookie selado ou migração em massa de sessões existentes.
- Mudanças em `iron-crypto` além do estritamente necessário para a lista de senhas.
- Mudanças em outros módulos (`h3/rules`, `session header`, etc.) além do que `session.ts` precisar.
- Documentação extensa e exemplos de rotação. Podem vir depois, em um PR separado.
- Alterações no código do projeto feitas por este PRD. Ele só descreve o trabalho.

## Premissas e riscos

### Premissas

- **P1.** `config.password` é usado em três pontos de `src/utils/session.ts`: `sealSession` (linha ~300), `unsealSession` (linha ~324) e o fallback legado (linha ~340). Essa é a principal área de mudança. Ainda precisa ser confirmado com uma busca por todos os usos.
- **P2.** `iron-crypto` aceita string ou um registro de senhas por id. A implementação precisa escolher entre tentar cada senha em ordem ou atribuir ids às senhas. Essa escolha fica em aberto e deve ser verificada antes de implementar.
- **P3.** A regra de tamanho mínimo da senha (32 caracteres, conforme a documentação de `password`) vale para cada item da lista.
- **P4.** Restrições do pedido: nenhum nome público novo; com uma senha só, o comportamento não muda; ajustar só os testes existentes que dependem da mudança, sem perder o que verificam; `pnpm lint` e `pnpm typecheck` passam.

### Riscos

- **R1. Custo de CPU.** Tentar várias senhas multiplica o custo de PBKDF2 (8192 iterações por padrão) para cookies selados com senhas antigas. Convém medir com uma lista de 2 a 3 senhas.
- **R2. Senha antiga que nunca sai.** Enquanto a senha antiga estiver na lista, as sessões que ela selou continuam válidas. Remover a senha da lista invalida essas sessões. Isso precisa ficar explícito na documentação futura.
- **R3. Combinação com `legacySealFallback`.** Tentar senhas × contagens de iteração pode ser caro ou ambíguo. A ordem de tentativas precisa ser definida.
- **R4. Quebra de tipo para quem lê `config.password`.** Mudar para `string | string[]` pode quebrar código de terceiros que trata o campo como string. Isso é mudança de tipo público e precisa ser sinalizada no changelog.
- **R5. Mensagem de erro.** Lista vazia e senha desconhecida precisam de mensagens diferentes, para não confundir quem configura a aplicação.
