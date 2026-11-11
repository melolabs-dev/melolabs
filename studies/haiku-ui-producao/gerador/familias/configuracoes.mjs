// Família "configuracoes": tela de configurações da conta / perfil (estudo 3b).
import { rng, pick, embaralhar, AXE_SRC } from '../comum.mjs';

export const ID = 'configuracoes';
export const TITULO = 'Configurações da conta';
export const REGRAS = ['NE39', 'NE44', 'NE47', 'NE49', 'NE50', 'NE16', 'NE18', 'NE20', 'NE23', 'NE25', 'NE32', 'NE34', 'AM06', 'AM13', 'AM20', 'AM26', 'AM32', 'AM40', 'AM46'];

const TEMAS = [
  { id: 'logistica', empresa: 'TransLog Cargas', produto: 'Painel de Frota', dominio: 'translog.com.br', objetos: 'veículos, rotas e cargas', consequencia: 'o histórico de rotas, manifestos e alertas da frota',
    cargos: ['Coordenador de operações', 'Analista de roteirização', 'Gerente de frota', 'Despachante'], cidades: ['Campinas', 'Curitiba', 'Goiânia'],
    apps: [['Rastreio GPS Frotas', 'Ler posição dos veículos'], ['Planilhas de Custos', 'Exportar relatórios de combustível'], ['Agenda Compartilhada', 'Criar eventos de entrega'], ['Conciliador Fiscal', 'Ler notas fiscais emitidas'], ['Alertas por mensagem', 'Enviar avisos de atraso'], ['Balança Digital', 'Gravar pesagens de carga']],
    notifs: ['Atraso em entregas', 'Manutenção preventiva vencendo', 'Desvio de rota detectado', 'Resumo diário da frota'] },
  { id: 'financas', empresa: 'Banco Horizonte', produto: 'Gestão de Tesouraria', dominio: 'bancohorizonte.com.br', objetos: 'contas, extratos e lançamentos', consequencia: 'extratos, conciliações e limites de aprovação',
    cargos: ['Analista financeiro', 'Tesoureira', 'Controller', 'Auditor interno'], cidades: ['São Paulo', 'Belo Horizonte', 'Porto Alegre'],
    apps: [['Contabilidade Online', 'Ler lançamentos contábeis'], ['Conciliador Bancário', 'Ler extratos das contas'], ['Aprovações Móveis', 'Aprovar pagamentos até o limite'], ['Planilha de Fluxo de Caixa', 'Exportar saldos diários'], ['Emissor de Boletos', 'Criar cobranças em seu nome'], ['Auditoria Externa', 'Ler trilha de auditoria']],
    notifs: ['Pagamento aguardando aprovação', 'Saldo abaixo do mínimo', 'Conciliação com divergência', 'Resumo semanal de caixa'] },
  { id: 'saude', empresa: 'Clínica Vida Plena', produto: 'Prontuário Integrado', dominio: 'vidaplena.med.br', objetos: 'pacientes, agendas e exames', consequencia: 'agendas, laudos assinados e anotações de atendimento',
    cargos: ['Enfermeira', 'Médico clínico', 'Recepcionista', 'Coordenadora assistencial'], cidades: ['Recife', 'Florianópolis', 'Salvador'],
    apps: [['Laboratório Parceiro', 'Gravar resultados de exames'], ['Agenda Online', 'Ler horários disponíveis'], ['Telemedicina', 'Iniciar teleconsultas'], ['Faturamento TISS', 'Ler procedimentos realizados'], ['Lembretes por SMS', 'Enviar confirmação de consulta'], ['Banco de Imagens', 'Anexar imagens de exame']],
    notifs: ['Paciente chegou à recepção', 'Resultado de exame disponível', 'Consulta cancelada', 'Resumo diário da agenda'] },
  { id: 'rh', empresa: 'Grupo Pessoas & Cia', produto: 'Portal de RH', dominio: 'pessoasecia.com.br', objetos: 'colaboradores, vagas e avaliações', consequencia: 'avaliações de desempenho, pedidos de férias e documentos',
    cargos: ['Analista de RH', 'Business partner', 'Gerente de pessoas', 'Recrutador'], cidades: ['Brasília', 'Fortaleza', 'Vitória'],
    apps: [['Ponto Eletrônico', 'Ler marcações de jornada'], ['Folha de Pagamento', 'Ler dados de remuneração'], ['Recrutamento Ágil', 'Criar e editar vagas'], ['Pesquisa de Clima', 'Ler lista de colaboradores'], ['Assinatura Digital', 'Assinar documentos em seu nome'], ['Treinamentos EAD', 'Ler matrículas de cursos']],
    notifs: ['Nova candidatura recebida', 'Pedido de férias pendente', 'Aniversário de empresa', 'Resumo semanal de vagas'] },
  { id: 'varejo', empresa: 'Mercado Bom Preço', produto: 'Central da Loja', dominio: 'bompreco.com.br', objetos: 'produtos, pedidos e estoques', consequencia: 'pedidos, estoques e promoções cadastradas',
    cargos: ['Gerente de loja', 'Comprador', 'Analista de estoque', 'Supervisor de caixa'], cidades: ['Londrina', 'Ribeirão Preto', 'Uberlândia'],
    apps: [['Marketplace Parceiro', 'Publicar produtos e preços'], ['Emissor Fiscal', 'Emitir notas de venda'], ['Controle de Validade', 'Ler lotes em estoque'], ['Entrega Expressa', 'Ler endereços de pedidos'], ['Programa de Fidelidade', 'Ler cadastro de clientes'], ['Etiquetas Eletrônicas', 'Atualizar preços nas gôndolas']],
    notifs: ['Estoque abaixo do mínimo', 'Pedido com atraso', 'Divergência no caixa', 'Resumo diário de vendas'] },
  { id: 'educacao', empresa: 'Colégio Novo Saber', produto: 'Secretaria Digital', dominio: 'novosaber.edu.br', objetos: 'turmas, notas e frequências', consequencia: 'diários de classe, boletins e comunicados enviados',
    cargos: ['Professora', 'Coordenador pedagógico', 'Secretário escolar', 'Diretora'], cidades: ['Maringá', 'Natal', 'Joinville'],
    apps: [['Biblioteca Virtual', 'Ler matrículas de alunos'], ['Plataforma de Provas', 'Lançar notas de avaliações'], ['Aplicativo para Famílias', 'Enviar comunicados'], ['Transporte Escolar', 'Ler endereços de alunos'], ['Diário Eletrônico', 'Editar frequências'], ['Videoaulas', 'Ler turmas e horários']],
    notifs: ['Nota lançada fora do prazo', 'Aluno com muitas faltas', 'Reunião de pais agendada', 'Resumo semanal da turma'] },
];
const NOMES = ['Marina', 'Rafael', 'Camila', 'Thiago', 'Beatriz', 'Lucas', 'Fernanda', 'Gustavo'];
const SOBRENOMES = ['Albuquerque', 'Nogueira', 'Teixeira', 'Carvalho', 'Moreira', 'Figueiredo', 'Ribeiro', 'Siqueira'];
const DISPOSITIVOS = [['Chrome em Windows 11', 'Notebook corporativo'], ['Safari em iPhone', 'Celular pessoal'], ['Edge em Windows 10', 'Desktop da recepção'], ['Firefox em Ubuntu', 'Estação de trabalho'], ['Chrome em Android', 'Tablet da equipe']];
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function variante(seed) {
  const R = rng(seed * 7919 + 13);
  const t = TEMAS[Math.abs(seed) % TEMAS.length];
  const nome = pick(R, NOMES), sob = pick(R, SOBRENOMES);
  const local = `${semAcento(nome)}.${semAcento(sob)}`;
  const ddd = pick(R, ['11', '19', '21', '31', '41', '51', '61', '81']);
  const n4 = () => String(1000 + Math.floor(R() * 9000));
  const nApps = 4 + Math.floor(R() * 3);
  const status = ['Ativo', 'Ativo', 'Pausado', 'Ativo', 'Expirado', 'Ativo'];
  const usos = ['hoje, 09:14', 'ontem, 17:40', 'há 3 dias', 'há 2 semanas', 'há 5 minutos', 'há 1 mês'];
  const apps = embaralhar(R, t.apps).slice(0, nApps).map(([n, p]) => ({ nome: n, perm: p, uso: pick(R, usos), status: pick(R, status) }));
  const sessoes = embaralhar(R, DISPOSITIVOS).slice(0, 3).map(([d, a]) => ({ dispositivo: d, apelido: a, local: pick(R, t.cidades), uso: pick(R, usos) }));
  return {
    seed, tema: t.id, empresa: t.empresa, produto: t.produto, objetos: t.objetos, consequencia: t.consequencia, dominio: t.dominio,
    usuario: { nome: `${nome} ${sob}`, iniciais: nome[0] + sob[0], local, email: `${local}@${t.dominio}`, tel: `(${ddd}) 9${n4()}-${n4()}`, telParcial: `(${ddd}) 9${n4()}-${String(10 + Math.floor(R() * 80))}`, cargo: pick(R, t.cargos), cidade: pick(R, t.cidades) },
    cargos: t.cargos, apps, sessoes, notifs: embaralhar(R, t.notifs).map(n => ({ rotulo: n, ligado: R() < 0.6 })),
    hora: `${String(7 + Math.floor(R() * 12)).padStart(2, '0')}:${String(Math.floor(R() * 60)).padStart(2, '0')}`,
    h1: R() < 0.5 ? 'zero' : 'dois', freq: pick(R, ['imediata', 'diaria', 'semanal']),
  };
}

const ICO = {
  sino: 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0',
  x: 'M6 6l12 12M18 6L6 18',
  lixo: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  olho: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  check: 'M4 12l5 5L20 6',
  alerta: 'M12 3l10 18H2L12 3zm0 7v5m0 3v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v6m0-9v.5',
  chave: 'M14 10a4 4 0 1 0-3 3.9L11 17h2v2h2v2h3v-3l-5-5',
};
const ico = (n, oculto = true) => `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${oculto ? ' aria-hidden="true" focusable="false"' : ''}><path d="${ICO[n]}"/></svg>`;

export function construir(V, violar = new Set()) {
  const x = id => violar.has(id);
  const F = r => x('AM40') ? `${Math.round(r * 1600) / 100}px` : `${r}rem`;
  const u = V.usuario;
  const mainTag = x('AM13') ? 'div' : 'main';
  const auto = (ok, ruim) => x('AM26') ? ruim : ok;
  const tituloMarca = x('AM06') && V.h1 === 'dois';

  const css = `
:root{
  --bg:#f4f6f8; --surface:#ffffff; --ink:#1d2733; --muted:#4b5968; --brand:#0b5cad; --brand-ink:#ffffff;
  --borda:#c3ccd6; --perigo:#b42318; --perigo-bg:#fdecea; --ok:#14653a; --ok-bg:#e4f4ea;
  --aviso:#7a4d00; --aviso-bg:#fff3d6; --raio:8px; --esp:16px; --sombra:0 1px 2px rgba(16,24,40,.08);
}
*{box-sizing:border-box}
html{font-size:${x('AM40') ? '16px' : '100%'}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Segoe UI",Roboto,Arial,sans-serif;font-size:${F(1)};line-height:1.6}
h1,h2,h3{line-height:1.25;margin:0 0 8px}
h1{font-size:${F(1.75)}}
h2{font-size:${F(1.25)}}
h3{font-size:${F(1.0625)}}
p{margin:0 0 8px}
a{color:var(--brand)}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.oculto{display:none}
[hidden]{display:none!important}
.pular{position:absolute;left:-999px;top:0;background:#fff;padding:8px}
.pular:focus{left:8px;top:8px;z-index:30}
.topo{background:var(--surface);border-bottom:1px solid var(--borda)}
.topo-in{max-width:1180px;margin:0 auto;padding:10px var(--esp);display:flex;align-items:center;gap:16px}
.marca{font-weight:700;font-size:${F(1.125)};margin:0}
.nav-topo{display:flex;gap:4px;list-style:none;margin:0 0 0 8px;padding:0;flex:1}
.nav-topo a{display:block;padding:6px 10px;border-radius:6px;text-decoration:none;color:var(--ink);font-size:${F(0.9375)}}
.nav-topo a[aria-current="page"]{background:#e3eefa;color:var(--brand);font-weight:600}
.btn-inicio{font:inherit;font-size:${F(0.9375)};padding:6px 12px;border:1px solid var(--borda);border-radius:6px;background:#fff;color:var(--ink);text-decoration:none;cursor:pointer}
.usuario-chip{display:flex;align-items:center;gap:8px;font-size:${F(0.875)}}
.avatar{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:var(--brand);color:var(--brand-ink);font-size:${F(0.75)};font-weight:700}
.avatar.grande{width:64px;height:64px;font-size:${F(1.25)}}
.btn-icone{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--borda);border-radius:6px;background:#fff;color:var(--ink);cursor:pointer}
.layout{max-width:1180px;margin:0 auto;padding:24px var(--esp);display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px}
.lateral ul{list-style:none;margin:0;padding:0;position:sticky;top:16px}
.lateral a{display:block;padding:8px 12px;border-radius:6px;text-decoration:none;color:var(--ink);font-size:${F(0.9375)}}
.lateral a:hover{background:#e8edf2}
.conteudo{min-width:0}
.titulo-pagina{margin-bottom:4px}
.lead{color:var(--muted);margin-bottom:20px}
.cartao{background:var(--surface);border:1px solid var(--borda);border-radius:var(--raio);box-shadow:var(--sombra);padding:24px;margin-bottom:24px}
.cartao>.desc{color:var(--muted);font-size:${F(0.9375)}}
.grade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 20px;margin-top:12px}
.campo{display:flex;flex-direction:column;gap:4px;position:relative}
.campo.largo{grid-column:1/-1}
.campo label{font-weight:600;font-size:${F(0.9375)}}
.campo input,.campo select,.campo textarea{font:inherit;font-size:${F(1)};padding:8px 10px;border:1px solid #7b8794;border-radius:6px;background:#fff;color:var(--ink)}
.campo textarea{min-height:84px;resize:vertical}
.dica{color:var(--muted);font-size:${F(0.8125)};margin:0}
.erro{color:var(--perigo);font-size:${F(0.875)};margin:0;font-weight:600}
.campo-erro input{border-color:var(--perigo);border-width:2px;background:#fff8f7}
.marca-erro{position:absolute;right:10px;top:32px;color:var(--perigo);font-weight:700;font-size:${F(0.875)}}
.foto{display:flex;align-items:center;gap:16px;margin:16px 0 4px}
.acoes{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
.btn{font:inherit;font-size:${F(0.9375)};font-weight:600;padding:9px 16px;border-radius:6px;border:1px solid var(--borda);background:#fff;color:var(--ink);cursor:pointer}
.btn.primario{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
.btn.perigo{background:var(--perigo);border-color:var(--perigo);color:#fff}
.btn.perigo-suave{border-color:var(--perigo);color:var(--perigo)}
.btn[disabled]{opacity:.55;cursor:not-allowed}
.btn.pequeno{padding:5px 10px;font-size:${F(0.8125)}}
.banner{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:var(--raio);margin:12px 0;border:1px solid}
.banner.ok{background:var(--ok-bg);border-color:var(--ok);color:#0d4527}
.banner-t{display:block;font-size:${F(1)}}
.banner-txt{flex:1;font-size:${F(0.9375)}}
.banner .btn-icone{width:28px;height:28px;border:0;background:transparent;color:inherit}
.aviso{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:var(--raio);background:var(--aviso-bg);border:1px solid #e3b341;color:var(--aviso);margin:0 0 16px}
.aviso p{margin:0;font-size:${F(0.9375)}}
.resumo{border:2px solid var(--perigo);background:var(--perigo-bg);border-radius:var(--raio);padding:14px 18px;margin-bottom:20px}
.resumo h2{font-size:${F(1.0625)};color:var(--perigo)}
.resumo ul{margin:0;padding-left:20px}
.resumo a{color:var(--perigo);font-weight:600}
fieldset{border:1px solid var(--borda);border-radius:6px;margin:16px 0 0;padding:12px 16px}
legend{font-weight:600;font-size:${F(0.9375)};padding:0 6px}
.opcao{display:flex;gap:10px;align-items:center;padding:6px 0;font-size:${F(0.9375)}}
.opcao input{width:18px;height:18px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:${F(0.9375)}}
caption{text-align:left;font-weight:600;padding:0 0 6px;font-size:${F(1)}}
th{text-align:left;padding:8px 10px;border-bottom:2px solid var(--borda);font-size:${F(0.8125)};text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
td{padding:10px;border-bottom:1px solid #e4e9ee;vertical-align:middle}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;background:#eaf0f6;font-size:${F(0.75)};color:#2b3a49}
.ponto{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:middle;margin-right:6px}
.ponto.ok{background:var(--ok)}
.ponto.pausa{background:#a0670a}
.ponto.exp{background:var(--perigo)}
.estado{display:inline-flex;align-items:center;font-size:${F(0.875)}}
.contagem{font-weight:600;margin:12px 0 0;font-size:${F(0.9375)}}
.vazio{text-align:center;padding:28px 16px;border:2px dashed var(--borda);border-radius:var(--raio);margin-top:12px;color:var(--muted)}
.vazio h3{color:var(--ink)}
.falha{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid var(--perigo);background:var(--perigo-bg);border-radius:var(--raio);margin-top:12px;align-items:flex-start}
.falha h3{color:var(--perigo);margin:0}
.esqueleto{margin-top:12px;display:grid;gap:8px}
.esqueleto span.linha{height:14px;border-radius:4px;background:linear-gradient(90deg,#e4e9ee,#f1f4f7,#e4e9ee)}
.texto{max-width:${x('AM46') ? 'none' : '62ch'};margin:12px 0;color:#26323f}
.zona-perigo{border-color:var(--perigo)}
.zona-perigo h2{color:var(--perigo)}
.rodape{max-width:1180px;margin:0 auto;padding:8px var(--esp) 32px;color:var(--muted);font-size:${F(0.8125)}}
.modal-fundo{position:fixed;inset:0;background:rgba(15,23,32,.55);display:flex;align-items:center;justify-content:center;z-index:40}
.modal{background:#fff;border-radius:var(--raio);padding:24px;max-width:460px;width:calc(100% - 32px)}
.modal h2{font-size:${F(1.25)}}
`;

  const campo = o => {
    const desc = [o.dica ? `dica-${o.id}` : '', o.erro ? `erro-${o.id}` : ''].filter(Boolean).join(' ');
    const ctrl = o.select
      ? `<select id="${o.id}" name="${o.id}"${o.attrs || ''}>${o.select}</select>`
      : o.area
        ? `<textarea id="${o.id}" name="${o.id}"${o.attrs || ''}>${o.valor || ''}</textarea>`
        : `<input id="${o.id}" name="${o.id}" type="${o.tipo || 'text'}" value="${o.valor || ''}"${o.attrs || ''}${o.inv ? ' aria-invalid="true"' : ''}>`;
    return `
        <div class="campo${o.largo ? ' largo' : ''}${o.marcaErro ? ' campo-erro' : ''}">
          <label for="${o.id}">${o.label}</label>
          ${ctrl.replace('>', desc ? ` aria-describedby="${desc}">` : '>')}
          ${o.marcaErro && !o.erro ? '<span class="marca-erro" aria-hidden="true">!</span>' : ''}
          ${o.dica ? `<p class="dica" id="dica-${o.id}">${o.dica}</p>` : ''}
          ${o.erro ? `<p class="erro" id="erro-${o.id}">${o.erro}</p>` : ''}
        </div>`;
  };

  const opts = (lista, sel) => lista.map(c => `<option${c === sel ? ' selected' : ''}>${c}</option>`).join('');
  const erroEmail = x('NE25') ? 'E-mail inválido.' : `Informe o e-mail completo, por exemplo ${u.local}@${V.dominio}.`;
  const erroTel = x('NE20') ? '' : 'Telefone incompleto: faltam dígitos no final do número.';

  const linhasApps = V.apps.map((a, i) => {
    const cls = a.status === 'Ativo' ? 'ok' : a.status === 'Pausado' ? 'pausa' : 'exp';
    return `
          <tr>
            <th scope="row">${a.nome}</th>
            <td><span class="chip">${a.perm}</span></td>
            <td>${a.uso}</td>
            <td><span class="estado"><span class="ponto ${cls}"${x('AM32') ? '' : ' role="img"'} aria-label="${a.status}"></span></span></td>
            <td><button type="button" class="btn perigo-suave pequeno" data-abrir="fundo-revogar">Revogar acesso</button></td>
          </tr>`;
  }).join('');
  const linhasSessoes = V.sessoes.map((s, i) => `
          <tr>
            <th scope="row">${s.dispositivo}</th>
            <td>${s.apelido}</td>
            <td>${s.local}</td>
            <td>${s.uso}</td>
            <td><button type="button" class="btn pequeno">${i === 0 ? 'Sessão atual' : 'Encerrar sessão'}</button></td>
          </tr>`).join('');
  const notifs = V.notifs.map((n, i) => `
          <label class="opcao"><input type="checkbox" name="notif${i}"${n.ligado ? ' checked' : ''}> ${n.rotulo}</label>`).join('');
  const freq = [['imediata', 'Imediata'], ['diaria', 'Resumo diário'], ['semanal', 'Resumo semanal']].map(([v, l]) => `
          <label class="opcao"><input type="radio" name="freq" value="${v}"${v === V.freq ? ' checked' : ''}> ${l}</label>`).join('');

  const marcaHtml = tituloMarca
    ? `<h1 class="marca">${V.empresa}</h1>`
    : `<span class="marca">${V.empresa}</span>`;
  const inicio = x('NE49')
    ? `<button type="button" class="btn-inicio" onclick="location.href='/'">Início</button>`
    : `<a class="btn-inicio" href="/">Início</a>`;
  const hTitulo = x('AM06') && V.h1 === 'zero'
    ? `<h2 class="titulo-pagina">Configurações da conta</h2>`
    : `<h1 class="titulo-pagina">Configurações da conta</h1>`;

  const aviso = (id, texto) => `
      <div class="aviso" id="${id}">
        ${ico('alerta', !x('NE50'))}
        <p>${x('NE50') ? '' : '<span class="sr-only">Aviso: </span>'}${texto}</p>
      </div>`;

  const modal = (id, titulo, desc, sim, nao) => `
  <div class="modal-fundo" id="fundo-${id}" data-modal hidden>
    <div class="modal" id="dlg-${id}" role="${x('NE44') ? 'dialog' : 'alertdialog'}" aria-modal="true" aria-labelledby="dlg-${id}-t"${x('NE44') ? '' : ` aria-describedby="dlg-${id}-d"`}>
      <h2 id="dlg-${id}-t">${titulo}</h2>
      <p id="dlg-${id}-d">${desc}</p>
      <div class="acoes">
        <button type="button" class="btn perigo" data-fechar>${x('NE39') ? 'Sim' : sim}</button>
        <button type="button" class="btn" data-fechar>${x('NE39') ? 'Não' : nao}</button>
      </div>
    </div>
  </div>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configurações da conta - ${V.empresa}</title>
<style>${css}</style>
</head>
<body>
<a class="pular" href="#principal">Pular para o conteúdo</a>
<header class="topo" id="topo">
  <div class="topo-in">
    ${marcaHtml}
    ${inicio}
    <nav aria-label="Principal" style="flex:1">
      <ul class="nav-topo">
        <li><a href="/painel">Painel</a></li>
        <li><a href="/relatorios">Relatórios</a></li>
        <li><a href="/equipe">Equipe</a></li>
        <li><a href="/configuracoes" aria-current="page">Configurações</a></li>
      </ul>
    </nav>
    <button type="button" class="btn-icone" id="btn-notif"${x('AM20') ? '' : ' aria-label="Notificações (3 novas)"'}>${ico('sino')}</button>
    <div class="usuario-chip"><span class="avatar" aria-hidden="true">${u.iniciais}</span><span>${u.nome}</span></div>
  </div>
</header>
<div id="live" class="${x('NE18') ? 'oculto' : 'sr-only'}" role="status"></div>
<div class="layout">
  <nav class="lateral" aria-label="Seções de configurações">
    <ul>
      <li><a href="#perfil">Perfil</a></li>
      <li><a href="#preferencias">Preferências</a></li>
      <li><a href="#acessos">Acessos e permissões</a></li>
      <li><a href="#privacidade">Privacidade e dados</a></li>
      <li><a href="#zona-perigo">Excluir conta</a></li>
    </ul>
  </nav>
  <${mainTag} id="principal" class="conteudo">
    ${hTitulo}
    <p class="lead">Gerencie seu perfil, suas preferências, os aplicativos conectados e a privacidade da conta no ${V.produto}.</p>
${aviso('aviso-sessoes', `Sua conta está conectada em ${V.sessoes.length} dispositivos. Encerre as sessões que você não reconhece.`)}
${x('NE23') ? '' : `
    <section class="resumo" id="resumo-erros" aria-labelledby="resumo-t" tabindex="-1">
      <h2 id="resumo-t">Corrija 2 campos para salvar o perfil</h2>
      <ul>
        <li><a href="#email">E-mail corporativo: o endereço está incompleto</a></li>
        <li><a href="#telefone">Telefone: o número está incompleto</a></li>
      </ul>
    </section>`}

    <section class="cartao" id="perfil" aria-labelledby="h-perfil">
      <h2 id="h-perfil">Perfil</h2>
      <p class="desc">Estas informações são exibidas para as demais pessoas da sua equipe.</p>
      <div class="foto">
        <span class="avatar grande" aria-hidden="true">${u.iniciais}</span>
        <div>
          <p><strong>Foto de perfil</strong></p>
          <button type="button" class="btn pequeno">Enviar nova foto</button>
          <button type="button" class="btn-icone" id="btn-remover-foto"${x('AM20') ? '' : ' aria-label="Remover foto"'}>${ico('lixo')}</button>
        </div>
      </div>
      <form id="form-perfil" action="#" method="post">
        <div class="grade">${campo({ id: 'nome', label: 'Nome completo', valor: u.nome, attrs: ` autocomplete="${auto('name', 'nome')}" required minlength="3"`.replace(x('NE34') ? ' required minlength="3"' : '§', '') })}${campo({ id: 'email', label: 'E-mail corporativo', tipo: x('NE34') ? 'text' : 'email', valor: u.local + '@' + V.dominio.split('.')[0], attrs: ` autocomplete="${auto('email', 'e-mail')}"${x('NE34') ? '' : ' required'}`, dica: 'Usamos este endereço para login e avisos de segurança.', erro: erroEmail, inv: true, marcaErro: true })}${campo({ id: 'telefone', label: 'Telefone celular', tipo: x('NE34') ? 'text' : 'tel', valor: u.telParcial, attrs: ` autocomplete="${auto('tel', 'telefone')}"${x('NE34') ? '' : ' pattern="[0-9() -]{14,16}"'}`, dica: 'Com DDD, por exemplo (11) 91234-5678.', erro: erroTel, inv: !x('NE20'), marcaErro: true })}${campo({ id: 'organizacao', label: 'Empresa', valor: V.empresa, attrs: ` autocomplete="${auto('organization', 'empresa')}"` })}${campo({ id: 'cargo', label: 'Cargo', select: opts(V.cargos, u.cargo) })}${campo({ id: 'cidade', label: 'Cidade', valor: u.cidade, attrs: ` autocomplete="${auto('address-level2', 'cidade')}"` })}${campo({ id: 'idioma', label: 'Idioma da interface', select: opts(['Português (Brasil)', 'English', 'Español'], 'Português (Brasil)') })}${campo({ id: 'bio', label: 'Sobre você', area: true, valor: `Responsável por ${V.objetos} na unidade de ${u.cidade}.`, largo: true, dica: 'Até 200 caracteres.' })}
        </div>
        <div class="acoes">
          <button type="submit" class="btn primario"${x('NE47') ? ' disabled' : ''}>Salvar alterações</button>
          <button type="reset" class="btn">Descartar</button>
        </div>
      </form>
    </section>

    <section class="cartao" id="preferencias" aria-labelledby="h-pref">
      <h2 id="h-pref">Preferências de notificação</h2>
      <p class="desc">Escolha quais avisos você recebe e com que frequência.</p>
      <div class="banner ok" id="banner-sucesso"${x('NE16') ? '' : ' role="status"'}>
        ${ico('check')}
        <div class="banner-txt">
          ${x('NE32') ? '' : '<strong class="banner-t">Sucesso</strong>'}
          <span>Suas preferências de notificação foram salvas às ${V.hora}.</span>
        </div>
        <button type="button" class="btn-icone" id="btn-dispensar"${x('AM20') ? '' : ' aria-label="Dispensar mensagem"'}>${ico('x')}</button>
      </div>
      <form id="form-prefs" action="#" method="post">
        <fieldset>
          <legend>Avisos por e-mail</legend>${notifs}
        </fieldset>
        <fieldset>
          <legend>Frequência</legend>${freq}
        </fieldset>
        <div class="grade">${campo({ id: 'fuso', label: 'Fuso horário', select: opts(['Brasília (GMT-3)', 'Manaus (GMT-4)', 'Fernando de Noronha (GMT-2)'], 'Brasília (GMT-3)') })}${campo({ id: 'densidade', label: 'Densidade da tabela', select: opts(['Confortável', 'Compacta'], 'Confortável') })}
        </div>
        <div class="acoes">
          <button type="submit" class="btn primario">Salvar preferências</button>
        </div>
      </form>
    </section>

    <section class="cartao" id="acessos" aria-labelledby="h-acessos">
      <h2 id="h-acessos">Acessos e permissões</h2>
      <p class="desc">Aplicativos que podem ler ou alterar dados da sua conta.</p>
      <p class="contagem" id="contagem-acessos"${x('NE16') ? '' : ' role="status"'}>${V.apps.length} aplicativos com acesso à sua conta</p>
      <table>
        <caption>Aplicativos conectados</caption>
        <thead>
          <tr><th scope="col">Aplicativo</th><th scope="col">Permissão</th><th scope="col">Último uso</th><th scope="col">Situação</th><th scope="col">Ação</th></tr>
        </thead>
        <tbody>${linhasApps}
        </tbody>
      </table>
      <table>
        <caption>Sessões ativas</caption>
        <thead>
          <tr><th scope="col">Dispositivo</th><th scope="col">Descrição</th><th scope="col">Local</th><th scope="col">Último acesso</th><th scope="col">Ação</th></tr>
        </thead>
        <tbody>${linhasSessoes}
        </tbody>
      </table>
      <h3 style="margin-top:24px">Chaves de API</h3>
      <div class="vazio">
        ${ico('chave')}
        <h3>Nenhuma chave de API criada</h3>
        <p>Crie uma chave para integrar sistemas externos sem compartilhar sua senha.</p>
        <button type="button" class="btn primario">Criar chave de API</button>
      </div>
      <h3 style="margin-top:24px">Atividade recente</h3>
      <div class="falha" role="alert">
        <h3>Não foi possível carregar o histórico</h3>
        <p>O servidor demorou para responder. Tente novamente em instantes.</p>
        <button type="button" class="btn">Tentar novamente</button>
      </div>
      <div class="esqueleto" aria-busy="true">
        <span class="sr-only">Carregando eventos de segurança</span>
        <span class="linha"></span><span class="linha"></span><span class="linha"></span>
      </div>
    </section>

    <section class="cartao" id="privacidade" aria-labelledby="h-priv">
      <h2 id="h-priv">Privacidade e dados</h2>
      <p class="texto">A ${V.empresa} trata os dados da sua conta, como nome, e-mail corporativo, telefone e registros de acesso, apenas para operar o ${V.produto}, cumprir obrigações legais e proteger a segurança de ${V.objetos}. Você pode solicitar uma cópia desses dados, corrigir informações desatualizadas ou pedir a exclusão a qualquer momento, e a resposta será enviada ao e-mail cadastrado em até quinze dias corridos, conforme a legislação de proteção de dados vigente.</p>
      <p class="texto">Os aplicativos conectados à conta só recebem as permissões que você autorizou na tabela de acessos. Ao revogar um acesso, a integração deixa de consultar ${V.objetos} imediatamente, mas os dados já sincronizados permanecem no sistema do aplicativo e precisam ser removidos por lá. Registros de auditoria são mantidos por doze meses para investigação de incidentes e não podem ser apagados pelo usuário.</p>
      <div class="acoes">
        <a class="btn" href="/dados/exportar" style="text-decoration:none">Baixar meus dados</a>
        <a class="btn" href="/privacidade" style="text-decoration:none">Ler política completa</a>
      </div>
    </section>

    <section class="cartao zona-perigo" id="zona-perigo" aria-labelledby="h-perigo">
      <h2 id="h-perigo">Excluir conta</h2>
${aviso('aviso-exclusao', `A exclusão é permanente e remove ${V.consequencia}. Esta ação não pode ser desfeita.`)}
      <button type="button" class="btn perigo" data-abrir="fundo-excluir">Excluir minha conta</button>
    </section>
  </${mainTag}>
</div>
<footer class="rodape">
  <p>${V.empresa} · ${V.produto} · Versão 4.12.0 · <a href="/ajuda">Central de ajuda</a> · <a href="/termos">Termos de uso</a></p>
</footer>
${modal('excluir', 'Excluir sua conta?', `Todos os dados de ${u.nome} serão apagados em 30 dias. Você perderá ${V.consequencia}.`, 'Excluir conta', 'Manter conta')}
${modal('revogar', 'Revogar o acesso deste aplicativo?', 'O aplicativo deixará de acessar sua conta imediatamente. Você poderá autorizá-lo novamente depois.', 'Revogar acesso', 'Manter acesso')}
<script>
document.querySelectorAll('[data-abrir]').forEach(function (b) { b.addEventListener('click', function () { document.getElementById(b.getAttribute('data-abrir')).hidden = false; }); });
document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('[data-modal]').hidden = true; }); });
document.getElementById('btn-dispensar').addEventListener('click', function () { document.getElementById('banner-sucesso').hidden = true; });
</script>
</body>
</html>
`;
}

async function axe(pagina, regras) {
  await pagina.evaluate(AXE_SRC);
  return pagina.evaluate(async r => (await axe.run(document, { runOnly: { type: 'rule', values: r } })).violations.map(v => v.id), regras);
}

export async function checar(pagina) {
  await pagina.setViewportSize({ width: 1280, height: 800 });
  const r = await pagina.evaluate(() => {
    const o = {};
    const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
    const txt = e => (e && e.textContent || '').replace(/\s+/g, ' ').trim();
    const nomeBtn = b => (b.getAttribute('aria-label') || txt(b) || b.getAttribute('title') || '').trim();
    const srOnly = e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.position === 'absolute' && b.width <= 2 && b.height <= 2; };
    const res = (ok, nota) => ({ ok: !!ok, nota });

    const dl = $$('[aria-modal="true"],[role=alertdialog],[role=dialog],dialog');
    const nomes = dl.flatMap(d => [...d.querySelectorAll('button')]).map(nomeBtn).filter(Boolean);
    const ruim = nomes.filter(n => /^(sim|n[ãa]o|ok|okay|confirmar|cancelar)$/i.test(n));
    o.NE39 = res(dl.length > 0 && nomes.length >= 2 && !ruim.length, `botões: ${nomes.join('|')}`);

    const semDesc = dl.filter(d => { if (d.getAttribute('role') !== 'alertdialog') return true; const ids = (d.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean); return !ids.length || !ids.every(i => txt(document.getElementById(i)).length > 0); });
    o.NE44 = res(dl.length > 0 && !semDesc.length, `${semDesc.length}/${dl.length} modais sem alertdialog+describedby`);

    const desab = $$('button,input[type=submit],input[type=button],input[type=reset],[role=button]').filter(e => e.disabled || e.getAttribute('aria-disabled') === 'true');
    o.NE47 = res(!desab.length, `${desab.length} desabilitados`);

    const ini = $$('a,button,[role=button]').filter(e => /^(in[ií]cio|voltar ao in[ií]cio)$/i.test(txt(e)));
    o.NE49 = res(ini.length > 0 && ini.every(e => e.tagName === 'A' && e.hasAttribute('href')), ini.map(e => e.tagName).join(','));

    const av = $$('[id^="aviso-"]');
    const falhaAv = av.filter(a => {
      const svgs = [...a.querySelectorAll('svg')];
      const iconeOk = svgs.length > 0 && svgs.every(s => s.closest('[aria-hidden="true"]'));
      const sr = [...a.querySelectorAll('*')].find(srOnly);
      const srOk = sr && /^(aviso|aten[cç][aã]o|importante)/i.test(txt(sr)) && /^(aviso|aten[cç][aã]o|importante)/i.test((a.textContent || '').trim());
      return !(iconeOk && srOk);
    });
    o.NE50 = res(av.length > 0 && !falhaAv.length, `${falhaAv.length}/${av.length} avisos sem texto oculto/ícone oculto`);

    const st = ['#banner-sucesso', '#contagem-acessos'].map(s => $(s));
    const semRole = st.filter(e => !e || !e.closest('[role=status],output'));
    o.NE16 = res(!semRole.length, `${semRole.length} mensagens sem role=status`);

    const vivos = $$('[role=status],[role=alert],[aria-live]:not([aria-live=off])');
    const escond = vivos.filter(e => !e.checkVisibility({ visibilityProperty: true }));
    o.NE18 = res(vivos.length > 0 && !escond.length, `${escond.length}/${vivos.length} regiões ocultas com display:none`);

    const tel = $('#telefone'), etel = $('#erro-telefone');
    o.NE20 = res(tel && tel.getAttribute('aria-invalid') === 'true' && etel && txt(etel).length >= 8 && (tel.getAttribute('aria-describedby') || '').split(/\s+/).includes('erro-telefone'), etel ? txt(etel) : 'sem texto de erro');

    const lk = $$('#principal a[href="#email"]').filter(a => !a.closest('form'));
    const ctn = lk.map(a => a.closest('section,div,aside')).find(c => c && c.querySelector('a[href="#telefone"]'));
    const perf = $('#perfil');
    o.NE23 = res(ctn && perf && (ctn.compareDocumentPosition(perf) & Node.DOCUMENT_POSITION_FOLLOWING) && !ctn.contains(perf), ctn ? 'resumo presente' : 'sem resumo');

    const ee = txt($('#erro-email'));
    o.NE25 = res(/(ex\.?:|exemplo|use |informe|digite|formato)/i.test(ee), ee);

    const ban = $('#banner-sucesso');
    const tit = ban && [...ban.querySelectorAll('*')].find(e => /^(sucesso|conclu[ií]do|tudo certo)[!.:]?$/i.test(txt(e)) && !e.querySelector('*'));
    o.NE32 = res(!!tit, tit ? txt(tit) : 'banner sem título');

    const em = $('#email'), no = $('#nome');
    o.NE34 = res(em && em.type === 'email' && em.required && no && no.required && no.minLength >= 2 && tel && tel.pattern, `email.type=${em && em.type} req=${em && em.required} nome.req=${no && no.required} tel.pattern=${tel && tel.pattern}`);

    let px = 0;
    const walk = rs => { for (const r of rs) { if (r.style && /\d(px|pt)\s*$/.test(r.style.getPropertyValue('font-size'))) px++; if (r.cssRules) walk(r.cssRules); } };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (e) {} }
    $$('[style]').forEach(e => { if (/\d(px|pt)\s*$/.test(e.style.getPropertyValue('font-size'))) px++; });
    o.AM40 = res(px === 0, `${px} declarações de font-size em px/pt`);

    const longos = $$('p').filter(p => txt(p).length >= 200 && p.getBoundingClientRect().height > 0);
    const cpl = longos.map(p => { const s = getComputedStyle(p); const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2; const linhas = Math.max(1, Math.round(p.getBoundingClientRect().height / lh)); return txt(p).length / linhas; });
    o.AM46 = res(longos.length > 0 && cpl.every(c => c <= 90), `caracteres/linha: ${cpl.map(c => Math.round(c)).join(',')}`);

    o._h1 = $$('h1').length; o._main = $$('main,[role=main]').length;
    o._autoEmail = ($('#email') || {}).getAttribute && $('#email').getAttribute('autocomplete');
    return o;
  });
  const v = await axe(pagina, ['page-has-heading-one', 'landmark-one-main', 'button-name', 'autocomplete-valid', 'aria-prohibited-attr']);
  const out = {};
  for (const id of REGRAS) if (r[id]) out[id] = r[id];
  out.AM06 = { ok: !v.includes('page-has-heading-one') && r._h1 === 1, nota: `${r._h1} h1` };
  out.AM13 = { ok: !v.includes('landmark-one-main') && r._main === 1, nota: `${r._main} main` };
  out.AM20 = { ok: !v.includes('button-name'), nota: v.includes('button-name') ? 'botão sem nome' : 'ok' };
  out.AM26 = { ok: !v.includes('autocomplete-valid') && !!r._autoEmail, nota: `autocomplete email=${r._autoEmail}` };
  out.AM32 = { ok: !v.includes('aria-prohibited-attr'), nota: v.includes('aria-prohibited-attr') ? 'aria-label em elemento genérico' : 'ok' };
  return out;
}

export function ruido(html, seed) {
  const R = rng(seed * 31 + 7);
  // 1) renomeia classes de forma consistente (HTML e CSS)
  const classes = new Set();
  html.replace(/class="([^"]*)"/g, (_, c) => { c.split(/\s+/).filter(Boolean).forEach(n => classes.add(n)); return _; });
  const sufixo = '-' + Math.floor(R() * 900 + 100).toString(36);
  const mapa = Object.fromEntries([...classes].map(n => [n, n + sufixo]));
  html = html.replace(/class="([^"]*)"/g, (_, c) => `class="${c.split(/\s+/).filter(Boolean).map(n => mapa[n]).join(' ')}"`);
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => {
    css = css.replace(/\.([a-z][\w-]*)(?![\w-])/g, (m, n) => mapa[n] ? '.' + mapa[n] : m);
    // valores equivalentes: cores curtas em maiúsculas e zeros
    css = css.replace(/#([0-9a-f]{6})\b/g, (m, h) => R() < 0.5 ? '#' + h.toUpperCase() : m).replace(/:0px/g, ':0');
    return `<style>${css}</style>`;
  });
  // 2) embaralha a ordem dos atributos
  html = html.replace(/<([a-z][a-z0-9]*)((?:\s+[^\s=>"']+(?:="[^"]*")?)+)\s*(\/?)>/g, (m, tag, attrs, fim) => {
    const lista = attrs.match(/\s+[^\s=>"']+(?:="[^"]*")?/g).map(a => a.trim());
    return `<${tag} ${embaralhar(R, lista).join(' ')}${fim}>`;
  });
  // 3) comentários e espaços entre linhas
  html = html.replace(/\n(\s*)<(section|header|footer|form|table|div class)/g, (m, ind, t) => `\n${ind}<!-- bloco ${Math.floor(R() * 1000)} -->\n${R() < 0.5 ? ind + ind : ind}<${t}`);
  html = html.replace(/\n {2}/g, () => '\n' + (R() < 0.5 ? '    ' : '  '));
  return html;
}
