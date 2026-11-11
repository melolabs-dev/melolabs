// Instrumento de consistência e hierarquia visual (10 medidas, ver dados/ESTETICA-CODIGO-CRITERIOS.md). Uso: node estetica.mjs entrada.json saida.json  ([{chave, html}])
import fs from 'node:fs'; import { chromium } from 'playwright-core';
import { parse as P, wcagContrast } from 'culori';
const medir = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const q = s => [...document.querySelectorAll(s)].filter(vis);
  const campos = q('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]), select, textarea');
  const botoes = q('button, input[type=submit]'); const btn = botoes.find(b => b.type === 'submit') || botoes.filter(b => b.type !== 'button')[0] || botoes[0];
  const rot = q('label'); const h1 = q('h1')[0]; const links = q('a');
  const css = (e, p) => getComputedStyle(e)[p]; const num = v => parseFloat(v) || 0;
  const bgDe = e => { for (let a = e; a; a = a.parentElement) { const c = css(a, 'backgroundColor'); const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); if (p.length < 4 || p[3] > 0.5) return c; } } return 'rgb(255,255,255)'; };
  const rect = e => e.getBoundingClientRect();
  return {
    alvo_min: Math.min(...[btn, ...campos].filter(Boolean).map(e => rect(e).height)),
    fonte_min: Math.min(...[...rot, ...campos, btn].filter(Boolean).map(e => num(css(e, 'fontSize')))),
    cor_texto: [...rot, ...links].map(e => [css(e, 'color'), bgDe(e)]),
    cor_botao: btn ? [css(btn, 'color'), bgDe(btn)] : null,
    cor_borda: campos.map(e => [css(e, 'borderTopColor'), bgDe(e.parentElement || e), num(css(e, 'borderTopWidth'))]),
    xs: [h1, ...rot, ...campos, btn].filter(Boolean).map(e => rect(e).left),
    blocos: [h1, ...campos.flatMap((c, i) => [rot[i], c]), btn, links[0]].filter(Boolean).map(e => { const r = rect(e); return [r.top, r.bottom]; }),
    h1: h1 ? num(css(h1, 'fontSize')) : 0, corpo: num(css(document.body, 'fontSize')),
    wc: campos[0] ? rect(campos[0]).width : 0, wb: btn ? rect(btn).width : 0,
    rc: campos[0] ? num(css(campos[0], 'borderTopLeftRadius')) : 0, rb: btn ? num(css(btn, 'borderTopLeftRadius')) : 0,
  };
};
const razao = ([a, b]) => { const x = P(a), y = P(b); return x && y ? wcagContrast(x, y) : 21; };
const c01 = v => Math.max(0, Math.min(1, v));
export function pontuar(m) {
  const sd = a => { const mu = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length); };
  const gaps = []; const bl = m.blocos.sort((a, b) => a[0] - b[0]); for (let i = 1; i < bl.length; i++) { const g = bl[i][0] - bl[i - 1][1]; if (g >= 0) gaps.push(g); }
  const mg = gaps.reduce((s, x) => s + x, 0) / (gaps.length || 1);
  const s = {
    alvo: c01(m.alvo_min / 44), fonte: c01(m.fonte_min / 16),
    contraste_texto: c01(Math.min(...m.cor_texto.map(razao), 21) / 4.5), contraste_botao: m.cor_botao ? c01(razao(m.cor_botao) / 4.5) : 0,
    contraste_borda: c01(Math.min(...m.cor_borda.map(([a, b, w]) => (w < 0.5 ? 1 : razao([a, b]))), 21) / 3),
    alinhamento: 1 - c01(sd(m.xs) / 8), ritmo: 1 - c01(mg ? sd(gaps) / mg : 1), hierarquia: c01(m.corpo ? m.h1 / m.corpo / 1.5 : 0),
    largura: 1 - c01(Math.abs(m.wc - m.wb) / 16), raio: 1 - c01(Math.abs(m.rc - m.rb) / 8),
  };
  return { ...s, nota: Object.values(s).reduce((a, b) => a + b, 0) / 10 };
}
if (process.argv[1]?.endsWith('estetica.mjs')) {
  const [ent, sai] = process.argv.slice(2); const itens = JSON.parse(fs.readFileSync(ent, 'utf8')); const out = {};
  const b = await chromium.launch({ channel: 'chrome' }); const pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  for (const it of itens) { try { await pg.setContent(it.html, { waitUntil: 'load' }); out[it.chave] = pontuar(await pg.evaluate(medir)); } catch (e) { out[it.chave] = { erro: String(e).slice(0, 100) }; } }
  await b.close(); fs.writeFileSync(sai, JSON.stringify(out, null, 1)); console.log('pontuadas', itens.length);
}
