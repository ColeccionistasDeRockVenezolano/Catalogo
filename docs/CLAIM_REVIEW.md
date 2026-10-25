# Revisión visual de aportes

La entrada **Curaduría → Revisar aportes** (`/curaduria/aportes`) reúne los
claims candidatos y en conflicto por ficha. Solo pueden acceder administradores.

La lista muestra imagen, nombre, contexto y cantidad de aportes. El detalle
compara el valor actual con cada propuesta. Las imágenes de la ficha se usan
para reconocerla; las imágenes propuestas se muestran en el dato correspondiente.
Cuando no hay imagen disponible se muestra un icono, sin inventar fotografías.

- **Aceptar dato / Confirmar dato** decide únicamente ese claim.
- **Descartar** conserva el claim y su evidencia como rechazados.
- Seleccionar datos permite aceptar o descartar exactamente los seleccionados.
  El servidor rechaza una selección que contenga valores rivales para un campo.
- **Elegir este valor** resuelve las contradicciones abiertas de ese claim por
  el motor de conflictos. Sus pruebas aparecen desplegadas.
- **Comparar y decidir** abre el aplicador específico de identidad, con las
  imágenes y el contexto disponibles. Las identidades ambiguas mantienen sus
  guardas y sus requisitos de decisión.
- **Dejar pendiente** avanza sin modificar los claims. J/K cambian de ficha.
- Las fuentes permanecen identificadas; **Ver evidencia** abre sus extractos y
  enlaces. Las notas adicionales son opcionales: cada acción registra de todos
  modos su alcance exacto, operador y motivo de la decisión.

Al terminar los aportes de una ficha se avanza a otra. Si quedan datos sin
seleccionar, permanecen en revisión. Los filtros y la ficha se conservan en la
URL y el punto de revisión se recuerda por cuenta en el navegador. La revisión
puede continuarse desde el resumen de Curaduría.

Cada acción usa un run transaccional con diario de cambios, historial y
**Deshacer**. Los claims se conservan. La versión enviada incluye la propuesta,
el estado de la ficha, la evidencia y las contradicciones: una vista obsoleta
se rechaza sin aplicar cambios parciales. El aislamiento serializable protege
contra cambios concurrentes durante la decisión.

La lista y los datos se paginan en el servidor (20 fichas, 50 aportes por
página en la interfaz; máximo 100 por petición). El botón de selección indica
su alcance visible; no incluye datos de otras páginas. Las consultas de detalle
usan las claves de destino o identidad indexadas.

No se eleva automáticamente la confianza de una fuente ni se aplican reglas
nuevas de fusión. Aceptar un claim vuelve a pasar por el motor normal; los
casos que todavía no pueden aplicarse quedan pendientes con su explicación.

Validación: `test/contract/claim-review-workbench.test.ts` prueba selección,
versiones obsoletas, separación de homónimos, conflictos, evidencia, deshacer y
serialización. `web/tests/visual/claim-review-qa.mjs` verifica el flujo a 1366,
390 y 320 px con peticiones interceptadas, sin escrituras en el catálogo real.
Las capturas se generan en staging SSD y se publican al cerrar la campaña.
