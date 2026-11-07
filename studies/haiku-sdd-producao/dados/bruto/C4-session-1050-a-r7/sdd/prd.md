# PRD — Múltiplas senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta nela) e contrato `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `SessionConfig.password` aceita uma única string (`src/utils/session.ts`). Para trocar a senha de selagem das sessões, é preciso escolher entre duas opções ruins:

- trocar a senha de uma vez: todas as sessões seladas com a senha antiga deixam de abrir e os usuários precisam entrar de novo;
- manter a senha antiga: a rotação de segredos fica adiada, e um segredo que deveria ser descartado continua valendo.

Quem faz rotação de segredos precisa de uma janela em que sessões antigas ainda abrem enquanto as novas já são seladas com o segredo novo.

### Objetivo

Permitir que `password` receba uma lista não vazia de senhas. A primeira senha sela as sessões; as demais servem só para abrir sessões seladas antes da rotação. Com uma senha só, o comportamento continua o de hoje.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `password`

O campo `SessionConfig.password` passa a aceitar `string | string[]`. Uma string equivale a uma lista com um item.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password` igual a uma lista de duas senhas válidas,
- **Quando** `useSession` (ou `sealSession`) é chamada,
- **Então** a chamada não lança erro e a sessão é selada.

### RF-02 — Selar sempre com a primeira senha

Ao selar uma sessão com lista, a selagem usa somente o primeiro item da lista.

**Critério de aceite**

- **Dado** uma configuração com `password: [novaSenha, senhaAntiga]`,
- **Quando** uma sessão é selada,
- **Então** a sessão abre com `novaSenha` sozinha e não abre com `senhaAntiga` sozinha.

### RF-03 — Abrir sessões com qualquer senha da lista

Ao abrir uma sessão, as senhas são tentadas na ordem da lista. A primeira que validar a sessão é usada.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga` e uma configuração `password: [novaSenha, senhaAntiga]`,
- **Quando** a sessão é lida numa requisição,
- **Então** os dados da sessão são retornados sem erro.

### RF-04 — Rejeitar sessão que nenhuma senha da lista abre

Se nenhuma senha da lista validar a sessão, o comportamento é o mesmo de hoje para uma senha errada: o erro de verificação é propagado e nenhum dado é retornado.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaDesconhecida` e uma configuração `password: [novaSenha, senhaAntiga]`,
- **Quando** a sessão é lida,
- **Então** a leitura falha com o mesmo erro que uma senha errada produz hoje, e a sessão não é considerada válida.

### RF-05 — Regravar sessões antigas com a senha primária

Quando uma sessão aberta com uma senha que não é a primeira for gravada novamente, ela é selada com a primeira senha. Assim, a janela de compatibilidade se fecha sozinha conforme os usuários navegam.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga` e uma configuração `password: [novaSenha, senhaAntiga]`,
- **Quando** a sessão é lida e depois gravada de novo na mesma configuração,
- **Então** a sessão gravada abre com `novaSenha` sozinha.

### RF-06 — Validar a lista de senhas

Uma lista vazia é inválida e falha de forma explícita na configuração. Cada item segue a mesma regra de hoje para uma senha única (ser string não vazia e atender o tamanho mínimo já exigido). Nenhum nome público novo é criado para isso.

**Critério de aceite**

- **Dado** uma configuração com `password: []`,
- **Quando** uma sessão é selada ou lida,
- **Então** a operação falha com erro explícito indicando senha ausente ou inválida.

- **Dado** uma configuração com `password: [novaSenha, ""]`,
- **Quando** uma sessão é selada ou lida,
- **Então** a operação falha com o mesmo erro que uma senha vazia produz hoje.

### RF-07 — Preservar o comportamento com senha única

Com uma string (ou lista de um item), selagem, leitura, expiração, `maxAge`, `idleTimeout` e o fallback de compatibilidade `legacySealFallback` se comportam exatamente como antes.

**Critério de aceite**

- **Dado** uma configuração com `password` igual a uma string,
- **Quando** a suíte existente de sessões é executada,
- **Então** todos os testes que passam hoje continuam passando sem mudança em suas verificações.

### RF-08 — Fallback legado com várias senhas

O fallback de iterações legadas (`legacySealFallback`) é aplicado a cada senha da lista, na mesma ordem, com as mesmas regras de hoje.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga` usando as iterações legadas de PBKDF2 e uma configuração `password: [novaSenha, senhaAntiga]`,
- **Quando** a sessão é lida,
- **Então** a sessão abre e os dados são retornados, marcada como selagem legada da mesma forma que hoje.

## Fora de escopo

- Um nome novo de opção, como `extraUnsealPasswords` — a primeira alternativa da issue não será implementada.
- Identificadores por senha (`{ id, secret }`) ou busca da senha pelo id no cookie. A ordem da lista é o único critério.
- Mudanças na API pública de `iron-crypto` (`src/utils/internal/iron-crypto.ts`), além do uso interno necessário.
- Ferramentas ou comando para rotacionar senhas, e a ferramenta de migração em lote de sessões já gravadas.
- Mudanças no tamanho mínimo da senha ou na política de geração de segredos.
- Documentação extensa de rotação; só a documentação do próprio campo `password` é ajustada.
- Mudanças nas rotas de `sealSession`/`unsealSession` além de aceitarem a nova forma do campo.

## Premissas

- O uso típico é `password: [novo, antigo]` durante a rotação, e depois `password: novo` quando a janela fechar. A remoção da senha antiga é decisão do operador.
- A ordem da lista é a ordem de preferência: a primeira senha é a atual.
- Os segredos continuam sendo strings aleatórias com o mesmo tamanho mínimo de hoje; a lista não relaxa isso.
- O formato do cookie selado não muda. Nenhum dado novo é gravado na sessão para registrar qual senha foi usada.
- A regravação da RF-05 segue o caminho de `getSession` que já regrava sessões no fluxo atual; isso ainda precisa ser confirmado no código antes da implementação.

## Riscos

- **Custo de CPU por cookie inválido.** Cada senha extra multiplica o custo de PBKDF2 ao rejeitar um cookie inválido, e o fallback legado dobra essa conta. Um atacante que envie cookies lixo pode forçar esse custo. Mitigação a avaliar: limitar a lista (por exemplo, a um número pequeno de senhas), ou medir o custo antes de decidir.
- **Detecção de erro por texto.** O fallback legado depende da mensagem `"Bad hmac value"`. Com várias senhas, a lógica de "tentar a próxima" precisa tratar só esse erro e propagar os demais, sem trocar isso por uma verificação mais frouxa.
- **Mudança de tipo.** `password` deixa de ser sempre `string`. Código de usuários que lê `config.password` como string pode quebrar em tempo de compilação. A mudança deve ser marcada como compatível no tipo de entrada, mas não no tipo de leitura interna.
- **Ordem errada na lista.** Se a senha antiga for colocada primeiro, as sessões novas passam a ser seladas com ela. Isso não gera erro visível; só a documentação e os testes de RF-02 protegem contra isso.
- **Senha antiga esquecida.** Como a lista não tem prazo, uma senha antiga pode ficar na configuração para sempre. Isso é uma decisão operacional, não de código, e deve aparecer na documentação do campo.
- **Testes existentes.** A suíte em `test/session.test.ts` depende de `sessionConfig.password` como string em vários pontos. Ajustes nesses testes devem manter as verificações originais, conforme `sdd/pedido.md`.
