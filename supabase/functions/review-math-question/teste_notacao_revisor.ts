(Deno as any).serve = (h: any) => { (globalThis as any).__handler = h; };
const mod = await import("./index.ts");   // rode a partir de uma cópia com os imports do GitHub trocados por locais (ver revisao/ ou /tmp/rmcheck no ambiente de desenvolvimento)
const { revisarNotacao, residuosNotacao } = mod as any;
const ov = (r: string) => Array.from(r).map((c) => c + "̅").join("");
// Questão real de hoje (q9) + q11, como saíram da rede determinística
const q = {
  disciplina: "Matemática", area: "matematica",
  textoBase: "Uma cultura de bactérias segue P(t) = 500 · 2^(t/3).",
  comando: "O tempo para atingir 4000 bactérias é",
  alternativas: { A: "3 horas", B: "6 horas", C: "9 horas", D: "12 horas", E: "V_cone/V_cil" },
  resolucaoComentada: "A população segue o modelo P(t) = 500 · 2^(t/3), em que t é o tempo em horas. Deseja-se P(t) = 4000, logo 500 · 2^(t/3) = 4000, o que dá 2^(t/3) = 8. Como 8 = 2³, tem-se t/3 = 3, ou seja, t = 9 horas.",
  analiseAlternativas: { B: { status: "incorreta", comentario: "Resolve corretamente a equação exponencial 500 · 2^(t/3) = 4000, identificando que 4000/500 = 8." }, C: { status: "correta", comentario: "Certo: raiz de sqrt(9) = 3 e área 5 m2." } },
  fonte: "x^2 nunca muda",
};
console.log("resíduos antes:", JSON.stringify(residuosNotacao(q).map((r: any) => [r.campo, r.achados])));
// Modelo simulado: 1ª tentativa corrige só a resolução; 2ª corrige o resto
let chamadas = 0;
const fake = async (_system: string, user: string, _prazo: number) => {
  chamadas++;
  if (chamadas === 1) return { resumo: "parcial", campos: {
    resolucaoComentada: "A população segue o modelo P(t) = 500 · 2ⁿ, em que n = t/3 e t é o tempo em horas. Deseja-se P(t) = 4000, logo 500 · 2ⁿ = 4000, o que dá 2ⁿ = 8. Como 8 = 2³, tem-se n = 3, ou seja, t/3 = 3 e t = 9 horas.",
    fonte: "TENTATIVA DE MEXER NA FONTE", comando: "não pedido" } };
  return { resumo: "resto", campos: {
    textoBase: "Uma cultura de bactérias segue P(t) = 500 · 2ⁿ, em que n = t/3.",
    "alternativas.E": "V₁/V₂ (cone e cilindro)",
    "analiseAlternativas.B.comentario": "Resolve corretamente a equação exponencial 500 · 2ⁿ = 4000, com n = t/3, identificando que 4000/500 = 8.",
    "analiseAlternativas.C.comentario": "Certo: √9 = 3 e área 5 m²." } };
};
const r = await revisarNotacao(q, "matematica", "Matemática", 60000, fake);
console.log("letras/contexto no user msg:", (await (async()=>{let m="";await revisarNotacao(q,"matematica","Matemática",60000,async(_s:string,u:string)=>{m=u;return {campos:{}};});return m;})()).split("LETRAS JÁ USADAS")[1]);
console.log("linguagens @a_silva → resíduos:", residuosNotacao({textoBase:"Postado por @a_silva e #e_agora"}, "linguagens").length, "| natureza V_cone:", residuosNotacao({textoBase:"V_cone = 3"}, "natureza").length);
console.log(JSON.stringify(r.notacao, null, 1));
console.log("fonte intacta:", r.question.fonte === "x^2 nunca muda", "| comando intacto:", r.question.comando === q.comando);
console.log("C:", r.question.analiseAlternativas.C.comentario);
console.log("resíduos depois:", residuosNotacao(r.question).length, "| chamadas:", chamadas);
// idempotência / sem resíduo → nenhuma chamada
let c2 = 0; const r2 = await revisarNotacao(r.question, "matematica", "Matemática", 60000, async () => { c2++; return { campos: {} }; });
console.log("sem resíduo → chamadas:", c2, "tentativas:", r2.notacao.tentativas);
// modelo que piora (introduz ^) é rejeitado
const r3 = await revisarNotacao(q, "matematica", "Matemática", 60000, async () => ({ campos: { resolucaoComentada: "x^2 e y^3 e z^4 e w^5 e a_b_c" } }));
console.log("rejeitados:", JSON.stringify(r3.notacao.rejeitados), "| resíduos depois:", r3.notacao.residuosDepois.length, "| resolução intacta:", r3.question.resolucaoComentada === q.resolucaoComentada);
// sem tempo → interrompido
const r4 = await revisarNotacao(q, "matematica", "Matemática", 5000, fake);
console.log("sem tempo:", r4.notacao.interrompido);
