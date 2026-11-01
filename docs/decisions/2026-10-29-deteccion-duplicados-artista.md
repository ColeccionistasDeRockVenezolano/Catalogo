# Detección de duplicados de artista por capas

Una ficha de artista se puede duplicar sin que el nombre coincida: «Kámara de
Tortura» (3230) y «La Kámara De la Tortura» (8576) escriben el nombre con un
conector de más, y el ER —que solo compara claves exactas de nombre, sin
artículo y compacta— no llega a carearlas. La identidad está en el resto de los
datos: el mismo disco *Vampiro* (2003) con las mismas 8 pistas, los mismos dos
músicos de la reunión, la misma foto y la misma página de evidencia de Rock
Hecho en Venezuela. El detector nuevo (`src/review/artist-candidates.ts`) mide
esas vías por capas y **propone, no decide**: solo escribe en
`ingest.review_queue` y nunca fusiona.

## Capas

- **Capa 0 — guardas.** No se compara «Various Artists»; no se repite el par
  con el mismo nombre canónico (lo resuelve `crv review duplicates`); y no se
  propone un par con ciudades distintas, separado por ≥15 años y sin ninguna
  ancla documental (disco, pista, integrante, página o ID externo).
- **Capa 1 — deterministas.** La misma página de evidencia cuando la comparten
  exactamente dos fichas (una página de directorio con 3+ no es señal), la
  misma cuenta oficial de red o plataforma a nivel de artista (si la comparten
  3+ fichas se trata como cuenta de plataforma, no como identidad), el mismo ID
  externo verificado, la misma huella de tracklist (discos de ≥3 pistas, sin
  recopilatorios), la misma foto (sha256 del archivo local o nombre
  direccionado por contenido) y un alias que ya pertenece a la otra ficha.
  Cada una basta para abrir una revisión; ninguna autoriza una fusión.
- **Capa 2 — probabilísticas.** Contención de tokens sin conectores,
  Jaro-Winkler contra nombre y alias, clave fonética española (K/C, B/V, S/Z, H
  muda), solapamiento de discografía y de integrantes por **nombre normalizado
  + instrumento**, nunca por `person_id` (el mismo músico también puede estar
  duplicado en `persons`; para eso está `crv review person-candidates`). Suma
  también ciudad y año de formación; resta país y tipo de artista distintos.
- **Capa 3 — evidencia.** `--compare-top=N` pide al comparador que ya existe
  (`startComparison`, informes en `ingest.entity_comparison_reports`) el
  informe conjunto del top del lote. Es opt-in porque consume investigación.

## Umbrales y cola

El mínimo es 0,45; 0,60 marca prioridad alta. La cola ordena por prioridad
descendente: 8 si hay señal determinista (severidad alta en Curaduría), 6 si el
score llega a 0,60 y 4 el resto. Un par cerrado como `dismissed` («son
distintas») no vuelve a proponerse, y una revisión viva no se duplica gracias al
índice parcial `review_queue_artist_duplicate_live_uk` (migración 0115). Los
pares aparecen en Curaduría · Fichas repetidas con sus dos fichas; la fusión
sigue siendo el flujo auditado de `GET /artists/:id/merge-preview` +
`POST /artists/:id/merge`.

## Fusión asistida por la IA del catálogo

`crv review artist-merge` toma los pares del detector, arma un dosier con los
hechos de ambas fichas (nombre, alias, origen, fechas, integrantes, discografía,
audiovisuales, enlaces y señales) y pide a DeepSeek —la IA del catálogo— un
veredicto: `same_identity`, `related`, `distinct` o `needs_human`, con hechos
citados, huecos de datos y dudas de identidad separados. La IA propone; el
código dispone: solo fusiona con confianza ≥ 0,90, dos hechos de identidad
citados, ningún hecho en contra, ninguna duda de identidad, una señal
determinista y nombres sin desambiguadores incompatibles. Lo demás queda en la
cola o se descarta con nota.

La fusión usa el mismo camino auditado de la API (`mergeEntities`): conserva el
nombre del duplicado como alias, une los textos largos y los marca para que la
IA los reescriba, mueve todas las referencias (discos, integrantes,
audiovisuales, galería, documentos, claims) y deja `merge_audit` para deshacer.
Antes y después compara integrantes, discos, audiovisuales, alias y fechas: si
falta algo, deshace el run y lo informa. La biografía unida se reescribe con la
IA en el momento (`rewritePending`); si falla, el texto queda unido y pendiente,
nunca perdido.

```bash
crv review artist-merge                      # solo clasifica (sin escribir)
crv review artist-merge --limit=20 --confirm --note="fusión asistida por IA"
crv review artist-merge --confirm --note="barrido completo" --concurrency=4
crv review artist-merge --keep-reviews       # no descarta los «distintos»
crv review artist-merge --no-rewrite         # fusiona sin reescribir biografías
crv review artist-merge --from-reviews --confirm --note="reanudar"  # pares ya en cola
crv review artist-merge --pair=3230:8576 --confirm --note="caso señalado"
```

Tras una fusión pueden quedar dos copias del mismo disco bajo el artista que
queda. `scripts/dedupe-albums-after-artist-merge.ts --since=<ISO> --confirm` une
solo los discos con la MISMA lista de pistas, mismo título y año y sin formatos
ni catálogos en conflicto (los títulos que quedan vacíos al normalizar, como
«@@@@@» y «^^^^^», nunca se tocan).

Los pares que la IA separa se cierran como `dismissed` y no vuelven a
proponerse; los dudosos quedan abiertos para una persona.

## Lecciones que quedaron en la política de la IA

- **Proyecto ≠ alias.** Nuuro y Arca son dos proyectos de Alejandra Ghersi con
  discografía propia: fichas distintas relacionadas como `successor`, nunca una
  absorbida como alias aunque compartan persona, cuentas y alias cruzado.
- **Desambiguador = homónimo.** «Necrosis» y «Necrosis (Zulia)», «Los Clippers»
  y «Los Clippers (1962)»: el paréntesis separa fichas; no se fusionan.
- **Variante de escritura = misma ficha.** Kámara/La Kámara, Alto Pana/Altopana,
  StormThrash/Stormtrash, Quince y Ultimo/15 y Ultimo: misma banda.
- **Página compartida:** exactamente dos fichas es señal; tres o más es un
  directorio o plataforma y no prueba identidad.
- **Cuenta oficial compartida:** puede ser de la persona y agrupar proyectos
  distintos; pesa, pero no decide sola.
- **Tracklist o portada iguales:** prueban la obra o la edición (reedición,
  homenaje, versión), no siempre al artista.
- **Sin ancla documental**, ciudades o épocas incompatibles mantienen las fichas
  separadas; un año desconocido queda nulo.
- **Al fusionar** se conservan alias, integrantes con rol y período, discos,
  audiovisuales y fechas; los textos se unen y se reescriben, y un año
  incompatible se anota en notas en vez de imponerlo.

Estas reglas viven en `EDITORIAL_POLICY_INSTRUCTIONS`
(`src/curation/editorial-policy.ts`, v2) y en `ARTIST_MERGE_INSTRUCTIONS`
(`src/review/artist-merge.ts`), que es lo que lee la IA del catálogo.

## Uso

```bash
crv review artist-candidates                       # previsualización
crv review artist-candidates --confirm --note="barrido de duplicados"
crv review artist-candidates --min-score=0.6 --limit=50 --confirm --note="solo fuertes"
crv review artist-candidates --confirm --note="barrido + informe" --compare-top=3
```

Pruebas: `test/unit/artist-candidates.test.ts` (puntuación y guardas) y
`test/contract/artist-candidates.test.ts` (PostgreSQL, idempotencia, descarte).
