import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { toApiError } from "../../src/api/http-errors.js";
import { registerImageCandidateRoutes } from "../../src/api/routes/image-candidates.js";
import { registerChangeRoutes } from "../../src/api/routes/changes.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { inspectImageCandidates } from "../../src/merge/image-inspection.js";

const token = "image-candidates-contract-admin-0123456789";
function poster(size: number, hue: number): Buffer {
  const lines = Array.from({ length: Math.round(size / 6) }, (_, i) => `<line x1="${i * 6}" y1="0" x2="${i * 6 + 40}" y2="${size}" stroke="#${i % 2 ? "222" : "ddd"}" stroke-width="2"/>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="hsl(${hue},60%,50%)"/>${lines}<circle cx="${size * 0.3}" cy="${size * 0.35}" r="${size * 0.22}" fill="#111"/><rect x="${size * 0.55}" y="${size * 0.5}" width="${size * 0.35}" height="${size * 0.4}" fill="#fafafa"/></svg>`);
}
describe("curaduría de imágenes: inspección, alternativas útiles, copia estable y decisiones reversibles", () => {
  let app: FastifyInstance, pg: PgContainer, album: number, mediaRoot: string;
  const previousEnv = { ...process.env };
  const headers = { authorization: `Bearer ${token}`, "x-crv-operator": "Admin de imágenes" };
  const images = new Map<string, Buffer>();
  const serve = async (url: string) => images.has(url) ? { bytes: images.get(url)! } : { error: "HTTP 404" };
  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl; process.env["CRV_OPERATOR_TOKEN"] = token;
    resetEnvCache(); await applyCore(pg.name); await migrateUp();
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code, message: expected.message } });
      return reply.send(error);
    });
    mediaRoot = await mkdtemp(path.join(tmpdir(), "crv-media-"));
    await registerOperatorAuth(app); await registerImageCandidateRoutes(app, { mediaRoot, download: serve }); await registerChangeRoutes(app);
    const db = getPool();
    const artist = Number((await db.query("INSERT INTO public.artists(name) VALUES('Banda Imagen') RETURNING id")).rows[0].id);
    album = Number((await db.query("INSERT INTO public.albums(artist_id,title,cover_url) VALUES($1,'Disco Imagen','https://img.example/actual.jpg') RETURNING id", [artist])).rows[0].id);
    const original = await sharp(poster(1400, 20)).jpeg({ quality: 92 }).toBuffer();
    images.set("https://img.example/original.jpg", original);
    images.set("https://img.example/variante.jpg", await sharp(original).resize(900).jpeg({ quality: 60 }).toBuffer());
    images.set("https://img.example/ampliada.jpg", await sharp(await sharp(poster(240, 200)).jpeg().toBuffer()).resize(1400, 1400).jpeg().toBuffer());
    for (const url of ["https://img.example/rota.jpg", ...images.keys()])
      await db.query("INSERT INTO ingest.image_candidates(entity_kind,album_id,current_url,candidate_url,source,origin) VALUES('album',$1,'https://img.example/actual.jpg',$2,'fuente','prueba')", [album, url]);
  });
  afterAll(async () => {
    await app?.close(); await closeDb(); await pg?.stop();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
    for (const key of ["DATABASE_URL", "CRV_OPERATOR_TOKEN"]) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
    resetEnvCache(); resetAuthStateForTests();
  });
  const list = async () => {
    const response = await app.inject({ method: "GET", url: `/curation/images?kind=album&entityId=${album}`, headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: Array<{ entityId: number; candidates: Array<{ id: number; url: string; quality: string | null; use: string | null; variantOf: number | null; effectiveWidth: number | null; reasons: string[] }> }> }>().data;
  };
  it("inspecciona sin tocar la ficha, ordena por calidad y agrupa variantes", async () => {
    const { result } = await withOperatorRun({ name: "image_inspection", operator: "QA", note: "Inspección de prueba" },
      (context) => inspectImageCandidates(context, { download: serve }));
    expect(result).toEqual({ inspected: 4, failed: 1, visual: 0 });
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [album])).rows[0].cover_url).toBe("https://img.example/actual.jpg");
    const [group] = await list();
    const byUrl = new Map(group!.candidates.map((c) => [c.url.split("/").pop(), c]));
    expect(group!.candidates.map((c) => c.url.split("/").pop())).toEqual(["original.jpg", "variante.jpg", "ampliada.jpg", "rota.jpg"]);
    expect(byUrl.get("original.jpg")).toMatchObject({ quality: "high", use: "cover", variantOf: null });
    expect(byUrl.get("variante.jpg")!.variantOf).toBe(byUrl.get("original.jpg")!.id);
    expect(byUrl.get("ampliada.jpg")!.quality).toBe("low");
    expect(byUrl.get("ampliada.jpg")!.reasons[0]).toMatch(/^Ampliada/u);
    expect(byUrl.get("rota.jpg")).toMatchObject({ quality: "failed", reasons: ["HTTP 404"] });
  });
  it("no permite elegir una imagen fallida; elegir otra se aplica, se deshace y reabre las candidatas", async () => {
    const [group] = await list();
    const broken = group!.candidates.find((c) => c.quality === "failed")!;
    const refused = await app.inject({ method: "POST", url: `/curation/images/album/${album}/decide`, headers, payload: { candidateId: broken.id } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.message).toContain("no se pudo descargar");
    const best = group!.candidates[0]!;
    // The source now serves another picture at the same address: nothing changes until it is measured again.
    const original = images.get(best.url)!;
    images.set(best.url, await sharp(poster(1400, 200)).flop().jpeg().toBuffer());
    const changed = await app.inject({ method: "POST", url: `/curation/images/album/${album}/decide`, headers, payload: { candidateId: best.id } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.message).toContain("cambió desde que se midió");
    images.delete(best.url);
    const unavailable = await app.inject({ method: "POST", url: `/curation/images/album/${album}/decide`, headers, payload: { candidateId: best.id } });
    expect(unavailable.statusCode).toBe(502);
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [album])).rows[0].cover_url).toBe("https://img.example/actual.jpg");
    images.set(best.url, original);
    const chosen = await app.inject({ method: "POST", url: `/curation/images/album/${album}/decide`, headers, payload: { candidateId: best.id } });
    expect(chosen.statusCode, chosen.body).toBe(200);
    // The record points to a stable copy of the original bytes; the source address stays on the candidate.
    const stored = chosen.json().chosenUrl as string;
    expect(stored).toMatch(/^\/crv\/media\/curated\/[0-9a-f]{64}\.jpg$/u);
    expect((await readFile(path.join(mediaRoot, "curated", path.basename(stored)))).equals(original)).toBe(true);
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [album])).rows[0].cover_url).toBe(stored);
    expect((await getPool().query("SELECT candidate_url, stored_url FROM ingest.image_candidates WHERE id=$1", [best.id])).rows[0]).toEqual({ candidate_url: best.url, stored_url: stored });
    const repeated = await app.inject({ method: "POST", url: `/curation/images/album/${album}/decide`, headers, payload: { candidateId: best.id } });
    expect(repeated.statusCode).toBe(409);
    const undo = await app.inject({ method: "POST", url: `/changes/${chosen.json().runId}/undo`, headers, payload: { note: "Deshacer la elección de prueba" } });
    expect(undo.statusCode, undo.body).toBeLessThan(300);
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [album])).rows[0].cover_url).toBe("https://img.example/actual.jpg");
    expect((await list())[0]!.candidates).toHaveLength(4);
  });
  it("un límite de la fuente deja la imagen sin elegir pero vuelve a la cola para reintentarla", async () => {
    const id = Number((await getPool().query("INSERT INTO ingest.image_candidates(entity_kind,album_id,current_url,candidate_url,source,origin) VALUES('album',$1,'https://img.example/actual.jpg','https://img.example/limite.jpg','fuente','prueba') RETURNING id", [album])).rows[0].id);
    await withOperatorRun({ name: "image_inspection", operator: "QA", note: "Inspección con límite de la fuente" },
      (context) => inspectImageCandidates(context, { ids: [id], download: async () => ({ error: "HTTP 429", transient: true }) }));
    const row = (await getPool().query("SELECT quality, inspected_at FROM ingest.image_candidates WHERE id=$1", [id])).rows[0];
    expect(row).toEqual({ quality: "failed", inspected_at: null });
    const refused = await app.inject({ method: "POST", url: `/curation/images/album/${album}/decide`, headers, payload: { candidateId: id } });
    expect(refused.statusCode).toBe(422);
  });
  it("sin contexto documentado, la lectura visual decide el uso y avisa si el texto nombra otra ficha", async () => {
    images.set("https://img.example/sin-contexto.jpg", await sharp(poster(800, 90)).jpeg().toBuffer());
    const id = Number((await getPool().query("INSERT INTO ingest.image_candidates(entity_kind,album_id,current_url,candidate_url,source,origin) VALUES('album',$1,'https://img.example/actual.jpg','https://img.example/sin-contexto.jpg','fuente','prueba') RETURNING id", [album])).rows[0].id);
    const seen: Array<{ expected: string[] }> = [];
    const { result } = await withOperatorRun({ name: "image_inspection", operator: "QA", note: "Inspección con lectura visual" },
      (context) => inspectImageCandidates(context, { ids: [id], download: serve, vision: async (input) => {
        seen.push(input);
        return { use: "cover", visibleText: ["Otra Banda", "Otro Disco"], reason: "Portada con título impreso", textMatch: "mismatch" };
      } }));
    expect(result.visual).toBe(1);
    expect(seen[0]!.expected).toEqual(["Disco Imagen", "Banda Imagen"]);
    const row = (await getPool().query("SELECT image_use, inspection_reasons FROM ingest.image_candidates WHERE id=$1", [id])).rows[0];
    expect(row.image_use).toBe("cover");
    expect(row.inspection_reasons.join(" ")).toContain("posible imagen de otra ficha");
  });
  it("una portada entre las fotos del artista se identifica y se propone para su disco", async () => {
    images.set("https://img.example/portada-en-retratos.jpg", await sharp(poster(900, 150)).jpeg().toBuffer());
    const artist = Number((await getPool().query("SELECT artist_id FROM public.albums WHERE id=$1", [album])).rows[0].artist_id);
    const id = Number((await getPool().query("INSERT INTO ingest.image_candidates(entity_kind,artist_id,current_url,candidate_url,source,page_url,origin) VALUES('artist',$1,NULL,'https://img.example/portada-en-retratos.jpg','fuente','https://musica.example/banda','prueba') RETURNING id", [artist])).rows[0].id);
    const { runId } = await withOperatorRun({ name: "image_inspection", operator: "QA", note: "Portada en la cola de retratos" },
      (context) => inspectImageCandidates(context, { ids: [id], download: serve, vision: async () =>
        ({ use: "cover", visibleText: ["BANDA IMAGEN", "Disco Imagen"], reason: "Portada con el título impreso", textMatch: "match" }) }));
    const reasons = (await getPool().query("SELECT inspection_reasons FROM ingest.image_candidates WHERE id=$1", [id])).rows[0].inspection_reasons;
    expect(reasons.join(" ")).toContain("Es la portada de «Disco Imagen»: se propone para ese disco");
    const proposed = (await getPool().query("SELECT status, origin, run_id::int AS run, image_context FROM ingest.image_candidates WHERE album_id=$1 AND candidate_url='https://img.example/portada-en-retratos.jpg'", [album])).rows;
    expect(proposed).toEqual([{ status: "open", origin: "portada entre las fotos del artista", run: runId, image_context: `Portada de «Disco Imagen» hallada entre las fotos del artista (candidata ${id})` }]);
  });
});
