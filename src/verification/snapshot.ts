import { getPool } from "../db/client.js";
import { getArtistDetail } from "../api/repositories/artists.js";
import { getPersonDetail } from "../api/repositories/persons.js";
import { getAlbumDetail } from "../api/repositories/albums.js";
import { notFound } from "../api/http-errors.js";
import type { VerificationArea, VerificationKind, VerificationSnapshot, VerificationUnit } from "./types.js";

export async function loadVerificationSnapshot(kind: VerificationKind, id: number): Promise<VerificationSnapshot> {
  const units: VerificationUnit[] = [];
  const add = (key: string, area: VerificationArea, label: string, value: string | null, expected: string[] = [], context: string[] = [], issue: string | null = null) => {
    if (area === "socials" && value) {
      try { const url = new URL(value); if (!["https:","http:"].includes(url.protocol)) issue = "El enlace no usa una dirección web válida."; }
      catch { issue = "El enlace no es una URL válida."; }
    }
    units.push({key, area, label, value: value?.trim() || null, expected, context, issue});
  };
  const detail = kind === "artist" ? await getArtistDetail(id) : kind === "person" ? await getPersonDetail(id) : await getAlbumDetail(id);
  if (!detail) throw notFound(kind, id);
  const name = "name" in detail ? detail.name : detail.title;
  const identity = [name, ...detail.aliases.map((a) => a.alias)];
  add("identity.name", "identity", kind === "album" ? "Título y artista del disco" : "Nombre de la ficha", name, [name]);
  for (const alias of detail.aliases) add(`identity.alias.${alias.id}`, "identity", "Alias / AKA", alias.alias, [alias.alias], [name]);
  add("identity.aliases.search", "identity", "Otros alias / AKA documentados", null, [], [name]);
  if ("pictureUrl" in detail) add("images.profile", "images", "Foto de perfil en buena calidad", detail.pictureUrl, detail.pictureUrl ? [detail.pictureUrl] : [], [name]);
  let albumIds: number[];
  const urls: string[] = [];
  const artistIds: number[] = [];
  let bio: string | null;
  if (kind === "artist") {
    const artist = await getArtistDetail(id);
    if (!artist) throw notFound(kind,id);
    bio = artist.biography;
    if (artist.artistType === "solo_artist") identity.push(...artist.members.map(member=>member.personName));
    if (artist.artistType === "solo_artist") {
      for (const member of artist.members) {
        add(`person.${member.personId}.birth`, "status", `Nacimiento de ${member.personName}`, member.personBirthDate, member.personBirthDate ? [member.personBirthDate.slice(0,4)] : [], [name,member.personName]);
        add(`person.${member.personId}.death`, "status", `Fallecimiento de ${member.personName} (si corresponde)`, member.personDeathDate, member.personDeathDate ? [member.personDeathDate.slice(0,4)] : [], [name,member.personName]);
      }
      if (!artist.members.length) {
        add("status.birth", "status", "Año de nacimiento del solista", null, [], [name]);
        add("status.death", "status", "Año de fallecimiento del solista (si corresponde)", null, [], [name]);
      }
    }
    albumIds = artist.discography.map((a)=>a.albumId); artistIds.push(id);
    if (!artist.members.length) add("members.empty","members","Integrantes",null);
    for (const member of artist.members) {
      const context = [name];
      add(`member.${member.id}.name`, "members", "Integrante", member.personName,[member.personName],context);
      add(`member.${member.id}.role`, "members", `Rol de ${member.personName}`, member.role,member.role.split(/[,;&/]+/u).map(r=>r.trim()).filter(Boolean),[name,member.personName]);
      add(`member.${member.id}.from`, "members", `Inicio de ${member.personName}`, member.fromYear?.toString() ?? null,member.fromYear ? [String(member.fromYear)] : [],[name,member.personName],
        member.fromYear && member.personBirthDate && member.fromYear < Number(member.personBirthDate.slice(0,4)) ? "La membresía empieza antes del nacimiento." : null);
      add(`member.${member.id}.until`, "members", `Periodo de ${member.personName}`, member.isCurrent ? "Integrante actual" : member.toYear?.toString() ?? null, member.toYear ? [String(member.toYear)] : [],[name,member.personName],
        member.toYear !== null && member.fromYear !== null && member.toYear < member.fromYear ? "El periodo termina antes de empezar." : member.isCurrent && member.personIsDeceased ? "Figura como integrante actual una persona fallecida; revisar el estado o el periodo." : null);
    }
    const socials = (await getPool().query<{platform:string;url:string;verified:boolean}>("SELECT platform,url,verified FROM public.social_links WHERE artist_id=$1 ORDER BY platform",[id])).rows;
    if (!socials.length) add("socials.empty","socials","Perfiles sociales oficiales",null);
    for (const social of socials) { add(`social.${social.platform}`,"socials",social.platform,social.url,[social.url],[name]); urls.push(social.url); }
    for (const platform of artist.platforms) {add(`platform.${platform.platform}`,"socials",platform.platform,platform.url,[platform.url],[name]); urls.push(platform.url);}
    if (!artist.genres.length) add("genres.empty","genres","Géneros propios del artista",null);
    for (const genre of artist.genres) add(`genre.${genre.slug}`,"genres","Género del artista",genre.name,[genre.name],[name]);
    add("status.formed","status","Año de formación",artist.formedYear?.toString() ?? null,artist.formedYear ? [String(artist.formedYear)] : [],[name]);
    add("status.ended","status","Estado del proyecto",artist.disbandedYear ? `Disuelto en ${artist.disbandedYear}` : null,artist.disbandedYear ? [String(artist.disbandedYear)] : [],[name],
      artist.disbandedYear && artist.formedYear && artist.disbandedYear < artist.formedYear ? "La disolución es anterior a la formación." : null);
    add("identity.realName","identity","Nombre real del solista", artist.artistType === "solo_artist" ? artist.members.map(m=>m.personName).join(", ") || null : "No corresponde a un proyecto colectivo", [],[name]);
    if (artist.artistType !== "solo_artist") units.splice(units.findIndex(u=>u.key==="identity.realName"),1);
  } else if (kind === "person") {
    const person = await getPersonDetail(id);
    if (!person) throw notFound(kind,id);
    bio = person.biography;
    const real = person.aliases.find(a=>/real|full|legal/iu.test(a.aliasType));
    const storedName = (await getPool().query<{real_name:string|null}>("SELECT real_name FROM public.persons WHERE id=$1",[id])).rows[0]?.real_name;
    const realName = storedName ?? real?.alias ?? null;
    add("identity.realName","identity","Nombre real completo", realName,realName ? [realName] : [],[name]);
    add("status.birth","status","Fecha de nacimiento",person.birthDate,person.birthDate ? [person.birthDate.slice(0,4)] : [],[name]);
    add("status.life","status","Estado de la persona",person.deathDate ? `Fallecimiento: ${person.deathDate}` : person.isDeceasedFlag === true ? "Fallecido/a" : person.isDeceasedFlag === false ? "Sin fallecimiento registrado" : null,person.deathDate ? [person.deathDate.slice(0,4)] : [],[name],
      person.birthDate && person.deathDate && person.deathDate < person.birthDate ? "La muerte está registrada antes del nacimiento." : null);
    if (!person.bands.length && !person.albumCredits.length && !person.trackCredits.length) add("members.empty","members","Trayectoria y créditos",null);
    for (const band of person.bands) {
      artistIds.push(band.artistId);
      add(`band.${band.id}.name`,"members","Proyecto",band.artistName,[band.artistName],[name]);
      add(`band.${band.id}.role`,"members",`Rol en ${band.artistName}`,band.role,band.role.split(/[,;&/]+/u).map(r=>r.trim()).filter(Boolean),[name,band.artistName]);
      add(`band.${band.id}.period`,"status",`Periodo en ${band.artistName}`,band.fromYear ? `${band.fromYear}–${band.isCurrent ? "actualidad" : band.toYear ?? "sin final registrado"}` : null, [band.fromYear,band.toYear].filter((v):v is number=>v!==null).map(String),[name,band.artistName],
        band.fromYear && person.birthDate && band.fromYear < Number(person.birthDate.slice(0,4)) ? "La membresía precede al nacimiento." : band.toYear !== null && band.fromYear !== null && band.toYear < band.fromYear ? "Periodo de membresía invertido." : null);
    }
    for (const credit of [...person.albumCredits,...person.trackCredits]) add(`credit.${"trackId" in credit ? "track" : "album"}.${credit.id}`,"members",`Crédito en ${credit.albumTitle}`,`${credit.role}${"trackTitle" in credit ? ` · ${credit.trackTitle}` : ""}`,credit.role.split(/[,;&/]+/u).map(r=>r.trim()).filter(Boolean),[name,credit.albumTitle]);
    const linked = await getPool().query<{id:string}>(`SELECT DISTINCT id::text FROM public.albums WHERE id IN (
      SELECT album_id FROM public.album_credits WHERE person_id=$1 UNION SELECT t.album_id FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE c.person_id=$1
      UNION SELECT a.id FROM public.albums a JOIN public.artists s ON s.id=a.artist_id JOIN public.artist_members m ON m.artist_id=s.id WHERE m.person_id=$1 AND s.artist_type='solo_artist'
    ) ORDER BY id::text`,[id]);
    albumIds = linked.rows.map(r=>Number(r.id));
    add("socials.empty","socials","Redes personales documentadas",null);
    // No se heredan géneros de las bandas: se investiga la trayectoria propia.
    add("genres.empty","genres","Estilos de la trayectoria personal",null);
  } else {
    const album = await getAlbumDetail(id);
    if (!album) throw notFound(kind,id);
    identity.push(album.artist.name);
    units[0]!.expected.push(album.artist.name);
    units[0]!.context.push(album.artist.name);
    albumIds = [id]; artistIds.push(album.artist.id); bio = album.description;
    if (!album.genres.length) add("genres.empty","genres","Géneros del disco",null);
    for (const genre of album.genres) add(`genre.${genre.slug}`,"genres","Género del disco",genre.name,[genre.name],[album.title,album.artist.name]);
    for (const [platform,url] of [["YouTube",album.youtubeUrl],["Instagram",album.instagramUrl],["WordPress",album.wordpressUrl],...album.platforms.map(p=>[p.platform,p.url])] as Array<[string,string|null]>) {
      if (url) { add(`social.${platform}`,"socials",`Enlace ${platform}`,url,[url],[album.title,album.artist.name]);urls.push(url); }
    }
    if (!urls.length) add("socials.empty","socials","Enlaces del lanzamiento",null);
    add("status.release","status","Año del lanzamiento",album.releaseYear?.toString() ?? null,album.releaseYear ? [String(album.releaseYear)] : [],[album.title,album.artist.name]);
    add("status.type","status","Tipo de lanzamiento",album.albumType,[album.albumType],[album.title,album.artist.name]);
  }
  if (bio) {
    const sentences = bio.split(/(?<=[.!?])\s+|\n+/u).map(s=>s.trim()).filter(Boolean);
    for (const [index,sentence] of sentences.entries()) add(`bio.${index}`,"biography",kind === "album" ? "Descripción del disco" : "Afirmación biográfica",sentence,[],[name]);
  } else add("bio.empty","biography",kind === "album" ? "Descripción del disco" : "Biografía",null);
  const albums: VerificationSnapshot["albums"] = [];
  if (!albumIds.length) add("discography.empty","discography","Discos registrados",null);
  for (const albumId of [...new Set(albumIds)].sort((a,b)=>a-b)) {
    const album = await getAlbumDetail(albumId);
    if (!album) continue;
    albums.push({id:album.id,title:album.title,artist:album.artist.name,year:album.releaseYear});
    artistIds.push(album.artist.id);
    const context = [album.artist.name,album.title];
    add(`album.${album.id}.title`,"discography","Disco",album.title,[album.title,album.artist.name],kind === "person" ? [name] : []);
    add(`album.${album.id}.year`,"discography",`Año de ${album.title}`,album.releaseYear?.toString() ?? null,album.releaseYear ? [String(album.releaseYear)] : [],context);
    add(`album.${album.id}.type`,"discography",`Tipo de ${album.title}`,album.albumType,[album.albumType],context);
    if (kind === "album") {
      const credits = [...album.credits,...Object.values(album.scopedCreditsByType).flat()];
      if (!credits.length) add("members.empty","members","Créditos del disco",null);
      for (const credit of credits) add(`albumcredit.${credit.id}`,"members",`Crédito de ${credit.personName ?? credit.artistName ?? credit.organizationName}`,credit.role,credit.role.split(/[,;&/]+/u).map(r=>r.trim()).filter(Boolean),[...context,credit.personName ?? credit.artistName ?? credit.organizationName ?? ""]);
    }
    add(`album.${album.id}.cover`, "images", `Portada de ${album.title} en buena calidad`, album.coverUrl, album.coverUrl ? [album.coverUrl] : [], context);
    add(`album.${album.id}.label`, "labels", `Sello de ${album.title}`, album.label?.name ?? null, album.label ? [album.label.name] : [], context);
    if (kind !== "album") {
      if (!album.genres.length) add(`album.${album.id}.genres.empty`, "genres", `Géneros de ${album.title}`, null, [], context);
      for (const genre of album.genres) add(`album.${album.id}.genre.${genre.slug}`, "genres", `Género de ${album.title}`, genre.name, [genre.name], context);
    }
    if (!album.tracklist.length) add(`tracks.${album.id}.empty`,"tracks",`Pistas de ${album.title}`,null,[],context);
    const positions = new Set<string>();
    const byDisc = new Map<number,number[]>();
    for (const track of album.tracklist) {
      const position = `${track.discNumber}.${track.trackNumber}`;
      const discPositions=byDisc.get(track.discNumber) ?? []; discPositions.push(track.trackNumber);byDisc.set(track.discNumber,discPositions);
      add(`track.${track.id}`,"tracks",`${album.title} · ${position}`,track.title,[track.title],context,
        positions.has(position) ? `Dos pistas ocupan la posición ${position} en ${album.title}.` : track.discNumber < 1 || track.trackNumber < 1 ? "Posición de pista inválida." : null);
      positions.add(position);
      add(`track.${track.id}.order`,"tracks",`Orden de «${track.title}» en ${album.title}`,position,[track.title,String(track.trackNumber)],context);
    }
    for (const [disc,numbers] of byDisc) {
      const max=Math.max(...numbers);
      for(let n=1;n<=max;n++) if(!numbers.includes(n)) add(`tracks.${album.id}.gap.${disc}.${n}`,"tracks",`${album.title} · ${disc}.${n}`,null,[],context,`Falta la posición ${disc}.${n}; comprobar si la edición usa otra numeración.`);
    }
    for (const url of [album.youtubeUrl,album.wordpressUrl,...album.platforms.map(p=>p.url)]) if(url) urls.push(url);
  }
  add("discography.search","missingAlbums",kind === "album" ? "Otras ediciones y pistas ausentes" : "Lanzamientos ausentes del catálogo",null,[],[name]);
  // Todas las URL de procedencia pertenecen a entidades efectivamente incluidas.
  const column={person:"person_id",artist:"artist_id",album:"album_id"}[kind];
  const {rows}=await getPool().query<{url:string}>(`SELECT DISTINCT r.url FROM ingest.claims c JOIN ingest.raw_pages r ON r.id=c.raw_page_id
    WHERE (c.${column}=$1 OR c.album_id=ANY($2::bigint[]) OR c.artist_id=ANY($3::bigint[])) AND r.url IS NOT NULL ORDER BY r.url`,[id,albumIds,[...new Set(artistIds)]]);
  const known=await getPool().query<{id:string;title:string;artist:string;year:number|null}>("SELECT al.id::text,al.title,a.name AS artist,al.release_year AS year FROM public.albums al JOIN public.artists a ON a.id=al.artist_id WHERE al.artist_id=ANY($1::bigint[]) ORDER BY al.id",[[...new Set(artistIds)]]);
  const catalogAlbums=known.rows.map(a=>({...a,id:Number(a.id)}));
  return {kind,id,name,identity,units,albums,catalogAlbums,sourceUrls:[...new Set([...rows.map(r=>r.url),...urls])].sort()};
}
