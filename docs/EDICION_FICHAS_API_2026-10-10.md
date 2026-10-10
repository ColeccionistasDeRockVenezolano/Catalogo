# Edición de fichas y cobertura de la API · 2026-10-10

La edición requiere una cuenta administradora. La API valida el rol y CSRF; ocultar botones no sustituye esa autorización. Una cuenta lectora y un visitante mantienen acceso al catálogo público. Las rutas de perfiles editables incluyen enlaces aún no confirmados y requieren administración también para leerlos.

| Ficha | Datos propios editables | Relaciones y datos que muestra | Lugar de gestión |
|---|---|---|---|
| Artista | Nombre, tipo, país/ciudad, formación/disolución, estado, períodos de actividad, temas, foto, logo, biografía, notas | Nombre real y fechas de la persona titular, integrantes, géneros, alias, redes y plataformas | Editar → Datos, Identidad e integrantes, Géneros, Redes sociales, Escuchar en. Alias en la ficha. Los datos personales se corrigen en la persona vinculada. |
| Persona | Nombre, nombre real, género, nacionalidad, venezolanidad, ciudad/fecha de nacimiento, condición/fecha/causa de fallecimiento, datos adicionales, foto, biografía, notas | Bandas/proyectos, organizaciones, créditos de disco/pista, alias | Editar → Datos, Bandas y proyectos. Organizaciones y alias en sus secciones. Los créditos se gestionan en el disco/pista de origen. |
| Disco | Título, tipo, artista, año/fecha textual, número de catálogo, formato de edición, texto original de género, sello, portada, descripción, notas, URL/estado de YouTube, Instagram y WordPress | Géneros confirmados, plataformas, videos relacionados/principal, pistas, créditos, formatos de archivo, alias | Editar → Datos, Géneros, Escuchar en, Videos de YouTube. Pistas, créditos, formatos y alias en sus secciones. El sello puede seleccionarse o quitarse. |
| Pista | Título, disco padre, número de disco/pista, duración, inicio en YouTube, notas | Créditos, alias | Editar en la lista de pistas del disco; créditos en la fila desplegada, alias en la sección del modal. |
| Organización | Nombre, tipo, país, sitio web, imagen, descripción, notas | Personas, discos como sello, artistas acreditados, alias | Editar para datos propios; personas y alias en sus secciones. Sello y créditos se corrigen en el disco de origen. |

## Rutas verificadas

- `POST/PATCH /artists`, `/persons`, `/organizations`, `/albums`, `/tracks`: campos propios; PATCH con ID. Discos y pistas admiten corregir su entidad padre.
- `POST/PATCH/DELETE /artist-members`, `/person-organizations`, `/album-credits`, `/track-credits`, `/album-formats`: relaciones; PATCH/DELETE con ID.
- Alias de cada tipo: crear, corregir, retirar y establecer principal mediante las rutas existentes.
- `GET /catalog-links/:kind/:id/:category`: todos los perfiles, incluidos pendientes; lectura privada. `PATCH/DELETE /catalog-links/:kind/:id/:category/:platform`: guardar o quitar. `kind`: artist/album; `category`: social/streaming. Redes sociales solo para artista; un enlace por entidad y plataforma.
- `GET /genres/vocabulary`; `POST /genres/:kind/:id/decision`: principal, secundario o retiro. Reutiliza las decisiones editoriales existentes y mantiene separado artista/disco.
- `PATCH/DELETE /albums/:id/videos/:videoId`: vincular, cambiar tipo/principal o desvincular un video. Seleccionar principal desmarca el anterior en la misma transacción.

## Datos derivados

Edad y estado de fallecimiento se calculan a partir de la persona. Último sello y discografía proceden de discos. Conteos, artistas acreditados, relacionados y similares proceden de sus relaciones y criterios del catálogo. Se corrigen las fichas y relaciones de origen; no se sobrescriben esas proyecciones con un valor independiente. Las referencias de fuentes, informes y auditoría representan evidencia e historial, no campos de contenido editables. El título original de un video pertenece a sus metadatos de fuente; el editor administra su asociación con el disco.

## Correcciones aplicadas

Los campos incorporados anteriormente al core no estaban incluidos en los formularios ni, en varios casos, en las respuestas de detalle. Ahora llegan desde los repositorios, se serializan en la API y precargan siguiendo la configuración de campos. Las notas de pista también llegan en la lista del disco. Las fechas vacías se envían como `null`; los estados de publicación conservan valores no nulos. Los cambios de relación no desmontan el modal ni descartan el borrador de datos propios.

Cada operación conserva operador, motivo y run. Los perfiles y videos usan el diario reversible existente; los géneros usan la decisión editorial existente. No se requiere migración de base de datos.

## Validación

Pruebas de contrato en PostgreSQL desechable: campos completos, perfiles públicos/pendientes, restricciones, videos principales, géneros e historial/Deshacer. Pruebas de autenticación: visitantes y lectores rechazados; administradores autorizados. Pruebas de configuración: cobertura de todos los campos admitidos por la API y conservación de datos ausentes de versiones anteriores. QA de navegador con API simulada para formularios, relaciones y permisos en 1440 px y 390 px.
