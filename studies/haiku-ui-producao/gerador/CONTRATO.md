# Contrato de uma família de telas (estudo 3b)

Cada família é um módulo `gerador/familias/<id>.mjs` mais um teste `gerador/familias/<id>.teste.mjs`. A ideia central: **a tela é gerada a partir de um conjunto de regras que ela deve cumprir ou violar**. O gabarito vem da construção, e um verificador independente (navegador real) confere.

## Exportações obrigatórias de `<id>.mjs`
```js
export const ID = 'painel';
export const TITULO = 'Painel de dados';
export const REGRAS = ['TD01', ...];          // 20 a 30 ids de lake/lake-ref-v2.json, só com elegivel=true e checavel_por_codigo=true
export function variante(seed) {...}          // conteúdo aleatório determinístico: tema (logística, finanças, saúde, RH, varejo, educação), nomes, colunas, linhas, rótulos em pt-BR
export function construir(variante, violar) {...}   // violar: Set de ids de REGRAS. Retorna HTML completo (<!doctype html>), AUTOCONTIDO (sem recurso externo, JS inline pequeno só se necessário)
export async function checar(pagina) {...}    // pagina: Playwright Page já com o HTML aberto; devolve { [id]: { ok: boolean, nota: string } } para TODAS as REGRAS
export function ruido(html, seed) {...}       // mudanças SEM efeito para o usuário (ordem de atributos, nomes de classe, comentários, espaços, valores CSS equivalentes); retorna HTML
```
Opcional: `export const BRIEFINGS = [...]` (veja T4, definido depois).

## Requisitos da tela
- Tela GRANDE e realista de produção: de 300 a 1.200 linhas de HTML+CSS, com tokens CSS (`:root{--...}`), componentes repetidos, vários estados visíveis quando fizer sentido (vazio, erro, carregando, parcial), dados plausíveis em pt-BR. Sem lorem ipsum.
- Cumpre TODAS as regras de `REGRAS` quando `violar` é vazio. Cada regra em `violar` deve produzir o defeito **de forma natural** (como um desenvolvedor descuidado faria), sem quebrar o restante da tela e sem violar outras regras por acidente.
- `construir` é determinístico: mesma variante e mesmo `violar` geram o mesmo HTML.
- Estética não importa. Não use imagens externas, fontes externas nem CDN.
- As regras vêm do campo `regra_final` do lake (use esse texto, não `regra`). Respeite a fonte e a intenção da regra.

## Independência do verificador
`checar` NÃO pode ler a variante nem o conjunto `violar`; só enxerga a página renderizada (DOM, estilos computados, geometria, e o axe-core via `navegador().axe()` de `comum.mjs` quando a regra tem `axe_rule`). Ele pode usar viewports diferentes (`pagina.setViewportSize`) para regras de mobile/reflow.

## Teste de autoconsistência (`<id>.teste.mjs`)
Para 15 sementes: (1) com `violar` vazio, todas as regras devem dar ok; (2) para cada regra, `violar={regra}` deve dar `ok=false` nessa regra e `ok=true` nas demais; (3) com 5 regras sorteadas violadas juntas, exatamente essas 5 falham. Imprima a concordância total e os casos que falharam. Meta: ≥ 97% de concordância; regra que não chegar lá depois de ajustes é REMOVIDA de `REGRAS` (e listada em `gerador/familias/<id>.removidas.json` com o motivo). `ruido` não pode alterar o resultado de nenhum `checar`.

## Como rodar
`node gerador/familias/<id>.teste.mjs` a partir de `studies/haiku-ui-producao`. Use `import { navegador, rng, pick, embaralhar, REGRA } from '../comum.mjs'`.
