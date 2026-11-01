/* global document, window */
// La cabecera EJS cierra la misma sesión PostgreSQL que usa el catálogo.
(function () {
  "use strict";
  document.querySelectorAll('form[action="/logout"]').forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var csrf = document.querySelector('meta[name="csrf-token"]');
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      fetch(new URL("api/auth/logout", document.baseURI), {
        method: "POST", credentials: "include", headers: { "x-crv-csrf": csrf ? csrf.content : "" },
      }).then(function (response) {
        if (!response.ok) throw new Error("logout failed");
        window.location.assign(new URL("roadmap", document.baseURI).href);
      }).catch(function () {
        if (button) {
          button.disabled = false;
          button.title = document.documentElement.lang === "en" ? "Could not sign out." : "No se pudo cerrar la sesión.";
        }
      });
    });
  });
})();
