# Resolución del remanente RYM — 9 de octubre de 2026

Aplicado en la base local del catálogo. Los **466 casos iniciales** tienen una resolución: **151 discos creados, 40 enlazados con fichas existentes y 275 excluidos con motivo**. El plan regenerado tiene **cero altas pendientes**, **cero identidades ambiguas** y ningún aviso abierto generado por esta resolución.

| Pendiente inicial | Creados | Enlazados | Excluidos |
|---|---:|---:|---:|
| 31 frenados por posibles duplicados | 0 | 31 | 0 |
| 285 cuyo titular solo existía como persona | 31 | 9 | 245 |
| 150 cuyo titular no tenía ficha | 120 | 0 | 30 |
| Total | 151 | 40 | 275 |

Se crearon **35 artistas**, se enlazaron con personas existentes cuando la identidad estaba comprobada y se incorporó a José Ignacio Cabrujas como **persona acreditada**, con textos y voz en la colaboración de Juan Carlos Núñez. Recordatorio quedó como proyecto de Armando Añez (persona 971); se absorbió la ficha errónea de persona «Recordatorio» y se conservaron sus créditos en el proyecto.

Se añadieron **678 pistas**, **141 portadas locales** y **71 clasificaciones de género**. Se corrigieron 12 tipos de disco entre los 31 originales. Las discrepancias de año no demostradas —por ejemplo, Edward Simon y Rincón Morales— se conservaron como discrepancias de fuente, sin sustituir el año del catálogo por el de una edición digital.

## Criterio de inclusión y exclusión

Se incluyó la discografía venezolana y la de titulares con vínculo documentado con la escena venezolana. Nacer fuera de Venezuela no se trató como prueba suficiente para excluir: Billo, Porfi, Agustín Irusta, Juan Arteta, Caterinetta Lescano y Arabella recibieron revisión contextual. No se convirtió una nacionalidad desconocida en «no venezolano».

De los 275 excluidos, **258** corresponden a titulares sin vínculo venezolano documentado que justifique importar su discografía completa; sus créditos de apoyo existentes se mantienen. **14** corresponden a Zzeta, Carlitos Flores y Benjamin Fox Casey: no se encontró vínculo verificable y Brian confirmó que tampoco tiene referencias. Se conservan sus capturas para reconsiderar con evidencia. Los otros **3** son dos publicaciones de campaña atribuidas a Edmundo González que no prueban que sea intérprete, y «Contrecoup», monografía de Benjamin de la Fuente en la que Joshua Dos Santos participa como director. No se crearon discografías ficticias para esos sujetos o participantes.

Cada fila tiene su destino o motivo de exclusión en [resolucion-435.csv](resolucion-435.csv). Las 31 asociaciones originales están en el [informe de auditoría](../rym-pendientes-auditoria-2026-10-09/INFORME.md).

## Identidad y créditos comprobados

- Recordatorio: [perfil oficial y créditos de Lógica resbalosa](https://recordatorio91.bandcamp.com/album/l-gica-resbalosa).
- Knotchej: [perfil del productor](https://traktrain.com/knotchej), que declara origen venezolano.
- Porfi: [historia de su orquesta](https://orquestaporfijimenez.blogspot.com/p/blog-page.html). «Miami» de 2025 se registró como reedición póstuma, según [Matasuna](https://matasunarecords.bandcamp.com/track/porfi-jim-nez-miami-original).
- Agustín Irusta: [biografía de Todo Tango](https://www.todotango.com/creadores/biografia/154/Agustin-Irusta/), que documenta su radicación en Caracas.
- Manuel Rocca: [su sello Abora](https://www.abora-recordings.com/manuel-rocca); Sebastian Rivero: [perfil profesional](https://www.beatport.com/artist/sebastian-rivero/653275).
- Lela: [entrevista a Gabriela Brito](https://www.noticiascaracol.com/los-informantes/lela-mc-la-rapera-venezolana-que-con-solo-12-anos-va-rumbo-al-estrellato-pr30).
- «Una isla en los Andes»: [edición oficial conjunta de Rxnde Akozta y Marrom Fernández](https://rxndeakozta90.bandcamp.com/album/una-isla-en-los-andes-2014). Se conservó el crédito compartido en la ficha.
- «Pajarera Vertical»: [edición oficial en Bandcamp](https://augustobrachomoisesdemartin.bandcamp.com/album/pajarera-vertical); se añadió el crédito de José Ignacio Benítez, Moisés de Martín, identificado en [esta entrevista a Gustavo Guerrero](https://revistaladosis.com/augusto-bracho-gustavo-guerrero-entrevista).
- «Contrecoup»: [ficha del editor Radio France](https://www.radiofrance.com/les-editions/disque/contrecoup-benjamin-de-la-fuente), con compositor y directores diferenciados.

## Correcciones adicionales del importador

El plan usa ahora los alias de álbumes, sigue las redirecciones de personas y conserva destinos explícitos para atribuciones compartidas. Tipo y año distinguen los títulos repetidos; las coincidencias ambiguas se exportan para revisión en vez de elegirse por orden de la base. Cabrujas se representa como autor acreditado y su ficha RYM no identifica al compositor Juan Carlos Núñez.

Se resolvieron siete casos adicionales detectados al regenerar el plan: los dos «^^^^^» de Arca (DJ mix y bootleg), álbum y sencillo «Carita Triste» de Anakena, Sonero Clásico del Caribe Vol.2 de 1978 y original/remix de «Báilame». El álbum de Anakena quedó en **2022 con siete pistas** y el sencillo en **2020 con una pista**, comprobados en [Apple Music, álbum](https://music.apple.com/us/album/carita-triste/1739045970) y [Apple Music, sencillo](https://music.apple.com/us/album/carita-triste/1738078185?i=1738078370).

También se corrigió la comprobación global de títulos en el motor: artistas diferentes pueden tener álbumes homónimos y posiciones diferentes pueden tener pistas del mismo nombre. Se cerraron **231 falsos avisos de alias**, comprobando cada par por artista/año/tipo o por disco/posición. La guarda de alias ambiguos de personas y de álbumes indistinguibles se mantiene.

## Verificación y recuperación

[VERIFICACION.json](VERIFICACION.json) comprueba los 435 destinos/exclusiones, las evidencias de las 198 asociaciones de discos, posiciones únicas de pistas, 141 archivos de portada y la ausencia de revisiones abiertas de estos runs. Contabiliza las altas desde el diario de cambios, no desde las simulaciones.

Pasaron **3 contratos PostgreSQL de ámbito de alias**, **7 pruebas de regresión de identidad**, **13 pruebas anteriores de RYM** y `tsc --noEmit`. Se omiten 6 pruebas anteriores que requieren el extractor opcional. Todos los cambios de base quedan en los runs enumerados en VERIFICACION.json y pueden revertirse desde el historial. Copia completa previa, comprobada con pg_restore: `/home/brian/backups/crv-rym-before-20261009.dump`.

Las [decisiones permanentes](../../docs/decisions/2026-10-09-rym-remanente.json) evitan que los casos vuelvan a aparecer como pendientes genéricos. No se inventaron años, pistas o portadas ausentes de la captura. El plan global conserva además cuatro portadas vacías ajenas a este remanente y dos términos «Field Recording / Nature Recordings» ya tratados como no géneros musicales; no son altas ni identidades pendientes.
