// Roadmap público — polling ligero cada 30s para detectar cambios.
// Sin JS la página funciona igual (SSR); esto solo refresca barras y contadores.
(function () {
  'use strict';

  var POLL_MS = 30000;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function fmtPct(p) { return Math.round(p) + '%'; }
  function fmtBar(p) { return Math.max(0, Math.min(100, p)).toFixed(2) + '%'; }

  var statusGlyph = {
    pending: '<i data-lucide="circle"></i>',
    in_progress: '<i data-lucide="loader-circle"></i>',
    completed: '<i data-lucide="circle-check-big"></i>',
  };
  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  // Los textos ya vienen traducidos del servidor (ver i18n-client.js).
  var i18n = window.HerraI18n || { t: function (key) { return key; }, dateLocale: 'es-VE' };
  var T = i18n.t;
  function statusLabelOf(status) { return T('status.' + status); }
  var currentUserId = Number(document.body.dataset.currentUserId || 0);
  var canManageAllTasks = document.body.dataset.canManageAllTasks === 'true';
  var apiBase = document.body.dataset.apiBase || '/api';
  var statusEl = document.getElementById('roadmapStatus');

  // ---- Paginación independiente por etapa --------------------------------
  var DEFAULT_PAGE_SIZE = 5;
  var VALID_PAGE_SIZES = [5, 10, 15, 20, 25, 'all'];
  // Sin más de 5 actividades la paginación no aporta nada: se oculta el control.
  var MIN_ITEMS_FOR_PAGINATION = 5;
  var categoryPageState = {};

  function paginationStorageKey(slug) {
    return 'herra:roadmap:pagination:v1:' + apiBase.replace(/\/api\/?$/, '') + ':' + slug;
  }

  function storedPageState(slug) {
    try {
      var stored = JSON.parse(window.localStorage.getItem(paginationStorageKey(slug)) || 'null');
      if (!stored || VALID_PAGE_SIZES.indexOf(stored.pageSize) < 0) return null;
      var page = Number(stored.page);
      return { pageSize: stored.pageSize, page: Number.isInteger(page) && page > 0 ? page : 1 };
    } catch (_) {
      return null;
    }
  }

  function pageState(slug) {
    if (!categoryPageState[slug]) {
      categoryPageState[slug] = storedPageState(slug) || { pageSize: DEFAULT_PAGE_SIZE, page: 1 };
    }
    return categoryPageState[slug];
  }

  function persistPageState(slug) {
    try {
      window.localStorage.setItem(paginationStorageKey(slug), JSON.stringify(categoryPageState[slug]));
    } catch (_) {
      // La vista sigue paginada en memoria si storage no está disponible.
    }
  }

  // ---- Filtro «Solo mostrar mis tareas» ---------------------------------
  // No toca porcentajes ni contadores: solo decide qué actividades se ven.
  var myTasksOnly = false;

  function matchesFilter(item) {
    return !myTasksOnly || item.classList.contains('task--mine');
  }

  function paginateCategory(slug) {
    var block = document.querySelector('[data-cat-slug="' + slug + '"]');
    var nav = block && block.querySelector('[data-roadmap-pagination]');
    var list = block && block.querySelector('.task-list');
    if (!nav || !list) return;
    var all = Array.prototype.filter.call(list.children, function (item) {
      return item.classList.contains('task') && !item.classList.contains('task--empty');
    });
    var items = all.filter(matchesFilter);
    all.forEach(function (item) { if (!matchesFilter(item)) item.hidden = true; });
    // Con el filtro activo, una etapa sin actividades propias no se muestra.
    block.dataset.filteredOut = myTasksOnly && items.length === 0 ? '1' : '';
    var total = items.length;
    if (total <= MIN_ITEMS_FOR_PAGINATION) {
      nav.hidden = true;
      items.forEach(function (item) { item.hidden = false; });
      return;
    }
    nav.hidden = false;
    var state = pageState(slug);
    var pageSize = state.pageSize === 'all' ? total : state.pageSize;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.max(1, Math.min(state.page, totalPages));
    var start = (state.page - 1) * pageSize;
    var end = Math.min(start + pageSize, total);
    items.forEach(function (item, index) { item.hidden = index < start || index >= end; });
    var status = nav.querySelector('[data-roadmap-page-status]');
    if (status) status.textContent = T('roadmap.range', { from: start + 1, to: end, total: total });
    var previous = nav.querySelector('[data-roadmap-page-prev]');
    var next = nav.querySelector('[data-roadmap-page-next]');
    if (previous) previous.disabled = state.page === 1;
    if (next) next.disabled = state.page === totalPages;
    var size = nav.querySelector('[data-roadmap-page-size]');
    if (size && size.value !== String(state.pageSize)) size.value = String(state.pageSize);
    persistPageState(slug);
  }

  function initPagination() {
    document.querySelectorAll('[data-roadmap-pagination]').forEach(function (nav) {
      paginateCategory(nav.dataset.catSlug);
    });
  }

  document.addEventListener('change', function (event) {
    var select = event.target.closest ? event.target.closest('[data-roadmap-page-size]') : null;
    if (!select) return;
    var nav = select.closest('[data-roadmap-pagination]');
    var state = pageState(nav.dataset.catSlug);
    state.pageSize = select.value === 'all' ? 'all' : Number(select.value);
    state.page = 1;
    paginateCategory(nav.dataset.catSlug);
  });

  document.addEventListener('click', function (event) {
    var previous = event.target.closest ? event.target.closest('[data-roadmap-page-prev]') : null;
    var next = event.target.closest ? event.target.closest('[data-roadmap-page-next]') : null;
    var button = previous || next;
    if (!button) return;
    var nav = button.closest('[data-roadmap-pagination]');
    var state = pageState(nav.dataset.catSlug);
    state.page += previous ? -1 : 1;
    paginateCategory(nav.dataset.catSlug);
  });

  // ---- Paginación global de etapas ---------------------------------------
  // Este nivel muestra u oculta bloques .cat-block completos y conserva
  // intacta la paginación de actividades que vive dentro de cada etapa.
  var LINES_DEFAULT_PAGE_SIZE = 5;
  var LINES_VALID_PAGE_SIZES = [5, 10, 15, 20, 'all'];
  var linesPageState = null;

  function linesStorageKey() {
    return 'herra:roadmap:lines-pagination:v1:' + apiBase.replace(/\/api\/?$/, '');
  }

  function getLinesPageState() {
    if (linesPageState) return linesPageState;
    try {
      var stored = JSON.parse(window.localStorage.getItem(linesStorageKey()) || 'null');
      if (stored && LINES_VALID_PAGE_SIZES.indexOf(stored.pageSize) >= 0) {
        var page = Number(stored.page);
        linesPageState = { pageSize: stored.pageSize, page: Number.isInteger(page) && page > 0 ? page : 1 };
      }
    } catch (_) {
      // Continuar con los valores predeterminados.
    }
    if (!linesPageState) linesPageState = { pageSize: LINES_DEFAULT_PAGE_SIZE, page: 1 };
    return linesPageState;
  }

  function persistLinesPageState() {
    try {
      window.localStorage.setItem(linesStorageKey(), JSON.stringify(linesPageState));
    } catch (_) {
      // El estado en memoria sigue siendo válido durante esta visita.
    }
  }

  function paginateLines() {
    var list = document.querySelector('[data-roadmap-category-list]');
    var navs = document.querySelectorAll('[data-lines-pagination]');
    if (!list || !navs.length) return;
    var allCategories = Array.prototype.filter.call(list.children, function (item) {
      return item.classList.contains('cat-block');
    });
    var categories = allCategories.filter(function (item) { return item.dataset.filteredOut !== '1'; });
    allCategories.forEach(function (item) { if (item.dataset.filteredOut === '1') item.hidden = true; });
    var total = categories.length;
    var state = getLinesPageState();
    var pageSize = state.pageSize === 'all' ? Math.max(1, total) : state.pageSize;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.max(1, Math.min(state.page, totalPages));
    var start = (state.page - 1) * pageSize;
    var end = Math.min(start + pageSize, total);
    categories.forEach(function (category, index) {
      category.hidden = index < start || index >= end;
    });
    navs.forEach(function (nav) {
      nav.hidden = total <= LINES_DEFAULT_PAGE_SIZE;
      var range = nav.querySelector('[data-lines-range]');
      if (range) range.textContent = T('roadmap.stageRange', { from: total ? start + 1 : 0, to: end, total: total });
      var pageStatus = nav.querySelector('[data-lines-page-status]');
      if (pageStatus) pageStatus.textContent = T('common.pageNofM', { n: state.page, total: totalPages });
      var previous = nav.querySelector('[data-lines-page-prev]');
      var next = nav.querySelector('[data-lines-page-next]');
      if (previous) previous.disabled = state.page === 1;
      if (next) next.disabled = state.page === totalPages;
      var size = nav.querySelector('[data-lines-page-size]');
      if (size && size.value !== String(state.pageSize)) size.value = String(state.pageSize);
    });
    var emptyMessage = document.querySelector('[data-my-tasks-empty]');
    if (emptyMessage) emptyMessage.hidden = !(myTasksOnly && total === 0);
    persistLinesPageState();
  }

  // Al activar o desactivar el filtro cambia cuántas actividades y etapas hay,
  // así que ambas paginaciones vuelven a la primera página.
  document.addEventListener('change', function (event) {
    var toggle = event.target.closest ? event.target.closest('[data-my-tasks-filter]') : null;
    if (!toggle) return;
    myTasksOnly = toggle.checked;
    Object.keys(categoryPageState).forEach(function (slug) { categoryPageState[slug].page = 1; });
    getLinesPageState().page = 1;
    initPagination();
    paginateLines();
  });

  document.addEventListener('change', function (event) {
    var select = event.target.closest ? event.target.closest('[data-lines-page-size]') : null;
    if (!select) return;
    var state = getLinesPageState();
    state.pageSize = select.value === 'all' ? 'all' : Number(select.value);
    state.page = 1;
    paginateLines();
  });

  document.addEventListener('click', function (event) {
    var previous = event.target.closest ? event.target.closest('[data-lines-page-prev]') : null;
    var next = event.target.closest ? event.target.closest('[data-lines-page-next]') : null;
    if (!previous && !next) return;
    var state = getLinesPageState();
    state.page += previous ? -1 : 1;
    paginateLines();
    var bottom = event.target.closest ? event.target.closest('.lines-pagination--bottom') : null;
    var top = document.querySelector('.lines-pagination--top');
    if (bottom && top) top.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });

  function notify(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', !!isError);
  }

  function parseUtc(value) {
    if (!value) return null;
    var normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z';
    var date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatUpdated(value) {
    var date = parseUtc(value);
    if (!date) return value || '';
    return new Intl.DateTimeFormat(i18n.dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function assigneeHtml(task, assignedUsers) {
    var mine = isMine(task);
    var shown = assignedUsers.slice(0, 5);
    var extra = assignedUsers.length - shown.length;
    var label = assignedUsers.length === 1
      ? T(mine ? 'roadmap.assigneeMineAria' : 'roadmap.assigneeAria')
      : T(mine ? 'roadmap.assigneesMineAria' : 'roadmap.assigneesAria', { n: assignedUsers.length });
    var popover = (mine ? '<p class="assignee-popover__mine">' + esc(T('roadmap.yourTask')) + '</p>' : '') +
      shown.map(function (u) { return '<p>' + esc(u.shortName) + '</p>'; }).join('') +
      (extra > 0 ? '<p class="assignee-popover__more">' + esc(extra === 1 ? T('roadmap.oneMoreCollaborator') : T('roadmap.moreCollaborators', { n: extra })) + '</p>' : '');
    return '<span class="assignee' + (mine ? ' assignee--mine' : '') + '">' +
      '<button type="button" class="assignee-bubble" data-assignee-toggle aria-expanded="false" aria-label="' + esc(label) + '">' +
      '<i data-lucide="user" class="assignee-icon"></i>' +
      '<span class="assignee-count">' + assignedUsers.length + '</span>' +
      '</button>' +
      '<div class="assignee-popover" role="tooltip">' + popover + '</div>' +
      '</span>';
  }

  function assignedUsersOf(task) {
    if (Array.isArray(task.assigned_users)) return task.assigned_users;
    if (task.assigned_user_id) return [{ id: task.assigned_user_id, name: task.assigned_user_name || '' }];
    return [];
  }

  function isMine(task) {
    return currentUserId > 0 && assignedUsersOf(task).some(function (user) { return user.id === currentUserId; });
  }

  function statusControl(task) {
    var mine = isMine(task);
    if (!mine && !canManageAllTasks) return '';
    var targetLabel = esc(T(mine ? 'roadmap.changeStatusOfMine' : 'roadmap.changeStatusOfTask'));
    return '<label class="visually-hidden" for="public-status-' + task.id + '">' + targetLabel + '</label>' +
      '<select id="public-status-' + task.id + '" class="task-status-control" data-task-status-id="' + task.id + '" data-last-value="' + task.status + '" aria-label="' + targetLabel + '">' +
      '<option value="pending"' + (task.status === 'pending' ? ' selected' : '') + '>' + esc(T('status.pending')) + '</option>' +
      '<option value="in_progress"' + (task.status === 'in_progress' ? ' selected' : '') + '>' + esc(T('status.in_progress')) + '</option>' +
      '<option value="completed"' + (task.status === 'completed' ? ' selected' : '') + '>' + esc(T('status.completed')) + '</option>' +
      '</select>';
  }

  function applyRoadmap(data) {
    if (!data || !data.categories) return;

    var overallPct = document.getElementById('overallPct');
    var overallText = document.querySelector('.overall-meta p');
    var overallBar = document.querySelector('.pbar-fill--overall');
    var overallWrap = document.querySelector('.pbar-overall');
    if (overallPct) overallPct.textContent = fmtPct(data.overall.percentage);
    if (overallText) overallText.textContent = T('roadmap.completedAndPending', { done: data.overall.completed, left: data.overall.total - data.overall.completed });
    var overallTotal = document.getElementById('overallTotal');
    var overallCompleted = document.getElementById('overallCompleted');
    var overallRemaining = document.getElementById('overallRemaining');
    if (overallTotal) overallTotal.textContent = String(data.overall.total);
    if (overallCompleted) overallCompleted.textContent = String(data.overall.completed);
    if (overallRemaining) overallRemaining.textContent = String(data.overall.total - data.overall.completed);
    if (overallBar) overallBar.style.setProperty('--fill', fmtBar(data.overall.percentage));
    if (overallWrap) overallWrap.setAttribute('aria-valuenow', String(Math.round(data.overall.percentage)));

    data.categories.forEach(function (cat) {
      var block = document.querySelector('[data-cat-slug="' + cat.slug + '"]');
      if (!block) return;

      var title = block.querySelector('.cat-title');
      if (title) title.textContent = cat.title;

      var num = block.querySelector('.record-total');
      if (num) {
        var strong = num.querySelector('strong');
        var span = num.querySelector('span');
        if (strong) strong.textContent = fmtPct(cat.progress.percentage);
        if (span) span.textContent = T('roadmap.completedWord');
      }
      var progressMeta = block.querySelector('.roadmap-card__progress-meta');
      if (progressMeta) {
        var progressParts = progressMeta.querySelectorAll('span');
        if (progressParts[0]) progressParts[0].textContent = T('roadmap.stageCompleted', { done: cat.progress.completed, total: cat.progress.total });
        if (progressParts[1]) progressParts[1].textContent = T('roadmap.stageRemaining', { n: cat.progress.total - cat.progress.completed });
      }

      var bar = block.querySelector('.pbar');
      var fill = block.querySelector('.pbar-fill');
      if (fill) fill.style.setProperty('--fill', fmtBar(cat.progress.percentage));
      if (bar) bar.setAttribute('aria-valuenow', String(Math.round(cat.progress.percentage)));

      var list = block.querySelector('.task-list');
      if (!list) return;
      list.querySelectorAll('.task:not(.task--empty)').forEach(function (li) { li.remove(); });
      var frag = document.createDocumentFragment();
      cat.tasks.forEach(function (t) {
        var assignedUsers = assignedUsersOf(t);
        var li = document.createElement('li');
        li.className = 'task task--' + t.status + (isMine(t) ? ' task--mine' : '');
        li.innerHTML = '<span class="task-glyph" aria-hidden="true">' + statusGlyph[t.status] + '</span>' +
          '<span class="task-text"></span>' +
          '<span class="task-meta">' +
          statusControl(t) +
          (assignedUsers.length ? assigneeHtml(t, assignedUsers) : '') +
          (isMine(t) || canManageAllTasks ? '' : '<span class="task-status task-status--' + t.status + '">' + esc(statusLabelOf(t.status)) + '</span>') +
          '</span>';
        li.querySelector('.task-text').textContent = t.title;
        frag.appendChild(li);
      });
      var empty = list.querySelector('.task--empty');
      if (cat.tasks.length === 0) {
        if (!empty) {
          var e = document.createElement('li');
          e.className = 'task task--empty';
          e.textContent = T('roadmap.noActivities');
          frag.appendChild(e);
        }
      } else if (empty) { empty.remove(); }
      list.appendChild(frag);
      paginateCategory(cat.slug);
    });
    paginateLines();

    var lastEl = document.getElementById('lastUpdated');
    if (lastEl) {
      if (data.lastUpdated) {
        var date = parseUtc(data.lastUpdated);
        lastEl.hidden = false;
        lastEl.innerHTML = '';
        lastEl.appendChild(document.createTextNode(T('roadmap.lastUpdated') + ' '));
        var time = document.createElement('time');
        if (date) time.dateTime = date.toISOString();
        time.textContent = formatUpdated(data.lastUpdated);
        lastEl.appendChild(time);
      } else {
        lastEl.hidden = true;
      }
    }
  }

  // Burbuja de responsables: clic/toque alterna el popover (el hover/foco ya
  // lo muestra en escritorio vía CSS); un clic fuera lo cierra.
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

  document.addEventListener('change', function (event) {
    var control = event.target.closest ? event.target.closest('[data-task-status-id]') : null;
    if (!control) return;
    var previous = control.dataset.lastValue || control.value;
    control.disabled = true;
    notify(T('roadmap.saving'));
    fetch(apiBase + '/tasks/' + control.dataset.taskStatusId + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ status: control.value })
    }).then(function (response) {
      return response.json().then(function (data) { return { ok: response.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok) {
        control.value = previous;
        control.disabled = false;
        notify(result.data && result.data.error ? result.data.error : T('roadmap.saveFailed'), true);
        return;
      }
      applyRoadmap(result.data.roadmap);
      notify(T('roadmap.statusSaved'));
    }).catch(function () {
      control.value = previous;
      control.disabled = false;
      notify(T('common.networkRetry'), true);
    });
  });

  function poll() {
    if (document.hidden) return;
    fetch(apiBase + '/roadmap', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) applyRoadmap(data); })
      .catch(function () { /* silencioso: la SSR ya mostró datos */ });
  }

  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  // El HTML ya trae una vista completa y útil. La paginación vive por debajo
  // del primer viewport, así que su recorrido del DOM espera a que la portada
  // haya terminado de pintar en vez de competir con el LCP.
  function initializePagination() {
    initPagination();
    paginateLines();
  }
  function schedulePagination() {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(initializePagination, { timeout: 2500 });
    } else {
      window.setTimeout(initializePagination, 0);
    }
  }
  if (document.readyState === 'complete') schedulePagination();
  else window.addEventListener('load', schedulePagination, { once: true });
})();
