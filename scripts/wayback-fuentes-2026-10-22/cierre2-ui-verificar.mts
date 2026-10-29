import {writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');mkdirSync(out+'/ui',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const r:any={at:new Date().toISOString(),failures:[],pageErrors:[]};
try{const p=await browser.newPage({viewport:{width:1360,height:1000}});p.on('pageerror',e=>r.pageErrors.push(String(e)));
 try{
  await p.goto('http://127.0.0.1:3120/crv/artistas/1163',{waitUntil:'domcontentloaded',timeout:30000});
  await p.getByRole('tab',{name:/^Otros/}).waitFor({state:'visible',timeout:30000});await p.getByRole('tab',{name:/^Otros/}).click();
  await p.getByRole('button',{name:/^Entrevistas\s/}).click();await p.getByRole('button',{name:'Entrevista a Los Dolares en Caracaspunk',exact:true}).click();
  await p.locator('.document-reader').waitFor({state:'visible',timeout:10000});r.interviewText=await p.locator('.document-reader').innerText();r.sourceLinks=await p.locator('.document-reader a[href]').evaluateAll(xs=>xs.map(a=>({text:a.textContent,href:a.getAttribute('href')})));
  if(r.interviewText.length<500||!r.sourceLinks.some((a:any)=>a.href?.includes('archive.org')))r.failures.push('interview-reader');
  await p.screenshot({path:out+'/ui/interview-reader.png'});
  await p.goto('http://127.0.0.1:3120/crv/artistas/1163',{waitUntil:'domcontentloaded',timeout:30000});await p.getByRole('tab',{name:/^Audiovisuales/}).waitFor({state:'visible',timeout:30000});await p.getByRole('tab',{name:/^Audiovisuales/}).click();
  await p.getByText('Cabrón de la Nación',{exact:true}).first().waitFor({state:'visible',timeout:10000});await p.getByText('Barricadas',{exact:true}).first().waitFor({state:'visible',timeout:10000});r.audiovisualTitlesVisible=true;r.audiovisualText=await p.locator('body').innerText();
  await p.screenshot({path:out+'/ui/audiovisual-copies.png'});
 }catch(e){r.failures.push(String(e));r.body=await p.locator('body').innerText().catch(()=>null);await p.screenshot({path:out+'/ui/failure.png'}).catch(()=>{});}
 if(r.pageErrors.length)r.failures.push('browser-page-errors');
 writeFileSync(out+'/ui-verificacion.json',JSON.stringify(r,null,2));console.log(JSON.stringify({interviewChars:r.interviewText?.length,audiovisualTitlesVisible:r.audiovisualTitlesVisible,failures:r.failures,pageErrors:r.pageErrors}));if(r.failures.length)process.exitCode=1;
}finally{await browser.close();}
