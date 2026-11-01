# Participaciones documentadas en RHV

La captura de una ficha no garantiza que sus recopilatorios y músicos estén
vinculados al catálogo. La importación del 25 de octubre de 2026 dejó 561
referencias a recopilatorios sin resolver y 48 canciones sin coincidencia.
Esas cifras describen el informe histórico, no los pendientes actuales.

`scripts/recover-rhv-appearances.mts` vuelve a contrastar las 511 fichas
preservadas con el catálogo actual. El modo predeterminado solo genera un
plan; `--rehearse` ensaya las escrituras y revierte la transacción;
`--confirm` aplica un run del operador con diario y evidencia de fuente.
El directorio de salida debe estar en el staging SSD descrito en
[SHARED_STORAGE.md](SHARED_STORAGE.md), y la campaña debe publicarse al cerrar.

La resolución usa la URL de evidencia del artista y los nombres documentados.
Para discos, compara título y año. Un título abreviado solo se reconoce cuando
hay un único candidato de Various Artists, coincide el año y todas las
canciones citadas coinciden sin ambigüedad con pistas acreditadas al artista o
con su nombre exacto como prefijo. Los otros casos quedan en revisión.
Nunca reasigna un disco de otro titular ni sobrescribe un año discrepante.

Las canciones citadas sin posiciones se conservan en un claim aceptado
`album_credit.documented_tracks`: un array JSON de títulos, asociado mediante
`album_credit_id` al crédito de intérprete, con URL y extracto en
`ingest.claim_evidence`. Este campo **no crea pistas, no inventa posiciones y
no afirma que sea el tracklist completo**. «Aparece en» une esos títulos a las
pistas acreditadas, conservando primero el orden conocido del catálogo.
Solo lee claims aceptados de créditos interpretativos del mismo artista.

Los prefijos de artista solo se retiran si coinciden con el nombre o alias
documentado completo. Las repeticiones no se asignan por preferencia. El
importador original también reconoce esos prefijos y los alias de álbum
contrastados, para que no reaparezca el fallo en nuevas ejecuciones.

Las membresías biográficas se recuperan cuando el nombre de la persona y su
instrumento coinciden con créditos de la discografía documentada de la banda.
No se crean ni fusionan personas por nombre. No se deducen fechas de ingreso,
salida ni vigencia actual. Las menciones explícitas de colaboración o invitación
no se convierten en membresías.

El contraste adicional de Metalkinesia Caracas usa la lista publicada por
Napoleón Sánchez / Prensa Cerebros Exprimidos el 16 de septiembre de 2019:
`https://cerebrosexprimidos.com.ve/metalkinesia-9/`. El script
`scripts/recover-metalkinesia-caracas.mts` exige coincidencia de posición,
título, duración e identidad antes de acreditar una pista existente.

Los runs, planes, capturas, portadas y resultados de la recuperación se
conservan en `reports/rhv-participaciones-2026-10-29` y
`web/public/media/rhv-participaciones-2026-10-29`. Los casos ambiguos quedan
en la Mesa de Cotejo con una clave estable para evitar duplicarlos al repetir.

El corte de 923 incidencias se cerró en la campaña
`reports/rhv-cierre-incidencias-2026-10-29`: 84 corregidas, 142 ya registradas,
14 falsos positivos y 683 no verificables con las fuentes consultadas.
«No verificable» termina esta investigación y conserva la afirmación y sus
fuentes; no significa que la afirmación sea falsa. La ficha pública no recibe
las atribuciones que siguen sin establecerse.

`src/review/evidence-closure.ts` conserva el veredicto explícito, citas,
búsquedas, huella de la evidencia y run en `payload.rhvClosure`. Antes de
escribir exige que el payload no haya cambiado desde el cotejo. Los cierres
son idempotentes y los importadores no vuelven a abrirlos por repetir la
misma captura o corregir una frase introductoria del parser. Un cambio
relevante de la biografía o de las entradas discográficas permite reabrirlos,
conservando la decisión anterior. Una página con varias ediciones del mismo
título se coteja completa: confirmar una edición no resuelve las demás.

Los scripts `close-rhv-review-cases.mts` y
`localize-rhv-closure-covers.mts` ensayan con rollback salvo `--confirm`.
`verify-rhv-closure.mts` comprueba en lectura el corte, los hashes, los
recibos de búsqueda y los destinos de las membresías y créditos. Las
carátulas nuevas se capturan en staging, se publican con SHA-256 y sólo
entonces se enlazan en el catálogo.
