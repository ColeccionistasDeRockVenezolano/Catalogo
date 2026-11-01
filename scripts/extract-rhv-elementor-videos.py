"""Extract Elementor video settings and iframe sources from archived RHV pages."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from bs4 import BeautifulSoup

out = Path(sys.argv[1]).resolve()
if not out.is_relative_to((Path.home() / 'crv-staging').resolve()):
    raise SystemExit('Solo staging SSD')
root = Path('data/raw/rockhecho-2026-10-29')
index = json.loads((root / 'index.json').read_text())['index']
rows, missing, errors = [], [], []
def video_id(url):
    parts = urlsplit(url)
    if parts.hostname not in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be'):
        return None
    match = re.search(r'^/(?:embed|shorts|live)/([\w-]{11})(?:/|$)', parts.path)
    value = (match.group(1) if match else parts.path.strip('/') if parts.hostname.endswith('youtu.be') else parse_qs(parts.query).get('v', [''])[0])
    return value if re.fullmatch(r'[\w-]{11}', value) else None

for site, posts in index.items():
    for post in posts:
        f = root / 'raw' / site / f"{post['id']}.html"
        if not f.exists():
            missing.append(post['link']); continue
        soup = BeautifulSoup(f.read_bytes(), 'html.parser')
        for element in soup.select('[data-widget_type="video.default"], iframe[src]'):
            settings = {}
            if element.get('data-settings'):
                try: settings = json.loads(element['data-settings'])
                except ValueError: errors.append({'url': post['link'], 'settings': element['data-settings']}); continue
            src = settings.get('youtube_url') or element.get('src') or ''
            vid = video_id(src)
            if vid:
                rows.append({'artist': post['title']['rendered'], 'source': post['link'], 'videoId': vid, 'videoUrl': src,
                             'widgetId': element.get('data-id'), 'evidenceFile': str(f), 'element': str(element)[:4000]})
(out / 'elementor-extract.json').write_text(json.dumps({'rows': rows, 'missing': missing, 'errors': errors}, ensure_ascii=False, indent=2))
print(json.dumps({'rows': len(rows), 'videos': len({r['videoId'] for r in rows}), 'pages': len({r['source'] for r in rows}), 'missing': len(missing), 'errors': len(errors)}))
