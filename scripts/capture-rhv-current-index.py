"""Captura el índice WordPress de todos los subsitios al staging SSD."""
import datetime
import json
import string
import sys
import time
from pathlib import Path

import requests

dest = Path(sys.argv[1]).resolve()
if not dest.is_relative_to((Path.home() / 'crv-staging').resolve()):
    raise SystemExit('Solo staging SSD')
session = requests.Session()
session.headers.update({'User-Agent': 'CRV-catalogo/1.0 (investigación documental)'} )
records = []
for letter in ['00', *string.ascii_lowercase]:
    page = 1
    while True:
        url = f'https://rockhechovenezuela.com/{letter}/wp-json/wp/v2/posts'
        params = {'per_page': 100, 'page': page, '_fields': 'id,slug,link,title,date,modified'}
        try:
            response = session.get(url, params=params, timeout=25, allow_redirects=False)
            item = {'site': letter, 'page': page, 'url': response.url, 'status': response.status_code,
                    'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'total': response.headers.get('X-WP-Total'), 'totalPages': response.headers.get('X-WP-TotalPages'),
                    'location': response.headers.get('Location')}
            if response.status_code == 200:
                item['body'] = response.json()
                if not isinstance(item['body'], list):
                    raise ValueError('La respuesta no es una lista WordPress')
            else:
                item['errorBody'] = response.text[:2000]
            records.append(item)
            print(letter, page, response.status_code, len(item.get('body', [])), flush=True)
            if response.status_code != 200 or page >= int(item.get('totalPages') or 1):
                break
            page += 1
        except (requests.RequestException, ValueError) as error:
            records.append({'site': letter, 'page': page, 'url': url, 'error': str(error)})
            print(letter, page, 'ERROR', str(error), flush=True)
            break
        finally:
            time.sleep(0.35)
    (dest / 'index.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
