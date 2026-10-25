import { createHash } from "node:crypto";
import { readFileSync,statSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { z } from "zod";
import { rymPublicationConflict,rymVideoOnlyMedium } from './rym-publication-identity.js';
import { load } from 'cheerio';

const candidateSchema = z.object({
  status: z.enum(["resolved", "needs_review"]), artistId: z.number().int().positive(), name: z.string(),
  rule: z.string(), yearAgrees: z.boolean(), cityAgrees: z.boolean(),
  catalogYear: z.number().nullable(), catalogCity: z.string().nullable(),
  sharedAlbums: z.array(z.object({ albumId: z.number().int().positive(), title: z.string(), sourceTitle: z.string() }).passthrough()),
  memberMatches: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
  recordingWitnesses: z.array(z.object({albumId:z.number().int().positive(),title:z.string(),sourceHref:z.string(),
    titles:z.array(z.string()).min(3),pins:z.array(z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/u)})).min(2)})).optional(),
});
export const rymIdentityLedgerSchema = z.object({
  version: z.literal("crv-rym-identity-v1"),
  identities: z.array(z.object({
    href: z.string().startsWith("/artist/"), sourceName: z.string(),
    status: z.enum(["resolved", "needs_review"]), artistId: z.number().int().positive().nullable(),
    candidates: z.array(candidateSchema),
    pins: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) })).min(1),
  }).superRefine((entry,ctx)=>{
    if(entry.status==='resolved'&&entry.pins.length<2)ctx.addIssue({code:'custom',message:'Identidad resuelta exige HTML y metadatos originales'});
  })),
});
export type RymIdentityLedger = z.infer<typeof rymIdentityLedgerSchema>;
const verifiedPins=new Map<string,{signature:string;hash:string}>();
/** Within one invocation, immutable source files need not be hashed again for
 * every field and credit. A change of inode, size, mtime or ctime invalidates
 * the cache; the expected digest is still checked on every call. */
export function verifyRymPin(pin:{path:string;sha256:string}):void{
  const stat=statSync(pin.path),signature=`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  let cached=verifiedPins.get(pin.path);
  if(!cached||cached.signature!==signature){cached={signature,hash:createHash('sha256').update(readFileSync(pin.path)).digest('hex')};verifiedPins.set(pin.path,cached);}
  if(cached.hash!==pin.sha256)throw new Error(`Captura RYM cambió: ${pin.path}`);
}
export function normalizeRymIdentity(value:string):string{
  const raw=value.trim();
  const key=raw.normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(!key||[...key].length<2&&raw.length>1&&/[^\p{L}\p{N}\s]/u.test(raw))return raw.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ');
  return key;
}
export function rymHref(value: string): string {
  return decodeURIComponent(value).replace(/^https:\/\/rateyourmusic\.com/u, "").split(/[?#]/u)[0]!.replace(/\/+$/u, "");
}
export function readRymIdentityLedger(filename: string): RymIdentityLedger {
  const ledger = rymIdentityLedgerSchema.parse(JSON.parse(readFileSync(filename, "utf8")));
  if (new Set(ledger.identities.map(entry => rymHref(entry.href))).size !== ledger.identities.length) throw new Error("URL RYM duplicada en el ledger de identidad");
  return ledger;
}

/** Rechecks both immutable source bytes and the live catalog witnesses. Never
 * accepts name/country alone or a decision supplied without its original proof. */
export async function assertRymIdentity(client: pg.Pool | pg.PoolClient, ledger: RymIdentityLedger, href: string, artistId: number): Promise<void> {
  const entry = ledger.identities.find(item => rymHref(item.href) === rymHref(href));
  if (!entry || entry.status !== "resolved" || entry.artistId !== artistId) throw new Error(`Identidad RYM sin resolver: ${href}`);
  const decision = entry.candidates.filter(item => item.status === "resolved");
  if (decision.length !== 1 || decision[0]!.artistId !== artistId) throw new Error("Decisión RYM ambigua");
  const proof = decision[0]!;
  for(const pin of entry.pins)verifyRymPin(pin);
  const rawPin=entry.pins.find(pin=>pin.path.endsWith('.json'));
  const raw=rawPin?{path:rawPin.path,content:readFileSync(rawPin.path)}:undefined;
  if (!raw || rymHref((JSON.parse(raw.content.toString("utf8")) as { href: string }).href) !== rymHref(href)) throw new Error("La captura no corresponde a la identidad RYM");
  const source = JSON.parse(raw.content.toString("utf8")) as { rec: { rows?: Array<{ t: string }> } };
  const sourceTitles = new Set((source.rec.rows ?? []).map(row => normalizeRymIdentity(row.t)));
  const artist = (await client.query<{ name: string; formed_year: number | null; origin_city: string | null }>(
    "SELECT name,formed_year,origin_city FROM public.artists WHERE id=$1", [artistId])).rows[0];
  if (!artist || normalizeRymIdentity(artist.name) !== normalizeRymIdentity(proof.name)) throw new Error("Artista del ledger cambió; regenerar identidad");
  const matches = await client.query<{ id: string; title: string }>(
    "SELECT id::text,title FROM public.albums WHERE artist_id=$1 AND id=ANY($2::bigint[])",
    [artistId, proof.sharedAlbums.map(album => album.albumId)]);
  const titles = new Set(matches.rows.filter(album => proof.sharedAlbums.some(saved => saved.albumId === Number(album.id)
    && normalizeRymIdentity(saved.title) === normalizeRymIdentity(album.title)
    && normalizeRymIdentity(saved.sourceTitle) === normalizeRymIdentity(album.title)
    && sourceTitles.has(normalizeRymIdentity(saved.sourceTitle)))).map(album => normalizeRymIdentity(album.title)));
  const members = await client.query<{ id: string; name: string }>(
    "SELECT DISTINCT p.id::text,p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1 AND p.id=ANY($2::bigint[])",
    [artistId, proof.memberMatches.map(member => member.id)]);
  const memberIds = new Set(members.rows.filter(member => proof.memberMatches.some(saved => saved.id === Number(member.id) && normalizeRymIdentity(saved.name) === normalizeRymIdentity(member.name))).map(member => member.id));
  // The source bytes are pinned; reject a change to either live witness used
  // by the planner, rather than searching unrelated years anywhere in HTML.
  const yearStillSupported = artist.formed_year !== null && artist.formed_year === proof.catalogYear;
  const cityStillSupported = !!artist.origin_city && normalizeRymIdentity(artist.origin_city) === normalizeRymIdentity(proof.catalogCity ?? "");
  let recordingSupported=false;
  for(const witness of proof.recordingWitnesses ?? []){
    const contents=witness.pins.map(pin=>{
      const content=readFileSync(pin.path);
      verifyRymPin(pin);
      return {path:pin.path,content};
    });
    const metadata=contents.find(p=>p.path.endsWith('.json')),html=contents.find(p=>p.path.endsWith('.html'));
    if(!metadata||!html||rymHref((JSON.parse(metadata.content.toString('utf8')) as {href:string}).href)!==rymHref(witness.sourceHref))throw new Error('Captura de repertorio sin URL acreditada');
    const $=load(html.content.toString('utf8'));
    const author=$('.release_page_header a[href^="/artist/"], a.artist[href^="/artist/"]').first().attr('href');
    if(!author||rymHref(author)!==rymHref(href))throw new Error('Repertorio de otro artista RYM');
    const primary=$('#tracks');
    const sourceTrackTitles=primary.find('li.track .tracklist_line .tracklist_title').map((_i,node)=>{
      const clean=$(node).clone();clean.find('.tracklist_duration,.tracks_lyric_link,a.artist').remove();
      return normalizeRymIdentity(clean.text());
    }).get();
    const wanted=witness.titles.map(normalizeRymIdentity);
    if(new Set(wanted).size<3||wanted.some(t=>!t)||JSON.stringify(sourceTrackTitles)!==JSON.stringify(wanted))throw new Error('Repertorio de identidad no coincide con la lista primaria');
    const live=(await client.query<{title:string}>(`SELECT t.title FROM public.tracks t JOIN public.albums a ON a.id=t.album_id
      WHERE a.id=$1 AND a.artist_id=$2 AND a.title=$3 ORDER BY t.disc_number,t.track_number,t.id`,[witness.albumId,artistId,witness.title])).rows.map(t=>normalizeRymIdentity(t.title));
    if(JSON.stringify(live)===JSON.stringify(wanted))recordingSupported=true;
  }
  const sufficient = titles.size >= 2 || (titles.size >= 1 && proof.yearAgrees && proof.cityAgrees && yearStillSupported && cityStillSupported) || memberIds.size >= 2 || recordingSupported;
  if (!sufficient) throw new Error("La evidencia de identidad RYM ya no alcanza; regenerar el ledger");
}

export interface RymCross {
  slug: string; albumId: number; artistId: number; artistHref: string;
  tituloCatalogo: string; tituloRym: string; sourceHref: string;
  identityVersion: string; capturePins: Array<{ path: string; sha256: string }>;
  releaseIdentityVersion: string; publicationType: string;
  audioEditionVerified?:boolean;
  sourceFormat?:string|null;
}

/** Required at every application entry point, even when invoked without the shell orchestrator. */
export async function validateRymCross(client: pg.Pool | pg.PoolClient, directory: string): Promise<Map<string, RymCross>> {
  const ledger = readRymIdentityLedger(path.join(directory, "identity-ledger.json"));
  const lines = readFileSync(path.join(directory, "cruce.jsonl"), "utf8").split("\n").filter(Boolean);
  const rows = lines.map(line => JSON.parse(line) as RymCross);
  const held=new Set((await client.query<{album_id:string}>("SELECT album_id::text FROM ingest.review_queue WHERE payload->>'operation'='rym_publication_identity_hold' AND status IN ('open','in_progress')")).rows.map(row=>Number(row.album_id)));
  const checked = new Set<string>();
  for (const row of rows) {
    if (row.identityVersion !== "crv-rym-identity-v1" || !row.artistHref || !row.sourceHref || !row.capturePins?.length) throw new Error("Cruce RYM anterior a la acreditación de identidad; regenerar");
    if(row.releaseIdentityVersion!=='crv-rym-release-v2' || !row.publicationType || held.has(row.albumId))throw new Error('Cruce RYM anterior a la revisión de publicación/edición; regenerar');
    if(rymVideoOnlyMedium(row.sourceFormat))throw new Error('El cruce contiene un soporte exclusivamente audiovisual');
    if (!checked.has(row.artistHref)) {
      await assertRymIdentity(client, ledger, row.artistHref, row.artistId);
      checked.add(row.artistHref);
    }
    let sourceVerified = false;
    for (const pin of row.capturePins) {
      verifyRymPin(pin);
      if (pin.path.endsWith(".json")) sourceVerified = rymHref((JSON.parse(readFileSync(pin.path,'utf8')) as { href: string }).href) === rymHref(row.sourceHref);
    }
    if (!sourceVerified) throw new Error("La captura no acredita la publicación del cruce");
    const album = (await client.query<{ artist_id: string; title: string;album_type:string;classifications:string[] }>("SELECT artist_id::text,title,album_type,ARRAY(SELECT classification FROM ingest.effective_album_classifications WHERE album_id=a.id) classifications FROM public.albums a WHERE id=$1", [row.albumId])).rows[0];
    if (!album || Number(album.artist_id) !== row.artistId || normalizeRymIdentity(album.title) !== normalizeRymIdentity(row.tituloCatalogo)) throw new Error("El destino del cruce cambió; regenerar");
    if(rymPublicationConflict(row.publicationType,album.album_type,album.classifications,row.audioEditionVerified??false))throw new Error('Tipo de publicación RYM sin acreditar; regenerar y revisar');
  }
  return new Map(rows.map(row => [row.slug, row]));
}
