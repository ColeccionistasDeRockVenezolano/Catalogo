# Plan del primo · Etapa 1 «Limpieza visible e identidades» (2026-10-12)

Plan: `~/Desktop/Plan primo/PLAN_POR_ETAPAS.md`. Respaldo previo a las escrituras: `/mnt/datos/backups/crv/crv-20261012T062934Z`.

## 1A · Pantalla

| Punto | Hecho |
|---|---|
| 4 · Último sello | Retirado de la API (`lastLabel`, SQL y esquema) y de la ficha de artista. |
| 5 · Campos vacíos | `EntityInfo` solo muestra «Sin dato» al admin (`showEmpty={isAdmin}`). Para el público se omite la fila vacía, y también los estados `unknown` (estado del artista, género de la persona). |
| 10 · Alias repetidos | La API marca `publicHidden` en los alias iguales al nombre (con o sin tildes y mayúsculas), en los repetidos, en el que ya sale como título compuesto y en los `source_variant`. El público no los ve; el admin los ve atenuados. No se borra nada. |
| 11 · Miembros | Ahora se lee «Integrantes» (pestaña, botones, avisos y rol «Miembro» → «Integrante»). |
| 2 · Apodo | Nuevo tipo de alias `nickname` (migración 0067). La API compone «Nombre "Apodo" Apellido» en la ficha, en los integrantes y en los créditos. La base guarda el nombre real. |

## 1B · Datos (runs)

| Run | Qué |
|---|---|
| 19008 | 348 alias de apodo marcados o creados a partir de alias con el apodo entre comillas (`scripts/primo-etapa1-apodos.ts`). |
| 19010 | Casos «antes» (`scripts/primo-etapa1-casos.ts --stage=antes`): <br>• La Banana Voladora y Atkinson pasan a variantes de fuente. <br>• Los «DJ …» pasan a nombre artístico. <br>• 9 solistas tenían a su propia persona como integrante y ahora es titular (Yordano, Montaner, Karina, Rudy La Scala, Noya, María Rivas, Saúl Vera, Jeremías, Paul Gillman). <br>• **1ra Edición (31) ⇐ Primera Edición (1172)** con sus discos («Tiempo De Actuar» ⇐ «Es Tiempo de Actuar», «1986» ⇐ «1986»). Manda el canal: formación 2002; lo que dice Rockzuela queda en notas. <br>• Indio Figueredo: 6664 ⇐ 4295. |
| 19013 | Plan de personas (`docs/decisions/2026-10-12-plan-primo-etapa1-personas.json`): <br>• 5 renombres por apodo, entre ellos **645 → Carlos Eduardo Troconis** («Cayayo»). <br>• **386 ⇐ 7564, 34688 y 34687** (Cheo Pardo y Cheo Pardo Broccoli Crü). <br>• **645 ⇐ 6490**; **3617 ⇐ 26106** (errata). <br>• Split de **34380** en Carlos «Nene» Quintero y Orlando Poleo. <br>• Toro Bernal, Jorge de la Vega y José Navarro. |
| 19014 | **José Luis «Cheo» Pardo (386) es titular de DJ Afro (72).** |
| 19017 | 193 titulares creados para solistas con nombre de persona (`docs/decisions/2026-10-12-plan-primo-etapa1-solistas.json`). |
| 19018 | Se deshace el titular de Otrebor: «Jesús Méndez» 30130 es un homónimo sin proyecto común. |
| 19019 | Lo que quedó claro del nuevo detector: **Cuarto Poder (1905) ⇐ 4to Poder (1767)** y sus dos discos dobles. |
| 19020 | DeepSeek flash reescribe las biografías unidas en las fusiones (text_rewrites 816, 817 y 823–827). |

### Detector de artistas parecidos

En `src/curation/detectors/duplicates.ts` hay una nueva regla, `variante_de_nombre`. Junta números escritos en cifra o en letra («1ra» y «Primera», «4to» y «Cuarto») y quita los envoltorios «La Banda de…» y «- La Banda». Los pares dudosos, sobre todo «X» frente a «Grupo X» o «X y su Orquesta», entran en la cola de Curaduría con el próximo `curation scan`. No se fusionan solos.

### Solistas sin titular (cola con motivo)

En `solistas-pendientes.json` quedan **283** solistas, todos con su motivo:

- **282:** nombre artístico o no reconocido como nombre de persona, y sin homónimo en el catálogo. Falta identificar a la persona.
- **1:** Otrebor. La biografía dice «Jesús Méndez», pero ese nombre es de otra ficha sin proyecto común. Hay que revisarlo a mano.

### Solistas sin discos (55)

Se revisaron y no se retiró ninguno:

- 27 son compositores académicos del lote del 2026-10-02. Se conservan por decisión de Brian.
- El resto aparece en recopilaciones o tiene perfil de streaming. Están listados en `solistas-pendientes.json` → `withoutAlbums`.

### Renombres no hechos

- **Eddy Pérez** y **Tweety González:** el nombre real choca con otra persona (Fabián González 26935) sin proyecto común. Siguen con su nombre actual.

## Verificación

- `scripts/primo-etapa1-verificar.ts` lee las fichas guía a través de los repositorios:
  - DJ Afro muestra como titular a José Luis "Cheo" Pardo.
  - La persona 386 muestra tres proyectos: DJ Afro, Los Amigos Invisibles y Los Crema Paraíso.
  - 645 se muestra como Carlos Eduardo "Cayayo" Troconis.
  - 1ra Edición: formación 2002 y alias público «Primera Edición».
  - Banana Voladora y Atkinson no muestran alias.
- Pruebas:
  - Unitarias: 848 del backend y 57 de la web, más `test/unit/public-names.test.ts`. Typecheck limpio en backend y web.
  - Contrato: se ajustaron `api-read` y `api-aliases` al nuevo campo `publicHidden`. E9.5 (análisis completo en menos de 5 s) ya fallaba en HEAD con 5,7 s. Se aceleró sin cambiar ningún hallazgo: siguen siendo 25.968 y las huellas son idénticas. Ahora el análisis de régimen tarda unos 4,0 s cuando la prueba corre sola y 4,9 s dentro de la suite completa, que da 552/552. Cambios:
    - `discos_partidos` solo tokeniza los discos de artistas que tienen alguna ficha con parte.
    - `albumPart` descarta antes de aplicar los patrones los títulos sin ninguna palabra de parte.
    - `canonicalByKind` ya no copia la lista en cada homónimo.
    - `roleKey` y las familias de rol se calculan una vez por texto.
    - `keyTokens` sale de la caché de claves.
    - `palabras_pegadas` y `codificacion_rota` usan un filtro previo barato.
    - `storable` y `canonical` (huella de contenido) ya no reconstruyen cada hallazgo.
  - Navegador: `test:browser` y `entity-editing-qa` (1440 y 390 px, admin, lector y visitante) en verde. El QA de edición ya fallaba en HEAD porque le faltaba simular `/catalog-model`; se añadió esa simulación y los textos «Añadir integrante» y «Integrantes».

## Despliegue

Hecho el 2026-10-12 con `scripts/deploy.sh --api`. Brian autorizó aplicar antes 0064–0066 (de Codex).

Pasos:
1. Respaldo nuevo: `/mnt/datos/backups/crv/crv-20261012T081703Z`.
2. Migraciones 0064–0066 aplicadas.
3. API de prueba en el puerto 8099 verificada.
4. Despliegue y análisis completo #919.

Comprobado después:
- `/crv/` y `/crv/api/health` responden 200.
- Las fichas guía se ven como visitante sin «Sin dato» ni «Último sello», con la pestaña «Integrantes» y sin errores de página.
- La regla nueva del detector dejó 29 pares `variante_de_nombre` en la cola de Curaduría.
