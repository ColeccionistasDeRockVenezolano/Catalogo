// Primera procedencia del día resuelta en el servidor; sin cookies ni identidad persistente.
(function () {
  'use strict';
  var script = document.currentScript;
  var page = script && script.dataset.acquisitionPage;
  if (!page || window.__crvAcquisition) return;
  window.__crvAcquisition = true;
  var base = (document.querySelector('meta[name="crv-api-base"]') || {}).content || '/api';
  var query = new URLSearchParams(window.location.search);
  var attribution = {};
  [['ref', 'ref'], ['utm_source', 'source'], ['utm_medium', 'medium'], ['utm_campaign', 'campaign'], ['utm_content', 'content']].forEach(function (pair) {
    var value = query.get(pair[0]);
    if (value && value.length <= 80) attribution[pair[1]] = value;
  });
  try { if (document.referrer) attribution.referrer = new URL(document.referrer).origin; } catch (error) { /* origen oculto */ }
  var documentId = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  var sent = {};
  function send(kind) {
    if (sent[kind]) return;
    sent[kind] = true;
    fetch(base + '/traffic/event', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ page: page, kind: kind, eventId: documentId + '_' + kind,
        webdriver: navigator.webdriver === true, attribution: attribution }),
    }).catch(function () { /* La medición nunca interrumpe la navegación. */ });
  }
  function visiblePage() { if (!document.hidden) send('page'); }
  visiblePage();
  document.addEventListener('visibilitychange', visiblePage);
  document.addEventListener('click', function (event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    var link = event.target.closest('a[href]');
    if (link) {
      try {
        var target = new URL(link.href, window.location.href);
        if (target.origin === window.location.origin && /\/colaborar\/?$/.test(target.pathname)) send('collaborate');
      } catch (error) { /* enlace no navegable */ }
    }
    if (event.target.closest('[data-radio-sync], [data-radio-identifier-toggle], [data-radio-unmute], [data-radio-mute]')) send('radio');
  }, { capture: true });
}());
