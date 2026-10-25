# Portadas recortadas de las miniaturas de YouTube

`scripts/thumbnails-covers.py` procesa las miniaturas de la plantilla 1280x720:

- **portada**: recuadro fijo `(64,71)-(553,561)` → 489x490. Se recorta tal cual; si la
  imagen no es 1280x720 el recuadro se escala proporcionalmente. El píxel `x=63` es la
  columna de mezcla (antialias) entre el fondo y la portada: incluirla dejaba una línea
  oscura de 1 px en el borde izquierdo, así que se empieza en 64.
- **textos**: tres líneas a la derecha, en franjas verticales fijas
  (álbum ≈ y240, banda ≈ y330, disquera ≈ y388). Las franjas se localizan por nitidez
  (el fondo está desenfocado) y cada una se lee con Tesseract `spa` probando dos
  preprocesos (`plain` y paso alto) y dos `psm`, quedándose con la lectura de mayor
  confianza.
- **vínculo con la hoja**: el número del nombre del archivo (`17_.png` → 17) se busca en
  la columna A; esa fila es la vinculada y la disquera leída se escribe en su columna D.

## Uso

```bash
# prueba con tres imágenes, sin escribir en la hoja
python3 scripts/thumbnails-covers.py --images ~/Desktop/Thumbnails --out ~/crv-thumbnail-covers --numbers 1,2,3

# todas (≈1 s por imagen)
python3 scripts/thumbnails-covers.py --images ~/Desktop/Thumbnails --out ~/crv-thumbnail-covers

# escribir la columna D (cuenta de servicio; ya compartida como Editor en la hoja)
export GOOGLE_APPLICATION_CREDENTIALS=/home/brian/apps/herra-instances/herra-crv/secrets/service-account-radio-sheet.json
~/.venvs/crv-thumbs/bin/python scripts/thumbnails-covers.py \
  --images ~/Desktop/Thumbnails --out ~/crv-thumbnail-covers --write

# reescribir la hoja desde un manifiesto ya generado, sin re-OCR (segundos)
~/.venvs/crv-thumbs/bin/python scripts/thumbnails-covers.py \
  --from-manifest ~/crv-thumbnail-covers/manifest.csv --write
```

La cuenta de servicio es `crv-radio-sheet@diesel-environs-328120.iam.gserviceaccount.com`,
la misma que usa el `radio:export` de las 04:00. La escritura va en un solo
`values.batchUpdate` por bloques de filas consecutivas (sin límite de cuota por celda)
y por defecto **no pisa** una D que ya tenga valor: usa `--overwrite` para eso.

Salidas en `--out`: una carpeta `banda - álbum/cover.png` por imagen, `manifest.csv`
(OCR, valores de la hoja, similitudes, estado y notas) y `columna-d.tsv` con una línea
por fila desde D2, para pegar el bloque completo en la hoja de una sola vez.

## Reglas y avisos

- El nombre de la carpeta usa la ortografía de la hoja (`--names sheet`, por defecto),
  porque el OCR trunca títulos largos; `--names ocr` usa lo leído de la imagen.
  Cuando OCR y hoja difieren con similitud < 0,75 la fila queda anotada en `notes`.
- Miniaturas «a sangre» (sin recuadro de portada, con el título sobre el arte) se
  marcan como `sin portada` y no se recortan: son otro formato, no un fallo.
- `--overwrite` sólo hace falta para pisar una D que ya tenga valor.
