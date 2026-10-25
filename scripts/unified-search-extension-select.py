"""Selección del tramo de ampliación AOTY (R45) + fanzines (R46). Verifica cada cita contra su fuente."""
import hashlib, json, re, sys
from pathlib import Path
ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
A = ROOT / 'data/raw/aoty-2026-10-19/user_reviews_all.jsonl'
F = ROOT / 'data/research/punkenvenezuela-fanzines-2026-10-23'
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
ws = lambda s: re.sub(r'\s+', ' ', s).strip()

AOTY = [  # línea, álbum CRV, cita literal
 (1768, 12757, "my only complaint is that is definitely is a bit inconsistent as it contains so many different styles"),
 (4435, 12765, "So a spanish hiphop album with the most schizo beats possible with the few bits of english being weird ass lyrics she makes sure we understand."),
 (6679, 12722, "i have no idea what mother is saying but this is definitely a haunting and beautiful album"),
 (8309, 135, "los beats son simples pero funcionan de forma bastante efectiva, los coros son superiores a los de muerte"),
 (8269, 134, "Maestría lírica y beats impecables"),
 (3374, 4407, "They are fun and simple albums, playing reggae/funk/psychedelic elements."),
 (9565, 3402, "me gusta pero se nota que quieren ser arctic monkeys."),
 (9573, 3397, "prefieren concentrarse en 8 temas con una producción prolija y con arreglos esmerados"),
 (9510, 247, "a very versatile album with electropop, salsa, funk, indie and above all an unforgettable charisma"),
 (9669, 15647, "post rock, percusión latina y ritualista, flujo perfecto entre canciones"),
 (9631, 14610, "All you need to make fantastical music is a guy who can sing and an acoustic guitar."),
 (9613, 21824, "Lo Bello de lo Malo cae en dos pecados, la repeticion y el no aprovechar tu premisa."),
]
FZ = [  # doc, página, artista CRV, nombre, publicación, año visible, cita (espacios normalizados)
 ('cap06_PDFs_Tierra_Bajo_Tierra_1995_No6-RestoDelPais.pdf', 11, 76, 'Dermis Tatú', 'Tierra Bajo Tierra n.º 6', '1995', "DERMIS TATU sonó con un estilo requetecontra ruleteado, ese Rock ininteligible de berreos de guitarra y del cantante (no se le entendía ni pío además, para variar, el sonido era infame)"),
 ('cap06_PDFs_Tierra_Bajo_Tierra_1995_No6-RestoDelPais.pdf', 6, 59, 'Cebollas Ardientes', 'Tierra Bajo Tierra n.º 6', '1995', "esta fue una de las mejores presentaciones, aunque el sonido no los ayudó mucho"),
 ('cap06_PDFs_El_Provo_No6-Barquisimeto.pdf', 6, 1219, 'Sin Sospechas', 'El Provo n.º 6', None, "Esta gente tiene buena escena e irradian energía, pero fallan un poco a nivel de letras"),
 ('cap06_PDFs_Tierra_Bajo_Tierra_No8-RestoDelPais.pdf', 2, 1159, 'Deskarriados', 'Tierra Bajo Tierra n.º 8', None, "Deskarriados, que aunque no inclinada hacia el Ska totalmente, experimentaba. ritmos con tendencias de bandas españolas como Kortatu, Korroskada, Baldin Buda y Decibelios que se acercaban al Ska-Hardcore."),
 ('cap06_PDFs_El_Provo_No6-Barquisimeto.pdf', 10, 157, 'Los Gusanos', 'El Provo n.º 6', None, "Empezamos a experimentar con los ritmos afrovenezolanos, incluimos una percusión y ahora tenemos dos percusionistas."),
 ('cap01_Mundo-Subterraneo-No.-4.pdf', 4, 220, 'Sentimiento Muerto', 'Mundo Subterráneo n.º 4', None, "El sonido estaba bien, no lo puedo negar, pero en realidad a mi no me atrae mucho la música new wa ve."),
 ('cap06_PDFs_Tierra_Bajo_Tierra_No1-RestoDelPais.pdf', 2, 220, 'Sentimiento Muerto', 'Tierra Bajo Tierra n.º 1', None, "NO QUERÍAN DEFINIR SU MÚSICA COMO UN ESTILO REBUSCADO NI CAER HACIA UN ESTEREOTIPO"),
 ('cap06_PDFs_Tierra_Bajo_Tierra_No8-RestoDelPais.pdf', 4, 1212, 'La Banana Voladora', 'Tierra Bajo Tierra n.º 8', None, "una música donde el Ska, el Rock, el Reggae, el Blues y la Salsa se dan la mano para crear el estilo particular de la Banda de la Banana Voladora"),
 ('cap06_PDFs_Tierra_Bajo_Tierra_1995_No6-RestoDelPais.pdf', 4, 1997, 'Reloj de Cuerda', 'Tierra Bajo Tierra n.º 6', '1995', "ideas inspiradas en grupos como Depeche Mode, Nine Inch Nails, Front 242"),
 ('cap06_PDFs_Tierra_Bajo_Tierra_1995_No6-RestoDelPais.pdf', 5, 335, 'Natastor', 'Tierra Bajo Tierra n.º 6', '1995', "EN LA MAS PURA ESENCIA DEL THRASH METAL MUY A LO SLAYER Y KREATOR"),
 ('cap06_PDFs_Sub-suelo_Insurgente_Zine_1997_No4-RestoDelPais.pdf', 4, 1009, '4to Reich', 'Sub-suelo Insurgente n.º 4', '1997', "alternaron con 4to Reich (punk? co- mercial)"),
 ('cap06_PDFs_El_Provo_No5-Barquisimeto.pdf', 5, 2206, 'Primero Venezuela', 'El Provo n.º 5', None, "editó un cassette con seis canciones y excelente sonido."),
]

LANG = {8309: "es", 8269: "es", 9565: "es", 9573: "es", 9669: "es", 9613: "es"}
lines = A.read_text().splitlines()
pages = {(p['doc'], p['pagina']): p for p in map(json.loads, open(F / 'corpus.jsonl'))}
files = {Path(r['file']).name: r['file'] for r in map(json.loads, open(F / 'inventario.jsonl'))}
items = []
for n, (line, album, quote) in enumerate(AOTY, 1):
    raw = lines[line - 1]; r = json.loads(raw); text = r['text']
    i = text.find(quote); assert i >= 0, (line, quote)
    items.append({'id': f'E2-A{n:02d}', 'resourceId': 'R45', 'object': {'kind': 'album', 'id': album, 'name': r['album']},
      'artist': r['artist'], 'work': r['album'], 'quote': quote, 'language': LANG.get(line, "en"),
      'source': r['url'], 'account': r['user_url'], 'page': None, 'locator': f'data/raw/aoty-2026-10-19/user_reviews_all.jsonl:{line} .text',
      'captureHash': sha(raw), 'capturedAtOriginal': '2026-10-19', 'visibleDate': f"{r['date']} (relativa a la captura)", 'rating': r['rating'],
      'extractorVersion': 'aoty-user-reviews-2026-10-19', 'context': ws(text)[:1600],
      'identityEvidence': [f"AOTY {r['url']}; cruce_crv.csv artista exacto; título de álbum exacto en public.albums:{album}"]})
for n, (doc, page, artist, name, pub, year, quote) in enumerate(FZ, 1):
    p = pages[(doc, page)]; t = ws(p['texto'])
    i = t.find(quote); assert i >= 0, (doc, page, quote)
    items.append({'id': f'E2-F{n:02d}', 'resourceId': 'R46', 'object': {'kind': 'artist', 'id': artist, 'name': name},
      'artist': name, 'work': pub, 'quote': quote, 'language': 'es',
      'source': 'https://punkenvenezuela.com/wp-content/' + files[doc], 'account': pub, 'page': page,
      'locator': f'data/research/punkenvenezuela-fanzines-2026-10-23/corpus.jsonl doc={doc} pagina={page} (espacios normalizados)',
      'captureHash': sha(p['texto']), 'capturedAtOriginal': '2026-10-23', 'visibleDate': year, 'ocrQuality': p['calidad'],
      'extractorVersion': f"{p['metodo']}:tesseract-spa-250dpi (fz-ocr.py)", 'context': t[max(0, i - 600): i + len(quote) + 500],
      'identityEvidence': [f"matches.jsonl: mención fuerte del artista {artist} con contexto de banda; public.artists:{artist}"]})
json.dump(items, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
print(len(items), sum(i['language'] == 'en' for i in items))
