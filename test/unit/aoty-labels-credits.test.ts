import { describe, expect, it } from "vitest";
import { buildPlan, labelLinks } from "../../scripts/aoty-labels-credits.js";

type Album = Parameters<typeof buildPlan>[0][number];
type Snapshot = Parameters<typeof buildPlan>[1];
const album: Album = {
  id: 10, title: "Disco", artist: "Artista", artist_url: "/artist/1-artista/",
  url: "https://www.albumoftheyear.org/album/10-disco.php",
  details: { "Release Date": { text: "January 1, 2020 / Release Date" }, Label: { text: "Sello / Label", links: [{ name: "Sello", url: "/label/2-sello/" }] } },
  credits: { full: [{ name: "Artista", url: "/artist/1-artista/", role: "Producer" }] },
};
function snapshot(): Snapshot {
  return {
    albums: [{ id: 100, artist_id: 1, name: "Artista", title: "Disco", release_year: 2020, label_id: null }],
    organizations: [{ id: 2, name: "Sello", organization_type: "record_label" }],
    persons: [], artists: [{ id: 1, name: "Artista" }], organizationAliases: [],
    anchors: [{ artist_id: 1, url: album.url }], personContext: [], credits: [], soloOwners: [],
  };
}
describe("enriquecimiento AOTY con contexto y edición", () => {
  it("identifica el sello y el crédito por aprobación anterior de AOTY", () => {
    const plan = buildPlan([album], snapshot());
    expect(plan.labelPlan[0]?.organizationId).toBe(2);
    expect(plan.creditPlan[0]?.endpoints).toEqual({ artistId: 1 });
  });
  it("rechaza años diferentes y años ausentes", () => {
    for (const release_year of [2021, null]) {
      const data = snapshot(); data.albums[0]!.release_year = release_year;
      const plan = buildPlan([album], data);
      expect(plan.labelPlan).toHaveLength(0); expect(plan.creditPlan).toHaveLength(0);
    }
  });
  it("no resuelve por título base ni por nombre de artista sin evidencia", () => {
    const data = snapshot(); data.anchors = [];
    expect(buildPlan([album], data).creditPlan).toHaveLength(0);
    data.anchors = snapshot().anchors; data.albums[0]!.title = "Disco (Deluxe)";
    expect(buildPlan([album], data).creditPlan).toHaveLength(0);
  });
  it("no convierte sellos compuestos ni No Label en organizaciones", () => {
    expect(labelLinks({ ...album, details: { Label: { text: "No Label / Label", links: [{ name: "No Label", url: "/label/994-no-label/" }] } } })).toEqual([]);
    expect(labelLinks({ ...album, details: { Label: { text: "Sello , Otro / Label", links: [{ name: "Sello", url: "/label/2-sello/" }, { name: "Otro", url: "/label/3-otro/" }] } } })).toEqual([]);
  });
  it("conserva los sellos existentes y rechaza homónimos", () => {
    const data = snapshot(); data.albums[0]!.label_id = 9;
    expect(buildPlan([album], data).labelPlan).toHaveLength(0);
    data.albums[0]!.label_id = null; data.organizations.push({ id: 3, name: "Sello", organization_type: "record_label" });
    expect(buildPlan([album], data).labelPlan).toHaveLength(0);
  });
  it("reutiliza el titular documentado de un solista y no duplica créditos", () => {
    const data = snapshot(); data.soloOwners = [{ person_id: 4, artist_id: 1 }];
    expect(buildPlan([album], data).creditPlan[0]?.endpoints).toEqual({ personId: 4 });
    data.credits = [{ album_id: 100, person_id: 4, artist_id: null, credit_type: "producer", role: "Producer" }];
    expect(buildPlan([album, album], data).creditPlan).toHaveLength(0);
  });
  it("Primary no es un crédito técnico y Feature conserva su tipo de invitado", () => {
    const work = { ...album, credits: { full: [{ name: "Artista", url: "/artist/1-artista/", role: "Primary" }, { name: "Artista", url: "/artist/1-artista/", role: "Feature" }] } };
    const plan = buildPlan([work], snapshot());
    expect(plan.creditPlan).toHaveLength(1); expect(plan.creditPlan[0]?.creditType).toBe("guest");
  });
  it("un nombre de persona necesita contexto y no puede tener homónimos", () => {
    const data = snapshot(); data.persons = [{ id: 5, name: "Técnico" }];
    const work = { ...album, credits: { full: [{ name: "Técnico", url: "/artist/99-tecnico/", role: "Mixing Engineer" }] } };
    expect(buildPlan([work], data).creditPlan).toHaveLength(0);
    data.personContext.push({ person_id: 5, artist_id: 1 });
    expect(buildPlan([work], data).creditPlan[0]?.endpoints).toEqual({ personId: 5 });
    data.persons.push({ id: 6, name: "Técnico" });
    expect(buildPlan([work], data).creditPlan).toHaveLength(0);
  });
});
