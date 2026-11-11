#!/usr/bin/env python3
"""Publishable account of the verified source-attributed Antologia imports."""
import argparse
import collections
import csv
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]


def main(out):
    load=lambda name:json.loads((out/name).read_text())
    verified=load('verification.json')
    assert verified['passed'] and verified['source_entries']==1638
    plan=list(map(json.loads,(out/'import-plan.jsonl').open()))
    receipts={r['result']['url']:r['result'] for r in map(json.loads,(out/'import-applied.jsonl').open())}
    old=list(map(json.loads,(ROOT/'reports/antologia-cotejo-integral-2026-11-09/entries.jsonl').open()))
    albums={a['id']:a for a in load('after/albums-snapshot.json')}
    coverage=[]
    for e in old:
        if e['url'] in receipts:
            r=receipts[e['url']]
            coverage.append({'url':e['url'],'title':e['source_title'],'previous_status':e['status'],'status':r['status'],'album_id':r['albumId'],'source_authority':'blog aceptado por Brian; atribución sin verificación biográfica independiente'})
        elif e['status'] in ('matched','matched_reviewed'):
            assert e['album_id'] in albums
            coverage.append({'url':e['url'],'title':e['source_title'],'previous_status':e['status'],'status':'previously_matched','album_id':e['album_id'],'source_authority':'cotejo anterior; no reimportado en esta campaña'})
        else:
            coverage.append({'url':e['url'],'title':e['source_title'],'previous_status':e['status'],'status':'editorial_document','album_id':None,'source_authority':'se conserva el original; no convertido automáticamente en disco'})
    counts=dict(collections.Counter(e['status'] for e in coverage))
    assert len(coverage)==3393 and counts.get('previously_matched')==1753 and counts.get('editorial_document')==2
    assert all(e['album_id'] is not None for e in coverage if e['status']!='editorial_document')
    (out/'cotejo-final.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in coverage))
    with (out/'altas-y-vinculos.csv').open('w') as f:
        w=csv.writer(f);w.writerow(['url','titulo_fuente','resultado','album_id','artist_id','artista_nuevo','pistas_nuevas'])
        for o in plan:
            r=receipts[o['url']];w.writerow([o['url'],o['source_title'],r['status'],r['albumId'],r['artistId'],r['artistCreated'],r['tracksCreated']])
    new={r['albumId'] for r in receipts.values() if r['status']=='created'}
    unknown={key:sum(albums[i].get(key) in (None,'','other') for i in new) for key in ('release_year','label_id','catalog_id','media_format','album_type')}
    genres=verified['genre_outcomes'];cons=verified['conservation'];created=cons['albums']['added'];existing=1638-created
    final={'verified':True,'blog_entries':3393,'previously_matched_entries':1753,'resolved_pending_entries':1638,'editorial_documents':2,'pending_from_original_1638':0,'coverage':counts,'conservation':cons,'genres':genres,'unknown_new_album_fields':unknown,'source_authority':'Blog secundario aceptado por Brian para altas documentadas, no verificación independiente de identidades.'}
    (out/'FINAL.json').write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n')
    text=f'''# Importación de AntologiaVenezuela — 10 de noviembre de 2026

Las **1.638 entradas pendientes** quedaron resueltas: **{created:,} altas de discos** y **{existing} entradas vinculadas a publicaciones existentes**. Se aceptó el blog como fuente por instrucción expresa de Brian. Se añadieron **{cons['tracks']['added']:,} pistas** y **{cons['artists']['added']} atribuciones artísticas nuevas**. Las 1.638 fuentes conservan portada, texto original completo, listado, posiciones literales, atribución y URL.

El cotejo completo suma 3.393 entradas: 1.753 correspondencias anteriores, las 1.638 resueltas ahora y dos documentos editoriales. No quedan entradas de aquel grupo de 1.638 sin vínculo. Las dos editoriales son el aviso técnico «Sin Sonido» y la noticia que reúne dos recopilaciones de Phidias; se conservan como documentos y no forman parte de estas 1.638 altas o vínculos.

## Qué se incorporó y cómo

Las publicaciones repetidas o ya presentes se vincularon mediante artista, título, repertorio y edición. Cada entrada tiene su versión documental con referencia a la fuente. Cuando la fuente lista una edición distinta, su año, sello u orden no sobrescriben los datos de otra edición existente. «Venezuela, una canción» conserva sus dos partes documentales sin sustituir las subdivisiones del catálogo. Los dos artículos de «70 Años, Para Siempre» completan una sola caja: 87 pistas en seis CD. Se corrigieron los 15 títulos o posiciones del importador anterior conservando sus IDs.

Las series y colecciones se registraron como recopilaciones, sin convertir nombres de colecciones en intérpretes. Los artistas nuevos declaran origen «Desconocido», tipo «other» y atribución según el blog. «Gallo, cuatro y bandola» usa una referencia técnica «Artista por identificar»: no se inventó su intérprete. La importación no certifica biografías, países, integrantes ni identidades homónimas por nombre solamente.

Los reinicios de numeración no inventan CD. En {verified['source_ordinal_lists']} listas con números repetidos o cero, el catálogo usa el orden del listado y conserva el número original en notas y metadata. Los mosaicos siguen siendo pistas únicas. Se separaron anotaciones explícitas de género, autores e intérpretes de los títulos en los formatos cubiertos por las pruebas, conservando siempre la línea literal. Las variantes de redacción conservadoras no equivalen a una certificación musicológica de cada título.

## Datos desconocidos y límites

Los créditos literales y textos técnicos permanecen en las notas y documentos. No se crearon personas ni relaciones de compositor basándose solo en nombres. Tampoco se inventaron duraciones, marcas de tiempo, enlaces de reproducción ni videos de YouTube. Las portadas son archivos ya capturados y comprobados; pueden ser imágenes pequeñas y no representan un inventario de escaneos de alta resolución o reversos.

Los géneros se procesaron en runs separados: {genres.get('source_categories',0)} discos por categorías explícitas de la entrada, {genres.get('inherited',0)} por herencia documentada y {genres.get('no_resolved_source_genre',0)} sin género resuelto, conservado vacío con revisión. No se trasladan características de una pista a todo el disco. Los campos desconocidos de las altas figuran en `FINAL.json`.

## Verificación y trazabilidad

`verification.json` comprueba las 1.638 URLs, el hash del texto documental, la metadata exacta de los listados, las versiones, los archivos de portada, la evidencia de claims aceptados y las altas contra instantáneas consistentes. Todos los artistas, discos, pistas y créditos anteriores permanecen; los títulos y posiciones de pistas anteriores solo admiten las 15 correcciones documentadas de la caja de Billo’s. Los campos editoriales anteriores de discos no se sobrescribieron.

Se conserva el historial completo de operaciones y deshacer estricto. Un primer intento de 485 entradas se revirtió con el diario antes de la carga corregida. Después se deshicieron únicamente dos altas duplicadas de Billo’s y se vincularon a sus fichas originales. Los recibos previos permanecen archivados. Las correcciones de títulos de esta campaña están en `title-cleanup-applied.jsonl`; los registros finales activos están en `import-applied.jsonl`.

- `FINAL.json`: resultado y totales.
- `cotejo-final.jsonl`: las 3.393 entradas, clasificación e ID de disco.
- `altas-y-vinculos.csv`: los 1.638 resultados de esta importación.
- `import-plan.jsonl`: campos, títulos y posiciones aceptados.
- `import-applied.jsonl`, `genres-applied.jsonl`: IDs y runs aplicados.
- `*-snapshot.json` y `after/`: instantáneas anterior y posterior.
- `tests.txt`, `typecheck.txt`, `eslint.txt`: validación del código.
- `implementation/`: copia exacta de los scripts usados.

La campaña se publica en `reports/antologia-altas-2026-11-10` del almacén Shared de 1 TB mediante `scripts/staging.py publish --hash`.
'''
    (out/'INFORME.md').write_text(text)
    print(json.dumps(final,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();out=a.out.resolve();out.relative_to(pathlib.Path.home()/'crv-staging/reports');main(out)
