# Contrato enxuto: HTTP Range no `serveStatic` (h3js/h3#1267)

## Objetivo
Fazer o utilitário `serveStatic` (`src/utils/static.ts`) atender pedidos de intervalo de bytes, para permitir retomar downloads e avançar em vídeo e áudio servidos pelo h3, como pede a issue h3js/h3#1267.

## Norma
RFC 9110 (HTTP Semantics), seções 13.1.5 (If-Range) e 14 (Range Requests), que substituem a RFC 7233 citada na issue. Siga a issue e a norma.

## Nomes públicos
- A mudança fica dentro de `serveStatic`, usando as opções que ele já recebe (`ServeStaticOptions`); o tamanho do asset é o `size` devolvido por `getMeta`.

## Restrições
- Nenhuma exportação pública nova: `src/index.ts` não ganha nomes (nem valores nem tipos) e as funções auxiliares ficam privadas no módulo.
- Não quebrar o que já existe: cache, seleção de encoding, `fallthrough` e as respostas para asset inexistente e para método não permitido continuam como hoje.
- A suíte existente continua passando; ajuste só os testes existentes que dependem do que a sua mudança altera, sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.
