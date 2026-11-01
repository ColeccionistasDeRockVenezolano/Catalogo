# B8 · Ventanas 3.8 (Formulario de colaboración) y 3.9 (Enlaces de registro)

2026-11-01. Sección 3 de `INSTRUCCIONES_HERMES_ADMIN_2026-11-01.md`, con efecto real en
`/colaborar` de staging.

## Qué se construyó

**3.8 Formulario de colaboración** (`?herramienta=formulario`, ventana ancha). Tres pestañas:

- **Campos**: los 14 campos con segmentado **No pedir · Opcional · Obligatorio**, agrupados como
  Herra (SOBRE TI, QUÉ SABES HACER, CÓMO QUIERES APORTAR, PROPÓN ALGO), el número de filas de
  enlace (0–10) y el aviso de los dos mínimos que el servidor también exige (una vía de contacto;
  experiencia o qué quieres aportar).
- **Textos**: portada y confirmación (antetítulo, titular con `<br>`, entrada, pilares, nota,
  botón, qué pasa después en líneas, textos de enviado), nombres de los pasos, etiquetas de los
  campos con casilla **personalizar** (sin marcar se usa la de fábrica) y avisos y ejemplos con su
  propia casilla.
- **Categorías de perfil**: alta por tipo (habilidad / área de aporte / tipo de enlace), tres
  columnas con el catálogo real del proyecto (15 / 9 / 8 en staging, como Herra), etiqueta con
  contador de personas que la usan, **renombrar** (conserva el `slug`, así no rompe enlaces ya
  guardados) y **archivar / restaurar**.

Pie: Guardar formulario · Restablecer todo (`ConfirmDialog`) · Previsualizar ↗, con el recuento
del catálogo. La copia de campos se guarda en `auth.projects.collaborate_json`; el render de
`/colaborar` la aplica sin recompilar y **sin** tocar la forma de la plantilla.

**3.9 Enlaces de registro** (`?herramienta=enlaces`). Generar enlace, copia automática al
portapapeles con aviso, el enlace visible con botón **Copiar** por si el portapapeles falla,
lista de activos con caducidad, creador y número de registros, y **Revocar** con `ConfirmDialog`.
Sin enlaces: «No hay enlaces de registro activos.»

## API

| Ruta | Qué hace |
|---|---|
| `GET /community/admin/collaborate-form` | Ajustes guardados, formulario efectivo en español y catálogo. |
| `PUT /community/admin/collaborate-form` | Sanea y guarda; descarta claves y valores desconocidos. |
| `GET /community/admin/profile-terms` | Catálogo completo (con archivadas) y agrupado por tipo. |
| `POST /community/admin/profile-terms` | Alta con `type` + `label`; `slug` derivado y sin duplicados. |
| `PATCH /community/admin/profile-terms/:id` | Renombrar o archivar/restaurar. |

- `src/api/project/collaborate-config.ts` — saneado puro (`sanitizeCollaborateConfig`) y acceso a
  datos. Reutiliza `resolveCollaborateForm` para el formulario efectivo.
- Los tres endpoints de categorías y los dos del formulario viven bajo `/community/admin/*`: el
  guardián global exige sesión y rol `admin`/`community`; la configuración del proyecto sigue
  siendo solo de administración total.

## Correcciones que salieron al verificar

1. **La ventana se cerraba al guardar.** `useAsync` recarga el roadmap cuando cualquier escritura
   emite el evento de cambio del catálogo; la página devolvía el esqueleto mientras
   `roadmap.loading` era verdadero, y al desmontarse la ventana se perdía lo recién creado (el
   enlace de registro, el de activación). Ahora el esqueleto solo aparece si **no hay datos**;
   una recarga en segundo plano mantiene la página y la ventana.
2. **`ConfirmDialog` exige motivo por omisión**, y las rutas de comunidad no lo usan: revocar un
   enlace (y un colaborador, desde B7) no llegaba a la API. Las tres confirmaciones de estas
   ventanas van con `requireNote={false}`; comprobado que revocar un colaborador deja
   `status='rejected'` y `access_code_hash` NULL.
3. **El botón de Candidaturas seguía deshabilitado** en la barra aunque la ventana 3.6 existía
   desde B7; ahora abre como las demás.
4. **Los enlaces de registro vencían a las 24 h**; Herra 1.1.34 usa 30 minutos
   (`REGISTRATION_TOKEN_TTL_MIN` por defecto 30). `INVITE_TTL_MINUTES = 30` y la ventana lo dice.

## Verificación

- `src/api/project/collaborate-config.test.ts` (7): textos, listas, `maxLinks` 0–10, modos
  válidos, claves desconocidas descartadas, `<span onclick>` saneado y cuerpos que no son objeto.
- **API real**: `GET` con 17 etiquetas y 14 campos; `PUT {"fields":{"city":"off"}}` y
  `/landing/colaborar` deja de pedir `name="city"` (vuelve al restablecer); alta/renombrado/
  archivado de categoría y borrado del término de prueba; invitación con `expiresAt` a 30 minutos
  y revocación (204, 0 activos).
- **Navegador real** (`scripts/checks/b8-ventanas-browser.mjs`): **19/19**. Herramientas
  habilitadas, tres pestañas, 15 filas de campos, **Ciudad pasa a No pedir y /colaborar deja de
  pedirla en 3 s**, vuelve en 2 s, columnas 15/9/8, 65 campos de texto, nota de 30 minutos,
  enlace generado con `Copiar`, un activo, revocar deja la lista vacía, capturas ES/EN y móvil sin
  desbordes ni errores de consola. Informe y PNG en `~/crv-staging/reports/b8-ventanas-2026-11/`.
- Typecheck backend y web, ESLint dirigido y `build:staging`.

## Límites

- El **contenido** de las ventanas está en español (los títulos vienen de la copia del panel, que
  sí cambia con el idioma), igual que PeopleWindow y que el admin de Herra, que también es
  español primero. Las traducciones del formulario al inglés se editan en 3.11 (B9).
- El gateway cachea la vista anónima de `/colaborar` 30 s: la comprobación mide el retraso real
  (2–4 s) y el aviso de guardado lo dice.
