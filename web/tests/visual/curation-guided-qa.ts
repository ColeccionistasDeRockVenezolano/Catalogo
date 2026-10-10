// Revisión con datos reales y una sesión HttpOnly temporal. No escribe en el catálogo.
// CRV_QA_CREDENTIALS_FILE apunta a un JSON privado con username/password.
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const base=process.env.CRV_QA_WEB_URL ?? 'http://127.0.0.1:5175';
const api=process.env.CRV_QA_API_URL ?? 'http://127.0.0.1:8086';
const credentials=JSON.parse(readFileSync(process.env.CRV_QA_CREDENTIALS_FILE ?? '/tmp/crv-ui-session.json','utf8')) as {username:string;password:string};
const browser=await chromium.launch({args:['--no-sandbox']});
try {
  const auth=await browser.newContext();
  const login=await auth.request.post(`${api}/auth/login`,{data:{username:credentials.username,password:credentials.password}});
  expect(login.ok()).toBe(true);
  const state=await auth.storageState();
  const cookie=state.cookies.find(c=>c.name==='crv_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie!.expires-Date.now()/1000).toBeLessThanOrEqual(3600);
  expect(cookie!.expires-Date.now()/1000).toBeGreaterThan(0);
  for (const width of [1366,768,390,320]) {
    const context=await browser.newContext({storageState:state,viewport:{width,height:1000}});
    const page=await context.newPage();const errors:string[]=[];const privateErrors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.url().startsWith(api)&&r.status()>=400)privateErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);});
    await page.route(`${api}/**`,async route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))throw new Error('La revisión visual intentó escribir');await route.continue();});
    // Los recursos publicados bajo /crv conservan su ruta durante el desarrollo local.
    await page.route('**/crv/media/**',route=>route.continue({url:`http://127.0.0.1:3120${new URL(route.request().url()).pathname}`}));
    async function capture(name:string){
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width}: desbordamiento`).toBe(true);
      await page.screenshot({path:`/tmp/crv-guided-${name}-${width}.png`});
    }
    await page.goto(`${base}/curaduria/ia?kind=artist&id=58`);
    await expect(page.locator('.ai-operation').first()).toBeVisible({timeout:30000});
    await expect(page.locator('.ai-context')).toContainText('Caramelos');
    await expect(page.getByRole('button',{name:'Implementar',exact:true})).toBeDisabled();
    await expect(page.locator('.ai-request')).not.toBeVisible();
    await capture('ia');
    await page.locator('.ai-operation').first().getByText('Qué cambiará',{exact:true}).click();
    await expect(page.locator('.ai-change-summary').first()).toBeVisible();
    await capture('ia-cambio');
    await page.getByRole('button',{name:/Excluidos/}).click();
    await expect(page.getByText('No hay cambios en este filtro. Elige Todos para ver la propuesta.')).toBeVisible();
    await page.getByRole('button',{name:/Todos \(/}).click();
    await page.locator('.ai-operation').first().getByText('Editar datos propuestos',{exact:true}).click();
    await page.locator('.ai-operation').first().getByLabel('Descripción del cambio',{exact:true}).fill('Ajuste local sin guardar');
    await expect(page.getByRole('button',{name:'Descartar mis ajustes'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Implementar',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Descartar mis ajustes'}).click();
    await page.goto(`${base}/curaduria/ia`);
    await expect(page.getByRole('button',{name:'Preparar propuesta',exact:true})).toBeDisabled();
    await expect(page.getByRole('combobox',{name:'Ficha a revisar',exact:true})).toBeVisible();
    await capture('ia-inicio');
    await page.goto(`${base}/curaduria/duplicados`);
    const pair=page.locator('.dup-card').first();await expect(pair).toBeVisible({timeout:60000});
    await expect(pair.locator('.signal-list')).not.toBeVisible();await capture('duplicados');
    await pair.getByText('Ver señales y evidencias de este par',{exact:true}).click();
    await expect(pair.locator('.signal-list')).toBeVisible();
    const full=pair.getByRole('button',{name:'Ver datos evaluados y todas las evidencias',exact:true});
    if(await full.count()){await full.click();await expect(pair.locator('.comparison-table')).toBeVisible();}
    await capture('duplicados-evidencia');
    await pair.getByRole('button',{name:'Revisar fusión',exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.merge-compare-table')).toBeVisible({timeout:30000});
    await capture('fusion');
    const savedResearch = page.getByRole('button',{name:'Ver investigación guardada',exact:true});
    await expect(savedResearch).toBeVisible();
    await expect(page.locator('.person-research__result')).not.toBeVisible();
    await savedResearch.click();
    await expect(page.locator('.person-research__result')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto(`${base}/curaduria/categoria/fichas_repetidas`);
    await expect(page.locator('.cfind__ai').first()).toBeVisible({timeout:30000});await capture('fichas-repetidas');
    for(const [kind,id]of [['artistas',58],['personas',40356],['discos',139]] as const){
      await page.goto(`${base}/${kind}/${id}`);
      const section=page.locator('.entity-verification');await expect(section).toBeVisible({timeout:30000});
      await expect(section.getByRole('link',{name:'Corregir datos con IA'})).toBeVisible();
      await expect(section.getByText('Cargando el informe…',{exact:true})).not.toBeVisible({timeout:30000});
      await section.scrollIntoViewIfNeeded();await capture(kind);
      await section.getByRole('button',{name:'Ver informe y datos pendientes',exact:true}).click();
      await expect(section.locator('.entity-verification__counts')).toBeVisible();
      await expect(section.getByRole('searchbox',{name:'Buscar en los datos'})).toBeVisible();
      await section.getByRole('searchbox',{name:'Buscar en los datos'}).fill('imposible-no-existe');
      await expect(section.getByText('No hay datos que coincidan con estos filtros.')).toBeVisible();
      await section.getByRole('searchbox',{name:'Buscar en los datos'}).fill('');
      await section.getByText('Más herramientas: verificar y comparar',{exact:true}).click();
      await section.getByRole('button',{name:'Comparar con otra ficha',exact:true}).click();
      await expect(section.locator('.entity-comparison__search')).toBeVisible();
      await section.scrollIntoViewIfNeeded();await capture(`${kind}-informe`);
    }
    // Preferencias guardadas por la interfaz anterior: no deben ocultar el detalle.
    await page.evaluate(username => sessionStorage.setItem(`crv.entity-tool.${username}.verify.artist.58`,JSON.stringify({open:true,details:false,filter:'all'})),credentials.username);
    await page.goto(`${base}/artistas/58`);
    await expect(page.getByRole('searchbox',{name:'Buscar en los datos'})).toBeVisible({timeout:30000});
    expect(errors).toEqual([]);expect(privateErrors).toEqual([]);
    console.log(`${width}px: propuestas, revisión, duplicados, fusión, fichas repetidas y tres tipos de ficha; sin escrituras, errores ni desbordamiento.`);
    await context.close();
  }
  const me=await auth.request.get(`${api}/auth/me`);const csrf=(await me.json()).csrf;
  await auth.request.post(`${api}/auth/logout`,{headers:{'x-crv-csrf':csrf}});
  await auth.close();
}finally{await browser.close();}
