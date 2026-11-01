# Reparación de portada pública, 2026-10-30

Superficie afectada: https://coleccionistasderockvenezolano.com/ (Herra, puerto 3020), no la SPA del catálogo.

El motor PostgreSQL se basó en una versión que carecía de las personalizaciones CRV presentes en `/home/brian/apps/herra`: cabecera, marca de las pantallas de acceso/cuenta, pie de página, CSS, imagen del logo y favicon. Se restauraron esos elementos sin sustituir la implementación actual de radio.

El POST `/api/visit` fallaba al incrementar un país existente: PostgreSQL considera ambigua la expresión `visits = visits + 1` dentro de `ON CONFLICT ... DO UPDATE`. La transacción revertía tanto el visitante nuevo como su agregado. Se califica la columna como `project_visit_stats.visits` en el servicio y en la herramienta de reconciliación.

Fuente corregida: `/home/brian/apps/herra-postgres`, motor 1.1.15. Se añadió regresión PostgreSQL para dos visitantes del mismo país y repetición de uno. Una prueba transaccional contra PostgreSQL verificó total=2, hoy=2, online=2 y rollback completo, sin conservar visitas sintéticas.

El histórico observado antes de la reparación era 237. Las peticiones revertidas no dejaron registros de visitas recuperables; no se fabrican visitas ni se cambia la deduplicación. Las cuentas siguen en PostgreSQL.

Activación: motor 1.1.15 instalado y fijado en la instancia, cron y configuración PM2. Respaldo PostgreSQL cifrado verificado antes del cambio. 86 pruebas unitarias y 81/81 comprobaciones de portabilidad correctas. POST público de visitas devuelve 200; total observado tras activar: 239, con 2 visitantes hoy/en línea. Logo original de 160 px servido y dibujado a 44 px, sin desbordamiento horizontal en escritorio.
