# -*- coding: utf-8 -*-
"""v16 — amplia o subconjunto da Carlito embarcado em src/fonts.js.

Parte dos QUATRO subconjuntos já embarcados (comprovados no jsPDF) e só
ACRESCENTA glifos, copiados da Carlito 1.104 completa (mesma versão; outlines
idênticos, conferido): letras sobrescritas (ᵃ…ᶻ, ᴬ…ᵂ) e subscritas (ₐ ₑ ᵢ ₒ ᵣ ᵤ ᵥ ₓ).
Os subscritos que a Carlito não tem (ₕ ⱼ ₖ ₗ ₘ ₙ ₚ ₛ ₜ) são fabricados do jeito
que a própria fonte fabrica os seus: a letra pequena do sobrescrito deslocada
1100 unidades para baixo. Todos os glifos novos entram ACHATADOS (contornos
simples, sem componentes), o caminho mais seguro para o subsetter do jsPDF.

Uso: python3 ampliar_carlito.py <fonts.js de entrada> <fonts.js de saída>
"""
import base64, re, sys, io
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen

SISTEMA = {
    "CARLITO_NORMAL": "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
    "CARLITO_BOLD": "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
    "CARLITO_ITALIC": "/usr/share/fonts/truetype/crosextra/Carlito-Italic.ttf",
    "CARLITO_BOLDITALIC": "/usr/share/fonts/truetype/crosextra/Carlito-BoldItalic.ttf",
}

SUP_MIN = {"a": 0x1D43, "b": 0x1D47, "c": 0x1D9C, "d": 0x1D48, "e": 0x1D49, "f": 0x1DA0, "g": 0x1D4D, "h": 0x02B0,
           "i": 0x2071, "j": 0x02B2, "k": 0x1D4F, "l": 0x02E1, "m": 0x1D50, "n": 0x207F, "o": 0x1D52, "p": 0x1D56,
           "r": 0x02B3, "s": 0x02E2, "t": 0x1D57, "u": 0x1D58, "v": 0x1D5B, "w": 0x02B7, "x": 0x02E3, "y": 0x02B8, "z": 0x1DBB}
SUP_MAI = {"A": 0x1D2C, "B": 0x1D2E, "D": 0x1D30, "E": 0x1D31, "G": 0x1D33, "H": 0x1D34, "I": 0x1D35, "J": 0x1D36,
           "K": 0x1D37, "L": 0x1D38, "M": 0x1D39, "N": 0x1D3A, "O": 0x1D3C, "P": 0x1D3E, "R": 0x1D3F, "T": 0x1D40,
           "U": 0x1D41, "W": 0x1D42}
SUB_EXISTENTES = {"a": 0x2090, "e": 0x2091, "o": 0x2092, "x": 0x2093, "i": 0x1D62, "r": 0x1D63, "u": 0x1D64, "v": 0x1D65}
SUB_FABRICADOS = {"h": 0x2095, "j": 0x2C7C, "k": 0x2096, "l": 0x2097, "m": 0x2098, "n": 0x2099, "p": 0x209A, "s": 0x209B, "t": 0x209C}
DESLOCAMENTO_SUB = -1100   # o mesmo que a Carlito usa em ₐ = ᵃ deslocado


def desenha_achatado(fonte, nome, pen, dy=0):
    """Desenha o glifo `nome` da fonte (resolvendo componentes) no pen, deslocado dy."""
    glyf = fonte["glyf"]
    g = glyf[nome]
    if g.isComposite():
        for c in g.components:
            comp = glyf[c.glyphName]
            if comp.numberOfContours == 0 or (comp.xMax == comp.xMin and comp.yMax == comp.yMin):
                continue   # âncora degenerada (glyph02781: um ponto em 0,0)
            desenha_achatado(fonte, c.glyphName, TransformPen(pen, (1, 0, 0, 1, c.x, c.y + dy)), 0)
    else:
        fonte.getGlyphSet()[nome].draw(TransformPen(pen, (1, 0, 0, 1, 0, dy)) if dy else pen)


def acrescenta_glifo(destino, origem, cp, nome_origem, dy=0, nome_novo=None):
    nome = nome_novo or ("uni%04X" % cp)
    if nome in destino.getGlyphOrder():
        raise RuntimeError("glifo já existe: " + nome)
    pen = TTGlyphPen(None)
    desenha_achatado(origem, nome_origem, pen, dy)
    g = pen.glyph()
    g.recalcBounds(destino["glyf"])
    destino["glyf"][nome] = g
    adv, lsb = origem["hmtx"][nome_origem]
    destino["hmtx"][nome] = (adv, g.xMin if g.numberOfContours else lsb)
    # glyf.__setitem__ já anexa o nome à ordem de glifos (lista compartilhada
    # com o TTFont); só garante a consistência das duas listas.
    ordem = list(destino["glyf"].glyphOrder)
    if nome not in ordem:
        ordem.append(nome)
    destino.setGlyphOrder(ordem)
    destino["glyf"].glyphOrder = ordem
    assert len(ordem) == len(destino["glyf"].glyphs), (len(ordem), len(destino["glyf"].glyphs))
    for t in destino["cmap"].tables:
        t.cmap[cp] = nome
    return nome


def amplia(face_bytes, caminho_sistema):
    sub = TTFont(io.BytesIO(face_bytes))
    full = TTFont(caminho_sistema)
    fc = full.getBestCmap()
    sc = sub.getBestCmap()
    novos = []
    def bbox_de(nome_origem, dy=0):
        pen = TTGlyphPen(None); desenha_achatado(full, nome_origem, pen, dy); g = pen.glyph(); g.recalcBounds(full["glyf"])
        return g.yMin, g.yMax
    for tabela in (SUP_MIN, SUP_MAI):
        for letra, cp in tabela.items():
            if cp in sc:
                continue
            if cp not in fc:
                raise RuntimeError("Carlito completa não tem U+%04X (%s)" % (cp, letra))
            ymin, ymax = bbox_de(fc[cp])
            assert ymin > 600, ("sobrescrito fora de posição na Carlito", hex(cp), ymin, ymax)
            acrescenta_glifo(sub, full, cp, fc[cp]); novos.append(cp)
    # Subscritos: a Carlito Italic e BoldItalic têm um DEFEITO — ₐ ₑ ₒ ₓ estão
    # desenhados na altura de SOBRESCRITO (bbox 875…1391). Por isso todo
    # subscrito é conferido pela posição; se vier alto, é fabricado a partir da
    # letra pequena do sobrescrito deslocada −1100, como a Regular faz.
    for tabela in (SUB_EXISTENTES, SUB_FABRICADOS):
        for letra, cp in tabela.items():
            if cp in sc:
                continue
            if cp in fc:
                ymin, ymax = bbox_de(fc[cp])
                if ymax < 700 and ymin < 0:
                    acrescenta_glifo(sub, full, cp, fc[cp]); novos.append(cp); continue
                print("   aviso: U+%04X (%s) está na altura errada na fonte (%d…%d) — fabricado" % (cp, letra, ymin, ymax))
            origem = fc[SUP_MIN[letra]]           # letra pequena do sobrescrito
            ymin, ymax = bbox_de(origem, DESLOCAMENTO_SUB)
            assert ymax < 700 and ymin < 0, ("fabricação fora de posição", hex(cp), ymin, ymax)
            acrescenta_glifo(sub, full, cp, origem, dy=DESLOCAMENTO_SUB); novos.append(cp)
    sub["maxp"].recalc(sub)
    out = io.BytesIO()
    sub.save(out, reorderTables=True)
    dados = out.getvalue()
    # verificação: reabre, confere cmap/hmtx/bbox dos novos
    chk = TTFont(io.BytesIO(dados)); cm = chk.getBestCmap()
    for cp in novos:
        nome = cm[cp]; g = chk["glyf"][nome]; adv, _ = chk["hmtx"][nome]
        assert g.numberOfContours > 0 and adv > 0, (hex(cp), g.numberOfContours, adv)
        assert not g.isComposite(), hex(cp)
    return dados, sorted(novos), chk


def main(entrada, saida):
    js = open(entrada, encoding="utf-8").read()
    cobertura_final = None
    for nome, caminho in SISTEMA.items():
        m = re.search(r'(const %s = ")([^"]+)(")' % nome, js)
        assert m, nome
        antes = base64.b64decode(m.group(2))
        dados, novos, chk = amplia(antes, caminho)
        cob = "".join(chr(cp) for cp in sorted(chk.getBestCmap().keys()) if cp >= 0x20)
        if cobertura_final is None:
            cobertura_final = cob
        else:
            assert cob == cobertura_final, "cobertura difere entre faces: " + nome
        js = js[:m.start(2)] + base64.b64encode(dados).decode("ascii") + js[m.end(2):]
        print("%s: %d → %d bytes, +%d glifos" % (nome, len(antes), len(dados), len(novos)))
    m = re.search(r'(const CARLITO_COBERTURA = ")((?:[^"\\]|\\.)*)(";)', js)
    assert m, "CARLITO_COBERTURA"
    antiga = m.group(2).replace('\\"', '"').replace("\\\\", "\\")   # a string só usa os escapes \" e \\
    # a string antiga pode ter escapes (\" \\); conferimos que só ACRESCENTAMOS
    faltam = [c for c in antiga if c not in cobertura_final and c not in "\n\t\r"]
    assert not faltam, "caracteres que sumiriam da cobertura: %r" % faltam
    nova = cobertura_final.replace("\\", "\\\\").replace('"', '\\"')
    js = js[:m.start(2)] + nova + js[m.end(2):]
    open(saida, "w", encoding="utf-8", newline="\n").write(js)
    print("cobertura: %d → %d caracteres" % (len(antiga), len(cobertura_final)))
    print("novos:", "".join(c for c in cobertura_final if c not in antiga))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
