# Rastreio dos testes contra o contrato enxuto

> Documento do autor, nunca entregue aos modelos (cita testes e valores). Rascunho de 05/11/2026.

## Critério
Cada linha pergunta: um bom engenheiro que lê só o contrato enxuto (`<variante>.contrato.md` nesta pasta), a issue original e a norma citada chega a esse comportamento sem adivinhar?

- **sim**: o comportamento sai da issue, da norma citada ou da regra "não quebrar o que já existe" (o comportamento atual do h3), sem escolha de projeto.
- **parcial**: há mais de uma leitura razoável, ou a issue e a norma apontam para lados diferentes.
- **não**: o teste fixa uma decisão de projeto que nem o contrato, nem a issue, nem a norma fixam.

Um teste com várias asserções recebe a classificação da asserção mais fraca. Testes já marcados como observação nos arquivos (O1, P10, O2 a O4) aparecem com "(obs.)" e entram nas contagens, mas não nas recomendações.

## range-1267 (norma citada: RFC 9110, seção 14)

| variante | arquivo | teste | determinado? | motivo |
|---|---|---|---|---|
| range-1267 | range-1267.test.ts | R1 | sim | A issue manda sempre anunciar `Accept-Ranges: bytes`; corpo e `Content-Length` completos são o comportamento atual. |
| range-1267 | range-1267.test.ts | R2 | sim | Intervalo `a-b` com 206, `Content-Range` e `Content-Length` vem da issue e de RFC 9110 14.1.2/14.4. |
| range-1267 | range-1267.test.ts | R3 | sim | Forma aberta `a-` até o fim está definida em RFC 9110 14.1.1. |
| range-1267 | range-1267.test.ts | R4 | sim | Forma de sufixo está definida em RFC 9110 14.1.1. |
| range-1267 | range-1267.test.ts | R5 | sim | RFC 9110 14.1.1 manda limitar o fim ao último byte quando passa do tamanho. |
| range-1267 | range-1267.test.ts | R6 | sim | Início no tamanho ou além é não satisfazível (RFC 9110 14.1.1) e a issue fixa 416, `bytes */size` e `Content-Length: 0`. |
| range-1267 | range-1267.test.ts | R7 | sim | A issue manda ignorar multi-range e servir a resposta completa. |
| range-1267 | range-1267.test.ts | R8 | sim | A issue manda ignorar Range malformado; unidade desconhecida e fim menor que o início são inválidos pela RFC 9110 14.1.1. |
| range-1267 | range-1267.test.ts | R9 | parcial | A issue pede só cabeçalhos em HEAD (lido como 206), mas RFC 9110 14.2 diz que o servidor DEVE ignorar Range em métodos diferentes de GET, o que leva a 200. |
| range-1267 | range-1267.test.ts | R10 | sim | O intervalo se aplica à representação selecionada (RFC 9110 14.1) e `serveStatic` já busca o `size` da variante comprimida escolhida. |
| range-1267 | range-1267.test.ts | R11 | sim | A issue manda preservar o cache e o contrato diz "não quebrar"; manter os cabeçalhos na 206 também é RFC 9110 15.3.7. |
| range-1267 | range-1267.test.ts | R12 | sim | A issue e o contrato mandam preservar as respostas 404 e 405. |
| range-1267 | range-1267.test.ts | R13 | sim | A issue e o contrato proíbem exportação nova e mandam deixar os auxiliares privados. |
| range-1267 | range-1267.test.ts | R14 | sim | Com If-Range igual ao etag, aplicar o Range é o comportamento de quem implementa If-Range e também de quem o ignora. |
| range-1267 | range-1267.test.ts | R15 | parcial | If-Range não está na issue; RFC 9110 14.2 só aponta para a seção 13.1.5, então implementá-lo depende de o engenheiro seguir a referência. |
| range-1267 | range-1267.extras.test.ts | E1 | parcial | Exige implementar If-Range com comparação forte (RFC 9110 13.1.5), que fica fora da seção citada; quem não implementa If-Range responde 206 e falha. |
| range-1267 | range-1267.extras.test.ts | E2 | não | A forma de data do If-Range e a regra de validador forte (RFC 9110 13.1.5 e 8.8.2.2) não aparecem na issue nem na seção citada. |
| range-1267 | range-1267.extras.test.ts | E3 | não | Tamanho desconhecido sai da issue ("quando o tamanho é conhecido"), mas tamanho zero contraria a leitura literal da RFC 9110 14.1.1 (416 para `0-4`, sufixo satisfazível) e exige a decisão de ignorar. |
| range-1267 | range-1267.extras.test.ts | E4 | parcial | "Sempre anunciar" pode ou não incluir 304 e 416; a RFC 9110 14.3 só diz que o servidor PODE enviar `Accept-Ranges` em qualquer resposta. |
| range-1267 | range-1267.extras.test.ts | E5 | sim | Forma aberta com início no tamanho ou além é não satisfazível pela RFC 9110 14.1.1, e a issue fixa o 416. |
| range-1267 | range-1267.extras.test.ts | O1 (obs.) | parcial | É o mesmo conflito do R9 (issue contra RFC 9110 14.2), já tratado como observação. |

## problem-1384-a (norma citada: RFC 9457; gatilho: `problemDetails`)

| variante | arquivo | teste | determinado? | motivo |
|---|---|---|---|---|
| problem-1384-a | problem-1384-a.test.ts | P1 | sim | Com a opção ligada, todo erro sai em `application/problem+json` com `status`, `type` e o `title` da frase do status (RFC 9457 3.1 e 4.2.1). |
| problem-1384-a | problem-1384-a.test.ts | P2 | parcial | Ligar `message` a `detail` é natural, mas `title` igual ao `statusText` customizado choca com RFC 9457 4.2.1, que recomenda a frase padrão do status quando `type` é `about:blank`. |
| problem-1384-a | problem-1384-a.test.ts | P3 | sim | O padrão `about:blank` é RFC 9457 4.2.1 e o contrato nomeia o campo `type` do `HTTPError`. |
| problem-1384-a | problem-1384-a.test.ts | P4 | sim | O contrato nomeia `instance` e a RFC 9457 3.1.5 define o membro. |
| problem-1384-a | problem-1384-a.test.ts | P5 | não | Achatar as chaves de `data` no nível raiz e dar precedência aos membros padrão é decisão de projeto; aninhar em `data` ou sobrescrever também é compatível com a RFC 9457 3.2. |
| problem-1384-a | problem-1384-a.test.ts | P6 | sim | RFC 9457 3.1.2 pede `status` igual ao status HTTP, e a opção cobre todos os erros, inclusive número lançado e erro não tratado. |
| problem-1384-a | problem-1384-a.test.ts | P7 | sim | Preservar `errHeaders`, os cabeçalhos do erro e o `set-cookie` é o comportamento atual ("não quebrar"). |
| problem-1384-a | problem-1384-a.test.ts | P8 | sim | HEAD sem corpo e com os mesmos cabeçalhos do GET é o comportamento atual e RFC 9110 9.3.2. |
| problem-1384-a | problem-1384-a.test.ts | P9 | sim | Opção ausente ou falsa mantém o formato atual, pelo próprio gatilho. |
| problem-1384-a | problem-1384-a.test.ts | P10 (obs.) | não | O tratamento do stack em `debug` não é fixado por nada, já tratado como observação. |

## problem-1384-b (norma citada: RFC 9457; gatilho: formato padrão)

| variante | arquivo | teste | determinado? | motivo |
|---|---|---|---|---|
| problem-1384-b | problem-1384-b.test.ts | P1 | sim | Igual a A/P1, com o formato sempre ligado. |
| problem-1384-b | problem-1384-b.test.ts | P2 | parcial | Igual a A/P2: `title` do `statusText` customizado contra a recomendação da RFC 9457 4.2.1. |
| problem-1384-b | problem-1384-b.test.ts | P3 | sim | Igual a A/P3. |
| problem-1384-b | problem-1384-b.test.ts | P4 | sim | Igual a A/P4. |
| problem-1384-b | problem-1384-b.test.ts | P5 | não | Igual a A/P5: achatar `data` com precedência dos membros padrão é decisão de projeto. |
| problem-1384-b | problem-1384-b.test.ts | P6 | sim | Igual a A/P6. |
| problem-1384-b | problem-1384-b.test.ts | P7 | sim | Igual a A/P7. |
| problem-1384-b | problem-1384-b.test.ts | P8 | sim | Igual a A/P8. |
| problem-1384-b | problem-1384-b.test.ts | P9 | parcial | Trocar o media type sai do gatilho, mas tirar `statusText` e `message` do corpo é escolha; mantê-los como membros de extensão para compatibilidade também é leitura razoável. |
| problem-1384-b | problem-1384-b.test.ts | P10 (obs.) | não | Igual a A/P10, já tratado como observação. |
| problem-1384-b | problem-1384-b.test.ts | P11 | sim | "Formato padrão de todas as respostas de erro" cobre erro lançado, retornado, assíncrono, número, não tratado, rota inexistente e erro de `readBody`. |

## problem-1384-c (norma citada: RFC 9457; gatilho: `problem()`)

| variante | arquivo | teste | determinado? | motivo |
|---|---|---|---|---|
| problem-1384-c | problem-1384-c.test.ts | P1 | sim | Igual a A/P1, com o erro criado por `problem()`. |
| problem-1384-c | problem-1384-c.test.ts | P2 | parcial | Igual a A/P2: `title` do `statusText` customizado contra a recomendação da RFC 9457 4.2.1. |
| problem-1384-c | problem-1384-c.test.ts | P3 | sim | Igual a A/P3, com `type` na entrada de `problem()`. |
| problem-1384-c | problem-1384-c.test.ts | P4 | sim | Igual a A/P4, com `instance` na entrada de `problem()`. |
| problem-1384-c | problem-1384-c.test.ts | P5 | não | Igual a A/P5: achatar `data` com precedência dos membros padrão é decisão de projeto. |
| problem-1384-c | problem-1384-c.test.ts | P6 | sim | `problem()` devolve `HTTPError`, então herda o status padrão e funciona retornado; `status` igual ao HTTP é RFC 9457 3.1.2. |
| problem-1384-c | problem-1384-c.test.ts | P7 | sim | Igual a A/P7. |
| problem-1384-c | problem-1384-c.test.ts | P8 | sim | Igual a A/P8. |
| problem-1384-c | problem-1384-c.test.ts | P9 | sim | Erros que não vêm de `problem()` mantêm o formato atual, pelo próprio gatilho. |
| problem-1384-c | problem-1384-c.test.ts | P10 (obs.) | não | Igual a A/P10, já tratado como observação. |
| problem-1384-c | problem-1384-c.test.ts | P12 | sim | "Só as respostas que usam o utilitário mudam" fixa os dois lados da tabela de casos. |

## session-1050-a (referência: issue; gatilho: `password: string | string[]`)

| variante | arquivo | teste | determinado? | motivo |
|---|---|---|---|---|
| session-1050-a | session-1050-a.test.ts | S1 | sim | É o objetivo da issue: abrir sessão selada com senha anterior da lista. |
| session-1050-a | session-1050-a.test.ts | S2 | sim | A issue e o contrato dizem que a primeira senha sela. |
| session-1050-a | session-1050-a.test.ts | S3 | não | Re-selar com a senha principal numa requisição só de leitura, com `Set-Cookie`, é decisão de projeto; a issue só pede continuar aceitando. |
| session-1050-a | session-1050-a.test.ts | S4 | sim | Senha fora da lista equivale à senha errada de hoje: sessão nova e vazia ("não quebrar"). |
| session-1050-a | session-1050-a.test.ts | S5 | não | Lista vazia e senha principal curta saem da issue e do comportamento atual, mas falhar ao selar por causa de uma senha antiga curta (que nunca sela) é decisão de projeto. |
| session-1050-a | session-1050-a.test.ts | S6 | sim | Com uma senha só, o comportamento é o atual, como diz o contrato. |
| session-1050-a | session-1050-a.test.ts | S7 | parcial | Tentar a principal primeiro é natural, mas tentar em sequência (e não em paralelo) e sem custo extra é escolha; tentar todas em paralelo também atende à issue. |
| session-1050-a | session-1050-a.test.ts | S8 | sim | Abrir com senha anterior vale para qualquer função que lê a sessão, e gravar usa a principal. |
| session-1050-a | session-1050-a.test.ts | S9 | sim | Cookie em pedaços e cabeçalho de sessão passam pela mesma abertura; não aceitar seria quebrar o que existe. |
| session-1050-a | session-1050-a.test.ts | S10 | parcial | Sessão legada com a senha principal é o comportamento atual, mas aplicar o fallback legado às senhas anteriores é uma escolha que o contrato não fixa. |
| session-1050-a | session-1050-a.extras.test.ts | O2 (obs.) | não | Mesmo ponto do S3 (re-selar na leitura ou só na gravação), já tratado como observação. |
| session-1050-a | session-1050-a.extras.test.ts | O3 (obs.) | não | Mesmo ponto do S5 (senha curta no meio da lista), já tratado como observação. |
| session-1050-a | session-1050-a.extras.test.ts | O4 (obs.) | parcial | Mesmo ponto do S7 (ordem e concorrência), já tratado como observação. |

## session-1050-b (referência: issue; gatilho: `extraUnsealPasswords`)

| variante | arquivo | teste | determinado? | motivo |
|---|---|---|---|---|
| session-1050-b | session-1050-b.test.ts | S1 | sim | É o objetivo da issue: abrir sessão selada com senha de `extraUnsealPasswords`. |
| session-1050-b | session-1050-b.test.ts | S2 | sim | A issue e o contrato dizem que `password` sela. |
| session-1050-b | session-1050-b.test.ts | S3 | não | Igual a a/S3: re-selar na leitura é decisão de projeto. |
| session-1050-b | session-1050-b.test.ts | S4 | sim | Igual a a/S4. |
| session-1050-b | session-1050-b.test.ts | S5 | não | `password` curta é o comportamento atual, mas falhar ao selar por senha extra curta ou vazia é decisão de projeto. |
| session-1050-b | session-1050-b.test.ts | S6 | sim | Sem senhas extras, ou com lista vazia, o comportamento é o atual, como diz o contrato. |
| session-1050-b | session-1050-b.test.ts | S7 | parcial | Igual a a/S7: sequência contra paralelo. |
| session-1050-b | session-1050-b.test.ts | S8 | sim | Igual a a/S8. |
| session-1050-b | session-1050-b.test.ts | S9 | sim | Igual a a/S9. |
| session-1050-b | session-1050-b.test.ts | S10 | parcial | Igual a a/S10: fallback legado para senhas extras não é fixado. |
| session-1050-b | session-1050-b.extras.test.ts | O2 (obs.) | não | Igual a a/O2, já tratado como observação. |
| session-1050-b | session-1050-b.extras.test.ts | O3 (obs.) | não | Igual a a/O3, já tratado como observação. |
| session-1050-b | session-1050-b.extras.test.ts | O4 (obs.) | parcial | Igual a a/O4, já tratado como observação. |

## Contagens por variante

Todas as linhas (inclui as observações já existentes):

| variante | testes | sim | parcial | não |
|---|---|---|---|---|
| range-1267 | 21 | 14 | 5 | 2 |
| problem-1384-a | 10 | 7 | 1 | 2 |
| problem-1384-b | 11 | 7 | 2 | 2 |
| problem-1384-c | 11 | 8 | 1 | 2 |
| session-1050-a | 13 | 6 | 3 | 4 |
| session-1050-b | 13 | 6 | 3 | 4 |
| **total** | **79** | **48** | **15** | **16** |

Só os testes que hoje contam para aprovação (sem O1, P10, O2, O3 e O4):

| variante | testes | sim | parcial | não |
|---|---|---|---|---|
| range-1267 | 20 | 14 | 4 | 2 |
| problem-1384-a | 9 | 7 | 1 | 1 |
| problem-1384-b | 10 | 7 | 2 | 1 |
| problem-1384-c | 10 | 8 | 1 | 1 |
| session-1050-a | 10 | 6 | 2 | 2 |
| session-1050-b | 10 | 6 | 2 | 2 |

## Recomendação: de aprovação para observação

Critério: vai para observação todo teste "não" e todo "parcial" em que uma implementação fiel à issue e à norma citada falha. Fica em aprovação o "parcial" em que a leitura alternativa é improvável ou também passa.

1. **range R9 (parcial, risco alto).** A RFC 9110 14.2 manda ignorar Range fora de GET; quem segue a norma citada responde 200 ao HEAD e falha. O1 já observa isso. Recomendo observação.
2. **range R15 e E1 (parcial).** Só passam se o modelo implementar If-Range, que a issue não cita. Duas saídas: (a) passar para observação; (b) citar no contrato "RFC 9110, seções 13.1.5 e 14", o que torna R15 e E1 "sim" sem enumerar casos. Recomendo (b), por ser citação de norma, não lista de casos; se o autor quiser a citação só da seção 14, então (a).
3. **range E2 e E3 (não).** E2 exige a forma de data do If-Range; E3 exige ignorar Range em asset de tamanho zero, contra a leitura literal da RFC 9110 14.1.1. Observação. Se o autor quiser manter a parte de tamanho desconhecido de E3 (que sai da issue), é preciso dividir o teste.
4. **range E4 (parcial).** "Sempre anunciar" é ambíguo para 304 e 416. Observação.
5. **problem P2, nas três variantes (parcial, risco alto).** Exige `title` igual ao `statusText` customizado, mas a RFC 9457 4.2.1 recomenda a frase padrão do status quando `type` é `about:blank`; quem segue a norma à risca falha. Observação. Atenção: com P2 e P5 fora, nenhum teste aprovado verifica `detail`; se o autor quiser manter isso, convém um teste novo, com `type` definido, que verifique só `detail`.
6. **problem P5, nas três variantes (não).** Achatar `data` na raiz com precedência dos membros padrão é decisão de projeto. Observação.
7. **problem-1384-b P9 (parcial).** A ausência de `statusText` e `message` no corpo é escolha. Observação, ou dividir: o media type fica na aprovação (P11 já o cobre).
8. **session S3, nas duas variantes (não).** Re-selar numa leitura é decisão de projeto. Observação (O2 já observa o mesmo ponto).
9. **session S5, nas duas variantes (não).** A parte de senha principal curta e de lista vazia (a) é determinada; a de senha antiga curta ou vazia não. Observação, ou dividir o teste.
10. **session S7, nas duas variantes (parcial).** Paralelo atende à issue e falha no teste. Observação (O4 já mede a ordem e a concorrência).
11. **session S10, nas duas variantes (parcial).** A primeira metade (legada com a senha principal) é comportamento atual; a segunda (legada com senha anterior) não é fixada. Dividir, ou observação.

Ficam em aprovação, mesmo com a leitura enxuta: todos os "sim", inclusive R10, R11, P7, P8, S8 e S9, que dependem da regra "não quebrar o que já existe" e não de enumeração.

## Efeito na comparabilidade
- Depois das trocas, o núcleo aprovado de #1384 fica: A com P1, P3, P4, P6, P7, P8 e P9 (7); B com P1, P3, P4, P6, P7, P8 e P11 (7, sem P9); C com P1, P3, P4, P6, P7, P8, P9 e P12 (8). A não tem um teste de abrangência como P11 ou P12 (só P6 cobre número lançado e erro não tratado). Igualar as três (dividir B/P9, ou aceitar a diferença) precisa de decisão do autor.
- As duas variantes de #1050 ficam com o mesmo núcleo aprovado (S1, S2, S4, S6, S8, S9), seis testes cada.
- range-1267 fica com R1 a R8, R10 a R14 e E5 (14 testes), ou mais R15 e E1 se o contrato citar a seção 13.1.5.
