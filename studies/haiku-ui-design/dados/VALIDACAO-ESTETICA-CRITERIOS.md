# Validação do instrumento de estética (critérios fixados ANTES de calcular qualquer nota)

Instrumento: UIClip (biglab/uiclip_jitteredwebsites-2-224-paraphrased), nota = probabilidade de "well-designed" vs "poor design", descrição fixa
"login screen with email field, password field and sign in button". Telas renderizadas em Chrome, viewport 390x844, escala 1.
Medidas de apoio (só reportadas, não decidem): colorido (Hasler-Süsstrunk), densidade de bordas (Sobel).

Teste A (degradação conhecida): tela de referência vs cada defeito visualmente observável (D01 sem rótulos, D02 botão claro, D03 rótulo claro,
D04 borda fraca, D05 botão baixo, D06 fonte 12 px, D10 sem link, D14 cartão fixo de 480 px, D15 dois h1, D17 line-height 1, D18 raios diferentes,
D19 espaço 13 px, D20 ordem trocada, D24 sem mostrar senha, D25 link sem sublinhado). 15 defeitos.
  Válido se a nota da referência é maior que a do defeito em >= 12 dos 15 (p binomial = 0,018).
Teste B (sensibilidade graduada): 5 séries de 5 níveis de degradação (contraste do rótulo, contraste do botão, fonte dos campos, espaço entre campos, altura do botão).
  Válido se |rho de Spearman| >= 0,8 com sinal de queda da nota em >= 4 das 5 séries.
Decisão: o instrumento só entra na decisão se passar A e B. Se falhar em qualquer um, a estética fica exploratória, sem peso na conclusão.
Nada neste teste usa rótulo humano publicado nem passa por modelo da família Claude.

## Registro de tentativas (acrescentado depois de ver o resultado da tentativa 1)
Tentativa 1 (captura da tela inteira de 390x844): A = 9/15 (p = 0,30), B = 2/5 (uma série com rho exatamente -0,8 conta; o 1/5 inicial vinha de arredondamento de ponto flutuante). NÃO VÁLIDO pelos critérios acima.
Hipótese para a falha: ~40% da captura é fundo vazio, e o UIClip reduz a imagem a 224 px de largura com janelas deslizantes. Tentativa 2, única e declarada: mesma tela cortada na altura do conteúdo (cartão + 32 px). Critérios idênticos (A >= 12/15, B >= 4/5). Duas tentativas: o resultado da 2 vale como válido só se passar nos mesmos limites, e as duas são reportadas. Sem terceira tentativa.

Resultado da tentativa 2: A = 8/15 (p = 0,50), B = 2/5. NÃO VÁLIDO.
