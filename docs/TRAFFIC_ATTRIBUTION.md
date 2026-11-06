# Procedencia y enlaces de campaña

Desde 2026-11-04, Administración → Métricas → «De dónde vienen» mide la portada y sus páginas de colaboración y acceso. No reconstruye el origen de visitas anteriores. No depende de Google Analytics, Hotjar ni cookies.

## Enlaces

Administración total crea un código único con nombre, fuente, medio, campaña y variante. Destinos permitidos: `/` y `/colaborar`. El panel ofrece el enlace `?ref=codigo`, copia, archivo/restauración y CSV de la tabla filtrada. Los códigos y etiquetas se conservan: para otra campaña se crea otro enlace. Los enlaces archivados siguen atribuyendo correctamente.

También se aceptan `utm_source`, `utm_medium`, `utm_campaign` y `utm_content` sin registrar un enlace. Prioridad: código registrado → UTM válidas → código sin registrar → dominio referente externo → directo/desconocido. Un código registrado prevalece sobre UTM contradictorias. Nunca se guardan `utm_term`, tokens, fragmentos ni URLs completas. El referente se reduce a hostname. Se descartan etiquetas con URLs, email, controles o más de 80 caracteres.

Las etiquetas son declaradas, no certifican la aplicación de origen. Reenviar un enlace conserva su etiqueta. Referente ausente significa «directo/desconocido»; no se deduce una fuente del país ni de la IP.

## Conteos

- Se utiliza la primera procedencia observada por huella/día/tipo de agente. La huella es el HMAC existente, con fecha del servidor en `America/Caracas`. No se introduce identidad persistente ni fecha del navegador.
- Un navegador que recibe una clasificación JS sospechosa se reclasifica en sus agregados de procedencia, en una sola transacción. Un agente declarado (curl, buscador, IA…) se registra separado de un navegador que comparta conexión. Por ello los días/tipos no equivalen a personas únicas. La clasificación es probabilística.
- «Visitantes/día»: huellas diarias por tipo. «Con JS»: aquellas con aviso de página; no demuestra humanidad. «Páginas JS»: una por documento cargado, no por heartbeat. «Solicitudes»: documentos medidos por el gateway.
- Colaborar/Radio: visitantes/día que pulsaron esos controles. Radio no mide minutos ni reproducción confirmada. Candidaturas: visitantes/día con un envío confirmado por `/community/applications`, nunca por un evento del navegador.
- Reintentos con el mismo evento no duplican cifras. Los clics repetidos del mismo visitante/día cuentan una vez por acción. Compartir IP puede unir navegadores: las cifras no identifican personas.
- Las páginas permitidas son portada, colaborar, login, registro y activar. Se excluyen administración, perfil, formularios y catálogo del origen de navegación. Los tokens de activación no se conservan.

## Almacenamiento y seguridad

Migración `0126_traffic_acquisition`. `auth.traffic_links` mantiene el mapa; `traffic_acquisition_visitors` y `traffic_acquisition_receipts` deduplican durante 3 días; `traffic_acquisition_daily` conserva agregados 400 días. La poda ocurre con actividad del escritor. No se guardan IPs ni User-Agent de personas. Las huellas no se exponen en el informe.

El escritor usa la cola existente, límite de 5.000 eventos, transacciones, bloqueos por huella y recibos atómicos; no hace consultas externas. `CRV_TRAFFIC_ENABLED` es el interruptor común. Los errores se registran sin volcar eventos. El navegador nunca bloquea una navegación por fallo de medición.

`POST /traffic/event` valida esquema cerrado, tipos y longitud, origen y 120 eventos/minuto por IP. Solo permite página, colaborar y radio. `/traffic/page` sigue siendo interno y exige token. Los GET de campañas requieren rol de administración/comunidad; POST y PATCH requieren administración total y CSRF. Todas las respuestas del panel son privadas y sin caché. El gateway añade exclusivamente `/api/traffic/event` a su lista blanca pública.

## Operación

Aplicar solo 0126 y registrar su versión antes de reiniciar la API nueva. Ensayar en `crv_staging`; respaldar `auth` antes de producción. Desplegar en una copia aislada del release público vigente, conservando sus cambios previos y su configuración. Las tablas son aditivas: volver al release anterior detiene la medición nueva y conserva sus datos. El `down` se niega a borrar campañas o agregados existentes.

Pruebas: `test/traffic/attribution.test.ts`, `test/contract/traffic-acquisition.test.ts` y `web/tests/visual/traffic-acquisition-qa.mjs`. La prueba de navegador solo escribe en staging y restaura sus fixtures; no fabrica visitas ni campañas de producción.
