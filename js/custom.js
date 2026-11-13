/*
 * Personalización: fondo propio y música propia (archivo, YouTube o Spotify).
 *  - Los archivos se guardan en IndexedDB del navegador (no se suben a ningún sitio).
 *  - YouTube y Spotify se reproducen con su reproductor oficial incrustado.
 */
(function (root) {
  'use strict';

  // ---------- almacenamiento de archivos (IndexedDB) ----------
  const Store = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open('pulsoCubico', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('files');
          req.onsuccess = () => { this.db = req.result; resolve(this.db); };
          req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
      });
    },
    async get(key) {
      try {
        const db = await this.open();
        return await new Promise((resolve) => {
          const r = db.transaction('files').objectStore('files').get(key);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => resolve(null);
        });
      } catch (e) { return null; }
    },
    async set(key, value) {
      try {
        const db = await this.open();
        return await new Promise((resolve) => {
          const tx = db.transaction('files', 'readwrite');
          if (value == null) tx.objectStore('files').delete(key);
          else tx.objectStore('files').put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      } catch (e) { return false; }
    },
  };

  // ---------- enlaces ----------
  function parseYouTube(url) {
    const m = String(url).trim().match(
      /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function parseSpotify(url) {
    const s = String(url).trim();
    let m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
    if (m) return { type: m[1], id: m[2] };
    m = s.match(/^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]+)$/);
    return m ? { type: m[1], id: m[2] } : null;
  }

  // Dentro de Claude (artefacto) no se pueden incrustar otras webs.
  const embedsBlocked = /claude|anthropic/i.test(location.hostname);

  // ---------- reproductor incrustado ----------
  class Embed {
    constructor(box) {
      this.box = box;
      this.frame = null;
      this.ready = false;
      this.queue = [];
      this.kind = null;
      this.key = null;
    }

    load(kind, info) {
      const key = kind + ':' + JSON.stringify(info);
      if (key === this.key) return;
      this.unload();
      this.key = key;
      this.kind = kind;
      const f = document.createElement('iframe');
      f.allow = 'autoplay; encrypted-media; clipboard-write';
      f.title = kind === 'youtube' ? 'Reproductor de YouTube' : 'Reproductor de Spotify';
      if (kind === 'youtube') {
        const origin = location.origin && location.origin !== 'null' ? '&origin=' + encodeURIComponent(location.origin) : '';
        f.src = `https://www.youtube.com/embed/${info}?enablejsapi=1&playsinline=1&rel=0${origin}`;
      } else {
        f.src = `https://open.spotify.com/embed/${info.type}/${info.id}?utm_source=generator`;
      }
      f.addEventListener('load', () => {
        if (kind === 'youtube') this.post({ event: 'listening', id: 1, channel: 'widget' });
        setTimeout(() => {
          this.ready = true;
          const q = this.queue; this.queue = [];
          q.forEach((m) => this.post(m));
        }, 400);
      });
      this.frame = f;
      this.box.querySelector('.embed-slot').appendChild(f);
      this.box.classList.remove('hidden');
    }

    unload() {
      if (this.frame) this.frame.remove();
      this.frame = null; this.ready = false; this.queue = []; this.key = null; this.kind = null;
      this.box.classList.add('hidden');
    }

    post(msg) {
      if (!this.frame) return;
      if (!this.ready && msg.event !== 'listening') { this.queue.push(msg); return; }
      const target = this.kind === 'youtube' ? 'https://www.youtube.com' : 'https://open.spotify.com';
      try { this.frame.contentWindow.postMessage(this.kind === 'youtube' ? JSON.stringify(msg) : msg, target); } catch (e) { /* ignorar */ }
    }

    yt(func, args) { this.post({ event: 'command', func, args: args || [] }); }

    play(seconds, muted) {
      if (this.kind === 'youtube') {
        this.yt(muted ? 'mute' : 'unMute');
        this.yt('seekTo', [seconds, true]);
        this.yt('playVideo');
      } else if (this.kind === 'spotify') {
        if (muted) { this.post({ command: 'pause' }); return; }
        this.post({ command: 'seek', timestamp: seconds });
        this.post({ command: 'resume' });
      }
    }

    pause() {
      if (this.kind === 'youtube') this.yt('pauseVideo');
      else if (this.kind === 'spotify') this.post({ command: 'pause' });
    }
  }

  /**
   * Banda sonora: misma interfaz que Music (play, stop, setMuted, sfx...),
   * pero puede usar la música del juego, un archivo propio, YouTube o Spotify.
   */
  class Soundtrack {
    constructor(embedBox) {
      this.synth = new root.Music();
      this.embed = new Embed(embedBox);
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.loop = true;
      this.audioUrl = null;
      this.source = 'game';   // game | file | youtube | spotify
      this.startAt = 0;
      this.muted = false;
      this.playing = false;
    }

    configure({ source, url, startAt }) {
      this.stop();
      this.startAt = Math.max(0, Number(startAt) || 0);
      this.source = source || 'game';
      if (this.source === 'youtube') {
        const id = parseYouTube(url);
        if (id) this.embed.load('youtube', id); else { this.embed.unload(); this.source = 'game'; }
      } else if (this.source === 'spotify') {
        const sp = parseSpotify(url);
        if (sp) this.embed.load('spotify', sp); else { this.embed.unload(); this.source = 'game'; }
      } else {
        this.embed.unload();
      }
      if (this.source === 'file' && !this.audioUrl) this.source = 'game';
    }

    setFile(blob) {
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = blob ? URL.createObjectURL(blob) : null;
      this.audio.src = this.audioUrl || '';
    }

    ensure() { return this.synth.ensure(); }

    setMuted(m) {
      this.muted = m;
      this.synth.setMuted(m);
      this.audio.muted = m;
      if (this.playing && (this.source === 'youtube' || this.source === 'spotify')) {
        if (this.source === 'youtube') this.embed.yt(m ? 'mute' : 'unMute');
        else if (m) this.embed.pause(); else this.embed.post({ command: 'resume' });
      }
    }

    play(levelMusic, offset = 0) {
      this.stop();
      this.playing = true;
      const t = this.startAt + offset;
      switch (this.source) {
        case 'file':
          try {
            this.audio.currentTime = this.audio.duration ? t % this.audio.duration : t;
          } catch (e) { /* aún cargando */ }
          this.audio.play().catch(() => {});
          break;
        case 'youtube':
        case 'spotify':
          this.embed.play(t, this.muted);
          break;
        default:
          this.synth.play(levelMusic, offset);
      }
    }

    stop() {
      this.playing = false;
      this.synth.stop();
      if (!this.audio.paused) this.audio.pause();
      this.embed.pause();
    }

    sfxDeath() { this.synth.sfxDeath(); }
    sfxWin() { this.synth.sfxWin(); }
  }

  root.Custom = { Store, Soundtrack, parseYouTube, parseSpotify, embedsBlocked };
})(window);
