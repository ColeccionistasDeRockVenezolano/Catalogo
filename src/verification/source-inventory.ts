import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { projectRoot } from "../config/project-root.js";
import type { VerificationSnapshot } from "./types.js";

const publicUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Se requiere una URL pública HTTPS sin credenciales");
const sourceSchema = z.object({
  url: publicUrl,
  title: z.string().min(1),
  sourceType: z.enum(["artist_website", "artist_bandcamp", "label_website", "secondary_directory", "festival_organizer"]),
  authorityStatus: z.enum(["self_identified", "unverified", "publisher", "secondary"]),
  verificationStatus: z.enum(["page_read", "indexed_only", "fetch_failed", "unverified"]),
  checkedAt: z.string().date(),
  accessedAt: z.string().date().nullable(),
  capturedAt: z.string().datetime().nullable(),
  verificationMethod: z.enum(["web_reader", "search_index"]),
  evidenceText: z.string().nullable(),
  availableData: z.array(z.string().min(1)),
  releaseTitle: z.string().nullable(),
  researchEligible: z.boolean(),
  extractionStatus: z.enum(["not_extracted", "partially_extracted", "extracted"]),
  reviewStatus: z.enum(["pending", "reviewed", "rejected"]),
  accessNotes: z.string().nullable(),
}).strict().superRefine((source, ctx) => {
  if (source.researchEligible && (source.verificationStatus !== "page_read" || !source.availableData.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Solo páginas leídas con datos documentados pueden alimentar la investigación", path: ["researchEligible"] });
  }
  if (source.verificationStatus === "page_read" && !source.accessedAt || source.verificationStatus !== "page_read" && source.accessedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "La fecha de lectura debe corresponder al estado de comprobación", path: ["accessedAt"] });
  }
});
const projectSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), aliases: z.array(z.string().min(1)),
  subjectKind: z.enum(["group", "person"]), genreHints: z.array(z.string()),
  genreHintsStatus: z.literal("orientative_unverified"),
  priority: z.enum(["critical", "high", "normal"]), sources: z.array(sourceSchema),
  curationNotes: z.string(),
}).strict();
export const sourceInventorySchema = z.object({
  schemaVersion: z.literal(1), researchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  language: z.literal("es"), purpose: z.string(),
  reportedCounters: z.object({ projects: z.number().int(), urls: z.number().int(), critical: z.number().int() }).strict(),
  counterNotes: z.string(),
  policy: z.object({
    targetedResearch: z.literal(true), bulkScrapingEnabled: z.literal(false), catalogAutoImport: z.literal(false),
    bandcampOwnership: z.literal("pending_per_profile"), publicMediaReuse: z.literal("requires_rights_review"), capturedAt: z.string(),
  }).strict(),
  projects: z.array(projectSchema),
  discoverySources: z.array(z.object({ id: z.string(), name: z.string(), sources: z.array(sourceSchema), curationNotes: z.string() }).strict()),
}).strict().superRefine((inventory, ctx) => {
  const ids = new Set<string>(), urls = new Set<string>();
  for (const item of [...inventory.projects, ...inventory.discoverySources]) {
    if (ids.has(item.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `ID repetido: ${item.id}` });
    ids.add(item.id);
    for (const source of item.sources) {
      if (urls.has(source.url)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `URL repetida: ${source.url}` });
      urls.add(source.url);
    }
  }
});
export type SourceInventory = z.infer<typeof sourceInventorySchema>;
// El inventario real vive en el almacén externo (docs/SHARED_STORAGE.md). CI no lo tiene:
// CRV_SOURCE_INVENTORY apunta a un inventario mínimo de prueba para que el código arranque.
export const SOURCE_INVENTORY_PATH = process.env["CRV_SOURCE_INVENTORY"]
  ?? path.join(projectRoot(import.meta.url), "data/research/venezuelan-music-sources.json");
export function loadSourceInventory(): SourceInventory {
  return sourceInventorySchema.parse(JSON.parse(readFileSync(SOURCE_INVENTORY_PATH, "utf8")) as unknown);
}
const inventory = loadSourceInventory();
const normalize = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/\s+/gu, " ").trim();

/** Finite entrypoints for the existing broker, never an ingest source or accepted fact. */
export function inventoryResearchUrls(snapshot: VerificationSnapshot, sources: SourceInventory = inventory): string[] {
  let subject: string | undefined, release: string | undefined;
  if (snapshot.kind === "artist" || snapshot.kind === "person") subject = snapshot.name;
  else if (snapshot.kind === "album" || snapshot.kind === "track") {
    subject = snapshot.identityProfile?.artist;
    release = snapshot.kind === "album" ? snapshot.name : snapshot.identityProfile?.album;
    // Only the album being examined establishes its artist; unrelated context albums do not.
    const album = snapshot.albums.find(item => snapshot.kind === "album" ? item.id === snapshot.id : release !== undefined && normalize(item.title) === normalize(release));
    subject ??= album?.artist;
    release ??= album?.title;
  }
  if (!subject) return [];
  const project = sources.projects.find(item => [item.name, ...item.aliases].some(name => normalize(name) === normalize(subject)));
  if (!project || snapshot.kind === "person" && project.subjectKind !== "person") return [];
  const country = snapshot.identityProfile?.country;
  if (country && !/venezuela/iu.test(country)) return [];
  return [...new Set(project.sources.filter(source => source.researchEligible && source.verificationStatus === "page_read" &&
    (!(snapshot.kind === "album" || snapshot.kind === "track") || source.releaseTitle === null || release !== undefined && normalize(source.releaseTitle) === normalize(release))
  ).map(source => source.url))];
}

export function inventorySummary(sources: SourceInventory = inventory) {
  const urls = [...sources.projects, ...sources.discoverySources].flatMap(item => item.sources);
  return {
    projects: sources.projects.length, discoverySources: sources.discoverySources.length,
    urls: urls.length, criticalProjects: sources.projects.filter(item => item.priority === "critical").length,
    pageRead: urls.filter(source => source.verificationStatus === "page_read").length,
    indexedOnly: urls.filter(source => source.verificationStatus === "indexed_only").length,
    fetchFailed: urls.filter(source => source.verificationStatus === "fetch_failed").length,
    researchEntrypoints: sources.projects.flatMap(item => item.sources).filter(source => source.researchEligible).length,
    bandcampOwnershipPending: urls.filter(source => source.sourceType === "artist_bandcamp" && source.authorityStatus === "unverified").length,
  };
}
