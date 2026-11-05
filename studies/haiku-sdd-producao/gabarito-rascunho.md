# Gabarito dos testes de aceite ocultos: rascunho

> **Rascunho de 05/11/2026. Nenhum teste vale até o autor aprovar um a um.** Os testes são escritos antes de qualquer execução e **nunca entram no enunciado nem no repositório dado aos modelos**. Depois de aprovados, são travados com hash (SHA-256) no pré-registro (F3.3).

## Decisões do autor (05/11/2026): maximizar dados
Critério dado pelo autor: em cada pergunta aberta, escolher a opção que gera mais dados, mesmo que algumas fiquem menos conclusivas. Aplicado assim:

| Pergunta | Decisão | Consequência |
|---|---|---|
| #1384, contrato (A, B ou C) | **As três** | A feature vira 3 variantes de tarefa: #1384-A (opt-in por configuração), #1384-B (padrão para todos os erros) e #1384-C (utilitário explícito). Cada uma tem enunciado e testes próprios. |
| #1384, P10 (stack em modo debug) | **Medir os dois** | P10 passa a ser **observação registrada**, não aprovação: grava se o `stack` aparece e onde. Entra como dado, não como critério de aceite. |
| #1050, contrato (a ou b) | **As duas** | Duas variantes: #1050-a (`password` aceita lista) e #1050-b (`extraUnsealPasswords`). |
| #1050, S3 (re-selar) | **Entra** | S3 vale como teste pontuado, relatado em separado dos demais. |
| #1267, R10 e R11 | **Entram**, e `If-Range` entra | R14 e R15 acrescentados. |

Efeito: 3 features, **6 variantes de tarefa** (#1267, #1384-A/B/C, #1050-a/b). Para a estatística (ver adendo no plano de análise), os blocos continuam sendo as 3 features e as variantes ficam aninhadas dentro delas. O custo das execuções cresce, mas **não há teto de gasto**: o custo é medido e reportado, e o limite passa a ser o tempo até 13/11. A estimativa de duração entra no plano de testes (F4).

## Base técnica
- Repositório clonado em `C:\dev\h3-estudo` (fora do OneDrive), commit `f0e17808ac2439b6434bb10609a961067f4d555b` (v2.0.8, 22/10/2026).
- Conferido nesse commit: nenhuma das três features existe. A busca por `content-range`, `accept-ranges`, `problem+json`, `9457` e `extraUnseal` em `src/` e `docs/` não achou nada, e as 3 issues continuam abertas.
- Estilo dos testes do h3: `describeMatrix` (roda em "web" e "node"), `t.fetch`, `t.app`, vitest. O gabarito usa o mesmo estilo e roda nos dois alvos.
- Conferência de contaminação ainda pendente: ver se existe PR aberto ou branch de upstream com essas features (F3.3).

## #1267 HTTP Range no `serveStatic` (norma: RFC 7233; contrato dado pela própria issue)
Contrato já definido na issue, então não depende de decisão nova: `Accept-Ranges: bytes` sempre; só 1 intervalo; multi-range ou intervalo malformado ignorado (resposta 200 completa); 206 com `Content-Range` e `Content-Length`; 416 com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`; HEAD só com cabeçalhos; sem novas exportações públicas.

Dados do mock existente: `/test.png` → conteúdo `asset:/test.png` (15 bytes); com `accept-encoding: gzip` → `asset:/test.png.gz` (18 bytes).

| # | Teste | Esperado |
|---|---|---|
| R1 | GET `/test.png` sem Range | 200, corpo inteiro, `accept-ranges: bytes` |
| R2 | `Range: bytes=0-4` | 206, corpo `asset`, `content-range: bytes 0-4/15`, `content-length: 5` |
| R3 | `Range: bytes=10-` | 206, corpo `t.png`, `content-range: bytes 10-14/15` |
| R4 | `Range: bytes=-3` (sufixo) | 206, corpo `png`, `content-range: bytes 12-14/15` |
| R5 | `Range: bytes=10-99` (fim além do tamanho) | 206, intervalo limitado ao fim: `bytes 10-14/15` |
| R6 | `Range: bytes=15-20` | 416, `content-range: bytes */15`, `content-length: 0` |
| R7 | `Range: bytes=0-1,3-4` (multi-range) | 200, corpo inteiro |
| R8 | `Range: abc` e `Range: bytes=5-2` (malformados) | 200, corpo inteiro |
| R9 | HEAD com `Range: bytes=0-4` | 206, corpo vazio, `content-length: 5` |
| R10 | Range com `accept-encoding: gzip` | intervalo vale para a representação enviada: `bytes 0-4/18` |
| R11 | Mantém `etag`, `last-modified`, `cache-control` e `vary` na 206 | iguais aos da 200 |
| R12 | Asset inexistente com Range | 404 como antes; método POST continua 405 |
| R13 | Nenhuma exportação pública nova em `src/index.ts` | lista de exports igual à do commit base |
| R14 | `If-Range` com etag igual ao do asset e `Range: bytes=0-4` | 206 com o intervalo |
| R15 | `If-Range` com etag diferente e `Range: bytes=0-4` | 200 com o corpo inteiro (a norma manda ignorar o Range) |

Perguntas para o autor: (a) R10 e R11 refletem o que você quer (a norma manda o intervalo valer para a representação escolhida), ou prefere ficar só com R1 a R9? (b) `If-Range` fica fora de escopo?

## #1384 RFC 9457 (problem JSON)
A issue tem uma frase e **não define contrato**. Sem contrato os testes não podem existir, e o enunciado dado aos modelos precisa carregar a mesma decisão. **Decisão do autor necessária** (opções abaixo). Os testes abaixo valem para qualquer opção marcada, e só R-nomes mudam de gatilho.

Opções de contrato:
- **A (Recomendada):** opt-in por configuração do app, por exemplo `new H3({ problemDetails: true })`. Mantém compatibilidade, que é o padrão do projeto.
- **B:** comportamento padrão para todos os erros. Quebra quem lê o formato atual.
- **C:** utilitário explícito que o handler chama, por exemplo `throw problem(...)`. Não mexe nos erros existentes.

| # | Teste (com o contrato escolhido ativo) | Esperado |
|---|---|---|
| P1 | Erro 404 de rota inexistente | `content-type: application/problem+json`, corpo com `status: 404`, `title` e `type` |
| P2 | `throw new HTTPError({ status: 422, statusText: "Unprocessable", data: {...} })` | `status: 422`, `title: "Unprocessable"`, `detail` quando houver mensagem |
| P3 | `type` ausente | `"about:blank"` (valor padrão da RFC 9457, seção 4.2.1) |
| P4 | `instance` | URI de referência da ocorrência, quando o app define |
| P5 | Membros de extensão | `data` do erro aparece como membros extras no mesmo nível, sem sobrescrever `type`, `title`, `status`, `detail`, `instance` |
| P6 | `status` do corpo igual ao status HTTP | sempre |
| P7 | Cabeçalhos de erro (`errHeaders`, `set-cookie`) | preservados como hoje |
| P8 | HEAD | sem corpo e sem `content-length`, como hoje |
| P9 | Com o contrato desativado | formato atual intacto (`application/json;charset=UTF-8`) |
| P10 | `debug: true` | **observação, não aprovação**: registrar se o `stack` aparece no corpo e em qual membro |
| P11 | Variante B: erros que o app já lança com o formato atual | todos saem como problem+json sem mudar o código do handler |
| P12 | Variante C: utilitário explícito chamado pelo handler | só as respostas que o chamam saem como problem+json; os demais erros ficam como hoje |

Perguntas para o autor: (a) A, B ou C? (b) P10: o stack em modo debug deve aparecer ou ficar fora do formato problem+json?

## #1050 Várias senhas de unseal em sessões
Contrato em aberto na issue. **Você disse que a decisão é sua e ainda não escolheu.** Opções: **(a)** `password` aceita lista de strings, primeira sela, todas abrem; **(b)** campo novo `extraUnsealPasswords` com `password` continuando a selar.

| # | Teste | Esperado |
|---|---|---|
| S1 | Sessão selada com a senha antiga, config nova com a antiga entre as de unseal | sessão lida com sucesso, dados preservados |
| S2 | Sessão nova | selada sempre com a senha principal (a primeira) |
| S3 | Sessão lida com senha antiga | re-selada com a principal no próximo `Set-Cookie` (rotação progressiva) |
| S4 | Sessão selada com senha fora da lista | tratada como sessão inexistente (nova), sem erro 500 |
| S5 | Lista vazia ou senha curta demais | erro claro, como a validação atual de senha |
| S6 | Sem `extraUnsealPasswords`/lista de uma só senha | comportamento atual intacto |
| S7 | Ordem de tentativa | principal primeiro; se falhar, as extras na ordem dada |
| S8 | `getSession`, `updateSession` e `clearSession` | funcionam com sessão aberta por senha antiga |
| S9 | Sessão em chunks e sessão por cabeçalho | também aceitas com senha antiga |
| S10 | Compatibilidade com sessões legadas (`iterations: 1`) | segue funcionando com o fallback atual |

Pergunta para o autor: S3 (re-selar com a senha nova ao ler com a antiga) entra no contrato ou fica de fora?

## Regras de uso do gabarito
1. Testes escritos e aprovados antes da primeira execução de qualquer braço.
2. Cada teste deve passar numa implementação de referência escrita por mim, e falhar no commit base. Isso prova que o teste mede a feature (a implementação de referência nunca é mostrada aos modelos).
3. O enunciado de cada feature descreve o contrato, nunca os valores esperados dos testes.
4. Aprovação do autor registrada por teste; mudança depois do pré-registro é adendo datado.
