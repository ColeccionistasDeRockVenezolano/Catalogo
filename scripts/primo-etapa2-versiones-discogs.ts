// CRV · Plan del primo, etapa 2 (2026-10-12): versiones con fuente (punto 9).
//
// «Flor de Fuego» (Caramelos de Cianuro, #140) es el caso del plan (imagen 2):
// sus seis ediciones según el máster de Discogs 1149840, cada una con sello,
// país, año y la URL de la ficha. «Not On Label» es una edición independiente:
// va sin sello. La edición en CD + DVD que juntó la run 18980 se completa con
// sus datos en vez de duplicarse.
//
//   npx tsx scripts/primo-etapa2-versiones-discogs.ts [--confirm]
import { parseDateValue } from "../src/catalog/date-value.js";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const confirm = process.argv.includes("--confirm");
const ALBUM_ID = 140;
const MASTER = "https://www.discogs.com/master/1149840";
const release = (id: number) => `https://www.discogs.com/release/${id}`;

interface Edition {
  discogs: number;
  title: string;
  format: string;
  details: string;
  catalog: string | null;
  country: string | null;
  year: number | null;
  date?: { year: number; month: number; day: number };
  labels: Array<{ organizationId: number; role: "label" | "distributor" | "licensee"; source: string }>;
  notes: string | null;
  primary?: boolean;
  /** Versión existente que se completa (la de la run 18980). */
  replaces?: string;
}

const EDITIONS: Edition[] = [
  { discogs: 9974343, title: "Edición original", format: "CD", details: "CD, Álbum", catalog: null, country: "Venezuela", year: 2006,
    labels: [], notes: "Edición independiente (Discogs: «Not On Label»), prensada por Optilaser C.A.", primary: true },
  { discogs: 1684152, title: "Edición promocional Pepsi", format: "CD", details: "CD, Álbum, Promo, funda de cartón", catalog: null, country: "Venezuela", year: 2006,
    labels: [{ organizationId: 1170, role: "label", source: "Pepsi" }], notes: "Distribuida por Pepsi; fabricada por Optilaser C.A." },
  { discogs: 9974748, title: "Edición especial en CD + DVD", format: "CD + DVD", details: "CD, Álbum; DVD, DVD-Video; Edición especial", catalog: null, country: "Venezuela", year: 2007,
    labels: [], notes: "Edición independiente (Discogs: «Not On Label»), prensada por Optilaser C.A.", replaces: "CD + DVD" },
  { discogs: 9975852, title: "Edición estadounidense", format: "CD", details: "CD, Álbum", catalog: "900166", country: "Estados Unidos", year: 2007,
    date: { year: 2007, month: 11, day: 13 },
    labels: [{ organizationId: 4249, role: "label", source: "Union Records (15)" }, { organizationId: 2278, role: "distributor", source: "Wea Corporation" }],
    notes: "Fabricada y distribuida por Wea Corporation." },
  { discogs: 13909996, title: "Reedición", format: "CD", details: "CD, Álbum, Reedición", catalog: null, country: "Venezuela", year: null,
    labels: [], notes: "Edición independiente (Discogs: «Not On Label»); sin año en la fuente." },
  { discogs: 25245367, title: "Edición sin código de barras", format: "CD", details: "CD, Álbum", catalog: null, country: null, year: null,
    labels: [], notes: "Edición independiente (Discogs: «Not On Label»), sin código de barras; sin país ni año en la fuente." },
];

const pool = getPool();
const current = await pool.query<{ id: string; position: number; format: string | null; is_primary: boolean; source: string | null }>(
  "SELECT id::text, position, format, is_primary, source FROM ingest.album_versions WHERE album_id = $1 ORDER BY position", [ALBUM_ID]);
console.log("versiones actuales:", current.rows);
for (const edition of EDITIONS) console.log(`${edition.title}: ${edition.details} · ${edition.country ?? "¿país?"} · ${edition.year ?? "¿año?"} · ${release(edition.discogs)}`);
if (confirm) {
  const { runId } = await withOperatorRun({ name: "primo-etapa2:versiones-discogs", operator: "claude-code",
    note: `Plan del primo, etapa 2 (2026-10-12): versiones de «Flor de Fuego» según el máster de Discogs (${MASTER})` }, async (context) => {
    const db = context.client;
    const primary = current.rows.find((row) => row.is_primary);
    for (const [index, edition] of EDITIONS.entries()) {
      const target = edition.primary ? primary : edition.replaces ? current.rows.find((row) => !row.is_primary && row.format === edition.replaces) : undefined;
      // parseDateValue valida el calendario (0068 no lleva CHECK sobre release_date).
      const date = edition.date
        ? JSON.stringify(parseDateValue(`${edition.date.year}-${String(edition.date.month).padStart(2, "0")}-${String(edition.date.day).padStart(2, "0")}`))
        : null;
      const values = [edition.title, edition.format, edition.details, edition.catalog, edition.country, edition.year, date, edition.notes,
        "discogs", `${release(edition.discogs)} (máster ${MASTER})`];
      let versionId: number;
      if (target) {
        await db.query(`
          UPDATE ingest.album_versions SET title = $2, format = $3, format_details = $4, catalog_number = $5, country = $6, release_year = $7,
                 release_date = $8::jsonb, notes = $9, source = $10, source_ref = $11, position = $12 WHERE id = $1`,
        [Number(target.id), ...values, index + 1]);
        versionId = Number(target.id);
      } else {
        versionId = Number((await db.query<{ id: string }>(`
          INSERT INTO ingest.album_versions(album_id, title, format, format_details, catalog_number, country, release_year, release_date, notes, source, source_ref,
                                            position, is_primary, run_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, false, $13) RETURNING id::text`,
        [ALBUM_ID, ...values, index + 1, context.runId])).rows[0]!.id);
      }
      for (const [position, label] of edition.labels.entries()) {
        await db.query(`
          INSERT INTO ingest.album_labels(album_id, version_id, organization_id, role, position, source_text, notes, run_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
        [ALBUM_ID, versionId, label.organizationId, label.role, position + 1, label.source, release(edition.discogs), context.runId]);
      }
    }
  });
  console.log(`run ${runId}`);
}
await closeDb();
