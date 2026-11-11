// Família "formulario": formulário longo em várias etapas (estudo 3b).
import { rng, pick, embaralhar } from '../comum.mjs';

export const ID = 'formulario';
export const TITULO = 'Formulário longo em várias etapas';
export const REGRAS = ['FC01', 'FC02', 'FC03', 'FC04', 'FC05', 'FC06', 'FC07', 'FC09', 'FC10', 'FC11', 'FC13', 'FC14', 'FC15', 'FC16', 'FC17', 'FC18', 'FC22', 'FC24', 'FC25', 'FC26', 'FC28', 'FC29', 'FC30', 'FC31', 'AM03', 'AM11', 'AM24', 'AM30', 'AM38', 'AM44'];

const TEMAS = [
  { k: 'logística', org: 'TransLog Brasil', form: 'Cadastro de transportadora', etapas: ['Dados da empresa', 'Responsável e contato', 'Frota e documentos', 'Seguros e garantias', 'Revisão e envio'], tab: { tit: 'Veículos informados', c1: 'Veículo', rows: [['Caminhão baú 3/4', '1.240,00', '14.880,00', 'Ativo'], ['Carreta graneleira', '2.980,00', '35.760,00', 'Ativo'], ['Van de entregas', '760,00', '9.120,00', 'Em análise'], ['Cavalo mecânico 6x2', '3.410,00', '40.920,00', 'Ativo']] } },
  { k: 'finanças', org: 'Banco Aurora', form: 'Abertura de conta empresarial', etapas: ['Tipo de conta', 'Titular e contato', 'Comprovantes', 'Produtos contratados', 'Revisão e envio'], tab: { tit: 'Produtos selecionados', c1: 'Produto', rows: [['Conta digital PJ', '29,90', '358,80', 'Ativo'], ['Cartão corporativo', '45,00', '540,00', 'Em análise'], ['Cobrança por boleto', '0,00', '0,00', 'Ativo']] } },
  { k: 'saúde', org: 'Clínica Vida Plena', form: 'Cadastro de paciente', etapas: ['Identificação', 'Dados pessoais e contato', 'Convênio e documentos', 'Histórico de saúde', 'Revisão e envio'], tab: { tit: 'Coberturas do plano', c1: 'Cobertura', rows: [['Consultas ambulatoriais', '312,40', '3.748,80', 'Incluída'], ['Exames laboratoriais', '98,20', '1.178,40', 'Incluída'], ['Internação', '540,00', '6.480,00', 'Carência'], ['Odontologia', '47,90', '574,80', 'Incluída']] } },
  { k: 'RH', org: 'Nexa Pessoas', form: 'Admissão de colaborador', etapas: ['Vaga e cargo', 'Dados pessoais e contato', 'Documentos', 'Benefícios', 'Revisão e envio'], tab: { tit: 'Benefícios escolhidos', c1: 'Benefício', rows: [['Vale-refeição', '880,00', '10.560,00', 'Ativo'], ['Plano de saúde', '412,30', '4.947,60', 'Ativo'], ['Auxílio-creche', '350,00', '4.200,00', 'Pendente']] } },
  { k: 'varejo', org: 'Mercado Central', form: 'Cadastro de lojista parceiro', etapas: ['Loja', 'Responsável e contato', 'Catálogo e documentos', 'Condições comerciais', 'Revisão e envio'], tab: { tit: 'Condições comerciais', c1: 'Condição', rows: [['Comissão por venda', '8,50', '102,00', 'Aprovada'], ['Tarifa de antecipação', '2,10', '25,20', 'Em análise'], ['Frete subsidiado', '0,00', '0,00', 'Aprovada'], ['Taxa de cadastro', '19,00', '228,00', 'Aprovada']] } },
  { k: 'educação', org: 'Instituto Horizonte', form: 'Matrícula de aluno', etapas: ['Curso', 'Dados do aluno e contato', 'Documentos', 'Mensalidade', 'Revisão e envio'], tab: { tit: 'Valores do curso', c1: 'Item', rows: [['Mensalidade', '1.190,00', '14.280,00', 'Contratado'], ['Material didático', '145,00', '1.740,00', 'Contratado'], ['Atividades extras', '210,00', '2.520,00', 'Opcional']] } },
];
const NOMES = ['José Antônio Ribeiro', 'Ana Beatriz Oliveira', 'Zhang Wei', 'Łukasz Kowalski', 'Maria das Graças Lima', 'Ayşe Yılmaz', 'Müller Fernandes', 'Thaís Nascimento Dias', 'Gabriel Ñandú Sosa', 'Renata Cavalcanti', 'Sakura Tanaka', 'Isabela Moreira Prado'];
const MAES = ['Lúcia Helena Barros', 'Conceição Duarte', 'Rosângela Pires', 'Fátima Andrade', 'Márcia Teixeira'];
const LUGARES = [['São Paulo', 'SP', '01310-100', 'Avenida Paulista', 'Bela Vista'], ['Belo Horizonte', 'MG', '30130-010', 'Rua da Bahia', 'Centro'], ['Curitiba', 'PR', '80020-290', 'Rua XV de Novembro', 'Centro'], ['Recife', 'PE', '50030-230', 'Avenida Conde da Boa Vista', 'Boa Vista'], ['Porto Alegre', 'RS', '90010-150', 'Rua dos Andradas', 'Centro Histórico'], ['Salvador', 'BA', '40020-000', 'Avenida Sete de Setembro', 'Centro']];
const UFS = ['SP', 'MG', 'PR', 'PE', 'RS', 'BA', 'RJ', 'SC', 'GO', 'CE'];

export function variante(seed) {
  const R = rng(seed * 7919 + 13);
  const tema = pick(R, TEMAS);
  const nome = pick(R, NOMES);
  const lug = pick(R, LUGARES);
  const lug2 = pick(R, LUGARES);
  const atual = 1 + Math.floor(R() * 3);
  const erros = embaralhar(R, ['cpf', 'ano', 'email', 'tel', 'cep']).slice(0, 3);
  const ordem = ['cpf', 'ano', 'email', 'tel', 'cep'];
  const id = n => String(Math.floor(R() * Math.pow(10, n))).padStart(n, '0');
  const slug = nome.split(' ')[0].normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase() || 'contato';
  return {
    seed, tema, atual, nome, erros: ordem.filter(k => erros.includes(k)),
    mae: pick(R, MAES), cpf: ['52998224725', '11144477735', '39053344705'][Math.floor(R() * 3)],
    email: `${slug}@${pick(R, ['exemplo.com.br', 'correio.net', 'empresa.com.br'])}`,
    tel: `11${9}${id(8)}`, d: String(1 + Math.floor(R() * 28)).padStart(2, '0'), m: String(1 + Math.floor(R() * 12)).padStart(2, '0'), a: String(1960 + Math.floor(R() * 45)),
    lug, lug2, num: String(10 + Math.floor(R() * 2000)), num2: String(10 + Math.floor(R() * 900)),
    comp: pick(R, ['Sala 12', 'Apto 304', 'Bloco B', '']), uf2: pick(R, UFS), pref: Math.floor(R() * 3), morad: Math.floor(R() * 3),
    hora: `${String(8 + Math.floor(R() * 10)).padStart(2, '0')}:${String(Math.floor(R() * 60)).padStart(2, '0')}`,
    status: embaralhar(R, ['Concluída', 'Com pendências', 'Em andamento']),
    termosN: 7 + Math.floor(R() * 3),
  };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function construir(v, violar) {
  const V = id => violar.has(id);
  const T = v.tema;
  const etapa = T.etapas[v.atual];
  const nEtapas = T.etapas.length;
  const ant = T.etapas[v.atual - 1], prox = T.etapas[v.atual + 1];
  const erroMsg = {
    cpf: ['cpf', 'Informe o CPF com 11 dígitos.'], ano: ['ano', 'Informe o ano de nascimento com 4 dígitos.'],
    email: ['email', 'Informe um e-mail completo, como nome@exemplo.com.br.'], tel: ['tel', 'Informe o telefone com DDD e 9 dígitos.'], cep: ['cep-res', 'Informe o CEP com 8 dígitos.'],
  };
  const comErro = k => v.erros.includes(k);
  const invalido = { cpf: v.cpf.slice(0, 8), ano: v.a.slice(2), email: v.email.split('@')[0] + '@', tel: v.tel.slice(0, 7), cep: v.lug[2].slice(0, 4) };
  const val = (k, ok) => esc(comErro(k) ? invalido[k] : ok);

  const desc = (...ids) => { const l = ids.filter(Boolean); return l.length ? ` aria-describedby="${l.join(' ')}"` : ''; };
  // Campo genérico
  const campo = o => {
    const { id, rot, tipo = 'text', req, auto, im, dica, key, valor = '', cls = '', extra = '', maxl, ph, tag = 'input', opts } = o;
    const erro = key && comErro(key) ? erroMsg[key][1] : '';
    const dId = dica ? `d-${id}` : null;
    const attrs = [
      tag === 'input' ? `type="${tipo}"` : '', `id="${id}"`, `name="${id}"`,
      auto ? `autocomplete="${auto}"` : '', im ? `inputmode="${im}"` : '', req && !V('FC09') ? 'required' : '',
      maxl ? `maxlength="${maxl}"` : '', ph ? `placeholder="${ph}"` : '', erro ? 'aria-invalid="true"' : '', extra,
    ].filter(Boolean).join(' ');
    const dd = desc(!V('FC11') && dica ? dId : null, erro ? `e-${id}` : null);
    const ctl = tag === 'select'
      ? `<select ${attrs}${dd}>${opts}</select>`
      : `<input ${attrs}${tag === 'input' ? ` value="${valor}"` : ''}${dd}>`;
    return `<div class="campo ${cls}${erro ? ' tem-erro' : ''}">
  <label for="${id}">${rot}${req ? ' <span class="obrig" aria-hidden="true">*</span>' : ''}</label>
  ${ctl}
  ${dica ? `<p class="dica" id="${dId}">${dica}</p>` : ''}
  ${erro ? `<p class="erro" id="e-${id}"><svg class="ico" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="currentColor"/></svg> ${erro}</p>` : ''}
</div>`;
  };
  const grupo = (violado, cls, legenda, interno, attrs = '') => violado
    ? `<div class="${cls}" ${attrs}>
  <p class="rotulo-grupo">${legenda}</p>
  ${interno}
</div>`
    : `<fieldset class="${cls}" ${attrs}>
  <legend class="rotulo-grupo">${legenda}</legend>
  ${interno}
</fieldset>`;
  const radios = (nome, legenda, ops, sel) => grupo(V('FC01'), 'grupo grupo-opcoes', legenda, `<div class="opcoes">
${ops.map((t, i) => `    <label class="opcao"><input type="radio" name="${nome}" value="${i}"${i === sel ? ' checked' : ''}> ${t}</label>`).join('\n')}
  </div>`);
  const opUF = sel => UFS.map(u => `<option value="${u}"${u === sel ? ' selected' : ''}>${u}</option>`).join('');
  const bloco = (suf, titulo, lug, num, comp, uf, req, bill, vazio) => {
    const a = (t) => (bill ? 'billing ' : '') + t;
    const numTipo = V('FC07') ? { tipo: 'number' } : { tipo: 'text', im: 'numeric' };
    const cepTipo = V('FC07') ? { tipo: 'number' } : { tipo: 'text', im: 'numeric' };
    const cityAuto = V('FC24') && suf === 'res' ? 'cidade' : a('address-level2');
    const rows = `
  <div class="linha">
    ${campo({ id: `cep-${suf}`, rot: 'CEP', req, auto: a('postal-code'), ...cepTipo, maxl: 9, valor: vazio ? '' : val('cep', lug[2]), dica: suf === 'res' ? 'Somente números, 8 dígitos.' : '', key: suf === 'res' ? 'cep' : null, cls: 'c-curto' })}
    ${campo({ id: `rua-${suf}`, rot: 'Rua', req, auto: a('address-line1'), valor: vazio ? '' : esc(lug[3]) })}
    ${campo({ id: `num-${suf}`, rot: 'Número', req, ...numTipo, valor: vazio ? '' : num, cls: 'c-curto' })}
  </div>
  <div class="linha">
    ${campo({ id: `comp-${suf}`, rot: 'Complemento', auto: a('address-line2'), valor: vazio ? '' : esc(comp) })}
    ${campo({ id: `bairro-${suf}`, rot: 'Bairro', auto: a('address-level3'), valor: vazio ? '' : esc(lug[4]) })}
  </div>
  <div class="linha">
    ${campo({ id: `cidade-${suf}`, rot: 'Cidade', req, auto: cityAuto, valor: vazio ? '' : esc(lug[0]) })}
    ${campo({ id: `uf-${suf}`, rot: 'UF', req, auto: a('address-level1'), tag: 'select', opts: opUF(uf), cls: 'c-curto' })}
  </div>`;
    return grupo(V('FC03'), 'grupo bloco-end', titulo, rows);
  };

  // Resumo de erros
  const itens = v.erros.map(k => `      <li><a href="#${erroMsg[k][0] === 'ano' ? 'ano' : erroMsg[k][0]}">${erroMsg[k][1]}</a></li>`).join('\n');
  const tituloErros = `Há ${v.erros.length} problemas nesta etapa`;
  const resumo = `<section id="resumo-erros" class="resumo-erros" tabindex="-1" aria-labelledby="titulo-erros"${V('FC17') ? ' role="alert"' : ''}>
  <svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24"><path d="M12 2 1 21h22z" fill="currentColor"/></svg>
  <div>
    <h2 id="titulo-erros" class="resumo-titulo"${V('FC17') ? '' : ' role="alert"'}>${tituloErros}</h2>
${V('FC16') ? '    <p>Corrija os campos destacados em vermelho antes de continuar.</p>' : `    <ul class="resumo-lista">
${itens}
    </ul>`}
  </div>
</section>`;

  // Indicador de etapas
  const stepsLi = T.etapas.map((e, i) => {
    const est = i < v.atual ? 'concluida' : i === v.atual ? 'atual' : 'futura';
    const ocul = V('FC29') ? '' : (est === 'concluida' ? ' <span class="sr">(etapa concluída)</span>' : est === 'futura' ? ' <span class="sr">(etapa não iniciada)</span>' : '');
    const cur = !V('FC29') && est === 'atual' ? ' aria-current="step"' : '';
    return `      <li class="passo ${est}"${cur}><span class="passo-num">${i + 1}</span> <span class="passo-nome">${esc(e)}</span>${ocul}</li>`;
  }).join('\n');

  // Tarefas
  const tarefasNomes = ['Identificação', 'Contato', 'Endereços', 'Documentos', 'Termos'];
  const tarefasSt = ['Concluída', v.status[0], v.status[1], 'Não iniciada', 'Não iniciada'];
  const pontoCls = { 'Concluída': 'ok', 'Com pendências': 'erro', 'Em andamento': 'prog', 'Não iniciada': 'nada' };
  const tarefas = tarefasNomes.map((n, i) => `      <li class="tarefa"><span class="ponto ponto-${pontoCls[tarefasSt[i]]}"></span> <span class="tarefa-nome">${n}</span>${V('FC30') ? '' : ` <span class="tarefa-status">${tarefasSt[i]}</span>`}</li>`).join('\n');

  // Tabela complexa
  const hd = V('AM11') ? () => '' : (...ids) => ` headers="${ids.join(' ')}"`;
  const linhasTab = T.tab.rows.map((r, i) => `        <tr>
          <th id="l${i + 1}" scope="row">${esc(r[0])}</th>
          <td${hd(`l${i + 1}`, 'h-custo', 'h-mes')}>${r[1]}</td>
          <td${hd(`l${i + 1}`, 'h-custo', 'h-ano')}>${r[2]}</td>
          <td${hd(`l${i + 1}`, 'h-sit')}>${r[3]}</td>
        </tr>`).join('\n');

  // Abas
  const abaSel = (b) => V('AM30') ? '' : ` aria-selected="${b}"`;
  const painelLab = (id) => V('AM30') ? '' : ` aria-labelledby="${id}"`;

  // SVGs informativos
  const svgInfo = (rotulo, corpo, w) => V('AM24')
    ? `<svg viewBox="0 0 24 24" width="${w}" height="${w}">${corpo}</svg>`
    : `<svg role="img" aria-label="${rotulo}" viewBox="0 0 24 24" width="${w}" height="${w}"><title>${rotulo}</title>${corpo}</svg>`;

  const termosP = Array.from({ length: v.termosN }, (_, i) => `    <p><strong>${i + 1}.</strong> ${[
    `A ${esc(T.org)} trata os dados informados neste formulário exclusivamente para a finalidade do ${esc(T.form.toLowerCase())}.`,
    'Você pode solicitar a correção, a portabilidade ou a exclusão dos seus dados a qualquer momento pelo canal de privacidade.',
    'Os documentos enviados são armazenados com criptografia e acessados apenas por pessoas autorizadas.',
    'Informações incompletas podem atrasar a análise do seu pedido em até cinco dias úteis.',
    'Ao salvar um rascunho, os dados permanecem no seu cadastro por 30 dias antes de serem removidos automaticamente.',
    'Comunicações de marketing só serão enviadas se você marcar as opções correspondentes na etapa de contato.',
    'Alterações nestes termos serão notificadas por e-mail com antecedência mínima de quinze dias.',
    'Em caso de divergência entre os dados informados e os documentos, prevalecerão os documentos apresentados.',
    'O prazo de retenção segue a legislação aplicável e as políticas internas de auditoria da empresa.',
  ][i % 9]}</p>`).join('\n');

  const tituloH1 = V('FC28') ? etapa : `Etapa ${v.atual + 1} de ${nEtapas}: ${etapa}`;
  const tituloDoc = `${V('FC18') ? '' : 'Erro: '}${tituloH1} - ${T.org}`;
  const comMain = !V('AM03');
  const tag = (n, extra = '') => comMain ? `<${n}${extra}>` : `<div${extra}>`;
  const fim = n => comMain ? `</${n}>` : '</div>';
  const mascara = V('FC26') ? ` oninput="this.value=this.value.replace(/\\D/g,'').replace(/^(\\d{2})(\\d{5})(\\d{0,4}).*/,'($1) $2-$3')"` : '';
  const phTel = V('FC26') ? ' placeholder="(00) 00000-0000"' : '';
  const autoNome = V('FC25') ? 'off' : 'name';
  const autoEmail = V('FC25') ? 'off' : 'email';
  const nomePat = V('FC22') ? ' pattern="[A-Za-z]+ [A-Za-z ]+" title="Informe nome e sobrenome usando letras de A a Z"' : '';

  const dataGrupo = grupo(V('FC04'), 'grupo grupo-data', 'Data de nascimento', `<div class="linha linha-data">
    ${campo({ id: 'dia', rot: 'Dia', req: true, auto: V('FC06') ? '' : 'bday-day', tipo: 'text', im: V('FC05') ? '' : 'numeric', maxl: 2, valor: v.d, cls: 'c-mini' })}
    ${campo({ id: 'mes', rot: 'Mês', req: true, auto: V('FC06') ? '' : 'bday-month', tipo: 'text', im: V('FC05') ? '' : 'numeric', maxl: 2, valor: v.m, cls: 'c-mini' })}
    ${campo({ id: 'ano', rot: 'Ano', req: true, auto: V('FC06') ? '' : 'bday-year', tipo: 'text', im: V('FC05') ? '' : 'numeric', maxl: 4, valor: val('ano', v.a), key: 'ano', cls: 'c-mini' })}
  </div>
  <p class="dica" id="d-nasc">Exemplo: 14 05 1988</p>`, V('FC11') ? '' : 'aria-describedby="d-nasc"');

  let html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tituloDoc)}</title>
<style>
:root{
  --c-fundo:#f4f6f9;
  --c-superficie:#ffffff;
  --c-texto:#1c2430;
  --c-suave:#4a5568;
  --c-borda:#c3cad4;
  --c-primaria:#0b5cad;
  --c-primaria-esc:#084680;
  --c-erro:#b3261e;
  --c-erro-fundo:#fdeceb;
  --c-ok:#1b7a3e;
  --c-aviso:#8a5a00;
  --esp-1:4px;
  --esp-2:8px;
  --esp-3:16px;
  --esp-4:24px;
  --raio:6px;
  --fonte:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
}
*{box-sizing:border-box}
html{scroll-padding-top:96px;scroll-padding-bottom:104px}
body{margin:0;font-family:var(--fonte);font-size:16px;line-height:1.5;color:var(--c-texto);background:var(--c-fundo)}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.pular{position:absolute;left:8px;top:-80px;background:var(--c-primaria);color:#ffffff;padding:8px 12px;border-radius:var(--raio)}
.pular:focus{top:8px;z-index:50}
.topo{position:sticky;top:0;z-index:20;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 var(--esp-4);background:var(--c-superficie);border-bottom:1px solid var(--c-borda)}
.marca{display:flex;align-items:center;gap:var(--esp-2);font-weight:700}
.topo-links{display:flex;gap:var(--esp-3);font-size:14px}
.topo-links a{color:var(--c-primaria)}
.pagina{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:var(--esp-4);max-width:1200px;margin:0 auto;padding:var(--esp-4)}
.cabecalho-form{margin-bottom:var(--esp-3)}
h1{font-size:26px;line-height:1.25;margin:0 0 var(--esp-2)}
.sub{margin:0;color:var(--c-suave)}
.etapas ol{display:flex;gap:var(--esp-2);list-style:none;margin:var(--esp-3) 0;padding:0}
.passo{position:relative;flex:1;padding:var(--esp-2) var(--esp-3);border-radius:var(--raio);background:#e6eaf0;font-size:14px}
.passo-num{display:inline-block;min-width:22px;height:22px;border-radius:50%;background:var(--c-borda);text-align:center;font-weight:700}
.passo.concluida{background:#e3f3e8}
.passo.atual{background:var(--c-primaria);color:#ffffff;font-weight:700}
.passo.atual .passo-num{background:#ffffff;color:var(--c-primaria)}
.legenda-obrig{margin:0 0 var(--esp-3);font-size:14px;color:var(--c-suave)}
.resumo-erros{display:flex;gap:var(--esp-3);padding:var(--esp-3);margin-bottom:var(--esp-4);border:2px solid var(--c-erro);border-radius:var(--raio);background:var(--c-erro-fundo);color:var(--c-erro)}
.resumo-titulo{font-size:18px;margin:0 0 var(--esp-2)}
.resumo-lista{margin:0;padding-left:var(--esp-4)}
.resumo-lista a{color:var(--c-erro);text-decoration:underline}
.secao{background:var(--c-superficie);border:1px solid var(--c-borda);border-radius:var(--raio);padding:var(--esp-4);margin-bottom:var(--esp-4)}
.secao h2{font-size:20px;margin:0 0 var(--esp-3)}
fieldset{border:0;margin:0;padding:0;min-width:0}
.grupo{margin:0 0 var(--esp-3)}
.rotulo-grupo{display:block;padding:0;margin:0 0 var(--esp-2);font-weight:600}
.bloco-end{padding:var(--esp-3);border:1px dashed var(--c-borda);border-radius:var(--raio);margin-bottom:var(--esp-3)}
.linha{display:flex;gap:var(--esp-3);margin-bottom:var(--esp-3)}
.linha .campo{flex:1;min-width:0}
.linha .c-curto{flex:0 0 140px}
.linha .c-mini{flex:0 0 90px}
.campo{display:flex;flex-direction:column;gap:var(--esp-1)}
label{font-weight:600;font-size:14px}
.obrig{color:var(--c-erro)}
input[type=text],input[type=tel],input[type=email],input[type=number],input[type=file],select{height:42px;padding:0 12px;border:1px solid var(--c-borda);border-radius:var(--raio);font:inherit;background:#ffffff;color:inherit;width:100%}
input:focus,select:focus,button:focus,a:focus,.termos:focus{outline:3px solid #f2a900;outline-offset:2px}
.tem-erro input{border-color:var(--c-erro);background:var(--c-erro-fundo)}
.dica{margin:0;font-size:13px;color:var(--c-suave)}
.erro{margin:0;font-size:13px;color:var(--c-erro);font-weight:600}
.ico{vertical-align:-2px;flex:none}
.opcoes{display:flex;gap:var(--esp-4);flex-wrap:wrap}
.opcao{display:flex;align-items:center;gap:var(--esp-2);font-weight:400;font-size:16px}
.check{display:flex;align-items:center;gap:var(--esp-2);font-weight:400;font-size:16px;margin:var(--esp-2) 0}
.abas [role=tablist]{display:flex;gap:var(--esp-1);border-bottom:2px solid var(--c-borda)}
.abas [role=tab]{padding:10px 16px;border:0;background:transparent;font:inherit;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
.abas [role=tab][aria-selected=true],.abas .aba-ativa{border-bottom-color:var(--c-primaria);font-weight:700;color:var(--c-primaria)}
.painel{padding:var(--esp-3) 0}
.tab-resumo{width:100%;border-collapse:collapse;font-size:14px}
.tab-resumo caption{text-align:left;font-weight:700;padding-bottom:var(--esp-2)}
.tab-resumo th,.tab-resumo td{border:1px solid var(--c-borda);padding:8px 12px;text-align:left}
.tab-resumo thead th{background:#e6eaf0}
.termos{max-height:150px;overflow:auto;border:1px solid var(--c-borda);border-radius:var(--raio);padding:var(--esp-3);font-size:14px;background:#fafbfc}
.aviso-seg{display:flex;gap:var(--esp-2);align-items:center;font-size:14px;color:var(--c-suave);margin-bottom:var(--esp-3)}
.rodape-acoes{position:sticky;bottom:0;z-index:15;min-height:72px;display:flex;align-items:center;padding:12px var(--esp-3);background:var(--c-superficie);border:1px solid var(--c-borda);border-radius:var(--raio)}
.acoes{display:flex;gap:var(--esp-3);width:100%;align-items:center}
.acoes .espaco{flex:1}
.btn{height:44px;padding:0 20px;border-radius:var(--raio);border:1px solid var(--c-primaria);font:inherit;font-weight:600;cursor:pointer}
.btn.pri{background:var(--c-primaria);color:#ffffff}
.btn.sec{background:#ffffff;color:var(--c-primaria)}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.lateral .cartao{background:var(--c-superficie);border:1px solid var(--c-borda);border-radius:var(--raio);padding:var(--esp-3);margin-bottom:var(--esp-3)}
.lateral h2{font-size:16px;margin:0 0 var(--esp-2)}
.tarefas{list-style:none;margin:0;padding:0}
.tarefa{display:flex;align-items:center;gap:var(--esp-2);padding:8px 0;border-bottom:1px solid #e6eaf0;font-size:14px}
.tarefa-status{margin-left:auto;font-weight:600}
.ponto{display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--c-borda)}
.ponto-ok{background:var(--c-ok)}
.ponto-erro{background:var(--c-erro)}
.ponto-prog{background:var(--c-aviso)}
.status-rasc{margin:0;font-size:14px;color:var(--c-ok);font-weight:600}
.vazio{margin:0;font-size:14px;color:var(--c-suave)}
.rodape-pagina{max-width:1200px;margin:0 auto;padding:var(--esp-3) var(--esp-4) var(--esp-4);font-size:13px;color:var(--c-suave)}
${V('FC13') ? '.linha-contato{flex-direction:row-reverse}' : ''}
${V('AM44') ? 'html{scroll-padding-top:0;scroll-padding-bottom:0}' : ''}
</style>
</head>
<body>
${V('AM03') ? '' : '<a class="pular" href="#conteudo">Pular para o formulário</a>'}
${tag('header', ' class="topo"')}
  <div class="marca">
    ${svgInfo(`Logotipo ${esc(T.org)}`, '<rect x="2" y="2" width="20" height="20" rx="5" fill="#0b5cad"/><path d="M6 12h12M12 6v12" stroke="#ffffff" stroke-width="2"/>', 28)}
    <span>${esc(T.org)}</span>
  </div>
  ${tag('nav', ' class="topo-links" aria-label="Atalhos da conta"')}
    <a href="#ajuda">Central de ajuda</a>
    <a href="#sair">Sair</a>
  ${fim('nav')}
${fim('header')}
<div class="pagina">
${tag('main', ' id="conteudo" tabindex="-1"')}
  <div class="cabecalho-form">
    <h1>${esc(tituloH1)}</h1>
    <p class="sub">${esc(T.form)} · ${esc(T.org)}</p>
  </div>
  ${tag('nav', ' id="etapas" class="etapas" aria-label="Etapas do cadastro"')}
    <ol>
${stepsLi}
    </ol>
  ${fim('nav')}
  ${V('FC10') ? '' : '<p class="legenda-obrig"><span class="obrig" aria-hidden="true">*</span> indica campo obrigatório.</p>'}
  ${resumo}
  <form action="#" method="post">
    <section class="secao" aria-labelledby="s-ident">
      <h2 id="s-ident">Identificação</h2>
      ${campo({ id: 'nome', rot: 'Nome completo', req: true, auto: autoNome, valor: esc(v.nome), extra: nomePat.trim() })}
      <div class="linha">
        ${campo({ id: 'cpf', rot: 'CPF', req: true, tipo: 'text', im: 'numeric', maxl: 14, valor: val('cpf', v.cpf), dica: 'Somente números, 11 dígitos.', key: 'cpf' })}
        ${campo({ id: 'mae', rot: 'Nome da mãe', valor: esc(v.mae) })}
      </div>
      ${dataGrupo}
      ${radios('morad', 'Situação de moradia', ['Imóvel próprio', 'Imóvel alugado', 'Imóvel cedido'], v.morad)}
    </section>
    <section class="secao" aria-labelledby="s-contato">
      <h2 id="s-contato">Contato</h2>
      <div class="linha linha-contato">
        ${campo({ id: 'email', rot: 'E-mail', req: true, tipo: 'email', auto: autoEmail, valor: val('email', v.email), key: 'email' })}
        ${campo({ id: 'tel', rot: 'Telefone', req: true, tipo: 'tel', auto: 'tel', valor: val('tel', v.tel), dica: 'Com DDD, somente números.', key: 'tel', extra: (phTel + mascara).trim() })}
      </div>
      ${radios('pref', 'Como prefere ser contatado?', ['E-mail', 'Telefone', 'Mensagem de texto'], v.pref)}
      ${grupo(V('FC02'), 'grupo grupo-opcoes', 'Quero receber comunicações sobre', `<div class="opcoes">
    <label class="opcao"><input type="checkbox" name="comunic" value="novidades" checked> Novidades do serviço</label>
    <label class="opcao"><input type="checkbox" name="comunic" value="ofertas"> Ofertas e promoções</label>
    <label class="opcao"><input type="checkbox" name="comunic" value="pesquisas"> Pesquisas de satisfação</label>
  </div>`)}
    </section>
    <section class="secao" aria-labelledby="s-end">
      <h2 id="s-end">Endereços</h2>
      ${bloco('res', 'Endereço residencial', v.lug, v.num, v.comp, v.lug[1], true, false, false)}
      <label class="check"><input type="checkbox" name="mesmo" value="1"> Usar o mesmo endereço para correspondência</label>
      ${bloco('cor', 'Endereço para correspondência', v.lug2, v.num2, '', v.uf2, false, true, true)}
    </section>
    <section class="secao" aria-labelledby="s-docs">
      <h2 id="s-docs">Documentos</h2>
      <p class="aviso-seg">${svgInfo('Cadeado: conexão segura', '<rect x="5" y="10" width="14" height="10" rx="2" fill="#4a5568"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#4a5568" stroke-width="2"/>', 20)} Seus arquivos são enviados por conexão criptografada.</p>
      <div class="abas">
        <div role="tablist" aria-label="Forma de envio do documento">
          <button type="button" role="tab" id="aba-1" class="aba-ativa"${abaSel('true')} aria-controls="painel-1">Enviar arquivo</button>
          <button type="button" role="tab" id="aba-2"${abaSel('false')} aria-controls="painel-2" tabindex="-1">Tirar foto</button>
          <button type="button" role="tab" id="aba-3"${abaSel('false')} aria-controls="painel-3" tabindex="-1">Já enviei antes</button>
        </div>
        <div role="tabpanel" id="painel-1" class="painel"${painelLab('aba-1')}>
          <div class="campo">
            <label for="arquivo">Documento de identificação (PDF ou imagem)</label>
            <input type="file" id="arquivo" name="arquivo" accept=".pdf,image/*"${V('FC11') ? '' : ' aria-describedby="d-arquivo"'}>
            <p class="dica" id="d-arquivo">Tamanho máximo de 10 MB.</p>
          </div>
        </div>
        <div role="tabpanel" id="painel-2" class="painel"${painelLab('aba-2')} hidden>
          <p class="vazio">Use a câmera do celular para fotografar o documento.</p>
        </div>
        <div role="tabpanel" id="painel-3" class="painel"${painelLab('aba-3')} hidden>
          <p class="vazio">Nenhum documento anterior encontrado para este cadastro.</p>
        </div>
      </div>
      <table class="tab-resumo">
        <caption>${esc(T.tab.tit)}</caption>
        <thead>
          <tr>
            <th id="h-desc" rowspan="2" scope="col">${esc(T.tab.c1)}</th>
            <th id="h-custo" colspan="2" scope="colgroup">Valor (R$)</th>
            <th id="h-sit" rowspan="2" scope="col">Situação</th>
          </tr>
          <tr>
            <th id="h-mes" scope="col">Mensal</th>
            <th id="h-ano" scope="col">Anual</th>
          </tr>
        </thead>
        <tbody>
${linhasTab}
        </tbody>
      </table>
    </section>
    <section class="secao" aria-labelledby="s-termos">
      <h2 id="s-termos">Termos e privacidade</h2>
      <div class="termos"${V('AM38') ? '' : ' tabindex="0"'} role="region" aria-label="Termos de uso e política de privacidade">
${termosP}
      </div>
      <label class="check"><input type="checkbox" name="aceite" id="aceite" ${V('FC09') ? '' : ' required'}> Li e aceito os termos de uso <span class="obrig" aria-hidden="true">*</span></label>
    </section>
    <div class="rodape-acoes">
      <div class="acoes">
        <button type="button" class="btn sec">${V('FC15') ? 'Voltar' : 'Voltar para ' + esc(ant.toLowerCase())}</button>
        <button type="button" class="btn sec">Salvar rascunho</button>
        <span class="espaco"></span>
        <button type="submit" class="btn pri"${V('FC14') ? ' disabled' : ''}>${V('FC15') ? 'Enviar' : 'Salvar e continuar para ' + esc(prox.toLowerCase())}</button>
      </div>
    </div>
  </form>
${fim('main')}
<aside class="lateral" aria-label="Resumo do progresso">
  <div class="cartao">
    <h2>Lista de tarefas</h2>
    <ul id="tarefas" class="tarefas">
${tarefas}
    </ul>
  </div>
  <div class="cartao">
    <h2>Rascunho</h2>
    <p id="rascunho" class="status-rasc"${V('FC31') ? '' : ' role="status"'}>Rascunho salvo às ${v.hora}</p>
  </div>
  <div class="cartao">
    <h2>Precisa de ajuda?</h2>
    <p class="vazio">Nenhuma conversa aberta. Nosso atendimento responde em até 2 horas úteis.</p>
  </div>
</aside>
</div>
<div class="rodape-pagina">${esc(T.org)} · Todos os direitos reservados · Protocolo ${String(v.seed * 104729 % 1000000).padStart(6, '0')}</div>
</body>
</html>
`;
  // Remove atributos vazios deixados por condicionais
  html = html.replace(/ (autocomplete|inputmode)=""/g, '').replace(/<div class="([^"]*)" >/g, '<div class="$1">').replace(/<fieldset class="([^"]*)" >/g, '<fieldset class="$1">').replace(/\n\s*\n/g, '\n');
  return html;
}

export async function checar(pagina) {
  const r = await pagina.evaluate(() => {
    const out = {};
    const set = (id, ok, nota) => { out[id] = { ok: !!ok, nota }; };
    const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const rect = el => el.getBoundingClientRect();
    const vis = el => { const r = rect(el), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const rotulo = c => [...(c.labels || [])].map(txt).join(' ');
    const limpa = s => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const legenda = c => { const f = c.closest('fieldset'); const l = f && [...f.children].find(x => x.tagName === 'LEGEND'); return l ? txt(l) : ''; };
    const ctrls = [...document.querySelectorAll('input,select,textarea')].filter(c => c.type !== 'hidden' && vis(c));
    const textuais = ctrls.filter(c => !['radio', 'checkbox', 'file', 'button', 'submit'].includes(c.type));
    const porNome = lista => { const m = {}; lista.forEach(c => (m[c.name] = m[c.name] || []).push(c)); return Object.values(m).filter(g => g.length >= 2); };
    const grupoOk = g => g.every(c => c.closest('fieldset') && legenda(c).length > 1);

    // FC01 / FC02
    const rg = porNome(ctrls.filter(c => c.type === 'radio'));
    set('FC01', rg.length > 0 && rg.every(grupoOk), `${rg.filter(grupoOk).length}/${rg.length} grupos de radios em fieldset`);
    const cg = porNome(ctrls.filter(c => c.type === 'checkbox'));
    set('FC02', cg.length > 0 && cg.every(grupoOk), `${cg.filter(grupoOk).length}/${cg.length} grupos de checkbox em fieldset`);
    // FC03
    const cont = {};
    textuais.forEach(c => { const k = limpa(rotulo(c)); if (k) (cont[k] = cont[k] || []).push(c); });
    const reps = Object.values(cont).filter(g => g.length >= 2);
    const f3 = reps.every(g => { const ls = g.map(c => c.closest('fieldset') && legenda(c)); return ls.every(Boolean) && new Set(ls).size === ls.length; });
    set('FC03', reps.length > 0 && f3, `${reps.length} rótulos repetidos`);
    // FC04 / 05 / 06
    const datas = ['dia', 'mês', 'ano'].map(n => textuais.find(c => limpa(rotulo(c)) === n));
    const dOk = datas.every(Boolean);
    const fs0 = dOk && datas[0].closest('fieldset');
    set('FC04', dOk && fs0 && datas.every(c => c.closest('fieldset') === fs0) && legenda(datas[0]).length > 1, dOk ? 'campos de data' : 'sem 3 campos de data');
    set('FC05', dOk && datas.every(c => c.type === 'text' && c.getAttribute('inputmode') === 'numeric'), 'type=text inputmode=numeric');
    const bd = ['bday-day', 'bday-month', 'bday-year'];
    set('FC06', dOk && datas.every((c, i) => c.getAttribute('autocomplete') === bd[i]), 'autocomplete bday-*');
    // FC07
    const nums = ctrls.filter(c => c.type === 'number');
    set('FC07', nums.length === 0, `${nums.length} input type=number`);
    // FC09
    const req = ctrls.filter(c => c.required && c.type !== 'radio');
    const cue = c => rotulo(c).includes('*');
    const sobra = ctrls.filter(c => c.type !== 'radio' && cue(c) && !c.required);
    const falta = req.filter(c => !cue(c));
    set('FC09', req.length > 0 && falta.length === 0 && sobra.length === 0, `${falta.length} required sem pista, ${sobra.length} pistas sem required`);
    // FC10
    const primeiro = ctrls[0];
    const legs = [...document.querySelectorAll('p,div,small,span,li')].filter(e => !e.children.length || [...e.children].every(x => x.tagName === 'SPAN')).filter(e => /\*/.test(txt(e)) && /obrigat/i.test(txt(e)) && txt(e).length < 120);
    set('FC10', legs.length > 0 && legs.some(e => primeiro && (e.compareDocumentPosition(primeiro) & Node.DOCUMENT_POSITION_FOLLOWING)), `${legs.length} legendas de asterisco`);
    // FC11
    const dicas = [...document.querySelectorAll('.dica')];
    const ligada = d => d.closest('label') || (d.id && document.querySelector(`[aria-describedby~="${d.id}"]`));
    const sol = dicas.filter(d => !ligada(d));
    set('FC11', dicas.length > 0 && sol.length === 0, `${sol.length}/${dicas.length} dicas soltas`);
    // FC13 (ordem DOM x visual, com sticky/fixed neutralizados)
    {
      const fixos = [...document.querySelectorAll('*')].filter(e => ['sticky', 'fixed'].includes(getComputedStyle(e).position));
      const antes = fixos.map(e => e.style.position);
      fixos.forEach(e => (e.style.position = 'static'));
      const foc = [...document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href],[tabindex]:not([tabindex="-1"])')].filter(vis);
      const rs = foc.map(rect);
      let bad = 0;
      for (let i = 0; i + 1 < foc.length; i++) {
        const A = rs[i], B = rs[i + 1];
        const acima = B.bottom <= A.top - 1;
        const sobreV = B.top < A.bottom && A.top < B.bottom;
        const esq = sobreV && B.right <= A.left - 1;
        if (acima || esq) bad++;
      }
      fixos.forEach((e, i) => (e.style.position = antes[i]));
      set('FC13', bad === 0 && foc.length > 3, `${bad} inversões em ${foc.length} focáveis`);
    }
    // FC14
    const des = [...document.querySelectorAll('button[disabled],input[type=submit][disabled],input[type=button][disabled],[role=button][aria-disabled=true]')];
    set('FC14', des.length === 0, `${des.length} botões desabilitados`);
    // FC15
    const GEN = new Set(['enviar', 'ok', 'submit', 'próximo', 'proximo', 'avançar', 'continuar', 'confirmar', 'voltar', 'salvar', 'clique aqui', 'sim', 'não', 'ir', 'prosseguir', 'next', 'send']);
    const bts = [...document.querySelectorAll('button:not([role=tab]),input[type=submit],input[type=button]')].filter(vis);
    const gen = bts.filter(b => GEN.has(((b.tagName === 'INPUT' ? b.value : txt(b)) || '').toLowerCase().replace(/[.!…]/g, '').trim()));
    set('FC15', bts.length > 0 && gen.length === 0, `${gen.length} botões genéricos`);
    // FC16 / FC17
    const res = document.getElementById('resumo-erros');
    const inval = ctrls.filter(c => c.getAttribute('aria-invalid') === 'true');
    const links = res ? [...res.querySelectorAll('a[href^="#"]')] : [];
    const alvos = new Set(links.map(a => a.getAttribute('href').slice(1)));
    const titulo = res && [...res.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=alert]')].some(h => txt(h).length > 3);
    set('FC16', !!res && !!titulo && inval.length > 0 && inval.every(c => alvos.has(c.id)), `${links.length} links p/ ${inval.length} campos inválidos`);
    const alerts = res ? [...res.querySelectorAll('[role=alert]')] : [];
    const externo = res && (res.getAttribute('role') === 'alert' || /assertive/.test(res.getAttribute('aria-live') || ''));
    set('FC17', !!res && alerts.length > 0 && !externo, externo ? 'role=alert no container externo' : `${alerts.length} role=alert interno`);
    // FC18
    set('FC18', /^Erro:/.test(document.title), document.title.slice(0, 30));
    // FC22
    const nomes = textuais.filter(c => /^nome\b/.test(limpa(rotulo(c))) || ['name', 'given-name', 'family-name'].includes(c.getAttribute('autocomplete')));
    const pats = nomes.filter(c => c.hasAttribute('pattern'));
    set('FC22', nomes.length > 0 && pats.length === 0, `${pats.length}/${nomes.length} nomes com pattern`);
    // FC24
    const VAL = new Set('name honorific-prefix given-name additional-name family-name honorific-suffix nickname username new-password current-password one-time-code organization-title organization street-address address-line1 address-line2 address-line3 address-level4 address-level3 address-level2 address-level1 country country-name postal-code cc-name cc-given-name cc-additional-name cc-family-name cc-number cc-exp cc-exp-month cc-exp-year cc-csc cc-type transaction-currency transaction-amount language bday bday-day bday-month bday-year sex tel tel-country-code tel-national tel-area-code tel-local tel-extension email impp url photo on off'.split(' '));
    const MOD = new Set(['shipping', 'billing', 'home', 'work', 'mobile', 'fax', 'pager']);
    const invA = [...document.querySelectorAll('[autocomplete]')].filter(e => {
      const t = e.getAttribute('autocomplete').toLowerCase().split(/\s+/).filter(x => x && !/^section-/.test(x) && !MOD.has(x));
      return !(t.length === 1 && VAL.has(t[0]));
    });
    set('FC24', invA.length === 0, `${invA.length} autocomplete inválidos`);
    // FC25
    const pessoais = textuais.filter(c => /nome|e-?mail|telefone|celular|^rua|endere|cidade|cep|bairro/.test(limpa(rotulo(c))));
    const offs = pessoais.filter(c => (c.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).includes('off'));
    set('FC25', pessoais.length > 0 && offs.length === 0, `${offs.length} campos pessoais com off`);
    // FC28
    const h1s = [...document.querySelectorAll('h1')];
    const re = /(etapa|passo)\s+\d+\s+de\s+\d+/i;
    set('FC28', h1s.length === 1 && re.test(txt(h1s[0])) && re.test(document.title), `h1="${h1s[0] ? txt(h1s[0]).slice(0, 25) : ''}"`);
    // FC29
    const et = document.getElementById('etapas');
    const lis = et ? [...et.querySelectorAll('li')] : [];
    const atuais = et ? et.querySelectorAll('[aria-current]') : [];
    const oculto = li => [...li.querySelectorAll('*')].some(e => { const r = rect(e); return txt(e).length > 2 && r.width <= 2 && r.height <= 2; });
    const outros = lis.filter(li => !li.querySelector('[aria-current]') && !li.hasAttribute('aria-current'));
    set('FC29', lis.length > 1 && atuais.length === 1 && outros.every(oculto), `${atuais.length} aria-current, ${outros.filter(oculto).length}/${outros.length} com texto oculto`);
    // FC30
    const tar = [...document.querySelectorAll('#tarefas li')];
    const ST = /conclu[ií]d|pendente|pendências|em andamento|não iniciad|com erro|bloquead/i;
    const semSt = tar.filter(li => !ST.test(li.innerText));
    set('FC30', tar.length > 0 && semSt.length === 0, `${semSt.length}/${tar.length} tarefas sem status em texto`);
    // FC31
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const msgs = [];
    for (let n; (n = walker.nextNode());) if (/rascunho salvo|salvo automaticamente/i.test(n.nodeValue)) msgs.push(n.parentElement);
    set('FC31', msgs.length > 0 && msgs.every(e => e.closest('[role=status],[aria-live=polite],output')), `${msgs.length} mensagens de status`);
    // AM03
    const fo = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')];
    const pul = fo.slice(0, 2).find(a => a.tagName === 'A' && a.getAttribute('href').startsWith('#') && a.getAttribute('href').length > 1 && document.getElementById(a.getAttribute('href').slice(1)));
    const lm = document.querySelector('main,[role=main]') && document.querySelector('header,[role=banner],nav,[role=navigation]');
    set('AM03', !!pul || !!lm, pul ? 'link de salto' : lm ? 'landmarks' : 'sem salto nem landmarks');
    // AM11
    const tbs = [...document.querySelectorAll('table')].filter(t => t.querySelector('th[colspan],th[rowspan]'));
    let semH = 0;
    tbs.forEach(t => t.querySelectorAll('td').forEach(td => {
      const h = (td.getAttribute('headers') || '').split(/\s+/).filter(Boolean);
      if (!h.length || !h.every(i => { const e = t.querySelector('#' + CSS.escape(i)); return e && e.tagName === 'TH'; })) semH++;
    }));
    set('AM11', tbs.length > 0 && semH === 0, `${semH} células sem headers`);
    // AM24
    const svgs = [...document.querySelectorAll('svg')].filter(s => !s.closest('[aria-hidden=true]'));
    const nomeSvg = s => (s.getAttribute('aria-label') || '').trim() || (s.getAttribute('aria-labelledby') && txt(document.getElementById(s.getAttribute('aria-labelledby')) || document.body).slice(0, 50)) || ((s.querySelector('title') || { textContent: '' }).textContent.trim());
    const ruins = svgs.filter(s => s.getAttribute('role') !== 'img' || !nomeSvg(s));
    set('AM24', svgs.length > 0 && ruins.length === 0, `${ruins.length}/${svgs.length} svgs sem nome`);
    // AM30
    const tl = document.querySelector('[role=tablist]');
    const tabs = [...document.querySelectorAll('[role=tab]')];
    const pans = [...document.querySelectorAll('[role=tabpanel]')];
    const selOk = tabs.length > 1 && tabs.every(t => ['true', 'false'].includes(t.getAttribute('aria-selected'))) && tabs.filter(t => t.getAttribute('aria-selected') === 'true').length === 1;
    const panOk = pans.length > 0 && pans.every(p => { const l = p.getAttribute('aria-labelledby'); const e = l && document.getElementById(l); return e && e.getAttribute('role') === 'tab'; });
    set('AM30', !!tl && selOk && panOk, `selected ${selOk}, painéis ${panOk}`);
    // AM38
    const rol = [...document.querySelectorAll('*')].filter(e => e !== document.body && e !== document.documentElement && /(auto|scroll)/.test(getComputedStyle(e).overflowY + getComputedStyle(e).overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1));
    const semFoco = rol.filter(e => !(e.tabIndex >= 0) && !e.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'));
    set('AM38', rol.length > 0 && semFoco.length === 0, `${semFoco.length}/${rol.length} rolagens sem foco`);
    // AM44
    const cs0 = getComputedStyle(document.documentElement);
    const pt = parseFloat(cs0.scrollPaddingTop) || 0, pb = parseFloat(cs0.scrollPaddingBottom) || 0;
    const fx = [...document.querySelectorAll('*')].filter(e => ['sticky', 'fixed'].includes(getComputedStyle(e).position));
    const ruim = fx.filter(e => { const c = getComputedStyle(e), h = rect(e).height; if (c.top !== 'auto') return pt < h - 0.5; if (c.bottom !== 'auto') return pb < h - 0.5; return false; });
    set('AM44', ruim.length === 0, `${ruim.length}/${fx.length} fixos sem scroll-padding (${pt}/${pb})`);
    return out;
  });
  // FC26: telefone sem máscara (digita e compara)
  const tel = pagina.locator('input[type=tel]').first();
  let ok = false, nota = 'sem campo de telefone';
  if (await tel.count()) {
    const auto = await tel.getAttribute('autocomplete');
    const orig = await tel.inputValue();
    await tel.fill('');
    await tel.pressSequentially('11987654321');
    const got = await tel.inputValue();
    await tel.fill(orig);
    ok = (auto || '').split(/\s+/).includes('tel') && got === '11987654321';
    nota = `autocomplete=${auto}, digitado -> ${got}`;
  }
  r.FC26 = { ok, nota };
  const res = {};
  for (const id of REGRAS) res[id] = r[id] || { ok: false, nota: 'sem checagem' };
  return res;
}

export function ruido(html, seed) {
  const R = rng(seed * 31 + 7);
  const partes = html.split(/(<style>[\s\S]*?<\/style>)/);
  return partes.map(p => {
    if (p.startsWith('<style>')) {
      return p.replace(/#([0-9a-f]{6})\b/gi, (_, h) => `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`).replace(/\n/g, R() < 0.5 ? '\n' : '\n\n');
    }
    return p.split('\n').map(l => {
      let s = l;
      if (/^\s*<(div|section|p|li|span)\b/.test(s) && !s.includes('class="sr"') && R() < 0.25) s = s.replace(/class="/, `class="u${Math.floor(R() * 900 + 100)} `);
      if (/^\s*<(div|section|fieldset|ul|ol)\b/.test(s) && R() < 0.15) s = `<!-- bloco ${Math.floor(R() * 9999)} -->\n` + s;
      if (R() < 0.1) s = '  ' + s;
      return s;
    }).join('\n');
  }).join('');
}
