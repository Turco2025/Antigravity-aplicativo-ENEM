# Emula jsonb_pretty() do PostgreSQL para conferir, por md5, que a transcrição de uma
# resposta da função de teste (copiada do resultado do SQL) é byte a byte a original.
# Regras do jsonb: chaves ordenadas por (comprimento em bytes, ordem binária); indentação de
# 4 espaços; "chave": valor; arrays/objetos vazios abrem e fecham em linhas separadas;
# strings escapam apenas ", \ e controles (não-ASCII fica como está); números como texto.
import json, sys, hashlib

def esc(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch == '"': out.append('\\"')
        elif ch == '\\': out.append('\\\\')
        elif ch == '\n': out.append('\\n')
        elif ch == '\r': out.append('\\r')
        elif ch == '\t': out.append('\\t')
        elif ch == '\b': out.append('\\b')
        elif ch == '\f': out.append('\\f')
        elif o < 0x20: out.append('\\u%04x' % o)
        else: out.append(ch)
    return '"' + ''.join(out) + '"'

def num(v):
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, int): return str(v)
    # jsonb guarda numeric; repr curto sem expoente
    s = repr(v)
    if 'e' in s or 'E' in s: s = format(v, 'f').rstrip('0').rstrip('.')
    return s

def pretty(v, nivel=0):
    ind = '    ' * nivel; ind1 = '    ' * (nivel + 1)
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return num(v)
    if isinstance(v, str): return esc(v)
    if isinstance(v, list):
        if not v: return '[\n' + ind + ']'
        return '[\n' + ',\n'.join(ind1 + pretty(x, nivel + 1) for x in v) + '\n' + ind + ']'
    if isinstance(v, dict):
        if not v: return '{\n' + ind + '}'
        chaves = sorted(v.keys(), key=lambda k: (len(k.encode('utf-8')), k.encode('utf-8')))
        return '{\n' + ',\n'.join(ind1 + esc(k) + ': ' + pretty(v[k], nivel + 1) for k in chaves) + '\n' + ind + '}'
    raise TypeError(type(v))

if __name__ == '__main__':
    obj = json.load(open(sys.argv[1], encoding='utf-8'))
    txt = pretty(obj)
    print(hashlib.md5(txt.encode('utf-8')).hexdigest())
    if len(sys.argv) > 2 and sys.argv[2] == '--print': print(txt)
