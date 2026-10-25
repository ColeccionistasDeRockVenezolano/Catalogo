# Sellos y créditos de la captura AOTY

`scripts/aoty-labels-credits.ts` aprovecha la captura publicada en
`data/raw/aoty-2026-10-19`. Brian autorizó su incorporación el 2026-10-22.

El plan exige artista y título exactos y únicos, año de edición coincidente y
una vinculación del artista documentada por claims AOTY aceptados previamente.
No elimina paréntesis, sufijos ni distinciones de edición para encontrar fichas.

## Sellos

Solo rellena `albums.label_id` vacío. El nombre debe venir con un enlace
individual de sello AOTY y corresponder a una organización `record_label`
existente. Las abreviaturas pueden resolverse por al menos dos discos de la
misma edición que documenten un único sello existente. No usa aliases
corporativos genéricos, no crea sellos y no elige uno de una cadena compuesta.
`No Label` y otras indicaciones de autoedición no crean organizaciones.

## Créditos

Lee `albums.jsonl → credits.full`, conserva los roles originales y omite
`Primary`, que solo repite la titularidad del lanzamiento. `Feature` se
clasifica como invitado y `Songwriter` como escritor; los demás roles pasan
por el clasificador del motor de relaciones.

Los proyectos se identifican por su URL AOTY previamente vinculada al catálogo.
Los roles de un solista se atribuyen a su persona titular cuando existe una
única relación documentada; `Feature` conserva el proyecto acreditado.
Para otras personas exige nombre único y créditos o membresía previos en el
contexto del artista. Las identidades nuevas o ambiguas quedan en el informe.
La deduplicación utiliza el acreditado, disco, tipo y equivalencia de rol del
motor. No crea pistas ni integrantes.

## Ejecución

```bash
python3 scripts/shared-storage.py status
python3 scripts/staging.py new reports aoty-sellos-creditos-AAAA-MM-DD
# Usar la ruta SSD que imprime staging.py:
npm exec -- tsx scripts/aoty-labels-credits.ts --report=/home/brian/crv-staging/reports/aoty-sellos-creditos-AAAA-MM-DD/plan.json
npm exec -- tsx scripts/aoty-labels-credits.ts --rehearse --report=/home/brian/crv-staging/reports/aoty-sellos-creditos-AAAA-MM-DD/ensayo.json
npm exec -- tsx scripts/aoty-labels-credits.ts --confirm --report=/home/brian/crv-staging/reports/aoty-sellos-creditos-AAAA-MM-DD/aplicacion.json
python3 scripts/staging.py publish reports aoty-sellos-creditos-AAAA-MM-DD --hash
```

Sin `--confirm` ni `--rehearse` solo consulta. El ensayo usa el motor real y
revierte la transacción completa, incluido el run; puede consumir valores de
secuencias PostgreSQL. La aplicación es una transacción con bloqueo de campaña,
claims atribuidos a AOTY, evidencias originales y auditoría del motor. Revisa
de nuevo que los campos de sello estén vacíos antes de escribir. El run se
guarda en el informe y puede revertirse mediante `crv runs undo`.

La aplicación invalida la caché mediante el marcador común del catálogo.
Una segunda previsualización comprueba que no queden cambios repetibles.
