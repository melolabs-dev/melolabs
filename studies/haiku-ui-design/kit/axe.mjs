// Checagem independente: axe-core (WCAG 2.x A/AA) sobre o HTML final de T1/T2. Uso: node axe.mjs entrada.jsonl saida.json
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const axeSrc = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const [ent, sai] = process.argv.slice(2); const out = [];
const b = await chromium.launch({ channel: 'chrome' }); const pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
for (const l of fs.readFileSync(ent, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l); if (r.erro || !r.html_final) continue;
  try { await pg.setContent(r.html_final, { waitUntil: 'load' }); await pg.evaluate(axeSrc);
    const res = await pg.evaluate(async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
    out.push({ tarefa: r.tarefa, id: r.id, cond: r.cond, amostra: r.amostra, modelo: r.modelo, violacoes: res.violations.length, regras: res.violations.map(v => v.id) });
  } catch (e) { out.push({ tarefa: r.tarefa, id: r.id, cond: r.cond, amostra: r.amostra, modelo: r.modelo, erro: String(e).slice(0, 80) }); }
}
await b.close(); fs.writeFileSync(sai, JSON.stringify(out)); console.log('axe', out.length);
