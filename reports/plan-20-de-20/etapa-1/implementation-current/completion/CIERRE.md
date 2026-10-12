# Cierre técnico de la etapa 1

La etapa 1 queda completa en implementación y validación técnica: E1-01 a E1-05. La revisión 3 retira el mínimo de ocho personas por instrucción del propietario. Las evaluaciones editoriales y el recorrido del propietario se registran en sus etapas correspondientes; el [guion preparado](../../../../../docs/plan-20-de-20/recorrido-propietario.md) no representa una sesión realizada.

La puerta completa aprobó sobre la huella `744f3f50db59c1cd9b7df806c008f53bf4e8ae23c17ed3bfb57bb2ce92bb3b93`, sin cambios de fuente entre controles. La copia fija parte de `cf60e9c4be8cac51a55890144a3b4267c601c404` y los dos ajustes de [candidate.patch](candidate.patch): el selector del campo requerido en la prueba de navegador y la ayuda del formulario según el tipo de ficha. Código y manifiesto están preservados en [source-manifest.json](source-manifest.json).

| Criterio de salida | Resultado y evidencia |
| --- | --- |
| Calidad reproducible del mismo código | [quality-r4/quality.json](quality-r4/quality.json): tipos, lint, 805 unitarias backend, 55 unitarias web, 537 contratos en 72 archivos, builds backend/web y navegador aprobados. CI incluye unitarias web y navegador con API real. La ejecución remota de GitHub no se atribuye a esta pasada local. |
| Integridad y límites históricos | [Doctor de la base activa](live-current/doctor.log): sin errores; un aviso de procedencia histórica declarado. El diario y las identidades tienen contratos de conservación y deshacer concurrente. |
| Operaciones conservan datos y relaciones | Contratos completos de crear, editar, fusionar, separar, convertir, retirar y deshacer; [54 contratos adicionales](integrated-quality.json) y tipos aprobados en el workspace actual, incluyendo 0063. |
| Fechas y modelo compatibles | 0061 conserva precisión de año, mes, día, aproximación e intervalos. 0062 conserva persona/proyecto, obra/edición/soporte y géneros por período. API y formularios persisten los cambios con motivo e historial; CD/DVD documentados mantienen fichas y pistas. |
| Cuatro artistas y catálogo conservados al migrar | [Restauración y migraciones](staging/migration-check-final.json): conteos exactos de 97 tablas/20.838.173 filas, 7.679 capturas con hash correcto y huellas de todas las filas canónicas iguales antes/después de migrar, revertir y reaplicar 0058–0062. |

La cobertura unitaria aprobó sus umbrales: 38,68 % de sentencias/líneas, 83,68 % de ramas y 50,97 % de funciones; [informe adicional](quality-r4/additional-quality.json). El contrato E9.5 aprobó dentro de la suite completa sobre 117.946 filas: análisis en régimen 3.873 ms y dirigido 160 ms, con los límites originales de 5 s/1 s. La medición en frío fue 7.057 ms y está registrada separadamente en el log.

El [corpus inicial](corpus-r2/manifest.json) contiene 40 fichas, 565 valores para conservación, 100 negativos representativos, 120 documentos cuyos bytes se verificaron y 100 asociaciones de imágenes; 24 fichas de desarrollo y 16 reservadas. Su [comprobación](corpus-r2/verification.json) conserva el significado de las etiquetas: los valores existentes y las asociaciones no reciben aprobación editorial externa automática.

El inventario integra documentos, lecturas, citas literales, hechos y ámbito, conservando captura desconocida y salidas de IA pendientes. Las citas nuevas usan bytes UTF-8 y las coordenadas antiguas conservan su unidad. Los contratos se ejecutaron en UTF8 y SQL_ASCII. La conciliación histórica se comprobó sobre el primer lote de 1.000 claims, con 366 hechos supervivientes vinculados, repetición sin duplicados y conservación al revertir/reaplicar. La herramienta por lotes está implementada; esta comprobación no ejecutó una importación global de los 2,1 millones de claims.

Las migraciones 0058–0062 ya estaban aplicadas en el servicio activo al verificarlo. Se comprobó el [esquema efectivo](live-current/stage-schema.json), el [servicio y sus permisos](live-current/service.json) y la integridad mediante lecturas. El workspace compartido contiene cambios de otras tareas; la puerta completa corresponde a la copia fija indicada y la comprobación adicional cubre la integración focalizada. La aceptación global del 20/20 y las etapas 2–5 mantienen su alcance propio.

El [registro de defectos](DEFECTOS.md) conserva sus reproducciones y correcciones. Las rondas fallidas permanecen como evidencia histórica y no se cuentan como aprobadas.

Para reproducir, usar el commit indicado, aplicar `candidate.patch` y ejecutar con Node ≥22 y Docker:

```sh
npm ci
npm --prefix web ci
npm run quality:evidence -- reports/verification-stage1
npm run test:coverage
```
