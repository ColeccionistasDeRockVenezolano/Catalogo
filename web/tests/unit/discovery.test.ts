import { describe, it, expect, vi } from "vitest";
vi.mock("../../src/lib/api", () => ({ discoveryApi: {}, CATALOG_DATA_CHANGED_EVENT: "changed" }));
import { discoveryExamples, type DiscoveryResponse } from "../../src/lib/discovery";
const response: DiscoveryResponse = { enabled: true, fallback: "", intervalMs: 5000, refreshMs: 15000,
 groupPolicy: ["a","a","b"], suggestions: [
 {id:1,name:"Uno",group:"a",priority:1,validUntil:null},
 {id:2,name:"Dos",group:"a",priority:100,validUntil:null},
 {id:3,name:"Tres",group:"b",priority:1,validUntil:null},
 {id:4,name:"Cuatro",group:"otro",priority:1,validUntil:null}] };
describe("política editorial de descubrimiento", () => {
 it("respeta turnos y prioridad sin perder grupos ni artistas", () => {
   expect(discoveryExamples(response, () => 0.5).map(e=>e.key)).toEqual(["artist-2","artist-1","artist-3","artist-4"]);
 });
 it("una identidad por ID, incluso con aliases", () => {
   expect(discoveryExamples({...response,suggestions:[...response.suggestions,{...response.suggestions[0]!,name:"Alias"}]})).toHaveLength(4);
 });
 it("bandera apagada y lista vacía no producen ejemplos", () => {
   expect(discoveryExamples({...response,enabled:false})).toEqual([]);
   expect(discoveryExamples({...response,suggestions:[]})).toEqual([]);
 });
 it("ninguna prioridad excluye indefinidamente proyectos; usa nombres canónicos", () => {
   for(let i=0;i<20;i++) expect(new Set(discoveryExamples(response).map(e=>e.label))).toEqual(new Set(["Uno","Dos","Tres","Cuatro"]));
 });
});
