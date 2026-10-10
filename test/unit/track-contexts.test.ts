import { describe, it, expect } from "vitest";
import { energyLabel, energyObservationSchema, trackContextBatchSchema } from "../../src/discovery/track-context-contract.js";
const data = energyObservationSchema.parse({ activity: "high", dynamics: "low", density: "medium", basis: "reviewed-description",
  reference: "Descripción específica de esta versión", rightsBasis: "Fuente textual revisada, sin descargar audio", observations: "Pulso activo, dinámica suave y densidad intermedia" });
const decision = { key: "d", trackId: 1, expectedAlbumId: 1, expectedTitle: "Pista", label: "energy-medium", evidenceId: 1,
  confidence: "medium", methodVersion: "perceived-energy-v1", methodData: data, state: "approved", proposalKey: null,
  reason: "Revisión de tres ejes", validFrom: "2020-01-01T00:00:00Z", validUntil: null };
const batch = (d: unknown) => ({ batch: "qa", reviewer: "QA", note: "Revisión", decisions: [d] });
describe("contrato de contextos y método de energía", () => {
  it("la energía ordinal usa el eje central y admite discrepancia documentada", () => {
    expect(energyLabel(data)).toBe("energy-medium");
    expect(energyLabel({ ...data, density: "low" })).toBe("energy-low");
    expect(energyLabel({ ...data, dynamics: "high" })).toBe("energy-high");
  });
  it("rechaza etiqueta energética incompatible, método desconocido y acceso sin documentar", () => {
    expect(trackContextBatchSchema.safeParse(batch(decision)).success).toBe(true);
    for (const patch of [{ label: "energy-high" }, { methodVersion: "bpm" }, { evidenceId: null }, { methodData: { ...data, rightsBasis: " " } }]) {
      expect(trackContextBatchSchema.safeParse(batch({ ...decision, ...patch })).success).toBe(false);
    }
  });
  it("contextos requieren criterio editorial, evidencia para aprobación y ventana real incluso con offsets", () => {
    const d = { ...decision, label: "serene", methodVersion: "context-editorial-v1", methodData: null };
    expect(trackContextBatchSchema.safeParse(batch(d)).success).toBe(true);
    expect(trackContextBatchSchema.safeParse(batch({ ...d,evidenceId:null })).success).toBe(false);
    expect(trackContextBatchSchema.safeParse(batch({ ...d,validFrom:"2020-01-01T01:00:00+01:00",validUntil:"2020-01-01T00:00:00Z" })).success).toBe(false);
    expect(trackContextBatchSchema.safeParse(batch({ ...d,popularity:100 })).success).toBe(false);
  });
  it("propuestas algorítmicas nunca son decisiones y requieren versión; energía v1 es humana", () => {
    const p = { key:"p",trackId:1,expectedAlbumId:1,expectedTitle:"Pista",label:"serene",evidenceId:null,confidence:"low",
      methodVersion:"context-editorial-v1",methodData:null,origin:"algorithm",proposer:"Piloto",modelName:"modelo-fixture",
      modelVersion:"v1",generatedAt:"2020-01-01T00:00:00Z",rationale:"Hipótesis sin verificar" };
    const b = { batch:"qa",reviewer:"QA",note:"Propuestas",proposals:[p] };
    expect(trackContextBatchSchema.safeParse(b).success).toBe(true);
    expect(trackContextBatchSchema.safeParse({ ...b,proposals:[{ ...p,modelVersion:null }] }).success).toBe(false);
    expect(trackContextBatchSchema.safeParse({ ...b,proposals:[{ ...p,...decision,origin:"algorithm" }] }).success).toBe(false);
    expect(trackContextBatchSchema.safeParse({ ...b,proposals:[{ ...p,state:"approved" }] }).success).toBe(false);
  });
});
