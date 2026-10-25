import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CRV · Frontend (PHASES §E8). Es un build estático aparte, no servido por
// Fastify: la API ya abre CORS a propósito (src/api/app.ts, `origin: true`)
// para que el navegador le hable directo por HTTP, sin compartir origen ni
// mezclar sus rutas JSON con las de esta SPA (una API en la raíz — /artists,
// /albums/:id... — y una SPA en la raíz colisionarían en el mismo puerto).
// El navegador nunca toca PostgreSQL: solo habla con esta API (CONTRACT #20).
export default defineConfig({
  plugins: [react(), {
    name: "catalog-local-media",
    configureServer(server) {
      // Las imágenes canónicas usan el prefijo del catálogo publicado.
      // En desarrollo, Vite sirve los mismos archivos desde public/media.
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith("/crv/media/")) request.url = request.url.slice("/crv".length);
        next();
      });
    },
  }],
  server: {
    port: 5173,
    // Las variantes WebP y los medios publicados se regeneran solos y suman
    // decenas de miles de archivos: vigilarlos agota el límite de inotify de la
    // máquina y el servidor de desarrollo muere con ENOSPC (fs.watch).
    // Los directorios de build también quedan fuera: dist/dist-public copian
    // public/media completo y el watcher los recorría igualmente.
    watch: {
      ignored: [
        "**/.media-variants/**",
        "**/public/media/**",
        "**/dist/**",
        "**/dist-public/**",
      ],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // `public/media` es un enlace al almacén de 1 TB con 19.586 archivos (2 GB):
    // copiarlo en cada build ataba la publicación al HDD (1m39s → 9m5s) y dejaba
    // una copia muerta de las imágenes en `dist-public/media`. `server.mjs` ya
    // sirve `/crv/media/*` desde `public/media`, así que aquí no se copia nada:
    // los estáticos sueltos de `public/` los añade scripts/copy-public-root.mjs.
    copyPublicDir: false,
  },
});
