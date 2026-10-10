import { chromium, expect } from "@playwright/test";
import { getIndividualVerification } from "../../../src/verification/store.js";
import { closeDb } from "../../../src/db/client.js";
import { curationFindings, findingInstruction } from "../../../src/verification/curation.js";
import { ENTITY_FIELDS } from "../../../src/api/routes/catalog-writes.js";
import { RELATION_ROUTES } from "../../../src/api/routes/relation-writes.js";
import { describeFields } from "../../../src/curation/ai/fields.js";
import { draftSchema } from "../../../src/curation/ai/schema.js";
import type {
  CatalogPlan,
  CatalogVocabulary,
} from "../../../src/curation/ai/types.js";

const base = {
  label: "Corregir ciudad de origen",
  reason: "La fuente documenta la ciudad",
  evidenceIds: ["E1"],
  enabled: true,
};
const vocabulary: CatalogVocabulary = {
  configured: true,
  model: "deepseek-flash",
  modelLabel: "DeepSeek V4.1 Flash",
  maxCalls: 2,
  maxTokens: 6000,
  entities: Object.fromEntries(
    Object.entries(ENTITY_FIELDS).map(([k, v]) => [k, describeFields(v)]),
  ) as CatalogVocabulary["entities"],
  relations: Object.fromEntries(
    RELATION_ROUTES.map((r) => [r.kind, describeFields(r.create)]),
  ) as CatalogVocabulary["relations"],
  genres: [{ slug: "rock", name: "Rock", level: "genre", parentGenreId: null }],
};
const fixture: CatalogPlan = {
  id: 1,
  entityKind: "artist",
  entityId: 58,
  instruction: "Revisar datos",
  status: "ready",
  phase: "ready",
  revision: 1,
  draft: draftSchema.parse({
    summary: "Correcciones documentadas y un disco pendiente para revisar.",
    unresolved: ["No hay fuente suficiente para la fecha de separación."],
    operations: [
      {
        ...base,
        key: "ciudad",
        op: "replace_fields",
        target: { kind: "artist", id: 58 },
        values: { originCity: "Caracas" },
      },
      {
        ...base,
        key: "orden",
        label: "Ordenar las pistas del primer disco",
        op: "reorder_tracks",
        album: { kind: "album", id: 8 },
        positions: [
          { track: { kind: "track", id: 12 }, discNumber: 1, trackNumber: 2 },
          { track: { kind: "track", id: 13 }, discNumber: 1, trackNumber: 1 },
        ],
      },
      {
        ...base,
        key: "nuevo",
        label: "Añadir Amanecer con sus pistas y créditos",
        op: "create_album",
        artist: { kind: "artist", id: 58 },
        values: {
          title: "Amanecer",
          releaseYear: 2001,
          albumType: "studio_album",
          description: "Edición documentada",
        },
        tracks: [
          {
            title: "Primera canción",
            discNumber: 1,
            trackNumber: 1,
            durationSeconds: 180,
          },
          { title: "Segunda canción", discNumber: 1, trackNumber: 2 },
        ],
        credits: [
          {
            target: { kind: "person", id: 5 },
            role: "Bass",
            creditType: "musician",
          },
        ],
        genres: [{ slug: "rock", role: "primary" }],
        aliases: ["Amanecer original"],
        formats: [{ format: "CD", quality: "HQ", archiveStatus: "published" }],
      },
    ],
  }),
  evidence: [
    {
      id: "E1",
      url: "https://fuente.example/banda",
      quote: "La banda nació en Caracas y publicó Amanecer en 2001.",
      origin: "page",
      fetchedAt: "2026-10-08",
      contentHash: "fixture",
      label: "Historia de la banda",
    },
  ],
  preview: {
    hash: "a".repeat(64),
    ready: true,
    sensitive: false,
    items: [
      {
        key: "ciudad",
        op: "replace_fields",
        label: base.label,
        before: { originCity: null },
        after: { originCity: "Caracas" },
        error: null,
        warnings: [],
      },
    ],
    affected: [
      { kind: "artist", id: 58, label: "Banda de prueba" },
      { kind: "album", id: 8, label: "Disco de prueba" },
      { kind: "person", id: 5, label: "Músico de prueba" },
    ],
  },
  reviewedKeys: [],
  result: null,
  usage: {
    calls: 1,
    cachedCalls: 0,
    tokensIn: 1200,
    tokensOut: 800,
    model: "deepseek-flash",
  },
  requestedBy: "QA",
  editedBy: null,
  appliedBy: null,
  error: null,
  runId: null,
  createdAt: "2026-10-08T12:00:00Z",
  updatedAt: "2026-10-08T12:00:00Z",
};

const biography = "Primer disco en 1994.\n\nReencuentro en 2007. Detalle histórico único conservado.";
fixture.draft = draftSchema.parse({summary: "Correcciones del informe", unresolved: [], operations: [
 {...base, key: "genero", label: "Añadir género: Rap", op: "assign_genre", target: {kind: "artist", id: 58}, genreSlug: "rap", role: "secondary"},
 fixture.draft!.operations[0],
 {...base, key: "bio", label: "Combinar las dos biografías", op: "replace_fields", target: {kind: "artist", id: 58}, values: {biography}},
 fixture.draft!.operations[2],
]});
vocabulary.genres.push({slug: "rap", name: "Rap", level: "genre", parentGenreId: null});
fixture.decisions = {};
const browser = await chromium.launch({headless: true, args: ["--no-sandbox"]});
const verification = await getIndividualVerification("artist", 58);
await closeDb();
try {
 for (const width of [1366, 390]) {
  let plan = structuredClone(fixture), saves = 0, applications = 0, modelCalls = 0;
  let lastInstruction = "";
  const errors: string[] = [];
  const page = await browser.newPage({viewport: {width, height: 1000}});
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://127.0.0.1:8080/**", async route => {
   const req = route.request(), path = new URL(req.url()).pathname;
   let body: unknown = {data: [], pagination: {total: 0, limit: 20, offset: 0}}, status = 200;
   if(path === "/auth/me") body = {user: {username: "qa", name: "QA", role: "admin"}, csrf: "qa"};
   else if(path === "/artists/58") body = {id: 58, name: "Banda de prueba"};
   else if(path === "/entity-verification/artist/58") body = verification;
   else if(path === "/curation/ai/vocabulary") body = vocabulary;
   else if(path === "/curation/ai/plans" && req.method() === "GET") body = [plan];
   else if(path === "/curation/ai/plans" && req.method() === "POST") {modelCalls++; lastInstruction = req.postDataJSON().instruction; body = {...plan, instruction: lastInstruction};}
   else if(path === "/curation/ai/plans/1" && req.method() === "GET") body = plan;
   else if(path === "/curation/ai/plans/1" && req.method() === "PATCH") {saves++; const payload = req.postDataJSON(); plan = {...plan, draft: payload.draft, revision: plan.revision+1}; body=plan;}
   else if(path === "/curation/ai/plans/1/decisions") {
    const payload=req.postDataJSON(); expect(payload.revision).toBe(plan.revision);
    if(payload.key === "nuevo" && payload.decision === "accepted") {status=400; body={error: {code:"invalid", message:"Ya existe un disco con estos datos. Revisa la edición."}};}
    else {
     if(payload.decision === "accepted") applications++;
     plan.decisions={...plan.decisions, [payload.key]: {decision:payload.decision, decidedBy:"QA", decidedAt:"2026-10-10", runId:payload.decision === "accepted" ? 40+applications : null}};
     plan.revision++; if(plan.draft!.operations.every(op=>plan.decisions?.[op.key])) {plan.status="reviewed";plan.phase="done";} body=plan;
    }
   } else if(path.endsWith("/summary")) body={categories:[], running:false, totals:{open:0},autofix:{today:{applied:0},alerts:[]},album:0,artist:0};
   await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto("http://127.0.0.1:5175/curaduria/ia?kind=artist&id=58");
  await expect(page.getByRole("heading",{name:"Propuestas con IA"})).toBeVisible();
  const queue = page.getByRole("region", {name: "Pendientes de la ficha"});
  await expect(queue.getByRole("heading", {name: `Recomendaciones y datos faltantes (${curationFindings(verification).length})`})).toBeVisible();
  const lastFinding = curationFindings(verification).at(-1)!;
  await queue.getByRole("button", {name: "Siguiente", exact: true}).click();
  await queue.getByLabel("Buscar pendiente").fill(lastFinding.label);
  await expect(queue.getByText(lastFinding.observed ? `${lastFinding.label}: ${lastFinding.observed}` : lastFinding.label, {exact: true})).toBeVisible();
  await queue.getByRole("button", {name: lastFinding.observed ? "Preparar corrección" : "Investigar y proponer", exact: true}).first().click();
  expect(lastInstruction).toBe(findingInstruction(lastFinding));
  expect(modelCalls).toBe(1);
  await expect(page.locator(".ai-plan")).toBeInViewport();
  await queue.getByLabel("Buscar pendiente").fill("");
  await queue.getByRole("combobox", {name: /^Área/u}).selectOption("genres");
  await expect(queue.getByText("Dato por revisar · Géneros: Punk", {exact:true})).toBeVisible();
  await queue.getByRole("combobox", {name: /^Área/u}).selectOption("all");
  for(const name of ["Guardar y validar","Implementar"]) await expect(page.getByRole("button",{name,exact:true})).toHaveCount(0);
  const card=(name:string)=>page.getByRole("article",{name,exact:true});
  await expect(card("Añadir género: Rap").getByRole("button",{name:"Sí, aceptar"})).toBeVisible();
  await expect(page.getByText("Detalle histórico único conservado.",{exact:false}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  await page.screenshot({path:`/tmp/crv-ai-decisions-${width}.png`,fullPage:true});
  await card("Añadir género: Rap").getByRole("button",{name:"Sí, aceptar"}).click();
  await expect(page.getByText("Cambio aplicado.",{exact:true})).toBeVisible();
  expect(plan.decisions?.genero?.decision).toBe("accepted");expect(plan.decisions?.ciudad).toBeUndefined();expect(saves).toBe(0);expect(applications).toBe(1);
  await card("Corregir ciudad de origen: Caracas").getByRole("button",{name:"No",exact:true}).click();
  await expect(page.getByText("Propuesta rechazada. El dato se conserva.")).toBeVisible();
  expect(plan.decisions?.ciudad?.decision).toBe("rejected");expect(applications).toBe(1);
  const bio=card("Combinar las biografías");await bio.getByText("Editar propuesta",{exact:true}).click();
  await bio.getByLabel("Biografía",{exact:true}).fill(biography+" Texto revisado.");
  await bio.getByRole("button",{name:"Sí, aceptar"}).click();await expect(bio).toHaveCount(0);
  expect(saves).toBe(1);expect(applications).toBe(2);
  const album=card("Añadir disco: Amanecer (2001)");await album.getByRole("button",{name:"Sí, aceptar"}).click();
  await expect(album.getByRole("alert")).toHaveText("Ya existe un disco con estos datos. Revisa la edición.");expect(plan.decisions?.nuevo).toBeUndefined();
  await album.getByRole("button",{name:"No",exact:true}).click();await expect(page.getByRole("heading",{name:"Revisión terminada",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Ver todas (4)"}).click();await expect(page.locator(".ai-operations").getByRole("button",{name:"Deshacer",exact:true})).toHaveCount(2);
  await expect(page.getByText("Texto revisado.",{exact:false}).first()).toBeVisible();
  await page.reload();await expect(page.getByRole("heading",{name:"Revisión terminada",exact:true})).toBeVisible();expect(modelCalls).toBe(1);
  plan=structuredClone(fixture);await page.goto("http://127.0.0.1:5175/curaduria/ia?kind=artist&id=58&prepare=1&instruction=Corregir%20solo%20el%20genero%20faltante");
  await expect(card("Añadir género: Rap")).toBeVisible();expect(modelCalls).toBe(2);expect(errors).toEqual([]);
  console.log(`${width}px: Sí aplica un cambio, No conserva datos, edición al aceptar, texto completo, persistencia y enlace desde verificación correctos.`);
  await page.close();
 }
} finally {await browser.close();}
