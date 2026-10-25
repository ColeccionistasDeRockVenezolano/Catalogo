import {describe,it,expect,vi} from "vitest";
import type {Readable as ResponseStream} from "node:stream";
const fixture=vi.hoisted(()=>({status:999}));
vi.mock("node:dns/promises",()=>({lookup:async()=>[{address:"8.8.8.8",family:4}]}));
vi.mock("node:https",async()=>{
  const {EventEmitter}=await import("node:events");
  const {Readable}=await import("node:stream");
  return {request:(_url:unknown,_options:unknown,callback:(response:ResponseStream&{headers:Record<string,string>;statusCode:number})=>void)=>{
    return Object.assign(new EventEmitter(),{end(){queueMicrotask(()=>callback(Object.assign(Readable.from([Buffer.from("Documento")]),{headers:{},statusCode:fixture.status})));}});
  }};
});
import {publicPageFetch} from "../../src/verification/documents/public-url.js";
describe("respuestas de páginas públicas",()=>{
  it("rechaza estados no estándar sin una excepción fuera de la promesa",async()=>{
    fixture.status=999;
    await expect(publicPageFetch("https://public.example/source")).rejects.toThrow(/Estado HTTP.*999/u);
  });
  it("mantiene la lectura del cuerpo de una respuesta ordinaria",async()=>{
    fixture.status=200;
    const response=await publicPageFetch("https://public.example/source");
    expect(response.status).toBe(200);expect(await response.text()).toBe("Documento");
  });
});
