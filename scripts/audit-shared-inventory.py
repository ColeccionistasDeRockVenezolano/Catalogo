#!/usr/bin/env python3
"""Inventario de Shared en solo lectura; escribe exclusivamente en SSD."""
import collections
import json
import os
import sys
import time
from pathlib import Path

root = Path('/mnt/1tb/Shared')
out = Path(sys.argv[1])
if '/crv-staging/' not in str(out.resolve()):
    raise SystemExit('La salida debe estar en crv-staging')
groups = collections.defaultdict(lambda: {'files': 0, 'bytes': 0, 'extensions': collections.Counter(), 'examples': []})
errors = []
started = time.time()
with (out / 'inventario-archivos.jsonl').open('w') as dest:
    for base, dirs, names in os.walk(root, followlinks=False, onerror=lambda e: errors.append(str(e))):
        dirs.sort()
        for name in sorted(names):
            p = Path(base) / name
            try:
                st = p.lstat()
                rel = p.relative_to(root)
                parts = rel.parts
                depth = 4 if parts[0] == 'coleccionistas-rock-venezolano' and len(parts)>2 and parts[1]=='data' else 3 if parts[0]=='coleccionistas-rock-venezolano' else 2
                group = '/'.join(parts[:min(depth,len(parts)-1)])
                ext = p.suffix.lower() or '[sin extension]'
                row = {'path': str(rel), 'bytes': st.st_size, 'mtime': st.st_mtime, 'extension': ext, 'group': group, 'symlink': p.is_symlink()}
                dest.write(json.dumps(row, ensure_ascii=False)+'\n')
                g=groups[group];g['files']+=1;g['bytes']+=st.st_size;g['extensions'][ext]+=1
                if len(g['examples'])<4:g['examples'].append(str(rel))
            except OSError as e:errors.append({'path':str(p),'error':str(e)})
summary={'root':str(root),'started':started,'finished':time.time(),'files':sum(x['files'] for x in groups.values()),'bytes':sum(x['bytes'] for x in groups.values()),'groups':dict(sorted(groups.items())),'errors':errors}
(out/'inventario-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k!='groups'}))
