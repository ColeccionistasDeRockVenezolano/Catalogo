"""Fail-closed validation: an URL/title alone cannot prove review identity."""
import hashlib
import re
from urllib.parse import urlsplit, unquote
from bs4 import BeautifulSoup
from rym_reviews_parse import parsear_reviews, VERSION


def path(value):
    return unquote(urlsplit(value).path).split('/reviews/')[0].rstrip('/')


def validate(html, task, final_url=None, status=200):
    soup = BeautifulSoup(html, 'lxml')
    errors = []
    expected = path(task['href'])
    allowed = {expected, *(path(x) for x in task.get('verifiedAliases', []))}
    title = soup.title.get_text(' ', strip=True) if soup.title else ''
    if re.search(r'^(?:rateyourmusic.com \| )?(?:50\d|Just a moment|Security check|Verification|Attention Required)', title, re.I):
        errors.append('error_or_challenge')
    if status in (429, 500, 502, 503, 504):
        errors.append('http_error')
    if final_url and path(final_url) not in allowed:
        errors.append('redirect_identity')
    og = soup.select_one('meta[property="og:url"]')
    if not og or path(og.get('content', '')) not in allowed:
        errors.append('canonical_identity')
    # Internal pagination must refer to this release, not a substituted body.
    nav = soup.select('a.navlinknum[href], a.navlinknext[href], a.navlinkprev[href]')
    pages = {1}
    for link in nav:
        match = re.search(r'/reviews/(\d+)/?', link['href'])
        if match:
            if path(link['href']) not in allowed:
                errors.append('pagination_identity')
            else:
                pages.add(int(match[1]))
    current = soup.select_one('.navlinkcurrent')
    if current and current.get_text(strip=True).isdigit() and int(current.get_text(strip=True)) != task['page']:
        errors.append('wrong_page')
    if task['page'] > 1 and current is None:
        errors.append('page_unproven')
    total, reviews = parsear_reviews(html)
    # Review permalinks omit release type; compare artist AND publication, retaining edition suffixes.
    keys = {tuple(p.strip('/').split('/')[2:4]) for p in allowed}
    for review in reviews:
        url = review.get('review_url')
        parts = urlsplit(url or '').path.strip('/').split('/')
        if len(parts) != 5 or parts[0] != 'music-review' or tuple(unquote(x) for x in parts[2:4]) not in keys:
            errors.append('review_identity')
        if not review.get('usuario') or not review.get('fecha') or not review.get('texto'):
            errors.append('incomplete_review')
    if not reviews and total != 0:
        errors.append('empty_unproven')
    ids = [r['review_id'] for r in reviews]
    if len(ids) != len(set(ids)):
        errors.append('duplicate_review')
    return {'valid': not errors, 'errors': sorted(set(errors)), 'total': total,
            'reviews': reviews, 'pages': sorted(pages), 'title': title,
            'htmlSha256': hashlib.sha256(html.encode()).hexdigest(), 'validator': VERSION}
