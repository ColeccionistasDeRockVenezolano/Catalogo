// Run against local Vite on :5188 with VITE_API_BASE_URL=http://127.0.0.1:4499.
// Public entity snapshots are read from the local catalog; private responses are fixtures.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = 'http://127.0.0.1:5188';
const output = '.impeccable/review/provenance';
await mkdir(output, { recursive: true });
const routes = [['artist','/artistas/54','/artists/54'], ['album','/discos/57','/albums/57'], ['person','/personas/2698','/persons/2698'], ['organization','/organizaciones/1033','/organizations/1033']];
const snapshots = new Map();
for (const [, , endpoint] of routes) {
  const res = await fetch(`http://127.0.0.1:3120/crv/api${endpoint}`);
  if (!res.ok) throw new Error(`Snapshot ${endpoint}: ${res.status}`);
  snapshots.set(endpoint, await res.json());
}
const browser = await chromium.launch({ headless: true });
try {
  for (const [size, viewport] of [['desktop', {width:1440,height:1000}], ['mobile',{width:390,height:844}]]) {
    for (const role of ['admin','reader','anonymous']) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      let claimsRequests = 0;
      let researchRequests = 0;
      let mode = 'populated';
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.route('http://127.0.0.1:4499/**', async route => {
        const url = new URL(route.request().url());
        const reply = (body, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if (url.pathname === '/auth/me') return reply(role === 'anonymous' ? {error:{code:'unauthorized',message:'Sin sesión'}} : {user:{username:'qa',name:'QA',role},csrf:'qa'}, role === 'anonymous' ? 401 : 200);
        if (url.pathname === '/credit-sources') return reply([]);
        if (url.pathname === '/claims') {
          claimsRequests++;
          if (mode === 'error') return reply({error:{code:'internal_error',message:'No se pudo cargar la evidencia.'}}, 500);
          const entityKind = url.searchParams.get('entity');
          const template = {entityKind,field:'name',rawValue:'Nombre documentado',normalizedValue:null,confidence:'high',status:'accepted',sourceId:1,sourceName:'Spotify',sourceUrl:'https://open.spotify.com/',pageUrl:null,seedRowNumber:null,createdBy:'system',createdAt:'2026-10-09T12:00:00.000Z'};
          const offset = Number(url.searchParams.get('offset') || 0);
          const data = mode === 'empty' ? [] : offset ? [{...template,id:16,evidence:[]}] : [
            {...template,id:1,evidence:[{url:'https://open.spotify.com/album/example',excerpt:'Nombre y fecha registrados en la fuente.'}]},
            {...template,id:2,field:'biography',rawValue:'Texto largo de evidencia. '.repeat(60),status:'superseded',sourceName:'Archivo importado',sourceUrl:null,seedRowNumber:25,evidence:[{url:'crv-api://operator-runs/1',excerpt:'Edición manual documentada.'}]},
            {...template,id:3,status:'candidate',sourceName:'Fuente con enlace general',evidence:[]},
          ];
          return reply({data,pagination:{limit:15,offset,total:mode === 'empty' ? 0 : 16}});
        }
        if (/identity-research/.test(url.pathname)) researchRequests++;
        if (snapshots.has(url.pathname)) return reply(snapshots.get(url.pathname));
        if (/entity-verification/.test(url.pathname)) return reply(null);
        if (/person-research|identity-research|text-rewrites/.test(url.pathname)) return reply({pending:[],data:[],research:[]});
        if (/\/neighbors$/.test(url.pathname)) return reply({sharedMembers:[],lineage:[],similar:[]});
        if (/\/summary$/.test(url.pathname)) return reply({});
        return reply({data:[],pagination:{limit:15,offset:0,total:0},pending:[],pairs:[],research:[]});
      });
      for (const [kind,path] of routes) {
        await page.goto(base+path+(kind !== 'album' ? '?tab=fuentes' : ''));
        await page.getByRole('heading',{level:1}).waitFor();
        const section = page.getByRole('region',{name:'Origen de los datos',exact:true});
        if (role === 'admin') {
          await expect(section.getByRole('link',{name:'Spotify',exact:true})).toHaveAttribute('href','https://open.spotify.com/album/example');
          await expect(section.getByText('Sin enlace web registrado.')).toBeVisible();
          if (size === 'mobile') {
            const heights = await section.locator('summary').evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
            expect(heights.every(height => height >= 44)).toBe(true);
          }
          await section.getByText('Ver valor completo').click();
          await section.getByText('Ver evidencia').first().click();
          await expect(section.getByText('Nombre y fecha registrados en la fuente.')).toBeVisible();
          await section.getByText('Ver valor completo').click();
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({path:`${output}/${size}-${kind}.png`,fullPage:true});
          const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(1);
          await section.getByRole('button',{name:'Siguiente'}).click();
          await expect(section.getByText('Página 2 de 2')).toBeVisible();
          await section.getByRole('button',{name:'Anterior'}).click();
          await expect(section.getByRole('link',{name:'Spotify',exact:true})).toBeVisible();
        } else {
          await expect(section).toHaveCount(0);
          await expect(page.getByRole('tab',{name:'Origen de los datos'})).toHaveCount(0);
          await expect(page.getByRole('tab',{name:'Historial'})).toHaveCount(0);
        }
      }
      if (role !== 'admin') { expect(claimsRequests).toBe(0); expect(researchRequests).toBe(0); }
      if (role === 'admin') {
        mode = 'empty';
        await page.goto(base+'/artistas/54?tab=fuentes');
        await expect(page.getByText('No hay fuentes registradas para esta ficha.',{exact:false})).toBeVisible();
        mode = 'error';
        await page.reload();
        await expect(page.getByRole('button',{name:'Reintentar',exact:true})).toBeVisible();
        mode = 'populated';
        await page.getByRole('button',{name:'Reintentar',exact:true}).click();
        await expect(page.getByRole('region',{name:'Origen de los datos',exact:true}).getByRole('link',{name:'Spotify',exact:true})).toBeVisible();
      }
      expect(errors).toEqual([]);
      await context.close();
      console.log(`${size} ${role}: four entities, visibility and links passed`);
    }
  }
} finally { await browser.close(); }
