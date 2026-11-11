// Família "navegacao": tela de aplicativo com menu lateral, breadcrumb, abas, modais, onboarding e estados.
import { rng, pick, embaralhar, REGRA, AXE_SRC } from '../comum.mjs';

export const ID = 'navegacao';
export const TITULO = 'Aplicativo com navegação';
export const REGRAS = ['NE05', 'NE06', 'NE07', 'NE08', 'NE09', 'NE10', 'NE11', 'NE12', 'NE13', 'NE14', 'NE17', 'NE19', 'NE22', 'NE29', 'NE33', 'NE35', 'AM08', 'AM14', 'AM21', 'AM27', 'AM34', 'AM41', 'AM48'];

const NOMES = ['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Elisa Ferraz', 'Fábio Nunes', 'Gabriela Torres', 'Heitor Alves'];
const ABAS = ['Visão geral', 'Atividade', 'Anexos', 'Histórico'];
const RODAPE = [['Termos de uso', '/termos'], ['Privacidade', '/privacidade'], ['Status do sistema', '/status'], ['Contato', '/contato']];
const GAVETA = [['Guia de início', '/ajuda/inicio'], ['Atalhos de teclado', '/ajuda/atalhos'], ['Falar com o suporte', '/suporte']];
const COLS = [['Código'], ['Descrição'], ['Responsável'], ['Situação'], ['Atualizado em']];

const TEMAS = [
  { app: 'RotaCerta', org: 'Transportadora Horizonte', ent: 'entrega', entP: 'Entregas', novo: 'Nova entrega', pref: 'ENT', secao: 'Operações',
    nav: ['Início', 'Entregas', 'Rotas', 'Motoristas', 'Veículos', 'Relatórios', 'Equipe', 'Configurações'],
    kpis: [['Entregas hoje', '248'], ['No prazo', '94%'], ['Atrasadas', '13'], ['Ocorrências abertas', '7']],
    rel: ['Ver relatório de entregas', 'Ver relatório de atrasos', 'Ver mapa de rotas'],
    descs: ['Entrega de 14 volumes de autopeças para o centro de distribuição de Campinas com agendamento de doca',
      'Coleta de carga refrigerada no porto de Santos com conferência de temperatura na origem e no destino',
      'Reentrega solicitada pelo cliente após ausência no endereço durante a primeira tentativa de visita',
      'Transferência de paletes entre os galpões da zona norte e da zona sul com escolta e rastreamento ativo',
      'Entrega fracionada de materiais de construção em três obras da mesma incorporadora na região do ABC',
      'Devolução de mercadoria avariada ao fornecedor, acompanhada de laudo fotográfico e nota fiscal de retorno'],
    status: ['Em rota', 'Entregue', 'Atrasada', 'Aguardando coleta'],
    vazio: ['Nenhuma entrega arquivada', 'Entregas concluídas há mais de 90 dias são arquivadas aqui para consulta futura. Você ainda não tem nenhuma.', 'Arquivar entregas antigas'],
    eventos: ['Rota 14 reprogramada por interdição na Rodovia dos Bandeirantes, com nova previsão de chegada às 16h40', 'Motorista Carlos Prado confirmou a coleta no galpão 3 e iniciou o deslocamento até o destino', 'Janela de entrega do cliente Mercantil Sul foi alterada para o período da tarde pelo atendimento'],
    alerta: 'Não foi possível carregar o rastreamento em tempo real. Os dados exibidos podem estar desatualizados.',
    passos: ['Cadastrar a primeira filial', 'Importar a base de clientes', 'Convidar a equipe de operação', 'Configurar as janelas de entrega'],
    convite: 'Convidar motorista', sync: ['Cadastros', 'Movimentações', 'Rotas', 'Notas fiscais'] },
  { app: 'CaixaClaro', org: 'Cooperativa Aurora', ent: 'lançamento', entP: 'Lançamentos', novo: 'Novo lançamento', pref: 'LAN', secao: 'Financeiro',
    nav: ['Início', 'Lançamentos', 'Contas a pagar', 'Contas a receber', 'Conciliação', 'Relatórios', 'Equipe', 'Configurações'],
    kpis: [['Saldo em conta', 'R$ 184.320,00'], ['A receber em 30 dias', 'R$ 92.450,00'], ['A pagar em 30 dias', 'R$ 61.870,00'], ['Itens conciliados', '97%']],
    rel: ['Ver relatório de fluxo de caixa', 'Ver relatório de inadimplência', 'Ver demonstrativo mensal'],
    descs: ['Pagamento de fornecedor de embalagens referente ao pedido de compra de março com desconto por antecipação',
      'Recebimento de mensalidades de cooperados via boleto registrado, com baixa automática pelo arquivo de retorno',
      'Tarifa bancária cobrada sobre transferências internacionais, ainda sem categoria definida pelo contador',
      'Provisão de 13º salário e encargos trabalhistas do trimestre para a folha da unidade administrativa',
      'Estorno de cobrança duplicada identificada na conciliação do cartão corporativo do departamento comercial',
      'Aporte de capital aprovado em assembleia e creditado na conta de investimentos de longo prazo da cooperativa'],
    status: ['Conciliado', 'Pendente', 'Vencido', 'Agendado'],
    vazio: ['Nenhum lançamento arquivado', 'Lançamentos de exercícios encerrados são arquivados aqui para auditoria. Ainda não há nenhum item nesta lista.', 'Arquivar lançamentos antigos'],
    eventos: ['Extrato do Banco Central do Sul importado com 312 movimentações, das quais 18 aguardam classificação manual', 'Boleto da distribuidora Rio Verde foi quitado antes do vencimento e a baixa aguarda conciliação', 'Limite do cartão corporativo atingiu 85% e o gestor financeiro recebeu o alerta por e-mail'],
    alerta: 'Não foi possível consultar o extrato bancário de hoje. Os saldos exibidos referem-se ao último fechamento.',
    passos: ['Conectar a conta bancária principal', 'Importar o plano de contas', 'Convidar o contador responsável', 'Definir as regras de conciliação'],
    convite: 'Convidar contador', sync: ['Extratos', 'Boletos', 'Notas fiscais', 'Câmbio'] },
  { app: 'ProntoCuidado', org: 'Clínica Vida Plena', ent: 'consulta', entP: 'Consultas', novo: 'Nova consulta', pref: 'CON', secao: 'Atendimento',
    nav: ['Início', 'Consultas', 'Pacientes', 'Exames', 'Prescrições', 'Relatórios', 'Equipe', 'Configurações'],
    kpis: [['Consultas hoje', '42'], ['Comparecimento', '88%'], ['Retornos pendentes', '19'], ['Exames aguardando laudo', '11']],
    rel: ['Ver relatório de atendimentos', 'Ver relatório de faltas', 'Ver agenda por especialidade'],
    descs: ['Consulta de retorno em cardiologia para avaliação dos exames solicitados na visita anterior ao paciente',
      'Primeira consulta pediátrica com orientação sobre calendário vacinal e acompanhamento de crescimento',
      'Teleconsulta de dermatologia com envio prévio de fotografias da lesão e histórico de medicamentos em uso',
      'Avaliação ortopédica pós-operatória com revisão da fisioterapia e liberação para atividades leves',
      'Consulta de pré-natal do segundo trimestre com ultrassonografia morfológica e orientação nutricional',
      'Atendimento de urgência encaminhado pela recepção por dor torácica, com protocolo de triagem aplicado'],
    status: ['Confirmada', 'Realizada', 'Faltou', 'Remarcada'],
    vazio: ['Nenhuma consulta arquivada', 'Consultas finalizadas há mais de um ano são arquivadas aqui para consulta posterior. Por enquanto, nada foi arquivado.', 'Arquivar consultas antigas'],
    eventos: ['Paciente Marta Oliveira confirmou presença na consulta de quinta-feira pelo link enviado por mensagem de texto', 'Laudo do exame de sangue de Joaquim Teles foi anexado ao prontuário e liberado para o médico responsável', 'Sala 4 ficou indisponível para manutenção do ar-condicionado e três consultas foram realocadas'],
    alerta: 'Não foi possível carregar a agenda dos médicos. Os horários exibidos podem não refletir as últimas alterações.',
    passos: ['Cadastrar as salas de atendimento', 'Importar a lista de pacientes', 'Convidar os médicos da clínica', 'Configurar os horários de atendimento'],
    convite: 'Convidar profissional', sync: ['Pacientes', 'Agenda', 'Convênios', 'Laudos'] },
  { app: 'GenteBem', org: 'Grupo Alvorada', ent: 'vaga', entP: 'Vagas', novo: 'Nova vaga', pref: 'VAG', secao: 'Recrutamento',
    nav: ['Início', 'Vagas', 'Candidatos', 'Entrevistas', 'Admissões', 'Relatórios', 'Equipe', 'Configurações'],
    kpis: [['Vagas abertas', '23'], ['Candidatos ativos', '412'], ['Entrevistas na semana', '37'], ['Tempo médio de contratação', '28 dias']],
    rel: ['Ver relatório de contratações', 'Ver relatório de origem dos candidatos', 'Ver funil de seleção'],
    descs: ['Analista de dados pleno para o time de inteligência comercial, com atuação híbrida em São Paulo',
      'Desenvolvedora back-end sênior para a plataforma de pagamentos, com foco em integrações e desempenho',
      'Assistente administrativo para a unidade de Belo Horizonte, com rotina de contratos, compras e atendimento',
      'Coordenador de logística para o centro de distribuição de Recife, com gestão de equipe de vinte pessoas',
      'Estágio em marketing digital com ênfase em conteúdo, métricas de campanhas e relacionamento com clientes',
      'Técnico de enfermagem para o ambulatório corporativo, com escala de seis horas e adicional noturno'],
    status: ['Aberta', 'Em seleção', 'Pausada', 'Encerrada'],
    vazio: ['Nenhuma vaga arquivada', 'Vagas encerradas há mais de seis meses são arquivadas aqui para consulta do histórico. Você ainda não tem nenhuma.', 'Arquivar vagas encerradas'],
    eventos: ['Candidata Renata Freitas concluiu o teste técnico com nota acima da média e avançou para a entrevista final', 'Vaga de analista de dados recebeu 46 novas candidaturas nas últimas 24 horas pelo portal de carreiras', 'Entrevista com o gestor da área foi reagendada para sexta-feira às 10h por solicitação do candidato'],
    alerta: 'Não foi possível sincronizar as candidaturas do portal de carreiras. A lista pode estar incompleta.',
    passos: ['Cadastrar os departamentos', 'Importar o banco de talentos', 'Convidar os gestores de área', 'Configurar as etapas do processo seletivo'],
    convite: 'Convidar gestor', sync: ['Candidaturas', 'Currículos', 'Testes', 'Avaliações'] },
  { app: 'LojaViva', org: 'Rede Mercado Central', ent: 'pedido', entP: 'Pedidos', novo: 'Novo pedido', pref: 'PED', secao: 'Vendas',
    nav: ['Início', 'Pedidos', 'Produtos', 'Clientes', 'Estoque', 'Relatórios', 'Equipe', 'Configurações'],
    kpis: [['Pedidos hoje', '386'], ['Ticket médio', 'R$ 142,80'], ['Aguardando separação', '41'], ['Devoluções abertas', '9']],
    rel: ['Ver relatório de vendas', 'Ver relatório de devoluções', 'Ver produtos mais vendidos'],
    descs: ['Kit de utensílios de cozinha com cinco peças, enviado como presente com embalagem especial e cartão',
      'Três caixas de café especial torrado em grãos, entrega agendada para o escritório da cliente em Niterói',
      'Smartphone de 128 GB na cor grafite com película e capinha, pagamento parcelado em dez vezes no cartão',
      'Mesa de escritório com tampo de madeira e gaveteiro, montagem inclusa e entrega em horário comercial',
      'Combo de produtos de limpeza para reposição mensal do restaurante, com nota fiscal em nome da empresa',
      'Tênis de corrida masculino número 42 com troca solicitada por tamanho, aguardando a devolução do original'],
    status: ['Separando', 'Enviado', 'Cancelado', 'Aguardando pagamento'],
    vazio: ['Nenhum pedido arquivado', 'Pedidos finalizados há mais de um ano são arquivados aqui para consultas fiscais. Por enquanto, não há nenhum.', 'Arquivar pedidos antigos'],
    eventos: ['Pagamento do pedido de Márcia Duarte foi aprovado pela operadora e a separação no estoque já começou', 'Transportadora informou atraso de dois dias nas entregas para a região Norte por causa de greve de caminhoneiros', 'Estoque do produto cafeteira elétrica chegou ao nível mínimo e o comprador recebeu um aviso de reposição'],
    alerta: 'Não foi possível atualizar o estoque das lojas físicas. As quantidades exibidas podem estar diferentes das reais.',
    passos: ['Cadastrar o primeiro produto', 'Importar o catálogo de clientes', 'Convidar os vendedores da loja', 'Configurar as formas de pagamento'],
    convite: 'Convidar vendedor', sync: ['Produtos', 'Preços', 'Estoque', 'Pedidos'] },
  { app: 'SalaAberta', org: 'Colégio Horizonte Azul', ent: 'turma', entP: 'Turmas', novo: 'Nova turma', pref: 'TUR', secao: 'Acadêmico',
    nav: ['Início', 'Turmas', 'Alunos', 'Professores', 'Avaliações', 'Relatórios', 'Equipe', 'Configurações'],
    kpis: [['Turmas ativas', '36'], ['Alunos matriculados', '1.124'], ['Frequência média', '92%'], ['Avaliações a corrigir', '58']],
    rel: ['Ver relatório de desempenho', 'Ver relatório de frequência', 'Ver boletim consolidado'],
    descs: ['Sétimo ano A do turno da manhã com projeto interdisciplinar de ciências e geografia sobre bacias hidrográficas',
      'Primeiro ano do ensino médio, turno da tarde, com reforço semanal de matemática e laboratório de redação',
      'Turma de alfabetização com atividades de leitura compartilhada e acompanhamento individual da evolução',
      'Terceiro ano do ensino médio com preparação para o vestibular e simulados quinzenais de todas as áreas',
      'Oficina de robótica educacional aberta a alunos do sexto ao nono ano, com encontros semanais no laboratório',
      'Turma noturna de educação de jovens e adultos com módulos de língua portuguesa, história e informática básica'],
    status: ['Em andamento', 'Concluída', 'Lotada', 'Planejada'],
    vazio: ['Nenhuma turma arquivada', 'Turmas de anos letivos anteriores são arquivadas aqui para consulta de históricos. Ainda não há nenhuma nesta lista.', 'Arquivar turmas antigas'],
    eventos: ['Professora Helena Cardoso lançou as notas da avaliação bimestral de matemática do sétimo ano A no diário', 'Reunião de pais da turma do terceiro ano foi marcada para o dia 18 às 19h no auditório principal', 'Aluno Pedro Henrique foi transferido da turma B para a turma A a pedido da família e com aval da coordenação'],
    alerta: 'Não foi possível carregar o diário de classe. As frequências exibidas podem estar desatualizadas.',
    passos: ['Cadastrar o ano letivo', 'Importar a lista de alunos', 'Convidar os professores', 'Configurar o calendário de avaliações'],
    convite: 'Convidar professor', sync: ['Matrículas', 'Notas', 'Frequência', 'Calendário'] },
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = n => String(n).padStart(2, '0');

export function variante(seed) {
  const R = rng(seed * 7919 + 13);
  const I = n => Math.floor(R() * n);
  const t = TEMAS[I(TEMAS.length)];
  const pessoas = embaralhar(R, NOMES);
  const descs = embaralhar(R, t.descs);
  const linhas = descs.map((d, i) => ({
    id: t.pref + '-' + (1000 + i * 137 + I(100)),
    desc: d, resp: pessoas[i % pessoas.length], st: I(4),
    data: pad(1 + I(28)) + '/' + pad(1 + I(11)) + '/2026',
  }));
  const alt = {};
  for (const [k, n] of Object.entries({ ne05: 7, ne07: 2, ne09: 3, ne08: 2, ne11: 2, ne12: 2, ne12m: 3, ne13m: 3, ne17: 2, ne19: 2, ne22: 2, ne29: 2, am08: 2, am14: 2, am21: 2, am34: 2 })) alt[k] = I(n);
  return { seed, t, linhas, usuario: pessoas[0], alt, concluidos: 1 + I(2), sincEtapa: 1 + I(2), nNot: 2 + I(8) };
}

const CSS = `
:root{
  --bg:#f4f6f9;
  --superficie:#ffffff;
  --texto:#1b2430;
  --texto-2:#46515f;
  --borda:#d5dbe4;
  --primaria:#1f5fbf;
  --primaria-esc:#174a96;
  --ok:#1a6e42;
  --aviso:#7a4f00;
  --perigo:#a8231b;
  --fundo-perigo:#fdecea;
  --fundo-ok:#e5f4ec;
  --fundo-aviso:#fff4d6;
  --raio:8px;
  --e1:4px;
  --e2:8px;
  --e3:12px;
  --e4:16px;
  --e5:24px;
  --altura-topo:56px;
  --larg-lateral:236px;
  --fonte:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
}
*{box-sizing:border-box}
html{scroll-padding-top:72px}
body{margin:0;font-family:var(--fonte);font-size:15px;line-height:1.5;color:var(--texto);background:var(--bg)}
h1{font-size:clamp(1.5rem,1.1rem + 1vw,2rem);margin:0;line-height:1.2}
h2,.titulo-secao{font-size:1.125rem;font-weight:700;margin:0 0 var(--e3);line-height:1.3}
h3{font-size:1rem;margin:0 0 var(--e1)}
p{margin:0 0 var(--e2)}
a{color:var(--primaria)}
a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #0b3d91;outline-offset:2px}
ul,ol{margin:0;padding:0;list-style:none}
.so-leitor{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.pular{position:absolute;left:-9999px;top:var(--e2);background:#000;color:#fff;padding:var(--e2) var(--e4);z-index:50}
.pular:focus{left:var(--e2)}
.faixa-aviso{background:#243447;color:#fff;padding:var(--e2) var(--e4);font-size:.875rem}
.topo{position:sticky;top:0;z-index:20;height:var(--altura-topo);display:flex;align-items:center;gap:var(--e4);padding:0 var(--e4);background:var(--superficie);border-bottom:1px solid var(--borda)}
.marca{font-weight:800;font-size:1.125rem;text-decoration:none;color:var(--primaria-esc);min-width:var(--larg-lateral)}
.busca{display:flex;gap:var(--e2);flex:1;max-width:520px}
.busca input{flex:1;padding:var(--e2) var(--e3);border:1px solid var(--borda);border-radius:var(--raio);font:inherit}
.topo-acoes{margin-left:auto;display:flex;align-items:center;gap:var(--e3)}
.btn,.btn-icone,.btn-txt,.busca button{font:inherit;cursor:pointer;border-radius:var(--raio);padding:var(--e2) var(--e4);border:1px solid var(--borda);background:var(--superficie);color:var(--texto)}
.btn-prim{background:var(--primaria);border-color:var(--primaria);color:#fff}
.btn-perigo{background:var(--perigo);border-color:var(--perigo);color:#fff}
.btn-icone{display:inline-flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;text-decoration:none;color:var(--texto)}
.btn-txt{border-color:transparent;background:transparent;text-decoration:underline}
.avatar{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:var(--primaria);color:#fff;font-size:.8125rem;font-weight:700;text-decoration:none}
.layout{display:grid;grid-template-columns:var(--larg-lateral) minmax(0,1fr);align-items:start}
.lateral{position:sticky;top:var(--altura-topo);padding:var(--e4) var(--e3);background:var(--superficie);border-right:1px solid var(--borda);min-height:calc(100vh - var(--altura-topo))}
.menu li{margin-bottom:2px}
.menu a,.lateral nav>a{display:flex;align-items:center;gap:var(--e3);padding:var(--e2) var(--e3);border-radius:var(--raio);color:var(--texto-2);text-decoration:none;font-weight:500}
.menu a:hover,.lateral nav>a:hover{background:var(--bg)}
.menu a.ativo,.lateral nav>a.ativo{background:#e3edfb;color:var(--primaria-esc);font-weight:700}
.ico{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;flex:none}
.org{font-size:.8125rem;color:var(--texto-2);padding:var(--e2) var(--e3) var(--e4)}
main{padding:var(--e5);display:block;min-width:0}
main:focus{outline:none}
.banner{display:flex;align-items:center;justify-content:space-between;gap:var(--e4);background:var(--fundo-aviso);color:#4a3200;border:1px solid #e8cf86;border-radius:var(--raio);padding:var(--e2) var(--e4);margin-bottom:var(--e4)}
.banner p{margin:0}
.breadcrumb ol{display:flex;flex-wrap:wrap;gap:var(--e2);font-size:.875rem;color:var(--texto-2)}
.breadcrumb li+li::before{content:"/";margin-right:var(--e2);color:var(--texto-2)}
.breadcrumb a{color:var(--texto-2)}
.pagina-topo{display:flex;align-items:center;justify-content:space-between;gap:var(--e4);margin:var(--e3) 0 var(--e4)}
.acoes-pagina{display:flex;gap:var(--e2)}
.abas{border-bottom:1px solid var(--borda);margin-bottom:var(--e5)}
.abas ul{display:flex;gap:var(--e4)}
.abas a{display:block;padding:var(--e2) var(--e1);color:var(--texto-2);text-decoration:none;border-bottom:3px solid transparent}
.abas a[aria-current="page"]{color:var(--primaria-esc);border-bottom-color:var(--primaria);font-weight:700}
section{background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);padding:var(--e4) var(--e5);margin-bottom:var(--e4)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--e3);margin-bottom:var(--e4)}
.kpi{border:1px solid var(--borda);border-radius:var(--raio);padding:var(--e3) var(--e4)}
.kpi-r{font-size:.8125rem;color:var(--texto-2);margin:0}
.kpi-v{font-size:1.75rem;font-weight:700;margin:0}
.cards-links{display:flex;gap:var(--e5);flex-wrap:wrap}
.barra{height:8px;background:var(--bg);border-radius:4px;overflow:hidden;margin:var(--e2) 0 var(--e3)}
.barra span{display:block;height:100%;background:var(--ok)}
.passos li{padding:var(--e2) 0;border-top:1px solid var(--borda);display:flex;gap:var(--e3);align-items:center}
.passos li.feito a{color:var(--texto-2)}
.passos .marca-passo{display:inline-flex;width:22px;height:22px;border-radius:50%;border:2px solid var(--borda);align-items:center;justify-content:center;font-size:.75rem}
.passos .feito .marca-passo{background:var(--ok);border-color:var(--ok);color:#fff}
.tabela-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{text-align:left;padding:var(--e2) var(--e3);border-bottom:1px solid var(--borda);vertical-align:middle}
th{font-size:.8125rem;color:var(--texto-2);font-weight:600}
th:nth-child(2){width:34%}
.trunc{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.selo{display:inline-block;padding:2px var(--e2);border-radius:999px;font-size:.8125rem;font-weight:600}
.s-0{background:#e3edfb;color:#174a96}
.s-1{background:var(--fundo-ok);color:var(--ok)}
.s-2{background:var(--fundo-perigo);color:var(--perigo)}
.s-3{background:var(--fundo-aviso);color:var(--aviso)}
.regiao{border:1px dashed var(--borda);border-radius:var(--raio);padding:var(--e3) var(--e4)}
.lista-sync li,.eventos li{display:flex;gap:var(--e3);align-items:center;padding:var(--e2) 0;border-bottom:1px solid var(--borda)}
.eventos .trunc{flex:1}
.hora{font-size:.8125rem;color:var(--texto-2);min-width:48px}
.skeleton{height:20px}
.skeleton span{display:block;height:12px;width:60%;border-radius:6px;background:linear-gradient(90deg,#e4e8ee,#f1f3f6,#e4e8ee)}
.alerta{background:var(--fundo-perigo);border:1px solid #efb4af;color:#7a1610;border-radius:var(--raio);padding:var(--e3) var(--e4);margin-bottom:var(--e3)}
.alerta .btn{margin-left:var(--e3)}
.acoes{display:flex;gap:var(--e3);align-items:center}
.estado-vazio{text-align:center;padding:var(--e5) var(--e4)}
.ev-ico{width:40px;height:40px;fill:none;stroke:var(--texto-2);stroke-width:1.4;margin-bottom:var(--e2)}
.estado-vazio p{max-width:46ch;margin:0 auto var(--e3);color:var(--texto-2)}
.gaveta{position:fixed;top:var(--altura-topo);right:0;width:300px;height:calc(100vh - var(--altura-topo));background:var(--superficie);border-left:1px solid var(--borda);padding:var(--e4);z-index:30;transform:translateX(100%)}
.gaveta li{padding:var(--e2) 0}
.rodape{padding:var(--e4) var(--e5);border-top:1px solid var(--borda);background:var(--superficie);font-size:.875rem;color:var(--texto-2)}
.rodape ul{display:flex;gap:var(--e4);flex-wrap:wrap;margin-bottom:var(--e2)}
.rodape-links{display:flex;gap:var(--e4);margin-bottom:var(--e2)}
.modal{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55)}
.modal[hidden]{display:none}
.modal-caixa{position:relative;width:min(480px,92vw);background:var(--superficie);border-radius:var(--raio);padding:var(--e5)}
.modal-caixa h2{padding-right:48px}
.modal-x{position:absolute;top:var(--e3);right:var(--e3);padding:var(--e1) var(--e3)}
.modal-acoes{display:flex;justify-content:flex-end;gap:var(--e2);margin-top:var(--e4)}
.campo label{display:block;font-weight:600;margin-bottom:var(--e1)}
.campo input{width:100%;padding:var(--e2) var(--e3);border:1px solid var(--borda);border-radius:var(--raio);font:inherit}
.campo input:user-invalid{border-color:var(--perigo);background:var(--fundo-perigo)}
.erro-msg{color:var(--perigo);font-size:.875rem}
`;

function icone(d) { return `<svg class="ico" aria-hidden="true" focusable="false" viewBox="0 0 16 16"><path d="${d}"/></svg>`; }
const ICO = ['M2 7l6-5 6 5v7H2z', 'M2 4h12v9H2z', 'M3 3l10 10M13 3L3 13', 'M8 2a3 3 0 100 6 3 3 0 000-6zM3 14c0-3 2-4 5-4s5 1 5 4', 'M2 11h12M4 11V5h8v6', 'M3 13V6M8 13V3M13 13V9', 'M5 6a2 2 0 104 0 2 2 0 00-4 0M2 13c0-2 2-3 4-3M10 9a2 2 0 100-4M14 13c0-2-1-3-3-3', 'M8 5a3 3 0 100 6 3 3 0 000-6zM8 1v2M8 13v2M1 8h2M13 8h2'];

export function construir(v, violar) {
  const V = id => violar.has(id);
  const { t, alt } = v;
  const L = [];
  const p = s => L.push(s);
  const entp = t.entP.toLowerCase();
  const ini = v.usuario.split(' ').map(x => x[0]).join('');
  const hEnt = '/' + slug(t.entP);

  p('<!doctype html>');
  p('<html lang="pt-BR">');
  p('<head>');
  p('<meta charset="utf-8">');
  if (!V('AM34')) p('<meta name="viewport" content="width=device-width, initial-scale=1">');
  else if (alt.am34 === 1) p('<meta name="viewport" content="width=1280">');
  p(`<title>${esc(t.entP)} - ${esc(t.app)}</title>`);
  let css = CSS;
  if (V('NE14')) css = css.replace('html{scroll-padding-top:72px}\n', '');
  if (V('NE35')) css = css.replace('.campo input:user-invalid', '.campo input:invalid');
  if (V('AM41')) css = css.replace('font-size:clamp(1.5rem,1.1rem + 1vw,2rem)', 'font-size:2.4vw');
  p('<style>' + css + '</style>');
  p('</head>');
  p('<body>');
  p('<a class="pular" href="#conteudo">Pular para o conteúdo</a>');
  if (V('AM14') && alt.am14 === 1) p('<div class="faixa-aviso">Manutenção programada no domingo, das 02h às 04h. Alguns recursos ficarão indisponíveis.</div>');

  // Topo
  p('<header class="topo">');
  p(`  <a class="marca" href="/">${esc(t.app)}</a>`);
  p('  <form class="busca" role="search" action="/busca">');
  p(`    <label class="so-leitor" for="q">Buscar em ${esc(t.app)}</label>`);
  p(`    <input id="q" type="search" name="q" placeholder="Buscar ${esc(entp)}">`);
  p('    <button type="submit">Buscar</button>');
  p('  </form>');
  p('  <div class="topo-acoes">');
  p('    <button type="button" class="btn-icone" aria-controls="gaveta" aria-expanded="false">Ajuda</button>');
  const semNome = V('AM21');
  p(`    <a class="btn-icone" href="/notificacoes"${semNome && alt.am21 === 0 ? '' : ` aria-label="Notificações (${v.nNot} novas)"`}>${icone(ICO[7])}</a>`);
  p(`    <a class="avatar" href="/perfil"${semNome && alt.am21 === 1 ? '' : ` aria-label="Perfil de ${esc(v.usuario)}"`}><span aria-hidden="true">${ini}</span></a>`);
  p('  </div>');
  p('</header>');

  p('<div class="layout">');
  // Lateral
  p('<div class="lateral">');
  p('  <nav aria-label="Principal">');
  p(`    <p class="org">${esc(t.org)}</p>`);
  const semLista = V('AM08') && alt.am08 === 0;
  if (!semLista) p('    <ul class="menu">');
  t.nav.forEach((rot, i) => {
    const href = i === 0 ? '/inicio' : '/' + slug(rot);
    const atual = i === 1;
    let attrs = '';
    if (atual) attrs = V('NE06') ? ' class="ativo"' : ' class="ativo" aria-current="page"';
    else if (i === 0 && V('NE07') && !V('NE06') && alt.ne07 === 0) attrs = ' aria-current="page"';
    const a = `<a href="${href}"${attrs}>${icone(ICO[i % ICO.length])}${esc(rot)}</a>`;
    p(semLista ? '    ' + a : `      <li>${a}</li>`);
  });
  if (!semLista) p('    </ul>');
  p('  </nav>');
  p('</div>');

  // Principal
  p('<main id="conteudo" tabindex="-1">');
  p('  <div class="banner" role="status">');
  p(`    <p>Nova versão do ${esc(t.app)} disponível, com filtros salvos e atalhos de teclado. <a href="/novidades">Conheça as novidades</a></p>`);
  p('    <button type="button" class="btn-txt">Dispensar</button>');
  p('  </div>');
  if (V('NE33')) {
    p('  <div class="banner" role="status">');
    p('    <p>Manutenção programada para domingo, das 02h às 04h.</p>');
    p('    <button type="button" class="btn-txt">Dispensar</button>');
    p('  </div>');
  }

  // Breadcrumb
  const bcLabel = V('NE08') && alt.ne08 === 0 ? '' : ' aria-label="Você está em"';
  const bcTag = V('NE08') && alt.ne08 === 1 ? 'div' : 'nav';
  const b9 = V('NE09') ? alt.ne09 : -1;
  p(`  <${bcTag} class="breadcrumb"${bcLabel}>`);
  if (b9 === 2) {
    p(`    <a href="/inicio">Início</a> / <a href="/${slug(t.secao)}">${esc(t.secao)}</a>`);
  } else {
    p('    <ol>');
    if (b9 !== 0) p('      <li><a href="/inicio">Início</a></li>');
    p(`      <li><a href="/${slug(t.secao)}">${esc(t.secao)}</a></li>`);
    if (b9 === 1) p(`      <li><a href="${hEnt}">${esc(t.entP)}</a></li>`);
    p('    </ol>');
  }
  p(`  </${bcTag}>`);

  p('  <div class="pagina-topo">');
  p(`    <h1>${esc(t.entP)}</h1>`);
  p('    <div class="acoes-pagina">');
  p('      <button type="button" class="btn">Exportar</button>');
  p(`      <button type="button" class="btn btn-prim" aria-haspopup="dialog" aria-controls="m0">${esc(t.novo)}</button>`);
  p('    </div>');
  p('  </div>');

  // Abas
  p(`  <nav class="abas" aria-label="Seções de ${esc(entp)}">`);
  p('    <ul>');
  ABAS.forEach((ab, i) => {
    const at = i === 0 ? ' aria-current="page"' : (i === 1 && V('NE07') && (alt.ne07 === 1 || V('NE06')) ? ' aria-current="page"' : '');
    p(`      <li><a href="${hEnt}/${slug(ab)}"${at}>${ab}</a></li>`);
  });
  p('    </ul>');
  p('  </nav>');

  const sec = (i, id, titulo) => (V('NE05') && alt.ne05 === i)
    ? `    <div class="titulo-secao" id="h-${id}">${titulo}</div>`
    : `    <h2 id="h-${id}">${titulo}</h2>`;
  const prefixo = on => on ? '<span class="so-leitor">Erro:</span> ' : '';

  // 0 Resumo
  p('  <section aria-labelledby="h-resumo">');
  p(sec(0, 'resumo', 'Resumo do período'));
  p('    <div class="kpis">');
  for (const [r, val] of t.kpis) { p('      <div class="kpi">'); p(`        <p class="kpi-r">${esc(r)}</p>`); p(`        <p class="kpi-v">${esc(val)}</p>`); p('      </div>'); }
  p('    </div>');
  p('    <ul class="cards-links">');
  const geral = ['Clique aqui', 'Saiba mais'];
  t.rel.forEach((r, i) => {
    let txt = r;
    if (V('NE10') && i < 2) txt = geral[i];
    p(`      <li><a href="/relatorios/${slug(r)}">${esc(txt)}</a></li>`);
  });
  p('    </ul>');
  p('  </section>');

  // 1 Onboarding
  p('  <section aria-labelledby="h-passos">');
  p(sec(1, 'passos', 'Primeiros passos'));
  p(`    <p>${v.concluidos} de ${t.passos.length} etapas concluídas. Complete a configuração para liberar todos os recursos.</p>`);
  p(`    <div class="barra"><span style="width:${v.concluidos * 100 / t.passos.length}%"></span></div>`);
  p('    <ol class="passos">');
  t.passos.forEach((ps, i) => {
    const feito = i < v.concluidos;
    p(`      <li${feito ? ' class="feito"' : ''}><span class="marca-passo" aria-hidden="true">${feito ? '&#10003;' : i + 1}</span><a href="/onboarding/passo-${i + 1}">${esc(ps)}</a></li>`);
  });
  p('    </ol>');
  p('  </section>');

  // 2 Tabela
  p('  <section aria-labelledby="h-atividade">');
  p(sec(2, 'atividade', `${t.entP} recentes`));
  p('    <div class="tabela-wrap">');
  p('      <table>');
  p(`        <caption class="so-leitor">Lista das ${esc(entp)} mais recentes</caption>`);
  p('        <thead>');
  p('          <tr>');
  for (const [c] of COLS) p(`            <th scope="col">${c}</th>`);
  p('          </tr>');
  p('        </thead>');
  p('        <tbody>');
  for (const l of v.linhas) {
    const txt = V('NE11') && alt.ne11 === 0 ? 'Ver detalhes' : `Abrir ${t.ent} ${l.id}`;
    p('          <tr>');
    p(`            <td><a href="${hEnt}/${l.id}">${esc(txt)}</a></td>`);
    p(`            <td><span class="trunc"${V('AM48') ? '' : ` title="${esc(l.desc)}"`}>${esc(l.desc)}</span></td>`);
    p(`            <td>${esc(l.resp)}</td>`);
    p(`            <td><span class="selo s-${l.st}">${esc(t.status[l.st])}</span></td>`);
    p(`            <td>${l.data}</td>`);
    p('          </tr>');
  }
  p('        </tbody>');
  p('      </table>');
  p('    </div>');
  p('  </section>');

  // 3 Sincronização (carregando)
  const busyCarreg = V('NE19') && alt.ne19 === 0 ? 'false' : 'true';
  p('  <section aria-labelledby="h-sync">');
  p(sec(3, 'sync', 'Sincronização de dados'));
  p(`    <div class="regiao" role="status" aria-live="polite" aria-busy="${busyCarreg}">`);
  p('      <ul class="lista-sync">');
  t.sync.forEach((s, i) => {
    if (i < v.sincEtapa + 1) p(`        <li><span>${esc(s)}: concluído</span></li>`);
    else p(`        <li class="skeleton"><span></span></li>`);
  });
  p('      </ul>');
  p(`      <p>Carregando ${t.sync.length - v.sincEtapa - 1} de ${t.sync.length} módulos. Isso pode levar alguns minutos.</p>`);
  p('    </div>');
  p('  </section>');

  // 4 Eventos (carregado)
  const busyOk = V('NE19') && alt.ne19 === 1 ? 'true' : 'false';
  p('  <section aria-labelledby="h-eventos">');
  p(sec(4, 'eventos', 'Últimos eventos'));
  p(`    <div class="regiao" role="log" aria-live="polite" aria-busy="${busyOk}">`);
  p('      <ul class="eventos">');
  t.eventos.forEach((e, i) => {
    p(`        <li><span class="hora">${pad(8 + i * 2)}:${pad(10 + i * 13)}</span><span class="trunc"${V('AM48') ? '' : ` title="${esc(e)}"`}>${esc(e)}</span></li>`);
  });
  p('      </ul>');
  p('    </div>');
  p('  </section>');

  // 5 Alerta de integração
  p('  <section aria-labelledby="h-integ">');
  p(sec(5, 'integ', 'Integrações'));
  const retry = '<button type="button" class="btn">Tentar novamente</button>';
  const diag = '<a href="/diagnostico">Abrir diagnóstico</a>';
  const dentro = V('NE17') ? (alt.ne17 === 0 ? retry : retry + ' ' + diag) : '';
  p(`    <div class="alerta erro-msg" role="alert">`);
  p(`      ${prefixo(!(V('NE22') && alt.ne22 === 0))}${esc(t.alerta)}${dentro ? '\n      ' + dentro : ''}`);
  p('    </div>');
  if (!V('NE17')) {
    p('    <div class="acoes">');
    p('      ' + retry);
    p('      ' + diag);
    p('    </div>');
  }
  p('  </section>');

  // 6 Vazio
  p('  <section aria-labelledby="h-arq">');
  p(sec(6, 'arq', 'Arquivados'));
  p('    <div class="estado-vazio">');
  p('      <svg class="ev-ico" aria-hidden="true" focusable="false" viewBox="0 0 40 40"><path d="M6 12h28v22H6zM4 6h32v6H4zM16 20h8"/></svg>');
  p(`      <h3>${esc(t.vazio[0])}</h3>`);
  if (!(V('NE29') && alt.ne29 === 1)) p(`      <p>${esc(t.vazio[1])}</p>`);
  if (!(V('NE29') && alt.ne29 === 0)) p(`      <button type="button" class="btn">${esc(t.vazio[2])}</button>`);
  p('    </div>');
  p('  </section>');
  p('</main>');
  p('</div>');

  // Rodapé
  const foot = V('AM14') && alt.am14 === 0 ? 'div' : 'footer';
  p(`<${foot} class="rodape">`);
  if (V('AM08') && alt.am08 === 1) {
    p('  <div class="rodape-links">');
    for (const [r, h] of RODAPE) p(`    <a href="${h}">${r}</a>`);
    p('  </div>');
  } else {
    p('  <ul>');
    for (const [r, h] of RODAPE) p(`    <li><a href="${h}">${r}</a></li>`);
    p('  </ul>');
  }
  p(`  <p>${esc(t.org)}. Todos os direitos reservados.</p>`);
  p(`</${foot}>`);

  // Gaveta de ajuda
  const gAtr = V('AM27') ? 'aria-hidden="true"' : 'hidden';
  p(`<aside class="gaveta" id="gaveta" aria-label="Central de ajuda" ${gAtr}>`);
  p('  <h2>Central de ajuda</h2>');
  p('  <ul>');
  for (const [r, h] of GAVETA) p(`    <li><a href="${h}">${r}</a></li>`);
  if (V('NE11') && alt.ne11 === 1) p('    <li><a href="/ajuda/inicio">Primeiros passos</a></li>');
  p('  </ul>');
  p('</aside>');

  // Modais
  const modal = (i, titulo, corpo, botoes) => {
    const semClose = V('NE13') && alt.ne13m === i;
    const semRole = V('NE12') && alt.ne12m === i && alt.ne12 === 0;
    const semNomeM = V('NE12') && alt.ne12m === i && alt.ne12 === 1;
    p(`<div class="modal"${semRole ? '' : ' role="dialog" aria-modal="true"'}${semNomeM ? '' : ` aria-labelledby="m${i}-t"`} id="m${i}" hidden>`);
    p('  <div class="modal-caixa">');
    p(`    <h2 id="m${i}-t">${titulo}</h2>`);
    if (!semClose) p('    <button type="button" class="btn modal-x" aria-label="Fechar janela">&times;</button>');
    for (const l of corpo) p('    ' + l);
    p('    <div class="modal-acoes">');
    for (const [rot, cls, fecha] of botoes) { if (fecha && semClose) continue; p(`      <button type="${cls.includes('prim') || cls.includes('perigo') ? 'submit' : 'button'}" class="btn ${cls}">${rot}</button>`); }
    p('    </div>');
    p('  </div>');
    p('</div>');
  };
  modal(0, esc(t.convite), [
    '<p>Enviaremos um link de acesso por e-mail. O convite expira em 7 dias.</p>',
    '<div class="campo">',
    '  <label for="conv-email">E-mail do convidado</label>',
    '  <input id="conv-email" type="email" name="email" required aria-describedby="conv-erro" value="nome@">',
    `  <p class="erro-msg" id="conv-erro">${prefixo(!(V('NE22') && alt.ne22 === 1))}Informe um e-mail válido, como nome@empresa.com.br.</p>`,
    '</div>',
  ], [['Cancelar', '', true], ['Enviar convite', 'btn-prim', false]]);
  modal(1, `Excluir ${esc(t.ent)}?`, [
    '<p>Esta ação não pode ser desfeita. Os anexos e o histórico também serão removidos.</p>',
  ], [['Cancelar', '', true], ['Excluir', 'btn-perigo', false]]);
  modal(2, `Bem-vindo ao ${esc(t.app)}`, [
    `<p>Em poucos minutos você configura ${esc(entp)}, equipe e integrações. Vamos começar?</p>`,
  ], [['Começar a usar', 'btn-prim', false]]);
  p('</body>');
  p('</html>');
  return L.join('\n');
}

export async function checar(pagina) {
  await pagina.setViewportSize({ width: 1280, height: 800 });
  await pagina.evaluate(AXE_SRC);
  const axeIds = await pagina.evaluate(async () => (await axe.run(document, { runOnly: { type: 'rule', values: ['list', 'region', 'link-name', 'aria-hidden-focus'] } })).violations.map(x => x.id));
  const d = await pagina.evaluate(() => {
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const T = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
    const nome = a => { const l = (a.getAttribute('aria-label') || '').trim(); if (l) return l; return T(a) || (a.querySelector('img[alt]') ? a.querySelector('img[alt]').alt : ''); };
    const nomeado = e => { if ((e.getAttribute('aria-label') || '').trim()) return true; return (e.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).some(i => { const x = document.getElementById(i); return x && T(x); }); };
    const visivel = e => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none';
    const bc = document.querySelector('.breadcrumb,[aria-label*="igalha" i],[aria-label*="readcrumb" i]');
    const ehBc = n => n.matches('.breadcrumb') || !!n.closest('.breadcrumb') || /migalha|breadcrumb|você está em/i.test(n.getAttribute('aria-label') || '');
    const r = {};
    // NE05
    const secs = $$('section');
    r.NE05 = { ok: secs.length > 0 && secs.every(s => /^H[1-6]$/.test(s.firstElementChild ? s.firstElementChild.tagName : '')), nota: secs.filter(s => !/^H[1-6]$/.test(s.firstElementChild ? s.firstElementChild.tagName : '')).length + ' seção(ões) sem título inicial' };
    // NE06
    const navs = $$('nav').filter(n => !ehBc(n) && $$('a', n).length >= 4);
    const sem6 = navs.filter(n => !n.querySelector('[aria-current="page"]'));
    r.NE06 = { ok: navs.length > 0 && sem6.length === 0, nota: sem6.length + ' menu(s) sem aria-current' };
    // NE07
    const mult = $$('nav').filter(n => $$('[aria-current="page"]', n).length > 1);
    r.NE07 = { ok: mult.length === 0, nota: mult.length + ' menu(s) com mais de um aria-current' };
    // NE08
    if (!bc) r.NE08 = { ok: false, nota: 'sem breadcrumb' };
    else { const n = bc.closest('nav'); r.NE08 = { ok: !!n && nomeado(n), nota: n ? 'nav ' + (nomeado(n) ? 'nomeado' : 'sem nome') : 'fora de nav' }; }
    // NE09
    if (!bc) r.NE09 = { ok: false, nota: 'sem breadcrumb' };
    else {
      const lis = $$('li', bc); const lista = !!bc.querySelector('ol,ul') && lis.length >= 2;
      const a0 = lis[0] ? lis[0].querySelector('a[href]') : null;
      const inicio = !!a0 && /^início$/i.test(T(a0));
      const h1 = document.querySelector('h1');
      const ult = lis.length ? T(lis[lis.length - 1]) : '';
      const fimOk = lis.length > 0 && !(h1 && ult.toLowerCase() === T(h1).toLowerCase());
      r.NE09 = { ok: lista && inicio && fimOk, nota: `lista=${lista} início=${inicio} fimOk=${fimOk}` };
    }
    // NE10
    const gen = /^(clique aqui|clique|aqui|saiba mais|leia mais|veja mais|ver mais|mais|mais informações|link|saiba|acesse)$/i;
    const ruins = $$('a[href]').filter(a => gen.test(nome(a).replace(/[.…]+$/, '')));
    r.NE10 = { ok: ruins.length === 0, nota: ruins.map(nome).join(' | ') };
    // NE11
    const porH = {}, porN = {};
    for (const a of $$('a[href]')) { const h = a.getAttribute('href'), n = nome(a).toLowerCase(); if (!n || h.startsWith('#')) continue; (porH[h] = porH[h] || new Set()).add(n); (porN[n] = porN[n] || new Set()).add(h); }
    const c1 = Object.entries(porH).filter(([, s]) => s.size > 1).length, c2 = Object.entries(porN).filter(([, s]) => s.size > 1).length;
    r.NE11 = { ok: c1 + c2 === 0, nota: `mesmo destino com textos diferentes=${c1}; mesmo texto com destinos diferentes=${c2}` };
    // NE12 e NE13
    const mods = $$('.modal,dialog,[role=dialog],[role=alertdialog],[aria-modal="true"]');
    const m12 = mods.filter(m => !(m.tagName === 'DIALOG' || /^(alert)?dialog$/.test(m.getAttribute('role') || '')) || !nomeado(m));
    r.NE12 = { ok: mods.length > 0 && m12.length === 0, nota: m12.length + ' modal(is) sem role/nome' };
    const m13 = mods.filter(m => !$$('button,a[href],[role=button]', m).some(b => /fechar|cancelar|dispensar/i.test(nome(b))));
    r.NE13 = { ok: mods.length > 0 && m13.length === 0, nota: m13.length + ' modal(is) sem fechar' };
    // NE14
    const fix = $$('body *').filter(e => { const cs = getComputedStyle(e); if (!/^(fixed|sticky)$/.test(cs.position)) return false; const b = e.getBoundingClientRect(); return b.top <= 1 && b.width >= innerWidth * 0.6 && b.height > 0 && b.height <= 250; });
    if (!fix.length) r.NE14 = { ok: true, nota: 'sem cabeçalho fixo' };
    else { const h = Math.max(...fix.map(e => e.getBoundingClientRect().height)); const sp = Math.max(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0, parseFloat(getComputedStyle(document.body).scrollPaddingTop) || 0); r.NE14 = { ok: sp >= h - 1, nota: `cabeçalho ${h}px, scroll-padding ${sp}px` }; }
    // NE17
    const al = $$('[role=alert]').filter(a => a.querySelector('a,button,[role=button],input[type=button],input[type=submit]'));
    r.NE17 = { ok: al.length === 0, nota: al.length + ' alert(s) com controle' };
    // NE19
    const regs = $$('[aria-live]:not([aria-live=off]),[role=status],[role=log],[role=alert]');
    const m19 = regs.filter(g => { const ph = !!g.querySelector('[class*=skeleton],progress,[role=progressbar]'); const b = g.getAttribute('aria-busy'); return (ph && b !== 'true') || (!ph && b === 'true'); });
    r.NE19 = { ok: regs.length > 0 && m19.length === 0, nota: m19.length + ' região(ões) com aria-busy incoerente' };
    // NE22
    const er = $$('[role=alert],.erro-msg');
    const m22 = er.filter(e => { const prim = [...e.childNodes].find(n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())); if (!prim || prim.nodeType !== 1 || T(prim) !== 'Erro:') return true; const cs = getComputedStyle(prim); return !(cs.position === 'absolute' && parseFloat(cs.width) <= 1 && parseFloat(cs.height) <= 1); });
    r.NE22 = { ok: er.length > 0 && m22.length === 0, nota: m22.length + ' erro(s) sem prefixo oculto' };
    // NE29
    const vz = $$('[class*=vazio]');
    const m29 = vz.filter(e => $$('p', e).map(T).join(' ').length < 25 || !e.querySelector('a[href],button'));
    r.NE29 = { ok: vz.length > 0 && m29.length === 0, nota: m29.length + ' estado(s) vazio(s) incompleto(s)' };
    // NE33
    const bn = $$('[class*=banner]').filter(visivel), rs = $$('[class*=resumo-erro],[class*=error-summary]').filter(visivel);
    r.NE33 = { ok: bn.length <= 1 && !(bn.length && rs.length), nota: bn.length + ' banner(s), ' + rs.length + ' resumo(s) de erro' };
    // NE35
    const css = $$('style').map(s => s.textContent).join('\n');
    const ruim = /(?<!user-):invalid/.test(css), bom = /:user-invalid/.test(css);
    r.NE35 = { ok: !ruim && bom, nota: `:invalid=${ruim} :user-invalid=${bom}` };
    // AM08 (parte DOM)
    const solto = $$('a[href]').filter(a => !a.closest('.breadcrumb') && a.closest('nav') && !a.closest('li'));
    const grupos = $$('body *').filter(e => !e.closest('.breadcrumb') && !/^(LI|UL|OL|DL)$/.test(e.tagName) && [...e.children].filter(c => c.tagName === 'A' && c.hasAttribute('href')).length >= 3);
    r.AM08 = { ok: solto.length === 0 && grupos.length === 0, nota: `links de nav fora de li=${solto.length}; grupos soltos=${grupos.length}` };
    // AM34
    const mv = document.querySelector('meta[name=viewport]');
    r.AM34 = { ok: !!mv && /width\s*=\s*device-width/i.test(mv.content), nota: mv ? mv.content : 'sem meta viewport' };
    // AM41
    const fontes = [];
    const rx = /font-size\s*:\s*([^;}"]+)/gi; let m;
    const fonte = css + '\n' + $$('[style]').map(e => e.getAttribute('style')).join(';');
    while ((m = rx.exec(fonte))) fontes.push(m[1].trim());
    const m41 = fontes.filter(f => /\d(vw|vh|vmin|vmax)\b/i.test(f) && !/\d(rem|em|px|pt|ch|%)/i.test(f));
    r.AM41 = { ok: m41.length === 0, nota: m41.join(' | ') };
    // AM48
    const tr = $$('body *').filter(e => { const cs = getComputedStyle(e); return cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1; });
    const m48 = tr.filter(e => { const ti = (e.getAttribute('title') || '').replace(/\s+/g, ' ').trim(); return !(ti && ti === T(e)) && !e.closest('a[href]'); });
    r.AM48 = { ok: m48.length === 0, nota: `${tr.length} truncado(s), ${m48.length} sem revelar` };
    return r;
  });
  const fora = (id, axeId, msg) => ({ ok: !axeIds.includes(axeId), nota: msg + (axeIds.includes(axeId) ? ' violada' : ' ok') });
  d.AM08.ok = d.AM08.ok && !axeIds.includes('list');
  d.AM14 = fora('AM14', 'region', 'axe region');
  d.AM21 = fora('AM21', 'link-name', 'axe link-name');
  d.AM27 = fora('AM27', 'aria-hidden-focus', 'axe aria-hidden-focus');
  const saida = {};
  for (const id of REGRAS) saida[id] = d[id];
  return saida;
}

export function ruido(html, seed) {
  const R = rng(seed * 31 + 7);
  const i = html.indexOf('</style>');
  let cab = html.slice(0, i), corpo = html.slice(i);
  cab = cab.replace(/<!doctype html>/i, '<!DOCTYPE html>').replace(/#fff;/g, '#ffffff;').replace(/;\}/g, '; }').replace(/\n\*\{/, '\n/* base */\n*{');
  corpo = corpo.replace(/<section /g, () => `<!-- bloco ${Math.floor(R() * 10000)} -->\n<section `);
  corpo = corpo.replace(/<(\w+) class="([^"]*)" id="([^"]*)"/g, '<$1 id="$3" class="$2"');
  corpo = corpo.replace(/>\n(\s*)</g, (m, s) => '>\n\n' + s + '  <');
  return cab + corpo;
}
