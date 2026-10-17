# Estrategia para encontrar los artistas venezolanos que faltan

Medido el 2026-10-17 contra el catálogo vivo y las capturas en disco.

## Dónde estamos

- RYM: **122 páginas de ciudad capturadas**; en ellas se ven **176 locations de Venezuela**,
  de las que **69 no tienen página capturada** (incluye variantes de nombre de la misma ciudad).
- Fichas de artista RYM en disco (para leer discografía): **12355**.
- De la auditoría de 950 fichas: 722 venezolanas → **459 con discografía legible**; de ellas **32 no son el catálogo** · 52 por resolver · 449 apartadas por duplicado · 189 sin discografía verificable.
- Catálogo: **4781 artistas**, de los que 2198 tienen ciudad y el resto no.

## Hueco 1 · Ciudades de RYM sin capturar (lo más barato)

Las páginas de ciudad se pueden capturar sin cuenta y traen, por artista: ciudad, año, alineación y «Member of».
Faltan estas locations (las 40 con más enlaces vistos):

- /location/Caracas/Distrito%20Federal/Venezuela — 906 enlaces
- /location/Barinas/Barinas/Venezuela — 190 enlaces
- /location/Caracas/Miranda/Venezuela — 82 enlaces
- /location/Cúa/Miranda/Venezuela — 80 enlaces
- /location/Maturin/Monagas/Venezuela — 64 enlaces
- /location/Caracas/Caracas/Venezuela — 61 enlaces
- /location/Naguanagua/Carabobo/Venezuela — 57 enlaces
- /location/Villa%20de%20Cura/Zamora/Venezuela — 49 enlaces
- /location/Catia%20la%20Mar/Vargas/Venezuela — 47 enlaces
- /location/Merida/Merida/Venezuela — 37 enlaces
- /location/San%20Cristobal/Táchira/Venezuela — 36 enlaces
- /location/La%20Guaira/La%20Guaira/Venezuela — 32 enlaces
- /location/Caracas/Ciudad%20Metropolitana/Venezuela — 31 enlaces
- /location/Anaco/Anzoátegui/Venezuela — 27 enlaces
- /location/Escuque/Trujillo/Venezuela — 27 enlaces
- /location/San%20Cristóbal/Tachira/Venezuela — 27 enlaces
- /location/Punta%20de%20Piedras/Nueva%20Esparta/Venezuela — 26 enlaces
- /location/Distrito%20Capital/VE/Venezuela — 25 enlaces
- /location/San%20Juan%20de%20los%20Morros/Guárico/Venezuela — 25 enlaces
- /location/Caracas/Capital%20District/Venezuela — 25 enlaces
- /location/Miranda/Zulia/Venezuela — 24 enlaces
- /location/Palo%20Negro/Aragua/Venezuela — 24 enlaces
- /location/Catia%20La%20Mar/Vargas/Venezuela — 22 enlaces
- /location/Barcelona/Anzoategui/Venezuela — 21 enlaces
- /location/Puerto%20La%20Cruz/Anzoategui/Venezuela — 21 enlaces
- /location/El%20Hatillo/Miranda/Venezuela — 21 enlaces
- /location/Caracas/Distritos%20Capital/Venezuela — 20 enlaces
- /location/Caracas/CCS/Venezuela — 20 enlaces
- /location/Petare/Distrito%20Capital/Venezuela — 20 enlaces
- /location/San%20Diego/Carabobo/Venezuela — 20 enlaces
- /location/Bolívar/Yaracuy/Venezuela — 20 enlaces
- /location/Puerto%20Ordaz/VEN/Venezuela — 20 enlaces
- /location/Valencia/Distrito%20Capital/Venezuela — 19 enlaces
- /location/Maracay/Venezuela/Venezuela — 19 enlaces
- /location/Cuyagua/Aragua/Venezuela — 19 enlaces
- /location/Mérida/Táchira/Venezuela — 18 enlaces
- /location/San%20Joaquín/Carabobo/Venezuela — 18 enlaces
- /location/San%20Juan%20de%20Colón/Táchira/Venezuela — 18 enlaces
- /location/Macuto/Vargas/Venezuela — 16 enlaces
- /location/Cumaná/Estado%20Sucre/Venezuela — 16 enlaces

**Cómo:** reutilizar el capturador de RYM con la lista de locations faltantes (una pasada por página y su paginación),
con el mismo ritmo humano y la sesión del dueño. Después: `scripts/rym-ciudades-reparse.py` (ya existe) y el mismo
cruce por niveles. Coste: minutos por ciudad; sin LLM.

## Hueco 2 · Fichas de artista ya capturadas, sin exprimir

Las 12.305 fichas en disco traen discografía, ciudad, integrantes y géneros. Hoy solo se usaron para la captura RYM.
**Cómo:** pasar `scripts/rym-v4-reparse.py` (o el extractor de discografía de este script) sobre todas y cruzar
discografía contra `public.albums`: el solape de títulos es la señal de identidad más fuerte que tenemos.
Eso permite decidir altas y también descubrir artistas que RYM lista pero cuya página de ciudad no se capturó.

## Hueco 3 · Fuentes fuera de RYM (para los que RYM no lista por ciudad)

| fuente | qué aporta | estado en el repo |
|---|---|---|
| MusicBrainz (area VE) | artistas con país/area Venezuela y relaciones | 1.666 MBID ya cosechados; faltan los demás |
| Discogs | artistas por país, con discografía y créditos | hay cosecha de bios; no barrido por país |
| Metal Archives | bandas VE con discografía, año y ciudad | `data/raw/metal-archives-ve-2026-10-01` |
| Bandcamp | artistas con location Venezuela y releases | sin barrido |
| Last.fm | tags venezuelan/venezuela/venezuelan rock | tags ya cargados en entity_user_tags |
| Sincopa / blogs / Hemeroteka | fichas históricas con discografía | cosechados y aplicados en parte |
| YouTube | canales/álbumes de artistas VE | hay disponibilidad de videos, no barrido de artistas |

**Orden recomendado:** (1) completar RYM por ciudad; (2) re-parsear las fichas ya en disco; (3) MusicBrainz por area
VE para los que no aparezcan; (4) Discogs y Bandcamp por país; (5) cruzar todo contra el catálogo con las seis señales
de este script (nombre con apodos, discografía, año, ciudad, integrantes, tipo).

## Regla de inclusión (para no volver a llenar el catálogo de homónimos)

1. Vínculo venezolano explícito (ciudad de VE en RYM, area VE en MusicBrainz, país Venezuela en Discogs…).
2. Al menos una obra musical (release) atribuida a esa ficha, no solo mención en una biografía.
3. Identidad: si hay candidata en el catálogo, exigir **discografía en común o año+ciudad+integrantes**;
   con solo el nombre igual no se descarta ni se fusiona: va a colisión.
4. Toda alta lleva claim + evidencia con la URL de la fuente y el run reversible.

## Métrica de avance

- Artistas VE con discografía detectados por fuente (hoy: RYM).
- Nuevos vs duplicados vs colisiones por lote (hoy: 32 nuevos · 449 duplicados · 52 por resolver).
- % del catálogo con ciudad/año/miembros, antes y después de cada lote.
