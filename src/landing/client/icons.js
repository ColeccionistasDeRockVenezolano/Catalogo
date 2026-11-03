// Iconos de interfaz compartidos. Lucide se sirve localmente para respetar la
// CSP y evitar que la interfaz dependa de un CDN.
(function () {
  'use strict';

  function renderIcons(root) {
    if (!window.lucide) return;
    var scope = root && root.querySelectorAll ? root : document;
    var placeholders = scope.matches && scope.matches('i[data-lucide]')
      ? [scope]
      : scope.querySelectorAll('i[data-lucide]');

    placeholders.forEach(function (placeholder) {
      // La portada entrega las páginas siguientes del roadmap ya ocultas. No
      // conviene fabricar SVG para cientos de iconos que aún no pueden verse;
      // se materializan al quitar `hidden` mediante el observador inferior.
      if (placeholder.closest('[hidden]')) return;
      var iconName = placeholder.getAttribute('data-lucide');
      var componentName = iconName.replace(/(^\w|[-_]\w)/g, function (part) {
        return part.replace(/[-_]/, '').toUpperCase();
      });
      var iconNode = window.lucide.icons[componentName];
      if (!iconNode) return;
      var svg = window.lucide.createElement(iconNode);
      Array.from(placeholder.attributes).forEach(function (attribute) {
        if (attribute.name !== 'data-lucide') svg.setAttribute(attribute.name, attribute.value);
      });
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.classList.add('lucide');
      placeholder.replaceWith(svg);
    });
  }

  window.herraIcons = { render: renderIcons };
  renderIcons(document);

  // Las listas del panel se actualizan con fetch. Convertimos únicamente los
  // nuevos placeholders, sin volver a procesar los SVG ya montados.
  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === 'attributes') {
        if (!mutation.target.hidden) renderIcons(mutation.target);
        return;
      }
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) renderIcons(node);
      });
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
})();
