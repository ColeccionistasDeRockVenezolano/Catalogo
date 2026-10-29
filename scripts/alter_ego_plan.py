"""Decisiones acotadas a los 41 lanzamientos mezclados; ninguna identidad por nombre solo."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata

OUT=Path(os.environ['ALTER_DATA'])
snapshot=json.loads((OUT/'snapshot.json').read_text())
sources=[r for file in ['sources.json','sources-extra.json','sources-platforms.json'] for r in json.loads((OUT/file).read_text())]
by_key={r['key']:r for r in sources}


def text(key):
    row=by_key[key]
    assert row.get('httpStatus')==200,key
    return (OUT/row['textFile']).read_text()


def proof(key,quote,assertion):
    assert quote in text(key),(key,quote)
    return {'sourceKey':key,'quote':quote,'assertion':assertion}


def norm(value):
    return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower())


def main():
    # Extracto de la lectura completa servida por web.open; el HTTP directo
    # produjo 403. No se presenta como un HTML descargado ni como HTTP 200.
    quote="Roma è sempre stata l'epicentro delle nostre scorribande, il luogo predestinato per le prove e la sede naturale della nostra attività."
    file=OUT/'sources/it-origin-excerpt.txt';file.write_text(quote)
    raw=file.read_bytes()
    sources.append({'key':'it-origin-excerpt','url':'https://www.allaboutjazz.com/intervista-ad-alter-ego-conversazione-con-manuel-zurria-by-aaji-staff',
                    'finalUrl':'https://www.allaboutjazz.com/intervista-ad-alter-ego-conversazione-con-manuel-zurria-by-aaji-staff',
                    'file':'sources/it-origin-excerpt.txt','textFile':'sources/it-origin-excerpt.txt','bytes':len(raw),
                    'sha256':hashlib.sha256(raw).hexdigest(),'textSha256':hashlib.sha256(raw).hexdigest(),'textChars':len(quote),
                    'capturedAt':None,'httpStatus':None,'contentType':'text/plain','acquisitionMethod':'local_archive',
                    'readAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'warning':'Extracto literal de la entrevista leído mediante web.open; se conserva el extracto, no el HTML completo. Consulta actual; fecha de captura de la caché desconocida. El HTTP directo está registrado por separado con 403.'})
    by_key['it-origin-excerpt']=sources[-1]
    german=proof('de-release-1544313',"Roman Flugel and Jorn Elling Wuttke's label Alter Ego Recordings",'Integrantes del proyecto y sello propio, distintos de la banda venezolana.')
    italian=proof('it-mode','Ensemble – Alter Ego (9)','El sello identifica expresamente al ensamble que interpreta la grabación.')
    atlanta=proof('us-bangla','Neetol: vocals and bass\nShubho: guitars\nSaeed: keys\nMahbub: drums','Alineación distinta y repertorio propio del proyecto Bangla documentados por la banda.')
    cuba=proof('cu-publisher','Diego Santiago','Director del trío, identificado por el Centro Cultural Pablo de la Torriente Brau; en el mismo texto figuran Esther Martínez y Edel Hernández.')
    targets=[
      {'key':'de','values':{'name':'Alter Ego (Alemania)','artist_type':'duo','origin_country':'Alemania','origin_city':'Darmstadt',
                           'biography':'Dúo de música electrónica integrado por Roman Flügel y Jörn Elling Wuttke. Publicó grabaciones en Klang Elektronik y Alter Ego Recordings, entre ellas Rocker, Transphormer y Decoding the Hacker Myth. Esta ficha distingue al proyecto alemán de la banda venezolana homónima.'},
       'evidence':[german,proof('de-musicbrainz','"country": "DE"','País de la identidad estructurada; begin-area Darmstadt.')],
       'note':'Nombre con aclaración geográfica editorial. No es alias de la banda de Caracas.'},
      {'key':'it','values':{'name':'Alter Ego (ensamble italiano)','artist_type':'group','origin_country':'Italia','origin_city':'Roma',
                           'biography':'Ensamble de música contemporánea radicado en Roma. Sus intérpretes documentados incluyen a Manuel Zurria, Paolo Ravaglia, Oscar Pizzo, Francesco Dillon y Aldo Campagnari. Ha grabado obras de Nicola Sani, Frederic Rzewski, Salvatore Sciarrino y Alvin Lucier para Stradivarius y Mode Records. Se conserva separado de sus homónimos.'},
       'evidence':[italian,{'sourceKey':'it-origin-excerpt','quote':quote,'assertion':'Sede y actividad del ensamble en Roma según declaración de Manuel Zurria.'}],
       'note':'La entrevista distingue primera reunión en 1989 y primer concierto en 1990; su introducción menciona 1991. No se fija año de formación.'},
      {'key':'atlanta','values':{'name':'Alter Ego (Atlanta)','artist_type':'band','origin_country':'Desconocido','current_city':'Atlanta','current_country':'Estados Unidos',
                                'biography':'Banda de Bangla rock radicada en Atlanta, integrada por Neetol en voz y bajo, Shubho en guitarra, Saeed en teclados y Mahbub en batería. Su publicación Osheem Asha y la canción Boshonto Batashe están documentadas en su Bandcamp. El lugar de residencia no se convierte en país o ciudad de formación.'},
       'evidence':[atlanta,proof('us-member','my band Alter Ego','Saeed Ahmed identifica personalmente a su banda y el disco Osheem Asha.')],
       'note':'Atlanta es ubicación actual declarada; origen no afirmado. Evitar deducir nacionalidad de lengua o repertorio.'},
      {'key':'cu','values':{'name':'Trío Alter Ego','artist_type':'group','origin_country':'Cuba',
                           'biography':'Trío cubano vinculado a la provincia de Villa Clara y al espacio A guitarra limpia del Centro Cultural Pablo de la Torriente Brau. Sus músicos documentados son Diego Santiago en laúd, Esther Martínez en guitarra y Edel Hernández en tres. La publicación Buscando Rutas aparece en la documentación del Centro Pablo.'},
       'evidence':[cuba,proof('cu-disc','Buscando Rutas','La publicación y la pieza Soneando a Ñico se atribuyen al TRÍO ALTER EGO y al Centro Pablo.')],
       'note':'La fecha 2010 de la publicación del Centro Pablo y el año 2009 del registro de streaming quedan como discrepancia de edición; no se reemplaza el año.'},
    ]
    mapping={30666:('de','de-tubeaction','Tubeaction'),30670:('de','de-release-2218641','Transphormed'),
             30673:('de','de-release-2218641','Transphormed'),30674:('de','de-release-1570128','Decoding The Hacker Myth'),
             30676:('de','de-release-1489044',"What's next?!"),30680:('de','de-release-1548827','Rocker'),
             30681:('de','de-release-1515726','Betty Ford'),30682:('de','de-release-1535354','Gary'),
             30683:('de','de-release-1487092','Fuckingham Palace'),30684:('de','de-release-1487076','Gate 23'),
             30685:('de','de-full-why','Chicken Shag'),30686:('de','de-release-901733','The Lost Album'),
             30687:('de','de-release-1484818','Daktari'),30688:('de','de-release-1482882','Blitz/Blank'),
             30689:('de','de-release-1489040','Jolly Joker'),30690:('de','de-release-1489043','Raw'),
             30691:('de','de-release-1484787','The Fridge'),30692:('de','de-release-1473788','Slaughterhouse'),
             30693:('de','de-release-1751565','Rocker / Gate 23'),30694:('de','de-release-1544313','The Luke Slater Remixes'),
             30662:('it','it-strad-sani','STR 33609'),30663:('it','it-strad-main','STR 33631'),
             30664:('it','it-strad-fiato','STR 33647'),30695:('it','it-mode','Two Circles'),
             30675:('atlanta','us-boshonto','Boshonto Batashe'),30677:('atlanta','us-bangla','Osheem Asha'),
             30668:('cu','cu-disc','Buscando Rutas')}
    # Transphormer completo se corrobora con la pista/título de su edición
    # en el registro de remixes y con el release group de MusicBrainz.
    mapping[30670]=('de','de-musicbrainz','Transphormer')
    albums=[]
    for album in snapshot['albums']:
        aid=int(album['id'])
        if album['artist_id']!='1686' or aid in [3089,3780]:continue
        tracks=[r for r in snapshot['tracks']if r['album_id']==str(aid)]
        decision={'albumId':aid,'title':album['title'],'year':album['release_year'],'oldArtistId':1686,
                  'trackIds':[int(t['id'])for t in tracks],
                  'trackSnapshotHash':hashlib.sha256(json.dumps(tracks,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()}
        if aid in mapping:
            target,source,q=mapping[aid];decision.update({'decision':'reparent','target':target,
               'evidence':[proof(source,q,'Título, catálogo o repertorio de la publicación contrastado con el homónimo documentado.')],
               'scope':'Se corrige el intérprete/dueño de esta ficha. No se afirma autoría exclusiva ni se cambian fecha, versión o pistas.'})
        else:decision.update({'decision':'hold','reason':'La edición proviene de un perfil de Spotify mezclado. Falta corroborar que pertenezca a la banda de Caracas o identificar otro dueño con evidencia específica.',
                              'evidence':[german,italian],'scope':'La evidencia acredita la contaminación del perfil, no un dueño alternativo para esta edición.'})
        albums.append(decision)
    assert len(albums)==41
    assert sum(a['decision']=='reparent'for a in albums)==27
    assert {a['albumId']for a in albums}.isdisjoint({3089,3780})
    plan={'campaign':'alter-ego-cola-2026-10-25','sourceArtistId':1686,'keptAlbums':[3089,3780],
          'snapshotAt':snapshot['capturedAt'],'targets':targets,'albums':albums,
          'streamingFlagsToWithdraw':[1865,14834,38849],
          'streamingReason':'La validación previa dependía de un disco coincidente en un catálogo contaminado; el perfil completo no acredita la identidad de la banda caraqueña. Se conserva la URL como candidato sin verificación.'}
    (OUT/'source-manifest.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2))
    (OUT/'decision-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
    print(json.dumps({'albumDecisions':len(albums),'reparent':27,'hold':14,'targets':len(targets),'sources':len(sources)}))


if __name__=='__main__':main()
