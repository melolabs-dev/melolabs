// Kit grau 0 (estático): parse5 + css-tree + culori. Sem navegador, sem layout.
import { parse as parseHtml } from 'parse5';
import * as csstree from 'css-tree';
import { parse as _parseColor, wcagContrast, formatHex8, formatHex } from 'culori';
const parseColor = v => { try { return _parseColor(v); } catch { return undefined; } };

const SKIP = new Set(['script', 'style', 'head', 'meta', 'link', 'title']);
const INHERIT = ['color', 'font-size', 'line-height', 'font-family', 'font-weight', 'text-align'];
const DEF = { 'font-size': '16px', 'line-height': 'normal', color: '#000000', 'font-weight': '400' };

// ---------- DOM ----------
function conv(n, parent) {
  const el = { tag: n.nodeName, attrs: {}, children: [], parent, text: '' };
  for (const a of n.attrs || []) el.attrs[a.name] = a.value;
  const kids = n.tagName === 'template' ? n.content.childNodes : n.childNodes || [];
  for (const k of kids) {
    if (k.nodeName === '#text') el.children.push({ tag: '#text', text: k.value, parent: el });
    else if (!k.nodeName.startsWith('#')) el.children.push(conv(k, el));
  }
  return el;
}
export function carregar(html) {
  const doc = parseHtml(html);
  const root = conv(doc.childNodes.find(n => n.nodeName === 'html') || doc, null);
  const styles = [];
  const walk = e => { if (e.tag === 'style') styles.push(e.children.map(c => c.text).join('')); e.children.forEach(c => c.tag !== '#text' && walk(c)); };
  walk(root);
  const regras = [];
  for (const css of styles) {
    const ast = csstree.parse(css, { positions: false });
    csstree.walk(ast, { visit: 'Rule', enter(rule) {
      if (rule.prelude.type !== 'SelectorList') return;
      const decls = {};
      rule.block.children.forEach(d => { if (d.type === 'Declaration') decls[d.property.toLowerCase()] = csstree.generate(d.value).trim(); });
      rule.prelude.children.forEach(sel => regras.push({ sel, selTxt: csstree.generate(sel), decls, ordem: regras.length }));
    } });
  }
  const vars = {};
  for (const r of regras) if (/^(:root|html|body)$/.test(r.selTxt)) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--')) vars[k] = v;
  return { root, regras, vars };
}

// ---------- seletores ----------
function todos(root, f, out = []) { if (root.tag !== '#text') { if (f(root)) out.push(root); root.children.forEach(c => todos(c, f, out)); } return out; }
function simples(el, comps) {
  for (const c of comps) {
    if (c.type === 'TypeSelector') { if (c.name !== '*' && c.name.toLowerCase() !== el.tag) return false; }
    else if (c.type === 'ClassSelector') { if (!(el.attrs.class || '').split(/\s+/).includes(c.name)) return false; }
    else if (c.type === 'IdSelector') { if (el.attrs.id !== c.name) return false; }
    else if (c.type === 'AttributeSelector') {
      const v = el.attrs[c.name.name]; if (v === undefined) return false;
      if (c.matcher) { const w = c.value && (c.value.value ?? c.value.name); if (c.matcher === '=' && v !== w) return false; if (c.matcher === '^=' && !v.startsWith(w)) return false; if (c.matcher === '$=' && !v.endsWith(w)) return false; if (c.matcher === '*=' && !v.includes(w)) return false; }
    } else if (c.type === 'PseudoClassSelector') {
      if (['hover', 'focus', 'active', 'focus-visible', 'focus-within', 'disabled', 'visited'].includes(c.name)) return false;
      if (c.name === 'root') { if (el.tag !== 'html') return false; }
      else if (c.name === 'first-child') { if (el.parent?.children.filter(x => x.tag !== '#text')[0] !== el) return false; }
      else if (c.name === 'last-child') { const k = el.parent?.children.filter(x => x.tag !== '#text'); if (k?.[k.length - 1] !== el) return false; }
    } else if (c.type === 'PseudoElementSelector') return false;
  }
  return true;
}
function casa(el, sel) {
  const partes = []; let cur = [];
  sel.children.forEach(c => { if (c.type === 'Combinator') { partes.push({ comps: cur, comb: c.name.trim() || ' ' }); cur = []; } else cur.push(c); });
  partes.push({ comps: cur, comb: null });
  const m = (e, i) => {
    if (!e || e.tag === '#text' || !simples(e, partes[i].comps)) return false;
    if (i === 0) return true;
    const c = partes[i - 1].comb; const p = e.parent;
    if (c === '>') return m(p, i - 1);
    if (c === ' ') { for (let a = p; a; a = a.parent) if (m(a, i - 1)) return true; return false; }
    if (c === '+') { const k = p?.children.filter(x => x.tag !== '#text'); const ix = k?.indexOf(e); return ix > 0 && m(k[ix - 1], i - 1); }
    if (c === '~') { const k = p?.children.filter(x => x.tag !== '#text'); const ix = k?.indexOf(e); return ix > 0 && k.slice(0, ix).some(x => m(x, i - 1)); }
    return false;
  };
  return m(el, partes.length - 1);
}
function especif(sel) {
  let a = 0, b = 0, c = 0;
  sel.children.forEach(x => { if (x.type === 'IdSelector') a++; else if (['ClassSelector', 'AttributeSelector', 'PseudoClassSelector'].includes(x.type)) b++; else if (x.type === 'TypeSelector' && x.name !== '*') c++; });
  return a * 10000 + b * 100 + c;
}

// ---------- estilo computado ----------
const UA = { h1: { 'font-size': '32px', 'font-weight': '700' }, h2: { 'font-size': '24px', 'font-weight': '700' }, a: { 'text-decoration': 'underline', color: '#0000ee' }, button: { 'font-size': '13.33px' }, input: { 'font-size': '13.33px' }, label: {}, };
function resolveVars(v, vars) { let n = 0; while (/var\(/.test(v) && n++ < 5) v = v.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, k, f) => vars[k] ?? f ?? ''); return v; }
function expande(d) {
  const o = { ...d };
  const quad = (p, v) => { const t = v.split(/\s+/); const [a, b = a, c = a, e = b] = t; o[p + '-top'] ??= a; o[p + '-right'] ??= b; o[p + '-bottom'] ??= c; o[p + '-left'] ??= e; };
  if (o.padding) quad('padding', o.padding);
  if (o.margin) quad('margin', o.margin);
  if (o.border && o.border !== 'none') {
    const m = o.border.match(/^(\S+)\s+(\S+)\s+(.+)$/); if (m) { o['border-width'] ??= m[1]; o['border-style'] ??= m[2]; o['border-color'] ??= m[3]; }
    else { const w = o.border.match(/^(\d[\w.]*)/); if (w) o['border-width'] ??= w[1]; }
  }
  if (o.background && !o['background-color']) { const c = o.background.split(/\s+(?![^(]*\))/).find(t => parseColor(t)); if (c) o['background-color'] = c; }
  if (o['border-top-left-radius'] && !o['border-radius']) o['border-radius'] = o['border-top-left-radius'];
  return o;
}
const cache = new WeakMap();
export function estilo(doc, el) {
  if (cache.has(el)) return cache.get(el);
  const ua = UA[el.tag] || {}; const dec = { ...ua };
  const cand = doc.regras.filter(r => casa(el, r.sel)).map(r => ({ r, esp: especif(r.sel) })).sort((a, b) => a.esp - b.esp || a.r.ordem - b.r.ordem);
  for (const { r } of cand) for (const [k, v] of Object.entries(expande(r.decls))) dec[k] = v;
  if (el.attrs.style) for (const p of el.attrs.style.split(';')) { const i = p.indexOf(':'); if (i > 0) dec[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim(); }
  for (const k of Object.keys(dec)) dec[k] = resolveVars(String(dec[k]), doc.vars).replace(/\s*!important/, '');
  const full = expande(dec);
  const pai = el.parent && el.parent.tag !== undefined && el.parent.tag !== '#document' ? estilo(doc, el.parent) : null;
  const out = {};
  for (const [k, v] of Object.entries(full)) out[k] = String(v);
  for (const k of INHERIT) if (out[k] === undefined || out[k] === 'inherit') out[k] = pai?.[k] ?? DEF[k];
  const fs = px(out['font-size'], pai ? px(pai['font-size']) : 16) ?? 16; out['font-size'] = fs + 'px';
  cache.set(el, out); return out;
}
export function px(v, base = 16, ref = 16) {
  if (v == null) return null; v = String(v).trim();
  let m;
  if ((m = v.match(/^(-?[\d.]+)px$/))) return +m[1];
  if ((m = v.match(/^(-?[\d.]+)rem$/))) return +m[1] * 16;
  if ((m = v.match(/^(-?[\d.]+)em$/))) return +m[1] * base;
  if ((m = v.match(/^(-?[\d.]+)pt$/))) return +m[1] * 4 / 3;
  if (/^-?[\d.]+$/.test(v)) return +v;
  return null;
}
function normCor(v) { const c = v && parseColor(v); if (!c) return null; return c.alpha === 0 ? 'transparent' : (c.alpha != null && c.alpha < 1 ? formatHex8(c) : formatHex(c)); }
function fundo(doc, el) { for (let a = el; a && a.tag !== undefined; a = a.parent) { if (a.tag === '#text') continue; const c = parseColor(estilo(doc, a)['background-color'] || ''); if (c && (c.alpha ?? 1) > 0.5) return c; } return parseColor('#ffffff'); }
function lh(doc, el) { const s = estilo(doc, el); const fs = px(s['font-size']); const l = s['line-height']; if (!l || l === 'normal') return fs * 1.2; if (/^[\d.]+$/.test(l)) return fs * +l; return px(l, fs) ?? fs * 1.2; }
function altura(doc, el) { const s = estilo(doc, el); const h = px(s.height, px(s['font-size'])); if (h != null) return h; const bw = el.tag === 'input' || el.tag === 'button' ? (px(s['border-width']) ?? 0) * 2 : 0; return lh(doc, el) + (px(s['padding-top']) ?? (el.tag === 'input' ? 1 : el.tag === 'button' ? 1 : 0)) + (px(s['padding-bottom']) ?? (el.tag === 'input' || el.tag === 'button' ? 1 : 0)) + bw; }

// ---------- utilitários de leitura ----------
const txt = e => e.tag === '#text' ? e.text : e.children.map(txt).join('');
const limpo = s => s.replace(/\s+/g, ' ').trim();
function visiveis(doc) { return todos(doc.root, e => !SKIP.has(e.tag) && e.attrs.type !== 'hidden'); }

// ---------- verificações do data lake ----------
const GEN = ['enviar', 'ok', 'submit', 'go', 'clique aqui', 'send'];
export const CHECKS = {
  rotulo(doc) {
    const falhas = [];
    for (const i of todos(doc.root, e => e.tag === 'input' && !['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(e.attrs.type))) {
      const id = i.attrs.id; let ok = false;
      if (id) ok = todos(doc.root, e => e.tag === 'label' && e.attrs.for === id && limpo(txt(e))).length > 0;
      for (let a = i.parent; a && !ok; a = a.parent) if (a.tag === 'label' && limpo(txt(a))) ok = true;
      if (i.attrs['aria-label'] || i.attrs['aria-labelledby']) ok = ok || false; // aria sozinho não conta como rótulo visível
      if (!ok) falhas.push(`campo ${descr(i)} sem label visível${i.attrs.placeholder ? ' (só placeholder)' : ''}`);
    }
    return falhas;
  },
  tipo_email(doc) { const i = todos(doc.root, e => e.tag === 'input' && e.attrs.type !== 'password' && !['hidden', 'submit', 'checkbox'].includes(e.attrs.type))[0]; if (!i) return ['sem campo de usuário/e-mail']; return (i.attrs.type === 'email' || /username|email/.test(i.attrs.autocomplete || '')) ? [] : [`campo ${descr(i)} é type=${i.attrs.type || 'text'} sem autocomplete username/email`]; },
  tipo_senha(doc) { return todos(doc.root, e => e.tag === 'input' && e.attrs.type === 'password').length ? [] : ['não há input type=password']; },
  autocomplete_senha(doc) { const i = todos(doc.root, e => e.tag === 'input' && e.attrs.type === 'password')[0]; if (!i) return []; return i.attrs.autocomplete === 'current-password' ? [] : [`senha com autocomplete=${i.attrs.autocomplete ?? '(ausente)'}`]; },
  autocomplete_todos(doc) { return todos(doc.root, e => e.tag === 'input' && !['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(e.attrs.type) && !e.attrs.autocomplete).map(i => `campo ${descr(i)} sem autocomplete`); },
  form_submit(doc) { const f = todos(doc.root, e => e.tag === 'form')[0]; if (!f) return ['não há <form>']; const b = todos(f, e => (e.tag === 'button' && (e.attrs.type ?? 'submit') === 'submit') || (e.tag === 'input' && e.attrs.type === 'submit')); return b.length ? [] : ['o form não tem botão de envio type=submit']; },
  contraste_botao(doc) { return todos(doc.root, e => e.tag === 'button' || (e.tag === 'input' && e.attrs.type === 'submit')).filter(b => b.attrs.type !== 'button' || true).flatMap(b => { const s = estilo(doc, b); const fg = parseColor(s.color || '#000'); const bg = fundo(doc, b); if (!fg) return []; const r = wcagContrast(fg, bg); return r < 4.5 ? [`botão "${limpo(txt(b)) || b.attrs.value}" contraste ${r.toFixed(2)}:1 (mínimo 4,5)`] : []; }); },
  contraste_texto(doc) { const out = []; for (const e of todos(doc.root, e => ['label', 'a', 'h1', 'h2', 'p', 'span', 'small'].includes(e.tag) && limpo(txt(e)))) { const fg = parseColor(estilo(doc, e).color || '#000'); if (!fg) continue; const r = wcagContrast(fg, fundo(doc, e)); if (r < 4.5) out.push(`${e.tag} "${limpo(txt(e)).slice(0, 30)}" contraste ${r.toFixed(2)}:1 (mínimo 4,5)`); } return out; },
  contraste_borda(doc) { return todos(doc.root, e => e.tag === 'input' && !['hidden', 'submit', 'checkbox'].includes(e.attrs.type)).flatMap(i => { const s = estilo(doc, i); if ((px(s['border-width']) ?? 1) === 0 || s['border-style'] === 'none') { const bg = parseColor(s['background-color'] || ''); const r = bg ? wcagContrast(bg, fundo(doc, i.parent)) : 1; return r >= 3 ? [] : [`campo ${descr(i)} sem borda e sem fundo distinguível`]; } const c = parseColor(s['border-color'] || '#767676'); if (!c) return []; const r = wcagContrast(c, fundo(doc, i)); return r < 3 ? [`campo ${descr(i)} borda ${normCor(s['border-color'])} contraste ${r.toFixed(2)}:1 (mínimo 3)`] : []; }); },
  alvo(doc) { return todos(doc.root, e => ['button', 'input'].includes(e.tag) && !['hidden', 'checkbox', 'radio'].includes(e.attrs.type)).flatMap(e => { const h = altura(doc, e); return h < 24 ? [`${descr(e)} altura estimada ${h.toFixed(0)} px (mínimo 24)`] : []; }); },
  fonte_min(doc) { return todos(doc.root, e => ['input', 'button', 'label', 'p', 'a'].includes(e.tag) && limpo(txt(e) || e.attrs.placeholder || 'x')).flatMap(e => { const f = px(estilo(doc, e)['font-size']); return f < 16 ? [`${descr(e)} fonte ${f} px (mínimo 16)`] : []; }).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4); },
  viewport(doc) { return todos(doc.root, e => e.tag === 'meta' && e.attrs.name === 'viewport' && /width=device-width/.test(e.attrs.content || '')).length ? [] : ['falta meta viewport com width=device-width']; },
  lang(doc) { return doc.root.attrs.lang ? [] : ['<html> sem lang']; },
  titulo_h1(doc) { const t = todos(doc.root, e => e.tag === 'title' && limpo(txt(e))).length; const h = todos(doc.root, e => e.tag === 'h1').length; const o = []; if (!t) o.push('sem <title>'); if (h !== 1) o.push(`há ${h} <h1> (deve haver 1)`); return o; },
  foco(doc) { const o = []; for (const r of doc.regras) { const d = r.decls; if (/^(none|0)(px)?$/.test(d.outline || d['outline-style'] || '') && !/:focus/.test(r.selTxt)) { const tem = doc.regras.some(q => /:focus/.test(q.selTxt) && (q.decls.outline && !/^none|0/.test(q.decls.outline) || q.decls['box-shadow'] || q.decls['border-color'])); if (!tem) o.push(`regra "${r.selTxt}" remove o outline sem indicador de foco`); } } return o.filter((v, i, a) => a.indexOf(v) === i); },
  esqueci(doc) { return todos(doc.root, e => e.tag === 'a' && /esquec|recuper|redefin|forgot|reset/i.test(txt(e))).length ? [] : ['sem link de recuperar senha']; },
  paste(doc) { return todos(doc.root, e => e.tag === 'input' && /onpaste/.test(Object.keys(e.attrs).join(' ')) && /false|preventDefault/.test(e.attrs.onpaste || '')).map(i => `campo ${descr(i)} bloqueia colar`); },
  mostrar_senha(doc) { return todos(doc.root, e => e.tag === 'button' && /mostr|exib|show|ver senha|revel/i.test(txt(e) + (e.attrs['aria-label'] || ''))).length ? [] : ['sem controle para mostrar/ocultar a senha']; },
  erro(doc) { return todos(doc.root, e => e.attrs.role === 'alert' || e.attrs['aria-live'] || /error|erro/.test(e.attrs.class || '') || todos(doc.root, i => i.attrs['aria-describedby'] === e.attrs.id && e.attrs.id).length).length ? [] : ['sem mensagem de erro em texto associada aos campos']; },
  obrigatorio(doc) { return todos(doc.root, e => e.tag === 'input' && !['hidden', 'submit', 'button', 'checkbox'].includes(e.attrs.type) && !('required' in e.attrs) && e.attrs['aria-required'] !== 'true').map(i => `campo ${descr(i)} sem required`); },
  line_height(doc) { const b = todos(doc.root, e => e.tag === 'body')[0]; if (!b) return []; const s = estilo(doc, b); const l = s['line-height']; const f = px(s['font-size']); const v = l === 'normal' ? 1.2 : /^[\d.]+$/.test(l) ? +l : px(l, f) / f; return v >= 1.5 ? [] : [`line-height do corpo ${v.toFixed(2)} (mínimo 1,5)`]; },
  reflow(doc) { const o = []; for (const e of visiveis(doc)) { const s = estilo(doc, e); for (const k of ['width', 'min-width']) { const v = px(s[k]); if (v > 320) o.push(`${descr(e)} ${k}: ${s[k]} (> 320 px)`); } } return o; },
  link_distinto(doc) { return todos(doc.root, e => e.tag === 'a').flatMap(a => { const s = estilo(doc, a); if (/none/.test(s['text-decoration'] || '')) { const fg = parseColor(s.color || '#000'); const pai = a.parent && a.parent.tag !== '#text' ? parseColor(estilo(doc, a.parent).color || '#000') : null; if (fg && pai && wcagContrast(fg, pai) < 3) return [`link "${limpo(txt(a)).slice(0, 25)}" sem sublinhado e quase da cor do texto`]; } return []; }); },
  img_alt(doc) { return todos(doc.root, e => e.tag === 'img' && !('alt' in e.attrs)).map(() => 'img sem alt'); },
  rotulo_acao(doc) { return todos(doc.root, e => e.tag === 'button' || (e.tag === 'input' && e.attrs.type === 'submit')).filter(b => b.attrs.type !== 'button').flatMap(b => GEN.includes(limpo(txt(b) || b.attrs.value || '').toLowerCase()) ? [`botão com rótulo genérico "${limpo(txt(b) || b.attrs.value)}"`] : []); },
  um_primario(doc) { const solidos = todos(doc.root, e => e.tag === 'button' && e.attrs.type !== 'button').filter(b => { const bg = normCor(estilo(doc, b)['background-color']); return bg && bg !== 'transparent' && bg !== '#ffffff'; }); return solidos.length > 1 ? [`${solidos.length} botões preenchidos competem como primário`] : []; },
  consistencia(doc) { const r = new Set(); for (const e of todos(doc.root, e => (e.tag === 'input' && !['hidden', 'checkbox'].includes(e.attrs.type)) || (e.tag === 'button' && e.attrs.type !== 'button'))) r.add(String(px(estilo(doc, e)['border-radius']) ?? 0)); return r.size > 1 ? [`raios de borda diferentes entre campos e botão: ${[...r].join(', ')} px`] : []; },
  escala_espaco(doc) { const o = []; for (const e of visiveis(doc)) { const s = estilo(doc, e); for (const k of ['margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'gap']) { const v = px(s[k]); if (v != null && v !== 0 && Math.abs(v % 4) > 0.01 && Math.abs(v % 4 - 4) > 0.01) o.push(`${descr(e)} ${k}: ${s[k]} não é múltiplo de 4`); } } return o.filter((v, i, a) => a.indexOf(v) === i).slice(0, 4); },
  ordem(doc) { const t = todos(doc.root, e => e.tag === 'input' || e.tag === 'button'); const iu = t.findIndex(e => e.tag === 'input' && e.attrs.type !== 'password' && e.attrs.type !== 'hidden'); const ip = t.findIndex(e => e.attrs.type === 'password'); const ib = t.findIndex(e => (e.tag === 'button' && e.attrs.type !== 'button') || e.attrs.type === 'submit'); if (iu < 0 || ip < 0 || ib < 0) return []; return iu < ip && ip < ib ? [] : ['a ordem no DOM não é usuário, senha, botão']; },
};
function descr(e) { return `<${e.tag}${e.attrs.type ? ` type=${e.attrs.type}` : ''}${e.attrs.id ? ` #${e.attrs.id}` : e.attrs.name ? ` name=${e.attrs.name}` : ''}>`; }

export function verificar(html, lake) {
  const doc = carregar(html);
  return lake.map(r => { const f = CHECKS[r.check] ? CHECKS[r.check](doc) : []; return { id: r.id, regra: r.regra, ok: f.length === 0, detalhe: f }; });
}
export function relatorio(html, lake) {
  const v = verificar(html, lake); const falhas = v.filter(x => !x.ok);
  const l = ['RELATÓRIO DO KIT (checagem automática por código)', `Regras verificadas: ${v.length}. Falharam: ${falhas.length}.`];
  for (const f of falhas) l.push(`- ${f.id} FALHOU: ${f.regra} → ${f.detalhe.join('; ')}`);
  if (!falhas.length) l.push('Nenhuma regra falhou.');
  return l.join('\n');
}

// ---------- diff estrutural e de estilo (frente 3) ----------
const PROPS = ['color', 'background-color', 'font-size', 'font-weight', 'line-height', 'font-family', 'text-align', 'text-decoration', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom', 'border-width', 'border-style', 'border-color', 'border-radius', 'width', 'max-width', 'height', 'display', 'gap', 'box-shadow', 'opacity', 'letter-spacing'];
function normVal(k, v) {
  if (v == null) return null; v = String(v).trim().toLowerCase();
  if (/color|^color$/.test(k) || k === 'border-color') return normCor(v) ?? v;
  if (['font-size', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom', 'border-width', 'border-radius', 'width', 'max-width', 'height', 'gap', 'letter-spacing'].includes(k)) { const p = px(v); return p != null ? p + 'px' : v; }
  if (k === 'font-weight') return ({ normal: '400', bold: '700' })[v] ?? v;
  if (k === 'line-height') { if (v === 'normal') return '1.2'; if (/^[\d.]+$/.test(v)) return v; return v; }
  if (k === 'font-family') return v.replace(/["']/g, '').replace(/\s*,\s*/g, ',');
  return v.replace(/\s+/g, ' ');
}
function chave(e) {
  const nome = limpo(txt(e)).slice(0, 24).toLowerCase();
  const cont = ['body', 'form', 'div', 'section', 'main', 'header', 'footer', 'ul', 'nav'].includes(e.tag);
  return [e.tag, e.attrs.id || e.attrs.name || '', e.attrs.type || '', (e.tag === 'input' || cont) ? '' : nome].join('|');
}
function mapa(doc) {
  const m = new Map(); const cont = {};
  for (const e of todos(doc.root, e => !SKIP.has(e.tag) && ['body', 'form', 'input', 'button', 'a', 'label', 'h1', 'h2', 'p', 'img', 'div', 'span', 'small', 'select', 'textarea', 'section', 'main', 'header', 'footer', 'ul', 'li', 'nav'].includes(e.tag))) {
    let k = chave(e); cont[k] = (cont[k] || 0) + 1; if (cont[k] > 1) k += '#' + cont[k]; m.set(k, e);
  }
  return m;
}
const ATTR_IGN = new Set(['class', 'style', 'id']);
export function diferencas(htmlA, htmlB) {
  const A = carregar(htmlA), B = carregar(htmlB);
  const ma = mapa(A), mb = mapa(B); const out = [];
  const nome = k => k.split('|').filter(Boolean).join(' ').replace(/#\d+$/, '');
  for (const k of ma.keys()) if (!mb.has(k)) out.push({ cat: 'estrutura', acao: 'removido', alvo: nome(k) });
  for (const k of mb.keys()) if (!ma.has(k)) out.push({ cat: 'estrutura', acao: 'adicionado', alvo: nome(k) });
  for (const [k, ea] of ma) {
    const eb = mb.get(k); if (!eb) continue;
    const sa = estilo(A, ea), sb = estilo(B, eb);
    for (const p of PROPS) { const va = normVal(p, sa[p]), vb = normVal(p, sb[p]); if ((va ?? null) !== (vb ?? null) && !(va == null && vb == null)) out.push({ cat: 'estilo', alvo: nome(k), propriedade: p, de: va, para: vb }); }
    const aa = Object.keys({ ...ea.attrs, ...eb.attrs }).filter(a => !ATTR_IGN.has(a) && !a.startsWith('data-'));
    for (const a of aa) if ((ea.attrs[a] ?? null) !== (eb.attrs[a] ?? null)) out.push({ cat: a === 'href' || a === 'action' || a === 'method' || a === 'name' || a === 'type' ? 'fluxo' : 'atributo', alvo: nome(k), propriedade: a, de: ea.attrs[a] ?? null, para: eb.attrs[a] ?? null });
    if (!['body', 'form', 'div', 'section', 'main', 'header', 'footer', 'ul', 'nav'].includes(ea.tag)) { const ta = limpo(txt(ea)), tb = limpo(txt(eb)); if (ta !== tb) out.push({ cat: 'conteudo', alvo: nome(k), de: ta.slice(0, 60), para: tb.slice(0, 60) }); }
  }
  // ordem relativa dos campos (fluxo)
  const ord = d => todos(d.root, e => e.tag === 'input' || e.tag === 'button').map(e => e.attrs.name || e.attrs.id || e.attrs.type || e.tag).join('>');
  if (ord(A) !== ord(B)) out.push({ cat: 'fluxo', alvo: 'ordem dos controles', de: ord(A), para: ord(B) });
  return out;
}
export function relatorioDiff(a, b) {
  const d = diferencas(a, b); const l = ['RELATÓRIO DO KIT (diferenças entre as telas A e B, valores normalizados: #fff = rgb(255,255,255), 16px = 1rem; nomes de classe e espaços são ignorados)', `Diferenças encontradas: ${d.length}.`];
  for (const x of d) l.push('- ' + (x.cat === 'estrutura' ? `${x.acao} ${x.alvo}` : x.propriedade ? `${x.cat}: ${x.alvo} ${x.propriedade}: ${x.de} → ${x.para}` : `${x.cat}: ${x.alvo}: "${x.de}" → "${x.para}"`));
  if (!d.length) l.push('As telas são equivalentes em estrutura, conteúdo, fluxo e estilo.');
  return l.join('\n');
}

// ---------- CLI ----------
if (process.argv[1] && process.argv[1].endsWith('kit.mjs') && process.argv[2]) {
  const fs = await import('node:fs'); const lake = JSON.parse(fs.readFileSync(new URL('../lake/login.json', import.meta.url), 'utf8'));
  if (process.argv[2] === 'diff') console.log(relatorioDiff(fs.readFileSync(process.argv[3], 'utf8'), fs.readFileSync(process.argv[4], 'utf8')));
  else console.log(relatorio(fs.readFileSync(process.argv[2], 'utf8'), lake));
}
