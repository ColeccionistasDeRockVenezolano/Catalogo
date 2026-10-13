import {describe,it,expect} from "vitest";
import {dateBacked} from "../../src/verification/date-proof.js";
import {evaluateVerification} from "../../src/verification/evaluate.js";
import type {VerificationSnapshot} from "../../src/verification/types.js";
const snapshot:VerificationSnapshot={kind:"person",id:1,name:"Persona Prueba",identity:["Persona Prueba"],units:[{key:"status.birth",area:"status",label:"Nacimiento",value:"1980-03-29",expected:["1980"],context:["Persona Prueba"],issue:null}],sourceUrls:[],albums:[],catalogAlbums:[]};
describe("respaldo con precisión de fecha",()=>{
 it("reconoce fechas naturales en español e inglés sin confundir números separados",()=>{
  expect(dateBacked("Persona Prueba nació el 29 de marzo de 1980.","1980-03-29")).toBe(true);
  expect(dateBacked("Born March 29, 1980","1980-03")).toBe(true);
  expect(dateBacked("1980; disco 3; pista 29","1980-03-29")).toBe(false);
  expect(dateBacked("1980-11-29","1980-01")).toBe(false);
 });
 it("un año solo aporta respaldo parcial a una fecha que contiene mes y día",()=>{
  const run=(content:string)=>evaluateVerification(snapshot,[{url:"https://fuente.example/persona",title:"Persona Prueba",content,contentHash:"fixture",fetchedAt:"2026-10-13T00:00:00Z"}],{findings:[{key:"status.birth",status:"confirmed",observed:"1980-03-29",reason:"Fecha",evidence:[{source:0,quote:content}]}],discoveries:[]},true).findings[0];
  expect(run("Persona Prueba nació en 1980.")).toMatchObject({status:"partial",coverage:1/3});
  expect(run("Persona Prueba nació el 29 de marzo de 1980.")).toMatchObject({status:"confirmed",coverage:1});
 });
});
