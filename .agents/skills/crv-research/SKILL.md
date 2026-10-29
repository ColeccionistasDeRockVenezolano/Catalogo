---
name: crv-research
description: Investiga música venezolana (artistas, bandas, discos, integrantes, prensa) con fuentes verificables y sin tocar el catálogo. Úsala en cualquier trabajo de investigación del proyecto CRV.
version: 1.0.0
---

# Investigación musical venezolana (CRV)

Alcance: artistas, bandas, proyectos, discos, integrantes, discografías, biografías y prensa.
**Solo lectura**: no ejecutes importadores, no escribas en la base ni en `media.*`.

## Orden de fuentes

1. **Primarias**: web oficial, sello, Bandcamp, YouTube del artista, notas de prensa de la época.
2. **Bases estructuradas**: Discogs (`DISCOGS_TOKEN` en `.env`), MusicBrainz, Last.fm
   (`LASTFM_API_KEY`), Spotify/Tidal para IDs y fechas de publicación.
3. **Archivo**: Wayback Machine para webs muertas; hemeroteca para prensa venezolana
   (skill `crv-hemeroteka`); Deska para fichas locales (skill `crv-deska`).
4. **Secundarias**: blogs, foros, Wikipedia. Solo como pista, nunca como prueba única.

## Recetas

```bash
# Búsqueda con operadores: año, comillas, sitio concreto
webresearch search '"Los Impala" discografía site:discogs.com' --limit 8
webresearch search '"rock venezolano" 1971 prensa' --limit 10

# Abrir la ficha y quedarse con el contenedor real
webresearch fetch "https://www.discogs.com/release/XXXX" --chars 9000

# API estructurada (más fiable que el HTML)
curl -s -H "Authorization: Discogs token=$DISCOGS_TOKEN" \
  "https://api.discogs.com/database/search?q=Los+Impala&type=artist"
curl -s "https://musicbrainz.org/ws/2/artist/?query=artist:%22Los%20Impala%22&fmt=json"
```

Con MCP (`webresearch`/`scrapling`) usa `searx_search` y `web_fetch`; con el CLI, los
comandos de arriba. La instancia SearXNG del proyecto es `CRV_SEARXNG_URL` (127.0.0.1:8888).

## Qué registrar por hallazgo

- URL final + fecha de consulta + cita literal (2-3 líneas).
- Tipo de fuente (primaria/secundaria) y qué afirma exactamente.
- Discrepancias entre fuentes (año, integrantes, sello) sin resolverlas por preferencia.
- Si el dato no aparece en ninguna fuente, se anota como ausente; no se rellena.

## Evidencia y almacenamiento

Las capturas nuevas van al staging del SSD y se publican al almacén de 1 TB:

```bash
python3 scripts/shared-storage.py status
python3 scripts/staging.py new data/research/<tema> <campaña>
python3 scripts/staging.py publish
```

## Pitfalls

- Bandcamp no existía antes de ~2008: una fecha de 2003 en Bandcamp es la que puso la banda.
- Un mismo disco puede tener reediciones con pistas extra: no mezcles ediciones (ver AGENTS.md).
- Los videos no crean discos: van a `media.artist_audiovisuals` (ver `docs/AUDIOVISUALS.md`).
- YouTube y Spotify dan IDs y fechas, pero no biografías citables.
- Si una fuente bloquea (403/captcha), cambia a `stealthy_fetch` o Wayback; no insistas.
