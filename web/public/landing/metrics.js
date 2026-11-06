// Métricas de tráfico: personas y bots por separado.
//
// Un mismo cliente sirve al panel de cada proyecto (dentro de su ventana
// «Métricas») y a la superadministración (con selector de ámbito y la política
// de robots.txt). Todo se pinta con nodos y textContent: los nombres de
// agentes y países vienen del servidor, pero nunca se insertan como HTML.
//
// Solo lo cargan los paneles; la portada pública no lo descarga nunca.
(function () {
  'use strict';

  var CATEGORIES = ['human', 'ai', 'search', 'bot', 'suspicious'];
  var CATEGORY_KEYS = {
    human: 'metrics.catHuman', ai: 'metrics.catAi', search: 'metrics.catSearch',
    bot: 'metrics.catBot', suspicious: 'metrics.catSuspicious',
  };
  var PAGE_KEYS = {
    home: 'metrics.pageHome', roadmap: 'metrics.pageRoadmap', collaborate: 'metrics.pageCollaborate',
    login: 'metrics.pageLogin', register: 'metrics.pageRegister', llms: 'metrics.pageLlms',
    sitemap: 'metrics.pageSitemap', robots: 'metrics.pageRobots',
  };
  var PURPOSE_KEYS = {
    training: 'metrics.purposeTraining', search: 'metrics.purposeSearch', user: 'metrics.purposeUser',
    preview: 'metrics.purposePreview', seo: 'metrics.purposeSeo', monitor: 'metrics.purposeMonitor',
    tool: 'metrics.purposeTool', other: 'metrics.purposeOther',
  };
  var RANGES = [7, 30, 90];
  var PREFS_KEY = 'herra-metrics-prefs';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Trazos de iconos (Lucide). Constantes del propio archivo, no datos.
  var ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    minus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  };

  var lang = document.documentElement.lang === 'en' ? 'en' : 'es';
  var locale = lang === 'en' ? 'en-US' : 'es-VE';
  var numberFormat = new Intl.NumberFormat(locale);
  var percentFormat = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  // ---- Utilidades ---------------------------------------------------------------

  function translator(node) {
    var messages = {};
    try { messages = JSON.parse(node.dataset.messages || '{}') || {}; } catch (error) { messages = {}; }
    return function (key, vars) {
      var template = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
      });
    };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (name) { node.setAttribute(name, attrs[name]); });
    return node;
  }

  function icon(name) {
    var node = svg('svg', {
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
    });
    node.innerHTML = ICONS[name];
    return node;
  }

  function num(value) { return numberFormat.format(value || 0); }

  function utcDay(day) {
    var parts = String(day).split('-');
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  }
  function formatDay(day, options) {
    var opts = Object.assign({ timeZone: 'UTC' }, options);
    return new Intl.DateTimeFormat(locale, opts).format(utcDay(day));
  }
  function shortDay(day) { return formatDay(day, { day: 'numeric', month: 'short' }); }
  function longDay(day) { return formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function fullDay(day) { return formatDay(day, { day: 'numeric', month: 'long', year: 'numeric' }); }
  // Las marcas de tiempo de SQLite van en UTC y sin zona: «2026-09-12 14:03:00».
  function formatStamp(value) {
    if (!value) return '—';
    var date = new Date(String(value).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(value) ? '' : 'Z'));
    if (isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function readPrefs() {
    try { return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (error) { return {}; }
  }
  function writePrefs(prefs) {
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (error) { /* modo privado */ }
  }

  // Grupo de opciones con flechas, como un radiogroup nativo: Tab entra y sale
  // del grupo entero y las flechas cambian la opción.
  function segmented(label, options, current, onChange) {
    var group = el('div', 'metrics-seg');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    var buttons = options.map(function (option) {
      var button = el('button', 'metrics-seg__opt', option.label);
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.dataset.value = String(option.value);
      var selected = String(option.value) === String(current);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      button.addEventListener('click', function () { choose(option.value, false); });
      group.appendChild(button);
      return button;
    });
    function choose(value, focus) {
      buttons.forEach(function (button) {
        var selected = button.dataset.value === String(value);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      });
      onChange(value);
    }
    group.addEventListener('keydown', function (event) {
      var index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      var next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
      if (next === null) return;
      event.preventDefault();
      choose(options[next].value, true);
    });
    return group;
  }

  // Escala «redonda» para el eje: 0, 5, 10, 15… nunca decimales, porque se
  // cuentan personas y peticiones.
  function niceTicks(max) {
    if (!(max > 0)) return [0, 1, 2, 3, 4];
    var rough = max / 4;
    var power = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var multipliers = [1, 2, 2.5, 5, 10];
    var step = power * 10;
    for (var i = 0; i < multipliers.length; i++) {
      if (power * multipliers[i] >= rough) { step = power * multipliers[i]; break; }
    }
    step = Math.max(1, Math.ceil(step));
    var ticks = [0];
    while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  // ---- Panel de métricas ----------------------------------------------------------

  function initDashboard(root) {
    var T = translator(root);
    var url = root.dataset.metricsUrl;
    if (!url) return;
    var flagBase = root.dataset.flagBase || '';
    var robotsEdit = root.dataset.robotsEdit || '';
    var scopeSelect = root.querySelector('[data-metrics-scope]');
    var prefs = readPrefs();
    var state = {
      days: RANGES.indexOf(Number(prefs.days)) >= 0 ? Number(prefs.days) : 30,
      measure: prefs.measure === 'requests' ? 'requests' : 'visitors',
      filter: 'all',
      table: false,
      report: null,
      loadedAt: 0,
      requestId: 0,
      active: -1,
    };

    root.classList.add('metrics');
    var scopeLabel = scopeSelect ? scopeSelect.closest('.metrics-scope') : null;
    var noscript = root.querySelector('noscript');
    if (noscript) noscript.remove();

    var filters = el('div', 'metrics__filters');
    if (scopeLabel) filters.appendChild(scopeLabel);
    filters.appendChild(segmented(T('metrics.range'), RANGES.map(function (days) {
      return { value: days, label: T('metrics.range' + days) };
    }), state.days, function (value) {
      state.days = Number(value);
      prefs.days = state.days;
      writePrefs(prefs);
      load();
    }));
    var meta = el('p', 'metrics__meta');
    meta.setAttribute('aria-live', 'polite');
    filters.appendChild(meta);
    var refresh = el('button', 'metrics-icon-btn');
    refresh.type = 'button';
    refresh.appendChild(icon('refresh'));
    refresh.appendChild(el('span', '', T('metrics.refresh')));
    refresh.addEventListener('click', function () { load(); });
    filters.appendChild(refresh);

    var alertBox = el('div', 'metrics__alert');
    alertBox.setAttribute('role', 'alert');
    alertBox.hidden = true;
    var content = el('div', 'metrics__content');
    root.appendChild(filters);
    root.appendChild(alertBox);
    root.appendChild(content);
    content.appendChild(el('p', 'metrics-empty', T('metrics.loading')));

    if (scopeSelect) scopeSelect.addEventListener('change', function () { load(); });

    function showAlert(message) {
      alertBox.textContent = '';
      alertBox.appendChild(el('span', '', message || T('metrics.error')));
      var retry = el('button', 'btn btn-ghost btn-sm', T('metrics.retry'));
      retry.type = 'button';
      retry.addEventListener('click', function () { load(); });
      alertBox.appendChild(retry);
      alertBox.hidden = false;
      if (!state.report) content.textContent = '';
    }

    function load() {
      var id = ++state.requestId;
      root.classList.add('is-loading');
      root.setAttribute('aria-busy', 'true');
      var query = '?days=' + state.days + (scopeSelect ? '&scope=' + encodeURIComponent(scopeSelect.value) : '');
      fetch(url + query, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (response) {
          return response.json().catch(function () { return null; }).then(function (body) {
            if (!response.ok || !body) throw new Error(body && body.error ? body.error : T('metrics.error'));
            return body;
          });
        })
        .then(function (report) {
          if (id !== state.requestId) return;
          state.report = report;
          state.loadedAt = Date.now();
          alertBox.hidden = true;
          render();
        })
        .catch(function (error) {
          if (id !== state.requestId) return;
          showAlert(error && error.message);
        })
        .then(function () {
          if (id !== state.requestId) return;
          root.classList.remove('is-loading');
          root.removeAttribute('aria-busy');
        });
    }
    root.metricsReload = load;

    // ---- Pintado ------------------------------------------------------------------
    var chartResize = null;

    function render() {
      var report = state.report;
      if (chartResize) { chartResize.disconnect(); chartResize = null; }
      var time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(state.loadedAt));
      var parts = [T('metrics.rangeLabel', { from: fullDay(report.from), to: fullDay(report.to) })];
      if (report.since) parts.push(T('metrics.since', { date: fullDay(report.since) }));
      parts.push(T('metrics.updated', { time: time }));
      meta.textContent = parts.join(' · ');

      content.textContent = '';
      if (report.acquisition && window.CRVAcquisitionPanel) content.appendChild(window.CRVAcquisitionPanel(root, report.acquisition));
      if (!report.since) {
        var empty = el('div', 'metrics-card');
        empty.appendChild(el('p', 'metrics-empty', T('metrics.noDataYet')));
        content.appendChild(empty);
        content.appendChild(howCard(report));
        return;
      }
      content.appendChild(tiles(report));
      content.appendChild(chartCard(report));
      content.appendChild(agentsCard(report));
      var split = el('div', 'metrics__split');
      split.appendChild(pagesCard(report));
      split.appendChild(countriesCard(report));
      content.appendChild(split);
      content.appendChild(howCard(report));
    }

    function replaceCard(oldCard, newCard, focusSelector) {
      oldCard.replaceWith(newCard);
      if (focusSelector) {
        var target = newCard.querySelector(focusSelector);
        if (target) target.focus();
      }
      return newCard;
    }

    function deltaText(current, previous) {
      if (!previous) return current ? T('metrics.deltaNew') : T('metrics.deltaFlat');
      var change = (current - previous) / previous;
      if (Math.abs(change) < 0.005) return T('metrics.deltaFlat');
      return T(change > 0 ? 'metrics.deltaUp' : 'metrics.deltaDown', { pct: percentFormat.format(Math.abs(change)) });
    }

    function tile(options) {
      var node = el('div', 'metrics-tile' + (options.modifier ? ' metrics-tile--' + options.modifier : ''));
      var label = el('p', 'metrics-tile__label');
      if (options.swatch) {
        var swatch = el('span', 'metrics-swatch metrics-swatch--' + options.swatch);
        swatch.setAttribute('aria-hidden', 'true');
        label.appendChild(swatch);
      }
      label.appendChild(document.createTextNode(options.label));
      node.appendChild(label);
      node.appendChild(el('p', 'metrics-tile__value', options.value));
      if (options.detail) node.appendChild(el('p', 'metrics-tile__detail', options.detail));
      node.appendChild(el('p', 'metrics-tile__delta', options.delta));
      return node;
    }

    function tiles(report) {
      var wrap = el('div', 'metrics__tiles');
      var confirmed = report.totals.confirmed;
      wrap.appendChild(tile({
        modifier: 'people', swatch: 'human', label: T('metrics.tilePeople'),
        value: num(confirmed.current), detail: T('metrics.tilePeopleHelp'),
        delta: deltaText(confirmed.current, confirmed.previous),
      }));
      var current = report.totals.categories.current;
      var previous = report.totals.categories.previous;
      var other = state.measure === 'visitors' ? 'requests' : 'visitors';
      CATEGORIES.forEach(function (category) {
        wrap.appendChild(tile({
          swatch: category, label: T(CATEGORY_KEYS[category]),
          value: num(current[category][state.measure]),
          detail: T(other === 'requests' ? 'metrics.tileRequests' : 'metrics.tileVisitors', { n: num(current[category][other]) }),
          delta: deltaText(current[category][state.measure], previous[category][state.measure]),
        }));
      });
      return wrap;
    }

    function cardHead(card, id, title, sub) {
      var head = el('div', 'metrics-card__head');
      var titles = el('div');
      var heading = el('h3', 'metrics-card__title', title);
      heading.id = id;
      titles.appendChild(heading);
      if (sub) titles.appendChild(el('p', 'metrics-card__sub', sub));
      head.appendChild(titles);
      card.setAttribute('aria-labelledby', id);
      card.appendChild(head);
      return head;
    }

    var uid = Math.random().toString(36).slice(2, 8);

    // ---- Gráfico diario -------------------------------------------------------------
    function chartCard(report) {
      var card = el('section', 'metrics-card');
      var head = cardHead(card, 'metrics-chart-' + uid, T('metrics.chartTitle'), T('metrics.chartSub'));
      var measureSeg = segmented(T('metrics.measure'), [
        { value: 'visitors', label: T('metrics.measureVisitors') },
        { value: 'requests', label: T('metrics.measureRequests') },
      ], state.measure, function (value) {
        state.measure = value;
        prefs.measure = value;
        writePrefs(prefs);
        var tilesNode = content.querySelector('.metrics__tiles');
        if (tilesNode) tilesNode.replaceWith(tiles(state.report));
        if (chartResize) { chartResize.disconnect(); chartResize = null; }
        replaceCard(card, chartCard(state.report), '.metrics-seg__opt[data-value="' + value + '"]');
      });
      head.appendChild(measureSeg);

      var legend = el('ul', 'metrics-legend');
      CATEGORIES.forEach(function (category) {
        var item = el('li');
        var swatch = el('span', 'metrics-swatch metrics-swatch--' + category);
        swatch.setAttribute('aria-hidden', 'true');
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(T(CATEGORY_KEYS[category])));
        legend.appendChild(item);
      });
      card.appendChild(legend);

      var total = report.daily.reduce(function (sum, day) {
        return sum + CATEGORIES.reduce(function (inner, category) { return inner + day[category][state.measure]; }, 0);
      }, 0);
      if (total === 0) {
        card.appendChild(el('p', 'metrics-empty', T('metrics.countriesEmpty')));
        return card;
      }

      var wrap = el('div', 'metrics-chart');
      card.appendChild(wrap);
      // Se dibuja al ancho real del contenedor y se vuelve a dibujar si cambia
      // (girar el móvil, redimensionar la ventana), conservando el día activo.
      var lastWidth = 0;
      function draw() {
        var width = Math.round(wrap.clientWidth) || 720;
        if (Math.abs(width - lastWidth) < 4) return;
        lastWidth = width;
        drawChart(wrap, report, width, total);
      }
      if ('ResizeObserver' in window) {
        chartResize = new ResizeObserver(draw);
        chartResize.observe(wrap);
      }
      window.requestAnimationFrame(draw);

      var toggle = el('button', 'metrics-icon-btn metrics-table-toggle', T(state.table ? 'metrics.hideTable' : 'metrics.showTable'));
      toggle.type = 'button';
      var tableId = 'metrics-daily-table-' + uid;
      toggle.setAttribute('aria-expanded', state.table ? 'true' : 'false');
      toggle.setAttribute('aria-controls', tableId);
      card.appendChild(toggle);
      var tableWrap = dailyTable(report);
      tableWrap.id = tableId;
      tableWrap.hidden = !state.table;
      card.appendChild(tableWrap);
      toggle.addEventListener('click', function () {
        state.table = !state.table;
        tableWrap.hidden = !state.table;
        toggle.textContent = T(state.table ? 'metrics.hideTable' : 'metrics.showTable');
        toggle.setAttribute('aria-expanded', state.table ? 'true' : 'false');
      });
      return card;
    }

    function drawChart(wrap, report, width, total) {
      wrap.textContent = '';
      var days = report.daily;
      var count = days.length;
      var height = width < 520 ? 210 : 250;
      var margin = { top: 12, right: 8, bottom: 28, left: 46 };
      var plotW = width - margin.left - margin.right;
      var plotH = height - margin.top - margin.bottom;
      var key = state.measure;
      var totals = days.map(function (day) {
        return CATEGORIES.reduce(function (sum, category) { return sum + day[category][key]; }, 0);
      });
      var ticks = niceTicks(Math.max.apply(null, totals));
      var top = ticks[ticks.length - 1] || 1;
      var baseline = margin.top + plotH;
      var band = plotW / count;
      var barW = Math.max(2, Math.min(24, band * 0.72));
      var measureLabel = T(key === 'visitors' ? 'metrics.measureVisitors' : 'metrics.measureRequests').toLowerCase();

      var chart = svg('svg', {
        viewBox: '0 0 ' + width + ' ' + height, width: String(width), height: String(height),
        role: 'img', tabindex: '0',
        'aria-label': T('metrics.chartAria', {
          measure: measureLabel,
          range: T('metrics.rangeLabel', { from: fullDay(report.from), to: fullDay(report.to) }),
          total: num(total),
        }),
      });

      ticks.forEach(function (tick) {
        var y = Math.round(baseline - (tick / top) * plotH) + 0.5;
        if (tick > 0) chart.appendChild(svg('line', { class: 'metrics-grid', x1: margin.left, x2: width - margin.right, y1: y, y2: y }));
        var label = svg('text', { class: 'metrics-tick', x: margin.left - 8, y: y + 4, 'text-anchor': 'end' });
        label.textContent = num(tick);
        chart.appendChild(label);
      });

      var hoverBand = svg('rect', { class: 'metrics-hover-band', x: 0, y: margin.top, width: band, height: plotH, rx: 4 });
      hoverBand.style.display = 'none';
      chart.appendChild(hoverBand);

      var columns = days.map(function (day, index) {
        var group = svg('g', { class: 'metrics-col' });
        var x = margin.left + band * index + (band - barW) / 2;
        var y = baseline;
        var visible = CATEGORIES.filter(function (category) { return day[category][key] > 0; });
        visible.forEach(function (category, position) {
          var h = (day[category][key] / top) * plotH;
          var isTop = position === visible.length - 1;
          // Hueco de 2 px del color de la superficie entre segmentos: separa
          // sin dibujar bordes alrededor de los datos.
          var drawn = Math.max(1, isTop ? h : h - 2);
          var yTop = y - h;
          if (isTop) {
            var r = Math.min(4, barW / 2, drawn);
            var path = 'M' + x + ',' + (yTop + drawn)
              + 'V' + (yTop + r) + 'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop
              + 'H' + (x + barW - r) + 'Q' + (x + barW) + ',' + yTop + ' ' + (x + barW) + ',' + (yTop + r)
              + 'V' + (yTop + drawn) + 'Z';
            group.appendChild(svg('path', { class: 'metrics-fill--' + category, d: path }));
          } else {
            group.appendChild(svg('rect', { class: 'metrics-fill--' + category, x: x, y: yTop + (h - drawn), width: barW, height: drawn }));
          }
          y -= h;
        });
        chart.appendChild(group);
        return group;
      });

      chart.appendChild(svg('line', { class: 'metrics-baseline', x1: margin.left, x2: width - margin.right, y1: baseline + 0.5, y2: baseline + 0.5 }));

      // Rótulos del eje X: los que caben sin pisarse, siempre con el último día.
      // Si el último queda demasiado cerca del anterior, cede el anterior.
      var LABEL_GAP = 72;
      var maxLabels = Math.max(2, Math.floor(plotW / 64));
      var step = Math.max(1, Math.ceil(count / maxLabels));
      var labelled = [];
      for (var i = 0; i < count; i += step) labelled.push(i);
      if (labelled[labelled.length - 1] !== count - 1) labelled.push(count - 1);
      while (labelled.length > 1 && (labelled[labelled.length - 1] - labelled[labelled.length - 2]) * band < LABEL_GAP) {
        labelled.splice(labelled.length - 2, 1);
      }
      labelled.forEach(function (index) {
        var day = days[index];
        var isLast = index === count - 1;
        var cx = margin.left + band * (index + 0.5);
        var anchor = index === 0 && band < 40 ? 'start' : isLast && band < 40 ? 'end' : 'middle';
        var label = svg('text', { class: 'metrics-tick', x: anchor === 'start' ? margin.left : anchor === 'end' ? width - margin.right : cx, y: height - 8, 'text-anchor': anchor });
        label.textContent = shortDay(day.day);
        chart.appendChild(label);
      });

      var hit = svg('rect', { x: margin.left, y: margin.top, width: plotW, height: plotH, fill: 'transparent' });
      chart.appendChild(hit);
      wrap.appendChild(chart);

      var tooltip = el('div', 'metrics-tooltip');
      tooltip.hidden = true;
      tooltip.setAttribute('aria-hidden', 'true');
      wrap.appendChild(tooltip);
      var live = el('p', 'sr-only');
      live.setAttribute('aria-live', 'polite');
      wrap.appendChild(live);

      function row(className, keyClass, label, value) {
        var line = el('div', 'metrics-tooltip__row' + (className ? ' ' + className : ''));
        var keyNode = el('span', 'metrics-key' + (keyClass ? ' ' + keyClass : ''));
        line.appendChild(keyNode);
        line.appendChild(el('span', '', label));
        line.appendChild(el('strong', '', value));
        return line;
      }

      function setActive(index, announce) {
        if (index < 0) {
          state.active = -1;
          wrap.classList.remove('has-active');
          columns.forEach(function (column) { column.classList.remove('is-active'); });
          hoverBand.style.display = 'none';
          tooltip.hidden = true;
          return;
        }
        state.active = index;
        var day = days[index];
        wrap.classList.add('has-active');
        columns.forEach(function (column, i) { column.classList.toggle('is-active', i === index); });
        hoverBand.setAttribute('x', String(margin.left + band * index));
        hoverBand.style.display = '';

        tooltip.textContent = '';
        tooltip.appendChild(el('p', 'metrics-tooltip__day', longDay(day.day)));
        var summary = [longDay(day.day)];
        CATEGORIES.slice().reverse().forEach(function (category) {
          tooltip.appendChild(row('', 'metrics-tooltip__key--' + category, T(CATEGORY_KEYS[category]), num(day[category][key])));
          summary.push(T(CATEGORY_KEYS[category]) + ': ' + num(day[category][key]));
        });
        tooltip.appendChild(row('metrics-tooltip__row--total', '', T('metrics.total'), num(totals[index])));
        tooltip.appendChild(row('', 'metrics-tooltip__key--human', T('metrics.tilePeople'), num(day.confirmed)));
        summary.push(T('metrics.total') + ': ' + num(totals[index]), T('metrics.tilePeople') + ': ' + num(day.confirmed));
        tooltip.hidden = false;

        var rect = chart.getBoundingClientRect();
        var scale = rect.width / width || 1;
        var cx = (margin.left + band * (index + 0.5)) * scale;
        var tipWidth = tooltip.offsetWidth;
        var left = cx + 14;
        if (left + tipWidth > rect.width) left = cx - 14 - tipWidth;
        tooltip.style.left = Math.max(0, left) + 'px';
        tooltip.style.top = Math.round(margin.top * scale) + 'px';
        if (announce) live.textContent = summary.join(', ');
      }

      function indexFromPointer(event) {
        var rect = chart.getBoundingClientRect();
        var x = (event.clientX - rect.left) * (width / rect.width);
        return Math.max(0, Math.min(count - 1, Math.floor((x - margin.left) / band)));
      }
      chart.addEventListener('pointermove', function (event) { setActive(indexFromPointer(event), false); });
      chart.addEventListener('pointerdown', function (event) { setActive(indexFromPointer(event), false); });
      chart.addEventListener('pointerleave', function () { if (document.activeElement !== chart) setActive(-1); });
      chart.addEventListener('focus', function () { setActive(state.active >= 0 && state.active < count ? state.active : count - 1, true); });
      chart.addEventListener('blur', function () { setActive(-1); });
      chart.addEventListener('keydown', function (event) {
        var index = state.active < 0 ? count - 1 : state.active;
        if (event.key === 'ArrowRight') index = Math.min(count - 1, index + 1);
        else if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = count - 1;
        else if (event.key === 'Escape') { setActive(-1); return; }
        else return;
        event.preventDefault();
        setActive(index, true);
      });
    }

    function dailyTable(report) {
      var wrap = el('div', 'metrics-table-wrap');
      var table = el('table', 'metrics-table');
      table.appendChild(el('caption', '', T('metrics.chartTitle')));
      var thead = el('thead');
      var headRow = el('tr');
      headRow.appendChild(el('th', '', T('metrics.colDay')));
      CATEGORIES.forEach(function (category) {
        var th = el('th', 'is-num', T(CATEGORY_KEYS[category]));
        headRow.appendChild(th);
      });
      headRow.appendChild(el('th', 'is-num', T('metrics.total')));
      headRow.appendChild(el('th', 'is-num', T('metrics.tilePeople')));
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = el('tbody');
      report.daily.slice().reverse().forEach(function (day) {
        var tr = el('tr');
        tr.appendChild(el('td', '', longDay(day.day)));
        var sum = 0;
        CATEGORIES.forEach(function (category) {
          sum += day[category][state.measure];
          tr.appendChild(el('td', 'is-num', num(day[category][state.measure])));
        });
        tr.appendChild(el('td', 'is-num', num(sum)));
        tr.appendChild(el('td', 'is-num', num(day.confirmed)));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }

    // ---- Agentes --------------------------------------------------------------------
    function badge(tone, iconName, label, title) {
      var node = el('span', 'metrics-badge metrics-badge--' + tone);
      var iconWrap = el('span', 'metrics-badge__icon');
      iconWrap.appendChild(icon(iconName));
      node.appendChild(iconWrap);
      node.appendChild(document.createTextNode(label));
      if (title) node.title = title;
      return node;
    }

    function verificationBadge(agent) {
      if (!agent.verifiable) return badge('neutral', 'minus', T('metrics.declared'));
      var v = agent.verification;
      var breakdown = T('metrics.verificationBreakdown', { verified: num(v.verified), spoofed: num(v.spoofed), unverified: num(v.unverified) });
      if (v.spoofed > 0 && v.verified > 0) return badge('warning', 'alert', T('metrics.mixed'), breakdown);
      if (v.spoofed > 0) return badge('critical', 'alert', T('metrics.spoofed'), breakdown);
      if (v.verified > 0 && v.unverified === 0) return badge('good', 'check', T('metrics.verified'), breakdown);
      if (v.verified > 0) return badge('warning', 'help', T('metrics.mixed'), breakdown);
      return badge('neutral', 'help', T('metrics.unverified'), breakdown);
    }

    function robotsBadge(status) {
      if (status === 'blocked') return badge('critical', 'ban', T('metrics.robotsBlocked'));
      if (status === 'allowed') return badge('good', 'check', T('metrics.robotsAllowed'));
      return el('span', 'is-muted', T('metrics.robotsNotApplicable'));
    }

    function agentsCard(report) {
      var card = el('section', 'metrics-card');
      cardHead(card, 'metrics-agents-' + uid, T('metrics.agentsTitle'), T('metrics.agentsSub'));
      var filters = [
        { value: 'all', label: T('metrics.filterAll') },
        { value: 'ai', label: T('metrics.catAi'), swatch: 'ai' },
        { value: 'search', label: T('metrics.catSearch'), swatch: 'search' },
        { value: 'bot', label: T('metrics.catBot'), swatch: 'bot' },
      ];
      var tabs = el('div', 'metrics-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', T('metrics.filterLabel'));
      var panelId = 'metrics-agents-panel-' + uid;
      var buttons = filters.map(function (filter) {
        var tab = el('button', 'metrics-tab');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panelId);
        tab.dataset.filter = filter.value;
        var selected = state.filter === filter.value;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.tabIndex = selected ? 0 : -1;
        if (filter.swatch) {
          var swatch = el('span', 'metrics-swatch metrics-swatch--' + filter.swatch);
          swatch.setAttribute('aria-hidden', 'true');
          tab.appendChild(swatch);
        }
        tab.appendChild(document.createTextNode(filter.label));
        var total = report.agents.filter(function (agent) { return filter.value === 'all' || agent.category === filter.value; }).length;
        tab.appendChild(el('span', 'metrics-tab__count', num(total)));
        tab.addEventListener('click', function () { choose(filter.value); });
        tabs.appendChild(tab);
        return tab;
      });
      function choose(value) {
        state.filter = value;
        replaceCard(card, agentsCard(state.report), '.metrics-tab[data-filter="' + value + '"]');
      }
      tabs.addEventListener('keydown', function (event) {
        var index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        var next = null;
        if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
        if (next === null) return;
        event.preventDefault();
        choose(filters[next].value);
      });
      card.appendChild(tabs);

      var panel = el('div');
      panel.id = panelId;
      panel.setAttribute('role', 'tabpanel');
      var agents = report.agents.filter(function (agent) { return state.filter === 'all' || agent.category === state.filter; });
      if (agents.length === 0) {
        panel.appendChild(el('p', 'metrics-empty', T('metrics.agentsEmpty')));
      } else {
        var wrap = el('div', 'metrics-table-wrap');
        var table = el('table', 'metrics-table');
        table.appendChild(el('caption', '', T('metrics.agentsTitle')));
        var thead = el('thead');
        var headRow = el('tr');
        [
          ['metrics.colAgent', ''], ['metrics.colPurpose', ''], ['metrics.colVerification', ''],
          ['metrics.colRequests', 'is-num'], ['metrics.colVisitors', 'is-num'], ['metrics.colJs', 'is-num'],
          ['metrics.colLast', ''], ['metrics.colRobots', ''],
        ].forEach(function (column) {
          var th = el('th', column[1], T(column[0]));
          th.scope = 'col';
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = el('tbody');
        agents.forEach(function (agent) {
          var tr = el('tr');
          var name = el('td');
          var who = el('div', 'metrics-agent');
          var swatch = el('span', 'metrics-swatch metrics-swatch--' + agent.category);
          swatch.setAttribute('aria-hidden', 'true');
          who.appendChild(swatch);
          var text = el('div');
          text.appendChild(el('span', 'metrics-agent__name', agent.label));
          var operator = agent.operator && agent.operator !== '—' ? agent.operator + ' · ' : '';
          text.appendChild(el('span', 'metrics-agent__meta', operator + T(CATEGORY_KEYS[agent.category])));
          who.appendChild(text);
          name.appendChild(who);
          tr.appendChild(name);
          tr.appendChild(el('td', 'is-muted', T(PURPOSE_KEYS[agent.purpose] || 'metrics.purposeOther')));
          var verification = el('td');
          verification.appendChild(verificationBadge(agent));
          tr.appendChild(verification);
          tr.appendChild(el('td', 'is-num', num(agent.requests)));
          tr.appendChild(el('td', 'is-num', num(agent.visitors)));
          tr.appendChild(el('td', 'is-num', num(agent.jsVisitors)));
          tr.appendChild(el('td', 'is-muted', formatStamp(agent.lastAt)));
          var robots = el('td');
          robots.appendChild(robotsBadge(agent.robots));
          tr.appendChild(robots);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        panel.appendChild(wrap);
      }
      card.appendChild(panel);

      var note = el('p', 'metrics-note');
      if (robotsEdit) {
        var link = el('a', '', T('metrics.robotsEdit'));
        link.href = robotsEdit;
        note.appendChild(document.createTextNode(T('metrics.robotsManaged') + ' '));
        note.appendChild(link);
      } else {
        note.textContent = T('metrics.robotsManaged');
      }
      card.appendChild(note);
      return card;
    }

    // ---- Pantallas y países ---------------------------------------------------------
    function pagesCard(report) {
      var card = el('section', 'metrics-card');
      cardHead(card, 'metrics-pages-' + uid, T('metrics.pagesTitle'), T('metrics.pagesSub'));
      if (report.pages.length === 0) {
        card.appendChild(el('p', 'metrics-empty', T('metrics.countriesEmpty')));
        return card;
      }
      var max = report.pages.reduce(function (value, page) { return Math.max(value, page.total); }, 0) || 1;
      var list = el('ul', 'metrics-bars');
      report.pages.forEach(function (page) {
        var item = el('li', 'metrics-bars__row');
        item.appendChild(el('span', 'metrics-bars__label', T(PAGE_KEYS[page.page] || page.page)));
        var track = el('span', 'metrics-bars__track');
        track.setAttribute('aria-hidden', 'true');
        track.style.width = Math.max(2, (page.total / max) * 100) + '%';
        var breakdown = [];
        CATEGORIES.forEach(function (category) {
          if (page[category] <= 0) return;
          var segment = el('span', 'metrics-bars__seg metrics-swatch--' + category);
          segment.style.flex = page[category] + ' 0 0';
          track.appendChild(segment);
          breakdown.push(T(CATEGORY_KEYS[category]) + ': ' + num(page[category]));
        });
        item.title = breakdown.join(' · ');
        item.appendChild(track);
        item.appendChild(el('strong', 'metrics-bars__num', num(page.total)));
        item.appendChild(el('span', 'sr-only', breakdown.join(', ')));
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }

    function countryList(title, items) {
      var column = el('div');
      column.appendChild(el('h4', '', title));
      if (items.length === 0) {
        column.appendChild(el('p', 'metrics-note', T('metrics.countriesEmpty')));
        return column;
      }
      var list = el('ol');
      items.forEach(function (item) {
        var row = el('li');
        if (item.flag) {
          var flag = el('img');
          flag.src = flagBase + item.flag + '.svg';
          flag.alt = '';
          flag.width = 21;
          flag.height = 15;
          flag.loading = 'lazy';
          row.appendChild(flag);
        } else {
          var unknown = el('span', 'metrics-flag-unknown');
          unknown.setAttribute('aria-hidden', 'true');
          row.appendChild(unknown);
        }
        row.appendChild(el('span', '', item.name));
        row.appendChild(el('strong', '', num(item.count)));
        list.appendChild(row);
      });
      column.appendChild(list);
      return column;
    }

    function countriesCard(report) {
      var card = el('section', 'metrics-card');
      cardHead(card, 'metrics-countries-' + uid, T('metrics.countriesTitle'));
      var grid = el('div', 'metrics-countries');
      grid.appendChild(countryList(T('metrics.countriesPeople'), report.countries.people));
      grid.appendChild(countryList(T('metrics.countriesAutomated'), report.countries.automated));
      card.appendChild(grid);
      return card;
    }

    function howCard(report) {
      var details = el('details', 'metrics-how');
      details.appendChild(el('summary', '', T('metrics.howTitle')));
      var list = el('ul');
      ['metrics.howHuman', 'metrics.howAgents', 'metrics.howSuspicious', 'metrics.howLimit', 'metrics.howPrivacy', 'metrics.howUnit']
        .forEach(function (key) { list.appendChild(el('li', '', T(key))); });
      var verification = report.verification;
      if (!verification.clientIp) list.appendChild(el('li', '', T('metrics.verifyNoIp')));
      if (!verification.network) list.appendChild(el('li', '', T('metrics.verifyOff')));
      list.appendChild(el('li', '', verification.lists > 0
        ? T('metrics.verifyLists', { n: num(verification.lists), total: num(verification.listsTotal), date: formatStamp(verification.updatedAt) })
        : T('metrics.verifyListsNone')));
      if (report.publicCounter) {
        list.appendChild(el('li', '', report.publicCounter.enabled
          ? T('metrics.counterTotal', { n: num(report.publicCounter.total) })
          : T('metrics.counterOff')));
      }
      details.appendChild(list);
      return details;
    }

    // ---- Arranque -------------------------------------------------------------------
    // Dentro de una ventana, las cifras se piden al abrirla (y se refrescan si
    // llevan más de un minuto). En una página se piden al cargarla: quien entra
    // por un enlace directo a otra sección también las encuentra listas.
    var dialogId = root.dataset.metricsLazy;
    var dialog = dialogId ? document.getElementById(dialogId) : null;
    if (dialog) {
      var onToggle = function () {
        if (!dialog.open) return;
        if (!state.report || Date.now() - state.loadedAt > 60000) load();
      };
      new MutationObserver(onToggle).observe(dialog, { attributes: true, attributeFilter: ['open'] });
      onToggle();
    } else {
      load();
    }

    document.addEventListener('herra:robots-saved', function () { if (state.report) load(); });
  }

  // ---- Política de robots.txt -------------------------------------------------------

  function initRobotsPolicy(form) {
    var T = translator(form);
    var api = form.dataset.robotsApi;
    if (!api) return;
    var signals = Array.prototype.slice.call(form.querySelectorAll('[data-signal]'));
    var crawlers = Array.prototype.slice.call(form.querySelectorAll('[data-crawler]'));
    var preview = form.querySelector('[data-robots-preview]');
    var countNode = form.querySelector('[data-robots-count]');
    var dirtyNode = form.querySelector('[data-robots-dirty]');
    var statusNode = form.querySelector('[data-robots-status]');
    var saveButton = form.querySelector('[data-robots-save]');
    var allowAll = form.querySelector('[data-robots-allow-all]');
    var previewTimer = null;
    var previewRequest = 0;

    function current() {
      var policy = { blocked: [], signals: {} };
      crawlers.forEach(function (input) { if (!input.checked) policy.blocked.push(input.value); });
      signals.forEach(function (input) { policy.signals[input.dataset.signal] = input.checked; });
      return policy;
    }
    function fingerprint(policy) {
      return JSON.stringify({
        blocked: policy.blocked.slice().sort(),
        signals: { search: !!policy.signals.search, aiInput: !!policy.signals.aiInput, aiTrain: !!policy.signals.aiTrain },
      });
    }
    var saved = fingerprint(current());

    function status(text, isError) {
      if (!statusNode) return;
      statusNode.textContent = text;
      statusNode.classList.toggle('is-error', !!isError);
    }

    function request(method, path, body) {
      return fetch(api + path, {
        method: method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-crv-csrf': csrfToken },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok || !data) throw new Error(data && data.error ? data.error : T('metrics.error'));
          return data;
        });
      });
    }

    function schedulePreview() {
      if (previewTimer) window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(function () {
        var id = ++previewRequest;
        request('POST', '/preview', current()).then(function (data) {
          if (id === previewRequest && preview) preview.textContent = data.preview;
        }, function (error) {
          if (id === previewRequest) status(error.message, true);
        });
      }, 180);
    }

    function sync(fromUser) {
      var policy = current();
      crawlers.forEach(function (input) {
        var row = input.closest('.robots-crawler');
        if (row) row.classList.toggle('is-blocked', !input.checked);
        var label = row && row.querySelector('[data-crawler-state]');
        if (label) label.textContent = T(input.checked ? 'metrics.robotsAllowed' : 'metrics.robotsBlocked');
      });
      if (countNode) countNode.textContent = T('metrics.robotsBlockedCount', { n: numberFormat.format(policy.blocked.length) });
      if (allowAll) allowAll.disabled = policy.blocked.length === 0;
      var dirty = fingerprint(policy) !== saved;
      if (dirtyNode) dirtyNode.hidden = !dirty;
      if (saveButton) saveButton.disabled = !dirty;
      if (fromUser) { status(''); schedulePreview(); }
    }

    form.addEventListener('change', function (event) {
      if (event.target.matches('[data-signal], [data-crawler]')) sync(true);
    });
    if (allowAll) {
      allowAll.addEventListener('click', function () {
        crawlers.forEach(function (input) { input.checked = true; });
        sync(true);
      });
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (saveButton) saveButton.disabled = true;
      request('PUT', '', current()).then(function (data) {
        saved = fingerprint(data.policy);
        if (preview) preview.textContent = data.preview;
        sync(false);
        status(T('metrics.robotsSaved'));
        document.dispatchEvent(new CustomEvent('herra:robots-saved'));
      }, function (error) {
        status(error.message, true);
        sync(false);
      });
    });
    // Salir con cambios sin guardar pediría confirmación al navegador.
    window.addEventListener('beforeunload', function (event) {
      if (fingerprint(current()) === saved) return;
      event.preventDefault();
      event.returnValue = '';
    });
    sync(false);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-metrics-root]'), initDashboard);
  Array.prototype.forEach.call(document.querySelectorAll('[data-robots-policy]'), initRobotsPolicy);
})();
