"""Decisiones editoriales revisadas: las propuestas automáticas no autorizan escrituras."""
import json
from pathlib import Path
O=Path('/home/brian/crv-staging/reports/wayback-restantes-2026-10-23')
conflicts=[json.loads(s) for s in Path('reports/wayback-incorporacion-2026-10-23/publicaciones-conflicto.jsonl').read_text().splitlines() if s]
# Año, día explícito cuando lo declara el artista, fuentes, alcance.
corrections={
2929:(2011,'2011-11-01',['https://ernieband.bandcamp.com/album/a-o-m'],'Publicación declarada por el artista.'),
333:(2013,'2013-03-20',['https://sofiainsomnia.bandcamp.com/album/breve-casi-eterno'],'Publicación declarada por el artista.'),
1652:(2013,None,['https://losmelancolicosanonimos.bandcamp.com/album/el-segundo'],'El año coincide con el archivo; el 1 de enero de la plataforma no acredita aniversario exacto.'),
198:(2003,'2003-07-15',['https://horacero.bandcamp.com/album/superllanero'],'2002 corresponde a la grabación; publicación declarada en 2003.'),
2705:(2009,'2009-01-10',['https://lostelecaster.bandcamp.com/album/todo-muerto'],'Publicación declarada por el artista.'),
2034:(2006,'2006-07-20',['https://masseratti2lts.bandcamp.com/album/coctel-5-cacao-mujer-y-beats'],'El propio dúo declara 20 de julio de 2006.'),
3609:(2008,'2008-11-05',['https://alfredgomezjr.bandcamp.com/album/la-reina-pein-ndose'],'El catálogo del artista declara 5 de noviembre de 2008.'),
5592:(2015,None,['https://correocultural.com/2015/05/tlx-estrena-disco-y-nuevo-sencillo/','https://revistaladosis.com/tlx-46-dpi-2015-venezuela','https://music.amazon.in/albums/B01CKE7YS4'],'Comunicado de la banda y reseña de época confirman el original de 2015. La fecha digital de 2016 se conserva como edición. El anuncio futuro de mayo no acredita por sí solo el día de publicación.'),
30342:(2012,None,['https://correocultural.com/2012/06/la-radio-candela-lanza-al-ruedo-cuentos-cantos-espantos/','https://www.elimpulso.com/2012/07/07/la-radio-candela-entre-cuentos-cantos-y-espantos/'],'Declaración de Johann Blanco en junio de 2012: el segundo disco ya estaba disponible. La grabación comenzó en diciembre de 2011. Se conserva el anterior 2025 como dato discrepante, sin inventar una reedición.'),
2736:(2009,None,['https://correocultural.com/2012/06/la-radio-candela-lanza-al-ruedo-cuentos-cantos-espantos/'],'La presentación del segundo disco identifica expresamente el debut como lanzado en 2009.'),
}
keeps={801:('https://reyesmusic.bandcamp.com/album/chuckmix','El editor declara 2009; no sustituir por 2008 del archivo gráfico.'),675:('https://elefreak.bandcamp.com/album/ep01','El artista declara 2009; el archivo gráfico dice 2010.'),530:('https://horacero.bandcamp.com/track/chiriguare-azul-desenchufado','La pista pertenece al disco Desenchufado, declarado en 2007 por el artista.'),75:('https://music.apple.com/us/album/bruja-single/1560135424','El editor fecha el sencillo el 15 de mayo de 2002; no confundir con el álbum posterior.'),2744:('https://masseratti2lts.bandcamp.com/','El catálogo del propio dúo sitúa Colores de Ideas en diciembre de 2009.')}
scopes={84:('https://music.apple.com/us/album/reiniciando-transmisi%C3%B3n/682054870','La ficha reúne el original Iniciando Transmisión (2011) y la ampliación Reiniciando Transmisión (2013). Conservar ambas ediciones; no trasladar la fecha digital al original.'),621:('https://americania.bandcamp.com/track/la-costura','La fecha de esta canción en Sigo (2011) no demuestra la fecha del sencillo independiente.'),397:('https://horacero.bandcamp.com/album/sonicosubte','Una selección parcial de Horacero no sustituye a la compilación de varios artistas.'),15604:('https://music.apple.com/us/album/daltonic-now-original/509506362','La plataforma declara distribución en marzo de 2012 y copyright de 2011. El copyright no basta para fechar el estreno original.')}
ledger=[]
for c in conflicts:
 aid=int(c['albumId']);r=dict(c,review='revisión editorial de fuentes y alcance; propuestas automáticas no aprobadas',status='unresolved',reason='Las búsquedas y capturas no permitieron demostrar inequívocamente el año original de esta edición. Se conserva el dato del catálogo y la variante histórica, sin elegir por mayoría de bases.',sources=[],newYear=None,exactDate=None)
 if aid in corrections:
  y,d,urls,why=corrections[aid];r.update(status='corrected-original-year',reason=why,sources=urls,newYear=y,exactDate=d)
 elif aid in keeps:
  u,why=keeps[aid];r.update(status='current-year-supported',reason=why,sources=[u])
 elif aid in scopes:
  u,why=scopes[aid];r.update(status='edition-or-scope-preserved',reason=why,sources=[u])
 elif aid in [23178,2671]:r.update(status='type-conflict-preserved',reason='El año coincide; discrepa el tipo de publicación. Se conserva la clasificación y la afirmación de la fuente sin deducir el tipo por número de pistas.')
 ledger.append(r)
(O/'fechas-resoluciones-aprobadas.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2))
from collections import Counter
print(dict(Counter(r['status'] for r in ledger)))
