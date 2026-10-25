"""Parser conservador del texto maquetado de las reseñas Venezuela Demo.

Separa encabezados en línea y columnas antes de interpretar campos. Conserva
el texto y los bloques promocionales para poder revisar cualquier interpretación.
"""
import re
import unicodedata

MARKER = re.compile(r"(?<!\S)(?:>>|»|›|>)\s*")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
WEB = re.compile(r"(?:https?://|www\.)[^\s,;]+", re.I)
LABEL = re.compile(
    r"^(integrantes(?: actuales)?|discograf[ií]a|contactos?|enlaces|links|"
    r"tema promocional|tema|cd|g[eé]nero|m[uú]sicos?(?: invitados)?|"
    r"grabaron el tema|producci[oó]n(?: musical| ejecutiva| general)?|"
    r"sello(?: discogr[aá]fico)?|fotograf[ií]a|informaci[oó]n)\b\s*:?[ \t]*(.*)$", re.I)


def flow(lines):
    text = ""
    for line in lines:
        line = line.strip()
        text = text[:-1] + line if text.endswith('-') and not text.endswith(' -') else (text+' '+line).strip()
    return re.sub(r'\s+', ' ', text).strip()


def key(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s.lower()) if not unicodedata.combining(c))


def parse_artist_text(original, name_hint=None):
    text = unicodedata.normalize('NFKC', original).replace('\u00ad', '')
    bio, blocks, source = [], [], []
    columns = [(0, 'bio', [])]
    name = name_hint or ''
    saw_heading = False
    promo = False

    def new_block(label, inline=''):
        block = {'etiqueta': label, 'lineas': [inline] if inline else [], 'promocional': promo}
        blocks.append(block)
        return block['lineas']

    for page, page_text in enumerate(text.split('\f'), 1):
        for raw in page_text.splitlines():
            if not raw.strip() or raw.strip().lower().startswith('www.venezuelademo.com'):
                continue
            marks = list(MARKER.finditer(raw))
            if marks:
                next_columns = []
                for i, m in enumerate(marks):
                    value = raw[m.end():marks[i+1].start() if i+1<len(marks) else len(raw)].strip()
                    match = LABEL.match(value)
                    if not saw_heading and not match:
                        name = name or value
                        saw_heading = True
                        continue
                    saw_heading = True
                    if match:
                        label, inline = match.groups()
                        if key(label) in ('tema promocional', 'tema'):
                            promo = True
                        target = new_block(label, inline)
                    else:
                        # Un título de canción o una línea género/duración cierra
                        # siempre la discografía. Nunca continúa la sección previa.
                        promo = True
                        label = 'detalle promocional' if re.search(r'\b\d{1,2}:\d{2}\b',value) else 'titulo promocional'
                        target = new_block(label,value)
                    blocks[-1]['pagina'] = page
                    next_columns.append((m.start(),label,target))
                if next_columns:
                    columns = next_columns
                continue
            attribution = re.search(r'(?i)(?:informaci[oó]n (?:proporcionada|suministrada|obtenida|tomada|publicada) (?:por|de)|texto:)\s*(.+)', raw)
            if attribution and columns[0][1]=='bio':
                prefix = raw[:attribution.start()].strip(' .')
                if prefix:
                    bio.append(prefix)
                source.append(attribution.group(0).strip())
                continue
            if columns[0][1]=='bio':
                bio.append(raw.strip())
                continue
            for i,(x,label,target) in enumerate(columns):
                end = columns[i+1][0] if i+1<len(columns) else len(raw)
                segment = raw[x:end].strip() if len(columns)>1 else raw.strip()
                if segment:
                    target.append(segment)

    members, albums, contacts, promotional = [], [], [], []
    pending_albums = []
    for block in blocks:
        label = key(block['etiqueta'])
        lines = block['lineas']
        if label.startswith('integrantes') and not block['promocional']:
            # Algunas reseñas tienen dos columnas de integrantes a la izquierda
            # y una tercera de discografía: no fusionar personas de la misma fila.
            previous_single = False
            instrument_words = {'bongo', 'guira', 'guiro', 'campana', 'bombak', 'congas',
                                'timbal', 'tambora', 'percusion', 'coros', 'voz',
                                'guitarra', 'bajo', 'teclados', 'piano', 'bateria'}
            for line in lines:
                parts = [part.strip() for part in re.split(r'\s{2,}',line) if part.strip()]
                for part in parts:
                    if not part.strip():
                        continue
                    pair = re.split(r'\s+[-–—]\s+',part,maxsplit=1)
                    # Una lista de instrumentos que continúa tras una coma no
                    # es otra persona. En columnas múltiples se conserva para
                    # revisión: la fila anterior no identifica un dueño único.
                    if (len(pair)==1 and len(parts)==1 and previous_single and members
                            and members[-1]['rol'].endswith(',')
                            and all(key(word.strip()) in instrument_words for word in part.split(','))):
                        members[-1]['rol'] += ' '+part
                        continue
                    members.append({'nombre':pair[0].strip(),'rol':pair[1].strip() if len(pair)>1 else ''})
                previous_single = len(parts)==1
        elif label=='discografia' and not block['promocional']:
            for line in lines:
                # pdftotext -layout conserva los huecos entre columnas. Una fila
                # puede contener dos discos con sus respectivos años; el año de
                # la derecha nunca debe fechar el título compuesto de la fila.
                for cell in re.split(r'\s{3,}',line):
                    cell=cell.strip()
                    if not cell:
                        continue
                    matches = list(re.finditer(r'(.*?)\s*[–—-]\s*((?:19|20)\d{2})(?=\s*[,;]|\s*$)',cell))
                    if matches:
                        for m in matches:
                            title = m.group(1).strip(' ,;')
                            if title:
                                albums.append({'titulo':title,'anio':int(m.group(2))})
                        if cell[matches[-1].end():].strip(' ,;'):
                            pending_albums.append(cell[matches[-1].end():].strip(' ,;'))
                    else:
                        # Anotaciones como «Grabado en 2005» no son una fecha
                        # explícita de publicación. Se conserva el texto literal.
                        albums.append({'titulo':cell,'anio':None})
        elif label.startswith('contacto'):
            for line in lines:
                emails = EMAIL.findall(line)
                webs = [w.rstrip(')./') for w in WEB.findall(line)]
                if emails or webs:
                    who = re.split(r'(?i)/|e-?mail\s*:|correo\s*:',line)[0].strip(' :')
                    contacts.append({'nombre':who,'emails':emails,'webs':webs,'pagina':block['pagina'],'texto':line,
                                     'ambito':'editorial' if emails and all(e.lower().endswith('@venezuelademo.com')for e in emails) else 'contacto declarado en la fuente',
                                     'vigencia':'sin verificar'})
        elif block['promocional']:
            promotional.append({'campo':block['etiqueta'],'texto':flow(lines),'pagina':block['pagina']})

    # Todas las menciones se conservan con su ámbito; las de la biografía o
    # editoriales no se convierten automáticamente en contacto del artista.
    mentions = []
    for page,pt in enumerate(text.split('\f'),1):
        for line in pt.splitlines():
            for email in EMAIL.findall(line):
                mentions.append({'email':email,'pagina':page,'texto':line.strip(),
                                 'en_contactos':any(email in c['emails']for c in contacts)})
    titles = [p['texto'] for p in promotional if key(p['campo']) in ('tema promocional','tema')]
    details = [p['texto'] for p in promotional if key(p['campo'])=='detalle promocional']
    promo_title = titles[0] if titles else next((p['texto']for p in promotional if key(p['campo'])=='titulo promocional'),'')
    durations = re.findall(r'\b\d{1,2}:\d{2}\b',' '.join(details))
    credits = []
    musicians = []
    for item in promotional:
        # Conservar el rol literal: no convertir una mención en una persona
        # del catálogo ni completar apellidos o instrumentos por aproximación.
        for part in re.split(r'\s+[–—-]\s+', item['texto']):
            m = re.match(r'([^:]{2,75}):\s*(.+)',part)
            if m and not m.group(1).lower().startswith(('http','www')):
                credits.append({'rol':m.group(1),'valor':m.group(2),'pagina':item['pagina']})
        if key(item['campo']).startswith(('produccion','sello')):
            first = re.split(r'\s+[–—-]\s+',item['texto'])[0]
            credits.append({'rol':item['campo'],'valor':first,'pagina':item['pagina']})
        if key(item['campo']).startswith('musico') or key(item['campo'])=='grabaron el tema':
            for part in re.split(r'\s+[–—-]\s+',item['texto']):
                pair = part.split(',',1)
                musicians.append({'nombre':pair[0].strip(),'rol':pair[1].strip()if len(pair)>1 else '',
                                  'pagina':item['pagina'],'texto':part})
    genre = re.split(r'\s+[–—-]\s+|\b\d{1,2}:\d{2}\b',details[0])[0].strip(' -–') if details else None
    return {
        'nombre':name.strip(),'fuente_info':flow(source),'biografia':flow(bio),
        'biografia_chars':len(flow(bio)),'integrantes':members,'discografia':albums,
        'discografia_pendiente':pending_albums,'contactos':contacts,'correos_mencionados':mentions,
        'enlaces':sorted(set(w.rstrip(')./') for b in blocks for l in b['lineas'] for w in WEB.findall(l))),
        'tema_promocional':{'titulo':promo_title,'duracion':durations[0] if len(set(durations))==1 else None,
                            'genero':genre,'creditos':credits,'musicos':musicians,
                            'disco_declarado':next((p['texto']for p in promotional if key(p['campo'])=='cd'),None),
                            'campos':promotional} if promotional else None,
        'bloques':[{k:v for k,v in b.items()if k!='lineas'}|{'texto':flow(b['lineas'])}for b in blocks],
        'secciones':[b['etiqueta']for b in blocks], 'texto_original':original,
        'tiene_texto':len(text.strip())>200,
    }
