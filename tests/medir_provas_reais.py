#!/usr/bin/env python3
"""Mede a extensão real das alternativas do ENEM nos PDFs oficiais do INEP.

   É daqui que sai a faixa das ALTERNATIVAS na CALIBRACAO_EXTENSAO do backend
   (supabase/functions/generate-question/index.ts), a gêmea CALIBRACAO_APP em
   src/app.js e os dois limiares da auditoria local. Rode sempre que quiser
   reconferir — a calibração deixou de ser número herdado.

   POR DECISÃO DO PROFESSOR (19/09/2026) SÓ CONTAM AS PROVAS DE 2022 A 2025.
   E 2021 está excluído mesmo que alguém amplie a janela: o PDF daquele ano tem
   a codificação de fonte quebrada e o texto extrai como lixo — 59% das
   alternativas saem sem pontuação final, contra 3-8% dos demais anos, e a média
   vai a 126 caracteres em Linguagens contra 58 dos outros. Só OCR resolveria.

   Uso:
     python3 tests/medir_provas_reais.py "/caminho/Provas anteriores do ENEM"

   Cada ano precisa de ENEM_<ano>_Prova_Dia{1,2}_Azul.pdf e
   ENEM_<ano>_Gabarito_Dia{1,2}_Azul.pdf. Precisa do pdftotext (poppler).

   COMO ELE LÊ. Os cadernos do INEP têm dois formatos de alternativa: até 2021 a
   letra vem na mesma linha do texto ("A texto da alternativa"); de 2022 em
   diante a letra circulada sai sozinha numa linha e é repetida na seguinte. O
   extrator cobre os dois. A página é de duas colunas, então ele usa
   `pdftotext -layout` e corta cada página no corredor de espaços em branco
   antes de ler — sem isso, o texto de uma coluna entra no da outra.

   SUBCONJUNTO LIMPO. Alternativa que não termina em pontuação é indício de
   corte ou de sujeira colada da coluna vizinha. As estatísticas saem do
   subconjunto em que as CINCO terminam bem (87% das questões), e o script
   informa a taxa descartada — se ela subir, o extrator regrediu.

   MEDIÇÃO DE 19/09/2026 (2022-2025 · 572 questões completas · 497 limpas):

     grupo                            p25  média  p75   p90 da média das cinco
     Linguagens (sem língua estr.)     46     58   69        80
     Língua estrangeira (Q1-5)         42     53   63        70
     Humanas                           28     38   46        61
     Natureza                           8     27   41        59
       Natureza, alternativa de texto  12     33   46
     Matemática                         3     10   10        18

     paridade maior/menor (menor > 40): p50 1,25 · p75 1,41 · p90 1,57 · p95 1,63
     a alternativa correta é a mais longa em 16,5%; passa de 1,25x a segunda
     maior em 2,3%; de +25 caracteres em 0,4%.

   Por grupo, e não por disciplina: a prova não rotula disciplina. Dá para
   isolar a língua estrangeira (questões 1 a 5) e as áreas (blocos de 45); o
   que está dentro delas, não.
"""
import os, re, sys, subprocess, statistics

ANOS_PADRAO = ["2022", "2023", "2024", "2025"]
LET = ["A", "B", "C", "D", "E"]
QRE = re.compile(r"^\s*quest[ãa]o\s+(\d{1,3})\b", re.I)
LIXO = re.compile(r"^(\*[A-Z0-9]|[–-]?\s*(LC|CH|CN|MT)\s*[-–]|LINGUAGENS|CIÊNCIAS|MATEMÁTICA|CADERNO|\d{4}$|Caderno)", re.I)
# rodapé e cromo de página podem aparecer em qualquer posição da linha
RODAPE = re.compile(r"(Caderno\s*\d|Aplica[çc][ãa]o|AZUL|[–-]?\s*\b(LC|CH|CN|MT)\b\s*[•·|–-]|\b\d[ºo]\s*DIA\b|Dispon[íi]vel em:|Acesso em:)", re.I)

def grupo(n):
    if 1 <= n <= 5:     return "Língua Estrangeira"
    if 6 <= n <= 45:    return "Linguagens (sem LEM)"
    if 46 <= n <= 90:   return "Humanas"
    if 91 <= n <= 135:  return "Natureza"
    if 136 <= n <= 180: return "Matemática"

def pdf(caminho, modo="-layout"):
    return subprocess.run(["pdftotext", modo, caminho, "-"], capture_output=True, timeout=180).stdout.decode("utf-8", "ignore")

def colunas(pagina):
    """corta a página no corredor branco entre as duas colunas"""
    ln = pagina.split("\n")
    if len(ln) < 8: return [ln]
    w = max((len(l) for l in ln), default=0)
    if w < 60: return [ln]
    branco = [sum(1 for l in ln if i >= len(l) or l[i] == " ") / len(ln) for i in range(w)]
    corr = [i for i in range(int(w * .35), int(w * .65)) if branco[i] > 0.97]
    if len(corr) < 3: return [ln]
    c = corr[len(corr) // 2]
    return [[l[:c].rstrip() for l in ln], [l[c:].rstrip() for l in ln]]

def cinco(linhas):
    """as cinco alternativas de uma questão, ou None"""
    ini = {}
    for i, L in enumerate(linhas):
        s = L.strip()
        if s in LET and i + 1 < len(linhas) and linhas[i + 1].strip().startswith(s + " "):
            ini.setdefault(s, []).append((i + 1, linhas[i + 1].strip()[2:].strip())); continue
        m = re.match(r"^([A-E])\s+(\S.*)$", s)
        if m and not (i > 0 and linhas[i - 1].strip() == m.group(1)):
            ini.setdefault(m.group(1), []).append((i, m.group(2).strip()))
    if any(l not in ini for l in LET): return None
    # a última sequência A<B<C<D<E: as alternativas ficam no fim da questão
    esc = {}; lim = len(linhas) + 1
    for l in reversed(LET):
        c = [p for p in ini[l] if p[0] < lim]
        if not c: return None
        esc[l] = c[-1]; lim = c[-1][0]
    ordem = [esc[l][0] for l in LET]; out = {}
    for k, l in enumerate(LET):
        a = esc[l][0]; fim = ordem[k + 1] if k + 1 < len(ordem) else len(linhas)
        partes = [esc[l][1]]; usadas = 0
        for j in range(a + 1, fim):
            s = linhas[j].strip()
            if not s: continue                      # coluna vazia nessa linha: pula, não corta
            if LIXO.match(s) or RODAPE.search(s) or QRE.match(s) or re.match(r"^\d{1,3}$", s) or s in LET: break
            partes.append(s); usadas += 1
            if usadas >= 4: break                   # alternativa do ENEM não passa de ~4 linhas na coluna
        t = " ".join(partes).strip()
        if not (2 <= len(t) <= 400): return None
        out[l] = t
    return out

def pct(v, p):
    v = sorted(v); return v[min(len(v) - 1, int(p * len(v)))]

def main(base, anos):
    alts = {}; gab = {}
    for ano in anos:
        if ano == "2021":
            print("AVISO: 2021 ignorado — PDF com fonte quebrada (ver o cabeçalho deste arquivo)."); continue
        for dia in ("Dia1", "Dia2"):
            g = os.path.join(base, ano, f"ENEM_{ano}_Gabarito_{dia}_Azul.pdf")
            p = os.path.join(base, ano, f"ENEM_{ano}_Prova_{dia}_Azul.pdf")
            if os.path.exists(g):
                for m in re.finditer(r"^\s*(\d{1,3})\s+([A-E])\s*$", pdf(g, "-raw"), re.M):
                    gab[(ano, int(m.group(1)))] = m.group(2)
            if not os.path.exists(p): continue
            fluxo = []
            for pag in pdf(p).split("\f"):
                for col in colunas(pag): fluxo.extend(col)
            bl = {}; q = None
            for L in fluxo:
                m = QRE.match(L)
                if m: q = int(m.group(1)); bl.setdefault(q, []); continue
                if q is not None: bl[q].append(L)
            for q, ln in bl.items():
                c = cinco(ln)
                if c and grupo(q): alts[(ano, q)] = c
    if not alts: sys.exit("nada extraído — confira o caminho e o pdftotext")
    def limpa(w): return all(len(x) <= 25 or x[-1] in ".?!:;)”\"'" for x in w.values())
    lim = {k: w for k, w in alts.items() if limpa(w)}
    print("provas: %s · questões completas: %d · subconjunto limpo: %d (%.0f%%)"
          % (", ".join(a for a in anos if a != "2021"), len(alts), len(lim), 100 * len(lim) / len(alts)))
    print("\n%-24s %5s %5s %6s %5s   %s" % ("grupo", "n", "p25", "média", "p75", "p90 da média das cinco"))
    for g in ["Língua Estrangeira", "Linguagens (sem LEM)", "Humanas", "Natureza", "Matemática"]:
        v = [len(x) for k, w in lim.items() if grupo(k[1]) == g for x in w.values()]
        ms = [statistics.mean(len(x) for x in w.values()) for k, w in lim.items() if grupo(k[1]) == g]
        if len(v) < 30: continue
        print("%-24s %5d %5d %6d %5d   %d" % (g, len(v), pct(v, .25), round(statistics.mean(v)), pct(v, .75), pct(ms, .90)))
    tex = [len(x) for k, w in lim.items() if grupo(k[1]) == "Natureza" for x in w.values()
           if sum(1 for c in x if c.isalpha()) > max(3, len(x) * 0.35)]
    if len(tex) >= 30:
        print("%-24s %5d %5d %6d %5d" % ("  Natureza (só texto)", len(tex), pct(tex, .25), round(statistics.mean(tex)), pct(tex, .75)))
    rs = [max(len(x) for x in w.values()) / min(len(x) for x in w.values())
          for w in lim.values() if min(len(x) for x in w.values()) > 40]
    print("\nparidade (maior/menor, menor > 40): n=%d · p50 %.2f · p75 %.2f · p90 %.2f · p95 %.2f"
          % (len(rs), pct(rs, .5), pct(rs, .75), pct(rs, .90), pct(rs, .95)))
    print("   acima de 1,30: %.1f%% · de 1,50: %.1f%% · de 1,60: %.1f%%  (o app avisa acima de 1,60)"
          % (100 * sum(1 for r in rs if r > 1.30) / len(rs), 100 * sum(1 for r in rs if r > 1.50) / len(rs),
             100 * sum(1 for r in rs if r > 1.60) / len(rs)))
    cg = [(w, gab[k]) for k, w in lim.items() if k in gab]
    if cg:
        par = [(len(w[L]), max(len(x) for y, x in w.items() if y != L)) for w, L in cg]
        print("a correta é a mais longa em %.1f%% (n=%d) · passa de 1,25x a segunda em %.1f%% · de +25 caracteres em %.1f%%"
              % (100 * sum(1 for a, b in par if a > b) / len(par), len(par),
                 100 * sum(1 for a, b in par if b and a > 1.25 * b) / len(par),
                 100 * sum(1 for a, b in par if a - b >= 25) / len(par)))

if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/Provas anteriores do ENEM")
    anos = sys.argv[2:] or ANOS_PADRAO
    main(base, anos)
