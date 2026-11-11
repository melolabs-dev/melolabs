import { navegador, rng, embaralhar } from '../comum.mjs';
import * as F from './painel.mjs';

const SEMENTES = Array.from({ length: 15 }, (_, i) => i + 1);
const nav = await navegador();
let total = 0, certos = 0;
const falhas = [];
const porRegra = {};
let minL = Infinity, maxL = 0;

async function rodar(html) { const pg = await nav.abrir(html); return F.checar(pg); }
function comparar(rotulo, res, violadas) {
  for (const id of F.REGRAS) {
    const esperado = !violadas.has(id);
    const obtido = res[id] ? res[id].ok : undefined;
    total++;
    porRegra[id] = porRegra[id] || { t: 0, c: 0 };
    porRegra[id].t++;
    if (obtido === esperado) { certos++; porRegra[id].c++; }
    else falhas.push(`${rotulo} regra ${id}: esperado ok=${esperado}, obtido ok=${obtido} (${res[id] ? res[id].nota : 'sem resultado'})`);
  }
}

for (const s of SEMENTES) {
  const vr = F.variante(s);
  const base = F.construir(vr, new Set());
  const l = base.split('\n').length; minL = Math.min(minL, l); maxL = Math.max(maxL, l);
  if (F.construir(vr, new Set()) !== base) falhas.push(`seed ${s}: construir não determinístico`);
  comparar(`s${s} limpo`, await rodar(base), new Set());
  for (const id of F.REGRAS) {
    const v = new Set([id]);
    comparar(`s${s} viola ${id}`, await rodar(F.construir(vr, v)), v);
  }
  const R = rng(s * 31 + 5);
  const cinco = new Set(embaralhar(R, F.REGRAS).slice(0, 5));
  comparar(`s${s} combo ${[...cinco].join('+')}`, await rodar(F.construir(vr, cinco)), cinco);
  // ruído não pode mudar o resultado
  for (const v of [new Set(), cinco]) {
    const r1 = await rodar(F.construir(vr, v)), r2 = await rodar(F.ruido(F.construir(vr, v), s));
    for (const id of F.REGRAS) if (r1[id].ok !== r2[id].ok) falhas.push(`s${s} ruido altera ${id} (violar=${[...v].join('+') || 'nenhuma'}): ${r1[id].ok} -> ${r2[id].ok}`);
  }
  process.stderr.write(`seed ${s} ok\n`);
}
await nav.fechar();
console.log(`Concordância total: ${certos}/${total} = ${(100 * certos / total).toFixed(2)}%`);
console.log(`Linhas da tela: min ${minL}, max ${maxL}`);
console.log('Por regra:');
for (const [id, x] of Object.entries(porRegra)) console.log(`  ${id}: ${x.c}/${x.t} = ${(100 * x.c / x.t).toFixed(1)}%`);
console.log(`Falhas (${falhas.length}):`);
for (const f of falhas.slice(0, 80)) console.log('  ' + f);
