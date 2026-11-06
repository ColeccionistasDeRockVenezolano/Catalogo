# Revisión de seguridad del dominio CRV — 2026-11-04

## Actualización operativa — 2026-11-05

Brian indicó expresamente «Lo vamos a dejar así, reactiva la sincronización».
Se reactivó el envío conservando los permisos actuales de Contactos: se retiró
únicamente `zzzzz-security-sheet-hold.conf`, se recargó systemd y se reinició
la API. Se procesaron los dos registros pendientes y la cola quedó vacía.
La lectura de Google confirmó ambos correos y todos los campos del registro
más reciente. Se conservó sin duplicar el contacto que ya existía en la hoja.
El trabajador vuelve a sincronizar inscripciones nuevas. La decisión del usuario
sustituye la pausa preventiva descrita en el informe original a continuación;
el hallazgo de acceso `anyone:writer` sigue vigente.

## Resultado y alcance

Se revisó `https://coleccionistasderockvenezolano.com/`, su gateway, API de portada,
formulario de lanzamiento, comunidad/cuentas, controles compartidos de autorización,
dependencias y conexión a PostgreSQL. Las correcciones del dominio están en
`/mnt/datos/crv-release/security-20261104`. No se certifica ausencia absoluta de
vulnerabilidades ni se hizo una prueba de carga, explotación destructiva o auditoría
forense del host, Cloudflare, Google o sus otras aplicaciones.

**Pendiente crítico:** la hoja Contactos permite `anyone:writer`. Drive lo confirmó
y su exportación CSV respondió 200 sin sesión. El conector disponible permite leer
ese permiso, pero no revocarlo. Brian debe usar **Compartir → Acceso general →
Restringido → Guardar**, conservando los accesos individuales. No se modificaron
sus celdas ni se añadieron contactos de prueba a la hoja.

Para contener la exposición, el envío a Google está pausado. El formulario conserva
las inscripciones en `auth.launch_contacts`; se entregarán después de resolver el
permiso y reactivar el trabajador. La pausa no elimina datos ni deshabilita el formulario.

## Hallazgos y correcciones

| Hallazgo | Estado |
| --- | --- |
| Hoja de contactos accesible y editable por cualquiera con el enlace | Pendiente de restringir en Google. Envío pausado desde el servidor. |
| API del dominio conectada como superusuario de PostgreSQL | Sustituida por `crv_landing_runtime`: lectura de catálogo, escritura de comunidad y sesiones; sin superusuario, creación de roles/bases, DDL ni ejecución de programas. |
| Node 24.20.0 del dominio sin las correcciones de octubre | Sustituido por Node 24.22.2 LTS, descarga oficial y SHA-256 verificado; incluye Undici 7.30.1 y OpenSSL 3.5.9. |
| Dependencias con avisos conocidos | Actualizadas. Auditorías finales del servidor, runtime de la release y frontend: cero avisos. |
| Confianza en cabeceras XFF de clientes directos | Solo se aceptan desde loopback; el gateway normaliza la IP y usa CF-Connecting-IP únicamente con el interruptor explícito y un peer local. |
| Rotación de claves podía expulsar límites activos | Los contadores activos no se expulsan para admitir claves nuevas. Se recupera espacio al vencer las ventanas. |
| Errores PostgreSQL podían devolver valores de filas | Los errores públicos conservan código/estado y un texto neutro; se elimina DETAIL, SQL y nombres de restricciones. |
| Respuestas de cuenta/personalizadas sin política uniforme de caché | `private, no-store` y `Vary: Cookie` para sesiones, cuentas e invitaciones/activaciones. |
| API de portada registraba editores y recuperaba trabajos del catálogo | `CRV_API_MODE=landing` registra solo comunidad, cuentas, roadmap, radio y health. El catálogo no existe en esa API. |
| Origen de producción podía depender del Host recibido | Solo se admite la lista de orígenes configurados. Los formularios públicos requieren Origin; el aviso interno de tráfico conserva su token propio. |
| Intentos inválidos del modal no consumían su límite específico | El presupuesto se comprueba antes de leer y validar el cuerpo. Máximo 4096 bytes; honeypot y validación estricta. |
| Cabeceras y fallos del gateway | HSTS de un año, cabeceras también en redirecciones, rechazo de archivos ocultos, Host malformado controlado y límites de tiempo de recepción. |
| Revalidación de privilegios vinculados entre proyectos | La sesión privilegiada exige que la administración siga perteneciendo al proyecto correcto y conserve el rol. |

El formulario ya tenía SQL parametrizado, correo normalizado/deduplicado, origen
Roadmap fijado en el servidor, cookie HttpOnly/SameSite y escritura RAW en Sheets.
Se conservaron. No se añaden datos personales a localStorage ni se ejecuta HTML
a partir de los campos. Las credenciales permanecen en el servidor con permisos 0600.

## Dependencias

Se actualizaron Fastify y dependencias transitivas compatibles. Para eliminar los
avisos restantes se migró Zod a 4.6.7 con su proveedor Fastify compatible, Vitest a
4.1.12, React Router a 7.18.5 y Vite a 7.3.7. Los records ahora declaran su clave
explícita; el contrato JSON usa la API pública de Zod. Se preservó el tratamiento
opcional de uncertainties en la verificación de personas.

Los overrides de `package.json` fijan versiones corregidas de minimatch, glob y
uuid de ExcelJS. Las pruebas y el build validan sus interfaces utilizadas. La
actualización del frontend se verificó con build y pruebas; la portada pública
sirve sus plantillas y scripts, sin publicar el catálogo React.

## Evidencia y pruebas

- 135 pruebas de seguridad, autenticación, permisos, formulario, subidas y
  compatibilidad: 13 archivos, todos pasan, repetidas con Node 24.22.2.
- 137 pruebas del frontend: 21 archivos, todas pasan.
- 17 comprobaciones de interfaz del modal en staging, sin escribir en producción.
- 24 comprobaciones HTTP de seguridad locales y 23 desde el dominio público;
  el caso extra local verifica que un Host inválido no termine el proceso.
- 108 comprobaciones de la puerta temporal, locales y públicas, todas pasan.
- Typecheck del proyecto y runtime; lint de los cambios principales; build del frontend.
- TLS 1.3, certificado y nombre verificados. CSP sin scripts unsafe-inline/eval,
  protección contra marcos, nosniff, HSTS y caché privada comprobados públicamente.
- Búsqueda de patrones de claves privadas y tokens conocidos en 3992 rutas de
  código: sin coincidencias. No equivale a un examen completo de todo el historial Git.
- Navegador público en móvil y escritorio: modal visible, sin errores JS y sin
  ejecutar una campaña de URL que contiene una etiqueta script.

La suite amplia inicial ejecutó 1621 pruebas: 1607 pasaron y 14 fallaron. Se
corrigieron las incompatibilidades de esta intervención y sus expectativas de
seguridad; las pruebas afectadas volvieron a pasar. Permanecen tres fallos ajenos
al endurecimiento, documentados sin alterar sus datos: revisión de recursos con
hash obsoleto de OperatorSettings; colección NOX que espera once efectos y contiene
doce; prueba de deploy que exige master mientras el trabajo está en
independencia/fases-0-3. No se restauró el catálogo antiguo de efectos ni se
reescribió evidencia de investigación para hacer pasar esas pruebas.

Los servicios del catálogo/chat y otros hostnames del Funnel usan releases y
runtimes distintos. No se sustituyeron en este despliegue de la portada; requieren
una revisión/despliegue propios antes de atribuirles estos resultados. PostgreSQL
y las API siguen escuchando en loopback. No se cambió el firewall global del host.

Evidencias: `reports/security-audit-2026-11-04/` (publicadas desde staging SSD al
almacén compartido al cerrar la campaña). No contienen contraseñas, tokens ni filas
personales de la hoja.

## Operación y recuperación

Overrides activos:

- `crv-api-landing.service.d/zzzzzz-security.conf`: release nueva, modo landing y
  `EnvironmentFile=/home/brian/apps/crv-landing/database-runtime.env` (0600).
- `crv-landing.service.d/zzzzzz-security.conf`: gateway nuevo y confianza CF local.
- `crv-api-landing.service.d/zzzzz-security-sheet-hold.conf`: vacía las credenciales
  de Google para detener únicamente la sincronización.

El rol limitado se creó con `scripts/provision-landing-runtime.ts`. Su archivo de
conexión se guarda fuera del repositorio; el script rechaza sobrescribirlo o rotar
un rol existente. Las credenciales de migraciones no se han cambiado ni publicado.
El rol de la API puede leer tablas del catálogo, pero no modificarlas. No se
cambiaron las cuentas de las personas ni sus permisos de administración en CRV.

Antes de retirar la pausa, comprobar con Drive que no existe permiso anyone y
que la exportación anónima ya no entrega CSV; verificar que la cuenta de servicio
mantiene permiso individual de escritura. Solo entonces retirar el override
security-sheet-hold, daemon-reload y reiniciar la API. El trabajador entrega la
cola automáticamente. No cambiar la aplicación a un endpoint público de Sheets.

No eliminar auth.launch_contacts ni su cola al revertir. Para una recuperación de
emergencia se conservó la release previa, pero retirar el override de seguridad
restauraría privilegios y dependencias antiguos. Mantener siempre la pausa de
Google hasta verificar el cierre del acceso público.

## Fuentes primarias consultadas

- [Aviso de seguridad de Node de octubre](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
- [Versión corregida Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1); se instaló su sucesora 24.22.2 de la misma línea LTS.
- [Aviso de Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- [Aviso de React Router](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6).
- [Compatibilidad oficial del proveedor Zod/Fastify](https://github.com/fastify/fastify-type-provider-zod).
