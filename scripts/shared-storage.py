#!/usr/bin/env python3
"""Comprueba el disco, los enlaces y el recibo del almacén local de capturas."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

PROJECT = Path(__file__).resolve().parent.parent
MOUNT = Path('/mnt/1tb')
STORE = MOUNT / 'Shared/coleccionistas-rock-venezolano'
DISK_UUID = '9036B43536B41E62'
ROOTS = {'data/raw', 'data/research', 'reports', 'web/public/media', 'tmp-analysis'}


def require_disk():
    if not os.path.ismount(MOUNT):
        raise RuntimeError(f'El disco no está montado: {MOUNT}; no crear directorios sustitutos')
    # Esta lectura activa x-systemd.automount antes de consultar el UUID.
    # No se crea nada si el dispositivo está ausente.
    if not STORE.is_dir():
        raise RuntimeError(f'No existe el almacén: {STORE}')
    uuid = subprocess.check_output(
        ['findmnt', '-n', '-o', 'UUID', '--target', str(MOUNT)], text=True
    ).strip()
    if uuid.casefold() != DISK_UUID.casefold():
        raise RuntimeError(f'UUID inesperado en {MOUNT}: {uuid}')


def status():
    plan_path = STORE / 'migration-plan.json'
    plan = json.loads(plan_path.read_text())
    if Path(plan['project']) != PROJECT:
        raise RuntimeError('Este checkout no es el origen de la migración local')
    if Path(plan['destination']) != STORE or set(plan['units']) != ROOTS:
        raise RuntimeError('El plan no corresponde a las cinco rutas del almacén')
    failures = []
    for relative in plan['units']:
        local = PROJECT / relative
        target = STORE / relative
        if not local.is_symlink() or local.resolve() != target or not target.is_dir():
            failures.append(relative)
    receipt = STORE / 'migration-complete.json'
    result = json.loads(receipt.read_text()) if receipt.exists() else None
    complete = bool(result and result.get('phase') == 'complete'
                    and set(result.get('cleaned', [])) == ROOTS
                    and result.get('project') == str(PROJECT)
                    and result.get('destination') == str(STORE))
    print(json.dumps({
        'store': str(STORE), 'migration_complete': complete,
        'links_expected': len(plan['units']), 'invalid_links': failures,
        'receipt': result,
    }, ensure_ascii=False, indent=2))
    return int(bool(failures) or not complete)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status', help='comprobar disco, enlaces y recibo de migración')
    args = parser.parse_args()
    try:
        require_disk()
        return status()
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
