(function () {
  "use strict";
  var lang = document.documentElement.lang === "en" ? "en" : "es";
  var labels = {
    es: { phase: "Fase", completed: "Completada", pending: "Pendiente", progress: "En curso", doneWord: "completadas", remainingWord: "por completar", complete: "completado", perPage: "por página", all: "Ver todas", updated: "Última actualización:" },
    en: { phase: "Phase", completed: "Completed", pending: "Pending", progress: "In progress", doneWord: "completed", remainingWord: "remaining", complete: "complete", perPage: "per page", all: "See all", updated: "Last updated:" }
  }[lang];
  var state = new Map();
  var signature = "";
  var apiUrl = new URL("../api/roadmap", window.location.href).toString();
  var list = document.querySelector("[data-roadmap-category-list]");
  if (!list) return;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function pct(value) { return Math.round(Number(value) || 0); }
  function pageState(slug) {
    if (!state.has(slug)) state.set(slug, { size: 5, page: 1 });
    return state.get(slug);
  }
  function range(start, end, total) {
    return lang === "en" ? start + "–" + end + " of " + total : start + "–" + end + " de " + total;
  }
  function icon(status) {
    return status === "completed" ? "circle-check-big" : status === "in_progress" ? "clock" : "circle";
  }
  function statusLabel(status) {
    return status === "completed" ? labels.completed : status === "in_progress" ? labels.progress : labels.pending;
  }
  function taskHtml(task) {
    return '<li class="task task--' + esc(task.status) + '" data-task-id="' + esc(task.id) + '">' +
      '<span class="task-glyph"><i data-lucide="' + icon(task.status) + '"></i></span>' +
      '<span class="task-text">' + esc(task.title) + "</span>" +
      '<span class="task-meta"><span class="task-status task-status--' + esc(task.status) + '">' + statusLabel(task.status) + "</span></span>" +
      "</li>";
  }
  function options(selected) {
    return [5, 10, 15, 20, 25].map(function (value) {
      return '<option value="' + value + '"' + (value === selected ? " selected" : "") + ">" + value + " " + labels.perPage + "</option>";
    }).join("") + '<option value="all"' + (selected === "all" ? " selected" : "") + ">" + labels.all + "</option>";
  }
  function blockHtml(category, index) {
    var current = pageState(category.slug);
    var total = category.tasks.length;
    var size = current.size === "all" ? Math.max(1, total) : current.size;
    var pages = Math.max(1, Math.ceil(total / size));
    var page = Math.min(current.page, pages);
    current.page = page;
    var start = (page - 1) * size;
    var visible = category.tasks.slice(start, start + size);
    var completed = category.progress.completed;
    var remaining = Math.max(0, category.progress.total - completed);
    var percent = pct(category.progress.percentage);
    var color = category.colorKey || "red";
    return '<div class="cat-block cat-block--' + esc(color) + '" data-cat-slug="' + esc(category.slug) + '">' +
      '<div class="section-head roadmap-card__head"><div class="roadmap-card__title">' +
      '<span class="kicker kicker--' + esc(color) + '">' + labels.phase + " " + String(index).padStart(2, "0") + "</span>" +
      '<h2 class="cat-title">' + esc(category.title) + "</h2></div>" +
      '<div class="record-total record-total--' + esc(color) + '"><strong>' + percent + '%</strong><span>' + labels.complete + "</span></div></div>" +
      '<div class="roadmap-card__progress-meta"><span>' + completed + " de " + category.progress.total + " " + labels.doneWord + "</span><span>" + remaining + " " + labels.remainingWord + "</span></div>" +
      '<div aria-label="Progreso de ' + esc(category.title) + '" aria-valuemax="100" aria-valuemin="0" aria-valuenow="' + percent + '" class="pbar pbar--' + esc(color) + '" role="progressbar"><div class="pbar-fill pbar-fill--' + esc(color) + '" style="--fill: ' + Number(category.progress.percentage).toFixed(2) + '%"></div></div>' +
      '<ul class="task-list">' + (visible.length ? visible.map(taskHtml).join("") : '<li class="task"><span class="task-text">' + (lang === "en" ? "No activities in this stage." : "Todavía no hay actividades en esta etapa.") + "</span></li>") + "</ul>" +
      '<nav aria-label="Paginación de ' + esc(category.title) + '" class="roadmap-pagination roadmap-pagination--' + esc(color) + '" data-cat-slug="' + esc(category.slug) + '">' +
      '<div class="roadmap-pagination__size"><label class="visually-hidden" for="roadmap-pagesize-' + esc(category.slug) + '">' + (lang === "en" ? "Activities per page in " : "Actividades por página en ") + esc(category.title) + '</label>' +
      '<select data-roadmap-page-size="" id="roadmap-pagesize-' + esc(category.slug) + '">' + options(current.size) + "</select></div>" +
      '<div class="roadmap-pagination__nav"><button aria-label="' + (lang === "en" ? "Previous page of " : "Página anterior de ") + esc(category.title) + '" class="roadmap-page-btn" data-roadmap-page-prev="" type="button"' + (page <= 1 ? " disabled" : "") + '><i data-lucide="arrow-left"></i></button>' +
      '<span aria-live="polite" class="roadmap-pagination__status" data-roadmap-page-status="">' + range(total ? start + 1 : 0, Math.min(start + size, total), total) + "</span>" +
      '<button aria-label="' + (lang === "en" ? "Next page of " : "Página siguiente de ") + esc(category.title) + '" class="roadmap-page-btn" data-roadmap-page-next="" type="button"' + (page >= pages ? " disabled" : "") + '><i data-lucide="arrow-right"></i></button></div></nav></div>';
  }
  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }
  function staticConsistent(view) {
    var blocks = Array.prototype.slice.call(list.querySelectorAll(".cat-block"));
    var categories = view.categories || [];
    if (blocks.length !== categories.length) return false;
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      var category = categories[i];
      if (block.getAttribute("data-cat-slug") !== category.slug) return false;
      var title = block.querySelector(".cat-title");
      if (title && title.textContent.trim() !== category.title) return false;
      var rows = block.querySelectorAll(".task");
      if (rows.length !== category.tasks.length) return false;
      var first = rows[0] && rows[0].querySelector(".task-text");
      if (first && category.tasks[0] && first.textContent.trim() !== category.tasks[0].title) return false;
    }
    return true;
  }
  function apply(view) {
    var overall = view.overall || {};
    var total = Number(overall.total) || 0;
    var completed = Number(overall.completed) || 0;
    var remaining = Math.max(0, total - completed);
    var percent = pct(overall.percentage);
    var set = function (selector, text) { var el = document.querySelector(selector); if (el) el.textContent = text; };
    set("#overallPct", percent + "%");
    set("#overallTotal", total);
    set("#overallCompleted", completed);
    set("#overallRemaining", remaining);
    var meta = document.querySelector(".overall-meta p");
    if (meta) meta.textContent = completed + " " + labels.doneWord + " · " + remaining + " " + (lang === "en" ? "remaining" : "faltantes");
    var overallBar = document.querySelector(".pbar-overall");
    if (overallBar) overallBar.setAttribute("aria-valuenow", String(percent));
    var overallFill = document.querySelector(".pbar-overall .pbar-fill");
    if (overallFill) overallFill.style.setProperty("--fill", Number(overall.percentage).toFixed(2) + "%");
    var stats = document.querySelectorAll(".roadmap-heading__stats dd");
    if (stats[0]) stats[0].textContent = String((view.categories || []).length);
    if (stats[1]) stats[1].textContent = String(total);
    if (stats[2]) stats[2].textContent = String(view.collaborators == null ? 0 : view.collaborators);
    var last = document.querySelector(".last-updated");
    if (last && view.lastUpdated) {
      var date = new Date(String(view.lastUpdated).replace(" ", "T") + "Z");
      var previous = last.querySelector("time");
      if (!previous || previous.getAttribute("datetime") !== date.toISOString()) {
        var formatted = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Caracas" }).format(date);
        last.innerHTML = esc(labels.updated) + ' <time datetime="' + date.toISOString() + '">' + esc(formatted) + "</time>";
      }
    }
    var nextSignature = JSON.stringify((view.categories || []).map(function (category) {
      return [category.slug, category.title, category.progress, category.tasks.map(function (task) { return [task.title, task.status]; })];
    }));
    if (signature === "" && staticConsistent(view)) {
      signature = nextSignature;
    } else if (nextSignature !== signature) {
      signature = nextSignature;
      list.innerHTML = (view.categories || []).map(blockHtml).join("");
      refreshIcons();
    }
  }
  function findBlock(target) { return target && target.closest ? target.closest(".cat-block") : null; }
  document.addEventListener("change", function (event) {
    var select = event.target.closest ? event.target.closest("[data-roadmap-page-size]") : null;
    if (!select) return;
    var block = findBlock(select);
    if (!block) return;
    var current = pageState(block.dataset.catSlug);
    current.size = select.value === "all" ? "all" : Number(select.value);
    current.page = 1;
    renderFromLast();
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("[data-roadmap-page-prev],[data-roadmap-page-next]") : null;
    if (!button) return;
    var block = findBlock(button);
    if (!block) return;
    var current = pageState(block.dataset.catSlug);
    current.page += button.hasAttribute("data-roadmap-page-next") ? 1 : -1;
    if (current.page < 1) current.page = 1;
    renderFromLast();
  });
  var lastView = null;
  function renderFromLast() {
    if (!lastView) return;
    list.innerHTML = (lastView.categories || []).map(blockHtml).join("");
    refreshIcons();
  }
  function load() {
    fetch(apiUrl, { headers: { Accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (view) { if (!view) return; lastView = view; apply(view); })
      .catch(function () {});
  }
  list.classList.remove("roadmap-category-list--deferred");
  load();
  window.setInterval(load, 15000);
})();
