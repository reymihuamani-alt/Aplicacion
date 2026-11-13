/* Pulso Onda — utilidades compartidas. */
(function (root) {
  'use strict';

  const U = {};

  U.rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.hash = (str) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

  // Ruido 1D suave y determinista.
  U.noise1 = (seed) => {
    const r = U.rng(seed);
    const tbl = new Float32Array(256);
    for (let i = 0; i < 256; i++) tbl[i] = r();
    return (x) => {
      const i = Math.floor(x);
      const f = x - i;
      const s = f * f * (3 - 2 * f);
      return U.lerp(tbl[i & 255], tbl[(i + 1) & 255], s);
    };
  };

  // Las cuatro figuras del camino. Cada una se asocia a una banda de la música.
  U.LANES = [
    { name: 'Bloque', band: 'golpes medios (caja)', key: 'A', alt: '←', p2: 'J', color: '#ff5c8a', hue: 342 },
    { name: 'Bucle', band: 'melodía sostenida', key: 'S', alt: '↓', p2: 'K', color: '#ffd35c', hue: 44 },
    { name: 'Onda', band: 'agudos (platillos)', key: 'D', alt: '↑', p2: 'L', color: '#5ce1ff', hue: 191 },
    { name: 'Foso', band: 'graves (bombo y bajo)', key: 'F', alt: '→', p2: 'Ñ', color: '#a98bff', hue: 258 },
  ];

  U.parseYouTube = (url) => {
    const s = String(url || '').trim();
    const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/);
    return m ? { type: 'video', id: m[1] } : null;
  };

  U.parseSpotify = (url) => {
    const s = String(url || '').trim();
    let m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
    if (m) return { type: m[1], id: m[2] };
    m = s.match(/^spotify:(track|album|playlist|episode):([A-Za-z0-9]+)$/);
    return m ? { type: m[1], id: m[2] } : null;
  };

  U.parseLink = (url) => {
    const sp = U.parseSpotify(url);
    if (sp) return { kind: 'spotify', ...sp, key: 'spotify:' + sp.type + ':' + sp.id };
    const yt = U.parseYouTube(url);
    if (yt) return { kind: 'youtube', ...yt, key: 'youtube:' + yt.id };
    return null;
  };

  U.store = {
    get(key, def) {
      try { const v = localStorage.getItem('pulsoOnda.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(key, value) {
      try { localStorage.setItem('pulsoOnda.' + key, JSON.stringify(value)); } catch (e) { /* sin almacenamiento */ }
    },
  };

  U.encodeCode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/=+$/, '');
  U.decodeCode = (str) => {
    try { return JSON.parse(decodeURIComponent(escape(atob(String(str).trim())))); } catch (e) { return null; }
  };

  // Dentro de Claude no se pueden incrustar otras webs.
  U.embedsBlocked = /claude|anthropic/i.test(location.hostname);

  root.U = U;
})(window);
