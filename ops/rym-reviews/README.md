# Campaña reviews RYM (2026-10-16) — operación

Captura, con la sesión del dueño, **todas las páginas de reviews** (`/reviews/1..N/`) de los discos
que tienen paginación en RYM (39 discos: 38 de la campaña «nuevos» + 1 de «etapa3»), con **cada
review + su rating**, votos, título, texto y rating por pista cuando la review lo trae.

Alcance decidido por Brian (2026-10-16): sólo los discos con más de una página de reviews; para el
resto, la ficha capturada ya declara el contador (`<h2>N Reviews</h2>`) y no se vuelve a RYM.

## Piezas

| Para… | Comando |
|---|---|
| Armar/actualizar la cola (de las fichas ya capturadas) | `python3 scripts/rym-reviews-cola.py --out data/raw/rym-reviews-2026-10-16/cola-reviews.jsonl` |
| Lanzar (en serie con «resto») | `bash ops/rym-reviews/lanzar.sh` |
| Ver la salud | `bash ops/rym-reviews/estado.sh` |
| Frenar | `systemctl --user stop crv-rym-reviews` |
| Log | `reports/scrapling-rym-reviews.log` |
| Tablero | `file:///tmp/crv-recon/rym-reviews-tablero.html` |
| Datos | `data/raw/rym-reviews-2026-10-16/pages/*.html|.json` + `reviews.jsonl` |

## Una sola sesión contra RYM

El motor (`scripts/rym-reviews-captura.py`) reusa el de la campaña «resto» (Scrapling Camoufox +
cookies del perfil de Firefox del dueño, ritmo humano 5-7 s, enfriamiento ante muro). Dos sesiones
simultáneas provocan tormenta de 503, así que `en-serie.sh` **para «resto», captura las reviews y
la relanza al terminar** (trap EXIT: pase lo que pase, «resto» vuelve; su estado es reanudable).

## Detalles medidos

- Cota de páginas: la de la cola, la del nav y `ceil(total declarado / reviews por página vistos)` —
  la cola decía 8 páginas para Arca «Kick I» y por el total declarado (71) son **9**.
- Muro: 503 suave → enfriar 15-35 s y seguir; 403 Cloudflare → aviso Telegram y enfriar 90-240 s
  (lo destraba el dueño abriendo RYM en su Firefox; hay cliquers en `crv-wall-clicker`).
- Rescate: al final se reintentan las páginas de discos cuya suma de reviews < total declarado
  («si no aparecen, buscar otra vez; si no hay forma, seguir con el siguiente disco»).
- Estado reanudable en `estado.json` (por página); `reviews.jsonl` se re-escribe desde `pages/`.
