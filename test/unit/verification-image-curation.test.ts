import {describe,it,expect} from "vitest";
import {imageTarget} from "../../src/verification/image-curation.js";
import type {VerificationFinding} from "../../src/verification/types.js";
const artist={kind:"artist" as const,id:1,name:"Jeremías",currentUrl:null};
const albums=[{kind:"album" as const,id:2,name:"Jeremías",currentUrl:null},{kind:"album" as const,id:3,name:"Un día más en el gran circo",currentUrl:null,aliases:["Un Día Más En El Circo"]}];
const finding=(context:string,quote:string,pageUrl="https://source.example/biografia"):VerificationFinding=>({key:"suggested.0",area:"images",label:"Imagen",value:null,expected:[],issue:null,status:"unverified",coverage:0,observed:"https://source.example/image.jpg",explanation:"Imagen",context:[context],evidence:[{url:pageUrl,title:context,quote:`${quote} | URL: https://source.example/image.jpg`,origin:"page",fetchedAt:"2026-10-10"}]});
describe("fotos y portadas hacia Curaduría",()=>{
  it("distingue el debut homónimo de la foto del artista",()=>{
    expect(imageTarget(finding("Jeremías","Imagen: Retrato del cantante"),artist,albums)?.kind).toBe("artist");
    expect(imageTarget(finding("Jeremías","Imagen: Portada del disco","https://source.example/album/jeremias"),artist,albums)?.id).toBe(2);
  });
  it("usa referencias de álbum explícitas y sus alias documentados",()=>{
    expect(imageTarget({...finding("Jeremías","Imagen"),key:"album.3.cover"},artist,albums)?.id).toBe(3);
    expect(imageTarget(finding("Un Día Más En El Circo","Imagen: Portada"),artist,albums)?.id).toBe(3);
  });
  it("envía también variantes de portada de una edición para comparación visual",()=>{
    const variants=[...albums,{kind:"album" as const,id:4,name:"Ese que va por ahí",currentUrl:null}];
    expect(imageTarget(finding("Ese que va por ahí (Bonus Track Version)","Imagen: Portada","https://source.example/album/bonus"),artist,variants)?.id).toBe(4);
  });
  it("no asigna a otra ficha una portada con disco desconocido o contexto ambiguo",()=>{
    expect(imageTarget(finding("Disco nuevo","Imagen: Portada","https://source.example/album/nuevo"),artist,albums)).toBeUndefined();
    expect(imageTarget(finding("Jeremías","Imagen principal","https://source.example/album/jeremias"),artist,albums)?.id).toBe(2);
  });
});
