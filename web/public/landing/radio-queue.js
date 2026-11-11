// Radio › Poner a continuación (2026-11-11).
//
// Busca en el catálogo al aire y pone una pieza para que suene en cuanto acabe
// la que está sonando. La programación no se reordena: al terminar, la emisión
// sigue en la pieza que tocaba. Todo se pinta con nodos y textContent.
// Solo lo carga el panel de administración.
(function () {
  'use strict';

  var root = document.querySelector('[data-radio-queue-root]');
  if (!root) return;
  var base = root.getAttribute('data-radio-queue-url') || '/api/community/admin/panel/radio';
  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var form = root.querySelector('[data-radio-queue-search]');
  var input = root.querySelector('[data-radio-queue-input]');
  var results = root.querySelector('[data-radio-queue-results]');
  var queue = root.querySelector('[data-radio-queue-list]');
  var status = root.querySelector('[data-radio-queue-status]');
  var timer = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function say(text, isError) {
    status.textContent = text || '';
    status.classList.toggle('is-error', Boolean(isError));
  }
  function call(method, url, body) {
    var init = { method: method, headers: { 'x-crv-csrf': csrfToken }, credentials: 'same-origin' };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (response) {
      if (response.status === 204) return { ok: true, data: null };
      return response.json().then(function (data) {
        var message = data && data.error ? (typeof data.error === 'object' ? data.error.message : data.error) : null;
        return { ok: response.ok, data: data, message: message };
      }, function () { return { ok: response.ok, data: null, message: response.ok ? null : 'Respuesta inválida (' + response.status + ').' }; });
    });
  }
  function clock(iso) {
    try {
      return new Intl.DateTimeFormat('es-VE', { timeStyle: 'short', timeZone: 'America/Caracas' }).format(new Date(iso));
    } catch (_) { return iso; }
  }
  function minutes(seconds) {
    var whole = Math.round(seconds);
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }
  function line(item) {
    return (item.artist ? item.artist + ' — ' : '') + item.title;
  }

  function renderQueue(payload) {
    queue.replaceChildren();
    if (payload && payload.owner === false) {
      queue.appendChild(el('p', 'radio-queue__empty', 'Este servidor no emite la radio: no se pueden poner piezas desde aquí.'));
      return;
    }
    var inserts = (payload && payload.inserts || []).filter(function (entry) { return entry.status !== 'done'; });
    if (inserts.length === 0) {
      queue.appendChild(el('p', 'radio-queue__empty', 'No hay piezas puestas: suena la programación.'));
      return;
    }
    inserts.forEach(function (entry) {
      var row = el('li', 'radio-queue__row');
      var text = el('div', 'radio-queue__text');
      text.appendChild(el('strong', null, line(entry)));
      text.appendChild(el('span', 'radio-queue__meta',
        (entry.status === 'playing' ? 'Sonando ahora · hasta ' + clock(entry.endsAt) : 'Suena a las ' + clock(entry.startsAt))
        + ' · ' + minutes(entry.durationSeconds) + (entry.requestedBy ? ' · ' + entry.requestedBy : '')));
      row.appendChild(text);
      if (entry.status === 'pending') {
        var cancel = el('button', 'btn btn-ghost btn-sm', 'Quitar');
        cancel.type = 'button';
        cancel.addEventListener('click', function () {
          cancel.disabled = true;
          call('DELETE', base + '/inserts/' + encodeURIComponent(entry.id)).then(function (result) {
            if (!result.ok) { say(result.message || 'No se pudo quitar.', true); cancel.disabled = false; return; }
            say('Quitada. Las demás se adelantan.');
            loadQueue();
          }, function () { say('Sin conexión con la radio.', true); cancel.disabled = false; });
        });
        row.appendChild(cancel);
      }
      queue.appendChild(row);
    });
  }

  function loadQueue() {
    return call('GET', base + '/inserts').then(function (result) {
      if (!result.ok) { say(result.message || 'No se pudo leer la fila.', true); return; }
      renderQueue(result.data);
    }, function () { say('Sin conexión con la radio.', true); });
  }

  function renderResults(items) {
    results.replaceChildren();
    if (items.length === 0) { results.appendChild(el('p', 'radio-queue__empty', 'Nada en el catálogo al aire con esas palabras.')); return; }
    items.forEach(function (item) {
      var row = el('li', 'radio-queue__row');
      var text = el('div', 'radio-queue__text');
      text.appendChild(el('strong', null, line(item)));
      text.appendChild(el('span', 'radio-queue__meta', item.album + (item.year ? ' (' + item.year + ')' : '') + ' · ' + minutes(item.durationSeconds)));
      row.appendChild(text);
      var put = el('button', 'btn btn-red btn-sm', 'Poner a continuación');
      put.type = 'button';
      put.addEventListener('click', function () {
        put.disabled = true;
        call('POST', base + '/inserts', { videoId: item.videoId, startSeconds: item.startSeconds }).then(function (result) {
          put.disabled = false;
          if (!result.ok) { say(result.message || 'No se pudo poner.', true); return; }
          say('«' + item.title + '» suena a las ' + clock(result.data.insert.startsAt) + '.');
          loadQueue();
        }, function () { put.disabled = false; say('Sin conexión con la radio.', true); });
      });
      row.appendChild(put);
      results.appendChild(row);
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var q = input.value.trim();
    if (q.length < 2) { say('Escribe al menos dos letras.', true); return; }
    say('Buscando…');
    call('GET', base + '/catalog?q=' + encodeURIComponent(q)).then(function (result) {
      if (!result.ok) { say(result.message || 'No se pudo buscar.', true); return; }
      say('');
      renderResults(result.data.items || []);
    }, function () { say('Sin conexión con la radio.', true); });
  });

  // La fila se refresca mientras la ventana está abierta; cerrada, no consulta nada.
  var dialog = root.closest('dialog');
  function start() { loadQueue(); if (!timer) timer = window.setInterval(loadQueue, 20000); }
  function stop() { if (timer) { window.clearInterval(timer); timer = null; } }
  if (dialog) {
    new MutationObserver(function () { if (dialog.open) start(); else stop(); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    if (dialog.open) start();
  } else {
    start();
  }
})();
