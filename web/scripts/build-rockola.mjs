import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { watch as watchFiles } from 'node:fs';
import { build, context } from 'esbuild';

// Bundle del chat de La Rockola. En producción se ejecuta una vez; con
// `--watch` (npm run dev:rockola) recompila al guardar cualquier fuente o CSS
// del widget, y la portada con CRV_LIVE_RELOAD=1 se recarga sola.
const watch = process.argv.includes('--watch');
const loaders = { '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' };
const srcDir = fileURLToPath(new URL('../src', import.meta.url));

const options = {
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ['src/landing-rockola.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: 'public/landing/rockola.js',
  jsx: 'automatic',
  define: {
    'import.meta.env': JSON.stringify({ BASE_URL: '/', VITE_API_BASE_URL: '/api' }),
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [{
    name: 'inline-widget-styles',
    setup(plugin) {
      plugin.onResolve({ filter: /\.css\?inline$/ }, args => ({
        path: fileURLToPath(new URL('../src/' + args.path.replace('./', '').replace('?inline', ''), import.meta.url)),
        namespace: 'inline-css',
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'inline-css' }, async args => {
        const result = await build({ entryPoints: [args.path], bundle: true, write: false, minify: true, loader: loaders });
        return { contents: result.outputFiles[0].text, loader: 'text', watchFiles: [args.path] };
      });
    },
  }],
  loader: loaders,
};

const ctx = await context(options);

// esbuild deja junto al bundle un rockola.css con el CSS que importa el widget
// (chat, efectos de nombre…), que en realidad va dentro del Shadow DOM. La hoja
// pública es solo esta; se reescribe después de CADA compilación: antes se
// escribía una vez y, en --watch, la primera recompilación la pisaba.
const PUBLIC_CSS = "/* Rockola styles are isolated inside its Shadow DOM. */\n#visitCounter[hidden]{display:none!important}\n";
const writePublicCss = () => writeFile(new URL("../public/landing/rockola.css", import.meta.url), PUBLIC_CSS);

if (watch) {
  // esbuild no vigila los CSS que resuelve el plugin (namespace propio), así
  // que el watch lo lleva Node sobre src/: cualquier .ts/.tsx/.css guardado
  // recompila el bundle. Es un build de ~300 ms, de sobra para trabajar.
  let running = false;
  let queued = false;
  let timer;
  const clock = () => new Date().toLocaleTimeString('es-VE', { hour12: false });

  async function compile(reason = 'inicial') {
    if (running) { queued = true; return; }
    running = true;
    try {
      const result = await ctx.rebuild();
      await writePublicCss();
      console.log(`rockola: recompilado ${clock()} · ${reason}`);
      if (result.warnings.length) console.warn(result.warnings.map(w => w.text).join('\n'));
    } catch (error) {
      console.error(`rockola: error de compilación\n${error.message ?? error}`);
    } finally {
      running = false;
      if (queued) { queued = false; void compile('cambios pendientes'); }
    }
  }

  await compile();
  watchFiles(srcDir, { recursive: true }, (_event, file) => {
    if (!file || !/\.(tsx?|css)$/u.test(file.toString())) return;
    clearTimeout(timer);
    timer = setTimeout(() => void compile(file.toString()), 150);
  });
  console.log('rockola: vigilando src/ (al guardar se recompila)');
} else {
  const result = await ctx.rebuild();
  await writePublicCss();
  if (result.warnings.length) console.warn(result.warnings.map(w => w.text).join('\n'));
  await ctx.dispose();
}

