import {describe,it,expect} from "vitest";
import {sourceMatchesIdentity} from "../../src/verification/source-identity.js";
import type {VerificationSnapshot} from "../../src/verification/types.js";
const snapshot:VerificationSnapshot={kind:"artist",id:1,name:"Horizonte",identity:["Horizonte"],units:[],sourceUrls:[],albums:[],catalogAlbums:[],identityProfile:{names:["Horizonte"],legalNames:[],country:"Venezuela",relatedNames:["Músico Primero"],repertoire:["Disco del Norte"]}};
const page=(content:string)=>({url:"https://fuente.example",title:"Horizonte",content,contentHash:"fixture",fetchedAt:"2026-10-13T00:00:00Z"});
describe("identidad contextual de todos los tipos",()=>{
 it("rechaza homónimos y referencias geográficas lejos del sujeto",()=>{
  expect(sourceMatchesIdentity(snapshot,page("Horizonte es una banda argentina."))).toBe(false);
  expect(sourceMatchesIdentity(snapshot,page(`Horizonte. ${"Contenido distinto. ".repeat(180)} Venezuela banda venezolana.`))).toBe(false);
  expect(sourceMatchesIdentity(snapshot,page("Horizonte es una banda venezolana."))).toBe(true);
  expect(sourceMatchesIdentity(snapshot,page("Horizonte publicó Disco del Norte."))).toBe(true);
 });
 it("distingue personas y proyectos por pertenencia o nombre legal documentado",()=>{
  const person={...snapshot,kind:"person" as const,identityProfile:{...snapshot.identityProfile!,relatedNames:["Proyecto Asociado"],legalNames:["Nombre Completo Legal"]}};
  expect(sourceMatchesIdentity(person,page("Horizonte colaboró con Proyecto Asociado."))).toBe(true);
  expect(sourceMatchesIdentity(person,page("Horizonte es un escritor de Chile."))).toBe(false);
 });
 it("requiere artista y álbum para atribuir una pista; el título solo no identifica su edición",()=>{
  const track={...snapshot,kind:"track" as const,identityProfile:{...snapshot.identityProfile!,artist:"Artista Asociado",album:"Disco Asociado"}};
  expect(sourceMatchesIdentity(track,page("Artista Asociado publicó Horizonte en Disco Asociado."))).toBe(true);
  expect(sourceMatchesIdentity(track,page("Otro Artista publicó Horizonte en Disco Asociado."))).toBe(false);
 });
 it("excluye navegación como ancla de país y valida organizaciones en su ámbito",()=>{
  const org={...snapshot,kind:"organization" as const};
  const document={captureId:1,rawHash:"fixture",format:"html" as const,method:"html",extractionVersion:1,complete:true,unreadParts:[],warnings:[],followLinks:[],locations:[{start:0,end:Buffer.byteLength("Horizonte"),selector:"main",context:"body" as const},{start:10,end:45,selector:"nav",context:"navigation" as const}]};
  expect(sourceMatchesIdentity(org,{...page("Horizonte Venezuela sello discográfico"),document})).toBe(false);
  expect(sourceMatchesIdentity(org,page("Horizonte es un sello venezolano."))).toBe(true);
 });
});
