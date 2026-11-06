# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-09). Esta especificação não altera código; descreve a mudança a ser feita.

## 1. Resumo

Adicionar `SessionConfig.extraUnsealPasswords?: string[]` em `src/utils/session.ts`. `sealSession` continua selando só com `config.password`. `unsealSession` tenta `password` primeiro e depois cada senha extra, na ordem. Uma sessão de cookie aberta com senha extra é re-selada com `password`, pelo mesmo caminho do reseal legado. Nenhum nome público novo é criado. Só um símbolo interno novo é adicionado, em `src/utils/internal/session.ts`, que não é reexportado por `src/index.ts`.

## 2. Estado atual (conferido no código)

- `SessionConfig` está em `src/utils/session.ts:39-99`. `password: string` fica em `:48`. `legacySealFallback` fica em `:95`.
- `sealSession` sela com `config.password` em `src/utils/session.ts:300-304`. Isso já cumpre RF-02, então não muda.
- `unsealSession` fica em `src/utils/session.ts:312-367`:
  - `:317-321` monta `sealOptions`.
  - `:324` faz `unseal(sealed, config.password, sealOptions)`.
  - `:325-348` é o `catch`. Ele só tenta o fallback legado (iterações = 1) se o erro for `Error` com mensagem `"Bad hmac value"`, se `legacySealFallback !== false` e se `iterations !== 1` (`:332-339`). No fallback, marca `unsealed[kLegacySeal] = true` (`:345-347`).
  - `:349-365` aplica `maxAge` e `idleTimeout`, fora do `try`. Lança `"Session expired!"`.
- `getSession` em `src/utils/session.ts:194-221` chama `unsealSession(...).catch(() => {})`. Em `:199-202` lê e apaga `kLegacySeal`. Em `:214` re-sela quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))`. Sessão vinda de cabeçalho nunca é re-selada, porque `sessionFromCookie` só vira `true` em `:189-193`.
- `kLegacySeal` está definido em `src/utils/internal/session.ts:7-9`.
- `unseal` em `src/utils/internal/iron-crypto.ts:87-150`:
  - Senha errada falha no HMAC com `"Bad hmac value"` (`:135-137`), antes de qualquer decifragem.
  - `"Expired seal"` (`:115-117`), `"Wrong mac prefix"` (`:106-108`), `"Incorrect number of sealed components"` (`:99-101`) e `"Empty password"` (`:94-96`) são lançados antes de qualquer PBKDF2.
  - `"Password string too short ..."` vem de `generateKey` (`:192-196`).
- `src/index.ts:199-212` exporta os tipos e funções de sessão. `SessionConfig` já é exportado, então o campo novo aparece sem tocar no `index`.
- `test/unit/package.test.ts` (linhas 28, 81, 125, 149-152) fixa a lista de exports. Ela não muda.
- `docs/2.utils/4.security.md:42-72` é gerado por `automd:jsdocs` e lista só funções, não campos de interface. Nenhuma doc precisa mudar, e o JSDoc do campo é suficiente (PRD, seção 3).

## 3. Decisões de arquitetura

### D-01 — Onde implementar a tentativa de várias senhas

- **Alternativa A:** tentar várias senhas dentro de `iron-crypto.ts` (`unseal` aceitar lista).
- **Alternativa B:** laço em `getSession`, chamando `unsealSession` várias vezes com configs diferentes.
- **Alternativa C:** laço dentro de `unsealSession`, em `src/utils/session.ts`, com um helper interno que abre com uma senha, incluindo o fallback legado.
- **Escolha: C.** O PRD proíbe mexer em `iron-crypto` (seção 3). A alternativa B faria `unsealSession`, que é público e exportado, ignorar o campo novo. Fora do `getSession`, quem o usa diretamente não teria a rotação. Em C, `unsealSession`, `getSession` e `useSession` ganham o comportamento no mesmo ponto. `maxAge` e `idleTimeout` (`:349-365`) ficam depois do laço, como hoje, e isso garante RF-06.

### D-02 — Quais erros disparam a tentativa da próxima senha

- **Alternativa A:** qualquer erro passa para a próxima senha.
- **Alternativa B:** só `"Bad hmac value"`, o mesmo critério já usado pelo fallback legado (`session.ts:332-339`).
- **Escolha: B.** `"Bad hmac value"` é o único erro que significa "esta senha não abre este selo". Os demais (`"Expired seal"`, prefixo errado, selo malformado) valem para qualquer senha, e a tentativa seria só gasto de CPU. Todos eles ocorrem antes do PBKDF2 e continuam sendo lançados na hora. Um erro de expiração (`"Expired seal"` e `"Session expired!"`) nunca causa nova tentativa (RF-06). Consequência: uma senha extra inválida (curta demais ou vazia) só gera erro quando a tentativa chega nela. Isso é o mesmo erro de configuração que `password` gera hoje, e `getSession` o engole via `.catch` (`:196`).

### D-03 — Ordem de tentativa, com o fallback legado

- **Alternativa A:** por senha: `password` na iteração atual, `password` legado, depois `extra[0]` atual, `extra[0]` legado, e assim por diante.
- **Alternativa B:** todas as senhas na iteração atual primeiro, depois todas no legado.
- **Escolha: A.** Mantém o resultado idêntico ao de hoje para `password` (RF-08) e reaproveita o bloco `try/catch` atual quase sem alteração, extraído para um helper. O custo marginal é baixo. O PBKDF2 com 1 iteração é praticamente grátis, então o custo dominante por senha extra é uma derivação de 8192 iterações (e não "o dobro", como o PRD supõe). O `legacySealFallback: false` desliga o legado para todas as senhas (RF-07).

### D-04 — Qual erro é lançado quando nenhuma senha serve

- **Alternativa A:** lançar o erro da última tentativa.
- **Alternativa B:** lançar o erro da primeira tentativa (`password`).
- **Escolha: B**, conforme o risco "Mascarar erros" do PRD. Com `extraUnsealPasswords` ausente ou `[]`, o helper é chamado uma vez e o erro sai sem captura adicional, então o comportamento é o mesmo de hoje (RF-08). A mensagem hoje já é `"Bad hmac value"`. A ordem exata dos erros do caminho legado de `password` não muda.

### D-05 — Como sinalizar que o reseal é necessário

- **Alternativa A:** reutilizar `kLegacySeal` para as senhas extras.
- **Alternativa B:** novo símbolo interno `kExtraSeal` em `src/utils/internal/session.ts`, tratado em `getSession` junto com `kLegacySeal`.
- **Alternativa C:** devolver `{ unsealed, resealNeeded }` e mudar a assinatura pública de `unsealSession`.
- **Escolha: B.** A alternativa A engana quem lê, porque o nome é "legado" e não descreve "aberta com senha extra". A alternativa C quebra a assinatura pública. O símbolo não é exportado em `src/index.ts`, então não cria nome público (restrição do pedido). Usa o mesmo padrão `Symbol.for("h3.internal.session...")` do arquivo. O marcador é removido em `getSession` antes de `Object.assign(session, unsealed)` (`:199-208`), para nunca ser selado de volta. Isso vale também para `unsealSession` chamado diretamente: o marcador não enumerável por símbolo é ignorado por `JSON.stringify`, como acontece hoje com `kLegacySeal`.

### D-06 — Re-selamento de sessão aberta com senha extra

- **Alternativa A:** re-selar sempre que a abertura usou senha extra, no mesmo ponto do `legacySeal` (`session.ts:214`).
- **Alternativa B:** não re-selar, deixando a sessão com a senha antiga até a próxima escrita.
- **Escolha: A** (RF-05). Em B, a senha antiga não poderia ser aposentada enquanto houvesse sessões ociosas. A condição passa a ser `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(...))`. `updateSession` sela com `config.password` (`:267`, `:300`) e não altera `id` nem `createdAt`. Sessão vinda de cabeçalho não é re-selada, igual a hoje, e esse risco é aceito e documentado no JSDoc.

### D-07 — Normalização da lista

- **Alternativa A:** validar e copiar a lista (descartar duplicatas, vazios e a própria `password`).
- **Alternativa B:** usar `config.extraUnsealPasswords ?? []` tal como vem.
- **Escolha: B.** O PRD define que array vazio equivale a ausente e que as senhas seguem as regras de `password`. Descartar itens silenciosamente esconderia erro de configuração. Uma extra igual a `password` só gasta uma tentativa a mais, porque a primeira tentativa dela já falhou por HMAC.

## 4. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-99` (campo novo após `:48`) | Adicionar `extraUnsealPasswords?: string[]` com JSDoc (só abre sessões; lista curta; remover quando as sessões antigas expirarem; cada tentativa falha custa um PBKDF2; sessão por cabeçalho não é re-selada). |
| `src/utils/session.ts` | `:5` | Importar também `kExtraSeal`. |
| `src/utils/session.ts` | `:199-202` | Ler e apagar `kExtraSeal` junto com `kLegacySeal`. |
| `src/utils/session.ts` | `:214` | Incluir `extraSeal` na condição do reseal. |
| `src/utils/session.ts` | `:312-348` | Extrair o `try/catch` atual para o helper interno `unsealWithPassword` e fazer o laço em `unsealSession`. Manter `:349-365` intactos, depois do laço. |
| `src/utils/internal/session.ts` | após `:9` | Exportar `kExtraSeal` (`Symbol.for("h3.internal.session.extra-seal")`). |
| `test/session.test.ts` | novo bloco, por exemplo antes de `:188` | Testes novos em `describeMatrix` (seção 6). |

Não mudam: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/package.test.ts` e `docs/`. Nenhum teste existente deve exigir ajuste. Os que dependem de falha de unseal (`session.test.ts:161-186`, legado com `legacySealFallback: false`) e do número de `Set-Cookie` (`:154`) não usam `extraUnsealPasswords`, e o caminho sem extras é idêntico.

## 5. Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (campo novo, único nome público)
export interface SessionConfig {
  password: string; // inalterado: única senha que sela
  /**
   * Previous passwords that are only used to open sessions, never to seal them.
   * ...
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}

// src/utils/internal/session.ts (interno, não exportado em src/index.ts)
export const kExtraSeal: unique symbol;

// src/utils/session.ts (interno, não exportado)
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
// Comportamento: o try/catch atual de unsealSession, parametrizado por senha.
// Marca kLegacySeal quando o fallback de 1 iteração é usado.
```

`unsealSession(_event, config, sealed): Promise<Partial<Session>>` mantém a assinatura. Esboço do laço:

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
let unsealed: Partial<Session> | undefined;
let firstError: unknown;
for (const [index, password] of passwords.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, config, sealOptions);
    if (index > 0) (unsealed as any)[kExtraSeal] = true;
    break;
  } catch (error) {
    if (index === 0) firstError = error;
    // só a senha errada (HMAC) segue para a próxima; o resto é lançado
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
  }
}
if (!unsealed) throw firstError;
```

Pontos de atenção na implementação:
- Com lista vazia ou ausente, o resultado deve ser o mesmo de hoje. Se o código ficar mais claro assim, usar caminho curto: se não houver extras, `return`/lançar direto do helper, sem laço.
- Se `unseal` devolver `null` (payload vazio), o código atual usa `unsealed.createdAt` sem checar, e isso pode lançar `TypeError`. Hoje esse comportamento é preservado, e o `break` não pode depender do valor ser truthy. Usar uma flag `opened` em vez de `if (!unsealed)` se necessário.
- O erro lançado no esgotamento é o da primeira tentativa (D-04).

## 6. Estratégia de testes

Seguir o fluxo de correção de bug do `AGENTS.md`: escrever os testes primeiro, confirmar que falham e só então implementar (RF-09). Os testes ficam em `test/session.test.ts`, dentro do `describeMatrix("session", ...)` existente (matriz web e node). Usam `seal`, `unseal` e `sealDefaults` já importados (`:12`). Cada caso usa `name`/config próprios para não colidir com o cookie compartilhado do bloco. Senhas de teste com 32+ caracteres, por exemplo `"antiga-" + "a".repeat(40)`.

| Caso | Requisito | Verificação |
| --- | --- | --- |
| Config com `extraUnsealPasswords` compila | RF-01 | `pnpm typecheck` (campo aceito, `password` ainda `string`). |
| `sealSession`/cookie de `updateSession` abre só com `password` | RF-02 | `unseal(valor, "nova", sealDefaults)` ok. `unseal(valor, "antiga", sealDefaults)` rejeita com `Bad hmac value`. |
| Cookie selado com a antiga é lido (`id`, `data`) | RF-03 | Resposta de `/` traz `id` e `data` originais. |
| Senha extra na segunda posição da lista é encontrada | RF-03 | Lista com duas extras, sessão selada com a segunda. |
| Sessão selada com senha desconhecida cria sessão nova | RF-04 | `id` diferente (vem de `generateId`), `data` vazio. |
| Cookie aberto com extra gera `Set-Cookie` re-selado com `password` | RF-05 | `getSetCookie()` com 1 item e `unseal(..., "nova", sealDefaults)` com `id` igual ao original. |
| Sessão por cabeçalho (`x-h3-test-session`) aberta com extra não emite cookie | RF-05 | `getSetCookie()` vazio. |
| Sessão expirada (`maxAge`) selada com extra é rejeitada | RF-06 | Fake timers só de `Date` (como `:190`). `id` novo na resposta. |
| Selo com `ttl` vencido não faz novas tentativas | RF-06 | Opcional: espiar `unseal` é inviável via import ESM. Cobrir só o resultado (sessão nova). |
| Selo legado (1 iteração) com a antiga em `extraUnsealPasswords` | RF-07 | Sessão restaurada. Cookie re-selado abre com `password` e `sealDefaults`. |
| Mesmo selo legado com `legacySealFallback: false` | RF-07 | Sessão rejeitada (`id` novo). |
| `extraUnsealPasswords: []` e ausente se comportam igual | RF-08 | Selo da `password` abre sem reseal. O `Set-Cookie` com senha desconhecida continua sem restauração. |

Além disso, rodar:
- `pnpm vitest run test/session.test.ts` (RF-09).
- `pnpm vitest run test/unit/package.test.ts` (nenhum export novo).
- `pnpm lint` e `pnpm typecheck`.
- `pnpm test` completo antes de concluir, para pegar regressões fora de sessões.

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Custo de CPU: cada senha extra que falha custa um PBKDF2 de 8192 iterações. Um cookie inválido forçaria `1 + N` derivações. | Vetor de abuso por requisição. | D-02: só `"Bad hmac value"` repete. Falhas baratas (expiração, formato) saem antes do PBKDF2. JSDoc pede lista curta. O PBKDF2 do fallback legado, com 1 iteração, é desprezível. |
| Mascarar erros ao tentar várias senhas. | Mensagens de erro diferentes das atuais. | D-04: lançar o erro da primeira tentativa. Sem extras, o caminho é idêntico ao de hoje. |
| Marcador `kExtraSeal` vazar para o payload selado ou para `session`. | Estado interno gravado no cookie. | Apagar em `getSession` antes do `Object.assign` (`:199-208`). É chave de símbolo, que `JSON.stringify` ignora. |
| Re-selar a cada leitura se o marcador não for apagado ou se a senha extra for igual a `password`. | Cookie reemitido sem necessidade. | Marcador só é definido quando `index > 0`, ou seja, depois que `password` falhou. |
| Senha extra comprometida continua abrindo sessões. | Segurança. | O re-selamento (RF-05) encurta a janela, e a remoção da senha é responsabilidade do operador (JSDoc). |
| Sessões por cabeçalho não são re-seladas. | Dependem de a senha extra permanecer configurada. | Comportamento atual preservado, documentado no JSDoc. |
| Senha extra curta ou vazia só falha quando alcançada. | Erro de configuração silencioso, pois `getSession` engole o erro. | Aceito (D-02). Mesma regra de `password`. |
| `unsealed` nulo (payload `null`) e o laço. | `TypeError` já existente em `:351`. | Não piorar: o laço não pode depender do valor ser truthy. |
