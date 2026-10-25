import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareStudyFeed, syncStudyFeed } from "../../src/search/knowledge-sync.js";
import { feedKey } from "../../src/search/knowledge-feed.js";
import { hashText, REVIEW_EXTRACTOR_VERSION } from "../../src/search/review-protocol.js";
import { knowledgeFixture } from "../support/knowledge-fixture.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "crv-sync-")); roots.push(root);
  await Promise.all(["data", "docs/unified-search/stage2", "reports/unified-search-stage2"].map(p => mkdir(path.join(root, p), { recursive: true })));
  const release = "/release/album/test/release/", capturedAt = "2026-10-16 12:00:00";
  const annotations = [], manifest = [];
  for (const page of [1, 2]) {
    const id = String(11 + page), url = `https://rateyourmusic.com/music-review/account/test/release/${id}`;
    const html = `<meta property="og:url" content="https://rateyourmusic.com${release}"><h1 class="album_title">Release<div><a class="artist">Artist</a></div></h1><div id="review_shell_std_${id}"><div class="review_user"><a class="user">Account</a></div><div class="review_date" content="2026-10-15"><a href="${url}">fecha</a></div><div class="review_rating" content="3.5"></div><div class="review_body"><div itemprop="description">Guitarras <span>fuzz al frente.</span></div></div></div>`;
    const filename = `data/page-${page}.html`;
    await writeFile(path.join(root, filename), html);
    const a = knowledgeFixture();
    a.id = `A${page}`; a.observation.resourceId = "R04";
    a.object = { ...a.object, kind: "album", id: 1, name: "Release", identityEvidence: ["accepted claim"] };
    a.observation = { ...a.observation, resourceId: "R04", source: url, reviewId: id, account: "Account", page,
      captureHash: hashText(html), capturedAt: null, capturedAtOriginal: capturedAt, captureTimeZone: null,
      locator: `#review_shell_std_${id} .review_body`, quote: "Guitarras fuzz al frente.", visibleDate: "2026-10-15", extractorVersion: REVIEW_EXTRACTOR_VERSION };
    a.layers.individualRating = { value: 3.5, minimum: 0.5, maximum: 5, object: "album" }; a.layers.trackRatings = [];
    annotations.push(a); manifest.push({ release, page, html: filename, htmlHash: hashText(html), capturedAt });
  }
  const metadata = JSON.stringify({ href: release, rec: { name: "Release", artist: "Artist" } });
  await writeFile(path.join(root, "data/release.json"), metadata);
  const spec = { release, albumId: 1, artistId: 3, identityMethod: "accepted_rym_title", claimId: null, importPlan: null,
    html: "data/page-1.html", metadata: "data/release.json", htmlHash: manifest[0]!.htmlHash, metadataHash: hashText(metadata),
    rationale: "Contrast sample", gaps: "Unknown edition", stratum: "multiple_review_pages" };
  const save = (file: string, data: unknown) => writeFile(path.join(root, file), JSON.stringify(data));
  await save("reports/unified-search-stage2/development-annotations.json", { annotations });
  await save("reports/unified-search-stage2/study.json", { manifest });
  await save("docs/unified-search/stage2/study-releases.json", { version: "test", releases: [spec] });
  await save("docs/unified-search/stage2/study-reserve.json", { version: "test", releases: ["/release/album/reserved/unopened/"] });
  const resolve = vi.fn(async () => ({ album: { id: 1, title: "Release", artist_id: 3 }, artistName: "Artist", sourceTitle: "Release", sourceArtist: "Artist",
    tracks: [{ id: 2, title: "Track", track_number: 1 }], identityEvidence: ["accepted claim"], repertoire: null }));
  return { root, annotations, manifest, spec, save, resolve };
}

it("prepara capturas citadas y un cursor acotado sin escribir ni abrir la reserva", async () => {
  const f = await fixture(), plan = await prepareStudyFeed(f.root, f.resolve);
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(plan.batches).toHaveLength(2);
  expect(plan.inputs.map(p => p.path)).toContain("data/page-2.html");
  expect(plan.batches.every(b => !b.sourceObject.includes(b.captureHash) && !b.sourceObject.includes("study:"))).toBe(true);
  const first = await syncStudyFeed(plan, { dryRun: true, limit: 1 });
  expect(first).toMatchObject({ total: 2, processed: 1, created: 0, reused: 0, dryRun: true });
  expect(first.jobs[0]!.created).toBeNull();
  const second = await syncStudyFeed(plan, { dryRun: true, limit: 1, cursor: first.nextCursor! });
  expect(second.nextCursor).toBeNull(); expect(second.jobs[0]!.key).not.toBe(first.jobs[0]!.key);
  expect(await prepareStudyFeed(f.root, f.resolve)).toEqual(plan);
  await expect(syncStudyFeed(plan, { dryRun: true, limit: 0 })).rejects.toThrow(/1 y 20/);
});

it("prepara y vuelve a verificar el corte con reports y data/raw trasladados por enlaces", async () => {
  const f = await fixture(), shared = await mkdtemp(path.join(os.tmpdir(), "crv-sync-shared-")); roots.push(shared);
  await mkdir(path.join(f.root, "data/raw"));
  for (const name of ["page-1.html", "page-2.html", "release.json"])
    await rename(path.join(f.root, "data", name), path.join(f.root, "data/raw", name));
  f.spec.html = "data/raw/page-1.html"; f.spec.metadata = "data/raw/release.json";
  for (const capture of f.manifest) capture.html = capture.html.replace("data/", "data/raw/");
  await f.save("docs/unified-search/stage2/study-releases.json", { version: "test", releases: [f.spec] });
  await f.save("reports/unified-search-stage2/study.json", { manifest: f.manifest });
  for (const directory of ["reports", "data/raw"]) {
    const target = path.join(shared, path.basename(directory));
    await rename(path.join(f.root, directory), target); await symlink(target, path.join(f.root, directory), "dir");
  }
  const plan = await prepareStudyFeed(f.root, f.resolve);
  expect(plan.batches).toHaveLength(2); expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(plan.inputs.some(pin => pin.path === "data/raw/page-2.html")).toBe(true);
});

it("captura cambiada mantiene el objeto estable y genera otra clave; cursor antiguo no salta cambios", async () => {
  const f = await fixture(), before = await prepareStudyFeed(f.root, f.resolve);
  const filename = path.join(f.root, "data/page-2.html"), html = (await readFile(filename, "utf8")).replace("fuzz al frente", "fuzz muy al frente");
  await writeFile(filename, html); f.manifest[1]!.htmlHash = hashText(html);
  f.annotations[1]!.observation.captureHash = hashText(html); f.annotations[1]!.observation.quote = "Guitarras fuzz muy al frente.";
  await f.save("reports/unified-search-stage2/study.json", { manifest: f.manifest });
  await f.save("reports/unified-search-stage2/development-annotations.json", { annotations: f.annotations });
  const after = await prepareStudyFeed(f.root, f.resolve);
  const a = before.batches.find(b => b.sourceObject.endsWith("page:2"))!, b = after.batches.find(b => b.sourceObject === a.sourceObject)!;
  expect(feedKey(a)).not.toBe(feedKey(b));
  await expect(syncStudyFeed(after, { dryRun: true, cursor: { planHash: before.planHash, offset: 1 } })).rejects.toThrow(/corte cambió/);
  const altered = structuredClone(after); altered.batches[0]!.annotations[0]!.analysis.interpretation = "Other analysis";
  await expect(syncStudyFeed(altered, { dryRun: true })).rejects.toThrow(/alterado/);
});

it.each(["quote", "account", "rating", "identity", "identity_evidence", "duplicate", "resource"])("detiene %s inválido antes de encolar", async field => {
  const f = await fixture(), a = f.annotations[0]!;
  if (field === "quote") a.observation.quote = "No está en la captura";
  if (field === "account") a.observation.account = "Another account";
  if (field === "rating") a.layers.individualRating!.value = 5;
  if (field === "identity") a.object.id = 999;
  if (field === "identity_evidence") a.object.identityEvidence = ["retired claim"];
  if (field === "duplicate") f.annotations.push(a);
  if (field === "resource") a.observation.resourceId = "R05";
  await f.save("reports/unified-search-stage2/development-annotations.json", { annotations: f.annotations });
  await expect(prepareStudyFeed(f.root, f.resolve)).rejects.toThrow();
});

it("no abre capturas reservadas y rechaza huellas cambiadas y enlaces fuera del archivo", async () => {
  const f = await fixture();
  await f.save("docs/unified-search/stage2/study-reserve.json", { version: "test", releases: [f.spec.release] });
  await expect(prepareStudyFeed(f.root, f.resolve)).rejects.toThrow(/reserva/); expect(f.resolve).not.toHaveBeenCalled();
  await f.save("docs/unified-search/stage2/study-reserve.json", { version: "test", releases: ["reserved"] });
  const filename = path.join(f.root, "data/page-2.html"); await writeFile(filename, "changed");
  await expect(prepareStudyFeed(f.root, f.resolve)).rejects.toThrow(/Captura cambió/);
  await rm(filename); await symlink(path.join(f.root, "docs/unified-search/stage2/study-reserve.json"), filename);
  await expect(prepareStudyFeed(f.root, f.resolve)).rejects.toThrow(/fuera del corte/);
});

it("aborta al vencer el presupuesto o ante archivos sobredimensionados antes de consultar identidad", async () => {
  const f = await fixture();
  vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(22001);
  await expect(prepareStudyFeed(f.root, f.resolve)).rejects.toThrow(/presupuesto/);
  vi.restoreAllMocks(); expect(f.resolve).not.toHaveBeenCalled();
  await writeFile(path.join(f.root, "data/page-1.html"), Buffer.alloc(20 * 1024 * 1024 + 1));
  await expect(prepareStudyFeed(f.root, f.resolve)).rejects.toThrow(/límite/);
  expect(f.resolve).not.toHaveBeenCalled();
});
