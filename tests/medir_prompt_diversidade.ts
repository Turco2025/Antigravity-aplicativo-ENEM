// v17/v73 — Medição do prompt do USUÁRIO (a parte não cacheada) por questão, numa leva de
// 20 de Matemática SEM tema, na ordem real de geração (1 sozinha, depois ondas de 5), com os
// temas reais da leva 538678f0. Compara o backend indicado (pasta com index.ts) usando o
// formato antigo (v72: só eixo + assuntos já usados) e o novo (v73: eixo + subtópico +
// domínio, assuntos só do mesmo eixo).
//
// Resultado medido em 14/09/2026 (index.ts v73 contra o v72 do commit 8328e33c):
//   v72: 72.840 caracteres na leva (média 3.642/questão)
//   v73: 61.905 caracteres na leva (média 3.095/questão)  → 15% MENOR
//   leva de 5: v72 ≈ 14.381 · v73 ≈ 13.309 (7% menor); leva de 2: 5.452 · 5.344; leva de 1: igual.
//
// Uso (a pasta precisa ter index.ts com os imports do GitHub trocados por "./" e
// `(globalThis as any).__bup = buildUserPrompt;` no fim — ver README):
//   SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=k ANTHROPIC_API_KEY=k OPENAI_API_KEY=k \
//   deno run --allow-env --allow-read --allow-net=127.0.0.1 tests/medir_prompt_diversidade.ts <pasta> [v72|v73]
const dir = Deno.args[0];
const modo = Deno.args[1] || (dir.endsWith("gqcheck") ? "v73" : "v72");
const fx = JSON.parse(await Deno.readTextFile(new URL("./fixtures/leva_538678f0.json", import.meta.url)));
(Deno as any).serve = (_h: any) => {};
await import(`${dir}/index.ts`);
const bup = (globalThis as any).__bup;
const qs = fx.questoes;
const eixos = qs.map((q: any) => q.eixo);
// subtópicos/domínios simulados (v73) — rodízio determinístico
const SUB: Record<string, string[]> = {
  "Conhecimentos numéricos": ["operações em conjuntos numéricos (naturais, inteiros, racionais e reais)", "desigualdades", "divisibilidade", "fatoração", "razões e proporções", "porcentagem e juros", "relações de dependência entre grandezas", "sequências e progressões", "princípios de contagem"],
  "Conhecimentos geométricos": ["características das figuras geométricas planas e espaciais", "grandezas, unidades de medida e escalas", "comprimentos, áreas e volumes", "ângulos", "posições de retas"],
  "Conhecimentos de estatística e probabilidade": ["representação e análise de dados", "medidas de tendência central (médias, moda e mediana)", "desvios e variância", "noções de probabilidade"],
  "Conhecimentos algébricos": ["gráficos e funções", "funções algébricas do 1.º e do 2.º graus", "funções polinomiais e racionais", "funções exponenciais e logarítmicas"],
  "Conhecimentos algébricos/geométricos": ["plano cartesiano", "retas", "circunferências", "paralelismo e perpendicularidade", "sistemas de equações"],
};
const DOMS = ["transporte e logística de cargas","agricultura familiar e cooperativas rurais","marcenaria e fabricação de móveis","indústria de componentes eletrônicos","arquitetura de interiores e revestimentos","saúde pública e vacinação","hospital e exames médicos","laboratório de microbiologia","atletismo e treinos esportivos","futebol e estádios","música, bandas e shows","cinema e plataformas de streaming","comércio varejista e promoções","consumo de energia elétrica residencial","energia solar fotovoltaica","reciclagem e gestão de resíduos","clima e meteorologia","astronomia e exploração espacial","culinária e alimentação","indústria têxtil e confecção","turismo e hotelaria","museus e patrimônio cultural","construção civil","finanças pessoais e crédito","telecomunicações e internet","pesquisas de opinião e eleições","demografia e censo","mineração e metalurgia","pesca e aquicultura","jogos de tabuleiro e sorteios","trânsito e segurança viária","escola e vida estudantil","saneamento e abastecimento de água","aviação e aeroportos","ferrovias e metrô","farmácia e medicamentos","cartografia e mapas","fotografia e impressão","teatro e dança","livros, editoras e bibliotecas"];
const cont: Record<string, number> = {};
const subs = eixos.map((e: string) => { const l = SUB[e]; const i = cont[e] || 0; cont[e] = i + 1; return l[i % l.length]; });
const novo = modo === "v73";
let total = 0; const porQ: number[] = [];
for (let i = 0; i < 20; i++) {
  // entregues antes desta questão: q1 conhece 0; onda k (5 por onda) conhece 1 + 5*(k-1)
  const conhecidas = i === 0 ? 0 : 1 + 5 * Math.floor((i - 1) / 5);
  const outras = qs.filter((_: any, j: number) => j !== i);
  let temasEvitar: string[];
  if (novo) {
    // v17: só temas entregues do MESMO eixo, itens de 120
    temasEvitar = qs.filter((q: any, j: number) => j !== i && j < conhecidas && q.eixo === eixos[i]).map((q: any) => q.tema.slice(0, 120));
  } else {
    temasEvitar = qs.filter((_q: any, j: number) => j !== i && j < conhecidas).map((q: any) => q.tema.slice(0, 200)).slice(0, 30);
  }
  const opts: any = { area: "matematica", disciplina: "Matemática", tema: "", dificuldade: "Médio", recurso: "nenhum", competenciaNum: null, habilidadeCod: null, gabaritoAlvo: "C", eixoTematico: eixos[i], temasEvitar, recorte: "" };
  if (novo) opts.diversidade = { subtopico: subs[i], dominioContexto: DOMS[i], dominioAlternativo: DOMS[20 + i], dominiosEvitar: [], contextosEvitar: [] };
  const p = bup(opts);
  porQ.push(p.length); total += p.length;
}
console.log(JSON.stringify({ versao: novo ? "v73" : "v72", totalChars: total, mediaChars: Math.round(total / 20), porQuestao: porQ }));
