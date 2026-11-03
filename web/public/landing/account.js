/* global document, window, history, URL, fetch */
// TEMPORAL-PORTADA · «Mi perfil» 1:1 de Herra. Un solo botón guarda perfil, enlaces
// y clave; al terminar se recarga como el POST de Herra para repintar los avisos.
// Ver docs/independencia/PUERTA-TEMPORAL.md.
(function () {
  "use strict";
  var form = document.querySelector(".account-form");
  if (!form) return;
  var en = document.documentElement.lang === "en";

  var url = new URL(window.location.href);
  if (url.searchParams.has("saved")) {
    url.searchParams.delete("saved");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  var error = document.createElement("p");
  error.className = "login-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  form.parentNode.insertBefore(error, form);

  function value(name) {
    var field = form.elements[name];
    return field ? String(field.value || "") : undefined;
  }
  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    error.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function payload() {
    var body = { firstName: value("firstName") || "", lastName: value("lastName") || "" };
    ["birthDate", "whatsappPhone", "email", "contactPreference", "city", "country", "bio", "experience", "availability", "profileVisibility"]
      .forEach(function (name) { var text = value(name); if (text !== undefined) body[name] = text; });
    if (form.querySelector('[name="termIds"]')) {
      body.termIds = Array.prototype.map.call(form.querySelectorAll('[name="termIds"]:checked'), function (box) { return Number(box.value); });
    }
    var rows = form.querySelectorAll(".link-row");
    if (rows.length) {
      body.links = [];
      Array.prototype.forEach.call(rows, function (row) {
        var link = row.querySelector('[name="linkUrl"]').value.trim();
        if (!link) return;
        body.links.push({
          type: row.querySelector('[name="linkType"]').value,
          label: row.querySelector('[name="linkLabel"]').value,
          url: link,
          isPublic: row.querySelector('[name="linkPublic"]').checked,
        });
      });
    }
    ["currentAccessCode", "newAccessCode", "newAccessCodeConfirm"].forEach(function (name) {
      var code = value(name);
      if (code) body[name] = code;
    });
    return body;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');
    var csrf = document.querySelector('meta[name="csrf-token"]');
    error.hidden = true;
    if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
    fetch(new URL("api/account/save", document.baseURI), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-crv-csrf": csrf ? csrf.content : "" },
      body: JSON.stringify(payload()),
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          if (response.status === 401) { window.location.assign(new URL("login", document.baseURI).href); return null; }
          throw new Error(data && data.error && data.error.message ? data.error.message : (en ? "Your changes could not be saved." : "No se pudieron guardar los cambios."));
        }
        return data;
      });
    }).then(function (data) {
      if (!data) return;
      var next = new URL("account", document.baseURI);
      next.searchParams.set("saved", data.saved);
      if (en) next.searchParams.set("lang", "en");
      window.location.assign(next.href);
    }).catch(function (problem) {
      showError(problem && problem.message ? problem.message : (en ? "Your changes could not be saved." : "No se pudieron guardar los cambios."));
    }).finally(function () {
      if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
    });
  });
})();
