// Admin — CRUD de actividades vía fetch, sin recargar la página.
(function () {
  'use strict';

  var statusGlyph = {
    pending: '<i data-lucide="circle"></i>',
    in_progress: '<i data-lucide="loader-circle"></i>',
    completed: '<i data-lucide="circle-check-big"></i>',
  };
  // Los textos llegan traducidos del servidor (ver i18n-client.js).
  var i18n = window.HerraI18n || { t: function (key) { return key; } };
  var T = i18n.t;
  function statusLabelOf(status) { return T('status.' + status); }

  var statusEl = document.getElementById('adminStatus');
  var form = document.getElementById('createForm');
  var userForm = document.getElementById('userForm');
  var accessCodeDialog = document.getElementById('accessCodeDialog');
  var accessCodeForm = document.getElementById('accessCodeForm');
  var categoryForm = document.getElementById('categoryForm');
  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  // Todos los paneles administrativos usan el <dialog> nativo. Centralizar
  // apertura y cierre evita que una acción deje un panel inline oculto tras
  // haber cambiado la plantilla a modal, y mantiene el scroll del roadmap
  // bloqueado mientras haya una ventana en la capa superior.
  function syncModalState() {
    var open = document.querySelectorAll('dialog.modal[open]').length > 0;
    document.documentElement.classList.toggle('has-modal', open);
    document.body.classList.toggle('has-modal', open);
  }

  function openModal(dialog, trigger) {
    if (!dialog) return false;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    syncModalState();
    window.setTimeout(function () {
      var focusable = dialog.querySelector('[autofocus], input:not([type="hidden"]), select, textarea, button:not(.modal__close)');
      if (focusable) focusable.focus();
    }, 0);
    return true;
  }

  function closeModal(dialog) {
    if (!dialog || !dialog.open) return;
    var triggerId = dialog.id;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    if (triggerId) {
      document.querySelectorAll('[data-open="' + triggerId + '"]').forEach(function (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      });
    }
    syncModalState();
  }

  function setToolbarCount(panelId, label, count) {
    var trigger = document.querySelector('[data-open="' + panelId + '"]');
    if (!trigger) return;
    var labelEl = trigger.querySelector('[data-btn-label]');
    var labelTextEl = labelEl && labelEl.querySelector('[data-btn-label-text]');
    var countEl = trigger.querySelector('[data-btn-count]');
    if (labelTextEl) labelTextEl.textContent = label;
    else if (labelEl) labelEl.textContent = label;
    else if (!countEl) trigger.textContent = label + (count ? ' (' + count + ')' : '');
    if (countEl) {
      countEl.textContent = count;
      countEl.hidden = !count;
    }
  }

  document.addEventListener('click', function (e) {
    var openTrigger = e.target.closest ? e.target.closest('[data-open]') : null;
    if (openTrigger) {
      var dialog = document.getElementById(openTrigger.dataset.open);
      if (dialog && dialog.tagName === 'DIALOG') {
        e.preventDefault();
        openModal(dialog, openTrigger);
        return;
      }
    }
    var closeTrigger = e.target.closest ? e.target.closest('[data-modal-close], [data-close]') : null;
    if (closeTrigger) {
      var closeDialog = closeTrigger.closest('dialog');
      if (!closeDialog && closeTrigger.dataset.close) closeDialog = document.getElementById(closeTrigger.dataset.close);
      if (closeDialog && closeDialog.tagName === 'DIALOG') {
        e.preventDefault();
        closeModal(closeDialog);
      }
    }
  });

  document.querySelectorAll('dialog.modal').forEach(function (dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) closeModal(dialog);
    });
    dialog.addEventListener('close', syncModalState);
    dialog.addEventListener('cancel', function () { window.setTimeout(syncModalState, 0); });
  });
  document.addEventListener('close', function (e) {
    var dialog = e.target;
    if (!dialog || dialog.tagName !== 'DIALOG') return;
    if (dialog.id) {
      document.querySelectorAll('[data-open="' + dialog.id + '"]').forEach(function (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      });
      var taskId = /^edit-(.+)$/.exec(dialog.id);
      if (taskId) {
        var editTrigger = document.querySelector('[data-action="toggle-edit"][data-id="' + taskId[1] + '"]');
        if (editTrigger) editTrigger.classList.remove('is-active');
      }
    }
    syncModalState();
  }, true);
  document.addEventListener('cancel', function () { window.setTimeout(syncModalState, 0); }, true);

  // La URL de la API sale del proyecto activo, no del src del script
  // (que vive bajo /static, compartido por todos los proyectos).
  function apiBase() {
    // El servidor entrega la URL completa porque una base vacía es válida:
    // corresponde al proyecto configurado en la raíz del dominio. Antes se
    // comprobaba `projectBase` por truthiness y, en ese caso, el script
    // terminaba aquí sin registrar edición, guardado ni drag-and-drop.
    var adminApiBase = document.body.dataset.adminApiBase;
    return typeof adminApiBase === 'string' && adminApiBase !== '' ? adminApiBase : null;
  }

  function usersApiBase() {
    return apiBase();
  }

  function msg(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', !!isError);
    window.setTimeout(function () {
      if (statusEl.textContent === text) {
        statusEl.textContent = '';
        statusEl.classList.remove('is-error');
      }
    }, 4000);
  }

  function errText(r) {
    return r.json().then(function (j) { return (j && j.error) ? j.error : T('common.error', { status: r.status }); }, function () { return T('common.error', { status: r.status }); });
  }

  // Lista de colaboradores conocida por el cliente, para poder regenerar los
  // checklists de responsables (por tarea y en «Nueva actividad») sin ir al
  // servidor. Arranca leyendo el checklist ya renderizado por el servidor y
  // se actualiza cada vez que renderUsers() recibe una lista nueva.
  var knownUsers = readUsersFromDom();

  function readUsersFromDom() {
    var container = document.getElementById('nt-assigned-users');
    if (!container) return [];
    return Array.prototype.map.call(container.querySelectorAll('[data-assignment-checkbox]'), function (cb) {
      var label = cb.nextElementSibling;
      return { id: Number(cb.value), name: label ? label.textContent : '' };
    });
  }

  function personDisplayName(user) {
    if (user.displayName) return user.displayName;
    var full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return full || user.name;
  }

  var SHORT_NAME_MAX = 20;

  // Para chips y resúmenes compactos: un nombre largo ("Brian Angel Gabriel
  // Garcia") se reduce a "Brian G." — primera palabra + inicial del apellido.
  function personShortName(user) {
    if (user.shortName) return user.shortName;
    var full = personDisplayName(user);
    if (full.length <= SHORT_NAME_MAX) return full;
    if (user.first_name && user.last_name) {
      var firstWord = user.first_name.trim().split(/\s+/)[0] || '';
      var lastInitial = user.last_name.trim().charAt(0);
      if (firstWord) return lastInitial ? firstWord + ' ' + lastInitial + '.' : firstWord;
    }
    // Datos venidos solo del DOM (sin first_name/last_name aparte): se
    // aproxima con la primera y última palabra del nombre ya unido.
    var words = full.split(/\s+/);
    if (words.length < 2) return full;
    return words[0] + ' ' + words[words.length - 1].charAt(0) + '.';
  }

  // Checkboxes invisibles: son el estado real (qué colaboradores quedan
  // asignados); la UI que se ve son los chips + el buscador, generados aparte
  // por renderChips()/renderResults() a partir de este mismo grupo.
  function checklistHtml(users, checkedIds, options) {
    options = options || {};
    if (!users || users.length === 0) return '';
    return users.map(function (user) {
      var id = 'assign' + (options.idPrefix || '-new') + '-' + user.id;
      var nameAttr = options.name ? ' name="' + options.name + '"' : '';
      var checked = checkedIds.indexOf(String(user.id)) >= 0 ? ' checked' : '';
      return '<label for="' + id + '">' +
        '<input type="checkbox" id="' + id + '"' + nameAttr + ' value="' + user.id + '" data-assignment-checkbox tabindex="-1"' + checked + '>' +
        '<span>' + esc(personDisplayName(user)) + '</span></label>';
    }).join('');
  }

  function checkedValues(container) {
    return Array.prototype.map.call(container.querySelectorAll('[data-assignment-checkbox]:checked'), function (cb) {
      return Number(cb.value);
    }).filter(function (value) { return value > 0; });
  }

  // ---- Selector de responsables: chips + buscador sobre el grupo de
  // checkboxes invisible (que sigue siendo la única fuente de verdad). -----

  function checkboxLabel(cb) {
    var el = cb.nextElementSibling;
    return el ? el.textContent : '';
  }

  function renderChips(picker) {
    var group = picker.querySelector('[data-assignment-group]');
    var box = picker.querySelector('[data-assignee-chips]');
    if (!group || !box) return;
    var checked = Array.prototype.filter.call(group.querySelectorAll('[data-assignment-checkbox]'), function (cb) { return cb.checked; });
    if (checked.length === 0) {
      box.innerHTML = '<span class="assignee-chips__empty">' + esc(T('admin.jsNoOwners')) + '</span>';
      return;
    }
    var shown = checked.slice(0, 5);
    var extra = checked.length - shown.length;
    box.innerHTML = shown.map(function (cb) {
      var fullLabel = checkboxLabel(cb);
      var known = knownUsers.filter(function (u) { return String(u.id) === cb.value; })[0];
      var shortLabel = known ? personShortName(known) : fullLabel;
      return '<span class="chip"><span class="chip__label" title="' + esc(fullLabel) + '">' + esc(shortLabel) + '</span>' +
        '<button type="button" class="chip__remove" data-assignee-remove data-value="' + cb.value + '" aria-label="Quitar a ' + esc(fullLabel) + '"><i data-lucide="x"></i></button></span>';
    }).join('') + (extra > 0 ? '<span class="chip chip--overflow">+' + extra + '</span>' : '');
  }

  function renderResults(picker, query) {
    var group = picker.querySelector('[data-assignment-group]');
    var results = picker.querySelector('[data-assignee-results]');
    var input = picker.querySelector('[data-assignee-search]');
    if (!group || !results) return;
    var q = query.trim().toLowerCase();
    var candidates = Array.prototype.filter.call(group.querySelectorAll('[data-assignment-checkbox]'), function (cb) {
      if (cb.checked) return false;
      return !q || checkboxLabel(cb).toLowerCase().indexOf(q) >= 0;
    });
    results.innerHTML = candidates.length
      ? candidates.map(function (cb) {
          return '<button type="button" class="assignee-result" data-assignee-pick data-value="' + cb.value + '">' + esc(checkboxLabel(cb)) + '</button>';
        }).join('')
      : '<p class="assignee-results__empty">' + esc(T('admin.jsNoMatches')) + '</p>';
    results.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
  }

  function closeResults(picker) {
    var results = picker.querySelector('[data-assignee-results]');
    var input = picker.querySelector('[data-assignee-search]');
    if (results) results.hidden = true;
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function initAssigneePickers(root) {
    (root || document).querySelectorAll('[data-assignee-picker]').forEach(renderChips);
  }

  document.addEventListener('input', function (e) {
    var input = e.target.closest ? e.target.closest('[data-assignee-search]') : null;
    if (!input) return;
    var picker = input.closest('[data-assignee-picker]');
    if (picker) renderResults(picker, input.value);
  });

  document.addEventListener('focus', function (e) {
    var input = e.target.closest ? e.target.closest('[data-assignee-search]') : null;
    if (!input) return;
    var picker = input.closest('[data-assignee-picker]');
    if (picker) renderResults(picker, input.value);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var input = e.target.closest ? e.target.closest('[data-assignee-search]') : null;
    if (!input) return;
    var picker = input.closest('[data-assignee-picker]');
    if (picker) closeResults(picker);
  });

  document.addEventListener('click', function (e) {
    var pick = e.target.closest ? e.target.closest('[data-assignee-pick]') : null;
    if (pick) {
      var picker = pick.closest('[data-assignee-picker]');
      var group = picker && picker.querySelector('[data-assignment-group]');
      var cb = group && group.querySelector('[data-assignment-checkbox][value="' + pick.dataset.value + '"]');
      if (cb) { cb.checked = true; renderChips(picker); }
      var input = picker && picker.querySelector('[data-assignee-search]');
      if (input) { input.value = ''; input.focus(); }
      if (picker) renderResults(picker, '');
      return;
    }
    var remove = e.target.closest ? e.target.closest('[data-assignee-remove]') : null;
    if (remove) {
      var picker2 = remove.closest('[data-assignee-picker]');
      var group2 = picker2 && picker2.querySelector('[data-assignment-group]');
      var cb2 = group2 && group2.querySelector('[data-assignment-checkbox][value="' + remove.dataset.value + '"]');
      if (cb2) { cb2.checked = false; renderChips(picker2); }
      return;
    }
    var withinPicker = e.target.closest ? e.target.closest('[data-assignee-picker]') : null;
    if (!withinPicker) {
      document.querySelectorAll('[data-assignee-picker]').forEach(closeResults);
    }
  });

  // ---- Render del roadmap tras cada cambio -------------------------------
  function fmtPct(p) { return Math.round(p) + '%'; }
  function fmtBar(p) { return Math.max(0, Math.min(100, p)).toFixed(2) + '%'; }

  function rerender(data) {
    // El marcador de arrastre no es una actividad y por eso no entra en el
    // selector de filas que se reconstruye más abajo. Se limpia de forma
    // explícita para que una respuesta tardía nunca deje huecos acumulados.
    document.querySelectorAll('.task-drop-placeholder').forEach(function (placeholder) { placeholder.remove(); });
    var overallPct = document.getElementById('overallPct');
    var overallText = document.querySelector('.overall-meta p');
    var overallBar = document.querySelector('.pbar-fill--overall');
    var overallWrap = document.querySelector('.pbar-overall');
    if (overallPct) overallPct.textContent = fmtPct(data.overall.percentage);
    if (overallText) overallText.textContent = data.overall.completed + ' de ' + data.overall.total + ' actividades completadas';
    if (overallBar) overallBar.style.setProperty('--fill', fmtBar(data.overall.percentage));
    if (overallWrap) overallWrap.setAttribute('aria-valuenow', String(Math.round(data.overall.percentage)));

    var createCategory = document.getElementById('nt-category');
    if (createCategory) {
      var selectedCategory = createCategory.value;
      createCategory.innerHTML = data.categories.map(function (category) {
        return '<option value="' + category.id + '"' + (String(category.id) === selectedCategory ? ' selected' : '') + '>' + esc(category.title) + '</option>';
      }).join('');
    }

    data.categories.forEach(function (cat) {
      var block = document.querySelector('[data-cat-slug="' + cat.slug + '"]');
      if (!block) return;
      var title = block.querySelector('.cat-title');
      if (title) title.textContent = cat.title;
      var titleInput = block.querySelector('[data-cat-title-input]');
      if (titleInput) titleInput.value = cat.title;
      var num = block.querySelector('.record-total');
      if (num) {
        var strong = num.querySelector('strong');
        var span = num.querySelector('span');
        if (strong) strong.textContent = fmtPct(cat.progress.percentage);
        if (span) span.textContent = cat.progress.completed + ' de ' + cat.progress.total;
      }
      var fill = block.querySelector('.pbar-fill');
      var bar = block.querySelector('.pbar');
      if (fill) fill.style.setProperty('--fill', fmtBar(cat.progress.percentage));
      if (bar) bar.setAttribute('aria-valuenow', String(Math.round(cat.progress.percentage)));

      var list = block.querySelector('.task-list');
      if (!list) return;
      list.querySelectorAll('.task:not(.task--empty)').forEach(function (li) { li.remove(); });
      var frag = document.createDocumentFragment();
      cat.tasks.forEach(function (t, index) { frag.appendChild(renderTask(t, data.categories, index, cat.tasks.length, knownUsers)); });
      var empty = list.querySelector('.task--empty');
      if (cat.tasks.length === 0) {
        if (!empty) {
          var e = document.createElement('li');
          e.className = 'task task--empty';
          e.textContent = T('admin.taskEmpty');
          frag.appendChild(e);
        }
      } else if (empty) { empty.remove(); }
      list.appendChild(frag);
      initAssigneePickers(list);
      paginateCategory(cat.slug);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Paginación por categoría ------------------------------------------
  var DEFAULT_PAGE_SIZE = 5;
  var VALID_PAGE_SIZES = [5, 10, 15, 20, 25, 'all'];
  // Sin más de 5 actividades la paginación no aporta nada: se oculta el control.
  var MIN_ITEMS_FOR_PAGINATION = 5;
  var categoryPageState = {};

  function paginationStorageKey(slug) {
    return 'herra:admin:pagination:v1:' + (document.body.dataset.projectBase || '') + ':' + slug;
  }

  function storedPageState(slug) {
    try {
      var stored = JSON.parse(window.localStorage.getItem(paginationStorageKey(slug)) || 'null');
      if (!stored || VALID_PAGE_SIZES.indexOf(stored.pageSize) < 0) return null;
      var page = Number(stored.page);
      return { pageSize: stored.pageSize, page: Number.isInteger(page) && page > 0 ? page : 1 };
    } catch (_) {
      // La paginación sigue funcionando aunque el navegador bloquee storage.
      return null;
    }
  }

  function persistPageState(slug) {
    try {
      window.localStorage.setItem(paginationStorageKey(slug), JSON.stringify(categoryPageState[slug]));
    } catch (_) {
      // Modo privado/cuota agotada: conservar al menos el estado en memoria.
    }
  }

  function pageState(slug) {
    if (!categoryPageState[slug]) {
      categoryPageState[slug] = storedPageState(slug) || { pageSize: DEFAULT_PAGE_SIZE, page: 1 };
    }
    return categoryPageState[slug];
  }

  function paginateCategory(slug) {
    var nav = document.querySelector('[data-cat-pagination][data-cat-slug="' + slug + '"]');
    var block = document.querySelector('[data-cat-slug="' + slug + '"]');
    if (!nav || !block) return;
    var list = block.querySelector('.task-list');
    if (!list) return;
    var items = Array.prototype.filter.call(list.children, function (li) {
      return li.classList.contains('task') && !li.classList.contains('task--empty');
    });
    var total = items.length;
    if (total <= MIN_ITEMS_FOR_PAGINATION) {
      nav.hidden = true;
      items.forEach(function (li) { li.hidden = false; });
      return;
    }
    nav.hidden = false;
    var state = pageState(slug);
    var pageSize = state.pageSize === 'all' ? total : state.pageSize;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    persistPageState(slug);
    var start = (state.page - 1) * pageSize;
    var end = start + pageSize;
    items.forEach(function (li, i) { li.hidden = !(i >= start && i < end); });
    var status = nav.querySelector('[data-page-status]');
    if (status) status.textContent = T('admin.jsPageOf', { n: state.page, total: totalPages, items: total });
    var prev = nav.querySelector('[data-page-prev]');
    var next = nav.querySelector('[data-page-next]');
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= totalPages;
    var sizeSelect = nav.querySelector('[data-page-size]');
    if (sizeSelect && sizeSelect.value !== String(state.pageSize)) sizeSelect.value = String(state.pageSize);
  }

  function initPagination() {
    document.querySelectorAll('[data-cat-pagination]').forEach(function (nav) {
      paginateCategory(nav.dataset.catSlug);
    });
  }

  document.addEventListener('change', function (e) {
    var select = e.target.closest ? e.target.closest('[data-page-size]') : null;
    if (!select) return;
    var nav = select.closest('[data-cat-pagination]');
    if (!nav) return;
    var slug = nav.dataset.catSlug;
    var state = pageState(slug);
    state.pageSize = select.value === 'all' ? 'all' : Number(select.value);
    state.page = 1;
    persistPageState(slug);
    paginateCategory(slug);
  });

  document.addEventListener('click', function (e) {
    var prevBtn = e.target.closest ? e.target.closest('[data-page-prev]') : null;
    var nextBtn = e.target.closest ? e.target.closest('[data-page-next]') : null;
    var pageBtn = prevBtn || nextBtn;
    if (!pageBtn) return;
    e.preventDefault();
    var nav = pageBtn.closest('[data-cat-pagination]');
    if (!nav) return;
    var slug = nav.dataset.catSlug;
    var state = pageState(slug);
    state.page += prevBtn ? -1 : 1;
    persistPageState(slug);
    paginateCategory(slug);
  });

  // Burbuja de responsables (mismo elemento «popper» que el roadmap público):
  // un botón con conteo que despliega la lista completa al pasar el cursor,
  // enfocar con teclado o tocar en móvil.
  function assigneeBubbleHtml(assignedUsers) {
    if (!assignedUsers || assignedUsers.length === 0) return '<span class="task-assignee">' + esc(T('admin.taskUnassigned')) + '</span>';
    var shown = assignedUsers.slice(0, 5);
    var extra = assignedUsers.length - shown.length;
    var label = assignedUsers.length + ' responsable' + (assignedUsers.length === 1 ? '' : 's') + ', ver lista';
    var popover = shown.map(function (u) { return '<p>' + esc(personShortName(u)) + '</p>'; }).join('') +
      (extra > 0 ? '<p class="assignee-popover__more">' + (extra === 1 ? 'Y otro colaborador' : 'Y otros ' + extra + ' colaboradores') + '</p>' : '');
    return '<span class="assignee">' +
      '<button type="button" class="assignee-bubble" data-assignee-toggle aria-expanded="false" aria-label="' + esc(label) + '">' +
      '<i data-lucide="user" class="assignee-icon"></i>' +
      '<span class="assignee-count">' + assignedUsers.length + '</span>' +
      '</button>' +
      '<div class="assignee-popover" role="tooltip">' + popover + '</div>' +
      '</span>';
  }

  // Clic/toque alterna el popover de responsables (hover/foco ya lo muestra
  // en escritorio vía CSS); un clic fuera de la burbuja lo cierra.
  document.addEventListener('click', function (event) {
    var toggle = event.target.closest ? event.target.closest('[data-assignee-toggle]') : null;
    document.querySelectorAll('.assignee.is-open').forEach(function (open) {
      if (!toggle || open !== toggle.closest('.assignee')) {
        open.classList.remove('is-open');
        var btn = open.querySelector('[data-assignee-toggle]');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });
    if (!toggle) return;
    var wrap = toggle.closest('.assignee');
    if (!wrap) return;
    var isOpen = wrap.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  function renderTask(t, categories, index, taskCount, users) {
    var li = document.createElement('li');
    li.className = 'task task--' + t.status;
    li.dataset.taskId = t.id;
    var opts = categories.map(function (c) {
      var sel = c.id === t.category_id ? ' selected' : '';
      return '<option value="' + c.id + '"' + sel + '>' + esc(c.title) + '</option>';
    }).join('');
    var assignedUsers = t.assigned_users || [];
    var assignedIds = assignedUsers.map(function (u) { return String(u.id); });
    li.innerHTML =
      '<div class="task-summary">' +
        '<button type="button" class="task-drag-handle" data-task-drag-handle aria-label="' + esc(T('admin.reorderTaskAria', { title: t.title })) + '" aria-describedby="task-drag-help" title="' + esc(T('admin.dragToReorder')) + '">' +
          '<i data-lucide="grip-vertical"></i><span class="visually-hidden">' + esc(T('admin.reorderTask')) + '</span>' +
        '</button>' +
        '<span class="task-glyph" aria-hidden="true">' + statusGlyph[t.status] + '</span>' +
        '<span class="task-text" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
        '<span class="task-status task-status--' + t.status + '">' + esc(statusLabelOf(t.status)) + '</span>' +
        assigneeBubbleHtml(assignedUsers) +
        '<div class="task-actions">' +
          '<button type="button" class="ctl ctl-btn ctl-pin" data-action="toggle-pin" data-id="' + t.id + '" aria-pressed="' + (t.order_pinned ? 'true' : 'false') + '" aria-label="' + esc(T(t.order_pinned ? 'admin.taskUnpinAria' : 'admin.taskPinAria')) + '" title="' + esc(T(t.order_pinned ? 'admin.taskPinnedTitle' : 'admin.taskPin')) + '"><i data-lucide="pin"></i></button>' +
          '<button type="button" class="ctl ctl-btn ctl-edit-toggle" data-action="toggle-edit" data-id="' + t.id + '" aria-expanded="false" aria-controls="edit-' + t.id + '" aria-label="' + esc(T('admin.taskEdit')) + '"><i data-lucide="pencil"></i></button>' +
          '<button type="button" class="ctl ctl-btn ctl-danger" data-action="delete" data-id="' + t.id + '" aria-label="' + esc(T('common.delete')) + '"><i data-lucide="trash-2"></i></button>' +
        '</div>' +
      '</div>' +
      '<dialog class="modal modal--lg" id="edit-' + t.id + '" aria-label="' + esc(T('admin.taskEditAria', { title: t.title })) + '">' +
        '<div class="modal__panel">' +
          '<div class="modal__head">' +
            '<div class="modal__titles"><span class="kicker">' + esc(T('admin.taskEditKicker')) + '</span><h2 class="modal__title" data-modal-title>' + esc(t.title) + '</h2></div>' +
            '<button type="button" class="modal__close" data-action="cancel-edit" data-id="' + t.id + '" aria-label="' + esc(T('common.close')) + '"><i data-lucide="x"></i></button>' +
          '</div>' +
          '<div class="modal__body task-edit">' +
            '<div class="field">' +
          '<label for="title-' + t.id + '">' + esc(T('admin.taskTitleLabel')) + '</label>' +
          '<input type="text" id="title-' + t.id + '" data-title-input data-id="' + t.id + '" value="' + esc(t.title) + '" maxlength="300">' +
        '</div>' +
        '<div class="task-edit-row">' +
          '<div class="field">' +
            '<label for="status-' + t.id + '">' + esc(T('admin.taskStatus')) + '</label>' +
            '<select id="status-' + t.id + '" class="ctl ctl-status" data-field="status" data-id="' + t.id + '">' +
              '<option value="pending"' + (t.status === 'pending' ? ' selected' : '') + '>' + esc(T('status.pending')) + '</option>' +
              '<option value="in_progress"' + (t.status === 'in_progress' ? ' selected' : '') + '>' + esc(T('status.in_progress')) + '</option>' +
              '<option value="completed"' + (t.status === 'completed' ? ' selected' : '') + '>' + esc(T('status.completed')) + '</option>' +
            '</select>' +
          '</div>' +
          '<div class="field">' +
            '<label for="cat-' + t.id + '">' + esc(T('admin.taskCategory')) + '</label>' +
            '<select id="cat-' + t.id + '" class="ctl ctl-cat" data-field="category" data-id="' + t.id + '">' + opts + '</select>' +
          '</div>' +
        '</div>' +
        '<div class="field field--wide">' +
          '<span class="field-label" id="assign-label-' + t.id + '">' + esc(T('admin.taskOwners')) + '</span>' +
          '<div class="assignee-picker" data-assignee-picker>' +
            '<div class="assignee-search">' +
              '<input type="text" class="assignee-search-input" data-assignee-search placeholder="' + esc(T('admin.taskSearchPeople')) + '" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-labelledby="assign-label-' + t.id + '">' +
              '<div class="assignee-results" data-assignee-results hidden></div>' +
            '</div>' +
            '<div class="assignee-chips" data-assignee-chips></div>' +
            '<div class="visually-hidden" data-assignment-group data-id="' + t.id + '" aria-hidden="true">' + checklistHtml(users, assignedIds, { idPrefix: '-' + t.id }) + '</div>' +
          '</div>' +
        '</div>' +
            '<div class="form-actions modal__actions">' +
          '<button type="button" class="btn btn-red btn-sm" data-action="save-task" data-id="' + t.id + '">' + esc(T('common.saveChanges')) + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-edit" data-id="' + t.id + '">' + esc(T('common.cancel')) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</dialog>';
    return li;
  }

  // ---- Acciones ----------------------------------------------------------

  function request(method, url, body) {
    var init = { method: method, headers: { 'Content-Type': 'application/json', 'x-crv-csrf': csrfToken } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }, function () { return { ok: r.ok, status: r.status, data: null }; });
    });
  }

  var base = apiBase();
  if (!base) return;

  // ---- Reordenamiento por arrastre ---------------------------------------
  // Pointer Events cubre mouse, trackpad y táctil sin depender del HTML5 DnD,
  // que no ofrece una experiencia consistente en móviles. El mismo tirador
  // incorpora un modo de teclado para que el orden no dependa del puntero.
  var taskDrag = null;

  // Compartido entre el arrastre de actividades y el de etapas cuando el
  // navegador carece de Pointer Events (Safari/WebViews antiguos).
  function matchingTouch(event, identifier) {
    var touches = event.changedTouches || event.touches || [];
    for (var i = 0; i < touches.length; i += 1) {
      if (touches[i].identifier === identifier) return touches[i];
    }
    return null;
  }

  function directTaskItems(list) {
    if (!list) return [];
    return Array.prototype.filter.call(list.children, function (item) {
      return item.classList && item.classList.contains('task') && item.dataset.taskId;
    });
  }

  function taskLists() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-task-dropzone]'));
  }

  function listCategoryName(list) {
    var block = list && list.closest('.cat-block');
    var title = block && block.querySelector('.cat-title');
    return title ? title.textContent.trim() : 'esta etapa';
  }

  function listPosition(list, placeholder) {
    var position = 1;
    for (var i = 0; i < list.children.length; i += 1) {
      var item = list.children[i];
      if (item === placeholder) break;
      if (item.classList && item.classList.contains('task') && item.dataset.taskId) position += 1;
    }
    return position;
  }

  function insertAtPosition(list, placeholder, position) {
    var items = directTaskItems(list);
    var before = items[Math.max(0, position - 1)];
    var empty = list.querySelector('.task--empty');
    if (before) list.insertBefore(placeholder, before);
    else if (empty) list.insertBefore(placeholder, empty);
    else list.appendChild(placeholder);
  }

  function announceTaskPosition(prefix) {
    if (!taskDrag) return;
    var position = listPosition(taskDrag.placeholder.parentNode, taskDrag.placeholder);
    var total = directTaskItems(taskDrag.placeholder.parentNode).length + 1;
    msg((prefix ? prefix + '. ' : '') + T('admin.jsTaskAt', {
      title: taskDrag.title,
      stage: listCategoryName(taskDrag.placeholder.parentNode),
      position: position,
      total: total,
    }));
  }

  function expandTaskListsForDrag() {
    document.querySelectorAll('[data-task-dropzone] .task[data-task-id][hidden]').forEach(function (item) {
      item.hidden = false;
    });
  }

  function restoreTaskPagination() {
    document.querySelectorAll('[data-task-dropzone]').forEach(function (list) {
      var block = list.closest('.cat-block');
      if (block) paginateCategory(block.dataset.catSlug);
    });
  }

  function clearDragStyles() {
    document.body.classList.remove('is-dragging-task');
    document.querySelectorAll('.task-list--admin.is-drop-target').forEach(function (list) {
      list.classList.remove('is-drop-target');
    });
  }

  function cleanupTaskDrag(restore) {
    if (!taskDrag) return;
    var state = taskDrag;
    if (state.preview) state.preview.remove();
    if (state.handle) state.handle.setAttribute('aria-pressed', 'false');
    clearDragStyles();
    if (restore && state.placeholder.isConnected) state.placeholder.replaceWith(state.task);
    taskDrag = null;
    restoreTaskPagination();
  }

  function beginTaskDrag(task, options) {
    if (taskDrag || catDrag || !task || !task.parentNode) return;
    var sourceList = task.parentNode;
    var placeholder = document.createElement('li');
    var summary = task.querySelector('.task-summary');
    var rect = summary ? summary.getBoundingClientRect() : task.getBoundingClientRect();
    var handle = task.querySelector('[data-task-drag-handle]');
    placeholder.className = 'task-drop-placeholder';
    if (options.keyboard) placeholder.setAttribute('aria-label', T('admin.jsTaskPickedHint'));
    else placeholder.setAttribute('aria-hidden', 'true');
    placeholder.tabIndex = -1;
    placeholder.style.height = Math.max(52, Math.round(rect.height)) + 'px';
    var originPosition = directTaskItems(sourceList).indexOf(task) + 1;
    taskDrag = {
      task: task,
      title: (task.querySelector('.task-text') || {}).textContent.trim(),
      sourceList: sourceList,
      sourceCategoryId: Number(sourceList.dataset.categoryId),
      originPosition: originPosition,
      placeholder: placeholder,
      handle: handle,
      keyboard: !!options.keyboard,
      pointerId: options.pointerId,
      grabX: options.clientX - rect.left,
      grabY: options.clientY - rect.top,
      preview: null,
    };
    task.replaceWith(placeholder);
    if (handle) handle.setAttribute('aria-pressed', 'true');
    expandTaskListsForDrag();
    document.body.classList.add('is-dragging-task');

    if (!options.keyboard && summary) {
      var preview = document.createElement('div');
      preview.className = 'task-drag-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.style.width = Math.round(rect.width) + 'px';
      var previewSummary = summary.cloneNode(true);
      previewSummary.querySelectorAll('button, input, select, textarea, a').forEach(function (control) { control.tabIndex = -1; });
      preview.appendChild(previewSummary);
      document.body.appendChild(preview);
      taskDrag.preview = preview;
      moveTaskPreview(options.clientX, options.clientY);
    }
    sourceList.classList.add('is-drop-target');
    if (options.keyboard) placeholder.focus();
    announceTaskPosition(T(options.keyboard ? 'admin.jsTaskPicked' : 'admin.jsDragging'));
  }

  function moveTaskPreview(clientX, clientY) {
    if (!taskDrag || !taskDrag.preview) return;
    taskDrag.preview.style.left = Math.round(clientX - taskDrag.grabX) + 'px';
    taskDrag.preview.style.top = Math.round(clientY - taskDrag.grabY) + 'px';
  }

  function dropListAtPoint(clientX, clientY) {
    var element = document.elementFromPoint(clientX, clientY);
    if (!element) return null;
    var list = element.closest ? element.closest('[data-task-dropzone]') : null;
    if (!list) {
      var block = element.closest ? element.closest('.cat-block') : null;
      list = block && block.querySelector('[data-task-dropzone]');
    }
    return list;
  }

  function movePlaceholderToPointer(clientX, clientY) {
    if (!taskDrag) return;
    var list = dropListAtPoint(clientX, clientY);
    if (!list) return;
    document.querySelectorAll('.task-list--admin.is-drop-target').forEach(function (item) {
      item.classList.toggle('is-drop-target', item === list);
    });
    var siblings = directTaskItems(list);
    var before = siblings.find(function (item) {
      var rect = item.getBoundingClientRect();
      return clientY < rect.top + (rect.height / 2);
    });
    var empty = list.querySelector('.task--empty');
    if (before) list.insertBefore(taskDrag.placeholder, before);
    else if (empty) list.insertBefore(taskDrag.placeholder, empty);
    else list.appendChild(taskDrag.placeholder);
  }

  function autoScrollDuringDrag(clientY) {
    var edge = 84;
    var speed = 0;
    if (clientY < edge) speed = -Math.ceil((edge - clientY) / 8);
    else if (clientY > window.innerHeight - edge) speed = Math.ceil((clientY - (window.innerHeight - edge)) / 8);
    if (speed) window.scrollBy(0, Math.max(-18, Math.min(18, speed)));
  }

  function commitTaskDrag() {
    if (!taskDrag) return;
    var state = taskDrag;
    var destination = state.placeholder.parentNode;
    var categoryId = Number(destination && destination.dataset.categoryId);
    var position = destination ? listPosition(destination, state.placeholder) : 0;
    var unchanged = categoryId === state.sourceCategoryId && position === state.originPosition;
    if (!destination || !categoryId || unchanged) {
      cleanupTaskDrag(true);
      if (unchanged) msg(T('admin.jsOrderUnchanged'));
      return;
    }
    if (state.preview) state.preview.remove();
    clearDragStyles();
    destination.setAttribute('aria-busy', 'true');
    msg(T('admin.jsSavingPosition'));
    request('PATCH', base + 'tasks/' + state.task.dataset.taskId, { categoryId: categoryId, position: position }).then(function (r) {
      if (!r.ok) {
        destination.removeAttribute('aria-busy');
        cleanupTaskDrag(true);
        msg(r.data && r.data.error ? r.data.error : T('admin.jsOrderSaveFailed'), true);
        return;
      }
      if (state.handle) state.handle.setAttribute('aria-pressed', 'false');
      var destinationName = listCategoryName(destination);
      destination.removeAttribute('aria-busy');
      state.placeholder.remove();
      taskDrag = null;
      if (r.data && r.data.roadmap) rerender(r.data.roadmap);
      restoreTaskPagination();
      var nextHandle = document.querySelector('.task[data-task-id="' + state.task.dataset.taskId + '"] [data-task-drag-handle]');
      if (nextHandle && state.keyboard) nextHandle.focus();
      msg(T('admin.jsTaskReordered', { stage: destinationName }));
    }, function () {
      destination.removeAttribute('aria-busy');
      cleanupTaskDrag(true);
      msg(T('admin.jsOrderNetworkError'), true);
    });
  }

  function movePlaceholderWithKeyboard(key) {
    if (!taskDrag) return;
    var list = taskDrag.placeholder.parentNode;
    var lists = taskLists();
    var listIndex = lists.indexOf(list);
    var position = listPosition(list, taskDrag.placeholder);
    var count = directTaskItems(list).length;
    var nextList = null;
    var nextPosition = position;
    if (key === 'ArrowUp') {
      if (position > 1) nextPosition = position - 1;
      else { nextList = lists[listIndex - 1]; nextPosition = nextList ? directTaskItems(nextList).length + 1 : position; }
    } else if (key === 'ArrowDown') {
      if (position <= count - 1) nextPosition = position + 1;
      else { nextList = lists[listIndex + 1]; nextPosition = nextList ? 1 : position; }
    } else if (key === 'ArrowLeft') {
      nextList = lists[listIndex - 1];
      nextPosition = nextList ? directTaskItems(nextList).length + 1 : position;
    } else if (key === 'ArrowRight') {
      nextList = lists[listIndex + 1];
      nextPosition = nextList ? directTaskItems(nextList).length + 1 : position;
    }
    var destination = nextList || list;
    insertAtPosition(destination, taskDrag.placeholder, nextPosition);
    document.querySelectorAll('.task-list--admin.is-drop-target').forEach(function (item) {
      item.classList.toggle('is-drop-target', item === destination);
    });
    announceTaskPosition(T('admin.jsNewLocation'));
  }

  function beginTaskDragFromHandle(target, point, pointerId) {
    var handle = target.closest ? target.closest('[data-task-drag-handle]') : null;
    if (!handle || taskDrag) return false;
    var task = handle.closest('.task[data-task-id]');
    if (!task) return false;
    beginTaskDrag(task, { pointerId: pointerId, clientX: point.clientX, clientY: point.clientY, keyboard: false });
    return true;
  }

  function moveTaskDragFromPoint(point, pointerId) {
    if (!taskDrag || taskDrag.keyboard || taskDrag.pointerId !== pointerId) return false;
    moveTaskPreview(point.clientX, point.clientY);
    movePlaceholderToPointer(point.clientX, point.clientY);
    autoScrollDuringDrag(point.clientY);
    return true;
  }

  function endTaskDragFromPoint(point, pointerId) {
    if (!taskDrag || taskDrag.keyboard || taskDrag.pointerId !== pointerId) return false;
    movePlaceholderToPointer(point.clientX, point.clientY);
    commitTaskDrag();
    return true;
  }

  // iOS/iPadOS modernos y Android actuales exponen Pointer Events. Para
  // WebViews y Safari antiguos mantenemos el respaldo táctil de abajo.
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      if (beginTaskDragFromHandle(event.target, event, event.pointerId)) event.preventDefault();
    });
    document.addEventListener('pointermove', function (event) {
      if (moveTaskDragFromPoint(event, event.pointerId)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerup', function (event) {
      if (endTaskDragFromPoint(event, event.pointerId)) event.preventDefault();
    });
    document.addEventListener('pointercancel', function (event) {
      if (!taskDrag || taskDrag.keyboard || event.pointerId !== taskDrag.pointerId) return;
      cleanupTaskDrag(true);
      msg(T('admin.jsReorderCancelled'));
    });
  } else {
    var lastTouchAt = 0;
    document.addEventListener('touchstart', function (event) {
      var touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      lastTouchAt = Date.now();
      if (beginTaskDragFromHandle(event.target, touch, 'touch-' + touch.identifier)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (event) {
      if (!taskDrag || taskDrag.keyboard) return;
      var touch = matchingTouch(event, Number(String(taskDrag.pointerId).replace('touch-', '')));
      if (touch && moveTaskDragFromPoint(touch, taskDrag.pointerId)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', function (event) {
      if (!taskDrag || taskDrag.keyboard) return;
      var touch = matchingTouch(event, Number(String(taskDrag.pointerId).replace('touch-', '')));
      if (touch && endTaskDragFromPoint(touch, taskDrag.pointerId)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchcancel', function () {
      if (!taskDrag || taskDrag.keyboard) return;
      cleanupTaskDrag(true);
      msg(T('admin.jsReorderCancelled'));
    });
    // Respaldo para navegadores de escritorio anteriores a Pointer Events.
    document.addEventListener('mousedown', function (event) {
      if (event.button !== 0 || Date.now() - lastTouchAt < 800) return;
      if (beginTaskDragFromHandle(event.target, event, 'mouse')) event.preventDefault();
    });
    document.addEventListener('mousemove', function (event) {
      if (moveTaskDragFromPoint(event, 'mouse')) event.preventDefault();
    });
    document.addEventListener('mouseup', function (event) {
      if (endTaskDragFromPoint(event, 'mouse')) event.preventDefault();
    });
  }

  document.addEventListener('keydown', function (event) {
    var handle = event.target.closest ? event.target.closest('[data-task-drag-handle]') : null;
    if (!taskDrag && handle && (event.key === ' ' || event.key === 'Enter')) {
      var task = handle.closest('.task[data-task-id]');
      if (!task) return;
      event.preventDefault();
      var rect = handle.getBoundingClientRect();
      beginTaskDrag(task, { keyboard: true, clientX: rect.left, clientY: rect.top });
      return;
    }
    if (!taskDrag || !taskDrag.keyboard) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      var focusHandle = taskDrag.handle;
      cleanupTaskDrag(true);
      if (focusHandle) focusHandle.focus();
      msg(T('admin.jsReorderCancelled'));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commitTaskDrag();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      movePlaceholderWithKeyboard(event.key);
    }
  });

  // ---- Reordenamiento de etapas por arrastre -----------------------------
  // Mismo patrón que el arrastre de actividades de arriba (tirador con
  // Pointer Events, marcador de posición, vista previa flotante y modo de
  // teclado): una única lista, así que solo hace falta mover arriba/abajo.
  var catDrag = null;

  function catDropzone() {
    return document.querySelector('[data-cat-dropzone]');
  }

  function directCatItems(list) {
    if (!list) return [];
    return Array.prototype.filter.call(list.children, function (item) {
      return item.classList && item.classList.contains('cat-block') && item.dataset.categoryId;
    });
  }

  function catListPosition(list, placeholder) {
    var position = 1;
    for (var i = 0; i < list.children.length; i += 1) {
      var item = list.children[i];
      if (item === placeholder) break;
      if (item.classList && item.classList.contains('cat-block') && item.dataset.categoryId) position += 1;
    }
    return position;
  }

  function insertCatAtPosition(list, placeholder, position) {
    var items = directCatItems(list);
    var before = items[Math.max(0, position - 1)];
    if (before) list.insertBefore(placeholder, before);
    else list.appendChild(placeholder);
  }

  // Las etiquetas "Fase NN" describen el orden, así que tienen que
  // renumerarse en cuanto ese orden cambia; se conserva may/minúsculas
  // porque el mismo dato se pinta distinto en la cabecera y en el modal.
  // Misma fórmula que el helper phaseLabel del servidor: numeración desde 00
  // rellenada a dos dígitos.
  function phaseLabel(index) {
    return 'Fase ' + String(index).padStart(2, '0');
  }

  function renumberCatKickers() {
    directCatItems(catDropzone()).forEach(function (block, index) {
      var label = phaseLabel(index);
      block.querySelectorAll('[data-cat-kicker]').forEach(function (kicker) {
        var isUpper = kicker.textContent === kicker.textContent.toUpperCase();
        kicker.textContent = isUpper ? label.toUpperCase() : label;
      });
    });
  }

  function announceCatPosition(prefix) {
    if (!catDrag) return;
    var list = catDrag.placeholder.parentNode;
    var position = catListPosition(list, catDrag.placeholder);
    var total = directCatItems(list).length + 1;
    msg((prefix ? prefix + '. ' : '') + T('admin.jsStageAt', { title: catDrag.title, position: position, total: total }));
  }

  function clearCatDragStyles() {
    document.body.classList.remove('is-dragging-category');
  }

  function cleanupCatDrag(restore) {
    if (!catDrag) return;
    var state = catDrag;
    if (state.preview) state.preview.remove();
    if (state.handle) state.handle.setAttribute('aria-pressed', 'false');
    clearCatDragStyles();
    if (restore && state.placeholder.isConnected) state.placeholder.replaceWith(state.block);
    catDrag = null;
  }

  function beginCatDrag(block, options) {
    if (catDrag || taskDrag || !block || !block.parentNode) return;
    var list = block.parentNode;
    var placeholder = document.createElement('div');
    var rect = block.getBoundingClientRect();
    var handle = block.querySelector('[data-cat-drag-handle]');
    placeholder.className = 'cat-drop-placeholder';
    if (options.keyboard) placeholder.setAttribute('aria-label', T('admin.jsStagePickedHint'));
    else placeholder.setAttribute('aria-hidden', 'true');
    placeholder.tabIndex = -1;
    placeholder.style.height = Math.max(96, Math.round(rect.height)) + 'px';
    var originPosition = directCatItems(list).indexOf(block) + 1;
    var titleEl = block.querySelector('.cat-title');
    catDrag = {
      block: block,
      title: titleEl ? titleEl.textContent.trim() : '',
      list: list,
      originPosition: originPosition,
      placeholder: placeholder,
      handle: handle,
      keyboard: !!options.keyboard,
      pointerId: options.pointerId,
      grabX: options.clientX - rect.left,
      grabY: options.clientY - rect.top,
      preview: null,
    };
    block.replaceWith(placeholder);
    if (handle) handle.setAttribute('aria-pressed', 'true');
    document.body.classList.add('is-dragging-category');

    var head = block.querySelector('.section-head');
    if (!options.keyboard && head) {
      var preview = document.createElement('div');
      preview.className = 'cat-drag-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.style.width = Math.round(rect.width) + 'px';
      var previewHead = head.cloneNode(true);
      previewHead.querySelectorAll('button, input, select, textarea, a').forEach(function (control) { control.tabIndex = -1; });
      preview.appendChild(previewHead);
      document.body.appendChild(preview);
      catDrag.preview = preview;
      moveCatPreview(options.clientX, options.clientY);
    }
    if (options.keyboard) placeholder.focus();
    announceCatPosition(T(options.keyboard ? 'admin.jsStagePicked' : 'admin.jsDragging'));
  }

  function moveCatPreview(clientX, clientY) {
    if (!catDrag || !catDrag.preview) return;
    catDrag.preview.style.left = Math.round(clientX - catDrag.grabX) + 'px';
    catDrag.preview.style.top = Math.round(clientY - catDrag.grabY) + 'px';
  }

  function moveCatPlaceholderToPointer(clientX, clientY) {
    if (!catDrag) return;
    var siblings = directCatItems(catDrag.list);
    var before = siblings.find(function (item) {
      var rect = item.getBoundingClientRect();
      return clientY < rect.top + (rect.height / 2);
    });
    if (before) catDrag.list.insertBefore(catDrag.placeholder, before);
    else catDrag.list.appendChild(catDrag.placeholder);
  }

  function commitCatDrag() {
    if (!catDrag) return;
    var state = catDrag;
    var list = state.placeholder.parentNode;
    var position = list ? catListPosition(list, state.placeholder) : 0;
    var unchanged = position === state.originPosition;
    if (!list || !position || unchanged) {
      cleanupCatDrag(true);
      if (unchanged) msg(T('admin.jsOrderUnchanged'));
      return;
    }
    if (state.preview) state.preview.remove();
    clearCatDragStyles();
    msg(T('admin.jsSavingPosition'));
    request('PATCH', base + 'categories/' + state.block.dataset.categoryId, { position: position }).then(function (r) {
      if (!r.ok) {
        cleanupCatDrag(true);
        msg(r.data && r.data.error ? r.data.error : T('admin.jsOrderSaveFailed'), true);
        return;
      }
      if (state.handle) state.handle.setAttribute('aria-pressed', 'false');
      state.placeholder.replaceWith(state.block);
      catDrag = null;
      renumberCatKickers();
      if (r.data && r.data.roadmap) rerender(r.data.roadmap);
      var nextHandle = state.block.querySelector('[data-cat-drag-handle]');
      if (nextHandle && state.keyboard) nextHandle.focus();
      msg(T('admin.jsStageReordered'));
    }, function () {
      cleanupCatDrag(true);
      msg(T('admin.jsOrderNetworkError'), true);
    });
  }

  function movePlaceholderWithKeyboardCat(key) {
    if (!catDrag) return;
    var position = catListPosition(catDrag.list, catDrag.placeholder);
    var count = directCatItems(catDrag.list).length;
    var nextPosition = position;
    if (key === 'ArrowUp' && position > 1) nextPosition = position - 1;
    else if (key === 'ArrowDown' && position <= count - 1) nextPosition = position + 1;
    insertCatAtPosition(catDrag.list, catDrag.placeholder, nextPosition);
    announceCatPosition(T('admin.jsNewLocation'));
  }

  function beginCatDragFromHandle(target, point, pointerId) {
    var handle = target.closest ? target.closest('[data-cat-drag-handle]') : null;
    if (!handle || catDrag || taskDrag) return false;
    var block = handle.closest('.cat-block[data-category-id]');
    if (!block) return false;
    beginCatDrag(block, { pointerId: pointerId, clientX: point.clientX, clientY: point.clientY, keyboard: false });
    return true;
  }

  function moveCatDragFromPoint(point, pointerId) {
    if (!catDrag || catDrag.keyboard || catDrag.pointerId !== pointerId) return false;
    moveCatPreview(point.clientX, point.clientY);
    moveCatPlaceholderToPointer(point.clientX, point.clientY);
    autoScrollDuringDrag(point.clientY);
    return true;
  }

  function endCatDragFromPoint(point, pointerId) {
    if (!catDrag || catDrag.keyboard || catDrag.pointerId !== pointerId) return false;
    moveCatPlaceholderToPointer(point.clientX, point.clientY);
    commitCatDrag();
    return true;
  }

  if (window.PointerEvent) {
    document.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      if (beginCatDragFromHandle(event.target, event, event.pointerId)) event.preventDefault();
    });
    document.addEventListener('pointermove', function (event) {
      if (moveCatDragFromPoint(event, event.pointerId)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerup', function (event) {
      if (endCatDragFromPoint(event, event.pointerId)) event.preventDefault();
    });
    document.addEventListener('pointercancel', function (event) {
      if (!catDrag || catDrag.keyboard || event.pointerId !== catDrag.pointerId) return;
      cleanupCatDrag(true);
      msg(T('admin.jsReorderCancelled'));
    });
  } else {
    var lastCatTouchAt = 0;
    document.addEventListener('touchstart', function (event) {
      var touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      lastCatTouchAt = Date.now();
      if (beginCatDragFromHandle(event.target, touch, 'touch-' + touch.identifier)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (event) {
      if (!catDrag || catDrag.keyboard) return;
      var touch = matchingTouch(event, Number(String(catDrag.pointerId).replace('touch-', '')));
      if (touch && moveCatDragFromPoint(touch, catDrag.pointerId)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', function (event) {
      if (!catDrag || catDrag.keyboard) return;
      var touch = matchingTouch(event, Number(String(catDrag.pointerId).replace('touch-', '')));
      if (touch && endCatDragFromPoint(touch, catDrag.pointerId)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchcancel', function () {
      if (!catDrag || catDrag.keyboard) return;
      cleanupCatDrag(true);
      msg(T('admin.jsReorderCancelled'));
    });
    document.addEventListener('mousedown', function (event) {
      if (event.button !== 0 || Date.now() - lastCatTouchAt < 800) return;
      if (beginCatDragFromHandle(event.target, event, 'mouse')) event.preventDefault();
    });
    document.addEventListener('mousemove', function (event) {
      if (moveCatDragFromPoint(event, 'mouse')) event.preventDefault();
    });
    document.addEventListener('mouseup', function (event) {
      if (endCatDragFromPoint(event, 'mouse')) event.preventDefault();
    });
  }

  document.addEventListener('keydown', function (event) {
    var handle = event.target.closest ? event.target.closest('[data-cat-drag-handle]') : null;
    if (!catDrag && handle && (event.key === ' ' || event.key === 'Enter')) {
      var block = handle.closest('.cat-block[data-category-id]');
      if (!block) return;
      event.preventDefault();
      var rect = handle.getBoundingClientRect();
      beginCatDrag(block, { keyboard: true, clientX: rect.left, clientY: rect.top });
      return;
    }
    if (!catDrag || !catDrag.keyboard) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      var focusHandle = catDrag.handle;
      cleanupCatDrag(true);
      if (focusHandle) focusHandle.focus();
      msg(T('admin.jsReorderCancelled'));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commitCatDrag();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      movePlaceholderWithKeyboardCat(event.key);
    }
  });

  function closeCategoryEditor(catBlock) {
    if (!catBlock) return;
    var editForm = catBlock.querySelector('[data-cat-title-edit]');
    closeModal(editForm);
  }

  function act(action, id, payload) {
    var p;
    switch (action) {
      case 'save-task': {
        var panel = document.getElementById('edit-' + id);
        if (!panel) return Promise.resolve();
        var titleInput = panel.querySelector('[data-title-input]');
        var title = titleInput ? titleInput.value.trim() : '';
        if (!title) { msg(T('admin.jsEmptyTitle'), true); return Promise.resolve(); }
        var statusSelect = panel.querySelector('[data-field="status"]');
        var categorySelect = panel.querySelector('[data-field="category"]');
        var assignmentGroup = panel.querySelector('[data-assignment-group]');
        p = request('PATCH', base + 'tasks/' + id, {
          title: title,
          status: statusSelect ? statusSelect.value : undefined,
          categoryId: categorySelect ? Number(categorySelect.value) : undefined,
          assignedUserIds: assignmentGroup ? checkedValues(assignmentGroup) : undefined,
        });
        break;
      }
      case 'up':
      case 'down':
        p = request('POST', base + 'tasks/' + id + '/move', { direction: action });
        break;
      case 'category-save': {
        var titleInput = document.querySelector('[data-cat-title-input][data-id="' + id + '"]');
        if (!titleInput) return Promise.resolve();
        var catBlock = titleInput.closest('.cat-block');
        var viewTitleEl = catBlock && catBlock.querySelector('.cat-title');
        var currentTitle = viewTitleEl ? viewTitleEl.textContent : '';
        var nextTitle = titleInput.value.trim();
        if (!nextTitle) { msg(T('admin.jsEmptyTitle'), true); return Promise.resolve(); }
        if (nextTitle === currentTitle) { closeCategoryEditor(catBlock); return Promise.resolve(); }
        p = request('PATCH', base + 'categories/' + id, { title: nextTitle });
        break;
      }
      case 'delete':
        if (!window.confirm(T('admin.jsConfirmDeleteTask'))) return Promise.resolve();
        p = request('DELETE', base + 'tasks/' + id);
        break;
      default:
        return Promise.resolve();
    }
    return p.then(function (r) {
      if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return false; }
      // Guardar cambios cierra el panel: es un guardado explícito y completo,
      // no un ajuste suelto — así queda claro que terminó.
      if (action === 'save-task') closeModal(document.getElementById('edit-' + id));
      if (action === 'category-save') {
        var savedInput = document.querySelector('[data-cat-title-input][data-id="' + id + '"]');
        closeCategoryEditor(savedInput && savedInput.closest('.cat-block'));
      }
      if (r.data && r.data.roadmap) rerender(r.data.roadmap);
      msg(T('common.changesSaved'));
      return true;
    }, function () { msg(T('common.networkError'), true); return false; });
  }

  // Enter guarda, Escape descarta — igual que cualquier campo editable inline.
  document.addEventListener('keydown', function (e) {
    var input = e.target.closest ? e.target.closest('[data-cat-title-input]') : null;
    if (!input) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      var editForm = input.closest('dialog[data-cat-title-edit]');
      var saveBtn = editForm && editForm.querySelector('[data-action="category-save"]');
      if (saveBtn) saveBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      var editForm2 = input.closest('dialog[data-cat-title-edit]');
      var cancelBtn = editForm2 && editForm2.querySelector('[data-action="category-cancel"]');
      if (cancelBtn) cancelBtn.click();
    }
  });

  // Delegación de eventos sobre la sección de categorías.
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el || !el.dataset.id) return;
    var action = el.dataset.action;
    if (action === 'category-delete') {
      e.preventDefault();
      if (!window.confirm(T('admin.jsConfirmDeleteStage'))) return;
      request('DELETE', base + 'categories/' + el.dataset.id).then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        window.location.reload();
      }, function () { msg(T('common.networkError'), true); });
      return;
    }
    if (action === 'toggle-edit') {
      e.preventDefault();
      var panel = document.getElementById('edit-' + el.dataset.id);
      if (!panel) return;
      openModal(panel, el);
      el.classList.add('is-active');
      return;
    }
    if (action === 'cancel-edit') {
      e.preventDefault();
      var editPanel = document.getElementById('edit-' + el.dataset.id);
      var toggleBtn = document.querySelector('[data-action="toggle-edit"][data-id="' + el.dataset.id + '"]');
      closeModal(editPanel);
      if (toggleBtn) { toggleBtn.setAttribute('aria-expanded', 'false'); toggleBtn.classList.remove('is-active'); }
      return;
    }
    if (action === 'category-edit-toggle') {
      e.preventDefault();
      var catBlockToggle = el.closest('.cat-block');
      var editFormToggle = catBlockToggle && catBlockToggle.querySelector('[data-cat-title-edit]');
      if (!editFormToggle) return;
      openModal(editFormToggle, el);
      var titleInputToggle = editFormToggle.querySelector('[data-cat-title-input]');
      if (titleInputToggle) { titleInputToggle.focus(); titleInputToggle.select(); }
      return;
    }
    if (action === 'category-cancel') {
      e.preventDefault();
      var catBlockCancel = el.closest('.cat-block');
      var titleInputCancel = catBlockCancel && catBlockCancel.querySelector('[data-cat-title-input]');
      var currentTitleCancel = catBlockCancel && catBlockCancel.querySelector('.cat-title');
      if (titleInputCancel && currentTitleCancel) titleInputCancel.value = currentTitleCancel.textContent;
      closeCategoryEditor(catBlockCancel);
      return;
    }
    if (action === 'category-save') {
      e.preventDefault();
      el.disabled = true;
      act('category-save', el.dataset.id).then(function () {
        if (el.isConnected) el.disabled = false;
      });
      return;
    }
    // Anclar / desanclar: el anclaje es lo único que exime a una actividad de
    // la regla de cola, así que se maneja desde la propia fila.
    if (action === 'toggle-pin') {
      e.preventDefault();
      var wasPinned = el.getAttribute('aria-pressed') === 'true';
      el.disabled = true;
      request('PATCH', base + 'tasks/' + el.dataset.id, { pinned: !wasPinned }).then(function (r) {
        if (el.isConnected) el.disabled = false;
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        if (r.data && r.data.roadmap) rerender(r.data.roadmap);
        msg(T(wasPinned ? 'admin.taskUnpinned' : 'admin.taskPinned'));
      }, function () {
        if (el.isConnected) el.disabled = false;
        msg(T('common.networkError'), true);
      });
      return;
    }
    if (action === 'up' || action === 'down' || action === 'delete') {
      e.preventDefault();
      act(action, el.dataset.id);
      return;
    }
    if (action === 'save-task') {
      e.preventDefault();
      el.disabled = true;
      act('save-task', el.dataset.id).then(function () {
        if (el.isConnected) el.disabled = false;
      });
    }
  });

  // Traducciones escritas junto al título en un formulario de creación. Se
  // recogen igual en «nueva actividad» y en «nueva etapa»: el idioma va en el
  // propio campo y lo vacío no viaja, para no guardar un hueco.
  function newTranslations(scope) {
    var out = {};
    scope.querySelectorAll('[data-new-translation]').forEach(function (field) {
      var value = field.value.trim();
      if (value !== '') out[field.dataset.newTranslation] = value;
    });
    return out;
  }

  // Formulario de nueva actividad.
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var payload = {
        title: String(fd.get('title') || '').trim(),
        categoryId: Number(fd.get('categoryId')),
        status: String(fd.get('status') || 'pending'),
        assignedUserIds: fd.getAll('assignedUserIds').map(function (value) { return Number(value); }).filter(function (value) { return value > 0; }),
      };
      var pos = String(fd.get('position') || '').trim();
      if (pos !== '') payload.position = Number(pos);
      payload.translations = newTranslations(form);
      request('POST', base + 'tasks', payload).then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        form.reset();
        initAssigneePickers(form);
        toggleNewForm(false);
        if (r.data && r.data.roadmap) rerender(r.data.roadmap);
        msg(T('admin.jsTaskCreated'));
      }, function () { msg(T('common.networkError'), true); });
    });
  }

  function toggleNewForm(show) {
    var box = document.getElementById('new-task-form');
    if (!box) return;
    if (show) openModal(box, document.querySelector('[data-open="new-task-form"]'));
    else closeModal(box);
  }

  // La posición viaja en el propio formulario: el botón general la deja vacía
  // (al final de la etapa) y la fila de cada etapa la fija en 1.
  function presetNewTask(categoryId, position) {
    var categorySelect = document.getElementById('nt-category');
    var positionInput = document.getElementById('nt-position');
    if (categorySelect && categoryId) categorySelect.value = String(categoryId);
    if (positionInput) positionInput.value = position ? String(position) : '';
  }

  document.addEventListener('click', function (e) {
    var addTop = e.target.closest ? e.target.closest('[data-add-task-top]') : null;
    if (addTop) {
      e.preventDefault();
      presetNewTask(addTop.dataset.categoryId, 1);
      toggleNewForm(true);
      return;
    }
    var open = e.target.closest ? e.target.closest('[data-open="new-task-form"]') : null;
    if (open) { e.preventDefault(); presetNewTask(null, 0); toggleNewForm(true); }
    var close = e.target.closest ? e.target.closest('[data-close="new-task-form"]') : null;
    if (close) { e.preventDefault(); toggleNewForm(false); }
  });

  // ---- Nueva etapa ---------------------------------------------------------
  if (categoryForm) {
    categoryForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var titleInput = categoryForm.querySelector('[name="title"]');
      if (!titleInput || !titleInput.value.trim()) return;
      request('POST', base + 'categories', {
        title: titleInput.value.trim(),
        translations: newTranslations(categoryForm),
      }).then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        window.location.reload();
      }, function () { msg(T('common.networkError'), true); });
    });
  }

  // ---- Idiomas del proyecto -------------------------------------------------
  // Se manda el objeto completo por idioma; los campos vacíos no viajan, así
  // que borrar un texto equivale a devolver ese campo al español.
  var languagesForm = document.getElementById('languagesForm');
  if (languagesForm) {
    var languagesStatus = document.getElementById('languagesStatus');

    function langMsg(text, isError) {
      if (!languagesStatus) return;
      languagesStatus.textContent = text;
      languagesStatus.classList.toggle('is-error', !!isError);
    }

    // Un idioma puede tener más de un bloque —la identidad del proyecto y los
    // textos del formulario van en pestañas distintas—, así que se acumula en
    // vez de sustituir.
    function collectTranslations() {
      var payload = {};
      languagesForm.querySelectorAll('[data-lang-group]').forEach(function (group) {
        var code = group.dataset.langGroup;
        var values = payload[code] || {};
        group.querySelectorAll('[data-i18n-field]').forEach(function (field) {
          var value = field.value.trim();
          if (value !== '') values[field.dataset.i18nField] = value;
        });
        if (Object.keys(values).length > 0) payload[code] = values;
      });
      return payload;
    }

    function saveTranslations(payload, doneText) {
      request('PUT', base + 'i18n', { i18nJson: JSON.stringify(payload) }).then(function (r) {
        if (!r.ok) { langMsg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        langMsg(doneText + ' ' + T('admin.jsReloading'));
        window.setTimeout(function () { window.location.reload(); }, 700);
      }, function () { langMsg(T('common.networkError'), true); });
    }

    languagesForm.addEventListener('submit', function (e) {
      e.preventDefault();
      saveTranslations(collectTranslations(), T('admin.jsTranslationsSaved'));
    });

    var languagesReset = languagesForm.querySelector('[data-languages-reset]');
    if (languagesReset) {
      languagesReset.addEventListener('click', function () {
        if (!window.confirm(T('admin.jsConfirmClearTranslations'))) return;
        languagesForm.querySelectorAll('[data-i18n-field]').forEach(function (field) { field.value = ''; });
        saveTranslations({}, T('admin.jsTranslationsCleared'));
      });
    }
  }

  // ---- Traducción del contenido del roadmap --------------------------------
  // Vive en la misma pantalla de Idiomas pero se guarda aparte: las etapas y
  // actividades no están en el JSON del proyecto, sino cada una en su fila.
  var contentI18nForm = document.getElementById('contentI18nForm');
  if (contentI18nForm) {
    var contentStatus = document.getElementById('contentI18nStatus');

    function contentMsg(text, isError) {
      if (!contentStatus) return;
      contentStatus.textContent = text;
      contentStatus.classList.toggle('is-error', !!isError);
    }

    // Se manda la lista entera, también lo que quedó vacío: un campo que se
    // borra tiene que borrar su traducción, no quedarse con la anterior.
    function collectContent() {
      var payload = { categories: {}, tasks: {} };
      contentI18nForm.querySelectorAll('[data-content-lang]').forEach(function (group) {
        var code = group.dataset.contentLang;
        group.querySelectorAll('[data-content-kind]').forEach(function (field) {
          var kind = field.dataset.contentKind;
          var id = field.dataset.contentId;
          if (!payload[kind][id]) payload[kind][id] = {};
          var value = field.value.trim();
          if (value !== '') payload[kind][id][code] = value;
        });
      });
      return payload;
    }

    function saveContent(payload, doneText) {
      request('PUT', base + 'content-i18n', payload).then(function (r) {
        if (!r.ok) { contentMsg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        contentMsg(doneText + ' ' + T('admin.jsReloading'));
        window.setTimeout(function () { window.location.reload(); }, 700);
      }, function () { contentMsg(T('common.networkError'), true); });
    }

    contentI18nForm.addEventListener('submit', function (e) {
      e.preventDefault();
      saveContent(collectContent(), T('admin.jsContentTranslationsSaved'));
    });

    var contentReset = contentI18nForm.querySelector('[data-content-i18n-reset]');
    if (contentReset) {
      contentReset.addEventListener('click', function () {
        if (!window.confirm(T('admin.jsConfirmClearContent'))) return;
        contentI18nForm.querySelectorAll('[data-content-kind]').forEach(function (field) { field.value = ''; });
        saveContent(collectContent(), T('admin.jsTranslationsCleared'));
      });
    }
  }

  // Pestañas de la pantalla de Idiomas. «Roadmap» tiene su propio formulario,
  // así que al llegar a esa pestaña se oculta el otro entero —barra de guardar
  // incluida— igual que hace el catálogo en la configuración del formulario.
  var langTabs = document.querySelectorAll('[data-lang-tab]');
  if (langTabs.length && languagesForm && contentI18nForm) {
    langTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var isContent = tab.dataset.langTab === 'lang-content';
        langTabs.forEach(function (other) {
          var isCurrent = other === tab;
          other.classList.toggle('is-current', isCurrent);
          other.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
          other.tabIndex = isCurrent ? 0 : -1;
          document.querySelectorAll('#' + other.dataset.langTab).forEach(function (pane) {
            pane.hidden = !isCurrent;
          });
        });
        languagesForm.hidden = isContent;
        contentI18nForm.hidden = !isContent;
      });
    });
  }

  // ---- Solicitudes pendientes ----------------------------------------------
  function renderPending(pendingUsers) {
    var list = document.getElementById('pendingList');
    if (!list) return;
    list.innerHTML = pendingUsers.length ? pendingUsers.map(function (user) {
      return '<li class="user-row" data-pending-id="' + user.id + '">' +
        '<span class="user-name">' + esc(user.name) + '</span>' +
        '<div class="user-actions">' +
        '<button type="button" class="ctl ctl-btn" data-pending-action="approve" data-id="' + user.id + '" aria-label="' + esc(T('admin.pendingApprove')) + '"><i data-lucide="check"></i></button>' +
        '<button type="button" class="ctl ctl-btn ctl-danger" data-pending-action="reject" data-id="' + user.id + '" aria-label="' + esc(T('admin.pendingReject')) + '"><i data-lucide="x"></i></button>' +
        '</div></li>';
    }).join('') : '<li class="user-empty">' + esc(T('admin.pendingEmpty')) + '</li>';
    setToolbarCount('pending-form', T('admin.pendingRequests'), pendingUsers.length);
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-pending-action]') : null;
    if (!el) return;
    e.preventDefault();
    var pendingAction = el.dataset.pendingAction;
    if (pendingAction === 'reject' && !window.confirm(T('admin.jsConfirmRejectRequest'))) return;
    request('PATCH', base + 'users/' + el.dataset.id + '/' + pendingAction).then(function (r) {
      if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
      if (r.data && r.data.pendingUsers) renderPending(r.data.pendingUsers);
      if (r.data && r.data.users) renderUsers(r.data.users);
      if (r.data && r.data.collaborations) renderCollaborations(r.data.collaborations);
      msg(T(pendingAction === 'approve' ? 'admin.jsAccountApproved' : 'admin.jsAccountRejected'));
    }, function () { msg(T('common.networkError'), true); });
  });

  // ---- Enlaces de registro --------------------------------------------------
  // Las fechas llegan como datetime UTC de SQLite («2026-09-01 04:35:29»), sin
  // zona: hay que marcarlas como UTC antes de mostrarlas en hora local.
  function parseUtc(value) {
    var s = String(value || '');
    var date = new Date(/[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    var date = parseUtc(value);
    if (!date) return String(value || '');
    try {
      return date.toLocaleString(i18n.dateLocale || 'es-VE', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (err) {
      return date.toLocaleString();
    }
  }

  // Texto de vigencia: lo que de verdad importa al repartir un enlace es
  // cuánto le queda, no la hora exacta de vencimiento.
  function remainingText(value) {
    var date = parseUtc(value);
    if (!date) return '';
    var mins = Math.round((date.getTime() - Date.now()) / 60000);
    if (mins <= 0) return 'vencido';
    if (mins === 1) return 'vence en 1 minuto';
    if (mins < 60) return 'vence en ' + mins + ' minutos';
    var hours = Math.round(mins / 60);
    return 'vence en ' + hours + (hours === 1 ? ' hora' : ' horas');
  }

  function tickInviteCountdowns() {
    document.querySelectorAll('[data-invite-countdown][data-expires]').forEach(function (el) {
      var text = remainingText(el.dataset.expires);
      el.textContent = text;
      el.classList.toggle('status-chip--rejected', text === 'vencido');
    });
  }

  function renderInvites(invites) {
    var list = document.getElementById('inviteList');
    if (!list) return;
    list.innerHTML = invites.length ? invites.map(function (invite) {
      return '<li class="user-row invite-row" data-invite-id="' + invite.id + '">' +
        '<span class="user-name"><strong>' + esc(T('admin.inviteRow', { id: invite.id })) + '</strong>' +
        '<small class="field-help">' + esc(T('admin.inviteDates', {
          created: formatDateTime(invite.created_at), expires: formatDateTime(invite.expires_at),
        })) + '</small></span>' +
        '<span class="invite-row__meta">' +
        '<span class="status-chip" data-invite-countdown data-expires="' + esc(invite.expires_at) + '"></span>' +
        '<span class="status-chip">' + esc(T('admin.inviteUses', { n: invite.use_count })) + '</span>' +
        '</span>' +
        '<div class="user-actions">' +
        '<button type="button" class="ctl ctl-btn ctl-danger" data-invite-action="revoke" data-id="' + invite.id + '" aria-label="' + esc(T('admin.inviteRevoke')) + '"><i data-lucide="link-2-off"></i></button>' +
        '</div></li>';
    }).join('') : '<li class="user-empty">' + esc(T('admin.invitesEmpty')) + '</li>';
    tickInviteCountdowns();
  }

  // Copia con doble camino: navigator.clipboard solo existe en contextos
  // seguros (https o localhost) y el panel también se usa por http en la red
  // interna, así que ahí se cae al execCommand sobre el input seleccionado.
  function copyInviteUrl(input) {
    var text = input.value;
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(input); });
    }
    return Promise.resolve(legacyCopy(input));
  }

  function legacyCopy(input) {
    try {
      input.focus();
      input.setSelectionRange(0, input.value.length);
      return document.execCommand('copy');
    } catch (err) {
      return false;
    }
  }

  var createInviteBtn = document.getElementById('createInviteBtn');
  var inviteReveal = document.getElementById('inviteReveal');
  var inviteUrl = document.getElementById('inviteUrl');
  var inviteCopyBtn = document.getElementById('inviteCopyBtn');
  var inviteCopyHint = document.getElementById('inviteCopyHint');
  var inviteRevealTimer = document.getElementById('inviteRevealTimer');
  var inviteCopyResetTimer = null;

  function setCopyState(copied, hint) {
    if (inviteCopyBtn) {
      var label = inviteCopyBtn.querySelector('.invite-copy__label');
      if (label) label.textContent = T(copied ? 'admin.jsCopied' : 'admin.copy');
      inviteCopyBtn.classList.toggle('is-copied', copied);
    }
    if (inviteCopyHint) {
      inviteCopyHint.textContent = hint;
      inviteCopyHint.classList.toggle('is-error', !copied);
    }
    window.clearTimeout(inviteCopyResetTimer);
    if (copied) {
      inviteCopyResetTimer = window.setTimeout(function () {
        var label = inviteCopyBtn && inviteCopyBtn.querySelector('.invite-copy__label');
        if (label) label.textContent = T('admin.copy');
        if (inviteCopyBtn) inviteCopyBtn.classList.remove('is-copied');
      }, 2500);
    }
  }

  if (inviteCopyBtn && inviteUrl) {
    inviteCopyBtn.addEventListener('click', function () {
      copyInviteUrl(inviteUrl).then(function (ok) {
        if (ok) setCopyState(true, T('admin.jsLinkCopied'));
        else setCopyState(false, T('admin.jsLinkCopyFailed'));
      });
    });
    // Un clic sobre el enlace lo deja seleccionado entero: si el portapapeles
    // no está disponible, copiarlo a mano sigue siendo un gesto.
    inviteUrl.addEventListener('focus', function () { inviteUrl.select(); });
    inviteUrl.addEventListener('click', function () { inviteUrl.select(); });
  }

  var inviteRevealClose = document.getElementById('inviteRevealClose');
  if (inviteRevealClose && inviteReveal) {
    inviteRevealClose.addEventListener('click', function () {
      closeModal(inviteReveal);
      if (inviteUrl) inviteUrl.value = '';
      if (inviteRevealTimer) inviteRevealTimer.removeAttribute('data-expires');
    });
  }

  if (createInviteBtn) {
    createInviteBtn.addEventListener('click', function () {
      createInviteBtn.disabled = true;
      request('POST', base + 'invites').then(function (r) {
        createInviteBtn.disabled = false;
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        if (inviteReveal && inviteUrl) {
          inviteUrl.value = r.data.url;
          openModal(inviteReveal, createInviteBtn);
          if (inviteRevealTimer) {
            inviteRevealTimer.dataset.expires = r.data.expiresAt || '';
            tickInviteCountdowns();
          }
          setCopyState(false, 'Copiando…');
          copyInviteUrl(inviteUrl).then(function (ok) {
            if (ok) setCopyState(true, T('admin.jsLinkCopiedOnce'));
            else setCopyState(false, T('admin.jsLinkSelected'));
          });
        }
        if (r.data && r.data.invites) renderInvites(r.data.invites);
        msg(T('admin.jsInviteCreated'));
      }, function () { createInviteBtn.disabled = false; msg(T('common.networkError'), true); });
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-invite-action="revoke"]') : null;
    if (!el) return;
    e.preventDefault();
    if (!window.confirm(T('admin.jsConfirmRevokeInvite'))) return;
    request('POST', base + 'invites/' + el.dataset.id + '/revoke').then(function (r) {
      if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
      if (r.data && r.data.invites) renderInvites(r.data.invites);
      msg(T('admin.jsLinkRevoked'));
    }, function () { msg(T('common.networkError'), true); });
  });

  tickInviteCountdowns();
  window.setInterval(tickInviteCountdowns, 30000);

  // ---- Configuración general del proyecto ------------------------------------
  var projectSettingsForm = document.getElementById('projectSettingsForm');
  if (projectSettingsForm) {
    projectSettingsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(projectSettingsForm);
      request('PUT', base + 'settings', {
        name: String(fd.get('name') || ''),
        visibilityMode: String(fd.get('visibilityMode') || ''),
        defaultLang: String(fd.get('defaultLang') || ''),
        acceptsApplications: fd.get('acceptsApplications') !== null,
        showLogin: fd.get('showLogin') !== null,
        visitorCounter: fd.get('visitorCounter') !== null,
      }).then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        msg(T('admin.jsGeneralSaved') + ' ' + T('admin.jsReloading'));
        window.setTimeout(function () { window.location.reload(); }, 800);
      }, function () { msg(T('common.networkError'), true); });
    });
  }

  // Poner el contador a cero es independiente de guardar la configuración: se
  // ejecuta al momento y no espera al botón de guardar, así que pregunta antes.
  var visitsResetBtn = document.getElementById('visitsResetBtn');
  if (visitsResetBtn) {
    visitsResetBtn.addEventListener('click', function () {
      if (!window.confirm(T('admin.visitsResetConfirm'))) return;
      request('DELETE', base + 'visits').then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        msg(T('admin.jsVisitsReset'));
      }, function () { msg(T('common.networkError'), true); });
    });
  }

  // ---- Tema del proyecto -----------------------------------------------------
  var themeForm = document.getElementById('themeForm');
  var themeAdvanced = document.getElementById('themeAdvanced');
  var themeJsonTextarea = document.getElementById('theme-json');

  function themeSimpleInputs() { return document.querySelectorAll('[data-theme-field]'); }

  function normalizeHexForPicker(value, fallback) {
    var v = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      return '#' + v.slice(1).split('').map(function (c) { return c + c; }).join('').toLowerCase();
    }
    return fallback;
  }

  // Solo entran al JSON los campos marcados como «Personalizar»: lo demás
  // sigue heredando del tema de la instancia, igual que con el JSON a mano.
  function buildThemeObjectFromSimple() {
    var obj = {};
    document.querySelectorAll('[data-theme-override]').forEach(function (cb) {
      if (!cb.checked) return;
      var input = document.querySelector('[data-theme-field="' + cb.dataset.themeOverride + '"]');
      if (input) obj[cb.dataset.themeOverride] = input.value;
    });
    var colors = {};
    var hasColors = false;
    document.querySelectorAll('[data-theme-color-override]').forEach(function (cb) {
      if (!cb.checked) return;
      hasColors = true;
      var hexInput = document.querySelector('[data-theme-color-hex="' + cb.dataset.themeColorOverride + '"]');
      if (hexInput) colors[cb.dataset.themeColorOverride] = hexInput.value;
    });
    if (hasColors) obj.colors = colors;
    return obj;
  }

  function applyThemeObjectToSimple(obj) {
    obj = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    themeSimpleInputs().forEach(function (input) {
      var key = input.dataset.themeField;
      var checkbox = document.querySelector('[data-theme-override="' + key + '"]');
      var has = Object.prototype.hasOwnProperty.call(obj, key);
      if (has) input.value = obj[key];
      if (checkbox) checkbox.checked = has;
    });
    var colors = (obj.colors && typeof obj.colors === 'object') ? obj.colors : {};
    document.querySelectorAll('[data-theme-color]').forEach(function (colorInput) {
      var key = colorInput.dataset.themeColor;
      var checkbox = document.querySelector('[data-theme-color-override="' + key + '"]');
      var hexInput = document.querySelector('[data-theme-color-hex="' + key + '"]');
      var has = Object.prototype.hasOwnProperty.call(colors, key);
      if (has) {
        if (hexInput) hexInput.value = colors[key];
        colorInput.value = normalizeHexForPicker(colors[key], colorInput.value);
      }
      if (checkbox) checkbox.checked = has;
    });
  }

  // Selector de color, campo hex y checkbox de «Personalizar» quedan en
  // sincronía; editar cualquiera de los dos implica querer personalizarlo.
  document.querySelectorAll('[data-theme-color]').forEach(function (colorInput) {
    colorInput.addEventListener('input', function () {
      var key = colorInput.dataset.themeColor;
      var hexInput = document.querySelector('[data-theme-color-hex="' + key + '"]');
      var checkbox = document.querySelector('[data-theme-color-override="' + key + '"]');
      if (hexInput) hexInput.value = colorInput.value;
      if (checkbox) checkbox.checked = true;
    });
  });
  document.querySelectorAll('[data-theme-color-hex]').forEach(function (hexInput) {
    hexInput.addEventListener('input', function () {
      var key = hexInput.dataset.themeColorHex;
      var colorInput = document.querySelector('[data-theme-color="' + key + '"]');
      var checkbox = document.querySelector('[data-theme-color-override="' + key + '"]');
      var normalized = normalizeHexForPicker(hexInput.value, null);
      if (colorInput && normalized) colorInput.value = normalized;
      if (checkbox) checkbox.checked = true;
    });
  });
  themeSimpleInputs().forEach(function (input) {
    input.addEventListener('input', function () {
      var checkbox = document.querySelector('[data-theme-override="' + input.dataset.themeField + '"]');
      if (checkbox) checkbox.checked = true;
    });
  });

  // El JSON avanzado manda mientras el <details> esté abierto: al abrirlo se
  // llena con el estado actual del editor simple; al cerrarlo, si es válido,
  // vuelve a repartirse sobre los campos simples.
  if (themeAdvanced && themeJsonTextarea) {
    themeAdvanced.addEventListener('toggle', function () {
      if (themeAdvanced.open) {
        themeJsonTextarea.value = JSON.stringify(buildThemeObjectFromSimple(), null, 2);
        return;
      }
      var raw = themeJsonTextarea.value.trim();
      if (raw === '') { applyThemeObjectToSimple({}); return; }
      try {
        applyThemeObjectToSimple(JSON.parse(raw));
      } catch (err) {
        msg(T('admin.jsInvalidJson'), true);
        themeAdvanced.open = true;
      }
    });
  }

  if (themeForm) {
    themeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var themeJson = (themeAdvanced && themeAdvanced.open)
        ? themeJsonTextarea.value
        : JSON.stringify(buildThemeObjectFromSimple());
      request('PUT', base + 'theme', { themeJson: themeJson }).then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        msg(T('admin.jsThemeSaved') + ' ' + T('admin.jsReloading'));
        window.setTimeout(function () { window.location.reload(); }, 800);
      }, function () { msg(T('common.networkError'), true); });
    });
  }

  // ---- Contraseña del propio administrador ------------------------------------
  var adminAccountForm = document.getElementById('adminAccountForm');
  if (adminAccountForm) {
    adminAccountForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(adminAccountForm);
      request('POST', base + 'account/password', {
        currentPassword: String(fd.get('currentPassword') || ''),
        newPassword: String(fd.get('newPassword') || ''),
      }).then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        adminAccountForm.reset();
        msg(T('admin.jsPasswordChanged'));
        window.setTimeout(function () { window.location.reload(); }, 1200);
      }, function () { msg(T('common.networkError'), true); });
    });
  }

  // ---- Colaboradores -------------------------------------------------------
  // renderUsers() se ocupa solo de los asignables: la lista visible la pinta
  // renderCollaborations(), que muestra también pendientes y rechazados.
  function renderUsers(users) {
    knownUsers = users;

    // Checklist de «Nueva actividad»: conserva lo ya marcado.
    var createGroup = document.getElementById('nt-assigned-users');
    if (createGroup) {
      var createChecked = checkedValues(createGroup).map(String);
      createGroup.innerHTML = checklistHtml(users, createChecked, { name: 'assignedUserIds' });
    }

    // Checklists de cada tarea ya renderizada en la página.
    document.querySelectorAll('[data-assignment-group]').forEach(function (group) {
      var checked = checkedValues(group).map(String);
      group.innerHTML = checklistHtml(users, checked, { idPrefix: '-' + group.dataset.id });
    });
    initAssigneePickers();
  }

  var STATUS_LABELS = {
    approved: T('admin.statusApproved'), pending: T('admin.statusPending'), rejected: T('admin.statusRejected'),
  };
  var SOURCE_LABELS = {
    self: T('admin.sourceSelf'),
    application: T('admin.sourceApplication'),
    admin: T('admin.sourceAdmin'),
  };

  // Debe coincidir con collaborationGaps() del servidor: la fila repintada tras
  // una acción no puede contradecir a la que llegó en el HTML inicial.
  function gapsOf(row) {
    if (row.person_id === null || row.person_id === undefined) return [T('gaps.profile')];
    var gaps = [];
    if (!row.person_birth_date) gaps.push(T('gaps.age'));
    if (!row.person_whatsapp_phone) gaps.push(T('gaps.whatsapp'));
    if (!row.person_experience) gaps.push(T('gaps.experience'));
    if (!row.term_count) gaps.push(T('gaps.categories'));
    if (!row.link_count) gaps.push(T('gaps.links'));
    return gaps;
  }

  function collaborationRowHtml(row) {
    var name = personDisplayName(row);
    var gaps = gapsOf(row);
    var actions = '';
    if (row.person_id) {
      actions += '<button type="button" class="ctl ctl-btn" data-person-action="edit" data-id="' + row.person_id +
        '" aria-label="' + esc(T('admin.editPersonAria', { name: name })) + '" title="' + esc(T('admin.editPersonTitle')) + '"><i data-lucide="contact-round"></i></button>';
    }
    if (row.status === 'approved') {
      actions += '<button type="button" class="ctl ctl-btn" data-user-action="edit" data-user-id="' + row.id +
        '" data-user-name="' + esc(row.name) + '" aria-label="' + esc(T('admin.editUsernameAria', { name: name })) + '" title="' + esc(T('admin.editUsernameTitle')) + '"><i data-lucide="at-sign"></i></button>' +
        '<button type="button" class="ctl ctl-btn" data-user-action="access-code" data-user-id="' + row.id +
        '" aria-label="' + esc(T('admin.resetCodeAria', { name: name })) + '" title="' + esc(T('admin.resetCodeTitle')) + '"><i data-lucide="key-round"></i></button>';
    }
    actions += '<button type="button" class="ctl" data-collaboration-action="activation" data-id="' + row.id + '">' + esc(T('admin.activationLink')) + '</button>' +
      '<button type="button" class="ctl ctl-btn ctl-danger" data-user-action="delete" data-user-id="' + row.id +
      '" aria-label="' + esc(T('admin.deleteCollabAria', { name: name })) + '" title="' + esc(T('admin.deleteCollabTitle')) + '"><i data-lucide="user-round-x"></i></button>';

    return '<li class="user-row user-row--stacked" data-collaboration-id="' + row.id + '" data-person-id="' +
      (row.person_id || '') + '" data-search="' + esc((name + ' @' + row.name + ' #' + row.id).toLowerCase()) + '">' +
      '<span class="user-name"><span class="user-name__main">' + esc(name) +
      (row.person_id ? ' <small class="field-help">' + esc(T('admin.peoplePerson', { id: row.person_id })) + '</small>' : '') + '</span>' +
      '<small class="field-help">' + esc(T('admin.peopleCollaborator', { name: row.name, id: row.id })) + '</small>' +
      '<small class="field-help"><span class="status-chip status-chip--' + esc(row.status) + '">' +
      esc(STATUS_LABELS[row.status] || row.status) + '</span> · ' + esc(SOURCE_LABELS[row.signup_source] || row.signup_source) +
      (row.admin_id ? ' · <span class="status-chip status-chip--admin">' + esc(T('admin.roleAdmin')) + '</span>' : '') + '</small>' +
      (gaps.length
        ? '<small class="profile-gaps profile-gaps--inline">' + esc(T('admin.profileIncomplete', { gaps: gaps.join(' · ') })) + '</small>'
        : '<small class="field-help">' + esc(T('admin.profileComplete')) + (row.term_labels ? ' · ' + esc(row.term_labels) : '') + '</small>') +
      '</span><div class="user-actions">' + actions + '</div>' +
      '<dialog class="modal modal--md" data-person-editor-dialog aria-label="' + esc(T('admin.editPersonAria', { name: name })) + '">' +
        '<div class="modal__panel"><div class="modal__head"><div class="modal__titles">' +
          '<span class="kicker">' + esc(T('admin.personProfileKicker')) + '</span><h2 class="modal__title" data-modal-title>' + esc(name) + '</h2>' +
          '<p class="modal__sub">' + esc(T('admin.personProfileSub')) + '</p>' +
        '</div><button type="button" class="modal__close" data-modal-close aria-label="' + esc(T('common.close')) + '"><i data-lucide="x"></i></button></div>' +
        '<div class="modal__body" data-person-editor></div></div></dialog></li>';
  }

  function renderCollaborations(rows) {
    var list = document.getElementById('collaborationList');
    if (!list) return;
    list.innerHTML = rows.length
      ? rows.map(collaborationRowHtml).join('')
      : '<li class="user-empty">' + esc(T('admin.peopleEmpty')) + '</li>';
    setToolbarCount('people-form', T('admin.people'), rows.length);
    applyCollaborationFilter();
  }

  // Filtro en el propio navegador: la lista de un proyecto cabe entera en la
  // página, así que no hace falta volver al servidor por cada tecla.
  var collaborationFilter = document.querySelector('[data-collaboration-filter]');
  var collaborationCounts = document.querySelector('[data-collaboration-counts]');
  var collaborationNoMatch = document.querySelector('[data-collaboration-nomatch]');

  function applyCollaborationFilter() {
    var list = document.getElementById('collaborationList');
    if (!list) return;
    var term = collaborationFilter ? collaborationFilter.value.trim().toLowerCase() : '';
    var rows = list.querySelectorAll('[data-collaboration-id]');
    var shown = 0;
    rows.forEach(function (row) {
      var match = !term || (row.dataset.search || '').indexOf(term) >= 0;
      row.hidden = !match;
      if (match) shown++;
    });
    if (collaborationNoMatch) collaborationNoMatch.hidden = !(term && shown === 0 && rows.length > 0);
    if (collaborationCounts) {
      collaborationCounts.textContent = term
        ? shown + ' de ' + rows.length + ' colaboradores'
        : (rows.length === 1 ? '1 colaborador' : rows.length + ' colaboradores');
    }
  }

  if (collaborationFilter) collaborationFilter.addEventListener('input', applyCollaborationFilter);
  applyCollaborationFilter();

  function userAction(action, id, name) {
    var uBase = usersApiBase();
    if (!uBase) return;
    if (action === 'delete' && !window.confirm(T('admin.jsConfirmDeleteCollab'))) return;
    if (action === 'edit') {
      name = window.prompt(T('admin.jsPromptUsername'), name || '');
      if (!name || !name.trim()) return;
      return request('PATCH', uBase + 'users/' + id, { name: name.trim() }).then(handleUsersResponse).catch(function () { msg(T('common.networkError'), true); });
    }
    if (action === 'access-code') {
      if (!accessCodeDialog || !accessCodeForm) return;
      accessCodeForm.reset();
      accessCodeForm.elements.userId.value = id;
      openModal(accessCodeDialog, null);
      return;
    }
    return request('DELETE', uBase + 'users/' + id).then(handleUsersResponse).catch(function () { msg(T('common.networkError'), true); });
  }

  function handleUsersResponse(r) {
    if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
    if (r.data && r.data.users) renderUsers(r.data.users);
    if (r.data && r.data.collaborations) renderCollaborations(r.data.collaborations);
    if (r.data && r.data.roadmap) rerender(r.data.roadmap);
    msg(T('admin.jsCollaboratorsSaved'));
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-user-action]') : null;
    if (!el) return;
    e.preventDefault();
    userAction(el.dataset.userAction, el.dataset.userId, el.dataset.userName);
  });

  if (userForm) {
    userForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstNameInput = userForm.querySelector('[name="firstName"]');
      var lastNameInput = userForm.querySelector('[name="lastName"]');
      var nameInput = userForm.querySelector('[name="name"]');
      var accessCodeInput = userForm.querySelector('[name="accessCode"]');
      var uBase = usersApiBase();
      if (!firstNameInput || !lastNameInput || !nameInput || !accessCodeInput || !uBase) return;
      request('POST', uBase + 'users', {
        firstName: firstNameInput.value.trim(),
        lastName: lastNameInput.value.trim(),
        name: nameInput.value.trim(),
        accessCode: accessCodeInput.value,
      }).then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        userForm.reset();
        renderUsers(r.data.users || []);
        renderCollaborations(r.data.collaborations || []);
        closeModal(document.getElementById('add-collaborator'));
        msg(T('admin.jsCollaboratorAdded'));
      }).catch(function () { msg(T('common.networkError'), true); });
    });
  }

  if (accessCodeForm && accessCodeDialog) {
    accessCodeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var accessCode = accessCodeForm.elements.accessCode.value;
      var confirmation = accessCodeForm.elements.accessCodeConfirm.value;
      if (accessCode !== confirmation) {
        msg(T('admin.jsCodesDoNotMatch'), true);
        accessCodeForm.elements.accessCodeConfirm.focus();
        return;
      }
      var uBase = usersApiBase();
      var id = accessCodeForm.elements.userId.value;
      if (!uBase || !id) return;
      var submit = accessCodeForm.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      request('PATCH', uBase + 'users/' + id, { accessCode: accessCode }).then(function (r) {
        if (submit) submit.disabled = false;
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        closeModal(accessCodeDialog);
        handleUsersResponse(r);
      }).catch(function () {
        if (submit) submit.disabled = false;
        msg(T('common.networkError'), true);
      });
    });
    document.addEventListener('click', function (e) {
      var close = e.target.closest ? e.target.closest('[data-close-access-code]') : null;
      if (close) closeModal(accessCodeDialog);
    });
  }

  // ---- Candidaturas -------------------------------------------------------
  var applicationList = document.getElementById('applicationList');
  var applicationResult = document.getElementById('applicationResult');
  var applicationFilters = document.getElementById('applicationFilters');
  var applicationActivationReveal = document.getElementById('applicationActivationReveal');
  var applicationActivationUrl = document.getElementById('applicationActivationUrl');
  var applicationActivationCopyBtn = document.getElementById('applicationActivationCopyBtn');
  var applicationActivationCopyHint = document.getElementById('applicationActivationCopyHint');
  var applicationActivationCopyResetTimer = null;

  // El enlace de una candidatura aceptada tiene la misma garantía que el de
  // registro: se intenta copiar al crearlo y queda un botón visible para el
  // caso en que el navegador bloquee el portapapeles.
  function setApplicationActivationCopyState(copied, hint) {
    if (applicationActivationCopyBtn) {
      var label = applicationActivationCopyBtn.querySelector('.invite-copy__label');
      if (label) label.textContent = T(copied ? 'admin.jsCopied' : 'admin.copy');
      applicationActivationCopyBtn.classList.toggle('is-copied', copied);
    }
    if (applicationActivationCopyHint) {
      applicationActivationCopyHint.textContent = hint;
      applicationActivationCopyHint.classList.toggle('is-error', !copied);
    }
    window.clearTimeout(applicationActivationCopyResetTimer);
    if (copied) {
      applicationActivationCopyResetTimer = window.setTimeout(function () {
        var label = applicationActivationCopyBtn && applicationActivationCopyBtn.querySelector('.invite-copy__label');
        if (label) label.textContent = T('admin.copy');
        if (applicationActivationCopyBtn) applicationActivationCopyBtn.classList.remove('is-copied');
      }, 2500);
    }
  }

  function showApplicationActivation(url) {
    if (!applicationActivationReveal || !applicationActivationUrl) return;
    applicationActivationUrl.value = url || '';
    openModal(applicationActivationReveal);
    setApplicationActivationCopyState(false, 'Copiando…');
    copyInviteUrl(applicationActivationUrl).then(function (ok) {
      if (ok) setApplicationActivationCopyState(true, T('admin.jsLinkCopiedOnce'));
      else setApplicationActivationCopyState(false, T('admin.jsLinkSelected'));
    });
  }

  if (applicationActivationCopyBtn && applicationActivationUrl) {
    applicationActivationCopyBtn.addEventListener('click', function () {
      copyInviteUrl(applicationActivationUrl).then(function (ok) {
        if (ok) setApplicationActivationCopyState(true, T('admin.jsLinkCopied'));
        else setApplicationActivationCopyState(false, T('admin.jsLinkCopyFailed'));
      });
    });
    applicationActivationUrl.addEventListener('focus', function () { applicationActivationUrl.select(); });
    applicationActivationUrl.addEventListener('click', function () { applicationActivationUrl.select(); });
  }

  if (applicationActivationReveal) {
    applicationActivationReveal.addEventListener('close', function () {
      if (applicationActivationUrl) applicationActivationUrl.value = '';
      setApplicationActivationCopyState(false, '');
    });
  }

  function applicationStatusLabel(status) {
    return T('appStatus.' + status) || status;
  }

  function text(tag, className, value) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined && value !== null) el.textContent = value;
    return el;
  }

  function renderApplications(applications) {
    if (!applicationList) return;
    applicationList.innerHTML = '';
    if (!applications.length) {
      applicationList.appendChild(text('li', 'user-empty', T('admin.jsNoApplicationsMatch')));
      return;
    }
    applications.forEach(function (application) {
      var li = document.createElement('li');
      li.className = 'user-row user-row--stacked';
      li.dataset.applicationId = application.id;

      var name = text('span', 'user-name', [application.first_name, application.last_name].filter(Boolean).join(' '));
      name.appendChild(text('small', 'field-help', 'Candidatura #' + application.id));
      var meta = text('small', 'field-help', applicationStatusLabel(application.status));
      if (application.term_labels) meta.textContent += ' · ' + application.term_labels;
      name.appendChild(meta);
      li.appendChild(name);

      var actions = text('div', 'user-actions');
      [['detail', T('admin.jsView'), 'ctl ctl-btn'], ['reviewing', T('admin.appsReviewing'), 'ctl'],
        ['contact', T('admin.appsContact'), 'ctl'], ['accept', T('admin.appsAccept'), 'ctl promote-btn'],
        ['rejected', T('admin.appsReject'), 'ctl ctl-danger'],
        ['archived', T('admin.appsArchive'), 'ctl ctl-btn']].forEach(function (action) {
        var button = text('button', action[2], action[1]);
        button.type = 'button';
        button.dataset.applicationAction = action[0];
        button.dataset.id = application.id;
        actions.appendChild(button);
      });
      li.appendChild(actions);
      var detailDialog = document.createElement('dialog');
      detailDialog.className = 'modal modal--lg';
      detailDialog.dataset.applicationDetailDialog = '';
      detailDialog.setAttribute('aria-label', T('admin.appsDetailAria', { id: application.id }));
      detailDialog.innerHTML = '<div class="modal__panel">' +
        '<div class="modal__head"><div class="modal__titles"><span class="kicker">CANDIDATURA #' + application.id +
        '</span><h2 class="modal__title" data-modal-title>' + esc([application.first_name, application.last_name].filter(Boolean).join(' ')) +
        '</h2></div><button type="button" class="modal__close" data-modal-close aria-label="Cerrar"><i data-lucide="x"></i></button></div>' +
        '<div class="modal__body" data-application-detail></div></div>';
      li.appendChild(detailDialog);
      applicationList.appendChild(li);
    });
  }

  function loadApplications() {
    if (!applicationFilters) return;
    var fd = new FormData(applicationFilters);
    var query = new URLSearchParams();
    if (fd.get('search')) query.set('search', String(fd.get('search')));
    if (fd.get('status')) query.set('status', String(fd.get('status')));
    request('GET', base + 'applications?' + query.toString()).then(function (r) {
      if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
      renderApplications(r.data.applications || []);
    }, function () { msg(T('common.networkError'), true); });
  }

  if (applicationFilters) {
    applicationFilters.addEventListener('submit', function (e) { e.preventDefault(); loadApplications(); });
  }

  // Detalle completo: se pide al abrirlo y no se precarga en la lista, para no
  // volcar datos de contacto de todas las candidaturas en el HTML de la página.
  function renderApplicationDetail(container, detail) {
    container.innerHTML = '';
    var application = detail.application;
    var rows = [
      [T('admin.jsContact'), [application.whatsapp_phone, application.email].filter(Boolean).join(' · ')],
      [T('admin.jsPrefers'), {
        whatsapp: 'WhatsApp', email: T('account.email'), both: T('admin.jsBothChannels'),
      }[application.contact_preference]],
      [T('admin.jsWhereTheyLive'), [application.city, application.country].filter(Boolean).join(', ')],
      [T('admin.jsBirth'), application.birth_date],
      [T('admin.jsCategories'), detail.terms.map(function (term) { return term.label; }).join(' · ')],
      [T('admin.jsExperience'), application.experience],
      [T('admin.jsWantsToContribute'), application.contribution_text],
      [T('admin.jsAvailability'), application.availability],
      [T('admin.jsIdea'), application.idea],
      [T('admin.jsWhyUseful'), application.idea_reason],
      [T('admin.jsImplementIt'), {
        yes: T('admin.jsYes'), maybe: T('admin.jsMaybe'), share_only: T('admin.jsShareOnly'),
      }[application.wants_to_implement]],
    ];
    rows.forEach(function (row) {
      if (!row[1]) return;
      var block = text('div', 'collab-review__row');
      block.appendChild(text('span', 'collab-review__label', row[0]));
      block.appendChild(text('p', null, row[1]));
      container.appendChild(block);
    });
    if (detail.links.length) {
      var links = text('div', 'collab-review__row');
      links.appendChild(text('span', 'collab-review__label', 'Enlaces'));
      detail.links.forEach(function (link) {
        var p = document.createElement('p');
        var a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.url;
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        p.appendChild(a);
        links.appendChild(p);
      });
      container.appendChild(links);
    }
    if (detail.candidates.length && application.status !== 'accepted') {
      var match = text('div', 'collab-review__row');
      match.appendChild(text('span', 'collab-review__label', T('admin.jsPossibleSamePerson')));
      detail.candidates.forEach(function (candidate) {
        var p = document.createElement('p');
        p.textContent = '#' + candidate.id + ' · ' + [candidate.first_name, candidate.last_name].filter(Boolean).join(' ');
        var button = text('button', 'ctl', T('admin.jsAcceptLinking', { id: candidate.id }));
        button.type = 'button';
        button.dataset.applicationAction = 'accept';
        button.dataset.id = application.id;
        button.dataset.personId = candidate.id;
        p.appendChild(button);
        match.appendChild(p);
      });
      container.appendChild(match);
    }
  }

  function acceptApplication(id, personId) {
    var question = personId
      ? T('admin.jsConfirmAcceptLinked', { id: personId })
      : T('admin.jsConfirmAccept');
    if (!window.confirm(question)) return;
    request('POST', base + 'applications/' + id + '/accept', personId ? { personId: personId } : {}).then(function (r) {
      if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
      showApplicationActivation(r.data.activationUrl);
      if (applicationResult) applicationResult.textContent = T('admin.jsApplicationAccepted');
      renderApplications(r.data.applications || []);
      msg(T('admin.jsApplicationAcceptedIds', { personId: r.data.personId, userId: r.data.userId }));
    }, function () { msg(T('common.networkError'), true); });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-application-action]') : null;
    if (!el) return;
    e.preventDefault();
    var action = el.dataset.applicationAction;
    var id = el.dataset.id;
    if (action === 'accept') { acceptApplication(id, el.dataset.personId ? Number(el.dataset.personId) : null); return; }
    if (action === 'detail') {
      var row = el.closest('[data-application-id]');
      var container = row ? row.querySelector('[data-application-detail]') : null;
      var detailDialog = row ? row.querySelector('[data-application-detail-dialog]') : null;
      if (!container || !detailDialog) return;
      container.innerHTML = '<p class="field-help">' + esc(T('admin.jsLoadingApplication')) + '</p>';
      openModal(detailDialog, el);
      request('GET', base + 'applications/' + id).then(function (r) {
        if (!r.ok) {
          container.innerHTML = '';
          closeModal(detailDialog);
          msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true);
          return;
        }
        renderApplicationDetail(container, r.data);
      }, function () { msg(T('common.networkError'), true); });
      return;
    }
    request('PATCH', base + 'applications/' + id + '/status', { status: action }).then(function (r) {
      if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
      renderApplications(r.data.applications || []);
      msg('Candidatura #' + id + ': ' + applicationStatusLabel(action) + '.');
    }, function () { msg(T('common.networkError'), true); });
  });

  // ---- Perfiles de persona y enlaces de activación --------------------------
  var peopleResult = document.getElementById('peopleResult');

  function field(container, label, name, value, type) {
    var wrapper = text('div', 'field');
    var id = 'person-' + name + '-' + Math.random().toString(36).slice(2, 8);
    var labelEl = text('label', null, label);
    labelEl.htmlFor = id;
    var input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    input.id = id;
    input.name = name;
    if (type !== 'textarea') input.type = type || 'text';
    input.value = value || '';
    wrapper.appendChild(labelEl);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
    return input;
  }

  function renderPersonEditor(container, profile) {
    container.innerHTML = '';
    var person = profile.person;
    var form = document.createElement('form');
    form.className = 'user-form';
    form.dataset.personForm = person.id;
    field(form, 'Nombre', 'firstName', person.first_name);
    field(form, 'Apellido', 'lastName', person.last_name);
    field(form, T('account.birthDate'), 'birthDate', person.birth_date, 'date');
    field(form, 'WhatsApp', 'whatsappPhone', person.whatsapp_phone, 'tel');
    field(form, 'Correo', 'email', person.email, 'email');
    field(form, 'Ciudad', 'city', person.city);
    field(form, T('account.country'), 'country', person.country);
    field(form, 'Experiencia', 'experience', person.experience, 'textarea');
    field(form, 'Disponibilidad', 'availability', person.availability);
    var actions = text('div', 'form-actions modal__actions');
    var save = text('button', 'btn btn-red btn-sm', T('admin.jsSaveProfile'));
    save.type = 'submit';
    actions.appendChild(save);
    form.appendChild(actions);
    container.appendChild(form);
  }

  document.addEventListener('submit', function (e) {
    var form = e.target.closest ? e.target.closest('[data-person-form]') : null;
    if (!form) return;
    e.preventDefault();
    var fd = new FormData(form);
    var body = {};
    fd.forEach(function (value, key) { body[key] = String(value); });
    request('PATCH', base + 'people/' + form.dataset.personForm, body).then(function (r) {
      if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
      msg(T('admin.jsProfileUpdated') + ' ' + T('admin.jsReloading'));
      window.setTimeout(function () { window.location.reload(); }, 800);
    }, function () { msg(T('common.networkError'), true); });
  });

  document.addEventListener('click', function (e) {
    var editBtn = e.target.closest ? e.target.closest('[data-person-action="edit"]') : null;
    if (editBtn) {
      e.preventDefault();
      var row = editBtn.closest('[data-collaboration-id]');
      var container = row ? row.querySelector('[data-person-editor]') : null;
      var editorDialog = row ? row.querySelector('[data-person-editor-dialog]') : null;
      if (!container || !editorDialog) return;
      container.innerHTML = '<p class="field-help">' + esc(T('admin.jsLoadingProfile')) + '</p>';
      openModal(editorDialog, editBtn);
      request('GET', base + 'people/' + editBtn.dataset.id).then(function (r) {
        if (!r.ok) {
          container.innerHTML = '';
          closeModal(editorDialog);
          msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true);
          return;
        }
        renderPersonEditor(container, r.data);
      }, function () { msg(T('common.networkError'), true); });
      return;
    }

    var activationBtn = e.target.closest ? e.target.closest('[data-collaboration-action="activation"]') : null;
    if (activationBtn) {
      e.preventDefault();
      if (!window.confirm(T('admin.jsConfirmActivation'))) return;
      request('POST', base + 'users/' + activationBtn.dataset.id + '/activation').then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        if (peopleResult) peopleResult.textContent = T('admin.jsActivationLinkOnce', { url: r.data.url });
      }, function () { msg(T('common.networkError'), true); });
      return;
    }

    var revokeBtn = e.target.closest ? e.target.closest('[data-activation-action="revoke"]') : null;
    if (revokeBtn) {
      e.preventDefault();
      if (!window.confirm(T('admin.jsConfirmRevokeActivation'))) return;
      request('POST', base + 'activations/' + revokeBtn.dataset.id + '/revoke').then(function (r) {
        if (!r.ok) { msg(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        var row = revokeBtn.closest('[data-activation-id]');
        if (row) row.remove();
        msg(T('admin.jsLinkRevoked'));
      }, function () { msg(T('common.networkError'), true); });
    }
  });

  // ---- Catálogo global ------------------------------------------------------
  var catalogForm = document.getElementById('catalogForm');
  var catalogResult = document.getElementById('catalogResult');

  function catalogStatus(text, isError) {
    if (!catalogResult) { msg(text, isError); return; }
    catalogResult.textContent = text;
    catalogResult.classList.toggle('is-error', Boolean(isError));
  }

  if (catalogForm) {
    catalogForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(catalogForm);
      request('POST', base + 'catalog', { type: String(fd.get('type') || ''), label: String(fd.get('label') || '') })
        .then(function (r) {
          if (!r.ok) { catalogStatus(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
          catalogStatus(r.data.existing
            ? T('admin.jsTermExisted', { label: r.data.term.label })
            : T('admin.jsTermAdded') + ' ' + T('admin.jsReloading'));
          if (!r.data.existing) window.setTimeout(function () { window.location.reload(); }, 800);
          catalogForm.reset();
        }, function () { catalogStatus(T('common.networkError'), true); });
    });
  }

  // ---- Formulario de colaboración -------------------------------------------
  var collaborateConfigForm = document.getElementById('collaborateFormConfig');
  if (collaborateConfigForm) {
    var cfgResult = document.getElementById('collaborateFormResult');
    var cfgAdvanced = document.getElementById('collaborateAdvanced');
    var cfgJson = document.getElementById('collaborate-json');

    // «Categorías» tiene su propio formulario (no puede anidarse dentro del
    // de Campos/Textos). Al llegar a esa pestaña se oculta el formulario
    // principal completo, incluida su barra de guardar, y queda solo el
    // catálogo con sus propias acciones y mensajes.
    document.querySelectorAll('[data-cfg-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var isCatalog = tab.dataset.cfgTab === 'cfg-catalog';
        document.querySelectorAll('[data-cfg-tab]').forEach(function (other) {
          var isCurrent = other === tab;
          other.classList.toggle('is-current', isCurrent);
          other.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
          other.tabIndex = isCurrent ? 0 : -1;
          var pane = document.getElementById(other.dataset.cfgTab);
          if (pane) pane.hidden = !isCurrent;
        });
        collaborateConfigForm.hidden = isCatalog;
        if (isCatalog) {
          var catalogHeading = document.getElementById('catalog-title');
          if (catalogHeading) catalogHeading.focus();
        }
      });
    });

    function cfgStatus(text, isError) {
      if (!cfgResult) { msg(text, isError); return; }
      cfgResult.textContent = text;
      cfgResult.classList.toggle('is-error', Boolean(isError));
    }

    // Marcar «Personalizar» al tocar un campo evita el error más común: escribir
    // un texto nuevo, guardar, y que no cambie nada porque faltaba la casilla.
    function autoCheck(el, selector) {
      var wrapper = el.closest('.theme-field');
      if (!wrapper) return;
      var box = wrapper.querySelector(selector);
      if (box && !box.checked) box.checked = true;
    }

    collaborateConfigForm.addEventListener('input', function (e) {
      var el = e.target;
      if (el.matches('[data-cfg-text], [data-cfg-list], [data-cfg-lines]')) autoCheck(el, '[data-cfg-override]');
      if (el.matches('[data-cfg-dict]')) autoCheck(el, '[data-cfg-dict-override]');
    });

    // Los mínimos que el servidor rechaza se avisan aquí antes de guardar: es
    // más claro que un 400 al pulsar el botón.
    var CFG_FLOORS = [
      { a: 'whatsappPhone', b: 'email', error: T('admin.jsContactRequired') },
      { a: 'experience', b: 'contributionText', error: T('admin.jsSubstanceRequired') },
    ];

    function modeOf(field) {
      var checked = collaborateConfigForm.querySelector('[data-cfg-mode="' + field + '"]:checked');
      return checked ? checked.value : 'optional';
    }

    function floorError() {
      for (var i = 0; i < CFG_FLOORS.length; i++) {
        if (modeOf(CFG_FLOORS[i].a) === 'off' && modeOf(CFG_FLOORS[i].b) === 'off') return CFG_FLOORS[i].error;
      }
      return '';
    }

    collaborateConfigForm.addEventListener('change', function (e) {
      if (!e.target.matches('[data-cfg-mode]')) return;
      var error = floorError();
      cfgStatus(error, Boolean(error));
    });

    // Solo se envía lo que difiere de los valores por defecto y está marcado
    // como personalizado: el JSON guardado se mantiene mínimo y legible.
    function buildOverrides() {
      var out = {};

      collaborateConfigForm.querySelectorAll('[data-cfg-override]').forEach(function (box) {
        if (!box.checked) return;
        var key = box.dataset.cfgOverride;
        var wrapper = box.closest('.theme-field');
        if (!wrapper) return;
        var input = wrapper.querySelector('[data-cfg-text], [data-cfg-list], [data-cfg-lines]');
        if (!input) return;
        if (input.hasAttribute('data-cfg-list')) {
          out[key] = input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        } else if (input.hasAttribute('data-cfg-lines')) {
          out[key] = input.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        } else {
          out[key] = input.value;
        }
      });

      collaborateConfigForm.querySelectorAll('[data-cfg-dict-override]').forEach(function (box) {
        if (!box.checked) return;
        var dict = box.dataset.cfgDictOverride;
        var wrapper = box.closest('.theme-field');
        if (!wrapper) return;
        var input = wrapper.querySelector('[data-cfg-dict]');
        if (!input) return;
        if (!out[dict]) out[dict] = {};
        out[dict][input.dataset.cfgKey] = input.value;
      });

      var fields = {};
      collaborateConfigForm.querySelectorAll('[data-cfg-field]').forEach(function (row) {
        var key = row.dataset.cfgField;
        fields[key] = modeOf(key);
      });
      if (Object.keys(fields).length > 0) out.fields = fields;

      var maxLinks = collaborateConfigForm.querySelector('[data-cfg-max-links]');
      if (maxLinks && maxLinks.value !== '') out.maxLinks = Number(maxLinks.value);

      return out;
    }

    collaborateConfigForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = floorError();
      if (error) { cfgStatus(error, true); return; }

      // Con el editor avanzado abierto manda el JSON, igual que en el tema: es
      // el escape para lo que el editor simple no cubre.
      var payload;
      if (cfgAdvanced && cfgAdvanced.open && cfgJson) {
        payload = cfgJson.value;
      } else {
        var overrides = buildOverrides();
        payload = Object.keys(overrides).length === 0 ? '' : JSON.stringify(overrides, null, 2);
      }

      request('PUT', base + 'collaborate-form', { collaborateJson: payload }).then(function (r) {
        if (!r.ok) { cfgStatus(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        cfgStatus(T('admin.jsFormSaved') + ' ' + T('admin.jsReloading'));
        window.setTimeout(function () { window.location.reload(); }, 800);
      }, function () { cfgStatus(T('common.networkError'), true); });
    });

    var cfgReset = collaborateConfigForm.querySelector('[data-cfg-reset]');
    if (cfgReset) {
      cfgReset.addEventListener('click', function () {
        if (!window.confirm(T('admin.jsConfirmResetForm'))) return;
        request('PUT', base + 'collaborate-form', { collaborateJson: '' }).then(function (r) {
          if (!r.ok) { cfgStatus(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
          cfgStatus(T('admin.jsFormReset') + ' ' + T('admin.jsReloading'));
          window.setTimeout(function () { window.location.reload(); }, 800);
        }, function () { cfgStatus(T('common.networkError'), true); });
      });
    }
  }

  // ---- Identidad y compartir --------------------------------------------------
  // Metadatos, imágenes de la tarjeta, redes y donación. Todo se edita contra
  // una vista previa viva: la tarjeta que se ve aquí se arma con los mismos
  // valores que acabarán en las etiquetas Open Graph de la página pública.
  var brandingDataEl = document.getElementById('brandingData');
  var brandingForm = document.getElementById('brandingForm');
  if (brandingDataEl && brandingForm) initBranding(brandingDataEl, brandingForm);

  function initBranding(dataEl, form) {
    var state = readJsonAttr(dataEl, 'brandingState', null);
    var platformList = readJsonAttr(dataEl, 'platforms', []);
    if (!state) return;

    var platforms = {};
    platformList.forEach(function (platform) { platforms[platform.key] = platform; });
    var fallbackPlatform = platforms.link || platformList[0];
    var maxSocialLinks = state.maxSocialLinks || 12;
    var statusEl = document.getElementById('brandingResult');
    var socialLinks = (state.branding.socialLinks || []).map(function (link) {
      return { platform: link.platform, url: link.url, label: link.label || '' };
    });

    function brandStatus(text, isError) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.toggle('is-error', !!isError);
    }

    function readJsonAttr(el, key, fallback) {
      try { return JSON.parse(el.dataset[key]); } catch (err) { return fallback; }
    }

    function platformOf(key) { return platforms[key] || fallbackPlatform; }

    // El SVG viene del registro del servidor, no de nada que escriba el
    // administrador: es la única parte de estas filas que se inyecta como HTML.
    function iconMarkup(key, className) {
      var platform = platformOf(key);
      if (!platform) return '';
      var presentation = platform.filled
        ? 'fill="currentColor" stroke="none"'
        : 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
      return '<svg class="' + className + '" viewBox="0 0 24 24" width="24" height="24" ' + presentation
        + ' aria-hidden="true" focusable="false">' + platform.body + '</svg>';
    }

    function detectPlatform(rawUrl) {
      var value = String(rawUrl || '').trim();
      if (value === '') return 'link';
      if (/^mailto:/i.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
      var host;
      try {
        host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value).hostname.toLowerCase();
      } catch (err) { return 'link'; }
      var bare = host.replace(/^www\./, '');
      for (var i = 0; i < platformList.length; i++) {
        var hosts = platformList[i].hosts || [];
        for (var h = 0; h < hosts.length; h++) {
          if (bare === hosts[h] || bare.slice(-(hosts[h].length + 1)) === '.' + hosts[h]) return platformList[i].key;
        }
      }
      return 'link';
    }

    // ---- Pestañas del panel ---------------------------------------------------
    // Las pestañas viven en la cabecera del modal, fuera del <form>, así que
    // se buscan en el documento y no dentro del formulario.
    function showPane(paneId) {
      document.querySelectorAll('[data-brand-tab]').forEach(function (tab) {
        var current = tab.dataset.brandTab === paneId;
        tab.classList.toggle('is-current', current);
        tab.setAttribute('aria-selected', current ? 'true' : 'false');
        var pane = document.getElementById(tab.dataset.brandTab);
        if (pane) pane.hidden = !current;
      });
    }
    document.querySelectorAll('[data-brand-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () { showPane(tab.dataset.brandTab); });
    });
    form.querySelectorAll('[data-brand-goto]').forEach(function (link) {
      link.addEventListener('click', function () { showPane(link.dataset.brandGoto); });
    });

    // ---- Lectura del formulario ------------------------------------------------
    function fieldValue(key) {
      var el = form.querySelector('[data-brand-field="' + key + '"]');
      if (!el) return '';
      return el.type === 'checkbox' ? el.checked : el.value.trim();
    }

    function donationValue(key) {
      var el = form.querySelector('[data-donation-field="' + key + '"]');
      if (!el) return key === 'enabled' ? false : '';
      return el.type === 'checkbox' ? el.checked : el.value.trim();
    }

    var defaults = state.defaults || {};

    function currentDonation() {
      return {
        enabled: Boolean(donationValue('enabled')),
        platform: String(donationValue('platform') || defaults.donation.platform),
        url: String(donationValue('url') || ''),
        label: String(donationValue('label') || '') || defaults.donation.label,
        note: String(donationValue('note') || ''),
      };
    }

    // Solo viaja lo que el proyecto cambia respecto a los valores por defecto de
    // Herra; el resto se hereda, igual que en el editor de tema. La comparación
    // es contra el valor por defecto y no contra lo publicado hoy: si fuese
    // contra lo publicado, guardar sin tocar un campo borraría su personalización.
    function buildPayload() {
      var payload = {};
      ['metaTitle', 'metaDescription', 'ogTitle', 'ogDescription', 'imageAlt', 'keywords',
        'siteUrl', 'twitterSite', 'aboutTitle', 'aboutDescription', 'aboutStatus', 'aboutScope',
        'aboutSourceUrl', 'aboutSourceLabel', 'faqTitle', 'faq1Question', 'faq1Answer',
        'faq2Question', 'faq2Answer', 'faq3Question', 'faq3Answer', 'faq4Question', 'faq4Answer',
        'supportKicker', 'supportTitle', 'supportSub'].forEach(function (key) {
        var value = String(fieldValue(key) || '');
        if (value !== (defaults[key] || '')) payload[key] = value;
      });
      var card = String(fieldValue('twitterCard') || defaults.twitterCard);
      if (card !== defaults.twitterCard) payload.twitterCard = card;
      if (fieldValue('allowIndexing') !== Boolean(defaults.allowIndexing)) {
        payload.allowIndexing = fieldValue('allowIndexing') === true;
      }
      var links = collectSocialLinks();
      if (links.length > 0) payload.socialLinks = links;
      var donation = currentDonation();
      if (donation.enabled || donation.url !== '') payload.donation = donation;
      return payload;
    }

    // ---- Vista previa de la tarjeta ---------------------------------------------
    function setAll(selector, apply) {
      form.querySelectorAll(selector).forEach(apply);
    }

    function previewHost() {
      var site = String(fieldValue('siteUrl') || '');
      if (site !== '') {
        try { return new URL(site).host; } catch (err) { /* a medio escribir */ }
      }
      return window.location.host;
    }

    function updateSharePreview() {
      var title = String(fieldValue('metaTitle') || '') || state.fallback.title;
      var description = String(fieldValue('metaDescription') || '') || state.fallback.description;
      var shareTitle = String(fieldValue('ogTitle') || '') || title;
      var shareDesc = String(fieldValue('ogDescription') || '') || description;
      var host = previewHost();
      setAll('[data-share-title]', function (el) { el.textContent = shareTitle; });
      setAll('[data-share-desc]', function (el) { el.textContent = shareDesc; });
      setAll('[data-share-host]', function (el) { el.textContent = host.toUpperCase(); });
      setAll('[data-share-url]', function (el) {
        var site = String(fieldValue('siteUrl') || '');
        el.textContent = site || (window.location.origin + document.body.dataset.projectBase + '/');
      });
      var notice = form.querySelector('[data-brand-index-notice]');
      if (notice) notice.hidden = fieldValue('allowIndexing') === true;
      updateCharCounts();
    }

    function updateCharCounts() {
      form.querySelectorAll('[data-char-count-for]').forEach(function (counter) {
        var target = document.getElementById(counter.dataset.charCountFor);
        if (!target) return;
        var ideal = Number(counter.dataset.charIdeal || 0);
        var length = target.value.trim().length;
        counter.textContent = length === 0 ? 'por defecto' : length + '/' + ideal;
        counter.classList.toggle('is-over', ideal > 0 && length > ideal);
      });
    }

    // ---- Redes sociales --------------------------------------------------------
    var socialList = form.querySelector('[data-social-list]');
    var socialEmpty = form.querySelector('[data-social-empty]');
    var socialCount = form.querySelector('[data-social-count]');
    var socialRowPreview = form.querySelector('[data-social-row-preview]');
    var socialAdd = form.querySelector('[data-social-add]');

    function collectSocialLinks() {
      if (!socialList) return [];
      return Array.prototype.map.call(socialList.querySelectorAll('[data-social-item]'), function (item) {
        return {
          platform: item.querySelector('[data-social-platform]').value,
          url: item.querySelector('[data-social-url]').value.trim(),
          label: item.querySelector('[data-social-label]').value.trim(),
        };
      }).filter(function (link) { return link.url !== ''; });
    }

    function makeButton(className, icon, label) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = '<i data-lucide="' + icon + '"></i>';
      return button;
    }

    function renderSocialItem(link) {
      var item = document.createElement('li');
      item.className = 'social-item';
      item.setAttribute('data-social-item', '');

      var mark = document.createElement('span');
      mark.className = 'social-item__mark';
      item.appendChild(mark);

      var fields = document.createElement('div');
      fields.className = 'social-item__fields';

      var select = document.createElement('select');
      select.setAttribute('data-social-platform', '');
      select.setAttribute('aria-label', 'Plataforma');
      platformList.forEach(function (platform) {
        var option = document.createElement('option');
        option.value = platform.key;
        option.textContent = platform.label;
        select.appendChild(option);
      });
      select.value = platforms[link.platform] ? link.platform : 'link';

      var url = document.createElement('input');
      url.type = 'text';
      url.setAttribute('data-social-url', '');
      url.setAttribute('aria-label', T('admin.linkUrl'));
      url.placeholder = 'https://instagram.com/tu-cuenta';
      url.maxLength = 500;
      url.value = link.url || '';

      var label = document.createElement('input');
      label.type = 'text';
      label.setAttribute('data-social-label', '');
      label.setAttribute('aria-label', 'Etiqueta (opcional)');
      label.placeholder = 'Etiqueta (opcional)';
      label.maxLength = 120;
      label.value = link.label || '';

      fields.appendChild(select);
      fields.appendChild(url);
      fields.appendChild(label);
      item.appendChild(fields);

      var actions = document.createElement('div');
      actions.className = 'social-item__actions';
      var up = makeButton('ctl ctl-btn', 'arrow-up', 'Subir');
      var down = makeButton('ctl ctl-btn', 'arrow-down', 'Bajar');
      var remove = makeButton('ctl ctl-btn ctl-danger', 'trash-2', T('admin.jsRemoveSocial'));
      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(remove);
      item.appendChild(actions);

      function paintMark() {
        mark.innerHTML = iconMarkup(select.value, 'social-link__icon');
        mark.style.color = platformOf(select.value).color;
      }
      paintMark();

      // Pegar una dirección reconocible elige la plataforma sola; elegirla a
      // mano después manda sobre la detección.
      url.addEventListener('input', function () {
        if (!select.dataset.manual) {
          select.value = detectPlatform(url.value);
          paintMark();
        }
        syncSocial();
      });
      select.addEventListener('change', function () {
        select.dataset.manual = '1';
        paintMark();
        syncSocial();
      });
      label.addEventListener('input', syncSocial);
      up.addEventListener('click', function () {
        var previous = item.previousElementSibling;
        if (previous) { socialList.insertBefore(item, previous); syncSocial(); }
      });
      down.addEventListener('click', function () {
        var next = item.nextElementSibling;
        if (next) { socialList.insertBefore(next, item); syncSocial(); }
      });
      remove.addEventListener('click', function () { item.remove(); syncSocial(); });

      return item;
    }

    function syncSocial() {
      var links = collectSocialLinks();
      var rows = socialList ? socialList.querySelectorAll('[data-social-item]').length : 0;
      if (socialEmpty) socialEmpty.hidden = rows > 0;
      if (socialCount) socialCount.textContent = rows + ' de ' + maxSocialLinks + ' redes';
      if (socialAdd) socialAdd.disabled = rows >= maxSocialLinks;
      if (!socialRowPreview) return;
      socialRowPreview.innerHTML = '';
      links.forEach(function (link) {
        var platform = platformOf(link.platform);
        var li = document.createElement('li');
        var anchor = document.createElement('span');
        anchor.className = 'social-link';
        anchor.style.setProperty('--social-brand', platform.color);
        anchor.innerHTML = '<span class="social-link__mark">' + iconMarkup(link.platform, 'social-link__icon') + '</span>';
        var name = document.createElement('span');
        name.className = 'social-link__name';
        name.textContent = link.label || platform.label;
        anchor.appendChild(name);
        li.appendChild(anchor);
        socialRowPreview.appendChild(li);
      });
    }

    if (socialList) {
      socialLinks.forEach(function (link) { socialList.appendChild(renderSocialItem(link)); });
      syncSocial();
    }
    if (socialAdd) {
      socialAdd.addEventListener('click', function () {
        if (!socialList || socialList.querySelectorAll('[data-social-item]').length >= maxSocialLinks) return;
        var item = renderSocialItem({ platform: 'link', url: '', label: '' });
        socialList.appendChild(item);
        syncSocial();
        var input = item.querySelector('[data-social-url]');
        if (input) input.focus();
      });
    }

    // ---- Vista previa del botón de donación --------------------------------------
    var donationPreview = form.querySelector('[data-donation-preview]');
    var donationNodes = null;

    // El botón se construye una vez y luego solo se le cambia el texto: volver
    // a crearlo en cada tecla reiniciaría las tres animaciones y la vista previa
    // parpadearía mientras se escribe.
    function buildDonationPreview() {
      var button = document.createElement('span');
      button.className = 'donate';
      var ring = document.createElement('span');
      ring.className = 'donate__ring';
      var body = document.createElement('span');
      body.className = 'donate__body';
      var mark = document.createElement('span');
      mark.className = 'donate__mark';
      var text = document.createElement('span');
      text.className = 'donate__label';
      var shine = document.createElement('span');
      shine.className = 'donate__shine';
      body.appendChild(mark);
      body.appendChild(text);
      body.appendChild(shine);
      button.appendChild(ring);
      button.appendChild(body);
      var note = document.createElement('p');
      note.className = 'donate-note';
      var off = document.createElement('p');
      off.className = 'field-help';
      off.textContent = T('admin.jsDonationOff');
      donationPreview.appendChild(button);
      donationPreview.appendChild(note);
      donationPreview.appendChild(off);
      return { button: button, mark: mark, text: text, note: note, off: off, platform: null };
    }

    function updateDonationPreview() {
      if (!donationPreview) return;
      if (!donationNodes) donationNodes = buildDonationPreview();
      var donation = currentDonation();
      var visible = donation.enabled && donation.url !== '';
      donationNodes.button.hidden = !visible;
      donationNodes.off.hidden = visible;
      donationNodes.note.hidden = !visible || donation.note === '';
      if (!visible) return;
      if (donationNodes.platform !== donation.platform) {
        donationNodes.platform = donation.platform;
        donationNodes.mark.innerHTML = iconMarkup(donation.platform, 'donate__glyph');
        donationNodes.button.style.setProperty('--donate-brand', platformOf(donation.platform).color);
      }
      donationNodes.text.textContent = donation.label;
      donationNodes.note.textContent = donation.note;
    }

    // ---- Imágenes ---------------------------------------------------------------
    // El navegador recorta y reduce antes de subir: el servidor recibe siempre
    // el tamaño correcto para cada uso y la base no engorda con originales de
    // varios megas.
    var ASSET_SPECS = {
      favicon: { width: 256, height: 256, type: 'image/png' },
      share_image: { width: 1200, height: 630, type: 'image/jpeg', quality: 0.86 },
    };

    function pageBackground() {
      var color = window.getComputedStyle(document.body).backgroundColor;
      return (color && color !== 'rgba(0, 0, 0, 0)') ? color : '#0a0a0a';
    }

    function renderToDataUrl(image, spec, fit) {
      var canvas = document.createElement('canvas');
      canvas.width = spec.width;
      canvas.height = spec.height;
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(T('admin.jsCanvasUnsupported'));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = pageBackground();
      ctx.fillRect(0, 0, spec.width, spec.height);
      var sw = image.naturalWidth;
      var sh = image.naturalHeight;
      if (!sw || !sh) throw new Error(T('admin.jsBadImageSize'));
      if (fit === 'contain') {
        var scale = Math.min(spec.width / sw, spec.height / sh);
        var dw = sw * scale;
        var dh = sh * scale;
        ctx.drawImage(image, 0, 0, sw, sh, (spec.width - dw) / 2, (spec.height - dh) / 2, dw, dh);
      } else {
        var cover = Math.max(spec.width / sw, spec.height / sh);
        var cw = spec.width / cover;
        var ch = spec.height / cover;
        ctx.drawImage(image, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, spec.width, spec.height);
      }
      return canvas.toDataURL(spec.type, spec.quality);
    }

    function prepareImage(file, spec, fit) {
      return new Promise(function (resolve, reject) {
        if (!/^image\/(png|jpeg|jpg|webp|gif|avif|bmp)$/i.test(file.type)) {
          reject(new Error(T('admin.jsBadImageFormat')));
          return;
        }
        if (file.size > 25 * 1024 * 1024) {
          reject(new Error(T('admin.jsImageTooBig')));
          return;
        }
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error(T('admin.jsImageUnreadable'))); };
        reader.onload = function () {
          var image = new Image();
          image.onerror = function () { reject(new Error(T('admin.jsNotAnImage'))); };
          image.onload = function () {
            try { resolve(renderToDataUrl(image, spec, fit)); } catch (err) { reject(err); }
          };
          image.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });
    }

    function kilobytes(bytes) { return Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

    function paintAsset(card, kind, asset) {
      var preview = card.querySelector('[data-asset-preview]');
      var empty = card.querySelector('[data-asset-empty]');
      var meta = card.querySelector('[data-asset-meta]');
      var remove = card.querySelector('[data-asset-remove]');
      var url = asset
        ? state.mediaBase + '/' + (kind === 'favicon' ? 'favicon' : 'share') + '?v=' + asset.checksum
        : '';
      if (preview) {
        preview.src = url;
        preview.hidden = !asset;
      }
      if (empty) empty.hidden = Boolean(asset);
      if (meta) {
        meta.textContent = asset
          ? (asset.width || '?') + '×' + (asset.height || '?') + ' px · ' + kilobytes(asset.byteSize)
          : '';
      }
      if (remove) remove.hidden = !asset;
      // Las vistas previas de la tarjeta y de la pestaña comparten la imagen.
      var selector = kind === 'favicon' ? '[data-favicon-image]' : '[data-share-image]';
      setAll(selector, function (img) { img.src = url; img.hidden = !asset; });
      if (kind === 'favicon') {
        setAll('[data-favicon-empty]', function (el) { el.hidden = Boolean(asset); });
      } else {
        setAll('[data-share-image-empty]', function (el) { el.hidden = Boolean(asset); });
      }
      state.assets[kind] = asset || undefined;
    }

    function uploadAsset(card, kind, file) {
      var spec = ASSET_SPECS[kind];
      var fitControl = card.querySelector('[data-asset-fit]');
      var fit = fitControl ? fitControl.value : 'cover';
      card.classList.add('is-busy');
      brandStatus(T('admin.jsProcessingImage'));
      prepareImage(file, spec, fit).then(function (dataUrl) {
        return request('POST', base + 'assets/' + kind, { dataUrl: dataUrl });
      }).then(function (r) {
        card.classList.remove('is-busy');
        if (!r.ok) { brandStatus(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        paintAsset(card, kind, r.data.asset);
        brandStatus(T('admin.jsImageSaved'));
      }, function (err) {
        card.classList.remove('is-busy');
        brandStatus(err && err.message ? err.message : T('admin.jsImageUploadFailed'), true);
      });
    }

    form.querySelectorAll('[data-asset-card]').forEach(function (card) {
      var kind = card.dataset.assetCard;
      var input = card.querySelector('[data-asset-input]');
      var drop = card.querySelector('[data-asset-drop]');
      var remove = card.querySelector('[data-asset-remove]');

      if (input) {
        input.addEventListener('change', function () {
          if (input.files && input.files[0]) uploadAsset(card, kind, input.files[0]);
          input.value = '';
        });
      }
      if (drop) {
        ['dragenter', 'dragover'].forEach(function (name) {
          drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
        });
        ['dragleave', 'drop'].forEach(function (name) {
          drop.addEventListener(name, function () { drop.classList.remove('is-over'); });
        });
        drop.addEventListener('drop', function (e) {
          e.preventDefault();
          var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file) uploadAsset(card, kind, file);
        });
        drop.addEventListener('keydown', function (e) {
          if ((e.key === 'Enter' || e.key === ' ') && input) { e.preventDefault(); input.click(); }
        });
      }
      if (remove) {
        remove.addEventListener('click', function () {
          if (!window.confirm(T('admin.jsConfirmRemoveImage'))) return;
          request('DELETE', base + 'assets/' + kind).then(function (r) {
            if (!r.ok) { brandStatus(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
            paintAsset(card, kind, null);
            brandStatus(T('admin.jsImageDeleted'));
          }, function () { brandStatus(T('common.networkError'), true); });
        });
      }
    });

    // ---- Guardado ---------------------------------------------------------------
    form.addEventListener('input', function () {
      updateSharePreview();
      updateDonationPreview();
    });
    form.addEventListener('change', function () {
      updateSharePreview();
      updateDonationPreview();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = buildPayload();
      request('PUT', base + 'branding', { brandingJson: JSON.stringify(payload) }).then(function (r) {
        if (!r.ok) { brandStatus(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
        brandStatus(T('admin.jsBrandSaved') + ' ' + T('admin.jsReloading'));
        window.setTimeout(function () { window.location.reload(); }, 800);
      }, function () { brandStatus(T('common.networkError'), true); });
    });

    var brandReset = form.querySelector('[data-brand-reset]');
    if (brandReset) {
      brandReset.addEventListener('click', function () {
        if (!window.confirm(T('admin.jsConfirmResetBrand'))) return;
        request('PUT', base + 'branding', { brandingJson: '' }).then(function (r) {
          if (!r.ok) { brandStatus(r.data && r.data.error ? r.data.error : T('common.error', { status: r.status }), true); return; }
          brandStatus(T('admin.jsBrandReset') + ' ' + T('admin.jsReloading'));
          window.setTimeout(function () { window.location.reload(); }, 800);
        }, function () { brandStatus(T('common.networkError'), true); });
      });
    }

    updateSharePreview();
    updateDonationPreview();
  }

  initAssigneePickers();
  initPagination();
})();
