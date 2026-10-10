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
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
