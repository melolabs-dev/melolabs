# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-07). Este documento decide como implementar. Nenhum código do projeto foi alterado.

## Estado atual (conferido no código)

- `SessionConfig` tem uma única `password: string` (`src/utils/session.ts:48`).
- `sealSession` sela com `config.password` (`src/utils/session.ts:300-304`).
- `unsealSession` tenta uma única vez com `config.password` (`src/utils/session.ts:324`). Se falhar com `"Bad hmac value"` e o fallback legado estiver ativo, repete com 1 iteração PBKDF2 (`src/utils/session.ts:332-344`).
- `getSession` chama `unsealSession` dentro de `.catch(() => {})` (`src/utils/session.ts:196-197`). Qualquer erro vira "sessão nova" sem aviso. Por isso a validação de RF-05 não pode ficar só dentro de `unsealSession`.
- Premissa do PRD, verificada: `getSession` só regrava a sessão quando ela é legada (`legacySeal`) ou quando `shouldSlide` é verdadeiro, ou seja, `idleTimeout` configurado e mais da metade da janela usada (`src/utils/session.ts:214`, `src/utils/session.ts:414-421`). Uma sessão aberta com senha extra e sem `idleTimeout` não é regravada ao ser lida.
- `iron-crypto` rejeita senha vazia com `"Empty password"` (`src/utils/internal/iron-crypto.ts:94-96`, `:171-174`) e senha curta com `"Password string too short (min N characters required)"` (`src/utils/internal/iron-crypto.ts:191-196`). O mínimo vem de `minPasswordlength`, que é 32 por padrão nos dois blocos (`src/utils/internal/iron-crypto.ts:22`, `:28`).
- `"Bad hmac value"` é lançado antes de qualquer decriptação (`src/utils/internal/iron-crypto.ts:135-137`). Cada tentativa com senha errada custa uma derivação PBKDF2 (integridade).
- `"Expired seal"` (TTL do iron) é lançado antes do HMAC (`src/utils/internal/iron-crypto.ts:110-118`). Cookie expirado não gasta PBKDF2.

## Decisões de arquitetura

### D-01 — Forma de configurar as senhas extras

**Escolha:** novo campo opcional `extraUnsealPasswords?: string[]` em `SessionConfig`, como manda o contrato. `password` continua `string`.

**Alternativas consideradas:**
- `password: string | string[]` (segunda alternativa da issue). Quebra o tipo público de `password` e mistura "selar" com "abrir". Fica fora de escopo pelo PRD.
- Senhas com id do iron (`{ id, secret }`). Exigiria seleção por id no selo, que o PRD exclui.
- Callback `getUnsealPasswords()`. Mais flexível, mas adiciona um tipo de contrato novo e não é pedido.

**Justificativa:** é o menor contrato que cumpre RF-01 e não cria nomes públicos além do campo.

### D-02 — Ordem de tentativa e critério de avanço

**Escolha:** tentar `config.password` e depois cada item de `extraUnsealPasswords`, na ordem. Avançar para a próxima senha **somente** em `"Bad hmac value"`. Qualquer outro erro é relançado na hora.

**Alternativas consideradas:**
- Capturar qualquer erro e seguir para a próxima senha. Mascara erros de configuração (RF-05) e repete trabalho inútil. Com `"Expired seal"`, cada senha gastaria PBKDF2 para depois falhar do mesmo jeito.
- Derivar as chaves de todas as senhas em paralelo. Aumenta o custo de CPU sem ganho no caso comum.

**Justificativa:** `"Bad hmac value"` é o único erro que significa "esta senha não é a certa". Os demais não dependem da senha, então tentar outra não serviria para nada. Isso também mantém o erro final idêntico ao atual (RF-04).

### D-03 — Combinação com o fallback de selo legado

**Escolha:** o fallback é aplicado em duas passadas. Primeiro tenta **todas** as senhas com as iterações atuais. Só se nenhuma abrir, e se o fallback estiver ativo, tenta **todas** as senhas com 1 iteração.

**Alternativas consideradas:**
- Intercalar por senha (senha 1 atual, senha 1 legada, senha 2 atual, ...). Simples, mas uma sessão aberta com a senha extra e com iterações atuais custa 3 derivações em vez de 2, e o caminho comum não ganha nada com isso.

**Custo:** com `N` senhas extras e fallback ativo, um cookie inválido custa `2 × (1 + N)` derivações de integridade. Sem extras, o custo é o de hoje (2).

**Justificativa:** o caminho comum (sessão atual, iterações atuais) continua com a mesma ordem de tentativas. O fallback legado é de compatibilidade e só roda depois.

### D-04 — Validação antecipada das senhas extras

**Escolha:** uma função interna `assertExtraUnsealPasswords(config)` valida cada item antes de qualquer tentativa. Ela é chamada em:
- `getSession`, antes do bloco que cria `context.sessions` e antes do `.catch` (para o erro não ser engolido);
- `sealSession`, no início (RF-05: "selada ... com essa configuração, lança erro");
- `unsealSession`, no início (é exportada em `src/index.ts:209` e pode ser chamada direto).

A validação lança `Error("Empty password")` para item vazio e `Error("Password string too short (min N characters required)")` para item curto, com `N = max(encryption.minPasswordlength, integrity.minPasswordlength)` das opções efetivas.

**Alternativas consideradas:**
- Validar só dentro de `unsealSession`. Falha: o `.catch` de `getSession` engole o erro e o sistema lê "sem sessão" sem aviso. Isso é exatamente o silêncio que RF-05 proíbe.
- Validar só em `sealSession`. Falha: um typo em senha extra nunca abriria sessões e nenhum erro apareceria na leitura.
- Exportar a validação de `iron-crypto.ts`. Mexe em um arquivo de crypto que não precisa mudar. Deixo a mensagem duplicada em `session.ts` e registro como risco baixo.

**Justificativa:** o erro aparece na primeira vez que a configuração é usada, em qualquer caminho. Sem extras, a função não faz nada (RF-04).

### D-05 — Não regravar ao abrir com senha extra

**Escolha:** `getSession` não muda. Uma sessão aberta com senha extra só é regravada com a senha atual quando (a) for legada, (b) passar da metade da janela de `idleTimeout`, ou (c) houver escrita (`updateSession`).

**Alternativas consideradas:**
- Regravar sempre que a sessão for aberta com senha extra, reaproveitando o caminho do `kLegacySeal` (uma flag no resultado de `unsealSession` e uma linha em `getSession`). A rotação termina no primeiro acesso de cada usuário. Custo: um selo extra por sessão na migração.

**Justificativa:** o PRD põe regravação obrigatória fora de escopo e diz que a rotação termina quando a sessão expira ou o usuário loga de novo. Seguir isso não exige código novo. A alternativa é uma mudança pequena e isolada, se o usuário preferir (ver "Pontos em aberto").

### D-06 — Onde fica o código

**Escolha:** tudo em `src/utils/session.ts`. Os helpers novos vão no fim do arquivo, como manda `AGENTS.md` (internal helpers at the end of files). `src/utils/internal/iron-crypto.ts` não muda. Nenhuma nova exportação em `src/index.ts`. `test/unit/package.test.ts:125` e `:149` (lista de exports) continuam válidos.

**Justificativa:** a mudança é de configuração de sessão. Não há nova API pública, então não há atualização de `src/index.ts` nem de `test/unit/package.test.ts`.

## Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-99` (`SessionConfig`) | Campo `extraUnsealPasswords?: string[]` com JSDoc (RF-01). Inserir depois de `password` (`:48`). |
| `src/utils/session.ts` | `:149-153` (`getSession`) | Chamar `assertExtraUnsealPasswords(config)` logo após `const sessionName` (`:153`), antes de `context.sessions` (`:155`). |
| `src/utils/session.ts` | `:282-307` (`sealSession`) | Chamar `assertExtraUnsealPasswords(config)` no início. O `seal` (`:300`) continua usando só `config.password`. |
| `src/utils/session.ts` | `:312-367` (`unsealSession`) | Validar no início; trocar `unseal(sealed, config.password, ...)` (`:324`) por `unsealWithPasswords`; trocar a comparação de `error.message` (`:336`) por `isBadHmac`; repetir a chamada no legado (`:340-344`) com a lista completa. |
| `src/utils/session.ts` | fim do arquivo (após `:464`) | Helpers internos: `assertExtraUnsealPasswords`, `unsealWithPasswords`, `isBadHmac`. |
| `test/session.test.ts` | novo `describe` após o bloco `lazy creation` (`:692`), usando `describeMatrix` como o resto do arquivo (`:15`) | Testes de RF-02 a RF-07 (ver estratégia). |

Nenhum outro arquivo muda. `docs/2.utils/4.security.md:56-62` só lista nomes de função; o PRD deixa a documentação fora do JSDoc do campo, então não é alterado nesta entrega.

## Contratos e assinaturas

### Campo público

```ts
export interface SessionConfig {
  password: string; // inalterado: a única senha usada para selar
  /**
   * Previous passwords that can still open sessions sealed with them. They are
   * tried in order after `password`, and are never used to seal. ...
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}
```

JSDoc (em inglês, como o resto do arquivo), com o que a lista faz, que só abre sessões, que cada item custa uma derivação PBKDF2 por tentativa e deve ser curta, que uma senha antiga removida invalida as sessões seladas com ela, e que quem tem um cookie selado com a senha extra pode usá-lo até expirar.

### Helpers internos (não exportados)

```ts
/** Throws for an empty or too-short extra password. No-op without extras. */
function assertExtraUnsealPasswords(config: SessionConfig): void;

/**
 * Tries each password in order. Moves on only on "Bad hmac value"; any other
 * error is thrown at once. Rethrows the last "Bad hmac value" if none opens it.
 */
function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  options: SealOptions,
): Promise<Partial<Session>>;

/** True when the error means the password is wrong (HMAC mismatch). */
function isBadHmac(error: unknown): boolean;
```

### Esboço de `unsealSession` (somente a parte nova)

```ts
export async function unsealSession(_event, config, sealed) {
  assertExtraUnsealPasswords(config);
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let unsealed: Partial<Session>;
  try {
    unsealed = await unsealWithPasswords(sealed, passwords, sealOptions);
  } catch (error) {
    // TODO comment preserved
    if (config.legacySealFallback === false || sealOptions.integrity.iterations === 1 || !isBadHmac(error)) {
      throw error;
    }
    unsealed = await unsealWithPasswords(sealed, passwords, {
      ...sealOptions,
      encryption: { ...sealOptions.encryption, iterations: 1 },
      integrity: { ...sealOptions.integrity, iterations: 1 },
    });
    if (unsealed) (unsealed as any)[kLegacySeal] = true;
  }
  // checagens de maxAge e idleTimeout inalteradas (:349-365)
  return unsealed;
}
```

O resto de `unsealSession` (checagens de `maxAge` e `idleTimeout`, `:349-365`) não muda. Por isso RF-06 vale para qualquer senha.

### Comportamento observável

| Situação | Resultado |
| --- | --- |
| Sem `extraUnsealPasswords` (ou `[]`) | Mesmas tentativas (1 + 1 com legado), mesmos cookies, mesmo erro `Bad hmac value` (RF-04). |
| Cookie selado com extra `A`, config `password: B`, `extraUnsealPasswords: [A]` | Sessão carregada com os mesmos dados (RF-02). |
| `sealSession` / `updateSession` | Sempre com `B`. `unseal` só com `A` lança `Bad hmac value` (RF-03). |
| Extra `""` ou curta | `getSession`/`useSession` rejeitam; `sealSession` e `unsealSession` lançam (RF-05). |
| Extra aberta com `maxAge` vencido | `Session expired!`, como para a senha atual (RF-06). |
| Extra com sessão legada (1 iteração) | Carregada; `kLegacySeal` é sinalizado; regravada com `B` no caminho existente (RF-07). |

## Estratégia de testes

Seguir o padrão do projeto: `describeMatrix` em `test/session.test.ts` (roda em `web` e `node`). Usar `seal` de `src/utils/internal/iron-crypto.ts` para selar com a senha antiga, como em `test/session.test.ts:134-143`.

Ordem TDD (AGENTS.md, Bug Fix Workflow, adaptado a feature): escrever os testes primeiro, rodar e confirmar que falham por falta de suporte (não por erro de digitação), depois implementar.

| # | Teste | Verifica | Como |
| --- | --- | --- | --- |
| T-01 | Abre sessão selada com a senha extra | RF-02 | Selar com `A`; `t.fetch` com cookie; config `{ password: B, extraUnsealPasswords: [A] }`; checar `session.data`. Config tipada como `SessionConfig` cobre RF-01 no `tsc`. |
| T-02 | Sela só com `password` | RF-03 | `updateSession` com config `B`+`[A]`; `unseal(cookie, A)` rejeita com `Bad hmac value`; `unseal(cookie, B)` funciona. |
| T-03 | Ordem e avanço: extras errada antes da certa | D-02 | `[X, A]` abre sessão selada com `A`. |
| T-04 | Sem extras, mesmo comportamento | RF-04 | Cookie com outra senha: sessão nova, e `crypto.subtle.deriveBits` chamado 2 vezes (atual + legado). Com `[X, Y]` extras e fallback ativo: 6 vezes (`2 × 3`). |
| T-05 | Erro que não é HMAC não percorre as senhas | D-02 | Cookie com `ttl` vencido (`Expired seal`) e extras: `deriveBits` chamado 0 vezes. |
| T-06 | Expiração com senha extra | RF-06 | `unsealSession({} as any, config, sealed)` com `maxAge` vencido rejeita com `Session expired!`. |
| T-07 | Fallback legado com extra | RF-07 | Selar com `A` e 1 iteração; config `B`+`[A]`; sessão carregada, `Set-Cookie` presente, e o novo cookie abre com `B`. |
| T-08 | Validação de extras | RF-05 | `[""]`: `useSession` rejeita com `Empty password`, e `sealSession` e `unsealSession` também. `["curta"]`: rejeita com `too short`. Nenhuma sessão nova é gerada (`getSession` não engole). |
| T-09 | Sliding com extra | D-05 | Sessão aberta com `A` e `idleTimeout` com janela mais da metade usada: a resposta traz cookie selado com `B`. Opcional, mas cobre a premissa do PRD. |

Comandos:
- `pnpm vitest run test/session.test.ts`: suíte de sessão, com os novos testes.
- `pnpm vitest run test/unit/iron-crypto.test.ts`: confirma que nada no iron mudou.
- `pnpm lint` e `pnpm typecheck`: exigidos pelo PRD.
- `pnpm test` antes de fechar: lint, typecheck e cobertura completa.

Os testes existentes em `test/session.test.ts:134-186` (legado e `legacySealFallback: false`) e `:410-474` (contagem de `subtle.encrypt` no throttle) não devem precisar de ajuste. Se algum quebrar, a causa é a mudança de `unsealSession` e precisa ser explicada no relatório, não contornada.

## Riscos

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| Amplificação de CPU: cada cookie inválido gasta `2 × (1 + N)` derivações PBKDF2 (8192 iterações) quando o fallback está ativo. Pode ser usado como vetor de DoS. | Média | Médio | JSDoc diz para manter a lista curta. Cookie expirado não paga PBKDF2 (`Expired seal` vem antes do HMAC). T-04 mede a contagem, para que a regressão apareça no teste. |
| Sessões que só são lidas continuam com a senha antiga até expirar (D-05). Remover a senha antiga antes de `maxAge` desconecta quem não escreveu desde a rotação. | Alta | Médio | Documentado no JSDoc e no PRD. Ver "Pontos em aberto" para a alternativa. |
| Sessão roubada antes da rotação continua válida enquanto a senha antiga estiver na lista. | Alta (por desenho) | Alto | Está no PRD. Documentar no JSDoc. Remover a senha antiga após `maxAge`. |
| Header de sessão (`sessionHeader`) nunca é regravado, então sessões abertas com extra por header ficam com a senha antiga até expirar. | Média | Baixo | Mesmo comportamento já existente para `idleTimeout` em header (`src/utils/session.ts:357-358`). Documentar. |
| Typo em senha extra que passa na validação de tamanho nunca abre sessões, e não há erro. | Média | Médio | RF-05 valida só vazio e tamanho, como pedido. Nenhuma verificação adicional sem pedido. |
| Mensagem de senha curta duplicada entre `session.ts` e `iron-crypto.ts`. | Baixa | Baixo | Mantida igual à do iron. Se o iron mudar, o teste T-08 detecta. |
| Duplicar a mesma senha em `password` e em `extraUnsealPasswords` gasta uma derivação extra por cookie inválido. | Baixa | Baixo | Não tratado. Deduplicar com `Set` seria simples se virar problema. |
| Legado + extras multiplica tentativas (D-03). | Certa | Médio | Coberto por T-04 e T-07. |

## Pontos em aberto

1. **Regravar ao abrir com senha extra (D-05).** Não implementado, por escopo do PRD. Se você quiser que a rotação termine no primeiro acesso, a mudança é pequena: `unsealSession` sinaliza a abertura com extra (como faz com `kLegacySeal`), e `getSession` regrava nesse caso. Custo: um selo extra por sessão na migração. Preciso que você decida antes de implementar.
2. **Mensagem de erro para senha curta.** Está duplicada de `iron-crypto.ts`. Se você preferir exportar a validação de lá, a mudança é em um arquivo a mais.
3. **Documentação fora do JSDoc.** `docs/4.examples/handle-session.md` e `docs/2.utils/4.security.md` não são atualizados nesta entrega, por escopo. Confirme se quer um trecho sobre rotação.
