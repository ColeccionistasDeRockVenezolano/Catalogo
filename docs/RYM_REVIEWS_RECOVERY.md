# Reviews RYM: control de integridad y sesiones (2026-10-21)

La cola antigua está retirada. No se puede dar una campaña por completa por
cantidad de archivos, HTTP 200 ni por título/URL canónica: hay respuestas con
cabecera del lanzamiento solicitado y reseñas/paginación de otros lanzamientos.
Los originales se conservan; esta corrección no escribe en PostgreSQL.

## Sesiones documentadas por Hermes y comprobadas

Se revisaron las skills locales de Hermes:

- `~/.hermes/skills/devops/browser-session-capture/SKILL.md`:
  Chrome propio, perfil copiado del dueño, headed, CDP `:9333`;
  comprobar sesión en la página, no por mera existencia de cookies.
- `~/.hermes/skills/devops/real-browser-bridge/SKILL.md`:
  Firefox normal, sin WebDriver/Marionette, extensión MV2 y servidor `:8899`;
  comprobar `/salud` y latido real antes de pedir `/pagina`.
- `~/.hermes/skills/software-development/crv-coleccionistas/references/rym-puente-navegador-real.md`:
  `humano.sh`, perfil `~/.cache/crv-rym-humano`, escritorio real `:0`;
  arrancar servidor antes del navegador; conservar el sobre y URL final.
- `~/.hermes/skills/software-development/crv-coleccionistas/references/rym-reviews-captura-cdp.md`:
  mediciones históricas de 10–11,7 páginas **por minuto**, dos pestañas,
  hueco global de 5–7 segundos. Contiene afirmaciones de cierre y alcance
  que la auditoría actual NO confirma.

La cookie de Firefox no mantiene automáticamente la sesión de Chrome. El keeper
es otro Firefox; el controlador usa directamente el puente del perfil humano.
No se trasplanta la clearance entre motores. La prueba inicial con Selenium fue
descartada: no reproducía el método documentado. También se observó contenido
mezclado en la prueba del Firefox normal. La causa de esas respuestas sigue sin
estar establecida; no atribuirla a un bloqueo deliberado sin más evidencia.

## Alcance y validación

`scripts/rym-reviews-repair.py` prepara una cola nueva en SSD, fija hashes de
las fuentes y conserva una lista explícita de identidades pendientes. Requiere
repertorio distintivo compartido, candidato único y nacimiento/formación en
Venezuela en el HTML original, o reintegro documentado expresamente autorizado.
El país registrado en nuestra base no basta: Propaganda figura como Venezuela,
pero su fuente RYM indica Düsseldorf, Alemania. Los compilados no heredan
nacionalidad de la etiqueta genérica Various Artists.

El parser estructural conserva autor/fecha aunque haya atributos adicionales y
texto con etiquetas anidadas. La validación exige URL final, canónica,
paginación y enlaces de las reseñas coherentes con el lanzamiento. Los alias de
edición/artista requieren evidencia explícita; un rechazo por diferencia de slug
puede requerir revisión, no prueba por sí solo que la página sea falsa.

Los errores, páginas vacías sin evidencia y duplicados entre páginas quedan
pendientes. Las subpáginas se descubren únicamente en paginación validada del
mismo lanzamiento. Nunca se crean discos ni pistas a partir de reseñas o videos.

## Operación

Brian confirmó el objetivo de **8–10 páginas por segundo en total**. El límite
compartido se configura a 9/s entre Chrome y Mozilla; no es una afirmación del
rendimiento conseguido. Se aumenta la concurrencia de Chrome después de tres
capturas válidas; cada navegador pausa y reintenta al fallar. El tablero muestra
el ritmo de páginas aceptadas separado del objetivo y de los rechazos.

- Controlador: `scripts/rym-reviews-control.py`.
- Unidad: `crv-rym-reviews-control.service` (plantilla en `ops/rym-reviews/systemd`).
- Navegadores: `crv-rym-chrome` y `crv-rym-humano`.
- Estado durante la corrida:
  `~/crv-staging/data/raw/rym-reviews-control-2026-10-21/controller-state.json`.
- Tablero existente: `/tmp/crv-recon/extraccion-2026-10-16.html`, secciones 8–9.
- Registros: `journalctl --user -u crv-rym-reviews-control.service`.
- Detener: `systemctl --user stop crv-rym-reviews-control.service`.

Todo se escribe en staging SSD. Al cerrar, `ExecStopPost` publica la campaña en
el almacén con verificación SHA-256. La primera auditoría y las sondas iniciales
ya se publicaron como `data/raw/rym-reviews-correctas-2026-10-21/`.
La siguiente corrida usa otro nombre: no se sobrescribe una campaña publicada.
`KillMode=mixed` permite que el controlador cierre sus clientes y escriba los
pendientes antes de terminar sus procesos auxiliares.

Las unidades antiguas están deshabilitadas y `bajar.sh` rechaza su relanzamiento.
No usar su `reviews.jsonl` para ingerir datos: el consolidado nuevo contiene solo
páginas que pasaron la validación y el alcance documentado.

## Verificación

```
~/.venvs/scrapling/bin/python -m unittest discover -s test/python -p 'test_rym_reviews_*.py' -v
python3 -m py_compile scripts/rym-reviews-control.py scripts/rym-reviews-repair.py scripts/rym_reviews_parse.py scripts/rym_reviews_validate.py
node --check ops/rym-resto/puente-ext/bg.js
```

Las pruebas incluyen cabecera correcta con reseñas ajenas, paginación de otro
disco, texto anidado, metadatos, redirección, páginas vacías y cierre reanudable
cuando el cliente del navegador ya se ha desconectado.
