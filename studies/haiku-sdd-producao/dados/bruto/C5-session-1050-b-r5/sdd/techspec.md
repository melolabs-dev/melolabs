# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1050.

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `password` continua única para selar. Na leitura, `unsealSession` tenta `password` e depois cada extra, na ordem, e para na primeira que abre o cookie. Uma sessão aberta por uma extra é resselada com `password` na mesma leitura. A validação das extras acontece no início de `getSession`. Nenhum export novo; a assinatura pública de `unsealSession` não muda.

## Estado atual (conferido no código)

- `src/utils/session.ts:48` — `password: string`, a única senha usada para abrir e selar.
- `src/utils/session.ts:149-155` — `getSession` começa aqui; nada é mutado em `context.sessions` antes da linha 155.
- `src/utils/session.ts:196-201` — `unsealSession` é chamado dentro de `.catch(() => {})` (linha 197): qualquer erro de unseal vira sessão vazia silenciosamente. Por isso a validação de RF-09 **não pode** ficar dentro de `unsealSession`, senão some.
- `src/utils/session.ts:214-216` — reseal da sessão lida só quando `legacySeal || shouldSlide(...)`.
- `src/utils/session.ts:312-348` — `unsealSession` tenta uma única senha (`config.password`, linha 324) e faz o fallback legado (1 iteração) só nessa senha (linhas 325-347). A exceção que dispara o fallback é `"Bad hmac value"` (linha 336).
- `src/utils/session.ts:300` — `sealSession` sela sempre com `config.password`. Não muda.
- `src/utils/internal/iron-crypto.ts:122-137` — com senha `string`, iron usa a senha direto e lança `"Bad hmac value"` se o MAC não bate. A verificação de MAC (linha 133) acontece **antes** da decifragem.
- `src/utils/internal/iron-crypto.ts:22` e `:28` — `minPasswordlength: 32` em `encryption` e `integrity`. A checagem de tamanho de string está em `iron-crypto.ts:191-196`, e lança erro que hoje também é engolido pelo `.catch` de `getSession`.
- `src/utils/internal/session.ts:7-9` — símbolo `kLegacySeal` (`Symbol.for`), marcador interno que `getSession` remove antes de `Object.assign` (`session.ts:199-201` e `:208`).
- `src/index.ts:209` — `unsealSession` é exportada publicamente; `test/unit/package.test.ts:149` trava a lista de exports. Não vamos adicionar nenhum export.
- `docs/2.utils/4.security.md:60` — a seção de `unsealSession` é gerada pelo automd a partir do JSDoc de `src/utils/session.ts`. Não editar à mão.

## Decisões de arquitetura

### D-01 — Onde fica a lista de tentativas

**Escolha:** manter a tentativa dentro de `unsealSession`, com um helper interno `unsealPasswords(config)` que devolve `[config.password, ...(config.extraUnsealPasswords ?? [])]`. A assinatura pública `unsealSession(_event, config, sealed)` não muda.

**Alternativas:**
- Encapsular as senhas num objeto `PasswordHash` e passar para `unseal` do iron (`iron-crypto.ts:122-128`, ramo `passwordId`). Descartada: o iron escolhe pelo `id` do cookie, e nossos cookies têm `id` vazio (`""`, `iron-crypto.ts:68`), então exigiria gravar ids novos, o que muda o formato do cookie (fora de escopo).
- Criar uma função pública nova `unsealSessionWithPasswords`. Descartada: viola "nenhum outro nome público novo".

### D-02 — Ordem do fallback legado: por senha

**Escolha:** para cada senha, na ordem, tenta-se o unseal atual e, se der `"Bad hmac value"` e o fallback estiver ativo, tenta-se a versão de 1 iteração **daquela senha** antes de passar para a próxima. Isso segue literalmente RF-04 e RF-06.

**Alternativas:**
- Duas fases: todas as senhas com iterações atuais, depois todas com 1 iteração. Descartada: um cookie legado selado com a última extra custaria N derivações de 8192 iterações antes de chegar ao fallback, e a regra de RF-06 ("vale para cada senha tentada") deixaria de ser a ordem natural.

### D-03 — Resselar quando a sessão foi aberta por uma extra

**Escolha:** acrescentar um gatilho ao reseal de `getSession`: se a sessão foi aberta com uma senha extra (não a `password`), ela é resselada com `password`, além dos gatilhos atuais (legado e `shouldSlide`). Mantém a condição de só resselar para sessões vindas do cookie (`sessionFromCookie`, linha 214), pois sessões de header não podem ser resseladas (`session.ts:64-65`).

**Por que diverge do PRD:** RF-05 diz que a resselagem ocorre "na mesma leitura em que o fluxo atual já resselaria". Sem este gatilho, uma sessão sem `idleTimeout` e não legada nunca migra; a senha antiga nunca pode sair da lista, o que anula o objetivo do PRD (`prd.md`, Objetivo e RF-05). **Precisa de confirmação do usuário.** Se ele preferir a leitura literal, a alternativa é remover este gatilho e documentar que a migração só ocorre com `idleTimeout`.

**Custo:** uma resselagem por sessão, na primeira leitura após a rotação. É o mesmo custo que o fallback legado já tem.

### D-04 — Marcador interno para "aberta por extra"

**Escolha:** novo símbolo em `src/utils/internal/session.ts`, `kExtraUnseal`, com `Symbol.for("h3.internal.session.extra-unseal")`, no mesmo padrão de `kLegacySeal` (`internal/session.ts:7-9`). `unsealSession` marca o objeto quando o índice da senha é maior que zero. `getSession` lê, apaga antes de `Object.assign` (`session.ts:208`) e usa no gatilho de D-03.

**Alternativas:**
- Comparar o resultado com um segundo unseal. Descartada: custo de PBKDF2 duplicado.
- Devolver `{ session, openedWith }` de `unsealSession`. Descartada: muda o tipo de retorno de uma função exportada.

### D-05 — Validação antecipada e falha explícita

**Escolha:** helper `assertExtraUnsealPasswords(config)` chamado em `getSession` logo após `const sessionName` (linha 153), **antes** de `context.sessions` ser alterado. Regras:
1. Cada item precisa ser `string` com pelo menos `minPasswordlength` caracteres (RF-09). O valor vem de `{ ...sealDefaults, ...config.seal }.encryption.minPasswordlength`, como no iron, para respeitar um `seal` customizado.
2. Um item igual a `password` ou repetido na lista é rejeitado (risco do PRD: "erro de configuração silencioso").

Erro lançado com `Error`, mensagem fixa que não diz qual senha falhou (risco de vazamento; RF-07). Como a checagem é antes do `.catch`, o erro chega ao handler e vira resposta 500 do H3.

**Alternativas:**
- Ignorar silenciosamente extras inválidas e duplicadas. Descartada: é o problema que RF-09 pede para evitar.
- Validar só em `unsealSession`. Descartada: o `.catch` de `session.ts:197` engole o erro.
- Validar também `password`. Descartada: muda o comportamento atual de `password` curta (RF-08); fora de escopo.

### D-06 — Sem limite de tamanho da lista nesta entrega

**Escolha:** nenhum limite imposto no código. Documentar no JSDoc de `extraUnsealPasswords` que cada extra custa uma derivação PBKDF2 por requisição com cookie inválido.

**Correção ao PRD:** `prd.md`, risco "Custo de CPU", afirma que o fallback legado "pode dobrar" o custo. Não é o caso: o retry legado usa 1 iteração (`session.ts:342-343`), então é desprezível. O custo para cookie inválido é N derivações de 8192 iterações (uma por senha), e a derivação de MAC acontece antes da decifragem (`iron-crypto.ts:133`).

### D-07 — Falha sem senha correta continua igual

**Escolha:** se nenhuma senha abrir o cookie, o último erro (`"Bad hmac value"`) é relançado e engolido por `getSession` (`session.ts:197`). Nenhuma mensagem nova (RF-07).

**Efeito colateral aceito:** cookies sealed por uma extra demoram mais para abrir do que cookies da `password`. Quem consegue medir tempo já consegue enviar cookies inválidos; não justifica padding.

### D-08 — Formato do cookie e `sealSession` não mudam

Nenhuma alteração em `sealSession` (`session.ts:282-307`) nem em `iron-crypto.ts`. Isso atende RF-02 e o item de fora de escopo "mudança no formato do cookie".

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:48` | Campo `extraUnsealPasswords?: string[]` logo após `password`, com JSDoc (RF-01). |
| `src/utils/session.ts:153` | Chamada a `assertExtraUnsealPasswords(config)` antes de tocar no contexto (D-05). |
| `src/utils/session.ts:199-201` | Ler e apagar o marcador `kExtraUnseal`, junto de `kLegacySeal` (D-04). |
| `src/utils/session.ts:214-216` | Acrescentar o gatilho de resselagem para sessão aberta por extra (D-03). |
| `src/utils/session.ts:312-348` | Trocar a tentativa única por loop sobre `unsealPasswords(config)`; mover o try/catch atual para um helper interno que recebe a senha (D-01, D-02). Marcar `kExtraUnseal` quando o índice > 0. |
| `src/utils/session.ts` (fim do arquivo, após `sessionExpires`, linha 464) | Helpers internos `unsealPasswords` e `assertExtraUnsealPasswords`. O arquivo já tem 464 linhas; se os helpers deixarem `session.ts` grande demais para o guia de ~200 LoC por arquivo, o helper de unseal pode ir para `src/utils/internal/session.ts`. |
| `src/utils/internal/session.ts:9` | Novo `kExtraUnseal` após `kLegacySeal` (D-04). |
| `test/session.test.ts` | Novo bloco de testes (ver estratégia). Os testes existentes não mudam. |

Não alterar: `src/index.ts` (sem exports novos), `src/utils/internal/iron-crypto.ts`, `package.json`, `CHANGELOG.md`, `docs/` (a documentação sai do JSDoc via automd).

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig
/**
 * Previous passwords that still open sessions sealed with them. Tried after
 * `password`, in order. Sessions are always sealed with `password`; a session
 * opened with one of these is resealed with `password` on the same read, so a
 * retired password can be removed once its sessions have migrated.
 *
 * Each must be at least 32 characters, and must differ from `password` and
 * from each other. Every entry costs one PBKDF2 derivation for each request
 * carrying a cookie that no password opens, so keep the list short.
 */
extraUnsealPasswords?: string[];

// Helpers internos (não exportados)
function unsealPasswords(config: SessionConfig): string[];
function assertExtraUnsealPasswords(config: SessionConfig): void; // lança Error
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean,
): Promise<Partial<Session>>; // corpo atual de session.ts:322-348 para uma senha

// src/utils/internal/session.ts
export const kExtraUnseal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-unseal",
);
```

Assinaturas públicas que **não mudam**: `getSession`, `useSession`, `updateSession`, `sealSession`, `unsealSession(_event, config, sealed): Promise<Partial<Session>>`.

Comportamento de `unsealSession` após a mudança (pseudocódigo):

```ts
const passwords = unsealPasswords(config);
for (const [index, password] of passwords.entries()) {
  try {
    const unsealed = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback !== false);
    if (index > 0) unsealed[kExtraUnseal] = true;   // só se unsealed não for null
    break;
  } catch (error) {
    // Só "Bad hmac value" significa senha errada; outros erros valem para todas
    const wrongPassword = error instanceof Error && error.message === "Bad hmac value";
    if (!wrongPassword || index === passwords.length - 1) throw error;
  }
}
// checagens de maxAge e idleTimeout seguem iguais, depois do loop
```

Nota: `"Expired seal"` (`iron-crypto.ts:116`) é checado antes do MAC e não depende da senha; não deve tentar a próxima senha, e com a regra acima não tenta.

Ajuste de tipo: o `const unsealed` dentro do loop precisa sair dele; o implementador escolhe a forma (variável `let` com `break` ou helper que devolve) para o TypeScript aceitar a atribuição.

## Estratégia de testes

Todos em `test/session.test.ts`, dentro de `describeMatrix("session", ...)` para rodar em `web` e `node`. Cookies de cada cenário são gerados com `seal` direto (padrão de `test/session.test.ts:162-172`), com a senha de teste desejada.

| Teste | Cobre | Verificação |
| --- | --- | --- |
| Sela só com `password` | RF-02 | Cookie emitido abre com A (`unseal(..., A, sealDefaults)`) e falha com B. |
| Abre cookie selado com extra | RF-03 | Config `password=A, extra=[B]`; cookie com B; `getSession` retorna `id` e `data` esperados. |
| Abre cookie da última extra | RF-04 | Config `password=A, extra=[B, C]`; cookie com C; retorna dados. Ordem de tentativa não é observável pelo resultado; cobrir na revisão de código. |
| Reseal para `password` após abrir por extra | RF-05, D-03 | Cookie com B, sem `idleTimeout`; o `Set-Cookie` da resposta abre com A e falha com B. |
| Legado selado com extra | RF-06 | Cookie 1 iteração com B; abre, `data` correto, e o `Set-Cookie` é resselado com A. |
| Legado com extra e `legacySealFallback: false` | RF-06 | Mesmo cookie; sessão vazia (`id` diferente). |
| Senha desconhecida Z | RF-07 | Cookie com Z; resposta com sessão vazia, sem mensagem contendo a senha. |
| `extraUnsealPasswords: []` igual a ausência | RF-08 | Mesmos resultados dos testes existentes; não precisa de teste novo além da suíte atual. |
| Extra curta | RF-09 | `extra=["curta"]`; a requisição responde 500 e a mensagem menciona o tamanho mínimo. |
| Extra igual a `password` e extra repetida | D-05 | Dois casos; ambos 500. |
| Header de sessão aberto por extra | Cobertura adicional de D-03 | Cookie do header com B; sessão aberta; `Set-Cookie` **não** é emitido (sessão de header não é resselada). |

Regressão obrigatória: `pnpm vitest run test/session.test.ts` inteiro antes e depois. Os testes existentes não podem mudar de expectativa.

Verificações de tipo e lint: `pnpm typecheck` (`package.json:54`) e `pnpm lint` (`package.json:46`). O typecheck cobre o campo opcional, já que os testes existentes tipam `SessionConfig` (`test/session.test.ts:21`).

Documentação: depois de alterar o JSDoc, rodar `pnpm fmt` para o automd atualizar `docs/2.utils/4.security.md`. Ver o diff gerado.

Ordem de trabalho (AGENTS.md, "Bug Fix Workflow" adaptado): escrever primeiro os testes de RF-03, D-03 e RF-09, confirmar que falham, depois implementar.

## Riscos

1. **Senhas antigas valem enquanto estiverem na lista.** Uma senha vazada só deixa de funcionar quando sai de `extraUnsealPasswords`, e a saída só é segura depois que as sessões migrarem. Mitigação: D-03 faz a migração acontecer na próxima leitura de cada sessão ativa; documentar o passo de remoção. Sessões inativas que nunca voltam continuam abertas até a janela de `maxAge`/`idleTimeout` acabar.
2. **Custo de CPU com cookie inválido.** N derivações de 8192 iterações por requisição (D-06). Mitigação: lista curta, documentada. Sem limite no código nesta entrega.
3. **Sessões de header não migram.** Sessões lidas só pelo cabeçalho não podem ser resseladas (PRD, fora de escopo). Enquanto a senha antiga estiver na lista, elas continuam abertas. Mitigação: documentar.
4. **Configuração inválida derruba todas as requisições com sessão.** D-05 lança erro em `getSession`, inclusive quando não há cookie. É intencional (erro cedo, RF-09), mas significa 500 em rotas que usam sessão até a config ser corrigida. Mitigação: a mensagem é clara; cobrir em teste.
5. **Vazamento por mensagem.** Erro de senha inválida nunca diz qual senha falhou (D-07). A validação de D-05 só revela que a configuração do próprio servidor está errada, não dados de usuário.
6. **Divergência do PRD em D-03.** Se o usuário mantiver a leitura literal de RF-05, a migração não ocorre sem `idleTimeout`, e a remoção de senhas antigas fica bloqueada. Ver D-03.
7. **Fallback legado e ordem.** Pela D-02, um cookie legado selado pela última extra passa pelo unseal de 8192 iterações de todas as senhas antes de tentar o fallback de cada uma. Custo aceito; o caso é raro e temporário durante a rotação.
8. **TypeScript no loop.** Atribuição a `unsealed` dentro de `for...of` com `break` pode não ser aceita pelo controle de fluxo. Resolver com `let` ou helper; não é risco de comportamento.
