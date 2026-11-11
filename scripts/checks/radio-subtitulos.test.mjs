import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Ejecuta el cliente completo con los eventos del reproductor simulados,
// sin red ni temporizadores reales. Incluye el bundle que sirve la portada.
function radioClient(file) {
  const element = () => {
    const attrs = new Map();
    return {
      getAttribute: key => attrs.get(key) ?? null,
      setAttribute: (key, value) => attrs.set(key, value),
      removeAttribute: key => attrs.delete(key),
      querySelector: () => null,
      appendChild() {},
    };
  };
  const root = element();
  const frame = { ...element(), parentNode: element() };
  const players = [];
  const window = {
    location: { origin: 'http://localhost' },
    addEventListener() {},
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    matchMedia: () => ({ matches: false }),
    YT: { Player: function (_holder, options) {
      const player = {
        events: options.events,
        modules: ['captions'],
        unloaded: [],
        getOptions() { return this.modules; },
        unloadModule(name) {
          this.unloaded.push(name);
          this.modules = this.modules.filter(module => module !== name);
          // YouTube vuelve a notificar al descargar el módulo: no debe ciclar.
          this.events.onApiChange({ target: this });
        },
        getIframe: () => element(),
        getPlayerState: () => -1,
        setVolume() {}, pauseVideo() {},
      };
      players.push(player);
      return player;
    } },
  };
  runInNewContext(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    window,
    navigator: { userAgent: '', platform: '' },
    document: {
      getElementById: id => id === 'radio' ? root : frame,
      querySelector: () => null,
      createElement: element,
      addEventListener() {},
    },
  });
  window.onYouTubeIframeAPIReady();
  assert.equal(players.length, 2);
  return players;
}

for (const file of ['../../src/landing/client/radio.js', '../../web/public/landing/radio.js']) {
  test(`${file}: apaga subtítulos al estar listo y en los siguientes videos de ambos reproductores`, () => {
    for (const player of radioClient(file)) {
      player.events.onReady({ target: player });
      assert.deepEqual(player.unloaded, ['captions']);
      // El módulo aparece más tarde, al cargar otro video.
      player.modules = ['captions'];
      player.events.onApiChange({ target: player });
      assert.deepEqual(player.unloaded, ['captions', 'captions']);
      player.modules = ['captions'];
      player.events.onStateChange({ target: player, data: 1 });
      assert.equal(player.unloaded.length, 3);
    }
  });

  test(`${file}: una API ausente o fallida no interrumpe los eventos de la radio`, () => {
    for (const player of radioClient(file)) {
      player.unloadModule = undefined;
      assert.doesNotThrow(() => player.events.onReady({ target: player }));
      assert.doesNotThrow(() => player.events.onApiChange({ target: player }));
      player.unloadModule = () => { throw new Error('YouTube cambió la API'); };
      assert.doesNotThrow(() => player.events.onApiChange({ target: player }));
      assert.doesNotThrow(() => player.events.onStateChange({ target: player, data: 1 }));
      player.getOptions = () => { throw new Error('módulos no disponibles'); };
      assert.doesNotThrow(() => player.events.onApiChange({ target: player }));
      assert.deepEqual(player.unloaded, []);
    }
  });
}
