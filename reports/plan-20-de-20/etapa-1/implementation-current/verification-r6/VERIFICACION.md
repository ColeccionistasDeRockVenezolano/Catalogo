# Verificación completa de la copia aislada · ronda 6

**La puerta técnica local aprobó; la etapa 1 sigue incompleta.** Se verificó
una copia aislada para evitar atribuir resultados a código que cambiaba durante
la ejecución. La comparación final confirma que el código del workspace
coincide con esa copia, después de terminar también la cobertura.

Huella SHA-256 del conjunto de 1.133 archivos de código/configuración:
`f792e196a064bba4f65125906bc4b0898e5124cc120c5da361cfe8ac5974139c`.
HEAD de referencia: `2857dfeb6a8064ef7a200a6852f9245265487ef2`, con cambios
sin commit. Ejecución UTC: 2026-10-10 23:59:53 a 2026-10-11 00:15:45;
la cobertura terminó después. Fecha local: 10 de octubre de 2026.

| Comprobación | Resultado |
| --- | --- |
| Tipos y lint | Código de salida 0 |
| Unitarias backend | 796/796 · 80 archivos |
| Unitarias web | 55/55 · 9 archivos |
| Contratos completos | 504/504 · 71 archivos · 699,95 s |
| Compilaciones backend y web | Código de salida 0 |
| Navegador real | SPA compilada y PostgreSQL aislado; login, roles, CSRF y edición persistida; acceso administrativo al inventario |
| Cobertura de unitarias backend | Código de salida 0; 38,68 % líneas/sentencias · 83,57 % ramas · 51,28 % funciones |
| Rendimiento E9.5 | 117.946 filas: régimen 4.373 ms < 5.000; dirigido 137 ms < 1.000; frío registrado aparte: 8.933 ms |
| Base publicada, consulta de solo lectura | 12 tablas canónicas completas y cuatro identidades iguales a la ronda 4; última migración: 0057 |

Los ocho pasos de `quality.json` mantuvieron exactamente la misma huella.
La cobertura también terminó con esa huella. Se conservaron los umbrales de
rendimiento y cobertura. El informe de cobertura incluye 296 archivos; sus
denominadores de líneas difieren de los de rondas anteriores, por lo que estos
porcentajes no se presentan como un incremento comparable de cobertura.
Node local: `v24.21.0`. No se atribuye una pasada de CI externa con Node 22.

## Evidencia conservada

- [Resultado de los ocho pasos](quality.json), con códigos de salida y huellas.
- [Resumen](verification-summary.json), [comparación de código](source-comparison.json)
  y [conservación del catálogo](catalog-conservation.json).
- Logs de cada paso y [cobertura](coverage.log), con su [resumen JSON](coverage-summary.json).
- [Copia del código/configuración](source-f792e19.tar.gz), comprobada archivo
  por archivo contra el [manifiesto y hash del archivo](source-snapshot.json).
  No incluye `.env`, dependencias ni datos; no es un respaldo completo.
- Checkout aislado: `/mnt/datos/crv-stage1-verification-20261010`.

La [ronda 4](../verification-r4/VERIFICACION.md) describe los cambios del
inventario 0060 y las correcciones de captura, citas, repetición de aplicación,
concurrencia y reversión sin pérdida de evidencia. Esta pasada completa
incorpora también los cambios posteriores de verificación de personas.
La [ronda 5](../verification-r5/VERIFICACION.md) conserva la ejecución que
aprobó sus pruebas pero fue rechazada por cambios de código durante la suite.

## Trabajo pendiente de la etapa 1

- Integrar las fechas parciales en campos vigentes, API y formulario; completar
  persona/identidad musical y obra/edición/soporte. El inventario conserva
  fechas tipadas, pero eso no completa esos modelos.
- Integrar todas las extracciones de hechos y conciliar el historial. La
  conservación de documentos está conectada a la lectura de páginas; falta
  completar los escritores de relaciones y ámbitos de edición/período.
- Completar el corpus etiquetado, la línea base de uso y la revisión editorial.
  El usuario confirmó que solo él está disponible; no se atribuyen ocho
  participantes ni sesiones realizadas.
- Verificar CI externa y preparar la publicación del candidato. Las migraciones
  0058–0060 no se han aplicado a la base publicada.
