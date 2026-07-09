# Generic method extractor: move class methods out of MindMapApp into a module
# as free functions taking `app: MindMapApp` first. Usage: edit BATCH below.
import io, re, os, sys

SRC = 'frontend/src/app.ts'

def load():
    return io.open(SRC, encoding='utf-8').read().splitlines(keepends=True)

def method_ranges(lines):
    starts = []
    for i, l in enumerate(lines):
        if re.match(r'^  (private |readonly |async |constructor)', l) or re.match(r'^  \w+\s*\(', l):
            starts.append(i)
    ranges = {}
    for idx, s in enumerate(starts):
        e = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        m = re.search(r'(\w+)\s*[(=]', lines[s])
        if m and m.group(1) not in ranges:
            ranges[m.group(1)] = (s, e)
    return ranges

def fix_header(chunk, name):
    first = chunk.splitlines(keepends=True)
    h = first[0]
    m = re.match(r'^  (?:private )?(async )?' + re.escape(name) + r'\((.*)$', h)
    if not m:
        raise SystemExit(f'cannot transform header of {name}: {h!r}')
    asy = m.group(1) or ''
    rest = m.group(2)
    sep = '' if rest.startswith(')') else ', '
    first[0] = (f'export {asy}function {name}(app: MindMapApp{sep}{rest}').rstrip('\n') + '\n'
    return ''.join([first[0]] + [l[2:] if l.startswith('  ') else l for l in first[1:]])

def run(move, module_path, extra_import_line, publicize):
    lines = load()
    ranges = method_ranges(lines)
    missing = [n for n in move if n not in ranges]
    if missing:
        raise SystemExit(f'missing methods: {missing}')
    chunks = []
    for n in move:
        s, e = ranges[n]
        chunk = ''.join(lines[s:e]).rstrip() + '\n'
        chunk = fix_header(chunk, n)
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
    new_text = ''.join(l for i, l in enumerate(lines) if i not in remove)
    for d in publicize:
        new_text = re.sub(r'^  private (readonly )?(async )?(' + re.escape(d) + r')\b',
                          lambda m: '  ' + (m.group(1) or '') + (m.group(2) or '') + m.group(3),
                          new_text, count=1, flags=re.M)
    for n in move:
        new_text = re.sub(r'this\.' + n + r'\(\)', n + '(this)', new_text)
        new_text = re.sub(r'this\.' + n + r'\(', n + '(this, ', new_text)
        # bare method references (callbacks) would be broken — fail loudly
        if re.search(r'this\.' + n + r'\b(?!\()', new_text):
            raise SystemExit(f'{n} is referenced without a call — handle manually')
    new_text = new_text.replace("import { api } from './api'",
                                "import { api } from './api'\n" + extra_import_line, 1)
    io.open(SRC, 'w', encoding='utf-8', newline='\n').write(new_text)
    os.makedirs(os.path.dirname(module_path), exist_ok=True)
    io.open(module_path, 'w', encoding='utf-8', newline='\n').write(
        "import type { MindMapApp } from '../app'\n\n" + '\n'.join(chunks))
    print('moved', len(move), 'methods ->', module_path)
