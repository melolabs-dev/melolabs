// Pontuação por código (sem juiz LLM). Uso: node pontuar.mjs entrada.jsonl saida.jsonl
// T1/T2: regras do data lake que falham no HTML final (kit) e, no T2, defeitos removidos/introduzidos.
// T3: recall/precisão/alarmes falsos contra o gabarito exato, casando por sinônimos fixados antes da coleta.
import fs from 'node:fs';
import { verificar } from './kit.mjs';

const aqui = new URL('.', import.meta.url);
const lake = JSON.parse(fs.readFileSync(new URL('../lake/login.json', aqui), 'utf8'));
const est = f => JSON.parse(fs.readFileSync(new URL('../dados/estimulos/' + f, aqui), 'utf8'));
const T2 = Object.fromEntries(est('t2.json').map(t => [t.id, t]));
const T3 = Object.fromEntries(est('t3.json').map(t => [t.id, t]));

const PROP = {
  'background-color': /background|fundo|\bbg\b|cor do bot|accent|acento/i, 'border-radius': /radius|raio|arredond/i, 'font-size': /font-?size|tamanho|fonte/i,
  'line-height': /line-?height|altura de linha|entrelinha/i, padding: /padding|preenchimento|espa[çc]amento interno|altura/i, 'font-weight': /weight|peso|negrito|bold/i,
  'border-color': /border|borda/i, 'max-width': /max-?width|largura/i, 'margin-bottom': /margin|espa[çc]o|gap|espa[çc]amento/i, color: /color|cor/i,
  'letter-spacing': /letter|entre letras|tracking/i, 'box-shadow': /shadow|sombra/i, texto: /texto|text|conte[úu]do|r[óo]tulo|label|placeholder|content/i,
  action: /action|destino|\/login|\/sessao/i, method: /method|m[ée]todo|post|get/i, type: /type|tipo/i, href: /href|destino|link/i, removido: /remov|ausen|falta|deleted|sem |n[ãa]o (existe|h[áa])/i, ordem: /ordem|order|sequ/i,
};
const ELEM = {
  titulo: /h1|t[ií]tulo|heading/i, botao: /bot[ãa]o|button|entrar|submit/i, campo: /input|campo|field/i, rotulo: /label|r[óo]tulo/i, cartao: /card|cart[ãa]o|main|container|caixa/i,
  corpo: /body|corpo|p[áa]gina|texto|geral|global/i, form: /form/i, link: /link|<a|esqueci|recuper|ajuda/i, 'botao mostrar': /mostrar|exibir|show|toggle|olho/i,
  'campo de e-mail': /e-?mail|usu[áa]rio/i, 'campo de senha': /senha|password/i, 'rotulo do e-mail': /e-?mail|usu[áa]rio/i, 'rotulo da senha': /senha|password/i,
  'mensagem de erro': /erro|alert|error/i, ordem: /./,
};
function casa(item, k) {
  const resp = item || {}; const el = [resp.elemento, resp.descricao].join(' '); const pr = [resp.propriedade, resp.elemento, resp.de, resp.para].join(' ');
  const eOk = (ELEM[k.alvo] || /./).test(el); const pOk = (PROP[k.propriedade] || /./).test(pr);
  return eOk && pOk;
}
function lerJson(t) { const m = t.match(/\[[\s\S]*\]/); if (!m) return null; try { const j = JSON.parse(m[0]); return Array.isArray(j) ? j : null; } catch { return null; } }

const [entrada, saida] = process.argv.slice(2);
const linhas = fs.readFileSync(entrada, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const out = linhas.map(r => {
  if (r.erro) return r;
  if (r.tarefa === 'T1' || r.tarefa === 'T2') {
    const v = verificar(r.html_final, lake); const fal = v.filter(x => !x.ok).map(x => x.id);
    r.falhas = fal; r.n_falhas = fal.length; r.n_regras = v.length;
    if (r.tarefa === 'T2') { const ch = T2[r.id].chave; r.removidos = ch.filter(x => !fal.includes(x)).length; r.n_defeitos = ch.length; r.introduzidos = fal.filter(x => !ch.includes(x)).length; }
  } else if (r.tarefa === 'T3') {
    const ch = T3[r.id].chave; const j = lerJson(r.resposta); r.json_ok = j !== null; const lista = j || [];
    const usados = new Set(); let acertos = 0;
    for (const k of ch) { const i = lista.findIndex((it, ix) => !usados.has(ix) && casa(it, k)); if (i >= 0) { usados.add(i); acertos++; } }
    r.n_chave = ch.length; r.acertos = acertos; r.n_resposta = lista.length; r.alarmes_falsos = lista.length - usados.size;
  }
  return r;
});
fs.writeFileSync(saida, out.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log('pontuadas', out.length);
