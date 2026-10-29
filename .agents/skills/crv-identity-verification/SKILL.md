---
name: crv-identity-verification
description: Contrasta identidades de artistas y bandas venezolanas con evidencias verificables antes de afirmar o fusionar fichas. Úsala al resolver homónimos, alias, países o integrantes.
version: 1.0.0
---

# Verificación de identidad (CRV)

Una identidad **no** se deduce por nombre, país o género. Se establece con evidencia
documentada y, cuando hay ambigüedad, se envía a revisión.

## Regla de evidencia

Un dato de identidad se acepta cuando cumple **al menos dos** de estas vías, y al menos una
es primaria:

- nombre y alias documentados (web oficial, sello, prensa);
- año y ciudad de formación;
- integrantes coincidentes (nombre + instrumento);
- discografía coincidente (título + año + sello);
- enlaces oficiales verificados (skill `crv-webs-oficiales`).

Formato obligatorio por afirmación:

```
DATO: <afirmación>
EVIDENCIA 1: <URL> — <fecha consulta> — "<cita literal>"
EVIDENCIA 2: <URL> — <fecha consulta> — "<cita literal>"
CONCLUSIÓN: confirmado | probable | ambiguo | descartado
```

## Procedimiento

1. Reúne todos los candidatos homónimos antes de comparar (Discogs, MusicBrainz, Last.fm,
   YouTube, prensa). No empieces asumiendo que son la misma banda.
2. Compara el eje fuerte: integrantes + discos. El nombre solo no identifica.
3. Distingue proyecto personal, banda, alias y colectivo; un mismo músico puede tener varios.
4. Si dos candidatos comparten nombre pero no integrantes ni discos, son identidades distintas:
   no fusiones.
5. Toda ambigüedad va a revisión con las dos versiones y sus URLs; nunca a "lo más probable".
6. Registra la decisión y su evidencia en el informe de la campaña.

## Señales de alarma

- Solo coincide el nombre y el país.
- Un blog copia a otro sin fuente original (cadena de copias, no dos fuentes).
- Fechas incompatibles con la existencia del sello o de la plataforma.
- Integrantes que nunca coinciden en ninguna fuente contemporánea.

## Referencias internas

- `docs/decisions/2026-10-06-verificacion-web-personas.md`
- Skill `verificacion-origen-artistas` (país/origen de un catálogo completo).
- Skill `evidence-web-sweep` (barrido masivo de evidencia por lote).
- Skill `crv-biografias-fusion` (al sintetizar biografías ya verificadas).
