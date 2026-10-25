"""Genera el informe editorial desde evidencia local; no accede a la base."""
import collections
import datetime
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "reports/discos-tracklist-2026-10-15"
audit = json.loads((OUT / "evaluacion.json").read_text())
base = json.loads((OUT / "expediente-base.json").read_text())
pairs = {r["pair"]: r for r in audit["results"]}
albums = {int(r["album"]["id"]): r for r in base["albums"]}
decisions = {}


def add(pair, verdict, finding, action, keep=None, refs=()):
    assert pair in pairs and pair not in decisions, pair
    decisions[pair] = dict(pair=pair, verdict=verdict, finding=finding,
                           recommendation=action, suggestedKeep=keep,
                           additionalReferences=list(refs), applied=False)


# Los 27 pares de coincidencia fuerte inicial.
add("5761-5762", "ediciones_documentadas",
    "Sincopa identifica las portadas recíprocamente como edición venezolana original de Sociedad Amigos de la Música y edición estadounidense HI-FI. Las trece pistas coinciden, pero la discografía distingue SAM EP-3 de HI-FI SR812. Las portadas locales son distintas. No son dos obras nuevas ni dos filas sin diferencia editorial.",
    "Relacionar como ediciones de la misma obra. Una eventual página única debe conservar títulos, sellos, catálogos, países y ambas portadas. No ejecutar una fusión que solo guarde un catálogo.",
    refs=["https://sincopa.com/classic/cdinfo_class/aliriodiaz_1957recitalgtr.htm", "https://sincopa.com/classic/cdinfo_class/aliriodiaz_1957gtr_vzla.htm"])
add("3796-4635", "consolidar",
    "Las trece pistas son las del recopilatorio EMI de 2000. 3796 nació de la lista de discografía y abrevia LAI; 4635 nació de la página detallada. La lista de 3796 fue completada después por operador. La abreviación no documenta otra edición.",
    "Consolidar en 4635, que conserva portada, sello y créditos. Usar el título completo de The Beginnings y guardar la abreviación como alias.", 4635)
add("15162-15163", "productos_digitales_distintos",
    "La API actual de Deezer confirma dos productos Discos VRZ del 2016-06-30: doce temas y 2315 segundos cada uno. UPC 190374902502 frente a 190374901772. Las doce duraciones coinciden, pero los doce ISRC son diferentes y el arte también. No se comparó audio.",
    "Conservar los productos comerciales y señalar el repertorio compartido. No declararlos duplicados técnicos ni dar por probado que los masters sean idénticos.",
    refs=["https://api.deezer.com/album/103449782", "https://api.deezer.com/album/114412932"])
add("8098-8099", "ediciones_documentadas",
    "Sincopa presenta Lo Siento Por Ti como portada y título alternativos de Injusto Despecho, edición Velvet 1966. Las doce pistas coinciden, incluidos los mosaicos 13 y 14. La diferencia editorial existe aunque ambos años y sellos coincidan.",
    "Relacionar o consolidar conservando las dos presentaciones y portadas. Mantener los subtemas de los mosaicos dentro de su pista; no expandirlos para crear diferencias artificiales de cantidad.",
    refs=["https://sincopa.com/latin_pop/cdinfo_latin/felipe_pirela/felipepirela_293injustodespecho.htm"])
add("8347-26925", "consolidar",
    "Mismas doce canciones, arte y año. La segunda ficha procede del alta RYM; La Sabrosita es el título, mientras Liz con Los Melódicos es la atribución incorporada al nombre en la primera. AllMusic confirma el repertorio y documenta otra presentación Vedisco.",
    "Consolidar en 8347 y titular La Sabrosita; conservar la atribución a Liz y Los Melódicos. No reemplazar el sello Velvet por Vedisco sin diferenciar la edición.", 8347,
    ["https://www.allmusic.com/album/release/sabrosita-mr0000050216"])
add("8869-26923", "consolidar",
    "Las doce pistas y la portada del volumen 4 coinciden. Quinteto Contrapunto Vol. 4 abrevia Música popular y folklórica de Venezuela, Vol. 4. RYM aporta LPHM 033. Hay un conflicto de fecha oculto: César Alejandro Carrillo, Debates IESA 2018, corrige expresamente 1966 por julio de 1965.",
    "Consolidar en 8869 conservando LPHM 033 y ambos títulos. Proponer 1965 como año original con la investigación citada y conservar el conflicto con Sincopa/RYM. Dos fichas con 1966 no equivalen a dos confirmaciones independientes.", 8869,
    ["https://www.debatesiesa.com/debatesweb/wp-content/uploads/2026/02/Aprender-a-emprender-Debates-IESA-XXIII-3-jul-sep-2018-.pdf"])
add("3592-28380", "consolidar",
    "Once pistas, portada y 2003 coinciden. Sincopa y MA describen el mismo recopilatorio; MA da RT002. 28380 procede de la captura MA que ya se había usado como evidencia de 3592. The y el subtítulo 1986-1996 explican la diferencia nominal.",
    "Consolidar en 3592; título The Wasted Years y alias Wasted Years / Wasted Years 1986-1996. Conservar RT002 y que las dos últimas pistas son en vivo de 2001; el intervalo del subtítulo no es la fecha de edición.", 3592,
    ["https://www.metal-archives.com/albums/Arkangel/The_Wasted_Years/1248791"])
add("4250-13568", "consolidar",
    "III y volumen 3 identifican el mismo repertorio de once temas. 4250 tiene portada y créditos; 13568 viene de un release-group de MusicBrainz. Sincopa fecha el CD en 2007 y Spotify la distribución digital en 2008.",
    "Consolidar en 4250, conservar las dos formas del título y diferenciar fecha física y digital. No convertir automáticamente la fecha de plataforma en año original.", 4250,
    ["https://sincopa.com/rock_pop/cdinfo_rock/ilanchester19_cancionvzla3.htm", "https://open.spotify.com/intl-es/album/6zR82GwD8uhoYbUEqaBaR6"])
add("6938-15707", "consolidar",
    "Las diez piezas corresponden al LP Dimensión Latina 76 / Salsa Brava que Sincopa fecha en 1975. El arte lleva ambas denominaciones. 15707 no aporta portada ni créditos; el título corto no documenta otra edición.",
    "Consolidar en 6938, con el título completo y Salsa Brava como alias. No transformar el 76 del título en año de publicación.", 6938)
add("7120-15397", "consolidar",
    "Las diez canciones y el arte coinciden; solo cambia la reproducción de color. El sitio oficial lista ese repertorio como Guaco 91. Sincopa llama Guaco al lanzamiento de 1991.",
    "Consolidar en 15397 por sus créditos y titular Guaco 91, conservando enlaces y metadatos de 7120. Guaco queda como alias contextual de esta edición.", 15397,
    ["https://www.guaco.org/pages/guaco-91"])
add("278-3537", "edicion_por_resolver",
    "Las diez canciones coinciden, pero Sincopa distingue Ritmo Revolution independiente 1997 y Hecho a Mano 1998. La página detallada describe la segunda. 3537 combina Hecho a Mano con 1997, dato inconsistente con su propia fuente. 278 conserva el video del canal.",
    "No fusionar todavía. Identificar qué edición representa el video 278 y revisar el año de la edición Hecho a Mano. Una página unificada deberá conservar ambas ediciones y el video.",
    refs=["https://sincopa.com/rock_pop/artist_rock/mata_rica.htm", "https://sincopa.com/rock_pop/cdinfo_rock/matarica_1ritmo.htm"])
add("3170-4104", "consolidar",
    "Mismas nueve canciones y arte. Hablando de tus Sueños procede de una discografía de blog; el LP y la canción homónima se titulan Hablando a Tu Sueño, Sono-Rodven 1987. 4104 conserva músicos, producción y estudio.",
    "Consolidar en 4104. La variante errónea puede mantenerse como alias de búsqueda documentado, pero no como otra edición.", 4104,
    ["https://sincopa.com/rock_pop/cdinfo_rock/frankquint_09hablando.htm"])
add("8143-8144", "ediciones_documentadas",
    "Atrévete Top-Hits 1980 y El Ídolo Top-Hits USA 1980 tienen las mismas nueve piezas, duraciones y grabación, con otro diseño. Pero 8144 también tiene claims de El Ídolo Sonográfica 1982: esa página enumera doce canciones diferentes. La ficha mezcla un homónimo distinto.",
    "Separar primero la evidencia Sonográfica 1982. Después relacionar Atrévete y El Ídolo USA como ediciones de la misma obra. No absorber la fuente de 1982 ni borrar ese lanzamiento por homonimia.",
    refs=["https://sincopa.com/latin_pop/cdinfo_latin/jose_luis_rodriguez/joseluis_80atrevete.htm", "https://sincopa.com/latin_pop/cdinfo_latin/jose_luis_rodriguez/joseluis_80elidolo.htm", "https://sincopa.com/latin_pop/cdinfo_latin/jose_luis_rodriguez/joseluis_elidolo82.htm"])
add("8290-26924", "consolidar",
    "Mismo arte y nueve pistas del LP Discomoda 1967. El título largo añade la atribución a Cherry. Recuerdos Nº 10 contiene cinco subtemas; no son cinco pistas nuevas. Coinciden fuente detallada y captura RYM.",
    "Consolidar en 8290 conservando título alternativo y créditos de Cherry Navarro, Tito Cortés y demás intérpretes. Preservar la estructura del mosaico.", 8290)
add("3962-4914", "fuentes_mezcladas",
    "Sincopa y Hippito 2011 documentan el LP de ocho temas y el mismo arte. 4914 también contiene el post Hippito 2014 del sencillo Un poquito más / Cuando era niño, Color 10189, con solo dos caras. El tracklist compartido vincula los LP, pero la ficha mezcla LP y sencillo.",
    "Separar antes el sencillo, su fuente de 2014 y sus créditos. Consolidar después la parte del LP con 3962. No asignar Color 10189 al LP ni descartar la evidencia del sencillo.",
    refs=["https://hippitoysuschatarritas.blogspot.com/2011/11/delia-un-poquito-mas-color-top-hits.html", "https://hippitoysuschatarritas.blogspot.com/2014/06/delia-un-poquito-mas-color-10189.html"])
add("4015-4660", "consolidar",
    "Ocho temas y arte coinciden. La página detallada identifica Bolumen 4 y Al Día Siguiente (De Dei After) como título/subtítulo del mismo LP Top Hits 1984. 4015 nace de discografía y 4660 del detalle.",
    "Consolidar en 4660 por sus créditos, conservar el título completo de 4015 y los alias. Emparejar ocho pistas; no anexar otro disco.", 4660)
add("15394-26931", "consolidar",
    "Ocho canciones, arte de frutas y 1981 coinciden. Mango y Grupo Mango describen el LP Integra; RYM aporta YVLP-018. No debe confundirse con otros álbumes homónimos de Mango de años anteriores.",
    "Consolidar en 15394 conservando Integra, YVLP-018, títulos, duraciones y créditos.", 15394)
add("2131-3336", "consolidar",
    "Ambos blogs describen la misma transferencia de casete a CD de 1996, siete canciones y el mismo arte. Repiten incluso la advertencia de fallas de transferencia. Rock de Vzla sí titula el material Evolucionando Bajo Suelo.",
    "Consolidar en 3336 y guardar Época de Recluta como alias. Documentar el casete. Los blogs parecen reutilizar material y no son dos pruebas de audio independientes.", 3336)
add("1665-2982", "consolidar",
    "Seis canciones y arte iguales. La banda en SoundCloud y su discográfica Spiritual Beast identifican el EP como Stormthrash (2012). La crónica de marzo y el productor en abril ya informaban que el EP estaba terminado, mientras MA/discográfica dan diciembre.",
    "Consolidar en 1665 con título Stormthrash y tipo EP. Mantener 2012; no adoptar diciembre como primera publicación sin resolver la evidencia contemporánea.", 1665,
    ["https://spiritual-beast.com/artists/stormthrash/", "https://soundcloud.com/stormthrash", "https://www.toprocknews.com/el-gillmanfest-se-apodero-de-caracas/"])
add("1112-28738", "consolidar",
    "La captura MA 975118 y el post de Descargas Metal describen el demo 2005 con las mismas cinco canciones. El arte usa el mismo logo; una reproducción añade Demo 2005 y la lista. No hay evidencia de otro demo distinto.",
    "Consolidar en 1112 como Demo 2005 y conservar Demos como alias. Preservar formato y fecha de la captura.", 1112,
    ["https://www.metal-archives.com/albums/Arsenal/Demo_2005/975118"])
add("3778-28633", "consolidar",
    "Sincopa y MA 778458 describen el EP 2007 de cuatro canciones, grabado en Doscara Studio. La conjunción y las mayúsculas no documentan otra edición. La ficha nueva carece de portada y créditos.",
    "Consolidar en 3778, conservando la variante sin conjunción y el formato CD. Mantener los créditos existentes.", 3778,
    ["https://www.metal-archives.com/albums/Alice_in_Hell/Coraz%C3%B3n%2C_sangre%2C_entra%C3%B1as/778458"])
add("5312-28730", "consolidar",
    "Las dos fichas reutilizan MA 1185167, con cuatro temas, arte y duraciones iguales. U+200B dentro de Sobredósis y fúnebre explica el nombre nuevo. MA da 3 de noviembre de 2023; Apple da 13 de noviembre y Spotify lo clasifica como EP.",
    "Consolidar en 5312, limpiar caracteres de formato del nombre mostrado y conservar el original en evidencia. Mantener las discrepancias de fecha/tipo como claims, sin inventar otra obra.", 5312)
add("5383-28768", "consolidar",
    "Ambas fichas proceden del mismo registro MA 1119272 y del mismo arte. Las cuatro pistas coinciden. U+200B dentro de Demostración causó la variante. La captura da demo digital del 28 de febrero de 2023.",
    "Consolidar en 5383 y mostrar Demostración 2023 sin caracteres invisibles; conservar la fecha completa y el formato digital.", 5383)
add("1500-2752", "consolidar",
    "Los dos posts nombran el EP completo Unreal Feelings... Cause To Me Desperation (2009), con tres temas y la misma foto. El título corto es un recorte de la fuente; también coincide el bonus de la tercera pista.",
    "Consolidar en 1500 y guardar el título corto como alias. Conservar la indicación bonus, sin sumar otra copia de la pista.", 1500)
add("1925-2410", "consolidar",
    "Los dos posts identifican el EP 2009 con tres canciones. El arte es el mismo logo a diferente resolución. EP y Buffalo Mad son dos formas de titular ese material, sin otra edición documentada.",
    "Consolidar en 2410 como Buffalo Mad, tipo EP. Conservar EP como alias contextual.", 2410)
add("1375-28855", "consolidar",
    "MA 144771 y los blogs describen Hekula... Voz de los Espíritus, demo 2007 de tres canciones. 1375 ya reunía dos blogs con el título corto; 28855 es otra importación del mismo demo.",
    "Consolidar en 1375 y adoptar el título completo, conservando Voz de los Espíritus como alias. Atribuir a MA la fecha 15 de enero de 2007.", 1375,
    ["https://www.metal-archives.com/albums/Odo%27Sha/Hekula..._Voz_de_los_Esp%C3%ADritus/144771"])
add("1353-3380", "consolidar",
    "Rock de Vzla llama Oldskull al Demo 2008 de dos pistas; el otro blog y MA 219728 lo llaman Till Then You Die. Ambas portadas llevan este último título. Las dos canciones también aparecen después en Breaking Bones, que es otro álbum.",
    "Consolidar en 1353 como Till Then You Die; guardar Oldskull como alias de este demo. No absorber Breaking Bones por compartir esas canciones.", 1353)

# Los 36 casos con grafías aproximadas.
add("9051-14960", "consolidar_condicionado",
    "Las fuentes alinean cuarenta canciones de 2011; tres variantes son pequeñas, incluida Maragariteño/Margariteño. Sincopa describe dos CD de veinte pistas. Vol. 2 pertenece al título de la colección, no indica que se deba conservar solo el segundo CD.",
    "Consolidación probable tras verificar identificador/portada del producto. Conservar dos discos y su numeración; corregir únicamente erratas respaldadas.")
add("7826-14820", "edicion_o_grabacion_por_verificar",
    "Las veintitrés piezas encajan, con Hernández/Hernadez, pero hay trece diferencias de duración y años 1990/1992. El material incluye bloques con diferentes directores y acompañantes. Hay títulos repetidos que pueden emparejarse ambiguamente.",
    "Conservar separados hasta comprobar soporte, catálogo y duraciones por posición. No equiparar automáticamente dos Malagueñas o Fulías ni concluir identidad de master.")
add("9666-14911", "reedicion_probable",
    "Veinte canciones infantiles encajan; Un/El elefante es la única variante aproximada. La referencia física Riqui, Riqui, Riqui Ran es de 2005 y Cancionero Infantil Venezolano es un producto digital posterior.",
    "Relacionar como posible reedición, preservando fecha física y digital; comprobar créditos e identificador comercial antes de consolidar.")
add("8633-8637", "ediciones_documentadas",
    "Sincopa describe Mi Cantar Por Venezuela (Pattaya 2002) y Venezuela Linda (AVR 2005). Son veinte canciones, con orden diferente y sellos distintos; Gaván de Maracay omite el artículo en una edición.",
    "Preservar las dos secuencias y ediciones. No imponer un orden a los créditos de pista de la otra ficha.")
add("8176-14494", "consolidar_condicionado",
    "Veinte canciones y 1999 coinciden. Crucemos/Cruzemos es ortográfico y other frente a compilation expresa ausencia de clasificación, no un conflicto demostrado de identidad.",
    "Consolidar bajo Colección 20/20 tras verificar el identificador de MusicBrainz. Mantener recopilatorio y la grafía documentada de Crucemos.", 8176)
add("9136-14863", "reedicion_probable",
    "Veinte temas encajan, con Magariteño/Margariteño. Sincopa describe el CD Palacio de 1990 y Deezer otro producto con fecha posterior.",
    "Relacionar como republicación probable y conservar fechas de cada edición. No reemplazar el año original por el digital.")
add("15098-15193", "edicion_o_grabacion_por_verificar",
    "Dieciocho canciones encajan; Rui Ra/Rui Rua es menor. Las referencias dan 1995/1996 y dos diferencias de duración, con procedencia MusicBrainz/Deezer.",
    "Comprobar soporte y presentación comercial antes de consolidar. Los nombres de pistas no prueban identidad de grabación.")
add("13069-13072", "edicion_o_grabacion_por_verificar",
    "Dieciséis temas coinciden; Te Quierro/Te Quiero conserva duración 191 s. El catálogo carece de años y las referencias apuntan a distintos productos digitales.",
    "Comparar UPC, sello y grabaciones. La errata permite emparejar una canción, pero no borrar una presentación comercial.")
add("8616-14837", "fecha_y_edicion_por_resolver",
    "Se alinean dieciséis temas y varía Pa'lante y Pa'trás. El catálogo combina 2008 y 1988; la página de Sincopa describe un CD independiente de 2008.",
    "No elegir 1988 por ser la fecha más antigua. Verificar el soporte que respalda ese año y separar original, reedición o error.")
add("9450-13106", "fuentes_mezcladas",
    "El detalle Sincopa de La Onda Máxima describe Sonograma 2001, catorce canciones. 9450 conserva 1972 de otra referencia discográfica. Puede haberse asociado el repertorio del CD al año del LP; Si Voce Pensa/Pensar dura 158 s en ambas.",
    "Resolver primero qué edición representa 9450. Consolidar únicamente el CD si ambos expedientes son su duplicación; conservar evidencia del LP de 1972.")
add("1427-1598", "corregir_pistas_no_fusionar",
    "Rules 2003 tiene once canciones en dos blogs y Sincopa; la antología Ariah 2004 añade N.I.B., Al Fin Una Victoria y Buscando Perdón. 1427 tiene hoy también los tres bonus, causando el falso 14/14. Varias duraciones de 1598 parecen desplazadas: Encuentro Con La Muerte 125 frente a 333 s.",
    "Mantener ambas ediciones, restituir once pistas al original y catorce a la antología. Revisar la asociación de duraciones por canción y los bonus.")
add("9041-9158", "ediciones_documentadas",
    "Sincopa diferencia Querida Mamá, vol. 16 (Sonográfica 1993), de Serenata Para Las Madres (Latin World 2002). Comparten catorce temas; Bordó/Bordó En es menor.",
    "Relacionar como reedición preservando portadas, años y sellos.")
for pair in ["9049-14949", "9176-14949", "9049-9176"]:
    add(pair, "repertorio_compartido_por_verificar",
        "Catorce canciones se repiten en tres presentaciones: 20 años de éxitos (1991), La Historia (Latin World 2003) y 30 Años De Éxitos (Palacio/Anes 2007). Calypso de El/del Callao y Media/Mediana Diana son variantes de los nombres, no prueba de identidad comercial.",
        "Analizar como grupo de tres lanzamientos, no ejecutar tres fusiones aisladas. Verificar masters o licencias y conservar las ediciones.")
add("142-3580", "reedicion_o_error_de_fuente",
    "Sincopa atribuye a Solo Éxitos (Universal 2001) los trece temas completos de Harakiri City (1996). Nº/# 2 es una diferencia de escritura. Los músicos acreditados cambian entre páginas, por lo que la igualdad de listas no certifica la edición.",
    "Conservar Harakiri City. Comprobar soporte de Solo Éxitos: puede ser reedición de catálogo o error de la fuente secundaria; no resolverlo solo con la lista.")
add("299-3299", "corregir_pistas_no_fusionar",
    "3299 repite las trece canciones de Ashanty Granpa (2005). El post citado da cuatro a En Vivo (Valencia 2002): Celebración, Hymno Shanty, Feel de Flow y Música De Paz. El run 8727 copió el bloque del álbum de estudio al concierto.",
    "Mantener estudio y directo. Reparar las cuatro pistas del concierto y revisar los textos derivados de la lista errónea.")
add("9459-9465", "reedicion_probable",
    "Doce temas encajan, con Cuatricentenaria/Cuartricentenaria. Sincopa describe el LP Velvet de 1976 y el CD ANS de 1994 por separado.",
    "Relacionar como probable reedición y preservar los dos sellos y años.")
add("9859-14926", "consolidar_condicionado",
    "Vol. V y Volumen 5 identifican el mismo disco de doce temas. canchunchú-cCanchunchú es una errata con duraciones próximas, 213/216 s. Sincopa fecha el CD en 1996 y la otra ficha no tiene año.",
    "Consolidación probable en 9859, conservando el identificador de MusicBrainz y el año del CD; verificar el soporte antes de aplicar.", 9859)
add("9188-9195", "ediciones_documentadas",
    "Sincopa da créditos originales del LP Polydor y de reedición Lyric/AVR 1996, con master digital de Rafael Alterio. Doce temas encajan. La ficha del CD llama Vol. 2 al original y la otra Vol. 5, conflicto de numeración.",
    "Preservar original y reedición. Resolver el volumen con el soporte y no confundir numeración de antología con numeración original.")
add("2148-2580", "consolidar",
    "1nfinit0 es la estilización de Infinito. Doce temas de 2008 aparecen bajo ese encabezado en Sincopa y el blog; Encuentro/Encuentros es la variante aproximada. other no demuestra una edición diferente.",
    "Consolidar en 2148, mantener 1nfinit0 como título artístico, Infinito como alias y tipo álbum de estudio.", 2148)
add("15400-24002", "edicion_o_grabacion_por_verificar",
    "Doce temas encajan, con Tuya/Tuyo. Los Blanco 76 aporta Velvet LPV-1706, mientras Ellos van usa 252011. El mismo año no descarta una licencia o edición territorial.",
    "Verificar las etiquetas y países de ambos catálogos. No borrar ninguno de los números al consolidar.")
add("9667-14910", "fecha_y_edicion_por_resolver",
    "Once canciones encajan y Criollísima/Criollíssima es variación español/portugués. Sincopa fecha Sesiones con Hamilton de Holanda en 2009; la otra referencia da 2006 y tipo colaboración.",
    "Determinar edición original e internacional. Preservar crédito a Hamilton de Holanda y condición de colaboración.")
add("348-3371", "corregir_pistas_no_fusionar",
    "El post diferencia Waking the Nightmares, álbum 2010 de once pistas, de Waking The Nightmare, sencillo 2009 con Lights, Camera and Action. 3371 recibió todas las canciones del álbum.",
    "Mantener separados y restituir la pista del sencillo. No copiar duración o mezcla del álbum sin comprobarla.")
add("9812-13103", "repertorio_compartido_por_verificar",
    "Diez canciones se emparejan, con Cantos/Canto de Mi Tierra. La fuente física es el LP Cymbal de 1961; Cantares de Mi Tierra corresponde a otro producto digital.",
    "Comparar el producto digital y sus créditos con el LP; no atribuir 1961 a la fecha de edición digital.")
add("4193-14479", "consolidar",
    "Las diez pistas y 1988 coinciden; 5 y V son numeraciones equivalentes del disco Sono-Rodven. Me Fascinas/Me fascina dura 231 s en ambas; Sincopa usa Me Fascinas.",
    "Consolidar en 4193 con 5 y V como alias y conservar identificadores de plataforma y grafía documentada.", 4193)
add("4234-13575", "reedicion_probable",
    "Diez canciones encajan, con Daniella/Daniela. La fuente del original es Philips/Sonográfica 1985; A Pasarla Bien corresponde a un producto digital posterior.",
    "Relacionar la republicación con el original y conservar títulos y fechas de las presentaciones comerciales.")
add("1630-1958", "edicion_o_grabacion_por_verificar",
    "Los diez temas encajan y sus duraciones difieren como máximo un segundo por pareja. Hay tres erratas, orden distinto y fuentes que dan 2007/2008. Esto favorece misma grabación, pero no fija orden ni fecha de cada edición.",
    "Verificar libreto o portada. Si se consolida, conservar los dos órdenes y el conflicto de fecha; no escoger uno por similitud.")
add("7675-12868", "edicion_o_grabacion_por_verificar",
    "Ocho temas de 1987 encajan, con Mulata Coqueta/La mulata coqueta. De Venezuela Para El Mundo y La salsa soy yo pueden ser títulos territoriales o de catálogo.",
    "Verificar sello, país y catálogo antes de elegir un único título.")
add("1867-28324", "consolidar",
    "Ocho temas de 1984 coinciden. Sincopa y MA describen el LP Color; MA aporta 103-35073. Decapo es errata y Dacapo es la grafía documentada. Hay duraciones en conflicto: Hijos De La Democracia difiere 15 s, 454/469.",
    "Consolidar en 1867 como Dacapo, conservando Decapo como alias. Mantener duraciones contradictorias como claims para comprobarlas, sin sobreescritura silenciosa.", 1867,
    ["https://www.metal-archives.com/albums/Resistencia/Dacapo/32024"])
add("19-3064", "corregir_pistas_no_fusionar",
    "La fuente diferencia el EP Through The Smoke I've Seen The Truth de Esperanza en la tormenta (Acto I: Kalima), sencillo 2012. Las cinco pistas de 3064 pertenecen al bloque del EP.",
    "Mantener ambos lanzamientos y reparar la lista del sencillo. No inventar duración o lista que la fuente no proporciona.")
add("560-14069", "consolidar",
    "Las cinco canciones encajan; Incrédulo/El incrédulo omite el artículo. Sincopa y el crédito digital sitúan una edición en 2009; prensa contemporánea documenta presentación en marzo de 2010. El 2010 compartido por el catálogo no resuelve eso.",
    "Consolidar en 560 conservando el video y el título Los Mesoneros — EP. Documentar discrepancia entre edición 2009 y lanzamiento promocional 2010.", 560,
    ["https://rumberos.net/grupo-musical-los-mesoneros-presentaron-su-ep/"])
add("1421-28476", "edicion_o_grabacion_por_verificar",
    "Loser 2010 y Perdedor MA 2016, Lament Records, comparten cinco títulos salvo Basta/Basta ya de callar. La traducción y seis años de diferencia permiten reedición o regrabación, pero faltan duraciones comparables.",
    "Conservar separados hasta verificar soporte o grabaciones. No inferir reedición idéntica solo de la traducción.")
add("25819-27128", "mantener_distintos",
    "Synth Destruction Two y Synth Destruction son piezas continuas de 1940 y 3677 segundos y años distintos. El comparador ignoró Two como marca de parte; no hay repertorio multipista que confirme identidad.",
    "Mantener separados y tratar palabras de número/parte como información de identidad.")
add("1856-28753", "consolidar",
    "Las dos referencias describen el sencillo Living Dead 2015 de dos canciones. The es un artículo omitido y Treshold/Threshold una errata. MA 1011112 aporta 4:25 y 8:00.",
    "Consolidar en 1856 como The Never Ending Dream, con Across the Threshold como segunda pista. Atribuir a MA la fecha 31 de enero de 2015.", 1856,
    ["https://www.metal-archives.com/albums/Living_Dead/The_Never_Ending_Dream/1011112"])
add("13964-13965", "mantener_distintos",
    "Véngase I y Véngase II son partes distintas y duran 262/201 segundos. La guarda aproximada preservaba dígitos arábigos, pero no números romanos.",
    "Mantener separados y preservar numeración romana y marcas de parte al comparar títulos.")

# Errores comprobados y reediciones dentro de los otros 277 pares.
for pair in ["2464-2465", "2464-2466", "2464-2468", "2465-2466", "2465-2468", "2466-2468"]:
    add(pair, "corregir_pistas_no_fusionar",
        "Bandcamp del artista distingue Presente (2008), doce canciones; Presente — Remixes (2009), cinco remezclas; Música Normal (2010), sencillo; Rarezas (2011), que incluye Laguna. El catálogo repite los cinco remixes en cuatro fichas. Los runs 8419, 8962 y 8996 copiaron esa lista a Música Normal, Presente y Laguna.",
        "Mantener los lanzamientos separados, reparar pistas y revisar reseñas, tipo y año derivados. La equivalencia exacta de Laguna con la colección Rarezas requiere confirmar qué edición quiso representar el blog.",
        refs=["https://uliseshadjis.bandcamp.com/album/presente-2008", "https://uliseshadjis.bandcamp.com/album/presente-remixes", "https://uliseshadjis.bandcamp.com/track/m-sica-normal", "https://uliseshadjis.bandcamp.com/album/rarezas"])
add("2723-2724", "corregir_pistas_no_fusionar",
    "El post separa Montecarlo y Five Time Loco; no enumera temas bajo Montecarlo y da dieciocho bajo Five Time Loco. El run 9129 copió esos dieciocho a Montecarlo. Su reseña conserva además evidencia Discogs de una pista 13 con tema oculto.",
    "Mantener ambos álbumes y recuperar la lista propia de Montecarlo desde soporte o fuente puntual; no inventarla ni borrar el álbum por coincidir con una lista copiada.")
for pair in ["2392-2393", "2392-4269"]:
    add(pair, "corregir_pistas_no_fusionar",
        "1983 Part2 aparece como sencillo 2011 sin lista propia. En otro bloque el blog enumera las nueve canciones de The Hidden Words. El run 9111 asignó estas al sencillo.",
        "Conservar sencillo y álbum, reparar atribución de pistas y verificar versión/duración de 1983 Part2.")
add("2393-4269", "fecha_y_edicion_por_resolver",
    "The Hidden Words y Hidden Words comparten nueve temas, artista y créditos de Darwin Lubo. El blog da 2009 y Sincopa 2006. Es un posible duplicado del álbum, diferente del error de 1983 Part2.",
    "Consolidación probable tras resolver año y edición; preservar ambas afirmaciones de fecha y mantener el sencillo fuera.")
add("2552-2557", "corregir_pistas_no_fusionar",
    "La fuente da Sol como sencillo 2002 y En Vivo Plaza de Los Museos como concierto de cuatro temas: Caricuao, Diex3, Megan y Sol. La ficha del sencillo contiene también los cuatro.",
    "Mantener ambos objetos y reparar 2552. Que Sol aparezca en el concierto no convierte el directo en el sencillo.")
add("2860-2861", "corregir_pistas_no_fusionar",
    "El post diferencia Fuera de Aquí (sencillo 2012), Nuestra Victoria, Tu Derrota (EP 2011, dos canciones) y un demo 2010. El sencillo recibió los dos temas del EP.",
    "Mantener EP y sencillo; reparar 2861 sin reutilizar el bloque vecino.")
add("2849-2855", "corregir_pistas_no_fusionar",
    "El Otro Yo es un sencillo 2012 sin lista desarrollada en el post. Las trece canciones actuales son el bloque Esperar 2009.",
    "Mantener el álbum y el sencillo; corregir la lista de 2855 y los textos derivados.")
add("2911-2913", "corregir_pistas_no_fusionar",
    "El post separa Reflejos (Acústico, versión inédita 2012) de Estación Transatlantic (2011), listado de doce temas. 2913 reproduce el álbum completo bajo el nombre de Reflejos.",
    "Mantener separados y reparar 2913. Revisar también su tipo: el encabezado documenta una versión acústica.")
add("2914-2916", "corregir_pistas_no_fusionar",
    "La fuente lista tres canciones bajo A Rise For Every Fall 2010 y ninguna bajo Whisper of Doom 2012. El catálogo duplicó esas tres en Whisper of Doom sin respaldo de su bloque.",
    "No fusionar. Recuperar la lista propia de Whisper of Doom desde una referencia específica; esta evidencia solo invalida la asociación copiada.")
for pair in ["7075-7077", "7075-8115", "7077-8115"]:
    add(pair, "ediciones_documentadas",
        "Las tres páginas Sincopa comparten dieciséis canciones, duraciones, músicos y grabación. En Vivo (Anes 1998) afirma que el CD ya había sido editado como Algo Más Que Boleros (Palacio-Polygram 1993). Diario Meridiano 1999 conserva el mismo material. El original de 1993 ya está acreditado como grabado en directo.",
        "Relacionar las tres ediciones de la misma grabación. No inferir otra toma de concierto solo por el título En Vivo; preservar 1993/1998/1999 y sus sellos.")

strong = {r["pair"] for r in pairs.values() if r["category"] == "coincidencia_fuerte"}
variants = {r["pair"] for r in pairs.values() if r["category"] == "tracklist_con_variantes"}
assert len(strong) == 27 and len(variants) == 36
assert strong <= decisions.keys() and variants <= decisions.keys()


def sources_for(album_id):
    urls = set()
    for c in base["claims"]:
        if int(c["album_id"]) != album_id:
            continue
        if c["url"] and c["url"].startswith("http") and "feeds/posts" not in c["url"]:
            urls.add(c["url"])
        if c["field"] in ["title", "source_url", "description", "release_year"]:
            for ev in c["evidence"] or []:
                u = ev["url"] or ""
                if u.startswith("http") and "feeds/posts" not in u:
                    urls.add(u)
    return sorted(urls)


def pages_for(album_id):
    return sorted({(c["url"], c["stored_path"], c["sha256"])
                   for c in base["claims"]
                   if int(c["album_id"]) == album_id and c["stored_path"]})


api_file = OUT / "plataformas-variantes.json"
api_data = json.loads(api_file.read_text())["results"] if api_file.exists() else []
api_by_id = {str(d["id"]): d for d in api_data if d.get("id")}
preview_file = OUT / "previsualizaciones-sin-aplicar.json"
previews = json.loads(preview_file.read_text())["previews"] if preview_file.exists() else []
preview_by_pair = {r["pair"]: r for r in previews}
for pair, d in decisions.items():
    r = pairs[pair]
    d["initialCategory"] = r["category"]
    d["albums"] = [dict(id=a["id"], artist=a["artist"], title=a["title"],
                        year=a["year"], tracks=len(a["tracks"])) for a in r["albums"]]
    d["sources"] = sorted(set(d["additionalReferences"] + [
        u for a in r["albums"] for u in sources_for(a["id"])]))
    d["cachedPages"] = [dict(url=u, path=p, sha256=s) for a in r["albums"]
                        for u, p, s in pages_for(a["id"])]
    api_ids = {u.rsplit("/", 1)[-1] for u in d["sources"] if "deezer.com/album/" in u}
    d["livePlatformMetadata"] = [
        {k: value for k, value in api_by_id[i].items() if k not in ["artist", "tracks"]}
        for i in sorted(api_ids) if i in api_by_id]
    d["evidenceBasis"] = "Lectura documental individual de capturas originales y/o fuentes web/API; portadas locales en los 27 prioritarios. No se comparó audio."
    if pair in preview_by_pair:
        preview = preview_by_pair[pair]
        d["mergePreview"] = dict(
            requiredMode="match", matched=preview["matched"],
            unmatched=len(preview["unmatched"]),
            positionOnly=preview["positionOnlyMatches"],
            engineSuggestedMode=preview["suggestion"]["mode"],
            fieldsInConflict=[c["field"] for c in preview["conflicts"]],
            applied=False)

# Datos añadidos tras la verificación actual de las APIs.
decisions["13069-13072"]["finding"] += (
    " La consulta actual distingue además tres productos: UPC 888003719880, "
    "194660962515 y 191018715939, con sellos Suramericana del Disco, Carnaval "
    "y El Gallo Productions y fechas digitales 2013, 2020 y 2016.")
decisions["9812-13103"]["finding"] += (
    " La API digital actual suma solo 401 segundos para sus diez pistas "
    "(Venevox, 2021, UPC 192562614655), por lo que no confirma la integridad "
    "ni identidad de las grabaciones del LP.")
decisions["1427-1598"]["finding"] += (
    " La API actual de Rules, UPC 5059654910369, también confirma once pistas.")
decisions["13964-13965"]["finding"] += (
    " Deezer confirma UPC diferentes: 859716440897 y 859716439617, "
    "y fechas 27 y 21 de enero de 2016.")

LABELS = {
    "consolidar": "Consolidación de ficha recomendada",
    "consolidar_condicionado": "Consolidación probable, comprobación pendiente",
    "ediciones_documentadas": "Ediciones distintas documentadas",
    "productos_digitales_distintos": "Productos digitales distintos",
    "edicion_por_resolver": "Edición por resolver",
    "fuentes_mezcladas": "Separar fuentes mezcladas antes",
    "edicion_o_grabacion_por_verificar": "Verificar edición y grabación",
    "reedicion_probable": "Reedición probable",
    "fecha_y_edicion_por_resolver": "Fecha y edición por resolver",
    "corregir_pistas_no_fusionar": "Corregir pistas; no fusionar",
    "repertorio_compartido_por_verificar": "Repertorio compartido por verificar",
    "reedicion_o_error_de_fuente": "Reedición o error de fuente",
    "mantener_distintos": "Mantener distintos",
}
counts = collections.Counter(decisions[p]["verdict"] for p in strong)
vcounts = collections.Counter(decisions[p]["verdict"] for p in variants)
meta = dict(createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            snapshot=base["meta"], individuallyReviewedPairs=len(decisions),
            strongBreakdown=dict(counts), variantBreakdown=dict(vcounts),
            databaseWrites=0, audioCompared=False,
            limitations="Las recomendaciones no están aplicadas. La matriz no revisada individualmente es triage de evidencia, no verificación web completa.")
(OUT / "analisis-editorial.json").write_text(json.dumps(
    dict(meta=meta, decisions=list(decisions.values())), ensure_ascii=False, indent=2) + "\n")


def esc(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


lines = [
    "# Análisis profundo de coincidencias de discos", "",
    "La igualdad del tracklist tiene tres explicaciones en este catálogo: "
    "duplicación de ficha, edición del mismo material y asociación errónea de "
    "canciones. Las coincidencias iniciales son señales de revisión, no una lista "
    "para fusionar en bloque.", "",
    f"Se documentan individualmente **{len(decisions)} pares**: los 27 prioritarios, "
    f"los 36 con grafías aproximadas y {len(decisions)-63} casos adicionales. "
    "El expediente de procedencia abarca 743 discos, 9.359 claims de álbum "
    "y 1.205 grupos de origen de pistas. Se compararon visualmente las portadas "
    "de los 27 pares iniciales; el mismo arte puede proceder de una misma fuente "
    "y no constituye corroboración independiente.", "",
    "Las consultas de la base fueron READ ONLY y REPEATABLE READ. Se combinaron "
    "capturas originales, páginas públicas y APIs de plataformas. No se comparó "
    "audio ni se modificaron fichas, pistas, claims o decisiones de curaduría.", "",
    "## Resultado de los 27 prioritarios", "",
    "| Diagnóstico | Pares |", "|---|---:|",
]
lines += [f"| {LABELS[k]} | {n} |" for k, n in counts.items()]
lines += [
    "", "## La causa comprobada de varios falsos duplicados", "",
    "La campaña de reposición de listas numeradas del 26 de septiembre de 2026 "
    "(curation:restore-scraped-tracklist) asignó en algunos casos bloques de "
    "páginas con varios lanzamientos al álbum equivocado. El texto de los posts "
    "distingue los discos; los runs conservan el destino de cada lista.", "",
    "| Ficha afectada | Contenido incorrecto | Fuente correcta / run |",
    "|---|---|---|",
    "| 2464 · Música Normal | Cinco remixes de Presente | Es un sencillo propio / 8419 |",
    "| 2468 · Presente | Cinco remixes | Álbum original: doce temas / 8962 |",
    "| 2466 · Laguna | Cinco remixes | El blog la distingue como rarezas / 8996 |",
    "| 3299 · PapaShanty, En Vivo | Trece temas de Ashanty Granpa | Valencia 2002: cuatro temas / 8727 |",
    "| 2392 · Illusive Mind, 1983 Part2 | Nueve temas de The Hidden Words | Sencillo separado / 9111 |",
    "| 2723 · Trece, Montecarlo | Dieciocho temas de Five Time Loco | Otro álbum / 9129 |", "",
    "Se comprobó además asociación incorrecta o no respaldada en The Asbestos "
    "3371, Feel The Blade 3064, Karavan 2552, Legado 2861, Ultra IB 2855, "
    "Espiral Jack 2913 y Forget the Fallen 2916. Cronos 1427 incorpora tres "
    "bonus de otra edición. Son **al menos 14 fichas afectadas** en los casos "
    "revisados, sin extrapolar ese número al catálogo completo.", "",
    "Las reseñas de Música Normal, Laguna y Presente también describen hoy "
    "remixes que no corresponden al lanzamiento. Reparar solo el nombre "
    "dejaría el error. Hay que revisar pistas, reseña, clasificación, fecha y "
    "enlaces que se hayan inferido de la lista equivocada.", "",
    "El perfil del artista distingue [Presente](https://uliseshadjis.bandcamp.com/album/presente-2008), "
    "[los remixes](https://uliseshadjis.bandcamp.com/album/presente-remixes), "
    "[Música Normal](https://uliseshadjis.bandcamp.com/track/m-sica-normal) "
    "y [Rarezas](https://uliseshadjis.bandcamp.com/album/rarezas). "
    "Son referencias puntuales, sin cambios en el registro de fuentes.", "",
    "## Límites corregidos de la primera evaluación", "",
    "- El comparador inicial no contrastó sellos, países ni UPC; por eso ediciones reales entraron entre los casos sin alertas.",
    "- Dos fichas pueden heredar el mismo año incorrecto. Esto afecta al volumen 4 del Quinteto Contrapunto y a la edición Hecho a Mano de Mata Rica.",
    "- Una lista copiada del bloque equivocado no corrobora identidad: debe verificarse el encabezado al que pertenece.",
    "- Los números romanos y palabras de parte también identifican obras: Véngase I/II y Synth Destruction/Two no son simples erratas.",
    "- Hay U+200B reales y secuencias escapadas literales en títulos; ambos requieren revisar la normalización sin borrar el original de la evidencia.",
    "- Diferencias de duración pueden venir de silencios, masters, grabaciones distintas o emparejamientos ambiguos de títulos repetidos. No se verificó audio.", "",
]
for category, title in [
    ("coincidencia_fuerte", "Los 27 pares iniciales, uno por uno"),
    ("tracklist_con_variantes", "Los 36 pares con variantes de canciones"),
    ("tracklist_igual_revisar_contexto", "Casos adicionales profundizados"),
]:
    lines += ["## " + title, ""]
    for r in audit["results"]:
        if r["category"] != category or r["pair"] not in decisions:
            continue
        d = decisions[r["pair"]]
        a, b = r["albums"]
        lines += [
            f"### {a['artist']} · {r['pair']}", "",
            f"**{a['title']}** ({a['year'] or 'sin año'}) ↔ "
            f"**{b['title']}** ({b['year'] or 'sin año'}). "
            f"Pistas: {len(a['tracks'])}/{len(b['tracks'])}; "
            f"coincidencias exactas normalizadas: {r['exactMatches']}; "
            f"con variantes: {r['variantMatches']}.", "",
            "**Diagnóstico: " + LABELS[d["verdict"]] + ".**", "",
            d["finding"], "", "**Recomendación:** " + d["recommendation"], "",
        ]
        if d["suggestedKeep"]:
            keep = d["suggestedKeep"]
            other = next(x["id"] for x in r["albums"] if x["id"] != keep)
            lines += [f"Destino sugerido, sin ejecutar: **{keep} ← {other}**. "
                      "Revisar previsualización, créditos y conservación de datos antes de aplicar.", ""]
        if "mergePreview" in d:
            pv = d["mergePreview"]
            lines += [f"Previsualización READ ONLY: {pv['matched']} pistas emparejadas, "
                      f"{pv['unmatched']} sin pareja. Modo indicado para consolidar: match. "
                      f"El motor sugiere {pv['engineSuggestedMode']}; "
                      f"{len(pv['positionOnly'])} emparejamientos se basan solo en posición "
                      "y se deben contrastar con las variantes documentadas.", ""]
            if pv["engineSuggestedMode"] == "append":
                lines += ["**Atención operativa:** la sugerencia append añadiría otro disco "
                          "con el mismo repertorio. Para este par corresponde emparejar "
                          "las pistas, no anexarlas.", ""]
        diffs = [m for m in r["matches"] if not m["normalizedEqual"]]
        if diffs:
            lines += ["Variantes cotejadas: " + "; ".join(
                f"«{m['a']['title']}» ↔ «{m['b']['title']}»" for m in diffs) + ".", ""]
        evidence = [albums[x["id"]] for x in r["albums"]]
        labels = [x["label"] or "sin sello cargado" for x in evidence]
        credit_counts = [x["album_credits"] + x["track_credits"] for x in evidence]
        lines += [f"Datos conservables: sellos {labels[0]} / {labels[1]}; "
                  f"créditos de álbum y pista {credit_counts[0]} / {credit_counts[1]}.", ""]
        for item in d["livePlatformMetadata"]:
            lines += [
                f"Comprobación actual en [API de plataforma]({item['url']}): "
                f"{item.get('title')}; fecha {item.get('release_date')}; "
                f"sello {item.get('label')}; UPC {item.get('upc')}; "
                f"{item.get('nb_tracks')} pistas, {item.get('duration')} s. "
                "Es metadata de esa edición digital, no prueba de fecha original.", ""]
        refs = d["additionalReferences"] + [
            u for u in d["sources"] if u not in d["additionalReferences"]]
        refs = [u for u in refs if "youtube.com" not in u and "/images/" not in u][:5]
        if refs:
            lines += ["Fuentes y procedencia: " + ", ".join(
                f"[referencia {i+1}]({u})" for i, u in enumerate(refs)) + ".", ""]
        if d["cachedPages"]:
            lines += [
                "El JSON editorial identifica las capturas originales por ruta y SHA-256. "
                "Las fuentes no accesibles en la consulta web actual se cotejaron desde "
                "su captura local cuando estaba disponible.", ""]
lines += [
    "## Previsualizaciones del motor", "",
    f"Se previsualizaron {len(previews)} consolidaciones recomendadas dentro de una "
    "transacción de solo lectura. Ninguna dejó pistas sin pareja en modo match. "
    "La sugerencia del motor pide append en tres pares: 8347/26925 (La Sabrosita), "
    "7120/15397 (Guaco 91) y 4015/4660 (Bolumen 4). No se aplicó esa sugerencia: "
    "anexar repetiría el repertorio como otro disco. Cinco pares con pequeñas "
    "variantes tienen algún emparejamiento solo por posición; se documenta cuáles "
    "para revisarlos antes de una eventual aplicación.", "",
    "## Alcance de la matriz restante", "",
    "La matriz contiene 426 pares enriquecidos: 27 prioritarios, 36 variantes, "
    "277 con alertas y 86 decisiones previas. Distingue los casos documentales "
    "individuales del triage de los restantes. No todos los 277 ni todos los "
    "pares del catálogo tuvieron verificación web individual.", "",
    "Los 101 pares con distinto ID de artista se agrupan en atribuciones.md. "
    "Incluyen colaboraciones, nombres anteriores, grupos y solistas asociados "
    "y posibles errores. Compartir un disco no autoriza fusionar artistas. "
    "Las 86 decisiones previas se preservan; esta investigación no las reabre.", "",
    "## Orden recomendado de corrección", "",
    "1. Reparar listas asignadas al bloque equivocado y textos derivados, con auditoría de los valores anteriores.",
    "2. Separar fuentes mezcladas de Delia y El Ídolo para no arrastrar el sencillo o el homónimo a otra obra.",
    "3. Consolidar los duplicados de ficha con recomendación individual y previsualización, conservando canal, enlaces, catálogos, alias, portadas y créditos.",
    "4. Relacionar ediciones y títulos territoriales preservando país, sello, catálogo y fecha. El modelo actual no justifica borrar esas diferencias.",
    "5. Resolver atribución de colaboraciones y cambios de nombre antes de mover discos entre proyectos.", "",
    "No se aplicó ninguna de estas acciones.", "",
]
(OUT / "analisis-profundo.md").write_text("\n".join(lines))

# Matriz: las filas no investigadas individualmente llevan el nivel triage.
matrix = []
focus = set(base["focusPairs"])
for r in audit["results"]:
    if r["pair"] not in focus:
        continue
    a, b = r["albums"]
    d = decisions.get(r["pair"])
    if d:
        status, reason = d["verdict"], d["recommendation"]
    elif r["category"] == "decision_previa_distintos":
        status, reason = "decision_previa_preservada", "; ".join(r["warnings"])
    elif a["artistId"] != b["artistId"]:
        status, reason = "revisar_atribucion", "Comprobar colaboración, alias, nombre anterior o atribución. No fusionar artistas solo por repertorio."
    elif any("duraciones" in w for w in r["warnings"]):
        status, reason = "revisar_grabacion_y_duraciones", "Verificar duraciones por canción, versión y encabezado correcto del bloque de la fuente."
    elif any("Versiones" in w for w in r["warnings"]):
        status, reason = "revisar_version_y_procedencia", "Comprobar directo, demo, regrabación o lista copiada antes de decidir."
    elif a["year"] != b["year"]:
        status, reason = "revisar_edicion_y_fecha", "Distinguir primera edición, distribución digital y error de año."
    else:
        status, reason = "revisar_metadatos_y_procedencia", "Cotejar fuente puntual, formato, catálogo, tipo y posiciones."
    matrix.append(dict(
        pair=r["pair"], status=status,
        reviewLevel="documental_individual" if d else "triage",
        recommendation=reason, initialCategory=r["category"],
        albums=[dict(id=x["id"], artistId=x["artistId"], artist=x["artist"],
                     title=x["title"], year=x["year"], tracks=len(x["tracks"]))
                for x in r["albums"]], warnings=r["warnings"],
        sources=sorted({u for x in r["albums"] for u in sources_for(x["id"])})))
assert len(matrix) == 426
(OUT / "matriz-revision.json").write_text(json.dumps(
    dict(meta=meta, rows=matrix), ensure_ascii=False, indent=2) + "\n")
table = ["# Matriz de revisión documental y triage", "",
         "426 pares. El nivel documental_individual tiene recomendación editorial; "
         "triage indica una revisión aún pendiente. Ninguna acción se aplicó.", "",
         "| Par | Artistas | Discos | Nivel | Diagnóstico | Recomendación |",
         "|---|---|---|---|---|---|"]
for r in matrix:
    a, b = r["albums"]
    table.append(
        f"| {r['pair']} | {esc(a['artist'])} / {esc(b['artist'])} | "
        f"{esc(a['title'])} ↔ {esc(b['title'])} | {r['reviewLevel']} | "
        f"{r['status']} | {esc(r['recommendation'])} |")
(OUT / "matriz-revision.md").write_text("\n".join(table) + "\n")

cross = collections.defaultdict(list)
for r in audit["results"]:
    a, b = r["albums"]
    if (a["artistId"] != b["artistId"] and r["sameCount"] and not r["genericOnly"]
            and r["exactMatches"] == len(a["tracks"])):
        cross[(a["artistId"], b["artistId"], a["artist"], b["artist"])].append(r["pair"])
assert sum(map(len, cross.values())) == 101
crosslines = ["# Mismo repertorio bajo distintos artistas", "",
              "101 pares agrupados por IDs de artista. Esta es una cola de atribución, "
              "sin recomendación general de fusionar proyectos o personas. "
              "Las decisiones previas se preservan.", "",
              "| Artista A | Artista B | Pares de discos |", "|---|---|---|"]
for (a, b, an, bn), cases in cross.items():
    crosslines.append(f"| #{a} · {esc(an)} | #{b} · {esc(bn)} | {', '.join(cases)} |")
(OUT / "atribuciones.md").write_text("\n".join(crosslines) + "\n")

short = [
    "# Conclusiones de la investigación de discos", "",
    "**No se deben fusionar todos los tracklists iguales.** Se documentaron "
    "81 pares de forma individual y se preparó una matriz de 426. "
    "Se encontraron al menos 14 fichas con listas de otro lanzamiento o sin "
    "respaldo para el encabezado del disco. No se modificó la base.", "",
    "De los 27 pares inicialmente fuertes: **21 consolidaciones recomendadas**, "
    "tres pares de ediciones documentadas (Alirio Díaz, Felipe Pirela y José "
    "Luis Rodríguez), un producto digital doble con códigos distintos (Billo), "
    "una edición por identificar (Mata Rica) y un caso que mezcla LP/sencillo (Delia).", "",
    "De los 36 pares aproximados: cinco consolidaciones recomendadas, tres "
    "probables condicionadas, cuatro asociaciones de pistas que reparar, "
    "dos descartes claros y 22 casos de edición/fecha/grabación o fuente que "
    "requieren resolver diferencias.", "",
    "## Consolidaciones recomendadas, todavía sin aplicar", "",
    "Cada flecha indica la ficha sugerida para conservar y la que absorbería. "
    "Es una recomendación editorial: preservar créditos, enlaces, catálogos y "
    "alias y revisar los conflictos antes de ejecutar.", "",
    "| Artista | Destino sugerido | Títulos actuales |",
    "|---|---|---|",
]
for d in decisions.values():
    if d["verdict"] != "consolidar":
        continue
    a, b = pairs[d["pair"]]["albums"]
    keep = d["suggestedKeep"]
    drop = next(x["id"] for x in [a, b] if x["id"] != keep)
    short.append(f"| {esc(a['artist'])} | {keep} ← {drop} | "
                 f"{esc(a['title'])} ↔ {esc(b['title'])} |")
short += [
    "", "Hay tres candidatas adicionales condicionadas: Serenata Guayanesa "
    "9051/14960, José Luis Rodríguez 8176/14494 y El Cuarteto 9859/14926.", "",
    "## Casos que cambian la decisión", "",
    "- **Ulises Hadjis:** 2464, 2466 y 2468 recibieron los cinco remixes de "
    "2465. El artista documenta por separado un álbum original de doce temas, "
    "los cinco remixes, el sencillo Música Normal y Rarezas. Reparar pistas "
    "y reseñas; no fusionar las cuatro fichas.",
    "- **PapaShanty 3299:** sus trece temas son del álbum de estudio; "
    "el bloque En Vivo Valencia 2002 tiene cuatro.",
    "- **Trece 2723:** tiene las dieciocho canciones de Five Time Loco. "
    "Montecarlo es otro álbum.",
    "- **Illusive Mind 2392:** el sencillo 1983 Part2 recibió las nueve "
    "canciones de The Hidden Words.",
    "- **The Asbestos 3371 y Feel The Blade 3064:** sencillos con las listas "
    "completas del álbum/EP vecino en la fuente.",
    "- **Cronos 1427/1598:** Rules 2003 tiene once temas; la antología 2004 "
    "agrega tres. La ficha original también recibió esos bonus y hay duraciones "
    "que revisar.",
    "- **Delia 4914:** reúne el LP de ocho canciones y la fuente del sencillo "
    "Color 10189, de dos caras. Separar esa evidencia antes de consolidar los LP.",
    "- **El Ídolo 8144:** mezcla la edición Top-Hits USA de Atrévete, nueve "
    "temas, con El Ídolo Sonográfica 1982, doce temas diferentes.",
    "- **Billo 15162/15163:** dos UPC, doce ISRC diferentes, mismo sello, fecha "
    "y duración. Son productos digitales distintos; no se verificó audio.",
    "- **Floria Márquez 7075/7077/8115:** En Vivo declara expresamente ser "
    "reedición de Algo Más Que Boleros. El título En Vivo no implica aquí "
    "otra toma de concierto.",
    "- **Quinteto Contrapunto 8869/26923:** mismo volumen, pero una "
    "investigación hemerográfica corrige el año 1966 por 1965.",
    "- **Rawayana Véngase I/II y Carlos Giffoni Synth Destruction/Two:** "
    "son diferencias de parte y duración; mantener separados.", "",
    "## Comprobación operativa", "",
    "Las 26 previsualizaciones READ ONLY emparejan todas las pistas. "
    "En tres casos el motor sugiere append, aunque corresponde match: "
    "8347/26925, 7120/15397 y 4015/4660. "
    "No se aplicó esa sugerencia ni ninguna fusión. Cinco pares con variantes "
    "tienen coincidencias basadas solo en posición; requieren revisar las "
    "grafías documentadas antes de aplicar.", "",
    "Las 86 decisiones previas se conservan. Los 101 pares bajo artistas "
    "distintos quedan en una cola de atribución; no justifican una fusión "
    "general de artistas.", "",
    "El detalle por caso y sus fuentes está en analisis-profundo.md; "
    "las recomendaciones estructuradas, en analisis-editorial.json. "
    "La matriz marca explícitamente qué filas son documentales y cuáles son "
    "triage pendiente. No se verificaron individualmente en web todos los "
    "pares del catálogo.", "",
]
(OUT / "conclusiones.md").write_text("\n".join(short))
(OUT / "README.md").write_text(
    "# Investigación de coincidencias de discos\n\n"
    "- [Conclusiones y 26 consolidaciones propuestas](conclusiones.md).\n"
    "- [Análisis documental de 81 pares](analisis-profundo.md).\n"
    "- [Decisiones editoriales estructuradas](analisis-editorial.json).\n"
    "- [Matriz de 426 pares: documental o triage](matriz-revision.md).\n"
    "- [101 pares bajo distintos artistas](atribuciones.md).\n"
    "- [Previsualizaciones sin aplicar](previsualizaciones-sin-aplicar.json).\n"
    "- [Procedencia de pistas y runs de corrección anteriores](procedencia-pistas-alertas.json).\n"
    "- [Expediente de 743 discos](expediente-base.json).\n\n"
    "evaluacion.json/md y resumen.md conservan la auditoría inicial. "
    "Las conclusiones documentales posteriores prevalecen para interpretar "
    "sus candidatos. No hubo escrituras en la base ni comparación de audio.\n")

manifest = [p for p in OUT.iterdir() if p.is_file()
            and p.name != "manifest-investigacion.json"]
(OUT / "manifest-investigacion.json").write_text(json.dumps(
    dict(createdAt=meta["createdAt"], artifacts=[
        dict(path=p.name, bytes=p.stat().st_size,
             sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        for p in sorted(manifest)]), indent=2) + "\n")
print(json.dumps(dict(individualPairs=len(decisions), strong=dict(counts),
                     variants=dict(vcounts), matrix=len(matrix),
                     crossArtistPairs=sum(map(len, cross.values()))),
                 ensure_ascii=False, indent=2))
