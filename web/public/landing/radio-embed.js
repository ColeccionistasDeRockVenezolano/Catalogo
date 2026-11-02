// CRV · Tarjeta de radio dentro del catálogo. El reproductor es el mismo de la
// portada (radio.js); aquí solo se le cuenta a la página que la contiene qué alto
// ocupa y si está en modo cine, porque un iframe no puede salirse de su caja.
(function () {
  'use strict';
  if (window.parent === window) return;
  var root = document.getElementById('radio');
  if (!root) return;
  function report() {
    window.parent.postMessage({
      type: 'crv-radio',
      cinema: root.classList.contains('is-cinema'),
      height: Math.ceil(root.getBoundingClientRect().height),
    }, window.location.origin);
  }
  new MutationObserver(report).observe(root, { attributes: true, attributeFilter: ['class'] });
  if (window.ResizeObserver) new ResizeObserver(report).observe(root);
  window.addEventListener('load', report);
  report();
}());
