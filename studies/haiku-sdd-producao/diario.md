# Diário de execução

Dados brutos nunca são editados. Cada entrada traz data, o que aconteceu, o desvio do plano (se houve) e a decisão. Ambiente completo em `ambiente.md`.

## Ambiente da coleta principal
- Máquina: Windows 11 Home, uma execução por vez, esperando pelo menos 3 GB de memória livre entre etapas (memória livre típica de 4 GB).
- Ferramenta: `claude -p` (Claude Code CLI), modelos efetivos registrados por execução: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` (juízes). Assinatura do autor, sem chave de API.
- Projeto-alvo: h3 no commit `f0e17808ac2439b6434bb10609a961067f4d555b`; pasta de execução com nome opaco em `C:\dev\runs`, exportação sem `.git` do projeto e sem remoto.
- Coleta principal: início em 06/11/2026 (madrugada) e fim em 06/11/2026 (conferida às 20h02, com 138 de 138); 138 execuções, sem falha de infraestrutura, sem nova tentativa de etapa. Juízes: 396 julgamentos, de 06/11 à noite a 07/11/2026.

## Linha do tempo e desvios
- **04/11:** estudo criado, premissa e hipóteses H1 a H6.
- **05/11:** H11 (persona e contexto) acrescentada a pedido do autor; 35 fontes verificadas; plano de análise aprovado; piloto de 12 execuções; pré-registro com a tag `prereg-haiku-sdd-producao`.
- **05/11 a 06/11 (desvio 1, revisão adversarial):** revisão independente achou 7 itens bloqueantes. Conferidos e tratados no adendo 1 (tag `prereg-haiku-sdd-producao-adendo1`), antes de qualquer dado da coleta principal. Retiradas as afirmações do piloto sobre auditoria de vazamento e sobre tokens (a contagem não era consumo; as transcrições estavam vazias).
- **06/11 (desvio 2):** o teste `test/unit/cli.test.ts` do h3 abre abas do navegador no Windows (cerca de 189 abas, Chrome com 8 GB) e foi removido das execuções, no projeto-alvo e nos juízes. Registrado no adendo e no ambiente.
- **06/11 (desvio 3):** falso positivo da auditoria no mini-piloto, porque o nome da pasta carregava a variante. Corrigido antes da coleta com pastas de nome opaco.
- **06/11:** mini-piloto de 8 execuções com o contrato enxuto: todas 100% do núcleo; deu base ao tamanho de amostra de rubrica.
- **06/11 (desvio 4, escopo):** o autor adiou a fase C (H2, H7, H8, H9 e braços S8 a S11) para um paper futuro. Essas hipóteses saem "não testadas". Nota no adendo 1.
- **06/11:** coleta principal em fila; os 138 itens do plano concluídos na ordem sorteada (semente 20261105).
- **06/11 à noite e 07/11:** avaliação cega, 396 julgamentos Opus de 132 artefatos (TechSpec e Tasks de #1267 e #1050-b, repetições 1 a 3). Um julgamento deu JSON inválido na primeira tentativa e foi refeito (1 erro registrado, 0 duplicados).
- **07/11 (resultado que muda uma expectativa):** a H4 não saturou na coleta completa, ao contrário do mini-piloto, porque as variantes #1384-a e #1384-c ainda não tinham entrado. Resultado reportado como está.
- **07/11 (desvio 5, estatística):** o alfa de Krippendorff dos juízes ficou em 0,62, abaixo do mínimo de 0,67 do plano. Pela regra pré-registrada, as hipóteses de rubrica ficam `subpotente`, não confirmadas.
- **07/11 (atenção):** a auditoria marcou 1 execução como suspeita (`C2n-session-1050-b-r1`): edições do próprio agente em arquivos de teste com nome parecido com o do gabarito. Pelo plano, fica na análise principal e sai na análise ao lado.

## Limites que seguem declarados
Orquestrador e autor dos testes são a mesma sessão; os três juízes são o mesmo modelo; os estilos do Haiku e do Sonnet são reconhecíveis; o histórico git ainda contém versões antigas dos testes ocultos em texto claro; a cascata (C5) nunca escalou para o Sonnet; H3 e o escalonamento da H5 ficam não testáveis neste desenho (reprovação no primeiro gate de 1,2%, limite de 10%).
