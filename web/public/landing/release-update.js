/* global document, window */
// Detecta publicaciones nuevas incluso al restaurar una pestaña desde bfcache.
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="crv-page-version"]');
  if (!meta || !window.fetch) return;
  var initial = meta.content;
  var pending = false;
  var checking = false;
  var reloading = false;
  var dirtyForms = [];

  function changed(event) {
    var form = event.target && event.target.form;
    if (form && dirtyForms.indexOf(form) === -1) dirtyForms.push(form);
  }
  document.addEventListener('input', changed, true);
  document.addEventListener('change', changed, true);
  document.addEventListener('reset', function (event) {
    dirtyForms = dirtyForms.filter(function (form) { return form !== event.target; });
  }, true);

  function safeToReload() {
    if (document.hidden || dirtyForms.some(function (form) { return document.documentElement.contains(form); })) return false;
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
    return true;
  }

  function apply() {
    if (!pending || reloading || !safeToReload()) return;
    reloading = true;
    window.location.reload();
  }

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
