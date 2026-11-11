import { navegador, rng, embaralhar } from '../comum.mjs';
import * as F from './configuracoes.mjs';

const SEMENTES = Array.from({ length: 15 }, (_, i) => i + 1);
const nav = await navegador();
let total = 0, certos = 0;
const falhas = [], porRegra = Object.fromEntries(F.REGRAS.map(r => [r, { t: 0, c: 0 }]));
let minL = 1e9, maxL = 0, noRuido = 0;

async function rodar(html) { const pg = await nav.abrir(html); return F.checar(pg); }
function comparar(rotulo, res, esperadoFalho) {
  for (const id of F.REGRAS) {
    const esp = !esperadoFalho.has(id);
    const obtido = res[id] && res[id].ok;
    total++; porRegra[id].t++;
    if (obtido === esp) { certos++; porRegra[id].c++; }
    else falhas.push(`${rotulo} regra ${id}: esperado ${esp ? 'ok' : 'falha'}, obtido ${obtido ? 'ok' : 'falha'} (${res[id] && res[id].nota})`);
  }
}

for (const s of SEMENTES) {
  const V = F.variante(s);
  const base = F.construir(V, new Set());
  if (JSON.stringify(F.construir(V, new Set())) !== JSON.stringify(base)) falhas.push(`seed ${s}: construir não determinístico`);
  const linhas = base.split('\n').length; minL = Math.min(minL, linhas); maxL = Math.max(maxL, linhas);
  comparar(`s${s} base`, await rodar(base), new Set());
  for (const r of F.REGRAS) {
    const h = F.construir(V, new Set([r]));
    const l = h.split('\n').length; minL = Math.min(minL, l); maxL = Math.max(maxL, l);
    comparar(`s${s} viola ${r}`, await rodar(h), new Set([r]));
  }
  const R = rng(s * 101);
  const cinco = new Set(embaralhar(R, F.REGRAS).slice(0, 5));
  const hc = F.construir(V, cinco);
  comparar(`s${s} viola5 ${[...cinco]}`, await rodar(hc), cinco);
  // ruído não pode mudar o resultado
  const a = await rodar(hc), b = await rodar(F.ruido(hc, s));
  for (const id of F.REGRAS) if (a[id].ok !== b[id].ok) { noRuido++; falhas.push(`s${s} ruido mudou ${id}: ${a[id].ok} -> ${b[id].ok}`); }
}
await nav.fechar();
console.log(`Concordância total: ${certos}/${total} = ${(100 * certos / total).toFixed(2)}%`);
console.log(`Linhas da tela: min ${minL}, max ${maxL}. Divergências por ruído: ${noRuido}`);
for (const [id, p] of Object.entries(porRegra)) console.log(`${id}: ${p.c}/${p.t} = ${(100 * p.c / p.t).toFixed(1)}%`);
console.log(`Falhas (${falhas.length}):`); falhas.slice(0, 60).forEach(f => console.log(' - ' + f));
