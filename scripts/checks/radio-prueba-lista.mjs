// CRV · Fase 3: ¿pasa YouTube a la pieza siguiente con la pantalla apagada en Brave para Android?
// Prueba aislada: no toca la radio, ni la base, ni el dominio. Sirve una página y guarda lo que informa.
//   lista:  el reproductor recibe todas las piezas y avanza solo (loadPlaylist).
//   relevo: nuestra página carga la siguiente al terminar cada una, como hace la radio (loadVideoById).
//   dos_fin:      dos reproductores. El segundo carga la siguiente, suena 1 s en silencio y queda en pausa;
//                 al terminar la primera, arranca. Luego el reproductor libre prepara la pieza que sigue.
//   dos_solapado: igual, pero el segundo arranca 3 s antes de que termine la primera, sin hueco de sonido.
//   En los modos dos, la primera pieza empieza a 90 s de su final para acortar la prueba.
//
//   node scripts/checks/radio-prueba-lista.mjs --salida=dir --videos=id1,id2,id3 [--host=127.0.0.1] [--ruta=secreto]
// Con --ruta, todo lo que no cuelgue de ella responde 404: sirve para exponerla un rato por un túnel.
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const opcion = (nombre, defecto) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1] ?? defecto;
const host = opcion("host", "127.0.0.1");
const puerto = Number(opcion("puerto", "3199"));
const salida = opcion("salida", "");
const ruta = opcion("ruta", "") ? `/${opcion("ruta", "")}` : "";
const videos = opcion("videos", "").split(",").filter((id) => /^[\w-]{11}$/u.test(id));
if (!salida || videos.length < 2) { console.error("faltan --salida=dir y --videos=id1,id2"); process.exit(2); }
mkdirSync(salida, { recursive: true });
const registro = join(salida, "eventos.jsonl");

const pagina = `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin">
<title>Prueba de radio</title><style>
body{margin:0;padding:16px;background:#111;color:#eee;font:16px system-ui}button{font:inherit;padding:14px;margin:0 8px 12px 0;min-height:48px}
#r,#r2{display:block;aspect-ratio:16/9;width:100%;max-width:480px;margin-bottom:8px}pre{font-size:12px;white-space:pre-wrap}</style>
<p>Toca un modo, espera a que suene y apaga la pantalla hasta que pasen las piezas.</p>
<button id="lista">Probar lista</button><button id="relevo">Probar relevo</button><br>
<button id="dos_fin">Dos reproductores: al terminar</button><button id="dos_solapado">Dos reproductores: solapados</button>
<p id="aviso"></p><div id="r"></div><div id="r2"></div><pre id="v"></pre>
<script>
const VIDEOS=${JSON.stringify(videos)};
const sesion=Math.random().toString(36).slice(2,10);let modo="",jugador,segundo,listos=0,indice=0,pendientes=[];
let activo=0,saliente=null,prep=null,saltoHecho=false;
const J=()=>[jugador,segundo],esDos=()=>modo.startsWith("dos_");
const v=document.getElementById("v");
function enviar(){if(!pendientes.length)return;const lote=pendientes;pendientes=[];
 fetch("${ruta}/eventos",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify(lote)}).catch(()=>{pendientes=lote.concat(pendientes)})}
function ev(tipo,datos){const f={t:new Date().toISOString(),sesion,modo,tipo,oculta:document.hidden,...datos};pendientes.push(f);v.textContent=f.t.slice(11,19)+" "+tipo+" "+JSON.stringify(datos||{})+"\\n"+v.textContent.slice(0,2000);enviar()}
function foto(p){try{return{estado:p.getPlayerState(),video:p.getVideoData().video_id,tiempo:Math.round(p.getCurrentTime()),duracion:Math.round(p.getDuration()),cargado:Math.round(p.getVideoLoadedFraction()*100),mudo:p.isMuted()}}catch(e){return{}}}
function fotos(){return{activo,a:foto(jugador),b:foto(segundo)}}
function preparar(i){const p=J()[i],video=VIDEOS[(indice+1)%VIDEOS.length];prep={i,video,hecho:false,temporizador:null};ev("prep_pide",{reproductor:i,video,...fotos()});p.mute();p.loadVideoById(video)}
function terminarPreparacion(i){const p=J()[i];if(!prep||prep.i!==i||prep.hecho)return;prep.hecho=true;p.pauseVideo();p.seekTo(0,true);p.unMute();p.setVolume(100);ev("prep_ok",{reproductor:i,...fotos()});
 document.getElementById("aviso").textContent="Listo: apaga la pantalla."}
function pasar(motivo){const sig=1-activo;if(prep&&prep.i===sig&&!prep.hecho)ev("prep_incompleta",fotos());prep=null;ev("pasa",{motivo,hacia:sig,...fotos()});
 saliente=activo;activo=sig;indice+=1;const p=J()[sig];p.unMute();p.setVolume(100);p.playVideo();
 setTimeout(()=>{if(p.getPlayerState()!==1){ev("reintenta",fotos());p.playVideo()}},5000)}
function alCambiar(i,e){const p=J()[i];
 if(prep&&prep.i===i&&!prep.hecho&&e.data===1&&!prep.temporizador)prep.temporizador=setTimeout(()=>terminarPreparacion(i),1000);
 if(i===activo&&e.data===1){ev("suena",{reproductor:i,...fotos()});
  if(!saltoHecho){saltoHecho=true;const d=p.getDuration();if(d>150)p.seekTo(d-90,true)}}
 if(i===activo&&e.data===0)pasar("termino");
 if(saliente!==null&&J()[saliente].getPlayerState()===0&&J()[activo].getPlayerState()===1){const libre=saliente;saliente=null;preparar(libre)}}
setInterval(()=>{if(modo!=="dos_solapado"||saliente!==null||!saltoHecho)return;const p=J()[activo];try{const d=p.getDuration(),t=p.getCurrentTime();if(p.getPlayerState()===1&&d>0&&d-t<=3)pasar("solapa")}catch(e){}},500);
function estado(){try{return{estado:jugador.getPlayerState(),video:jugador.getVideoData().video_id,tiempo:Math.round(jugador.getCurrentTime()),posicion:jugador.getPlaylistIndex()}}catch(e){return{}}}
ev("carga",{ua:navigator.userAgent});
for(const n of["visibilitychange","freeze","resume","pagehide","pageshow"])document.addEventListener(n,()=>ev(n));
for(const n of["online","offline","freeze","resume"])window.addEventListener(n,()=>ev(n));
setInterval(()=>{if(modo)ev("latido",esDos()?fotos():estado())},5000);
window.onYouTubeIframeAPIReady=()=>{segundo=new YT.Player("r2",{playerVars:{playsinline:1,origin:location.origin},events:{
 onReady(){listos+=1;ev("listo",{reproductor:1})},onError(e){ev("error",{reproductor:1,codigo:e.data,...fotos()})},
 onStateChange(e){ev("estado",{reproductor:1,nuevo:e.data,...fotos()});if(esDos())alCambiar(1,e)}}});
 jugador=new YT.Player("r",{playerVars:{playsinline:1,origin:location.origin},events:{
 onReady(){listos+=1;ev("listo",{reproductor:0})},onError(e){ev("error",{codigo:e.data,...estado()})},
 onStateChange(e){ev("estado",{...estado(),nuevo:e.data});if(esDos())alCambiar(0,e);
  if(modo==="relevo"&&e.data===0&&indice<VIDEOS.length-1){indice+=1;ev("relevo_pide",{video:VIDEOS[indice]});jugador.loadVideoById(VIDEOS[indice])}}}})};
function empezar(m){if(listos<2)return;modo=m;indice=0;ev("empieza");
 if(esDos()){activo=0;saliente=null;saltoHecho=false;document.getElementById("aviso").textContent="Preparando el segundo reproductor…";jugador.loadVideoById(VIDEOS[0]);preparar(1);return}
 if(m==="lista")jugador.loadPlaylist(VIDEOS,0,0);else jugador.loadVideoById(VIDEOS[0])}
for(const m of["lista","relevo","dos_fin","dos_solapado"])document.getElementById(m).onclick=()=>empezar(m);
</script><script src="https://www.youtube.com/iframe_api"></script></html>`;

createServer((peticion, respuesta) => {
  if (peticion.method === "POST" && peticion.url === `${ruta}/eventos`) {
    let cuerpo = "";
    peticion.on("data", (trozo) => { if (cuerpo.length < 100000) cuerpo += trozo; });
    peticion.on("end", () => {
      try { for (const fila of JSON.parse(cuerpo)) appendFileSync(registro, `${JSON.stringify(fila)}\n`); } catch { respuesta.writeHead(400); return respuesta.end(); }
      respuesta.writeHead(204); respuesta.end();
    });
    return;
  }
  if (peticion.method === "GET" && peticion.url === `${ruta}/`) {
    respuesta.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return respuesta.end(pagina);
  }
  respuesta.writeHead(404); respuesta.end();
}).listen(puerto, host, () => console.log(`http://${host}:${puerto}${ruta}/`));
