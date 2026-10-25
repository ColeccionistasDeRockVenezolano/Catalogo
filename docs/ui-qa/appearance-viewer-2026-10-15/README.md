# Administración, temas y visor de imágenes

## Comportamiento

- La entrada «Home» reemplaza «Buscar» y usa un icono de casa.
- «Administrar», visible solo para administradores, abre «Curaduría» y «Configuración».
- Configuración → Temas conserva Actual y añade Carbón. Seleccionar una opción no la publica hasta pulsar «Aplicar tema al catálogo».
- La elección se guarda en `ingest.site_appearance` para todos los visitantes. El tema inicial es Actual. La preferencia pública se revalida al navegar, volver a la ventana y cada minuto mientras está visible.
- Home siempre recibe los tokens originales, independientemente del tema global. No cambian sus secciones ni sus selecciones diarias.
- Las portadas, fotos y logos abren un visor dedicado con archivo original, proporción íntegra, zoom con rueda/pellizco, arrastre limitado, doble clic, ajuste a pantalla y tamaño real.
- Teclado: +/− para zoom, 0 para ajustar, 1 para tamaño real, flechas para desplazar, Esc para cerrar. Tab permanece dentro; al cerrar, el foco vuelve al botón de origen.
- El visor bloquea el desplazamiento del fondo y muestra carga, error y reintento. Los controles son de al menos 44 px.

## Validación

- Compilación de producción de la web, con TypeScript.
- Pruebas unitarias web: 14 archivos, 87 pruebas.
- Contrato PostgreSQL aislado: lectura pública, tema inicial, persistencia, vuelta a Actual, atribución al administrador, restricciones de sesión/rol/CSRF y validación estricta del cuerpo.
- Navegador: `web/tests/visual/appearance-viewer-qa.mjs`, escritorio de 1440 px y móviles de 390 y 320 px; menú, configuración, errores al guardar, visitante nuevo, exclusión de Home, foto de Arca y visor con zoom, arrastre, rueda, doble clic, pellizco, teclado, foco y carga fallida con reintento.
- Regresión de reproducción: `web/tests/visual/album-player-qa.mjs`, con video flotante, pistas y controles de administración.
- Detector de diseño: sin hallazgos en los componentes y estilos nuevos.

Las capturas usan fichas reales del catálogo. Solo los iframes de plataformas externas y los permisos/preferencias del sitio se sustituyen en las pruebas del navegador. Las pruebas no cambian la configuración ni el catálogo de producción. La procedencia de la textura creada por código está en `web/src/assets/charcoal-grain.provenance.json`.

## Publicación

Cambios preparados localmente. La publicación requiere aplicar `0074_site_appearance` y desplegar API y web. No se han migrado ni modificado las preferencias del sitio publicado.

La comprobación de TypeScript del backend completo encontró un error ajeno a esta implementación en `scripts/apply-soundcloud-chatgpt.ts:120` (propiedades opcionales con valor `undefined`). La comprobación de todo `src` y del nuevo contrato con sus utilidades pasa; el contrato PostgreSQL también pasa. El script ajeno no se ha modificado.
