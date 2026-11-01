// CRV · actividades propias en el roadmap estático.
//
// El documento público es el de la portada; este script añade el control de
// estado únicamente a las actividades asignadas a la cuenta que inició sesión.
// La API comprueba la asignación otra vez: el navegador no decide permisos.
(function () {
  "use strict";
  var list = document.querySelector("[data-roadmap-category-list]");
  if (!list) return;
  var lang = document.documentElement.lang === "en" ? "en" : "es";
  var labels = lang === "en"
    ? { pending: "Pending", in_progress: "In progress", completed: "Completed", error: "Could not save." }
    : { pending: "Pendiente", in_progress: "En curso", completed: "Completada", error: "No se pudo guardar." };
  var csrf = "";
  var mine = new Map();

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function selectFor(task) {
    var options = ["pending", "in_progress", "completed"].map(function (status) {
      return '<option value="' + status + '"' + (task.status === status ? " selected" : "") + ">" + labels[status] + "</option>";
    }).join("");
    return '<select class="task-status-control" data-collab-status="' + esc(task.id) + '" aria-label="' +
      (lang === "en" ? "Status of " : "Estado de ") + esc(task.title) + '">' + options + "</select>";
  }
  function apply() {
    mine.forEach(function (task) {
      var row = list.querySelector('[data-task-id="' + task.id + '"]');
      if (!row || row.querySelector("[data-collab-status]")) return;
      var meta = row.querySelector(".task-meta");
      if (!meta) return;
      meta.innerHTML = selectFor(task);
      row.classList.add("task--editable");
    });
  }
  function updateRow(task, status) {
    var row = list.querySelector('[data-task-id="' + task.id + '"]');
    if (!row) return;
    row.classList.remove("task--pending", "task--in_progress", "task--completed");
    row.classList.add("task--" + status);
    var control = row.querySelector("[data-collab-status]");
    if (control) control.value = status;
    var text = row.querySelector(".task-text");
    if (text) text.setAttribute("title", task.title);
  }
  function save(select) {
    var id = Number(select.getAttribute("data-collab-status"));
    var task = mine.get(id);
    if (!task) return;
    select.disabled = true;
    fetch(new URL("../api/roadmap/tasks/" + id + "/status", document.baseURI), {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json", "Content-Type": "application/json",
        "x-crv-csrf": csrf || sessionStorage.getItem("crv-csrf") || "",
      },
      body: JSON.stringify({ status: select.value }),
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) throw new Error(data && data.error && data.error.message ? data.error.message : labels.error);
        return data;
      });
    }).then(function (data) {
      task.status = data.status || select.value;
      task.title = data.title || task.title;
      updateRow(task, task.status);
    }).catch(function (problem) {
      select.value = task.status;
      select.setAttribute("title", problem && problem.message ? problem.message : labels.error);
      select.classList.add("is-error");
    }).finally(function () {
      select.disabled = false;
    });
  }

  list.addEventListener("change", function (event) {
    var select = event.target.closest ? event.target.closest("[data-collab-status]") : null;
    if (select) save(select);
  });

  var observer = new MutationObserver(function () { apply(); });
  observer.observe(list, { childList: true, subtree: true });

  fetch(new URL("../api/roadmap/me", document.baseURI), {
    credentials: "include", headers: { Accept: "application/json" },
  }).then(function (response) {
    if (!response.ok) return null;
    return response.json();
  }).then(function (data) {
    if (!data || !Array.isArray(data.tasks)) return;
    csrf = data.csrf || "";
    if (csrf) {
      try { sessionStorage.setItem("crv-csrf", csrf); } catch (_) { /* sin almacenamiento */ }
    }
    data.tasks.forEach(function (task) { mine.set(Number(task.id), task); });
    apply();
  }).catch(function () { /* visitante: el roadmap sigue siendo solo lectura */ });
})();
