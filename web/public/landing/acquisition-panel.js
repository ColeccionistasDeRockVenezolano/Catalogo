// Panel de procedencia. Datos siempre como texto, incluidos nombres y códigos de campañas.
(function () {
  'use strict';
  var english = document.documentElement.lang === 'en';
  function t(es, en) { return english ? en : es; }
  var nf = new Intl.NumberFormat(english ? 'en-US' : 'es-VE');
  function node(tag, cls, text) {
    var item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function button(label, action, cls) {
    var item = node('button', cls || 'metrics-icon-btn', label); item.type = 'button';
    item.addEventListener('click', action); return item;
  }
  function labeled(label, input) {
    var wrap = node('label', 'acquisition-field'); wrap.appendChild(node('span', '', label)); wrap.appendChild(input); return wrap;
  }
  function select(options, value) {
    var input = node('select'); options.forEach(function (option) {
      var item = node('option', '', option[1]); item.value = option[0]; input.appendChild(item);
    }); input.value = value; return input;
  }
  function textInput(max) { var input = node('input'); input.type = 'text'; input.maxLength = max || 80; return input; }
  function table(headings, label) {
    var wrap = node('div', 'metrics-table-wrap acquisition-table'); wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label);
    var tab = node('table', 'metrics-table'); var head = node('thead'); var tr = node('tr');
    headings.forEach(function (heading, index) { var th = node('th', index ? 'is-num' : '', heading); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); tab.appendChild(head); var body = node('tbody'); tab.appendChild(body); wrap.appendChild(tab);
    return { wrap: wrap, body: body };
  }
  function sourceName(value) {
    return ({ direct: t('Directo / desconocido', 'Direct / unknown'), 'unregistered-link': t('Enlace no registrado', 'Unregistered link') })[value] || value;
  }
  var pageNames = { roadmap: t('Portada', 'Home'), collaborate: t('Colaborar', 'Collaborate'), login: t('Entrar', 'Sign in'), register: t('Registro', 'Register'), activate: t('Activación', 'Activation') };
  var countKeys = ['visitors', 'js_visitors', 'pages', 'requests', 'collaborate', 'radio', 'applications'];
  var columns = [t('Procedencia', 'Origin'), t('Visitantes/día', 'Visitors/day'), t('Con JS', 'With JS'),
    t('Páginas JS', 'JS pages'), t('Solicitudes', 'Requests'), t('Colaborar', 'Collaborate'), t('Radio', 'Radio'), t('Candidaturas', 'Applications')];

  window.CRVAcquisitionPanel = function (root, report) {
    var block = node('section', 'metrics-card acquisition'); block.dataset.acquisitionPanel = '';
    block.appendChild(node('h3', 'metrics-card__title', t('De dónde vienen', 'Where visitors come from')));
    block.appendChild(node('p', 'metrics-card__sub', report.since
      ? t('Procedencia medida desde ', 'Origins measured since ') + report.since + t(' · Día de Caracas', ' · Caracas day')
      : t('La medición comienza con las próximas visitas. Las visitas anteriores no tienen procedencia recuperable.', 'Measurement starts with new visits. Earlier origins cannot be recovered.')));
    var prefs = root.acquisitionPrefs || (root.acquisitionPrefs = { group: 'source', category: 'human', search: '', page: 0 });
    var linksByCode = {};
    report.links.forEach(function (link) { linksByCode[link.code] = link; });
    var controls = node('div', 'acquisition-controls');
    var group = select([['source', t('Fuentes', 'Sources')], ['campaign', t('Campañas', 'Campaigns')], ['ref', t('Enlaces', 'Links')],
      ['referrer', t('Webs referentes', 'Referring websites')], ['landing', t('Páginas de entrada', 'Entry pages')], ['country', t('Países', 'Countries')]], prefs.group);
    var category = select([['human', t('Personas probables', 'Likely people')], ['automated', t('Bots, IA y buscadores', 'Bots, AI and search engines')],
      ['suspicious', t('Sospechosos', 'Suspicious')], ['all', t('Todo el tráfico', 'All traffic')]], prefs.category);
    var search = node('input'); search.type = 'search'; search.maxLength = 100; search.value = prefs.search;
    controls.appendChild(labeled(t('Agrupar por', 'Group by'), group));
    controls.appendChild(labeled(t('Tipo de tráfico', 'Traffic type'), category));
    controls.appendChild(labeled(t('Buscar fuente o campaña', 'Search sources or campaigns'), search)); block.appendChild(controls);
    var summary = node('p', 'acquisition-summary'); summary.setAttribute('aria-live', 'polite'); block.appendChild(summary);
    var listing = table(columns, t('Procedencias y acciones; desplaza para ver todas las columnas', 'Origins and actions; scroll for all columns'));
    block.appendChild(listing.wrap);
    var empty = node('p', 'metrics-empty'); block.appendChild(empty);
    var foot = node('div', 'acquisition-pagination');
    var prev = button(t('Anterior', 'Previous'), function () { prefs.page -= 1; render(); });
    var page = node('span'); var next = button(t('Siguiente', 'Next'), function () { prefs.page += 1; render(); });
    foot.appendChild(prev); foot.appendChild(page); foot.appendChild(next); block.appendChild(foot);
    var filtered = [];
    function labelFor(d) {
      var value = d[prefs.group];
      if (prefs.group === 'source') return sourceName(value);
      if (prefs.group === 'ref') return value ? (linksByCode[value] ? linksByCode[value].label + ' · ' + value : value) : t('Sin enlace etiquetado', 'No tagged link');
      if (prefs.group === 'landing') return pageNames[value] || value;
      if (prefs.group === 'country') {
        if (value === 'zz') return t('Desconocido', 'Unknown');
        try { return new Intl.DisplayNames([english ? 'en' : 'es'], { type: 'region' }).of(value.toUpperCase()); } catch (error) { return value; }
      }
      return value || t('Sin dato', 'No data');
    }
    function render() {
      var grouped = new Map(); var term = prefs.search.toLocaleLowerCase();
      report.rows.forEach(function (row) {
        var d = row.dimensions;
        if (prefs.category === 'automated' ? ['ai', 'search', 'bot'].indexOf(d.category) < 0 : prefs.category !== 'all' && d.category !== prefs.category) return;
        var label = labelFor(d);
        if (term && (label + ' ' + Object.values(d).join(' ')).toLocaleLowerCase().indexOf(term) < 0) return;
        var key = d[prefs.group] || '';
        var item = grouped.get(key) || { label: label, visitors: 0, js_visitors: 0, pages: 0, requests: 0, collaborate: 0, radio: 0, applications: 0 };
        countKeys.forEach(function (count) { item[count] += Number(row[count]) || 0; }); grouped.set(key, item);
      });
      filtered = Array.from(grouped.values()).sort(function (a, b) { return b.visitors - a.visitors || a.label.localeCompare(b.label); });
      var pages = Math.max(1, Math.ceil(filtered.length / 15)); prefs.page = Math.max(0, Math.min(prefs.page, pages - 1));
      var totals = filtered.reduce(function (sum, item) { countKeys.forEach(function (key) { sum[key] = (sum[key] || 0) + item[key]; }); return sum; }, {});
      summary.textContent = nf.format(totals.visitors || 0) + t(' visitantes/día · ', ' visitors/day · ') + nf.format(totals.applications || 0) + t(' con candidatura enviada', ' with a submitted application');
      listing.body.textContent = '';
      filtered.slice(prefs.page * 15, (prefs.page + 1) * 15).forEach(function (item) {
        var row = node('tr'); var th = node('th', '', item.label); th.scope = 'row'; row.appendChild(th);
        countKeys.forEach(function (key) { row.appendChild(node('td', 'is-num', nf.format(item[key]))); }); listing.body.appendChild(row);
      });
      empty.hidden = filtered.length > 0; empty.textContent = t('No hay visitas para estos filtros. Comparte un enlace de campaña y consulta de nuevo.', 'No visits match these filters. Share a campaign link and check again.');
      listing.wrap.hidden = !filtered.length; foot.hidden = filtered.length <= 15;
      prev.disabled = prefs.page === 0; next.disabled = prefs.page >= pages - 1;
      page.textContent = (prefs.page + 1) + ' / ' + pages;
    }
    [group, category, search].forEach(function (control) { control.addEventListener(control === search ? 'input' : 'change', function () {
      prefs.group = group.value; prefs.category = category.value; prefs.search = search.value; prefs.page = 0; render();
    }); });
    var csv = button(t('Descargar CSV', 'Download CSV'), function () {
      function cell(value) { var safe = String(value); if (/^[=+@\-\t\r]/.test(safe)) safe = "'" + safe; return '"' + safe.replace(/"/g, '""') + '"'; }
      var lines = [columns.map(cell).join(',')];
      filtered.forEach(function (item) { lines.push([item.label].concat(countKeys.map(function (key) { return item[key]; })).map(cell).join(',')); });
      var url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      var download = node('a'); download.href = url; download.download = 'crv-procedencia-' + report.from + '_' + report.to + '-' + prefs.category + '-' + prefs.group + '.csv'; download.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }); block.appendChild(csv);
    var help = node('details', 'acquisition-help'); help.appendChild(node('summary', '', t('Cómo interpretar estos datos', 'How to read these figures')));
    help.appendChild(node('p', '', t('Primera procedencia observada del día, sin cookies. Una huella cuenta una vez por día y tipo de agente; una conexión compartida puede reunir personas y herramientas. Los días y tipos no identifican personas únicas. «Con JS» tampoco demuestra que sea una persona.', 'First observed origin each day, without cookies. A fingerprint counts once per day and agent type; a shared connection may include people and tools. Days and types do not identify unique people. Running JS does not prove a visitor is human.')));
    help.appendChild(node('p', '', t('Colaborar y Radio cuentan visitantes/día que pulsaron sus controles; Radio no mide escucha ni minutos. Candidaturas cuenta visitantes/día con un envío confirmado. Directo/desconocido incluye aplicaciones que ocultan el referente. Las etiquetas UTM son declaradas; un enlace reenviado conserva su campaña.', 'Collaborate and Radio count visitors/day clicking those controls; Radio does not measure listening or minutes. Applications counts visitors/day with a confirmed submission. Direct/unknown includes apps hiding the referrer. UTM tags are declared; forwarded links retain their campaign.')));
    help.appendChild(node('p', '', t('Se guardan etiquetas, dominio referente, país, página y conteos. Las huellas y recibos se eliminan tras 3 días; los agregados, tras 400 días. No se guardan IPs, agentes de navegador ni URLs completas.', 'Stores tags, referring domain, country, page and counts. Fingerprints and receipts expire after 3 days; aggregates after 400 days. No IPs, browser agents or full URLs are stored.'))); block.appendChild(help);
    render();
    block.appendChild(linkManager(root, report)); return block;
  };

  function linkManager(root, report) {
    var wrap = node('section', 'acquisition-links');
    wrap.appendChild(node('h4', '', t('Enlaces de campaña', 'Campaign links')));
    wrap.appendChild(node('p', 'metrics-card__sub', t('Crea un enlace para cada lugar donde compartas la web. Archivar lo oculta de la lista activa y conserva sus estadísticas y funcionamiento.', 'Create a link for each place you share the site. Archiving hides it from the active list while retaining its statistics and function.')));
    var status = node('p', 'acquisition-status'); status.setAttribute('role', 'status'); wrap.appendChild(status);
    var endpoint = root.dataset.metricsUrl + '/links';
    var mayEdit = root.dataset.linksEdit === 'true';
    var origin;
    try { origin = new URL(root.dataset.publicOrigin); if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password) throw new Error(); }
    catch (error) { origin = new URL(window.location.origin); }
    function publicLink(link) { var url = new URL(link.destination, origin); url.searchParams.set('ref', link.code); return url.href; }
    function request(method, suffix, body) {
      return fetch(endpoint + suffix, { method: method, credentials: 'same-origin', headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'x-crv-csrf': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
      }, body: JSON.stringify(body) }).then(function (response) { return response.json().then(function (data) {
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : t('No se pudo guardar el enlace.', 'Could not save the link.')); return data;
      }); });
    }
    var archivedLabel = node('label', 'acquisition-archived'); var archived = node('input'); archived.type = 'checkbox';
    archivedLabel.appendChild(archived); archivedLabel.appendChild(node('span', '', t('Mostrar archivados', 'Show archived'))); wrap.appendChild(archivedLabel);
    var list = node('ul', 'acquisition-link-list'); wrap.appendChild(list);
    function renderLinks() {
      list.textContent = '';
      var links = report.links.filter(function (link) { return archived.checked || !link.archived; });
      if (!links.length) list.appendChild(node('li', 'metrics-empty', t('Todavía no hay enlaces activos. Crea el primero para empezar a medir tus campañas.', 'No active links yet. Create your first link to start measuring campaigns.')));
      links.forEach(function (link) {
        var li = node('li'); var content = node('div', 'acquisition-link-info');
        content.appendChild(node('strong', '', link.label + (link.archived ? t(' · Archivado', ' · Archived') : '')));
        content.appendChild(node('span', '', [link.source, link.medium, link.campaign].filter(Boolean).join(' · ')));
        var input = node('input'); input.readOnly = true; input.value = publicLink(link); input.setAttribute('aria-label', t('Enlace de ', 'Link for ') + link.label);
        input.addEventListener('focus', function () { input.select(); }); content.appendChild(input); li.appendChild(content);
        var actions = node('div', 'acquisition-link-actions');
        var copy = button(t('Copiar enlace', 'Copy link'), function () {
          if (!navigator.clipboard || !navigator.clipboard.writeText) { input.focus(); input.select(); status.textContent = t('Enlace seleccionado. Cópialo con el menú o Ctrl/Cmd+C.', 'Link selected. Copy it using the menu or Ctrl/Cmd+C.'); return; }
          navigator.clipboard.writeText(input.value).then(function () { status.textContent = t('Enlace copiado.', 'Link copied.'); }).catch(function () { input.focus(); input.select(); status.textContent = t('Enlace seleccionado para copiar.', 'Link selected for copying.'); });
        }); actions.appendChild(copy);
        if (mayEdit) {
          var archive = button(link.archived ? t('Restaurar', 'Restore') : t('Archivar', 'Archive'), function () {
            archive.disabled = true;
            request('PATCH', '/' + link.id, { archived: !link.archived }).then(function () {
              link.archived = !link.archived; renderLinks(); status.textContent = t('Enlace actualizado.', 'Link updated.');
            }).catch(function (error) { archive.disabled = false; status.textContent = error.message; });
          }); actions.appendChild(archive);
        }
        li.appendChild(actions); list.appendChild(li);
      });
    }
    archived.addEventListener('change', renderLinks); renderLinks();
    if (!mayEdit) { wrap.appendChild(node('p', 'metrics-card__sub', t('Solo administración total puede crear o archivar enlaces.', 'Only full administrators can create or archive links.'))); return wrap; }
    var details = node('details', 'acquisition-create'); details.appendChild(node('summary', '', t('Crear enlace de campaña', 'Create campaign link')));
    var form = node('form', 'acquisition-form'); var fields = {};
    [['label', t('Nombre del enlace', 'Link name'), 100], ['code', t('Código único', 'Unique code'), 64],
      ['source', t('Fuente: whatsapp, instagram…', 'Source: whatsapp, instagram…'), 80], ['medium', t('Medio: social, grupo, qr…', 'Medium: social, group, qr…'), 80],
      ['campaign', t('Campaña (opcional)', 'Campaign (optional)'), 80], ['content', t('Variante (opcional)', 'Variant (optional)'), 80]].forEach(function (entry) {
        var input = textInput(entry[2]); input.name = entry[0]; input.required = ['label', 'code', 'source'].indexOf(entry[0]) >= 0;
        if (entry[0] === 'code') { input.pattern = '[a-z0-9][a-z0-9_-]{1,63}'; input.title = t('Entre 2 y 64 letras minúsculas, números, guiones o guiones bajos.', '2–64 lowercase letters, numbers, hyphens or underscores.'); }
        fields[entry[0]] = input; form.appendChild(labeled(entry[1], input));
      });
    fields.destination = select([['/', t('Portada', 'Home')], ['/colaborar', t('Colaborar', 'Collaborate')]], '/');
    form.appendChild(labeled(t('Destino', 'Destination'), fields.destination));
    var preview = node('output', 'acquisition-preview'); preview.setAttribute('aria-label', t('Vista previa del enlace', 'Link preview'));
    function updatePreview() { preview.textContent = publicLink({ destination: fields.destination.value, code: fields.code.value || 'codigo' }); }
    form.addEventListener('input', updatePreview); updatePreview(); form.appendChild(preview);
    var submit = node('button', 'btn btn-red', t('Crear enlace', 'Create link')); submit.type = 'submit'; form.appendChild(submit);
    var errorBox = node('p', 'acquisition-form-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true; form.appendChild(errorBox);
    form.addEventListener('submit', function (event) {
      event.preventDefault(); if (submit.disabled) return;
      var body = {}; Object.keys(fields).forEach(function (key) { body[key] = fields[key].value.trim(); });
      submit.disabled = true; submit.textContent = t('Creando…', 'Creating…'); errorBox.hidden = true;
      request('POST', '', body).then(function (data) {
        report.links.unshift(data.link); renderLinks(); form.reset(); updatePreview();
        status.textContent = t('Enlace creado. Ya puedes copiarlo y compartirlo.', 'Link created. You can copy and share it now.'); details.open = false;
      }).catch(function (error) { errorBox.textContent = error.message; errorBox.hidden = false; })
        .finally(function () { submit.disabled = false; submit.textContent = t('Crear enlace', 'Create link'); });
    }); details.appendChild(form); wrap.appendChild(details); return wrap;
  }
}());
