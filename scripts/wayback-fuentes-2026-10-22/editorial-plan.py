"""Decisiones manuales del primer grupo prioritario: 16 expedientes, sin inferencias de homónimos."""
import json,os,pathlib
out=pathlib.Path(os.environ['WAYBACK_OUT'])
old=pathlib.Path('reports/wayback-restantes-2026-10-23')
before=json.loads((out/'antes-catalogo.json').read_text())
cases=[]
def evidence(url,quote,kind='primary'):
    return dict(url=url,quote=quote,kind=kind,consultedAt='2026-10-25')
def credit(name,status,reason,sources,**extra):
    original=next(c for c in before['creditCases'] if c['name']==name)
    cases.append(dict(caseId='credit:'+str(original['documentId']),group='credit',status=status,
                      fact=f'{name}: {original["role"]} en {next(a["title"] for a in before["albums"] if int(a["id"])==original["albumId"])}',
                      original=original,reason=reason,evidence=sources,**extra))
credit('Luis Navas','confirmed','El portafolio del autor reúne la campaña de Cinco y lo identifica como guitarrista de Los Que Rezan. Es la identidad 16515, ya vinculada a esta banda; no se fusiona con el bajista homónimo 2602.',[
 evidence('https://www.behance.net/gallery/19766827/Los-que-rezan-(Cinco)','Luis Navas (Guitarra líder)'),
 evidence('https://web.archive.org/web/20160610033414/http://lagaleriadelrock.com/portfolio/5/','Concepto y diseño gráfico: Marina Schonta y Luis Navas')],
 target={'kind':'person','id':16515},biography='Luis Navas es guitarrista de Los Que Rezan. Su portafolio documenta la campaña de lanzamiento del EP Cinco, cuyo concepto y diseño gráfico comparte en los créditos de La Galería del Rock con Marina Schonta.')
credit('Carlos Delgado','pending','La fotografía y el perfil batetebecerro están documentados, pero no se obtuvo un vínculo inequívoco con los candidatos 2651 y 29208. Sus créditos previos de Témpano, Pentágono y Los Melódicos no bastan para identificar al autor de esta portada.',[
 evidence('https://web.archive.org/web/20160610014500/http://lagaleriadelrock.com/portfolio/el-camino-de-regreso/','Fotografía: Carlos Delgado','archival-editorial')])
credit('Papersoul','confirmed','El dominio enlazado en el crédito histórico se identifica en 2016 como Art Collective & Store y en su página archivada de 2019 como estudio de caligrafía y diseño. Se acredita al estudio, sin convertirlo en una persona ni vincularlo con la tienda actual del dominio.',[
 evidence('https://web.archive.org/web/20160210212258/http://www.papersoul.co/','CALLIGRAPHY | ILLUSTRATION | DESIGN'),
 evidence('https://web.archive.org/web/20190722124607/http://www.papersoul.co/about','Papersoul is a calligraphy, lettering and design studio'),
 evidence('https://recordatorio91.bandcamp.com/album/l-gica-resbalosa','Caligrafía por Papersoul.')],
 target={'kind':'organization','name':'Papersoul'},biography='Estudio de caligrafía, lettering y diseño documentado en el dominio histórico papersoul.co. Figura acreditado por la caligrafía de material gráfico de Recordatorio. La web archivada de 2019 identifica a Julia Grace como creadora del estudio.',notes='Identidad histórica del estudio papersoul.co, conservada mediante Wayback 2016/2019. No se identifica con el comercio actual de ese dominio.')
credit('Daniel González','pending','La fuente no enlaza un perfil del diseñador. No hay prueba para asociarlo al ingeniero de Mojo Pojo 34302 ni al guitarrista de Gruesome 17836. Se conserva el crédito junto a Wladimir Aranguren y Carlos Dordelly.',[
 evidence('https://web.archive.org/web/20160610011101/http://lagaleriadelrock.com/portfolio/no-pretendo/','Diseño: Daniel González, Wladimir Aranguren y Carlos Dordelly','archival-editorial')])
credit('Thugwarr','confirmed','El mismo identificador thugwarriorscars que enlaza La Galería del Rock corresponde al autor thugWARR de la portada animada del mismo EP en Vimeo. Se normaliza el seudónimo profesional, conservando desconocidos el nombre legal y la nacionalidad.',[
 evidence('https://vimeo.com/api/oembed.json?url=https://vimeo.com/145276864','Orange Spray - Marti Ann'),
 evidence('https://vimeo.com/api/v2/thugwarriorscars/info.json','thugWARR'),
 evidence('https://web.archive.org/web/20160610032856/http://lagaleriadelrock.com/portfolio/orange-spray/','Diseño: Thugwarr','archival-editorial')],
 target={'kind':'person','name':'thugWARR'},biography='Creador visual acreditado con el seudónimo thugWARR. Su perfil thugwarriorscars presenta trabajos de animación e ilustración, entre ellos la portada animada del EP Orange Spray de Marti Ann, publicada con mención a Emprise Music.',notes='Seudónimo contrastado por perfil y obra: https://vimeo.com/thugwarriorscars ; https://vimeo.com/145276864 . No se afirma un nombre legal ni una nacionalidad. La posible relación con Havery Pischedda queda fuera de los campos normalizados.')
credit('Heather','confirmed','El artista enlaza directamente la cuenta michar y la acredita por fotografía; el perfil de Flickr se identifica como Heather / HDC Photography. Se usa este nombre de crédito, sin completar apellidos ni nacionalidad.',[
 evidence('https://alfredgomezjr.bandcamp.com/track/que-llueva','Fotografía por Heather'),
 evidence('https://www.flickr.com/people/michar/','Heather'),
 evidence('https://www.flickr.com/people/michar/','HDC Photography')],
 target={'kind':'person','name':'Heather (michar)'},biography='Fotógrafa identificada como Heather en la cuenta michar de Flickr, presentada como HDC Photography. Alfred Gómez Jr. la acredita por la fotografía de Que Llueva y enlaza esa cuenta en los créditos oficiales.',notes='Identidad delimitada por https://www.flickr.com/people/michar/ y https://alfredgomezjr.bandcamp.com/track/que-llueva . No se amplía el nombre ni se atribuye nacionalidad venezolana.')
credit('Leonardo Pérez','confirmed','La web personal enlaza LAPSsounds; ese canal acredita animación y música de Tercer Cuarto a Leonardo Pérez. La web y la edición del artista documentan Laps Around the Sun. Se vincula al integrante 15985 de Tercer Cuarto; el homónimo 30108 es autor acreditado por Sonero Clásico del Caribe y no se fusiona.',[
 evidence('https://leonardoperez.ru/about','I perform in Laps Around The Sun'),
 evidence('https://vimeo.com/api/oembed.json?url=https://vimeo.com/3207058','Animation and music by Leonardo Perez.'),
 evidence('https://lapsaroundthesun.bandcamp.com/album/novo-sapiens-see-you-when-you-see-me-remastered','Both albums were recorded, mixed and mastered by Leonardo Perez')],
 target={'kind':'person','id':15985},biography='Leonardo Pérez es un músico, compositor, productor e ingeniero de sonido de Caracas. Participó en Tercer Cuarto y desarrolló Laps Around the Sun tras trasladarse a Londres. Su web personal y el catálogo de su proyecto documentan su trabajo de grabación, mezcla y composición, así como su actividad posterior en Moscú.',membership={'artistId':4640,'role':'integrante y compositor'})
credit('Luxxar','confirmed','El crédito oficial del sencillo identifica expresamente a Luxxar Comunicación Social como autor de la portada. Se normaliza esa organización, conservando diferenciado al músico Luxxar que toca el bajo en la misma banda.',[
 evidence('https://nolightnowater.bandcamp.com/','Arte de portada: Luxxar Comunicación Social'),
 evidence('https://web.archive.org/web/20160610001305/http://lagaleriadelrock.com/portfolio/solera/','Diseño: Luxxar','archival-editorial')],
 target={'kind':'organization','name':'Luxxar Comunicación Social'},biography='Entidad de comunicación visual acreditada oficialmente por el arte de portada del sencillo Solera de No Light No Water. La Galería del Rock conserva el crédito abreviado Luxxar con enlace al perfil LuxxarCS.',notes='No se confunde esta entidad con el bajista Luxxar ni se deduce el nombre legal de ese músico. Fuente oficial: https://nolightnowater.bandcamp.com/ .')
credit('Pedro Fajardo','confirmed','El portafolio propio documenta el diseño de Tomates Fritos. La entrevista de Banesco vincula al diseñador con Tomates Fritos y Karina y publica p_magenta, el identificador que enlaza la fuente histórica. Se usa 34358, que ya tiene el diseño de Karina; no se fusiona 12791 sin probar sus otros trabajos.',[
 evidence('https://www.behance.net/gallery/68715889/Design-and-Packaging-Disc-Tomates-Fritos-TF','Design and Packaging Disc "Tomates Fritos" TF'),
 evidence('https://www.banescopedia.banesco.com/bitstream/handle/100/13644/BD41_415_000009.pdf?isAllowed=y&sequence=1','@p_magenta'),
 evidence('https://sincopa.com/rock_pop/cdinfo_rock/karina_09tequilayrosas.htm','Graphic Design: Pedro Fajardo','editorial-discography')],
 target={'kind':'person','id':34358},biography='Pedro Fajardo es un diseñador gráfico y director de arte. Su portafolio documenta el diseño y empaque del disco Tomates Fritos, y su trayectoria incluye trabajos para Karina. La entrevista publicada por Banesco identifica su perfil profesional como p_magenta.')
for album,doc,title,url,quote in [
 (23178,2606,'Clásico','https://melomanosblogs.wordpress.com/2013/02/02/descarga-el-disco-debut-de-los-colores/','publican su album debut Clasico'),
 (2671,2637,'Sin Otro Sentido','https://www.diversomagazine.com/2011/07/lasso.html','sale a la venta en marzo de 2011 su primer album')]:
    sources=[evidence(url,quote,'contemporary-press')]
    if album==2671:sources.append(evidence('https://music.apple.com/es/album/sin-otro-sentido/1443537379','13 canciones, 45 minutos'))
    else:sources.append(evidence('https://www.elimpulso.com/2013/12/26/entre-los-mejores-discos-nacionales-del-2013/','su disco debut: Clásico','contemporary-press'))
    cases.append(dict(caseId='type:'+str(album),group='release-type',status='confirmed',albumId=album,documentId=doc,fact=title+' es un álbum; también existe un sencillo homónimo',reason='La prensa de época distingue expresamente el álbum del promocional homónimo. Se confirma studio_album sin convertir una canción promocional en otro disco ni crear pistas desde un videoclip. La referencia digital posterior es una edición y no sustituye el año original.',evidence=sources))
for artist,name,url in [(6994,'Luis / Luis Felipe','https://web.archive.org/web/20040408205719/http://www.musica.com.ve:80/bandas/12am.htm'),(7008,'Daniel «el nuevo»','https://web.archive.org/web/20041204200517/http://www.angelfire.com/rock3/ati/mypage1.html')]:
    cases.append(dict(caseId='member:'+str(artist),group='member',status='pending',artistId=artist,fact=name+' — identidad incompleta',reason='No se encontró un apellido ni un perfil personal inequívoco. Se conserva el nombre literal como integrante histórico en la documentación. La ausencia de capturas o resultados no demuestra que no exista la persona.',evidence=[evidence(url,'luis en el bajo' if artist==6994 else 'Daniel “el nuevo” en el bajo')]))
source='https://web.archive.org/web/20041028175647/http://losandeselectronicos.net:80/espanol/records.html'
for number,title in [(2,'Carne Y Hueso - Dúplex'),(3,"Salir De Aqui - V'lis")]:
    cases.append(dict(caseId='track:630:'+str(number),group='track-order',status='pending',albumId=630,versionId=5226,number=number,fact='Alma, posición '+str(number),reason='El sello lista Dúplex antes que V’lis; la descripción y capítulos confirmados del video del catálogo usan el orden inverso. Se documentan ambos órdenes por fuente y no se cambian posiciones ni marcas de tiempo sin identificar el audio de la edición histórica.',evidence=[evidence(source,title),evidence('https://www.youtube.com/watch?v=nrctsTnYo7o',"02. V'lis - Salir De Aquí 03:47\n03. Dúplex - Carne y Hueso 08:56",'catalogue-audio-description')]))
cases.append(dict(caseId='track:655:2',group='track-repertoire',status='pending',albumId=655,versionId=5227,number=2,fact='Vida, posición 2: Tema Rojo 2003 / Solamente Tú',reason='El catálogo primario distingue Tema Rojo y Solamente Tu dentro de la publicación de Sebas&Charles. No son alias probados. La referencia del sello y el video tienen títulos diferentes en esa posición; se mantienen separados en notas de edición, sin renombrar ni inventar marcas de tiempo.',evidence=[evidence(source,'02. Tema Rojo 2003 - Sebas&Charles'),evidence('https://www.youtube.com/watch?v=d_aIiMjuXFM','02. Sebas & Charles - Solamente Tú 04:55','catalogue-audio-description')]))
assert len(cases)==16
plan={'campaign':'wayback-cierre-editorial-2026-10-25','scope':'Primer grupo prioritario: 9 créditos, 2 integrantes, 2 tipos y 3 discrepancias de pistas','approval':'Revisión manual de evidencias, autorizada por Brian con «Hazlo»','cases':cases}
(out/'decisiones-aprobadas.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
lines=[]
for case in cases:
    lines.append('DATO: '+case['fact'])
    for i,e in enumerate(case['evidence'],1):lines.append(f'EVIDENCIA {i}: {e["url"]} — {e["consultedAt"]} — «{e["quote"]}»')
    lines+=['CONCLUSIÓN: '+('confirmado' if case['status']=='confirmed' else 'ambiguo')+'. '+case['reason'],'']
(out/'DICTAMENES.md').write_text('\n'.join(lines))
print(json.dumps({'cases':len(cases),'confirmed':sum(c['status']=='confirmed' for c in cases),'pending':sum(c['status']=='pending' for c in cases)},indent=2))
