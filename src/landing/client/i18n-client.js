// Idioma en el navegador. Los textos llegan ya traducidos desde el servidor en
// data-messages del <body>, así que el cliente no negocia nada ni pide otro
// archivo: solo busca la clave e interpola. Si falta una clave devuelve la
// propia clave, igual que en el servidor, para que el hueco se vea.
(function () {
  'use strict';

  var messages = {};
  try {
    messages = JSON.parse(document.body.dataset.messages || '{}') || {};
  } catch (error) {
    messages = {};
  }

  function translate(key, vars) {
    var template = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
    });
  }

  window.HerraI18n = {
    lang: document.documentElement.lang || 'es',
    // Locale de fechas: coincide con el que usa el servidor para el mismo idioma.
    dateLocale: (document.documentElement.lang || 'es') === 'en' ? 'en-US' : 'es-VE',
    t: translate,
  };
})();
