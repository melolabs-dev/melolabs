# Instrumento de consistência e hierarquia visual por código (critérios fixados ANTES de calcular)

Medidas em Chrome (390x844) sobre o DOM renderizado, cada uma em [0,1], 1 = melhor. Nota = média simples (sem pesos, sem ajuste depois).
 1. alvo: min(1, menor altura entre botão principal e campos / 44)                     (Material 3, alvo de 48 dp; WCAG 2.5.8)
 2. fonte: min(1, menor fonte entre rótulos, campos e botão / 16)                      (web.dev, sign-in form)
 3. contraste_texto: min(1, menor razão de contraste de rótulos e links / 4,5)         (WCAG 1.4.3)
 4. contraste_botao: min(1, razão de contraste do texto do botão / 4,5)                (WCAG 1.4.3)
 5. contraste_borda: min(1, razão de contraste da borda do campo com o fundo / 3)      (WCAG 1.4.11)
 6. alinhamento: 1 - min(1, desvio-padrão do x esquerdo de título, rótulos, campos e botão / 8 px)   (Material 3, layout)
 7. ritmo: 1 - min(1, coeficiente de variação das distâncias verticais entre blocos consecutivos)   (Material 3, grade de 4/8 dp)
 8. hierarquia: min(1, razão fonte do título / fonte do corpo / 1,5)                   (Material 3, escala tipográfica)
 9. largura: 1 - min(1, |largura do campo - largura do botão| / 16 px)                 (Material 3, consistência de componentes)
10. raio: 1 - min(1, |raio do campo - raio do botão| / 8 px)                           (Material 3, consistência de componentes)

Validação (mesma do UIClip, mesmos limites): Teste A >= 12/15 defeitos visuais piores que a referência; Teste B >= 4/5 séries com rho <= -0,8.
Limite declarado: o instrumento codifica legibilidade, alvo, alinhamento, ritmo e consistência. Não mede beleza. Como ele codifica o que os defeitos
injetados violam, a validade de construção é em parte circular; por isso só vale para o que as regras dizem e não se estende a "gosto".
