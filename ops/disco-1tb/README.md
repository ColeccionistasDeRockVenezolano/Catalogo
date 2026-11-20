# Disco de 1 TB: apagones y marca NTFS «dirty»

El almacén (`/mnt/1tb`, NTFS, UUID `9036B43536B41E62`) se monta con `ntfs3`. Tras un
apagado brusco el volumen queda «dirty» y `ntfs3` se niega a montarlo
(`volume is dirty and "force" flag is not set`). El 2026-11-20 pasó dos veces
(17:13 y 19:01, cortes de luz: el registro se interrumpe sin secuencia de apagado):
sin disco, `crv-api` moría al arrancar y no había imágenes.

## Tres capas

| Capa | Qué hace | Dónde |
| --- | --- | --- |
| API tolerante | Si `data/research/venezuelan-music-sources.json` no se puede leer, la API arranca igual con un inventario vacío (solo se pierde la investigación dirigida) y reintenta cada 5 min | `src/verification/source-inventory.ts` |
| Montaje con autorreparación | Al arrancar, antes de las sesiones de usuario: espera al disco (hasta 90 s), lo monta y, **solo si el núcleo dijo «dirty»**, ejecuta `ntfsfix -d` y vuelve a montar. Cualquier otro fallo no se toca | `montar-o-reparar.sh` + `crv-disco-1tb.service` |
| Aviso | El vigilante de Hermes (cada 5 min, Telegram) avisa si el disco no está montado y una vez por cada reparación o fallo del arranque | `~/.hermes/scripts/crv-servidor-watchdog.sh` |

## Instalar (una vez, con sudo)

```bash
bash ops/disco-1tb/instalar.sh
```

Copia el script a `/usr/local/sbin/crv-disco-1tb-montar`, la unidad a
`/etc/systemd/system/`, la habilita y la ejecuta una vez (con el disco montado
solo escribe «ya estaba montado»). Registro: `/var/log/crv-disco-1tb.log`;
último evento: `/var/lib/crv-disco-1tb/ultimo-evento.json`.

Probar la lógica sin root: `bash ops/disco-1tb/prueba-montar.sh` (cinco casos con
comandos falsos: ya montado, normal, dirty, otro error, sin disco).

## Decisiones

- **No `force` en fstab**: montaría también volúmenes con daños reales sin dejar
  rastro. La reparación automática se limita al caso «dirty» y queda registrada.
- **Montar con `systemctl start mnt-1tb.mount`**, nunca `mount` a mano: con el
  automontaje de fstab, un `mount` manual se apila y deja dos capas
  (`shared-storage.py status` falla con «UUID inesperado»).
- **`ntfsfix -d` no es un chkdsk.** Corrige `$MFTMirr`, vacía el journal y quita
  la marca. Si las reparaciones se repiten, pasar `chkdsk /f` desde Windows.
- **Pasar a ext4** sería lo más robusto (fsck y journal automáticos), pero el
  disco tiene 827 GB usados de 931 y no hay otro destino para mover los datos.

## La causa: cortes de luz

La máquina es un escritorio sin batería. Lo único que evita el problema de raíz
(también protege PostgreSQL y el SSD) es un **UPS** con puerto USB y `nut`
(`upsmon`) configurado para apagar en orden cuando la batería baja.

## Reparación manual (si la automática falla)

Parar lo que use el disco, desmontar todas las capas, reparar y montar:

```bash
sudo umount /mnt/1tb            # repetir mientras findmnt /mnt/1tb muestre algo
sudo ntfsfix -d /dev/disk/by-uuid/9036B43536B41E62
sudo systemctl reset-failed mnt-1tb.mount mnt-1tb.automount
sudo systemctl start mnt-1tb.mount
findmnt /mnt/1tb                # una sola línea
systemctl --user reset-failed && systemctl --user restart crv-api
```
