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

  // CP0 parcial: la portada aplica tema y marca de auth.projects sin rebuild.
  var COLOR_VARS = ["bg", "surface", "surface-2", "surface-3", "border", "border-soft",
    "text", "text-muted", "text-faint", "red", "amber", "teal", "violet"];

  function lang() {
    var value = (document.documentElement.getAttribute("lang") || "es").toLowerCase();
    return value.indexOf("en") === 0 ? "en" : "es";
  }

  function setMeta(selector, attribute, value) {
    if (!value) return;
    var node = document.querySelector(selector);
    if (node) node.setAttribute(attribute, value);
  }

  function setHtml(node, value) {
    if (!node || !value) return;
    // El API ya sanea: solo llegan <br>, <em>, <strong> y <span>.
    node.innerHTML = value + '<span class="accent">.</span>';
  }

  function applySkin(site) {
    if (!site || typeof site !== "object") return;
    var theme = site.theme || {};
    var branding = site.branding || {};
    var translated = (site.translations || {})[lang()] || {};
    var currentLang = lang();

    if (branding.metaTitle) document.title = branding.metaTitle;
    setMeta('meta[name="description"]', "content", translated.metaDescription || branding.metaDescription);
    setMeta('meta[property="og:title"]', "content", branding.ogTitle);
    setMeta('meta[property="og:description"]', "content", branding.ogDescription);
    setMeta('meta[property="og:site_name"]', "content", branding.metaTitle);
    setMeta('meta[name="twitter:site"]', "content", branding.twitterSite);

    setHtml(document.querySelector("h1.hero-title, .hero h1, h1"), translated.heroTitleHtml || theme.heroTitleHtml);
    var sub = document.querySelector(".hero-sub, .hero p.lead, .hero p");
    var subText = translated.heroSubPublic || theme.heroSubPublic;
    if (sub && subText && !sub.querySelector("a")) sub.textContent = subText;
    // El badge de la portada es el del directo de radio, no el titular del
    // proyecto: no se toca aquí. `landingHeadline` y `footerNote` quedan
    // reservados al render EJS completo de CP0.

    var root = document.documentElement.style;
    if (theme.fontTitle) root.setProperty("--font-display", theme.fontTitle);
    if (theme.fontBody) root.setProperty("--font-body", theme.fontBody);
    var colors = theme.colors || {};
    for (var i = 0; i < COLOR_VARS.length; i += 1) {
      var key = COLOR_VARS[i];
      if (colors[key]) root.setProperty("--" + key, colors[key]);
    }
    // El idioma del documento manda: si la página es EN, se queda en EN.
    document.documentElement.dataset.crvSiteLang = currentLang;
  }

  function apply(config) {
    if (!config || typeof config !== "object") return;
    document.documentElement.dataset.crvSiteConfig = "ready";
    if (config.site) applySkin(config.site);
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
