/**
 * Biografía de la serie «VenezuelaDemo» (id 72): sustituye la ficha de una línea
 * por el texto editorial completo, redactado a partir del artículo de Mari Stella
 * Paredes y de los datos verificados del catálogo (34 volúmenes, 626 temas,
 * 616 agrupaciones y solistas distintos, 2005–2010).
 *
 * El párrafo se separa con línea en blanco: `.entity-hero__desc` usa
 * `white-space: pre-wrap`, así que la página de la serie respeta los cortes.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-bio.mts [--apply]
 */
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun} from '../src/merge/operator.js';

const TAG = 'venezuelademo-bio-2026-10-27';
const APPLY = process.argv.includes('--apply');
const TITLE = 'VenezuelaDemo';

const BIO = `VenezuelaDemo es el catálogo discográfico de músicos independientes venezolanos que, entre 2005 y 2010, demostró con discos lo que muchas emisoras se empeñaban en negar: que en el país había —y hay— música de sobra, y de la buena. Nació por impulso del colectivo El G4, formado por Alejandro Calzadilla, melómano, diseñador gráfico e investigador musical; Raúl Abzueta, compositor, arreglista e intérprete; Luis Laya, melómano, periodista y productor audiovisual; y Germán Acero, productor de espectáculos, con Mari Stella Paredes en la coordinación del catálogo. Su respuesta a las radios que esquivaban la cuota de música venezolana exigida por la Ley de Responsabilidad Social en Radio y Televisión —y que alegaban falta de material o de calidad— fue contundente: un tema representativo por agrupación, tomado de la discografía producida desde el año 2000 dentro y fuera del país, acompañado de la reseña de su evolución artística, fotografía, discografía, créditos del tema y datos de contacto. Cada volumen se prensó en mil ejemplares de distribución gratuita para la red radial nacional; los músicos cedían el derecho del tema promocional y recibían diez ejemplares para su propia promoción.

Los tres primeros volúmenes reunieron 51 agrupaciones y se distribuyeron en agosto de 2005, con presentación en concierto público. A lo largo de esos años el catálogo creció hasta los 34 volúmenes que aquí se reúnen, con 626 temas y 616 agrupaciones y solistas distintos, entre dieciséis y veintidós por entrega: reggae, electrónica, salsa, jazz, tambores de la costa, las distintas formas del joropo, hip hop y cuanto género estaba sonando en el país. El Ministerio de Comunicación e Información lo hizo llegar a las emisoras de todo el territorio, y muchas radios comerciales lo usaron al principio; cuando la fiscalización se mostró laxa, la vieja costumbre de la payola recuperó terreno y fueron las emisoras alternativas y comunitarias —junto a honrosas excepciones del dial comercial— las que sostuvieron la difusión, usando los contactos del catálogo para entrevistar a los músicos y pedirles más material.

El proyecto también dejó la medida de lo que la ley movió: según la Biblioteca Nacional, los discos con Depósito Legal pasaron de 430 en 2004 a 1.403 en 2008, y alrededor del movimiento creció una cadena completa de estudios de grabación, fabricantes de discos compactos, imprentas, tiendas de instrumentos, academias, productoras, proveedores y discotiendas. A los discos se sumaron un portal donde descargar todas las reseñas y escuchar los temas, un boletín semanal gratuito que desde octubre de 2005 mantuvo a la comunidad al día, ciclos y conciertos, y una difusión dentro y fuera del país que sirvió de puente con festivales e instituciones culturales. La serie abrió además una línea temática: Sonidos de la Tradición (volúmenes 24, 33 y 34), que incluye el repertorio de los pueblos indígenas, y Música para Niños (volumen 32). VenezuelaDemo quedó así como un espacio de encuentro por encima de sellos y géneros, un retrato en movimiento de la música venezolana que desmintió, tema a tema, aquello de que no había material ni para tres semanas de programación.`;

const pool = getPool();
const found = (await pool.query<{id: string; description: string | null}>(
  'SELECT id::text, description FROM ingest.series WHERE title = $1 AND artist_id = 257', [TITLE])).rows[0];
if (!found) {
  console.error(`No existe la serie «${TITLE}».`);
  await closeDb();
  process.exit(1);
}
const seriesId = Number(found.id);
console.log(`serie ${seriesId}: ${BIO.length} caracteres, ${BIO.split(/\n\s*\n/).length} párrafos (antes ${found.description?.length ?? 0})`);

if (!APPLY) {
  console.log('dry-run: usar --apply para guardar la biografía.');
  await closeDb();
  process.exit(0);
}

const {runId} = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian)',
  note: 'Serie VenezuelaDemo: biografía editorial completa en la ficha de la serie.',
  params: {seriesId, paragraphs: BIO.split(/\n\s*\n/).length, chars: BIO.length},
}, async ctx => {
  const r = await ctx.client.query(
    'UPDATE ingest.series SET description = $1 WHERE id = $2', [BIO, seriesId]);
  return {updated: r.rowCount};
});
console.log(`run ${runId}: biografía guardada en la serie ${seriesId}`);
await closeDb();
