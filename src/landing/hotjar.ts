// Solo se inserta en los documentos públicos autorizados de la portada temporal.
// Hotjar, Google Tag Manager y Google Analytics arrancan solos: no hay aviso ni
// panel de preferencias.
export const analyticsInit = `<script id="crv-hotjar-init">
(function(){
  if (location.hostname !== 'coleccionistasderockvenezolano.com' || !['/', '/colaborar'].includes(location.pathname)) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', 'G-WNJ73ZPTXY');
  if (!document.getElementById('crv-gtag-js')) {
    var ga = document.createElement('script'); ga.id = 'crv-gtag-js'; ga.async = true;
    ga.src = 'https://www.googletagmanager.com/gtag/js?id=G-WNJ73ZPTXY';
    document.head.appendChild(ga);
  }
  if (!document.getElementById('crv-gtm')) {
    window.dataLayer.push({'gtm.start': new Date().getTime(), event:'gtm.js'});
    var tag = document.createElement('script'); tag.id = 'crv-gtm'; tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-KJ8VKCCX';
    document.head.appendChild(tag);
  }
  if (window.hj) return;
  window.hj = function(){ (window.hj.q = window.hj.q || []).push(arguments); };
  window._hjSettings = {hjid:6838865,hjsv:6};
  var script = document.createElement('script'); script.async = true;
  script.src = 'https://static.hotjar.com/c/hotjar-6838865.js?sv=6';
  document.head.appendChild(script);
})();
</script>`;
