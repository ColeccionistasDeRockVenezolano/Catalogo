// CRV · envío del formulario de candidatura de la landing /colaborar.
(function () {
  "use strict";
  var form = document.getElementById("collaborateForm");
  if (!form) return;
  var statusEl = form.querySelector("[data-collab-status]");
  var submit = form.querySelector('button[type="submit"]');
  var api = new URL("api/community/applications", window.location.href);

  function text(name) {
    var field = form.elements[name];
    return field && "value" in field ? String(field.value || "").trim() : "";
  }
  function checked(name) {
    return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (input) {
      return Number(input.value);
    }).filter(function (value) { return Number.isFinite(value) && value > 0; });
  }
  function showError(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = false;
    statusEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function payload() {
    var data = new FormData(form);
    var types = data.getAll("linkType").map(String);
    var urls = data.getAll("linkUrl").map(String);
    var names = data.getAll("linkLabel").map(String);
    var links = [];
    urls.forEach(function (url, index) {
      var clean = url.trim();
      if (!clean) return;
      var link = { type: types[index] || "otro", url: clean };
      if (names[index] && names[index].trim()) link.label = names[index].trim();
      links.push(link);
    });
    return {
      firstName: text("firstName"), lastName: text("lastName"), birthDate: text("birthDate"),
      whatsappPhone: text("whatsappPhone"), email: text("email"), city: text("city"), country: text("country"),
      contactPreference: text("contactPreference"), experience: text("experience"),
      contributionText: text("contributionText"), idea: text("idea"), ideaReason: text("ideaReason"),
      wantsToImplement: text("wantsToImplement"), availability: text("availability"),
      skillIds: checked("skillIds"), areaIds: checked("areaIds"), links: links,
    };
  }
  function success(id, preference) {
    var en = document.documentElement.lang === "en";
    var number = Number(id) > 0 ? Number(id) : 0;
    var channel = preference === "email" ? (en ? "email" : "correo")
      : preference === "both" ? (en ? "WhatsApp or email" : "WhatsApp o correo")
      : "WhatsApp";
    var steps = en ? [
      "We read your application and review it carefully.",
      "If it fits, we write to you through the channel you chose.",
      "If we move forward, you will get a personal link to create your access to the project.",
    ] : [
      "Leemos tu candidatura y la revisamos con calma.",
      "Si encaja, te escribimos por la vía que elegiste para conversar.",
      "Si seguimos adelante, recibirás un enlace personal para crear tu acceso al proyecto.",
    ];
    var title = en ? "Application sent" : "Candidatura enviada";
    var registered = number
      ? (en ? ' Your application to <strong>Coleccionistas De Rock Venezolano</strong> was registered with number <strong>#' + number + "</strong>."
        : ' Tu candidatura a <strong>Coleccionistas De Rock Venezolano</strong> quedó registrada con el número <strong>#' + number + "</strong>.")
      : "";
    var body = en
      ? 'Thank you for writing to us.' + registered
      : 'Gracias por escribirnos.' + registered;
    var nextTitle = en ? "What happens next" : "Qué pasa después";
    var help = en
      ? 'We will get in touch by <strong>' + channel + '</strong>. There is nothing else you need to do.'
      : 'Te escribiremos por <strong>' + channel + '</strong>. No hace falta que hagas nada más.';
    document.body.className = "login-body";
    document.body.innerHTML =
      '<main class="login-main"><div class="login-card login-card--wide">' +
      '<span class="brand-logo brand-logo--lg" aria-hidden="true"><img src="landing/crv-logo.jpg" alt="" width="160" height="160"></span>' +
      '<h1>' + title + '</h1><p class="login-sub">' + body + '</p>' +
      '<section class="account-section"><h2>' + nextTitle + '</h2><ol class="collab-next-list">' +
      steps.map(function (step) { return "<li>" + step + "</li>"; }).join("") +
      '</ol><p class="field-help">' + help + '</p></section>' +
      '<a class="login-back" href="roadmap"><i data-lucide="arrow-left"></i> ' + (en ? "Back to the project" : "Volver al proyecto") + '</a>' +
      "</div></main>";
    document.title = title + " — Coleccionistas De Rock Venezolano";
    window.scrollTo(0, 0);
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (form.dataset.sending === "true") return;
    form.dataset.sending = "true";
    var preference = text("contactPreference");
    if (submit) { submit.disabled = true; submit.setAttribute("aria-busy", "true"); }
    fetch(api, {
      method: "POST", credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          var message = data && data.error && data.error.message ? data.error.message : (data && data.message ? data.message : "No pudimos enviar la candidatura.");
          throw new Error(message);
        }
        return data || {};
      });
    }).then(function (data) {
      success(data.id, preference);
    }).catch(function (error) {
      showError(error && error.message ? error.message : "No pudimos enviar la candidatura.");
    }).finally(function () {
      form.dataset.sending = "false";
      if (submit) { submit.disabled = false; submit.removeAttribute("aria-busy"); }
    });
  });
})();
