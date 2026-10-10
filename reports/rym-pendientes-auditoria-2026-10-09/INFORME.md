# Auditoría de pendientes de RYM — 9 de octubre de 2026

Se consultó la base PostgreSQL viva y se reconstruyó el plan contra las capturas locales. Se revisaron las decisiones del ER, los alias y los redireccionamientos de personas. Consultas de solo lectura: ninguna alta, fusión, descarte ni modificación del catálogo. Los reportes originales permanecen intactos.

## Resultado

| Bloque | Reporte previo | Verificado hoy | Interpretación |
|---|---:|---:|---|
| Supuestas altas | 31 | 31 reaparecen en el plan; 0 `album_match` abiertos | Las 31 tienen ficha de destino documentada: 28 por alias existente, 3 por resolución cerrada sin alias. No son 31 altas pendientes. |
| Dueño solo persona | 285 discos | 285 discos, 52 personas | No tienen ficha resuelta de artista ni enlace actual de titular; existen todas las personas tras seguir fusiones. |
| Dueño sin ficha | 150 discos | 150 discos, 42 nombres | Son casos con decisiones previas de «verificado distinto» o «sin alias». Esa decisión impide reutilizar la ficha parecida, pero no equivale a excluir al artista del catálogo. |

Las cifras cuentan fichas de lanzamiento RYM y no prueban que cada una necesite un disco nuevo: antes hay que revisar coautorías y discos existentes bajo otro intérprete.

## Los 31: corregir reconocimiento, no crear de nuevo

`plan-discos.py` compara únicamente `public.albums.title` mediante `clave_titulo`; no consulta `ingest.album_aliases`. Los títulos estables del catálogo se conservaron y las variantes RYM quedaron como alias, por lo que el plan vuelve a pedir altas ya resueltas.

Tres casos se cerraron el 6 de octubre después de que la aplicación informara que no podía fijar una variante de nombre. No se crearon discos ni se persistieron estos alias:

- Fur Coat «Repeat» → 14442, «Repeat EP», 2018; revisión 1848445.
- Fur Coat «Time Traveler» → 14451, «Time Traveler EP», 2021; revisión 1848446.
- Schola Cantorum «Aguinaldos Venezolanos» → 5941, «Aguinaldos Venezolanos Vol. I», 1969; revisión 1848453.

Recomendación: reconocer primero la asociación de la ficha RYM con el destino aprobado, después títulos y alias dentro del artista correcto. Añadir los tres alias pendientes por el motor habitual, con evidencia y run reversible. No usar coincidencias de prefijo ni eliminar volúmenes, remix o deluxe indiscriminadamente. Ante candidatos múltiples o diferencias relevantes de formato/edición, revisar.

Los 31 tienen además dos diferencias de año (Edward Simon 2023/2024 y Rincón Morales 1962/1963) y 14 diferencias de tipo: 12 son `other`, dos `compilation` frente a Album. Deben tratarse como correcciones separadas y no como nuevas identidades. En Femeninas hay promoción del disco en 2023 y fecha digital de 2024: no sustituir automáticamente el año original por el de una plataforma.

Las dos fichas de Schola 5941 y 5950 no tienen pistas. Las capturas aportan respectivamente 12 y 25: son candidatas a completar después de revisar que corresponden a las mismas ediciones. «La Orquesta De Los Exitos» 8297 tiene 11 pistas frente a 12 en RYM; investigar la diferencia sin reemplazar su listado automáticamente.

## Los 285 con persona

El examen local por señal de origen resulta en:

| Señal | Personas | Discos |
|---|---:|---:|
| País de nacimiento fuera de Venezuela | 47 | 255 |
| Persona actual marcada venezolana | 1 | 10 |
| RYM sin país de nacimiento y catálogo sin nacionalidad afirmada | 4 | 20 |

Estas son señales documentales, no un veredicto de nacionalidad ni de pertenencia a la escena. Nacer fuera o vivir fuera no excluye a un artista venezolano.

Priorizar cuatro casos que suman 30 lanzamientos antes de descartar el resto:

- **Recordatorio, 13:** figura indebidamente como persona 39906. El proyecto de Armando Añez se documenta en su Bandcamp. Armando ya existe como persona 971 y tiene historia en Americania. Recomiendo crear la ficha de proyecto personal Recordatorio y enlazarla con 971; revisar los créditos/alias de 39906 antes de corregir esa ficha. «Besos Infinitos» ya está en Sunsplash 12829, por lo que los 13 no son 13 discos nuevos seguros. Dos sencillos se acreditan como Armando y Alejandro: respetar la coautoría.
- **Billo Frómeta, 10:** el ID histórico 20300 redirige a 7779, que sí está marcado venezolano. `plan-personas-vz.py` usa el ID antiguo para mirar esa señal, por lo que lo deja fuera. Varios discos ya aparecen en Billo's Caracas Boys, Felipe Pirela u Orquesta De Concierto De Billo Frómeta; hay diferencias de año y posibles duplicados entre esas fichas. Revisar atribución y edición antes de crear una ficha solista o más discos.
- **Porfi Jiménez, 6:** su lugar de nacimiento dominicano no justifica excluir su discografía venezolana. Su orquesta ya tiene ficha 4595 y otras variantes. Revisar si estos lanzamientos corresponden a la orquesta o a un proyecto diferente. El sencillo «Miami» de 2025 merece comprobación de intérprete/edición; Porfi falleció en 2010.
- **Knotchej, 1:** RYM solo da residencia en EE. UU.; su perfil propio declara origen venezolano. Crear ficha de proyecto/solista con tipo verificado y enlazar la persona existente 40126. Conservar el nombre de firma si no consta un nombre civil fiable.

Para el resto, recomiendo mantener las personas por sus créditos y excluir del lote de altas las discografías sin vínculo venezolano acreditado. Billy Ocean (52), Euson (26) y Pete Philly (23) ejemplifican el volumen de origen extranjero del remanente. Benjamin Fox Casey y Spell siguen sin origen demostrado con las fuentes examinadas. No hace falta borrar datos ni convertir automáticamente cada persona en artista.

Hay una decisión histórica «solo los venezolanos» en `plan-personas-vz.py`, y un lote anterior ya creó fichas y discos bajo ese criterio. Lo pendiente requiere corregir las señales y excepciones, no decidir desde cero sobre las 285 capturas.

## Los 150 sin ficha

| Señal en las capturas RYM | Dueños | Discos |
|---|---:|---:|
| Nacimiento o formación en Venezuela | 28 | 114 |
| Solo residencia en Venezuela | 5 | 9 |
| Sin señal de origen | 2 | 9 |
| Nacimiento o formación fuera de Venezuela | 7 | 18 |

Priorizar las 28 identidades con origen venezolano. Por volumen: Carlos Otero (22), La Cruz (22), El Pricto (11), Luis G. Tovar (9), Alejandro Molinari (7), Lorenzo González (6) y Omar Acedo (5). Crear su propia ficha después de verificar identidad y tipo, respetando los veredictos que los separan de homónimos. El Pricto no debe enlazarse con El Prieto; Living Death no con Living Dead; Decibeles no con Decibel.

Los 114 son un lote de revisión con buena señal de origen, no una autorización para 114 altas automáticas. Hay casos que necesitan atribución o alcance: Edmundo González aparece con canciones de campaña; Cabrujas con un álbum compartido con Juan Carlos Núñez; Joshua Dos Santos con «Contrecoup», cuyo segmento de URL dice `multiple`. Distinguir intérprete, compositor, director, voz acreditada y persona homenajeada; aplicar la política existente para material hablado y de campaña antes de crear una ficha musical.

Los cinco casos de residencia son Arabella (4), Lela (2), Manuel Rocca (1), Marrom Fernández (1) y Sebastian Rivero (1). La biografía propia de Rivero en Beatport confirma Caracas como origen; los otros requieren comprobar nacionalidad o vínculo de escena, sin confundir residencia con nacionalidad. Zzeta (8) y Carlitos Flores (1) siguen sin señal local suficiente. Los 18 con origen exterior se pueden dejar fuera del lote venezolano salvo que aparezca una vinculación pertinente.

## Orden recomendado

1. Corregir el reconocimiento de alias/decisiones RYM y los redireccionamientos de personas. Recalcular en una salida separada: los 31 deben dejar de pedir altas.
2. Resolver Recordatorio, Knotchej, Billo y Porfi con atribución correcta, persona ya existente y comparación de discografía. No crear solistas ficticios para representar una orquesta.
3. Preparar un lote de revisión para los 28 dueños con origen venezolano y sus 114 capturas; resolver primero identidad, tipo y dueño real.
4. Mantener a revisión los casos sin evidencia y registrar explícitamente los excluidos por alcance. Evitar una cola permanente que mezcle «no corresponde importar» y «falta investigar».
5. Antes de aplicar, producir un ensayo con destinos, altas realmente nuevas, enlaces, correcciones y exclusiones. Aplicar por el motor de claims en runs reversibles según el procedimiento existente.

## Correspondencia completa de los 31

| Artista | Título RYM | Ficha existente | Título del catálogo | Reconocido por |
|---|---|---:|---|---|
| Rada | Impressiones Etnosonicas | 2932 | Impresiones Etnosónicas | alias existente |
| Los Dementes | iAlerta mundo! llegan: The Crazy Men | 8227 | Alerta Mundo Llegan... "The Crazy Men" | alias existente |
| Akapellah | Double Cup | 13749 | Double Cup (feat. Trainer & Big Soto) | alias existente |
| Big Soto | Sotorious | 13836 | SOTORIUS | alias existente |
| Ángel Custodio Loyola | El disco de oro | 14680 | El disco de oro de Ángel C. Loyola | alias existente |
| Soledad Bravo | Volumen 4 | 8416 | Vol. 4 | alias existente |
| Los Melódicos | German, Niro, Chucho y Emilita con Los Melódicos | 8264 | Germán, Niro, Chucho y Emilita | alias existente |
| Los Melódicos | 12 Hits | 8270 | 12 Hits Con Los Melódicos | alias existente |
| Los Melódicos | Lucerito y Los Melódicos | 8293 | Lucerito | alias existente |
| Los Melódicos | Album homenaje a los 30 años de Víctor Piñero | 8309 | Album Homenaje a Los 30 Años de Victor Piñero Los Melódicos | alias existente |
| Los Melódicos | El sonido | 8337 | El Sonido St. | alias existente |
| Los Melódicos | Orquesta de los exitos | 8297 | La Orquesta De Los Exitos | alias existente |
| Mau y Ricky | No puede ser | 13331 | No Puede Ser (con Eladio Carrion) | alias existente |
| Fur Coat | Berlin Chronicles | 14446 | Berlin Chronicles EP | alias existente |
| Fur Coat | Katarsis | 14436 | Katarsis EP | alias existente |
| Fur Coat | Interstellar | 14457 | Interstellar EP | alias existente |
| Fur Coat | Numbers | 14438 | Number's EP | alias existente |
| Fur Coat | Immersion | 14445 | Immersion EP | alias existente |
| Fur Coat | Repeat | 14442 | Repeat EP | resolucion documentada sin alias |
| Fur Coat | Time Traveler | 14451 | Time Traveler EP | resolucion documentada sin alias |
| Fur Coat | In Our Town | 14455 | In Our Town - EP | alias existente |
| Arca | Ritual | 12741 | Яitual | alias existente |
| Schola Cantorum de Caracas | Aguinaldos Venezolanos | 5941 | Aguinaldos Venezolanos Vol. I | resolucion documentada sin alias |
| Schola Cantorum de Caracas | Antología del madrigal Venezolano | 5950 | Antología del Madrigal Venezolano Vol. I y Vol. II | alias existente |
| Un Solo Pueblo | La música de Venezuela Un Solo Pueblo | 9086 | La Música de Venezuela | alias existente |
| Lilia Vera | Lilia Vera y Su Nuevo Canto | 9282 | Y Su Nuevo Canto | alias existente |
| Benito González | Passion Reverence Transcendence: The Music of McCoy Tyner | 6607 | Passion Reverence Transcendence: The Music of McCoy | alias existente |
| Los Blanco | Dando en el blanco con Los Blanco | 7308 | Dando En El Blanco | alias existente |
| Los Blanco | La fiesta caliente | 7315 | Fiesta Caliente | alias existente |
| Rincón Morales | Gaiteros de la nueva ola | 15026 | Gaiteros de nueva ola | alias existente |
| Edward Simon | Femininas | 6195 | Femeninas | alias existente |

## Evidencia y archivos

- `discos-31-verificados.csv` y `.json`: destinos, diferencias y revisiones.
- `duenos-pendientes.csv` y `.json`: los 94 dueños, sus señales y sus 435 lanzamientos.
- `resumen-duenos.json`: conteos por clasificación local.
- `cotejo-duenos-especiales.json`: candidatos para revisar Billo, Porfi y otras atribuciones; las sugerencias por parecido NO prueban identidad.
- `verificacion-web.json`: verificaciones externas complementarias.
- `auditar.py` y `auditar-31.py`: consultas de solo lectura y generación del informe de datos.

Fuentes externas:

- [Recordatorio](https://recordatorio91.bandcamp.com/album/l-gica-resbalosa): Perfil propio situado en Caracas, Venezuela; créditos de composición, producción y mezcla de Armando Añez.
- [Knotchej](https://traktrain.com/knotchej): El perfil del productor declara que es originario de Venezuela.
- [Porfi Jiménez](https://orquestaporfijimenez.blogspot.com/p/blog-page.html): Nacido en República Dominicana; llegó a Venezuela en 1954, fundó su orquesta en 1963; falleció en 2010.
- [Sebastian Rivero](https://www.beatport.com/artist/sebastian-rivero/653275): Biografía del perfil del DJ: Caracas es su ciudad de origen.
- [Edward Simon — Femeninas](https://www.katesmithpromotions.com/wp-content/uploads/2023/05/ESf-ONE-SHEET.pdf): Promoción de radio fechada mayo de 2023; título Femeninas, 11 pistas. Hay evidencia del disco anterior a la fecha digital de 2024.
- [Edward Simon — Femeninas](https://music.apple.com/us/album/femeninas-songs-of-latin-american-women-feat-magos-herrera/1785306196): Fecha digital mostrada: 27 de diciembre de 2024; 11 pistas. La diferencia de año no demuestra otra obra.
