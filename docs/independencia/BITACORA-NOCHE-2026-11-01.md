# Bitácora nocturna CRV — 2026-11-01

**Fuente de verdad.** Si el contexto se compacta, leer primero este archivo, luego los cuatro
documentos de arranque y continuar desde el primer bloque que no esté en «cumple».

## Resumen para la mañana

_(se completa al terminar la noche)_

## Informe de la tanda anterior (previo a B0)

### Qué se tocó

- `web/src/pages/CurationRoadmapPage.tsx` — se añadieron «Nueva actividad» global, «Añadir
  actividad al principio», posición inicial, paginación por etapa, arrastre de etapas y
  actividades y el aviso de la regla de cola. Se quitaron los formularios de creación por
  etapa y el bloque de cinco tarjetas de estadísticas.
- `web/src/styles/roadmap-admin.css` — estilos de la barra de herramientas, modal, filas
  arrastrables, paginación y etapas.
- `web/src/pages/CurationProjectPage.tsx`, `web/src/lib/project.ts`,
  `web/src/pages/CurationLayout.tsx`, `web/src/App.tsx` — página `/curaduria/ajustes` y su
  entrada en la barra lateral.
- `src/api/project/config.ts`, `src/api/routes/project-config.ts`,
  `src/api/routes/community.ts`, `src/api/routes/roadmap.ts`, `src/api/roadmap/store.ts`,
  `src/api/auth.ts` — ajustes del proyecto, estado de actividades por colaborador y
  excepción mínima de escritura del rol `reader`.
- `web/public/landing/login-es.html`, `login-en.html`, `login.js`, `site-config.js`,
  `roadmap-collab.js`; `web/server.mjs` — `/login` 1:1 y aplicación de los ajustes en la
  landing estática.
- `docs/independencia/FASE2.1.md` y `docs/independencia/FASE2.md` — documentación de la
  tanda.

### Qué quedó a medias

- El admin visual sigue siendo el panel del catálogo, **no la página completa de Herra**:
  faltan la cabecera de administración, la tarjeta de progreso, la barra de 13 herramientas,
  las ventanas 3.1–3.13, las filas de actividad con burbuja de responsables y la edición
  mediante modal. Brian lo rechazó: «no se parece en nada a Herra».
- Colaboradores, Candidaturas, Ajustes y Visitas siguen siendo páginas separadas; deben
  pasar a ventanas de `/curaduria/roadmap`.
- No se hizo CP0: la landing sigue siendo HTML estático con solo tres interruptores.
- No se portó `herra-separacion/src/traffic`; Métricas no tiene datos clasificados.
- No se había hecho el commit de B0.
- Los datos de prueba de staging («Actividad UI», categorías y usuarios temporales) se
  borraron y la paridad quedó en 61 actividades / 27 completadas / 5 etapas / 283 visitas.
  Hay que volver a comprobarlo al cerrar cada bloque.

## Estado de bloques

| Bloque | Estado | Evidencia / siguiente acción |
|---|---|---|
| B0 | cumple | Commit `53c350f7` en `independencia/fases-0-3`, 132 archivos del plan; `.hermes/` quedó fuera. `git diff --cached --check` solo reportó espacios finales de HTML copiado. |
| B1 | cumple | `CRV_COMMUNITY_ENABLED`/`CRV_RADIO_ENABLED` apagados por defecto y registrados condicionalmente; `CRV_WEB_MODE` validado; redirección sin prefijo solo con `CRV_WEB_REDIRECT_UNPREFIXED=1`; 0124 en `migrations/pending`; `.down` ya no promueve a admin; `deploy.sh` aborta en rama/cambios. Prueba: API alterna :8093 con flags false → 404 en roadmap/site-config/radio/community y health 200; staging con flags → 200; `/roadmap` sin prefijo → 302 y `/crv/roadmap` 200; `bash scripts/deploy.sh` abortó por rama. Typecheck backend/web, 18/18 vitest. |
| B2 | pendiente | P-1…P-4, F1-1…F1-6, F2-1 |
| B3 | pendiente | IP real, país, cookies, orígenes, secretos |
| B4 | pendiente de permiso | No reiniciar producción; dejar comando exacto |
| B5 | pendiente | CP0: portadas generadas desde datos |
| B6 | pendiente | C1-C2: página y ventanas 3.1–3.3 |
| B7 | pendiente | C3-C5 y /cuenta |
| B8 | pendiente | C8, C6 |
| B9 | pendiente | C9, C11, C10 |
| B10 | pendiente | C7, C12 y traffic |
| B11 | pendiente | Timer sombra larga |

## Incidencias y decisiones pendientes

- Producción no se toca. Cualquier reinicio de `crv-api`/`crv-web`/`crv-chat` de producción
  o `npm run deploy`/`db:migrate` queda fuera de esta noche salvo B4, que solo se documenta.
- Nada de `/tmp` para informes; las capturas y reportes van al staging del SSD.
