# v2: move methods AND arrow-function properties out of MindMapApp.
# Arrow props leave a thin delegating property behind (listener identity preserved).
# In app.ts, moved symbols are referenced via a namespace import (no name clashes).
import io, re, os

SRC = 'frontend/src/app.ts'

def load():
    return io.open(SRC, encoding='utf-8').read().splitlines(keepends=True)

def member_ranges(lines):
    starts = []
    for i, l in enumerate(lines):
        if re.match(r'^  (private |readonly |async |constructor)', l) or re.match(r'^  \w+\s*\(', l):
            m = re.search(r'(\w+)\s*[(=:]', l)
            if m:
                starts.append((i, m.group(1)))
    ranges = {}
    for idx, (s, n) in enumerate(starts):
        e = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        if n not in ranges:
            ranges[n] = (s, e)
    return ranges

def parse_arrow_header(h, name):
    # `  private readonly name = (a: T, b: U): R => {`
    m = re.match(r'^  (?:private )?(?:readonly )?' + re.escape(name) +
                 r'\s*=\s*(async )?\((.*?)\)(: [^=]*?)? =>', h)
    if not m:
        return None
    asy = m.group(1) or ''
    params = m.group(2).strip()
    ret = (m.group(3) or ': void').strip()
    argnames = []
    depth = 0
    cur = ''
    for ch in params + ',':
        if ch == ',' and depth == 0:
            if cur.strip():
                nm = cur.split(':')[0].strip().lstrip('_')
                argnames.append(cur.split(':')[0].strip())
            cur = ''
        else:
            if ch in '<([{': depth += 1
            if ch in '>)]}': depth -= 1
            cur += ch
    return asy, params, ret, argnames

def run(move, module_path, ns, publicize):
    lines = load()
    ranges = member_ranges(lines)
    missing = [n for n in move if n not in ranges]
    if missing:
        raise SystemExit(f'missing: {missing}')
    chunks = []
    stubs = {}
    for n in move:
        s, e = ranges[n]
        chunk = ''.join(lines[s:e]).rstrip() + '\n'
        header = chunk.splitlines()[0]
        arrow = parse_arrow_header(header, n)
        if arrow:
            asy, params, ret, argnames = arrow
            sep = ', ' if params else ''
            body = chunk.split('=>', 1)[1]
            body = body[body.index('{'):]
            fn = f'export {asy}function {n}(app: MindMapApp{sep}{params}){ret.replace(": ", ": ", 1)} '
            fn = f'export {asy}function {n}(app: MindMapApp{sep}{params}){ret} ' + body
            # dedent 2
            fn = '\n'.join(l[2:] if l.startswith('  ') else l for l in fn.splitlines()) + '\n'
            args = ', '.join(a for a in argnames)
            call_args = ('this, ' + args) if args else 'this'
            stubs[n] = (f'  private readonly {n} = ({params}){ret} =>\n'
                        f'    {ns}.{n}({call_args})\n\n')
            chunk = fn
        else:
            m = re.match(r'^  (?:private )?(async )?' + re.escape(n) + r'\((.*)$', header)
            if not m:
                raise SystemExit(f'bad header {n}: {header!r}')
            asy = m.group(1) or ''
            rest = m.group(2)
            sep = '' if rest.startswith(')') else ', '
            first = f'export {asy}function {n}(app: MindMapApp{sep}{rest}\n'
            rest_lines = chunk.splitlines(keepends=True)[1:]
            chunk = first + ''.join(l[2:] if l.startswith('  ') else l for l in rest_lines)
        chunk = chunk.replace('this.', 'app.')
        chunk = re.sub(r'\(this\)', '(app)', chunk)
        chunk = re.sub(r'\(this,\s*', '(app, ', chunk)
        for sib in move:
            chunk = re.sub(r'app\.' + sib + r'\(\)', sib + '(app)', chunk)
            chunk = re.sub(r'app\.' + sib + r'\(', sib + '(app, ', chunk)
        chunks.append(chunk)
    remove = set()
    for n in move:
        s, e = ranges[n]
        remove |= set(range(s, e))
    kept = []
    inserted = False
    for i, l in enumerate(lines):
        if i in remove:
            n = next((nm for nm in move if ranges[nm][0] == i), None)
            if n and n in stubs:
                kept.append(stubs[n])
            continue
        kept.append(l)
    new_text = ''.join(kept)
    for d in publicize:
        new_text = re.sub(r'^  private (readonly )?(async )?(' + re.escape(d) + r')\b',
                          lambda m: '  ' + (m.group(1) or '') + (m.group(2) or '') + m.group(3),
                          new_text, count=1, flags=re.M)
    for n in move:
        if n in stubs:
            continue  # method gone; calls in app.ts rewritten below
        # nothing extra for arrows: property still exists
    for n in move:
        if n in stubs:
            continue
        new_text = re.sub(r'this\.' + n + r'\(\)', ns + '.' + n + '(this)', new_text)
        new_text = re.sub(r'this\.' + n + r'\(', ns + '.' + n + '(this, ', new_text)
        if re.search(r'this\.' + n + r'\b(?!\()', new_text):
            raise SystemExit(f'{n} referenced without call — manual fix needed')
    mod_from = module_path.replace('frontend/src', '.').replace('.ts', '')
    new_text = new_text.replace("import { api } from './api'",
                                f"import {{ api }} from './api'\nimport * as {ns} from '{mod_from}'", 1)
    io.open(SRC, 'w', encoding='utf-8', newline='\n').write(new_text)
    os.makedirs(os.path.dirname(module_path), exist_ok=True)
    io.open(module_path, 'w', encoding='utf-8', newline='\n').write(
        "import type { MindMapApp } from '../app'\n\n" + '\n'.join(chunks))
    print('moved', len(move), '->', module_path)
