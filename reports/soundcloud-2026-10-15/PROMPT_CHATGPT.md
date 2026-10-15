# Prompt maestro — investigación de SoundCloud (CRV), 2026-10-15

## Cómo se usa (para Brian)

1. Abre un chat **nuevo** en ChatGPT, modo **Investigación profunda / Deep Research**.
2. **Adjunta un solo archivo**: `reports/soundcloud-2026-10-15/catalogo-soundcloud-completo.jsonl`
   (726 KB: los 4.785 artistas con su discografía, en orden de trabajo).
3. Pega el bloque **PROMPT** de abajo como mensaje.
4. ChatGPT no va a investigar 4.785 artistas en una respuesta: trabaja por **tandas** (10-15
   artistas). En cada respuesta devuelve un bloque ```json con el tramo. Tú solo escribes
   `sigue` y continúa por donde iba. Si quieres parar, paras; el archivo adjunto se queda ahí.
5. Cuando lleves unas cuantas tandas (o al terminar la sesión), **selecciona todo el chat, copia**
   y guarda el volcado como:
   `reports/soundcloud-2026-10-15/recibidos/chat-soundcloud-1.txt`
   Yo saco TODOS los bloques de ese archivo de una vez, verifico cada URL contra SoundCloud y
   aplico al catálogo en un run reversible. No hay que recortar nada a mano.
6. Si ChatGPT se atraganta con el adjunto (dice que es muy largo / no lo lee bien):
   usa los 5 trozos de `reports/soundcloud-2026-10-15/partes/` (uno por chat, mismo prompt).

`catalogo-artistas.json` (2,77 MB, con formato) es la copia de archivo para nosotros: NO se adjunta.
La lista de lotes (`lotes/`) queda como plan B si algún día quieres ir de a poco y con control.

---

## PROMPT (copiar desde aquí)

```
========================== PROMPT (copiar entero) ==========================

Eres investigador musical. Trabajas para el catálogo editorial de música venezolana
"Coleccionistas de Rock Venezolano" (CRV). Adjunto un archivo de texto: una línea JSON por artista
del catálogo, en orden de trabajo, con esta forma:

  {"i":932,"n":"Kraptor","al":["Billos"],"f":2007,"p":"Colombia","sc":"https://soundcloud.com/x","d":[[2727,"Night Of The Living dead",2012]]}

Claves: i=id del artista · n=nombre · al=alias · f=año de formación · p=país (si no es Venezuela;
los demás son venezolanos) · sc=perfil de SoundCloud que el catálogo YA tiene · d=discos, cada uno
[albumId, título, año].

TU TRABAJO, para cada artista del archivo:
A) PERFIL — encontrar su perfil PRINCIPAL en SoundCloud.
B) DISCOS — por cada disco listado, encontrar en SoundCloud la página de ESE disco.

TRABAJA POR TANDAS: en cada respuesta investiga como máximo 15 artistas, empezando por el primero
del archivo, y continúa desde el siguiente al último que ya entregaste en esta conversación (yo te
escribiré «sigue»). No repitas artistas ya entregados. Es mejor una tanda de 8 artistas bien hecha
que una de 30 a medias.

REGLA DE ORO: nunca inventes ni adivines una URL. Toda URL que devuelvas tiene que venir de un
resultado de búsqueda o de una página donde la hayas visto escrita. Un null honesto vale más que una
URL inventada.

IMPORTANTE: SoundCloud bloquea el acceso automático de los asistentes de IA a sus páginas (su
robots.txt lo dice), así que es normal que NO puedas abrir un perfil o una lista de SoundCloud.
No pasa nada: NO necesitas abrirla. Yo abro y verifico cada URL desde fuera. Devuelve la URL de
soundcloud.com tal como aparece en el resultado o en la página (buscador, Wikipedia, Linktree, la
web del sello, el Instagram/Facebook del artista, Bandcamp, prensa…), con esa fuente en `evidencia`,
y ajusta la confianza: «alta» solo si la fuente es oficial (la propia banda) o si pudiste abrir la
página; «media» si viene de una fuente fiable que la enlaza; «baja» si es dudoso. Nunca completes a
mano un slug a partir del nombre: si solo tienes «el usuario podría ser X», devuelve null.

1. El perfil debe ser el OFICIAL del artista. Descarta cuentas de fans, covers, remixes de terceros,
   sellos que re-suben catálogos y, sobre todo, HOMÓNIMOS extranjeros. Usa el país, el año de
   formación, los alias y los títulos de los discos para desambiguar: si el perfil tiene canciones o
   listas que coinciden con la discografía listada, es el correcto; si no coincide nada, no lo
   devuelvas.
2. En SoundCloud un disco vive como "lista"/set: https://soundcloud.com/<usuario>/sets/<nombre>.
   Devuelve el set. Si el disco solo existe como pistas sueltas
   (https://soundcloud.com/<usuario>/<pista>), devuélvela y dilo en `nota` («solo pistas sueltas»).
   Si no existe nada, deja `url` en null.
3. La coincidencia de título debe ser real: ignora mayúsculas, tildes, signos y sufijos de edición
   («(Remastered 2019)», «Deluxe», «Edición aniversario»). Un disco DISTINTO con título parecido no vale.
4. Si el artista trae `sc`, ese perfil ya lo tenemos: entra en él y busca ahí los sets de sus discos;
   devuélvelo como perfil solo si confirmas que sigue vivo.
5. No busques fuera de SoundCloud y no añadas discos que no estén en la lista (nada de sencillos
   sueltos ni recopilaciones de terceros).
6. Los ids son intocables: devuelve `i` y los `albumId` exactamente como vienen. No traduzcas títulos.
7. `evidencia` = la URL donde viste el enlace (el propio perfil, Linktree, la web de la banda, el
   sello, Wikipedia...). Sin evidencia no pasa nada, es un dato para revisar a mano.
8. `confianza`: «alta» si abriste el perfil y la identidad encaja sin duda; «media» si encaja por
   nombre y discos pero hay algún homónimo posible; «baja» si es una suposición.
9. Para cada disco del archivo incluye una entrada en `discos`, aunque no lo encuentres (url null).
10. ENTREGA: **un único bloque ```json y nada más** (ni saludo, ni resumen, ni viñetas fuera del
    bloque). El bloque lleva el tramo trabajado:

{
  "tramo": "<primerArtistId>-<ultimoArtistId>",
  "artistas": [
    {
      "artistId": <i>,
      "nombre": "<n>",
      "soundcloud": {
        "url": "https://soundcloud.com/<usuario>" | null,
        "confianza": "alta" | "media" | "baja",
        "evidencia": "<url donde lo viste>" | null,
        "motivo": "<una frase: solo si url es null o la confianza no es alta>"
      },
      "discos": [
        { "albumId": <albumId>, "titulo": "<título>",
          "url": "https://soundcloud.com/<usuario>/sets/<nombre>" | null,
          "confianza": "alta" | "media" | "baja",
          "evidencia": "<url>" | null,
          "nota": "<opcional>" }
      ]
    }
  ]
}

No devuelvas HTML ni código de inserción: el reproductor (iframe) se construye desde la URL, así que
me basta con la URL correcta. Recuerda: un solo bloque json por respuesta, ids tal cual, y nada
inventado.

========================== FIN DEL PROMPT ==========================
```

---

## Qué pasa con lo que devuelve ChatGPT (para quien lo lea después)

`scripts/apply-soundcloud-chatgpt.ts` lee cualquier `.json`, `.txt` o `.md` de `recibidos/` y saca
TODOS los bloques `{…"artistas":[…]}`, vengan sueltos o dentro de un volcado de chat con prosa. Por
cada URL:

* la abre en soundcloud.com (página canónica, sin parámetros: el robots de SoundCloud prohíbe `/*?`,
  así que el endpoint oEmbed no se usa aquí);
* 404 → descartada; página 200 sin `og:title` → descartada (SoundCloud responde 200 con un cascarón
  vacío en los sets y pistas que no existen: medido el 2026-10-15);
* `og:type` dice qué es: `music.musician` = perfil, `music.playlist` = set, `music.song` = pista;
* `og:title` se compara con el nombre del artista (y sus alias) o con el título del disco:

| caso | resultado |
| --- | --- |
| perfil con nombre coincidente | `verified=true` (entra en la web como reproductor) |
| set con título coincidente | `verified=true` |
| existe pero no coincide (homónimo, otro título, pista en vez de set) | `verified=false` → Curaduría |
| no existe / ruta no canónica | se descarta y queda en el informe |
| ya había enlace verificado o escrito a mano | no se toca |
| el disco citado no es del artista citado | se descarta (guarda contra ids cruzados) |

El reproductor (iframe) se genera con `web/src/lib/embeds.ts` a partir de la URL, así que **no** hace
falta que nadie pegue HTML: se calcula solo. El informe `verificacion.json` trae, por URL, el
veredicto y el iframe exacto que va a quedar visible.
