import {describe,it,expect} from "vitest";
import {sourceMatchesIdentity} from "../../src/verification/source-identity.js";
import {unusableReason} from "../../src/verification/proof.js";
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
 it("dos pistas catalogadas cerca del nombre identifican el repertorio, aunque la página perdiera los saltos de línea",()=>{
  const track=(id:number,title:string)=>({key:`track.${id}`,area:"tracks" as const,label:`Disco · 1.${id}`,value:title,expected:[title],context:["Horizonte","Disco"],issue:null});
  const withTracks={...snapshot,units:[track(1,"Clan Venérea"),track(2,"Techos de Cartón"),track(3,"Beto")]};
  expect(sourceMatchesIdentity(withTracks,page("Horizonte (1994) 01) El circo02) Techos de cartón03) Arrebátate14) Clan venérea15) La torre"))).toBe(true);
  // One title may be a cover or a homonym; a short title never anchors.
  expect(sourceMatchesIdentity(withTracks,page("Horizonte tocó Clan Venérea en vivo."))).toBe(false);
  expect(sourceMatchesIdentity(withTracks,page("Horizonte: Beto y Clan Venérea."))).toBe(false);
 });
 it("un homónimo junto a otra ciudad venezolana va a revisión salvo que lo anclen integrantes o repertorio",()=>{
  const city={key:"identity.city",area:"identity" as const,label:"Ciudad de origen",value:"Caracas",expected:["Caracas"],context:["Horizonte"],issue:null};
  const caraquenos={...snapshot,units:[city]};
  expect(sourceMatchesIdentity(caraquenos,page("HORIZONTE ES UN GRUPO QUE DESDE BARQUISIMETO NO BAJA LA GUARDIA. Banda de thrash."))).toBe(false);
  expect(sourceMatchesIdentity(caraquenos,page("Horizonte, banda de Caracas, tocó en Barquisimeto."))).toBe(true);
  expect(sourceMatchesIdentity(caraquenos,page("Horizonte, banda de Barquisimeto con Músico Primero en la voz."))).toBe(true);
 });
 it("la ciudad de un toque no es el origen; el gentilicio cuenta como la ciudad catalogada (Soma Raza)",()=>{
  const city={key:"identity.city",area:"identity" as const,label:"Ciudad de origen",value:"Caracas",expected:["Caracas"],context:["Horizonte"],issue:null};
  const caraquenos={...snapshot,units:[city]};
  expect(sourceMatchesIdentity(caraquenos,page("Presentación de Horizonte en la radio. El 28 de diciembre presentan un toque en la ciudad de Barquisimeto. Grupo de ska venezolano."))).toBe(true);
  expect(sourceMatchesIdentity(caraquenos,page("Horizonte, revelación entre las nuevas bandas caraqueñas. Luego, Barquisimeto."))).toBe(true);
  expect(sourceMatchesIdentity(caraquenos,page("Horizonte, banda de Barquisimeto que dio un toque en Maracay."))).toBe(false);
 });
 it("un integrante ancla aunque la fuente añada una inicial o el OCR cambie una letra del apellido",()=>{
  const band={...snapshot,identityProfile:{...snapshot.identityProfile!,country:null,relatedNames:["Arnold de Vries","Robert Gibiaqui"]}};
  expect(sourceMatchesIdentity(band,page("Horizonte. Arnold M. De Vries Van Leeuwen, 18 años, se inscribe en el conservatorio."))).toBe(true);
  expect(sourceMatchesIdentity(band,page("Horizonte. Robert Gigiaqui en la batería."))).toBe(true);
  expect(sourceMatchesIdentity(band,page("Horizonte. Roberto Gibiaqui en la batería."))).toBe(false);
  expect(sourceMatchesIdentity(band,page("Horizonte. Robert Gibson en la batería."))).toBe(false);
 });
 it("las demás páginas del sitio que lleva el nombre de la ficha heredan la identidad de una página identificada",()=>{
  const bio={...page("Horizonte es una banda venezolana."),url:"https://www.horizonte.com/biografia/"};
  const portfolio={...page("Portafolio. Canciones grabadas por otros artistas."),url:"https://horizonte.com/compositor"};
  const elsewhere={...page("Portafolio. Canciones grabadas por otros artistas."),url:"https://otro.example/compositor"};
  expect(sourceMatchesIdentity(snapshot,portfolio,[bio,portfolio,elsewhere])).toBe(true);
  expect(sourceMatchesIdentity(snapshot,elsewhere,[bio,portfolio,elsewhere])).toBe(false);
  // Without an identified page on the site, its name alone proves nothing.
  expect(sourceMatchesIdentity(snapshot,portfolio,[portfolio])).toBe(false);
  const person={...snapshot,kind:"person" as const,name:"Juan Carlos Pérez Soto",identity:["Juan Carlos Pérez Soto"],identityProfile:{...snapshot.identityProfile!,names:["Juan Carlos Pérez Soto"]}};
  const own=(path:string,content:string)=>({...page(content),url:`https://www.jcperezsoto.com/${path}`});
  const pages=[own("biografia","Juan Carlos Pérez Soto, cantautor venezolano."),own("compositor","Juan Carlos Pérez Soto. Canciones.")];
  expect(sourceMatchesIdentity(person,pages[1]!,pages)).toBe(true);
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
 it("una reseña que solo nombra a la banda en el título se identifica por su repertorio",()=>{
  const review={url:"https://blog.example/horizonte-disco",title:"Horizonte «Disco del Norte» (1996)",content:"Banda de Caracas que publicó su segundo álbum con Músico Primero en la guitarra.",contentHash:"fixture",fetchedAt:"2026-10-19T00:00:00Z"};
  expect(sourceMatchesIdentity(snapshot,review)).toBe(true);
  expect(sourceMatchesIdentity(snapshot,{...review,title:"Reseña de 1996"})).toBe(false);
 });
 it("ciudades venezolanas, roles en plural o de intérprete y la web oficial catalogada identifican la fuente",()=>{
  expect(sourceMatchesIdentity(snapshot,page("Horizonte, Víctimas y Odio fueron bandas del movimiento subterráneo de Caracas."))).toBe(true);
  expect(sourceMatchesIdentity(snapshot,page("Horizonte, tenor venezolano lírico-spinto."))).toBe(true);
  expect(sourceMatchesIdentity(snapshot,page("Horizonte: banda de Valencia."))).toBe(false);
  const withSite={...snapshot,units:[{key:"social.website",area:"socials" as const,label:"Web",value:"https://horizonte.example/",expected:[],context:[],issue:null}]};
  expect(sourceMatchesIdentity(withSite,{...page("Horizonte intervistato a Roma."),url:"http://www.horizonte.example/documents/articolo.pdf"})).toBe(true);
  expect(sourceMatchesIdentity(withSite,{...page("Horizonte intervistato a Roma."),url:"https://otro.example/articolo.pdf"})).toBe(false);
 });
});
describe("capturas que no pueden respaldar datos",()=>{
 const capture=(title:string,content:string,document?:object)=>({url:"https://fuente.example",title,content,contentHash:"fixture",fetchedAt:"2026-10-19T00:00:00Z",...(document?{document}:{})}) as Parameters<typeof unusableReason>[0];
 it("distingue avisos de navegador, accesos con cuenta y HTML sin extraer de una página real",()=>{
  expect(unusableReason(capture("Banda - Disco","O YouTube Music não está otimizado para seu navegador. Verifique se há atualizações ou teste o Google Chrome."))).toMatch(/navegador/u);
  expect(unusableReason(capture("Listado","¡Hola! Para continuar, ingresa a tu cuenta. Soy nuevo. Ya tengo cuenta."))).toMatch(/sesión/u);
  expect(unusableReason(capture("Banda | Spotify","<!DOCTYPE html><html><head><title>Banda</title></head><body></body></html>"))).toMatch(/volver a leerla/u);
  expect(unusableReason(capture("Banda","Banda venezolana de rock formada en 1990. Si tu navegador no es compatible con el reproductor, usa la versión de texto. ".repeat(8)))).toBeNull();
  expect(unusableReason(capture("Client Challenge","Comprobando"))).toMatch(/desafío/u);
 });
});
