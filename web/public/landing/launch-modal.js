(function () {
  'use strict';
  var dialog = document.getElementById('launch-modal');
  var form = document.getElementById('launch-form');
  if (!dialog || !form || typeof dialog.showModal !== 'function') return;
  var key = 'crv-library-launch-completed-v1';
  var english = document.documentElement.lang === 'en';
  var api = (document.body.getAttribute('data-api-base') || '/api') + '/roadmap/launch';
  var error = document.getElementById('launch-error');
  var submit = form.querySelector('[type="submit"]');
  var label = form.querySelector('[data-launch-submit-label]');
  var completed = false;
  var sending = false;
  var previousFocus;
  var previousOverflow;
  var campaign = '';
  try { campaign = (new URL(window.location.href).searchParams.get('utm_campaign') || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200); } catch (_) {}
  function remember() { completed = true; try { localStorage.setItem(key, '1'); } catch (_) {} }
  function close() { if (dialog.open) dialog.close(); }
  function open() {
    if (completed || dialog.open) return;
    previousFocus = document.activeElement;
    previousOverflow = document.documentElement.style.overflow;
    // Evita abrir el teclado móvil antes de que la persona elija un campo.
    dialog.querySelector('[data-launch-close]').autofocus = true;
    dialog.showModal();
    document.documentElement.style.overflow = 'hidden';
  }
  dialog.querySelectorAll('[data-launch-close]').forEach(function (button) { button.addEventListener('click', close); });
  dialog.addEventListener('close', function () {
    document.documentElement.style.overflow = previousOverflow || '';
    if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  });
  dialog.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var stops = Array.from(dialog.querySelectorAll('button, input, select, summary, [tabindex="0"]')).filter(function (element) {
      return !element.disabled && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0;
    });
    var first = stops[0]; var last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  // Un gesto que comienza dentro y termina fuera no debe cerrar el formulario.
  var backdropStart = false;
  dialog.addEventListener('pointerdown', function (event) { backdropStart = event.target === dialog; });
  dialog.addEventListener('click', function (event) {
    var box = dialog.getBoundingClientRect();
    if (backdropStart && event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
    backdropStart = false;
  });
  window.addEventListener('storage', function (event) { if (event.key === key && event.newValue === '1') { completed = true; close(); } });
  function fieldError(field, message) {
    var input = form.elements.namedItem(field);
    var output = document.getElementById('launch-' + field + '-error');
    if (!input || !output) return;
    input.setAttribute('aria-invalid', 'true'); output.textContent = message; output.hidden = false;
    var details = input.closest('details'); if (details) details.open = true;
  }
  function resetErrors() {
    error.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach(function (input) { input.removeAttribute('aria-invalid'); });
    form.querySelectorAll('.launch-form__error').forEach(function (output) { output.hidden = true; output.textContent = ''; });
  }
  form.noValidate = true;
  form.addEventListener('input', function (event) {
    var input = event.target;
    if (input.name && input.hasAttribute('aria-invalid')) {
      input.removeAttribute('aria-invalid');
      var output = document.getElementById('launch-' + input.name + '-error'); if (output) output.hidden = true;
    }
  });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (sending || completed) return;
    resetErrors();
    var values = Object.fromEntries(new FormData(form));
    Object.keys(values).forEach(function (name) { values[name] = String(values[name]).trim(); });
    if (!values.name || values.name.length < 2) fieldError('name', english ? 'Enter your name (at least 2 characters).' : 'Escribe tu nombre (al menos 2 caracteres).');
    if (!values.email || !form.elements.namedItem('email').validity.valid) fieldError('email', english ? 'Enter a valid email, such as you@example.com.' : 'Escribe un correo válido, como tu@correo.com.');
    if (!values.type) fieldError('type', english ? 'Choose the option that best describes you.' : 'Elige la opción que más te identifica.');
    if (values.phone && (!/^[+\d\s().-]{6,40}$/.test(values.phone) || values.phone.replace(/\D/g, '').length < 6)) fieldError('phone', english ? 'Check your number and include the country code.' : 'Revisa tu número e incluye el código de país.');
    ['name', 'social'].forEach(function (name) { if (/[\u0000-\u001f\u007f]/.test(values[name] || '')) fieldError(name, english ? 'Remove unsupported characters.' : 'Elimina los caracteres no válidos.'); });
    var invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    sending = true; submit.disabled = true; form.setAttribute('aria-busy', 'true');
    label.textContent = english ? 'Saving your registration…' : 'Guardando tu registro…';
    values.campaign = campaign;
    try {
      var response = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(response.status === 429 ? 'rate' : 'request');
      var result = await response.json();
      if (result.completed !== true) throw new Error('request');
      remember();
      dialog.querySelector('[data-launch-intro]').hidden = true;
      var success = dialog.querySelector('[data-launch-success]'); success.hidden = false;
      dialog.setAttribute('aria-labelledby', 'launch-success-title');
      success.querySelector('h2').id = 'launch-success-title';
      dialog.removeAttribute('aria-describedby');
      // Si se cerró durante el envío, confirmar igualmente el registro guardado.
      if (!dialog.open) { previousOverflow = document.documentElement.style.overflow; dialog.showModal(); document.documentElement.style.overflow = 'hidden'; }
      dialog.scrollTop = 0; success.focus();
    } catch (failure) {
      error.textContent = failure.message === 'rate'
        ? (english ? 'Too many attempts. Wait 15 minutes and try again.' : 'Has enviado varios intentos. Espera 15 minutos y vuelve a intentarlo.')
        : (english ? 'We couldn’t confirm your registration. Your details are still here; please try again.' : 'No pudimos confirmar tu registro. Tus datos siguen aquí; vuelve a intentarlo.');
      error.hidden = false;
    } finally {
      sending = false; submit.disabled = false; form.removeAttribute('aria-busy');
      label.textContent = english ? 'Notify me at launch' : 'Avísame del lanzamiento';
    }
  });
  try { if (localStorage.getItem(key) === '1') { completed = true; return; } } catch (_) {}
  // El aviso no interrumpe la llegada: sale a los dos minutos de estar en la
  // página. Si la pestaña sigue en segundo plano, espera a que vuelva.
  var OPEN_DELAY = 120000;
  var scheduled = false;
  function scheduleOpen() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      if (completed) return;
      if (document.hidden) {
        document.addEventListener('visibilitychange', function onVisible() {
          document.removeEventListener('visibilitychange', onVisible);
          if (!completed && !document.hidden) open();
        });
        return;
      }
      open();
    }, OPEN_DELAY);
  }
  scheduleOpen();
  // La cookie HttpOnly permite recordar el envío aunque se borre localStorage.
  fetch(api, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(1800) })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (result) { if (result && result.completed) remember(); })
    .catch(function () {});
}());
