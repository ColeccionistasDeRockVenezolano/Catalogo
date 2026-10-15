// Cierre de EON (#6979) — la ÚNICA banda legítimamente nueva del cierre del hueco MA 2026-10-15
// (las otras 13 «bandas» de la fase B resultaron fichas ya existentes con el otro nombre).
// Se completa con la captura de Metal Archives: foto y logo (ya en disco) y el lineup actual
// (3 personas de MA ya presentes en el catálogo), cada membresía con claim de la fuente y evidencia.
// Los géneros («Melodic Death Metal») van por el flujo de vocabulario, aparte.
// Uso: ./scripts/with-node22.sh npx tsx scripts/cierre-eon-2026-10-15.ts [--confirm]
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { createRelation, updateEntity, withOperatorRun } from "../src/merge/operator.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const MA = "data/raw/metal-archives-ve-2026-10-01";
const ARTISTA = 6979;
const CONFIRM = process.argv.includes("--confirm");
const FICHA_MA = "https://www.metal-archives.com/bands/EON/3540500619";

const LINEUP = [
  { personId: 4925, person: "Alexander Pulido", role: "Drums" },
  { personId: 4883, person: "Ronald Lares", role: "Guitars, Bass" },
  { personId: 13481, person: "Lenin Morales", role: "Vocals" },
];

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  const pool = getPool();
  const fotoOrigen = path.join(ROOT, MA, "img", "3540500619_photo.jpg");
  const logoOrigen = path.join(ROOT, MA, "img", "3540500619_logo.jpg");
  console.log(`artista ${ARTISTA} · foto ${existsSync(fotoOrigen)} · logo ${existsSync(logoOrigen)} · membresías a crear: ${LINEUP.length}`);
  writeFileSync(path.join(ROOT, DIR, "cierre-eon-plan.json"), JSON.stringify({ ARTISTA, LINEUP, FICHA_MA }, null, 1));
  if (!CONFIRM) { console.log("vista previa: repite con --confirm"); await closeDb(); return; }

  const source = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='metal-archives'");
  const sourceId = Number(source.rows[0]?.id);

  const { runId, result } = await withOperatorRun({
    name: "hermes:cierre-eon",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Cierre de la banda nueva EON: foto y logo de la captura de Metal Archives y lineup actual (createRelation + claim de la fuente con evidencia).",
    params: { artista: ARTISTA },
  }, async (context) => {
    const destino = path.join(ROOT, "web", "public", "media", "artist");
    mkdirSync(destino, { recursive: true });
    copyFileSync(fotoOrigen, path.join(destino, `${ARTISTA}.jpg`));
    copyFileSync(logoOrigen, path.join(destino, `${ARTISTA}-logo.jpg`));
    await updateEntity(context, "artist", ARTISTA, {
      picture_url: `/crv/media/artist/${ARTISTA}.jpg`,
      logo_url: `/crv/media/artist/${ARTISTA}-logo.jpg`,
    });

    let creadas = 0;
    for (const m of LINEUP) {
      await context.client.query("SAVEPOINT eon_rel");
      try {
        const res = await createRelation(context, "artist_membership",
          { artistId: ARTISTA, personId: m.personId },
          { role: m.role, is_current: "true" });
        if (res.created) creadas++;
        const claim = await context.client.query<{ id: string }>(`
          INSERT INTO ingest.claims(source_id,entity_kind,artist_membership_id,field,raw_value,normalized_value,raw_hash,extractor,
                                    extractor_version,confidence,status,created_by,run_id,notes,identity_key)
          VALUES($1,'artist_membership',$2,'role',$3::jsonb,$3::jsonb,$4,$5,'1','medium','accepted','human',$6,$7,$8)
          ON CONFLICT DO NOTHING RETURNING id::text`,
        [sourceId, res.id, JSON.stringify(m.role), sha(["ficha-metal-archives", ARTISTA, m.personId, m.role, FICHA_MA]),
          "ficha-metal-archives", context.runId,
          `Membresía según la ficha de Metal Archives (banda 3540500619): actual`,
          `ma:membership:3540500619:${m.personId}:${m.role.toLowerCase().replace(/\s+/gu, "-")}`]);
        if (claim.rows[0]?.id) {
          await context.client.query(
            "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
            [claim.rows[0].id, FICHA_MA, `${m.person} — ${m.role} (actual)`, sha([FICHA_MA, m.role])]);
        }
        await context.client.query("RELEASE SAVEPOINT eon_rel");
      } catch (error) {
        await context.client.query("ROLLBACK TO SAVEPOINT eon_rel");
        throw error;
      }
    }
    return { creadas, foto: true, logo: true };
  });

  writeFileSync(path.join(ROOT, DIR, "cierre-eon-aplicado.json"), JSON.stringify({ run: runId, result }, null, 1));
  console.log(`run ${runId}: foto+logo y ${result.creadas}/${LINEUP.length} membresías creadas`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
