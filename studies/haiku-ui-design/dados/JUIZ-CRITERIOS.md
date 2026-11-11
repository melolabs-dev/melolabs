# Critérios do juiz Fable (fixados em 10/11/2026 antes de calcular qualquer acurácia)
Validação: pares do WiserUI-Bench (rótulo = vencedora do teste A/B real), uma ordem pseudo-aleatória por par; 100 pares repetidos com A e B trocados.
O juiz só entra na decisão se TODOS valerem:
 1. Acurácia nos pares (primeira ordem) >= 60%.
 2. Limite inferior do IC 95% (Wilson) da acurácia > 50%.
 3. Consistência de posição nos 100 pares repetidos (mesmo vencedor nas duas ordens) >= 70%.
 4. Acurácia nos pares da primeira ordem em que a resposta foi "A" e "B" sem viés extremo: nenhuma das duas letras passa de 65% das respostas.
Referência da literatura: acordo médio entre designers no DesignPref = 62,4%; melhores juízes de IA ficam perto de 55 a 60% contra um designer. Por isso o limiar de 60% já é exigente.
Limite declarado: o rótulo mede qual interface induz mais ações (conversão), não beleza; e o Fable pode ter visto o WiserUI-Bench no treino, o que inflaria a acurácia.
Se não passar, o juiz fica exploratório e não entra na decisão.
