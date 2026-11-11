// Família "listagem": listagem com busca, facetas, tabela ordenável, paginação e estados (sem resultado, carregando, vazio).
import { rng, pick, embaralhar, AXE_SRC } from '../comum.mjs';

export const ID = 'listagem';
export const TITULO = 'Listagem com busca e filtros';
export const REGRAS = ['TD02', 'TD04', 'TD06', 'TD08', 'TD10', 'TD13', 'TD15', 'TD18', 'TD20', 'TD26', 'TD38', 'TD39', 'TD40', 'TD42', 'TD43', 'TD44', 'TD45', 'TD48', 'TD50', 'AM02', 'AM10', 'AM16', 'AM23', 'AM29', 'AM37', 'AM43'];

const TEMAS = [
  { id: 'logistica', marca: 'Rota Certa', titulo: 'Entregas em rota', sing: 'entrega', plur: 'entregas', prefix: 'ENT', termo: 'Carga',
    suf: ['refrigerada Curitiba', 'fracionada Campinas', 'paletizada Recife', 'de eletrônicos Manaus', 'a granel Santos', 'frágil Porto Alegre', 'de medicamentos Goiânia', 'expressa Salvador'],
    semRes: 'Contêiner offshore', grupos: ['Sul', 'Sudeste', 'Nordeste'], status: ['Em rota', 'Aguardando coleta', 'Entregue', 'Atrasada'], cats: ['Fracionada', 'Lotação', 'Expressa'],
    colId: 'Código', colNome: 'Carga', colStatus: 'Situação', colQtd: 'Volumes', colValor: 'Frete', colData: 'Previsão', sw: 'Somente atrasadas', novo: 'Nova entrega', qtdMax: 40, valMax: 9000 },
  { id: 'financas', marca: 'Caixa Clara', titulo: 'Lançamentos financeiros', sing: 'lançamento', plur: 'lançamentos', prefix: 'LAN', termo: 'Pagamento',
    suf: ['fornecedor Alfa', 'aluguel da sede', 'folha de maio', 'licença de software', 'energia elétrica', 'frete internacional', 'manutenção predial', 'consultoria jurídica'],
    semRes: 'Estorno cambial', grupos: ['Conta corrente', 'Cartão corporativo', 'Caixa'], status: ['Pago', 'Agendado', 'Em análise', 'Vencido'], cats: ['Despesa fixa', 'Despesa variável', 'Receita'],
    colId: 'Código', colNome: 'Descrição', colStatus: 'Situação', colQtd: 'Parcelas', colValor: 'Valor', colData: 'Vencimento', sw: 'Somente vencidos', novo: 'Novo lançamento', qtdMax: 12, valMax: 48000 },
  { id: 'saude', marca: 'Clínica Viva', titulo: 'Consultas agendadas', sing: 'consulta', plur: 'consultas', prefix: 'CON', termo: 'Consulta',
    suf: ['de cardiologia, Dr. Almeida', 'de pediatria, Dra. Souza', 'de ortopedia, Dr. Ramos', 'de dermatologia, Dra. Lima', 'de neurologia, Dr. Prado', 'de oftalmologia, Dra. Castro', 'de clínica geral, Dr. Teixeira', 'de endocrinologia, Dra. Vieira'],
    semRes: 'Hemodiálise', grupos: ['Centro', 'Zona Norte', 'Zona Sul'], status: ['Confirmada', 'Aguardando', 'Realizada', 'Cancelada'], cats: ['Particular', 'Convênio', 'Retorno'],
    colId: 'Protocolo', colNome: 'Especialidade', colStatus: 'Situação', colQtd: 'Duração (min)', colValor: 'Valor', colData: 'Data', sw: 'Somente com retorno', novo: 'Nova consulta', qtdMax: 60, valMax: 800 },
  { id: 'rh', marca: 'Pessoas Mais', titulo: 'Candidaturas abertas', sing: 'candidatura', plur: 'candidaturas', prefix: 'CAN', termo: 'Analista',
    suf: ['de dados pleno', 'financeiro sênior', 'de suporte júnior', 'de marketing pleno', 'de RH júnior', 'de compras sênior', 'de qualidade pleno', 'de logística júnior'],
    semRes: 'Engenheiro aeroespacial', grupos: ['Tecnologia', 'Financeiro', 'Operações'], status: ['Triagem', 'Entrevista', 'Proposta', 'Reprovado'], cats: ['CLT', 'PJ', 'Estágio'],
    colId: 'Código', colNome: 'Vaga', colStatus: 'Etapa', colQtd: 'Entrevistas', colValor: 'Pretensão', colData: 'Inscrição', sw: 'Somente com proposta', novo: 'Nova candidatura', qtdMax: 6, valMax: 18000 },
  { id: 'varejo', marca: 'Mercado do Bairro', titulo: 'Catálogo de produtos', sing: 'produto', plur: 'produtos', prefix: 'SKU', termo: 'Notebook',
    suf: ['ultrafino 14 pol.', 'gamer 15 pol.', 'corporativo 13 pol.', 'conversível 2 em 1', 'básico 15 pol.', 'para criadores 16 pol.', 'educacional 11 pol.', 'reforçado 14 pol.'],
    semRes: 'Impressora 3D industrial', grupos: ['Computadores', 'Acessórios', 'Periféricos'], status: ['Em estoque', 'Poucas unidades', 'Sob encomenda', 'Esgotado'], cats: ['Nacional', 'Importado', 'Outlet'],
    colId: 'SKU', colNome: 'Produto', colStatus: 'Disponibilidade', colQtd: 'Estoque', colValor: 'Preço', colData: 'Atualizado em', sw: 'Somente em estoque', novo: 'Novo produto', qtdMax: 300, valMax: 12000 },
  { id: 'educacao', marca: 'Escola Aberta', titulo: 'Catálogo de cursos', sing: 'curso', plur: 'cursos', prefix: 'CUR', termo: 'Curso',
    suf: ['de Excel avançado', 'de redação técnica', 'de lógica de programação', 'de gestão de projetos', 'de inglês instrumental', 'de estatística básica', 'de segurança digital', 'de oratória'],
    semRes: 'Mergulho profissional', grupos: ['Tecnologia', 'Gestão', 'Idiomas'], status: ['Inscrições abertas', 'Em andamento', 'Encerrado', 'Lista de espera'], cats: ['Online', 'Presencial', 'Híbrido'],
    colId: 'Código', colNome: 'Curso', colStatus: 'Situação', colQtd: 'Vagas', colValor: 'Mensalidade', colData: 'Início', sw: 'Somente inscrições abertas', novo: 'Novo curso', qtdMax: 80, valMax: 1800 },
];
const CORES = ['2f6fed', '1b8a5a', 'b4541a', '7a3ec2', 'c2335a', '0e7c86'];
const brl = n => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svg = (cor, n) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='8' fill='%23${cor}'/%3E%3Ccircle cx='20' cy='20' r='${6 + n % 7}' fill='%23ffffff' fill-opacity='.85'/%3E%3C/svg%3E`;

export function variante(seed) {
  const R = rng(seed * 7919 + 13);
  const t = TEMAS[seed % TEMAS.length];
  const tamanhos = [5, 4, 5];
  const linhas = [];
  let k = 0;
  const base = 1000 + Math.floor(R() * 8000);
  tamanhos.forEach((n, g) => {
    for (let i = 0; i < n; i++, k++) {
      const dia = 1 + Math.floor(R() * 28), mes = 1 + Math.floor(R() * 12);
      linhas.push({
        g, id: `${t.prefix}-${base + k * 17 + Math.floor(R() * 9)}`,
        nome: `${t.termo} ${t.suf[k % 8]}${k >= 8 ? ' · lote ' + 'BCDEFG'[k - 8] : ''}`,
        st: Math.floor(R() * 4), cat: pick(R, t.cats), qtd: 1 + Math.floor(R() * t.qtdMax),
        valor: Math.round((50 + R() * t.valMax) * 100) / 100,
        data: `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/2026`, cor: CORES[k % CORES.length],
      });
    }
  });
  const paginas = 3 + Math.floor(R() * 4);
  const total = (paginas - 1) * 14 + 8 + Math.floor(R() * 6);
  return { seed, t, linhas, paginas, total, marcados: [Math.floor(R() * 4), Math.floor(R() * 3)], op: Math.floor(R() * 3) };
}

export function construir(v, violar) {
  const V = id => violar.has(id);
  const t = v.t;
  const E = esc;
  const tituloPag = V('AM02') ? 'Sem título' : t.titulo;
  const titulo = `${tituloPag}${V('TD48') ? '' : ` (página 1 de ${v.paginas})`}`;

  // ---------- busca ----------
  const campo = (id, valor) => {
    const tipo = V('TD38') ? 'text' : 'search';
    const nomeAttr = V('TD38') ? '' : ' name="q"';
    const rot = V('TD40') ? '' : `<label class="rotulo" for="${id}">Buscar ${t.plur}</label>`;
    const aria = V('TD40') ? ` aria-label="Buscar ${t.plur}"` : '';
    const ti = V('AM16') ? ' tabindex="2"' : '';
    const tb = V('AM16') ? ' tabindex="3"' : '';
    const controle = `<div class="busca-linha">
          <input class="campo" id="${id}" type="${tipo}"${nomeAttr}${aria}${ti} value="${E(valor)}" placeholder="Ex.: ${E(t.termo)}" autocomplete="off">
          <button class="btn btn-pri" type="submit"${tb}>Buscar</button>
        </div>`;
    return { rot, controle };
  };
  const formBusca = (id, valor, extra = '') => {
    const { rot, controle } = campo(id, valor);
    const tag = V('TD39') ? 'div' : 'form';
    const attrs = V('TD39') ? ' class="busca"' : ' class="busca" role="search" action="?" method="get"';
    return `<${tag}${attrs}>
        ${rot}
        ${controle}${extra}
      </${tag}>`;
  };
  let blocoBusca;
  if (V('TD08')) {
    const { rot, controle } = campo('busca-principal', t.termo);
    blocoBusca = `<table class="barra-busca">
      <tbody>
        <tr>
          <th>${rot}</th>
          <td>
            ${V('TD39') ? '<div class="busca">' : '<form class="busca" role="search" action="?" method="get">'}
              ${controle}
            ${V('TD39') ? '</div>' : '</form>'}
          </td>
        </tr>
      </tbody>
    </table>`;
  } else {
    blocoBusca = formBusca('busca-principal', t.termo);
  }

  // ---------- facetas ----------
  const ac = (idp, rotulo, conteudo, aberto, n) => {
    const ctrl = V('AM29') ? '' : ` aria-controls="${idp}"`;
    const extra = V('AM29') ? ` <span class="cont">(${n})</span>` : '';
    return `<div class="faceta">
        <h3 class="ac-t"><button class="ac-b" type="button" aria-expanded="${aberto}"${ctrl}>${E(rotulo)}</button>${extra}</h3>
        <div class="ac-p" id="${idp}"${aberto ? '' : ' hidden'}>
          ${conteudo}
        </div>
      </div>`;
  };
  const checks = (pref, lista, marcado) => lista.map((s, i) => `<label class="op">
            <input type="checkbox" name="${pref}" value="${i}"${i === marcado ? ' checked' : ''}>
            <span>${E(s)}</span>
          </label>`).join('\n          ');
  const faixas = ['Até R$ 500', 'R$ 500 a R$ 2.000', 'Acima de R$ 2.000'].map((s, i) => `<label class="op">
            <input type="radio" name="faixa" value="${i}"${i === v.op ? ' checked' : ''}>
            <span>${s}</span>
          </label>`).join('\n          ');
  const sw = V('TD50')
    ? `<div class="sw-linha"><span class="sw-rot">${E(t.sw)}</span><div class="sw" tabindex="0"><span class="sw-bola"></span></div></div>`
    : `<div class="sw-linha"><span class="sw-rot" id="sw1-l">${E(t.sw)}</span><div class="sw" id="sw1" role="switch" aria-checked="false" aria-labelledby="sw1-l" tabindex="0"><span class="sw-bola"></span></div></div>`;
  const facetas = `<aside class="filtros" aria-label="Filtros da listagem">
      <h2 class="h-lateral">Filtros</h2>
      ${ac('fac-status', 'Situação', checks('status', t.status, v.marcados[0]), true, 4)}
      ${ac('fac-tipo', 'Tipo', checks('tipo', t.cats, v.marcados[1]), true, 3)}
      ${ac('fac-faixa', 'Faixa de valor', faixas, false, 3)}
      ${sw}
      <button class="btn btn-sec" type="button">Limpar filtros</button>
    </aside>`;

  // ---------- tabela ----------
  const cab = (texto, aria, num) => {
    const tag = V('TD02') ? 'td' : 'th';
    const sc = tag === 'th' ? ` scope="${V('AM10') ? 'coluna' : 'col'}"` : '';
    const seta = aria === 'ascending' ? '▲' : aria === 'descending' ? '▼' : '⇅';
    const ah = V('TD20') ? '' : ' aria-hidden="true"';
    const cls = num ? ' class="num"' : '';
    if (V('TD18')) return `<${tag}${sc}${cls} aria-sort="${aria}" onclick="ordenar(this)">${texto} <span class="seta"${ah}>${seta}</span></${tag}>`;
    return `<${tag}${sc}${cls} aria-sort="${aria}"><button class="ord" type="button">${texto} <span class="seta"${ah}>${seta}</span></button></${tag}>`;
  };
  const tagCab = V('TD02') ? 'td' : 'th';
  const thead = `<thead>
          <tr>
            ${cab(t.colId, 'none')}
            ${cab(t.colNome, 'none')}
            ${cab(t.colStatus, 'none')}
            ${cab(t.colQtd, 'none', true)}
            ${cab(t.colValor, 'none', true)}
            ${cab(t.colData, 'descending')}
            <${tagCab}${tagCab === 'th' ? ` scope="${V('AM10') ? 'coluna' : 'col'}"` : ''}>Ações</${tagCab}>
          </tr>
        </thead>`;
  let imgN = 0;
  const linha = r => {
    imgN++;
    const alt = V('AM23') ? ` alt="IMG_${4000 + imgN}.jpg"` : ` alt="Miniatura de ${E(r.nome)}"`;
    return `<tr>
            <th scope="row"><a class="lnk" href="#${r.id}">${r.id}</a></th>
            <td>
              <span class="nm">
                <img class="thumb" src="${svg(r.cor, imgN)}"${alt} width="32" height="32">
                <span class="nm-t">
                  <span>${E(r.nome)}</span>
                  <small>${E(r.cat)}</small>
                </span>
              </span>
            </td>
            <td><span class="badge s${r.st}">${E(t.status[r.st])}</span></td>
            <td class="num">${r.qtd}</td>
            <td class="num">${brl(r.valor)}</td>
            <td>${r.data}</td>
            <td><a class="btn btn-s" href="#${r.id}-detalhe" aria-label="Detalhes de ${r.id}">Detalhes</a></td>
          </tr>`;
  };
  const corpos = t.grupos.map((g, gi) => {
    const rs = v.linhas.filter(r => r.g === gi);
    return `<tbody>
          <tr class="grupo">
            <th colspan="7"${V('TD06') ? '' : ' scope="rowgroup"'}>${E(g)} · ${rs.length} ${t.plur}</th>
          </tr>
          ${rs.map(linha).join('\n          ')}
        </tbody>`;
  }).join('\n        ');
  const caption = V('TD04') ? '' : `<caption class="cap">${E(t.titulo)} em ordem de ${E(t.colData.toLowerCase())}</caption>\n        `;
  const tituloAvulso = V('TD04') ? `<div class="titulo-tabela">${E(t.titulo)}</div>` : '';
  const tabela = `${tituloAvulso}<table class="tabela">
        ${caption}${thead}
        ${corpos}
      </table>`;
  const rolavel = V('AM37') ? `<div class="tabela-solta">\n      ${tabela}\n    </div>` : `<div class="tabela-rolavel">\n      ${tabela}\n    </div>`;

  // ---------- paginação ----------
  const nums = Array.from({ length: v.paginas }, (_, i) => i + 1);
  const itens = nums.map(n => V('TD45')
    ? `<li><a class="pg${n === 1 ? ' atual' : ''}" href="?p=${n}">${n}</a></li>`
    : `<li><a class="pg" href="?p=${n}"${n === 1 ? ' aria-current="page"' : ''}>${n}</a></li>`).join('\n          ');
  const pagInner = `<ul class="pag-lista">
          <li><span class="pg pg-off" aria-disabled="true">Anterior</span></li>
          ${itens}
          <li><a class="pg" href="?p=2">Próxima</a></li>
        </ul>`;
  const paginacao = V('TD45')
    ? `<div class="pag">\n        ${pagInner}\n      </div>`
    : `<nav class="pag" aria-label="Paginação dos resultados">\n        ${pagInner}\n      </nav>`;

  // ---------- estados ----------
  const semResMsg = V('TD42')
    ? `<p class="est-msg">Nenhum resultado encontrado.</p>`
    : `<p class="est-msg">Nenhum resultado para “${E(t.semRes)}”. Revise a grafia, remova filtros ou tente um termo mais geral.</p>`;
  const painelSemRes = `<section class="estado" aria-labelledby="h-sem">
        <h3 id="h-sem">Sem resultados</h3>
        ${semResMsg}
        ${formBusca('busca-vazia', V('TD42') ? '' : t.semRes)}
      </section>`;
  const painelCarregando = V('TD43')
    ? `<section class="estado" aria-labelledby="h-car">
        <h3 id="h-car">Carregando resultados</h3>
        <p class="est-msg">Nenhum registro encontrado.</p>
      </section>`
    : `<section class="estado" aria-labelledby="h-car">
        <h3 id="h-car">Carregando resultados</h3>
        <div role="status" aria-busy="true">
          <progress class="prog" aria-label="Carregando ${t.plur}"></progress>
          <p class="est-msg">Buscando ${t.plur} no servidor…</p>
          <div class="esq"></div>
          <div class="esq curta"></div>
        </div>
      </section>`;
  const painelVazio = V('TD44')
    ? `<section class="estado" aria-labelledby="h-vaz">
        <h3 id="h-vaz">Lista vazia</h3>
        <p class="est-msg">Nenhum registro.</p>
      </section>`
    : `<section class="estado" aria-labelledby="h-vaz">
        <h3 id="h-vaz">Lista vazia</h3>
        <p class="est-msg">Ainda não há registros de ${t.plur} nesta lista. Para adicionar, importe uma planilha CSV ou use o botão abaixo; os registros aparecem aqui assim que forem salvos.</p>
        <a class="btn btn-pri" href="#novo">${E(t.novo)}</a>
      </section>`;

  const logoAlt = V('AM23') ? '' : ` alt="Logotipo ${E(t.marca)}"`;
  const alvo = V('AM43') ? '30px' : '44px';
  const ruidoCSS = V('TD26')
    ? `.badge{display:inline-block;height:1.2em;line-height:1.2;overflow:hidden;padding:0 .6rem;border-radius:999px;font-size:.8rem;font-weight:600}`
    : `.badge{display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.8rem;font-weight:600}`;
  const numAlign = V('TD10') ? 'left' : 'right';
  const sticky = V('TD13') ? 'static' : 'sticky';
  const padSroll = V('TD15') ? '' : 'scroll-padding-top:64px;';
  const rolCss = V('AM37')
    ? `.tabela-solta{margin-top:.5rem}`
    : `.tabela-rolavel{overflow:auto;max-height:560px;${padSroll}border:1px solid var(--borda);border-radius:var(--raio);background:var(--sup)}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${E(titulo)}</title>
<style>
:root{
  --fundo:#f4f6fa;
  --sup:#ffffff;
  --texto:#1c2330;
  --texto-2:#4a5568;
  --borda:#cfd6e2;
  --pri:#1d4ed8;
  --pri-txt:#ffffff;
  --sec:#e8edf7;
  --foco:#f59e0b;
  --raio:10px;
  --esp:1rem;
  --alvo:${alvo};
}
${V('TD15') ? '' : 'html{scroll-padding-top:64px}'}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.45;color:var(--texto);background:var(--fundo)}
h1,h2,h3{line-height:1.25;margin:0}
h1{font-size:1.6rem}
h2{font-size:1.25rem}
h3{font-size:1rem}
a{color:var(--pri)}
:focus-visible{outline:3px solid var(--foco);outline-offset:2px}
.topo{display:flex;flex-wrap:wrap;align-items:center;gap:var(--esp);padding:.5rem var(--esp);background:var(--sup);border-bottom:1px solid var(--borda)}
.marca{display:inline-flex;align-items:center;gap:.6rem;min-height:44px;min-width:44px;font-weight:700;text-decoration:none;color:var(--texto)}
.marca img{display:block}
.menu-lista{display:flex;flex-wrap:wrap;gap:.25rem;list-style:none;margin:0;padding:0}
.menu-lista a{display:inline-flex;align-items:center;min-height:var(--alvo);min-width:var(--alvo);padding:0 .9rem;border-radius:8px;text-decoration:none;color:var(--texto)}
.menu-lista a[aria-current]{background:var(--sec);font-weight:700}
main{max-width:1180px;margin:0 auto;padding:var(--esp)}
.lead{color:var(--texto-2);margin:.4rem 0 1.2rem;max-width:70ch}
.busca-bloco{background:var(--sup);border:1px solid var(--borda);border-radius:var(--raio);padding:var(--esp);margin-bottom:var(--esp)}
.busca{display:flex;flex-direction:column;gap:.4rem}
.rotulo{font-weight:600;font-size:.95rem}
.busca-linha{display:flex;flex-wrap:wrap;gap:.5rem}
.campo{flex:1 1 220px;min-width:0;min-height:44px;padding:0 .8rem;border:1px solid #6b7686;border-radius:8px;font:inherit;background:#fff;color:var(--texto)}
.barra-busca{width:100%;border-collapse:collapse}
.barra-busca th{text-align:left;padding:0 .75rem 0 0;white-space:nowrap}
.barra-busca td{width:100%}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 1rem;border-radius:8px;border:1px solid transparent;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn-pri{background:var(--pri);color:var(--pri-txt)}
.btn-sec{background:var(--sec);color:var(--texto);border-color:var(--borda)}
.btn-s{background:var(--sec);color:var(--pri);border-color:var(--borda)}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:var(--esp);align-items:start}
.filtros{background:var(--sup);border:1px solid var(--borda);border-radius:var(--raio);padding:var(--esp);display:flex;flex-direction:column;gap:.75rem}
.h-lateral{font-size:1.05rem}
.faceta{border-top:1px solid var(--borda);padding-top:.5rem}
.ac-t{margin:0;display:flex;align-items:center;gap:.5rem}
.ac-b{flex:1;display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 .25rem;border:0;background:transparent;font:inherit;font-weight:700;text-align:left;cursor:pointer;color:var(--texto)}
.ac-b::after{content:"+";font-weight:400}
.ac-b[aria-expanded="true"]::after{content:"–"}
.cont{color:var(--texto-2);font-size:.85rem}
.ac-p{display:flex;flex-direction:column}
.op{display:flex;align-items:center;gap:.6rem;min-height:var(--alvo);min-width:var(--alvo);cursor:pointer}
.op input{width:18px;height:18px;margin:0}
.sw-linha{display:flex;align-items:center;justify-content:space-between;gap:.75rem;border-top:1px solid var(--borda);padding-top:.5rem}
.sw{position:relative;width:56px;height:44px;border-radius:22px;background:#8a94a6;cursor:pointer;flex:none}
.sw-bola{position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:50%;background:#fff;transition:left .15s}
.sw[aria-checked="true"]{background:var(--pri)}
.sw[aria-checked="true"] .sw-bola{left:20px}
.resultados{min-width:0}
.cabeca-res{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:var(--esp);margin-bottom:.75rem}
.contagem{margin:.25rem 0 0;color:var(--texto-2)}
.ctl{display:flex;flex-direction:column;gap:.25rem;font-size:.9rem;font-weight:600}
.ctl select{min-height:44px;padding:0 .6rem;border:1px solid #6b7686;border-radius:8px;font:inherit;background:#fff;cursor:pointer}
.ctls{display:flex;flex-wrap:wrap;gap:.75rem}
.cap{caption-side:top;text-align:left;font-weight:700;padding:.6rem .75rem}
.titulo-tabela{font-weight:700;padding:.6rem .75rem 0}
.tabela{width:100%;min-width:920px;border-collapse:separate;border-spacing:0;background:var(--sup)}
.tabela thead th,.tabela thead td{position:${sticky};top:0;z-index:2;background:#e9eef8;text-align:left;font-size:.9rem;padding:0;border-bottom:2px solid var(--borda);vertical-align:middle}
.tabela thead th:last-child,.tabela thead td:last-child{padding:0 .75rem}
.tabela td,.tabela tbody th{padding:.4rem .75rem;border-bottom:1px solid var(--borda);vertical-align:middle;text-align:left;font-weight:400}
.tabela td.num,.tabela th.num,.tabela td.num{text-align:${numAlign};font-variant-numeric:tabular-nums}
.tabela thead .num{text-align:${numAlign}}
.ord{display:flex;align-items:center;gap:.35rem;width:100%;min-height:44px;padding:0 .75rem;border:0;background:transparent;font:inherit;font-weight:700;color:var(--texto);cursor:pointer;text-align:inherit}
.num .ord{justify-content:flex-end}
.seta{font-size:.75rem;color:var(--texto-2)}
.tabela .grupo th{background:#f0f3f9;font-weight:700;font-size:.9rem;padding:.4rem .75rem}
.lnk{display:inline-flex;align-items:center;min-height:44px;min-width:44px;font-weight:600}
.nm{display:flex;align-items:center;gap:.6rem}
.nm-t{display:flex;flex-direction:column}
.nm-t small{color:var(--texto-2)}
.thumb{border-radius:8px;flex:none}
${ruidoCSS}
.s0{background:#dbeafe;color:#1e3a8a}
.s1{background:#fef3c7;color:#78350f}
.s2{background:#dcfce7;color:#14532d}
.s3{background:#fee2e2;color:#7f1d1d}
${rolCss}
.pag{margin-top:var(--esp)}
.pag-lista{display:flex;flex-wrap:wrap;gap:.35rem;list-style:none;margin:0;padding:0}
.pg{display:inline-flex;align-items:center;justify-content:center;min-height:var(--alvo);min-width:var(--alvo);padding:0 .75rem;border:1px solid var(--borda);border-radius:8px;background:var(--sup);color:var(--texto);text-decoration:none}
.pg[aria-current="page"],.pg.atual{background:var(--pri);color:var(--pri-txt);border-color:var(--pri);font-weight:700}
.pg-off{color:#6b7686;background:transparent}
.estados{margin-top:2rem}
.estados>h2{margin-bottom:.25rem}
.grade-estados{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--esp);margin-top:var(--esp)}
.estado{background:var(--sup);border:1px dashed var(--borda);border-radius:var(--raio);padding:var(--esp);display:flex;flex-direction:column;gap:.6rem;min-width:0}
.est-msg{margin:0;color:var(--texto-2)}
.prog{width:100%;height:10px}
.esq{height:14px;border-radius:6px;background:linear-gradient(90deg,#e3e8f1,#f3f5fa,#e3e8f1);margin-top:.5rem}
.esq.curta{width:60%}
.rodape{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:center;justify-content:space-between;padding:var(--esp);border-top:1px solid var(--borda);background:var(--sup);margin-top:2rem}
.rodape ul{display:flex;flex-wrap:wrap;gap:.25rem;list-style:none;margin:0;padding:0}
.rodape a{display:inline-flex;align-items:center;min-height:var(--alvo);min-width:var(--alvo);padding:0 .6rem}
@media (max-width:820px){
  .layout{grid-template-columns:minmax(0,1fr)}
  .barra-busca th,.barra-busca td{display:block;width:auto;padding:0 0 .4rem}
  h1{font-size:1.35rem}
}
</style>
</head>
<body>
<header class="topo">
  <a class="marca" href="#inicio">
    <img src="${svg('1d4ed8', 3)}"${logoAlt} width="32" height="32">
    <span>${E(t.marca)}</span>
  </a>
  <nav aria-label="Principal">
    <ul class="menu-lista">
      <li><a href="#painel">Painel</a></li>
      <li><a href="#listagem" aria-current="page">${E(t.plur[0].toUpperCase() + t.plur.slice(1))}</a></li>
      <li><a href="#relatorios">Relatórios</a></li>
      <li><a href="#ajuda">Ajuda</a></li>
    </ul>
  </nav>
</header>
<main id="conteudo">
  <h1>${E(t.titulo)}</h1>
  <p class="lead">Pesquise por palavra-chave, combine filtros e ordene as colunas para encontrar ${t.plur} rapidamente. Os resultados são atualizados a cada busca.</p>
  <div class="busca-bloco">
    ${blocoBusca}
  </div>
  <div class="layout">
    ${facetas}
    <section class="resultados" aria-labelledby="h-res">
      <div class="cabeca-res">
        <div>
          <h2 id="h-res" tabindex="-1">Resultados</h2>
          <p class="contagem" role="status">Exibindo 1–14 de ${v.total} ${t.plur} para “${E(t.termo)}”</p>
        </div>
        <div class="ctls">
          <div class="ctl">
            <label for="ordem">Ordenar por</label>
            <select id="ordem" name="ordem">
              <option>${E(t.colData)} (mais recente)</option>
              <option>${E(t.colValor)} (maior)</option>
              <option>${E(t.colNome)} (A–Z)</option>
            </select>
          </div>
          <div class="ctl">
            <label for="porpag">Itens por página</label>
            <select id="porpag" name="porpag">
              <option>14</option>
              <option>28</option>
              <option>56</option>
            </select>
          </div>
        </div>
      </div>
      ${rolavel}
      ${paginacao}
    </section>
  </div>
  <section class="estados" aria-labelledby="h-estados">
    <h2 id="h-estados">Outros estados da listagem</h2>
    <p class="lead">Como a tela se comporta quando a busca não encontra nada, enquanto os dados carregam e quando ainda não há registros.</p>
    <div class="grade-estados">
      ${painelSemRes}
      ${painelCarregando}
      ${painelVazio}
    </div>
  </section>
</main>
<footer class="rodape">
  <span>© 2026 ${E(t.marca)}</span>
  <nav aria-label="Rodapé">
    <ul>
      <li><a href="#termos">Termos de uso</a></li>
      <li><a href="#privacidade">Privacidade</a></li>
      <li><a href="#contato">Contato</a></li>
    </ul>
  </nav>
</footer>
<script>
function ordenar(el){ el.setAttribute('aria-sort', el.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending'); }
document.querySelectorAll('button[aria-expanded]').forEach(function (b) {
  b.addEventListener('click', function () {
    var aberto = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', String(!aberto));
    var p = document.getElementById(b.getAttribute('aria-controls')) || b.parentElement.nextElementSibling;
    if (p) p.hidden = aberto;
  });
});
document.querySelectorAll('.sw').forEach(function (s) {
  function alternar() { if (s.hasAttribute('aria-checked')) s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true')); }
  s.addEventListener('click', alternar);
  s.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); alternar(); } });
});
</script>
</body>
</html>
`;
}

export async function checar(pagina) {
  await pagina.setViewportSize({ width: 1280, height: 800 });
  const out = {};
  const dom = await pagina.evaluate(() => {
    const out = {};
    const S = (id, ok, nota = '') => { out[id] = { ok: !!ok, nota }; };
    const T = (id, fn) => { try { const [ok, n] = fn(); S(id, ok, n || ''); } catch (x) { S(id, false, 'erro ' + x.message); } };
    const cs = e => getComputedStyle(e);
    const vis = e => { const r = e.getBoundingClientRect(), s = cs(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
    const nome = e => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(/\s+/).map(i => { const x = document.getElementById(i); return x ? txt(x) : ''; }).join(' ').trim() || txt(e) || e.getAttribute('title') || '').trim();
    const tabs = [...document.querySelectorAll('table')].sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length);
    const tb = tabs[0];
    const buscas = [...document.querySelectorAll('input')].filter(i => ['search', 'text'].includes(i.type));
    const painel = re => { const h = [...document.querySelectorAll('h2,h3,h4')].find(x => re.test(txt(x))); return h ? h.closest('section') : null; };
    const cabCels = tb && tb.tHead ? [...tb.tHead.querySelectorAll('th,td')] : [];

    T('TD02', () => [cabCels.length > 0 && cabCels.every(c => c.tagName === 'TH') && tb.querySelectorAll('tbody td').length > 0, `${cabCels.filter(c => c.tagName !== 'TH').length} células de cabeçalho não-th`]);
    T('TD04', () => { const c = tb.firstElementChild; const t = c && c.tagName === 'CAPTION' ? txt(c) : ''; return [!!t && t.length >= 3 && t.length <= 70 && tb.querySelectorAll('caption').length === 1, `caption="${t}"`]; });
    T('TD06', () => { const sp = [...tb.querySelectorAll('th')].filter(h => h.colSpan > 1 || h.rowSpan > 1); const ruins = sp.filter(h => !['colgroup', 'rowgroup'].includes(h.getAttribute('scope'))); return [ruins.length === 0, `${sp.length} th com span, ${ruins.length} sem scope de grupo`]; });
    T('TD08', () => { const ruins = tabs.filter(t => t.querySelector('input,select,textarea,form,table,h1,h2,h3,nav') || ['presentation', 'none'].includes(t.getAttribute('role'))); return [ruins.length === 0, `${ruins.length} tabela(s) de layout`]; });
    T('TD10', () => {
      const n = Math.max(...[...tb.tBodies].flatMap(b => [...b.rows].map(r => r.cells.length)));
      const rows = [...tb.tBodies].flatMap(b => [...b.rows]).filter(r => r.cells.length === n);
      const re = /^[+\-–]?\s*(R\$\s*)?[\d.]+(,\d+)?\s*%?$/;
      const cols = []; for (let i = 0; i < n; i++) { const cel = rows.map(r => r.cells[i]); if (cel.length && cel.every(c => re.test(txt(c)))) cols.push(cel); }
      const ruins = cols.filter(cel => cel.some(c => !['right', 'end'].includes(cs(c).textAlign)));
      return [cols.length > 0 && ruins.length === 0, `${cols.length} colunas numéricas, ${ruins.length} não alinhadas à direita`];
    });
    T('TD13', () => [cabCels.length > 0 && cabCels.every(c => /sticky/.test(cs(c).position)), `position=${cabCels[0] ? cs(cabCels[0]).position : '-'}`]);
    T('TD15', () => {
      let sc = document.documentElement;
      for (let p = tb.parentElement; p && p !== document.body; p = p.parentElement) { const o = cs(p).overflowY; if (o === 'auto' || o === 'scroll') { sc = p; break; } }
      const pad = parseFloat(cs(sc).scrollPaddingTop) || 0; const h = tb.tHead.getBoundingClientRect().height;
      return [pad >= h - 1, `scroll-padding-top=${pad} cabeçalho=${Math.round(h)}`];
    });
    T('TD18', () => { const c = [...tb.querySelectorAll('[aria-sort]')]; const ruins = c.filter(x => { const b = x.querySelector('button'); return !b || !txt(b).replace(/[▲▼⇅]/g, '').trim(); }); return [c.length > 0 && ruins.length === 0, `${c.length} colunas ordenáveis, ${ruins.length} sem button`]; });
    T('TD20', () => {
      const ic = [...tb.querySelectorAll('[aria-sort] svg, [aria-sort] span, [aria-sort] i')].filter(e => e.tagName === 'svg' || /^[▲▼▴▾↑↓⇅↕⬍△▽]$/.test(txt(e)));
      const ruins = ic.filter(e => !e.closest('[aria-hidden="true"]'));
      return [ic.length > 0 && ruins.length === 0, `${ic.length} ícones, ${ruins.length} expostos`];
    });
    T('TD38', () => { const ruins = buscas.filter(i => i.type !== 'search' || !i.getAttribute('name')); return [buscas.length > 0 && ruins.length === 0, `${buscas.length} campos, ${ruins.length} sem type=search+name`]; });
    T('TD39', () => { const ruins = buscas.filter(i => !i.closest('form[role="search"],search,[role="search"]')); return [buscas.length > 0 && ruins.length === 0, `${ruins.length} fora de região de busca`]; });
    T('TD40', () => { const ruins = buscas.filter(i => { const l = [...(i.labels || [])].find(x => vis(x) && txt(x).length >= 2 && x.getBoundingClientRect().width >= 8 && x.getBoundingClientRect().height >= 8); return !l; }); return [buscas.length > 0 && ruins.length === 0, `${ruins.length} sem rótulo visível`]; });
    T('TD42', () => {
      const p = painel(/sem resultado/i); if (!p) return [false, 'painel sem resultado ausente'];
      const i = [...p.querySelectorAll('input')].find(x => ['search', 'text'].includes(x.type)); if (!i) return [false, 'sem campo'];
      const q = i.value.trim(); const msg = [...p.querySelectorAll('p')].map(txt).join(' ');
      return [!i.disabled && !i.readOnly && q.length > 0 && msg.toLowerCase().includes(q.toLowerCase()) && /nenhum|n[ãa]o encontr|sem resultado/i.test(msg), `consulta="${q}" msg="${msg.slice(0, 60)}"`];
    });
    T('TD43', () => { const p = painel(/carregando/i); if (!p) return [false, 'painel carregando ausente']; const prog = p.querySelector('progress,[role="progressbar"],[aria-busy="true"]'); return [!!prog && !/nenhum|sem registro|sem resultado|vazi/i.test(txt(p)), `progresso=${!!prog}`]; });
    T('TD44', () => { const p = painel(/lista vazia/i); if (!p) return [false, 'painel vazio ausente']; const msg = [...p.querySelectorAll('p')].map(txt).join(' '); const a = [...p.querySelectorAll('a[href],button')].find(x => nome(x)); return [msg.length >= 50 && !!a, `texto=${msg.length} acao=${!!a}`]; });
    T('TD45', () => {
      const n = [...document.querySelectorAll('a,button')].filter(x => /^\d+$/.test(txt(x)));
      if (n.length < 2) return [false, 'sem itens de paginação'];
      const nav = n[0].closest('nav,[role="navigation"]'); if (!nav) return [false, 'sem nav'];
      const nm = nome({ getAttribute: a => nav.getAttribute(a), textContent: '', }) ;
      return [!!nm && !!nav.querySelector('[aria-current="page"],[aria-current="true"]'), `nome="${nm}"`];
    });
    T('TD48', () => [/p[aá]gina\s+\d+\s+de\s+\d+/i.test(document.title), `title="${document.title}"`]);
    T('TD50', () => {
      const nat = 'a[href],button,input,select,textarea,summary,label,option,details,th,td,tr,[contenteditable]';
      const rolesOk = ['button', 'switch', 'checkbox', 'radio', 'link', 'tab', 'menuitem', 'option', 'combobox', 'slider', 'textbox', 'menuitemcheckbox', 'menuitemradio', 'treeitem'];
      const sus = [...document.body.querySelectorAll('*')].filter(e => {
        if (e.matches(nat) || e.closest('a[href],button,select,label,summary,[role="switch"],[role="button"],[role="checkbox"],[role="radio"],[role="tab"],[role="link"]')) return false;
        if (!vis(e)) return false;
        const ti = e.getAttribute('tabindex');
        return (ti !== null && parseInt(ti, 10) >= 0) || cs(e).cursor === 'pointer';
      });
      const ruins = sus.filter(e => !rolesOk.includes(e.getAttribute('role')) || !nome(e));
      return [ruins.length === 0, `${sus.length} controles custom, ${ruins.length} sem papel/nome`];
    });
    T('AM16', () => { const ruins = [...document.querySelectorAll('[tabindex]')].filter(e => parseInt(e.getAttribute('tabindex'), 10) > 0); return [ruins.length === 0, `${ruins.length} tabindex positivos`]; });
    T('AM10', () => { const ok = ['col', 'row', 'colgroup', 'rowgroup']; const ruins = [...document.querySelectorAll('[scope]')].filter(e => !ok.includes(e.getAttribute('scope')) || !['TH'].includes(e.tagName)); return [ruins.length === 0, `${ruins.length} scope inválidos`]; });
    T('AM02', () => { const t = document.title.replace(/\(?\s*p[aá]gina\s+\d+\s+de\s+\d+\s*\)?/i, '').trim(); return [t.length >= 3 && !/^(sem t[ií]tulo|untitled|documento|document|index|nova p[aá]gina|p[aá]gina)$/i.test(t), `title="${document.title}"`]; });
    T('AM23', () => { const ruins = [...document.querySelectorAll('img')].filter(i => { if (i.getAttribute('role') === 'presentation' || i.getAttribute('aria-hidden') === 'true') return false; const a = i.getAttribute('alt'); if (a === null) return true; if (a === '') return false; return /\.(png|jpe?g|gif|svg|webp)$/i.test(a.trim()) || /^(img|image|imagem|foto|placeholder)[\s_\-]*\d*$/i.test(a.trim()); }); return [ruins.length === 0, `${ruins.length} imagens sem alt útil`]; });
    T('AM29', () => {
      const b = [...document.querySelectorAll('button[aria-expanded]')]; if (!b.length) return [false, 'sem acordeão'];
      const ruins = b.filter(x => { const p = x.parentElement; const h = p && (/^H[1-6]$/.test(p.tagName) || p.getAttribute('role') === 'heading'); const c = x.getAttribute('aria-controls'); return !(h && p.children.length === 1 && c && document.getElementById(c)); });
      return [ruins.length === 0, `${b.length} gatilhos, ${ruins.length} fora do padrão`];
    });
    T('AM43', () => {
      const sel = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="switch"],[role="button"],[role="checkbox"],[role="link"],[role="tab"],[tabindex]:not([tabindex^="-"])';
      const alvos = new Set(); [...document.querySelectorAll(sel)].forEach(e => { if (!vis(e) && !(e.closest('label') && vis(e.closest('label')))) return; alvos.add(['checkbox', 'radio'].includes(e.type) && e.closest('label') ? e.closest('label') : e); });
      const ruins = [...alvos].filter(e => { if (!vis(e)) return false; const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; });
      return [ruins.length === 0, `${alvos.size} alvos, ${ruins.length} menores que 44px`];
    });
    return out;
  });
  Object.assign(out, dom);

  // axe: reforça AM02, AM10, AM16 e AM23 com as regras correspondentes
  const ax = await pagina.evaluate(AXE_SRC).then(() => pagina.evaluate(async () => (await axe.run(document, { runOnly: { type: 'rule', values: ['document-title', 'scope-attr-valid', 'tabindex', 'image-alt'] } })).violations.map(v => v.id)));
  const mapa = { AM02: 'document-title', AM10: 'scope-attr-valid', AM16: 'tabindex', AM23: 'image-alt' };
  for (const [r, a] of Object.entries(mapa)) if (ax.includes(a)) out[r] = { ok: false, nota: (out[r].nota || '') + ` axe:${a}` };

  // TD26: aumenta o espaçamento de texto (WCAG 1.4.12) e procura texto cortado
  out.TD26 = await pagina.evaluate(() => {
    const st = document.createElement('style'); st.id = '__esp';
    st.textContent = '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}';
    document.head.appendChild(st);
    const cortados = [...document.body.querySelectorAll('*')].filter(e => {
      if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
      const s = getComputedStyle(e);
      if (!['hidden', 'clip'].includes(s.overflowX) && !['hidden', 'clip'].includes(s.overflowY)) return false;
      return e.clientHeight > 0 && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth);
    });
    st.remove();
    return { ok: cortados.length === 0, nota: `${cortados.length} elementos com texto cortado` };
  });

  // AM37: em tela estreita a página não pode rolar na horizontal; a tabela larga tem contêiner próprio
  await pagina.setViewportSize({ width: 375, height: 800 });
  out.AM37 = await pagina.evaluate(() => {
    const tb = [...document.querySelectorAll('table')].sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length)[0];
    let w = null;
    for (let p = tb.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { w = p; break; } }
    const pagOk = document.documentElement.scrollWidth <= window.innerWidth + 1;
    return { ok: pagOk && !!w, nota: `página ${document.documentElement.scrollWidth}px, contêiner rolável=${!!w}` };
  });
  await pagina.setViewportSize({ width: 1280, height: 800 });
  return Object.fromEntries(REGRAS.map(r => [r, out[r] || { ok: false, nota: 'sem verificação' }]));
}

export function ruido(html, seed) {
  const R = rng(seed * 31 + 7);
  const pref = 'r' + Math.floor(R() * 90 + 10) + '_';
  // 1) renomeia classes (HTML, CSS e script)
  const classes = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
  const lista = [...classes].sort((a, b) => b.length - a.length);
  const renomear = s => { for (const c of lista) s = s.replace(new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])', 'g'), '.' + pref + c); return s; };
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => '<style>' + renomear(css).replace(/\}\n/g, () => '} /* ' + Math.floor(R() * 999) + ' */\n').replace(/#fff\b(?!\w)/g, '#ffffff').replace(/#fff;/g, '#ffffff;') + '</style>');
  html = html.replace(/<script>([\s\S]*?)<\/script>/, (_, js) => '<script>' + renomear(js) + '</script>');
  html = html.replace(/class="([^"]*)"/g, (_, c) => 'class="' + c.split(/\s+/).filter(Boolean).map(x => pref + x).join(' ') + '"');
  // 2) embaralha a ordem dos atributos fora de style/script
  const partes = html.split(/(<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>)/);
  html = partes.map((p, i) => {
    if (i % 2) return p;
    return p.replace(/<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)+)\s*>/g, (_, tag, attrs) => {
      const as = attrs.match(/[\w:-]+(?:="[^"]*")?/g);
      return '<' + tag + ' ' + embaralhar(R, as).join(' ') + '>';
    });
  }).join('');
  // 3) comentários e linhas em branco sem efeito
  html = html.replace(/<\/tr>/g, () => '</tr><!-- ' + Math.floor(R() * 9999) + ' -->').replace(/<\/li>\n/g, '</li>\n\n').replace(/<\/section>/g, '</section>\n<!-- fim -->');
  return html;
}
