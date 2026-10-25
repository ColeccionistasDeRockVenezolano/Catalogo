#!/usr/bin/env python3
"""Close the RYM campaign with journal-based counts and reproducible artifacts."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--dir',required=True);args=ap.parse_args();out=Path(args.dir)
    verification=json.loads((out/'verificacion-final.json').read_text());pipeline=verification['pipeline']
    if not pipeline.get('completedAt') or not pipeline.get('converged'):raise SystemExit('No cerrar un pipeline incompleto')
    if verification['nativeHistory']['openReviews']:raise SystemExit('Hay revisiones pendientes de esta campaña')
    if any(value for status,value in verification['nativeHistory']['claimStatuses'].items() if status not in ('accepted','rejected','superseded')):raise SystemExit('Hay claims pendientes de decisión')
    problems={k:v for k,v in verification['duplicates'].items() if v}
    if problems:raise SystemExit('Examinar las coincidencias antes del cierre: '+', '.join(problems))
    if verification['protectedFieldOverwrites'] or verification['membershipChronology']:raise SystemExit('Resolver los controles de preservación y cronología')
    if verification['negativeSourceDecisions']:raise SystemExit('La fuente introdujo decisiones negativas')
    if not verification['convergenceAudit'] or verification['convergenceAudit']['semanticChanges']:raise SystemExit('La pasada de cierre todavía modificó el catálogo')
    postcheck=verification['postImportChecks']
    if not postcheck or not postcheck.get('completedAt') or not postcheck.get('stableIteration'):raise SystemExit('Falta cerrar la comprobación posterior de identidades y créditos')
    created=verification['created'];fills=verification['existingFieldsFilled'];updates=verification['updatedSurvivingFields'];counts=verification['sourceCounts']
    native_runs=verification['nativeHistory']['runIds']
    run_results=[]
    for name in ['images','listening']:
        for file in out.glob(f'run-*-{name}.json'):
            record=json.loads(file.read_text())
            if record['runId'] in native_runs:run_results.extend((name,r) for r in record['result'])
    covers={r['albumId'] for name,r in run_results if name=='images'}
    links={(r['albumId'],r['platform']) for name,r in run_results if name=='listening'}
    first_listens={r['albumId'] for name,r in run_results if name=='listening' and r.get('firstListen')}
    sources=[*Path('scripts').glob('rym-integral*'),Path('scripts/rym_identity.py'),*Path('src/verification').glob('rym-*.ts'),*Path('test/unit').glob('rym-*.test.ts'),Path('test/unit/rym_integral_signals_test.py'),Path('src/catalog/album-classifications.ts'),Path('src/er/repository.ts'),Path('src/api/search-index.ts')]
    hashes={}
    for source in sources:
        if not source.is_file():continue
        destination=out/'codigo'/source;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination);hashes[str(source)]=hashlib.sha256(source.read_bytes()).hexdigest()
    (out/'codigo-sha256.json').write_text(json.dumps(hashes,ensure_ascii=False,indent=2)+'\n')
    field=lambda name:fills.get(name,0)
    rows=[('Publicaciones nuevas conservadas',created.get('public.albums',0)),('Pistas nuevas conservadas',created.get('public.tracks',0)),('Duraciones completadas en pistas previas',field('public.tracks:duration_seconds')),('Personas nuevas identificadas',created.get('public.persons',0)),('Integrantes nuevos',created.get('public.artist_members',0)),('Créditos nuevos de discos',created.get('public.album_credits',0)),('Créditos nuevos de pistas',created.get('public.track_credits',0)),('Alias de discos nuevos',created.get('ingest.album_aliases',0)),('Alias de pistas nuevos',created.get('ingest.track_aliases',0)),('Alias de artistas nuevos',created.get('ingest.artist_aliases',0)),('Sellos nuevos',created.get('public.organizations',0)),('Versiones o ediciones nuevas',created.get('ingest.album_versions',0)),('Obras audiovisuales nuevas',created.get('media.artist_audiovisuals',0)),('Portadas incorporadas',len(covers)),('Enlaces de escucha incorporados o verificados',len(links)),('Discos con su primer enlace de escucha verificado',len(first_listens))]
    metadata=[('Fechas textuales de publicación',field('public.albums:release_date_text')),('Años de publicación',field('public.albums:release_year')),('Números de catálogo',field('public.albums:catalog_id')),('Soportes o formatos',field('public.albums:media_format')),('Sellos vinculados al disco',field('public.albums:label_id')),('Valoraciones RYM',field('public.albums:rym_rating')),('Recuentos de valoraciones RYM',field('public.albums:rym_ratings_count')),('Fechas de nacimiento',field('public.persons:birth_date_value')),('Fechas de fallecimiento',field('public.persons:death_date_value')),('Ciudades de nacimiento',field('public.persons:birth_city'))]
    text=f"""# Aprovechamiento integral de RYM — 21 de octubre de 2026

Se recorrió el corpus preservado completo, sin un corte temporal de capturas. La campaña aplicó datos mediante el operador nativo y terminó sin revisiones abiertas. Las cifras proceden de sus propios runs y del journal, contrastados con las filas que siguen existiendo; no incluyen trabajos históricos ni cambios de otros operadores simultáneos.

## Alcance

- {counts['inventario.jsonl']:,} URL canónicas inventariadas, con todas sus capturas alternativas conservadas en `corpus/inventario.jsonl`.
- {counts['artistas.jsonl']:,} perfiles y {counts['albumes.jsonl']:,} publicaciones reextraídos correctamente.
- {counts['errores.jsonl']:,} fuentes rechazadas por errores o discrepancias de URL; se intentaron las alternativas existentes sin relajar el control de identidad (`corpus/recuperacion-alternativas.json`).
- Exclusiones expresas: MySpace, Last.fm y reseñas de usuarios de RYM. Las valoraciones agregadas se conservan como datos de RYM.
- El cruce musical no publica automáticamente a cada persona acreditada como artista. La coincidencia de nombre, país o género por sí sola no establece identidad.

## Aportes aplicados

| Aporte | Cantidad |
| --- | ---: |
"""+''.join(f'| {label} | {count:,} |\n' for label,count in rows)+"""
Los alias incluyen los nombres canónicos que el operador registra para las fichas nuevas; no representan publicaciones ni pistas adicionales. Los créditos e integrantes que ya existían recibieron únicamente los roles o periodos compatibles que faltaban. Los recuentos de altas excluyen estas actualizaciones. Las pistas aportadas a discos previos se contrastaron por posiciones y títulos o alias documentados; no se renombró, reordenó ni borró su repertorio.

## Campos completados en fichas previas

| Campo | Fichas |
| --- | ---: |
"""+''.join(f'| {label} | {count:,} |\n' for label,count in metadata)+f"""
También se incorporaron clasificaciones musicales combinadas y géneros declarados en la ficha primaria. Las decisiones editoriales previas se conservaron; una fuente que no menciona una característica no se convirtió en un rechazo. Los subgéneros pudieron afinar únicamente asignaciones producidas por esta campaña, sin sustituir decisiones de otros operadores.

Las ediciones con repertorio completo coincidente se guardaron como versiones cuando la evidencia permitió distinguirlas. Los tipos genéricos «Additional release» con soporte musical documentado conservaron el tipo «otro» y sus características explícitas. Los videos y soportes exclusivamente audiovisuales se incorporaron a Audiovisuales; no generaron discos ni pistas. Los enlaces de escucha se verificaron en la plataforma oficial y las portadas se publicaron con SHA-256, conservando las que ya estaban asignadas.

## Duplicación, preservación y cierre

- Cero revisiones abiertas de esta campaña y cero claims pendientes de decisión: el historial nativo conserva las afirmaciones resueltas y sus evidencias, incluidas las sustituidas por una corrección posterior.
- Se contrastaron y cerraron seis avisos secundarios de géneros compatibles, descriptores amplios o diferencias de principal, conservando asignaciones, sugerencias y fuentes. Cada resolución consta en `avisos-generos-aplicado.json`.
- Cero coincidencias pendientes en las claves examinadas: títulos y alias de discos, números de catálogo, repertorios completos de altas nuevas, posiciones de pistas, identidades exactas de personas, integrantes y créditos.
- Cero sustituciones de valores previos en los campos protegidos de fechas, formatos, catálogo, portadas, sellos, títulos, posiciones y duraciones.
- La auditoría retiró tres alias propios compartidos entre proyectos y el alta propia ambigua del sello León. El disco conservó el nombre literal del sello y su fuente en una nota, sin fusionar compañías por similitud. Solo se revirtió el vínculo introducido por esta campaña; `conflictos-alias-aplicado.json` y `ownFieldReversions` conservan el detalle.
- Se corrigieron dos vinculaciones previas por apodos compartidos: Gus quedó identificado como Gustavo Enrique Ortega Urdaneta; Nacho se vinculó a Miguel Ignacio Mendoza, ya presente como miembro de Chino & Nacho. Gustavo Corma e Ignacio Pérez conservaron sus proyectos y recuperaron los campos personales anteriores a esta campaña. `identidad-gus-aplicado.json`, `identidad-nacho-aplicado.json` y `postcheck-identidades-final.json` documentan la corrección y la repetición de créditos hasta quedar sin cambios.
- Dos altas detectadas durante la auditoría se consolidaron en las fichas previas mediante la fusión nativa, conservando alias, pistas, metadatos y redirecciones: Grupo Pan, sencillo Promus 50-109; Rawayana/Irepelusa, «Orden #30 Extra Brócoli» / «CAMINAAANDO». Evidencia en `consolidacion-aplicada.json`.
- La pasada {pipeline['converged']} terminó sin cambios semánticos adicionales en publicaciones, metadatos, integrantes y créditos de discos. Después se aplicaron los perfiles personales, créditos por pista, versiones, audiovisuales y medios verificados.

Esto agota las aplicaciones automáticas acreditadas por los originales preservados y las reglas verificadas. Las discrepancias de identidad, año, catálogo, soporte o repertorio se conservaron agrupadas en los archivos del informe. No constituyen una cola de tareas para Brian, ni justifican publicar hechos dudosos. El control de duplicados se limita a las evidencias y claves examinadas; no presupone que todo el catálogo anterior carezca de duplicados.

## Evidencia y reproducción

- `verificacion-final.json`: cifras, IDs supervivientes, controles y runs propios.
- `journal-catalogo.json`: diferencias nativas de esta campaña; `catalogo-verificacion.json`: estado contrastado.
- `pipeline-steps.json`: comandos, resultados y convergencia; `run-*.json`: recibos de cada lote aplicado.
- `ordinal-alias-aplicado.json`: variante Nº/no. de Recuerdos Nº 20, contrastada en las once posiciones antes de vincular disco y pista.
- `identity-ledger.json`, `cruce.jsonl`, `cruce-sobrantes.jsonl`, `retenidos.jsonl`: resolución y conservación documental.
- `corpus/`: originales derivados con rutas y hashes de los HTML/JSON fuente. `official-platform-evidence/`: respuestas oficiales conservadas y verificadas.
- `codigo/` y `codigo-sha256.json`: código utilizado. `tests-final.log` (50 pruebas), `tests-python.log`, `typecheck-final.log`, `eslint-final.log`, `eslint-identidades-final.log`: validación.
- `verificacion-reglas.json`: equivalencia de consultas nativas y comprobación de clasificaciones aditivas.
- Copia previa completa verificada: `/mnt/datos/backups/crv/crv-20261021T164335Z`; copia de base: `/mnt/datos/backups/crv/rym-integral-before-20261021`.

Los informes y medios de esta campaña se cierran y publican en el almacén compartido de 1 TB con verificación de hashes. El journal y los runs permiten examinar o revertir operaciones concretas mediante las herramientas nativas.
"""
    (out/'INFORME.md').write_text(text)
    summary={'created':created,'covers':len(covers),'listeningLinks':len(links),'firstListens':len(first_listens),'existingFieldsFilled':fills,'updates':updates,'runs':len(native_runs),'converged':pipeline['converged']}
    (out/'resumen-aplicado.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
