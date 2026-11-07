# Especificação técnica — Várias senhas de unseal nas sessões

Referências: issue h3js/h3#1050 (segunda alternativa), `sdd/pedido.md`, `sdd/prd.md`.

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `35fa25a`, branch `master`).

## 1. Contexto e estado atual

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`). O campo é documentado na mesma interface, de `src/utils/session.ts:41` a `:47`.
- O campo é usado em três pontos de `src/utils/session.ts`, como o PRD previa:
  - selagem em `sealSession`: `seal(session, config.password, …)` em `src/utils/session.ts:300`;
  - abertura em `unsealSession`: `unseal(sealed, config.password, sealOptions)` em `src/utils/session.ts:324`;
  - abertura no fallback legado: `unseal(sealed, config.password, {…})` em `src/utils/session.ts:340`.
- `unsealSession` começa em `src/utils/session.ts:312`. O fallback legado fica em `src/utils/session.ts:332-344`, e só dispara para o erro `"Bad hmac value"` (`src/utils/session.ts:336`).
- A verificação de vida da sessão fica depois da abertura: `maxAge` em `src/utils/session.ts:350-355` e `idleTimeout` em `src/utils/session.ts:359-365`.
- `getSession` chama `unsealSession` em `src/utils/session.ts:196` e engole qualquer erro com `.catch(() => {})` em `src/utils/session.ts:197`. Por isso, uma senha inválida ou um erro de configuração na abertura vira "sem sessão" e não aparece para o chamador.
- Em `src/utils/internal/iron-crypto.ts`:
  - `seal(object, password, opts)` está em `src/utils/internal/iron-crypto.ts:58`. Ele aceita `RawPassword` (string, `Uint8Array`, objeto com `secret` ou com `encryption`/`integrity`), mas não aceita array.
  - `unseal(sealed, password, opts)` está em `src/utils/internal/iron-crypto.ts:87`. Também não aceita array; o tipo é `Password | PasswordHash` (`src/utils/internal/iron-crypto.ts:89`).
  - A verificação de expiração do seal (`"Expired seal"`) acontece antes do HMAC, em `src/utils/internal/iron-crypto.ts:110-118`. Ela não depende da senha.
  - O HMAC é calculado em `src/utils/internal/iron-crypto.ts:133`, e só depois a chave de cifragem é derivada e o conteúdo decifrado (`src/utils/internal/iron-crypto.ts:139-147`). Uma tentativa com senha errada custa uma derivação PBKDF2 (a de integridade). Uma abertura bem-sucedida custa duas.
  - O defaults usa 8192 iterações (`src/utils/internal/iron-crypto.ts:21` e `:27`).
- `sealSession` e `unsealSession` são exportados publicamente (`src/index.ts:208-209`). Qualquer mudança na assinatura afeta o contrato da API.
- `kLegacySeal` é o marcador interno do fallback (`src/utils/internal/session.ts:7`).

## 2. Decisões de arquitetura

### D-01 — A lista é normalizada em `session.ts`, sem mexer no `iron-crypto`

**Escolha:** um helper não exportado em `src/utils/session.ts` converte `string | string[]` em uma lista ordenada de senhas. `seal` e `unseal` continuam recebendo uma senha por vez.

**Alternativas consideradas:**
- Aceitar arrays dentro de `iron-crypto.ts` (`seal`, `unseal`, `PasswordHash`). Rejeitada: o módulo é interno e espelha a biblioteca iron, com contrato de `password id`. Estender esse contrato aumenta a superfície sem necessidade.
- Criar uma nova opção pública, como `extraUnsealPasswords`. Rejeitada pelo PRD (fora de escopo).

**Justificativa:** `session.ts` é o único consumidor de `config.password` (confirmado acima). A mudança fica localizada, e o comportamento de `iron-crypto.ts` não muda.

### D-02 — Tipo público `password: string | string[]`, sem novas opções

**Escolha:** `SessionConfig.password` passa a `string | string[]` (`src/utils/session.ts:48`), com JSDoc atualizado. Nenhum outro nome público é adicionado.

**Justificativa:** atende RF-01 e às restrições do PRD. Quem passa uma string não precisa mudar nada.

### D-03 — Abertura tenta as senhas em ordem; só continua no erro de HMAC

**Escolha:** a abertura percorre a lista na ordem declarada. Para cada senha:
- se a abertura funciona, ela para e retorna o resultado;
- se o erro é `"Bad hmac value"`, a próxima tentativa é feita (inclusive a tentativa legada da D-04);
- qualquer outro erro é propagado imediatamente.

Os erros propagados são os que não dependem da senha: `"Expired seal"` (`src/utils/internal/iron-crypto.ts:116`), `"Wrong mac prefix"` (`:107`) e `"Incorrect number of sealed components"` (`:100`). Tentar as outras senhas nesses casos só repetiria o mesmo erro e gastaria trabalho à toa.

**Alternativas consideradas:**
- Capturar qualquer erro e tentar a próxima senha. Rejeitada: mascara erros de formato e de expiração e repete trabalho sem ganho.
- Usar a identificação por id do iron (`passwordId` no cookie). Rejeitada pelo PRD: a ordem da lista é o único critério.

**Justificativa:** mantém o comportamento de uma senha só (um único `unseal`, mesmo erro) e restringe a tentativa extra a um erro que realmente significa "esta senha não é a certa".

### D-04 — Fallback legado é tentado por senha, logo após a tentativa atual

**Escolha:** para cada senha, a ordem é: tentativa com as iterações atuais, depois, se `legacySealFallback !== false` e as iterações atuais não forem 1, tentativa com 1 iteração (`src/utils/session.ts:332-344`).

**Alternativas consideradas:**
- Duas passadas: primeiro todas as senhas com iterações atuais, depois todas com 1 iteração. O custo de pior caso é o mesmo, porque a tentativa legada usa 1 iteração e custa cerca de 8192 vezes menos que a atual. A diferença é só a ordem.

**Justificativa:** com a ordem por senha, uma sessão selada pela primeira senha é aberta na primeira tentativa, sem nenhuma tentativa extra, como hoje. As guardas existentes (`legacySealFallback === false`, `iterations === 1`) são preservadas como estão.

### D-05 — Lista vazia gera erro na leitura e na escrita

**Escolha:** `toPasswordList` lança erro quando a lista é vazia. Ele é chamado em:
- `getSession`, no início, antes de tocar em `context.sessions` (`src/utils/session.ts:149-155`), para que a configuração inválida apareça para o chamador e não seja engolida por `.catch` (`src/utils/session.ts:197`);
- `sealSession` (`src/utils/session.ts:282`);
- `unsealSession` (`src/utils/session.ts:312`), porque é exportado e pode ser chamado direto.

Uma string vazia `""` não é validada, para manter o comportamento de hoje (RF-04).

**Alternativas consideradas:**
- Validar só na selagem. Rejeitada: RF-01 pede erro também na abertura, e a abertura hoje engole erros (`src/utils/session.ts:197`), então a configuração errada passaria despercebida.

**Justificativa:** erro explícito no primeiro uso, sem estado parcial no contexto.

### D-06 — Limites de vida continuam fora do laço, após a abertura

**Escolha:** `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam sendo verificados uma única vez, depois que alguma senha abriu a sessão. Não são verificados dentro do laço de tentativas.

**Justificativa:** atende RF-06. Verificar dentro do laço faria a expiração ser testada por senha e poderia gerar erros trocados.

### D-07 — Selagem sempre com a primeira senha; formato do cookie inalterado

**Escolha:** `sealSession` usa `toPasswordList(config.password)[0]`. Uma senha em string gera o mesmo cookie de hoje, porque `normalizePassword` não atribui id (`src/utils/internal/iron-crypto.ts:304-306`) e o `passwordId` fica vazio. O formato não muda.

**Justificativa:** RF-02 e RF-04. Nenhuma sessão nova usa formato diferente, e uma sessão selada com a primeira senha pode ser aberta por versões que só conhecem essa senha.

### D-08 — Sem regravação automática de sessões abertas com senha não-primeira

**Escolha:** não há regravação nova. Uma sessão aberta com `B` é regravada com `A` apenas pelos caminhos que já existem: resealagem legada (`src/utils/session.ts:214-215`), resealagem por `idleTimeout` (mesma linha) e escrita via `updateSession`.

**Justificativa:** fora de escopo pelo PRD. Os caminhos existentes já migram as sessões de forma natural quando elas são reseladas.

### D-09 — Documentação na JSDoc e no guia de sessão

**Escolha:**
- JSDoc de `SessionConfig.password` em `src/utils/session.ts:41-47`: explicar que a lista é aceita, que a primeira sela e que as demais só abrem, e que a senha antiga deve sair da lista quando a rotação terminar.
- Em `docs/4.examples/handle-session.md`, logo após o aviso da linha 37-43, uma seção curta sobre rotação: procedimento (colocar a nova senha primeiro, manter a antiga, remover a antiga depois de um intervalo maior que o maior `maxAge`/`idleTimeout`), e o trade-off de tempo de resposta (PRD, "Vazamento de tempo").
- `CHANGELOG.md` não é editado, porque é gerado no release.

### D-10 — Ajuste mínimo dos testes existentes

**Escolha:** em `test/session.test.ts`, extrair a senha para uma constante `password` e usá-la em `sessionConfig` (`:21-25`). Trocar `sessionConfig.password` por `password` nas três chamadas diretas de `seal`/`unseal`: `:137`, `:157` e `:164`. Essas chamadas passam a valer só enquanto o tipo for string, porque `seal`/`unseal` não aceitam arrays. O comportamento verificado não muda.

**Justificativa:** o PRD prevê ajustes em testes que dependem da mudança de tipo. Essas três linhas são as únicas afetadas, e a checagem de tipos (`tsc --noEmit`, `include: ["src", "test"]`) vai apontar qualquer outra.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/session.ts` | Tipo de `password` (`:48`), JSDoc (`:41-47`), helper `toPasswordList`, validação em `getSession` (`:149`), `sealSession` (`:282-304`, em especial `:300`), `unsealSession` (`:312-367`, em especial `:324` e `:340`). |
| `test/session.test.ts` | Constante `password` (`:21-25`), ajuste em `:137`, `:157`, `:164`, novo `describe` com os testes da seção 5, inserido após os testes de legado (`:134-186`). |
| `docs/4.examples/handle-session.md` | Seção sobre rotação de senhas, após `:43`. |
| `test/bench/session.ts` | Opcional: entrada com `password: [nova, antiga]` para medir a leitura com senha não-primeira (ver seção 5.3). |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/utils/auth.ts`, `src/index.ts` (os nomes exportados não mudam).

## 4. Contratos e assinaturas

### 4.1 Público

```ts
export interface SessionConfig {
  /**
   * ... (JSDoc atualizada, ver D-09)
   */
  password: string | string[];
  // demais campos inalterados
}
```

Funções exportadas e suas assinaturas: **nenhuma muda**.
- `useSession<T>(event, config): Promise<SessionManager<T>>` (`src/utils/session.ts:108`)
- `getSession<T>(event, config): Promise<Session<T>>` (`src/utils/session.ts:149`)
- `updateSession<T>(event, config, update?): Promise<Session<T>>` (`src/utils/session.ts:241`)
- `sealSession<T>(event, config): Promise<string>` (`src/utils/session.ts:282`)
- `unsealSession(_event, config, sealed): Promise<Partial<Session>>` (`src/utils/session.ts:312`)
- `clearSession(event, config)` (`src/utils/session.ts:372`)

### 4.2 Interno (não exportado)

```ts
/** Normaliza `SessionConfig.password` na lista ordenada usada para selar e abrir. */
function toPasswordList(password: string | string[]): string[];
// Array vazio -> throw new Error("Session password list must not be empty")
// String -> [string] (sem validação extra, ver D-05)
```

Esboço do laço de abertura (a implementação pode ajustar nomes; o contrato é o descrito em D-03 e D-04):

```ts
// dentro de unsealSession, substituindo as linhas 322-347
for (const password of toPasswordList(config.password)) {
  // 1. tentativa com sealOptions (iterações atuais)
  // 2. se "Bad hmac value" e legado habilitado: tentativa com 1 iteração, marca kLegacySeal
  // 3. qualquer outro erro: throw imediato
}
// nenhuma senha abriu: relançar o primeiro "Bad hmac value"
```

### 4.3 Comportamento observável

| Situação | Resultado |
| --- | --- |
| `password: "A"` (string) | Idêntico ao atual. |
| `password: ["A"]` | Idêntico a `"A"`. |
| `password: [A, B]`, cookie selado com `A` | Aberto na primeira tentativa. |
| `password: [A, B]`, cookie selado com `B` | Aberto na segunda tentativa, sem erro, sem deslogar. |
| `password: [A, B]`, cookie selado com `C` | Sessão inválida, como senha errada hoje. |
| `password: [A, B]`, cookie 1 iteração selado com `B`, fallback ativo | Aberto, `kLegacySeal` marcado, regravado com `A`. |
| Mesmo cookie, `legacySealFallback: false` | Sessão inválida. |
| `password: []` | Erro `Session password list must not be empty` em `getSession`, `sealSession` e `unsealSession`. |
| Sessão expirada por `maxAge`, selada com `B` | `unsealSession` rejeita com `Session expired!`, como com uma senha só. |

## 5. Estratégia de testes

Convenção: `describeMatrix` roda cada teste em `web` e `node` (`AGENTS.md`). Os testes novos ficam em `test/session.test.ts`.

Ordem, conforme o Bug Fix Workflow de `AGENTS.md`: escrever os testes primeiro e confirmar que os novos falham antes da implementação. O teste de tipo falha no `tsc` antes da mudança em `src/utils/session.ts:48`.

### 5.1 Testes novos (`describe("multiple passwords")`)

1. **sela com a primeira senha**: sela via `useSession` com `[A, B]`; `unseal(cookie, A, sealDefaults)` deve abrir; `unseal(cookie, B, sealDefaults)` deve rejeitar com `"Bad hmac value"`. Cobre RF-02.
2. **abre sessão selada com a segunda senha**: `seal(session, B, sealDefaults)` manualmente; requisição com `[A, B]` restaura `id` e `data`. Cobre RF-03.
3. **rejeita senha fora da lista**: selada com `C`; requisição com `[A, B]` não restaura a sessão (`id` diferente). Cobre RF-03.
4. **string e lista de um elemento são equivalentes**: cookie selado com `"A"` abre com `["A"]` e o reverso. Cobre RF-04.
5. **legado com a segunda senha**: 1 iteração com `B`; `[A, B]` abre, `id` restaurado, cookie regravado com `A` (`unseal(resealed, A, sealDefaults)`). Cobre RF-05.
6. **legado com a segunda senha e fallback desligado**: mesmo cookie com `legacySealFallback: false` é inválido. Cobre RF-05.
7. **lista vazia**: `useSession`, `getSession`, `sealSession` e `unsealSession` rejeitam com a mensagem. Cobre RF-01.
8. **maxAge com a segunda senha**: `unsealSession` com `maxAge` vencido e cookie selado com `B` rejeita com `Session expired!`. Cobre RF-06. (Chamar `unsealSession` direto com um evento mínimo, porque `_event` não é usado.)
9. **tipo**: uma configuração `const config: SessionConfig = { password: [A, B] }` precisa compilar (já coberto pelo `tsc`, mas vale um teste explícito de tipo em `test/unit/`, seguindo o padrão de `types.test-d.ts` citado em `AGENTS.md`).

### 5.2 Testes existentes

Os testes de `test/session.test.ts` (idle, maxAge, lazy, legado, cookies em chunks) continuam sem mudança, exceto os três pontos de D-10. Eles precisam continuar passando sem alteração de expectativa.

### 5.3 Desempenho

O PRD exige medir o custo na bancada, mas não define limite. Proposta:
- rodar `pnpm bench:node` antes e depois, com e sem lista;
- acrescentar em `test/bench/session.ts` uma entrada que lê um cookie selado com a senha antiga, com `password: [nova, antiga]`;
- registrar o resultado no PR. Limite aceitável: **pendente de definição pelo time** (o PRD não traz número).

### 5.4 Comandos de verificação

```bash
pnpm vitest run test/session.test.ts
pnpm vitest run test/unit
pnpm typecheck
pnpm lint
pnpm vitest run --coverage   # suíte completa, sem o lint embutido
pnpm bench:node              # opcional, ver 5.3
```

## 6. Riscos

| Risco | Probabilidade / impacto | Mitigação |
| --- | --- | --- |
| **Custo de desempenho** em leituras com senha antiga (PRD). Cada senha errada custa uma derivação PBKDF2 de 8192 iterações, a de integridade (`src/utils/internal/iron-crypto.ts:133`). Com a senha correta na posição `k`, o custo extra é `k − 1` derivações caras, mais `k − 1` tentativas legadas de 1 iteração. | Média / baixo, lista curta | Medir (5.3). Documentar que a senha antiga deve sair da lista. |
| **Dupla tentativa legada** (PRD). Cada senha pode gerar uma tentativa legada extra. | Baixa / baixo | Tentativa legada custa cerca de 8192 vezes menos que a atual (D-04). Não há duplicação de custo relevante. |
| **Senha antiga para sempre** (PRD). Sem regravação automática na leitura, a senha antiga continua aceita enquanto estiver na lista. | Alta, se a lista não for limpa / médio | Documentação (D-09). |
| **Vazamento de tempo** (PRD). A ordem das tentativas revela, pelo tempo de resposta, qual posição abriu o cookie. | Baixa / baixo (o atacante já precisa do cookie e o segredo é a senha) | Documentar em D-09. |
| **Mudança de tipo** (PRD). Código externo que lê `config.password` e chama métodos só de string quebra na checagem de tipos. Quem só passa string não é afetado. | Baixa / médio | Checagem de tipos cobre o repositório. Mencionar na nota de release. |
| **Erro de configuração engolido** na leitura, porque `getSession` captura erros de `unsealSession` (`src/utils/session.ts:197`). | Média sem D-05 / alto (o usuário fica deslogado sem explicação) | D-05: validação antes do `try`, em `getSession`. |
| **Senha curta em posição 2 ou posterior.** O `iron-crypto` rejeita senhas com menos de 32 caracteres (`src/utils/internal/iron-crypto.ts:192-196`). A rejeição vira erro de "não é HMAC" e a sessão fica inválida, como já acontece com a senha errada. | Baixa / baixo | O PRD não adiciona validação de tamanho. Documentação (D-09). |
| **Senha vazia ou não-string em um elemento da lista.** `unseal` lança `"Empty password"` (`src/utils/internal/iron-crypto.ts:94-96`), que não é `"Bad hmac value"` e é propagado. A sessão fica inválida. | Baixa / baixo | Mesmo tratamento de senha curta. Fora de escopo validar. |
| **Ordem de tentativa muda com a lista.** Trocar a ordem (por exemplo, colocar a antiga na frente) muda o custo e o que sela. | Média / médio | A primeira senha sela, e a ordem é parte do contrato público. Documentar. |
| **Regressão de formato.** Uma mudança na selagem poderia gerar cookies que versões antigas não abrem. | Baixa / alto | D-07: o cookie continua idêntico com string. Teste 4 (5.1) e a suíte existente cobrem. |

## 7. Pendências e perguntas abertas

- Limite de desempenho aceitável para a leitura com senha não-primeira (5.3). O PRD não define.
- Confirmar com o time se a mensagem de erro de lista vazia deve ser em inglês, como as demais de `src/utils/`, ou em português. Esta especificação usa inglês, seguindo o padrão do código.
