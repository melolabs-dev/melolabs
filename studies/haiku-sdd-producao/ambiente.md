# Ambiente de execução

> Rascunho de 05/11/2026, escrito a partir do que foi medido na máquina. Os itens marcados "a confirmar" só se fecham durante o piloto (F3.2).

- **Hardware:** Intel Core i7-12700H (14 núcleos, 20 threads), 15,6 GB de RAM, 119 GB livres no disco C:.
- **Sistema operacional:** Windows 11 Home Single Language, versão 10.0.26200.
- **Versões fixadas:**
  - Node v24.18.0, pnpm 11.24.0, git 2.49.0.
  - Repositório alvo h3 (h3js/h3, MIT) no commit `f0e17808ac2439b6434bb10609a961067f4d555b` (v2.0.8, 22/10/2026), com dependências do `pnpm-lock.yaml` do próprio repositório (typescript 7.0.2, vitest 5.0.5, vite 8.3.4).
  - Modelos: Haiku 5.5, Sonnet 5.5 e Opus 5.5, chamados pelos apelidos `haiku`, `sonnet` e `opus` do Claude Code. **A confirmar:** o identificador exato que cada apelido resolve em cada execução; o piloto registra o que o próprio agente informa e o que a ferramenta mostra, e o artigo declara que a versão veio dos apelidos.
  - Claude Code desktop com a assinatura do autor (sem chave de API), versão a registrar no início da coleta.
- **Lockfile ou container:** `pnpm-lock.yaml` do h3, instalado com `pnpm install --frozen-lockfile`. Cada execução usa uma cópia limpa do commit base (git worktree em `C:\dev\h3-run-<id>`), sem os testes ocultos. Não há container; a tolerância está abaixo.
- **Rede, região e custo:**
  - Execuções feitas por subagentes do Claude Code sob a assinatura do autor, sem teto de gasto (decisão de 05/11/2026).
  - O harness informa tokens totais, número de chamadas de ferramenta e duração por agente. **Não informa entrada, saída e cache separados.** O custo em dólar é uma estimativa por proporção declarada (a mesma de 80% de entrada e 20% de saída usada nos estudos anteriores) com a tabela de preços de 04/11/2026, e isso limita as hipóteses H6, H8 e H10 (ver `plano-de-testes.md`).
  - Os limites de uso da assinatura e a carga do serviço variam durante o dia e não são controláveis.
- **O que pode variar entre máquinas e a tolerância aceita:**
  - Tempo de relógio: varia com a carga da máquina e do serviço; por isso o tempo é reportado como mediana e dispersão, e não como valor único.
  - Fins de linha: o clone usa `core.autocrlf=true` e o `oxfmt --check` global falha por CRLF mesmo no commit base; o critério de lint das execuções usa só os arquivos tocados e `tsc`, não o `oxfmt` global.
  - A saída dos modelos não é determinística; a variação entre repetições é medida, não eliminada.
