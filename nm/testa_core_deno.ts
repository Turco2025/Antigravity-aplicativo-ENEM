// Deno: o MESMO core avaliado como módulo TS (via notacao_matematica.ts) contra os mesmos casos.
import { nmNormalizaTexto, nmNormalizaQuestao, nmAudita } from "../supabase/functions/generate-question/notacao_matematica.ts";
const casos = JSON.parse(await Deno.readTextFile(new URL("./casos_notacao.json", import.meta.url)));
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let ok = 0; const falhas: string[] = [];
for (const c of casos.texto) { const esp = c.igual ? c.in : c.out; const s = nmNormalizaTexto(c.in); if (s === esp && nmNormalizaTexto(s) === s) ok++; else falhas.push(`texto ${c.n}: ${JSON.stringify(s)}`); }
for (const c of casos.questao) { const esp = c.igual ? c.in : c.out; const s = nmNormalizaQuestao(c.in, c.disciplina); if (igual(s, esp) && igual(nmNormalizaQuestao(s, c.disciplina), s)) ok++; else falhas.push(`questao ${c.n}: ${JSON.stringify(s)}`); }
for (const c of casos.auditoria) { const s = nmAudita(c.in); if (igual(s, c.achados)) ok++; else falhas.push(`auditoria ${c.in}: ${JSON.stringify(s)}`); }
// Não regressão química: para textos de Natureza, aplicar a rede matemática DEPOIS
// da química não pode mudar nada que a química decidiu, e reaplicar a química
// depois da matemática também não muda nada (as duas comutam nesses casos).
import { normalizarNotacaoTexto } from "../supabase/functions/generate-question/notacao_quimica.ts";
const quimicos = [
  "6CO2 + 6H2O → C6H12O6 + 6O2", "SO4 2- e Ca2+ em solução", "NH4+ e NO3-", "2 H2(g) + O2(g) → 2 H2O(l)",
  "SO4^2-(aq) + Ba^2+(aq) → BaSO4(s)", "Fe^3+(aq) e Ca^{2+}", "Al2(SO4)3 e K2Cr2O7", "1,5 × 10^-3 mol/L de H2SO4",
  "pH = -log[H+] e [H+] = 10^-7 mol/L", "K = [NH3]^2/([N2]·[H2]^3)", "v = k·[A]^2·[B]", "CH3COOH ⇌ CH3COO- + H+",
];
for (const d of ["Química", "Física", "Biologia", "Geografia"]) for (const x of quimicos) {
  const q = normalizarNotacaoTexto(x, d); const m = nmNormalizaTexto(q); const q2 = normalizarNotacaoTexto(m, d);
  if (q2 === m && nmNormalizaTexto(q2) === m) ok++; else falhas.push(`química×matemática [${d}] ${x} → quim: ${q} → mat: ${m} → quim: ${q2}`);
}
console.log(`${ok} casos ok, ${falhas.length} falha(s)`); falhas.forEach((f) => console.log("✗ " + f));
if (falhas.length) Deno.exit(1);
