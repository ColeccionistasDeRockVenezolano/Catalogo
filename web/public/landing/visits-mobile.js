// CRV · el globo del contador de visitas no tapa el reproductor en móvil.
//
// El contador es fijo abajo a la derecha; en móvil la tarjeta de radio ocupa
// todo el ancho y su botón de reproducir queda justo debajo del globo. Mientras
// la tarjeta se solape con el globo, este se oculta; al desplazarse fuera,
// vuelve. Solo aplica a pantallas angostas: en escritorio conviven.
(function () {
  "use strict";
  var widget = document.getElementById("visitCounter");
  var radio = document.getElementById("radio");
  if (!widget || !radio) return;
  var mq = window.matchMedia("(max-width: 720px)");
  var margen = 10;

  function aplica() {
    if (!mq.matches) {
      widget.classList.remove("visits--oculta");
      return;
    }
    var a = widget.getBoundingClientRect();
    var b = radio.getBoundingClientRect();
    var solapa = a.left < b.right + margen && a.right > b.left - margen
      && a.top < b.bottom + margen && a.bottom > b.top - margen;
    widget.classList.toggle("visits--oculta", solapa);
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(aplica, { threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(radio);
  }
  window.addEventListener("scroll", aplica, { passive: true });
  window.addEventListener("resize", aplica);
  if (mq.addEventListener) mq.addEventListener("change", aplica);
  else if (mq.addListener) mq.addListener(aplica);
  aplica();
})();
