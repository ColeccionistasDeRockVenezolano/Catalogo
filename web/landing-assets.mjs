// Versiones del contenido publicado, calculadas una vez al arrancar cada release.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function landingAssets(root, extraFiles = []) {
  const versions = new Map();
  const release = createHash('sha256');
  function visit(directory, relative = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(path.join(directory, entry.name), name);
      else if (entry.isFile() && /\.(?:js|css|html)$/.test(name)) {
        const body = readFileSync(path.join(directory, entry.name));
        versions.set(name, createHash('sha256').update(body).digest('hex').slice(0, 20));
        release.update(name).update('\0').update(body).update('\0');
      }
    }
  }
  if (existsSync(root)) visit(root);
  for (const file of extraFiles) release.update(readFileSync(file)).update('\0');
  const version = release.digest('hex').slice(0, 20);
  return {
    version,
    // Solo recursos locales existentes; conserva parámetros ajenos y fragmentos.
    versionHtml(html, prefix = '') {
      const base = `${prefix}/landing/`;
      return html.replace(/\b(src|href|data-[\w-]+)="([^"]+)"/g, (attribute, key, value) => {
        if (!value.startsWith(base) && !value.startsWith('landing/') && !value.startsWith('./landing/')) return attribute;
        const url = new URL(value.replaceAll('&amp;', '&'), `http://localhost${prefix}/`);
        const name = url.pathname.slice(base.length);
        const hash = versions.get(name);
        if (!hash || !/\.(?:js|css)$/.test(name)) return attribute;
        url.searchParams.set('v', hash);
        return `${key}="${url.pathname}${url.search.replaceAll('&', '&amp;')}${url.hash}"`;
      });
    },
    pageVersion(html) {
      const template = html.match(/<meta name="crv-template-version" content="([a-f0-9]+)">/)?.[1] ?? '';
      return createHash('sha256').update(version).update(template).digest('hex').slice(0, 20);
    },
    prepareHtml(html, prefix = '') {
      const pageVersion = this.pageVersion(html);
      html = html.replace('</head>', `<meta name="crv-page-version" content="${pageVersion}"></head>`);
      html = html.replace('</body>', `<script src="${prefix}/landing/release-update.js" defer></script></body>`);
      return { html: this.versionHtml(html, prefix), version: pageVersion };
    },
  };
}
