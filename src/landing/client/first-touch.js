// CRV · Primer toque de la radio en Android: cualquier gesto, también deslizar, abre el sonido.
//
// Sin un gesto completo en la pestaña, el navegador pausa el video al quitarle el silencio. Deslizar
// no es un gesto completo porque el desplazamiento nativo lo cancela (pointercancel). Hasta el primer
// gesto, el dedo no desplaza de forma nativa: el gesto termina en pointerup, que sí cuenta, y este
// archivo mueve la página con el dedo para que nadie note la diferencia. Después todo queda nativo.
// Va en el <head> para estar listo antes del primer toque. Desktop y iPhone no pasan por aquí.
(function () {
  'use strict';
  var activation = navigator.userActivation;
  if (!activation || activation.hasBeenActive || !/Android/i.test(navigator.userAgent) || window.top !== window) return;

  var FRICTION_PER_FRAME = 0.95;
  var MIN_SPEED = 0.02;
  var AXIS_LOCK_PX = 4;

  var style = document.createElement('style');
  style.textContent = 'html,html *{touch-action:pinch-zoom!important}';
  document.head.appendChild(style);

  var finger = null;
  var glide = 0;

  function canScroll(node, axis) {
    var css = window.getComputedStyle(node);
    var overflow = axis === 'y' ? css.overflowY : css.overflowX;
    if (overflow !== 'auto' && overflow !== 'scroll') return false;
    return axis === 'y' ? node.scrollHeight > node.clientHeight : node.scrollWidth > node.clientWidth;
  }

  function scrollNode(node, axis, delta) {
    var before = axis === 'y' ? node.scrollTop : node.scrollLeft;
    node.scrollBy({ top: axis === 'y' ? delta : 0, left: axis === 'y' ? 0 : delta, behavior: 'instant' });
    return (axis === 'y' ? node.scrollTop : node.scrollLeft) !== before;
  }

  // Como el desplazamiento nativo: el contenedor más cercano y, si llegó a su borde, el de afuera.
  function scrollFrom(start, axis, delta) {
    var root = document.scrollingElement || document.documentElement;
    for (var node = start; node && node !== document.body && node !== root; node = node.parentElement) {
      if (canScroll(node, axis) && scrollNode(node, axis, delta)) return true;
    }
    // Un diálogo abierto bloquea la página con overflow hidden: se respeta.
    var body = window.getComputedStyle(document.body);
    var html = window.getComputedStyle(root);
    var blocked = axis === 'y' ? (body.overflowY === 'hidden' || html.overflowY === 'hidden') : (body.overflowX === 'hidden' || html.overflowX === 'hidden');
    return !blocked && scrollNode(root, axis, delta);
  }

  function stopGlide() {
    if (glide) window.cancelAnimationFrame(glide);
    glide = 0;
  }

  // La inercia al soltar, para que el primer deslizamiento se sienta como los siguientes.
  function startGlide(start, axis, speed) {
    var last = performance.now();
    function frame(now) {
      var elapsed = now - last;
      last = now;
      speed *= Math.pow(FRICTION_PER_FRAME, elapsed / (1000 / 60));
      if (Math.abs(speed) < MIN_SPEED || !scrollFrom(start, axis, speed * elapsed)) { glide = 0; return; }
      glide = window.requestAnimationFrame(frame);
    }
    glide = window.requestAnimationFrame(frame);
  }

  function release() {
    if (!activation.hasBeenActive) return false;
    style.remove();
    window.removeEventListener('touchstart', onStart, true);
    window.removeEventListener('touchmove', onMove, true);
    window.removeEventListener('touchend', onEnd, true);
    window.removeEventListener('touchcancel', onEnd, true);
    window.clearInterval(watcher);
    return true;
  }

  function onStart(event) {
    stopGlide();
    finger = null;
    if (event.touches.length !== 1) return;
    var target = event.target;
    // Un campo de texto o un control deslizante usan el dedo para sí mismos.
    if (!target || !target.closest || target.closest('input,textarea,select,[contenteditable]')) return;
    var touch = event.touches[0];
    finger = { target: target, startX: touch.clientX, startY: touch.clientY, x: touch.clientX, y: touch.clientY, at: event.timeStamp, axis: null, speed: 0 };
  }

  function onMove(event) {
    if (!finger) return;
    if (event.touches.length !== 1) { finger = null; return; }
    var touch = event.touches[0];
    if (!finger.axis) {
      var totalX = Math.abs(touch.clientX - finger.startX);
      var totalY = Math.abs(touch.clientY - finger.startY);
      if (Math.max(totalX, totalY) < AXIS_LOCK_PX) return;
      finger.axis = totalY >= totalX ? 'y' : 'x';
    }
    var delta = finger.axis === 'y' ? finger.y - touch.clientY : finger.x - touch.clientX;
    var elapsed = Math.max(1, event.timeStamp - finger.at);
    finger.speed = finger.speed * 0.6 + (delta / elapsed) * 0.4;
    finger.x = touch.clientX;
    finger.y = touch.clientY;
    finger.at = event.timeStamp;
    if (delta) scrollFrom(finger.target, finger.axis, delta);
  }

  function onEnd(event) {
    if (event.touches.length) return;
    var ended = finger;
    finger = null;
    if (ended && ended.axis && event.type === 'touchend') startGlide(ended.target, ended.axis, ended.speed);
    release();
  }

  window.addEventListener('touchstart', onStart, { capture: true, passive: true });
  window.addEventListener('touchmove', onMove, { capture: true, passive: true });
  window.addEventListener('touchend', onEnd, { capture: true, passive: true });
  window.addEventListener('touchcancel', onEnd, { capture: true, passive: true });
  // Un gesto sobre el video le llega a su iframe: aquí no hay evento, pero sí la activación.
  var watcher = window.setInterval(release, 500);
})();
