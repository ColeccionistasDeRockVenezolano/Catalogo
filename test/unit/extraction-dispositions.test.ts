import {describe,it,expect} from "vitest";
import {evaluateVerification} from "../../src/verification/evaluate.js";
import type {VerificationSnapshot} from "../../src/verification/types.js";
const snapshot:VerificationSnapshot={kind:"artist",id:1,name:"Banda Prueba",identity:["Banda Prueba"],sourceUrls:[],albums:[],catalogAlbums:[],units:[{key:"genre.rock",area:"genres",label:"Género",value:"Rock",expected:["Rock"],context:["Banda Prueba"],issue:null}]};
const content="Banda Prueba toca Rock y Jazz. Grabó en Estudio Primero en 1998.",page={url:"https://fuente.example/banda",title:snapshot.name,content,contentHash:"fixture",fetchedAt:"2026-10-10T00:00:00Z"};
describe("destinos de todas las extracciones",()=>{
 it("conserva hechos presentes, sugerencias, ámbitos no compatibles y citas rechazadas con motivos explícitos",()=>{
  const evidence=[{source:0,quote:content}];
  const report=evaluateVerification(snapshot,[page],{findings:[{key:"field.not_supported",status:"confirmed",observed:"Grabación original de estudio",reason:"No existe este campo",evidence}],discoveries:[
   {area:"genres",value:"Rock",context:snapshot.name,reason:"En la ficha",evidence},
   {area:"genres",value:"Jazz",context:snapshot.name,reason:"Otro género",evidence},
   {area:"genres",value:"Metal",context:snapshot.name,reason:"Incorrecto",evidence:[{source:0,quote:"No está en la fuente"}]},
   {area:"labels",value:"Sello inventado",context:snapshot.name,reason:"Referencia inválida",evidence:[{source:42,quote:content}]},
  ]},true);
  expect(report.extractions).toHaveLength(5);
  expect(report.extractions?.map(item=>item.destination)).toEqual(["pending","already_present","proposal","discarded","discarded"]);
  expect(report.extractions?.every(item=>item.id&&item.reason&&item.evidence.length)).toBe(true);
  expect(report.extractions?.find(item=>item.destination==="proposal")?.findingKey).toBe(report.suggestions?.[0]?.key);
 });
 it("no considera documentado un valor por compartir una cita válida que no lo menciona",()=>{
  const report=evaluateVerification(snapshot,[page],{findings:[],discoveries:[{area:"genres",value:"Metal",context:snapshot.name,reason:"Pendiente",evidence:[{source:0,quote:content}]}]},true);
  expect(report.extractions?.[0]).toMatchObject({destination:"pending",state:"uncertain"});
 });
});
