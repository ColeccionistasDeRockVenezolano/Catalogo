#!/usr/bin/env python3
"""Plan source-attributed catalog additions; never writes the database.

Brian authorized accepting this archived blog as the source on 2026-11-10.
Unknown identities are source-attributed, not independently verified biographies.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
import pathlib
import re
from urllib.parse import urlsplit, unquote

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / 'reports/antologia-cotejo-integral-2026-11-09'
spec = importlib.util.spec_from_file_location('cotejo', ROOT/'scripts/antologia-cotejo-integral.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
norm = c.norm
SOURCE_STYLES=set(map(norm, 'Chachachá|Son|Chunga|Bolero|Cumbia|Guaracha Plena|Merengue|Porro Cumbé|Estilo|Guaracha|Merengue Dominicano|Charleston Instrumental|Cha Cha Samba|Joropo|Pasaje|Vals|Gaita|Instrumental|Salsa|Bossa Nova|Tango|Balada|Danzón|Bambuco|Plena|Porro|Cha Cha Cha'.split('|')))

# Source labels for collections, publishers, styles and series are not artists.
COLLECTIONS = set(map(norm, '''Llaneras|Arpas De Venezuela I|Cd Mania|La Federacion Venezolana De Coleo|Margarita Y Su Musica|Musica Popular Y Floklorica De Venezuela|Coleccion Lo Mejor|Venezuela Canta Y Baila|La Maravillosa Musica Venezolana|Venezuela Folklore Regional|Venezuela|Tecnobaile|VenezuelaDemo disco 24|Festividades|Lo Mejor De La Navidad Venezolana|Tradición Navideña|Un Regalo A Venezuela|Yo Soy Venezuela|Serenata Llanera|20 Pegaditas Decembrinas|FolkSong From Venezuela|Venezuela Y Sus Canciones|20 Voces Inolvidables De La Venezuela Romantica|Los Grandes Del Llano|Oriente Mio|Evocación Andina|Joropos Y Pasajes|World Network|La Vitrola Popular 950|Saxo Romantico En Venezuela|El Disco De Oro|Los 4 Grandes|Saxo Romantico|Fundacion Bigott|Todos Juntos|La Grandeza Del Joropo|V.A. Bandola Y Bandolin|Maravillosa Venezuela|Bailables 100%|V.A. Todos Juntos|Noche Caliente|V. A. Canciones Tradicionales Navideñas|Musica Oriental Venezolana|Lo Maximo De La Musica Venezolana|Valses De Antonio Lauro|1er Festival Del Galeron Oriental|Lo Mejor Del Encuentro Del Joropo Llanero|Venezuela Plurar|Venezuela De Luz|Acuarela Musical Venezolana|Festival Del Merengue|Corporacion De Turismo De Venezuela|Venezuela Musica De Mi Tierra|Sucre Musica Y Tradicion|Gran Festival De Musica Criolla|Los Mejores Timbaleros De Venezuela|La Bandola Oriental En Tres Generaciones|Canto Bicentenario|Las Mejores Gaitas|Clasicos De La Gaita|PDVSA|Inolvidables En Arpa|Pa' Los Salseros|Sabor A Fania|La Salsa De Venezuela|Venezuela Plural|16 Voces Del Llano|Camara Venezolana De Productores Fonograficos|Golpes Tocuyanos Y Mirandinos|Los Mejores Istrumentales De Venezuela|Pueblo, Tambor Y Canto|Canchunchu Florido "Venezuela Plurar"|Varios Artistas Super Favoritas Rumbos|Colección Venezuela Plural|Serie Caracas 400 Años|Venezuelan Salsa|V. A. San Remo 69 En Español (1969) Velvet'''.split('|')))

# Explicit spelling/nickname variants appearing in the same source collection.
# Do not singularize arbitrary names, or strip "y su ..." across projects.
VARIANT_GROUPS = '''Cheo Hernandez Prisco|Cheo Hernadez Prisco|Cheo Hernandez Prisco (El Coplero Coleador)
Ali Cabello|Ali Cabellos
Victor Veliz|Víctor Veliz|Victor Véliz
Luis Lozada (El Cubiro)|Luis Lozada El Cubiro
Hector Cabrera|Hector Crabrera
Rafael Martinez (El Cazador Novato)|Rafael Martinez A. (El Cazador Novato)|Rafael Martinez "El cazador Novato"|El Cazador Novato
Rogelio Ortiz|Rogelio Ortiz (El Caballero Del Canto Nacional)
Hernan Gamboa (El Cuatro De Venezuela)|Hernán Gamboa (El Cuatro De Venezuela)
Rosalinda Garcia|Rosa Linda Garcia|Rosalinda Garcia "La Reyna"
Orquesta La Dimension De Siempre|Orquesta La Dimension De Siempre "La Original"|Dimension De Siempre (La Original)
Banda T.T. (Transito Terrestre)|Banda T.T (Transito Terrestre)|Banda T. T. (Transito Terrestre)
Edmundo Ros|Edmundo Ross
The Lasser Play Orchestra|The Laseer Play Orchestra
Orquesta Ideal|La Orquesta Ideal
Gaita Con Todo|Gaita ConTodo
Eukaris|Eucaris|Eukaris (La Nena Sexy De La Salsa)
Edith Salcedo|Edith Salcedo (La Negrita Cariñosa)|Edith Salcedo "La Negrita Cariñosa"
Argenis Sanchez|Argenis Sanchez (La Voz Recia )
Orquesta La Decada|Orquesta La Década
Orquesta Sinsaye|Orquesta Sinsaye De Venezuela
Orquesta Salsa Y Cebada|Salsa Y Cebada
Orquesta La Salsa Mayor|La Salsa Mayor|La Salsa Mayor Nuestra Orquestra
Pancho Prim (El Rey Del Canto Mirandino)|Pancho Prim "El Rey Del Canto Mirandino"
Francisco Mata Y Sus Guaiqueries|Francisco Mata Y Sus Guaiqueríes
Jose Jimenez "El Pollo De Orichuna"|José Jiménez (El Pollo De Orichuna)
Cristobal Jimenez "El Coplero De Oro "|Cristóbal Jiménez El Coplero De Oro
Orquesta Venezuela En Ritmo|Orq. Venezuela En Ritmo
Nohemi Berlaty|Nohemi Berlatti
Supertamarindo|Supertamarindo, Saxo Romántico
Nathalia Mendoza (La Bella Del Llano)|Nathalia Mendoza
Orquesta Bronko De Venezuela|Orquesta Broko
Juan Pablo Barrios His Salsa Latin Jazz|Juan Pablo Barrios Salsa Latín Jazz
Los Pacheco|Los Pachecos
Los Juniors|¡Los Juniors!
Cheo Feliciano Y La Rondalla Venezolana|Cheo Feliciano Y Rondalla Venezolana
Hugo Liscano Y Javier Galue|Hugo Liscano, Javier Galué
Orquesta La Amistad Chuito y Rodrigo|Orquesta La Amistad Chuito Y Rodrigo
Don Nauro & His Caribbean Bar Sextett|Don Nauro Y Sus Caribbean, Double Bar Sextett'''
VARIANTS = {}
for group in VARIANT_GROUPS.splitlines():
    names = group.split('|')
    for name in names:
        VARIANTS[norm(name)] = names[0]

# Reviewed publication attributions: the source's distinctive name and the
# artist's registered repertoire agree. These are parent credits for these
# publications, not identity merges or new universal artist aliases.
PUBLICATION_ARTISTS={norm(name):aid for name,aid in [
 ('Billo Caracas Boys',3764),('Fucho Aparicio',3960),
 ('Luis Felipe Gonzalez Y Sus Estrellas',6750),
 ('Jesus Moreno Conjunto De Omar Moreno',6659),
 ('Juan Vicente Torrealba Coleccion De Oro',3829),
 ('Orquesta La Amistad Chuito y Rodrigo',3736),
 ('Magia Caribeña Y Sus Amigos',7931),('Huascar Barrada',3904),
 ('Yordano Di Marzo',264),('Eduardo Vals',8682),
 ('Jesus Sevillano Con Estudiantina Universitaria UCV',3827),
 ('Alfredo Naranjo Y Su Guajeo',3610),
 ('Manolo Monterrey Con La Orquesta Sans Souci',6707),
 ('Jesus Avila Y Su Conjunto Cuerdas Espartanas',8761),
 ('Tony Monserrat Su Piano Y Ritmo',5876),
 ('Maria Teresa Chacin Con Su Conjunto',3797),
]}

# Separator-free titles manually read against their source headers. Preserve
# the complete publication title; these are artist attributions, not renames.
NONSTANDARD = {
 'hector-cabrera-y-juan-vicente-torrealba': 'Hector Cabrera Y Juan Vicente Torrealba',
 'victor-mendoza-el-clan-de-victor': 'El Clan De Victor',
 'elio-pacheco-y-su-mafia-latina': 'Elio Pacheco Y Su Mafia Latina',
 'orquesta-sinfonica-municipal-de-caracas': "Orquesta Sinfonica Municipal De Caracas Presenta A Oscar D' Leon",
 'aldemaro-romero-y-su-musica': 'Aldemaro Romero',
 'mon-carrillo-y-su-sexteto': 'Mon Carrillo Y Su Sexteto',
 'ray-perez-y-el-grupo-casabe': 'Ray Perez Y El Grupo Casabe',
 'rafa-galindo-con-la-rondalla': 'Rafa Galindo Con La Rondalla Venezolana',
 'violines-tipicos-andinos': 'Violines Tipicos Andinos',
 'vasallos-del-sol-en-vivo': 'Vasallos Del Sol',
 'ensamble-gurrufio-presenta': 'Ensamble Gurrufío Presenta Alexis Cárdenas',
 'jose-antonio-garcia-con-la-rondalla': 'Jose Antonio Garcia Con La Rondalla Venezolana',
 'pedro-ramon-oropeza': 'Pedro Ramon Oropeza',
 'la-banda-y-su': 'La Banda',
 'magdalena-sanchez-y-el-cuarteto': 'Magdalena Sanchez Con Cuarteto Criollo De Ulises Acosta',
 'nelson-henriquez-vs-luis-felipe': 'Nelson Henriquez vs Luis Felipe Gonzalez Con Nelson Y Sus Estrellas',
 'joselo-las-gaitas': 'Joselo Con Hugo Blanco Y Su Conjunto',
 'la-brabra-sound': 'La BraBra Sound De Enrique "Culebra" Iriarte',
 'carlos-guerra-y-su-quinteto': 'Carlos Guerra Y Su Quinteto Tropical',
 'caricuao-experimental': 'Caricuao Experimental',
 'koquimba-2000': 'Koquimba',
 'franklin-virguez-y-su-orquesta': 'Franklin Virguez Y Su Orquesta',
 'magia-caribena-y-sus-amigos': 'Magia Caribeña Y Sus Amigos',
 'orquesta-tokun': 'Orquesta Tokun',
 'carlos-tabaco-quintana-y-su-sexteto': 'Carlos "Tabaco" Quintana Y Su Sexteto',
 'standarte-la-orquesta': 'StandArte La Orquesta',
 'orquesta-ensueno-tropical': 'Orquesta Ensueño Tropical',
 'chani-martinez-y-su-super-quinteto': 'Chani Martinez Y Su Super Quinteto',
 'hely-orsini': 'Hely Orsini',
 'la-nueva-sepias-boys': "La Nueva Sepias Boy's Big Band Orquesta",
 'perucho-aguirre-y-su-collar': 'Perucho Aguirre Y Su Collar De Perlas',
 'coro-de-camara-de-merida': 'Coro De Camara De Merida',
 'francisco-mata-y-sus-guaiqueries': 'Francisco Mata Y Sus Guaiqueries',
 'nano-nano-grant': 'Nano "Nano Grant" Y La Salsa Cubana',
 'dionisio-bolivar-y-etanislao': 'Dionisio Bolivar Y Etanislao Parra',
 'nelson-y-renny': 'Nelson Y Renny',
 'venezuela-una-cancion': 'Chelique Sarabia, César Prato & Los Cuñaos',
}

def image_key(url):
    return re.sub(r'/(?:s\d+(?:-[^/]*)?|w\d+(?:-h\d+)?(?:-[^/]*)?)/', '/', unquote(urlsplit(url).path))


def publication_track_forms(title):
    forms=c.track_forms(title)
    medley=re.split(r'\s+[aA]\)\s*',title,maxsplit=1)[0]
    forms.add(norm(medley))
    return {re.sub(r'\b(?:n|no|numero)\s*(?=\d)', '',k).strip() for k in forms if k}


def source_title_layout(tracks):
    lines=[t.get('source_line',t['title']) for t in tracks]
    lead=sum(bool(re.match(r'^\([^()]+\)\s+\S',line)) for line in lines)
    trailing=sum(bool(re.search(r'\([^()]+\)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]',line)) for line in lines)
    return {'leading':lead>=max(2,len(lines)*.5),'trailing':trailing>=max(2,len(lines)*.5)}


def clean_listed_tracks(tracks,parser,artist_names):
    """Read the blog's three documented credit layouts without folding credits
    into titles: labelled, (performer) title (author), title (author) performer.
    Layout agreement across a list disambiguates otherwise unlabelled names.
    """
    layout=source_title_layout(tracks)
    out=[]
    for original in tracks:
        t=dict(original);line=t.get('source_line',t['title'])
        quoted=re.search(r'[\"“]([^\"”]+)[\"”]',line)
        if quoted and norm(quoted[1]) in SOURCE_STYLES and quoted.start()>0 and '(' not in line[:quoted.start()]:
            line=line[:quoted.start()].strip()
        slash=re.match(r'^(.+?)\s*/\s*([^()/]+)(?=\s*\(|$)',line)
        if slash and norm(slash[2]) in SOURCE_STYLES:
            line=slash[1].strip()+line[slash.end():]
        lead=re.match(r'^\(([^()]+)\)\s+(.+)$',line)
        if lead and (layout['leading'] or norm(lead[1]) in artist_names):
            t['performer']=lead[1];line=lead[2]
        # Explicit abbreviated performer/technical labels, including Intp.
        line=re.split(r'\s+(?:Intp\.?\s*:?[ \t]|Arrg\.?\s+(?:Espa[nñ]ol|:)|Autor(?:es)?(?:\s+[Ee]\s+Int[eé]rpretes?)?\s*[.:])',line,maxsplit=1,flags=re.I)[0].strip()
        parens=list(re.finditer(r'\(([^()]*)\)',line))
        if parens:
            last=parens[-1];suffix=line[last.end():].strip()
            if suffix and (layout['trailing'] or norm(suffix) in artist_names or re.match(r'^(?:Con\s+|Arrg\.?\b|Arreglos?\b)',suffix,re.I)):
                # Numeric dates/durations and version descriptors are not people.
                if not re.match(r'^(?:\d|en vivo\b|versi[oó]n\b|remix\b|instrumental\b|ac[uú]stico\b)',suffix,re.I):
                    t['performer']=suffix;line=line[:last.end()].strip()
        elif layout['trailing'] and re.search(r'["“]',line):
            # This layout also quotes an author instead of parenthesizing it.
            line=re.split(r'["“]',line,maxsplit=1)[0].strip()
        parsed=parser._parse_track_disc(f"{t['n']}.- {line}")
        if parsed and parsed[0]['title']:t['title']=parsed[0]['title']
        out.append(t)
    return out

def source_positions(tracks):
    """Literal positions when unique; source order if the source repeats labels.

    No disc is inferred from a reset. Every original label/side stays in notes.
    The fallback number is explicitly an ordinal of the archived listing.
    """
    pairs = [(t.get('disc',1), t['n']) for t in tracks]
    repeated = len(pairs) != len(set(pairs)) or any(d<1 or n<1 for d,n in pairs)
    counts = collections.Counter()
    out = []
    for t in tracks:
        disc = t.get('disc',1)
        counts[disc] += 1
        n = counts[disc] if repeated else t['n']
        title = t['title'].strip()
        # Explicit credits remain in notes, never in the display title. Do not
        # cut titles just because they contain a musical instrument or musician.
        title=re.split(r'\s+\((?:Letra\s+[Yy]\s+M[uú]sica\s*:|Composici[oó]n/)',title,maxsplit=1)[0].strip()
        if re.search(r'\([^)]*\b(?:Arreglo|Arreglos|Vocalizando)\b',title,re.I):
            title=title.split('(',1)[0].strip()
        title=re.split(r'\s+(?:Arreglos?\s*:|Arreglos?\s+(?=[A-ZÁÉÍÓÚÑ])|Integrantes\s+(?=[A-ZÁÉÍÓÚÑ])|Invitados?\s*:)',title,maxsplit=1)[0].strip()
        # This one source paragraph explicitly includes arrangement/performance
        # commentary in parentheses; retain the entire commentary in notes.
        if len(title)>250 and re.search(r'\(.*Arreglo De',title,re.I):
            title=title.split('(',1)[0].strip()
        assert title and len(title)<=250, title
        note = f"Fuente: posición {t['n']}, disco {disc}" + (f", lado {t['side']}" if t.get('side') else '') + '.'
        if repeated: note += ' La posición del catálogo indica el orden del listado; la fuente repite numeración o usa cero sin distinguir todas las posiciones válidas del catálogo.'
        note += '\nTexto literal de la fuente:\n' + t['raw']
        out.append({'disc':disc,'n':n,'title':title,'notes':note,'source_number':t['n'],'source_side':t.get('side'),'ordinal_position':repeated})
    return out

def main(out):
    from bs4 import BeautifulSoup
    from PIL import Image
    load=lambda k:json.loads((out/(k+'-snapshot.json')).read_text())
    artists={a['id']:a for a in load('artists')}
    albums={a['id']:a for a in load('albums')}
    parser=c.load_parser()
    labels=[(norm(o['name']),o) for o in load('organizations') if o['organization_type']=='record_label']
    entries=[json.loads(l) for l in (BASE/'entries.jsonl').open()]
    posts={p['url']:p for p in map(json.loads,(ROOT/'data/raw/antologiavenezuela-blogspot/posts.jsonl').open())}
    artist_keys=collections.defaultdict(set)
    for a in artists.values():artist_keys[norm(a['name'])].add(a['id'])
    for a in load('artist_aliases'):
        if a['confidence']!='rejected' and a['artist_id'] in artists:artist_keys[norm(a['alias'])].add(a['artist_id'])
    artist_keys.pop('',None)
    documented=collections.defaultdict(set)
    for e in entries:
        if e['album_id'] in albums and e['parts']['artist']:
            aid=albums[e['album_id']]['artist_id']
            words=set(norm(e['parts']['artist']).split())-{'de','del','la','los','las','el','y','su','sus','con','orquesta','grupo','band'}
            target=set(norm(artists[aid]['name']).split())-{'de','del','la','los','las','el','y','su','sus','con','orquesta','grupo','band'}
            # Repertoire-only matches to an unrelated performer are never
            # transitive artist evidence (e.g. Estelita / Nuevo Mundo Jazz Band).
            if words&target or any(len(w)>=4 and len(t)>=4 and w[:3]==t[:3] for w in words for t in target):
                documented[norm(e['parts']['artist'])].add(aid)
    image_rows=collections.defaultdict(list)
    for img in map(json.loads,(ROOT/'data/raw/antologiavenezuela-blogspot/images.jsonl').open()):
        if img.get('status')=='ok' and img.get('file'):
            image_rows[image_key(img['key'])].append(img)
    # Reuse a completed cover selection in this same campaign. Covers and the
    # source capture are immutable; repeated HDD image decoding is unnecessary.
    cover_cache={}
    previous_plan=out/'import-plan.jsonl'
    if previous_plan.exists():
        for op in map(json.loads,previous_plan.open()):
            if op['fields'].get('cover_url'):cover_cache[op['url']]=op['fields']['cover_url']
    def cover(post):
        if post['url'] in cover_cache:return cover_cache[post['url']]
        soup=BeautifulSoup(post['content_html'],'html.parser')
        for img in soup.find_all('img'):
            choices=image_rows.get(image_key(img.get('src','')),[])
            if not choices:continue
            ranked=[]
            for im in choices:
                file=ROOT/'web/public/media/antologiavenezuela-blogspot'/im['file']
                with Image.open(file) as picture:width,height=picture.size
                ranked.append((width*height,im))
            im=max(ranked,key=lambda r:r[0])[1]
            return '/crv/media/antologiavenezuela-blogspot/'+im['file']
        return None
    tracks=collections.defaultdict(list)
    for t in load('tracks'):tracks[t['album_id']].append(t)
    plan=[];canonical_names={}
    for e in entries:
        if e['status'] in ('matched','matched_reviewed','editorial_no_album','editorial_with_two_releases'):continue
        p=posts[e['url']];parts=dict(e['parts']);raw_artist=parts['artist']
        compilation=parts['compilation'] or norm(raw_artist) in COLLECTIONS or bool(re.match(r'^v\.?\s*a\.?\s',raw_artist,re.I))
        if e['status']=='nonstandard_title':
            slug=p['url'].rsplit('/',1)[-1]
            raw_artist=next((v for k,v in NONSTANDARD.items() if slug.startswith(k)), '')
            compilation=not bool(raw_artist)
        name='Various Artists' if compilation else VARIANTS.get(norm(raw_artist),raw_artist)
        if '/gallo-cuatro-y-bandola.' in e['url']:
            # Neither text nor the cover names a performer. An explicit unknown
            # reference is preferable to falsely calling this a compilation.
            name='Artista por identificar';compilation=False
        ids=artist_keys.get(norm(name),set())
        proof='registered_name_or_alias'
        if not ids:
            ids=documented.get(norm(raw_artist),set()) or documented.get(norm(name),set())
            proof='same_source_artist_and_previously_matched_discography'
        if not ids and norm(raw_artist) in PUBLICATION_ARTISTS:
            ids={PUBLICATION_ARTISTS[norm(raw_artist)]}
            proof='reviewed_source_name_and_documented_repertoire'
        if len(ids)>1: raise ValueError(('ambiguous artist',name,ids))
        artist_id=next(iter(ids)) if ids else None
        if not artist_id:name=canonical_names.setdefault(norm(name),name)
        fields={'title':parts['album'] or p['title']}
        if compilation and norm(parts['artist']) in COLLECTIONS:
            fields['title']=parts['artist']+' — '+fields['title']
        # The full title remains documentary when no artist/title delimiter exists.
        if e['status']=='nonstandard_title':fields['title']=parts['album']
        if parts['year'] and 1900<=parts['year']<=2100:fields['release_year']=parts['year']
        if compilation:fields['album_type']='compilation'
        elif re.search(r',\s*EP\s*(?:\(|$)',p['title'],re.I):fields['album_type']='ep'
        tail=parts['label_raw'] or ''
        label_key=norm(tail)
        label_matches=[o for key,o in labels if label_key==key or label_key.startswith(key+' ')]
        if label_matches:
            longest=max(len(norm(o['name'])) for o in label_matches)
            precise=[o for o in label_matches if len(norm(o['name']))==longest]
            if len(precise)==1:fields['label_id']=precise[0]['id']
        code=re.search(r'\b(?:[A-Z]{1,6}[-. ]?\d{2,}[A-Z0-9.\-/]*|\d{1,3}\.\d{2,}(?:[-.]\d+)*)\b',tail)
        if code:fields['catalog_id']=code[0].strip()
        cov=cover(p)
        if cov:fields['cover_url']=cov
        fmt=re.search(r'\b(CD|LP|Cassette)\b',p['title'],re.I)
        if fmt:fields['media_format']=fmt[1].upper()
        parsed_tracks=clean_listed_tracks(e['source_tracks'],parser,artist_keys)
        # These two posts use long prose credits and genre parentheses rather
        # than the blog's usual composer notation. Read the literal title
        # boundary from each numbered source line, preserving all else in notes.
        if '/sucre-musica-y-tradicion-vol-02-' in e['url']:
            for t in parsed_tracks:t['title']=t['source_line'].split('(',1)[0].strip()
        if '/prisca-davila-y-marieva-davila-' in e['url']:
            for t in parsed_tracks:t['title']=re.split(r'["“]',t['source_line'],maxsplit=1)[0].strip()
        source_tracks=source_positions(parsed_tracks)
        # Preserve complete documentary text, not inferred person identities.
        fields['notes']=f"Publicación documentada en Antología de la Música Venezolana. Fuente secundaria aceptada para esta importación por Brian (2026-11-10).\nFuente: {e['url']}\nTítulo literal: {p['title']}\nAtribución literal: {raw_artist or 'publicación colectiva; intérpretes en el listado'}.\nLas fechas, títulos y créditos se conservan según esta fuente; no implican verificación independiente de identidades."
        if parts['label_raw']:fields['notes']+='\nSello/catálogo o anotación literal: '+parts['label_raw']
        targets=[]
        if artist_id:
            for a in albums.values():
                if a['artist_id']!=artist_id or norm(a['title'])!=norm(fields['title']):continue
                ks=set().union(*(publication_track_forms(t['title']) for t in tracks[a['id']])) if tracks[a['id']] else set()
                matched=sum(bool(publication_track_forms(t['title'])&ks) for t in source_tracks)
                coverage=matched/max(len(source_tracks),len(tracks[a['id']]),1)
                same_year=bool(parts['year'] and a['release_year']==parts['year'])
                threshold=.75 if compilation else .5
                if (not ks and (not a['release_year'] or not parts['year'] or same_year)) or coverage>=.9 or (same_year and matched>=2 and coverage>=threshold):targets.append(a['id'])
        # The source preserves the two complete sides, while the existing
        # catalog indexes their subsections. Cover credit + title + year bind
        # the publication; the source's two-part listing stays documentary.
        if '/venezuela-una-cancion' in e['url']:targets=[8066]
        # Same artist and complete repertoire; the source year remains on its version.
        if '/billos-caracas-boys-tres-regalos-1961.html' in e['url']:targets=[7933]
        if '/billos-caracas-boys-al-amanecer-1967.html' in e['url']:targets=[7928]
        numbered_box=bool("70 Años, Para Siempre" in p['title'] and re.search(r'CDs\s+[1-6]',p['title']))
        if numbered_box:targets=[41720]
        if len(targets)>1:
            # No overwrite/merge: exact edition year can disambiguate title twins.
            by_year=[i for i in targets if albums[i]['release_year']==parts['year'] and parts['year']]
            targets=by_year if len(by_year)==1 else sorted(targets,key=lambda i:(-len(tracks[i]),i))[:1]
        plan.append({'key':e['id'],'url':e['url'],'source_title':p['title'],'source_content_sha256':hashlib.sha256(p['content_text'].encode()).hexdigest(),'source_status':e['status'],'artist_name':name,'source_artist':raw_artist,'artist_id':artist_id,'artist_binding':proof if artist_id else 'source_attribution_only','compilation':compilation,'fields':fields,'tracks':source_tracks,'target_album_id':targets[0] if targets else None,'allow_position_fill':numbered_box,'categories':e['categories']})
    assert len(plan)==1638
    (out/'import-plan.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in plan))
    summary={'entries':len(plan),'existing_artist_entries':sum(x['artist_id'] is not None for x in plan),'new_source_artist_names':len({norm(x['artist_name']) for x in plan if not x['artist_id']}),'existing_album_bindings':sum(x['target_album_id'] is not None for x in plan),'compilations':sum(x['compilation'] for x in plan),'source_tracks':sum(len(x['tracks']) for x in plan),'covers':sum(bool(x['fields'].get('cover_url')) for x in plan),'source_ordinal_lists':sum(any(t['ordinal_position'] for t in x['tracks']) for x in plan)}
    c.write_json(out/'plan-summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=pathlib.Path,required=True);args=parser.parse_args()
    out=args.out.resolve();out.relative_to(pathlib.Path.home()/'crv-staging/reports');assert out.is_dir()
    main(out)
