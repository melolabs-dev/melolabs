# Contrato #1384-B: problem details (RFC 9457) como formato padrão de erro

## Objetivo
Trocar o formato padrão das respostas de erro do h3 pelo formato "problem details" da RFC 9457 (`application/problem+json`), **para todos os erros e sem nenhuma configuração**. É uma mudança de comportamento padrão: o formato JSON de erro atual deixa de ser emitido.

## API pública
- Nenhuma opção nova de configuração.
- `HTTPError` passa a aceitar, no objeto de entrada do construtor, dois campos opcionais de texto: `type` e `instance`. Eles ficam expostos como propriedades somente leitura de mesmo nome na instância.

## Comportamento
Todo erro que o h3 transforma em resposta (`HTTPError` lançado ou retornado pelo handler, `Error` não tratado, número lançado, rota inexistente, erros dos utilitários do h3), sem mudar o código dos handlers, sai assim:

1. Cabeçalho `content-type` com o media type `application/problem+json`.
2. Corpo JSON com os membros da RFC 9457:
   - `status`: sempre igual ao status HTTP da resposta.
   - `title`: o `statusText` do erro; se o erro não tiver `statusText`, a frase padrão (reason phrase) do status HTTP, conforme a RFC 9110.
   - `type`: o `type` do erro; quando ausente, o valor padrão definido na RFC 9457, seção 4.2.1.
   - `detail`: a mensagem (`message`) do erro, quando o erro tem mensagem própria.
   - `instance`: o `instance` do erro, quando definido; omitido quando não definido.
3. Membros de extensão: se `data` do erro for um objeto, cada chave dele vira um membro no nível raiz do corpo. Uma chave de `data` nunca sobrescreve `type`, `title`, `status`, `detail` ou `instance`.
4. Os membros `statusText` e `message` do formato antigo não são repetidos no corpo (o conteúdo deles passa a sair em `title` e `detail`).
5. Erros não tratados continuam sem expor mensagem ou dados internos, como hoje.
6. Cabeçalhos de erro continuam preservados como hoje: os `headers` do `HTTPError`, os cabeçalhos preparados em `event.res.errHeaders` (inclusive `set-cookie`, sem duplicar) e a regra de não vazar cabeçalhos de sucesso em respostas de erro.
7. Requisições `HEAD` continuam sem corpo e sem `content-length`, mas com os mesmos cabeçalhos de uma resposta `GET` (inclusive o `content-type` acima).
8. O hook `onError` continua funcionando como hoje. Uma `Response` retornada pelo `onError` não é alterada.
9. Em modo `debug`, o que fazer com o stack trace fica a critério da implementação.

## Fora do escopo
Opção para voltar ao formato antigo, negociação de conteúdo pelo cabeçalho `Accept`, formato XML (`application/problem+xml`) e mudanças em respostas que não são de erro.

## Critério geral
A suíte de testes existente do repositório deve continuar passando. Os testes existentes que verificam o formato antigo de erro devem ser atualizados para o novo formato, sem perder o que eles verificam.
