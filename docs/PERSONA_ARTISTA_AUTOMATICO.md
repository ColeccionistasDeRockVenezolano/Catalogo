# Resolver el artista de una persona con IA

En la ficha de una persona, dentro de **Fiabilidad de la ficha**, la acción
**Resolver artista y buscar información con IA** inicia una tarea guardada.
No necesita una instrucción escrita ni seleccionar manualmente un artista.

El sistema lee las fuentes del informe y, si hace falta, busca nuevas páginas.
La IA identifica la carrera solista, el nombre artístico y el rol musical.
El servidor exige citas literales de páginas leídas que unan ambos nombres;
los resúmenes del buscador y la biografía del catálogo no autorizan altas.

Luego busca por nombre real, nombre artístico, alias, similitud y vínculos.
Reutiliza un único solista compatible o crea el artista si no hay candidatos.
Un proyecto colectivo, varios candidatos, un solista vinculado a otra persona,
una coincidencia aproximada o datos incompatibles quedan como conflicto.
La IA contrasta también la biografía del artista existente antes de vincularlo.
Ser integrante de una banda no implica tener una carrera solista.

La creación, el alias artístico de la persona y su vínculo se aplican juntos,
con el motor de escritura del catálogo, sin permitir altas sobre identidades
parecidas. Se comprueban nuevamente la persona y los candidatos dentro de una
transacción serializable. Los cambios quedan en el historial y se pueden deshacer.
Repetir la acción reutiliza el trabajo activo y conserva un vínculo ya existente.

Después se investigan artista y persona y se guardan sus informes con evidencias
y datos pendientes. La búsqueda usa también los alias artísticos y el nombre de
la persona vinculada; su discografía incluye los discos del solista. Los nuevos
datos quedan disponibles en los informes y en las propuestas de corrección con IA.
Una búsqueda fallida conserva el vínculo y explica la investigación pendiente.

Las tareas continúan al salir de la ficha. Un reinicio las marca interrumpidas
conservando el resultado ya guardado; repetir la acción retoma desde los datos
actuales. Los recursos GET/POST `/curation/ai/persons/:id/resolve-artist` son
privados para administradores y mantienen la autenticación y CSRF existentes.

La migración `0051_person_artist_resolution` agrega la persistencia en `ingest`.
La identificación usa el modelo configurado de curaduría y registra sus llamadas
en `ingest.ai_runs`; la investigación utiliza el flujo de verificación existente.
