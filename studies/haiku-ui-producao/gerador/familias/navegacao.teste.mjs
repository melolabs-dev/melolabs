import { navegador, rng, embaralhar } from '../comum.mjs';
import * as fam from './navegacao.mjs';

const SEMENTES = Array.from({ length: 15 }, (_, i) => i + 1);
const nav = await navegador();
let total = 0, certos = 0;
const porRegra = Object.fromEntries(fam.REGRAS.map(r => [r, { n: 0, ok: 0 }]));
const falhas = [];
const linhas = [];

async function rodar(html) { const pg = await nav.abrir(html); return fam.checar(pg); }
function avaliar(rotulo, res, falham) {
  for (const id of fam.REGRAS) {
    const esperado = !falham.has(id);
    const r = res[id];
    const bate = r && r.ok === esperado;
    total++; porRegra[id].n++;
    if (bate) { certos++; porRegra[id].ok++; }
    else falhas.push(`${rotulo} regra ${id}: esperado ok=${esperado}, obtido ${r ? r.ok : 'ausente'} (${r ? r.nota : ''})`);
  }
}

for (const s of SEMENTES) {
  const v = fam.variante(s);
  const base = fam.construir(v, new Set());
  if (fam.construir(v, new Set()) !== base) falhas.push(`seed ${s}: construir não determinístico`);
  linhas.push(base.split('\n').length);
  avaliar(`seed ${s} limpa`, await rodar(base), new Set());
  for (const r of fam.REGRAS) avaliar(`seed ${s} viola ${r}`, await rodar(fam.construir(v, new Set([r]))), new Set([r]));
  const R = rng(s * 101 + 3);
  const cinco = new Set(embaralhar(R, fam.REGRAS).slice(0, 5));
  avaliar(`seed ${s} viola 5 [${[...cinco].join(',')}]`, await rodar(fam.construir(v, cinco)), cinco);
  // ruído não pode mudar o resultado
  if (s <= 5) {
    const html = fam.construir(v, cinco);
    const a = await rodar(html), b = await rodar(fam.ruido(html, s));
    for (const id of fam.REGRAS) if (a[id].ok !== b[id].ok) falhas.push(`seed ${s}: ruído mudou ${id}`);
  }
}
await nav.fechar();
console.log(`Concordância total: ${certos}/${total} = ${(100 * certos / total).toFixed(2)}%`);
for (const [id, x] of Object.entries(porRegra)) console.log(id, `${x.ok}/${x.n}`, `${(100 * x.ok / x.n).toFixed(1)}%`);
console.log(`Linhas da tela limpa: mín ${Math.min(...linhas)} máx ${Math.max(...linhas)}`);
if (falhas.length) { console.log(`Falhas (${falhas.length}):`); for (const f of falhas.slice(0, 60)) console.log(' -', f); }
