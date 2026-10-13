import {createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {normalizePreservedState} from "../../src/verification/preserved-state.js";
import {evaluateVerification} from "../../src/verification/evaluate.js";
import type {ResearchState} from "../../src/verification/research.js";
import type {VerificationSnapshot} from "../../src/verification/types.js";

const snapshot:VerificationSnapshot={kind:"artist",id:1,name:"Grupo Archivo",identity:["Grupo Archivo"],units:[],sourceUrls:[],albums:[],catalogAlbums:[]};
const content="Grupo Archivo publicó Disco Histórico en 1998.",page={url:"https://fuente.example/grupo",title:"Grupo Archivo",content,contentHash:createHash("sha256").update(content).digest("hex"),fetchedAt:"2020-01-01T00:00:00Z",capturedAt:"2020-01-01T00:00:00Z",acquisitionMethod:"http" as const};
const marker={...page,url:"https://fuente.example/search",content:"",contentHash:"legacy-hash",origin:"search_snippet" as const,acquisitionMethod:"search_snippet" as const};
const state=():ResearchState=>({rulesVersion:6,pages:[marker,page],proposal:{findings:[],discoveries:[{area:"discography",value:"Disco Histórico",context:"Grupo Archivo",reason:"Lanzamiento",evidence:[{source:1,quote:content}]}]},pendingKeys:[],limitations:[],attempts:1});
const report=evaluateVerification(snapshot,[page],{findings:[],discoveries:[]},true);
describe("copias preservadas legadas",()=>{
 it("remapea todas las citas y conserva descubrimientos crudos al omitir únicamente marcadores vacíos sin referencias",()=>{
  const original=state(),copy=normalizePreservedState(original,report);
  expect(copy.pages).toEqual([page]);expect(copy.proposal.discoveries[0]?.evidence[0]?.source).toBe(0);
  expect(copy.normalizations).toEqual([{index:0,url:marker.url,contentHash:marker.contentHash,reason:"legacy_empty_uncited_search_marker"}]);
  expect(original).toEqual(state());expect(normalizePreservedState(copy,report)).toEqual(copy);
 });
 it("rechaza un marcador vacío citado y conserva referencias inválidas para su descarte auditado",()=>{
  const original=state();original.proposal.discoveries[0]!.evidence[0]!.source=0;
  expect(()=>normalizePreservedState(original,report)).toThrow(/hash/);
  original.proposal.discoveries[0]!.evidence[0]!.source=999;
  expect(normalizePreservedState(original,report).proposal.discoveries[0]?.evidence[0]?.source).toBe(999);
 });
 it("rechaza cualquier texto alterado aunque ninguna afirmación lo cite",()=>{
  const original=state();original.pages.push({...page,url:"https://fuente.example/extra",content:"Alterado"});
  expect(()=>normalizePreservedState(original,report)).toThrow(/hash/);
 });
 it("exige la captura exacta del informe y no sustituye un documento con el mismo URL",()=>{
  const original=state();original.pages[1]={...page,capturedAt:"2026-01-01T00:00:00Z"};
  expect(()=>normalizePreservedState(original,report)).toThrow(/copia exacta/);
 });
});
