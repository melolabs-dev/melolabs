# Contrato #1384-C: problem details (RFC 9457) por utilitário explícito

## Objetivo
Dar ao handler um utilitário que gera erros no formato "problem details" da RFC 9457 (`application/problem+json`). **Só as respostas que usam o utilitário mudam**; todos os outros erros continuam no formato atual.

## API pública
- Nova função `problem(input)`, exportada pelo pacote `h3` (mesmo ponto de entrada de `HTTPError`).
  - `input` aceita os mesmos campos do objeto de entrada de `HTTPError` (`status`, `statusText`, `message`, `data`, `headers`, `cause`...) e mais dois campos opcionais de texto: `type` e `instance`. Exporte também o tipo dessa entrada.
  - Retorna um `HTTPError` (passa em `HTTPError.isError`), com o mesmo status padrão de `HTTPError` quando `status` não é informado.
  - O handler pode lançar (`throw problem(...)`) ou retornar o valor; os dois produzem a mesma resposta, em handlers síncronos ou assíncronos.

## Comportamento das respostas geradas por `problem()`
1. Cabeçalho `content-type` com o media type `application/problem+json`.
2. Corpo JSON com os membros da RFC 9457:
   - `status`: sempre igual ao status HTTP da resposta.
   - `title`: o `statusText` informado; se não houver `statusText`, a frase padrão (reason phrase) do status HTTP, conforme a RFC 9110.
   - `type`: o `type` informado; quando ausente, o valor padrão definido na RFC 9457, seção 4.2.1.
   - `detail`: a mensagem (`message`) informada, quando houver.
   - `instance`: o `instance` informado, quando definido; omitido quando não definido.
3. Membros de extensão: se `data` for um objeto, cada chave dele vira um membro no nível raiz do corpo. Uma chave de `data` nunca sobrescreve `type`, `title`, `status`, `detail` ou `instance`.
4. Os membros `statusText` e `message` do formato antigo não são repetidos no corpo (o conteúdo deles passa a sair em `title` e `detail`).
5. Cabeçalhos de erro preservados como hoje: os `headers` informados, os cabeçalhos preparados em `event.res.errHeaders` (inclusive `set-cookie`, sem duplicar) e a regra de não vazar cabeçalhos de sucesso em respostas de erro.
6. Requisições `HEAD` sem corpo e sem `content-length`, mas com os mesmos cabeçalhos de uma resposta `GET` (inclusive o `content-type` acima).
7. O hook `onError` recebe o erro normalmente. Uma `Response` retornada pelo `onError` não é alterada.
8. Em modo `debug`, o que fazer com o stack trace fica a critério da implementação.

## Todos os outros erros
Erros que não vêm de `problem()` (`HTTPError` comum, `Error` não tratado, número lançado, rota inexistente, erros dos utilitários do h3) ficam exatamente como hoje: mesmo `content-type` e mesmo corpo, inclusive na mesma app que usa `problem()`.

## Fora do escopo
Mudar o formato padrão de erro, opção de configuração global, negociação de conteúdo pelo cabeçalho `Accept` e formato XML (`application/problem+xml`).

## Critério geral
A suíte de testes existente do repositório deve continuar passando.
