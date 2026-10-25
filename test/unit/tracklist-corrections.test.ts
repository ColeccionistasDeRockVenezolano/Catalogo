import { describe, expect, it } from "vitest";
import { tracklistFingerprint } from "../../src/verification/tracklist-corrections.js";
describe("rejected tracklist identity", () => {
  it("recognizes spelling normalization without depending on inherited durations", () => {
    expect(tracklistFingerprint(["Música Normal", "Aquí no"])).toBe(tracklistFingerprint(["musica normal", "Aqui No"]));
  });
  it("does not reject an independently delimited list or another version", () => {
    expect(tracklistFingerprint(["Música Normal"])).not.toBe(tracklistFingerprint(["Música Normal (Remix)"]));
    expect(tracklistFingerprint(["Uno", "Dos"])).not.toBe(tracklistFingerprint(["Uno"]));
    expect(tracklistFingerprint(["Uno", "Dos"])).not.toBe(tracklistFingerprint(["Dos", "Uno"]));
  });
});
