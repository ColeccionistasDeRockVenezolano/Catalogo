/// <reference lib="dom" />
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');mkdirSync(out+'/browser-press',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results:any[]=[];
try{for(const [key,url] of [['superpop-chron','https://www.chron.com/news/article/igual-de-inmaduros-los-amigos-invisibles-1813128.php'],['blush-entrevista','https://www.theresistance.cl/2020/07/entrevista-blush-magenta-hoy-el-enfoque_27.html']]){
 const p=await browser.newPage({viewport:{width:1200,height:900}});const r:any={key,url,at:new Date().toISOString()};try{
  const response=await p.goto(url!,{waitUntil:'domcontentloaded',timeout:30000});r.status=response?.status();await p.waitForFunction(()=>document.body.innerText.includes('Superpop Venezuela')||document.body.innerText.includes('Yessica'),{},{timeout:20000}).catch(()=>{});
  r.text=await p.locator('body').innerText();const html=await p.content();r.sha256=createHash('sha256').update(html).digest('hex');writeFileSync(out+'/browser-press/'+key+'.html',html);await p.screenshot({path:out+'/browser-press/'+key+'.png'});
 }catch(e){r.error=String(e);}results.push(r);writeFileSync(out+'/prensa-renderizada.json',JSON.stringify(results,null,2));await p.close();console.log(JSON.stringify({key,status:r.status,chars:r.text?.length,error:r.error}));
}}finally{await browser.close();}
