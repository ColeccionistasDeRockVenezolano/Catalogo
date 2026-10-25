import { mapAlbumType } from '../ingest/lote-investigacion.js';
import { albumTitleCharacteristics } from '../normalization/album-characteristics.js';
import { liveTitleVerdict } from '../normalization/live-title.js';
import { rymVideoOnlyMedium } from './rym-publication-identity.js';

const months: Record<string,string> = {january:'enero',february:'febrero',march:'marzo',april:'abril',may:'mayo',june:'junio',july:'julio',august:'agosto',september:'septiembre',october:'octubre',november:'noviembre',december:'diciembre'};
/** Strip label/catalog prose; retain only an explicitly stated date precision. */
export function rymReleaseDateText(raw: string | null | undefined): string | null {
  const clean=(raw ?? '').replace(/^in\s+/iu,'').replace(/\s+on\s+.*$/iu,'').trim();
  if (/^\d{4}$/u.test(clean)) return clean;
  const match=/^(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(\d{4})$/u.exec(clean);
  const month=match ? months[match[2]!.toLowerCase()] : null;
  if (!match || !month || (match[1] && (Number(match[1]) < 1 || Number(match[1]) > 31))) return null;
  return match[1] ? `${Number(match[1])} de ${month} de ${match[3]}` : `${month} de ${match[3]}`;
}

/** Only explicit publication types. Features and editions never imply a base type. */
export function rymPublicationType(raw: string | null | undefined): { albumType: string; classifications: string[] } | null {
  if (!raw?.trim()) return null;
  const parts = raw.split(',').map(value => value.trim());
  if (parts.some(value => /video|film|concert|documentary|bootleg|unauthorized/i.test(value))) return null;
  const publication=/^(album|ep|single|compilation|live album|soundtrack|collaborative album|remix album|demo|dj mix|mixtape|additional release)$/i;
  const base = parts.find(value => publication.test(value));
  if (!base) return null;
  const known = /^(album|ep|single|compilation|live album|soundtrack|collaborative album|collaboration|split|remix album|demo|remix|acoustic|instrumental|live|en vivo|b-sides|dj mix|mixtape|additional release)$/i;
  if (parts.some(value => !known.test(value))) return null;
  const labels:Record<string,string>={album:'Studio Album',ep:'EP',single:'Single',compilation:'Compilation Album',collaboration:'Collaboration Album','collaborative album':'Collaboration Album','live album':'Live Album',soundtrack:'Soundtrack',split:'Split','remix album':'Remix',demo:'Demos',remix:'Remix',acoustic:'Acústico',instrumental:'Instrumental',live:'En vivo','en vivo':'En vivo','b-sides':'B-Sides','dj mix':'DJ Mix',mixtape:'Mixtape'};
  return { albumType:/^(?:dj mix|mixtape|additional release)$/iu.test(base)?'other':base.toLowerCase()==='demo'?'demo':mapAlbumType(base)!, classifications:parts.flatMap(value=>labels[value.toLowerCase()]?[labels[value.toLowerCase()]!]:[]) };
}

export interface RymPublicationInput {tipo:string|null;titulo:string;artista?:string|null;formato?:string|null;musicalEditionVerified?:boolean;publication_attributes?:Array<{classification:string;basis:string;evidence:string}>}
/** Publication-level statements only; no characteristic is copied from a track. */
export function rymReleaseClassifications(source:RymPublicationInput): {albumType:string;classifications:string[];reviewReason?:string} | null {
  if(rymVideoOnlyMedium(source.formato))return null;
  const base=rymPublicationType(source.tipo);
  if(!base)return null;
  if(/\badditional release\b/iu.test(source.tipo??'')&&!source.musicalEditionVerified&&!/\b(?:CD|LP|Vinyl|Cassette)\b/iu.test(source.formato??''))return {...base,reviewReason:'additional_release_audio_edition_not_documented'};
  if(base.classifications.includes('DJ Mix')&&!source.musicalEditionVerified&&!/\b(?:CD|LP|Vinyl|Cassette)\b/iu.test(source.formato??''))return {...base,reviewReason:'dj_mix_audio_edition_not_documented'};
  const live=liveTitleVerdict(source.titulo,source.artista);
  if(live.marker?.includes('otro tipo'))return {...base,reviewReason:'mixed_material_title_requires_content_review'};
  const classifications=new Set([...base.classifications,...albumTitleCharacteristics(source.titulo)]);
  for(const attribute of source.publication_attributes ?? [])classifications.add(attribute.classification);
  if(/\bdemos?\b/iu.test(source.titulo))classifications.add('Demos');
  const recordedLive=classifications.has('En vivo') || live.live || /^live\s+(?:19|20)\d{2}\s+ep$/iu.test(source.titulo.trim()) && base.albumType==='ep'
    || source.publication_attributes?.some(attribute=>attribute.classification==='En vivo');
  let albumType=base.albumType;
  if(classifications.has('Soundtrack') && albumType==='studio_album'){albumType='soundtrack';classifications.delete('Studio Album');}
  if(recordedLive){
    classifications.add('En vivo');
    if(albumType==='studio_album'){albumType='live_album';classifications.delete('Studio Album');classifications.add('Live Album');}
  }
  return {albumType,classifications:[...classifications]};
}

export interface RymTrackInput { n: string; titulo: string; seg: number; dur?: string; title_ambiguous?: boolean }
export function rymTrackPositions(tracks: RymTrackInput[]): Array<{ title: string; disc_number: number; track_number: number; duration_seconds?: number; notes: string }> | null {
  const positions = new Set<string>();
  const notations = new Set<string>();
  const counters = new Map<number, number>();
  const result: Array<{ title: string; disc_number: number; track_number: number; duration_seconds?: number; notes: string }> = [];
  for (const track of tracks) {
    const position = track.n.trim();
    if (track.title_ambiguous || !track.titulo.trim() || track.titulo.trim().length > 250 || !/^(?:[1-9]\d*(?:\.[1-9]\d*)?|[A-Z](?:[1-9]\d*)?)$/.test(position)) return null;
    if (positions.has(position)) return null;
    positions.add(position);
    const cd = /^(\d+)\.(\d+)$/.exec(position);
    const side = /^([A-Z])\d*$/.exec(position);
    notations.add(cd ? 'disc' : side ? 'side' : 'number');
    if (notations.size > 1) return null;
    const disc = cd ? Number(cd[1]) : side ? Math.floor((side[1]!.charCodeAt(0) - 65) / 2) + 1 : 1;
    const number = cd ? Number(cd[2]) : side ? (counters.get(disc) ?? 0) + 1 : Number(position);
    if (disc > 100 || number > 1000 || result.some(item => item.disc_number === disc && item.track_number === number)) return null;
    counters.set(disc, number);
    result.push({ title: track.titulo.trim().normalize('NFC'), disc_number: disc, track_number: number,
      ...(track.dur && track.seg > 0 ? { duration_seconds: track.seg } : {}), notes: `Posición documentada en RYM: ${position}.` });
  }
  return result;
}
