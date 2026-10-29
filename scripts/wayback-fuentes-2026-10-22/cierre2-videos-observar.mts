/// <reference lib="dom" />
/** Inspección reproducible de copias candidatas, con el navegador ya instalado. Sólo lectura. */
import {writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');mkdirSync(out+'/browser',{recursive:true});
const outputName=process.env['WAYBACK_VIDEO_OUTPUT']??('browser-videos-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');if(!/^[a-zA-Z0-9_.-]+\.json$/.test(outputName))throw Error('Nombre de salida inválido');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const pages:string[][]=process.env['WAYBACK_VIDEO_REVIEW']?JSON.parse(process.env['WAYBACK_VIDEO_REVIEW']):[['nada-kaos','07GOOGf-7Zg'],['deskarriados-hemofilia','xb9UeDp1xPw'],['dolares-cabron','1xyE-AWLopc'],['dolares-barricadas','vvxNUz1zPeE'],['lisiado-politica','opy9tWjQhCM']];
const results:any[]=[];
try{for(const [key,id] of pages){const p=await browser.newPage({viewport:{width:1200,height:800}});const r:any={key,id};
 try{await p.goto('https://www.youtube.com/watch?v='+id,{waitUntil:'domcontentloaded',timeout:30000});await p.locator('video').waitFor({state:'attached',timeout:15000});
  r.initial=await p.evaluate(async()=>{const v=document.querySelector('video');if(!v)return null;v.muted=true;try{await v.play();}catch{}return {currentTime:v.currentTime,duration:v.duration,paused:v.paused,readyState:v.readyState,error:v.error?.message??null};});
  await p.screenshot({path:out+'/browser/'+key+'-initial.png'});
  await p.waitForFunction(()=>{const v=document.querySelector('video');return !!v&&(v.currentTime>8||v.error!==null);},{},{timeout:25000}).catch(()=>{});
  r.final=await p.evaluate(()=>{const v=document.querySelector('video');return {currentTime:v?.currentTime,duration:v?.duration,paused:v?.paused,readyState:v?.readyState,error:v?.error?.message??null,body:document.body.innerText.slice(0,12000)};});
  await p.screenshot({path:out+'/browser/'+key+'-final.png'});
 }catch(e){r.error=String(e);r.body=await p.locator('body').innerText().catch(()=>null);await p.screenshot({path:out+'/browser/'+key+'-error.png'}).catch(()=>{});}
 results.push(r);writeFileSync(out+'/'+outputName,JSON.stringify(results,null,2));await p.close();console.log(JSON.stringify({key,result:r.final??r.error}));
}}finally{await browser.close();}
