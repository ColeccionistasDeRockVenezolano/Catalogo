# Verificación del inventario persistente · ronda 4

**Etapa 1 incompleta. La pasada técnica completa de esta ronda aprobó sobre
la huella `1db73df…`.** Después de terminar también la cobertura cambiaron
dos archivos de verificación de personas. La huella posterior `c8647e3…`
aprobó 95 pruebas dirigidas, tipos y lint; no se le atribuye una pasada global.
`quality.json` y `verification-summary.json` distinguen ambos resultados.

## Resultados comprobados

| Comprobación de la versión `1db73df…` | Resultado |
| --- | --- |
| Tipos y lint | Código de salida 0 |
| Unitarias backend | 793/793 · 80 archivos |
| Unitarias web | 55/55 · 9 archivos |
| Contratos completos | 504/504 · 71 archivos · 681,33 s |
| Compilaciones backend y web | Código de salida 0 |
| Navegador real | SPA compilada, API y PostgreSQL aislados; login, roles, CSRF y edición persistida; lector sin acceso al inventario |
| Cobertura | 35,20 % líneas/sentencias · 82,63 % ramas · 47,66 % funciones; umbrales originales aprobados |
| Rendimiento E9.5 | 117.946 filas: régimen 3.967 ms < 5.000; dirigido 143 ms < 1.000; frío registrado aparte: 7.778 ms |
| Conservación de la base real | 12 tablas canónicas completas y cuatro identidades iguales a la ronda 3; última migración real: 0057 |

La puerta de ocho pasos mantuvo la misma huella en cada comprobación. La
cobertura terminó antes de las modificaciones posteriores, según sus
marcas de escritura. Node local: `v24.21.0`; no se atribuye una pasada de CI
con Node 22. Los logs y códigos de salida son evidencia local.

La huella posterior modifica `src/ambiguity/person-web-verification.ts` y
su test unitario: amplía la aposición de nombre real/nombre artístico en el
caso Mayra Martí. Se comprobaron 90 pruebas de verificación/comparación,
cinco contratos de investigación de pares, tipos y lint. Ambos archivos y
la huella permanecieron iguales al finalizar esas comprobaciones. Los
resultados están en `post-quality-*.log` y `post-quality-source.json`.
La pasada global del código posterior permanece pendiente.

## Cambio revisado

La migración 0060 añade documentos preservados, recibos de lectura,
fragmentos literales, afirmaciones tipadas, enlaces a evidencia y destinos
vigentes. `WebSearchBroker.page()` conserva el documento al obtener o releer
una página. La API administrativa permite consultar documentos, lecturas y
hechos; registrar citas y afirmaciones; y aplicar campos admitidos mediante
el escritor editorial existente.

Los documentos y afirmaciones son inmutables. El destino vigente y su
decisión editorial se registran en el diario estricto. Se retiene la
identidad original al fusionar, aunque el destino vigente cambie; deshacer
puede eliminar el destino de una afirmación y mantiene su evidencia.

El contrato admite estado pendiente, verificado, contradicho, no comprobable
y editorial. Una afirmación automática no puede declararse verificada o
editorial. Verificar exige un fragmento preservado con captura conocida por
HTTP o archivo original. Aplicar explícitamente una decisión editorial no
convierte una afirmación no comprobable en un hecho verificado.

## Decisiones y defectos corregidos

| Problema | Decisión | Impacto y prueba |
| --- | --- | --- |
| Releer una fuente podía aparentar una captura nueva | Conservar documento y captura; añadir recibos de lectura separados | Misma identidad de documento, fechas originales y múltiples lecturas; contrato de captura y consulta paginada |
| JavaScript podía truncar microsegundos o diferenciar husos de un mismo instante | Identidad normalizada en PostgreSQL sin convertir el instante a `Date` | Captura `.123456` preservada; otra representación de huso reutiliza el documento |
| Años, fechas sin huso y fechas imposibles podían aceptarse como adquisición | Exigir instante completo y calendario válido | 14 unitarias de procedencia; una fecha legible no acredita método desconocido |
| Offsets de JavaScript podían cortar caracteres astrales | Contar puntos de código y comprobar cita en PostgreSQL | Fragmento después de `🎸`; citas y offsets falsos rechazados |
| Un hecho aplicado podía repetirse y pisar una edición posterior | Releer destino bajo bloqueos; repetición sin escrituras solo si el campo conserva el valor | API devuelve 409 tras otra edición; la repetición válida no crea claims ni cambios de catálogo |
| Una fusión o deshacer podía cambiar el destino entre lectura y aplicación | Bloquear padre y vínculo y comprobar de nuevo su identidad | Dos transacciones reales: rechaza el destino cambiado sin aplicar el valor |
| Fechas y períodos inválidos podían entrar por SQL directo | Validar estructura, precisión, calendario e intervalos en la base | Rechaza 30 de febrero, precisión incompatible, año fraccionario e intervalos vacíos o invertidos |
| Revertir la función podía borrar el inventario | Mover las seis tablas y secuencias a `crv_evidence_archive` y recuperarlas al reaplicar | Filas completas y core idénticos después de revertir/reaplicar dos veces; secuencias y restricciones conservadas |

## Límites de esta entrega

- No se ha publicado el candidato ni aplicado 0058–0060 a la base real.
- Las fechas parciales ya se conservan en afirmaciones del inventario; falta
  su integración en campos vigentes, API de personas y formulario.
- Los ámbitos de edición usan IDs del catálogo existente. Falta completar
  la separación obra/edición/soporte y persona/identidad musical.
- El inventario de documentos está conectado a la lectura de páginas.
  Falta integrar todas las extracciones de hechos y conciliar claims e
  informes históricos. No se declara completada la extracción global.
- Las relaciones y los hechos acotados a edición/período se conservan y no
  se proyectan mediante un campo global. Sus escritores específicos faltan.
- La pasada global posterior a los dos cambios de personas, el corpus
  reservado, CI externa y revisión editorial siguen pendientes.
  Solo el usuario está disponible; no se atribuyen ocho sesiones realizadas.

Los fallos intermedios se conservan en `development/`: lint detectó una
asignación innecesaria y una versión del validador SQL falló por sintaxis;
ambos se corrigieron antes de la pasada completa. Los contratos siguientes
aprobaron. Esos logs de desarrollo no sustituyen la puerta final.
