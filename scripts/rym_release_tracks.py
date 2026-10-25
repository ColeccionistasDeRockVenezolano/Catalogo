"""Literal RYM track rows, including split song links around artist credits."""
import copy
import re
import unicodedata
from urllib.parse import unquote
from lxml import html


def has_class(node, value):
    return value in (node.get('class') or '').split()


def text(node):
    return re.sub(r'\s+', ' ', node.text_content()).strip() if node is not None else ''


def title_key(value):
    value = ''.join(character for character in unicodedata.normalize('NFD', unquote(value)).lower() if not unicodedata.combining(character))
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def classes(value):
    return f"contains(concat(' ',normalize-space(@class),' '),' {value} ')"


def publication_attributes(tree):
    attributes = []
    for row in tree.xpath(f'//tr[th[{classes("info_hdr")}]]'):
        heading = row.xpath('./th')[0]
        cells = row.xpath('./td')
        if text(heading).lower() == 'ranked' and cells:
            value = text(cells[0])
            for token, classification in [('live', 'En vivo'), ('archival', 'Archival'), ('soundtracks?', 'Soundtrack')]:
                if re.search(r'\bfor\s+'+token+r'\b', value, re.I):
                    attributes.append({'classification': classification, 'basis': 'ranked_release_type', 'evidence': value})
            break
    return attributes


def extract_tracks(markup):
    tree = html.fromstring(markup)
    output = {'pistas': [], 'n_pistas': 0, 'total_text': None, 'total_seg': None, 'publication_attributes': publication_attributes(tree)}
    primary = tree.xpath('//*[@id="tracks"]')
    mobile = tree.xpath('//*[@id="tracks_mobile"]')
    roots = [node for node in primary+mobile if node.xpath(f'.//li[{classes("track")}]//*[{classes("tracklist_title")}]')]
    if roots:
        tree = roots[0]  # One presentation of the selected release, never personal catalogs or other issues.
    elif tree.xpath('//*[@id="catalog_list" or @id="my_catalog" or @id="track_ratings"]'):
        return output
    seen = set()
    rows = tree.xpath(f'.//li[{classes("track")}]')
    if tree.tag == 'li' and has_class(tree, 'track'):
        rows.insert(0, tree)
    for li in rows:
        lines = li.xpath(f'./*[{classes("tracklist_line")}]')
        totals = li.xpath(f'.//*[{classes("tracklist_total")}]')
        if totals:
            output['total_text'] = text(totals[0])
            match = re.search(r'(\d+):(\d{2})(?::(\d{2}))?', output['total_text'])
            if match:
                output['total_seg'] = (int(match[1])*3600+int(match[2])*60+int(match[3])) if match[3] else int(match[1])*60+int(match[2])
            continue
        if not lines and not li.xpath(f'./*[{classes("tracklist_title")}]'):
            continue  # Structural parent; never borrow a nested track's fields.
        line = lines[0] if lines else li
        titles = line.xpath(f'.//*[{classes("tracklist_title")}]')
        if not titles:
            continue
        title_node = titles[0]
        links = title_node.xpath(f'.//a[{classes("song")}]')
        if not links:
            links = title_node.xpath(f'.//a[contains(@href,"/song/") and not({classes("tracks_lyric_link")}) and not(contains(@href,"#lyrics"))]')
        meaningful = [node for node in links if any(character.isalnum() for character in text(node))]
        chosen = meaningful[-1] if meaningful else links[-1] if links else None
        distinct = {node.get('href') for node in meaningful}
        ambiguous = len(distinct) > 1
        artist_nodes = title_node.xpath(f'.//a[{classes("artist")}]')
        if chosen is not None:
            anchors = list(title_node.iter('a'))
            delimiters = [node for node in links if re.match(r'^[-–—]\s+', text(node)) and any(has_class(other, 'artist') for other in anchors[:anchors.index(node)])]
            words = title_node.xpath(f'.//text()[not(ancestor::*[{classes("tracklist_duration")} or {classes("tracks_lyric_link")}])]')
            if delimiters:
                chosen = delimiters[0]
                start = next(index for index, word in enumerate(words) if word.getparent() is chosen or chosen in list(word.getparent().iterancestors()))
                title = re.sub(r'^[-–—]\s+', '', re.sub(r'\s+', ' ', ''.join(words[start:])).strip())
            else:
                title = re.sub(r'\s+', ' ', ''.join(words)).strip()
                if artist_nodes and anchors.index(artist_nodes[0]) < anchors.index(links[0]):
                    fragment = text(chosen)
                    tail = re.split(r'\s+[-–—]\s+', fragment)[-1]
                    slug = (chosen.get('href') or '').rstrip('/').split('/')[-1]
                    if fragment.startswith('by ') and tail != fragment and title_key(tail) == title_key(slug):
                        title = tail  # Literal title also agrees with its canonical song URL.
                    else:
                        ambiguous = True
        else:
            clean = copy.deepcopy(title_node)
            for node in clean.xpath(f'.//*[{classes("tracklist_duration")} or {classes("tracks_lyric_link")}] | .//a[{classes("artist")}]'):
                node.drop_tree()
            title = text(clean)
            if artist_nodes:
                title = re.sub(r'^(?:[-&/]\s*)+', '', title).strip()
        if not title:
            continue
        ambiguous = ambiguous or not any(character.isalnum() for character in title)
        nums = line.xpath(f'.//*[{classes("tracklist_num")}]')
        durations = line.xpath(f'.//*[{classes("tracklist_duration")}]')
        number = text(nums[0]) if nums else ''
        key = (number, title)
        if key in seen:
            continue
        seen.add(key)
        duration = durations[0] if durations else None
        try:
            seconds = int(duration.get('data-inseconds')) if duration is not None and duration.get('data-inseconds') is not None else None
        except ValueError:
            seconds = None
        track = {'n': number, 'titulo': title, 'seg': seconds, 'dur': text(duration),
                 'href': chosen.get('href') if chosen is not None else None, 'nota': text(li)[:2000],
                 'artist_credits': [{'nombre': text(node), 'href': node.get('href')} for node in artist_nodes]}
        if ambiguous:
            track['title_ambiguous'] = True
            track['title_candidates'] = [{'titulo': text(node), 'href': node.get('href')} for node in links]
        output['pistas'].append(track)
    output['n_pistas'] = len(output['pistas'])
    return output
