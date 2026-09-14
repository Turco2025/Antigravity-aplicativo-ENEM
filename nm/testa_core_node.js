// Node: avalia o core (como o navegador faria) e roda os casos compartilhados.
const fs = require("fs"), path = require("path"), vm = require("vm");
const dir = __dirname;
const core = fs.readFileSync(path.join(dir, "notacao_matematica_core.js"), "utf8");
const casos = JSON.parse(fs.readFileSync(path.join(dir, "casos_notacao.json"), "utf8"));
const ctx = {}; vm.createContext(ctx);
vm.runInContext(core + "\n;this.__nm = { nmNormalizaTexto, nmNormalizaQuestao, nmAudita };", ctx);
const { nmNormalizaTexto, nmNormalizaQuestao, nmAudita } = ctx.__nm;

let ok = 0, falhas = [];
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const c of casos.texto) {
  const esperado = c.igual ? c.in : c.out;
  const saida = nmNormalizaTexto(c.in);
  if (saida === esperado && nmNormalizaTexto(saida) === saida) ok++;
  else falhas.push(`texto "${c.n}"\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(saida)}${nmNormalizaTexto(saida) !== saida ? "\n   (não idempotente)" : ""}`);
}
for (const c of casos.questao) {
  const esperado = c.igual ? c.in : c.out;
  const saida = nmNormalizaQuestao(c.in, c.disciplina);
  if (igual(saida, esperado) && igual(nmNormalizaQuestao(saida, c.disciplina), saida)) ok++;
  else falhas.push(`questao "${c.n}"\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(saida)}`);
}
for (const c of casos.auditoria) {
  const saida = nmAudita(c.in);
  if (igual(saida, c.achados)) ok++;
  else falhas.push(`auditoria ${JSON.stringify(c.in)}\n   esperado: ${JSON.stringify(c.achados)}\n   obtido:   ${JSON.stringify(saida)}`);
}
// Paridade: o núcleo colado em src/app.js (NM-INÍCIO…NM-FIM) e o de notacao_matematica.ts
// têm de ser byte a byte iguais a este arquivo.
try {
  const app = fs.readFileSync(path.join(dir, "..", "src", "app.js"), "utf8");
  const bloco = app.split("// NM-INÍCIO\n")[1].split("// NM-FIM")[0];
  if (bloco === core.replace(/\s+$/, "") + "\n") ok++; else falhas.push("paridade: o bloco NM em src/app.js difere de nm/notacao_matematica_core.js");
  const ts = fs.readFileSync(path.join(dir, "..", "supabase", "functions", "generate-question", "notacao_matematica.ts"), "utf8");
  if (ts.includes(core.replace(/\s+$/, ""))) ok++; else falhas.push("paridade: notacao_matematica.ts não contém o núcleo idêntico");
} catch (e) { falhas.push("paridade: " + e.message); }
console.log(`${ok} casos ok, ${falhas.length} falha(s)`);
falhas.forEach(f => console.log("✗ " + f));
process.exit(falhas.length ? 1 : 0);
