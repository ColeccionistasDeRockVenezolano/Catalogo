# Variantes WebP de las imágenes del catálogo

El gateway (`web/server.mjs`) sirve `/crv/media/…?w=160|320|640|1200` desde
`web/.media-variants`. Si la copia aún no existe entrega el **original** (más
pesado, `max-age=300`) y la encarga al optimizador de BrandForge. Este timer
genera cada día lo que falte, para que ninguna visita pague el original.

**No está instalado** (2026-11-08): instalar un timer persistente requiere la
aprobación de Brian. Para activarlo:

```bash
cp ops/media-variantes/crv-media-variants-diario.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now crv-media-variants-diario.timer
# a mano, sin esperar al timer:
systemctl --user start crv-media-variants-diario.service
```

Límites: 2 núcleos, `nice 19`, E/S ociosa, 1,5 GB. Se puede relanzar: solo
genera lo que falta o quedó más viejo que su original
(`node web/scripts/media-variants.mjs --dry-run` cuenta lo pendiente).

El 2026-11-08 se generaron a mano las ~66.000 copias que faltaban (16.500
originales × 4 anchos) con estos mismos límites (`systemd-run --user`), en ~1 h 45 min:
51.021 copias al día y 0 pendientes en los cuatro anchos; `web/.media-variants`
ocupa 4,0 GB en el SSD.

Dos originales (`artist/4267.jpg` y uno de antologiavenezuela) fallaban con
«No data found for frame»: son JPEG de cámara con varias imágenes (MPO) y el
optimizador de BrandForge los trataba como animación. Se corrigió en
`~/apps/brandforge/backend/app/optimize.py` (`_open` usa el primer cuadro como JPEG;
copia previa en `optimize.py.antes-mpo-20261108`; BrandForge no está en Git).
