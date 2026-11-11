// Gerador de estímulos do estudo 3. Determinístico (semente fixa). Gabarito por construção, conferido pelo kit.
import fs from 'node:fs';
import { verificar, diferencas } from '../kit/kit.mjs';

const lake = JSON.parse(fs.readFileSync(new URL('../lake/login.json', import.meta.url), 'utf8'));
const OUT = new URL('../dados/estimulos/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20261110);
const pick = a => a[Math.floor(R() * a.length)];
const emb = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' rx='10' fill='%231d4ed8'/%3E%3C/svg%3E";
export const BASE = {
  lang: 'pt-BR', viewport: true, title: 'Entrar', h1: 'Entrar', h1n: 1, logo: true, logoAlt: 'Melo Labs',
  bodyFont: 16, lineHeight: 1.5, textColor: '#1f2937', bg: '#f3f4f6', cardBg: '#ffffff', accent: '#1d4ed8', btnColor: '#ffffff',
  labelColor: '#1f2937', labelWeight: 500, inputBorder: '#6b7280', inputRadius: 8, btnRadius: 8, inputFont: 16, btnFont: 16, btnPadY: 16, btnH: null,
  cardW: 360, gap: 16, h1Size: 28, shadow: '0 1px 3px rgba(0,0,0,.15)', outline: true, letter: '0',
  form: true, action: '/login', method: 'post', emailType: 'email', emailLabel: 'E-mail', emailPlaceholder: 'voce@exemplo.com', labels: true,
  emailAuto: 'username', passType: 'password', passAuto: 'current-password', paste: true, required: true,
  btnText: 'Entrar', btnType: 'submit', forgot: true, forgotText: 'Esqueci minha senha', forgotHref: '/recuperar', forgotUnderline: true,
  show: true, error: true, order: 'ep', remember: false, passLabel: 'Senha', cls: 'a',
};
export function tela(p) {
  const c = n => n + '-' + p.cls;
  const email = `<div class="${c('campo')}">${p.labels ? `<label for="email">${p.emailLabel}</label>` : ''}<input id="email" name="email" type="${p.emailType}"${p.emailAuto ? ` autocomplete="${p.emailAuto}"` : ''} placeholder="${p.emailPlaceholder}"${p.required ? ' required' : ''}></div>`;
  const senha = `<div class="${c('campo')}">${p.labels ? `<label for="senha">${p.passLabel}</label>` : ''}<input id="senha" name="senha" type="${p.passType}"${p.passAuto ? ` autocomplete="${p.passAuto}"` : ''}${p.required ? ' required' : ''}${p.paste ? '' : ' onpaste="return false"'}>${p.show ? `<button type="button" class="${c('mostrar')}" aria-label="Mostrar senha">${p.showText ?? 'Mostrar'}</button>` : ''}</div>`;
  const campos = p.order === 'ep' ? email + '\n    ' + senha : senha + '\n    ' + email;
  const btnH = p.btnH ? `height:${p.btnH}px;` : '';
  const css = `
  :root { --texto:${p.textColor}; --acento:${p.accent}; }
  body { margin:0; font-family: system-ui, sans-serif; font-size:${p.bodyFont}px; line-height:${p.lineHeight}; color:var(--texto); background:${p.bg}; display:flex; justify-content:center; padding:32px 16px; }
  .${c('card')} { background:${p.cardBg}; width:${p.cardFixed ? p.cardW + 'px' : '100%'}; max-width:${p.cardW}px; padding:32px 24px; border-radius:12px; box-shadow:${p.shadow}; }
  h1 { font-size:${p.h1Size}px; margin:0 0 24px; letter-spacing:${p.letter}; }
  .${c('campo')} { margin-bottom:${p.gap}px; }
  label { display:block; margin-bottom:8px; font-weight:${p.labelWeight}; color:${p.labelColor}; }
  input { width:100%; box-sizing:border-box; padding:12px; font-size:${p.inputFont}px; border:1px solid ${p.inputBorder}; border-radius:${p.inputRadius}px; ${p.outline ? '' : 'outline:none;'} }
  ${p.outline ? 'input:focus, button:focus { outline:2px solid var(--acento); outline-offset:2px; }' : ''}
  .${c('mostrar')} { margin-top:8px; background:transparent; border:0; color:var(--acento); font-size:16px; padding:4px 0; }
  .${c('entrar')} { width:100%; padding:${p.btnPadY}px 16px; font-size:${p.btnFont}px; background:var(--acento); color:${p.btnColor}; border:0; border-radius:${p.btnRadius}px; ${btnH} cursor:pointer; ${p.outline ? '' : 'outline:none;'} }
  .${c('links')} { margin-top:16px; text-align:center; }
  a { color:var(--acento); text-decoration:${p.forgotUnderline ? 'underline' : 'none'}; }
  .${c('erro')} { color:#b91c1c; margin:0 0 16px; }`;
  const botao = p.form ? `<button type="${p.btnType}" class="${c('entrar')}">${p.btnText}</button>` : `<button type="button" class="${c('entrar')}">${p.btnText}</button>`;
  const corpo = `<main class="${c('card')}">
    ${p.logo ? `<img src="${LOGO}" width="48" height="48" alt="${p.logoAlt}">` : `<img src="${LOGO}" width="48" height="48">`}
    <h1>${p.h1}</h1>${p.h1n > 1 ? '\n    <h1>Bem-vindo</h1>' : ''}
    ${p.error ? `<p class="${c('erro')}" role="alert" hidden>${p.errorText ?? 'E-mail ou senha incorretos.'}</p>` : ''}
    ${p.form ? `<form action="${p.action}" method="${p.method}">` : '<div>'}
    ${campos}
    ${botao}
    ${p.form ? '</form>' : '</div>'}
    ${p.forgot ? `<p class="${c('links')}"><a href="${p.forgotHref}">${p.forgotText}</a></p>` : ''}
  </main>`;
  const logoFix = p.logo ? '' : '';
  return `<!doctype html>
<html${p.lang ? ` lang="${p.lang}"` : ''}>
<head>
  <meta charset="utf-8">${p.viewport ? '\n  <meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
  <title>${p.title}</title>
  <style>${css}
  </style>
</head>
<body>
  ${corpo}
</body>
</html>
`;
}

// ---------- defeitos (T2) ----------
export const DEFEITOS = {
  D01: { regras: ['L01', 'L02'], f: p => ({ ...p, labels: false }) },
  D02: { regras: ['L08'], f: p => ({ ...p, accent: '#93c5fd', btnColor: '#ffffff' }) },
  D03: { regras: ['L09'], f: p => ({ ...p, labelColor: '#9ca3af' }) },
  D04: { regras: ['L10'], f: p => ({ ...p, inputBorder: '#e5e7eb' }) },
  D05: { regras: ['L11'], f: p => ({ ...p, btnPadY: 0, btnH: 18 }) },
  D06: { regras: ['L12'], f: p => ({ ...p, inputFont: 12 }) },
  D07: { regras: ['L13'], f: p => ({ ...p, viewport: false }) },
  D08: { regras: ['L14'], f: p => ({ ...p, lang: '' }) },
  D09: { regras: ['L16'], f: p => ({ ...p, outline: false }) },
  D10: { regras: ['L17'], f: p => ({ ...p, forgot: false }) },
  D11: { regras: ['L18'], f: p => ({ ...p, paste: false }) },
  D12: { regras: ['L04'], f: p => ({ ...p, passType: 'text' }) },
  D13: { regras: ['L05'], f: p => ({ ...p, passAuto: 'off' }) },
  D14: { regras: ['L23'], f: p => ({ ...p, cardW: 480, cardFixed: true }) },
  D15: { regras: ['L15'], f: p => ({ ...p, h1n: 2 }) },
  D16: { regras: ['L26'], f: p => ({ ...p, btnText: 'Enviar' }) },
  D17: { regras: ['L22'], f: p => ({ ...p, lineHeight: 1 }) },
  D18: { regras: ['L28'], f: p => ({ ...p, inputRadius: 2, btnRadius: 24 }) },
  D19: { regras: ['L29'], f: p => ({ ...p, gap: 13 }) },
  D20: { regras: ['L30'], f: p => ({ ...p, order: 'pe' }) },
  D21: { regras: ['L25'], f: p => ({ ...p, logo: false }) },
  D22: { regras: ['L03'], f: p => ({ ...p, emailType: 'text', emailAuto: '' }) },
  D23: { regras: ['L07'], f: p => ({ ...p, form: false }) },
  D24: { regras: ['L19'], f: p => ({ ...p, show: false }) },
  D25: { regras: ['L24'], f: p => ({ ...p, forgotUnderline: false, accent: '#1f2937' }) },
};
const CONFLITO = [['D02', 'D25'], ['D12', 'D13'], ['D01', 'D22'], ['D07', 'D14']];
const falhas = html => verificar(html, lake).filter(x => !x.ok).map(x => x.id).sort();

// ---------- verificação da base ----------
const ref = tela(BASE);
const baseFalhas = falhas(ref);
if (baseFalhas.length) { console.error('A tela de referência não passa em tudo:', baseFalhas, verificar(ref, lake).filter(x => !x.ok)); process.exit(1); }
fs.writeFileSync(new URL('ref.html', OUT), ref);

// ---------- T2: 20 telas com 3 defeitos cada ----------
const t2 = [];
const dkeys = Object.keys(DEFEITOS);
let tent = 0;
while (t2.length < 20 && tent++ < 500) {
  const ds = emb(dkeys).slice(0, 3);
  if (CONFLITO.some(([a, b]) => ds.includes(a) && ds.includes(b))) continue;
  let p = { ...BASE, cls: pick(['a', 'b', 'c']), title: BASE.title }; ds.forEach(d => { p = DEFEITOS[d].f(p); });
  const html = tela(p); const fal = falhas(html);
  const esperado = [...new Set(ds.flatMap(d => DEFEITOS[d].regras))].sort();
  const okk = esperado.every(r => fal.includes(r));
  if (!okk) { console.warn('kit não detectou', ds, 'esperado', esperado, 'obtido', fal); continue; }
  t2.push({ id: 'T2-' + String(t2.length + 1).padStart(2, '0'), defeitos: ds, chave: fal, injetadas: esperado, html });
}
fs.writeFileSync(new URL('t2.json', OUT), JSON.stringify(t2, null, 1));

// ---------- T3: 60 pares ----------
const CSSOPS = {
  'cor de fundo do botão': ['botao', 'background-color', p => ({ ...p, accent: '#b91c1c' })],
  'raio de borda do botão': ['botao', 'border-radius', p => ({ ...p, btnRadius: 2 })],
  'tamanho da fonte dos campos': ['campo', 'font-size', p => ({ ...p, inputFont: 18 })],
  'altura de linha do corpo': ['corpo', 'line-height', p => ({ ...p, lineHeight: 1.4 })],
  'padding vertical do botão': ['botao', 'padding', p => ({ ...p, btnPadY: 10 })],
  'peso da fonte dos rótulos': ['rotulo', 'font-weight', p => ({ ...p, labelWeight: 700 })],
  'cor da borda dos campos': ['campo', 'border-color', p => ({ ...p, inputBorder: '#1d4ed8' })],
  'tamanho do título': ['titulo', 'font-size', p => ({ ...p, h1Size: 24 })],
  'largura máxima do cartão': ['cartao', 'max-width', p => ({ ...p, cardW: 400 })],
  'espaço entre campos': ['campo', 'margin-bottom', p => ({ ...p, gap: 24 })],
  'cor do texto': ['corpo', 'color', p => ({ ...p, textColor: '#374151' })],
  'espaçamento entre letras do título': ['titulo', 'letter-spacing', p => ({ ...p, letter: '1px' })],
  'sombra do cartão': ['cartao', 'box-shadow', p => ({ ...p, shadow: '0 4px 12px rgba(0,0,0,.25)' })],
  'raio do botão (sutil)': ['botao', 'border-radius', p => ({ ...p, btnRadius: 6 })],
  'fonte dos campos (sutil)': ['campo', 'font-size', p => ({ ...p, inputFont: 15 })],
  'altura de linha (sutil)': ['corpo', 'line-height', p => ({ ...p, lineHeight: 1.45 })],
  'padding do botão (sutil)': ['botao', 'padding', p => ({ ...p, btnPadY: 14 })],
  'espaço entre campos (sutil)': ['campo', 'margin-bottom', p => ({ ...p, gap: 18 })],
  'tamanho do título (sutil)': ['titulo', 'font-size', p => ({ ...p, h1Size: 27 })],
  'cor do acento (sutil)': ['botao', 'background-color', p => ({ ...p, accent: '#1e40af' })],
};
const CONTOPS = {
  'texto do título': ['titulo', p => ({ ...p, h1: 'Acessar sua conta' })],
  'texto do botão': ['botao', p => ({ ...p, btnText: 'Continuar' })],
  'rótulo do e-mail': ['rotulo do e-mail', p => ({ ...p, emailLabel: 'Usuário' })],
  'texto do link': ['link', p => ({ ...p, forgotText: 'Não lembro a senha' })],
  'rótulo da senha': ['rotulo da senha', p => ({ ...p, passLabel: 'Palavra-passe' })],
  'placeholder do e-mail': ['campo de e-mail', p => ({ ...p, emailPlaceholder: 'nome@empresa.com' })],
  'texto do aviso de erro': ['mensagem de erro', p => ({ ...p, errorText: 'Dados inválidos.' })],
  'texto de mostrar senha': ['botao mostrar', p => ({ ...p, showText: 'Exibir' })],
};
const FLUXOOPS = {
  'destino do formulário': ['form', 'action', p => ({ ...p, action: '/sessao' })],
  'método do formulário': ['form', 'method', p => ({ ...p, method: 'get' })],
  'tipo do campo de e-mail': ['campo de e-mail', 'type', p => ({ ...p, emailType: 'text' })],
  'destino do link de recuperação': ['link', 'href', p => ({ ...p, forgotHref: '/ajuda' })],
  'botão mostrar senha removido': ['botao mostrar', 'removido', p => ({ ...p, show: false })],
  'ordem dos campos': ['ordem', 'ordem', p => ({ ...p, order: 'pe' })],
  'link de recuperação removido': ['link', 'removido', p => ({ ...p, forgot: false })],
  'tipo da senha': ['campo de senha', 'type', p => ({ ...p, passType: 'text' })],
};
const base3 = () => ({ ...BASE, cls: pick(['a', 'b', 'c']) });
const t3 = []; let n = 0;
const add = (cat, a, b, chave, extra = {}) => t3.push({ id: 'T3-' + String(++n).padStart(2, '0'), categoria: cat, a, b, chave, ...extra });
for (const [nome, [alvo, prop, f]] of emb(Object.entries(CSSOPS)).slice(0, 20)) { const p = base3(); const A = tela(p), B = tela(f(p)); add('css', A, B, [{ alvo, propriedade: prop, descricao: nome }]); }
for (const [nome, [alvo, f]] of emb(Object.entries(CONTOPS)).slice(0, 8)) { const p = base3(); add('conteudo', tela(p), tela(f(p)), [{ alvo, propriedade: 'texto', descricao: nome }]); }
for (const [nome, [alvo, prop, f]] of emb(Object.entries(FLUXOOPS)).slice(0, 8)) { const p = base3(); add('fluxo', tela(p), tela(f(p)), [{ alvo, propriedade: prop, descricao: nome }]); }
// compostos: 2 a 3 mudanças de categorias diferentes
for (let i = 0; i < 8; i++) {
  const css = pick(Object.entries(CSSOPS)), cont = pick(Object.entries(CONTOPS)), flu = pick(Object.entries(FLUXOOPS));
  const usar = i % 2 ? [css, cont, flu] : [css, flu]; let p = base3(); const A = tela(p); const chave = [];
  for (const [nome, v] of usar) { if (v.length === 3) { p = v[2](p); chave.push({ alvo: v[0], propriedade: v[1], descricao: nome }); } else { p = v[1](p); chave.push({ alvo: v[0], propriedade: 'texto', descricao: nome }); } }
  add('composto', A, tela(p), chave);
}
// ruído: mudanças sem efeito (a resposta correta é "nenhuma diferença real")
const ruidos = [
  p => [tela(p), tela(p).replace(/class="([^"]*)-a"/g, 'class="$1-z"').replace(/\.([\w]+)-a /g, '.$1-z ')],
  p => [tela(p), tela(p).replace(/\n\s+/g, '\n').replace(/>\s+</g, '><')],
  p => [tela(p), tela(p).replace('<title>', '<!-- tela de acesso -->\n<title>')],
  p => [tela(p), tela(p).replace('#1d4ed8', 'rgb(29, 78, 216)')],
  p => [tela(p), tela(p).replace(/font-size:16px/g, 'font-size:1rem')],
  p => [tela(p), tela(p).replace('padding:12px;', 'padding-top:12px; padding-right:12px; padding-bottom:12px; padding-left:12px;')],
  p => [tela(p), tela(p).replace(/<input id="email" name="email" type="email"/, '<input type="email" name="email" id="email"')],
  p => [tela(p), tela(p).replace(/#1f2937/g, '#1F2937').replace('#6b7280', '#6B7280')],
];
for (const f of ruidos) { const [A, B] = f(base3()); add('ruido', A, B, []); }
// idênticos
for (let i = 0; i < 8; i++) { const A = tela({ ...BASE, cls: pick(['a', 'b', 'c']), emailPlaceholder: pick(['voce@exemplo.com', 'nome@empresa.com']) }); add('identico', A, A, []); }
// verificação: o kit deve achar >= 1 diferença nos pares com chave e 0 nos de ruído/idênticos
let alerta = 0;
for (const t of t3) {
  const d = diferencas(t.a, t.b);
  if (t.chave.length === 0 && d.length) { alerta++; console.warn(t.id, t.categoria, 'kit viu diferença em par sem diferença', d.slice(0, 2)); }
  if (t.chave.length && !d.length) { alerta++; console.warn(t.id, t.categoria, 'kit NÃO viu diferença em par com diferença', t.chave); }
  t.kit_n = d.length;
}
fs.writeFileSync(new URL('t3.json', OUT), JSON.stringify(t3, null, 1));

// ---------- T1: 12 pedidos de criação ----------
const CTX = [['uma clínica de fisioterapia', 'pacientes agendam consultas'], ['um banco digital', 'clientes consultam extrato'], ['uma escola de idiomas', 'alunos acessam aulas'], ['uma loja de plantas', 'clientes acompanham pedidos'], ['uma plataforma de cursos de programação', 'estudantes retomam cursos'], ['um app de corrida', 'atletas veem treinos'], ['um sistema de reservas de salas', 'funcionários reservam salas'], ['uma biblioteca municipal', 'leitores renovam empréstimos'], ['uma cooperativa agrícola', 'cooperados veem entregas'], ['um painel de energia solar', 'moradores veem consumo'], ['um estúdio de design', 'clientes aprovam entregas'], ['um clube de xadrez', 'sócios inscrevem-se em torneios']];
const t1 = CTX.map(([quem, uso], i) => ({ id: 'T1-' + String(i + 1).padStart(2, '0'), contexto: quem, uso, pedido: `Crie a tela de login (HTML e CSS em um único arquivo, sem JavaScript externo) de ${quem}, onde ${uso}. A tela deve ter campo de e-mail, campo de senha e botão de entrada, em português do Brasil.` }));
fs.writeFileSync(new URL('t1.json', OUT), JSON.stringify(t1, null, 1));

const porCat = {}; t3.forEach(t => porCat[t.categoria] = (porCat[t.categoria] || 0) + 1);
console.log(JSON.stringify({ base_ok: true, t1: t1.length, t2: t2.length, t3: t3.length, porCat, alerta }));
