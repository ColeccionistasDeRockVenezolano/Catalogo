import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../src/config/project-root.js";
import { closeDb } from "../src/db/client.js";
import { hashText } from "../src/search/review-protocol.js";
import { extractReleaseLanguage, releaseLanguageStudySchema } from "../src/search/rym-release-language.js";
import { assertDevelopmentSelection, resolveStudyRelease, studyReleaseFileSchema, studyReserveSchema } from "../src/search/study-identity.js";

const root = projectRoot(import.meta.url);
const read = (p: string) => readFile(path.join(root, p), "utf8");
try {
  const specPath = "docs/unified-search/stage2/study-releases.json", reservePath = "docs/unified-search/stage2/study-reserve.json";
  const [specText, reserveText] = await Promise.all([read(specPath), read(reservePath)]);
  const spec = studyReleaseFileSchema.parse(JSON.parse(specText)), reserve = studyReserveSchema.parse(JSON.parse(reserveText));
  assertDevelopmentSelection(spec.releases.map(r => r.release), reserve.releases);
  const records = [], manifest = [];
  for (const capture of spec.releases) {
    // SELECT-only revalidation against existing claims, artist and ordered repertoire.
    const identity = await resolveStudyRelease(root, capture);
    const [html, metadata] = await Promise.all([read(capture.html), read(capture.metadata)]);
    if (hashText(metadata) !== capture.metadataHash) throw new Error("Metadatos de idioma cambiaron durante lectura");
    const meta = JSON.parse(metadata) as { capturedAt: string };
    records.push(extractReleaseLanguage({ html, source: `https://rateyourmusic.com${capture.release}`,
      capturedAtOriginal: meta.capturedAt, expectedHash: capture.htmlHash,
      object: { kind: "album", id: capture.albumId, name: identity.sourceTitle, artist: identity.sourceArtist, identityEvidence: identity.identityEvidence } }));
    manifest.push({ albumId: capture.albumId, html: capture.html, htmlHash: capture.htmlHash, metadata: capture.metadata, metadataHash: capture.metadataHash });
  }
  const report = releaseLanguageStudySchema.parse({ version: "crv-release-language-study-0.1.0", resourceId: "R06",
    inputs: [{ path: specPath, sha256: hashText(specText) }, { path: reservePath, sha256: hashText(reserveText) }], manifest, records,
    coverage: { releases: records.length, documented: records.filter(r => r.status === "documented").length,
      unknown: records.filter(r => r.status === "unknown").length, unresolved: records.filter(r => r.status === "unresolved").length,
      multilingual: records.filter(r => r.status === "documented" && new Set(r.languages.map(l => l.code)).size > 1).length },
    limits: ["Corte de desarrollo; no cobertura completa R06", "Sin evidencia por pista o edición", "Sin consulta pública ni aprobación editorial", "Idioma de metadatos no equivale a comprensión, traducción o ausencia de voz"],
    operationalDatabaseWrites: 0, entityAssignmentsAuthorized: false, publicationAuthorized: false });
  await mkdir(path.join(root, "reports/unified-search-stage2"), { recursive: true });
  await writeFile(path.join(root, "reports/unified-search-stage2/release-languages.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.coverage));
} finally { await closeDb(); }
