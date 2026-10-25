"""Lee conversaciones completas de las campañas y conserva un índice de hallazgos."""
import collections
import datetime
import hashlib
import json
import os
import pathlib
import re
import sqlite3

OUT = pathlib.Path(os.environ['HERMES_DEEP_REPORT'])
PROJECT = str(pathlib.Path(__file__).resolve().parents[1])
CORE = {
    '20261023_220957_a38711': 'RadioLAE / iVoox / Mixcloud',
    '20261023_221114_a320d9': 'Tumblr',
    '20261023_222305_e63f10': 'Barraezo',
    '20261023_222447_07db34': 'MP3.com',
    '20261023_225402_5754cf': 'Venezuela Demo',
    '20261023_225604_feb7c5': 'Punk / fanzines',
    '20261023_230827_38e9bd': 'Reparación Hermes / imágenes',
    '20261024_164117_a63d95': 'Auditoría posterior Hermes',
}


def clean(text):
    text = re.sub(r'(?i)(Bearer\s+)[\w.\-/+=]+', r'\1[REDACTADO]', text)
    text = re.sub(r'(?i)([?&](?:key|token|api_key|access_token)=)[^\s&"\']+', r'\1[REDACTADO]', text)
    text = re.sub(r'(?i)((?:api[_-]?key|password|secret|authorization)\s*[=:]\s*["\']?)[^\s"\',}]+', r'\1[REDACTADO]', text)
    return text


c = sqlite3.connect('file:' + str(pathlib.Path.home() / '.hermes/state.db') + '?mode=ro', uri=True)
c.row_factory = sqlite3.Row
c.execute('BEGIN')
sessions = [dict(r) for r in c.execute('SELECT id,title,cwd,parent_session_id,message_count,tool_call_count,started_at,last_activity_at,last_activity_description FROM sessions ORDER BY started_at')]
project = [r for r in sessions if r['cwd'] == PROJECT or r['id'] in CORE]
selected = set(CORE)
while True:
    extra = {r['id'] for r in sessions if r['parent_session_id'] in selected}
    if extra <= selected:
        break
    selected |= extra
result = []
lines = ['# Lectura profunda de las sesiones Hermes', '', 'Lectura completa de mensajes persistidos (incluidos inactivos/compactados), sin escribir en Hermes ni enviar órdenes a terminales.', '']
pattern = re.compile(r'pendient|falta|revis|bloque|no se|sin |error|fall|no pud|no desc|luego|despu[eé]s|siguiente|cr[eé]dito|comentario|enlace|track|canci[oó]n|fuente|incorpor|complet', re.I)
for meta in project:
    if meta['id'] not in selected:
        continue
    msgs = [dict(r) for r in c.execute('SELECT id,role,content,tool_calls,tool_name,timestamp,active,compacted FROM messages WHERE session_id=? ORDER BY id', (meta['id'],))]
    raw_hash = hashlib.sha256(json.dumps(msgs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    final = [m for m in msgs if m['role'] == 'assistant' and m['content'] and not m['tool_calls']]
    findings = []
    urls = collections.Counter()
    tools = collections.Counter()
    for m in msgs:
        text = m['content'] or ''
        for url in re.findall(r'https?://[^\s<>"\')]+', text):
            urls[clean(url)] += 1
        if m['tool_name']:
            tools[m['tool_name']] += 1
        if m['role'] not in ('assistant', 'user'):
            continue
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip() and pattern.search(p)]
        if paragraphs:
            findings.append({'messageId': m['id'], 'role': m['role'], 'active': m['active'], 'compacted': m['compacted'], 'paragraphs': [clean(p) for p in paragraphs]})
    item = {**meta, 'topic': CORE.get(meta['id'], 'Continuación'), 'messagesRead': len(msgs), 'roles': dict(collections.Counter(m['role'] for m in msgs)), 'charactersRead': sum(len(m['content'] or '') + len(m['tool_calls'] or '') for m in msgs), 'messagesSha256': raw_hash, 'tools': dict(tools), 'urls': dict(urls), 'findings': findings, 'closingMessages': [{'messageId': m['id'], 'content': clean(m['content'])} for m in final[-4:]]}
    result.append(item)
    lines += ['## ' + item['topic'] + ' — ' + meta['id'], '', f"{len(msgs)} mensajes leídos; {item['charactersRead']:,} caracteres de contenido/llamadas. SHA-256 de la instantánea de mensajes: `{raw_hash}`.", '']
    for m in item['closingMessages']:
        lines += [f"### Mensaje {m['messageId']}", '', m['content'], '']
    lines += ['Los hallazgos de todos los mensajes y las URL están en sesiones-lectura.json; las afirmaciones de la conversación no sustituyen una verificación del artefacto/BD.', '']
c.execute('ROLLBACK')
c.close()
(OUT / 'sesiones-indice-proyecto.json').write_text(json.dumps(project, ensure_ascii=False, indent=2))
(OUT / 'sesiones-lectura.json').write_text(json.dumps({'readAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'projectSessions': len(project), 'selectedSessions': result}, ensure_ascii=False, indent=2))
(OUT / 'SESIONES.md').write_text('\n'.join(lines))
print(json.dumps({'projectSessions': len(project), 'sessionsRead': len(result), 'messagesRead': sum(r['messagesRead'] for r in result), 'charactersRead': sum(r['charactersRead'] for r in result)}, ensure_ascii=False))
