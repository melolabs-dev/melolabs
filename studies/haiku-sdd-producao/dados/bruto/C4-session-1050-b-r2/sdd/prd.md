# PRD — Múltiplas senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (primeira alternativa proposta) e contrato enxuto #1050-b em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession` / `SessionConfig` aceita uma única `password`, que é usada tanto para selar (gerar o cookie) quanto para abrir (unseal) as sessões. Ao rotacionar o segredo, a troca da `password` invalida todas as sessões já emitidas: quem estava logado é deslogado no momento do deploy da nova chave.

### Objetivo

Permitir que a aplicação troque a senha de selagem sem invalidar sessões existentes. A nova senha sela; senhas anteriores, configuradas em um campo novo, apenas abrem sessões já emitidas. Quem não usar o campo novo continua com o comportamento atual.

### Fora do problema

Este PRD não trata de invalidar sessões antigas de forma forçada nem de rotação automática de chaves.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores que só servem para abrir sessões. A `password` continua sendo `string` e continua sendo a única usada para selar. Nenhum outro nome público novo é introduzido.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** o tipo `SessionConfig` é verificado pelo TypeScript,
- **Então** o campo é aceito como opcional, do tipo `string[]`, e `password` continua sendo `string`.

### RF-02 — Selagem sempre com `password`

Toda sessão nova ou resselada é selada com `password`, nunca com uma senha de `extraUnsealPasswords`.

**Critério de aceite**

- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `useSession` cria uma sessão e a sela,
- **Então** o cookie resultante abre com `"senha-nova"` e não abre apenas com `"senha-antiga"`.

### RF-03 — Abertura tenta `password` e depois as senhas extras, em ordem

Ao abrir um cookie, a biblioteca tenta primeiro `password`, depois cada item de `extraUnsealPasswords` na ordem em que foram declarados, e para na primeira que abrir o cookie.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** a requisição chega com esse cookie e a sessão é lida,
- **Então** os dados da sessão são retornados normalmente, sem erro e sem criar uma sessão nova.

### RF-04 — Caminho legado também tenta as senhas extras

O fallback para sessões seladas com a iteração legada do PBKDF2 (uma iteração) também deve tentar `password` e depois `extraUnsealPasswords`, para que sessões antigas sejam aceitas durante a rotação.

**Critério de aceite**

- **Dado** um cookie selado com a senha antiga usando a iteração legada,
- **Quando** a configuração tem `password` nova e a senha antiga em `extraUnsealPasswords`,
- **Então** a sessão é aberta pelo fallback legado e os dados são retornados.

### RF-05 — Migração das sessões abertas com senha extra

Quando uma sessão é aberta com uma senha de `extraUnsealPasswords`, ela é resselada com `password` pelo caminho que já existe para sessões legadas e para o `idleTimeout`. Assim, a rotação migra as sessões à medida que são usadas.

**Critério de aceite**

- **Dado** uma sessão aberta com `"senha-antiga"` (senha extra) e uma configuração com `password: "senha-nova"`,
- **Quando** `getSession` conclui a leitura e o reselo ocorre,
- **Então** o cookie emitido na resposta abre com `"senha-nova"`.

> Observação: o reselo só acontece quando o caminho existente decide resselar (sessão legada ou janela de `idleTimeout`). Ver premissa P-03.

### RF-06 — Sem senhas extras, comportamento inalterado

Se `extraUnsealPasswords` não for definido ou for um array vazio, as sessões se comportam exatamente como hoje, incluindo mensagens, cookies emitidos e o caminho legado.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente de `test/session.test.ts` é executada,
- **Então** todos os testes existentes passam sem alteração de asserções.

### RF-07 — Senha errada continua sendo rejeitada

Se nenhuma das senhas (`password` nem as extras) abrir o cookie, o resultado é o mesmo de hoje para um cookie inválido: sessão vazia, sem erro exposto ao cliente e sem vazar qual senha foi tentada.

**Critério de aceite**

- **Dado** um cookie selado com uma senha que não está em `password` nem em `extraUnsealPasswords`,
- **Quando** `getSession` é chamado,
- **Então** a sessão retornada não tem dados do cookie, nenhum erro é lançado ao chamador e a mensagem de erro, se houver log, não contém nenhuma das senhas.

### RF-08 — Validação das senhas extras

Cada item de `extraUnsealPasswords` deve respeitar a mesma regra exigida de `password` (comprimento mínimo de 32 caracteres, conforme a documentação de `SessionConfig`). Itens inválidos devem falhar do mesmo jeito que uma `password` inválida.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords: ["curta"]`,
- **Quando** a sessão é usada pela primeira vez,
- **Então** o erro é o mesmo que seria lançado para uma `password` de 5 caracteres.

## Fora de escopo

- Trocar `password` por `string | string[]` (segunda alternativa da issue).
- Identificador de senha (`kid`) no formato do seal ou no cookie.
- Invalidação forçada de sessões antigas ou expiração antecipada por rotação.
- Rotação automática ou leitura de segredos de variáveis de ambiente.
- Mudanças no formato do seal, nos algoritmos ou no `iron-crypto` além do necessário para tentar mais de uma senha.
- Mudanças em `useSession` além da leitura do novo campo, e em cookies chunked.
- Remoção ou mudança do fallback legado (ele será removido só na v3, conforme já anunciado).
- Documentação de guia operacional de rotação (pode vir depois, em PR separado).

## Premissas

- **P-01** O seal atual não carrega identificador de senha: a biblioteca não sabe qual senha selou o cookie, então precisa tentar as senhas em sequência. Confirmar lendo `src/utils/internal/iron-crypto.ts`.
- **P-02** A lista de `extraUnsealPasswords` é pequena (algumas unidades, no máximo poucas por ciclo de rotação). Não há limite definido no contrato; a premissa é que a aplicação remove senhas antigas depois de um período.
- **P-03** A migração para a senha nova só acontece quando o caminho de reselo existente dispara (sessão legada ou janela de `idleTimeout`). Sessões abertas com senha extra e fora dessas condições continuam válidas com a senha antiga até expirar. Se o time quiser migração imediata, isso vira um requisito novo.
- **P-04** `password` e as extras já estão validadas pelo mesmo mecanismo de `iron`, então a regra de comprimento pode ser reutilizada. Confirmar na implementação.
- **P-05** Os testes existentes em `test/session.test.ts` cobrem o caminho atual e continuam válidos sem alteração de asserções (ajustes só se a mudança alterar algo que eles verificam, conforme `sdd/pedido.md`).

## Riscos

- **R-01 — Custo de CPU (amplificação).** Cada senha tentada é uma derivação PBKDF2 completa. Com N senhas extras, um cookie inválido custa até N+1 derivações, e o caminho legado dobra a conta. Um atacante que envie muitos cookies inválidos pode aumentar o uso de CPU. Mitigação possível: limite máximo de senhas extras, documentação e medição com benchmark (`pnpm bench:node`).
- **R-02 — Senhas antigas ficam ativas por tempo indefinido.** Quem mantiver uma senha extra mantém válidas as sessões seladas com ela até o TTL. Isso é o comportamento pedido, mas precisa estar documentado para quem rotaciona chaves.
- **R-03 — Vazamento de informação por tempo de resposta.** Tentar várias senhas muda o tempo de resposta conforme a posição da senha que abriu o cookie. Impacto baixo, mas deve ser considerado.
- **R-04 — Duplicatas e ordem.** Se a mesma senha aparecer em `password` e em `extraUnsealPasswords`, ela é tentada duas vezes à toa. A ordem declarada passa a valer como prioridade; isso precisa estar claro na documentação.
- **R-05 — Remoção do fallback legado na v3.** A implementação deve ser feita sem depender do fallback legado, para não criar mais um ponto a remover.
- **R-06 — Vazamento de senha em logs ou erros.** Os erros de unseal novos (se houver) não podem incluir as senhas nem o índice exato que abriu o cookie.
