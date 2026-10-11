# Verificación web de identidades

La búsqueda web descubre fuentes; no decide ni cambia el catálogo. Cada propuesta
se guarda con la revisión o persona investigada, un hash del dosier, las URL y
huellas de las páginas, y citas cuyo texto existe en la página guardada.

## Operación

1. Configurar `CRV_SEARXNG_SECRET` y `CRV_SEARXNG_URL=http://127.0.0.1:8888/` en `.env`.
2. Arrancar el buscador privado con
   `docker compose -f ops/searxng/compose.yml --env-file .env -p crv-search up -d`.
3. Ejecutar `npm run db:migrate` (migraciones 0041 y 0042).
4. En **Posibles duplicados**, pulsar **Investigar con IA en internet** en la tarjeta del par.
   El botón también aparece en los pares de personas de **Fichas repetidas**; allí la investigación
   es puntual, porque algunos hallazgos no tienen una revisión en la cola.
   En un par de la cola de revisión se puede usar **Investigar en internet**.
   Para un hallazgo de **Trayectoria imposible**, pulsar **Investigar ficha mezclada en internet**.
5. Leer las citas y las fichas. **Marcar como leída** registra la nota humana;
   fusionar o declarar distintas sigue en **Posibles duplicados**. Una ficha
   mezclada se separa con el procedimiento de separación, moviendo los créditos.

En **Posibles duplicados** cada tarjeta muestra un solo puntaje de coincidencia.
Ese puntaje reúne las señales del catálogo y, cuando existe, la evidencia web
verificada. «Misma persona» añade hasta 25 puntos como señal documental;
«distintas» o «ficha mezclada» lo dejan en 0. «No se sabe» no suma puntos y
recomienda esperar. Son puntos de triaje, no probabilidades ni permisos para
fusionar. Si una revisión se creó sin puntaje, se calcula con el mismo detector
y se muestran sus señales. El filtro «Coincidencia alta» usa ese único puntaje
e incluye revisiones creadas manualmente.

Desde cualquier **ficha de persona**, el operador puede pulsar **Investigar
identidad con otra ficha**, elegir la otra con el buscador y ver el puntaje de
coincidencia, sus señales, la evidencia documental, la recomendación y las fuentes sin
abrir la ventana de fusión. Desde la migración 0043, la investigación queda
guardada para el par y aparece en ambas fichas, aunque no exista una revisión
de cola. La búsqueda se ejecuta como trabajo consultable: el botón responde
enseguida, el estado se puede recuperar tras salir de la página y un trabajo
interrumpido por reinicio se puede repetir. En la ficha se puede abrir la
comparación para fusionar o confirmar con una nota que son personas distintas;
ambas decisiones son humanas. La confirmación de personas distintas crea un
run de auditoría y cierra una revisión viva del par. La ventana de fusión
también ofrece la investigación antes de confirmar.

**Coincidencia alta** usa el puntaje de coincidencia, incluidas las revisiones
creadas manualmente. La recomendación, la evidencia y el motivo explican sus
señales. El puntaje es una ayuda de triaje, no una medición estadística de
identidad.

Sin SearXNG se usan las URL que ya respaldan claims del catálogo. La búsqueda
y las páginas descargadas se guardan en `ingest.person_web_*_cache`.
La caché de páginas se renueva a los 30 días y se vuelve a descargar antes si
contiene caracteres de reemplazo por errores de codificación. Sincopa se lee
con la codificación declarada en la página o con Windows-1252.
Las páginas inaccesibles no cuentan como prueba. No se aplica ninguna propuesta
de DeepSeek automáticamente.

## Prueba de control

`./scripts/with-node22.sh npx tsx scripts/benchmark-person-web-verification.ts`

El conjunto contiene cinco pares separados manualmente, un par que se dejó
en duda y dos fusiones históricas de la run 13285. Las fichas descartadas ya no
existen; los dos controles positivos usan expedientes mínimos congelados con
sus nombres y proyectos de entonces. El informe queda en
`reports/person-web-verification-benchmark-AAAA-MM-DD.json`.

El 6 de octubre de 2026 la prueba revisada dio 5/8: acertó las dos fusiones,
dos pares separados y el par incierto; dejó tres pares separados como «no se
sabe». No hubo fusiones falsas ni separaciones falsas. El sistema sigue siendo una ayuda para la
revisión humana; el resultado no autoriza decisiones automáticas.

## DeepSeek extrae hechos; el código decide (revisión del 6 de octubre)

La primera versión aceptaba la conclusión del modelo si traía citas. En la prueba
difícil DeepSeek flash encontraba buenas citas pero concluía mal (citaba «su padre»
para decir «misma persona»; confundía el artista del disco con la persona). Ahora el
modelo solo extrae citas literales y hechos (nombre completo, nacimiento, muerte,
parentesco, alias) y las reglas deciden sobre el texto guardado:

- **Misma persona:** nombres compatibles (los apellidos de uno caben en los del otro,
  con una errata de una letra o dos letras traspuestas), sin veto de épocas ni cita de
  parentesco, y la web liga el nombre con el proyecto común, o con un proyecto de la
  otra ficha, o una cita une las dos formas del nombre y cada ficha sale con lo suyo.
- **Distintas:** la web liga a cada ficha con sus propios proyectos y hay una
  contradicción: épocas incompatibles, nacimiento posterior a los créditos (menos de
  12 años), apellidos incompatibles, parentesco citado o nombres completos distintos.
- **Pruebas en los dos sentidos:** queda «no se sabe».
- **Ficha mezclada:** grupos con citas verificadas y proyectos reales de la ficha, en
  sitios distintos, con una contradicción (nombres completos, nacimiento, muerte más
  de 3 años antes de los créditos del otro grupo, o parentesco). Si la ficha tiene dos
  épocas sin artista común, o una fecha de nacimiento con créditos imposibles, cada
  lado se investiga como un par; si alguna página liga el nombre con proyectos de los
  dos lados, no se parte (carrera larga, o la fecha es de otro).

Otras correcciones: búsquedas espaciadas y sin cachear resultados vacíos (Bing y
Yahoo activados en SearXNG; DuckDuckGo, Brave y Google CSE suspenden por CAPTCHA);
Metal Archives responde 403 y se usa la copia guardada en `ingest.raw_pages`; las
páginas de banda de Metal Archives de las bandas de la persona entran como fuentes;
los volcados JSON de blogs van al final; se quita el «Gordon 296» de Lobotoradio; una
evidencia mal formada se descarta sin tumbar la respuesta; el texto cortado a mitad de
un emoji ya no rompe el guardado en `ingest.ai_runs`.

## Prueba difícil y validación aparte

`./scripts/with-node22.sh npx tsx scripts/benchmark-person-web-hard.ts` (27 casos) y
`HOLDOUT=1 …` (30 casos que no se usaron para ajustar las reglas). Las fusiones se
reconstruyen desde `ingest.change_journal`; los homónimos son las separaciones de las
runs 18011, 18110 y 18116; las fichas «juntadas» vuelven a unir una separación.
Informes: `reports/person-web-verification-dificil-2026-10-06.json` y
`reports/person-web-verification-validacion-2026-10-06.json`.

Primera medición (mañana del 6 de octubre): difícil 24/28 y validación 23/30, sin errores graves; «distintas»
quedaba en 57 % en la validación.

## Ronda 20/20 (tarde del 6 de octubre)

Reglas nuevas, todas generales (ninguna nombra un caso):

- **Fuentes propias de cada ficha.** Copia local de Metal Archives (`data/raw/metal-archives-ve-2026-10-01`, que
  responde 403 en vivo) ligada por nombre *y* banda; perfiles de Discogs de quien firma los créditos de la ficha
  (`src/ambiguity/discogs-credits.ts`). Discogs junta homónimos en un mismo artista, así que **nunca** prueba que
  dos fichas sean la misma persona ni sirve de puente.
- **Búsqueda.** Primero los resultados que traen todas las frases buscadas (`relevantFirst`), se repite la búsqueda
  si la caché no trae ninguno y tiene más de 6 horas; sin «Venezuela» en las consultas de un proyecto (atraía
  abogados); consulta de edad (colegio, liceo, «con N años») cuando hay 10+ años entre los créditos.
- **Edad.** El código, no el modelo, lee «banda colegial», «estudiantes de bachillerato» o «con 15 años» junto a un
  proyecto de una sola ficha. Solo frases de edad: «lasted 21 years» o «durante 20 años» no son edades.
- **Muerte.** Después de morir solo cuentan créditos que exigen estar vivo (mezcla, producción, grabación, arreglos,
  ser integrante), con un año de gracia: cantar en una recopilación póstuma sí se puede (Héctor Cabrera).
- **Parentesco.** Solo cuenta si la frase (con el título y lo que la página dice justo antes) nombra a **dos**
  personas que se llaman como la ficha: «José Romero Bello… father of Joseito Romero» sí; «Neguito Borjas,
  brother of Heberto Borjas» o «Carlos Nené Quintero con su hermano Jesús Chú Quintero» no.
- **Pariente que firma los créditos.** Si la fuente nombra al pariente con un nombre propio («su hijo José
  (Joseíto Romero)») y otro grupo de créditos está firmado así, la ficha mezcla a los dos (486).
- **Créditos firmados con otro nombre** («Rudy» en un disco de Rudy Márquez, «Hernán Gamboa Jr.» en la ficha del
  padre): esa parte se investiga como otra persona.
- **Seudónimo.** Nombre artístico y nombre real con apellidos distintos se unen si una cita verificada trae los dos
  con una marca de alias («a.k.a.», «conocida como», «nombre artístico», «Real Name»); sin esa cita, apellidos
  distintos siguen siendo prueba de dos personas. «DJ» o «MC» no cuentan como parte del nombre.
- **«Hijo», «Jr.».** Si solo un nombre lo lleva, no se fusiona nunca (Emilio Estefan Jr. es Emilio Estefan, pero el
  nombre no basta para saberlo). Son distintos si una misma frase nombra a los dos por separado («Vocals: Hernán
  Gamboa y Hernán Gamboa Jr.»). Un nombre metido dentro del otro («Juan Vicente Torrealba hijo») no cuenta como
  los dos.
- **Muestra de la ficha.** El modelo ve 40 discos repartidos por toda la carrera, con las membresías y las firmas
  raras siempre dentro (antes eran los 40 más antiguos y el hijo de 2007 nunca aparecía).

Conjuntos (`scripts/benchmark-person-web-hard.ts`): difícil, `HOLDOUT=1` y cuatro **frescos** (`FRESH=1…4`),
cada uno armado después de cerrar las reglas de la ronda anterior y con la verdad confirmada en la web. Los frescos
1 y 2 destaparon errores graves que nadie había visto (DJ Baffa separado de Emidio Falconi, Mayra Martí como
mezclada, Torrealba fusionado con su hijo); se corrigieron con las reglas de seudónimo y de «Hijo», y por eso se
armaron el 3 y el 4. El caso «Joseíto Romero / José Romero» salió de la puntuación: la ficha conservada (486) junta
a padre e hijo, así que «misma» y «distintas» son las dos defendibles.

Resultado final (misma versión del código para los seis conjuntos):

| Conjunto | Aciertos | Misma persona | Distintas | Mezcladas | Una persona | Errores graves |
|---|---|---|---|---|---|---|
| Difícil | 25/27 | 7/7 | 11/12 | 4/5 | 3/3 | 0 |
| Validación | 28/30 | 9/9 | 6/7 | 8/9 | 4/4 | 0 |
| Fresco 1 | 20/21 | 8/9 | 3/3 | 3/3 | 5/5 | 0 |
| Fresco 2 | 15/16 | 5/6 | 2/2 | 2/2 | 6/6 | 0 |
| Fresco 3 | 9/10 | 3/4 | 1/1 | 1/1 | 4/4 | 0 |
| Fresco 4 | 9/10 | 2/2 | 2/2 | 2/3 | 3/3 | 0 |
| **Total** | **106/114 (93 %)** | 34/37 | 25/27 | 20/23 | 25/25 | **0** |

En la primera pasada del fresco 4, que no se había usado para nada, salieron 8/10 sin errores graves. El fallo de
«Iván Velázquez» era la regla de edad («lasted 21 years»), que se corrigió.

Todo lo que falla queda en «no se sabe», nunca en una conclusión equivocada:
- homónimos exactos con solo recopilatorios (Héctor Cabrera);
- un apodo que la web no liga con el disco (Chino Agreda);
- «Alfred Gómez Jr.» = «Alfred Gómez», a propósito, por la regla de «Jr.»;
- los Francisco González que la web no documenta;
- la ficha 8842 de Rafael «Gallo» Velásquez.

Entre corridas, uno o dos casos del difícil oscilan entre acierto y «no se sabe» (Ezequiel Serrano, 486). Ocurre
cuando la caché de búsqueda se renueva o cambia la muestra de discos y el modelo recibe otras páginas. En ninguna
corrida eso produjo un error grave. Sigue siendo una ayuda para revisar: nada se aplica solo.

Hallazgos reales que salieron de las pruebas (sin aplicar):
- 40356 = 40357, el mismo bajista según Metal Archives 933907.
- Héctor Cabrera 11886 = 27255.
- La 486 junta a tres personas: José Romero Bello (1922–1998), Joseíto Romero (guitarra, 1971–1988) y José
  «Cheo» Romero (trombón, Desorden Público).
- La 987 (Rudy Pagliuca) tiene discos de Rudy Márquez.
- La 8842 (Rafael «Gallo» Velásquez, trompetista, m. 2009) tiene grabaciones de 2000–2003 y un diseño de 2014.
- La 7157 (Mario Suárez, cantante) tiene «Recorded & Mixed by» de «Guaco» 1975, probablemente de Mario Suárez Jr.
  (29325); sin confirmar en la web.
- Nombres a corregir: la 8610 se llama «Robert Vilela» y es Robert Vilera; la 7910 se llama «Marshall» y es
  Freddy Cabezas Álvarez («Freddy Marshall»).

## Ronda del 10 de octubre: frescos 5–9

Con «sube el puntaje a 20/20 realista» se armaron cinco conjuntos frescos más, cada uno después de cerrar las
reglas del anterior y con la verdad confirmada en la web antes de correrlo (fuentes en los comentarios de
`scripts/benchmark-person-web-hard.ts`).

Primera pasada de cada fresco, sin haberlo usado para nada:

| Conjunto | Aciertos | Errores graves |
|---|---|---|
| Fresco 5 | 24/30 | 1 (Yordano separado de sí mismo) |
| Fresco 6 | 22/29 | 2 (Lamberti fusionados, Pedro Junco separado) |
| Fresco 7 | 19/26 | 5 (Ilan Chester, Negrito Man, Jarz/Nilz, PTT) |
| Fresco 8 | 14/20 | 0 |
| Fresco 9 | 7/9 | 0 |

En el fresco 8 la primera pasada marcó a Italo Pizzolante como mezclado y la etiqueta decía «una persona». El
verificador tenía razón: la ficha tiene voz y guitarras de Americania de 2009 a 2026 (el compositor murió en
2011), que son de Ítalo Aquiles Pizzolante. Por eso cuenta como 14/20 y no como 13/20.

Reglas nuevas (todas generales, con prueba unitaria que falla sin ellas):
- Nombres de pila que no casan (Lamberti: «Edgar» / «Gabriel "Pepo"») no se fusionan por proyecto común ni por
  lista. Solo vale un puente explícito entre las dos formas; si lo hay, el veto se levanta.
- Puentes explícitos: marca de alias, ampliada con «nacido», «nombre completo», «nickname», etc.; paréntesis o
  comillas («Luis Eduardo Blanco (Negrito Man)»); apodo entre nombre y apellido («Carlos "Nené" Quintero» frente a
  «Nene Quintero»); aposición «Moira Elisa Martínez Álvarez: Mayra Martí»; página titulada con un nombre cuya
  cita da el otro tras «nombre completo:» (Lobotoradio, Ilan Chéster).
- Un nombre de una palabra sin nada en común con el otro («Nilz» / «Jarzen Arcia») no cuenta como compatible.
- Otro segundo nombre no es un tocayo: «Pedro Francisco Lizardo» (el padre) no casa con «Pedro V. Lizardo».
- Parentesco con tocayos: no cuentan las menciones que una marca de alias une al mismo nombre (Boston Rex), ni
  palabras sueltas del propio nombre («di Marzo»).
- «Jr.» separa si una frase nombra a los dos por separado: enumeración, parentesco entre las menciones
  («Ricardo Montaner Jr., …, los hijos del cantante Ricardo Montaner») o etiqueta de crédito («Cuatro: Adelso Paz
  Maracas: Adelso Paz Jr.»). Nombrar dos veces al mismo autor no separa, y Discogs tampoco aquí.
- «Jr.», «hijo» y «junior» son la misma marca: «Adelso Paz Jr.» y «Adelso Paz hijo» no son dos generaciones.
- El apodo entre comillas no tapa el nombre al buscar la liga con un proyecto («Guillermo "Willy" Noya»).

Resultado final con la misma versión del código para los doce conjuntos (medido en un worktree de HEAD con el lector
v3; ver «Pendiente»):

| Conjunto | Aciertos | Misma | Distintas | Mezcladas | Una persona | Errores graves |
|---|---|---|---|---|---|---|
| Difícil | 25/27 | 6/7 | 11/12 | 6/6 | 2/2 | 0 |
| Validación | 27/30 | 9/9 | 6/7 | 7/9 | 4/4 | 0 |
| Fresco 1 | 18/21 | 8/9 | 2/3 | 2/3 | 5/5 | 0 |
| Fresco 2 | 15/16 | 5/6 | 2/2 | 2/2 | 6/6 | 0 |
| Fresco 3 | 9/10 | 3/4 | 1/1 | 1/1 | 4/4 | 0 |
| Fresco 4 | 8/10 | 2/2 | 2/2 | 1/3 | 3/3 | 0 |
| Fresco 5 | 26/30 | 14/15 | 3/4 | 2/4 | 7/7 | 0 |
| Fresco 6 | 22/29 | 13/15 | 2/4 | 0/3 | 7/7 | 0 |
| Fresco 7 | 21/26 | 10/12 | 3/4 | 1/3 | 7/7 | 0 |
| Fresco 8 | 14/20 | 6/9 | 0/1 | 2/4 | 6/6 | 0 |
| Fresco 9 | 7/9 | 3/3 | — | 0/2 | 4/4 | 0 |
| **Total** | **192/228 (84 %)** | 79/91 | 32/40 | 24/40 | 55/55 | **0** |

(Los «dudosos» del fresco 1 y de la validación, 2/2, entran en el total.)

Lo que falla queda en «no se sabe»:
- fichas mezcladas por una fusión equivocada (5900, 3343, 2704, 9280), 24/40 en mezcladas;
- padre e hijo cuando la página escribe distinto el nombre («Williams Sigismondi»);
- «Emilio Estefan Jr.» = «Emilio Estefan», a propósito, por la regla de «Jr.»;
- casos que oscilan entre corridas al renovarse la caché de búsqueda (Luis Arismendi, Daniel Gil).

Hallazgos reales de esta ronda (sin aplicar; confirmar y decidir con Brian):
- 21742 «Juan V. Torrealba» = 4456 Juan Vicente Torrealba.
- 29174 «Pedro Junco» = 20312 Pedro Junco Jr., el mismo compositor de «Nosotros».
- La 3617 (Nené Quintero) tiene la mezcla y masterización de Los Beat3 «¡En Vivo!» (2010), que según el librito
  son de Carlos Kinttero (hippitoysuschatarritas, 2012/09).
- La 1260 (Italo Pizzolante, m. 2011) tiene voz y guitarras de Americania 2009–2026: son de Ítalo Aquiles
  Pizzolante.
- Fusiones equivocadas de la run 13285:
  - 5900 Ezlen Ramos (batería de Hiena) tiene el timple de José Antonio Ramos, el timplista canario;
  - 1701 Luisito Quintero (percusionista) tiene la voz de Luis Quintero «Bosta's Brain» (PapaShanty, La Corte);
  - 3343 Ignacio Pérez (bajista de Ricochet) tiene créditos de Nacho, de Chino & Nacho;
  - 2704 Miguel «El Enano» González (Caramelos de Cianuro) tiene a Rubén «El Enano» Castro (Almas, 2011);
  - 9280 Francisco González (Nauta, n. 1988) tiene los raps de Pipo Ramírez en Huáscar Barradas.

Pendiente: en esta rama el lector de páginas (procedencia v4, de otro frente y sin commit) consulta
`captured_at`/`acquisition_method`, y la migración 0059 no está aplicada en la base de desarrollo. Sin ella, cada
página falla y el verificador decide solo con fragmentos del buscador. La decisión de aplicarla es de ese frente.

### v6 (2026-10-10, noche) y fresco 10

Reglas nuevas, todas generales y con prueba unitaria que falla sin ellas (46 pruebas del verificador):
- **Todas las formas acreditadas ajenas** (`foreignCreditForms`): la búsqueda de mezcla ya no mira solo la forma
  ajena más frecuente. Antes, «Ezlen Ramos» con «José Antonio Ramos» o «Pipo Ramírez» dentro de «Francisco
  González» quedaban tapados por otra forma. Un apodo de una palabra cuenta como ajeno si no casa con ningún
  nombre de pila de la ficha (Chino ≠ Agreda sigue sin contar).
- **Hermanos enumerados**: si una misma frase enumera a dos personas con el mismo apellido y nombres de pila que
  no casan («Edgar y Gabriel Lamberti»), es una contradicción. Solo se levanta con un puente explícito de
  seudónimo.
- **Puentes de seudónimo más amplios**: cuentan el título de la página como nombre («Ilan Chester» + «conocido
  como Ilan»), el apodo intercalado («Carlos "Nené" Quintero») y la aposición con dos puntos («Moira Elisa
  Martínez Álvarez: Mayra Martí»). Con nombres de pila que no casan, solo un puente explícito permite el «same».
- «Hijo», «junior» y «Jr.» son la misma marca de generación.

Medido en el worktree de HEAD (lector v3). El fresco 10 se cerró antes de correrlo y no se tocó después:

| Conjunto | Aciertos | Misma | Distintas | Mezcladas | Una persona | Errores graves |
|---|---|---|---|---|---|---|
| Difícil | 25/27 | 6/7 | 11/12 | 6/6 | 2/2 | 0 |
| Validación | 27/30 | 9/9 | 6/7 | 7/9 | 4/4 | 0 |
| Fresco 1 | 18/21 | 8/9 | 2/3 | 2/3 | 5/5 | 0 |
| Fresco 2 | 15/16 | 5/6 | 2/2 | 2/2 | 6/6 | 0 |
| Fresco 3 | 9/10 | 3/4 | 1/1 | 1/1 | 4/4 | 0 |
| Fresco 4 | 8/10 | 2/2 | 2/2 | 1/3 | 3/3 | 0 |
| Fresco 5 | 26/30 | 14/15 | 3/4 | 2/4 | 7/7 | 0 |
| Fresco 6 | 25/29 | 13/15 | 3/4 | 2/3 | 7/7 | 0 |
| Fresco 7 | 23/26 | 10/12 | 3/4 | 3/3 | 7/7 | 0 |
| Fresco 8 | 14/20 | 6/9 | 0/1 | 2/4 | 6/6 | 0 |
| Fresco 9 | 8/9 | 3/3 | — | 1/2 | 4/4 | 0 |
| Fresco 10 (intacto) | 4/6 | 3/5 | — | — | 1/1 | 0 |
| **Total** | **202/234 (86 %)** | 82/96 | 33/40 | 29/40 | 56/56 | **0** |

(Más los «dudosos», 2/2.)

En el fresco 10 fallan Angie Machado = Ángel Machado y Francisco Tedesco = «Chicho» Tedesco. Las dos quedan en
«no se sabe», y la causa es la búsqueda, no las reglas:
- SearXNG no devuelve la página de salsagoogle que dice el nombre completo de Angie;
- de Tedesco solo hay el mismo nombre con dos bandas en páginas distintas, y eso el verificador no acepta como
  prueba, a propósito (Discogs y los homónimos).

No se agregó una regla de «mismo nombre, mismo instrumento, misma época», porque produciría fusiones falsas (caso
Víctor Valerio).

Decisión mantenida: **no** separar solo porque el nombre de pila es distinto. Separaría a Nené = Carlos y a Willy
= Guillermo.

### v7–v8 (2026-10-11) y fresco 11

Tres reglas generales más, cada una con una prueba que falla sin ella (49 pruebas del verificador):
- **Listas con otros nombres en medio**: «Juan Vicente Torrealba, Douglas T. Mardonio Tortolero, Henry Rubio & Juan
  Vicente Torrealba Jr.» enumera a dos personas. Cuenta si entre los dos nombres solo hay separadores y nombres
  cortos. Además, la inicial casa con el nombre completo («Juan V.» = «Juan Vicente»), y el punto de una inicial ya
  no corta la frase.
- **Apodo con letras sueltas**: en «Jesús «G-zaz» Romero», el apodo se compara tal cual se escribe; antes la «g»
  se perdía y no se reconocía el puente.
- **Forma compartida**: si un nombre es el otro más un apodo o un segundo nombre («Manuel Diquez» / «Manuel "Manny"
  Diquez»), una página que no sea de Discogs y nombre esa forma con los proyectos de las dos fichas une las fichas.
  Son las mismas exigencias que con un nombre idéntico: que el modelo diga «same» y que haya dos sitios.

Revisado y no cambiado:
- Mandingo: su perfil dice «Father of Felipe Rengifo Jr.», así que el veto por parentesco es correcto.
- Calavén: osciló porque esta vez el modelo citó «Yánez» con «z». Una letra distinta en el apellido no se acepta, por
  la misma regla de Greco/Grego.
- Vladimir Peña: el nombre está lejos del proyecto y el título de la página trae una errata.
- René Toledo / René L. Toledo: sin la inicial, los nombres son idénticos y comparten proyecto. Con un nombre
  idéntico el proyecto común no aporta nada nuevo y Discogs junta homónimos, así que queda en «no se sabe».

| Conjunto | v6 | v8 |
|---|---|---|
| Difícil | 25/27 | 25/27 |
| Validación | 27/30 | 27/30 |
| Fresco 1–4 | 50/57 | 50/57 |
| Fresco 5 | 26/30 | 25/30 (Calavén, variación) |
| Fresco 6 | 25/29 | 27/29 |
| Fresco 7 | 23/26 | 24/26 |
| Fresco 8 | 14/20 | 14/20 |
| Fresco 9 | 8/9 | 8/9 |
| Fresco 10 | 4/6 | 4/6 |
| Fresco 11 (intacto, nuevo) | — | 4/5 |
| **Total** | **202/234** | **208/239 (87 %)**, **0 errores graves** |

Medido en el worktree de HEAD. Otra sesión dejó en este archivo la consulta a `birth_date_value` (migración 0061, sin
aplicar); para medir, en el worktree se usó la consulta de HEAD. No se aplicó ninguna migración.

### v9–v11 (2026-10-11): búsqueda y puentes, y un error grave encontrado y corregido

Mejoras generales, cada una con una prueba que falla sin ella (53 pruebas del verificador):
- **Búsqueda con las dos formas juntas** (`combinedName`): «Guillermo Noya» + «Willy Noya» → «Guillermo Willy Noya»,
  que encuentra «Guillermo “Willy” Noya». Va primero el nombre de pila y después el diminutivo. No se arma para
  hermanos («Edgar» + «Gabriel "Pepo"» Lamberti), para generaciones distintas ni para nombres que ya se buscan.
- **Resultados con las dos formas, primero**: un resultado cuyo título o resumen nombra las dos formas («Ángel
  "Angie" Machado» en AllMusic) se lee antes. Si la página no se puede leer, se guarda su resumen del buscador.
- **«credited as», «acreditado como», «nombre de pila», «nombre de nacimiento» y «nombre de bautizo»** son marcas
  de alias.
- **Puente por título más amplio**: el título puede contener el nombre («Murió el cantante Al Zeppy a los 80 años»),
  no solo empezar por él, y vale también el orden «Alberto Lewis, su nombre de pila».
- **El colegio como lugar no es edad**: «Setlist at Teatro del Colegio Santa Rosa de Lima» ya no lleva a
  «no pudo nacer antes de 2005» (caso Gavidia).
- **Error grave de la v10**: «Al Zeppy / Alberto Lewis» salió «distintos» por «apellidos distintos en las fichas».
  Esta vez el modelo no citó el puente, aunque la página decía «Su nombre de pila es Alberto Lewis». Corrección,
  que solo evita separar: si una página nombra las dos formas a menos de 250 caracteres y con una marca de alias,
  «apellidos distintos» no cuenta como contradicción.

| Conjunto | v8 | v11 |
|---|---|---|
| Difícil | 25/27 | 25/27 |
| Validación | 27/30 | 27/30 |
| Fresco 1–4 | 50/57 | 50/57 |
| Fresco 5 | 25/30 | 26/30 |
| Fresco 6 | 27/29 | 27/29 |
| Fresco 7 | 24/26 | 25/26 |
| Fresco 8 | 14/20 | 14/20 |
| Fresco 9 | 8/9 | 8/9 |
| Fresco 10 | 4/6 | 6/6 |
| Fresco 11 | 4/5 | 4/5 |
| Fresco 12 (intacto, nombres artísticos) | — | 4/4 |
| **Total** | **208/239** | **216/243 (89 %)**, **0 errores graves** |

Lección: la variación entre corridas (qué citas elige el modelo, qué páginas trae el buscador) puede destapar
errores graves que una sola corrida no muestra. Las reglas que separan no deben depender de que el modelo cite el
puente: miran también la página.

**Decisión de Brian (2026-10-11): la meta se cierra en 18/20.** Se mantienen las dos protecciones: los pares «X» /
«X Jr.» quedan en «no se sabe», y entre nombres idénticos (o iguales salvo una inicial) el proyecto común no basta
para unir. El verificador queda como ayuda que solo propone para revisión manual: 0 errores graves, alrededor del
88 % de casos decididos.

### v12 (2026-10-11, tarde): en vivo

Para ponerlo en marcha se ensayó sobre una copia restaurada del respaldo de la noche del 10: las migraciones
0058–0062 entraron en 11 s, el doctor quedó en verde y la API respondió con el código actual. Sin ellas, cualquier
reinicio de la API dejaba `/persons`, `/artists` y `/albums` en error 500. Con el visto bueno de Brian se aplicaron
en la base de desarrollo y se reiniciaron crv-api y crv-web.

El verificador corrió sin parches sobre esa copia, y fresco 12 destapó otro **error grave**: «Nano Grand / Octavio
Palacios» salió «distintos» por «apellidos distintos en las fichas». En esa corrida no apareció la página con
«conocido artísticamente como», pero otras decían «Voz: Octavio Palacios "Nano Grand"». Corrección, que solo evita
separar: un puente explícito en cualquier página (el nombre real con el artístico entre comillas o paréntesis)
también impide usar «apellidos distintos» como contradicción. Hay una prueba que falla sin la corrección (54
pruebas del verificador).

| Conjunto | v11 | v12 (copia migrada) |
|---|---|---|
| Difícil | 25/27 | 26/27 |
| Validación | 27/30 | 28/30 |
| Fresco 1–4 | 50/57 | 53/57 |
| Fresco 5 | 26/30 | 27/30 |
| Fresco 6 | 27/29 | 28/29 |
| Fresco 7 | 25/26 | 24/26 |
| Fresco 8 | 14/20 | 13/20 |
| Fresco 9 | 8/9 | 8/9 |
| Fresco 10 | 6/6 | 6/6 |
| Fresco 11 | 4/5 | 4/5 |
| Fresco 12 | 4/4 | 4/4 |
| **Total** | **216/243** | **221/243 (91 %)**, **0 errores graves** |

Los informes de esta corrida están en `reports/person-web-verification-v12-2026-10-11/`.
