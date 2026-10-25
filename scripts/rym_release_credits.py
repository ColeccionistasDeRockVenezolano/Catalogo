"""RYM credit extraction: desktop/mobile, unlinked people and track scopes.
Each explicit role keeps its own scope. A display duplicate is not another credit.
"""
import re
from lxml import html


def class_xpath(name):
    return f'contains(concat(" ",normalize-space(@class)," ")," {name} ")'


def text(node):
    return re.sub(r'\s+', ' ', node.text_content()).strip()


def extract_credits(source):
    tree = html.fromstring(source)
    output, seen = [], set()
    for item in tree.xpath(f'//ul[{class_xpath("credits")}]/li'):
        if item.xpath('ancestor::*[@id="catalog_list" or @id="my_catalog" or @id="track_ratings"]'):
            continue
        if 'expand_button' in (item.get('class') or '').split():
            continue
        containers = item.xpath(f'./*[{class_xpath("credits_artist")}]')
        names = containers or item.xpath('./a[1] | ./span[1]')
        if not names:
            continue
        name_node = names[0]
        if 'role_name' in (name_node.get('class') or '').split():
            continue
        name = text(name_node)
        if not name:
            continue
        links = name_node.xpath('.//a[@href]') if containers else ([name_node] if name_node.tag=='a' else [])
        href = links[0].get('href') if links else None
        roles = item.xpath(f'.//*[{class_xpath("role_name")}]')
        if not roles:
            roles = item.xpath(f'.//*[{class_xpath("credits_roles")}]')
        for role in roles or [None]:
            position_nodes = role.xpath(f'.//*[{class_xpath("role_tracks")}]') if role is not None else []
            positions = ', '.join(text(node) for node in position_nodes) or None
            label = re.sub(r'\s+',' ', ''.join(role.xpath(f'.//text()[not(ancestor::*[{class_xpath("role_tracks")}])]'))).strip() if role is not None else None
            key = (href or name.casefold(), label, positions)
            if key in seen:
                continue
            seen.add(key)
            output.append({'nombre': name, 'roles': label or None, 'href': href, 'positions': positions})
    return output
