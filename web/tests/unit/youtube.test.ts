import { describe, expect, it } from "vitest";
import { albumYoutubeVideoId, trackAtYoutubeTime, youtubeVideoId } from "../../src/lib/youtube";

const primaryId = "Q-pRpO2sYSI";
const secondaryId = "abcdefghijk";

describe("pista que está sonando", () => {
  const first = { youtubeStartSeconds: 0, durationSeconds: 184 };
  const second = { youtubeStartSeconds: 184, durationSeconds: 218 };
  const unknown = { youtubeStartSeconds: null, durationSeconds: null };

  it("incluye cero y cambia en el límite exacto, independientemente del orden", () => {
    const tracks = [second, unknown, first];
    expect(trackAtYoutubeTime(tracks, 0)).toBe(first);
    expect(trackAtYoutubeTime(tracks, 183.99)).toBe(first);
    expect(trackAtYoutubeTime(tracks, 184)).toBe(second);
    expect(trackAtYoutubeTime(tracks, 401.99)).toBe(second);
    expect(trackAtYoutubeTime(tracks, 402)).toBeNull();
  });

  it("no inventa una pista activa en huecos, tiempos desconocidos o inválidos", () => {
    expect(trackAtYoutubeTime([first, { youtubeStartSeconds: 200, durationSeconds: 20 }], 190)).toBeNull();
    expect(trackAtYoutubeTime([second], 183)).toBeNull();
    expect(trackAtYoutubeTime([unknown], 0)).toBeNull();
    expect(trackAtYoutubeTime([first], -1)).toBeNull();
    expect(trackAtYoutubeTime([first], Number.NaN)).toBeNull();
  });

  it("usa los inicios conocidos cuando no hay duración", () => {
    const withoutDuration = { youtubeStartSeconds: 0, durationSeconds: null };
    expect(trackAtYoutubeTime([withoutDuration, second], 100)).toBe(withoutDuration);
    expect(trackAtYoutubeTime([withoutDuration, second], 184)).toBe(second);
  });
});

describe("video del disco", () => {
  it.each([
    `https://www.youtube.com/watch?v=${primaryId}&t=184s`,
    `https://youtu.be/${primaryId}?si=share`,
    `https://m.youtube.com/watch?v=${primaryId}`,
    `https://www.youtube.com/embed/${primaryId}`,
    `https://www.youtube-nocookie.com/embed/${primaryId}`,
    `https://www.youtube.com/shorts/${primaryId}`,
    `https://www.youtube.com/live/${primaryId}`,
  ])("extrae el video de %s", (url) => {
    expect(youtubeVideoId(url)).toBe(primaryId);
  });

  it.each([null, "", "no es una URL", "https://youtube.com/watch?v=invalid", "https://youtu.be/", `https://youtube.com.ejemplo.com/watch?v=${primaryId}`, `https://ejemplo.com/watch?v=${primaryId}`, `javascript://youtube.com/watch?v=${primaryId}`])(
    "no crea un reproductor para %s", (url) => {
      expect(youtubeVideoId(url)).toBeNull();
    },
  );

  it("usa el principal aunque el URL o el primer vínculo correspondan a otro video", () => {
    expect(albumYoutubeVideoId({
      youtubeUrl: `https://youtu.be/${secondaryId}`,
      youtubeLinks: [
        { videoId: secondaryId, title: null, kind: "music_video", isPrimaryLink: false },
        { videoId: primaryId, title: null, kind: "full_album", isPrimaryLink: true },
      ],
    })).toBe(primaryId);
  });

  it("prefiere el disco completo y admite el URL cuando aún no hay vínculos", () => {
    expect(albumYoutubeVideoId({
      youtubeUrl: null,
      youtubeLinks: [
        { videoId: secondaryId, title: null, kind: "music_video", isPrimaryLink: false },
        { videoId: primaryId, title: null, kind: "full_album", isPrimaryLink: false },
      ],
    })).toBe(primaryId);
    expect(albumYoutubeVideoId({ youtubeUrl: `https://youtu.be/${primaryId}`, youtubeLinks: [] })).toBe(primaryId);
  });

  it("admite un video relacionado y omite los vínculos inválidos", () => {
    expect(albumYoutubeVideoId({
      youtubeUrl: null,
      youtubeLinks: [
        { videoId: "invalid", title: null, kind: "full_album", isPrimaryLink: true },
        { videoId: primaryId, title: null, kind: "music_video", isPrimaryLink: false },
      ],
    })).toBe(primaryId);
    expect(albumYoutubeVideoId({ youtubeUrl: null, youtubeLinks: [] })).toBeNull();
  });
});
