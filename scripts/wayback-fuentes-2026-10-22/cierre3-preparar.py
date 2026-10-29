"""Decisiones editoriales explícitas; no modifica la base de datos."""
import os, json, pathlib, hashlib, re
from bs4 import BeautifulSoup

out = pathlib.Path(os.environ['WAYBACK_OUT'])
before = json.loads((out / 'antes.json').read_text())
artists = {int(a['id']): a for a in before['artists']}
docs = {int(d['id']): d for d in before['documents']}
fetched = json.loads((out / 'evidence-results.json').read_text())
sources, changes = {}, []

def original(did):
    if did in sources:
        return sources[did]
    d = docs[did]
    path = d['metadata'].get('evidence', {}).get('archivo')
    if did == 1871:
        path = 'data/raw/wayback-fuentes-2026-10-22/skaypunk/bandas/c4/c4.htm'
    if not path or not pathlib.Path(path).is_file():
        raise ValueError(f'Falta original {did}')
    raw = pathlib.Path(path).read_bytes()
    soup = BeautifulSoup(raw, 'html.parser')
    for tag in soup(['script', 'style']):
        tag.decompose()
    text = re.sub(r'\s+', ' ', soup.get_text(' ', strip=True))
    r = dict(documentId=did, path=path, sha256=hashlib.sha256(raw).hexdigest(), text=text,
             sourceUrl=d['source_url'], archiveUrl=d['archive_url'])
    sources[did] = r
    return r

def add(aid, did, paragraph, anchors, replacements=(), external=(), reason='Incorporación de información histórica omitida; formación referida a la captura, sin vincular personas por nombres parciales.'):
    a, d = artists[aid], docs[did]
    assert int(d['artist_id']) == aid
    raw = original(did)
    for anchor in anchors:
        assert anchor.casefold() in raw['text'].casefold(), (did, anchor)
    text = a['biography']
    for old, new in replacements:
        assert text.count(old) == 1, (aid, old)
        text = text.replace(old, new)
    if paragraph:
        text += '\n\n' + paragraph
    assert text != a['biography']
    evidence = []
    for url, anchor in external:
        r = next(r for r in fetched if r['url'] == url)
        assert r.get('status') == 200 and not r.get('blocked') and anchor.casefold() in r['text'].casefold()
        evidence.append(dict(url=url, sha256=r['sha256'], quote=anchor))
    changes.append(dict(artistId=aid, name=a['name'], documentId=did, previous=a['biography'],
                        newBiography=text, paragraph=paragraph, replacements=replacements,
                        source=raw, anchors=anchors, externalEvidence=evidence, reason=reason))

add(55, 2, '', ['Pulgar - guitarra'],
    [('Frank Pulgar en los teclados', 'Frank Pulgar en la guitarra')],
    [('https://anarkiamusical.blogspot.com/2008/06/candy66-prepara-su-tercer-disco.html?m=0',
      'guitarrista Frank Pulgar')],
    'Corrección de instrumento: la ficha primaria de 2004 y la nota de prensa de 2008 coinciden en que Frank Pulgar era guitarrista.')
add(1946, 3,
    'Para grabar Practical Man entre 2001 y 2002, el grupo dedicó un año a construir su propio estudio y asumió la grabación, las mezclas y la producción. Entre los temas destacados estaban Practical Man, Artificial World II y Tower Queen. La reseña histórica describe Last Man in Space, terminado en 2003, como una continuación musical de Practical Man, hasta considerar ambos trabajos un proyecto unitario.',
    ['En el 2001 - 2002', 'creación de su propio estudio', 'proyecto unitario'])
add(1243, 130,
    'Antes de consolidarse como dúo, Cerouno fue presentado como un trío en la ficha conservada en febrero de 2004, que enumeraba a Javier Otero, Alejandro Suárez y Ricardo Suárez. En los créditos de Atari Amor (2008), Ricardo participa en la voz de Atari Amor y en las guitarras de Atari Amor, Espontáneo y Misil.',
    ['El trío', 'Ricardo Suárez'], external=[('https://cerouno.bandcamp.com/album/atari-amor-2', 'Ricardo Suárez')],
    reason='La formación del archivo de 2004 y los créditos propios del disco de 2008 corresponden a etapas distintas; no se sustituye la descripción posterior como dúo.')
add(67, 141,
    'La grabación de El Viaje de una Vida comenzó a finales de 1994; el sello Cygnus lo editó en noviembre de 1995.',
    ['A finales del 94', 'editado en noviembre del 95'])
add(1662, 247,
    'La ficha histórica conservada en abril de 2004 enumeraba a Gerard Bellorin, José «Toto» Palomo y Hecfran Pinto, e indicaba que Rondney Molleja estaba a prueba.',
    ['Gerard Bellorin', 'Rondney Molleja (en Prueba)'])
add(507, 268,
    'En una formación anterior documentada por Musica.com.ve figuraban Alexander Borges en la voz, Alexis Peraza en el bajo, Juan Carlos Figueroa en la batería, Luis Ascanio en la guitarra y Rudi Martins en guitarra y voz.',
    ['Alexander Borges en la voz', 'Alexis Peraza en el bajo', 'Rudi Martins en la guitarra y voz'])
add(3057, 306,
    'Entre las influencias expresamente citadas en su presentación histórica estaban Iron Maiden, Stratovarius y Rata Blanca.',
    ['Iron Maiden, Stratovarius, Rata blanca'])
add(121, 333,
    'La formación recogida en la ficha histórica de 2004 incluía también a Lendys Solarte en la percusión, junto a Tommy Chávez, Daniel Garrido, Ulises Hadjis y Carlos Vargas.',
    ['Lendys Solarte-Percusión'])
add(4578, 419,
    'En aquella formación inicial, Patricia Urbano se encargaba de la voz y la guitarra; Manfred Maroldt, del bajo y la voz; Jonnatan Santiago, de la batería; y Juan J. Santiago, de la guitarra.',
    ['Patricia Urbano: Voz y Guitarra', 'Manfred Maroldt: Bajo y Voz', 'Jonnatan Santiago: Bateria', 'Santiago: Guitarra'])
add(224, 580,
    'La formación histórica recogida en febrero de 2004 se presentaba como Miguel T. en batería y coros, Johan M. en bajo y coros y César H. en voz y guitarra.',
    ['Johan M.: Bajo y Coros', 'Miguel T.: Bateria'])
add(1047, 635,
    'En la etapa documentada en junio de 2004 se había incorporado Carlos Leal, graduado de la Academia Washington y estudiante de la Universidad Metropolitana, como cantante y guitarrista rítmico. Completaron aquella formación Mauricio Rojas en el bajo, Myron Sullivan en la primera guitarra y Leonardo Pérez en la batería. La reseña destacó su participación en Alma Mater Rock, además de presentaciones en Little Rock Caffe, F-1 Las Mercedes y El León.',
    ['Carlos Leal', 'Academia Washington', 'Mauricio Rojas (Bajo)', 'festival "Alma Mater Rock"'])
add(7457, 1730, '', ['Punk / Pto.Fijo-Falcón'],
    [('La Moska Punk es un proyecto musical de Pto.Fijo (Falcón).',
      'La Moska Punk es un proyecto de punk de Punto Fijo, estado Falcón, Venezuela.')])
add(466, 378,
    'La ficha conservada en mayo de 2004 documentaba una formación con Nayibel Falcón en la voz, Jonathan Leal en la guitarra, Joseba Abab en el bajo y Jonathan Galindo en la batería. Aquel texto anunciaba un primer disco para mediados de 2003; esa previsión no constituye una fecha de publicación.\n\nEn las notas de prensa de 2011, la formación reunía a Nayibel Falcón, Jonathan Leal, Bernardo Feijoo en la segunda guitarra, José Antonio Calcaño en bajo y secuencias y Robert Van Gehuchten en la batería. Mil Estaciones fue producido, mezclado y masterizado por Diego Márquez en Caracas; Cinco Segundos fue su sencillo promocional.',
    ['Nayibel falcon en la voz', 'Joseba Abab en el bajo', 'mediados del año 2003'],
    [(' Estuvo activa entre 2010 y 2012.', ''),
     ('El grupo contó con una grabación reciente en vivo', 'La reseña histórica describía una grabación en vivo'),
     ('La banda comenzó a grabar material para lo que sería su primer disco oficial.',
      'En esa etapa temprana, la banda comenzó a grabar material para lo que sería su primer disco oficial.')],
    [('https://correocultural.com/2011/08/languidez-nos-presenta-su-primera-produccion-musical-mil-estaciones/', 'Diego Márquez'),
     ('https://correocultural.com/2011/11/languidez-presenta-el-showcase-de-su-disco-mil-estaciones/', 'Nayibel')],
    'Identidad contrastada por ciudad, Nayibel Falcón y Jonathan Leal con sus instrumentos; la actividad documentada en 2004 invalida limitar su existencia a 2010–2012. Se distinguen el anuncio temprano y el álbum de 2011.')
add(1226, 233,
    'La banda citó entre sus influencias a Dave Matthews Band, Red Hot Chili Peppers, Radiohead e Incubus. En su debut en Alma Mater 02 resultó finalista.',
    ['Dave Matthews Band', 'donde resultan finalistas'])
add(1589, 365,
    'La presentación histórica de Musica.com.ve la clasificó dentro del ska y enumeró como integrantes a Juan Carlos, Damian, Army y Benjamin.',
    ['Juan Carlos, Damian, Army, Benjamin', 'Ska / Caracas-DF'])
add(3066, 377,
    'La ficha histórica conservó una formación con Daniela en la voz, Marjorie en teclados y otras voces, Ana en guitarra, Braidys en bajo y Aly en batería y otras voces.',
    ['Braidys - bajo', 'Daniela - voz'])
add(7421, 683,
    'La ficha histórica de Musica.com.ve consignó el crédito de integrante «CAM.C.».',
    ['CAM.C.'])
add(1210, 692,
    'La alineación recogida en la ficha conservada en 2004 situaba a Raúl Rodríguez en guitarra, Ángel Guanchez en bajo y voz y Raúl Sosa en batería.',
    ['Raúl Sosa (Batería)'])
add(1529, 1873,
    'La reseña histórica citó además a Black Uhuru entre sus influencias. Junto a los nombres ya asociados al grupo, enumeró a Richard «Tacaña» Romero, Mariano Augusto, Gilberto «Frito», Eroy Bustillos, Julio Blanco y Daniela Morales, sin especificar sus instrumentos.',
    ['Black uhuru', 'richard tacaña romero', 'daniela morales'])
add(2091, 1871,
    'En 1994 Aitor Garrote fue reemplazado por Joswald Niño; con él tocaron en el Auditorio de Arquitectura de la Universidad del Zulia durante el Congreso de Estudiantes de Arquitectura. Ronald Franco estudiaba en la misma universidad que Raoul Camacho. Entre las influencias citadas por la banda estaban Sentimiento Muerto, Sex Pistols, Strung Out, Face to Face, Fun People, 2 Minutos, NOFX y Lagwagon.',
    ['Joswald', '1994', 'Arquitectura', 'Sentimiento Muerto'])

add(574, 1357,
    'La historia escrita por el propio grupo recuerda que en 1997 se incorporaron dos compañeros de la disuelta L.S.I. En marzo de 1998 tocaron en Medellín junto a IRA, Rechazo, Polikarpas, Anti-Todo y Resistencia. Su recorrido por Bogotá y Medellín de febrero y marzo de 1999 llevó por nombre La gira de la Miseria.\n\nEn abril de 2000 organizaron las primeras Jornadas Anarkopunks con Desarme y 11011. En la edición del EP de ese año participaron Bajo Perfil, Lumpen Records, HgFact, La Resistencia Records e Ilegal Rekords. Las terceras Jornadas, celebradas en noviembre de 2000 con Lo$ Dolare$ y Doña Maldad, dieron origen al casete compartido con esta última banda. Más adelante recorrieron Chile y Perú con la gira Unión y Acción por un mundo nuevo. En febrero de 2001 la formación estaba integrada por Julia en guitarra y voz, Miguel en batería y voz y Johnny en bajo y voz. En septiembre organizaron las cuartas Jornadas con Retaque, Lo$ Dolare$, 11011 y Doña Maldad, y en diciembre emprendieron Sigamos luchando por un mundo nuevo por Ecuador, Colombia y Venezuela.\n\nEn enero de 2002 terminaron de grabar Cuando el rumor es información, con la colaboración de Esteban Sierra e Ingo Rohrer, editado en vinilo y también en CD con diecisiete temas. Entre febrero y mayo de ese año realizaron una gira europea que, según su propia crónica, sumó setenta conciertos y quince charlas y foros.',
    ['L.S.I', 'en el 97', 'Marzo-98', 'Miseria', '2000', 'HgFact', '2001', '2002', '70', '15'],
    reason='Crónica del propio grupo: se completan giras y actividades. La expresión diciembre-enero 2001 no se convierte en fechas exactas. La variante Creados/Creadores del título del EP queda pendiente.')
add(571, 307,
    'El regreso de 1995 incluyó al guitarrista Chovy. Cuando Carlos Arvelo y Leo Andrade consideraron desarrollar otro proyecto con Jesús Alberto, las conversaciones terminaron con la incorporación de este último a Incendiario. Chovy volvió a pasar por el grupo después de la partida de Jesús Alberto a Canadá y posteriormente se retiró otra vez. El 9 de junio de 2003 tocaron con Guillman, Telex, Efluvio y otros artistas en un homenaje a los músicos valencianos. Jesús Miguel Montero, incorporado como tecladista, había sido guitarrista de Zig-Zag de Valencia. La reseña histórica también anunció un primer CD de ocho temas titulado Renacer; se conserva como proyecto anunciado, sin dar su publicación por confirmada.',
    ['primera desintegración en 1990', 'Chovy', '9 de junio', '2003', 'Zig-Zag', 'RENACER', '8 temas'],
    [('Poco después el grupo entró en un receso que se prolongó hasta 1995, y durante ese período se incorporó como guitarrista Carlos Arvelo.',
      'En 1990 llegó su primera desintegración, tras la incorporación del guitarrista Carlos Arvelo, y el receso se prolongó hasta 1995.')],
    reason='Se completa la trayectoria con la crónica histórica. El puesto tercero frente a cuarto en el festival queda en conflicto; no se elige una posición sin corroboración adicional.')
add(1089, 1633,
    'La crónica histórica recogió además una invitación desde México para integrar un recopilatorio de punk de Pepedote Records; el texto documenta la invitación, sin confirmar que aquella edición llegara a publicarse con la banda.',
    ['Pepedote'],
    reason='La sugerencia automática convertía una invitación en participación efectiva. Se conserva su alcance literal y no se crea una edición discográfica.')

if len({c['artistId'] for c in changes}) != len(changes):
    raise ValueError('Artista duplicado')
(out / 'biografias-aprobadas.json').write_text(json.dumps(changes, ensure_ascii=False, indent=2))
(out / 'fuentes-originales-biografias.json').write_text(json.dumps(list(sources.values()), ensure_ascii=False, indent=2))
print(json.dumps({'biografias': len(changes), 'originales': len(sources)}, ensure_ascii=False))
