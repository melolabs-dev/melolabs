# Especificação técnica — Múltiplas senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-09), h3js/h3#1050.

## Resumo

Adicionar `extraUnsealPasswords?: string[]` em `SessionConfig`. Ao abrir um selo, o código tenta `password` e depois cada senha extra, nesta ordem, até uma abrir o selo. Toda gravação continua selada só com `password`. Nenhum outro nome público novo.

A mudança fica restrita a `src/utils/session.ts`, mais testes. O formato do selo, o `iron-crypto.ts` e os parâmetros de PBKDF2 não mudam.

## Correções ao PRD

Duas premissas do PRD não batem com o código. Esta especificação segue o código.

1. **Senha mínima existe e vale para `password`.** O PRD diz que "o código não impõe tamanho mínimo hoje". O `iron-crypto.ts` impõe: `minPasswordlength: 32` em `src/utils/internal/iron-crypto.ts:22` e `:28`, e a checagem em `src/utils/internal/iron-crypto.ts:191-196`. Logo, as senhas extras também herdam esse mínimo sem código novo. Ver D-05 e o risco R1.
2. **O fallback legado não dobra o custo.** O PRD diz que o fallback "pode dobrar esse custo". O retry legado roda com 1 iteração (`src/utils/session.ts:340-344`), então custa quase nada. O custo real de um cookie inválido é uma derivação PBKDF2 de 8192 iterações por senha configurada, feita antes da checagem de HMAC (`src/utils/internal/iron-crypto.ts:133`). Com N extras, são N+1 derivações completas. Ver R2.

## Decisões de arquitetura

### D-01 — Onde ficam as tentativas: loop dentro de `unsealSession`

**Escolha.** O loop de senhas fica em `unsealSession` (`src/utils/session.ts:312-367`). O corpo atual do `try/catch` com o fallback legado vira um helper interno que recebe uma senha só.

**Por quê.** `unsealSession` já é o ponto único para cookie e header (`src/utils/session.ts:196`), e é onde as checagens de `maxAge` e `idleTimeout` acontecem (`:350-365`). Com o loop ali, RF-05 e RF-07 valem sem código extra.

**Alternativas.**
- *Usar `PasswordHash` do iron* (`src/utils/internal/iron-crypto.ts:427`, seleção em `:120-128`). Rejeitada. O iron indexa por `id`, e o selo gerado por h3 não tem `id` (`passwordId` vazio vira `"default"`). Ele não expressa uma ordem de tentativas nem várias senhas com o mesmo id. Também exigiria mexer no iron, que está fora de escopo.
- *Loop em `getSession`.* Rejeitada. Separaria a tentativa de abertura das checagens de expiração, que ficam em `unsealSession`. Duplicaria lógica.

### D-02 — Critério de parada: só `Bad hmac value` passa para a próxima senha

**Escolha.** Para cada senha, tenta-se abrir o selo. Se o erro for exatamente `"Bad hmac value"`, passa-se para a próxima senha. Qualquer outro erro para o loop e é relançado. Isso inclui `"Expired seal"` (`src/utils/internal/iron-crypto.ts:116`), `"Wrong mac prefix"` (`:107`) e `"Password string too short..."` (`:193`).

**Por quê.** `"Bad hmac value"` é o único erro que significa "esta senha não é a certa". Os outros indicam problema do selo ou da configuração, e continuar tentando mascararia o problema.

**Alternativa rejeitada.** Capturar qualquer erro e seguir para a próxima senha. Mascara senha curta e torna o erro de configuração invisível.

### D-03 — Fallback legado por senha, dentro de cada tentativa

**Escolha.** Para cada senha, a ordem é: abrir com as opções atuais; se der `"Bad hmac value"` e o fallback estiver ativo, abrir com 1 iteração. Só depois passa-se para a próxima senha. A marcação `kLegacySeal` continua sendo definida no sucesso (`src/utils/session.ts:345-347`), então `getSession` regrava a sessão como hoje (`:199-201`, `:214`).

**Por quê.** Mantém o helper autocontido e cobre o caso de sessão antiga selada com uma senha extra. O custo do retry legado é desprezível (1 iteração).

**Alternativa.** Tentar todas as senhas com opções atuais e só depois o legado para todas. Mesmo custo no pior caso, mas a lógica fica mais difícil de ler. Rejeitada.

### D-04 — Selagem inalterada

**Escolha.** `sealSession` (`src/utils/session.ts:282-307`) continua selando com `config.password` (`:300`). Nenhum código novo migra sessões.

**Por quê.** O PRD proíbe caminho novo de migração. A troca acontece pelos caminhos que já existem: escrita pelo handler (`updateSession`, `:241`), reseal legado (`:214`) e reseal do `idleTimeout` (`shouldSlide`, `:414`).

### D-05 — Senhas extras sem validação própria

**Escolha.** Nenhuma validação nova em `useSession` ou `getSession`. A senha curta gera erro do iron no momento de abrir, igual a `password` hoje. A JSDoc de `extraUnsealPasswords` diz que cada extra precisa ter o mesmo mínimo de `password`.

**Por quê.** `password` também não é validada na configuração. Validar só as extras criaria um segundo caminho de validação. A regra fica no mesmo lugar para as duas.

**Alternativa.** Validar a lista em `useSession` e lançar erro explícito. Rejeitada por ora, por ser um segundo caminho de validação. Fica como pendência (ver abaixo).

### D-06 — Tipo público

**Escolha.** Um campo novo em `SessionConfig` (`src/utils/session.ts:39`). Nada em `Session`, nenhum export novo. `test/unit/package.test.ts` lista os exports (`:81` para `getSession`, `:149` para `unsealSession`, `:152` para `useSession`) e continua igual.

### D-07 — Expiração aplicada depois do loop

**Escolha.** As checagens de `maxAge` (`src/utils/session.ts:350-355`) e de `idleTimeout` (`:359-365`) ficam depois do loop, sobre o payload aberto por qualquer senha. Não há checagem por senha.

**Por quê.** Atende RF-05 sem duplicar código.

## Arquivos a alterar

| Arquivo | O que muda |
| --- | --- |
| `src/utils/session.ts:39-48` | Campo `extraUnsealPasswords?: string[]` em `SessionConfig`, com JSDoc. Ajustar também a JSDoc de `password` (`:41`) para citar as extras. |
| `src/utils/session.ts:312-367` | `unsealSession` passa a fazer o loop de senhas (D-01, D-02, D-07). A assinatura não muda. |
| `src/utils/session.ts` (fim do arquivo, após `:464`) | Helper interno `unsealWithPassword`, com o `try/catch` atual de `:322-348` movido e trocando `config.password` por um parâmetro. Helper no fim do arquivo, conforme `AGENTS.md`. |
| `test/session.test.ts` | Novos casos na mesma `describeMatrix` (`:15`). Ver estratégia de testes. |

Sem alteração em: `sealSession` (`:282-307`), `getSession` (`:149-232`), `src/utils/internal/iron-crypto.ts`, `src/_deprecated.ts`, `test/unit/package.test.ts`.

## Contratos e assinaturas

```ts
// src/utils/session.ts — adição em SessionConfig
export interface SessionConfig {
  /** ... (mantido) ... */
  password: string;
  /**
   * Senhas anteriores, usadas só para abrir sessões seladas antes da rotação.
   * Tentadas em ordem, depois de `password`. Nunca são usadas para selar.
   * Cada uma precisa ter o mesmo tamanho mínimo de `password`.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}

// Assinatura inalterada
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

// Helper interno (não exportado)
async function unsealWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Comportamento de `unsealSession`:

1. Monta `sealOptions` como hoje (`src/utils/session.ts:317-321`).
2. Para cada senha em `[config.password, ...(config.extraUnsealPasswords || [])]`, chama `unsealWithPassword`.
3. Se der certo, usa o resultado e sai do loop.
4. Se der erro com mensagem exatamente `"Bad hmac value"` e não for a última senha, passa para a próxima.
5. Em qualquer outro caso, relança o erro. Na última senha, relança o `"Bad hmac value"`, que `getSession` engole como hoje.
6. Aplica as checagens de `maxAge` e `idleTimeout` (`:350-365`) e retorna.

Ao chegar em `getSession`, nada muda: ele já trata o retorno e o erro (`src/utils/session.ts:196-197`).

Quando `extraUnsealPasswords` não é informado ou é vazio, a lista tem um item só e o comportamento é o de hoje (RF-04).

## Estratégia de testes

A regra do `AGENTS.md` vale: escrever o teste de regressão e ver falhar antes de mudar o código. Os testes novos vão em `test/session.test.ts`, com `describeMatrix` (web e node). Para selar com senhas antigas, seguir o padrão de `seal(...)` já usado em `test/session.test.ts:135-143`.

| Teste | Cobre | Verificação |
| --- | --- | --- |
| Cookie selado com `extraUnsealPasswords[1]` | RF-03 | Dados, `id` e `createdAt` originais preservados. |
| `POST` com cookie antigo, depois abrir o novo cookie | RF-02 | Abre com `password`; abrir com a senha antiga lança `"Bad hmac value"`. |
| Senha que não está na lista | RF-06 | Sessão nova, `data` vazio, resposta 200, sem erro para o `ctx.errors`. |
| Sessão antiga com `createdAt` além de `maxAge` | RF-05 | Vira sessão nova. |
| Header `x-h3-test-session` com selo antigo | RF-07 | Dados lidos. |
| Selo com 1 iteração e senha extra | RF-08 | Abre, regrava com `password` e as opções atuais (padrão de `test/session.test.ts:134-159`). |
| Senha extra curta antes da correta | D-02, D-05 | `unsealSession` rejeita com `"Password string too short"`. Teste unitário com `unsealSession({} as HTTPEvent, config, sealed)`. |
| Cookie inválido com `password` + 2 extras | R2 | Conta chamadas a `crypto.subtle.deriveBits` com `vi.spyOn`. Esperado: 2 × (N+1) = 6. Confirmar ao rodar. |
| Tipo com `extraUnsealPasswords` | RF-01 | Literal de config compila. Confirmar se `tsconfig` inclui `test/`; se não incluir, usar `test/unit/types.test-d.ts`. |
| Suíte existente | RF-04 | `test/session.test.ts` e `test/unit/package.test.ts` passam sem mudar expectativa. |

Verificação final: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint` (inclui `oxfmt --check`), `pnpm typecheck` (`tsc --noEmit`, conforme `package.json`).

## Riscos

**R1 — Senha curta em extra.** Uma extra com menos de 32 caracteres gera erro ao abrir. Esse erro afeta só sessões que não abrem com as senhas antes dela na lista. `getSession` engole o erro (`src/utils/session.ts:197`), então o efeito é o usuário ser deslogado sem aviso. *Mitigação:* JSDoc (D-05) e o teste de senha curta. Pendência: decidir se vale validar cedo.

**R2 — Custo com cookie inválido.** Cada senha configurada custa uma derivação de 8192 iterações por requisição com cookie que não abre (ver correção 2). Como o cookie vem do cliente, isso permite gastar CPU. *Mitigação:* documentar um limite recomendado de extras (o PRD sugere 2 a 3) e manter o teste de contagem do item acima.

**R3 — Senha antiga esquecida.** Enquanto uma senha estiver na lista, sessões seladas com ela abrem até expirar. *Mitigação:* documentar que a senha pode sair da lista só depois de `maxAge` (ou `idleTimeout`) da sessão mais antiga. Sem `idleTimeout`, uma sessão aberta com extra só migra com uma escrita (D-04).

**R4 — Ordem das tentativas vaza informação de temporização.** Quanto mais tarde a senha está na lista, mais derivações o servidor faz. Isso revela só o índice da senha, não o segredo. Risco baixo, sem mitigação planejada.

**R5 — Regressão silenciosa.** Erros em `unsealSession` são engolidos por `getSession`. Um bug na ordem pode deslogar usuários sem erro visível. *Mitigação:* os testes de RF-03, RF-05 e RF-06 com senha correta, antiga e desconhecida.

## Pendências para decisão

1. Validar `extraUnsealPasswords` em `useSession` com erro explícito (D-05, R1). Recomendação: fazer só se a equipe quiser. O código atual já falha, só que em silêncio.
2. Migrar sessões abertas com senha extra de forma imediata (fora do escopo do PRD). Rejeitado por ora.
3. Limite recomendado de senhas extras (R2). Sugestão: 2, documentada na JSDoc.
