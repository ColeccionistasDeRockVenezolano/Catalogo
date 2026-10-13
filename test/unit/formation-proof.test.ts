import {describe,it,expect} from "vitest";
import {evaluateVerification} from "../../src/verification/evaluate.js";
import type {VerificationSnapshot} from "../../src/verification/types.js";
const snapshot:VerificationSnapshot={kind:"artist",id:1,name:"Grupo Prueba",identity:["Grupo Prueba"],units:[{key:"status.formed",area:"status",label:"Formación",value:"2001",expected:["2001"],context:["Grupo Prueba"],issue:null}],sourceUrls:[],albums:[],catalogAlbums:[]};
const run=(content:string)=>evaluateVerification(snapshot,[{url:"https://fuente.example/grupo",title:"Grupo Prueba",content,contentHash:"fixture",fetchedAt:"2026-10-13T00:00:00Z"}],{findings:[{key:"status.formed",status:"confirmed",observed:"2001",reason:"Año",evidence:[{source:0,quote:content}]}],discoveries:[]},true).findings[0];
describe("formación respaldada por su propio evento",()=>{
 it("el primer disco no confirma formación y tampoco otro año de publicación en el mismo párrafo",()=>{
  expect(run("Grupo Prueba publicó su primer disco en 2001.")).toMatchObject({status:"unverified",coverage:0});
  expect(run("Grupo Prueba se formó en 1998 y publicó su primer disco en 2001.")).toMatchObject({status:"unverified",coverage:0});
 });
 it("acepta la fecha explícita de formación sin confundir un lanzamiento posterior",()=>{
  expect(run("Grupo Prueba se formó en 2001 y publicó su primer disco en 2003.")).toMatchObject({status:"confirmed",coverage:1});
  expect(run("Grupo Prueba\nFormación:\n2001\nPrimer disco: 2003")).toMatchObject({status:"confirmed",coverage:1});
 });
});
