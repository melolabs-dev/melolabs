// Família "painel": painel de dados (tabela larga, filtros, ordenação, KPIs, gráfico SVG, paginação).
import { rng, pick, embaralhar } from '../comum.mjs';

export const ID = 'painel';
export const TITULO = 'Painel de dados';
export const REGRAS = ['TD01', 'TD03', 'TD05', 'TD07', 'TD09', 'TD11', 'TD14', 'TD17', 'TD19', 'TD25', 'TD27', 'TD28', 'TD29', 'TD31', 'TD32', 'AM01', 'AM09', 'AM15', 'AM22', 'AM28', 'AM35', 'AM42'];

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const NOMES_PESSOA = ['Ana Ribeiro', 'Bruno Tavares', 'Carla Mendes', 'Diego Farias', 'Elisa Prado', 'Fábio Nogueira', 'Gabriela Lopes', 'Heitor Cardoso'];

const TEMAS = [
  {
    id: 'logistica', app: 'Torre de Controle', org: 'Rota Segura Logística', ent: 'Remessas', pre: 'RM-',
    cols: ['Remessa', 'Cliente', 'Filial de origem', 'Data de saída', 'Situação', 'Volumes', 'Frete (R$)', 'Custo operacional (R$)', 'Entregas no prazo (%)', 'Índice de avaria', 'Peso total (kg)', 'Transportadora'],
    grupos: ['Identificação', 'Operação', 'Financeiro', 'Indicadores'],
    txt: ['Mercado Bom Preço', 'Farmácia Vida Plena', 'Distribuidora Alvorada', 'Casa & Obra Sul', 'Supermercados Pinheiro', 'Eletro Nova Era', 'Papelaria Central', 'Agro Campo Verde'],
    cat: ['Campinas', 'Curitiba', 'Recife', 'Goiânia', 'Porto Alegre'], cat2: ['TransLeste', 'Expresso Norte', 'RodoSul', 'Via Rápida', 'Cargas Unidas'],
    status: ['Entregue', 'Em trânsito', 'Aguardando coleta', 'Atrasada'],
    kpis: ['Receita de frete', 'Volumes movimentados', 'Entregas no prazo', 'Remessas atrasadas'],
    rotCat: 'filial', metr: ['Volumes', 'Frete', 'Entregas no prazo'], busca: 'Buscar remessa ou cliente',
  },
  {
    id: 'financas', app: 'Mesa de Crédito', org: 'Banco Horizonte Capital', ent: 'Contratos', pre: 'CT-',
    cols: ['Contrato', 'Cliente', 'Agência', 'Data de assinatura', 'Situação', 'Parcelas', 'Valor financiado (R$)', 'Saldo devedor (R$)', 'Taxa efetiva a.a. (%)', 'Índice de inadimplência', 'Prazo médio (dias)', 'Gerente'],
    grupos: ['Identificação', 'Andamento', 'Valores', 'Risco'],
    txt: ['Oficina Mecânica Ferraz', 'Padaria Estrela do Sul', 'Clínica Dental Sorriso', 'Transportes Lima & Filhos', 'Construtora Nova Obra', 'Moda Íntima Bela', 'Gráfica Rápida Impressos', 'Hotel Vista Serra'],
    cat: ['Centro', 'Zona Norte', 'Zona Sul', 'Barra', 'Pampulha'], cat2: NOMES_PESSOA.slice(0, 5),
    status: ['Quitado', 'Em dia', 'Em renegociação', 'Em atraso'],
    kpis: ['Carteira ativa', 'Parcelas a vencer', 'Taxa média efetiva', 'Contratos em atraso'],
    rotCat: 'agência', metr: ['Parcelas', 'Valor financiado', 'Taxa efetiva'], busca: 'Buscar contrato ou cliente',
  },
  {
    id: 'saude', app: 'Gestão Hospitalar', org: 'Hospital Santa Aurora', ent: 'Internações', pre: 'IN-',
    cols: ['Registro', 'Paciente (iniciais)', 'Ala', 'Data de admissão', 'Situação', 'Diárias', 'Custo da internação (R$)', 'Repasse do convênio (R$)', 'Ocupação do leito (%)', 'Índice de gravidade', 'Medicação total (mg)', 'Médico responsável'],
    grupos: ['Identificação', 'Atendimento', 'Financeiro', 'Clínico'],
    txt: ['M. A. Souza', 'J. P. Almeida', 'R. C. Barbosa', 'L. F. Teixeira', 'S. M. Duarte', 'T. R. Pires', 'V. L. Campos', 'H. B. Moreira'],
    cat: ['UTI adulto', 'Clínica médica', 'Pediatria', 'Maternidade', 'Ortopedia'], cat2: ['Dra. Helena Rocha', 'Dr. Paulo Vieira', 'Dra. Renata Dias', 'Dr. Otávio Lemos', 'Dra. Sofia Brandão'],
    status: ['Alta concedida', 'Internado', 'Em observação', 'Estado crítico'],
    kpis: ['Receita de convênios', 'Diárias no período', 'Ocupação média', 'Pacientes em estado crítico'],
    rotCat: 'ala', metr: ['Diárias', 'Custo', 'Ocupação'], busca: 'Buscar registro ou paciente',
  },
  {
    id: 'rh', app: 'Painel de Pessoas', org: 'Grupo Meridiano', ent: 'Colaboradores', pre: 'MT-',
    cols: ['Matrícula', 'Nome', 'Departamento', 'Data de admissão', 'Situação', 'Horas extras', 'Salário base (R$)', 'Custo total mensal (R$)', 'Avaliação de desempenho (%)', 'Índice de absenteísmo', 'Banco de horas (h)', 'Gestor'],
    grupos: ['Identificação', 'Vínculo', 'Remuneração', 'Desempenho'],
    txt: NOMES_PESSOA,
    cat: ['Comercial', 'Operações', 'Tecnologia', 'Financeiro', 'Jurídico'], cat2: ['Marcos Veloso', 'Patrícia Gomes', 'Rogério Alencar', 'Tânia Siqueira', 'Yuri Machado'],
    status: ['Ativo', 'Em férias', 'Afastado', 'Em desligamento'],
    kpis: ['Folha mensal', 'Horas extras no mês', 'Desempenho médio', 'Colaboradores afastados'],
    rotCat: 'departamento', metr: ['Horas extras', 'Salário base', 'Desempenho'], busca: 'Buscar matrícula ou nome',
  },
  {
    id: 'varejo', app: 'Central de Vendas', org: 'Lojas Aurora Brasil', ent: 'Pedidos', pre: 'PD-',
    cols: ['Pedido', 'Cliente', 'Loja', 'Data do pedido', 'Situação', 'Itens', 'Valor do pedido (R$)', 'Custo da mercadoria (R$)', 'Margem bruta (%)', 'Índice de devolução', 'Peso (kg)', 'Vendedor'],
    grupos: ['Identificação', 'Atendimento', 'Financeiro', 'Indicadores'],
    txt: ['Marina Albuquerque', 'Otávio Brandão', 'Juliana Campos', 'Renato Figueiredo', 'Luciana Moura', 'Eduardo Salgado', 'Beatriz Quintana', 'Caetano Ribas'],
    cat: ['Shopping Centro', 'Loja Norte', 'Loja Sul', 'Outlet Rodovia', 'Loja Virtual'], cat2: ['Camila Dantas', 'Felipe Rangel', 'Lívia Amaral', 'Gustavo Pessoa', 'Nádia Xavier'],
    status: ['Entregue', 'Em separação', 'Pagamento pendente', 'Cancelado'],
    kpis: ['Receita bruta', 'Itens vendidos', 'Margem bruta média', 'Pedidos cancelados'],
    rotCat: 'loja', metr: ['Itens', 'Receita', 'Margem bruta'], busca: 'Buscar pedido ou cliente',
  },
  {
    id: 'educacao', app: 'Secretaria Digital', org: 'Colégio Novo Saber', ent: 'Matrículas', pre: 'MA-',
    cols: ['Matrícula', 'Aluno', 'Unidade', 'Data de ingresso', 'Situação', 'Disciplinas', 'Mensalidade (R$)', 'Bolsa e descontos (R$)', 'Frequência (%)', 'Índice de aproveitamento', 'Carga horária (h)', 'Orientador'],
    grupos: ['Identificação', 'Vínculo', 'Financeiro', 'Desempenho'],
    txt: ['Lucas Andrade', 'Isabela Ferraz', 'Mateus Coelho', 'Helena Vasques', 'Davi Cordeiro', 'Aline Peixoto', 'Rafael Guedes', 'Bianca Sampaio'],
    cat: ['Unidade Centro', 'Unidade Jardins', 'Unidade Alto', 'Unidade Lagoa', 'Unidade Serra'], cat2: ['Prof. Ivan Moreira', 'Profa. Lúcia Fontes', 'Prof. Sérgio Matos', 'Profa. Elaine Cunha', 'Prof. Nuno Barreto'],
    status: ['Matriculado', 'Em renovação', 'Trancada', 'Evadido'],
    kpis: ['Receita de mensalidades', 'Disciplinas ofertadas', 'Frequência média', 'Alunos evadidos'],
    rotCat: 'unidade', metr: ['Disciplinas', 'Mensalidade', 'Frequência'], busca: 'Buscar matrícula ou aluno',
  },
];

export function variante(seed) {
  const R = rng(seed * 7919 + 13);
  const t = TEMAS[seed % TEMAS.length];
  const n = 12;
  const linhas = [];
  for (let i = 0; i < n; i++) {
    const mes = 1 + Math.floor(R() * 10), dia = 1 + Math.floor(R() * 28);
    const v = Math.round((1200 + R() * 94000) * 100) / 100;
    linhas.push({
      id: t.pre + (10000 + Math.floor(R() * 89000)),
      txt: pick(R, t.txt), cat: pick(R, t.cat),
      data: { y: 2026, m: mes, d: dia },
      status: Math.floor(R() * 4),
      inteiro: 20 + Math.floor(R() * 2300),
      v1: v, v2: Math.round(v * (0.45 + R() * 0.4) * 100) / 100,
      pct: Math.round(R() * 1000) / 10,
      idx: Math.round((0.2 + R() * 0.79) * 100) / 100,
      dec: Math.round((12 + R() * 4800) * 10) / 10,
      cat2: pick(R, t.cat2),
    });
  }
  linhas.sort((a, b) => (b.data.m - a.data.m) || (b.data.d - a.data.d));
  const soma = k => linhas.reduce((s, l) => s + l[k], 0);
  const totais = { inteiro: soma('inteiro'), v1: soma('v1'), v2: soma('v2'), pct: soma('pct') / n, idx: soma('idx') / n, dec: soma('dec') };
  const porCat = t.cat.map(c => ({ nome: c, v: linhas.filter(l => l.cat === c).reduce((s, l) => s + l.v1, 0) }));
  const total = porCat.reduce((s, c) => s + c.v, 0) || 1;
  const ranking = [...porCat].sort((a, b) => b.v - a.v).map(c => ({ ...c, part: c.v / total * 100 }));
  const resumo = t.metr.map((m, i) => ({ nome: m, q: [0, 1, 2, 3].map(() => i === 0 ? 800 + Math.floor(R() * 9000) : i === 1 ? Math.round((90000 + R() * 600000) * 100) / 100 : Math.round(R() * 1000) / 10) }));
  const kpis = [
    { v: totais.v1, tipo: 'moeda', delta: Math.round((R() * 20 - 8) * 10) / 10 },
    { v: totais.inteiro, tipo: 'int', delta: Math.round((R() * 20 - 8) * 10) / 10 },
    { v: totais.pct, tipo: 'pct', delta: Math.round((R() * 8 - 4) * 10) / 10 },
    { v: linhas.filter(l => l.status === 3).length, tipo: 'int', delta: Math.round((R() * 12 - 6) * 10) / 10 },
  ];
  return {
    seed, tema: t, linhas, totais, ranking, resumo, kpis, porCat,
    totalRegistros: 1200 + Math.floor(R() * 8000),
    atualizado: { y: 2026, m: 11, d: 1 + Math.floor(R() * 9), h: 8 + Math.floor(R() * 10), min: Math.floor(R() * 60) },
    ordenarPor: pick(R, [6, 7, 3, 8]),
  };
}

function fmtNum(n, dec, bad) {
  const neg = n < 0; n = Math.abs(n);
  const s = n.toFixed(dec);
  let [i, f] = s.split('.');
  if (!bad) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  else if (i === '0' && f !== undefined) i = '';
  return (neg ? '-' : '') + i + (f !== undefined ? ',' + f : '');
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64 = s => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
const IMG_LOGO = b64('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1a56db"/><path d="M7 22l6-8 5 5 7-10" fill="none" stroke="#fff" stroke-width="3"/></svg>');
const IMG_VAZIO = b64('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110" viewBox="0 0 160 110"><rect x="10" y="20" width="140" height="80" rx="8" fill="#e8edf4"/><rect x="26" y="40" width="70" height="8" rx="4" fill="#c5cedb"/><rect x="26" y="58" width="100" height="8" rx="4" fill="#c5cedb"/><circle cx="128" cy="30" r="18" fill="#9db6ee"/></svg>');
const IMG_AVATAR = b64('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#9db6ee"/><circle cx="16" cy="13" r="6" fill="#fff"/><path d="M5 28c2-7 20-7 22 0z" fill="#fff"/></svg>');

function passoBonito(max) {
  const bruto = max / 4; const p = Math.pow(10, Math.floor(Math.log10(bruto)));
  const f = bruto / p; const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return m * p;
}

export function construir(vr, violar) {
  const t = vr.tema;
  const v = id => violar.has(id);
  const N = (x, d = 0) => fmtNum(x, d, v('TD29'));
  const R$ = x => 'R$ ' + N(x, 2);
  const dataTxt = d => v('TD28') ? `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}` : `${d.d} ${MES[d.m - 1]} ${d.y}`;
  const iso = d => `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  const tempo = d => v('TD27') ? dataTxt(d) : `<time datetime="${iso(d)}">${dataTxt(d)}</time>`;
  const a = vr.atualizado;
  const hora = `${a.h}:${String(a.min).padStart(2, '0')}`;
  const atualizadoHtml = v('TD27')
    ? `${dataTxt(a)}, ${hora}`
    : `<time datetime="${iso(a)}T${String(a.h).padStart(2, '0')}:${String(a.min).padStart(2, '0')}">${dataTxt(a)}, ${hora}</time>`;
  const ariaNav = txt => v('AM15') ? '' : ` aria-label="${txt}"`;
  const selos = ['ok', 'and', 'aten', 'crit'];

  // ---- CSS ----
  const css = [];
  css.push(`:root{--c-fundo:#f4f6f9;--c-sup:#ffffff;--c-borda:#d5dbe3;--c-texto:#1c2430;--c-suave:#4a5668;--c-prim:#1a56db;--c-prim-esc:#123f9f;--c-cab:#e8edf4;--c-linha:#f7f9fc;--c-ok:#0f7b4a;--c-and:#1a56db;--c-aten:#8a5a00;--c-crit:#b42318;--r:8px;--e1:4px;--e2:8px;--e3:12px;--e4:16px;--e5:24px;--fonte:system-ui,"Segoe UI",Roboto,Arial,sans-serif;--sombra:0 1px 2px rgba(16,24,40,.08)}`);
  css.push(`*{box-sizing:border-box}`);
  css.push(`body{margin:0;background:var(--c-fundo);color:var(--c-texto);font:14px/1.5 var(--fonte)}`);
  if (!v('AM42')) css.push(`img{max-width:100%;height:auto}`);
  css.push(`.so{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`);
  css.push(`.pular{position:absolute;left:-9999px;top:0;padding:8px 12px;background:var(--c-prim);color:#fff}`);
  css.push(`.pular:focus{left:8px;top:8px}`);
  css.push(`.topo{display:flex;flex-wrap:wrap;align-items:center;gap:var(--e3);padding:var(--e3) var(--e4);background:var(--c-sup);border-bottom:1px solid var(--c-borda)}`);
  css.push(`.marca{display:flex;align-items:center;gap:var(--e2);font-weight:700;font-size:16px}`);
  css.push(`.usuario{margin-left:auto;display:flex;align-items:center;gap:var(--e2)}`);
  css.push(`.app{display:grid;grid-template-columns:220px minmax(0,1fr);gap:var(--e4);padding:var(--e4);max-width:1440px;margin:0 auto}`);
  css.push(`.lateral{background:var(--c-sup);border:1px solid var(--c-borda);border-radius:var(--r);padding:var(--e2);align-self:start}`);
  css.push(`.lateral ul{list-style:none;margin:0;padding:0}`);
  css.push(`.lateral a{display:block;padding:8px 12px;border-radius:6px;color:var(--c-texto);text-decoration:none}`);
  css.push(`.lateral a[aria-current=page]{background:var(--c-cab);font-weight:600}`);
  css.push(`.trilha ol{display:flex;flex-wrap:wrap;gap:var(--e2);list-style:none;margin:0 0 var(--e3);padding:0;color:var(--c-suave)}`);
  css.push(`.trilha a{display:inline-block;padding:4px 2px;min-height:24px;color:var(--c-prim-esc)}`);
  css.push(`h1{font-size:24px;margin:0 0 var(--e1)}`);
  css.push(`h2{font-size:18px;margin:0 0 var(--e3)}`);
  css.push(`h3{font-size:15px;margin:0 0 var(--e1)}`);
  css.push(`.sub{color:var(--c-suave);margin:0 0 var(--e4)}`);
  css.push(`.sub a,.nota a{color:var(--c-prim-esc)}`);
  css.push(`.nota{color:var(--c-suave);margin:var(--e3) 0}`);
  css.push(`.bloco{background:var(--c-sup);border:1px solid var(--c-borda);border-radius:var(--r);padding:var(--e4);margin-bottom:var(--e4);box-shadow:var(--sombra)}`);
  css.push(`.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--e3);margin-bottom:var(--e4)}`);
  css.push(`.kpi{background:var(--c-sup);border:1px solid var(--c-borda);border-radius:var(--r);padding:var(--e3) var(--e4)}`);
  css.push(`.kpi h3{font-size:13px;color:var(--c-suave);font-weight:600}`);
  css.push(`.kpi-valor{font-size:22px;font-weight:700;margin:0;overflow-wrap:anywhere}`);
  css.push(`.kpi-delta{margin:var(--e1) 0 0;font-size:12px;color:var(--c-suave)}`);
  css.push(`.alta{color:var(--c-ok);font-weight:600}`);
  css.push(`.queda{color:var(--c-crit);font-weight:600}`);
  css.push(`.filtros-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--e3);align-items:end}`);
  if (v('TD17')) css.push(`.filtros-grade{display:flex;width:980px;gap:var(--e3)}`);
  css.push(`.campo{display:flex;flex-direction:column;gap:var(--e1);min-width:0}`);
  css.push(`.campo label{font-size:12px;font-weight:600;color:var(--c-suave)}`);
  css.push(`input,select{height:34px;padding:0 var(--e2);border:1px solid var(--c-borda);border-radius:6px;background:#fff;font:inherit;width:100%;min-width:0}`);
  css.push(`.btn{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 var(--e3);border:1px solid var(--c-prim);border-radius:6px;background:var(--c-prim);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}`);
  css.push(`.btn.sec{background:#fff;color:var(--c-prim-esc)}`);
  css.push(`.acoes{display:flex;flex-wrap:wrap;gap:var(--e2);margin-top:var(--e3)}`);
  css.push(`.avancado{margin-top:var(--e3);padding:var(--e3);border:1px dashed var(--c-borda);border-radius:var(--r)}`);
  css.push(`.avancado[hidden]{display:none}`);
  css.push(`.rolagem{overflow:auto;max-height:520px;border:1px solid var(--c-borda);border-radius:var(--r);background:var(--c-sup)}`);
  css.push(`.rolagem-peq{overflow:auto;border:1px solid var(--c-borda);border-radius:var(--r)}`);
  css.push(`table{border-collapse:collapse;width:100%}`);
  css.push(`caption{text-align:left;font-weight:600;padding:var(--e2) var(--e3);color:var(--c-suave)}`);
  css.push(`.dados{min-width:1480px}`);
  css.push(`.resumo{min-width:480px}`);
  css.push(`.rank{min-width:340px}`);
  css.push(`th,td{padding:8px 12px;border-bottom:1px solid var(--c-borda);text-align:left;white-space:nowrap}`);
  css.push(`tbody tr:nth-child(even){background:var(--c-linha)}`);
  css.push(`.dados th.cab{background:var(--c-cab);position:sticky;${v('TD14') ? '' : 'top:0;'}z-index:2}`);
  css.push(`.dados th.cab1{height:40px;text-align:center;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--c-suave)}`);
  if (!v('TD14')) css.push(`.dados th.cab2{top:40px}`);
  css.push(`.ord{display:inline-flex;align-items:center;gap:var(--e1);min-height:28px;padding:2px 6px;border:0;border-radius:4px;background:transparent;font:inherit;font-weight:700;cursor:pointer;color:var(--c-texto)}`);
  css.push(`.dados tfoot th,.dados tfoot td{background:var(--c-cab);font-weight:700}`);
  css.push(`td.num{text-align:right}`);
  if (!v('TD11')) css.push(`td.num,tfoot td,.resumo td,.rank td,.rank th{font-variant-numeric:tabular-nums}`);
  css.push(`.selo{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid currentColor}`);
  css.push(`.selo.ok{color:var(--c-ok)}.selo.and{color:var(--c-and)}.selo.aten{color:var(--c-aten)}.selo.crit{color:var(--c-crit)}`);
  css.push(`.pag{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--e3);margin-top:var(--e3)}`);
  css.push(`.pag ul{display:flex;flex-wrap:wrap;gap:var(--e1);list-style:none;margin:0;padding:0}`);
  css.push(`.pag button{${v('TD25') ? 'width:18px;height:18px;padding:0;font-size:11px;' : 'width:34px;height:34px;'}border:1px solid var(--c-borda);border-radius:6px;background:#fff;font:inherit;cursor:pointer}`);
  css.push(`.pag button[aria-current=page]{background:var(--c-prim);border-color:var(--c-prim);color:#fff}`);
  css.push(`.pag .por-pagina{display:flex;align-items:center;gap:var(--e2)}`);
  css.push(`.pag .por-pagina select{width:auto}`);
  css.push(`.grafico svg{display:block;width:100%;height:auto;max-width:720px}`);
  css.push(`.grafico figcaption{color:var(--c-suave);margin-top:var(--e2)}`);
  css.push(`.barra{fill:var(--c-prim)}.eixo{stroke:var(--c-borda);stroke-width:1}.rot{font:12px var(--fonte);fill:var(--c-suave)}`);
  css.push(`.duas{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--e4)}`);
  css.push(`pre.rank-texto{margin:0;padding:var(--e3);background:var(--c-linha);border:1px solid var(--c-borda);border-radius:var(--r);overflow:auto;max-width:100%;font:13px/1.5 ui-monospace,Consolas,monospace}`);
  css.push(`.estados{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--e4)}`);
  css.push(`.estado{border:1px solid var(--c-borda);border-radius:var(--r);padding:var(--e4);background:var(--c-sup);min-width:0}`);
  css.push(`.esq{height:12px;border-radius:6px;background:var(--c-cab);margin:var(--e2) 0}`);
  css.push(`.esq.l{width:70%}.esq.m{width:45%}`);
  css.push(`.estado.erro{border-color:var(--c-crit)}`);
  css.push(`.estado.erro p{color:var(--c-crit)}`);
  css.push(`.rodape{max-width:1440px;margin:0 auto;padding:var(--e4);color:var(--c-suave);display:flex;flex-wrap:wrap;gap:var(--e4);justify-content:space-between}`);
  css.push(`.rodape ul{display:flex;flex-wrap:wrap;gap:var(--e4);list-style:none;margin:0;padding:0}`);
  css.push(`.rodape a{display:inline-block;padding:4px 0;min-height:28px;color:var(--c-prim-esc)}`);
  css.push(`@media (max-width:800px){.app{grid-template-columns:minmax(0,1fr);padding:var(--e3)}.lateral ul{display:flex;flex-wrap:wrap}.kpi-valor{font-size:18px}h1{font-size:20px}}`);

  // ---- Gráfico ----
  const maxV = Math.max(...vr.porCat.map(c => c.v), 1);
  const passo = passoBonito(maxV);
  const topo = Math.ceil(maxV / passo) * passo;
  const W = 640, H = 270, x0 = 90, x1 = 620, y0 = 20, y1 = 220;
  const yv = val => y1 - (val / topo) * (y1 - y0);
  const gTicks = [];
  for (let val = 0; val <= topo + 1; val += passo) {
    gTicks.push(`<line class="eixo" x1="${x0}" x2="${x1}" y1="${yv(val).toFixed(1)}" y2="${yv(val).toFixed(1)}"/>`);
    gTicks.push(`<text class="rot" x="${x0 - 8}" y="${(yv(val) + 4).toFixed(1)}" text-anchor="end">${N(val)}</text>`);
  }
  const larg = (x1 - x0) / vr.porCat.length;
  const gBarras = vr.porCat.map((c, i) => {
    const bx = x0 + i * larg + larg * 0.2, bw = larg * 0.6, by = yv(c.v);
    return `<rect class="barra" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${(y1 - by).toFixed(1)}"/>\n<text class="rot" x="${(bx + bw / 2).toFixed(1)}" y="${y1 + 18}" text-anchor="middle">${esc(c.nome)}</text>`;
  });
  const maior = [...vr.porCat].sort((p, q) => q.v - p.v)[0];
  const descGraf = `Gráfico de barras com a receita por ${t.rotCat}. ` + vr.porCat.map(c => `${c.nome}: ${R$(c.v)}`).join('; ') + `. A maior receita é de ${maior.nome}, com ${R$(maior.v)}.`;
  const svgAttrs = v('TD31') ? '' : ' role="img" aria-labelledby="graf-titulo" aria-describedby="graf-desc"';
  const svgTitulo = v('TD31') ? '' : `<title id="graf-titulo">Receita por ${t.rotCat}</title>\n`;
  const svgDesc = v('TD31') ? '' : `<p id="graf-desc" class="so">${esc(descGraf)}</p>`;

  // ---- Tabela principal ----
  const grupoSpans = [4, 2, 3, 3];
  const tipos = ['id', 'txt', 'cat', 'data', 'status', 'int', 'v1', 'v2', 'pct', 'idx', 'dec', 'cat2'];
  const sortAttr = i => {
    if (i === vr.ordenarPor) return ' aria-sort="descending"';
    if (v('TD19') && i > 0 && i % 2 === 1) return ' aria-sort="ascending"';
    return '';
  };
  const rowG = [`<tr>`];
  t.grupos.forEach((g, i) => rowG.push(`<th class="cab cab1" scope="colgroup" colspan="${grupoSpans[i]}">${g}</th>`));
  rowG.push(`</tr>`);
  const rowC = [`<tr>`];
  t.cols.forEach((c, i) => {
    const sc = v('TD03') ? '' : ' scope="col"';
    rowC.push(`<th class="cab cab2"${sc}${sortAttr(i)}><button type="button" class="ord">${esc(c)}</button></th>`);
  });
  rowC.push(`</tr>`);
  const cabLinhas = [...rowG, ...rowC];
  const celula = (l, tp) => {
    switch (tp) {
      case 'txt': return `<td>${esc(l.txt)}</td>`;
      case 'cat': return `<td>${esc(l.cat)}</td>`;
      case 'data': return `<td>${tempo(l.data)}</td>`;
      case 'status': return `<td><span class="selo ${selos[l.status]}">${esc(t.status[l.status])}</span></td>`;
      case 'int': return `<td class="num">${N(l.inteiro)}</td>`;
      case 'v1': return `<td class="num">${R$(l.v1)}</td>`;
      case 'v2': return `<td class="num">${R$(l.v2)}</td>`;
      case 'pct': return `<td class="num">${N(l.pct, 1)}%</td>`;
      case 'idx': return `<td class="num">${N(l.idx, 2)}</td>`;
      case 'dec': return `<td class="num">${N(l.dec, 1)}</td>`;
      case 'cat2': return `<td>${esc(l.cat2)}</td>`;
    }
    return '';
  };
  const dadosLinhas = vr.linhas.map(l => {
    const sc = v('TD03') ? '' : ' scope="row"';
    const cels = tipos.slice(1).map(tp => celula(l, tp));
    return [`<tr>`, `<th${sc}><a href="#${esc(l.id)}">${esc(l.id)}</a></th>`, ...cels, `</tr>`].join('\n');
  });
  const tt = vr.totais;
  const totalLinha = [`<tr>`, `<th${v('TD03') ? '' : ' scope="row"'}>Totais</th>`, `<td></td>`, `<td></td>`, `<td></td>`, `<td></td>`, `<td class="num">${N(tt.inteiro)}</td>`, `<td class="num">${R$(tt.v1)}</td>`, `<td class="num">${R$(tt.v2)}</td>`, `<td class="num">${N(tt.pct, 1)}%</td>`, `<td class="num">${N(tt.idx, 2)}</td>`, `<td class="num">${N(tt.dec, 1)}</td>`, `<td></td>`, `</tr>`];
  const tabAttrs = v('TD09') ? ' border="1" cellpadding="6" cellspacing="0" width="100%" summary="Listagem completa dos registros"' : '';
  const capPrinc = v('AM09') ? '' : `<caption>${t.ent} do período, ordenadas por ${esc(t.cols[vr.ordenarPor].replace(/ \(.*\)/, '').toLowerCase())}</caption>`;
  let tabelaPrinc;
  if (v('TD05')) {
    tabelaPrinc = [`<table class="dados"${tabAttrs}>`, capPrinc, `<tbody>`, ...cabLinhas, ...dadosLinhas, ...totalLinha, `</tbody>`, `</table>`];
  } else {
    tabelaPrinc = [`<table class="dados"${tabAttrs}>`, capPrinc, `<thead>`, ...cabLinhas, `</thead>`, `<tbody>`, ...dadosLinhas, `</tbody>`, `<tfoot>`, ...totalLinha, `</tfoot>`, `</table>`];
  }

  // ---- Resumo trimestral (headers/id) ----
  const idQ = i => v('TD07') ? `trim-${i + 1}` : `rs-q${i + 1}`;
  const refQ = i => v('TD07') ? `tri${i + 1}` : `rs-q${i + 1}`;
  const idM = i => `rs-m${i + 1}`;
  const refM = i => v('TD07') ? `met${i + 1}` : `rs-m${i + 1}`;
  const scr = v('TD03') ? '' : ' scope="col"';
  const scrw = v('TD03') ? '' : ' scope="row"';
  const resumoLinhas = vr.resumo.map((m, i) => {
    const cels = m.q.map((x, j) => {
      const txt = i === 0 ? N(x) : i === 1 ? R$(x) : N(x, 1) + '%';
      return `<td class="num" headers="${refQ(j)} ${refM(i)}">${txt}</td>`;
    });
    return [`<tr>`, `<th id="${idM(i)}"${scrw}>${esc(m.nome)}</th>`, ...cels, `</tr>`].join('\n');
  });
  const capRes = v('AM09') ? '' : `<caption>Resumo trimestral de 2026</caption>`;
  const headRes = [`<tr>`, `<th${scr}>Indicador</th>`, ...[0, 1, 2, 3].map(i => `<th id="${idQ(i)}"${scr}>T${i + 1}</th>`), `</tr>`];
  const tabelaRes = v('TD05')
    ? [`<table class="resumo">`, capRes, `<tbody>`, ...headRes, ...resumoLinhas, `</tbody>`, `</table>`]
    : [`<table class="resumo">`, capRes, `<thead>`, ...headRes, `</thead>`, `<tbody>`, ...resumoLinhas, `</tbody>`, `</table>`];

  // ---- Ranking (tabela ou pre) ----
  let rankHtml;
  if (v('TD01')) {
    const linhasPre = [`Pos  ${(t.rotCat[0].toUpperCase() + t.rotCat.slice(1)).padEnd(20)}${'Receita'.padStart(18)}  Part.`];
    vr.ranking.forEach((r, i) => linhasPre.push(`${i + 1}    ${r.nome.padEnd(20)}${R$(r.v).padStart(18)}  ${N(r.part, 1)}%`));
    rankHtml = `<pre class="rank-texto">${esc(linhasPre.join('\n'))}</pre>`;
  } else {
    const capR = v('AM09') ? '' : `<caption>Ranking por ${t.rotCat}</caption>`;
    const cabR = [`<tr>`, `<th${scr}>Posição</th>`, `<th${scr}>${t.rotCat[0].toUpperCase() + t.rotCat.slice(1)}</th>`, `<th${scr}>Receita</th>`, `<th${scr}>Participação</th>`, `</tr>`];
    const corpoR = vr.ranking.map((r, i) => [`<tr>`, `<th${scrw}>${i + 1}</th>`, `<td>${esc(r.nome)}</td>`, `<td class="num">${R$(r.v)}</td>`, `<td class="num">${N(r.part, 1)}%</td>`, `</tr>`].join('\n'));
    const todo = v('TD05')
      ? [`<table class="rank">`, capR, `<tbody>`, ...cabR, ...corpoR, `</tbody>`, `</table>`]
      : [`<table class="rank">`, capR, `<thead>`, ...cabR, `</thead>`, `<tbody>`, ...corpoR, `</tbody>`, `</table>`];
    rankHtml = `<div class="rolagem-peq">\n${todo.filter(Boolean).join('\n')}\n</div>`;
  }

  // ---- KPIs ----
  const kpiHtml = vr.kpis.map((k, i) => {
    const val = k.tipo === 'moeda' ? R$(k.v) : k.tipo === 'pct' ? N(k.v, 1) + '%' : N(k.v);
    const sinal = k.delta >= 0 ? '+' : '-';
    const cls = (i === 3 ? k.delta <= 0 : k.delta >= 0) ? 'alta' : 'queda';
    return `<article class="kpi">\n<h3>${esc(t.kpis[i])}</h3>\n<p class="kpi-valor">${val}</p>\n<p class="kpi-delta"><span class="${cls}">${sinal}${N(Math.abs(k.delta), 1)}%</span> <span>em relação ao período anterior</span></p>\n</article>`;
  }).join('\n');

  // ---- Paginação ----
  const pagBtns = [1, 2, 3, 4, 5].map(i => `<li><button type="button"${i === 1 ? ' aria-current="page"' : ''} aria-label="Página ${i}">${i}</button></li>`).join('\n');

  // ---- Toggles (AM28) ----
  const ctlAdv = v('AM28') ? 'painel-filtro-av' : 'painel-avancado';
  const ctlLeg = v('AM28') ? 'painel-leg' : 'painel-legenda';
  const exp = (b) => v('AM28') ? (b ? 'sim' : 'nao') : (b ? 'true' : 'false');

  const textoExport = v('AM22')
    ? `Para baixar os dados filtrados, <a href="#exportar-csv">clique aqui</a>.`
    : `Os dados filtrados podem ser baixados em <a href="#exportar-csv">planilha CSV com todos os registros do filtro</a>.`;

  const imgAlt = (alt) => v('TD32') ? '' : ` alt="${alt}"`;

  const html = `<!doctype html>
<html${v('AM01') ? '' : ' lang="pt-BR"'}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="${v('AM35') ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' : 'width=device-width, initial-scale=1'}">
<title>${t.ent} - ${t.app} | ${t.org}</title>
<style>
${css.join('\n')}
</style>
</head>
<body>
<a class="pular" href="#conteudo">Ir para o conteúdo principal</a>
<header class="topo">
<img src="${IMG_LOGO}" width="32" height="32"${imgAlt('Logotipo ' + esc(t.org))}>
<div class="marca">${esc(t.app)}</div>
<div class="usuario">
<img src="${IMG_AVATAR}" width="32" height="32"${v('TD32') ? '' : ' alt=""'}>
<span>Caio Mello</span>
<button type="button" class="btn sec">Sair</button>
</div>
</header>
<div class="app">
<nav class="lateral"${ariaNav('Navegação principal')}>
<ul>
<li><a href="#visao">Visão geral</a></li>
<li><a href="#painel" aria-current="page">${t.ent}</a></li>
<li><a href="#relatorios">Relatórios</a></li>
<li><a href="#metas">Metas do trimestre</a></li>
<li><a href="#config">Configurações</a></li>
</ul>
</nav>
<main id="conteudo">
<nav class="trilha"${ariaNav('Trilha de navegação')}>
<ol>
<li><a href="#inicio">Início</a></li>
<li><a href="#analises">Análises</a></li>
<li aria-current="page">${t.ent}</li>
</ol>
</nav>
<h1>${t.ent}</h1>
<p class="sub">${esc(t.org)}. Dados atualizados em ${atualizadoHtml}.</p>
<section aria-labelledby="tit-kpis">
<h2 id="tit-kpis" class="so">Indicadores principais</h2>
<div class="kpis">
${kpiHtml}
</div>
</section>
<section class="bloco" aria-labelledby="tit-filtros">
<h2 id="tit-filtros">Filtros</h2>
<form action="#" method="get">
<div class="filtros-grade">
<div class="campo"><label for="f-busca">${esc(t.busca)}</label><input id="f-busca" type="search" name="q" placeholder="Digite para buscar"></div>
<div class="campo"><label for="f-cat">${t.rotCat[0].toUpperCase() + t.rotCat.slice(1)}</label><select id="f-cat" name="cat"><option>Todas</option>${t.cat.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
<div class="campo"><label for="f-sit">Situação</label><select id="f-sit" name="sit"><option>Todas</option>${t.status.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
<div class="campo"><label for="f-de">De</label><input id="f-de" type="date" name="de" value="2026-01-01"></div>
<div class="campo"><label for="f-ate">Até</label><input id="f-ate" type="date" name="ate" value="2026-10-31"></div>
</div>
<div class="acoes">
<button type="submit" class="btn">Aplicar filtros</button>
<button type="reset" class="btn sec">Limpar</button>
<button type="button" class="btn sec" aria-expanded="${exp(true)}" aria-controls="${ctlAdv}">Filtros avançados</button>
</div>
<div id="painel-avancado" class="avancado">
<div class="filtros-grade">
<div class="campo"><label for="f-min">Valor mínimo (R$)</label><input id="f-min" type="number" name="min" min="0" placeholder="0"></div>
<div class="campo"><label for="f-max">Valor máximo (R$)</label><input id="f-max" type="number" name="max" min="0" placeholder="100000"></div>
<div class="campo"><label for="f-resp">${esc(t.cols[11])}</label><select id="f-resp" name="resp"><option>Todos</option>${t.cat2.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
</div>
</div>
</form>
</section>
<section class="bloco" aria-labelledby="tit-tabela" id="painel">
<h2 id="tit-tabela">Registros detalhados</h2>
<div class="rolagem" role="region" aria-label="Rolagem horizontal da tabela de ${t.ent.toLowerCase()}" tabindex="0">
${tabelaPrinc.filter(Boolean).join('\n')}
</div>
<div class="pag">
<p>Exibindo 1 a 12 de ${N(vr.totalRegistros)} registros</p>
<nav${ariaNav('Paginação')}>
<ul>
<li><button type="button" aria-label="Página anterior">&lsaquo;</button></li>
${pagBtns}
<li><button type="button" aria-label="Próxima página">&rsaquo;</button></li>
</ul>
</nav>
<div class="por-pagina"><label for="pp">Itens por página</label><select id="pp"><option>10</option><option selected>12</option><option>25</option><option>50</option><option>100</option></select></div>
</div>
<p class="nota">${textoExport}</p>
</section>
<section class="bloco" aria-labelledby="tit-grafico">
<h2 id="tit-grafico">Receita por ${t.rotCat}</h2>
<figure class="grafico" style="margin:0">
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"${svgAttrs}>
${svgTitulo}${gTicks.join('\n')}
${gBarras.join('\n')}
</svg>
${svgDesc}
<figcaption>Receita acumulada no período, em reais, agrupada por ${t.rotCat}.</figcaption>
</figure>
<div class="acoes"><button type="button" class="btn sec" aria-expanded="${exp(false)}" aria-controls="${ctlLeg}">Como ler este gráfico</button></div>
<div id="painel-legenda" class="avancado" hidden>
<p>Cada barra representa a soma do valor dos registros de uma ${t.rotCat}. A escala vertical começa em zero.</p>
</div>
</section>
<div class="duas">
<section class="bloco" aria-labelledby="tit-resumo">
<h2 id="tit-resumo">Resumo trimestral</h2>
<div class="rolagem-peq">
${tabelaRes.filter(Boolean).join('\n')}
</div>
</section>
<section class="bloco" aria-labelledby="tit-rank">
<h2 id="tit-rank">Ranking</h2>
${rankHtml}
</section>
</div>
<section class="bloco" aria-labelledby="tit-estados">
<h2 id="tit-estados">Estados de exibição</h2>
<div class="estados">
<div class="estado" role="status">
<h3>Carregando</h3>
<div class="esq"></div>
<div class="esq l"></div>
<div class="esq m"></div>
<p>Carregando registros do período...</p>
</div>
<div class="estado">
<img src="${IMG_VAZIO}" width="160" height="110"${v('TD32') ? '' : ' alt=""'}>
<h3>Nenhum resultado</h3>
<p>Nenhum registro corresponde aos filtros aplicados.</p>
<button type="button" class="btn sec">Limpar filtros</button>
</div>
<div class="estado erro" role="alert">
<h3>Falha ao carregar</h3>
<p>Não foi possível carregar os dados. A conexão com o servidor foi interrompida.</p>
<button type="button" class="btn">Tentar novamente</button>
</div>
</div>
</section>
</main>
</div>
<footer class="rodape">
<span>&copy; 2026 ${esc(t.org)}. Todos os direitos reservados.</span>
<nav${ariaNav('Rodapé')}>
<ul>
<li><a href="#privacidade">Política de privacidade</a></li>
<li><a href="#termos">Termos de uso</a></li>
<li><a href="#ajuda">Central de ajuda</a></li>
</ul>
</nav>
</footer>
<script>
document.querySelectorAll('button[aria-controls]').forEach(function (b) {
  b.addEventListener('click', function () {
    var p = document.getElementById(b.getAttribute('aria-controls'));
    if (!p) return;
    var aberto = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', String(!aberto));
    p.hidden = aberto;
  });
});
</script>
</body>
</html>
`;
  return html;
}

// ---- Checagem independente (só DOM renderizado) ----
export async function checar(pagina) {
  const res = {};
  const set = (id, ok, nota) => { res[id] = { ok: !!ok, nota: nota || '' }; };

  // TD17 em viewport estreito (primeiro; depois restaura)
  await pagina.setViewportSize({ width: 390, height: 800 });
  const mob = await pagina.evaluate(() => {
    const larguraDoc = document.documentElement.scrollWidth;
    const iw = window.innerWidth;
    let contido = false;
    for (const el of document.querySelectorAll('div,section')) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.querySelector('table')) { contido = true; break; }
    }
    return { larguraDoc, iw, contido };
  });
  await pagina.setViewportSize({ width: 1280, height: 800 });
  set('TD17', mob.larguraDoc <= mob.iw + 1 && mob.contido, `doc ${mob.larguraDoc}px / viewport ${mob.iw}px; tabela em rolagem contida: ${mob.contido}`);

  const d = await pagina.evaluate(() => {
    const o = {};
    const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const tabelas = [...document.querySelectorAll('table')];
    const dadosT = tabelas.filter(t => t.querySelector('th'));

    // TD01
    const pres = [...document.querySelectorAll('*')].filter(e => /^pre/.test(getComputedStyle(e).whiteSpace) && vis(e) && e.children.length === 0 && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE').filter(e => {
      const ls = e.textContent.split('\n').filter(l => /\S {2,}\S/.test(l)); return ls.length >= 2;
    });
    o.TD01 = [pres.length === 0, `${pres.length} bloco(s) alinhado(s) com espaços`];

    // TD03
    const semScope = [...document.querySelectorAll('th')].filter(th => !th.hasAttribute('scope'));
    o.TD03 = [semScope.length === 0, `${semScope.length} th sem scope`];

    // TD05
    let td05 = dadosT.length > 0; const n05 = [];
    for (const t of dadosT) if (!t.querySelector('thead th')) { td05 = false; n05.push('sem thead'); }
    const maxCols = Math.max(...dadosT.map(t => Math.max(...[...t.rows].map(r => r.cells.length))));
    const princ = dadosT.find(t => Math.max(...[...t.rows].map(r => r.cells.length)) === maxCols);
    if (!princ || !princ.querySelector('tfoot tr')) { td05 = false; n05.push('tabela principal sem tfoot'); }
    o.TD05 = [td05, n05.join('; ')];

    // TD07
    const hs = [...document.querySelectorAll('[headers]')];
    let ruins = 0;
    for (const c of hs) for (const tok of c.getAttribute('headers').split(/\s+/).filter(Boolean)) {
      const alvo = document.getElementById(tok);
      if (!alvo || alvo.closest('table') !== c.closest('table')) ruins++;
    }
    o.TD07 = [hs.length > 0 && ruins === 0, `${hs.length} células com headers, ${ruins} referências inválidas`];

    // TD09
    const obs = document.querySelectorAll('table[align],table[bgcolor],table[border],table[cellpadding],table[cellspacing],table[width],table[summary],thead[align],tbody[align],tr[align],tr[bgcolor],td[align],td[bgcolor],td[width],th[align],th[bgcolor],th[width],col[width],col[align]');
    o.TD09 = [obs.length === 0, `${obs.length} elementos com atributos obsoletos`];

    // TD11
    const re = /^[-+]?\s*(R\$\s*)?[\d.,]*\d[\d.,]*\s*(%|kg|h|mg)?$/;
    let num = 0, semTab = 0;
    for (const c of document.querySelectorAll('td,th')) {
      const tx = c.textContent.trim();
      if (tx && re.test(tx) && c.children.length === 0) { num++; if (!getComputedStyle(c).fontVariantNumeric.includes('tabular-nums')) semTab++; }
    }
    o.TD11 = [num > 0 && semTab === 0, `${semTab} de ${num} células numéricas sem tabular-nums`];

    // TD14
    const sticky = [...document.querySelectorAll('th')].filter(th => getComputedStyle(th).position === 'sticky');
    let td14 = sticky.length > 0, n14 = `${sticky.length} th sticky`;
    for (const th of sticky) {
      if (getComputedStyle(th).top === 'auto') { td14 = false; n14 = 'sticky sem top'; break; }
      let p = th.parentElement, ok = false;
      while (p && p !== document.body) { if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY) && p.tagName !== 'TABLE') { ok = true; break; } p = p.parentElement; }
      if (!ok) { td14 = false; n14 = 'sem ancestral de rolagem'; break; }
    }
    o.TD14 = [td14, n14];

    // TD19
    const sorts = [...document.querySelectorAll('[aria-sort]')].filter(e => /^(ascending|descending)$/.test(e.getAttribute('aria-sort')));
    o.TD19 = [sorts.length === 1, `${sorts.length} cabeçalhos com aria-sort ativo`];

    // TD25
    const pequenos = [];
    for (const e of document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button]')) {
      if (!vis(e)) continue;
      if (e.tagName === 'A' && getComputedStyle(e).display === 'inline') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) pequenos.push(`${e.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    o.TD25 = [pequenos.length === 0, `${pequenos.length} alvos pequenos ${pequenos.slice(0, 2).join(', ')}`];

    // TD27 / TD28
    const reData = /\b\d{1,2}\s+(de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?(\s+de)?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/i;
    const reNum = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s?[º°ª]|\b\d+(st|nd|rd|th)\b/;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let semTime = 0, numericas = 0, nTime = document.querySelectorAll('time').length;
    while (w.nextNode()) {
      const n = w.currentNode; const p = n.parentElement;
      if (!p || ['SCRIPT', 'STYLE'].includes(p.tagName)) continue;
      const tx = n.textContent;
      if (reData.test(tx) && !p.closest('time')) semTime++;
      if (reNum.test(tx)) numericas++;
    }
    o.TD27 = [nTime > 0 && semTime === 0, `${semTime} datas/horas fora de time; ${nTime} time`];
    o.TD28 = [numericas === 0, `${numericas} datas numéricas/ordinais`];

    // TD29
    const rePuro = /^[-+]?\s*(R\$\s*)?([\d.,]*\d[\d.,]*)\s*(%|kg|h|mg)?$/;
    let n29 = 0, ex29 = '';
    for (const e of document.body.querySelectorAll('*')) {
      if (e.children.length || ['SCRIPT', 'STYLE'].includes(e.tagName)) continue;
      const m = rePuro.exec(e.textContent.trim());
      if (!m) continue;
      const tok = m[2];
      if (/^\d{4,}/.test(tok) || /^[,.]\d/.test(tok)) { n29++; ex29 = ex29 || tok; }
    }
    o.TD29 = [n29 === 0, `${n29} números mal formatados ${ex29}`];

    // TD31
    const grandes = [...document.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.width >= 200 && r.height >= 100; });
    let td31 = grandes.length > 0, n31 = `${grandes.length} gráfico(s)`;
    for (const s of grandes) {
      let nome = s.getAttribute('aria-label') || '';
      const lb = s.getAttribute('aria-labelledby');
      if (!nome && lb) nome = lb.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
      if (!nome) { const ti = s.querySelector('title'); nome = ti ? ti.textContent.trim() : ''; }
      const db = s.getAttribute('aria-describedby');
      const desc = db ? db.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim() : '';
      const role = s.getAttribute('role');
      if (role !== 'img' || nome.length < 5 || nome.length > 150 || desc.length < 60) { td31 = false; n31 = `role=${role} nome=${nome.length} desc=${desc.length}`; }
    }
    o.TD31 = [td31, n31];

    // TD32
    const imgs = [...document.querySelectorAll('img')];
    let n32 = 0;
    for (const im of imgs) {
      if (!im.hasAttribute('alt')) { n32++; continue; }
      const al = im.getAttribute('alt').trim();
      if (/\.(png|jpe?g|svg|gif|webp)\b/i.test(al) || /^(imagem|image|foto|img)$/i.test(al)) { n32++; continue; }
      if (al === '') {
        const ctl = im.closest('a,button');
        if (ctl && !ctl.textContent.trim() && !ctl.getAttribute('aria-label')) n32++;
      }
    }
    o.TD32 = [imgs.length > 0 && n32 === 0, `${n32} de ${imgs.length} imagens com alt inadequado`];

    // AM01
    const lang = document.documentElement.getAttribute('lang') || '';
    o.AM01 = [/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(lang), `lang="${lang}"`];

    // AM09
    let n09 = 0;
    for (const t of dadosT) {
      const c = t.querySelector('caption'); const tx = c ? c.textContent.trim() : '';
      if (tx.length < 3 || tx.length > 140 || tx === (t.getAttribute('summary') || '').trim()) n09++;
    }
    o.AM09 = [dadosT.length > 0 && n09 === 0, `${n09} de ${dadosT.length} tabelas sem caption adequado`];

    // AM15
    const grupos = {};
    for (const e of document.querySelectorAll('nav,[role=navigation],aside,[role=complementary],[role=search],section[aria-label],section[aria-labelledby],[role=region]')) {
      const tag = e.tagName.toLowerCase(), rl = e.getAttribute('role');
      const papel = rl === 'region' || (tag === 'section') ? 'region' : (tag === 'nav' || rl === 'navigation') ? 'nav' : (tag === 'aside' || rl === 'complementary') ? 'aside' : 'search';
      let nome = (e.getAttribute('aria-label') || '').trim();
      const lb = e.getAttribute('aria-labelledby');
      if (!nome && lb) nome = lb.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
      (grupos[papel] = grupos[papel] || []).push(nome);
    }
    let n15 = 0;
    for (const [p, nomes] of Object.entries(grupos)) {
      if (nomes.length < 2) continue;
      if (nomes.some(n => !n) || new Set(nomes.map(n => n.toLowerCase())).size !== nomes.length) n15++;
    }
    o.AM15 = [n15 === 0, `grupos de landmark sem nome único: ${n15} (${Object.entries(grupos).map(([k, v]) => k + ':' + v.length).join(',')})`];

    // AM22
    const ruins22 = [...document.querySelectorAll('a')].filter(a => { const tx = a.textContent.trim().toLowerCase().replace(/[.!]+$/, ''); return /clique aqui/.test(tx) || /^(aqui|clique|saiba mais|leia mais|veja mais|ver mais|mais)$/.test(tx); });
    o.AM22 = [ruins22.length === 0, `${ruins22.length} links genéricos`];

    // AM28
    const tg = [...document.querySelectorAll('button[aria-controls],button[aria-expanded]')];
    let n28 = 0;
    for (const b of tg) {
      const ex = b.getAttribute('aria-expanded'); const ct = (b.getAttribute('aria-controls') || '').trim();
      if (!(ex === 'true' || ex === 'false') || !ct || ct.split(/\s+/).some(i => !document.getElementById(i))) n28++;
    }
    o.AM28 = [tg.length > 0 && n28 === 0, `${n28} de ${tg.length} botões de painel inválidos`];

    // AM35
    const mv = document.querySelector('meta[name=viewport]');
    const mc = mv ? mv.getAttribute('content') || '' : '';
    const mx = /maximum-scale\s*=\s*([\d.]+)/.exec(mc);
    o.AM35 = [!!mv && !/user-scalable\s*=\s*(no|0)/i.test(mc) && !(mx && parseFloat(mx[1]) < 2), `viewport="${mc}"`];

    // AM42
    const im2 = imgs.filter(i => getComputedStyle(i).maxWidth !== '100%');
    o.AM42 = [imgs.length > 0 && im2.length === 0, `${im2.length} de ${imgs.length} imagens sem max-width:100%`];
    return o;
  });
  for (const [id, [ok, nota]] of Object.entries(d)) set(id, ok, nota);
  return res;
}

// ---- Ruído sem efeito para o usuário ----
const CLASSES_RUIDO = ['kpi', 'kpi-valor', 'kpi-delta', 'bloco', 'campo', 'acoes', 'selo', 'ord', 'avancado', 'estado', 'grafico', 'pag', 'topo', 'lateral', 'trilha', 'rodape', 'barra', 'rot', 'eixo', 'duas'];
export function ruido(html, seed) {
  const R = rng(seed * 104729 + 7);
  const sfx = 'x' + Math.floor(R() * 9000 + 1000);
  const cabecaAntes = html.indexOf('<style>');
  // 1) classes renomeadas de forma consistente (CSS + atributos class)
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (m, css) => {
    for (const c of CLASSES_RUIDO) css = css.replace(new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])', 'g'), '.' + c + '-' + sfx);
    css = css.replace(/#([0-9a-f]{3,8})\b/g, (_, h) => '#' + h.toUpperCase());
    css = css.replace(/\n/g, R() < 0.5 ? '\n\n' : '\n');
    return '<style>' + css + '</style>';
  });
  html = html.replace(/ class="([^"]*)"/g, (m, v) => ' class="' + v.split(/\s+/).map(c => CLASSES_RUIDO.includes(c) ? c + '-' + sfx : c).join(' ') + '"');
  // 2) ordem dos atributos embaralhada (somente em tags simples, fora de style/script)
  html = html.replace(/<([a-z][a-z0-9]*)((?:\s+[a-zA-Z:-]+(?:="[^"]*")?)+)\s*(\/?)>/g, (m, tag, attrs, fim) => {
    const lista = attrs.match(/\s+[a-zA-Z:-]+(?:="[^"]*")?/g).map(s => s.trim());
    if (lista.length < 2) return m;
    return '<' + tag + ' ' + embaralhar(R, lista).join(' ') + (fim ? ' /' : '') + '>';
  });
  // 3) comentários antes de seções/linhas e espaços extras entre tags
  html = html.replace(/\n(<(?:section|tr|li)[ >])/g, (m, t) => R() < 0.35 ? `\n<!-- bloco ${Math.floor(R() * 1000)} -->\n${t}` : m);
  html = html.replace(/>\n</g, () => R() < 0.3 ? '>\n\n  <' : '>\n<');
  html = html.replace(/<\/body>/, '<!-- fim -->\n</body>');
  return html;
}
