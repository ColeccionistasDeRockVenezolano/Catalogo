// Formulario de candidatura por pasos. Sin JS la página sigue funcionando:
// los bloques se muestran seguidos y el envío es el mismo POST. El número de
// pasos no es fijo: cada proyecto puede apagar campos enteros, así que todo se
// cuenta desde el DOM en lugar de asumir cinco.
(function () {
  'use strict';

  // Los textos llegan traducidos del servidor (ver i18n-client.js).
  var T = (window.HerraI18n || { t: function (key) { return key; } }).t;
  var form = document.getElementById('collaborateForm');
  if (!form) return;

  var panels = Array.prototype.slice.call(form.querySelectorAll('[data-collab-step]'));
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-collab-step-tab]'));
  var nav = form.querySelector('[data-collab-nav]');
  var prevBtn = form.querySelector('[data-collab-prev]');
  var nextBtn = form.querySelector('[data-collab-next]');
  var statusEl = form.querySelector('[data-collab-status]');
  var review = form.querySelector('[data-collab-review]');
  if (panels.length === 0 || !nav) return;

  var total = panels.length;
  var current = 1;

  // La navegación por pasos solo aparece cuando hay JS para gobernarla.
  nav.hidden = false;

  // Los pasos se numeran por posición: así el asistente sigue siendo coherente
  // aunque el proyecto haya quitado alguno del medio.
  function panelOf(step) {
    return panels[step - 1] || null;
  }

  function valueOf(name) {
    var field = form.elements[name];
    if (!field) return '';
    return (field.value || '').trim();
  }

  function checkedLabels(name) {
    var boxes = form.querySelectorAll('input[name="' + name + '"]:checked');
    return Array.prototype.map.call(boxes, function (box) {
      var span = box.parentElement.querySelector('span');
      return span ? span.textContent.trim() : box.value;
    });
  }

  function linkSummary() {
    var urls = Array.prototype.slice.call(form.querySelectorAll('input[name="linkUrl"]'));
    return urls.map(function (input) { return input.value.trim(); }).filter(Boolean);
  }

  function selectedText(name) {
    var field = form.elements[name];
    if (!field || typeof field.selectedIndex !== 'number') return '';
    var option = field.options[field.selectedIndex];
    return option ? option.textContent.trim() : '';
  }

  // El resumen usa las etiquetas que el visitante acaba de leer, no unas
  // propias: el proyecto puede haberlas renombrado en su configuración.
  function labelOf(name, fallback) {
    var el = form.querySelector('label[for="' + name + '"]');
    if (!el) return fallback;
    return el.textContent.replace(/\s*\*\s*$/, '').trim() || fallback;
  }

  function addRow(list, label, value) {
    if (!value) return;
    var row = document.createElement('div');
    row.className = 'collab-review__row';
    var term = document.createElement('span');
    term.className = 'collab-review__label';
    term.textContent = label;
    var text = document.createElement('p');
    text.textContent = value;
    row.appendChild(term);
    row.appendChild(text);
    list.appendChild(row);
  }

  // El resumen se arma con textContent: nada de lo que escriba el visitante
  // se interpreta como HTML.
  function buildReview() {
    if (!review) return;
    review.innerHTML = '';
    var intro = document.createElement('p');
    intro.className = 'field-help';
    intro.textContent = T('collab.reviewHelp');
    review.appendChild(intro);

    var name = [valueOf('firstName'), valueOf('lastName')].filter(Boolean).join(' ');
    addRow(review, T('collab.reviewName'), name);
    addRow(review, labelOf('birthDate', T('collab.reviewBirthDate')), valueOf('birthDate'));
    addRow(review, labelOf('whatsappPhone', 'WhatsApp'), valueOf('whatsappPhone'));
    addRow(review, labelOf('email', T('collab.reviewEmail')), valueOf('email'));
    addRow(review, T('collab.reviewWhereYouLive'), [valueOf('city'), valueOf('country')].filter(Boolean).join(', '));
    addRow(review, T('collab.reviewContactPreference'), selectedText('contactPreference'));
    addRow(review, T('collab.reviewSkills'), checkedLabels('skillIds').join(' · '));
    addRow(review, labelOf('experience', T('collab.reviewExperience')), valueOf('experience'));
    addRow(review, T('collab.reviewLinks'), linkSummary().join('\n'));
    addRow(review, T('collab.reviewAreas'), checkedLabels('areaIds').join(' · '));
    addRow(review, labelOf('contributionText', T('collab.reviewContribution')), valueOf('contributionText'));
    addRow(review, labelOf('availability', T('collab.reviewAvailability')), valueOf('availability'));
    addRow(review, labelOf('idea', T('collab.reviewIdea')), valueOf('idea'));
    addRow(review, labelOf('ideaReason', T('collab.reviewIdeaReason')), valueOf('ideaReason'));
    addRow(review, labelOf('wantsToImplement', T('collab.reviewWantsToImplement')), selectedText('wantsToImplement'));

    if (review.children.length === 1) {
      var empty = document.createElement('p');
      empty.className = 'field-help';
      empty.textContent = T('collab.reviewEmpty');
      review.appendChild(empty);
    }
  }

  function show(step) {
    current = Math.min(Math.max(step, 1), total);
    panels.forEach(function (panel, index) {
      panel.hidden = index + 1 !== current;
    });
    tabs.forEach(function (tab, index) {
      tab.classList.toggle('is-current', index + 1 === current);
      tab.classList.toggle('is-done', index + 1 < current);
    });
    if (prevBtn) prevBtn.disabled = current === 1;
    if (nextBtn) nextBtn.hidden = current === total;
    if (statusEl) statusEl.textContent = T('collab.stepOf', { n: current, total: total });
    if (current === total) buildReview();
    var panel = panelOf(current);
    if (panel) {
      var focusable = panel.querySelector('input, textarea, select, button');
      if (focusable) focusable.focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  // La validación nativa del navegador se respeta paso a paso: no se avanza
  // dejando atrás un campo obligatorio vacío.
  function stepIsValid() {
    var panel = panelOf(current);
    if (!panel) return true;
    var fields = panel.querySelectorAll('input, textarea, select');
    for (var i = 0; i < fields.length; i++) {
      if (!fields[i].checkValidity()) { fields[i].reportValidity(); return false; }
    }
    // Grupos de casillas que el proyecto marcó como obligatorios: `required`
    // en una casilla suelta exigiría esa casilla concreta, no una cualquiera.
    var groups = panel.querySelectorAll('[data-require-one]');
    for (var g = 0; g < groups.length; g++) {
      var name = groups[g].dataset.requireOne;
      if (panel.querySelector('input[name="' + name + '"]:checked')) continue;
      var first = groups[g].querySelector('input[type="checkbox"]');
      if (!first) continue;
      first.setCustomValidity(T('collab.chooseOne'));
      first.reportValidity();
      first.setCustomValidity('');
      return false;
    }
    return true;
  }

  if (nextBtn) nextBtn.addEventListener('click', function () { if (stepIsValid()) show(current + 1); });
  if (prevBtn) prevBtn.addEventListener('click', function () { show(current - 1); });

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () {
      var target = index + 1;
      if (target <= current || stepIsValid()) show(target);
    });
  });

  // Enter dentro de un campo avanza de paso en lugar de enviar a medias.
  form.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA') return;
    if (current === total) return;
    event.preventDefault();
    if (stepIsValid()) show(current + 1);
  });

  show(1);
}());
