"""Evidence-based RYM artist identity shared by offline planning and application.

Names select candidates; country and genre never resolve an identity. Titles
retain edition words. Generic/eponymous titles cannot establish shared repertoire.
"""
import re
import unicodedata

VERSION = "crv-rym-identity-v1"
GENERIC = {"demo", "demos", "ep", "single", "live", "en vivo", "greatest hits", "exitos", "album", "the album", "untitled"}


def norm(value):
    display=str(value or '').strip()
    value=''.join(c for c in unicodedata.normalize('NFD',display.lower()) if unicodedata.category(c)!='Mn')
    key=' '.join(''.join(c if c.isalnum() else ' ' for c in value).split())
    if not key or len(key)<2 and len(display)>1 and any(not c.isalnum() and not c.isspace() for c in display):
        return ' '.join(unicodedata.normalize('NFKC',display).lower().split())
    return key


def distinctive(title, artist):
    key = norm(title)
    return sum(c.isalnum() for c in key) >= 4 and key not in GENERIC and key != norm(artist) and not key.isdigit()


def assess(source, artist):
    source_titles = {}
    for row in source.get('discografia_listada') or []:
        source_titles.setdefault(norm(row.get('t')), []).append(row)
    shared = []
    for album in artist.get('albums') or []:
        matches = source_titles.get(norm(album['title']), [])
        if matches and distinctive(album['title'], artist['name']):
            shared.append({'albumId': album['id'], 'title': album['title'], 'sourceTitle': matches[0]['t'],
                           'year': album.get('year'), 'sourceYear': matches[0].get('y')})
    unique_titles = {norm(x['title']) for x in shared}
    info = source.get('info') or {}
    formed = info.get('Formed', '')
    year = re.search(r'\b(?:18|19|20)\d{2}\b', formed)
    year_agrees = bool(year and artist.get('formedYear') and int(year[0]) == artist['formedYear'])
    city = norm(artist.get('city'))
    city_agrees = bool(city and (' '+city+' ') in (' '+norm(formed).split(' venezuela')[0]+' '))
    source_member_names = {norm(x.split('(')[0]) for x in info.get('Members', '').split('),')}
    members = [m for m in artist.get('members') or [] if len(norm(m['name']).split()) >= 2 and norm(m['name']) in source_member_names]
    member_ids = {m['id'] for m in members}
    same = len(unique_titles) >= 2 or (len(unique_titles) >= 1 and year_agrees and city_agrees) or len(member_ids) >= 2
    return {'status': 'resolved' if same else 'needs_review', 'artistId': artist['id'],
            'name': artist['name'], 'sharedAlbums': shared, 'memberMatches': members,
            'yearAgrees': year_agrees, 'cityAgrees': city_agrees,
            'catalogYear': artist.get('formedYear'), 'catalogCity': artist.get('city'),
            'rule': 'shared_repertoire' if len(unique_titles) >= 2 else 'repertoire_year_city' if same and shared else 'two_full_name_members' if same else 'insufficient_evidence'}
def publication_type_conflict(source_type, current_type, classifications=(), audio_edition_verified=False):
    raw = source_type or ''
    if not raw.strip() or re.search(r'video|documentary|documental|interview|entrevista|short|bootleg|unauthorized', raw, re.I):
        return True
    if 'additional release' in raw.lower() and not audio_edition_verified:
        return True
    parts = [part.strip().lower() for part in re.split(r'[,;+]', raw)]
    wanted = next((part for part in parts if part in ('album', 'ep', 'single', 'compilation', 'live album', 'studio album')), None)
    source_base = 'album' if wanted in ('album', 'compilation', 'live album', 'studio album') else wanted
    current_base = 'album' if current_type in ('studio_album', 'live_album', 'compilation') else current_type if current_type in ('single', 'ep') else None
    special = 'DJ Mix' if 'dj mix' in parts else 'Mixtape' if 'mixtape' in parts else None
    if special=='DJ Mix' and not audio_edition_verified and 'DJ Mix' not in classifications:
        return True
    if special:
        return current_base in ('single','ep') and special not in classifications
    if not source_base or not current_base or source_base == current_base:
        return False
    labels = ('Album', 'Studio Album', 'Live Album', 'Compilation Album') if source_base == 'album' else ('EP',) if source_base == 'ep' else ('Single',)
    return not any(label in classifications for label in labels)

