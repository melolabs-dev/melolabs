# PRD: várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta na issue), contrato #1050-a em `sdd/pedido.md`.

## Problema e objetivo

Hoje `useSession` (`src/utils/session.ts`) aceita uma única `password`, usada tanto para selar quanto para abrir o cookie de sessão. Ao trocar o segredo, todas as sessões seladas com o segredo anterior deixam de abrir, e os usuários são desconectados.

Objetivo: permitir rotacionar a senha das sessões sem invalidá-las. A rotação é configurada no próprio campo `password`: a primeira senha sela, e as demais servem apenas para abrir sessões já existentes. Com uma senha só, o comportamento atual não muda.

## Requisitos funcionais

### RF-01 — `password` aceita uma lista de senhas

A configuração de sessão passa a aceitar `password` como `string | string[]`.

**Dado** uma configuração com `password: ["nova", "antiga"]`,
**Quando** a configuração é usada para criar uma sessão,
**Então** o sistema aceita a configuração sem erro de tipo nem de execução.

### RF-02 — A primeira senha sela

Ao selar uma sessão, o sistema usa somente a primeira senha da lista.

**Dado** uma configuração com `password: ["nova", "antiga"]`,
**Quando** uma sessão é selada,
**Então** o cookie resultante abre com `"nova"` e não abre com `"antiga"`.

### RF-03 — Qualquer senha da lista abre a sessão

Ao ler uma sessão, o sistema tenta abrir o cookie com cada senha da lista, na ordem, e usa a primeira que funcionar.

**Dado** um cookie selado com `"antiga"` e uma configuração com `password: ["nova", "antiga"]`,
**Quando** `getSession` lê esse cookie,
**Então** os dados da sessão são retornados íntegros.

### RF-04 — Senha única continua igual

Uma string em `password` tem o mesmo comportamento de hoje.

**Dado** uma configuração com `password: "senha-unica"`,
**Quando** uma sessão é selada e depois lida,
**Então** o resultado é idêntico ao da versão atual, e o cookie gerado abre com `"senha-unica"`.

### RF-05 — Lista vazia é rejeitada

Uma lista vazia não pode ser usada, porque não há senha para selar.

**Dado** uma configuração com `password: []`,
**Quando** o sistema tenta selar ou abrir uma sessão com essa configuração,
**Então** um erro claro é lançado, indicando que é necessária ao menos uma senha.

### RF-06 — Sessão aberta com senha antiga é resselada com a atual

Quando uma sessão é aberta com uma senha que não é a primeira da lista, o sistema grava o cookie novamente selado com a primeira senha, para que a rotação avance sem ação do usuário.

**Dado** um cookie selado com `"antiga"` e uma configuração com `password: ["nova", "antiga"]`,
**Quando** `getSession` lê esse cookie,
**Então** a resposta contém um cookie novo que abre com `"nova"`.

### RF-07 — Fallback legado funciona para qualquer senha da lista

O fallback para sessões seladas com 1 iteração PBKDF2 (o caminho `legacySeal`) continua valendo quando a senha que abre o cookie é uma das senhas extras.

**Dado** um cookie legado selado com `"antiga"` e uma configuração com `password: ["nova", "antiga"]`,
**Quando** `getSession` lê esse cookie,
**Então** a sessão é aberta e resselada com a senha atual, como acontece hoje com uma senha só.

### RF-08 — Nenhum novo nome público

A mudança não cria exports, opções de configuração nem tipos públicos novos além da mudança de tipo de `password`.

**Dado** a API pública antes e depois da mudança,
**Quando** os exports de `src/utils/session.ts` e `src/index.ts` são comparados,
**Então** a única diferença é o tipo aceito por `password`.

### RF-09 — Suíte, lint e typecheck continuam passando

**Dado** a branch com a mudança aplicada,
**Quando** `pnpm test` (ou `pnpm lint` e `pnpm vitest run test/session.test.ts` mais a suíte completa) é executado,
**Então** todos os testes existentes passam, e os novos testes cobrem RF-01 a RF-07.

## Fora de escopo

- Rotação automática ou agendada de senhas, e qualquer mecanismo para gerar ou guardar senhas.
- Outras formas de configuração propostas na issue (por exemplo, um campo `extraUnsealPasswords` separado). Só a alternativa de lista em `password` é tratada aqui.
- Mudança no formato do cookie selado ou na lógica de idle timeout e de `ttl`.
- Remoção do fallback legado de 1 iteração. Ele continua deprecated e será tratado na v3.
- Alterações em `ocache`, `rules` ou em outros utilitários além de `session`.

## Premissas e riscos

### Premissas

- A biblioteca de selagem (`src/utils/internal/iron-crypto.ts`) aceita uma senha por chamada. A implementação deve tentar cada senha em sequência, e isso precisa ser confirmado na leitura do código antes de codar.
- A ordem da lista é a única forma de indicar a senha de selagem. Não há metadado no cookie que identifique qual senha foi usada.
- Senhas têm o mesmo requisito de tamanho mínimo que a senha única atual, aplicado a cada item da lista.

### Riscos

- **Custo de desempenho:** cada leitura de uma sessão antiga pode tentar várias senhas, e cada tentativa envolve PBKDF2. Listas longas aumentam a latência, especialmente em rotas que lêem a sessão em toda requisição. Mitigação: manter listas curtas e documentar o custo.
- **Interação com o fallback legado:** a combinação de múltiplas senhas e o fallback de 1 iteração pode multiplicar tentativas. Precisa ser testada explicitamente (RF-07).
- **Resselagem em leitura (RF-06):** muda o comportamento de `getSession`, que passa a poder emitir `Set-Cookie` com mais frequência durante a rotação. Pode afetar caches ou respostas que não esperam esse cabeçalho.
- **Senha antiga removida cedo demais:** se a senha antiga sair da lista antes de todas as sessões terem sido resseladas, esses usuários são desconectados. Não há como detectar isso pelo código; a orientação de operação precisa dizer para manter a senha antiga até o prazo máximo da sessão.
- **Vazamento de senha antiga:** manter senhas antigas aceitas amplia a superfície de ataque até que sejam removidas. Deve ser documentado.
