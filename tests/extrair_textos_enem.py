#!/usr/bin/env python3
"""Extrai, dos PDFs oficiais do INEP, o material de cada questão do ENEM para o
   BANCO DE TEXTOS DO ENEM (camada zero das fontes — decisão do professor,
   21/09/2026): texto-base, referência, comando, alternativas e gabarito.

   Por que existe: os textos das provas já foram conferidos pelo INEP — autor,
   obra e referência reais. Reaproveitá-los como texto-base de itens NOVOS
   elimina a invenção de fonte e a pesquisa na internet para os temas que as
   provas cobrem. Este script é a etapa 1 (extração bruta + heurísticas); a
   etapa 3 (classificação por tema, separação fina texto/referência/comando,
   autor e obra) é feita pelo modelo, a partir do campo "bruto".

   Uso:
     python3 tests/extrair_textos_enem.py <pasta provas> <pasta saída> [anos...]

   Saída: <saída>/textos_enem_bruto.jsonl (uma linha por questão) e
          <saída>/resumo_extracao.txt.

   Estrutura das provas (fixa, por ano — o INEP mudou a ordem das áreas):
     2009:       Dia1 = CN (1-45) + CH (46-90)   Dia2 = LC (91-135) + MT (136-180)
     2010-2016:  Dia1 = CH (1-45) + CN (46-90)   Dia2 = LC (91-135) + MT (136-180)
     2017-2025:  Dia1 = LC (1-45) + CH (46-90)   Dia2 = CN (91-135) + MT (136-180)
   Em LC, as questões 1-5 (ou 91-95) são de língua estrangeira (inglês/espanhol
   duplicadas no caderno) e ficam marcadas.

   2021: o PDF tem a codificação de fonte quebrada (texto sai como lixo);
   é pulado e apontado no resumo. Só OCR resolveria.

   Leitura do PDF (v2): cada página é recortada em duas metades geométricas
   (pdftotext -x/-W) e lida em ordem natural; ver fluxo_por_colunas. Questões
   segmentadas por "Questão N" / "QUESTÃO NN". """
import os, re, sys, json, subprocess, unicodedata

LET = ["A", "B", "C", "D", "E"]
QRE = re.compile(r"^\s*quest[ãa]o\s+(\d{1,3})\b", re.I)
# Cabeçalhos e cromos de página. SEM re.I: em caixa alta são cabeçalho ("CIÊNCIAS
# HUMANAS…"); em minúscula são texto da questão ("ciências, tecnologias e culturas"
# — uma linha da Declaração da ONU que a versão anterior apagava).
LIXO = re.compile(r"^(\*[A-Z0-9]|[–-]?\s*(LC|CH|CN|MT)\s*[-–]|LINGUAGENS|CIÊNCIAS (HUMANAS|DA NATUREZA)|MATEMÁTICA E SUAS|CADERNO|\d{4}$|Caderno \d|ENEM\d{4}|Quest[õo]es de \d+ a \d+|PROVA DE )")
RODAPE = re.compile(r"(Caderno\s*\d|Aplica[çc][ãa]o|\bAZUL\b|[–-]?\s*\b(LC|CH|CN|MT)\b\s*[•·|–-]|\b\d[ºo]\s*DIA\b|^\s*\d{1,2}\s*$|ENEM\s*20\d\d\s*ENEM)", re.I)
# marca FORTE de referência bibliográfica: SOBRENOME, I. / "Disponível em" / "Acesso em" / (adaptado) / In:
REF = re.compile(r"((?:^|[\s(])[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}(?:\s(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}|DE|DA|DO|DOS|DAS|E|JR\.?))*,\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]\.|Dispon[íi]vel em|Acesso em|\(adaptado\)|\(fragmento\)|\bIn:\s|\bwww\.|\bhttps?://)")
# marca FRACA: continuação de referência (editora, ano, páginas, cidade: editora)
REF_CONT = re.compile(r"(\b(1[5-9]|20)\d{2}\b|\bEd\.|\bEditora\b|\bp\.\s*\d|\bv\.\s*\d|\bn\.\s*\d|\bTradu[çc][ãa]o\b|:\s*[A-Z][\w&.\s]{1,30},\s*(1[5-9]|20)\d{2}|\(adaptado\)|s\.d\.)")

def area_de(ano, numero):
    a = int(ano)
    if 1 <= numero <= 45:
        return "natureza" if a == 2009 else ("humanas" if a <= 2016 else "linguagens")
    if 46 <= numero <= 90:
        return "humanas" if a == 2009 else ("natureza" if a <= 2016 else "humanas")
    if 91 <= numero <= 135:
        return "linguagens" if a <= 2016 else "natureza"
    if 136 <= numero <= 180:
        return "matematica"
    return None

def lingua_estrangeira(ano, numero):
    a = int(ano)
    return (a <= 2016 and 91 <= numero <= 95) or (a >= 2017 and 1 <= numero <= 5)

def pdf(caminho, modo="-layout"):
    return subprocess.run(["pdftotext", modo, caminho, "-"], capture_output=True, timeout=180).stdout.decode("utf-8", "ignore")

def tamanhos_paginas(caminho):
    """(largura, altura) de CADA página — o caderno de 2009 mistura capa em
    outro formato com páginas A4; tomar a primeira para todas cortava as colunas
    no lugar errado."""
    info = subprocess.run(["pdfinfo", "-f", "1", "-l", "400", caminho], capture_output=True, timeout=60).stdout.decode("utf-8", "ignore")
    tam = {}
    for m in re.finditer(r"Page\s+(\d+)\s+size:\s+([\d.]+) x ([\d.]+)", info):
        tam[int(m.group(1))] = (float(m.group(2)), float(m.group(3)))
    if not tam:
        m = re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", info)
        n = int((re.search(r"Pages:\s+(\d+)", info) or [0, "0"])[1])
        for i in range(1, n + 1): tam[i] = (float(m.group(1)), float(m.group(2))) if m else (595.0, 842.0)
    return tam

def coluna(caminho, pagina, x, w, h):
    return subprocess.run(["pdftotext", "-layout", "-f", str(pagina), "-l", str(pagina), "-x", str(int(x)), "-y", "0", "-W", str(int(w)), "-H", str(int(h) + 2), caminho, "-"],
                          capture_output=True, timeout=120).stdout.decode("utf-8", "ignore")

def calhas(caminho):
    """Posição da calha (corredor entre as duas colunas) em CADA página, em
    pontos, medida pelas caixas das palavras (pdfplumber). O meio geométrico
    não serve: nos cadernos de 2014 e 2019 a calha fica ~5 pt à esquerda do
    centro, e o recorte no centro decepava o fim das linhas da coluna esquerda.
    Devolve {página: (x_da_calha ou None se coluna única, largura, altura)} — tudo em MediaBox."""
    import pdfplumber
    out = {}
    with pdfplumber.open(caminho) as doc:
        for i, pg in enumerate(doc.pages, start=1):
            # O caderno de 2024 tem CropBox deslocado (34 pt): pdfplumber mede no
            # MediaBox, pdftotext -x recorta no CropBox. Tudo aqui é convertido
            # para coordenadas do CropBox, que é o que pdfinfo/pdftotext usam.
            # Medido: pdftotext -x/-W recorta em coordenadas do MEDIABOX (não do
            # CropBox), e pdfplumber também mede no MediaBox — então a calha sai
            # daqui já na unidade certa. O CropBox (deslocado 34 pt em 2024) só
            # serve para ignorar cabeçalho e rodapé.
            cx0, cy0, cx1, cy1 = [float(v) for v in pg.cropbox]
            mx0, my0, mx1, my1 = [float(v) for v in pg.mediabox]
            W = int(mx1 - mx0); H = my1 - my0
            try: words = pg.extract_words()
            except Exception: words = []
            cov = [0] * (W + 1)
            for wd in words:
                if wd["top"] < cy0 + 40 or wd["bottom"] > cy1 - 40: continue
                # cromo de página ("ENEM2024ENEM2024…", "4202MENE…") e faixas que
                # atravessam a página inteira não são texto de coluna
                if (wd["x1"] - wd["x0"]) > 0.4 * W or re.search(r"ENEM\d{4}|\d{4}MENE", wd["text"]): continue
                for x in range(max(0, int(wd["x0"] - mx0)), min(W, int(wd["x1"] - mx0) + 1)): cov[x] += 1
            melhor = (0, None); ini = None
            for x in range(int(W * .30), int(W * .70) + 1):
                if cov[x] == 0:
                    if ini is None: ini = x
                else:
                    if ini is not None and x - ini > melhor[0]: melhor = (x - ini, (ini + x) / 2)
                    ini = None
            if ini is not None and int(W * .70) + 1 - ini > melhor[0]: melhor = (int(W * .70) + 1 - ini, (ini + int(W * .70) + 1) / 2)
            out[i] = (melhor[1] if melhor[0] >= 4 else None, W, H)
    return out

def fluxo_por_colunas(caminho):
    """v2 (21/09): em vez de -layout na página inteira + corte no corredor branco
    em caracteres (que truncava as referências em fonte pequena, alinhadas à
    direita), recorta cada página nas duas colunas (pdftotext -x/-W, na calha
    medida por calhas()) e lê cada coluna em -layout. Referências saem inteiras;
    as letras das alternativas ficam como o caderno as imprime; uma questão que
    vira de coluna/página continua na ordem certa. Página sem calha (coluna
    única) é lida inteira. Devolve as linhas do caderno: esquerda → direita,
    página a página."""
    fluxo = []
    cal = calhas(caminho)
    for pg, (x, w, h) in sorted(cal.items()):
        if x is None:
            partes = [coluna(caminho, pg, 0, w + 1, h)]
        else:
            partes = [coluna(caminho, pg, 0, x, h), coluna(caminho, pg, x, w - x + 1, h)]
        for txt in partes:
            fluxo.extend(txt.split("\n")); fluxo.append("")
    return fluxo

def cinco(linhas):
    """as cinco alternativas e a linha em que começa a A — ou None"""
    ini = {}
    for i, L in enumerate(linhas):
        s = L.strip()
        if s in LET and i + 1 < len(linhas) and linhas[i + 1].strip().startswith(s + " "):
            ini.setdefault(s, []).append((i + 1, linhas[i + 1].strip()[2:].strip())); continue
        m = re.match(r"^([A-E])\s+(\S.*)$", s)
        if m and not (i > 0 and linhas[i - 1].strip() == m.group(1)):
            ini.setdefault(m.group(1), []).append((i, m.group(2).strip()))
    if any(l not in ini for l in LET): return None, None
    esc = {}; lim = len(linhas) + 1
    for l in reversed(LET):
        c = [p for p in ini[l] if p[0] < lim]
        if not c: return None, None
        esc[l] = c[-1]; lim = c[-1][0]
    ordem = [esc[l][0] for l in LET]; out = {}
    for k, l in enumerate(LET):
        a = esc[l][0]; fim = ordem[k + 1] if k + 1 < len(ordem) else len(linhas)
        partes = [esc[l][1]]; usadas = 0
        for j in range(a + 1, fim):
            s = linhas[j].strip()
            if not s: continue
            if LIXO.match(s) or RODAPE.search(s) or QRE.match(s) or re.match(r"^\d{1,3}$", s) or s in LET: break
            partes.append(s); usadas += 1
            if usadas >= 4: break
        t = " ".join(partes).strip()
        if not (1 <= len(t) <= 400): return None, None
        out[l] = t
    inicio = esc["A"][0] - (1 if esc["A"][0] > 0 and linhas[esc["A"][0] - 1].strip() == "A" else 0)
    return out, inicio

def cinco_sem_letras(linhas):
    """2010 (caderno regular): as letras A-E são glifos que o pdftotext não
    devolve — as alternativas saem como cinco parágrafos recuados no fim da
    questão, sem letra. Toma os cinco últimos parágrafos curtos (≤ 400
    caracteres) do bloco. Devolve (alternativas, índice da primeira linha)."""
    pars = []; atual = None
    for i, L in enumerate(linhas):
        s = L.rstrip()
        if not s.strip():
            if atual: pars.append(atual); atual = None
            continue
        if LIXO.match(s.strip()) or RODAPE.search(s) or QRE.match(s) or re.match(r"^\s*\d{1,3}\s*$", s):
            if atual: pars.append(atual); atual = None
            continue
        recuo = len(s) - len(s.lstrip())
        if atual is not None and recuo >= 3 and not REF.search(s):
            pars.append(atual); atual = None
        if atual is None: atual = [i, s.strip()]
        else: atual[1] += " " + s.strip()
    if atual: pars.append(atual)
    if len(pars) < 6: return None, None
    ult = pars[-5:]
    if any(not (2 <= len(p[1]) <= 400) for p in ult): return None, None
    return {l: re.sub(r"\s+", " ", p[1]).strip() for l, p in zip(LET, ult)}, ult[0][0]

def paragrafos(linhas):
    """parágrafo = bloco entre linhas em branco; recuo de 4+ espaços também abre
    parágrafo (modo -layout). Linhas de referência (REF) grudadas ao fim de um
    parágrafo são destacadas como parágrafo próprio, para separa() reconhecê-las."""
    pars = []; atual = []
    def fecha():
        nonlocal atual
        if not atual: return
        # cauda de referência: começa na última linha com marca FORTE (entre as 4
        # finais) e vai até o fim, desde que as linhas seguintes sejam curtas e
        # pareçam continuação (ano, editora, páginas)
        corte = None
        for i in range(max(0, len(atual) - 4), len(atual)):
            if REF.search(atual[i]) and len(atual[i]) <= 200:
                if all(len(l) <= 160 and (REF.search(l) or REF_CONT.search(l)) for l in atual[i + 1:]):
                    corte = i; break
        cauda = atual[corte:] if corte is not None else []
        corpo = atual[:corte] if corte is not None else atual
        if corpo: pars.append(" ".join(corpo))
        if cauda: pars.append(" ".join(cauda))
        atual = []
    for L in linhas:
        s = L.rstrip()
        if not s.strip(): fecha(); continue
        if LIXO.match(s.strip()) or RODAPE.search(s) or re.match(r"^\s*\d{1,3}\s*$", s): continue
        recuo = len(s) - len(s.lstrip())
        if atual and recuo >= 4 and not (REF.search(s) or REF_CONT.search(s)): fecha()
        atual.append(s.strip())
    fecha()
    return [re.sub(r"\s+", " ", p).strip() for p in pars if p.strip()]

def separa(pars):
    """heurística: comando = último parágrafo; referência = parágrafos com marcas de referência; texto = o resto"""
    if not pars: return "", "", ""
    comando = pars[-1]; corpo = pars[:-1]
    # comando muito curto colado no anterior (ex.: "assinale:")? junta
    if len(comando) < 25 and corpo:
        comando = corpo[-1] + " " + comando; corpo = corpo[:-1]
    refs = [p for p in corpo if REF.search(p) and len(p) <= 350]
    texto = [p for p in corpo if p not in refs]
    return "\n".join(texto).strip(), " ".join(refs).strip(), comando.strip()

def gabaritos(caminho):
    """Gabarito oficial: linhas "91 A" ou tabelas "91 A C 137 B" (inglês/espanhol
    lado a lado: fica a primeira letra, inglês). Um PDF "com_gab" (gabarito só
    marcado em destaque na prova) não tem texto extraível → dicionário vazio."""
    g = {}
    if not caminho or not os.path.exists(caminho): return g
    txt = pdf(caminho, "-raw")
    for m in re.finditer(r"(?<![A-Za-z\d])(\d{1,3})\s+([A-E])(?![A-Za-z])", txt):
        n = int(m.group(1))
        if 1 <= n <= 180: g.setdefault(n, m.group(2))
    return g

def acha_arquivos(pasta_ano):
    provas = []
    for f in sorted(os.listdir(pasta_ano)):
        fl = f.lower()
        if not fl.endswith(".pdf"): continue
        if "gabarito" in fl or "com_gab" in fl: continue
        m = re.search(r"dia\s*_?(\d)", fl)
        if not m: continue
        dia = int(m.group(1))
        aplicacao = "PPL" if "ppl" in fl else "regular"
        # gabarito correspondente
        cand = [g for g in os.listdir(pasta_ano) if g.lower().endswith(".pdf") and (("gabarito" in g.lower()) or ("com_gab" in g.lower()))
                and re.search(r"dia\s*_?%d" % dia, g.lower()) and (("ppl" in g.lower()) == (aplicacao == "PPL"))]
        provas.append((os.path.join(pasta_ano, f), dia, aplicacao, os.path.join(pasta_ano, cand[0]) if cand else None))
    return provas

def main(base, saida, anos):
    os.makedirs(saida, exist_ok=True)
    out = open(os.path.join(saida, "textos_enem_bruto.jsonl"), "w", encoding="utf-8")
    resumo = []; total = 0; com_texto = 0
    for ano in anos:
        pasta = os.path.join(base, ano)
        if not os.path.isdir(pasta): resumo.append(f"{ano}: pasta ausente"); continue
        if ano == "2021":
            resumo.append("2021: PULADO — PDF com codificação de fonte quebrada (texto ilegível); só OCR resolveria"); continue
        for caminho, dia, aplicacao, gab_path in acha_arquivos(pasta):
            gab = gabaritos(gab_path)
            fluxo = fluxo_por_colunas(caminho)
            bl = {}; q = None
            for L in fluxo:
                m = QRE.match(L)
                if m:
                    q = int(m.group(1)); bl.setdefault(q, []); continue
                if q is not None: bl[q].append(L)
            n_q = 0; n_txt = 0; n_alt = 0
            for numero, linhas in sorted(bl.items()):
                area = area_de(ano, numero)
                if not area: continue
                alts, ini = cinco(linhas)
                sem_letras = False
                if not alts:
                    alts, ini = cinco_sem_letras(linhas); sem_letras = bool(alts)
                pre = linhas[:ini] if ini is not None else linhas
                pars = paragrafos(pre)
                texto, referencia, comando = separa(pars)
                bruto = "\n".join(pars)
                if len(bruto) < 40 and not alts: continue   # bloco vazio (página de instruções)
                letras = sum(1 for c in texto if c.isalpha()); simb = sum(1 for c in texto if not c.isalnum() and not c.isspace())
                legivel = letras >= 0.6 * max(1, letras + simb)
                reg = {
                    "ano": int(ano), "aplicacao": aplicacao, "dia": dia, "numero": numero, "area": area,
                    "lingua_estrangeira": lingua_estrangeira(ano, numero),
                    "gabarito": gab.get(numero), "texto": texto, "referencia": referencia, "comando": comando,
                    "alternativas": alts, "alternativas_sem_letra": sem_letras, "bruto": bruto,
                    "chars_texto": len(texto), "tem_texto": len(texto) >= 120 and legivel,
                    "possivel_imagem": len(texto) < 120, "legivel": legivel,
                    "arquivo": os.path.basename(caminho),
                }
                out.write(json.dumps(reg, ensure_ascii=False) + "\n")
                n_q += 1; total += 1
                if reg["tem_texto"]: n_txt += 1; com_texto += 1
                if alts: n_alt += 1
            resumo.append(f"{ano} {aplicacao} dia {dia}: {n_q} questões · {n_txt} com texto-base extraível · {n_alt} com as 5 alternativas · gabaritos {len(gab)} · {os.path.basename(caminho)}")
    out.close()
    resumo.append(f"\nTOTAL: {total} questões · {com_texto} com texto-base extraível")
    with open(os.path.join(saida, "resumo_extracao.txt"), "w", encoding="utf-8") as f: f.write("\n".join(resumo) + "\n")
    print("\n".join(resumo))

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(__doc__)
    base, saida = sys.argv[1], sys.argv[2]
    anos = sys.argv[3:] or [str(a) for a in range(2009, 2026)]
    main(base, saida, anos)
