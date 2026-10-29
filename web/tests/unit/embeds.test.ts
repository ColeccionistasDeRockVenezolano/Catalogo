import { describe, expect, it } from "vitest";
import { embedFor, embedOptions, preferredPlatform } from "../../src/lib/embeds";

describe("reproductor de cada plataforma", () => {
  it("CRV reproduce el video elegido sin convertirlo en una lista ni mezclarlo con el YouTube del artista", () => {
    expect(embedFor({ platform: "crv_youtube", url: "https://www.youtube.com/watch?v=mKt3ABDlyTg" }, "artist"))
      .toMatchObject({ src: "https://www.youtube-nocookie.com/embed/mKt3ABDlyTg?rel=0", previewsWithoutLogin: false });
    expect(embedFor({ platform: "crv_youtube", url: "https://www.youtube.com/watch?v=invalido" }, "artist")).toBeNull();
    const options = embedOptions([{ label: "Video CRV", links: [
      { platform: "crv_youtube", url: "https://www.youtube.com/watch?v=mKt3ABDlyTg" },
      { platform: "youtube", url: "https://www.youtube.com/channel/UCtYlrz6GyvRahlhHjocWQYQ" },
    ] }], "artist");
    expect(options.map(option => option.platform)).toEqual(["crv_youtube", "youtube"]);
  });
  it("Spotify: disco, artista y pista, también con prefijo de idioma", () => {
    expect(embedFor({ platform: "spotify", url: "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy" }, "album")?.src)
      .toBe("https://open.spotify.com/embed/album/4aawyAB9vmqN3uQ7FjRGTy?utm_source=generator");
    expect(embedFor({ platform: "spotify", url: "https://open.spotify.com/intl-es/artist/1Dt7cfRzxM8qPVa82jX9y5" }, "artist")?.src)
      .toBe("https://open.spotify.com/embed/artist/1Dt7cfRzxM8qPVa82jX9y5?utm_source=generator");
    expect(embedFor({ platform: "spotify", url: "https://open.spotify.com/user/xyz" }, "album")).toBeNull();
  });

  it("Deezer: el disco con su lista y el artista por sus más escuchadas", () => {
    expect(embedFor({ platform: "deezer", url: "https://www.deezer.com/album/156420822" }, "album")?.src)
      .toBe("https://widget.deezer.com/widget/dark/album/156420822?tracklist=true");
    expect(embedFor({ platform: "deezer", url: "https://www.deezer.com/es/artist/461584" }, "artist")?.src)
      .toBe("https://widget.deezer.com/widget/dark/artist/461584/top_tracks?tracklist=true");
  });

  it("Apple Music solo inserta discos", () => {
    expect(embedFor({ platform: "apple_music", url: "https://music.apple.com/us/album/lifestyle-moods/1566698869?uo=4" }, "album")?.src)
      .toBe("https://embed.music.apple.com/us/album/1566698869");
    expect(embedFor({ platform: "apple_music", url: "https://itunes.apple.com/no/artist/id16339946" }, "artist")).toBeNull();
  });

  it("Tidal inserta discos, no perfiles", () => {
    expect(embedFor({ platform: "tidal", url: "https://tidal.com/browse/album/77646169" }, "album")?.src).toBe("https://embed.tidal.com/albums/77646169");
    expect(embedFor({ platform: "tidal", url: "https://tidal.com/artist/24052" }, "artist")).toBeNull();
  });

  it("Bandcamp necesita el id del disco", () => {
    expect(embedFor({ platform: "bandcamp", url: "https://x.bandcamp.com/album/y", externalId: "album=3578302479" }, "album")?.src)
      .toContain("https://bandcamp.com/EmbeddedPlayer/album=3578302479/");
    expect(embedFor({ platform: "bandcamp", url: "https://x.bandcamp.com/" }, "artist")).toBeNull();
  });
  it("conserva el perfil y usa el identificador documentado para reproducir", () => {
    expect(embedFor({platform:"youtube",url:"https://www.youtube.com/@embriogenesis",externalId:"UCtYlrz6GyvRahlhHjocWQYQ"},"artist")?.src)
      .toContain("list=UUtYlrz6GyvRahlhHjocWQYQ");
    expect(embedFor({platform:"bandcamp",url:"https://example.bandcamp.com",externalId:"album=123456"},"artist")?.src)
      .toContain("album=123456/");
  });
  it("permite un disco verificado como fuente del reproductor de un artista", () => {
    const options=embedOptions([
      {label:null,links:[{platform:"apple_music",url:"https://music.apple.com/us/artist/829131381"}]},
      {label:"Disco documentado",owner:"album",links:[{platform:"apple_music",url:"https://music.apple.com/us/album/prueba/123456"}]},
    ],"artist");
    expect(options).toHaveLength(1);
    expect(options[0]?.targets[0]).toMatchObject({label:"Disco documentado",embed:{src:"https://embed.music.apple.com/us/album/123456"}});
  });

  it("SoundCloud codifica la URL del perfil", () => {
    const embed = embedFor({ platform: "soundcloud", url: "https://soundcloud.com/gorgorothofficial" }, "artist");
    expect(embed?.src).toContain("https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fgorgorothofficial");
    expect(embed?.previewsWithoutLogin).toBe(false);
  });

  it("YouTube Music y el canal de YouTube se reproducen como lista", () => {
    expect(embedFor({ platform: "youtube_music", url: "https://music.youtube.com/playlist?list=OLAK5uy_k27Dvl5Wh1qdkbnTc4-_QH-jb1l4Zy__I" }, "album")?.src)
      .toBe("https://www.youtube-nocookie.com/embed/videoseries?list=OLAK5uy_k27Dvl5Wh1qdkbnTc4-_QH-jb1l4Zy__I&rel=0");
    expect(embedFor({ platform: "youtube_music", url: "https://music.youtube.com/channel/UCHmVsLXc3SbTX6NjyW_7RAQ", externalId: "VLOLAK5uy_mKfk1PLIFVLaMKPCUt08q-Dhp9X2094Rk" }, "artist")?.src)
      .toContain("list=OLAK5uy_mKfk1PLIFVLaMKPCUt08q-Dhp9X2094Rk");
    expect(embedFor({ platform: "youtube", url: "https://www.youtube.com/channel/UCPFxN9KeilJRpQLLvxa6VFA" }, "artist")?.src)
      .toContain("list=UUPFxN9KeilJRpQLLvxa6VFA");
    expect(embedFor({ platform: "youtube", url: "https://www.youtube.com/@Necronacia" }, "artist")).toBeNull();
    expect(embedFor({ platform: "amazon_music", url: "https://music.amazon.com/artists/B000QKCC9Q" }, "artist")).toBeNull();
  });
});

describe("selector de plataformas", () => {
  it("prioriza CRV, Bandcamp, SoundCloud, YouTube y YouTube Music en artistas y discos", () => {
    const links = [
      { platform: "youtube", url: "https://www.youtube.com/channel/UCtYlrz6GyvRahlhHjocWQYQ" },
      { platform: "deezer", url: "https://www.deezer.com/artist/461584" },
      { platform: "crv_youtube", url: "https://www.youtube.com/watch?v=mKt3ABDlyTg" },
      { platform: "spotify", url: "https://open.spotify.com/artist/1Dt7cfRzxM8qPVa82jX9y5" },
      { platform: "soundcloud", url: "https://soundcloud.com/gorgorothofficial" },
      { platform: "bandcamp", url: "https://example.bandcamp.com/", externalId: "album=123456" },
      { platform: "youtube_music", url: "https://music.youtube.com/playlist?list=OLAK5uy_k27Dvl5Wh1qdkbnTc4-_QH-jb1l4Zy__I" },
      { platform: "amazon_music", url: "https://music.amazon.com/artists/B000QKCC9Q" },
      { platform: "apple_music", url: "https://music.apple.com/us/album/prueba/123456" },
      { platform: "tidal", url: "https://tidal.com/album/123456" },
    ];
    for (const owner of ["artist", "album"] as const) {
      const remaining = [...links];
      const tail = owner === "artist" ? ["spotify", "deezer", "apple_music", "tidal"] : ["spotify", "apple_music", "deezer", "tidal"];
      for (const expected of ["crv_youtube", "bandcamp", "soundcloud", "youtube", "youtube_music", ...tail]) {
        const options = embedOptions([{ label: null, links: remaining, owner: "album" }], owner);
        expect(options[0]?.platform).toBe(expected);
        expect(options.some(option => option.platform === "amazon_music")).toBe(false);
        remaining.splice(remaining.findIndex(link => link.platform === expected), 1);
      }
      expect(embedOptions([{ label: null, links: remaining }], owner)).toEqual([]);
    }
  });

  it("omite enlaces sin reproductor válido al elegir la prioridad del perfil", () => {
    const options = embedOptions([{ label: null, links: [
      { platform: "soundcloud", url: "https://example.com/perfil" },
      { platform: "spotify", url: "https://open.spotify.com/user/xyz" },
      { platform: "crv_youtube", url: "https://www.youtube.com/watch?v=invalido" },
      { platform: "deezer", url: "https://www.deezer.com/artist/461584" },
    ] }], "artist");
    expect(options.map(option => option.platform)).toEqual(["deezer"]);
  });

  it("ordena por plataforma, agrupa los reproductores de cada disco y no repite", () => {
    const options = embedOptions([
      { label: null, links: [{ platform: "deezer", url: "https://www.deezer.com/album/1" }, { platform: "spotify", url: "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy" }, { platform: "amazon_music", url: "https://music.amazon.com/albums/B1" }] },
      { label: "Lado B", links: [{ platform: "deezer", url: "https://www.deezer.com/album/2" }, { platform: "deezer", url: "https://www.deezer.com/album/1" }] },
    ], "album");
    expect(options.map((option) => option.platform)).toEqual(["spotify", "deezer"]);
    expect(options[1]!.targets.map((target) => target.label)).toEqual([null, "Lado B"]);
  });

  it("recuerda la plataforma elegida solo si esta ficha la tiene", () => {
    expect(preferredPlatform(["youtube", "spotify"], "spotify")).toBe("spotify");
    expect(preferredPlatform(["youtube", "deezer"], "spotify")).toBe("youtube");
    expect(preferredPlatform([], "spotify")).toBeNull();
  });
});
