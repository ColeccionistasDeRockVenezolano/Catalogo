# Patrones de las capturas Wayback (MySpace)

Eventos: 833 · perfiles intentados: 356 · consultas CDX: 328 · descargas: 133

## Resultado por fuente
- fuente **ma**: 28 intentos · 19 con datos (68 %) · [('ok', 19), ('sin_snapshot', 5), ('sin_datos', 4)]
- fuente **cdx**: 328 intentos · 100 con datos (30 %) · [('sin_clasico', 183), ('ok', 100), ('sin_snapshot', 35), ('sin_datos', 10)]

## Por año del snapshot (¿qué ventana rinde?)
- 2007: 6 intentos · 100 % con datos · campos top [('Influences', 6), ('Band Website', 5), ('Member Since', 5)] · no-ASCII mediano 85
- 2008: 36 intentos · 100 % con datos · campos top [('Member Since', 35), ('Type of Label', 33), ('Band Members', 26)] · no-ASCII mediano 74
- 2009: 61 intentos · 100 % con datos · campos top [('Member Since', 59), ('Band Members', 44), ('Influences', 40)] · no-ASCII mediano 59
- 2010: 16 intentos · 100 % con datos · campos top [('Member Since', 16), ('Band Members', 12), ('Influences', 12)] · no-ASCII mediano 67
- 2011: 8 intentos · 0 % con datos · campos top [] · no-ASCII mediano 98
- 2012: 4 intentos · 0 % con datos · campos top [] · no-ASCII mediano 72
- 2016: 1 intentos · 0 % con datos · campos top [] · no-ASCII mediano 4
- 2024: 1 intentos · 0 % con datos · campos top [] · no-ASCII mediano 4

## Por forma de la URL original
- myspace.com: 231 · {'sin_snapshot': 35, 'sin_clasico': 177, 'sin_datos': 5, 'ok': 14}
- www.myspace.com:80: 96 · {'ok': 88, 'sin_datos': 8}
- www.myspace.com: 23 · {'ok': 16, 'sin_datos': 1, 'sin_clasico': 6}
- ?: 5 · {'sin_snapshot': 5}
- profile.myspace.com: 1 · {'ok': 1}

## CDX: salud y saturación
- latencia: p50 16304 ms · p90 49660 ms · máx 92783 ms
- consultas 328 · vacías 140 (43 %) · sin respuesta 27
- ráfagas de vacíos: [33, 22, 14, 8, 8, 5, 5, 4] (máx 33 seguidos)
- latencia media justo ANTES de un vacío: 24502 ms · DESPUÉS: 25370 ms
- statuses vistos: [('200', 1100), ('301', 1095), ('302', 48), ('-', 26), ('404', 25), ('500', 13)] · consultas con archivo pero sin 200: 105
- forma de URL que rindió (con 200 clásicos): [(None, 178), ('myspace.com', 10)]

## Campos que rinden
- [('Member Since', 115), ('Type of Label', 86), ('Band Members', 85), ('Influences', 84), ('Record Label', 78), ('Sounds Like', 67), ('Band Website', 61), ('Miembro desde', 2), ('Miembros de la banda', 2), ('Tipo de sello', 2), ('Sello discográfico', 1), ('Sitio Web de la banda', 1)]

## Coste
- descargas: 133 · mediana 1666 ms · bytes medianos 155000

## Recomendaciones automáticas
- tasa de datos global: 33 %.
- mejor ventana medida: 2009 (100 % con datos).
- 40 perfiles sin snapshot: reintentar tras respiro del CDX antes de darlos por ausentes (el log lo distingue: una ráfaga de vacíos = saturación).
- si el CDX encadena 4 vacíos: pausa de 300 s (política ya aplicada en el capturador).
