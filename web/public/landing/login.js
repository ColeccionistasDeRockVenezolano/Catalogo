// CRV · acceso de colaboradores desde el documento estático /login.
(function () {
  "use strict";
  var form = document.querySelector(".login-form");
  if (!form) return;
  var error = document.createElement("p");
  error.className = "login-sub";
  error.hidden = true;
  error.setAttribute("role", "alert");
  error.style.color = "var(--red, #d64545)";
  form.parentNode.insertBefore(error, form);

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var username = form.elements.name ? String(form.elements.name.value || "").trim() : "";
    var password = form.elements.accessCode ? String(form.elements.accessCode.value || "") : "";
    var button = form.querySelector('button[type="submit"]');
    if (!username || !password) {
      showError(document.documentElement.lang === "en" ? "Enter your username and passphrase." : "Escribe tu usuario y tu clave.");
      return;
    }
    if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
    error.hidden = true;
    fetch(new URL("../api/auth/login", document.baseURI), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password }),
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          var message = data && data.error && data.error.message ? data.error.message
            : (data && data.message ? data.message : "No pudimos entrar.");
          throw new Error(message);
        }
        return data || {};
      });
    }).then(function (data) {
      if (data.csrf) {
        try { sessionStorage.setItem("crv-csrf", data.csrf); } catch (_) { /* sin almacenamiento */ }
      }
      window.location.assign(new URL("../roadmap", document.baseURI).href);
    }).catch(function (problem) {
      showError(problem && problem.message ? problem.message : "No pudimos entrar.");
    }).finally(function () {
      if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
    });
  });
})();
