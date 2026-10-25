# Instrucciones compartidas del proyecto

Seguir [AGENTS.md](AGENTS.md) y leer
[docs/SHARED_STORAGE.md](docs/SHARED_STORAGE.md) antes de trabajar con capturas.
El almacén es `/mnt/1tb/Shared/coleccionistas-rock-venezolano`; los enlaces del
proyecto conservan las rutas usadas por los scripts. Ejecutar
`python3 scripts/shared-storage.py status` antes de escribir datos.
El traslado de informes versionados fue autorizado expresamente por Brian.
Las capturas nuevas van al staging del SSD (`$HOME/crv-staging`) y se publican
al almacén con `python3 scripts/staging.py publish`; no capturar sobre el HDD.
