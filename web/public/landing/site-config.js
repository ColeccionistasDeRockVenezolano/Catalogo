// CRV · Ajustes públicos del proyecto en los documentos estáticos.
//
// El roadmap y /colaborar son HTML real de la portada; este script aplica las
// decisiones administrativas que no pueden quedar incrustadas en ese HTML:
// ocultar «Entrar», apagar el contador o cerrar candidaturas. La API sigue
// siendo la autoridad (por ejemplo, rechaza candidaturas cerradas).
(function () {
  "use strict";
  var api = new URL("api/site-config", document.baseURI).href;

  function removeNavLogin() {
    var links = document.querySelectorAll(
      '#navLinks a[href$="/cuenta"], #navLinks a[href$="/login"], ' +
      '.nav-links a[href$="/cuenta"], .nav-links a[href$="/login"], ' +
      '.nav-menu a[href$="/cuenta"], .nav-menu a[href$="/login"]'
    );
    for (var i = 0; i < links.length; i += 1) {
      var item = links[i].closest("li");
      if (item) item.remove();
      else links[i].remove();
    }
  }

  function apply(config) {
    if (!config || typeof config !== "object") return;
    document.documentElement.dataset.crvSiteConfig = "ready";
    if (config.showLogin === false) removeNavLogin();
    if (config.visitorCounter === false) {
      var counter = document.getElementById("visitCounter");
      if (counter) counter.remove();
    }
    if (config.acceptsApplications === false) {
      document.body.dataset.applicationsClosed = "true";
      var ctas = document.querySelectorAll('a.nav-cta[href$="/colaborar"], a[href$="/colaborar"].btn');
      for (var i = 0; i < ctas.length; i += 1) {
        ctas[i].setAttribute("aria-disabled", "true");
        ctas[i].setAttribute("title", "Las candidaturas están cerradas en este momento.");
      }
    }
    document.dispatchEvent(new CustomEvent("crv:site-config", { detail: config }));
  }

  fetch(api, { credentials: "same-origin", headers: { accept: "application/json" } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(apply)
    .catch(function () { /* la página sigue funcionando con sus valores de portada */ });
})();
