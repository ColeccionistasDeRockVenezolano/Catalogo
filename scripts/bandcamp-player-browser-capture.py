"""Resumable, isolated Bandcamp captures with Scrapling's pooled browser session.

Run with ~/.venvs/scrapling/bin/python after merging existing browser results.
"""
import asyncio
import hashlib
import json
import logging
import pathlib
import sys
from datetime import datetime, timezone

from scrapling.fetchers import AsyncStealthySession

logging.getLogger('scrapling').setLevel(logging.CRITICAL)

DEST = pathlib.Path(sys.argv[1])
SELECTOR = 'meta[name="bc-page-properties"], [data-item-id]'


async def main():
    urls = json.loads((DEST / 'pending.json').read_text())
    semaphore = asyncio.Semaphore(4)
    request_lock = asyncio.Lock()
    blocked = asyncio.Event()
    completed = 0
    async with AsyncStealthySession(max_pages=4, headless=True, disable_resources=True,
                                   timeout=20000, retries=1) as session:
        async def capture(url):
            nonlocal completed
            key = hashlib.sha256(url.encode()).hexdigest()
            target = DEST / f'browser-session-{key}.json'
            if target.exists():
                previous = json.loads(target.read_text())['result'][0]
                if previous['status'] not in (0, 429, 503):
                    completed += 1
                    return
            async with semaphore:
                if blocked.is_set():
                    return
                observed = {'status': 0}
                async def setup(page):
                    def response_received(response):
                        if response.request.resource_type == 'document':
                            observed['status'] = response.status
                            if response.status == 429:
                                blocked.set()
                    page.on('response', response_received)
                try:
                    async with request_lock:
                        if blocked.is_set():
                            return
                        await asyncio.sleep(2.5)
                    page = await session.fetch(url, page_setup=setup)
                    result = {'url': page.url, 'status': page.status,
                              'content': [element.html_content for element in page.css(SELECTOR)]}
                except Exception as error:
                    result = {'url': url, 'status': observed['status'], 'content': [], 'error': str(error)}
                data = {'requestedUrls': [url], 'retrievedAt': datetime.now(timezone.utc).isoformat(),
                        'engine': 'Scrapling AsyncStealthySession', 'selector': SELECTOR, 'result': [result]}
                target.write_text(json.dumps(data, ensure_ascii=False, indent=2))
                completed += 1
                if completed % 20 == 0:
                    print(f'{completed}/{len(urls)}', flush=True)
        await asyncio.gather(*(capture(url) for url in urls))
    print(f'Finished: {completed}', flush=True)
    if blocked.is_set():
        print('Stopped on HTTP 429; resume after the provider cooldown.', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
