// QA de la bandeja visual: API interceptada, sin escrituras en el catálogo.
import { chromium,expect } from '@playwright/test';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { dailyCycleAt } from '../../../src/shared/daily-cycle.ts';
const base = process.env.CRV_QA_WEB_URL ?? 'http://127.0.0.1:5193';
const output = process.env.CRV_QA_OUTPUT ?? '/home/brian/crv-staging/tmp-analysis/claim-review-ui-2026-10-21';
await mkdir(output,{recursive:true});
const cover = await readFile('web/public/media/album/1.jpg');
const entity = (id,name,kind='album') => ({id,kind,name,context:'Artista de prueba · 1982',imageUrl:'https://fixture.invalid/cover.jpg',albumId:kind==='album'?id:null});
const item = (id,field,value,currentValue,extra={}) => ({id,version:'a'.repeat(64),field,value,currentValue,hasCurrentField:true,status:'candidate',confidence:'low',sourceName:'Fuente de prueba',sourceUrl:'https://fixture.invalid',evidence:[{url:'https://fixture.invalid/evidence',excerpt:'Evidencia documental de la prueba.'}],reviewId:null,requiresReview:false,canAccept:true,canReject:true,...extra});
const initial = [
  {entity:entity(100,'Disco de prueba'),changes:[item(1,'release_year',1982,null),item(2,'genre','Rock progresivo',null)]},
  {entity:entity(null,'Músico por identificar','person'),changes:[item(3,'name','Músico por identificar',null,{hasCurrentField:false,requiresReview:true,reviewId:81,canAccept:false,canReject:false})]},
  {entity:entity(300,'Dos años documentados'),changes:[item(4,'release_year',1980,1980,{status:'conflict',canReject:false}),item(5,'release_year',1981,1980,{status:'conflict',canReject:false})]},
  ...Array.from({length:20},(_,index)=>({entity:entity(400+index,`Disco de prueba ${index+4}`),changes:[item(6+index,'release_year',1990+index,null)]})),
];
const summary = {lastScan:null,lastCorrection:null,running:false,categories:[],totals:{open:30,ignored:0,resolved:0,newInLastScan:0,chainedOpen:0,openInformational:0},autofix:{enabled:false,rules:{total:0,active:0},today:{batches:0,applied:0,undone:0},alerts:[]},metrics:{detectors:[],alerts:[],meanCorrectionSeconds:null,actionCoverage:{open:30,excludedInformational:0,level1OrLess:0,level2OrLess:0,level1OrLessPct:null,level2OrLessPct:null},batches:{total:0,previewed:0,applied:0,undone:0,autoApplied:0,autoReverted:0}}};
const browser = await chromium.launch({args:['--no-sandbox']});
const report = {scenarios:[],screenshots:[],failures:[],catalogWrites:0};
try {
  for(const width of [1366,390,320]) {
    const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
    const groups = structuredClone(initial);
    const anchors = new Map(initial.flatMap((group,index)=>group.changes.map(change=>[change.id,index])));
    const decisions=[];const errors=[];let failNext=false;let failList=false;
    const selectGroup = group => ({id:Math.min(...group.changes.map(change=>change.id)),entity:group.entity,pending:group.changes.length,conflicts:group.changes.filter(change=>change.status==='conflict').length,sources:['Fuente de prueba'],fields:group.changes.map(change=>change.field)});
    await context.route('**/*',async route=>{
      const req=route.request();const url=new URL(req.url());
      if(url.hostname==='fixture.invalid')return route.fulfill({status:200,contentType:'image/jpeg',body:cover});
      if(url.origin===base&&!url.pathname.startsWith('/crv/api/'))return route.continue();
      const path=url.pathname.replace(/^\/crv\/api/u,'');
      const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(status>=400?{error:body}:body),headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'content-type,x-crv-csrf','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
      if(req.method()==='OPTIONS')return send({});
      if(path==='/auth/me')return send({user:{username:'qa-visual',name:'QA Visual',role:'admin'},csrf:'qa-only'});
      if(path==='/daily-cycle')return send({...dailyCycleAt(),serverNow:new Date().toISOString()});
      if(path==='/site-appearance')return send({catalogTheme:'current',updatedAt:null});
      if(path==='/curation/summary')return send(summary);
      if(path==='/curation/images/summary')return send({artist:0,album:0});
      if(path==='/claims/review/groups'){
        if(failList){failList=false;return send({code:'test',message:'No se pudo cargar la bandeja de prueba.'},500);}
        let filtered=groups.filter(group=>group.changes.length);
        if(url.searchParams.get('q'))filtered=filtered.filter(group=>group.entity.name.toLowerCase().includes(url.searchParams.get('q').toLowerCase()));
        if(url.searchParams.get('kind'))filtered=filtered.filter(group=>group.entity.kind===url.searchParams.get('kind'));
        const bucket=url.searchParams.get('bucket');
        filtered=filtered.map(group=>({...group,changes:group.changes.filter(change=>!bucket||bucket==='all'||change.status===bucket)})).filter(group=>group.changes.length);
        const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??20);
        return send({data:filtered.slice(offset,offset+limit).map(selectGroup),pagination:{total:filtered.length,offset,limit},claims:filtered.reduce((sum,group)=>sum+group.changes.length,0)});
      }
      if(/^\/claims\/review\/groups\/\d+$/.test(path)){
        const id=Number(path.split('/').at(-1));const group=groups[anchors.get(id)];
        if(!group)return send({message:'No encontrado'},404);
        const bucket=url.searchParams.get('bucket');const changes=group.changes.filter(change=>!bucket||bucket==='all'||change.status===bucket);
        return send({group:{...selectGroup({...group,changes:changes.length?changes:group.changes}),id},changes,pagination:{total:changes.length,limit:50,offset:0}});
      }
      if(path==='/claims/review/decide'){
        if(failNext){failNext=false;return send({code:'stale_preview',message:'La ficha cambió. Revisa sus valores actuales.'},409);}
        const body=req.postDataJSON();decisions.push(body);
        const ids=body.claims.map(change=>change.id);const group=groups[anchors.get(body.groupId)];
        group.changes=group.changes.filter(change=>!ids.includes(change.id));
        return send({runId:901,results:ids.map(id=>({id,action:body.action==='accept'?'accepted':'rejected',detail:'Decisión de prueba'})),accepted:body.action==='accept'?ids.length:0,rejected:body.action==='reject'?ids.length:0,pending:0});
      }
      if(path==='/review-queue/81')return send({id:81,kind:'person_match',status:'open',priority:5,notes:null,createdAt:new Date().toISOString(),claimAId:3,claimBId:null,conflictId:null,artistAId:null,artistBId:null,personAId:null,personBId:9,organizationAId:null,organizationBId:null,albumId:null,trackId:null,videoId:null,payload:{},resolvedAt:null,resolvedBy:null,resolutionNote:null,claims:[],identityContext:{incoming:entity(null,'Músico por identificar','person'),candidate:entity(9,'Músico con nombre parecido','person')}});
      if(path==='/changes/901')return send({runId:901,kind:'manual',status:'ok',action:'claims:visual-accept',operator:'QA',note:'Prueba',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),journaled:true,counts:{},total:1,entities:[],entityTotal:0,undoneBy:null,undoOf:null,redoOf:null,undo:{method:'journal',undoable:true,reason:null,plan:{runId:901,changes:1,steps:{restore:0,revert:1,remove:0},byTable:{},entities:[],conflicts:[],skipped:[],claimsToSupersede:0}}});
      if(req.method()!=='GET'){report.catalogWrites++;return send({message:'Escritura inesperada bloqueada'},409);}
      return send({data:[],pagination:{total:0,limit:20,offset:0}});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    async function capture(name){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px sin desbordamiento`).toBe(true);const filename=`${name}-${width}.png`;if(process.env.CRV_QA_CAPTURE!=='0'){await page.screenshot({path:`${output}/${filename}`,fullPage:false});report.screenshots.push(filename);}}
    try{
      await page.goto(`${base}/curaduria/aportes`);
      await expect(page.locator('.claim-desk__queue li')).toHaveCount(20);
      await capture('bandeja');
      if(width<760)await page.locator('.claim-desk__queue li button').first().click();
      await expect(page.locator('.claim-change')).toHaveCount(2);
      await expect(page.locator('.claim-group__identity img')).toBeVisible();
      await expect(page.locator('.claim-evidence[open]')).toHaveCount(0);
      await capture('comparacion');
      await page.locator('.claim-evidence summary').first().click();await expect(page.getByText('Evidencia documental de la prueba.').first()).toBeVisible();
      await page.getByRole('button',{name:'Aceptar dato',exact:true}).first().click();
      await expect(page.locator('.claim-change')).toHaveCount(1);
      expect(decisions[0].claims.map(item=>item.id)).toEqual([1]);
      await expect(page.locator('.claim-group__identity h3')).toHaveText('Disco de prueba');
      report.scenarios.push(`${width}: decisión individual mantiene el dato no seleccionado`);
      await page.getByRole('checkbox',{name:/Seleccionar Género/}).check();
      await page.getByRole('button',{name:'Aceptar 1',exact:true}).click();
      await expect(page.locator('.claim-group__identity h3')).toHaveText('Músico por identificar');
      await page.getByRole('button',{name:'Comparar y decidir'}).click();
      await expect(page.getByRole('dialog').locator('.review-identity__picture')).toHaveCount(2);
      await capture('identidad');
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Dejar pendiente',exact:true}).click();
      await expect(page.locator('.claim-group__identity h3')).toHaveText('Dos años documentados');
      await expect(page.locator('.claim-evidence[open]')).toHaveCount(2);
      const checks=page.locator('.claim-change input[type="checkbox"]');await checks.nth(0).check();await checks.nth(1).check();
      await expect(checks.nth(0)).not.toBeChecked();await expect(checks.nth(1)).toBeChecked();
      await expect(page.getByRole('button',{name:'Descartar 1',exact:true})).toBeDisabled();
      await capture('contradiccion');
      report.scenarios.push(`${width}: identidad visual, evidencia bajo demanda y alternativas excluyentes`);
      if(width===1366){
        const before=decisions.length;await page.getByRole('button',{name:'Dejar pendiente',exact:true}).click();expect(decisions.length).toBe(before);
        const current=await page.locator('.claim-group__identity h3').textContent();await page.reload();await expect(page.locator('.claim-group__identity h3')).toHaveText(current);
        await page.keyboard.press('j');await expect(page.locator('.claim-group__identity h3')).not.toHaveText(current);
        failNext=true;await page.getByRole('button',{name:'Aceptar dato',exact:true}).click();
        await expect(page.getByRole('alert').filter({hasText:'La ficha cambió'})).toBeVisible();expect(decisions.length).toBe(before);
        await expect(page.locator('.claim-change')).toHaveCount(1);
        await page.getByRole('button',{name:'Aceptar dato',exact:true}).click();await expect.poll(()=>decisions.length).toBe(before+1);
        await page.getByRole('button',{name:'Deshacer',exact:true}).first().click();await expect(page.locator('.modal-panel[role="dialog"]')).toBeVisible();await page.keyboard.press('Escape');
        await page.getByLabel('Buscar aportes por nombre o ID').fill('sin coincidencias');await expect(page.getByText('No hay aportes con estos filtros')).toBeVisible();await capture('sin-resultados');
        report.scenarios.push('Teclado, reanudación, cambio obsoleto, deshacer y búsqueda sin resultados');
      }
      expect(errors).toEqual([]);
    }catch(error){report.failures.push({width,error:String(error)});await page.screenshot({path:`${output}/fallo-${width}.png`,fullPage:true});}
    await context.close();
  }
}finally{await browser.close();if(process.env.CRV_QA_CAPTURE==='0')report.screenshots=(await readdir(output)).filter(name=>name.endsWith('.png')&&!name.startsWith('fallo-'));await writeFile(`${output}/verificacion.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));if(report.failures.length||report.catalogWrites)process.exitCode=1;
