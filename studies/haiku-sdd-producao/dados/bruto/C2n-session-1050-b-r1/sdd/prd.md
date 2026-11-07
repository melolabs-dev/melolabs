# PRD — Várias senhas de unseal nas sessões (#1050-b)

Referência: issue h3js/h3#1050 (primeira alternativa proposta nela) e contrato em `sdd/pedido.md`. Em caso de conflito entre este PRD e o contrato, o contrato prevalece e este documento deve ser corrigido.

## Problema e objetivo

### Problema

As sessões do H3 são seladas com uma única senha (`SessionConfig.password`, em `src/utils/session.ts`). Para trocar essa senha, hoje é preciso escolher entre:

- manter a senha antiga, o que vai contra a rotação de segredos; ou
- trocar a senha de uma vez, o que invalida todas as sessões em uso e desconecta os usuários.

### Objetivo

Permitir a rotação da senha de sessão sem invalidar as sessões seladas com senhas anteriores. A configuração ganha um campo opcional com senhas extras que só servem para abrir (unseal) sessões. A senha atual continua sendo a única usada para selar.

Sem senhas extras, o comportamento deve ser idêntico ao atual, byte a byte no cookie gerado e no resultado de leitura.

### Fora do objetivo (resumo)

Não há mudança de algoritmo de selo, de formato de cookie nem de API além do campo novo. Ver "Fora de escopo" abaixo.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` passa a aceitar o campo opcional `extraUnsealPasswords: string[]`. `password` continua sendo uma `string` e continua sendo a única senha usada para selar.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** o tipo `SessionConfig` é verificado pelo TypeScript
- **Então** a configuração compila sem erros, e a configuração sem o campo também continua compilando

### RF-02 — Abertura tenta a senha atual e depois as extras, em ordem

Ao abrir uma sessão, o H3 tenta `password` primeiro e depois cada item de `extraUnsealPasswords`, na ordem em que aparecem. Para na primeira senha que abrir a sessão. Se a senha atual abrir, nenhuma extra é tentada.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** a requisição chega com o cookie dessa sessão
- **Então** a sessão é lida com os dados originais, e `useSession`/`getSession` retornam o mesmo conteúdo que retornariam com a senha antiga como única senha
- **E** com `password` correta e uma extra qualquer, a extra não é tentada (verificável com um spy na função de derivação de chave ou contagem de chamadas)

### RF-03 — Selagem sempre com `password`

Novas sessões, e qualquer sessão regravada pelo H3, são seladas somente com `password`. As senhas de `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** uma nova sessão é criada com `useSession` ou `sealSession`
- **Então** o cookie resultante só abre com `"senha-nova"` e não abre com `"senha-antiga"`

### RF-04 — Migração de sessões abertas com senha extra

Quando uma sessão é aberta com uma senha de `extraUnsealPasswords`, o H3 a regrava com `password`, do mesmo modo que já regrava cookies com selo legado.

Escopo da migração (decidido aqui):

- Vale para todo caminho de leitura que abre sessão: `getSession`, `useSession` e qualquer outro ponto de `src/utils/session.ts` que chame a abertura.
- Só regrava quando a abertura veio de uma extra. Sessão aberta com `password` não gera cookie novo.
- A regravação entra na resposta do mesmo modo que a regravação do selo legado já faz. Se a resposta não puder carregar cookie (por exemplo, já enviada), a sessão continua válida e só a migração é adiada para a próxima leitura. Nenhum erro é lançado por isso.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** a requisição lê a sessão com `getSession` e a resposta é gerada
- **Então** a resposta traz um cookie novo que abre com `"senha-nova"` e não abre com `"senha-antiga"`
- **E** uma nova leitura desse cookie não gera `Set-Cookie`

### RF-05 — Sem senhas extras, comportamento inalterado

Se `extraUnsealPasswords` estiver ausente, `undefined` ou `[]`, o H3 tenta apenas `password`. Uma falha de abertura segue exatamente o caminho que existe hoje, sem nenhuma tentativa adicional.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`
- **Quando** o cookie de uma sessão selada com outra senha é lido
- **Então** a sessão não é aberta, e o resultado (valor retornado, cookies e eventuais erros) é igual ao do código anterior à mudança, comparado por um teste que roda nos dois casos

### RF-06 — Falha com todas as senhas

Se nenhuma senha (atual ou extra) abrir a sessão, o resultado é o de uma senha errada hoje: a sessão aparece vazia, sem erro novo e sem cookie novo. Nenhuma das senhas aparece na mensagem de erro, no cookie ou nos dados retornados. O H3 também não escreve nenhuma senha em logs, mesmo em modo de depuração.

**Critério de aceite**

- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** o cookie foi selado com uma terceira senha, `"senha-outra"`
- **Então** a sessão aparece vazia, como hoje ocorre com uma senha errada, e nenhuma das três senhas aparece na resposta ou em logs produzidos pelo H3

### RF-07 — Compatibilidade com o fallback de selo legado

O fallback de selo legado (`legacySealFallback`, com 1 iteração de PBKDF2) é aplicado a cada senha da lista, na mesma ordem. Uma sessão antiga selada com senha extra e com o selo legado deve ser aberta e regravada.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"` usando 1 iteração de PBKDF2, e uma configuração com `password: "senha-nova"`, `extraUnsealPasswords: ["senha-antiga"]` e `legacySealFallback` não desligado
- **Quando** a requisição lê a sessão
- **Então** a sessão é aberta, e a resposta traz um cookie novo selado com `"senha-nova"`

### RF-08 — Tipagem e exportações públicas

O único nome público novo é o campo `extraUnsealPasswords`. Nenhuma outra função, tipo ou export é adicionado à API pública.

**Critério de aceite**

- **Dado** o build (`pnpm build`) e os arquivos de tipos gerados (`dist/*.d.mts`) antes e depois da mudança
- **Quando** os dois conjuntos de tipos são comparados (diff simples dos arquivos gerados)
- **Então** a única diferença na API pública é o campo `extraUnsealPasswords` em `SessionConfig`, com o JSDoc do RF-09

### RF-09 — Documentação mínima no código

O JSDoc de `extraUnsealPasswords` deve dizer, em uma frase cada:

- que as senhas servem só para abrir sessões e nunca para selar;
- que a ordem de tentativa é `password` e depois as extras;
- que cada senha extra custa uma derivação de chave por requisição com cookie que não abre com a atual;
- que as senhas extras devem ser removidas da configuração quando as sessões antigas tiverem sido regravadas (RF-04) ou expirado (`maxAge`/`idleTimeout`);
- que a regravação gera `Set-Cookie` durante a janela de rotação.

Não há atualização do site de documentação (ver "Fora de escopo").

### RF-10 — Testes e qualidade

Seguindo o fluxo de correção de bug do `AGENTS.md`, adaptado a uma funcionalidade nova: os testes de RF-02 a RF-07 são escritos antes da implementação e devem falhar antes dela (ou seja, provar que a funcionalidade ainda não existe). Os testes ficam em `test/session.test.ts` (ou arquivo de sessão já existente, se o nome for outro) e seguem `describeMatrix` para rodar em modo `web` e `node`.

Um teste existente só pode ser alterado se depender de um comportamento que muda. Nesse caso a alteração mantém o que o teste verifica e fica descrita no PR.

**Critério de aceite**

- **Dado** o repositório com a mudança aplicada
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run test/session.test.ts` são executados, seguidos da suíte completa (`pnpm test`)
- **Então** todos passam, e nenhum teste existente foi removido sem substituto equivalente

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue #1050). Só o campo novo `extraUnsealPasswords` é feito.
- Identificador de chave (`kid`) ou qualquer mecanismo para escolher a senha pelo cookie. A abertura é por tentativa.
- Rotação automática, agendamento ou ferramenta de troca de senha. A troca continua sendo feita pelo usuário da biblioteca na configuração.
- Mudanças em `useSession`/`getSession` além do necessário para RF-02 a RF-07 (por exemplo, nova API de rotação).
- Remoção do fallback de selo legado (continua previsto para a v3, conforme o TODO em `src/utils/session.ts`).
- Mudanças em `iron-crypto.ts` além do que for estritamente necessário para tentar várias senhas.
- Atualização da documentação do site. A documentação da mudança fica apenas no JSDoc (RF-09).
- Mudanças em `sdd/pedido.md`.
- Validação nova de entropia ou de tamanho das senhas extras, e limite de quantidade de extras (ver "Decisões em aberto").

## Decisões em aberto

Cada item traz a recomendação. Elas podem ser fechadas antes da implementação; se não forem, vale a recomendação.

1. **Senha extra igual à atual.** Recomendação: ignorar silenciosamente a extra igual a `password` na tentativa (não repetir a derivação) e não lançar erro. Não é erro funcional; um aviso só valeria se houvesse canal de log definido.
2. **Limite de quantidade de extras.** Recomendação: não impor limite agora. Documentar o custo (RF-09) e tratar limite como requisito à parte, se o custo medido em uso real justificar.
3. **Validação de entropia das extras.** Recomendação: mesma regra de `password` já documentada no JSDoc, sem validação nova (ver Premissas).

## Premissas

- A senha atual (`password`) continua sendo a única usada para selar. Isso segue o contrato em `sdd/pedido.md`, que ainda precisa existir no repositório na hora da implementação.
- O campo é lido a cada requisição, então a configuração de senhas pode ser trocada em um deploy sem migração de dados.
- A migração do RF-04 (regravar com a senha atual ao abrir com uma extra) é uma decisão de desenho adotada aqui, não uma exigência literal do contrato. Ela é o que torna a rotação útil no tempo, então foi incluída.
- O cookie continua com o mesmo formato e tamanho; só muda a senha usada na tentativa de abertura.
- O número de iterações de PBKDF2 por padrão (8192, conforme citado neste PRD) deve ser conferido em `src/utils/session.ts` antes de fechar os números de custo do RF-09.

## Riscos

- **Custo de CPU por tentativa.** Cada senha extra é uma tentativa de PBKDF2 em cada requisição com cookie que não abre com a senha atual. Uma lista longa, ou um cliente que envie cookies inválidos de propósito, aumenta o custo. Mitigação: manter a lista curta (RF-09), documentar o custo, e tratar limite como requisito à parte (decisão 2). Um cliente que envia cookies inválidos de propósito já custa uma tentativa hoje; a mudança multiplica esse custo pelo número de extras.
- **Senhas antigas continuam válidas enquanto estiverem na configuração.** Quem vazou a senha antiga pode forjar ou abrir sessões seladas com ela até ela ser removida. Mitigação: RF-09 manda documentar a remoção; o RF-04 acelera a saída das sessões antigas.
- **Combinação com o fallback legado.** Como o fallback também tenta 1 iteração para cada senha, o número de tentativas pode dobrar no pior caso. O RF-07 cobre o comportamento correto. Medir a diferença de tempo é uma verificação de desempenho à parte, feita fora da suíte, sem alterar o fallback.
- **Migração silenciosa.** O RF-04 faz a resposta trazer um cookie novo na primeira leitura de cada sessão antiga. Isso aumenta o tráfego de `Set-Cookie` durante a janela de rotação. É esperado e está no JSDoc (RF-09).
- **Ambiguidade de precedência.** Se a mesma senha aparecer em `password` e em `extraUnsealPasswords`, a tentativa é repetida sem efeito. Tratado pela decisão 1.
