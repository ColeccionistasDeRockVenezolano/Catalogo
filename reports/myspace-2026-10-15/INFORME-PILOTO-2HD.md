# Piloto 2HD — ficha completada con MA + MySpace (2026-10-15)

Encargo: «Ok» al plan (piloto 2HD + entrar a los 705 discos de MA). Este informe cierra el piloto.
Ficha: `https://mini-server.tail5815b0.ts.net/crv/artistas/2288` (artista 2288, 2HD).

## Qué se aplicó (run reversible **20100**)

| Campo | Antes | Después | Fuente |
|---|---|---|---|
| Disco | **ninguno** | «Dos humanidades diferentes» — demo, 2005, CD, grabado en los estudios R&M (Caracas) · `album_type='demo'`, `release_date_text='2005'` | captura MA (`consolidado/discos.csv`, album 182364) |
| Pistas | — | **4 con duración**: Hiel 1:41 · Gotas de alma 3:56 · Fantasmas apostólicas avernales 4:54 · No necesito morir 4:39 | captura MA (`consolidado/pistas.csv`) |
| Portada | — | `/crv/media/album/28307.jpg` (archivo copiado y verificado por sha256; mismo patrón que las 14.498 portadas locales) | `img/182364_cover.jpg` |
| Biografía | 59 caracteres | **1.027 caracteres** con la historia: fundación a finales de 2002 en Margarita (Fernando Mendoza, Igor Hurtado, Ómar Rodríguez, Ademar Arias), primera presentación en Puerto Ordaz (marzo 2003), tecladista Pedro Laprea, entrada de Francisco Laprea (julio 2003), Petróleo Bar de Valencia (2004, única banda margariteña en tocar allí), entrada de Jonathan González, grabación del demo en R&M (2005) | About del MySpace 2010 (tildes **reconstruidas**: el snapshot las perdió) + dato del nombre desde MA |

## Verificación (independiente, contra base/archivo/API)

- SQL: álbum 28307 con tipo/año/formato/notas y las 4 pistas con sus duraciones exactas.
- Portada: `sha256(img/182364_cover.jpg) == sha256(web/public/media/album/28307.jpg)`.
- Auditoría: 16 filas en `ingest.merge_audit` del run 20100 (álbum, 4 pistas, bio, portada) — deshacer = undo del run.
- API en vivo: `GET /artists/2288` → bio de 1.027 caracteres y 1 disco; `GET /albums/28307` → tracklist completo con duraciones y `coverUrl` local.

## Lo que queda anotado (no aplicado a propósito)

- **Membresías**: ya estaban (5 actuales + Igor Hurtado pasado, roles `Drums/Bass/Guitars/Vocals`, el estilo dominante del catálogo). El MySpace añade la precisión de los dos guitarristas (Francisco Laprea rítmica, Jonathan González melódica) — pendiente de una vía sancionada de edición de membresías.
- **Géneros**: el MySpace lista influencias (Metalcore, HxC, Grindcore…) — son influencias declaradas, no géneros del catálogo; se dejan fuera sin un cotejo con el vocabulario.
- **Web propia** (`www.2-hd.tk`): era un frameset a Geocities (cerrado); hoy no es enlace vivo y el core no tiene campo de sitio web.
- Los widgets incrustados del perfil eran de **CORTEX**: descartados (evidencia de por qué no se atribuyen).

## Hallazgo de plataforma

`ingest`/`public` corren con `server_encoding = SQL_ASCII`: `length()`/`char_length()` en Postgres
**cuentan bytes**, no caracteres (una bio de 1.027 caracteres con 25 multibyte reporta 1052). No
afecta a los datos (md5 idéntico entre base, script y API), pero es una trampa al medir textos con
acentos desde SQL.

## Archivos

- `scripts/piloto-2hd-2026-10-15.ts` — applier re-ejecutable (`--confirm`; sin él, vista previa revertida).
- `piloto-2hd-vista-previa.json` / `piloto-2hd-aplicado.json` — informes de las dos corridas.
