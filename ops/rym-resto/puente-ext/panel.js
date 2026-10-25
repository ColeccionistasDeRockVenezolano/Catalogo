document.title = "PANEL-VIVO";
/* Bucle de trabajo de la extensión: vive en la pestaña «panel» (una página abierta conserva sus
   temporizadores; el fondo de la extensión se suspende, por eso el bucle va aquí). */
const BASE = "http://127.0.0.1:8899";
const salida = document.getElementById("e");

async function bucle() {
  try {
    fetch(BASE + "/latido", { cache: "no-store" }).catch(() => {});
    const r = await fetch(BASE + "/trabajo", { cache: "no-store" });
    if (r.status === 200) {
      const j = await r.json();
      if (j && j.url) {
        salida.textContent = "pidiendo " + j.url;
        browser.runtime.sendMessage({ tipo: "pedir", id: j.id, url: j.url });
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } else {
      salida.textContent = "esperando trabajos…";
    }
  } catch (e) {
    salida.textContent = "puente caído: " + e;
  }
  setTimeout(bucle, 800);
}

bucle();
