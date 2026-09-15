import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
/* Os dados pedagógicos (Matriz de Referência, contexto por área, modelo universal
   e objetos de conhecimento) vivem no repositório e entram no pacote no momento da
   implantação — não são copiados à mão para dentro da função. O conteúdo é embutido
   pelo empacotador do Deno na hora do deploy, então em produção não há nenhuma
   chamada de rede ao GitHub: o que roda é uma cópia congelada. A conferência de
   integridade (GET ?selftest=1) diz exatamente qual cópia foi carregada. */
import APP_DATA_JSON from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/app_data.json" with { type: "json" };
const APP_DATA: any = APP_DATA_JSON;
/* v63: os textos fixos dos prompts (notação química, protocolo do recurso
   visual e formato de entrega) vivem em recurso_instrucoes.ts, ao lado deste
   arquivo no repositório, e entram no pacote do mesmo jeito que app_data.json:
   embutidos no deploy, sem rede em produção. Conteúdo idêntico ao da v62. */
import { NOTACAO_QUIMICA, NOTACAO_MATEMATICA, RECURSO_INSTRUCOES, COMPLEMENTO_BIOLOGIA, instrucoesImagem, ehBiologia, JSON_SCHEMA_TXT } from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/recurso_instrucoes.ts";
/* v70: rede de segurança da notação química (índices e cargas em subscrito/
   sobrescrito, lista fechada) vive em notacao_quimica.ts, ao lado deste
   arquivo no repositório, e entra no pacote como recurso_instrucoes.ts:
   embutida no deploy, sem rede em produção. Ver o cabeçalho daquele arquivo. */
import { normalizarNotacaoTexto, normalizarNotacaoQuimica, normalizarNotacaoVisual, qnTabela, qnConverteIon, QN_FORMULAS_COMUNS, QN_FORMULAS_DISCIPLINA, QN_GASES, QN_GASES_SEMPRE, QN_IONS } from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/notacao_quimica.ts";
/* v71: rede de segurança da notação MATEMÁTICA (expoentes, índices, × e ·),
   em notacao_matematica.ts — o mesmo JavaScript que roda no app, com os mesmos
   casos de teste. Roda em TODAS as áreas, depois da química. Caso real que a
   motivou: 13/09/2026, 6 de 20 questões de Matemática com Q0, 2^4, 10^9,
   "4,6 x 10^9" — porque nenhuma regra de notação chegava a Matemática. */
import { normalizarNotacaoMatematica, nmNormalizaTexto, nmAudita } from "https://raw.githubusercontent.com/Turco2025/Enem/main/supabase/functions/generate-question/notacao_matematica.ts";


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Chave da Anthropic (Claude), guardada em segurança do lado do servidor —
// nunca é exposta ao navegador nem a quem chama esta função.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
/* MODELO FIXO EM "claude-sonnet-5" PARA TODA E QUALQUER CHAMADA DESTA FUNÇÃO.
   Isto é intencional e definitivo: por decisão de custo, o professor exige
   EXCLUSIVAMENTE o Claude Sonnet 5 — nunca Claude Sonnet 4.6 nem qualquer
   outro modelo — mesmo que isso signifique abrir mão de capacidade do 4.6.
   A variável de ambiente ANTHROPIC_MODEL NÃO é mais lida: mesmo que ela
   exista nos secrets deste projeto Supabase com outro valor (por exemplo
   apontando para Sonnet 4.6), esse valor é ignorado de propósito, para que
   nenhuma configuração externa consiga trocar o modelo sem editar este
   arquivo. Para usar outro modelo no futuro, o pedido tem que ser explícito
   e o valor tem que ser trocado aqui, nunca por env var, header ou parâmetro
   de request. */
const MODEL = "claude-sonnet-5";
// SEM TETO DIÁRIO (decisão do professor): ausente, 0 ou negativo = ilimitado.
// Para reativar um limite depois, basta definir MAX_DAILY_QUESTIONS com um número
// positivo nos secrets do projeto Supabase — não é preciso reimplantar a função.
const MAX_DAILY_QUESTIONS = Number(Deno.env.get("MAX_DAILY_QUESTIONS") || "0");

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Matriz de Referência oficial do ENEM (competências/habilidades por área),
// contexto pedagógico por área e o "modelo universal" de elaboração de itens —
// é o mesmo conteúdo usado pelo app cliente (Gerador Inteligente de Simulados ENEM).


const AREA_LABELS: Record<string, string> = {
  linguagens: "Linguagens, Códigos e suas Tecnologias",
  humanas: "Ciências Humanas e suas Tecnologias",
  natureza: "Ciências da Natureza e suas Tecnologias",
  matematica: "Matemática e suas Tecnologias",
};

// Disciplinas em que o texto-suporte tipicamente se apoia em autores, obras, pesquisas
// ou registros históricos/culturais reais — nestas disciplinas é proibido "inventar"
// autores/textos/estudos que não existem; o modelo deve usar apenas fontes reais e,
// em caso de dúvida, pesquisar na internet antes de escrever a questão (ver
// buildUserPrompt). Comparação por substring, em minúsculas,
// para cobrir variações do rótulo (ex.: "Língua Estrangeira (Inglês/Espanhol)").
const DISCIPLINAS_FONTES_REAIS_OBRIGATORIAS = [
  "literatura", "língua portuguesa", "artes", "língua estrangeira",
  "história", "geografia", "filosofia", "sociologia", "biologia",
];
function precisaFontesReais(disciplina: string): boolean {
  const d = (disciplina || "").toLowerCase();
  return DISCIPLINAS_FONTES_REAIS_OBRIGATORIAS.some((alvo) => d.includes(alvo));
}

const CALIBRACAO_EXTENSAO: Record<string, { n: number; texto: [number, number, number]; comando: [number, number, number]; item: [number, number, number] }> = {
  "Língua Portuguesa": { n: 213, texto: [608, 1201, 902], comando: [82, 180, 138], item: [44, 70, 58] },
  "Literatura": { n: 105, texto: [608, 1122, 868], comando: [82, 164, 118], item: [45, 67, 57] },
  "Artes": { n: 50, texto: [384, 798, 610], comando: [107, 189, 143], item: [48, 70, 61] },
  "Educação Física": { n: 32, texto: [799, 1134, 962], comando: [83, 128, 106], item: [35, 73, 59] },
  "Língua Estrangeira (Inglês/Espanhol)": { n: 100, texto: [409, 1073, 761], comando: [77, 179, 129], item: [37, 60, 50] },
  "História": { n: 132, texto: [469, 757, 620], comando: [84, 130, 104], item: [33, 53, 45] },
  "Geografia": { n: 152, texto: [398, 737, 554], comando: [76, 126, 101], item: [29, 43, 37] },
  "Filosofia": { n: 80, texto: [477, 671, 596], comando: [78, 118, 95], item: [31, 51, 41] },
  "Sociologia": { n: 86, texto: [497, 780, 625], comando: [76, 123, 107], item: [28, 49, 40] },
  "Biologia": { n: 163, texto: [374, 634, 527], comando: [41, 102, 93], item: [13, 49, 34] },
  "Física": { n: 154, texto: [476, 805, 648], comando: [47, 122, 109], item: [5, 40, 25] },
  "Química": { n: 133, texto: [483, 780, 641], comando: [56, 110, 104], item: [7, 41, 26] },
  "Matemática": { n: 450, texto: [420, 725, 586], comando: [47, 134, 142], item: [3, 10, 9] },
};

function findCalibracaoKey(disciplina: string): string | null {
  const alvo = (disciplina || "").trim().toLowerCase();
  if (!alvo) return null;
  for (const key of Object.keys(CALIBRACAO_EXTENSAO)) {
    if (key.toLowerCase() === alvo) return key;
  }
  for (const key of Object.keys(CALIBRACAO_EXTENSAO)) {
    const k = key.toLowerCase();
    if (alvo.includes(k) || k.includes(alvo)) return key;
  }
  if (alvo.includes("tecnologia") && alvo.includes("informa")) return "Língua Portuguesa";
  return null;
}

function buildCalibracaoExtensao(disciplina: string): string {
  const key = findCalibracaoKey(disciplina);
  if (!key) return "";
  const cal = CALIBRACAO_EXTENSAO[key];
  const [tP25, tP75, tMean] = cal.texto;
  const [cP25, cP75, cMean] = cal.comando;
  const [iP25, iP75, iMean] = cal.item;
  return `

📏 CALIBRAÇÃO DE EXTENSÃO (baseada na contagem real de caracteres de ${cal.n} questões de "${key}" nas provas do ENEM 2015-2025):
- Texto-suporte (campo "textoBase"): mire em torno de ${tMean} caracteres; a maioria das questões reais desta disciplina fica entre ${tP25} e ${tP75} caracteres.
- Comando (campo "comando"): mire em torno de ${cMean} caracteres; faixa típica real: ${cP25}–${cP75} caracteres.
- Cada alternativa (A-E): mire em torno de ${iMean} caracteres cada; faixa típica real: ${iP25}–${iP75} caracteres (alternativas numéricas curtas são normais quando ${iMean} for baixo).
Trate estes números como META DE REFERÊNCIA, não como contagem rígida obrigatória: o objetivo é que a questão gerada "pareça" uma questão real do ENEM em tamanho — nem artificialmente mais curta nem mais longa que o padrão histórico desta disciplina. Pequena variação em torno da meta é normal e aceitável; o que deve ser evitado é uma questão sistematicamente muito mais longa ou muito mais curta que a média real acima.`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/* ---------------- Prompt building (porta fiel da lógica do app cliente) ---------------- */

// Objetos de conhecimento oficiais (Anexo da Matriz de Referência do ENEM), por área.
// Vão no PROMPT DO SISTEMA — e não no prompt do usuário — para que tanto a chamada de
// geração quanto a de revisão enxerguem a mesma lista: o revisor precisa dela para
// conferir se o objeto declarado pela questão existe de fato na Matriz.
function buildObjetosConhecimento(area: string): string {
  const lista = APP_DATA.objetosConhecimento ? APP_DATA.objetosConhecimento[area] : null;
  if (!Array.isArray(lista) || lista.length === 0) return "";
  const itens = lista.map((o: string, i: number) => `${i + 1}. ${o}`).join("\n");
  return `\n\n📚 OBJETOS DE CONHECIMENTO OFICIAIS DESTA ÁREA (Anexo da Matriz de Referência do ENEM) — a questão DEVE declarar exatamente UM deles, no campo "objetoConhecimento", escolhido por ser o recorte de conteúdo que ela efetivamente mobiliza (não por afinidade temática de superfície). Copie literalmente, no campo "objetoConhecimento", um dos títulos da lista abaixo — sem abreviar, parafrasear ou combinar dois deles. É PROIBIDO declarar um objeto de conhecimento que não esteja nesta lista:\n${itens}`;
}

/* v71 — NOTAÇÃO EM TODAS AS ÁREAS, por decisão do professor (13/09/2026).
   Até a v70 o bloco químico só entrava em Ciências da Natureza e Matemática
   não recebia regra NENHUMA de notação — resultado: Q0, 2^4, 10^9, "4,6 x
   10^9" em 6 de 20 questões. Agora os dois blocos (química e matemática)
   entram em todas as áreas: Geografia escreve CO₂ e km², Física escreve v₀ e
   m/s², Matemática escreve 10⁻³ e Q₀. Custo: ~2 mil tokens a mais no prompt
   do sistema, que fica em cache — na ordem de US$ 0,0005 por questão. */
function blocoNotacao() {
  return NOTACAO_QUIMICA + "\n" + NOTACAO_MATEMATICA;
}
function buildSystemPrompt(area: string) {
  return APP_DATA.universalModel + "\n\n" + APP_DATA.areaContext[area] + buildObjetosConhecimento(area) + blocoNotacao();
}

/* v69 — PROMPT DE SISTEMA ENXUTO PARA REFAZER SÓ O RECURSO VISUAL.
   O botão "Refazer imagem" e o refazer automático (garantirVisual) usavam
   buildSystemPrompt(area) — o modelo pedagógico completo (26,5 mil
   caracteres), que serve para ESCREVER questões — só para reespecificar
   uma imagem. Medido em 10/09/2026: um clique custava US$ 0,097 (entrada
   11 mil tokens + gravação de cache de 12,5 mil). Aqui vai só o que a
   imagem precisa: papel, contexto da área e, em Ciências da Natureza, a
   notação química (rótulos podem ter fórmulas). O protocolo de imagem
   continua indo na mensagem (buildVisualRedoPrompt). */
function buildSystemVisual(area: string) {
  const notacao = "\n\n" + blocoNotacao();   // v71: todas as áreas (rótulos podem ter fórmulas e expoentes)
  return `Você é um elaborador de itens do ENEM (Inep), especialista em recursos visuais de questões: sua tarefa nesta chamada é produzir SOMENTE a especificação do recurso visual (imagem, gráfico ou tabela) de uma questão já escrita, seguindo à risca o protocolo e o formato indicados na mensagem do usuário. Não reescreva, não corrija e não comente a questão.\n\nÁrea: ${AREA_LABELS[area]}.\n\n${APP_DATA.areaContext[area]}${notacao}`;
}

function findCompetencia(area: string, numero: number) {
  const m = APP_DATA.matriz[area];
  if (!m) return null;
  return m.competencias.find((c: any) => c.numero === numero) || null;
}

function findHabilidade(area: string, codigo: string) {
  const m = APP_DATA.matriz[area];
  if (!m) return null;
  for (const c of m.competencias) {
    const h = c.habilidades.find((h: any) => h.codigo === codigo);
    if (h) return { competencia: c, habilidade: h };
  }
  return null;
}

function buildMatrizInstrucoes(area: string, competenciaNum: number | null, habilidadeCod: string | null) {
  const m = APP_DATA.matriz[area];
  if (habilidadeCod) {
    const found = findHabilidade(area, habilidadeCod);
    if (found) {
      return `A questão DEVE mobilizar exatamente esta competência e habilidade da Matriz de Referência (cite-as literalmente nos campos "competencia" e "habilidade" da resposta):\nCompetência ${found.competencia.numero}: ${found.competencia.texto}\n${found.habilidade.codigo}: ${found.habilidade.texto}`;
    }
  }
  if (competenciaNum) {
    const c = findCompetencia(area, competenciaNum);
    if (c) {
      const habsTxt = c.habilidades.map((h: any) => `${h.codigo}: ${h.texto}`).join("\n");
      return `A questão DEVE pertencer a esta competência de área:\nCompetência ${c.numero}: ${c.texto}\nEscolha, dentre as habilidades abaixo, a que melhor corresponde à operação cognitiva exigida pela questão que você vai elaborar, e cite-a literalmente no campo "habilidade":\n${habsTxt}`;
    }
  }
  const allTxt = m.competencias
    .map((c: any) => `Competência ${c.numero}: ${c.texto}\n` + c.habilidades.map((h: any) => `  ${h.codigo}: ${h.texto}`).join("\n"))
    .join("\n\n");
  return `O professor NÃO especificou competência/habilidade. Analise o tema pedido, a disciplina e o nível de dificuldade, e escolha, dentre TODAS as competências e habilidades oficiais da área abaixo, a única competência e a única habilidade que mais correspondem à operação cognitiva que a questão vai exigir (não apenas ao assunto de superfície). Cite-as literalmente e por completo nos campos "competencia" e "habilidade" da resposta.\n\n${allTxt}`;
}

// Bloco anti-alucinação: injetado apenas para disciplinas em que o texto-suporte
// tipicamente cita autor/obra/pesquisa real (ver DISCIPLINAS_FONTES_REAIS_OBRIGATORIAS).
// Instrui o modelo a nunca inventar autoria e a usar a ferramenta web_search (quando
// disponível na chamada) para verificar qualquer dado do qual não tenha certeza.
function buildRegraFontesReais(disciplina: string): string {
  if (!precisaFontesReais(disciplina)) return "";
  return `

⚠️ REGRA OBRIGATÓRIA — PROIBIDO INVENTAR AUTORES OU TEXTOS: a disciplina "${disciplina}" normalmente exige um texto-suporte apoiado em autor, obra, pesquisa, teoria, evento histórico ou registro cultural real. Você está TERMINANTEMENTE PROIBIDO de inventar, "criar hipóteses de", atribuir erroneamente ou apresentar como real qualquer autor, livro, poema, conto, artigo, quadro, obra de arte, filme, teoria, pesquisador, estudo científico, citação ou fato histórico que não exista de fato. Use SOMENTE autores/obras/estudos reais, verificáveis e reconhecidos, adequados ao nível de ensino médio/ENEM (autores consagrados da literatura em língua portuguesa e estrangeira, documentos e eventos históricos reais, teóricos e obras reais de filosofia/sociologia, pesquisas e pesquisadores reais de biologia, obras de arte reais, etc.).
${ehBiologia(disciplina) ? BUSCA_BIOLOGIA : BUSCA_PADRAO} No campo "textoBase", cite a fonte real (autor, obra, ano) no formato ENEM; é PROIBIDO usar uma citação "verossímil"/fictícia nesta disciplina. Você pode resumir, parafrasear ou adaptar um trecho real do texto (para não reproduzir excertos extensos protegidos por direitos autorais), mas a autoria e a obra citadas devem ser genuínas e o conteúdo do resumo deve corresponder fielmente ao que a obra real de fato trata.`;
}

/* Como usar a busca na web, por disciplina. O texto padrão (Literatura,
   História, Filosofia etc.) incentiva a pesquisa sempre que houver dúvida.
   v69 — em BIOLOGIA a leva real de 10/09/2026 mostrou 6 buscas em 5 das 10
   questões, cada uma custando ≈ US$ 0,04–0,05 (a busca em si, a segunda
   rodada e a gravação do resultado no cache) — quase sempre para confirmar
   conhecimento consolidado (ciclos, anatomia, fisiologia) que não precisa de
   fonte. Em Biologia a busca passa a ser reservada a citação de estudo, dado
   numérico ou publicação específica, no máximo uma vez; sem certeza da
   fonte, o Guia do Inep permite texto-suporte como situação hipotética
   formulada pelo elaborador — sem autor inventado. */
const BUSCA_PADRAO = `Se você tiver QUALQUER dúvida sobre a existência, autoria, título exato, data, conteúdo ou trecho de um texto/autor antes de usá-lo, USE A FERRAMENTA web_search para verificar em fontes confiáveis (sites de universidades, editoras, enciclopédias reconhecidas, artigos científicos/acadêmicos, acervos como Domínio Público, Fundação Biblioteca Nacional, Scielo) antes de escrever a questão — é sempre preferível pesquisar e confirmar a arriscar citar algo inexistente ou incorreto.`;
const BUSCA_BIOLOGIA = `USO DA BUSCA NA WEB EM BIOLOGIA — regra de economia, sem abrir mão da veracidade: pesquise NO MÁXIMO UMA VEZ por questão, e SOMENTE quando for citar um estudo, uma pesquisa, um dado numérico, uma estatística ou uma publicação ESPECÍFICA cuja existência, autoria ou valor você não tenha certeza. Para conhecimento consolidado de Biologia (ciclos biogeoquímicos, anatomia, fisiologia, ecologia, genética, evolução, ciclos de vida, saúde pública básica) NÃO pesquise: escreva a partir do seu conhecimento. Se você não tiver certeza de uma fonte específica e a busca não for justificada, NÃO invente autor, instituição nem ano: escreva o texto-suporte como situação hipotética formulada pelo elaborador (permitida pelo Guia do Inep), com contexto real e verossímil, e SEM citação de fonte — isso é sempre preferível a uma citação inventada.`;

// Posição do gabarito: o professor reserva, antes de gerar, qual letra é a
// correta em cada questão, de modo que em cada bloco de cinco questões
// consecutivas as cinco letras apareçam uma única vez.
function buildGabaritoAlvo(L: string | null) {
  if (!L) return "";
  return `
⛔ POSIÇÃO OBRIGATÓRIA DO GABARITO — a alternativa correta desta questão DEVE ser a letra ${L}. O campo "gabarito" do JSON tem de vir exatamente "${L}", e a alternativa ${L} tem de ser a única defensável como correta.

Como cumprir sem quebrar nenhuma outra regra:
1. Escreva a correta e os quatro distratores, cada um com o seu erro de raciocínio específico.
2. Distribua-os de modo que a correta caia em ${L} RESPEITANDO a ordem lógica exigida pelo Guia do Inep: numéricas em ordem crescente, as demais da mais curta para a mais longa. Se a ordem lógica empurrar a correta para outra posição, REESCREVA os valores ou a redação dos distratores (nunca a correta) até que ordem lógica e posição ${L} coincidam.
3. NUNCA troque as alternativas de lugar no fim: uma lista de números fora de ordem crescente denuncia a manipulação.
4. A correta em ${L} continua não podendo ser mais longa, mais completa nem mais bem redigida que os distratores (regra 4.4).
5. Se ainda assim for impossível, escolha OUTRO recorte de conteúdo para a questão em vez de entregar o gabarito em posição diferente.

Motivo: gabaritos repetidos em sequência deixam o candidato acertar por padrão, não por domínio da habilidade — e destroem a validade do simulado.
`;
}

/* ANCORAGEM DE ASSUNTO DO RECURSO VISUAL.

   Bug observado: o professor gera um simulado de uma disciplina (ex.: Física,
   com uma questão sobre conversão de energia numa usina hidrelétrica) e, ao
   trocar de disciplina no mesmo formulário (ex.: para Matemática) sem
   perceber, o campo "Instruções opcionais para a criação da imagem" de um
   slot de questão pode continuar preenchido com uma instrução pensada para a
   disciplina anterior (o campo é por questão, digitado livremente pelo
   professor, e nada no formulário o limpa sozinho ao trocar de área). O
   resultado: o texto-base e o comando saem corretos, sobre o novo tema — mas
   o "promptImagem" (que o protocolo de imagem instrui a seguir a instrução do
   professor "com prioridade") pode obedecer à instrução deixada para trás e
   desenhar um cenário de outra disciplina inteira.

   Este bloco é a rede de segurança do lado do modelo: repete a disciplina e o
   tema desta questão especificamente ENTRE a especificação técnica da imagem
   e a instrução opcional do professor — a posição importa, porque um prompt
   desta extensão (o protocolo de imagem sozinho passa de 5 mil caracteres)
   corre risco real de "diluir" a atenção do modelo ao tema original de tanto
   texto no meio — e manda explicitamente IGNORAR qualquer parte da instrução
   que descreva um assunto incompatível com a disciplina/tema atuais, em vez
   de tentar obedecer os dois pedidos ao mesmo tempo. (A correção definitiva —
   limpar esse campo no formulário ao trocar de disciplina — já foi feita no
   app cliente; isto aqui é a segunda camada, para o caso de uma instrução
   antiga chegar ao backend por qualquer outro caminho.) */
function buildAncoragemVisual(area: string, disciplina: string, tema: string, recurso: string): string {
  if (recurso === "nenhum") return "";
  const temaTxt = tema || "(o tema que você mesmo escolheu para esta questão, definido acima)";
  return `
🔒 ANCORAGEM DE ASSUNTO DO RECURSO VISUAL — releia com atenção mesmo já tendo lido a disciplina e o tema no início deste prompt: esta questão específica é de ${AREA_LABELS[area]}, disciplina ${disciplina}, sobre "${temaTxt}". ESCREVA O CAMPO "visual" POR ÚLTIMO — só depois de já ter escrito e finalizado "textoBase", "comando", "alternativas", "gabarito" e "resolucaoComentada". A especificação da imagem (campo "promptImagem"/"descricao", ou os dados de gráfico/tabela) tem de ser derivada EXATA e EXCLUSIVAMENTE do cenário, dos objetos, dos personagens e dos valores que você mesmo acabou de escrever nesses campos, para ESTA questão — nunca decidida antes de escrevê-los, nunca o assunto de uma disciplina diferente, nunca um exemplo genérico deste protocolo, e nunca uma instrução deixada para uma questão anterior. Se a "Instrução adicional do professor" logo acima (quando houver) pedir um cenário visivelmente incompatível com "${disciplina}" ou com o tema acima, IGNORE especificamente essa parte incompatível da instrução — nunca mude o assunto da imagem, e nunca invente uma questão diferente só para justificar a instrução.`;
}

/* v63 — DIVERSIDADE TEMÁTICA DENTRO DA LEVA.

   Teste real de 09/09/2026 (10 questões de Biologia com o tema em branco):
   5 das 10 saíram sobre estômatos. Sem tema, cada chamada escolhe o assunto
   sozinha e, como as questões saem em paralelo, uma não sabe da outra. O app
   passa a reservar, para cada questão sem tema, um EIXO (objeto de
   conhecimento oficial da disciplina, distribuído em rodízio) e a enviar os
   ASSUNTOS JÁ USADOS na leva. Este bloco vai no prompt do usuário — a parte
   que varia por questão — e por isso não mexe no cache do sistema. */
/* v73 — DIVERSIDADE DE EXEMPLOS SEM CUSTO (pedido do professor, 14/09/2026).
   Leva real 538678f0 (20 de Matemática, sem tema): "fábrica de componentes
   eletrônicos" com linhas A/B 60%/40% em DUAS questões, "transportadora" em
   três, "cooperativa agrícola" em três, marcenaria e velas na mesma leva.
   O app agora reserva, ANTES da leva e sem chamada nova à IA, um SUBTÓPICO
   oficial dentro do eixo e um DOMÍNIO DE CONTEXTO (principal + alternativo)
   exclusivo de cada questão, e manda os domínios das outras como proibidos.
   Este bloco só transmite essas reservas; nada aqui altera o cache do sistema
   (é prompt do usuário) e o tamanho é parecido com o da lista antiga de
   assuntos, que ficou mais curta (itens de 120 caracteres). */
type DiversidadeExtras = {
  subtopico?: string; dominioContexto?: string; dominioAlternativo?: string;
  dominiosEvitar?: string[]; contextosEvitar?: string[];
};
function buildDiversidadeTematica(eixoTematico: string, temasEvitar: string[], temaDoProfessor: string, recorte = "", extras: DiversidadeExtras = {}): string {
  const partes: string[] = [];
  const subtopico = (extras.subtopico || "").trim();
  const dominio = (extras.dominioContexto || "").trim();
  const dominioAlt = (extras.dominioAlternativo || "").trim();
  const dominiosEvitar = (extras.dominiosEvitar || []).filter((d) => d && d !== dominio && d !== dominioAlt);
  const contextosEvitar = (extras.contextosEvitar || []).filter(Boolean);
  /* v64: com tema digitado pelo professor, a diversidade vem de um RECORTE
     planejado antes da leva (ver planejarRecortes): conteúdo + contexto +
     habilidade próprios desta questão, sempre dentro do tema pedido. */
  if (recorte) {
    partes.push(`🎯 RECORTE RESERVADO PARA ESTA QUESTÃO (diversidade da leva): este simulado tem várias questões sobre o mesmo tema pedido pelo professor, e cada uma recebeu de antemão um recorte próprio, para que a leva cubra o tema em vez de repetir o exemplo mais comum. Esta questão DEVE seguir este recorte — ${recorte} — mantendo-se DENTRO do tema pedido: trate exatamente esse conteúdo, construa o texto-base e a situação-problema sobre esse contexto (não o troque por outro mais frequente) e, quando o recorte indicar uma habilidade, mobilize essa habilidade da Matriz e cite-a nos campos "competencia" e "habilidade". O campo "tema" da sua resposta deve nomear o recorte, não apenas o tema geral.`);
  }
  if (eixoTematico) {
    if (subtopico) {
      partes.push(`🎯 EIXO E SUBTÓPICO RESERVADOS (diversidade da leva): esta questão DEVE mobilizar o objeto de conhecimento oficial "${eixoTematico}" (copie-o em "objetoConhecimento") e tratar exatamente o subtópico "${subtopico}" — não outro item desse objeto. O campo "tema" nomeia o subtópico e o contexto.`);
    } else {
      partes.push(`🎯 EIXO TEMÁTICO RESERVADO PARA ESTA QUESTÃO (diversidade da leva): o professor não detalhou o tema, e este simulado distribui o conteúdo da disciplina entre as questões. Esta questão DEVE mobilizar o objeto de conhecimento oficial "${eixoTematico}" — declare-o literalmente no campo "objetoConhecimento" — e escolher, DENTRO dele, um recorte de conteúdo específico, frequente nas provas do ENEM e diferente dos assuntos listados a seguir (quando houver). Não escolha um assunto de outro objeto de conhecimento.`);
    }
  }
  // Com recorte planejado que traz "contexto: …", o cenário já veio do
  // planejamento (que recebeu os domínios): o bloco de domínio seria redundante
  // — ou contraditório. Ele entra quando não há recorte, quando o recorte veio
  // SEM contexto (o app descarta contextos fora do domínio, repetidos ou do
  // botão "Outro contexto") e depois de uma colisão.
  const recorteTemContexto = /(^|·)\s*contexto:/i.test(recorte);
  if (dominio && (!recorte || !recorteTemContexto || contextosEvitar.length)) {
    partes.push(`🎯 DOMÍNIO DE CONTEXTO RESERVADO (cada questão da leva tem o seu, para a prova não repetir exemplos): ambiente o texto-base e a situação-problema em "${dominio}" — cenário concreto, verossímil e brasileiro desse domínio.${dominioAlt ? ` Se o conteúdo não couber nele com naturalidade, use só o alternativo "${dominioAlt}".` : ""} Os demais domínios pertencem a outras questões.${dominiosEvitar.length ? ` ⛔ NÃO use: ${dominiosEvitar.join("; ")}.` : ""}`);
  }
  if (contextosEvitar.length) {
    partes.push(`⛔ CENÁRIOS JÁ USADOS POR OUTRAS QUESTÕES DESTE SIMULADO — PROIBIDO ambientar esta questão em qualquer um deles, mesmo com outros números ou outra empresa do mesmo ramo: ${contextosEvitar.join("; ")}.`);
  }
  if (temasEvitar.length) {
    const lista = temasEvitar.map((t, i) => `${i + 1}. ${t}`).join("\n");
    partes.push(`⛔ ASSUNTOS JÁ USADOS NESTE SIMULADO — PROIBIDO repetir, reformular ou variar superficialmente qualquer um deles (mesmo fenômeno, mesma estrutura, mesmo processo ou mesmo experimento com outros números NÃO conta como assunto novo):\n${lista}\n${subtopico ? `Fique no subtópico reservado acima, mas com outro exemplo, outra estrutura ou outro contexto, claramente distintos.` : `Escolha um fenômeno, estrutura, processo ou contexto claramente distinto — outro capítulo do conteúdo${temaDoProfessor ? "" : ", ainda que dentro do mesmo eixo temático"}.`} O campo "tema" da sua resposta deve deixar essa diferença evidente.`);
  }
  return partes.length ? `\n${partes.join("\n\n")}\n` : "";
}

/* CUSTO: O QUE É FIXO VAI PARA O CACHE.

   Medido na v60 com o código real: o prompt do USUÁRIO de uma questão com
   imagem tinha ~24 mil caracteres em Matemática e ~36 mil em Biologia —
   maior que o próprio prompt do sistema — e era pago a preço cheio em toda
   questão, porque só o sistema tinha cache_control. Só que quase tudo ali é
   texto idêntico de uma questão para a outra: a regra de fontes reais, a
   calibração de extensão, o protocolo de imagem (8 seções), a lista completa
   de competências da área e o esquema JSON. O que de fato varia cabe em
   poucas linhas: área, disciplina, tema, nível, instrução do professor,
   ancoragem de assunto, letra do gabarito e (quando escolhida) a
   competência/habilidade.

   A partir da v61 o texto fixo viaja em buildBlocoFixo(), como SEGUNDO bloco
   do prompt do sistema, com seu próprio cache_control — o primeiro bloco
   (modelo universal + contexto da área) continua igual e continua cacheado.
   O modelo lê EXATAMENTE as mesmas frases, na mesma ordem relativa entre
   elas; nenhuma instrução foi cortada, resumida ou reescrita. O que muda é
   quem paga: cache lido (US$ 0,20/M) em vez de entrada nova (US$ 2/M).
   O prompt do usuário fica só com o que é desta questão. */
function buildBlocoFixo(opts: {
  area: string; disciplina: string; recurso: string;
  competenciaNum: number | null; habilidadeCod: string | null;
}) {
  // A lista completa da Matriz só é fixa quando o professor NÃO escolheu
  // competência/habilidade; escolhida, o trecho é específico e fica no
  // prompt do usuário (buildUserPrompt), exatamente como antes.
  const matrizFixa = (!opts.competenciaNum && !opts.habilidadeCod)
    ? `\n\n${buildMatrizInstrucoes(opts.area, null, null)}`
    : "";
  return `═══════ INSTRUÇÕES FIXAS DESTA CONFIGURAÇÃO (disciplina ${opts.disciplina}, recurso visual: ${opts.recurso}) ═══════
As instruções abaixo valem para a questão pedida no prompt do usuário e devem ser seguidas integralmente junto com ele.
${buildRegraFontesReais(opts.disciplina)}
${buildCalibracaoExtensao(opts.disciplina)}

${instrucoesImagem(opts.recurso, opts.disciplina)}${matrizFixa}

${JSON_SCHEMA_TXT}`;
}

function buildUserPrompt(opts: {
  area: string; disciplina: string; tema: string; dificuldade: string;
  recurso: string; competenciaNum: number | null; habilidadeCod: string | null;
  instrucoesVisual?: string; gabaritoAlvo?: string | null;
  eixoTematico?: string; temasEvitar?: string[]; recorte?: string;
  diversidade?: DiversidadeExtras;
}) {
  // Trecho específico da Matriz (só quando o professor escolheu
  // competência/habilidade) — o caso "automático" está no bloco fixo.
  const matrizEspecifica = (opts.competenciaNum || opts.habilidadeCod)
    ? `\n\n${buildMatrizInstrucoes(opts.area, opts.competenciaNum, opts.habilidadeCod)}`
    : "";
  return `Elabore UMA questão inédita, original, no padrão ENEM, com os seguintes parâmetros definidos pelo professor:

Área do conhecimento: ${AREA_LABELS[opts.area]}
Disciplina: ${opts.disciplina}
Tema/conteúdo solicitado: ${opts.tema || (opts.eixoTematico ? (opts.diversidade && opts.diversidade.subtopico ? "(o professor não detalhou; siga o eixo e o subtópico reservados para esta questão, indicados abaixo)" : "(o professor não detalhou; siga o eixo reservado para esta questão, indicado abaixo)") : "(o professor não detalhou; escolha um tema representativo da disciplina e do nível de dificuldade pedidos)")}
Nível de dificuldade: ${opts.dificuldade}
Recurso visual pedido: ${opts.recurso}

Siga integralmente as INSTRUÇÕES FIXAS DESTA CONFIGURAÇÃO que estão no prompt do sistema (regra de fontes, calibração de extensão, instruções do recurso visual, Matriz de Referência e formato de entrega) — elas fazem parte deste pedido.
${buildDiversidadeTematica(opts.eixoTematico || "", opts.temasEvitar || [], opts.tema, opts.recorte || "", opts.diversidade || {})}${opts.instrucoesVisual ? `\nInstrução adicional do professor especificamente para o recurso visual (siga-a com prioridade, desde que compatível com as instruções do recurso visual no prompt do sistema e com a ANCORAGEM DE ASSUNTO logo abaixo): ${opts.instrucoesVisual}\n` : ""}
${buildAncoragemVisual(opts.area, opts.disciplina, opts.tema, opts.recurso)}${matrizEspecifica}
${buildGabaritoAlvo(opts.gabaritoAlvo || null)}
Entregue a questão chamando a ferramenta "entregar_questao", no formato descrito no prompt do sistema.`;
}

// Prompt usado quando o professor/aluno pede para refazer SÓ o recurso visual de uma
// questão já pronta (botão "Refazer" na tela) — mantém texto-base, comando, alternativas,
// gabarito e resolução comentada intactos, e pede ao modelo apenas uma nova versão do
// recurso visual, opcionalmente guiada por instruções extras digitadas na hora.
function buildVisualRedoPrompt(opts: {
  tema: string; disciplina: string; recurso: string; textoBase: string; comando: string;
  alternativas: Record<string, string>; gabarito: string; resolucaoComentada: string;
  instrucoesVisual?: string; motivoFaltante?: string;
}) {
  /* v62: quando o recurso visual FALTOU na entrega (ou veio trocado), o pedido
     não é "refazer uma variação" — é produzir, agora, o recurso obrigatório
     que a questão já pressupõe. O texto abaixo diz isso com clareza. */
  const abertura = opts.motivoFaltante
    ? `Você elaborou anteriormente a questão de vestibular abaixo (padrão ENEM), que foi configurada pelo professor com recurso visual OBRIGATÓRIO do tipo ${opts.recurso.toUpperCase()} — mas a entrega veio sem ele (${opts.motivoFaltante}). Produza AGORA o recurso visual (${opts.recurso}) desta questão — mantenha o texto-suporte, o comando, as alternativas, o gabarito e a resolução comentada exatamente como estão; gere apenas o recurso visual, coerente com o restante da questão e com os MESMOS fatos/valores já usados na resolução comentada. O recurso deve ser pedagogicamente necessário para resolver a questão (nunca decorativo): se o texto-suporte já descreve a situação em palavras, a ${opts.recurso === "imagem" ? "imagem" : opts.recurso === "grafico" ? "representação gráfica" : "tabela"} deve mostrar essa mesma situação com os mesmos elementos e valores.`
    : `Você elaborou anteriormente a questão de vestibular abaixo (padrão ENEM). O professor pediu para refazer SOMENTE o recurso visual (${opts.recurso}) desta questão — mantenha o texto-suporte, o comando, as alternativas, o gabarito e a resolução comentada exatamente como estão; gere apenas uma NOVA versão do recurso visual, coerente com o restante da questão e com os MESMOS fatos/valores já usados na resolução comentada, a menos que as instruções do professor abaixo peçam explicitamente para mudar dados.`;
  return `${abertura}

⚠️ REGRA ABSOLUTA DE ASSUNTO: o novo recurso visual tem de retratar EXATAMENTE o mesmo objeto, cenário, disciplina e fenômeno do texto-suporte/comando/resolução comentada abaixo — nunca outro tema, ainda que visualmente parecido (ex.: se a questão é de Matemática sobre um caixa eletrônico, a imagem tem de mostrar um caixa eletrônico, nunca uma cena de física, trânsito ou qualquer outro assunto). Isto vale mesmo que as "Instruções adicionais do professor" abaixo peçam algo incompatível: obedeça só a parte delas que for compatível com o texto-suporte/comando/resolução desta questão, e ignore qualquer pedido de cenário diferente (esse tipo de instrução, quando aparece, normalmente sobrou digitada de uma questão anterior, de outra disciplina). Antes de escrever qualquer seção do "promptImagem" (ou os dados do gráfico/tabela), liste mentalmente de 2 a 4 substantivos concretos que aparecem no texto-suporte/comando/resolução abaixo (ex.: "trapézio", "canteiro de flores", "jardim retangular") — se o cenário que você está prestes a descrever não contiver esses substantivos, ele está errado; recomece a partir do texto-suporte real, não da instrução do professor. Antes de entregar, releia o "promptImagem"/"descricao" (ou os dados do gráfico/tabela) e confirme, item por item, que cada elemento pertence à mesma situação-problema descrita abaixo.

QUESTÃO ATUAL (contexto — não repita nem altere nada disto na sua resposta):
Tema: ${opts.tema}
Texto-suporte: ${opts.textoBase}
Comando: ${opts.comando}
Alternativas: ${JSON.stringify(opts.alternativas)}
Gabarito: ${opts.gabarito}
Resolução comentada: ${opts.resolucaoComentada}

${instrucoesImagem(opts.recurso, opts.disciplina)}
${opts.instrucoesVisual
    ? `\nInstruções adicionais do professor para esta nova versão do recurso visual (siga-as com prioridade): ${opts.instrucoesVisual}\n`
    : opts.motivoFaltante
      ? `\nO recurso visual é o PRIMEIRO desta questão (não há versão anterior a variar): produza-o completo, no formato instruído acima.\n`
      : `\nO professor não deu instruções adicionais desta vez — gere uma variação genuinamente diferente da anterior (ex.: outro tipo de gráfico, outra organização da tabela, outro ângulo/estilo de imagem), mantendo a coerência com a questão.\n`}

Entregue o resultado chamando a ferramenta "entregar_visual", com um único argumento neste formato:
{"visual": <objeto do recurso visual, no formato de "visual" instruído acima>}
Não escreva o JSON no texto da resposta e não escreva nada antes ou depois da chamada da ferramenta.`;
}

/* v64 — PLANEJAMENTO DE RECORTES (várias questões com o mesmo tema).

   Leva real de 09/09/2026 (10 de Física, "Eletricidade – Eletrodinâmica"):
   4 questões sobre associação de resistores e 2 quase iguais sobre
   capacitores. As questões saem em ondas paralelas e, dentro de uma onda,
   uma não sabe da outra; o eixo por objeto de conhecimento (v63) só vale
   com tema em branco. Aqui, UMA chamada curta antes da leva devolve N
   recortes distintos do tema — conteúdo, contexto real e habilidade — e o
   app entrega um recorte a cada questão. Prompt pequeno, sem cache e sem
   busca na web: custa centavos por leva. */
function listaHabilidadesDaArea(area: string): string {
  const m = APP_DATA.matriz[area];
  if (!m) return "";
  return m.competencias
    .map((c: any) => `Competência ${c.numero}: ${c.texto}\n` + c.habilidades.map((h: any) => `  ${h.codigo}: ${h.texto}`).join("\n"))
    .join("\n\n");
}

function buildSystemPlanejamento(area: string): string {
  return `Você é um elaborador de itens do ENEM (Inep) encarregado de PLANEJAR um simulado: antes de qualquer questão ser escrita, você distribui o tema pedido pelo professor em recortes distintos, um por questão, para que a prova cubra o tema em vez de repetir o exemplo mais comum. Você conhece as provas reais do ENEM de 2015 a 2025 e a Matriz de Referência oficial. Você não escreve questões nesta etapa — só o plano.

MATRIZ DE REFERÊNCIA — ${AREA_LABELS[area]} (competências e habilidades oficiais; cite os códigos exatamente como estão aqui):
${listaHabilidadesDaArea(area)}`;
}

function buildPlanejamentoPrompt(opts: { area: string; disciplina: string; tema: string; quantidade: number; dificuldades: string[]; dominios?: (string | null)[]; dominiosAlternativos?: (string | null)[]; temasPorQuestao?: (string | null)[] }): string {
  const niveis = opts.dificuldades.length ? opts.dificuldades.map((d, i) => `${i + 1}: ${d}`).join(", ") : "todas Médio";
  // v74: o app já distribuiu os conteúdos da lista do professor entre as
  // questões (rodízio) — o planejador detalha o recorte DENTRO do conteúdo de
  // cada número, em vez de decidir sozinho qual conteúdo cabe a cada questão.
  const porQuestao = (opts.temasPorQuestao || []).map((t) => String(t || "").replace(/\s+/g, " ").trim());
  const temaLinha = String(opts.tema || "").replace(/\s+/g, " ").trim();
  const comLista = porQuestao.filter(Boolean).length >= 2 && new Set(porQuestao.filter(Boolean).map((t) => t.toLowerCase())).size >= 2;
  // v74.1: no teste real de 15/09/2026 o modelo, com a lista em uma linha só,
  // criou um recorte a mais para o domínio alternativo e deslocou todos os
  // seguintes (7 de 10 fora do conteúdo fixado). A lista agora vai uma por
  // linha, com a regra "um recorte por número" explícita, e cada recorte
  // devolve o seu "numero" — o app confere e realinha pelo conteúdo.
  const aberturaTema = comLista
    ? `O professor pediu um simulado sobre esta lista de conteúdos: "${temaLinha}". O aplicativo JÁ DISTRIBUIU os conteúdos entre as questões — o conteúdo de cada número está FIXADO abaixo e o recorte daquele número tem de ficar DENTRO dele, sem migrar para o conteúdo de outra questão.

CONTEÚDO FIXADO POR QUESTÃO (não altere a ordem, não troque, não acrescente nem remova números):
${porQuestao.map((t, i) => `${i + 1}: ${t || "(qualquer conteúdo da lista)"}`).join("\n")}

Entregue EXATAMENTE ${opts.quantidade} recortes: o recorte de número n é sobre o conteúdo fixado para n e traz o campo "numero" igual a n. Cada número gera UM único recorte — um domínio entre parênteses (abaixo) é só um substituto para o contexto daquele mesmo número, nunca um segundo recorte.`
    : `TODAS as questões são sobre o tema pedido pelo professor: "${opts.tema}".`;
  const conteudoDesc = comLista
    ? `o subtópico ou conceito específico, DENTRO do conteúdo fixado para o número da questão, que ela vai mobilizar. Comece o campo pelo nome do conteúdo exatamente como o professor escreveu, seguido de um travessão e do subtópico (ex.: "MDC — divisão em lotes iguais sem sobra"). Questões com o mesmo conteúdo fixado precisam de subtópicos, contextos e habilidades diferentes entre si.`
    : `o subtópico ou conceito específico, dentro do tema, que a questão vai mobilizar. Os ${opts.quantidade} conteúdos devem ser diferentes entre si; se o tema for estreito e não comportar ${opts.quantidade} conteúdos distintos, repita um conteúdo apenas quando o contexto e a habilidade forem claramente diferentes.`;
  // v73: domínios de contexto reservados pelo app (um por questão, exclusivos),
  // com um alternativo para quando conteúdo e domínio não casam.
  const alts = opts.dominiosAlternativos || [];
  const doms = (opts.dominios || []).map((d, i) => d ? `${i + 1}: ${d}${alts[i] ? ` (ou ${alts[i]})` : ""}` : "").filter(Boolean);
  const blocoDominios = doms.length
    ? `\n\nDOMÍNIOS DE CONTEXTO RESERVADOS (um por recorte, na ordem das questões): o "contexto" de cada recorte DEVE se passar dentro do domínio indicado para o seu número — um cenário concreto e verossímil desse domínio, nomeando-o — e nunca no domínio de outro recorte. Quando houver um domínio entre parênteses, é o alternativo: use-o só se o conteúdo não couber com naturalidade no principal. Domínios: ${doms.join("; ")}.`
    : "";
  return `Planeje ${opts.quantidade} recortes DISTINTOS para um simulado de ${AREA_LABELS[opts.area]}, disciplina ${opts.disciplina}. ${aberturaTema} Nível de dificuldade pedido por questão: ${niveis}.

Cada recorte é o plano de UMA questão e tem três partes:
- "conteudo": ${conteudoDesc}
- "contexto": a situação-problema concreta e real em que a questão vai se apoiar — do cotidiano, do trabalho, da ciência, da tecnologia, do ambiente ou da sociedade brasileira, no espírito das provas reais do ENEM 2015-2025. Uma ou duas frases curtas, até 200 caracteres: só o cenário e o que se pede (os números e detalhes ficam para a questão). Os ${opts.quantidade} contextos devem ser TODOS diferentes: nunca o mesmo aparelho, objeto, cenário ou experimento em dois recortes.
- "habilidade": o código e o texto de UMA habilidade da Matriz (lista no prompt do sistema) que a questão vai exigir. Varie as habilidades ao longo da lista (cálculo, leitura de gráfico/tabela/esquema, comparação de procedimentos, análise de impacto social ou ambiental, etc.), sem concentrar todas na mesma; a habilidade deve corresponder à operação cognitiva do recorte, não só ao assunto.

Regras: fique DENTRO do tema pedido${comLista ? " e, em cada número, DENTRO do conteúdo fixado para ele" : ""} (nunca migre para outro tema da disciplina); prefira recortes frequentes nas provas reais${comLista ? " (a ordem das questões já está fixada pelos conteúdos acima)" : ", ordenados do mais frequente ao menos frequente"}; recortes de nível "Fácil" pedem contextos diretos e uma etapa de raciocínio, "Difícil" pedem combinar informações ou uma armadilha conceitual fina; escreva em português, de forma específica (nada de "aplicações no cotidiano" — diga qual).${blocoDominios} Entregue chamando a ferramenta "entregar_recortes", com exatamente ${opts.quantidade} itens, na ordem das questões.`;
}

const FERRAMENTA_RECORTES = {
  name: "entregar_recortes",
  description: "Entrega o plano de recortes do simulado. Use SEMPRE esta ferramenta — nunca escreva o JSON no texto da resposta.",
  input_schema: {
    type: "object",
    properties: {
      recortes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            numero: { type: "integer", description: "Número da questão a que este recorte pertence (1 = primeira), na ordem pedida. Obrigatório quando houver conteúdo fixado por questão." },
            conteudo: { type: "string", description: "Subtópico/conceito específico dentro do tema (com conteúdo fixado por questão: comece pelo nome do conteúdo como o professor escreveu)." },
            contexto: { type: "string", description: "Situação-problema concreta e real, em até 200 caracteres, diferente das demais e, quando houver domínio reservado para este índice, dentro dele (nomeando o domínio)." },
            habilidade: { type: "string", description: "Código e texto de uma habilidade da Matriz (ex.: \"H21: ...\")." },
          },
          required: ["conteudo", "contexto", "habilidade"],
        },
      },
    },
    required: ["recortes"],
  },
};

/* v65 — leitura tolerante do plano. Na primeira leva real (09/09/2026,
   15:10) o planejamento voltou 502 "sem recortes utilizáveis": o modelo
   chamou a ferramenta, mas não exatamente no formato pedido (a API não
   valida o schema da ferramenta à risca). Aqui a resposta é aceita em
   qualquer destas formas: lista no campo "recortes"; lista dentro de uma
   string JSON; objeto numerado {"1": {...}, "2": {...}}; lista em outro
   campo qualquer do argumento; e chaves com acento/maiúsculas ("Conteúdo",
   "Contexto", "Habilidade"). O que não for lido fica registrado no log
   (forma da resposta), para que a próxima falha tenha diagnóstico. */
function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
function campoDoRecorte(r: Record<string, unknown>, nome: string): string {
  const direto = r[nome];
  if (typeof direto === "string" && direto.trim()) return direto.trim();
  for (const k of Object.keys(r)) {
    if (semAcento(k).startsWith(nome)) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object") { const txt = textoDeEspecificacao(v); if (txt) return txt; }
    }
  }
  return "";
}
function listaDeRecortes(data: unknown): unknown[] {
  let bruto: any = data && typeof data === "object" && !Array.isArray(data) ? (data as any).recortes : data;
  if (bruto == null && data && typeof data === "object" && !Array.isArray(data)) {
    // o modelo pode ter usado outro nome de campo: pega a primeira lista que houver
    for (const v of Object.values(data as Record<string, unknown>)) { if (Array.isArray(v)) { bruto = v; break; } }
    if (bruto == null) bruto = data;
  }
  if (typeof bruto === "string") { try { bruto = JSON.parse(bruto); } catch { return []; } }
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    if (Array.isArray((bruto as any).recortes)) return (bruto as any).recortes;
    const valores = Object.values(bruto as Record<string, unknown>);
    return valores.every((v) => v && typeof v === "object") ? valores : [];
  }
  return Array.isArray(bruto) ? bruto : [];
}
type Recorte = { conteudo: string; contexto: string; habilidade: string; numero?: number };
/* v74.2: corte sem interromper palavra ou frase. Até a v74.1 o contexto era cortado
   em 250 caracteres onde caísse ("…considerando também uma situação em qu") e o
   fragmento ia assim para o prompt da questão. Agora o prompt pede contextos de até
   200 caracteres e, se ainda assim passar do limite, fica até o último fim de frase
   depois da metade do limite — ou, sem fim de frase, até o último espaço. */
function cortaLimpo(texto: string, max: number): string {
  const t = texto.trim();
  if (t.length <= max) return t;
  const base = t.slice(0, max);
  let corte = -1;
  // Fim de frase = pontuação seguida de espaço NO TEXTO ORIGINAL (não na fatia):
  // "3.400 sacas" cortado logo depois do ponto de milhar não é fim de frase.
  for (const m of base.matchAll(/[.;!?]/g)) { const i = m.index ?? -1; if (i + 1 >= max / 2 && /\s/.test(t[i + 1] ?? " ")) corte = i + 1; }
  if (corte > 0) return base.slice(0, corte).trim();
  const esp = base.lastIndexOf(" ");
  return (esp > max / 2 ? base.slice(0, esp) : base).replace(/[\s,;:(\u2013\u2014-]+$/, "").trim();
}
function normalizarRecortes(bruto: unknown, quantidade: number): Recorte[] {
  const lista = listaDeRecortes(bruto);
  const saida: Recorte[] = [];
  for (const r of lista) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const conteudo = campoDoRecorte(obj, "conteudo").slice(0, 200);
    const contexto = cortaLimpo(campoDoRecorte(obj, "contexto"), 320);
    const habilidade = campoDoRecorte(obj, "habilidade").slice(0, 200);
    if (!conteudo && !contexto) continue;
    // v74.1: número da questão declarado pelo modelo (só inteiros 1..quantidade).
    const nRaw = typeof obj.numero === "number" ? obj.numero : Number(campoDoRecorte(obj, "numero") || NaN);
    const item: Recorte = { conteudo, contexto, habilidade };
    if (Number.isInteger(nRaw) && nRaw >= 1 && nRaw <= quantidade) item.numero = nRaw;
    saida.push(item);
    // v74.1: até 2 recortes a mais são devolvidos (o modelo às vezes cria um
    // extra e desloca os seguintes); o app casa cada recorte com a sua questão.
    if (saida.length >= quantidade + 2) break;
  }
  return saida;
}

/* ---------------- Claude API (server-side) ---------------- */

// Códigos de erro transitórios (sobrecarga momentânea, timeout de proxy/CDN entre
// nós de rede e a Anthropic, etc.) — vale a pena tentar de novo automaticamente.
// 524 é o "A timeout occurred" da Cloudflare: acontece quando a resposta da
// Anthropic demora demais para ser entregue por completo, algo que fica bem mais
// provável quando várias questões são geradas ao mesmo tempo (mais carga = respostas
// mais lentas). 429/500/502/503/529 também são transitórios e merecem nova tentativa.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 522, 523, 524, 529]);
const MAX_ATTEMPTS = 4;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Espera exponencial com jitter entre tentativas (0.8s, 1.6s, 3.2s... + até 400ms
// aleatórios) para não martelar a API da Anthropic logo em seguida de uma falha.
function backoffDelay(attempt: number) {
  return Math.min(800 * 2 ** (attempt - 1), 8000) + Math.random() * 400;
}

type SistemaPrompt = string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;

async function callClaude(system: SistemaPrompt, userMsg: string, maxTokens: number, enableWebSearch: false | { type: string; name: string; max_uses: number } = false, ferramenta: any = null): Promise<{ text: string; truncated: boolean; usage: any; ferramentaJSON: string }> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(), 240_000);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          /* CACHE DE PROMPT. O prompt do sistema (modelo universal + contexto da
             área + objetos de conhecimento + notação química) passa de 25 mil
             caracteres e é IDÊNTICO em todas as questões da mesma área — e ainda
             se repete na chamada de revisão. Marcado assim, a Anthropic guarda o
             processamento dele por alguns minutos: da segunda chamada em diante
             ele é lido do cache, a uma fração do preço e sem ser reprocessado.
             A resposta devolve os números de cache no campo "uso", para que dê
             para conferir que está valendo em vez de supor. */
          /* Na v61 o sistema pode vir como LISTA de blocos, cada um com seu
             cache_control (até 4 pontos de cache por chamada): bloco 1 = modelo
             universal + contexto da área; bloco 2 = instruções fixas desta
             configuração (ver buildBlocoFixo). Uma string simples continua
             aceita e vira um bloco único, como sempre foi. */
          system: Array.isArray(system) ? system : [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userMsg }],
          thinking: { type: "disabled" },
          /* EFFORT FIXO EM "medium" PARA TODA E QUALQUER CHAMADA AO SONNET 5.
             Isto é intencional e definitivo: não deve variar por disciplina,
             por tipo de chamada (rascunho, revisão de matemática, refazer
             visual) nem por qualquer outra condição. Não tornar configurável
             por env var, header, ou parâmetro de request — o pedido foi para
             fixar em "medium" sempre, sem hipótese de subir nem descer. */
          output_config: { effort: "medium" },
          stream: true,
          ...(() => {
            const tools = [
              ...(enableWebSearch ? [enableWebSearch] : []),
              ...(ferramenta ? [ferramenta] : []),
            ];
            if (!tools.length) return {};
            /* Sem busca na web, a entrega pela ferramenta é obrigatória — não há
               por que deixar espaço para prosa. Com busca ligada, a escolha fica
               automática: o modelo precisa poder pesquisar ANTES de entregar. */
            const tool_choice = ferramenta && !enableWebSearch
              ? { type: "tool", name: ferramenta.name }
              : { type: "auto" };
            return { tools, tool_choice };
          })(),
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const rawErr = await resp.text().catch(() => "");
        if (RETRYABLE_STATUS.has(resp.status) && attempt < MAX_ATTEMPTS) {
          lastErr = new Error(`HTTP ${resp.status}`);
          clearTimeout(watchdog);
          await sleep(backoffDelay(attempt));
          continue;
        }
        let msg = "";
        try { const j = rawErr ? JSON.parse(rawErr) : {}; msg = j?.error?.message || ""; } catch { /* corpo não é JSON */ }
        if (!msg) msg = rawErr ? rawErr.slice(0, 300) : `Erro HTTP ${resp.status} ${resp.statusText || ""}`.trim();
        if (resp.status === 401) {
          msg = `Chave de API da Anthropic inválida ou expirada (401) nos secrets deste projeto Supabase. Detalhe: ${msg}`;
        }
        if (resp.status === 524) {
          msg = `A Anthropic demorou demais para responder (524 - timeout de proxy) mesmo após ${attempt} tentativa(s). Detalhe: ${msg}`;
        }
        throw new Error(msg);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let stopReason: string | null = null;
      let streamErrorMsg: string | null = null;
      let usage: any = null;
      // Argumento da NOSSA ferramenta, montado pedaço a pedaço pelo streaming.
      // A busca na web também é uma ferramenta, então filtramos pelo nome.
      let ferramentaJSON = "";
      let blocoEhNossaFerramenta = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          let evt: any;
          try { evt = JSON.parse(jsonStr); } catch { continue; }
          if (evt.type === "message_start") {
            usage = { ...(evt.message?.usage || {}) };
          } else if (evt.type === "content_block_start") {
            const bloco = evt.content_block || {};
            blocoEhNossaFerramenta = bloco.type === "tool_use" && !!ferramenta && bloco.name === ferramenta.name;
          } else if (evt.type === "content_block_stop") {
            blocoEhNossaFerramenta = false;
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            text += evt.delta.text || "";
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta") {
            if (blocoEhNossaFerramenta) ferramentaJSON += evt.delta.partial_json || "";
          } else if (evt.type === "message_delta") {
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
            if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
          } else if (evt.type === "error") {
            streamErrorMsg = evt.error?.message || "Erro reportado pelo streaming da Anthropic.";
          }
        }
      }
      clearTimeout(watchdog);
      if (streamErrorMsg) throw new Error(streamErrorMsg);
      return { text, truncated: stopReason === "max_tokens", usage, ferramentaJSON };
    } catch (err: any) {
      clearTimeout(watchdog);
      const isAbort = err?.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      if ((isAbort || isNetwork) && attempt < MAX_ATTEMPTS) {
        lastErr = err;
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Falha ao contatar a Anthropic após múltiplas tentativas.");
}

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
// v69: em Biologia o teto cai para 2 buscas por questão (ver BUSCA_BIOLOGIA).
function webSearchTool(disciplina: string) {
  return ehBiologia(disciplina) ? { ...WEB_SEARCH_TOOL, max_uses: 2 } : WEB_SEARCH_TOOL;
}

/* ENTREGA POR FERRAMENTA, NÃO POR TEXTO LIVRE.

   Durante muito tempo a questão voltava como texto e era interpretada aqui.
   Isso funciona quase sempre — e falha justamente nas questões mais ricas: uma
   aspa não escapada dentro do texto-base, um prefácio em prosa antes do JSON,
   um rascunho abandonado quando o modelo decide pesquisar no meio da resposta.
   Cada um desses casos custou uma questão perdida ao professor.

   Pedindo a resposta como CHAMADA DE FERRAMENTA, o JSON deixa de ser texto que
   o modelo escreve e passa a ser argumento que a API monta e valida: aspas,
   escapes e fechamento de chaves deixam de ser problema nosso. A leitura do
   texto continua existindo logo abaixo, como plano B, para o caso de o modelo
   responder em prosa mesmo assim. */
/* ORDEM DOS CAMPOS IMPORTA. Ao preencher uma chamada de ferramenta, o modelo
   escreve os campos aproximadamente na ordem em que a "properties" abaixo os
   lista — é assim que a geração de JSON guiada por schema funciona. Até a
   v58, "visual" vinha ANTES de "textoBase"/"comando"/"resolucaoComentada":
   ou seja, o modelo era obrigado a especificar a imagem (as 8 seções do
   protocolo, com cena, elementos, setas, rótulos e números) ANTES de ter
   escrito o enunciado concreto que essa imagem deveria ilustrar — só com
   "tema" (um rótulo curto, ex.: "Geometria Plana") como referência, sem
   ainda ter a situação-problema, os valores e a resolução específicos desta
   questão. Isso é uma causa bem mais provável — e verificável no próprio
   design da ferramenta — do que qualquer "cache" para o recurso visual às
   vezes sair sobre um assunto completamente diferente do da questão, mesmo
   sem nenhuma instrução deixada de uma questão anterior: sem o texto ainda
   escrito, o modelo não tem em que ancorar a cena e pode derivar para um
   exemplo genérico do próprio protocolo de imagem (que cita, como exemplos
   de uso, cenários de outras disciplinas).
   CORREÇÃO: "visual" agora vem por ÚLTIMO no schema, depois de todo o
   conteúdo textual da questão já ter sido escrito (texto-base, comando,
   alternativas, gabarito, resolução comentada e análise das alternativas) —
   a imagem passa a ser especificada com base no que já foi efetivamente
   escrito para ESTA questão, nunca decidida antes e às cegas. */
/* SCHEMA DO CAMPO "visual". Até a v59 ele era "{}" — sem tipo nenhum —, e o
   modelo, lendo no protocolo "8 seções, cada uma com seu título", às vezes
   entregava "promptImagem" como um OBJETO com uma chave por seção (ou
   {"tipo","valor"}, ou {"tipo","descricao"}), em vez de uma string. Aqui os
   campos internos ganham tipo explícito (string) e uma descrição que diz isso
   com todas as letras. Não há "type" no nível de cima de propósito: com
   recurso "nenhum" o campo vem como null e continua válido. A rede de
   segurança definitiva é normalizarVisual(), mais abaixo — o schema só reduz
   a chance de precisar dela. */
const VISUAL_SCHEMA = {
  description: 'Recurso visual da questão, ou null quando recurso = "nenhum". Para imagem: {"tipo":"imagem","descricao":"<string>","promptImagem":"<string>"}. "promptImagem" é OBRIGATORIAMENTE uma única string de texto corrido contendo as 8 seções numeradas em sequência — NUNCA um objeto com uma chave por seção. Para gráfico: {"tipo":"grafico","chartType","titulo","labels","datasets"}. Para tabela: {"tipo":"tabela","titulo","colunas","linhas"}.',
  properties: {
    tipo: { type: "string", description: '"imagem", "grafico" ou "tabela"' },
    descricao: { type: "string", description: "Legenda em português (string única)." },
    promptImagem: { type: "string", description: "Especificação técnica em inglês, as 8 seções numeradas em UMA ÚNICA STRING de texto corrido — nunca um objeto." },
    titulo: { type: "string" },
    chartType: { type: "string" },
    labels: { type: "array" },
    datasets: { type: "array" },
    colunas: { type: "array" },
    linhas: { type: "array" },
  },
};

/* v62 — SCHEMA DO "visual" POR RECURSO PEDIDO.
   O banco mostrou (08/09/2026, 11 simulados) que, com "visual" opcional no
   schema, o modelo entregava a questão SEM o recurso visual pedido em 1 a 5
   questões por leva de 10 ("visual": null), ou trocava o tipo (gráfico no
   lugar de imagem) — e a questão seguia como "pronta". Aqui, quando o
   professor pediu imagem/gráfico/tabela, o campo "visual" passa a ser
   OBRIGATÓRIO, com "tipo" fixo no recurso pedido e os campos essenciais
   obrigatórios. Com recurso "nenhum" o schema continua o de sempre (null). */
function visualSchemaPara(recurso: string): any {
  if (recurso === "imagem") {
    return {
      type: "object",
      description: 'OBRIGATÓRIO nesta questão (recurso pedido: IMAGEM). {"tipo":"imagem","descricao":"<legenda em português>","promptImagem":"<especificação técnica em inglês, as 8 seções numeradas em UMA ÚNICA STRING>"}. Nunca null, nunca gráfico ou tabela no lugar da imagem.',
      properties: {
        tipo: { type: "string", enum: ["imagem"] },
        descricao: { type: "string", description: "Legenda em português (string única)." },
        promptImagem: { type: "string", description: "Especificação técnica em inglês, as 8 seções numeradas em UMA ÚNICA STRING de texto corrido — nunca um objeto." },
      },
      required: ["tipo", "descricao", "promptImagem"],
    };
  }
  if (recurso === "grafico") {
    return {
      type: "object",
      description: 'OBRIGATÓRIO nesta questão (recurso pedido: GRÁFICO). {"tipo":"grafico","chartType":"bar"|"line"|"pie","titulo","labels":[...],"datasets":[{"label","data":[...]}]}. Nunca null.',
      properties: {
        tipo: { type: "string", enum: ["grafico"] },
        chartType: { type: "string", enum: ["bar", "line", "pie"] },
        titulo: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        datasets: { type: "array", items: { type: "object", properties: { label: { type: "string" }, data: { type: "array", items: { type: "number" } } }, required: ["label", "data"] } },
      },
      required: ["tipo", "chartType", "titulo", "labels", "datasets"],
    };
  }
  if (recurso === "tabela") {
    return {
      type: "object",
      description: 'OBRIGATÓRIO nesta questão (recurso pedido: TABELA). {"tipo":"tabela","titulo","colunas":[...],"linhas":[[...],...]}. Nunca null.',
      properties: {
        tipo: { type: "string", enum: ["tabela"] },
        titulo: { type: "string" },
        colunas: { type: "array", items: { type: "string" } },
        linhas: { type: "array", items: { type: "array", items: { type: "string" } } },
      },
      required: ["tipo", "titulo", "colunas", "linhas"],
    };
  }
  return VISUAL_SCHEMA;
}

function ferramentaQuestaoPara(recurso: string): any {
  const comVisual = ["imagem", "grafico", "tabela"].includes(recurso);
  return {
    name: "entregar_questao",
    description: "Entrega a questão pronta. Use SEMPRE esta ferramenta para devolver a questão — nunca escreva o JSON no texto da resposta.",
    input_schema: {
      type: "object",
      properties: {
        area: { type: "string" },
        disciplina: { type: "string" },
        tema: { type: "string" },
        dificuldade: { type: "string" },
        competencia: { type: "object" },
        habilidade: { type: "object" },
        objetoConhecimento: { type: "string" },
        recurso: comVisual ? { type: "string", enum: [recurso] } : { type: "string" },
        textoBase: { type: "string" },
        comando: { type: "string" },
        alternativas: {
          type: "object",
          description: 'OBJETO com as chaves "A", "B", "C", "D" e "E", cada valor uma string com o texto da alternativa — nunca uma string contendo JSON.',
          properties: { A: { type: "string" }, B: { type: "string" }, C: { type: "string" }, D: { type: "string" }, E: { type: "string" } },
          required: ["A", "B", "C", "D", "E"],
        },
        gabarito: { type: "string" },
        resolucaoComentada: { type: "string" },
        analiseAlternativas: { type: "object" },
        visual: visualSchemaPara(recurso),
      },
      required: [
        "area", "disciplina", "tema", "dificuldade", "competencia", "habilidade",
        "objetoConhecimento", "recurso", "textoBase", "comando", "alternativas",
        "gabarito", "resolucaoComentada", "analiseAlternativas",
        ...(comVisual ? ["visual"] : []),
      ],
    },
  };
}

function ferramentaVisualPara(recurso: string): any {
  return {
    name: "entregar_visual",
    description: "Entrega apenas a nova versão do recurso visual da questão.",
    input_schema: {
      type: "object",
      properties: { visual: visualSchemaPara(recurso) },
      required: ["visual"],
    },
  };
}

// Compatibilidade com o restante do arquivo (recurso "nenhum" = schema antigo).
const FERRAMENTA_QUESTAO = ferramentaQuestaoPara("nenhum");
const FERRAMENTA_VISUAL = ferramentaVisualPara("imagem");

function sanitizeJsonControlChars(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') { inString = true; out += ch; continue; }
      out += ch;
    }
  }
  return out;
}

/* ASPAS SOLTAS DENTRO DE UM CAMPO DE TEXTO.

   Era a causa da falha "Expected ',' or '}' after property value", e ela tinha
   origem concreta: o protocolo da imagem pedia o texto de cada rótulo entre
   aspas duplas — `the label "Comprimento (L)" placed to the left…` — e essa
   especificação inteira viaja dentro do campo JSON "promptImagem". Quando o
   modelo esquecia de escapá-las, o JSON.parse fechava a string cedo e a questão
   inteira se perdia. O protocolo passou a pedir aspas simples, o que remove a
   causa; esta função é a rede embaixo, porque uma citação entre aspas no
   texto-base ou uma frase em inglês copiada de outra seção reabrem o mesmo
   buraco.

   A regra de decisão: dentro de uma string, uma aspa só ENCERRA de verdade se
   o próximo caractere não-branco for `}`, `]` ou o fim do texto — ou uma
   vírgula seguida do começo de um novo valor (`"`, `{`, `[`). Qualquer outra
   coisa depois dela é continuação do texto, então a aspa é escapada. É por
   isso que `"o professor disse "não depende da massa", e os alunos…"` é
   recuperado corretamente: a aspa antes da vírgula é seguida de ` e`, não de
   uma nova chave.

   Um caso à parte é o `:` depois da aspa. Ele só indica fim de CHAVE — nunca
   fim de um VALOR — porque em JSON válido um dois-pontos jamais segue o valor
   de uma propriedade (só a chave). Tratar todo `"` seguido de `:` como fim de
   string quebrava exatamente o caso que motivou o reparo pelo schema: um
   título citado dentro de um campo de texto, com outro dois-pontos mais
   adiante na mesma frase — `citado por Hilário Franco Jr. em "As Cruzadas" —
   fonte real, acadêmica: amplamente usada em vestibulares` fecharia a string
   ali por engano. Por isso a aspa só é tratada como fim de CHAVE quando a
   PRÓPRIA STRING começou em posição de chave: logo depois de `{` ou de `,`
   (ignorando espaços) — nunca no meio do valor de outro campo. */
function escaparAspasSoltas(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  let inicioString = -1;
  const proximoNaoBranco = (de: number) => {
    let k = de;
    while (k < text.length && /\s/.test(text[k])) k++;
    return { ch: k < text.length ? text[k] : "", i: k };
  };
  const anteriorNaoBranco = (de: number) => {
    let k = de;
    while (k >= 0 && /\s/.test(text[k])) k--;
    return k >= 0 ? text[k] : "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) { out += ch; if (ch === '"') { inString = true; inicioString = i; } continue; }
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch !== '"') { out += ch; continue; }
    const depois = proximoNaoBranco(i + 1);
    let encerra: boolean;
    if (depois.ch === "" || depois.ch === "}" || depois.ch === "]") {
      encerra = true;
    } else if (depois.ch === ",") {
      const seguinte = proximoNaoBranco(depois.i + 1);
      encerra = seguinte.ch === '"' || seguinte.ch === "{" || seguinte.ch === "[" || seguinte.ch === "";
    } else if (depois.ch === ":") {
      const antes = anteriorNaoBranco(inicioString - 1);
      encerra = antes === "{" || antes === ",";
    } else {
      encerra = false;
    }
    if (encerra) { out += ch; inString = false; } else { out += '\\"'; }
  }
  return out;
}

/* Barra invertida que não inicia um escape válido. Aparece quando o modelo
   escorrega para notação de LaTeX no meio de uma explicação de física ou de
   matemática (`T = 2\\pi\\sqrt{L/g}`): `\\p` e `\\s` não são escapes de JSON. */
function escaparBarrasInvalidas(text: string) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) { out += ch; if (ch === '"') inString = true; continue; }
    if (ch === '"') { out += ch; inString = false; continue; }
    if (ch === "\\") {
      const p = text[i + 1] || "";
      if ('"\\\\/bfnrtu'.includes(p)) { out += ch + p; i++; continue; }
      out += "\\\\";
      continue;
    }
    out += ch;
  }
  return out;
}

/* REPARO GUIADO PELO SCHEMA — o último recurso, e o mais confiável dos três.

   As duas funções acima decidem caractere a caractere, e por isso têm pontos
   cegos. O pior deles: um texto que cita duas coisas entre aspas seguidas —
   `a "Cruzada dos Nobres", "Cruzada Popular" e outras` — tem uma aspa interna
   seguida de vírgula e de nova aspa, exatamente o desenho de quem fecha um
   valor e abre a próxima chave. Nenhuma regra local distingue os dois casos.

   O que distingue é o SCHEMA: sabemos os nomes dos campos e a ordem deles. O
   valor de um campo de texto vai do sinal de dois-pontos até onde COMEÇA o
   próximo campo conhecido — e tudo que estiver no meio é texto, aspas
   inclusive. Campos cujo valor é objeto (competencia, alternativas, visual…)
   passam intactos: não se mexe no que não está quebrado. */
const CHAVES_DO_SCHEMA = [
  "area", "disciplina", "tema", "dificuldade", "competencia", "numero", "codigo",
  "habilidade", "objetoConhecimento", "recurso", "visual", "tipo", "descricao",
  "promptImagem", "chartType", "titulo", "labels", "datasets", "colunas", "linhas",
  "textoBase", "comando", "alternativas", "gabarito", "resolucaoComentada",
  "analiseAlternativas", "status", "comentario", "texto", "data", "label",
  "A", "B", "C", "D", "E",
];
const CHAVES_DO_SCHEMA_SET = new Set(CHAVES_DO_SCHEMA);

function escaparConteudoDeString(bruto: string) {
  return bruto
    .replace(/\\(?!["\\\/bfnrtu])/g, "\\\\")
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
    .replace(/(?<!\\)"/g, '\\"');
}

/* Cada objeto de primeiro nível fechado corretamente, do maior para o menor. */
function objetosBalanceados(text: string): string[] {
  const achados: string[] = [];
  let inString = false, escaped = false, profundidade = 0, inicio = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { if (profundidade === 0) inicio = i; profundidade++; continue; }
    if (ch === "}") {
      profundidade--;
      if (profundidade === 0 && inicio >= 0) { achados.push(text.slice(inicio, i + 1)); inicio = -1; }
      if (profundidade < 0) profundidade = 0;
    }
  }
  return achados.sort((a, b) => b.length - a.length);
}

function repararPeloSchema(text: string) {
  // Onde cada campo conhecido começa: a aspa de abertura do NOME do campo.
  // Versão solta — aceita qualquer ocorrência de `"chave":`, mesmo que a
  // palavra apareça citada dentro do valor de OUTRO campo (ver a versão
  // estrita, abaixo, para o reparo que evita esse falso positivo).
  const marcas: number[] = [];
  const re = /"([A-Za-z][A-Za-z0-9_]*)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (CHAVES_DO_SCHEMA_SET.has(m[1])) marcas.push(m.index);
  }
  return repararComMarcas(text, marcas);
}

/* VERSÃO ESTRITA DO REPARO PELO SCHEMA.

   A versão solta acima tem seu próprio ponto cego: palavras genéricas da
   lista de chaves — "texto", "status", "label", "data", "comentario" — podem
   aparecer citadas, entre aspas e seguidas de dois-pontos, dentro do valor de
   OUTRO campo (uma citação, uma observação em prosa). Quando isso acontece, a
   versão solta marca um limite de campo que não existe e corta o valor real
   no lugar errado.

   Esta versão só aceita uma ocorrência como limite de campo se a aspa de
   abertura do NOME estiver, ela mesma, em posição de chave: logo depois de
   `{` (primeiro campo do objeto) ou de `,` (campo seguinte), ignorando
   espaços. Nenhuma chave real de JSON aparece em outro lugar — então esse
   filtro nunca descarta um campo verdadeiro, só os falsos positivos. */
function repararPeloSchemaEstrito(text: string) {
  const marcas: number[] = [];
  const re = /"([A-Za-z][A-Za-z0-9_]*)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!CHAVES_DO_SCHEMA_SET.has(m[1])) continue;
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    const antes = k >= 0 ? text[k] : "";
    if (antes === "{" || antes === ",") marcas.push(m.index);
  }
  return repararComMarcas(text, marcas);
}

function repararComMarcas(text: string, marcas: number[]) {
  if (marcas.length < 2) return text;

  let saida = "";
  let cursor = 0;
  for (let i = 0; i < marcas.length; i++) {
    const inicioChave = marcas[i];
    const fimDoTrecho = i + 1 < marcas.length ? marcas[i + 1] : text.length;
    const trecho = text.slice(inicioChave, fimDoTrecho);
    const doisPontos = trecho.indexOf(":", trecho.indexOf('"', 1) + 1);
    if (doisPontos < 0) continue;
    const nome = trecho.slice(0, doisPontos + 1);
    let valor = trecho.slice(doisPontos + 1);

    // O que vem depois do valor e antes da próxima chave (vírgula, chaves de
    // fechamento, espaços) fica de fora do conserto e é copiado como está.
    const abre = valor.indexOf('"');
    const soAntes = valor.slice(0, abre < 0 ? valor.length : abre);
    if (abre < 0 || soAntes.trim() !== "") {
      // valor não é string (objeto, lista, número, null) — passa intacto
      saida += text.slice(cursor, fimDoTrecho);
      cursor = fimDoTrecho;
      continue;
    }
    const fecha = valor.lastIndexOf('"');
    if (fecha <= abre) { saida += text.slice(cursor, fimDoTrecho); cursor = fimDoTrecho; continue; }
    const miolo = valor.slice(abre + 1, fecha);
    const rabo = valor.slice(fecha + 1);
    saida += text.slice(cursor, inicioChave) + nome + soAntes + '"' + escaparConteudoDeString(miolo) + '"' + rabo;
    cursor = fimDoTrecho;
  }
  saida += text.slice(cursor);
  return saida;
}

function parseJSONLoose(text: string) {
  const raw = (text || "").trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) candidates.push(raw.slice(start, end + 1));
  /* Com a busca na web ligada, o modelo às vezes começa o JSON, decide
     pesquisar e recomeça do zero — sobram dois objetos na mesma resposta, e o
     recorte "da primeira chave à última" junta o rascunho abandonado com o bom.
     Por isso cada objeto BALANCEADO também entra como candidato, do maior para
     o menor: o completo costuma ser o último e o maior. */
  for (const bloco of objetosBalanceados(raw)) candidates.push(bloco);

  const semVirgulaFinal = (v: string) => v.replace(/,(\s*[}\]])/g, "$1");

  let lastErr: any;
  for (const cand of candidates) {
    /* Do mais literal ao mais reparado. A tentativa sem reparo nenhum vem
       sempre primeiro: reparo só entra quando o texto já está quebrado, então
       uma resposta bem-formada nunca passa por essas funções. */
    const variantes: string[] = [];
    for (const base of [cand, sanitizeJsonControlChars(cand)]) {
      const aspas = escaparAspasSoltas(base);
      const barras = escaparBarrasInvalidas(base);
      const ambos = escaparBarrasInvalidas(aspas);
      // O reparo pelo schema entra tanto no texto cru quanto no já corrigido
      // por escaparAspasSoltas: a correção de aspas soltas costuma limpar
      // aspas falsas que, de outro modo, o schema poderia confundir com um
      // limite de campo — as duas passagens juntas cobrem mais casos do que
      // cada uma sozinha.
      const peloSchema = repararPeloSchema(base);
      const peloSchemaEstrito = repararPeloSchemaEstrito(base);
      const peloSchemaDeAspas = repararPeloSchema(aspas);
      const peloSchemaEstritoDeAspas = repararPeloSchemaEstrito(aspas);
      for (const v of [base, aspas, barras, ambos, peloSchema, peloSchemaEstrito, peloSchemaDeAspas, peloSchemaEstritoDeAspas]) {
        variantes.push(v, semVirgulaFinal(v));
      }
    }
    for (const v of variantes) {
      try { return JSON.parse(v); } catch (e) { lastErr = e; }
    }
  }
  const preview = raw.slice(0, 180).replace(/\s+/g, " ");
  const detail = lastErr ? lastErr.message : "erro desconhecido";
  /* Sem um pedaço do texto NO PONTO da falha, cada erro destes vira uma
     investigação às cegas. A janela abaixo mostra o defeito em vez de descrevê-lo. */
  const posicao = Number((lastErr?.message || "").match(/position (\d+)/)?.[1] ?? -1);
  const janela = posicao >= 0
    ? ` Trecho ao redor da falha: …${raw.slice(Math.max(0, posicao - 130), posicao + 130).replace(/\s+/g, " ")}…`
    : "";
  throw new Error(`Não foi possível interpretar a resposta do modelo como JSON (${detail}). Resposta com ${raw.length} caracteres, iniciando em: "${preview}${raw.length > 180 ? "..." : ""}".${janela}`);
}

/* O argumento da ferramenta chega pronto e válido. Ainda assim ele passa por
   JSON.parse: um objeto vazio ou um pedaço truncado por limite de tokens não
   pode ser confundido com uma questão. Devolvendo null, o caminho de texto
   assume. */
function lerFerramenta(bruto: string): any | null {
  const t = (bruto || "").trim();
  if (!t) return null;
  try {
    const obj = JSON.parse(t);
    if (obj && typeof obj === "object" && Object.keys(obj).length) return obj;
  } catch { /* veio incompleto — segue pelo texto */ }
  return null;
}

async function callClaudeForJSON(system: SistemaPrompt, userMsg: string, enableWebSearch: false | { type: string; name: string; max_uses: number } = false, usos?: any[], ferramenta: any = FERRAMENTA_QUESTAO) {
  const primeira = await callClaude(system, userMsg, 8000, enableWebSearch, ferramenta);
  const { text, truncated, usage } = primeira;
  if (usos && usage) usos.push(usage);
  // Caminho normal: a resposta veio como argumento de ferramenta, já válido.
  const daFerramenta = lerFerramenta(primeira.ferramentaJSON);
  if (daFerramenta) return daFerramenta;
  try {
    return parseJSONLoose(text);
  } catch (err: any) {
    /* Resposta cortada no meio: o problema é espaço, então repete com teto
       maior. Resposta completa porém malformada: o problema é a redação do
       JSON, então repete DIZENDO qual foi o erro — sem isso a segunda
       tentativa costuma reproduzir o mesmo defeito. Em ambos os casos é uma
       chamada a mais só quando já se perdeu a questão; o caminho feliz
       continua com uma chamada só. */
    if (truncated) {
      const retry = await callClaude(system, userMsg, 12000, enableWebSearch, ferramenta);
      if (usos && retry.usage) usos.push(retry.usage);
      return lerFerramenta(retry.ferramentaJSON) ?? parseJSONLoose(retry.text);
    }
    const correcao = `${userMsg}

ATENÇÃO — sua resposta anterior não pôde ser lida como JSON. O erro do interpretador foi: ${String(err?.message || err).slice(0, 300)}

Reenvie a MESMA questão, agora como JSON estritamente válido. Verifique, antes de responder: toda aspa dupla que faça parte de um texto está escapada como \\" ; não há barra invertida solta (nada de LaTeX como \\pi ou \\sqrt — escreva por extenso); não há quebra de linha literal dentro de uma string; não há vírgula sobrando antes de } ou ]. Entregue chamando a ferramenta indicada acima, sem crase e sem texto em volta.`;
    const retry = await callClaude(system, correcao, 8000, enableWebSearch, ferramenta);
    if (usos && retry.usage) usos.push(retry.usage);
    return lerFerramenta(retry.ferramentaJSON) ?? parseJSONLoose(retry.text);
  }
}

/* Resumo do consumo desta requisição, para que o cache seja verificável e não
   apenas prometido. "cacheLido" maior que zero significa que o prompt do
   sistema veio do cache — é o que se espera da segunda chamada em diante. */
/* v63: além dos tokens, o número de BUSCAS NA WEB feitas nesta questão
   (usage.server_tool_use.web_search_requests, devolvido pela Anthropic) e o
   custo estimado em dólares com os preços vigentes do Sonnet 5 — entrada
   US$ 2/M, gravação de cache (5 min) US$ 2,50/M, leitura de cache US$ 0,20/M,
   saída US$ 10/M, busca na web US$ 10 por mil. Serve para medir, com dado
   real, quanto cada questão custa e quantas buscas o modelo faz de fato. */
const PRECO_USD_POR_M = { entrada: 2, cacheEscrito: 2.5, cacheLido: 0.2, saida: 10 };
const PRECO_USD_POR_BUSCA = 0.01;
function resumoUso(usos: any[]) {
  const soma = (chave: string) => usos.reduce((t, u) => t + (Number(u?.[chave]) || 0), 0);
  const buscasWeb = usos.reduce((t, u) => t + (Number(u?.server_tool_use?.web_search_requests) || 0), 0);
  const r = {
    chamadas: usos.length,
    entradaNova: soma("input_tokens"),
    cacheEscrito: soma("cache_creation_input_tokens"),
    cacheLido: soma("cache_read_input_tokens"),
    saida: soma("output_tokens"),
    buscasWeb,
    custoUSD: 0,
  };
  r.custoUSD = Number((
    (r.entradaNova * PRECO_USD_POR_M.entrada + r.cacheEscrito * PRECO_USD_POR_M.cacheEscrito +
     r.cacheLido * PRECO_USD_POR_M.cacheLido + r.saida * PRECO_USD_POR_M.saida) / 1e6 +
    buscasWeb * PRECO_USD_POR_BUSCA
  ).toFixed(5));
  return r;
}

/* ---------------- HTTP handler ---------------- */

async function checkDailyCap(): Promise<Response | null> {
  // Sem limite configurado: não consulta o log nem bloqueia nada.
  if (!Number.isFinite(MAX_DAILY_QUESTIONS) || MAX_DAILY_QUESTIONS <= 0) return null;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("question_generation_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (!countErr && typeof count === "number" && count >= MAX_DAILY_QUESTIONS) {
      return jsonResponse({
        error: `Limite diário de ${MAX_DAILY_QUESTIONS} questões atingido. Tente novamente amanhã, ou aumente MAX_DAILY_QUESTIONS nas configurações do backend.`,
      }, 429);
    }
  } catch (_e) {
    // Se o log falhar por algum motivo, não bloqueia a geração.
  }
  return null;
}

async function logGeneration(area: string, disciplina: string, tema: string, extra?: { recurso?: string; uso?: ReturnType<typeof resumoUso> }) {
  try {
    const linha: Record<string, unknown> = { area, disciplina, tema: tema.slice(0, 200) };
    // v63: consumo real da questão (tokens, buscas na web, custo estimado).
    if (extra?.recurso) linha.recurso = extra.recurso;
    if (extra?.uso) {
      const u = extra.uso;
      linha.chamadas = u.chamadas;
      linha.buscas_web = u.buscasWeb;
      linha.tokens_entrada = u.entradaNova;
      linha.tokens_cache_escrito = u.cacheEscrito;
      linha.tokens_cache_lido = u.cacheLido;
      linha.tokens_saida = u.saida;
      linha.custo_usd = u.custoUSD;
      console.log(`[uso] ${disciplina} · ${extra.recurso || "?"} · ${u.chamadas} chamada(s) · entrada ${u.entradaNova} · cache escrito ${u.cacheEscrito} · cache lido ${u.cacheLido} · saída ${u.saida} · buscas web ${u.buscasWeb} · ≈ US$ ${u.custoUSD.toFixed(4)}`);
    }
    await supabase.from("question_generation_log").insert(linha);
  } catch (_e) {
    // best-effort logging
  }
}

/* Verificação de integridade da implantação.

   Esta função é implantada enviando o CONTEÚDO dos arquivos pela API, e não
   copiando bytes de um disco para outro. Um caractere trocado dentro do
   app_data.json — 54 KB numa única linha minificada — não quebraria o boot:
   passaria despercebido e sairia como uma questão sutilmente errada.

   Por isso a função sabe dizer o que carregou. GET ou POST com {selftest:true}
   devolve o tamanho e a impressão digital (FNV-1a) do APP_DATA efetivamente
   carregado, calculados sobre a forma canônica JSON.stringify. Basta comparar
   com o valor calculado no arquivo de origem: batendo, os dados chegaram
   inteiros; não batendo, a implantação é refeita. Nada de segredo é exposto —
   só um número e um hash. */
/* QUEBRA DE LINHA LITERAL NO TEXTO GERADO.

   Bug observado: o modelo às vezes escreve os DOIS CARACTERES "\n" (barra
   invertida + letra n) dentro do próprio texto de um campo — tipicamente
   entre o texto-suporte e a citação de fonte ao final — em vez de produzir
   uma quebra de linha de verdade. A instrução em JSON_SCHEMA_TXT (acima)
   agora pede explicitamente para não fazer isso, mas prompt não é garantia:
   o app inteiro depende de quebras de linha REAIS nesses campos — a tela
   usa white-space:pre-wrap (uma quebra real vira parágrafo; texto comum,
   não) e o PDF/DOCX (enemTextoBase, no app.js) separa a citação do corpo
   cortando em \n reais. Quando o modelo erra e digita o texto literal
   "\n", nenhum dos dois funciona: a tela mostra "\n" visível (foi o que o
   professor reportou) e a exportação trata a citação como parte do corpo.

   Por isso esta função varre TODO o objeto da questão, recursivamente, e
   troca cada ocorrência da sequência literal \r\n ou \n (os caracteres,
   não uma quebra real) por uma quebra de linha de verdade — corrigindo o
   deslize do modelo antes que o dado saia desta função, não importa em
   qual chamada (rascunho, validação ou refazer visual) ele tenha entrado. */
function corrigirQuebrasLiterais<T>(valor: T): T {
  if (typeof valor === "string") {
    return valor.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n") as unknown as T;
  }
  if (Array.isArray(valor)) return valor.map((v) => corrigirQuebrasLiterais(v)) as unknown as T;
  if (valor && typeof valor === "object") {
    const saida: any = {};
    for (const k of Object.keys(valor as any)) saida[k] = corrigirQuebrasLiterais((valor as any)[k]);
    return saida as T;
  }
  return valor;
}

/* IMAGEM FORA DE ASSUNTO — A CAUSA RAIZ, COMPROVADA NO BANCO.

   O professor relatou questões de Matemática saindo com imagens de Física
   (usina hidrelétrica, ponte estaiada, aquecedor solar) — em até metade de
   uma leva de 10. Não era cache, não era instrução residual, não era a ordem
   dos campos. Era o TIPO de um campo.

   O que o banco mostrou (tabela image_generation_log, 08/09/2026): 27 das 69
   imagens do dia foram pedidas ao gerador com o prompt terminando em
   "Cena: [object Object]" — ou seja, SEM NENHUMA DESCRIÇÃO da cena. E nos
   simulados arquivados (tabela simulados), exatamente as questões com imagem
   errada tinham "visual.promptImagem" gravado como OBJETO, não como string:
   ora uma chave por seção ({"sceneAndViewpoint":…, "elementInventory":…}),
   ora {"tipo":"texto","valor":…}, ora {"tipo":"imagem","descricao":…}. O
   modelo, lendo no protocolo "8 seções, cada uma com seu título", às vezes
   estruturava a especificação como JSON em vez de texto — e o schema da
   ferramenta ("visual: {}", sem tipo) não o impedia.

   O app fazia String(promptImagem) → "[object Object]", mandava para o
   gerador só o preâmbulo genérico ("ilustração educacional para uma questão
   no padrão ENEM…") e o gerador, sem cena nenhuma, inventava uma cena
   "educacional" qualquer — quase sempre com cara de Física. Por isso a
   imagem não tinha relação com o enunciado: ela nunca soube do enunciado.

   Esta função garante que "promptImagem", "descricao" e "titulo" saiam daqui
   SEMPRE como string. Se vieram como objeto, o conteúdo é preservado e
   convertido em texto corrido, com as seções na ordem do protocolo — nada se
   perde, e nenhuma chamada a mais é feita. */
const SECOES_IMAGEM: Array<[RegExp, string]> = [
  [/scene|viewpoint|cena/i, "1. SCENE AND VIEWPOINT"],
  [/inventory|element/i, "2. ELEMENT INVENTORY"],
  [/layout|position|posi/i, "3. LAYOUT AND POSITION"],
  [/arrow|seta/i, "4. ARROWS"],
  [/label|r[oó]tulo/i, "5. TEXT LABELS"],
  [/number|scale|measure|n[uú]mero|escala|medida/i, "6. NUMBERS, SCALES AND MEASUREMENT MARKS"],
  [/style|legib|estilo/i, "7. STYLE AND LEGIBILITY"],
  [/negative|constraint|restri/i, "8. NEGATIVE CONSTRAINTS"],
];
const CHAVES_ENVELOPE = ["promptImagem", "prompt", "valor", "value", "texto", "text", "descricao", "description", "conteudo", "content", "especificacao", "specification"];

function textoDeEspecificacao(valor: unknown, profundidade = 0): string {
  if (valor == null) return "";
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (Array.isArray(valor)) {
    return valor.map((v) => textoDeEspecificacao(v, profundidade + 1)).filter(Boolean).join(profundidade === 0 ? "\n" : "; ");
  }
  if (typeof valor === "object") {
    const obj = valor as Record<string, unknown>;
    const chaves = Object.keys(obj);
    // Envelope de um único texto: {"tipo":"texto","valor":"…"}, {"tipo":"imagem","descricao":"…"} etc.
    for (const k of CHAVES_ENVELOPE) {
      const conteudo = obj[k];
      if (typeof conteudo === "string" && conteudo.trim()) {
        const restantes = chaves.filter((c) => c !== k && c !== "tipo" && c !== "type");
        if (!restantes.length) return conteudo.trim();
      }
    }
    // Uma chave por seção: reordena pelas 8 seções do protocolo e junta em texto corrido.
    const partes: Array<{ ordem: number; texto: string }> = [];
    chaves.forEach((k, i) => {
      const conteudo = textoDeEspecificacao(obj[k], profundidade + 1);
      if (!conteudo) return;
      const secao = SECOES_IMAGEM.findIndex(([re]) => re.test(k));
      const titulo = secao >= 0
        ? SECOES_IMAGEM[secao][1]
        : k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
      partes.push({ ordem: secao >= 0 ? secao : 100 + i, texto: `${titulo}: ${conteudo}` });
    });
    partes.sort((a, b) => a.ordem - b.ordem);
    return partes.map((p) => p.texto).join(profundidade === 0 ? "\n\n" : "; ");
  }
  return "";
}

function normalizarVisual(visual: unknown, recurso: string): any {
  if (visual == null) return null;
  let v: any = visual;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v = parsed;
      else return recurso === "imagem" ? { tipo: "imagem", promptImagem: t } : v;
    } catch {
      return recurso === "imagem" ? { tipo: "imagem", promptImagem: t } : v;
    }
  }
  if (typeof v !== "object" || Array.isArray(v)) return v;
  const saida: any = { ...v };
  if (typeof saida.tipo === "string") saida.tipo = saida.tipo.trim().toLowerCase();
  if (!saida.tipo && ["imagem", "grafico", "tabela"].includes(recurso)) saida.tipo = recurso;
  for (const campo of ["promptImagem", "descricao", "titulo"]) {
    if (saida[campo] != null && typeof saida[campo] !== "string") saida[campo] = textoDeEspecificacao(saida[campo]);
  }
  if (typeof saida.promptImagem === "string" && !saida.promptImagem.trim()) delete saida.promptImagem;
  return saida;
}

/* v67 — CAMPOS ESTRUTURADOS QUE CHEGAM COMO STRING.
   Caso real (10/09/2026, lote "ciclos biogeoquímicos", questão 6): o modelo
   preencheu "alternativas" da ferramenta com uma STRING contendo o JSON das
   cinco alternativas — e ainda truncada no fim (sem o `"}` final). A API não
   valida o conteúdo contra o schema, o backend passou adiante e o app, ao
   procurar alternativas.A…E numa string, mostrou as cinco em branco.
   Mesmo padrão de normalizarVisual(), estendido a alternativas,
   analiseAlternativas, competencia e habilidade:
   1) JSON.parse direto; 2) JSON.parse acrescentando `"}` ou `}` (fechamento
   perdido); 3) só para alternativas: extração pelos marcadores "A":" … "E":",
   valor de cada letra = do marcador até o marcador seguinte, tirando as aspas
   e vírgulas sobrando e desfazendo os escapes. A conversão só é aceita quando
   produz um objeto utilizável (alternativas: as cinco letras com texto); caso
   contrário o campo fica como veio, para a auditoria continuar acusando.
   Objeto que já chega como objeto não é tocado. */
const LETRAS_ALTERNATIVAS = ["A", "B", "C", "D", "E"];

function desescaparJsonString(s: string): string {
  return s
    .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\\\/g, "\\");
}

function objetoDeString(bruto: string): any | null {
  const t = bruto.trim();
  if (!t.startsWith("{")) return null;
  for (const sufixo of ["", '"}', "}", '"}}', "}}"]) {
    try {
      const p = JSON.parse(t + sufixo);
      if (p && typeof p === "object" && !Array.isArray(p)) return p;
    } catch { /* tenta o próximo fechamento */ }
  }
  return null;
}

function alternativasDeString(bruto: string): Record<string, string> | null {
  const direto = objetoDeString(bruto);
  if (direto && alternativasUtilizaveis(direto)) return direto;
  // Extração pelos marcadores — tolera o fechamento perdido e aspas soltas.
  const marcas: Array<{ letra: string; inicio: number; fimMarca: number }> = [];
  const re = /"([A-E])"\s*[^"\w\s]{0,2}\s*"/g; // aceita ":" e também um separador trocado (caso real: `"D">"16 A."`)
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto)) !== null) {
    if (marcas.some((x) => x.letra === m![1])) continue;
    marcas.push({ letra: m[1], inicio: m.index, fimMarca: m.index + m[0].length });
  }
  if (marcas.length !== 5) return null;
  const saida: Record<string, string> = {};
  for (let i = 0; i < marcas.length; i++) {
    const fim = i + 1 < marcas.length ? marcas[i + 1].inicio : bruto.length;
    let valor = bruto.slice(marcas[i].fimMarca, fim).trim();
    valor = valor.replace(/[\s,]*\}*\s*$/g, "").replace(/(?<!\\)"[\s,]*$/g, "").trim();
    saida[marcas[i].letra] = desescaparJsonString(valor).trim();
  }
  return alternativasUtilizaveis(saida) ? saida : null;
}

function alternativasUtilizaveis(obj: any): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return LETRAS_ALTERNATIVAS.every((L) => typeof obj[L] === "string" && obj[L].trim().length > 0);
}

function normalizarCamposEstruturados(data: any): any {
  if (!data || typeof data !== "object") return data;
  if (typeof data.alternativas === "string") {
    const tamanho = data.alternativas.length;
    const obj = alternativasDeString(data.alternativas);
    if (obj) { data.alternativas = obj; console.log("[alternativas] campo veio como string — reparado (" + tamanho + " caracteres)"); }
    else console.warn("[alternativas] campo veio como string e NÃO pôde ser reparado (" + tamanho + " caracteres)");
  }
  for (const campo of ["analiseAlternativas", "competencia", "habilidade"]) {
    if (typeof data[campo] === "string") {
      const obj = objetoDeString(data[campo]);
      if (obj) { data[campo] = obj; console.log("[" + campo + "] campo veio como string — reparado"); }
    }
  }
  if (data.analiseAlternativas && typeof data.analiseAlternativas === "object") {
    for (const L of LETRAS_ALTERNATIVAS) {
      const v = data.analiseAlternativas[L];
      if (typeof v === "string") { const obj = objetoDeString(v); if (obj) data.analiseAlternativas[L] = obj; }
    }
  }
  return data;
}

/* v62 — O recurso visual entregue corresponde ao pedido?
   Devolve {ok:true} ou {ok:false, motivo}. Para imagem exige a especificação
   (promptImagem) com tamanho de especificação real (>= 200 caracteres): uma
   linha solta não é uma especificação nas 8 seções e produziria uma imagem
   genérica. */
function visualConforme(visual: any, recurso: string): { ok: boolean; motivo: string } {
  if (!["imagem", "grafico", "tabela"].includes(recurso)) return { ok: true, motivo: "" };
  if (visual == null || typeof visual !== "object") return { ok: false, motivo: `recurso "${recurso}" pedido, mas o modelo entregou visual ${visual == null ? "null" : typeof visual}` };
  if (visual.tipo !== recurso) return { ok: false, motivo: `recurso "${recurso}" pedido, mas o modelo entregou tipo "${visual.tipo || "(sem tipo)"}"` };
  if (recurso === "imagem") {
    const p = typeof visual.promptImagem === "string" ? visual.promptImagem.trim() : "";
    if (p.length < 200) return { ok: false, motivo: `imagem sem especificação utilizável (promptImagem com ${p.length} caracteres)` };
    return { ok: true, motivo: "" };
  }
  if (recurso === "grafico") {
    const okG = Array.isArray(visual.labels) && visual.labels.length > 0 && Array.isArray(visual.datasets) && visual.datasets.length > 0 && Array.isArray(visual.datasets[0]?.data) && visual.datasets[0].data.length > 0;
    return okG ? { ok: true, motivo: "" } : { ok: false, motivo: "gráfico sem labels/datasets utilizáveis" };
  }
  const okT = Array.isArray(visual.colunas) && visual.colunas.length > 0 && Array.isArray(visual.linhas) && visual.linhas.length > 0;
  return okT ? { ok: true, motivo: "" } : { ok: false, motivo: "tabela sem colunas/linhas utilizáveis" };
}

/* v62 — Garante o recurso visual pedido. Se a questão veio sem ele (ou com o
   tipo trocado), pede ao modelo SÓ o recurso visual, pela mesma rota do botão
   "Refazer" (buildVisualRedoPrompt + entregar_visual), usando o texto-base,
   comando, alternativas, gabarito e resolução JÁ escritos desta questão — até
   MAX_REFAZER_VISUAL vezes. Devolve o diagnóstico completo da etapa. */
const MAX_REFAZER_VISUAL = 2;
async function garantirVisual(data: any, opts: { area: string; disciplina: string; recurso: string; tema: string; instrucoesVisual: string }, usos: any[]) {
  const diag: any = {
    recursoPedido: opts.recurso,
    entregueTipo: data?.visual?.tipo ?? null,
    promptChars: typeof data?.visual?.promptImagem === "string" ? data.visual.promptImagem.length : 0,
    refeito: 0,
    tentativasRefazer: [] as string[],
    conforme: false,
    motivo: "",
  };
  if (!data || typeof data !== "object") { diag.motivo = "questão inválida"; return diag; }
  let check = visualConforme(data.visual, opts.recurso);
  for (let n = 1; !check.ok && n <= MAX_REFAZER_VISUAL; n++) {
    console.log(`[visual] questão "${opts.tema}" (${opts.disciplina}): ${check.motivo} — refazendo recurso visual (${n}/${MAX_REFAZER_VISUAL})`);
    try {
      const userMsg = buildVisualRedoPrompt({
        tema: data.tema || opts.tema, disciplina: opts.disciplina, recurso: opts.recurso,
        textoBase: String(data.textoBase || ""), comando: String(data.comando || ""),
        alternativas: (data.alternativas && typeof data.alternativas === "object") ? data.alternativas : {},
        gabarito: String(data.gabarito || ""), resolucaoComentada: String(data.resolucaoComentada || ""),
        instrucoesVisual: opts.instrucoesVisual, motivoFaltante: check.motivo,
      });
      const novo = await callClaudeForJSON(buildSystemVisual(opts.area), userMsg, false, usos, ferramentaVisualPara(opts.recurso));
      const visualNovo = normalizarVisual(novo?.visual, opts.recurso);
      const c2 = visualConforme(visualNovo, opts.recurso);
      diag.refeito = n;
      if (c2.ok) {
        data.visual = visualNovo;
        data.recurso = opts.recurso;
        diag.tentativasRefazer.push(`${n}: ok`);
        check = c2;
        break;
      }
      diag.tentativasRefazer.push(`${n}: ${c2.motivo}`);
      check = c2;
    } catch (err) {
      diag.tentativasRefazer.push(`${n}: erro ${String((err as any)?.message || err).slice(0, 200)}`);
      diag.refeito = n;
    }
  }
  diag.conforme = check.ok;
  diag.motivo = check.ok ? "" : check.motivo;
  diag.entregueTipo = data?.visual?.tipo ?? null;
  diag.promptChars = typeof data?.visual?.promptImagem === "string" ? data.visual.promptImagem.length : 0;
  if (!check.ok) {
    /* Nunca entregar um recurso trocado como se fosse o pedido, nem fingir que
       está pronto: o visual sai null e "visualPendente" diz exatamente o que
       faltou. O app trata isso como questão NÃO concluída. */
    data.visual = null;
    data.visualPendente = { recurso: opts.recurso, motivo: check.motivo, tentativas: diag.refeito };
    console.error(`[visual] questão "${opts.tema}" (${opts.disciplina}): recurso "${opts.recurso}" NÃO obtido após ${diag.refeito} refazer(es): ${check.motivo}`);
  } else {
    delete data.visualPendente;
    console.log(`[visual] questão "${opts.tema}" (${opts.disciplina}): recurso "${opts.recurso}" ok (tipo ${diag.entregueTipo}, promptImagem ${diag.promptChars} chars, refeito ${diag.refeito}x)`);
  }
  return diag;
}

function fnv1a(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function selfTestResponse() {
  const canonico = JSON.stringify(APP_DATA);
  /* O mesmo cuidado vale para o código: um caractere trocado dentro de um
     texto de prompt não quebraria o boot. Function.prototype.toString()
     devolve o corpo realmente carregado pelo runtime, então a impressão
     digital abaixo cobre as partes do index.ts que decidem o conteúdo. */
  const codigo = [
    NOTACAO_QUIMICA,
    NOTACAO_MATEMATICA,
    JSON_SCHEMA_TXT,
    buildSystemPrompt.toString(),
    buildUserPrompt.toString(),
    buildBlocoFixo.toString(),
    buildGabaritoAlvo.toString(),
    buildVisualRedoPrompt.toString(),
    buildRegraFontesReais.toString(),
    buildCalibracaoExtensao.toString(),
    buildMatrizInstrucoes.toString(),
    buildObjetosConhecimento.toString(),
    buildDiversidadeTematica.toString(),
    buildSystemPlanejamento.toString(),
    normalizarNotacaoTexto.toString(), normalizarNotacaoQuimica.toString(), qnConverteIon.toString(),
    JSON.stringify([QN_FORMULAS_COMUNS, QN_FORMULAS_DISCIPLINA, QN_GASES, QN_GASES_SEMPRE, QN_IONS]),
    normalizarNotacaoMatematica.toString(), nmNormalizaTexto.toString(),
    buildPlanejamentoPrompt.toString(),
    buildSystemVisual.toString(),
    BUSCA_PADRAO,
    BUSCA_BIOLOGIA,
  ].join(String.fromCharCode(0));
  return jsonResponse({
    selftest: true,
    appDataChars: canonico.length,
    appDataHash: fnv1a(canonico),
    chaves: Object.keys(APP_DATA).sort(),
    codigoChars: codigo.length,
    codigoHash: fnv1a(codigo),
    notacaoChars: NOTACAO_QUIMICA.length,
    notacaoHash: fnv1a(NOTACAO_QUIMICA),
    schemaChars: JSON_SCHEMA_TXT.length,
    schemaHash: fnv1a(JSON_SCHEMA_TXT),
    // v68: impressão digital dos protocolos de recurso visual embutidos no
    // deploy (recurso_instrucoes.ts), para provar qual versão está no ar.
    recursoChars: JSON.stringify(RECURSO_INSTRUCOES).length,
    recursoHash: fnv1a(JSON.stringify(RECURSO_INSTRUCOES)),
    // v69: Biologia usa o protocolo de Física byte a byte + complemento científico.
    complementoBiologiaChars: COMPLEMENTO_BIOLOGIA.length,
    complementoBiologiaHash: fnv1a(COMPLEMENTO_BIOLOGIA),
    biologiaUsaProtocoloDeFisica: instrucoesImagem("imagem", "Biologia").startsWith(instrucoesImagem("imagem", "Física")),
    recursoBiologiaCinematografico: /National Geographic/.test(instrucoesImagem("imagem", "Biologia")),
    buscaBiologiaMaxUses: webSearchTool("Biologia").max_uses,
    temNotacaoQuimica: typeof NOTACAO_QUIMICA === "string" && NOTACAO_QUIMICA.length > 0,
    temGabaritoAlvo: typeof buildGabaritoAlvo === "function",
    temNormalizarCamposEstruturados: typeof normalizarCamposEstruturados === "function",
    temNormalizarNotacaoQuimica: typeof normalizarNotacaoQuimica === "function",
    notacaoAmostra: normalizarNotacaoTexto("CO2 e NO3- e Ca2+ e H10 e C3 e O+", "Biologia"),
    notacaoTokens: { Biologia: qnTabela("Biologia").mapa.size, Quimica: qnTabela("Química").mapa.size, Fisica: qnTabela("Física").mapa.size, Outra: qnTabela("Matemática").mapa.size },
    // v71: notação matemática em todas as áreas (prompt + rede de segurança).
    temNotacaoMatematica: typeof NOTACAO_MATEMATICA === "string" && NOTACAO_MATEMATICA.length > 0,
    notacaoMatChars: NOTACAO_MATEMATICA.length,
    notacaoMatHash: fnv1a(NOTACAO_MATEMATICA),
    notacaoEmTodasAsAreas: ["linguagens", "humanas", "natureza", "matematica"].every((a) => buildSystemPrompt(a).includes("NOTAÇÃO MATEMÁTICA") && buildSystemPrompt(a).includes("NOTAÇÃO QUÍMICA")),
    notacaoMatAmostra: normalizarNotacaoMatematica({ textoBase: "Q(t) = Q0 · 2^(-t/T) e 4,6 x 10^9 anos; S = S0 . (1 + i)^t; 288 = 2^5 x 3^2; 5 m2; log10(A/A0)", resolucaoComentada: "Q0 = 200" }, "Matemática").textoBase,
    // v73: diversidade de exemplos sem custo — o bloco do prompt transmite
    // subtópico, domínio (com alternativo e proibidos) e cenários a evitar.
    diversidadeV73: (() => {
      const b = buildDiversidadeTematica("Conhecimentos numéricos", ["PG e depreciação"], "", "", { subtopico: "porcentagem e juros", dominioContexto: "pesca e aquicultura", dominioAlternativo: "correios e encomendas", dominiosEvitar: ["transporte e logística de cargas", "pesca e aquicultura"], contextosEvitar: ["fábrica de componentes eletrônicos"] });
      const semRecorte = buildDiversidadeTematica("", [], "Função exponencial", "conteúdo: x · contexto: y", { dominioContexto: "pesca e aquicultura" });
      const aposColisao = buildDiversidadeTematica("", [], "Função exponencial", "conteúdo: x", { dominioContexto: "pesca e aquicultura", contextosEvitar: ["marcenaria"] });
      const semContexto = buildDiversidadeTematica("", [], "Função exponencial", "conteúdo: x · habilidade: H21: y", { dominioContexto: "pesca e aquicultura" });
      return { subtopico: b.includes('subtópico "porcentagem e juros"'), dominio: b.includes('em "pesca e aquicultura"'), alternativo: b.includes('alternativo "correios e encomendas"'), proibidos: /NÃO use: transporte e logística de cargas\./.test(b), cenarios: b.includes("fábrica de componentes eletrônicos"), dominioOmitidoComRecorte: !semRecorte.includes("DOMÍNIO DE CONTEXTO"), dominioVoltaAposColisao: aposColisao.includes("DOMÍNIO DE CONTEXTO") && aposColisao.includes("marcenaria"), dominioComRecorteSemContexto: semContexto.includes("DOMÍNIO DE CONTEXTO"), chars: b.length };
    })(),
    // v74: planejamento com conteúdos já distribuídos pelo app (lista do lote em rodízio).
    planejamentoV74: (() => {
      const base = { area: "matematica", disciplina: "Matemática", quantidade: 4, dificuldades: ["Médio", "Médio", "Fácil", "Difícil"], dominios: ["pesca e aquicultura", null, null, null], dominiosAlternativos: [] };
      const comLista = buildPlanejamentoPrompt({ ...base, tema: "MDC\nMMC\nradiciação", temasPorQuestao: ["MDC", "MMC", "radiciação\n", "MDC"] });
      const semLista = buildPlanejamentoPrompt({ ...base, tema: "Exponenciação" });
      const umSo = buildPlanejamentoPrompt({ ...base, tema: "Exponenciação", temasPorQuestao: ["Exponenciação", "Exponenciação", "Exponenciação", "Exponenciação"] });
      return {
        fixaConteudos: comLista.includes("1: MDC\n2: MMC\n3: radiciação\n4: MDC") && comLista.includes("JÁ DISTRIBUIU") && comLista.includes("Comece o campo pelo nome do conteúdo") && comLista.includes('lista de conteúdos: "MDC MMC radiciação"') && !/conteúdos: "[^"]*\n/.test(comLista) && comLista.includes('traz o campo "numero" igual a n') && comLista.includes("nunca um segundo recorte") && FERRAMENTA_RECORTES.input_schema.properties.recortes.items.properties.numero !== undefined,
        mantemDominios: comLista.includes("DOMÍNIOS DE CONTEXTO RESERVADOS") && comLista.includes("1: pesca e aquicultura"),
        semListaIgualAoV73: semLista.includes('TODAS as questões são sobre o tema pedido pelo professor: "Exponenciação"') && !semLista.includes("JÁ DISTRIBUIU"),
        umConteudoSoNaoFixa: !umSo.includes("JÁ DISTRIBUIU"),
        // v74.2: contexto curto no prompt e corte limpo no normalizador.
        contextoCurto: semLista.includes("até 200 caracteres") && FERRAMENTA_RECORTES.input_schema.properties.recortes.items.properties.contexto.description.includes("até 200 caracteres"),
        corteLimpo: cortaLimpo("Primeira frase completa e um pouco mais longa. Segunda frase que seria cortada no meio por ser longa demais", 60) === "Primeira frase completa e um pouco mais longa."
          && cortaLimpo("Uma frase sem ponto final que continua e continua até passar do limite estabelecido", 50) === "Uma frase sem ponto final que continua e continua"
          && cortaLimpo("Curta.", 60) === "Curta."
          && cortaLimpo("A cooperativa colheu 1.200 sacas de soja e 3.400 de milho nesta safra recorde", 45) === "A cooperativa colheu 1.200 sacas de soja e"
          && cortaLimpo("Valor de R$ 3.14 por unidade em uma compra grande de material para a obra da escola", 40) === "Valor de R$ 3.14 por unidade em uma"
          && !/[\s,;:(\u2013\u2014-]$/.test(cortaLimpo("Texto com vírgula, no lugar do corte, que continua além do limite estabelecido aqui", 45)),
        chars: comLista.length - semLista.length,
      };
    })(),
  });
}

// v72: sobra de notação ASCII em algum campo da questão (depois das redes
// determinísticas)? Índices com mais de uma letra (V_cone) também contam.
function temResiduoNotacao(q: any, area: string): boolean {
  const textos: string[] = [];
  for (const c of ["textoBase", "comando", "resolucaoComentada"]) if (typeof q?.[c] === "string") textos.push(q[c]);   // "tema" é do professor
  if (q?.alternativas && typeof q.alternativas === "object") for (const v of Object.values(q.alternativas)) if (typeof v === "string") textos.push(v);
  if (q?.analiseAlternativas && typeof q.analiseAlternativas === "object") for (const a of Object.values(q.analiseAlternativas) as any[]) if (a && typeof a.comentario === "string") textos.push(a.comentario);
  const v = q?.visual;
  if (v && typeof v === "object") { for (const c of ["titulo", "descricao"]) if (typeof v[c] === "string") textos.push(v[c]); for (const arr of [v.colunas, v.labels]) if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") textos.push(x); if (Array.isArray(v.linhas)) for (const l of v.linhas) if (Array.isArray(l)) for (const x of l) if (typeof x === "string") textos.push(x); }
  const indicesContam = area === "matematica" || area === "natureza";   // fora daí, "@a_silva" e "#e_agora" são nomes, não índices
  return textos.some((t) => nmAudita(t).length > 0 || (indicesContam && /(?<![\p{L}\p{Nd}@#\/])\p{L}_[\p{L}]{2,}(?![\p{L}\p{Nd}])/u.test(t)));
}
const LIMITE_FUNCAO_MS = 140_000;   // a Edge Function é encerrada em 150 s; margem de 10 s

Deno.serve(async (req: Request) => {
  const inicioReq = Date.now();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method === "GET" && new URL(req.url).searchParams.get("selftest") === "1") {
    return selfTestResponse();
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado. Use POST." }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({
      error: "Backend não configurado: falta a variável de ambiente ANTHROPIC_API_KEY nos secrets deste projeto Supabase.",
    }, 500);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "JSON inválido." }, 400); }
  if (body?.selftest === true) return selfTestResponse();

  const area = (body.area || "").toString();
  if (!AREA_LABELS[area]) {
    return jsonResponse({ error: `Campo 'area' inválido ou ausente. Use um destes valores: ${Object.keys(AREA_LABELS).join(", ")}.` }, 400);
  }
  const disciplina = (body.disciplina || "").toString().trim();
  if (!disciplina) {
    return jsonResponse({ error: "Campo 'disciplina' é obrigatório (ex.: 'Física', 'História', 'Matemática')." }, 400);
  }
  const dificuldade = ["Fácil", "Médio", "Difícil"].includes(body.dificuldade) ? body.dificuldade : "Médio";
  const tema = (body.tema || "").toString().trim();
  const instrucoesVisual = (body.instrucoesVisual || "").toString().trim().slice(0, 1000);
  // Letra que o professor reservou para a resposta correta desta questão.
  const gabaritoAlvoRaw = (body.gabaritoAlvo || "").toString().trim().toUpperCase();
  const gabaritoAlvo = ["A", "B", "C", "D", "E"].includes(gabaritoAlvoRaw) ? gabaritoAlvoRaw : null;

  /* v64 — planejamento de recortes: várias questões com o mesmo tema. */
  if (body.planejarRecortes === true) {
    if (!tema) return jsonResponse({ error: "Campo 'tema' é obrigatório para planejar recortes." }, 400);
    const qtdRaw = Number(body.quantidade);
    const quantidade = Number.isFinite(qtdRaw) ? Math.max(2, Math.min(30, Math.round(qtdRaw))) : 2;
    const dificuldades: string[] = Array.isArray(body.dificuldades)
      ? body.dificuldades.slice(0, quantidade).map((d: unknown) => ["Fácil", "Médio", "Difícil"].includes(String(d)) ? String(d) : "Médio")
      : [];
    // v73: domínios de contexto reservados pelo app, um por questão (ou null).
    const limpaDominios = (v: unknown): (string | null)[] => Array.isArray(v)
      ? v.slice(0, quantidade).map((d: unknown) => { const t = String(d || "").trim().slice(0, 80); return t || null; })
      : [];
    const dominios = limpaDominios(body.dominios);
    const dominiosAlternativos = limpaDominios(body.dominiosAlternativos);
    // v74: conteúdo já distribuído pelo app para cada questão (lista do lote em rodízio).
    const temasPorQuestao: (string | null)[] = Array.isArray(body.temasPorQuestao)
      ? body.temasPorQuestao.slice(0, quantidade).map((t: unknown) => { const v = String(t || "").replace(/\s+/g, " ").trim().slice(0, 120); return v || null; })
      : [];
    const usos: any[] = [];
    try {
      // Sem cache_control de propósito: o prompt é pequeno e a chamada é única.
      const system: SistemaPrompt = [{ type: "text", text: buildSystemPlanejamento(area) }];
      const userMsg = buildPlanejamentoPrompt({ area, disciplina, tema, quantidade, dificuldades, dominios, dominiosAlternativos, temasPorQuestao });
      let data = await callClaudeForJSON(system, userMsg, false, usos, FERRAMENTA_RECORTES);
      let recortes = normalizarRecortes(data, quantidade);
      if (!recortes.length) {
        /* v65: forma inesperada — registra o que veio e pede UMA vez mais,
           dizendo exatamente o formato. Só quando a primeira já se perdeu. */
        console.error(`[tema] planejamento "${tema}": resposta sem recortes utilizáveis — forma recebida: ${JSON.stringify(data).slice(0, 700)}`);
        const correcao = `${userMsg}

ATENÇÃO — sua resposta anterior não pôde ser usada: o argumento da ferramenta "entregar_recortes" precisa ser exatamente {"recortes": [ {"conteudo": "...", "contexto": "...", "habilidade": "..."}, ... ]} — uma LISTA de ${quantidade} objetos, com estas três chaves em minúsculas e sem acento, cada valor uma string. Reenvie o plano nesse formato.`;
        data = await callClaudeForJSON(system, correcao, false, usos, FERRAMENTA_RECORTES);
        recortes = normalizarRecortes(data, quantidade);
      }
      if (!recortes.length) return jsonResponse({ error: "O modelo não devolveu recortes utilizáveis." }, 502);
      // v70: o recorte entra no prompt da questão ("conteúdo: … CO2 …") e o
      // modelo copia a grafia — foi assim que a questão 2 de 11/09 saiu com
      // "CO2". Corrige na origem (conteúdo e contexto; a habilidade é texto
      // oficial e não é tocada).
      // v71: todas as áreas, química e depois matemática ("potências 2^4" no
      // recorte viraria "2^4" na questão).
      const nRec = (t: string) => nmNormalizaTexto(normalizarNotacaoTexto(t, disciplina));
      recortes = recortes.map((r) => ({ ...r, conteudo: nRec(r.conteudo), contexto: nRec(r.contexto) }));
      const uso = resumoUso(usos);
      console.log(`[tema] planejamento "${tema}" (${disciplina})${temasPorQuestao.filter(Boolean).length ? ` · conteúdos fixados: ${temasPorQuestao.map((t, i) => `${i + 1}: ${t || "—"}`).join(", ")}` : ""}: ${recortes.length}/${quantidade} recorte(s) · ` + recortes.map((r, i) => `${i + 1}${r.numero ? ` (nº ${r.numero})` : ""}: ${r.conteudo}`).join(" · "));
      await logGeneration(area, disciplina, `[planejar recortes] ${tema}`, { recurso: "planejamento", uso });
      return jsonResponse({ recortes, uso });
    } catch (err) {
      return jsonResponse({ error: `Erro ao planejar os recortes do tema: ${String((err as any)?.message || err)}` }, 502);
    }
  }

  if (body.regenerarVisual === true) {
    const recurso = ["imagem", "grafico", "tabela"].includes(body.recurso) ? body.recurso : null;
    if (!recurso) {
      return jsonResponse({ error: "Campo 'recurso' inválido para refazer o recurso visual. Use 'imagem', 'grafico' ou 'tabela'." }, 400);
    }
    const textoBase = (body.textoBase || "").toString();
    const comando = (body.comando || "").toString();
    const gabarito = (body.gabarito || "").toString();
    const resolucaoComentada = (body.resolucaoComentada || "").toString();
    const alternativas = (body.alternativas && typeof body.alternativas === "object") ? body.alternativas : {};

    const capResponse = await checkDailyCap();
    if (capResponse) return capResponse;

    const usos: any[] = [];
    try {
      // v69: sistema enxuto — a imagem não precisa do modelo pedagógico inteiro.
      const system = buildSystemVisual(area);
      const userMsg = buildVisualRedoPrompt({ tema, disciplina, recurso, textoBase, comando, alternativas, gabarito, resolucaoComentada, instrucoesVisual });
      const data = await callClaudeForJSON(system, userMsg, false, usos, ferramentaVisualPara(recurso));
      if (!data || !data.visual) {
        return jsonResponse({ error: "O modelo não retornou um novo recurso visual válido." }, 502);
      }
      // v62: o recurso refeito também tem de ser do tipo pedido e utilizável.
      const visualNovo = normalizarVisual(data.visual, recurso);
      const conf = visualConforme(visualNovo, recurso);
      if (!conf.ok) {
        console.error(`[visual] refazer "${tema}" (${disciplina}): ${conf.motivo}`);
        return jsonResponse({ error: `O modelo não entregou o recurso visual pedido (${conf.motivo}). Tente novamente.` }, 502);
      }
      const usoRefazer = resumoUso(usos);
      await logGeneration(area, disciplina, `[refazer visual] ${tema}`, { recurso, uso: usoRefazer });
      // v70/v71: descrição/título/tabela/rótulos do recurso refeito com a
      // notação certa — química (todas as áreas) e matemática. A matemática
      // recebe a questão inteira (texto-base, comando, alternativas,
      // resolução), porque a regra "letra + dígito" (Q0 → Q₀) só decide com o
      // contexto da questão; daqui sai só o visual.
      const visualQuimica = normalizarNotacaoVisual(visualNovo, disciplina);
      const contexto = normalizarNotacaoMatematica({ textoBase, comando, alternativas, resolucaoComentada, visual: visualQuimica }, disciplina);
      const visualSaida = contexto && contexto.visual ? contexto.visual : visualQuimica;
      return jsonResponse({ visual: corrigirQuebrasLiterais(visualSaida), uso: usoRefazer });
    } catch (err) {
      return jsonResponse({ error: `Erro ao refazer o recurso visual: ${String((err as any)?.message || err)}` }, 502);
    }
  }

  const recurso = ["nenhum", "imagem", "grafico", "tabela"].includes(body.recurso) ? body.recurso : "nenhum";
  const competenciaNum = typeof body.competenciaNum === "number" ? body.competenciaNum : null;
  const habilidadeCod = body.habilidadeCod ? String(body.habilidadeCod) : null;
  // v63 — diversidade temática (ver buildDiversidadeTematica). Só faz sentido
  // com tema em branco; com tema do professor o eixo é ignorado, e os
  // assuntos a evitar continuam valendo se o app os mandar.
  const eixoTematico = tema ? "" : (body.eixoTematico || "").toString().trim().slice(0, 300);
  // v64 — recorte planejado (ver planejarRecortes): só com tema digitado.
  const recorte = tema ? (body.recorte || "").toString().trim().slice(0, 800) : "";   // v74.2: era 600 (contexto passou de 250 para 320)
  // v73: teto 40 (era 30) e itens de 120 caracteres — ver temasEvitarPara no app.
  const listaCurta = (v: unknown, maxItens: number, maxChars: number): string[] => Array.isArray(v)
    ? Array.from(new Set(v.map((t: unknown) => String(t || "").trim().slice(0, maxChars)).filter((t: string) => t))).slice(0, maxItens) as string[]
    : [];
  const temasEvitar: string[] = listaCurta(body.temasEvitar, 40, 120);
  // v73 — diversidade de exemplos sem custo (reservas feitas pelo app):
  // subtópico oficial só sem tema; domínio de contexto em qualquer leva.
  const subtopico = tema ? "" : (body.subtopico || "").toString().trim().slice(0, 200);
  const dominioContexto = (body.dominioContexto || "").toString().trim().slice(0, 80);
  const dominioAlternativo = (body.dominioAlternativo || "").toString().trim().slice(0, 80);
  const dominiosEvitar: string[] = listaCurta(body.dominiosEvitar, 40, 80);
  const contextosEvitar: string[] = listaCurta(body.contextosEvitar, 10, 120);
  const diversidade: DiversidadeExtras = { subtopico, dominioContexto, dominioAlternativo, dominiosEvitar, contextosEvitar };

  const capResponse = await checkDailyCap();
  if (capResponse) return capResponse;

  const usos: any[] = [];
  try {
    const system: SistemaPrompt = [
      { type: "text", text: buildSystemPrompt(area), cache_control: { type: "ephemeral" } },
      { type: "text", text: buildBlocoFixo({ area, disciplina, recurso, competenciaNum, habilidadeCod }), cache_control: { type: "ephemeral" } },
    ];
    const userMsg = buildUserPrompt({ area, disciplina, tema, dificuldade, recurso, competenciaNum, habilidadeCod, instrucoesVisual, gabaritoAlvo, eixoTematico, temasEvitar, recorte, diversidade });
    const webSearch = precisaFontesReais(disciplina) ? webSearchTool(disciplina) : false;
    // v62: a ferramenta de entrega é específica do recurso pedido (com
    // imagem/gráfico/tabela, o campo "visual" é obrigatório e tipado).
    let data = await callClaudeForJSON(system, userMsg, webSearch, usos, ferramentaQuestaoPara(recurso));
    // v67: alternativas/análise/competência/habilidade sempre como objeto.
    data = normalizarCamposEstruturados(data);
    // "promptImagem"/"descricao" sempre como string — ver normalizarVisual().
    if (data && typeof data === "object") data.visual = normalizarVisual(data.visual, recurso);
    // v62: recurso pedido = recurso entregue, ou o backend refaz só o visual.
    const visualDiag = await garantirVisual(data, { area, disciplina, recurso, tema, instrucoesVisual }, usos);

    /* REVISÃO MATEMÁTICA — agente separado (review-math-question), acionado
       só para questões de matemática, logo depois do rascunho. Corrige SÓ
       quando encontra lastro no banco de referência (63 livros); sem
       cobertura, a questão segue como está. Uma falha aqui (rede, parsing,
       function fora do ar) nunca pode derrubar a entrega da questão —
       mantém-se o resultado do rascunho. */
    const revisarMatematica = body.revisarMatematica !== false;
    /* v72: as redes determinísticas rodam ANTES do revisor, para que ele só
       receba o que elas não resolvem; rodam de novo no fim (idempotentes). */
    data = normalizarNotacaoMatematica(normalizarNotacaoQuimica(data, area, disciplina), disciplina);
    const residuoAntes = temResiduoNotacao(data, area);
    let notacaoDiag: any = { residuoAntesDoRevisor: residuoAntes, revisorChamado: false };
    // O revisor é chamado em Matemática (contas + notação) e, nas demais áreas,
    // só quando sobrou notação ASCII (passe de notação, uma chamada curta).
    if ((area === "matematica" && revisarMatematica) || residuoAntes) {
      /* Relógio de segurança nesta ponta também: a review-math-question faz
         embedding + busca vetorial + até três chamadas não streaming à
         Anthropic (contas + 2 tentativas de notação), cada uma com seu próprio
         timeout — mas, sem um limite aqui, uma trava na rede entre as duas
         funções ainda seguraria a entrega. O orçamento é o que resta dos 140 s
         da função, e vai junto no corpo (prazoMs) para o revisor se organizar. */
      const restante = LIMITE_FUNCAO_MS - (Date.now() - inicioReq);
      if (restante < 20_000) {
        notacaoDiag.pulado = `sem tempo para o revisor (restavam ${Math.round(restante / 1000)} s)`;
      } else {
        const prazoMs = Math.min(restante - 5_000, 110_000);
        const reviewController = new AbortController();
        const reviewWatchdog = setTimeout(() => reviewController.abort(), prazoMs + 3_000);
        try {
          const reviewResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/review-math-question`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ question: data, area, disciplina, prazoMs, soNotacao: area !== "matematica" }),
            signal: reviewController.signal,
          });
          if (reviewResp.ok) {
            const reviewData = await reviewResp.json();
            if (reviewData?.question && typeof reviewData.question === "object") {
              data = reviewData.question;
            }
            notacaoDiag = { ...notacaoDiag, revisorChamado: true, contas: { alterado: reviewData?.alterado === true, cobertura: reviewData?.coberturaEncontrada === true }, notacao: reviewData?.notacao ?? null };
          } else {
            notacaoDiag.erro = `review-math-question HTTP ${reviewResp.status}`;
          }
        } catch (e) {
          // Mantém a questão como veio do rascunho — nunca falha a geração por
          // causa do revisor (inclui o timeout acima).
          notacaoDiag.erro = String((e as any)?.message || e).slice(0, 200);
        } finally {
          clearTimeout(reviewWatchdog);
        }
      }
    }

    // De novo, depois da revisão matemática: idempotente, e garante o tipo na saída.
    data = normalizarCamposEstruturados(data);
    if (data && typeof data === "object") data.visual = normalizarVisual(data.visual, recurso);
    // v62: a revisão matemática devolve a questão inteira — o recurso visual
    // garantido acima não pode ter sido perdido no caminho. Se foi, reaplica.
    if (data && typeof data === "object" && ["imagem", "grafico", "tabela"].includes(recurso) && !visualConforme(data.visual, recurso).ok && visualDiag.conforme) {
      const diag2 = await garantirVisual(data, { area, disciplina, recurso, tema, instrucoesVisual }, usos);
      visualDiag.refeito += diag2.refeito;
      visualDiag.tentativasRefazer.push(...diag2.tentativasRefazer.map((t: string) => `pós-revisão ${t}`));
      visualDiag.conforme = diag2.conforme;
      visualDiag.motivo = diag2.motivo;
      visualDiag.entregueTipo = diag2.entregueTipo;
      visualDiag.promptChars = diag2.promptChars;
    }
    const diversidadeDiag = {
      eixoTematico: eixoTematico || null,
      recorte: recorte || null,
      subtopico: subtopico || null,
      dominioContexto: dominioContexto || null,
      dominioAlternativo: dominioAlternativo || null,
      dominiosEvitar: dominiosEvitar.length,
      contextosEvitar: contextosEvitar.length,
      temasEvitar: temasEvitar.length,
      temaEntregue: data && typeof data === "object" ? String(data.tema || "") : "",
      objetoEntregue: data && typeof data === "object" ? String(data.objetoConhecimento || "") : "",
      eixoRespeitado: eixoTematico ? (data && typeof data === "object" && String(data.objetoConhecimento || "").trim().toLowerCase() === eixoTematico.toLowerCase()) : null,
    };
    if (eixoTematico) console.log(`[tema] "${diversidadeDiag.temaEntregue}" · eixo pedido "${eixoTematico}" · objeto entregue "${diversidadeDiag.objetoEntregue}" · respeitado ${diversidadeDiag.eixoRespeitado} · evitar ${temasEvitar.length} assunto(s)`);
    if (recorte) console.log(`[tema] "${diversidadeDiag.temaEntregue}" · recorte reservado "${recorte.slice(0, 160)}" · evitar ${temasEvitar.length} assunto(s)`);
    if (subtopico || dominioContexto) console.log(`[contexto] "${diversidadeDiag.temaEntregue}"${subtopico ? ` · subtópico "${subtopico}"` : ""}${dominioContexto ? ` · domínio "${dominioContexto}"${dominioAlternativo ? ` (ou "${dominioAlternativo}")` : ""} · ${dominiosEvitar.length} domínio(s) proibido(s)` : ""}${contextosEvitar.length ? ` · ${contextosEvitar.length} cenário(s) a evitar` : ""}`);
    // v63: o registro vai por último, com TODAS as chamadas desta questão
    // (rascunho, refazer visual, retentativas) já somadas em "usos".
    const uso = resumoUso(usos);
    await logGeneration(area, disciplina, tema, { recurso, uso });
    // v70/v71: redes de segurança da notação — química (lista fechada de
    // fórmulas; em todas as áreas desde a v71) e depois matemática (expoentes,
    // índices, × e ·). Por último, depois de tudo o que pode ter reescrito a
    // questão (garantia do visual, revisão matemática). A ordem importa: a
    // química converte H2O → H₂O antes que a matemática veja "letra + dígito".
    data = normalizarNotacaoQuimica(data, area, disciplina);
    data = normalizarNotacaoMatematica(data, disciplina);
    notacaoDiag.residuoFinal = temResiduoNotacao(data, area);
    if (notacaoDiag.residuoFinal) console.warn(`[notação] resíduo ASCII na questão entregue (${disciplina}: "${String(data?.tema || "").slice(0, 60)}") — ` + JSON.stringify(notacaoDiag.notacao?.residuosDepois ?? notacaoDiag));
    else if (notacaoDiag.residuoAntesDoRevisor) console.log(`[notação] resíduo corrigido pelo revisor (${notacaoDiag.notacao?.tentativas ?? "?"} tentativa(s))`);
    return jsonResponse({ question: corrigirQuebrasLiterais(data), uso, visualDiag, diversidadeDiag, notacaoDiag });
  } catch (err) {
    return jsonResponse({ error: `Erro ao gerar questão: ${String((err as any)?.message || err)}` }, 502);
  }
});
