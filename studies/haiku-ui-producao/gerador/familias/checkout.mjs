// Familia "checkout" do estudo 3b: endereco de entrega, frete, pagamento com cartao, verificacao, revisao, resumo e confirmacao.
import { rng, pick, embaralhar } from '../comum.mjs';

export const ID = 'checkout';
export const TITULO = 'Finalizar compra (checkout)';
export const REGRAS = ['FC35', 'FC36', 'FC37', 'FC38', 'FC39', 'FC40', 'FC42', 'FC43', 'FC44', 'FC45', 'FC46', 'FC48', 'FC50', 'AM05', 'AM12', 'AM19', 'AM25', 'AM31', 'AM39', 'AM45'];

const TEMAS = [
  { tema: 'logistica', loja: 'TransLog Suprimentos', cor: '#0b5cad', itens: [['Fita adesiva industrial 48mm', 890], ['Caixa de papelao 40x30x30', 540], ['Filme stretch 500mm', 7490], ['Etiqueta termica 100x150', 3290], ['Lacre de seguranca numerado', 1250], ['Pallet plastico PBR', 18900], ['Cinta de arqueamento 16mm', 12400], ['Luva de protecao antiderrapante', 1690], ['Paleteira manual 2,5t', 189000], ['Estilete de seguranca', 1450], ['Fita de demarcacao de piso', 2790], ['Saco plastico reforcado 60x90', 4100], ['Coletor de dados portatil', 129900], ['Colete refletivo classe 2', 3590], ['Rolo de bolha de ar 1,20m', 9800], ['Selador de caixas manual', 15600], ['Etiqueta fragil 10x5', 1190], ['Carrinho plataforma 150kg', 42900], ['Balanca de plataforma 300kg', 98700], ['Capacete com jugular', 4690], ['Cone de sinalizacao 75cm', 6400], ['Fita antiderrapante 50mm', 3350], ['Organizador de gaveta modular', 2490], ['Lanterna recarregavel LED', 5990]] },
  { tema: 'financas', loja: 'Contabil Office', cor: '#1b6e3c', itens: [['Calculadora financeira', 38900], ['Papel sulfite A4 resma 500 fls', 2390], ['Pasta suspensa kraft', 390], ['Toner compativel preto', 18900], ['Carimbo autoentintado', 4290], ['Cofre eletronico de mesa', 52000], ['Leitor de codigo de barras', 16900], ['Maquina de contar cedulas', 129000], ['Detector de notas falsas', 8900], ['Grampeador de mesa 100 fls', 7490], ['Etiqueta de arquivo morto', 1290], ['Caixa arquivo polionda', 790], ['Bobina termica 80mm', 1890], ['Token de assinatura digital', 21900], ['Organizador de documentos', 3490], ['Perfurador de papel 60 fls', 6590], ['Livro caixa 100 folhas', 1790], ['Marcador de texto 6 cores', 2290], ['Fragmentadora de papel', 34900], ['Agenda executiva 2027', 5890], ['Mouse sem fio', 4590], ['Teclado numerico USB', 3290], ['Fitilho colorido 10 un.', 990], ['Envelope timbrado 500 un.', 8700]] },
  { tema: 'saude', loja: 'MedSul Suprimentos Clinicos', cor: '#0a7f86', itens: [['Luva de procedimento caixa 100', 3290], ['Mascara cirurgica caixa 50', 1890], ['Alcool em gel 500 ml', 1490], ['Termometro infravermelho', 14900], ['Seringa 10 ml caixa 100', 7900], ['Esparadrapo 10 cm x 4,5 m', 1190], ['Gaze esteril pacote 10', 690], ['Oximetro de pulso', 11900], ['Estetoscopio adulto', 18900], ['Esfigmomanometro aneroide', 15500], ['Avental descartavel 20 un.', 6900], ['Touca descartavel 100 un.', 1590], ['Algodao hidrofilo 500 g', 2390], ['Curativo adesivo 100 un.', 1790], ['Coletor perfurocortante 7 L', 1250], ['Lencol descartavel rolo', 3890], ['Detergente enzimatico 1 L', 6790], ['Macas dobravel leve', 89000], ['Balanca digital adulto', 24900], ['Otoscopio portatil', 32900], ['Pinca anatomica inox', 2290], ['Cuba rim inox', 3490], ['Garrote elastico', 590], ['Lanterna clinica', 1990]] },
  { tema: 'rh', loja: 'Pessoas & Cia Brindes', cor: '#7b3fb2', itens: [['Cracha PVC com cordao', 1290], ['Camiseta de uniforme algodao', 4990], ['Caneca termica 450 ml', 3890], ['Kit boas-vindas colaborador', 15900], ['Mochila executiva', 12900], ['Garrafa de aco inox 750 ml', 5490], ['Caderno corporativo A5', 2590], ['Caneta metalica gravada', 1890], ['Porta-cracha retratil', 990], ['Colete institucional', 8900], ['Pen drive 32 GB', 3290], ['Mouse pad personalizado', 1590], ['Boné bordado', 3290], ['Certificado emoldurado A4', 4590], ['Placa de homenagem acrilico', 12900], ['Quadro de avisos 90x60', 18900], ['Cadeira ergonomica', 69900], ['Apoio de pes ajustavel', 14900], ['Suporte para notebook', 8990], ['Lixeira seletiva 3 un.', 17900], ['Kit primeiros socorros', 9490], ['Relogio de parede', 4990], ['Ventilador de mesa', 12900], ['Fone com microfone USB', 9900]] },
  { tema: 'varejo', loja: 'Mercado Bela Vista', cor: '#b8431a', itens: [['Arroz tipo 1 pacote 5 kg', 2790], ['Feijao carioca 1 kg', 890], ['Cafe torrado 500 g', 2290], ['Azeite extravirgem 500 ml', 3990], ['Leite integral caixa 12 un.', 6490], ['Acucar refinado 5 kg', 2590], ['Oleo de soja 900 ml', 790], ['Macarrao espaguete 500 g', 490], ['Molho de tomate 340 g', 350], ['Biscoito recheado 140 g', 290], ['Detergente liquido 500 ml', 250], ['Sabao em po 1,6 kg', 1890], ['Papel higienico 12 rolos', 2490], ['Agua mineral 1,5 L fardo', 1190], ['Suco de uva integral 1 L', 1290], ['Farinha de trigo 1 kg', 490], ['Sal refinado 1 kg', 240], ['Atum em lata 170 g', 790], ['Achocolatado 400 g', 990], ['Margarina 500 g', 890], ['Queijo mussarela 500 g', 2290], ['Presunto fatiado 200 g', 1490], ['Amaciante 2 L', 1790], ['Esponja multiuso 3 un.', 490]] },
  { tema: 'educacao', loja: 'Livraria Saber', cor: '#a3283d', itens: [['Caderno universitario 200 fls', 2490], ['Kit de canetas esferograficas', 1590], ['Livro de matematica 9o ano', 8990], ['Dicionario escolar', 5490], ['Mochila escolar reforçada', 15900], ['Estojo escolar duplo', 3290], ['Calculadora cientifica', 6990], ['Atlas geografico', 7490], ['Caixa de lapis de cor 36 cores', 4290], ['Cola branca 90 g', 390], ['Tesoura sem ponta', 990], ['Pasta catalogo 50 envelopes', 2190], ['Livro de redacao', 6290], ['Compasso escolar', 1390], ['Jogo de esquadros', 1190], ['Folhas de oficio 100 un.', 1990], ['Marcador de quadro branco 4 un.', 2490], ['Apagador para quadro', 890], ['Globo terrestre 30 cm', 9900], ['Kit de experimentos quimica', 17900], ['Microscopio escolar', 38900], ['Livro de literatura brasileira', 4590], ['Agenda escolar 2027', 3290], ['Fichario 4 argolas', 3990]] },
];
const NOMES = ['Ana', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'Joao', 'Karina', 'Leonardo', 'Mariana', 'Nicolas', 'Patricia', 'Rafael', 'Sabrina', 'Tiago'];
const SOBRENOMES = ['Almeida', 'Barbosa', 'Cardoso', 'Dias', 'Ferreira', 'Gomes', 'Lima', 'Machado', 'Nogueira', 'Oliveira', 'Pereira', 'Ribeiro', 'Santos', 'Teixeira'];
const RUAS = ['Rua das Acacias', 'Avenida Brasil', 'Rua Sao Joao', 'Rua XV de Novembro', 'Avenida Paulista', 'Rua das Palmeiras', 'Rua Dom Pedro II', 'Avenida Getulio Vargas', 'Rua Sete de Setembro', 'Rua dos Ipes'];
const CIDADES = [['Campinas', 'SP', '13010-111'], ['Curitiba', 'PR', '80010-020'], ['Belo Horizonte', 'MG', '30110-050'], ['Porto Alegre', 'RS', '90010-150'], ['Recife', 'PE', '50030-230'], ['Salvador', 'BA', '40020-000'], ['Goiania', 'GO', '74003-010'], ['Florianopolis', 'SC', '88010-400']];
const UFS = ['SP', 'RJ', 'MG', 'PR', 'RS', 'SC', 'BA', 'PE', 'GO', 'DF'];
const EMPRESAS_SUF = ['Comercio', 'Servicos', 'Solucoes', 'Distribuidora'];

// Acentua apenas na saida (dados ficam em ASCII para simplicidade do gerador).
const ACENTOS = [['Acacias', 'Acácias'], ['Sao Joao', 'São João'], ['Goiania', 'Goiânia'], ['Florianopolis', 'Florianópolis'], ['Getulio', 'Getúlio'], ['Ipes', 'Ipês'], ['Palmeiras', 'Palmeiras'], ['Servicos', 'Serviços'], ['Solucoes', 'Soluções'], ['Comercio', 'Comércio']];
const acentuar = (s) => ACENTOS.reduce((t, [a, b]) => t.split(a).join(b), s);
const FIX = [['logistica', 'logística'], ['financas', 'finanças'], ['saude', 'saúde']];

export function variante(seed) {
  const R = rng(seed * 101 + 7);
  const t = TEMAS[seed % 6];
  const cidade = pick(R, CIDADES);
  const n = 18 + Math.floor(R() * 5);
  const itens = embaralhar(R, t.itens).slice(0, n).map(([nome, preco], i) => ({ nome: acentuar(nome), sku: `${t.tema.slice(0, 2).toUpperCase()}-${1000 + Math.floor(R() * 8999)}`, qtd: 1 + Math.floor(R() * 5), preco: preco + Math.floor(R() * 40) * 10 }));
  const nome = pick(R, NOMES), sob = pick(R, SOBRENOMES);
  const fretes = [{ id: 'eco', nome: 'Economica', prazo: '6 a 8 dias uteis', preco: 1890 + Math.floor(R() * 20) * 50 }, { id: 'pad', nome: 'Padrao', prazo: '3 a 5 dias uteis', preco: 2990 + Math.floor(R() * 20) * 50 }, { id: 'exp', nome: 'Expressa', prazo: '1 a 2 dias uteis', preco: 5490 + Math.floor(R() * 30) * 50 }];
  return {
    seed, tema: t.tema, loja: acentuar(t.loja), cor: t.cor, itens,
    cliente: { nome, sobrenome: sob, email: `${nome}.${sob}`.toLowerCase() + '@exemplo.com.br', tel: `(${11 + Math.floor(R() * 80)}) 9${Math.floor(1000 + R() * 8999)}-${Math.floor(1000 + R() * 8999)}`, empresa: `${sob} ${pick(R, EMPRESAS_SUF)} Ltda` },
    endereco: { rua: `${pick(R, RUAS)}, ${10 + Math.floor(R() * 990)}`, cidade: cidade[0], uf: cidade[1], cep: cidade[2] },
    fretes, freteSel: Math.floor(R() * 3), descontoPct: pick(R, [0, 0, 5, 10]),
    cartaoFim: String(1000 + Math.floor(R() * 8999)), pedido: `PED-${200000 + Math.floor(R() * 799999)}`,
    parcelasMax: pick(R, [6, 10, 12]), dialogo: Math.floor(R() * 3),
  };
}

const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, '.');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PALAVRAS = [['Endereco', 'Endereço'], ['endereco', 'endereço'], ['Numero', 'Número'], ['numero', 'número'], ['Codigo', 'Código'], ['codigo', 'código'], ['seguranca', 'segurança'], ['Cartao', 'Cartão'], ['cartao', 'cartão'], ['credito', 'crédito'], ['Pais', 'País'], ['Confirmacao', 'Confirmação'], ['confirmacao', 'confirmação'], ['Revisao', 'Revisão'], ['Previsao', 'Previsão'], ['Opcoes', 'Opções'], ['Acoes', 'Ações'], ['nao', 'não'], ['Preco', 'Preço'], ['digitos', 'dígitos'], ['Digito', 'Dígito'], ['verificacao', 'verificação'], ['Padrao', 'Padrão'], ['Economica', 'Econômica'], ['uteis', 'úteis'], ['localizacao', 'localização'], ['Voce', 'Você'], ['podera', 'poderá'], ['sera', 'será'], ['aprovacao', 'aprovação'], ['Cobranca', 'Cobrança'], ['cobranca', 'cobrança'], ['devolucoes', 'devoluções'], ['Separacao', 'Separação'], ['Proximos', 'Próximos'], ['proximas', 'próximas'], ['conteudo', 'conteúdo'], ['bancario', 'bancário'], ['igual a entrega', 'igual à entrega'], ['Previsao', 'Previsão'], ['Cobranca', 'Cobrança'], ['Atualizando', 'Atualizando']];
const acentoPt = (t) => PALAVRAS.reduce((x, [a, b]) => x.replace(new RegExp('(?<![\\p{L}])' + a + '(?![\\p{L}])', 'gu'), b), t);
const lbl = (s) => FIX.reduce((t, [a, b]) => t.split(a).join(b), s);

export function construir(v, violar = new Set()) {
  const V = (id) => violar.has(id);
  const cli = v.cliente, end = v.endereco;
  const itens = v.itens.map((i) => ({ ...i, nome: i.nome }));
  const sub = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const frete = v.fretes[v.freteSel];
  const desc = Math.round(sub * v.descontoPct / 100);
  const total = sub + frete.preco - desc;
  const unidades = itens.reduce((s, i) => s + i.qtd, 0);
  const H3 = V('AM05') ? 'h4' : 'h3';

  // ---- autocomplete (regras FC35 a FC43) ----
  const pre = (sec) => (V('FC42') ? '' : sec + ' ');
  const acEnd = (sec, tok) => `autocomplete="${pre(sec)}${tok}"`;
  const acEndOpc = (sec, tok) => (V('FC43') ? '' : acEnd(sec, tok));

  const campo = (id, rotulo, attrs, dica) => `
        <div class="campo">
          <label for="${id}">${rotulo}</label>
          <input id="${id}" ${attrs}>${dica ? `\n          <small id="${id}-d">${dica}</small>` : ''}
        </div>`;

  const ufOpts = (sel) => UFS.map((u) => `<option value="${u}"${u === sel ? ' selected' : ''}>${u}</option>`).join('\n            ');
  const enderecoCampos = (sec, p, valores) => {
    const rua = V('FC43') ? 'name="rua"' : `name="${p}_rua" ${acEnd(sec, 'street-address')}`;
    const ruaPat = V('FC44') ? ' pattern="(?=.*\\d).+" title="Informe rua e numero"' : '';
    const cepAc = V('FC43') ? 'name="cep"' : `name="${p}_cep" ${acEnd(sec, 'postal-code')}`;
    const pais = V('FC43') ? 'name="pais"' : `name="${p}_pais" ${acEnd(sec, 'country')}`;
    return `
        <div class="linha">
          <div class="campo campo-cep">
            <label for="${p}-cep">CEP</label>
            <div class="com-botao">
              <input id="${p}-cep" type="text" inputmode="numeric" ${cepAc} value="${valores.cep}" required>
              ${p === 'ent' ? botaoBuscar() : ''}
            </div>
            ${p === 'ent' ? '<small id="cep-status" role="status">Digite o CEP para preencher o endereco.</small>' : ''}
          </div>
          <div class="campo campo-largo">
            <label for="${p}-rua">Logradouro</label>
            <input id="${p}-rua" type="text" ${rua} value="${esc(valores.rua)}"${ruaPat} required>
          </div>
        </div>
        <div class="linha">
          <div class="campo">
            <label for="${p}-cidade">Cidade</label>
            <input id="${p}-cidade" type="text" name="${p}_cidade" ${acEnd(sec, 'address-level2')} value="${esc(valores.cidade)}" required>
          </div>
          <div class="campo campo-curto">
            <label for="${p}-uf">Estado</label>
            <select id="${p}-uf" name="${p}_uf" ${acEnd(sec, 'address-level1')}>
            ${ufOpts(valores.uf)}
            </select>
          </div>
          <div class="campo">
            <label for="${p}-pais">Pais</label>
            <select id="${p}-pais" ${pais}>
              <option value="BR" selected>Brasil</option>
              <option value="PT">Portugal</option>
              <option value="AR">Argentina</option>
            </select>
          </div>
        </div>`;
  };

  // botao "Buscar" (AM19: div com onclick; AM25: aria-label diferente do texto)
  const botaoBuscar = () => {
    const al = V('AM25') ? 'Pesquisar localizacao' : 'Buscar endereco pelo CEP';
    return V('AM19')
      ? `<div class="btn btn-sec" onclick="buscarCep()" aria-label="${al}">Buscar</div>`
      : `<button type="button" class="btn btn-sec" onclick="buscarCep()" aria-label="${al}">Buscar</button>`;
  };
  const botaoAplicar = () => {
    const al = V('AM25') ? 'Validar cupom' : 'Aplicar cupom de desconto';
    return V('AM19')
      ? `<div class="btn btn-sec" onclick="aplicarCupom()" aria-label="${al}">Aplicar</div>`
      : `<button type="button" class="btn btn-sec" onclick="aplicarCupom()" aria-label="${al}">Aplicar</button>`;
  };
  const botaoReenviar = () => (V('AM19')
    ? '<div class="btn btn-link" onclick="reenviar()">Reenviar codigo</div>'
    : '<button type="button" class="btn btn-link" onclick="reenviar()">Reenviar codigo</button>');

  const grupo = (titulo, corpo, cls = '') => (V('AM12')
    ? `<div class="bloco grupo ${cls}">\n        <div class="grupo-titulo">${titulo}</div>${corpo}\n      </div>`
    : `<fieldset class="bloco ${cls}">\n        <legend>${titulo}</legend>${corpo}\n      </fieldset>`);

  // ---- cartao (FC35 a FC39) ----
  const numAttr = V('FC37') ? 'type="number"' : 'type="text" inputmode="numeric"';
  const acNum = V('FC35') ? '' : 'autocomplete="cc-number"';
  let numeroCartao;
  if (V('FC38')) {
    const partes = [1, 2, 3, 4].map((k) => `<input type="${V('FC37') ? 'number' : 'text'}" ${V('FC37') ? '' : 'inputmode="numeric"'} maxlength="4" name="cartao_p${k}" aria-label="Numero do cartao, parte ${k}" ${k === 1 ? acNum : ''} placeholder="0000" required>`).join('\n              ');
    numeroCartao = `
        <div class="campo campo-largo">
          <span class="rotulo" id="rot-num">Numero do cartao</span>
          <div class="partes" role="group" aria-labelledby="rot-num">
              ${partes}
          </div>
        </div>`;
  } else {
    numeroCartao = `
        <div class="campo campo-largo">
          <label for="cc-num">Numero do cartao</label>
          <input id="cc-num" ${numAttr} name="${V('FC35') ? 'card' : 'cartao_numero'}" ${acNum} placeholder="0000 0000 0000 0000" required>
        </div>`;
  }
  const t36 = (tok) => (V('FC36') ? '' : `autocomplete="${tok}"`);
  const cartao = `
      <fieldset class="bloco" id="cartao">
        <legend>Dados do cartao</legend>${numeroCartao}
        <div class="linha">
          <div class="campo campo-largo">
            <label for="cc-nome">Nome impresso no cartao</label>
            <input id="cc-nome" type="text" name="${V('FC36') ? 'titular' : 'cartao_nome'}" ${t36('cc-name')} value="${esc((cli.nome + ' ' + cli.sobrenome).toUpperCase())}" required>
          </div>
          <div class="campo campo-curto">
            <label for="cc-exp">Validade (MM/AA)</label>
            <input id="cc-exp" type="text" inputmode="numeric" name="${V('FC36') ? 'validade' : 'cartao_validade'}" ${t36('cc-exp')} placeholder="MM/AA" required>
          </div>
          <div class="campo campo-curto">
            <label for="cc-csc">${V('FC39') ? 'CVV' : 'Codigo de seguranca'}</label>
            <input id="cc-csc" ${V('FC37') ? 'type="number"' : 'type="text" inputmode="numeric"'} name="${V('FC36') ? 'cvv' : 'cartao_codigo'}" ${t36('cc-csc')} aria-describedby="cc-csc-d" required>
            <small id="cc-csc-d">3 digitos no verso</small>
          </div>
        </div>
        <div class="linha">
          <div class="campo">
            <label for="parcelas">Parcelas</label>
            <select id="parcelas" name="parcelas">
              ${Array.from({ length: v.parcelasMax }, (_, k) => `<option value="${k + 1}">${k + 1}x de ${brl(Math.ceil(total / (k + 1)))}${k === 0 ? ' sem juros' : ''}</option>`).join('\n              ')}
            </select>
          </div>
          <div class="campo campo-opc">
            <label class="marca-check"><input type="checkbox" name="salvar_cartao"> Salvar este cartao para as proximas compras</label>
          </div>
        </div>
      </fieldset>`;

  // ---- verificacao (FC48) ----
  const verificacao = V('FC48')
    ? `<div class="campo">
          <span class="rotulo" id="rot-otp">Codigo de verificacao</span>
          <div class="otp" role="group" aria-labelledby="rot-otp">
            ${[1, 2, 3, 4, 5, 6].map((k) => `<input type="text" inputmode="numeric" maxlength="1" name="otp${k}" aria-label="Digito ${k} de 6" onpaste="return false" required>`).join('\n            ')}
          </div>
        </div>`
    : `<div class="campo">
          <label for="otp">Codigo de verificacao</label>
          <input id="otp" type="text" inputmode="numeric" name="otp" autocomplete="one-time-code" placeholder="000000" required>
        </div>`;

  // ---- tabela de itens (AM45, AM25, AM19) ----
  const linhas = itens.map((i, k) => `
          <tr>
            <td class="col-nome">${esc(i.nome)}</td>
            <td class="col-sku">${i.sku}</td>
            <td class="col-num">${i.qtd}</td>
            <td class="col-num">${brl(i.preco)}</td>
            <td class="col-num">${brl(i.qtd * i.preco)}</td>
            <td class="col-acao"><button type="button" class="btn btn-link" onclick="abrirDialogo('${esc(i.nome).replace(/'/g, '')}')" aria-label="${V('AM25') ? 'Excluir' : 'Remover'} ${esc(i.nome)}${V('AM25') ? '' : ' do pedido'}">Remover</button></td>
          </tr>`).join('');

  // ---- revisao (FC50) ----
  const alt = (alvo, sr) => `<a class="link-alterar" href="#${alvo}">Alterar${V('FC50') ? '' : `<span class="sr-only"> ${sr}</span>`}</a>`;

  // ---- dialogo (AM31) ----
  const dlgAttrs = V('AM31') ? 'role="dialog"' : 'role="dialog" aria-modal="true" aria-labelledby="dlg-t"';

  const css = `
    :root{--cor-primaria:${v.cor};--cor-texto:#1c2430;--cor-suave:#5b6675;--cor-fundo:#f4f6f9;--cor-card:#ffffff;--cor-borda:#d5dbe3;--cor-erro:#b3261e;--cor-ok:#1b7a3d;--cor-aviso:#8a5a00;--esp-p:8px;--esp-m:12px;--esp-g:20px;--raio:8px;--fonte:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
    *{box-sizing:border-box}
    body{margin:0;background:var(--cor-fundo);color:var(--cor-texto);font:16px/1.5 var(--fonte)}
    .sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    .pular{position:absolute;left:-999px;top:0;background:#fff;padding:8px}
    .pular:focus{left:8px;z-index:10}
    .topo{background:var(--cor-card);border-bottom:1px solid var(--cor-borda)}
    .topo-in{max-width:1180px;margin:0 auto;padding:var(--esp-m) var(--esp-g);display:flex;align-items:center;gap:var(--esp-g);flex-wrap:wrap}
    .marca{font-weight:700;font-size:20px;color:var(--cor-primaria);text-decoration:none}
    .etapas{display:flex;gap:var(--esp-m);list-style:none;margin:0;padding:0;flex:1;font-size:14px;color:var(--cor-suave)}
    .etapas li[aria-current]{color:var(--cor-primaria);font-weight:600}
    .seguro{font-size:13px;color:var(--cor-ok)}
    .pagina{max-width:1180px;margin:0 auto;padding:var(--esp-g)}
    h1{font-size:28px;margin:0 0 var(--esp-g)}
    h2{font-size:21px;margin:var(--esp-g) 0 var(--esp-m)}
    .sub{font-size:17px;margin:var(--esp-m) 0 var(--esp-p)}
    .grade{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:var(--esp-g);align-items:start}
    .card{background:var(--cor-card);border:1px solid var(--cor-borda);border-radius:var(--raio);padding:var(--esp-g);margin-bottom:var(--esp-g)}
    .bloco{border:1px solid var(--cor-borda);border-radius:var(--raio);padding:var(--esp-m) var(--esp-g) var(--esp-g);margin:0 0 var(--esp-m);min-width:0}
    .bloco legend,.grupo-titulo{font-weight:600;padding:0 var(--esp-p)}
    .grupo-titulo{padding:0 0 var(--esp-p)}
    .linha{display:flex;gap:var(--esp-m);flex-wrap:wrap}
    .campo{display:flex;flex-direction:column;gap:4px;flex:1 1 180px;margin-top:var(--esp-m)}
    .campo-largo{flex:3 1 280px}
    .campo-curto{flex:0 1 140px}
    .campo-opc{justify-content:flex-end}
    .campo label,.rotulo{font-size:14px;font-weight:600}
    .campo small{color:var(--cor-suave);font-size:13px}
    input[type=text],input[type=email],input[type=tel],input[type=number],select{font:inherit;padding:10px 12px;border:1px solid #8793a3;border-radius:var(--raio);background:#fff;min-width:0;width:100%}
    input:focus,select:focus,button:focus,a:focus,summary:focus{outline:3px solid #1a73e8;outline-offset:2px}
    .com-botao{display:flex;gap:var(--esp-p)}
    .partes,.otp{display:flex;gap:var(--esp-p)}
    .partes input{text-align:center}
    .otp input{width:48px;text-align:center;font-size:20px;padding:10px 0}
    .marca-check{display:flex;gap:var(--esp-p);align-items:center;font-weight:400!important}
    .opcao{display:flex;gap:var(--esp-m);align-items:center;padding:var(--esp-m);border:1px solid var(--cor-borda);border-radius:var(--raio);margin-top:var(--esp-p)}
    .opcao span.preco{margin-left:auto;font-weight:600}
    .btn{display:inline-block;font:inherit;font-weight:600;padding:10px 16px;border-radius:var(--raio);border:1px solid var(--cor-primaria);background:var(--cor-primaria);color:#fff;cursor:pointer;text-decoration:none;text-align:center}
    .btn-sec{background:#fff;color:var(--cor-primaria)}
    .btn-link{background:none;border-color:transparent;color:var(--cor-primaria);padding:4px 8px;text-decoration:underline}
    .btn-perigo{background:var(--cor-erro);border-color:var(--cor-erro)}
    .btn-pagar{width:100%;font-size:18px;padding:14px 16px;margin-top:var(--esp-m)}
    details{border:1px dashed var(--cor-borda);border-radius:var(--raio);padding:var(--esp-p) var(--esp-m);margin-top:var(--esp-m)}
    summary{cursor:pointer;color:var(--cor-primaria);font-weight:600}
    .alerta{border-radius:var(--raio);padding:var(--esp-m) var(--esp-g);margin-bottom:var(--esp-m);border:1px solid}
    .alerta.erro{background:#fdecea;border-color:var(--cor-erro);color:#601410}
    .alerta.ok{background:#e8f5ec;border-color:var(--cor-ok);color:#134d27}
    .alerta p{margin:4px 0 var(--esp-p)}
    .carregando{color:var(--cor-suave);font-style:italic;margin:0}
    .erro-campo{color:var(--cor-erro);font-size:13px;margin:4px 0 0}
    table{width:100%;border-collapse:collapse;font-size:15px}
    caption{text-align:left;font-weight:600;padding-bottom:var(--esp-p)}
    th,td{padding:14px 12px;border-bottom:1px solid var(--cor-borda);text-align:left;height:52px}
    ${V('AM45') ? 'thead th{background:#eef1f5}' : 'thead th{position:sticky;top:0;background:#eef1f5;z-index:2}'}
    .col-num{text-align:right;white-space:nowrap}
    tfoot th,tfoot td{font-weight:700}
    dl.resumo{margin:0}
    dl.resumo div{display:flex;justify-content:space-between;padding:6px 0}
    dl.resumo dt{color:var(--cor-suave)}
    dl.resumo dd{margin:0;font-weight:600}
    dl.resumo .total{border-top:1px solid var(--cor-borda);margin-top:var(--esp-p);padding-top:var(--esp-m);font-size:19px}
    dl.revisao{margin:0}
    dl.revisao div{display:grid;grid-template-columns:140px 1fr auto;gap:var(--esp-m);padding:var(--esp-m) 0;border-bottom:1px solid var(--cor-borda)}
    dl.revisao dt{font-weight:600}
    dl.revisao dd{margin:0}
    .linha-tempo{list-style:none;margin:var(--esp-m) 0 0;padding:0;display:grid;gap:var(--esp-p)}
    .selo{display:inline-block;background:#e8f5ec;color:var(--cor-ok);border-radius:99px;padding:2px 10px;font-size:13px;font-weight:600}
    .veu{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50}
    .veu[hidden]{display:none}
    .caixa{background:#fff;border-radius:var(--raio);padding:var(--esp-g);max-width:440px;width:92%}
    .caixa h2{margin-top:0}
    .acoes{display:flex;gap:var(--esp-m);justify-content:flex-end}
    .rodape{max-width:1180px;margin:0 auto;padding:var(--esp-g);color:var(--cor-suave);font-size:14px}
    .rodape ul{display:flex;gap:var(--esp-g);list-style:none;padding:0}
    .lateral{position:sticky;top:var(--esp-m)}
    @media (orientation:landscape){.lateral{max-height:calc(100vh - 24px);overflow:auto}}
    @media (max-width:900px){.grade{grid-template-columns:1fr}.lateral{position:static;max-height:none}dl.revisao div{grid-template-columns:1fr}}
    ${V('AM39') ? '.gire{display:none}\n    @media (orientation:portrait){.topo,.pagina,.rodape{display:none}.gire{display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;font-size:20px}}' : ''}`;

  const radioFrete = v.fretes.map((f, k) => `
          <label class="opcao"><input type="radio" name="frete" value="${f.id}"${k === v.freteSel ? ' checked' : ''}> <span>${f.nome} <small>(${f.prazo})</small></span> <span class="preco">${brl(f.preco)}</span></label>`).join('');
  const metodos = [['cartao', 'Cartao de credito', true], ['pix', 'Pix (aprovacao imediata)', false], ['boleto', 'Boleto bancario (vence em 2 dias)', false]]
    .map(([id, nome, sel]) => `
          <label class="opcao"><input type="radio" name="metodo" value="${id}"${sel ? ' checked' : ''}> <span>${nome}</span></label>`).join('');

  const cobranca = `
      <div id="bloco-cobranca"${V('FC46') ? '' : ' hidden'}>
      <fieldset class="bloco">
        <legend>Endereco de cobranca</legend>${enderecoCampos('billing', 'cob', { rua: end.rua, cidade: end.cidade, uf: end.uf, cep: end.cep })}
      </fieldset>
      </div>`;

  const dlgNome = itens[v.dialogo % itens.length].nome;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Finalizar compra - ${esc(v.loja)}</title>
<style>${css}
</style>
</head>
<body>
<a class="pular" href="#principal">Ir para o conteudo principal</a>
${V('AM39') ? '<div class="gire" role="note">Gire o dispositivo para continuar a compra</div>' : ''}
<header class="topo">
  <div class="topo-in">
    <a class="marca" href="#">${esc(v.loja)}</a>
    <nav aria-label="Etapas da compra">
      <ol class="etapas">
        <li>Carrinho</li>
        <li aria-current="step">Entrega e pagamento</li>
        <li>Confirmacao</li>
      </ol>
    </nav>
    <span class="seguro">Compra 100% protegida</span>
  </div>
</header>
<main id="principal" class="pagina">
  <h1>Finalizar compra</h1>
  <div class="grade">
    <div class="coluna">
      <form id="form-checkout" action="#" method="post" novalidate>
        <section class="card" id="entrega" aria-labelledby="t-entrega">
          <h2 id="t-entrega">1. Entrega</h2>
          <fieldset class="bloco">
            <legend>Contato</legend>
            <div class="linha">
              ${campo('email', 'E-mail', `type="email" name="email" autocomplete="email" value="${cli.email}" required`)}
              ${campo('tel', 'Telefone com DDD', `type="tel" name="telefone" autocomplete="tel" value="${cli.tel}" required`)}
            </div>
          </fieldset>
          <fieldset class="bloco">
            <legend>Endereco de entrega</legend>
            <div class="linha">
              ${campo('ent-nome', 'Nome de quem recebe', `type="text" name="ent_nome" ${acEnd('shipping', 'name')} value="${esc(cli.nome + ' ' + cli.sobrenome)}" required`)}
            </div>${enderecoCampos('shipping', 'ent', { rua: end.rua, cidade: end.cidade, uf: end.uf, cep: end.cep })}
            ${V('FC45')
    ? `<div class="linha">
              ${campo('ent-comp', 'Complemento', `type="text" name="ent_complemento" ${acEnd('shipping', 'address-line2')} ${V('FC44') ? 'required' : ''}`)}
              ${campo('ent-empresa', 'Empresa (opcional)', `type="text" name="ent_empresa" ${acEnd('shipping', 'organization')} value="${esc(cli.empresa)}"`)}
            </div>`
    : `<details>
              <summary>Adicionar complemento ou empresa</summary>
              <div class="linha">
                ${campo('ent-comp', 'Complemento', `type="text" name="ent_complemento" ${acEnd('shipping', 'address-line2')} ${V('FC44') ? 'required' : ''}`)}
                ${campo('ent-empresa', 'Empresa (opcional)', `type="text" name="ent_empresa" ${acEnd('shipping', 'organization')} value="${esc(cli.empresa)}"`)}
              </div>
            </details>`}
          </fieldset>
          ${V('FC46') ? '' : `<label class="marca-check"><input type="checkbox" name="cobranca_igual" checked onchange="alternarCobranca(this)"> Cobranca igual a entrega</label>`}
          ${cobranca}
          ${grupo('Opcoes de frete', radioFrete)}
          <p class="carregando" aria-live="polite">Atualizando prazo de entrega para o CEP ${end.cep}...</p>
        </section>

        <section class="card" id="pagamento" aria-labelledby="t-pag">
          <h2 id="t-pag">2. Pagamento</h2>
          <div class="alerta erro" role="alert">
            <${H3} class="sub">Pagamento nao autorizado</${H3}>
            <p>O banco emissor recusou a tentativa anterior com o cartao final ${v.cartaoFim}. Confira os dados ou use outro cartao.</p>
            <button type="button" class="btn btn-sec" onclick="document.getElementById('cc-nome').focus()">Usar outro cartao</button>
          </div>
          ${grupo('Forma de pagamento', metodos)}${cartao}
          <div class="bloco">
            <${H3} class="sub">Confirmacao do banco</${H3}>
            <p>Enviamos um codigo de 6 digitos por SMS para o telefone ${cli.tel.slice(0, 5)} ****-${cli.tel.slice(-4)}.</p>
            ${verificacao}
            <p>${botaoReenviar()} <small>Voce podera pedir um novo codigo em 30 segundos.</small></p>
          </div>
        </section>

        <section class="card" id="revisao" aria-labelledby="t-rev">
          <h2 id="t-rev">3. Revisao do pedido</h2>
          <dl class="revisao">
            <div><dt>Entrega</dt><dd>${esc(cli.nome + ' ' + cli.sobrenome)}<br>${esc(end.rua)} - ${esc(end.cidade)}/${end.uf} - CEP ${end.cep}</dd><dd>${alt('entrega', 'endereco de entrega')}</dd></div>
            <div><dt>Frete</dt><dd>${frete.nome}, ${frete.prazo} (${brl(frete.preco)})</dd><dd>${alt('entrega', 'opcao de frete')}</dd></div>
            <div><dt>Pagamento</dt><dd>Cartao de credito final ${v.cartaoFim}</dd><dd>${alt('pagamento', 'forma de pagamento')}</dd></div>
            <div><dt>Itens</dt><dd>${unidades} unidades em ${itens.length} produtos</dd><dd>${alt('itens', 'itens do pedido')}</dd></div>
          </dl>
          <button type="submit" class="btn btn-pagar">${V('FC40') ? 'Pagar' : 'Pagar ' + brl(total)}</button>
        </section>
      </form>

      <section class="card" id="itens" aria-labelledby="t-itens">
        <h2 id="t-itens">Itens do pedido</h2>
        <table>
          <caption>${itens.length} produtos, ${unidades} unidades</caption>
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th scope="col">Codigo</th>
              <th scope="col" class="col-num">Qtd.</th>
              <th scope="col" class="col-num">Preco unit.</th>
              <th scope="col" class="col-num">Subtotal</th>
              <th scope="col"><span class="sr-only">Acoes</span></th>
            </tr>
          </thead>
          <tbody>${linhas}
          </tbody>
          <tfoot>
            <tr><th scope="row" colspan="4">Subtotal dos itens</th><td class="col-num">${brl(sub)}</td><td></td></tr>
          </tfoot>
        </table>
      </section>

      <section class="card" id="confirmacao" aria-labelledby="t-conf">
        <h2 id="t-conf">Pedido confirmado</h2>
        <div class="alerta ok" role="status">
          <strong>Pagamento aprovado.</strong> Enviamos o comprovante para ${cli.email}.
        </div>
        <p><span class="selo">${v.pedido}</span> Previsao de entrega: ${frete.prazo}.</p>
        <${H3} class="sub">Proximos passos</${H3}>
        <ol class="linha-tempo">
          <li>Pagamento aprovado</li>
          <li>Separacao dos produtos no estoque</li>
          <li>Envio pela transportadora</li>
        </ol>
        <p><a class="btn" href="#">Acompanhar pedido</a></p>
      </section>
    </div>

    <aside class="lateral" aria-labelledby="t-resumo">
      <div class="card">
        <h2 id="t-resumo">Resumo do pedido</h2>
        <dl class="resumo">
          <div><dt>Subtotal (${unidades} un.)</dt><dd>${brl(sub)}</dd></div>
          <div><dt>Frete ${frete.nome}</dt><dd>${brl(frete.preco)}</dd></div>
          <div><dt>Desconto${v.descontoPct ? ` (${v.descontoPct}%)` : ''}</dt><dd>${desc ? '- ' + brl(desc) : brl(0)}</dd></div>
          <div class="total"><dt>Total</dt><dd>${brl(total)}</dd></div>
        </dl>
        <details>
          <summary>Tem um cupom de desconto?</summary>
          <div class="campo">
            <label for="cupom">Codigo do cupom</label>
            <div class="com-botao">
              <input id="cupom" type="text" name="cupom" autocomplete="off">
              ${botaoAplicar()}
            </div>
            <p class="erro-campo" role="status">Este cupom expirou em 31/10.</p>
          </div>
        </details>
        <${H3} class="sub">Entrega prevista</${H3}>
        <p>${frete.nome}: ${frete.prazo}, para ${esc(end.cidade)}/${end.uf}.</p>
      </div>
    </aside>
  </div>
</main>
<footer class="rodape">
  <h2>Precisa de ajuda?</h2>
  <ul>
    <li><a href="#">Trocas e devolucoes</a></li>
    <li><a href="#">Formas de pagamento</a></li>
    <li><a href="#">Fale com o atendimento</a></li>
  </ul>
  <p>${esc(v.loja)} - todos os direitos reservados.</p>
</footer>
<div class="veu" id="veu" hidden>
  <div class="caixa" ${dlgAttrs}>
    <h2 id="dlg-t">Remover item do pedido?</h2>
    <p id="dlg-p">${esc(dlgNome)} sera removido do pedido.</p>
    <div class="acoes">
      <button type="button" class="btn btn-sec" onclick="fecharDialogo()">Cancelar</button>
      <button type="button" class="btn btn-perigo" onclick="fecharDialogo()">Remover</button>
    </div>
  </div>
</div>
<script>
function buscarCep(){var s=document.getElementById('cep-status');if(s){s.textContent='Endereco localizado.';}}
function aplicarCupom(){var i=document.getElementById('cupom');if(i){i.focus();}}
function reenviar(){var o=document.getElementById('otp');if(o){o.focus();}}
function abrirDialogo(n){var v=document.getElementById('veu');var p=document.getElementById('dlg-p');if(p){p.textContent=n+' sera removido do pedido.';}if(v){v.hidden=false;}}
function fecharDialogo(){var v=document.getElementById('veu');if(v){v.hidden=true;}}
function alternarCobranca(c){var b=document.getElementById('bloco-cobranca');if(b){b.hidden=c.checked;}}
</script>
</body>
</html>
`.replace(/\n\s*\n/g, '\n').replace(/>([^<]+)</g, (m, t) => '>' + acentoPt(t) + '<').replace(/(aria-label|placeholder|title)="([^"]*)"/g, (m, a, t) => `${a}="${acentoPt(t)}"`);
}

export async function checar(pagina) {
  await pagina.setViewportSize({ width: 1280, height: 800 });
  const base = await pagina.evaluate(() => {
    const out = {};
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const txt = (e) => norm(e.textContent);
    const low = (s) => norm(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    const rot = (el) => {
      const p = [];
      if (el.labels) for (const l of el.labels) p.push(txt(l));
      const al = el.getAttribute('aria-label'); if (al) p.push(norm(al));
      const lb = el.getAttribute('aria-labelledby');
      if (lb) for (const id of lb.split(/\s+/)) { const e = document.getElementById(id); if (e) p.push(txt(e)); }
      return norm(p.join(' '));
    };
    const toks = (el) => (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).filter(Boolean);
    const semPre = (el) => toks(el).filter((t) => !/^(shipping|billing|home|work|mobile|section-.*)$/.test(t));
    const oculto = (el) => {
      for (let e = el; e; e = e.parentElement) {
        if (e.hidden) return true;
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        if (e.tagName === 'DETAILS' && !e.open) {
          const sum = [...e.children].find((c) => c.tagName === 'SUMMARY');
          if (!(sum && sum.contains(el))) return true;
        }
      }
      return false;
    };
    const campos = [...document.querySelectorAll('input,select,textarea')];
    const set = (id, ok, nota) => { out[id] = { ok: !!ok, nota }; };

    set('FC35', campos.some((i) => toks(i).includes('cc-number')), 'campo com cc-number');
    {
      const t = campos.flatMap(toks);
      const nome = t.includes('cc-name'), exp = t.includes('cc-exp') || (t.includes('cc-exp-month') && t.includes('cc-exp-year')), csc = t.includes('cc-csc');
      set('FC36', nome && exp && csc, `cc-name:${nome} cc-exp:${exp} cc-csc:${csc}`);
    }
    {
      const c = campos.filter((i) => toks(i).some((t) => t === 'cc-number' || t === 'cc-csc') || /n[uú]mero do cart|c[oó]digo de seguran|^(cvv|cvc)\b/i.test(rot(i)));
      const ruins = c.filter((i) => i.type === 'number' || (i.getAttribute('inputmode') || '') !== 'numeric');
      set('FC37', c.length > 0 && ruins.length === 0, `${c.length} campos, ${ruins.length} sem inputmode numeric ou type=number`);
    }
    {
      let seg = 0;
      const porPai = new Map();
      for (const i of campos) if (i.getAttribute('maxlength') === '4') porPai.set(i.parentElement, (porPai.get(i.parentElement) || 0) + 1);
      for (const n of porPai.values()) if (n >= 2) seg += n;
      const cc = campos.filter((i) => toks(i).includes('cc-number')).length;
      set('FC38', seg === 0 && cc <= 1, `segmentos maxlength=4: ${seg}; cc-number: ${cc}`);
    }
    {
      const c = campos.filter((i) => toks(i).includes('cc-csc') || /c[oó]digo de seguran|^(cvv|cvc|cid|csc)\b/i.test(rot(i)));
      const ruins = c.filter((i) => !/seguran/i.test(rot(i)));
      set('FC39', c.length > 0 && ruins.length === 0, c.map(rot).join('|'));
    }
    {
      const bs = [...document.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')].filter((b) => /\b(pagar|finalizar)\b/i.test(b.value || txt(b)));
      const ruins = bs.filter((b) => !/R\$\s*\d/.test(b.value || txt(b)));
      set('FC40', bs.length > 0 && ruins.length === 0, bs.map((b) => txt(b)).join('|'));
    }
    const legenda = (f) => { const l = f.querySelector(':scope > legend'); return l ? txt(l) : ''; };
    const fsA = [...document.querySelectorAll('fieldset')].filter((f) => /endere[cç]o de (entrega|cobran)/i.test(legenda(f)));
    {
      const ruins = [];
      let n = 0;
      for (const f of fsA) {
        const esperado = /cobran/i.test(legenda(f)) ? 'billing' : 'shipping';
        for (const i of f.querySelectorAll('input,select,textarea')) {
          const t = toks(i); if (!t.length || t[0] === 'off') continue;
          n++; if (t[0] !== esperado) ruins.push(t.join(' '));
        }
      }
      set('FC42', n > 0 && ruins.length === 0, `${n} campos com autocomplete, ${ruins.length} sem prefixo correto`);
    }
    {
      const falta = [];
      for (const f of fsA) {
        const t = [...f.querySelectorAll('input,select,textarea')].flatMap(semPre);
        for (const [alvo, alt] of [['street-address', 'street-address'], ['postal-code', 'postal-code'], ['country', 'country-name']]) if (!t.includes(alvo) && !t.includes(alt)) falta.push(alvo);
      }
      set('FC43', fsA.length > 0 && falta.length === 0, falta.length ? 'faltam: ' + falta.join(',') : 'tokens presentes');
    }
    {
      const l2 = campos.filter((i) => toks(i).includes('address-line2') || semPre(i).includes('address-line2') || /complemento/i.test(rot(i)));
      const rua = campos.filter((i) => semPre(i).includes('street-address') || /logradouro/i.test(rot(i)));
      const ruins = [...l2.filter((i) => i.required || i.getAttribute('aria-required') === 'true'), ...rua.filter((i) => /\\d|\[0-9\]/.test(i.getAttribute('pattern') || ''))];
      set('FC44', l2.length > 0 && rua.length > 0 && ruins.length === 0, `${ruins.length} restricoes indevidas`);
    }
    {
      const alvos = campos.filter((i) => semPre(i).includes('address-line2') || /complemento|cupom|empresa/i.test(rot(i)));
      const visiveis = alvos.filter((i) => !oculto(i));
      set('FC45', alvos.length >= 3 && visiveis.length === 0, `${alvos.length} opcionais, ${visiveis.length} expostos`);
    }
    {
      const cb = campos.find((i) => i.type === 'checkbox' && /cobran[cç]a.*(igual|mesmo)|mesmo endere/i.test(rot(i)));
      const fb = fsA.find((f) => /cobran/i.test(legenda(f)));
      set('FC46', !!(cb && cb.checked && fb && oculto(fb)), cb ? `checkbox marcado:${cb.checked}, cobranca oculta:${fb ? oculto(fb) : 'n/a'}` : 'sem checkbox');
    }
    {
      const otc = campos.filter((i) => toks(i).includes('one-time-code'));
      const porPai = new Map();
      for (const i of campos) if (i.getAttribute('maxlength') === '1') porPai.set(i.parentElement, (porPai.get(i.parentElement) || 0) + 1);
      const caixas = [...porPai.values()].filter((n) => n >= 3).length;
      const bloqueio = campos.filter((i) => /return false|preventDefault/.test(i.getAttribute('onpaste') || '')).length;
      set('FC48', otc.length === 1 && caixas === 0 && bloqueio === 0, `one-time-code:${otc.length}, grupos de caixas:${caixas}, paste bloqueado:${bloqueio}`);
    }
    {
      const as = [...document.querySelectorAll('a,button,[role=button],[role=link]')].filter((e) => /^alterar\b/i.test(txt(e)) || /^alterar\b/i.test(e.getAttribute('aria-label') || ''));
      const nomes = as.map((e) => low(e.getAttribute('aria-label') || txt(e)));
      const unicos = new Set(nomes).size === nomes.length;
      set('FC50', as.length >= 2 && unicos && nomes.every((n) => n.length > 'alterar'.length + 3), nomes.join('|'));
    }
    {
      const n = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1]);
      let salto = 0; for (let i = 1; i < n.length; i++) if (n[i] > n[i - 1] + 1) salto++;
      set('AM05', n.length > 0 && salto === 0, `${salto} saltos de nivel`);
    }
    {
      const g = new Map();
      for (const i of campos) if (i.type === 'radio' || i.type === 'checkbox') { const k = i.type + ':' + i.name; if (!g.has(k)) g.set(k, []); g.get(k).push(i); }
      const grupos = [...g.values()].filter((a) => a.length >= 2);
      const ruins = grupos.filter((a) => !a.every((i) => { const f = i.closest('fieldset'); const l = f && f.querySelector(':scope > legend'); return l && txt(l); }));
      set('AM12', grupos.length > 0 && ruins.length === 0, `${grupos.length} grupos, ${ruins.length} sem fieldset/legend`);
    }
    {
      const nativos = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION'];
      const ruins = [...document.querySelectorAll('[onclick]')].filter((e) => !nativos.includes(e.tagName) && !(e.getAttribute('role') === 'button' && e.hasAttribute('tabindex')));
      const roleSemTab = [...document.querySelectorAll('[role=button]')].filter((e) => !nativos.includes(e.tagName) && !e.hasAttribute('tabindex'));
      set('AM19', ruins.length === 0 && roleSemTab.length === 0, `${ruins.length} elementos nao nativos clicaveis`);
    }
    {
      const cs = [...document.querySelectorAll('button,a[href],[role=button],[role=link],input[type=button],input[type=submit],summary')].filter((e) => e.hasAttribute('aria-label'));
      let n = 0; const ruins = [];
      for (const e of cs) { const vis = low(e.innerText || e.value || ''); if (!vis) continue; n++; if (!low(e.getAttribute('aria-label')).includes(vis)) ruins.push(vis); }
      set('AM25', n > 0 && ruins.length === 0, `${n} controles com aria-label, ${ruins.length} divergentes`);
    }
    {
      const ds = [...document.querySelectorAll('[role=dialog],[role=alertdialog],dialog,[aria-modal]')];
      const ruins = ds.filter((d) => !(d.tagName === 'DIALOG' || /^(alert)?dialog$/.test(d.getAttribute('role') || '')) || d.getAttribute('aria-modal') !== 'true' || !rot(d));
      set('AM31', ds.length > 0 && ruins.length === 0, `${ds.length} dialogos, ${ruins.length} incompletos`);
    }
    {
      const ts = [...document.querySelectorAll('table')].filter((t) => t.getBoundingClientRect().height > innerHeight);
      const ruins = ts.filter((t) => { const ths = [...t.querySelectorAll('thead th')]; return !ths.length || !ths.every((th) => getComputedStyle(th).position === 'sticky' || getComputedStyle(th.parentElement.parentElement).position === 'sticky'); });
      set('AM45', ts.length > 0 && ruins.length === 0, `${ts.length} tabelas altas, ${ruins.length} sem cabecalho fixo`);
    }
    return out;
  });
  // AM39: orientacao retrato e paisagem em tamanho de celular e de tablet.
  const falhas = [];
  for (const [w, h] of [[390, 844], [844, 390], [800, 1280]]) {
    await pagina.setViewportSize({ width: w, height: h });
    const r = await pagina.evaluate(() => {
      const m = document.querySelector('main');
      const alt = m ? m.getBoundingClientRect().height : 0;
      return { vis: !!m && m.checkVisibility() && alt > 300, gire: /gire (o|seu) (dispositivo|aparelho|celular|telefone)|vire (o|seu) (dispositivo|aparelho|celular)/i.test(document.body.innerText) };
    });
    if (!r.vis || r.gire) falhas.push(`${w}x${h}${r.gire ? ' pede giro' : ' conteudo oculto'}`);
  }
  await pagina.setViewportSize({ width: 1280, height: 800 });
  base.AM39 = { ok: falhas.length === 0, nota: falhas.length ? falhas.join('; ') : 'conteudo utilizavel nas duas orientacoes' };
  return base;
}

export function ruido(html, seed) {
  const R = rng(seed * 31 + 5);
  // 1) ordem dos atributos
  html = html.replace(/<([a-z][a-z0-9-]*)((?:\s+[a-zA-Z_:][\w:.-]*(?:="[^"]*")?)+)\s*>/g, (m, tag, attrs) => {
    const lista = attrs.match(/[a-zA-Z_:][\w:.-]*(?:="[^"]*")?/g);
    if (!lista || lista.length < 2) return m;
    return `<${tag} ${embaralhar(R, lista).join(' ')}>`;
  });
  // 2) comentarios antes de blocos
  let k = 0;
  html = html.replace(/\n(\s*)(<(?:section|fieldset|aside|footer|header)\b)/g, (m, sp, tag) => (R() < 0.6 ? `\n${sp}<!-- bloco ${++k} -->\n${sp}${tag}` : m));
  // 3) indentacao e espacos finais
  html = html.replace(/\n( +)</g, (m, sp) => '\n' + sp + (R() < 0.5 ? '  ' : '') + '<');
  html = html.replace(/>\n/g, (m) => (R() < 0.15 ? '> \n' : m));
  // 4) valores CSS equivalentes
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (m, css) => {
    css = css.replace(/#fff(?![0-9a-fA-F])/g, '#ffffff').replace(/--esp-p:8px/, '--esp-p:.5rem').replace(/--esp-m:12px/, '--esp-m:.75rem').replace(/--raio:8px/, '--raio:0.5rem').replace(/font-weight:700/g, 'font-weight:bold');
    css = css.replace(/\n(\s*)\*\{/, '\n$1/* base */\n$1*{');
    return `<style>${css}</style>`;
  });
  return html;
}
