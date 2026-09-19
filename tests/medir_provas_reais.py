#!/usr/bin/env python3
"""Mede a extensão real das questões do ENEM a partir dos PDFs oficiais.

   É daqui que sai a CALIBRAÇÃO DE EXTENSÃO do backend (CALIBRACAO_EXTENSAO em
   supabase/functions/generate-question/index.ts) e os dois limiares de aviso do
   aplicativo (auditoria local em src/app.js). Antes desta medição os números
   eram herdados; agora dá para reconferir todos a qualquer momento.

   Uso:
     python3 tests/medir_provas_reais.py "/caminho/Provas anteriores do ENEM"

   A pasta deve ter um subdiretório por ano com os arquivos
     ENEM_<ano>_Prova_Dia1_Azul.pdf · ENEM_<ano>_Prova_Dia2_Azul.pdf
     ENEM_<ano>_Gabarito_Dia1_Azul.pdf · ENEM_<ano>_Gabarito_Dia2_Azul.pdf
   Precisa do pdftotext (poppler-utils) no PATH.

   Resultado da medição de 19/09/2026 (2015-2025, cadernos Azul — 1.700
   alternativas, 326 questões completas, 314 com gabarito):

     alternativas      p25  média  p75        média das cinco   p50  p75  p90
     Linguagens         43     56   67                           54   67   88
     Humanas            28     38   46                           33   47   68
     Natureza            8     27   42                           18   43   60
     Matemática          3     10   10                            5   11   18

     paridade (maior/menor, só onde a menor passa de 40 caracteres):
       p50 1,24 · p75 1,37 · p90 1,47 · p95 1,59 — e 1,30 reprova 37,3% das reais
     a alternativa correta é a mais longa em 15,3% das questões;
       passa de 1,25x a segunda maior em 1,4%; de +25 caracteres em 0,3%.
"""
import os, re, sys, subprocess, statistics

LET = ["A", "B", "C", "D", "E"]
CORTA = re.compile(r"^(QUESTÃO\b|\*\d|[–-]\s*(LC|CH|CN|MT)\b|LINGUAGENS|CIÊNCIAS|MATEMÁTICA E|CADERNO)")

def area(n):
    if 1 <= n <= 45: return "Linguagens"
    if 46 <= n <= 90: return "Humanas"
    if 91 <= n <= 135: return "Natureza"
    if 136 <= n <= 180: return "Matemática"

def pdf(p):
    return subprocess.run(["pdftotext", "-raw", p, "-"], capture_output=True, timeout=180).stdout.decode("utf-8", "ignore")

def alternativas(txt):
    """Devolve {numero da questão: {letra: tamanho}}. O PDF oficial imprime a
       letra sozinha (o círculo) e repete a letra na linha do texto."""
    ln = txt.split("\n"); q = None; i = 0; out = {}
    while i < len(ln):
        L = ln[i].strip()
        m = re.match(r"^QUESTÃO\s+(\d{1,3})\b", L)
        if m: q = int(m.group(1)); i += 1; continue
        if L in LET and i + 1 < len(ln) and ln[i + 1].strip().startswith(L + " "):
            partes = [ln[i + 1].strip()[2:].strip()]; j = i + 2
            while j < len(ln):
                s = ln[j].strip()
                if not s or s in LET or CORTA.match(s) or re.match(r"^\d{1,3}$", s): break
                partes.append(s); j += 1
            t = " ".join(partes).strip()
            if q and 2 <= len(t) <= 400: out.setdefault(q, {})[L] = len(t)
            i = j; continue
        i += 1
    return out

def pct(v, p):
    v = sorted(v); return v[min(len(v) - 1, int(p * len(v)))]

def main(base):
    alts = {}; gab = {}; sem_ponto = 0; total = 0
    anos = sorted(d for d in os.listdir(base) if d.isdigit())
    if not anos: sys.exit("nenhuma pasta de ano em " + base)
    for ano in anos:
        for dia in ("Dia1", "Dia2"):
            g = os.path.join(base, ano, f"ENEM_{ano}_Gabarito_{dia}_Azul.pdf")
            p = os.path.join(base, ano, f"ENEM_{ano}_Prova_{dia}_Azul.pdf")
            if os.path.exists(g):
                for m in re.finditer(r"^\s*(\d{1,3})\s+([A-E])\s*$", pdf(g), re.M):
                    gab[(ano, int(m.group(1)))] = m.group(2)
            if os.path.exists(p):
                for q, v in alternativas(pdf(p)).items():
                    alts[(ano, q)] = v; total += len(v)
    comp = {k: v for k, v in alts.items() if len(v) == 5 and area(k[1])}
    print(f"provas: {anos[0]}-{anos[-1]} · alternativas {total} · questões completas {len(comp)} · com gabarito {sum(1 for k in comp if k in gab)}\n")
    print("%-12s %5s %5s %6s %5s   %5s %5s %5s" % ("área", "n", "p25", "média", "p75", "méd.p50", "p75", "p90"))
    for a in ["Linguagens", "Humanas", "Natureza", "Matemática"]:
        v = [x for k, w in comp.items() if area(k[1]) == a for x in w.values()]
        ms = [statistics.mean(w.values()) for k, w in comp.items() if area(k[1]) == a]
        if not v: continue
        print("%-12s %5d %5d %6d %5d   %5d %5d %5d" % (a, len(v), pct(v, .25), round(statistics.mean(v)), pct(v, .75), pct(ms, .5), pct(ms, .75), pct(ms, .90)))
    rs = [max(w.values()) / min(w.values()) for w in comp.values() if min(w.values()) > 40]
    print("\nparidade (maior/menor, menor > 40): n=%d · p50 %.2f · p75 %.2f · p90 %.2f · p95 %.2f · %% acima de 1,30: %.1f%% · de 1,50: %.1f%%"
          % (len(rs), pct(rs, .5), pct(rs, .75), pct(rs, .90), pct(rs, .95),
             100 * sum(1 for r in rs if r > 1.30) / len(rs), 100 * sum(1 for r in rs if r > 1.50) / len(rs)))
    cg = [(w, gab[k]) for k, w in comp.items() if k in gab]
    par = [(w[L], max(x for y, x in w.items() if y != L)) for w, L in cg]
    print("a correta é a mais longa em %.1f%% · passa de 1,25x a segunda em %.1f%% · de +25 caracteres em %.1f%%"
          % (100 * sum(1 for g, s in par if g > s) / len(par),
             100 * sum(1 for g, s in par if s and g > 1.25 * s) / len(par),
             100 * sum(1 for g, s in par if g - s >= 25) / len(par)))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/Provas anteriores do ENEM"))
