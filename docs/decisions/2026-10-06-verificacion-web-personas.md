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
