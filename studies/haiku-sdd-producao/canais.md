# Textos para os canais (rascunho para aprovação do autor; nada foi postado)

URLs canônicas previstas (o site ainda precisa ser publicado em melolabs.net):
- Técnico: https://melolabs.net/pt/haiku-sdd-producao/ e https://melolabs.net/en/haiku-sdd-producao/
- Guia: https://melolabs.net/pt/haiku-sdd-guia/ e https://melolabs.net/en/haiku-sdd-guia/

## DEV e Hashnode
Posta o artigo completo (o mesmo texto do site), com `canonical_url` apontando para o blog, imagens com URL absoluta em PNG, e a nota "Os experimentos, os dados e as conclusões são meus. A redação foi assistida por IA e revisada por mim."
- Tags DEV (máx. 4): técnico `sdd, haiku, sonnet, custo`; guia `sdd, haiku, guia, custo`.
- Hashnode (máx. 5): as mesmas tags do frontmatter.

## LinkedIn

### Técnico (pt)
Medi o Haiku 5.5 contra o Sonnet 5.5 em desenvolvimento guiado por especificação (PRD, especificação técnica, tarefas e código): 198 execuções isoladas, hipóteses pré-registradas, juízes cegos.

O que apareceu:
• Cerca de 1/5 do custo de lista do Sonnet (0,18).
• TechSpec e Tasks com notas praticamente iguais, pelo que a rubrica mede.
• Código: 72% contra 91% no núcleo de testes. Mas 12 das 15 falhas do Haiku são um único teste; sem ele, 94% contra 91%. Por tarefa, o intervalo inclui zero.

Nenhuma hipótese ficou "confirmada", e o texto diz o que não dá para concluir. Uma revisão adversarial independente refez as contas, achou os números certos e várias leituras exageradas; elas estão corrigidas.

Dados, código e prompts abertos. Artigo completo: https://melolabs.net/pt/haiku-sdd-producao/

### Technical (en)
I measured Haiku 5.5 against Sonnet 5.5 on spec-driven development (PRD, technical spec, tasks and code): 198 isolated runs, pre-registered hypotheses, blind judges.

What came out:
• About 1/5 of Sonnet's list cost (0.18).
• TechSpec and Tasks scores practically tied, as far as the rubric measures.
• Code: 72% vs 91% on the core tests. But 12 of Haiku's 15 failures are a single test; without it, 94% vs 91%. By task, the interval includes zero.

No hypothesis came out "confirmed", and the text says what cannot be concluded. An independent adversarial review recomputed the numbers, found them right and several readings overstated; those are corrected.

Open data, code and prompts. Full article: https://melolabs.net/en/haiku-sdd-producao/

### Guia simples (pt)
Quer usar o Haiku no dia a dia do SDD sem gastar à toa? Escrevi uma versão simples do meu estudo, para quem está começando.

A receita que funcionou melhor: pedido claro com nomes exatos, o Haiku escreve os documentos, checagem automática, testes primeiro, loop de correção com a saída real dos comandos e uma pessoa revisando. Sai por cerca de 1/5 do custo do Sonnet. No código ele ainda falha mais em algumas tarefas, e o texto diz o que não está provado.

Tem figuras e um checklist para começar amanhã: https://melolabs.net/pt/haiku-sdd-guia/

### Plain guide (en)
Want to use Haiku in everyday SDD without overspending? I wrote a plain version of my study for people just starting out.

The recipe that worked best: a clear request with exact names, Haiku writes the documents, automatic checks, tests first, a correction loop with real command output, and a person reviewing. It costs about 1/5 of Sonnet. On code it still fails more on some tasks, and the text says what is not proven.

It has figures and a checklist to start tomorrow: https://melolabs.net/en/haiku-sdd-guia/
