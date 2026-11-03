// Navegación móvil compartida por el roadmap público y sus paneles.
(function () {
  'use strict';

  // Desplegable «Herramientas»: abrir y cerrar es cosa del CSS (hover y
  // focus-within); aquí solo se refleja el estado para lectores de pantalla.
  document.querySelectorAll('[data-nav-dropdown]').forEach(function (dropdown) {
    var trigger = dropdown.querySelector('[data-nav-dropdown-trigger]');
    if (!trigger) return;
    function setExpanded(open) { trigger.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    dropdown.addEventListener('mouseenter', function () { setExpanded(true); });
    dropdown.addEventListener('mouseleave', function () { setExpanded(false); });
    dropdown.addEventListener('focusin', function () { setExpanded(true); });
    dropdown.addEventListener('focusout', function (event) {
      if (!dropdown.contains(event.relatedTarget)) setExpanded(false);
    });
    // Sin destino propio: el disparador nunca navega ni cambia de página.
    trigger.addEventListener('click', function (event) { event.preventDefault(); });
  });

  var menus = document.querySelectorAll('.nav-menu');
  if (!menus.length) return;

  // Los dos rótulos del menú llegan del servidor ya traducidos, en el propio
  // <details>: aquí no se decide idioma, solo cuál de los dos toca.
  function menuLabel(menu, open) {
    return (open ? menu.dataset.labelClose : menu.dataset.labelOpen) || '';
  }

  function closeMenu(menu, restoreFocus) {
    if (!menu || !menu.open) return;
    menu.removeAttribute('open');
    var summary = menu.querySelector('summary');
    if (summary) {
      summary.setAttribute('aria-label', menuLabel(menu, false));
      if (restoreFocus) summary.focus();
    }
  }

  menus.forEach(function (menu) {
    menu.addEventListener('toggle', function () {
      var summary = menu.querySelector('summary');
      if (summary) summary.setAttribute('aria-label', menuLabel(menu, menu.open));
    });
  });

  document.addEventListener('click', function (event) {
    menus.forEach(function (menu) {
      var link = event.target.closest ? event.target.closest('.nav-menu__panel a') : null;
      if (link && link.closest('.nav-menu') === menu) {
        closeMenu(menu, false);
      } else if (menu.open && !menu.contains(event.target)) {
        closeMenu(menu, false);
      }
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    menus.forEach(function (menu) { closeMenu(menu, true); });
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 720) menus.forEach(function (menu) { closeMenu(menu, false); });
  });

  // Marca en el menú la sección que se está viendo (Herra 1.1.39).
  var sectionLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-links--desktop a[href^="#"], .nav-menu__panel a[href^="#"]'));
  if (!sectionLinks.length) return;
  var targets = [];
  sectionLinks.forEach(function (link) {
    var id = link.getAttribute('href').slice(1);
    if (!id) return;
    var target = null;
    for (var index = 0; index < targets.length; index += 1) {
      if (targets[index].id === id) {
        target = targets[index];
        break;
      }
    }
    if (!target) {
      var section = document.getElementById(id);
      if (!section) return;
      target = { id: id, section: section, links: [] };
      targets.push(target);
    }
    target.links.push(link);
  });
  if (!targets.length) return;

  var header = document.querySelector('.site-header');
  var frame = 0;
  function updateActive() {
    frame = 0;
    var offset = (header ? header.getBoundingClientRect().height : 0) + 24;
    var current = targets[0];
    var passed = false;
    targets.forEach(function (target) {
      if (target.section.getBoundingClientRect().top - offset <= 0) {
        current = target;
        passed = true;
      }
    });
    if (!passed) current = targets[0];
    var atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    if (atBottom) current = targets[targets.length - 1];
    targets.forEach(function (target) {
      var active = target === current;
      target.links.forEach(function (link) {
        if (link.classList.contains('active') !== active) link.classList.toggle('active', active);
      });
    });
  }
  function scheduleUpdate() {
    if (!frame) frame = window.requestAnimationFrame(updateActive);
  }
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  updateActive();
})();
