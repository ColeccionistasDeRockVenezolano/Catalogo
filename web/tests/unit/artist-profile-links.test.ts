import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { artistProfileLinks, isYouTubeProfile } from "../../../src/shared/platforms";
import { PlatformLinks } from "../../src/components/PlatformLinks";

describe("canales de artistas en Síguelos en", () => {
  it.each([
    "https://www.youtube.com/@Banda",
    "https://youtube.com/channel/UCabc123/videos",
    "https://m.youtube.com/c/Banda/",
    "https://www.youtube.com/user/Banda/about?view=1",
  ])("reconoce el perfil %s", (url) => {
    expect(isYouTubeProfile({ platform: "youtube", url })).toBe(true);
  });

  it.each([
    "https://www.youtube.com/watch?v=video",
    "https://youtu.be/video",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/shorts/video",
    "https://music.youtube.com/channel/UCabc123",
    "https://youtube.com.ejemplo.com/@Banda",
    "https://www.youtube.com/",
    "https://www.youtube.com/watch",
    "enlace inválido",
  ])("no convierte música ni videos en perfiles: %s", (url) => {
    expect(isYouTubeProfile({ platform: "youtube", url })).toBe(false);
  });

  it("mueve los canales históricos, conserva los demás enlaces y no modifica los originales", () => {
    const channel = { platform: "youtube", url: "https://youtube.com/@Banda" };
    const spotify = { platform: "spotify", url: "https://open.spotify.com/artist/id" };
    const music = { platform: "youtube_music", url: "https://music.youtube.com/channel/UC123" };
    const socials = [{ platform: "instagram", url: "https://instagram.com/banda" }];
    const platforms = [channel, spotify, music];
    expect(artistProfileLinks(socials, platforms)).toEqual({ follow: [...socials, channel], listen: [spotify, music] });
    expect(platforms).toEqual([channel, spotify, music]);
    expect(socials).toHaveLength(1);
    expect(artistProfileLinks([], [channel])).toEqual({ follow: [channel], listen: [] });
  });

  it("prioriza el perfil social existente sin duplicar YouTube", () => {
    const social = { platform: "youtube", url: "https://youtube.com/@Oficial" };
    expect(artistProfileLinks([social], [{ platform: "youtube", url: "https://youtube.com/user/Anterior" }]))
      .toEqual({ follow: [social], listen: [] });
  });

  it("el botón de seguimiento abre el canal con su logo y nombre accesible", () => {
    const links = [{ platform: "youtube", url: "https://youtube.com/@Banda" }];
    const render = (follow: boolean) => renderToStaticMarkup(createElement(PlatformLinks, { links, subject: "Banda", follow }));
    expect(render(true)).toContain('aria-label="Banda: Seguir en YouTube"');
    expect(render(true)).toContain('href="https://youtube.com/@Banda"');
    expect(render(true)).toContain('target="_blank"');
    expect(render(true)).toContain("<svg");
    expect(render(false)).toContain('aria-label="Banda: Escuchar en YouTube"');
  });
});
