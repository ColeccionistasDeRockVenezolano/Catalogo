/* global document, window */
// Detecta publicaciones nuevas incluso al restaurar una pestaña desde bfcache.
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="crv-page-version"]');
  if (!meta || !window.fetch || window.CRVRequestBuildReload) return;
  var initial = meta.content;
  var pending = false;
  var checking = false;
  var reloading = false;
  var edits = [];
  var mutations = 0;
  var reloadKey = 'crv:stale-build-reload';

  // Protege también los guardados por fetch que no provienen de un formulario.
  var fetch = window.fetch;
  window.fetch = function (input, options) {
    var method = String(options && options.method || input && input.method || 'GET').toUpperCase();
    var mutation = !/^(GET|HEAD|OPTIONS)$/.test(method);
    if (mutation) mutations += 1;
    var request;
    try { request = fetch.apply(this, arguments); }
    catch (error) { if (mutation) mutations -= 1; throw error; }
    if (!mutation) return request;
    return request.then(function (response) { mutations -= 1; return response; }, function (error) { mutations -= 1; throw error; });
  };

  function value(field, defaults) {
    if (field.type === 'checkbox' || field.type === 'radio') return String(defaults ? field.defaultChecked : field.checked);
    if (field.options) return Array.prototype.filter.call(field.options, function (option) { return defaults ? option.defaultSelected : option.selected; }).map(function (option) { return option.value; }).join('\n');
    return String(defaults ? field.defaultValue || '' : field.value == null ? field.textContent || '' : field.value);
  }

  function changed(event) {
    var target = event.target;
    if (!target || !('value' in target || target.isContentEditable)) return;
    for (var i = 0; i < edits.length; i += 1) if (edits[i].field === target) return;
    edits.push({ field: target, original: value(target, event.type !== 'focusin') });
  }
  document.addEventListener('focusin', changed, true);
  document.addEventListener('input', changed, true);
  document.addEventListener('change', changed, true);
  document.addEventListener('reset', function (event) {
    edits = edits.filter(function (edit) { return edit.field.form !== event.target; });
  }, true);

  function safeToReload() {
    edits = edits.filter(function (edit) { return document.documentElement.contains(edit.field); });
    if (document.hidden || mutations || edits.some(function (edit) { return value(edit.field, false) !== edit.original; })) return false;
    // Los widgets externos no exponen siempre su estado de pausa: mientras
    // exista un player abierto, conservarlo. Cerrar el player libera la recarga.
    if (document.querySelector('.catalog-video-player iframe, .video-layer--external iframe, .eedit__tray.is-dirty, [data-crv-build-busy], [aria-busy="true"]')) return false;
    if (typeof window.CRVRadioCanReload === 'function') {
      if (!window.CRVRadioCanReload()) return false;
    } else {
      // Si otro cliente arrancó antes de que cargue la radio, no asumir silencio.
      var radio = document.getElementById('radio');
      if (radio && radio.getAttribute('data-radio-requested') === 'true') return false;
    }
    var media = document.querySelectorAll('audio, video');
    for (var i = 0; i < media.length; i += 1) {
      if (!media[i].paused && !media[i].ended) return false;
    }
    var event = new window.Event('crv:before-build-reload', { cancelable: true });
    if (!window.dispatchEvent(event)) return false;
    return true;
  }

  function recentlyReloaded() {
    try { return Date.now() - Number(window.sessionStorage.getItem(reloadKey) || 0) < 30000; }
    catch (_) { return false; }
  }

  function apply() {
    if (!pending || reloading || recentlyReloaded() || !safeToReload()) return;
    reloading = true;
    try { window.sessionStorage.setItem(reloadKey, String(Date.now())); } catch (_) { /* almacenamiento desactivado */ }
    window.location.reload();
  }

  // Vite y ErrorBoundary solicitan la misma recarga, con los mismos bloqueos
  // y el mismo límite de intentos que la comprobación periódica.
  window.CRVRequestBuildReload = function () {
    if (pending || reloading) return true;
    if (recentlyReloaded()) return false;
    pending = true;
    apply();
    return true;
  };
  // Compatibilidad con bundles ya publicados que aún no conocen el hook.
  // Captura antes del listener de Vite de la SPA; solo toma el evento cuando
  // la recarga está aceptada, sin ejecutar dos recuperaciones a la vez.
  window.addEventListener('vite:preloadError', function (event) {
    if (window.CRVRequestBuildReload()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  function check() {
    if (document.hidden || checking || reloading) return;
    if (pending) { apply(); return; }
    checking = true;
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timer = window.setTimeout(function () { if (controller) controller.abort(); }, 10000);
    window.fetch(window.location.href, {
      method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'manual',
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      var next = response.headers.get('X-CRV-Page-Version');
      if (response.ok && next && next !== initial) pending = true;
    }).catch(function () { /* Sin conexión: esperar al próximo intento. */ }).then(function () {
      window.clearTimeout(timer);
      checking = false;
      apply();
    });
  }

  window.addEventListener('pageshow', check);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.setInterval(check, 60000);
  window.setInterval(apply, 5000);
})();
