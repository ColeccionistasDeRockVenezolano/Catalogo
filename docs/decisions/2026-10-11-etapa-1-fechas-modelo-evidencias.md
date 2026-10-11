# Etapa 1: fechas, modelo musical e inventario

La revisión 3 del contrato incorpora la retirada del mínimo de ocho participantes solicitada por el propietario. La implementación mantiene la conservación, la auditoría y la separación entre comprobación técnica y aprobación editorial.

0061 añade textos canónicos de nacimiento y fallecimiento: año, mes, día, aproximación e intervalos. Las columnas DATE existentes son proyecciones exclusivamente de días exactos; no se reinterpretan los primeros de enero históricos. SQL y API rechazan calendarios inválidos y cronología definitivamente imposible. Al revertir, la precisión se archiva; reaplicar aborta si una escritura antigua cambió las fechas mientras tanto.

0062 añade obras, metadatos de edición, identidades musicales, soportes y géneros acotados por período. Los discos anteriores conservan una edición propia sin inferir una obra compartida a partir del título. Persona y proyecto se vinculan por decisión explícita. Las pistas de un soporte deben pertenecer a su edición y número de disco; los cambios posteriores de los padres también se comprueban. Las nuevas tablas tienen claves, índices y diario; el rollback las archiva y la reaplicación restaura sus relaciones.

La edición del catálogo ofrece estos vínculos en los formularios existentes, con selector de entidad, precisión temporal y motivo. Los cambios quedan en el historial y pueden deshacerse. La fecha estructurada de la edición se presenta en la ficha sin sustituir el texto histórico de publicación.

Guardar una verificación incorpora todas sus afirmaciones y sugerencias al inventario. Solo una cita que coincida literalmente con el documento conservado de la versión se convierte en fragmento; las citas no resolubles permanecen registradas con motivo. Una salida de IA nunca obtiene aprobación documental humana. La conciliación histórica conserva la instantánea íntegra de cada claim sobreviviente, no cambia el catálogo y no atribuye capturas desconocidas.

Los fragmentos nuevos usan offsets en bytes UTF-8 y validación literal sobre bytes, compatibles con UTF8 y con el SQL_ASCII real del catálogo. El API declara la unidad. Una reactivación de un inventario anterior conserva sus coordenadas nativas y su unidad explícita; no las reinterpreta. Los contratos del inventario se ejecutan en ambos encodings.

El corpus reproducible etiqueta valores existentes para conservación: no transforma el contenido del catálogo en verdad externa. Las asociaciones de imágenes tampoco afirman una revisión visual realizada. La evidencia final se guarda en reports/plan-20-de-20/etapa-1/implementation-current/completion/.

El respaldo usa una instantánea MVCC exportada para que el dump y los conteos describan exactamente las mismas filas mientras otros procesos escriben caché. La comprobación de restauración utiliza una base aislada y verifica los hashes de las capturas y la conservación canónica antes y después de migrar, revertir y reaplicar.
