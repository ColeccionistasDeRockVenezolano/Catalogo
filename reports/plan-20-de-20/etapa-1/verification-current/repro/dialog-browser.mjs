import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
const root = process.cwd();
const require = createRequire(path.join(root, 'web/package.json'));
const { chromium, expect } = require('@playwright/test');
const { createServer } = await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href);
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
const out = path.join(root, 'reports/plan-20-de-20/etapa-1/verification-current');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import { createRoot } from 'react-dom/client'; import { BrowserRouter } from 'react-router-dom';
import { FixBatchDialog } from '/src/components/FixBatchDialog.tsx'; import { setSessionCsrf } from '/src/lib/operator.ts'; import '/src/styles/global.css';
setSessionCsrf('fixture-only');
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,{},React.createElement(FixBatchDialog,{mode:'individual',findingIds:[1],title:'Revisar año de formación',description:'Introduce el dato y la evidencia antes de confirmar la corrección.',onDone:()=>{},onClose:()=>{}})));
</script></body></html>`;
const editorialInputs = [
  { key: 'year', type: 'number', label: 'Año documentado', explanation: 'Usa el año respaldado por la fuente consultada.' },
  { key: 'basis', type: 'text', label: 'Fundamento documental', explanation: 'Explica qué documento respalda este cambio.' },
];
const results = [];
let server, browser;
try {
  server = await createServer({ root: path.join(root,'web'), configFile: false,
    plugins: [react(), { name:'verification-only', configureServer(s) {
      s.middlewares.use(async (req,res,next) => {
        if (req.url !== '/__stage1_audit') return next();
        try { res.setHeader('Content-Type','text/html'); res.end(await s.transformIndexHtml('/__stage1_audit',html)); }
        catch(error) { next(error); }
      });
    } }],
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') },
    server: { host:'127.0.0.1', port:0 },
  });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless:true });
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport });
    const errors = []; const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/curation/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/actions')) return route.fulfill({ json:{ findingId:1,status:'open',actions:[] } });
      if (!url.pathname.endsWith('/preview')) return route.fulfill({ status:500,json:{ error:{ message:'Unexpected request in isolated UI check' } } });
      const body = route.request().postDataJSON(); requests.push(body);
      const params = body.overrides?.byFinding?.['1']?.params ?? { year:null,basis:'' };
      const pending = !!params.year && !!params.basis;
      const item = { id:requests.length,position:1,findingId:1,finding:{id:1,title:'Año de formación por revisar'},actionKey:'fixture',actionLabel:'Corregir formación',level:1,params,status:pending?'pending':'blocked',before:{formedYear:2001},after:{formedYear:params.year},touched:[],blocked:pending?null:{code:'editorial_input',message:'Falta el año y su fundamento.'},noop:null,collisions:[],warnings:[],proposal:null,editorialInputs };
      return route.fulfill({ json:{ id:requests.length,mode:'individual',status:'previewed',previewHash:'fixture',counts:{items:1,pending:pending?1:0,blocked:pending?0:1},items:[item],pagination:{total:1,limit:100,offset:0} } });
    });
    await page.goto(`http://127.0.0.1:${address.port}/__stage1_audit`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Año documentado')).toBeVisible();
    await page.getByLabel('Año documentado').fill('1990');
    await page.getByLabel('Fundamento documental').fill('Documento contemporáneo que registra la formación en 1990.');
    await page.getByLabel('Motivo *',{exact:true}).fill('Dato comprobado para esta revisión editorial.');
    await expect(page.getByRole('button',{name:/^Aplicar /})).toBeDisabled();
    await page.getByRole('button',{name:'Actualizar vista previa'}).click();
    await expect(page.getByRole('button',{name:'Aplicar 1 corrección',exact:true})).toBeEnabled();
    const sent = requests.at(-1).overrides.byFinding['1'].params;
    if (sent.year !== 1990 || !sent.basis.includes('contemporáneo')) throw new Error('Los valores editoriales no llegaron a la nueva vista previa');
    const layout = await page.getByRole('dialog').evaluate(el => {
      const r=el.getBoundingClientRect(); const viewport=el.ownerDocument.defaultView.innerWidth; return {left:r.left,right:r.right,width:r.width,viewport,bodyOverflow:el.ownerDocument.documentElement.scrollWidth>viewport};
    });
    await page.screenshot({ path:path.join(out,`dialog-${viewport.width}.png`),fullPage:true });
    results.push({ viewport,layout,errors,previewRequests:requests.length,editorialValuesSent:sent,applyDisabledUntilNewPreview:true,api:'controlled fixture; no backend writes' });
    await page.close();
  }
  await writeFile(path.join(out,'dialog-browser.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
