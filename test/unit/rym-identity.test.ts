import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type pg from "pg";
import { assertRymIdentity, readRymIdentityLedger, normalizeRymIdentity, type RymIdentityLedger } from "../../src/verification/rym-identity.js";

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "crv-rym-identity-")); temporary.push(directory);
  const capture = { href: "/artist/bacos", rec: { rows: [{ t: "Un camino largo" }, { t: "Otra vida" }] } };
  const pins = ["json", "html"].map(extension => {
    const filename = path.join(directory, `bacos.${extension}`);
    const content = extension === "json" ? JSON.stringify(capture) : "<html>Bacos</html>";
    writeFileSync(filename, content);
    return { path: filename, sha256: createHash("sha256").update(content).digest("hex") };
  });
  const ledger: RymIdentityLedger = { version: "crv-rym-identity-v1", identities: [{
    href: "/artist/bacos", sourceName: "Bacos", status: "resolved", artistId: 1, pins,
    candidates: [{ status: "resolved", artistId: 1, name: "Bacos", rule: "shared_repertoire", yearAgrees: false, cityAgrees: false,
      catalogYear: null, catalogCity: null, memberMatches: [],
      sharedAlbums: [{ albumId: 2, title: "Un camino largo", sourceTitle: "Un camino largo" }, { albumId: 3, title: "Otra vida", sourceTitle: "Otra vida" }] }],
  }] };
  const albums = [{ id: "2", title: "Un camino largo" }, { id: "3", title: "Otra vida" }];
  const client = { query: async (sql: string) => ({ rows: sql.includes("FROM public.artists")
    ? [{ name: "Bacos", formed_year: null, origin_city: null }]
    : sql.includes("FROM public.albums") ? albums : [] }) } as unknown as pg.Pool;
  return { directory, ledger, albums, client };
}
describe("RYM source-to-catalog identity", () => {
  it('keeps non-Latin and symbolic titles distinct and stable on repeated normalization',()=>{
    const titles=['コンコルド','Я ВЕРНУСЬ С ИКЕРОМ КАСИЛЬЯСОМ','(･ω<)☆','!','...','º'];
    const keys=titles.map(normalizeRymIdentity);
    expect(new Set(keys).size).toBe(titles.length);
    expect(keys.every(Boolean)).toBe(true);
    for(const key of keys)expect(normalizeRymIdentity(key)).toBe(key);
    expect(normalizeRymIdentity('Oton\u0303al')).toBe(normalizeRymIdentity('Otoñal'));
    expect(normalizeRymIdentity('')).toBe('');
  });
  it("requires a resolved decision even for an identical artist name", async () => {
    const f = fixture(); f.ledger.identities[0]!.status = "needs_review";
    await expect(assertRymIdentity(f.client, f.ledger, "/artist/bacos", 1)).rejects.toThrow("sin resolver");
  });
  it("checks live repertoire and the pinned source titles", async () => {
    const f = fixture();
    await expect(assertRymIdentity(f.client, f.ledger, "/artist/bacos", 1)).resolves.toBeUndefined();
    f.albums.pop();
    await expect(assertRymIdentity(f.client, f.ledger, "/artist/bacos", 1)).rejects.toThrow("ya no alcanza");
  });
  it("rejects changed source bytes", async () => {
    const f = fixture(); writeFileSync(f.ledger.identities[0]!.pins[0]!.path, "changed");
    await expect(assertRymIdentity(f.client, f.ledger, "/artist/bacos", 1)).rejects.toThrow("Captura RYM cambió");
  });
  it("rejects a different target ID", async () => {
    const f = fixture();
    await expect(assertRymIdentity(f.client, f.ledger, "/artist/bacos", 2)).rejects.toThrow("sin resolver");
  });
  it("rejects multiple identities for the same canonical URL", () => {
    const f = fixture(); f.ledger.identities.push({ ...f.ledger.identities[0]!, href: "/artist/bacos/" });
    const filename = path.join(f.directory, "ledger.json"); writeFileSync(filename, JSON.stringify(f.ledger));
    expect(() => readRymIdentityLedger(filename)).toThrow("URL RYM duplicada");
  });
  it('resolves a one-album artist only with a complete literal recording witness',async()=>{
    const f=fixture(),titles=['Camino al mar','Otra orilla','Viento del sur'];
    f.ledger.identities[0]!.candidates[0]!.sharedAlbums=[];
    const pins=['json','html'].map(extension=>{
      const filename=path.join(f.directory,`recording.${extension}`);
      const content=extension==='json'?JSON.stringify({href:'/release/album/bacos/camino'}):
        `<div class="release_page_header"><a href="/artist/bacos">Bacos</a></div><div id="tracks">${titles.map(title=>`<li class="track"><div class="tracklist_line"><span class="tracklist_title">${title}</span></div></li>`).join('')}</div>`;
      writeFileSync(filename,content);return {path:filename,sha256:createHash('sha256').update(content).digest('hex')};
    });
    f.ledger.identities[0]!.candidates[0]!.recordingWitnesses=[{albumId:2,title:'Camino',sourceHref:'/release/album/bacos/camino',titles,pins}];
    const query=f.client.query.bind(f.client);
    const client={query:async(sql:string)=>sql.includes('FROM public.tracks')?{rows:titles.map(title=>({title}))}:query(sql)} as unknown as pg.Pool;
    await expect(assertRymIdentity(client,f.ledger,'/artist/bacos',1)).resolves.toBeUndefined();
    titles[1]='Grabación diferente';
    await expect(assertRymIdentity(client,f.ledger,'/artist/bacos',1)).rejects.toThrow('lista primaria');
  });
  it('does not accept a recording witness with only repeated generic titles',async()=>{
    const f=fixture();f.ledger.identities[0]!.candidates[0]!.sharedAlbums=[];
    f.ledger.identities[0]!.candidates[0]!.recordingWitnesses=[];
    await expect(assertRymIdentity(f.client,f.ledger,'/artist/bacos',1)).rejects.toThrow('ya no alcanza');
  });
});
