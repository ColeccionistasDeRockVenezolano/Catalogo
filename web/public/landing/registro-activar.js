/* global document, window */
// Registro e invitación usan las APIs de comunidad del catálogo.
(function () {
  "use strict";
  var form = document.querySelector(".login-form");
  if (!form) return;
  var isActivation = window.location.pathname.replace(/\/+$/, "").endsWith("/activar");
  var english = document.documentElement.lang === "en";
  var message = document.createElement("p");
  message.className = "login-error";
  message.setAttribute("role", "alert");
  message.hidden = true;
  form.prepend(message);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(form);
    var code = String(data.get("accessCode") || "");
    if (code !== String(data.get("accessCodeConfirm") || "")) {
      message.textContent = english ? "The passwords do not match." : "Las claves no coinciden.";
      message.hidden = false;
      return;
    }
    var payload = { token: String(data.get("token") || ""), name: String(data.get("name") || ""), accessCode: code };
    if (!isActivation) {
      payload.firstName = String(data.get("firstName") || "");
      payload.lastName = String(data.get("lastName") || "");
    }
    var button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    message.hidden = true;
    fetch(new URL("api/community/" + (isActivation ? "activate" : "register"), document.baseURI), {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error && body.error.message || (english ? "Could not complete the request." : "No se pudo completar la solicitud."));
      });
    }).then(function () {
      var done = document.createElement("p");
      done.className = "login-sub";
      done.textContent = isActivation
        ? (english ? "Your account is active. You can now sign in." : "Tu cuenta está activa. Ya puedes iniciar sesión.")
        : (english ? "Your registration was sent for approval." : "Tu registro se envió para aprobación.");
      var link = document.createElement("a");
      link.className = "btn btn-red btn-block";
      link.href = new URL("login", document.baseURI).href;
      link.textContent = english ? "Sign in" : "Entrar";
      form.replaceWith(done, link);
    }).catch(function (error) {
      message.textContent = error.message;
      message.hidden = false;
    }).finally(function () { if (button) button.disabled = false; });
  });
})();
