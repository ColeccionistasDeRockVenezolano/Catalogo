(function () {
  "use strict";
  var radio = document.getElementById("radio");
  if (!radio) return;
  var api = radio.getAttribute("data-radio-api") || "api/radio/now";
  var iframe = document.getElementById("radioPlayer");
  function text(selector, value) {
    var node = radio.querySelector(selector);
    if (node && value != null) node.textContent = value;
  }
  function update(snapshot) {
    if (!snapshot || !snapshot.current) return;
    if (radio.getAttribute("data-radio-requested") === "true") return;
    if (radio.getAttribute("data-radio-state") !== "ready") return;
    var item = snapshot.current;
    var start = Math.floor((Number(item.startSeconds) || 0) + (Number(snapshot.offsetSeconds) || 0));
    var end = (Number(item.startSeconds) || 0) + (Number(item.durationSeconds) || 0);
    radio.setAttribute("data-radio-video-id", item.videoId);
    radio.setAttribute("data-radio-start-seconds", String(start));
    radio.setAttribute("data-radio-starts-at", snapshot.startsAt);
    radio.setAttribute("data-radio-queue-id", snapshot.queueId || "");
    text("[data-radio-title]", item.title);
    text("[data-radio-artist]", [item.artist, item.album, item.year].filter(Boolean).join(" · "));
    text("[data-radio-next]", snapshot.next ? [snapshot.next.title, snapshot.next.artist].filter(Boolean).join(" — ") : "");
    text("[data-radio-identifier-next]", snapshot.next ? snapshot.next.title : "");
    text("[data-radio-identifier-artist]", snapshot.next ? snapshot.next.artist : "");
    text("[data-radio-listeners]", snapshot.listeners > 0 ? snapshot.listeners + (document.documentElement.lang === "en" ? " listening" : " escuchando") : (document.documentElement.lang === "en" ? "The broadcast is still live" : "La emisión sigue activa"));
    if (iframe) {
      var params = new URLSearchParams({
        enablejsapi: "1", playsinline: "1", rel: "0", autoplay: "1", start: String(start), end: String(end),
        origin: window.location.origin, controls: "0", fs: "0", disablekb: "1", iv_load_policy: "3",
      });
      iframe.setAttribute("data-src", "https://www.youtube.com/embed/" + item.videoId + "?" + params.toString());
      iframe.setAttribute("title", "Reproductor de YouTube: " + item.title);
    }
    var noScript = radio.querySelector(".radio-card__noscript a");
    if (noScript) {
      noScript.href = "https://www.youtube.com/watch?v=" + item.videoId + "&t=" + start + "s";
      noScript.textContent = "YouTube · " + item.title;
    }
  }
  function load() {
    fetch(api, { headers: { Accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(update)
      .catch(function () {});
  }
  load();
  window.setInterval(load, 30000);
})();
