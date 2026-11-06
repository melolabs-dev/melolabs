# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` (`src/utils/session.ts`) sela e desela as sessões com uma única senha, `SessionConfig.password`. Quando a senha é trocada (rotação de segredo), todas as sessões seladas com a senha anterior falham na verificação HMAC (`Bad hmac value`) e os usuários são desconectados de uma vez.

O objetivo é permitir a rotação sem derrubar sessões válidas: a aplicação informa senhas anteriores, que passam a ser aceitas apenas para abrir (desselar) sessões. A senha atual continua sendo a única usada para selar.

Referência: issue h3js/h3#1050, primeira alternativa proposta nela (campo novo de configuração).

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores aceitas somente para desselar. O campo `password` continua sendo `string`.

**Critério de aceite**
- **Dado** uma configuração de sessão com `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** o tipo `SessionConfig` é verificado pelo typecheck,
- **Então** o campo é aceito como `string[]` opcional e nenhum outro nome público novo é exigido.

### RF-02 — Selagem sempre com `password`

Toda sessão nova ou resselada é selada exclusivamente com `password`. Senhas em `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**
- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** uma sessão é selada com `sealSession`,
- **Então** o resultado só é aberto por `password` (abrir com apenas `"senha-antiga"` falha).

### RF-03 — Tentativa de unseal em ordem

Ao desselar uma sessão, `unsealSession` tenta `password` primeiro e depois cada item de `extraUnsealPasswords`, na ordem da lista. A primeira senha que valida a sessão é usada e as demais não são tentadas.

**Critério de aceite**
- **Dado** uma sessão selada com `"senha-antiga"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** a sessão é lida na requisição seguinte,
- **Então** os dados da sessão são retornados sem erro.

### RF-04 — Erro quando nenhuma senha valida

Se nenhuma das senhas (atual ou extras) validar a sessão, o comportamento de erro é o mesmo de hoje para uma sessão inválida: a sessão é tratada como vazia e uma nova é criada.

**Critério de aceite**
- **Dado** uma sessão selada com `"senha-desconhecida"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** a sessão é lida,
- **Então** nenhum dado da sessão anterior é retornado e a resposta não expõe qual senha foi tentada.

### RF-05 — Compatibilidade sem senhas extras

Quando `extraUnsealPasswords` está ausente ou vazio, o comportamento é idêntico ao atual, incluindo o fallback de selos legados (`legacySealFallback`) e a assinatura das funções exportadas.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords` (ou com `[]`),
- **Quando** a suíte existente de sessões é executada,
- **Então** todos os testes que passavam antes continuam passando sem alteração de expectativa.

### RF-06 — Validação das senhas extras

Cada item de `extraUnsealPasswords` segue a mesma regra de `password`: string não vazia com pelo menos 32 caracteres, conforme a documentação do campo.

**Critério de aceite**
- **Dado** uma configuração com `extraUnsealPasswords: ["curta"]`,
- **Quando** a sessão é usada,
- **Então** o erro informa a senha inválida da mesma forma que uma `password` curta, e não há sessão aceita com ela.

### RF-07 — Cobertura de testes de rotação

A mudança é coberta por testes na suíte existente de sessões, em modo matriz (`describeMatrix`, web e node), cobrindo: sessão antiga aceita, sessão com senha desconhecida rejeitada, selagem com a senha nova e lista de extras vazia.

**Critério de aceite**
- **Dado** a suíte de sessões com os novos casos de rotação,
- **Quando** `pnpm vitest run` é executado para os arquivos de sessão,
- **Então** os novos casos passam nos dois modos (web e node).

## Fora de escopo

- A segunda alternativa da issue: aceitar `password` como array de strings. Só o campo `extraUnsealPasswords` é implementado.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Mecanismo automático de rotação de chaves, agendamento ou expiração das senhas antigas.
- Regravar sessões abertas com senha extra dentro de `getSession` (ver premissa P3).
- Mudança no formato do selo, no cookie, no header de sessão ou no particionamento em chunks.
- Alteração do fallback de selo legado além do necessário para ele rodar com cada senha.
- Mudanças em código fora de `src/utils/session.ts` e dos testes de sessão que dependam dele.

## Premissas e riscos

### Premissas

- **P1.** O `unseal` do iron lança erro ao receber senha errada, e o erro `Bad hmac value` é o sinal para tentar a próxima senha. Verificar antes de implementar.
- **P2.** A ordem da lista é a ordem de tentativa; não há priorização por data.
- **P3.** Sessões abertas com uma senha extra continuam com o selo antigo até serem resseladas por outro motivo (escrita ou renovação por `idleTimeout`). Regravar imediatamente com `password` é uma decisão a confirmar; não está no escopo acima.
- **P4.** `maxAge` e `idleTimeout` continuam sendo aplicados independentemente da senha que abriu a sessão.

### Riscos

- **R1. Custo de CPU.** Cada senha extra que falha custa uma derivação PBKDF2 completa, e o fallback legado pode dobrar a tentativa. Com muitas senhas, uma requisição com cookie inválido fica mais cara. Mitigação: documentar que a lista deve ser curta e que senhas antigas devem sair da configuração após a janela de rotação.
- **R2. Enfraquecimento por senhas antigas mantidas.** Uma senha vazada que continua na lista continua abrindo sessões. Mitigação: documentação deixando claro que a remoção é responsabilidade de quem configura.
- **R3. Interação com `legacySealFallback`.** A combinação de senhas extras com o fallback de 1 iteração precisa ser testada para não criar tentativas redundantes nem aceitar selo fora da regra.
- **R4. Quebra silenciosa.** Se a validação de RF-06 não reaproveitar a regra de `password`, senhas extras curtas poderiam ser aceitas. Mitigação: testar explicitamente o caso de RF-06.
