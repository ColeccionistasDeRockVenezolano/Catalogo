// Local Vite :5188, VITE_API_BASE_URL=http://127.0.0.1:4499.
// Read-only snapshots of disco 1946; admin/reader sessions are simulated in the browser.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const sources = JSON.parse(await readFile(process.env.CRV_CREDIT_SNAPSHOT ?? '/tmp/crv-credit-snapshot.json', 'utf8'));
const response = await fetch('http://127.0.0.1:3120/crv/api/albums/1946');
if (!response.ok) throw new Error(`Snapshot disco: ${response.status}`);
const original = await response.json();
const output = '.impeccable/review/credit-provenance';
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true});
try {
  for (const [size,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    for (const role of ['admin','reader','anonymous']) {
      const context = await browser.newContext({viewport});
      const page = await context.newPage();
      let mode = 'real';
      let privateRequests = 0;
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const fakeCredit = {...original.credits[0],id:90001,creditIds:[90001,90002],role:'Coros de pista',tracks:[{discNumber:1,trackNumber:1},{discNumber:1,trackNumber:2}]};
      const fakeSources = [90001,90002].map((id,index)=>({entityKind:'track_credit',entityId:id,claims:[{...sources[0].claims[0],id:90000+index,field:'credit_role',rawValue:'Coros',normalizedValue:'Coros',sourceName:`Fuente de pista ${index+1}`,evidence:[{url:`https://example.org/track/${index+1}`,excerpt:'Respaldo del crédito de pista'}]}]}));
      await page.route('http://127.0.0.1:4499/**', async route=>{
        const url=new URL(route.request().url());
        const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(url.pathname==='/auth/me') return reply(role==='anonymous'?{error:{code:'unauthorized',message:'Sin sesión'}}:{user:{username:'qa',name:'QA',role},csrf:'qa'},role==='anonymous'?401:200);
        if(url.pathname==='/albums/1946') return reply(mode==='scoped'?{...original,scopedCreditsByType:{musician:[fakeCredit]}}:original);
        if(url.pathname==='/credit-sources') {privateRequests++; if(mode==='error') return reply({error:{code:'internal_error',message:'Error de prueba'}},500); return reply(mode==='empty'?[]:mode==='scoped'?[...sources,...fakeSources]:sources);}
        if(url.pathname==='/claims') return reply({data:[],pagination:{total:0,limit:15,offset:0}});
        if(url.pathname.startsWith('/entity-verification')) return reply(null);
        return reply({data:[],pagination:{total:0,limit:15,offset:0},pending:[],pairs:[]});
      });
      await page.goto('http://127.0.0.1:5188/discos/1946');
      const credits=page.locator('.credit-groups');
      await expect(page.getByRole('heading',{level:1,name:'Ordenador'})).toBeVisible();
      if(role==='admin') {
        const sincopa=credits.getByRole('link',{name:'Sincopa',exact:true});
        await expect(sincopa).toHaveCount(12);
        await expect(sincopa.first()).toHaveAttribute('href','https://sincopa.com/rock_pop/cdinfo_rock/godsnewversion_ordenador.htm');
        await expect(credits.getByText('Operador del catálogo (API)',{exact:true})).toHaveCount(2);
        await credits.getByText('Ver origen del crédito',{exact:true}).first().click();
        await expect(credits.getByText('Vocals & Guitar: Andrés Morillo "André"',{exact:true})).toBeVisible();
        if(size==='mobile') expect(await credits.locator('summary').evaluateAll(items=>items.every(item=>item.getBoundingClientRect().height>=44))).toBe(true);
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:`${output}/${size}.png`,fullPage:true});
        await credits.screenshot({path:`${output}/${size}-credits.png`});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        mode='scoped'; await page.reload();
        await expect(credits.getByRole('link',{name:'Fuente de pista 1'})).toHaveAttribute('href','https://example.org/track/1');
        await expect(credits.getByRole('link',{name:'Fuente de pista 2'})).toHaveAttribute('href','https://example.org/track/2');
        mode='empty'; await page.reload();
        await expect(credits.getByText('Sin fuente registrada para este crédito.')).toHaveCount(14);
        mode='error'; await page.reload();
        await credits.getByRole('button',{name:'Reintentar fuentes'}).first().waitFor();
        mode='real'; await credits.getByRole('button',{name:'Reintentar fuentes'}).first().click();
        await expect(sincopa).toHaveCount(12);
      } else {
        await expect(page.locator('.credit-provenance')).toHaveCount(0);
        expect(privateRequests).toBe(0);
      }
      expect(errors).toEqual([]);
      await context.close();
      console.log(`${size} ${role}: credits 1946, privacy, links and states passed`);
    }
  }
} finally {await browser.close();}
