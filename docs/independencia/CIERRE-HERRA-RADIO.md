# Separación operativa de Herra: radio y www

Cerrada el 2026-11-04 02:36–02:40 UTC (2026-11-03 en Caracas), por instrucción de Brian:
«finaliza lo que falta de la forma recomendada». Este registro sustituye los pendientes sobre
export, géneros, hoja y www de FASE3 §5 y §8. No es la entrega de la Fase 4.

## Estado instalado

- `crv-api-landing` continúa con su release `traffic-20261104`; el entorno efectivo del proceso
  lee `CRV_RADIO_DATA_DIR=/mnt/datos/crv-radio/catalogo` y la credencial propia
  `/home/brian/apps/crv-radio/secrets/service-account-radio-sheet.json` (0600, directorio 0700).
  Estado y logs siguen en `/mnt/datos/crv-radio/{estado,logs}`. La copia antigua se conserva para
  recuperación; ningún trabajo nuevo necesita el directorio de Herra.
- `crv-radio-catalogo.service` ejecuta la copia fijada `~/apps/crv-radio-catalogo`, con el entorno
  de PostgreSQL leído por `CRV_ENV_FILE`. Sincroniza YT Master y después exporta versión 3, tipos,
  géneros y vetos desde PostgreSQL. Mantiene orden y duraciones anteriores, escritura atómica,
  cerrojo compartido y límite de retiradas. No llama a Herra ni consulta YouTube para exportar.
- `crv-radio-catalogo.timer`: habilitado y persistente, 04:00 de America/Caracas. Probado con una
  activación adicional `OnActiveSec=3s` del mismo timer instalado, retirada tras el ensayo.
  Activación efectiva a las 02:36:30 UTC, final correcto a las 02:36:38. La próxima diaria es
  2026-11-04 08:00 UTC; no se presenta el ensayo como una ejecución a las 04:00.
- `ops/youtube-canal/nuevo.sh` llama al mismo servicio después del alta y enriquecimiento.
  Se actualizaron el árbol compartido y los scripts externos de las releases ya publicadas
  `traffic-20261104`, `hotjar-20261103` y `6cf055b8`; no se cambió su aplicación ni su cliente.
  El comando horario `intake` y el verificador `availability` también piden el refresco al
  terminar. `--dry-run` no lo pide.
- `crv-www-redirect.service`: habilitado, Node en 127.0.0.1:3020. Responde 308 al origen fijo
  `https://coleccionistasderockvenezolano.com`, conserva ruta y query y no pone cookies.
  Cloudflare conserva su configuración. Ese puerto es solo una redirección, no un respaldo de
  la portada: si se necesita recuperar la portada antigua, primero hay que arrancar Herra.
- `herra-crv` detenido y retirado de PM2 y de su dump persistente. Retirado únicamente su bloque
  de crontab (respaldo/alertas; el export antiguo ya no estaba programado). Se conservan código,
  datos antiguos y una configuración privada para recuperación. El túnel `cloudflared-herra-crv`
  sigue activo: es el transporte del dominio y no depende del motor Herra. La central personal,
  sus tareas y las demás aplicaciones siguen activas.

## Comprobaciones

- Trabajo real independiente, con credencial nueva: 571 videos Listed; ninguna fila, estado,
  fecha ni orden cambiado en Sheets. Se conserva una posible duplicidad preexistente para
  revisión; este cambio no la resuelve ni la oculta.
- Catálogo: 5.547 piezas, 518 videos, 359,2 h, todas con género confirmado, 8 videos con veto
  parcial. Cero altas/bajas respecto del catálogo copiado. Hash lógico servido por la radio:
  `e45f80bce131abbe`, igual al anterior.
- Después de detener Herra, el timer ejecutó hoja + export correctamente (exit 0).
- 28/28 pruebas del catálogo, merge, estados de hoja, regiones y motor; typecheck y ESLint
  dirigido correctos. 3/3 pruebas Node: cadena de alta con éxito, cadena con fallo de intake
  que aun así llega a radio, redirección sin confiar en Host ni URL externa.
- Dominio: lista blanca 104/104; www devuelve 308 sin cookie Herra tanto en `/` como en
  `/registro?lang=en`; Funnel `/crv/` devuelve 200. API `/radio/now` responde normalmente y
  entorno efectivo del proceso confirma las rutas propias.
- El reinicio de la API tardó unos 26 s hasta escuchar; la primera espera de 20 s resultó
  insuficiente. No hubo que revertir. No se reiniciaron `crv-api` ni `crv-web` del catálogo.
- No se repitió una escucha larga en teléfono: el cliente y el motor publicado no cambiaron.
  La prueba de la cadena de alta usa ejecutores simulados para evitar crear fichas de prueba
  en producción; el trabajo final y su activación por timer sí se ejecutaron realmente.

Evidencia sin secretos: `reports/cierre-herra-radio-2026-11-04/`.

## Vuelta atrás

Respaldo privado local: `/mnt/datos/crv-radio/transicion-independencia/`, 0700. Incluye los
entornos anteriores, crontab, configuración PM2 y la instantánea de radio. No publicarlo en
reports ni Git: contiene secretos. No hay que restaurar PostgreSQL para deshacer este cambio.

1. Detener `crv-radio-catalogo.timer` y esperar que termine el servicio si está activo.
2. Detener/deshabilitar `crv-www-redirect`; arrancar únicamente Herra CRV con
   `pm2 start /mnt/datos/crv-radio/transicion-independencia/herra-crv-rollback.json` y `pm2 save`.
3. Si se necesita volver al lector antiguo, copiar `api.env` del respaldo sobre
   `~/apps/crv-landing/api.env` (0600) y reiniciar solo `crv-api-landing`. El catálogo antiguo
   permanece intacto. Para reactivar escritores antiguos, apagar antes el trabajo de CRV:
   nunca dos exportadores sobre el mismo archivo.
4. No restaurar el crontab completo automáticamente: reponer solo el bloque `herra-crv` desde
   `crontab.antes`, conservando cualquier cambio posterior de otras aplicaciones.
5. Comprobar radio, dominio, www, lista blanca y Funnel. Los scripts externos antiguos de las
   releases se conservaron en el respaldo por si se decide revertir también los ganchos.

Para un traslado a otro host, copiar catálogo, estado y credencial por separado; configurar
`CRV_RADIO_DATA_DIR`, `CRV_RADIO_STATE_DIR`, `CRV_RADIO_SHEET_CREDENTIALS` y
`CRV_RADIO_EXPORT_PATH`; adaptar WorkingDirectory y el ejecutable Node de las unidades.
Rotación/transferencia de la credencial y restauración completa siguen siendo Fase 4.
