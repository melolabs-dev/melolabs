// Renderiza HTML em PNG (Chrome instalado, 390x844). Uso: node render.mjs entrada.json pasta_saida   (entrada: [{chave, html}])
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const [ent, pasta] = process.argv.slice(2); fs.mkdirSync(pasta, { recursive: true });
const itens = JSON.parse(fs.readFileSync(ent, 'utf8'));
const b = await chromium.launch({ channel: 'chrome' }); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const pg = await ctx.newPage();
for (const it of itens) { await pg.setContent(it.html, { waitUntil: 'load' }); const h = process.env.CORTAR ? await pg.evaluate(() => Math.ceil(document.querySelector('main').getBoundingClientRect().bottom) + 32) : 844; await pg.screenshot({ path: `${pasta}/${it.chave}.png`, clip: { x: 0, y: 0, width: 390, height: Math.min(h, 844) } }); }
await b.close(); console.log('renderizadas', itens.length);
