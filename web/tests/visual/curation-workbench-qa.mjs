// Banco de 1.200 casos, incluidas las 81 investigaciones reales. Toda decisión
// se intercepta: este QA nunca modifica el catálogo ni ejecuta fusiones.
import { chromium, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dailyCycleAt } from '../../../src/shared/daily-cycle.ts';

const base = process.env.CRV_QA_WEB_URL ?? 'http://127.0.0.1:5187';
const output = 'docs/ui-qa/curation-workbench';
mkdirSync(output, { recursive: true });
const dossier = JSON.parse(readFileSync('src/curation/research/album-tracklists-2026-10-15.json', 'utf8'));
const stamp = '2026-10-15T16:00:00Z';
function row(id, data) {
  return { id, category: 'nombres_sucios', detector: 'caracteres_invisibles', detectorLabel: 'Caracteres invisibles',
    signature: 'caracteres_invisibles', signatureLabel: 'Caracteres invisibles', severity: 'medium',
    entity: { kind: 'artist', id: 500000 + id, label: `Artista de prueba ${String(id).padStart(4, '0')}` },
    field: 'name', value: 'Nombre con  espacios', title: 'Revisar la escritura del nombre', suggestion: 'Conservar la grafía documentada.',
    suggestedValue: 'Nombre con espacios', related: [], evidence: {}, status: 'open', isNew: false, triggeredBy: [],
    firstSeenAt: stamp, lastSeenAt: stamp, resolvedAt: null, ignoredAt: null, ignoredBy: null, ignoreNote: null,
    ignoreReason: null, resolution: null, resolvedByRunId: null, resolvedBy: null,
    actions: [{ key: 'limpiar_texto', label: 'Limpiar el texto', level: 0 }], ...data };
}
const researchRows = dossier.cases.map((item, index) => row(index + 1, {
  category: 'investigacion_documentada', detector: 'investigacion_documentada', detectorLabel: dossier.title,
  signature: item.verdict, signatureLabel: item.label, severity: item.verdict === 'corregir_pistas_no_fusionar' ? 'high' : 'medium',
  entity: { kind: 'album', id: item.albums[0].id, label: `${item.albums[0].artist} — ${item.albums[0].title}` },
  field: 'tracklist', value: null, suggestedValue: null, title: item.albums.map(album => album.title).join(' ↔ '),
  suggestion: item.recommendation, related: [{ kind: 'album', id: item.albums[1].id, label: item.albums[1].title }],
  evidence: { pair: item.albums.map(album => album.id), research: { ...item, researchedAt: dossier.researchedAt, changedAlbumIds: [] } }, actions: [],
}));
const template = [...researchRows, ...Array.from({ length: 1119 }, (_, index) => row(10000 + index, {}))];
const definitions = [
  { key: 'investigacion_documentada', label: 'Investigaciones documentadas', description: 'Fuentes, conclusiones y decisiones pendientes.' },
  { key: 'nombres_sucios', label: 'Nombres sucios', description: 'Revisar la escritura del catálogo.' },
];
function summary(rows) {
  const count = status => rows.filter(row => row.status === status).length;
  const categories = definitions.map(definition => {
    const group = rows.filter(row => row.category === definition.key);
    const open = group.filter(row => row.status === 'open');
    const detector = group[0];
    return { ...definition, open: open.length, ignored: group.filter(row => row.status === 'ignored').length, resolved: 0, newInLastScan: 0, chainedOpen: 0,
      severity: { high: open.filter(row => row.severity === 'high').length, medium: open.filter(row => row.severity === 'medium').length, low: 0 },
      detectors: [{ key: detector.detector, label: detector.detectorLabel, description: definition.description, open: open.length, ignored: 0, resolved: 0,
        newInLastScan: 0, signatures: [...new Set(open.map(row => row.signature))].map(key => ({ key, label: open.find(row => row.signature === key).signatureLabel,
          open: open.filter(row => row.signature === key).length })) }] };
  });
  return { lastScan: null, lastCorrection: null, running: false, categories,
    totals: { open: count('open'), ignored: count('ignored'), resolved: 0, newInLastScan: 0, chainedOpen: 0, openInformational: 0 },
    autofix: { enabled: false, rules: { total: 0, active: 0 }, today: { batches: 0, applied: 0, undone: 0 }, alerts: [] },
    metrics: { detectors: [], alerts: [], meanCorrectionSeconds: null,
      actionCoverage: { open: count('open'), excludedInformational: 0, level1OrLess: 1119, level2OrLess: 1119, level1OrLessPct: null, level2OrLessPct: null },
      batches: { total: 0, previewed: 0, applied: 0, undone: 0, autoApplied: 0, autoReverted: 0 } } };
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const result = { cases: template.length, viewports: [], scenarios: [], failures: [], catalogWrites: 0 };
try {
  for (const width of [1366, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const rows = structuredClone(template);
    const errors = [];
    const requests = [];
    let delayedSearch = false;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === base && !url.pathname.startsWith('/crv/api/')) return route.continue();
      url.pathname = url.pathname.replace(/^\/crv\/api/u, '');
      const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json',
        body: JSON.stringify(status >= 400 ? { error: body } : body), headers: { 'Access-Control-Allow-Origin': base,
          'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-crv-csrf',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
      requests.push({ method: request.method(), path: url.pathname, query: url.search });
      if (request.method() === 'OPTIONS') return send({});
      if (url.pathname === '/auth/me') return send({ user: { username: 'qa-curation', name: 'QA Curaduría', role: 'admin' }, csrf: 'qa-csrf-only-intercepted' });
      if (url.pathname === '/daily-cycle') return send({ ...dailyCycleAt(), serverNow: new Date().toISOString() });
      if (url.pathname === '/site-appearance') return send({ catalogTheme: 'current', updatedAt: null });
      if (url.pathname === '/curation/summary') return send(summary(rows));
      if (url.pathname === '/curation/distinct-pairs') return send({ data: [], pagination: { total: 0, limit: 50, offset: 0 } });
      if (url.pathname === '/curation/images/summary') return send({ artist: 0, album: 0 });
      if (url.pathname.includes('duplicate')) return send({ data: [], pagination: { total: 0, limit: 1, offset: 0 } });
      if (url.pathname === '/curation/findings') {
        const p = url.searchParams;
        let filtered = rows.filter(row => p.get('status') === 'all' || row.status === (p.get('status') ?? 'open'));
        for (const key of ['category', 'detector', 'signature', 'severity']) if (p.get(key)) filtered = filtered.filter(row => row[key] === p.get(key));
        if (p.get('entityKind')) filtered = filtered.filter(row => row.entity.kind === p.get('entityKind'));
        if (p.get('q')) {
          const q = p.get('q').toLowerCase();
          filtered = filtered.filter(row => `${row.entity.label} ${row.title} ${row.value ?? ''}`.toLowerCase().includes(q) || String(row.entity.id) === q.replace(/^#/, ''));
          if (delayedSearch) await new Promise(resolve => setTimeout(resolve, 450));
        }
        filtered.sort(p.get('sort') === 'entity' ? (a, b) => a.entity.label.localeCompare(b.entity.label) || a.id - b.id
          : p.get('sort') === 'newest' ? (a, b) => b.id - a.id : (a, b) => a.id - b.id);
        const offset = Number(p.get('offset') ?? 0), limit = Number(p.get('limit') ?? 50);
        return send({ data: filtered.slice(offset, offset + limit), pagination: { offset, limit, total: filtered.length } });
      }
      if (/^\/curation\/findings\/\d+\/ignore$/.test(url.pathname) && request.method() === 'POST') {
        const finding = rows.find(row => row.id === Number(url.pathname.split('/')[3]));
        Object.assign(finding, { status: 'ignored', ignoreReason: request.postDataJSON().reason });
        return send(finding);
      }
      if (/^\/albums\/\d+$/.test(url.pathname)) {
        const id = Number(url.pathname.split('/')[2]);
        const album = dossier.cases.flatMap(item => item.albums).find(album => album.id === id);
        return send({ id, title: album?.title ?? 'Disco', tracklist: [{ id: id * 10, title: 'Pista de comparación QA', discNumber: 1, trackNumber: 1, durationSeconds: 180 }] });
      }
      if (url.pathname.endsWith('/merge-preview')) return send({ code: 'stale_preview', message: 'Previsualización interceptada durante QA' }, 409);
      if (!['GET', 'HEAD'].includes(request.method())) {
        result.catalogWrites++;
        return send({ code: 'blocked', message: 'Escritura inesperada en QA' }, 409);
      }
      return send({ data: [], pagination: { total: 0, limit: 50, offset: 0 } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const capture = async name => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px sin desbordamiento`).toBe(true);
      await page.screenshot({ path: `${output}/${name}-${width}.png` });
    };
    try {
      await page.goto(`${base}/curaduria/hallazgos`);
      await expect(page.locator('.cwork__row')).toHaveCount(50);
      await capture('lista');
      if (width === 1366) {
        await expect(page.locator('.cwork__body article')).toHaveCount(1);
        const first = await page.locator('.cwork__case[aria-current="true"]').textContent();
        await page.keyboard.press('j');
        await expect(page.locator('.cwork__case[aria-current="true"]')).not.toHaveText(first);
        await page.locator('.cwork__case').last().click();
        await page.getByRole('button', { name: 'Caso siguiente', exact: true }).click();
        await expect(page).toHaveURL(/offset=50/);
        await expect(page.locator('.cwork__detail-head')).toContainText('Caso 51 de 1.200');
        await page.getByRole('button', { name: 'Caso anterior', exact: true }).click();
        await expect(page.locator('.cwork__detail-head')).toContainText('Caso 50 de 1.200');
        result.scenarios.push('Teclado, siguiente y anterior entre páginas');

        await page.goto(`${base}/curaduria/categoria/nombres_sucios`);
        await page.getByLabel('Seleccionar página', { exact: true }).check();
        await expect(page.locator('.csel-toolbar')).toContainText('50 seleccionados');
        await page.getByRole('button', { name: /Siguiente →/ }).click();
        await page.getByLabel('Seleccionar página', { exact: true }).check();
        await expect(page.locator('.csel-toolbar')).toContainText('100 seleccionados');
        await page.getByRole('button', { name: 'Seleccionar los 1.119 que cumplen el filtro' }).click();
        await expect(page.locator('.csel-toolbar')).toContainText('Los 1.119 hallazgos que cumplen el filtro');
        await page.getByRole('button', { name: 'Vaciar selección', exact: true }).click();
        await page.getByLabel('Casos por página', { exact: true }).selectOption('100');
        await expect(page.locator('.cwork__row')).toHaveCount(100);
        await page.getByLabel('Ordenar casos', { exact: true }).selectOption('newest');
        await expect(page.locator('.cwork__entity').first()).toContainText('11118');
        result.scenarios.push('Selección entre páginas, todo el filtro, tamaño y orden en servidor');

        delayedSearch = true;
        await page.getByRole('searchbox', { name: 'Buscar en los hallazgos' }).fill('sin-coincidencias-qa');
        await page.getByRole('search').getByRole('button', { name: 'Buscar', exact: true }).click();
        await expect(page.locator('.cwork__body article')).toHaveCount(0);
        await expect(page.getByText('No hay hallazgos abiertos aquí', { exact: true })).toBeVisible();
        delayedSearch = false;
        result.scenarios.push('No hay acciones de resultados anteriores durante la búsqueda');

        await page.goto(`${base}/curaduria/categoria/nombres_sucios?offset=1100&limit=100`);
        await expect(page.locator('.cwork__row')).toHaveCount(19);
        await page.locator('.cwork__case').last().click();
        const nextLabel = await page.locator('.cwork__case').nth(17).locator('.cwork__entity').textContent();
        await page.getByRole('button', { name: 'No es un problema', exact: true }).click();
        await page.getByRole('radio', { name: /Falso positivo/ }).check();
        await page.getByRole('dialog').getByRole('button', { name: 'No es un problema', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.locator('.cwork__case[aria-current="true"] .cwork__entity')).toHaveText(nextLabel);
        result.scenarios.push('Decisión individual y continuidad en la última página');
      }

      const investigated = researchRows.find(row => row.entity.id === 8347);
      await page.goto(`${base}/curaduria/categoria/investigacion_documentada?q=8347&case=${investigated.id}`);
      await expect(page.getByRole('region', { name: 'Detalle del caso' })).toBeVisible();
      await page.getByText('Fuentes consultadas', { exact: false }).click();
      await page.getByText('Comparar pistas actuales', { exact: true }).click();
      await expect(page.locator('.cresearch__track-table tbody tr')).toHaveCount(1);
      await capture('investigacion');
      if (width === 1366) {
        await page.getByRole('button', { name: 'Revisar fusión', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByText('Previsualización interceptada durante QA', { exact: true })).toBeVisible();
        expect(requests.filter(request => request.path.endsWith('/merge-preview')).every(request => request.query.includes('mode=match'))).toBe(true);
        expect(requests.some(request => request.path === '/albums/8347/merge-preview' && request.query.includes('with=26925'))).toBe(true);
        await page.keyboard.press('Escape');
        result.scenarios.push('Dos listas y fuentes dentro del detalle; fusión precargada en modo match');
      } else {
        await page.getByRole('button', { name: 'Lista', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Lista de casos' })).toBeVisible();
      }
      await page.goto(`${base}/curaduria`);
      await expect(page.getByRole('link', { name: 'Continuar revisión', exact: true })).toBeVisible();
      await capture('resumen');
      await page.getByRole('link', { name: 'Continuar revisión', exact: true }).click();
      await expect(page).toHaveURL(/q=8347/);
      expect(errors).toEqual([]);
      result.viewports.push({ width, passed: true });
    } catch (error) {
      result.failures.push({ width, error: String(error), browserErrors: errors });
      await page.screenshot({ path: `${output}/error-${width}.png` });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
writeFileSync(`${output}/resultado.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (result.failures.length || result.catalogWrites) process.exitCode = 1;
