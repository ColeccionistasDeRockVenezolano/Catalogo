"""Parse reviews structurally, preserving nested text and optional metadata."""
from __future__ import annotations
import re
from urllib.parse import urljoin
from bs4 import BeautifulSoup

RE_SHELL = re.compile(r'<div\b[^>]*\bid=["\']review_shell_std_(\d+)["\']')
RE_PAG = re.compile(r'/reviews/(\d+)/')
RE_TOTAL = re.compile(r'<h2[^>]*>\s*([\d,]+)\s*Reviews?\s*</h2>', re.I)
VERSION = 'reviews-dom-v2'


def limpiar_texto(value):
    soup = BeautifulSoup(value, 'lxml')
    for br in soup.find_all('br'):
        br.replace_with('\n')
    return soup.get_text().strip()


def parsear_reviews(html):
    soup = BeautifulSoup(html, 'lxml')
    total = None
    for heading in soup.select('h2'):
        match = re.fullmatch(r'([\d,]+)\s+Reviews?', heading.get_text(' ', strip=True), re.I)
        if match:
            total = int(match[1].replace(',', ''))
            break
    out = []
    for shell in soup.select('[id^="review_shell_std_"]'):
        rid = int(shell['id'].rsplit('_', 1)[1])
        user = shell.select_one('.review_user a')
        date = shell.select_one('.review_date a')
        rating = shell.select_one('.review_rating img[alt]')
        votes = shell.select_one('.review_vote_count')
        title = shell.select_one('.review_title')
        body = shell.select_one('.review_body .rendered_text')
        tracks = []
        for row in shell.select(f'#review_track_rating_{rid} li'):
            number = row.select_one('.tracklist_num')
            name = row.select_one('.tracklist_title')
            score = row.select_one('.track_rating_disp img[alt]')
            if number and name and score and number.get_text(strip=True).isdigit():
                tracks.append({'num': int(number.get_text(strip=True)), 'titulo': name.get_text(' ', strip=True),
                               'rating': score['alt'].replace(' stars', '')})
        out.append({'review_id': rid, 'usuario': user.get_text(strip=True) if user else None,
                    'usuario_url': user.get('href') if user else None,
                    'fecha': date.get_text(' ', strip=True) if date else None,
                    'review_url': urljoin('https://rateyourmusic.com', date['href']) if date else None,
                    'rating': rating['alt'].replace(' stars', '') if rating else None,
                    'votos': votes.get_text(strip=True) if votes else '',
                    'titulo': title.get_text(' ', strip=True) if title else None,
                    'texto': limpiar_texto(str(body)) if body else None, 'tracks': tracks})
    return total, out
