# PRD — Várias senhas de unseal nas sessões (#1050-b)

**Fonte:** `sdd/pedido.md` (issue h3js/h3#1050, primeira alternativa, variante com campo novo)
**Escopo de código:** `src/utils/session.ts`, `test/session.test.ts`
**Status:** rascunho para revisão

## Problema e objetivo

Hoje cada sessão do `useSession`/`getSession` é selada e aberta com uma única string, `SessionConfig.password`. Trocar essa senha (rotação de segredos) invalida todas as sessões ativas: quem estava logado é deslogado, e a aplicação não tem como aceitar as sessões antigas durante a transição.

**Objetivo:** permitir que a aplicação informe senhas anteriores, que só servem para abrir sessões, enquanto `password` continua sendo a única senha usada para selar. Sessões seladas com uma senha antiga continuam válidas e passam a ser reseladas com a senha atual no próprio acesso, então a senha antiga pode ser retirada da configuração quando não houver mais sessões que a usem.

**Fora do objetivo:** mudar o formato do selo, a forma de `password` ou o cálculo de expiração.

## Contexto atual (verificado no código)

- `SessionConfig.password: string` (`src/utils/session.ts`, perto da linha 48) é a única chave usada pelo `seal` (`sealSession`) e pelo `unseal` (`unsealSession`, perto da linha 324).
- `unsealSession` tenta abrir com as opções atuais; se falhar com a mensagem `"Bad hmac value"` e o fallback legado não estiver desligado, tenta de novo com 1 iteração PBKDF2 e marca o resultado com `kLegacySeal`.
- `getSession` (perto das linhas 194–220) engole o erro de `unsealSession` e cria uma sessão nova. Resela o cookie só quando a sessão veio de cookie e é legada (`kLegacySeal`) ou quando `shouldSlide` pede (idle timeout). Sessões lidas do header nunca são reseladas.
- `maxAge` e `idleTimeout` são checados depois de abrir a sessão, independentemente de qual senha a abriu.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

**Dado** uma configuração de sessão com `password` e `extraUnsealPasswords: ["senha-antiga-1", "senha-antiga-2"]`,
**Quando** o tipo `SessionConfig` é usado (inclusive pelo `useSession`, `getSession` e `sealSession`),
**Então** o campo é aceito como `string[]` opcional, tem comentário JSDoc descrevendo que as senhas servem só para abrir sessões, o tipo é anotado explicitamente (compatível com `isolatedDeclarations`), e `password` continua do tipo `string`.

### RF-02 — `password` é a única senha que sela

**Dado** uma configuração com `password: "atual"` e `extraUnsealPasswords: ["antiga"]`,
**Quando** uma sessão é criada ou atualizada (`updateSession`, `sealSession`),
**Então** o selo é gerado com `"atual"`; em nenhum caso `"antiga"` é usada para selar.

### RF-03 — Ordem de tentativa e primeira que abre vence

**Dado** uma configuração com `password: "A"` e `extraUnsealPasswords: ["B", "C"]`,
**Quando** `unsealSession` recebe um selo produzido com `"C"`,
**Então** as senhas são tentadas na ordem `A`, `B`, `C`; a primeira que verifica o HMAC abre a sessão, e o resultado é igual ao de uma sessão selada com `A`, exceto pelo que o RF-04 exige.

### RF-04 — Sessão aberta com senha extra é resealada com `password`

**Dado** um cookie de sessão selado com `"antiga"` e uma configuração `password: "atual"`, `extraUnsealPasswords: ["antiga"]`,
**Quando** `getSession` (ou `useSession`) lê esse cookie numa requisição,
**Então** o cookie da resposta é resealado com `"atual"` nessa mesma requisição, o `id`, `createdAt` e `data` da sessão são preservados, e uma leitura seguinte com a mesma configuração não gera novo reseal por causa da senha (só por idle timeout, como hoje).

### RF-05 — Sem `extraUnsealPasswords`, nada muda

**Dado** uma configuração existente, sem o campo ou com `extraUnsealPasswords: []`,
**Quando** a sessão é lida, criada ou atualizada,
**Então** o selo produzido é idêntico ao atual, o número de tentativas de unseal (e de PBKDF2) é o mesmo, e a sessão com senha errada continua sendo tratada como ausente, como hoje. Os testes existentes em `test/session.test.ts` passam sem alteração de expectativa.

### RF-06 — Fallback legado aplica-se depois das senhas atuais

**Dado** um cookie legado selado com 1 iteração PBKDF2 pela senha `"antiga"`, e uma configuração `password: "atual"`, `extraUnsealPasswords: ["antiga"]`,
**Quando** `unsealSession` tenta abrir o selo,
**Então** primeiro são tentadas todas as senhas (`"atual"`, depois `"antiga"`) com as opções atuais; só se nenhuma abrir, o fallback de 1 iteração é tentado para cada senha, na mesma ordem. A sessão é aberta, marcada como legada e resealada, como hoje. Se `legacySealFallback: false`, o fallback não roda para nenhuma senha.

### RF-07 — Só erro de HMAC avança para a próxima senha

**Dado** uma configuração com várias senhas,
**Quando** a tentativa com uma senha falha por um motivo diferente de HMAC inválido (por exemplo, `"Expired seal"` ou selo malformado),
**Então** a falha é propagada imediatamente, sem tentar as demais senhas, e o comportamento de expiração (`maxAge`/`idleTimeout`) é o mesmo de hoje.

### RF-08 — Validação de `extraUnsealPasswords`

**Dado** uma configuração com `extraUnsealPasswords` contendo uma string vazia ou um valor que não é string,
**Quando** a configuração é usada por `useSession` ou `getSession`,
**Então** a chamada falha com erro explícito que cita o campo (e não ignora a entrada em silêncio). Quanto a tamanho, cada entrada segue a mesma regra que `password` já segue no código atual; esta feature não cria regra nova de tamanho.

### RF-09 — Nenhum outro nome público novo

**Dado** a implementação concluída,
**Quando** se comparam as exportações de `src/index.ts` e os tipos públicos de `session.ts` com a versão atual,
**Então** a única adição pública é o campo `extraUnsealPasswords` em `SessionConfig`. Helpers internos ficam sem export ou em `src/utils/internal/`.

### RF-10 — Sessões lidas do header seguem a mesma regra de abertura

**Dado** uma sessão enviada pelo header de sessão (`sessionHeader`) selada com uma senha extra,
**Quando** a requisição é processada,
**Então** a sessão é aberta normalmente, não é resealada (igual ao comportamento atual de sessões de header), e continua expirando no prazo original do selo.

### RF-11 — Retirar uma senha invalida só as sessões que ela selou

**Dado** uma senha `"antiga"` removida de `extraUnsealPasswords`,
**Quando** chega um cookie selado com `"antiga"`,
**Então** a sessão é tratada como ausente (nova sessão criada), enquanto cookies selados com `password` ou com outras senhas extras continuam válidos.

### RF-12 — Testes nos dois alvos de runtime

**Dado** a feature implementada,
**Quando** `pnpm vitest run test/session.test.ts` é executado,
**Então** os novos casos (RF-02 a RF-04, RF-06 a RF-08, RF-10, RF-11) estão escritos com `describeMatrix` e passam nos alvos `web` e `node`. Cada novo caso de comportamento foi visto falhando antes da implementação, conforme o fluxo de correção de bug do `AGENTS.md`.

### RF-13 — Qualidade do repositório

**Dado** a mudança concluída,
**Quando** `pnpm lint` e `pnpm typecheck` são executados, e depois a suíte de testes,
**Então** tudo passa. Se um teste existente precisar de ajuste, o ajuste altera só o que a mudança exige e mantém a verificação original.

## Fora de escopo

- A alternativa 2 da issue: aceitar `password` como array (com a primeira senha selando). A API de `password` não muda de tipo.
- Rotação automática, agendada ou por tempo; a aplicação decide quando remover uma senha.
- Reseal de sessões lidas do header (não é possível hoje e não entra aqui).
- Mudança no formato do selo, no algoritmo ou no número padrão de iterações PBKDF2.
- Remoção do fallback legado (`legacySealFallback`), que continua previsto para a v3.
- Novo mecanismo de lista de revogação de sessões ou de identificação de chave (`kid`) no cookie.
- Alteração de `src/_entries/*`, de `rou3`, `srvx` ou de novas dependências.
- Documentação fora do JSDoc (site de docs), benchmarks e tracing.

## Premissas e riscos

**Premissas**

- O selo atual aceita uma senha string por chamada de `unseal`; a implementação tenta cada senha em sequência, sem depender de identificadores de senha no selo.
- A mensagem `"Bad hmac value"` (usada hoje para decidir o fallback legado) é o sinal de senha errada. O RF-07 depende dela; se a dependência de seal mudar a mensagem, o teste de RF-07 deve falhar.
- Como h3 é multi-runtime, o comportamento deve ser idêntico em `web` e `node`.

**Riscos**

- **Custo de CPU:** uma sessão selada com uma senha extra gasta uma ou mais tentativas PBKDF2 a mais por requisição, até ser resealada (RF-04 resolve isso no mesmo acesso). Uma lista longa de senhas aumenta o custo de cookies inválidos, porque cada um percorre todas as candidatas. Mitigação: manter a lista curta e documentar isso no JSDoc.
- **Senha antiga por tempo indeterminado:** se a aplicação esquecer de remover uma senha antiga, ela continua valendo para abrir sessões. Mitigação: o JSDoc orienta a remoção após o prazo máximo de sessão (`maxAge`).
- **Sessões de header não migram:** elas continuam seladas com a senha antiga até expirar. Aceito (RF-10).
- **Ambiguidade de fallback legado:** RF-06 escolhe tentar o fallback só depois de todas as senhas atuais. Isso mantém o caminho comum barato, mas um cookie legado selado com senha extra passa por mais tentativas que hoje. Aceito.
- **Erro de configuração silencioso:** se RF-08 não for coberto, uma entrada vazia pode bloquear a tentativa seguinte. Coberto pelo teste correspondente.
