// Contador público de visitas.
//
// El servidor ya entrega la tarjeta rellena, así que esto solo añade lo que la
// SSR no puede: el latido que mantiene viva la lista de «en línea», el refresco
// cada minuto y el paso automático entre las tres páginas.
//
// Sin JavaScript la tarjeta se sigue viendo, con las cifras del momento en que
// se cargó la página y su primera página a la vista.
(function () {
  'use strict';

  var root = document.getElementById('visitCounter');
  if (!root) return;

  // Latido: una vez al abrir y luego cada minuto. La ventana de «en línea» son
  // cinco minutos, así que se pueden perder varios sin que nadie desaparezca.
  var BEAT_MS = 60000;
  // Tiempo que cada página está a la vista antes de dar paso a la otra. Lo
  // bastante largo para leer una lista corta sin quedarse esperando.
  var ROTATE_MS = 7000;

  var url = root.dataset.visitsUrl;
  var flagBase = root.dataset.flagBase || '';
  var storageKey = root.dataset.visitsStorage || 'herra-visits';
  var locale = document.documentElement.lang === 'en' ? 'en-US' : 'es-VE';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var messages = {};
  try { messages = JSON.parse(root.dataset.messages || '{}') || {}; } catch (error) { messages = {}; }
  function T(key, vars) {
    var template = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
    });
  }

  function num(value) {
    try { return Number(value).toLocaleString(locale); } catch (error) { return String(value); }
  }

  // ---- Plegado ---------------------------------------------------------------
  // La preferencia es de este navegador y de este proyecto: quien aparta la
  // tarjeta no quiere volver a encontrársela abierta en cada página.
  var toggle = document.getElementById('visitsToggle');
  var body = document.getElementById('visitsBody');
  var collapsedBrand = root.querySelector('[data-visits-brand="collapsed"]');
  var online = Number((root.querySelector('[data-visits-online]') || {}).textContent) || 0;

  function readStored() {
    try { return window.localStorage.getItem(storageKey); } catch (error) { return null; }
  }
  function store(value) {
    try { window.localStorage.setItem(storageKey, value); } catch (error) { /* modo privado */ }
  }

  function setCollapsedBrand() {
    if (collapsedBrand) collapsedBrand.textContent = T('visits.collapsedTitle', { count: num(online) });
  }

  function applyCollapsed(collapsed) {
    root.classList.remove('visits--pending');
    root.classList.toggle('is-collapsed', collapsed);
    if (body) body.hidden = collapsed;
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      var label = T(collapsed ? 'visits.expand' : 'visits.collapse');
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
    }
    setCollapsedBrand();
  }

  var radio = document.getElementById('radio');

  function overlapsRadio() {
    if (!radio) return false;
    var widgetRect = root.getBoundingClientRect();
    var radioRect = radio.getBoundingClientRect();
    var gap = 12;
    return widgetRect.left < radioRect.right + gap
      && widgetRect.right > radioRect.left - gap
      && widgetRect.top < radioRect.bottom + gap
      && widgetRect.bottom > radioRect.top - gap;
  }

  function applyResponsiveDefault() {
    // En teléfonos se prioriza siempre el reproductor. En el resto se mide la
    // intersección real: la tarjeta queda abierta siempre que no tape la radio.
    if (window.matchMedia('(max-width: 720px)').matches) {
      applyCollapsed(true);
      return;
    }
    applyCollapsed(false);
    applyCollapsed(overlapsRadio());
  }

  // Una decisión explícita de la persona manda sobre el ajuste automático.
  // Sin preferencia guardada, el estado responde al espacio disponible.
  var stored = readStored();
  if (stored === 'collapsed' || stored === 'open') {
    applyCollapsed(stored === 'collapsed');
  } else {
    applyResponsiveDefault();
    window.addEventListener('resize', applyResponsiveDefault);
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      var collapsed = !root.classList.contains('is-collapsed');
      applyCollapsed(collapsed);
      store(collapsed ? 'collapsed' : 'open');
      window.removeEventListener('resize', applyResponsiveDefault);
    });
  }

  // ---- Páginas ---------------------------------------------------------------
  var pages = Array.prototype.slice.call(root.querySelectorAll('[data-visits-page]'));
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-visits-tab]'));
  var current = 0;
  var rotateTimer = null;
  var paused = false;

  function showPage(index, viaUser) {
    current = (index + pages.length) % pages.length;
    pages.forEach(function (page, i) {
      // Sin atributo `hidden`: la página oculta debe seguir ocupando su celda
      // para que la tarjeta no cambie de altura (ver .visits__pages en el CSS).
      page.classList.toggle('is-active', i === current);
    });
    tabs.forEach(function (tab, i) {
      var active = i === current;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });
    if (viaUser && tabs[current]) tabs[current].focus();
  }

  function stopRotation() {
    if (rotateTimer !== null) { window.clearInterval(rotateTimer); rotateTimer = null; }
  }

  function startRotation() {
    stopRotation();
    if (pages.length < 2) return;
    rotateTimer = window.setInterval(function () {
      // Con la tarjeta plegada, la pestaña oculta o alguien leyéndola encima,
      // pasar de página no aporta nada y solo gasta.
      if (paused || document.hidden || root.classList.contains('is-collapsed')) return;
      showPage(current + 1);
    }, ROTATE_MS);
  }

  // Pasar el ratón por encima o llegar con el teclado detiene el carrusel: nadie
  // debería ver desaparecer la lista que está leyendo.
  ['mouseenter', 'focusin'].forEach(function (event) {
    root.addEventListener(event, function () { paused = true; });
  });
  ['mouseleave', 'focusout'].forEach(function (event) {
    root.addEventListener(event, function () {
      paused = root.contains(document.activeElement) || root.matches(':hover');
    });
  });

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { showPage(index); });
    tab.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault(); showPage(current + 1, true);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault(); showPage(current - 1, true);
      }
    });
  });

  startRotation();

  // ---- Repintado -------------------------------------------------------------
  function setText(selector, value) {
    var node = root.querySelector(selector);
    if (node) node.textContent = value;
  }

  function renderList(page, items, emptyText) {
    var title = page.querySelector('.visits__page-title');
    // Se reconstruye solo la parte variable: el rótulo de la página no cambia.
    while (page.lastChild && page.lastChild !== title) page.removeChild(page.lastChild);

    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'visits__empty';
      empty.textContent = emptyText;
      page.appendChild(empty);
      return;
    }

    var list = document.createElement('ul');
    list.className = 'visits__list';
    items.forEach(function (item) {
      var row = document.createElement('li');
      row.className = 'visits__row';
      row.title = T('visits.fromCountry', { count: num(item.count), country: item.name });

      if (item.flag) {
        var flag = document.createElement('img');
        flag.className = 'visits__flag';
        // El servidor ya comprobó que el archivo existe (ver flags.ts): aquí no
        // hace falta un plan B para una bandera que falte.
        flag.src = flagBase + item.flag + '.svg';
        flag.alt = '';
        flag.width = 21;
        flag.height = 15;
        flag.loading = 'lazy';
        flag.decoding = 'async';
        row.appendChild(flag);
      } else {
        var globe = document.createElement('span');
        globe.className = 'visits__flag visits__flag--unknown';
        globe.setAttribute('aria-hidden', 'true');
        row.appendChild(globe);
      }

      var name = document.createElement('span');
      name.className = 'visits__country';
      name.textContent = item.name;
      row.appendChild(name);

      var count = document.createElement('span');
      count.className = 'visits__count';
      count.textContent = num(item.count);
      row.appendChild(count);

      list.appendChild(row);
    });
    page.appendChild(list);
  }

  function apply(stats) {
    setText('[data-visits-today]', num(stats.today));
    setText('[data-visits-total]', num(stats.total));
    online = Number(stats.online) || 0;
    setText('[data-visits-online]', num(online));
    setCollapsedBrand();
    root.classList.toggle('has-company', stats.online > 1);

    pages.forEach(function (page) {
      if (page.dataset.visitsPage === 'today') {
        renderList(page, stats.todayCountries || [], T('visits.emptyToday'));
      } else if (page.dataset.visitsPage === 'online') {
        renderList(page, stats.onlineCountries || [], T('visits.emptyOnline'));
      } else {
        renderList(page, stats.totalCountries || [], T('visits.emptyTotal'));
      }
    });
  }

  var failures = 0;

  function beat() {
    if (document.hidden) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // navigator.webdriver delata a los navegadores manejados por un programa:
      // el servidor los aparta del contador (ver traffic/classify.ts).
      body: JSON.stringify({ webdriver: navigator.webdriver === true }),
    }).then(function (response) {
      return response.ok ? response.json() : null;
    }).then(function (stats) {
      if (!stats) { failures += 1; return; }
      failures = 0;
      apply(stats);
    }).catch(function () {
      // Silencioso a propósito: un contador que no llega no es un error que
      // merezca molestar a nadie, y la SSR ya dejó cifras en pantalla.
      failures += 1;
    });
  }

  if (root.dataset.visitRecorded !== 'true') beat();
  var beatTimer = window.setInterval(function () {
    // Tres intentos fallidos seguidos: el servidor no está o el contador se
    // acaba de apagar. Se deja de insistir hasta la próxima carga de página.
    if (failures >= 3) { window.clearInterval(beatTimer); stopRotation(); return; }
    beat();
  }, BEAT_MS);

  // Volver a la pestaña debe encontrar el contador al día, sin esperar al
  // siguiente minuto.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) beat(); });

  // Con movimiento reducido no hay transición, pero las páginas siguen pasando:
  // la información de la segunda no puede quedar inalcanzable.
  if (reduceMotion.matches) root.classList.add('is-still');
  reduceMotion.addEventListener('change', function (event) {
    root.classList.toggle('is-still', event.matches);
  });
})();
