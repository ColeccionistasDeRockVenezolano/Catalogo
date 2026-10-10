// Comprueba la presentación con un expediente real ya guardado. Solo lee el catálogo;
// las peticiones del navegador usan respuestas locales y no disparan investigación ni fusiones.
import { chromium } from "@playwright/test";
import { listPersonDuplicateCandidates } from "../../../src/api/repositories/persons.js";
import { closeDb } from "../../../src/db/client.js";

const base = process.env["CRV_QA_WEB_URL"] ?? "http://127.0.0.1:5199";
const browser = await chromium.launch();
try {
  const result = await listPersonDuplicateCandidates({limit:1000,offset:0});
  const candidate = result.rows.find((row) => row.comparison?.a.evidence.length && row.comparison?.b.evidence.length);
  if (!candidate) throw new Error("Se requiere un par con investigación de ambos lados para este control visual.");
  for (const width of [1280,400]) {
    const page = await browser.newPage({viewport:{width,height:1000}});
    const errors: string[] = [];
    page.on("pageerror",(error)=>errors.push(error.message));
    await page.route("http://127.0.0.1:8080/**",async (route)=>{
      const pathname=new URL(route.request().url()).pathname;
      const body=pathname.endsWith("/me") ? {user:{username:"qa",name:"QA",role:"admin"},csrf:"qa"}
        : pathname.endsWith("/summary") ? {categories:[],running:false,totals:{open:0},autofix:{today:{applied:0},alerts:[]},album:0,artist:0}
        : pathname.endsWith("/duplicate-candidates") ? {data:[candidate],pagination:{total:1,limit:30,offset:0}}
        : {data:[],pagination:{total:0,limit:1,offset:0}};
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    });
    await page.goto(`${base}/curaduria/duplicados`);
    const button=page.getByRole("button",{name:"Ver datos evaluados y todas las evidencias",exact:true});
    await button.waitFor();
    if (await page.locator(".comparison-side").count()!==2) throw new Error("Faltan los dos informes individuales");
    if (await page.locator(".comparison-side blockquote").count()!==2) throw new Error("Faltan las dos evidencias resumidas");
    if (await page.locator(".dup-score__value").count()!==1) throw new Error("El total está duplicado");
    if (await page.locator(".signal-list > li").count()!==7) throw new Error("El desglose no incluye todas las dimensiones");
    await page.screenshot({path:`/tmp/crv-person-comparison-summary-${width}.png`,fullPage:true});
    await button.click();
    if (await page.locator(".comparison-table tbody tr").count()!==7) throw new Error("Falta comparación detallada");
    if (await page.locator(".comparison-full-side").count()!==2) throw new Error("Falta detalle de una ficha");
    if (await page.getByRole("button",{name:"Ocultar datos evaluados",exact:true}).getAttribute("aria-expanded")!=="true") throw new Error("El botón no expande el detalle");
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error("Desbordamiento horizontal");
    if (errors.length) throw new Error(errors.join("\n"));
    await page.screenshot({path:`/tmp/crv-person-comparison-detail-${width}.png`,fullPage:true});
    console.log(`${width}px: dos evidencias, un total, siete dimensiones y detalle accesible; sin errores ni desbordamiento`);
    await page.close();
  }
} finally {await browser.close();await closeDb();}
