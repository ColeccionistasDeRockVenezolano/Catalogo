# Instrucciones compartidas del proyecto

@AGENTS.md
@docs/SHARED_STORAGE.md

Las capturas y los resultados, incluidos los informes antes versionados,
viven en `/mnt/1tb/Shared/coleccionistas-rock-venezolano`. Comprobar el almacén
con `python3 scripts/shared-storage.py status` antes de escribir datos.
Las capturas nuevas se escriben en el staging del SSD (`$HOME/crv-staging`) y
se publican al almacén con `python3 scripts/staging.py publish`; no capturar
directamente sobre los enlaces del HDD.
