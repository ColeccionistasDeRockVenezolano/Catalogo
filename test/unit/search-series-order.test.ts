import { describe, expect, it } from "vitest";
import { sortSeries } from "../../src/api/repositories/search.js";

const labels = (xs: string[]) => sortSeries(xs.map(label => ({ label }))).map(hit => hit.label);

describe("sortSeries", () => {
  it("ordena cada serie por número aunque haya dos series y títulos sueltos", () => {
    expect(labels(["Venezuelademo 1", "Venezuelademo 10", "Venezuelademo 2", "Otro disco", "VenezuelaDemo Disco 10", "VenezuelaDemo disco 4", "Venezuelademo 3"]))
      .toEqual(["Venezuelademo 1", "Venezuelademo 2", "Venezuelademo 3", "Venezuelademo 10", "Otro disco", "VenezuelaDemo disco 4", "VenezuelaDemo Disco 10"]);
  });
  it("no toca un número suelto que no forma serie", () => {
    expect(labels(["Disco B 2", "Álbum 1999", "Disco A"])).toEqual(["Disco B 2", "Álbum 1999", "Disco A"]);
  });
});
