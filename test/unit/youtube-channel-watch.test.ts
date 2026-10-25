import { describe, expect, it } from "vitest";
import { albumTypeFor, channelAlbumTitle, looseAlbumKey, planUpload, type WatchAlbum, type WatchCatalog, type WatchVideo } from "../../src/youtube/channel-watch.js";
import { youtubeLinkKey } from "../../src/youtube/linker.js";

const TRACKS = ["Monotonía", "Ladrón Perfecto", "Con Las Puertas Cerradas", "Para Estar Junto A Ti", "No Me Acostumbro"];

function video(title: string, tracks: string[] = TRACKS, status = "published"): WatchVideo {
  return {
    videoId: "6ascsso-J0s", title, durationSeconds: 2600, publicationStatus: status,
    tracklist: tracks.map((name, position) => ({ position, title: name, startSeconds: position * 200 })),
  };
}

function album(id: number, title: string, year: number | null, tracks: string[] = [], extra: Partial<WatchAlbum> = {}): WatchAlbum {
  return {
    id, artistId: 1, title, year, aliases: [], coverUrl: null, primary: null,
    tracks: tracks.map((name, index) => ({ id: id * 100 + index, discNumber: 1, trackNumber: index + 1, title: name, youtubeStartSeconds: null, durationSeconds: null })),
    ...extra,
  };
}

function catalog(albums: WatchAlbum[], artists: Array<{ id: number; name: string }> = [{ id: 1, name: "Tisuby & Georgina" }]): WatchCatalog {
  const artistsByKey = new Map<string, Array<{ id: number; name: string }>>();
  for (const artist of artists) artistsByKey.set(youtubeLinkKey(artist.name), [...(artistsByKey.get(youtubeLinkKey(artist.name)) ?? []), artist]);
  return { artistsByKey, albumsOf: (artistId) => albums.filter((item) => item.artistId === artistId) };
}

describe("channelAlbumTitle", () => {
  it("quita los añadidos del canal medidos en los enlaces existentes", () => {
    expect(channelAlbumTitle("Tisuby & Georgina - Sueños Simples (2001) || Full Album ||")).toBe("Sueños Simples");
    expect(channelAlbumTitle("Gasolina - Gasolina: Blues Criollo 4K60 Remastered (1975) || Full Album ||")).toBe("Blues Criollo");
    expect(channelAlbumTitle("Hana Kobayashi - Smells Like Teen Spirit @LaQuintaBar 4K60 Remastered (2019) || Full Album ||")).toBe("Smells Like Teen Spirit LaQuintaBar");
    expect(channelAlbumTitle("Cunaguaro Soul - Cunaguaro Soul | Full Album ||")).toBe("Cunaguaro Soul");
  });
  it("no devuelve un nombre que el parser no supo leer", () => {
    expect(channelAlbumTitle("SyncroDynamic - N[u(n)clear] [EP] (2011) || Full Album ||")).toBeNull();
  });
});

describe("looseAlbumKey", () => {
  it("iguala artículo inicial, volumen romano y conjunciones", () => {
    expect(looseAlbumKey("Los sueños simples")).toBe(looseAlbumKey("Sueños Simples"));
    expect(looseAlbumKey("El Final Del Mundo Vol. I")).toBe(looseAlbumKey("El Final Del Mundo Vol. 1"));
    expect(looseAlbumKey("La Magia De Los 60 & 70")).toBe(looseAlbumKey("La Magia De Los 60's y 70's"));
    expect(looseAlbumKey("Futuro")).not.toBe(looseAlbumKey("Futuro: Lado A / Lado B"));
  });
});

describe("albumTypeFor", () => {
  it("la etiqueta del título manda; si no, en vivo por el nombre o de estudio", () => {
    expect(albumTypeFor("X - Y [EP] (2011) || Full Album ||", "Y")).toBe("ep");
    expect(albumTypeFor("X - En Vivo (2013) || Full Album ||", "En Vivo")).toBe("live_album");
    expect(albumTypeFor("X - Y (2013) || Full Album ||", "Y")).toBe("studio_album");
  });
});

describe("planUpload", () => {
  const title = "Tisuby & Georgina - Sueños Simples (2001) || Full Album ||";

  it("enlaza como principal el disco con el mismo nombre (caso del 2026-10-13)", () => {
    const decision = planUpload(video(title), catalog([album(4542, "Sueños Simples", 2001, TRACKS), album(352, "Ruleta Del Amor", 2003)]));
    expect(decision).toMatchObject({ action: "link", albumId: 4542, rename: null, primary: true, via: "nombre exacto" });
  });

  it("renombra al título del canal cuando el nombre es equivalente y el año coincide", () => {
    const decision = planUpload(video(title), catalog([album(4542, "Los sueños simples", 2001)]));
    expect(decision).toMatchObject({ action: "link", albumId: 4542, rename: "Sueños Simples", via: "nombre equivalente" });
  });

  it("encuentra el disco por el tracklist aunque el nombre sea otro, y lo renombra", () => {
    const decision = planUpload(video(title), catalog([album(4542, "Primer disco", null, TRACKS)]));
    expect(decision).toMatchObject({ action: "link", albumId: 4542, rename: "Sueños Simples", via: "tracklist", fillYear: 2001 });
  });

  it("un alias del disco cuenta como su nombre y no provoca renombre si el título ya coincide", () => {
    const decision = planUpload(video(title), catalog([album(4542, "Sueños Simples", 2001, [], { aliases: ["Los sueños simples"] })]));
    expect(decision).toMatchObject({ action: "link", rename: null });
  });

  it("crea el disco si el artista existe y no hay nada parecido", () => {
    const decision = planUpload(video(title), catalog([album(352, "Ruleta Del Amor", 2003, ["Otra", "Cosa", "Distinta"])]));
    expect(decision).toMatchObject({ action: "create", artistId: 1, title: "Sueños Simples", year: 2001, albumType: "studio_album" });
  });

  it("un sencillo cuyas canciones están en un disco del artista se crea igual (caso Picahielo)", () => {
    const single = video("Tisuby & Georgina - Monotonía [Single] (2001) || Full Album ||", ["Monotonía", "Ladrón Perfecto", "Monotonía (Remix)"]);
    expect(planUpload(single, catalog([album(4542, "Sueños Simples", 2001, TRACKS)]))).toMatchObject({ action: "create", title: "Monotonía", albumType: "single" });
  });

  it("manda a la cola si el artista no existe o es ambiguo", () => {
    expect(planUpload(video("Nadie - Disco (2001) || Full Album ||"), catalog([])).action).toBe("review");
    const twins = catalog([], [{ id: 1, name: "Tisuby & Georgina" }, { id: 2, name: "Tisuby & Georgina" }]);
    expect(planUpload(video(title), twins)).toMatchObject({ action: "review", artistIds: [1, 2] });
  });

  it("manda a la cola el mismo nombre con otro año en vez de duplicar", () => {
    expect(planUpload(video(title), catalog([album(4542, "Sueños Simples", 1999)])).action).toBe("review");
  });

  it("manda a la cola un nombre equivalente sin año ni tracklist que lo confirme", () => {
    expect(planUpload(video(title, []), catalog([album(4542, "Los sueños simples", null)])).action).toBe("review");
  });

  it("si el video principal actual está caído, el nuevo pasa a principal; si está vivo, queda secundario", () => {
    const dead = album(4542, "Sueños Simples", 2001, [], { primary: { videoId: "old", available: false } });
    expect(planUpload(video(title), catalog([dead]))).toMatchObject({ action: "link", primary: true });
    const alive = album(4542, "Sueños Simples", 2001, [], { primary: { videoId: "old", available: true } });
    expect(planUpload(video(title), catalog([alive]))).toMatchObject({ action: "link", primary: false });
  });

  it("envía las entrevistas a audiovisuales e ignora discos con videos caídos", () => {
    expect(planUpload(video("Entrevista a CRV por @Exitos103.1"), catalog([])).action).toBe("audiovisual");
    expect(planUpload(video(title, TRACKS, "unpublished"), catalog([album(4542, "Sueños Simples", 2001)])).action).toBe("ignore");
  });
});
