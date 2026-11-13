/*
 * Fuentes de música. Todas ofrecen la misma interfaz:
 *   prepare(onProgress) -> { candidates, bpm, offset, duration, sections, title, seed }
 *   start(desde), pause() -> tiempo, stop(), time() -> segundos (o null si aún no suena)
 *   levels() -> { low, mid, high } entre 0 y 1 para animar el mundo
 */
(function (root) {
  'use strict';
  const { hash, clamp } = root.U;
  const { composeSong, songToCandidates, SynthPlayer } = root.Synth;

  // ---------- contexto de audio compartido ----------
  const Hub = {
    ctx: null, master: null, analyser: null, data: null,
    get() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.6;
        this.master.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        this.data = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    levels() {
      if (!this.analyser) return null;
      this.analyser.getByteFrequencyData(this.data);
      const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += this.data[i]; return s / (b - a) / 255; };
      return { low: avg(1, 8), mid: avg(8, 70), high: avg(70, 300) };
    },
    setVolume(v) { if (this.master) this.master.gain.value = v; },
  };

  // Niveles sintéticos a partir del ritmo, para fuentes sin acceso al audio.
  function beatLevels(t, bpm) {
    const ph = ((t * bpm) / 60) % 1;
    const k = Math.exp(-ph * 6);
    const h = Math.exp(-(((t * bpm) / 30) % 1) * 9);
    return { low: 0.25 + 0.6 * k, mid: 0.3 + 0.25 * Math.sin(t * 1.3) ** 2, high: 0.2 + 0.5 * h };
  }

  // ---------- generador ----------
  class SynthSource {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.kind = 'synth';
      this.key = 'synth:' + this.seed;
    }
    async prepare() {
      this.song = composeSong(this.seed);
      return {
        candidates: songToCandidates(this.song), bpm: this.song.bpm, offset: 0, duration: this.song.duration,
        sections: this.song.sections, seed: this.seed,
        title: `Canción generada #${this.seed % 100000} · ${this.song.bpm} BPM · escala ${this.song.scaleName}`,
      };
    }
    start(from = 0) {
      const ctx = Hub.get();
      if (!this.player) this.player = new SynthPlayer(ctx, Hub.master);
      this.player.start(this.song, from);
      this.running = true;
    }
    time() { return this.running ? this.player.time() : null; }
    pause() { const t = this.time(); this.stop(); return t; }
    stop() { if (this.player) this.player.stop(); this.running = false; }
    levels() { return Hub.levels(); }
  }

  // ---------- archivo propio (análisis real) ----------
  class FileSource {
    constructor(file) {
      this.file = file;
      this.kind = 'file';
      this.key = 'file:' + file.name + ':' + file.size;
      this.seed = hash(this.key);
    }
    async prepare(onProgress) {
      const ctx = Hub.get();
      const data = await this.file.arrayBuffer();
      const a = await root.Analysis.analyzeAudio(ctx, data, onProgress);
      this.buffer = a.buffer;
      return { ...a, seed: this.seed, title: `${this.file.name.replace(/\.[^.]+$/, '')} · ${Math.round(a.bpm)} BPM detectados` };
    }
    start(from = 0) {
      const ctx = Hub.get();
      this.stop();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(Hub.master);
      src.start(ctx.currentTime + 0.05, Math.max(0, from));
      src.onended = () => { if (this.node === src) this.ended = true; };
      this.node = src;
      this.ended = false;
      this.t0 = ctx.currentTime + 0.05 - from;
    }
    time() {
      if (!this.node) return null;
      const lat = Hub.ctx.outputLatency || Hub.ctx.baseLatency || 0;
      return Hub.ctx.currentTime - this.t0 - lat;
    }
    pause() { const t = this.time(); this.stop(); return t; }
    stop() { if (this.node) { try { this.node.stop(); } catch (e) { /* ya parado */ } this.node.disconnect(); } this.node = null; }
    levels() { return Hub.levels(); }
  }

  // ---------- reproductor incrustado (Spotify / YouTube) ----------
  const Embed = {
    box: null, frame: null, kind: null, key: null, ready: false, queue: [],
    pos: null, at: 0, paused: true, duration: null, uri: null, title: null, gotMessage: false,
    listeners: new Set(),

    init(box) {
      this.box = box;
      window.addEventListener('message', (e) => this.onMessage(e));
    },

    load(link) {
      const src = link.kind === 'youtube'
        ? `https://www.youtube.com/embed/${link.id}?enablejsapi=1&playsinline=1&rel=0` +
          (location.origin && location.origin !== 'null' ? '&origin=' + encodeURIComponent(location.origin) : '')
        : `https://open.spotify.com/embed/${link.type}/${link.id}?utm_source=generator`;
      if (this.key === link.key && this.frame) return;
      this.unload();
      this.key = link.key;
      this.kind = link.kind;
      const f = document.createElement('iframe');
      f.allow = 'autoplay; encrypted-media; clipboard-write';
      f.title = link.kind === 'youtube' ? 'Reproductor de YouTube' : 'Reproductor de Spotify';
      f.src = src;
      f.addEventListener('load', () => {
        if (this.kind === 'youtube') {
          this.post({ event: 'listening', id: 1, channel: 'widget' });
          this.yt('addEventListener', ['onStateChange']);
        }
        setTimeout(() => { this.ready = true; const q = this.queue; this.queue = []; q.forEach((m) => this.post(m)); }, 500);
      });
      this.frame = f;
      this.box.querySelector('.embed-slot').appendChild(f);
      this.box.classList.remove('hidden');
    },

    unload() {
      if (this.frame) this.frame.remove();
      Object.assign(this, { frame: null, kind: null, key: null, ready: false, queue: [], pos: null, duration: null, uri: null, title: null, paused: true, gotMessage: false });
      if (this.box) this.box.classList.add('hidden');
    },

    post(msg) {
      if (!this.frame) return;
      if (!this.ready && msg.event !== 'listening') { this.queue.push(msg); return; }
      const target = this.kind === 'youtube' ? 'https://www.youtube.com' : 'https://open.spotify.com';
      try { this.frame.contentWindow.postMessage(this.kind === 'youtube' ? JSON.stringify(msg) : msg, target); } catch (e) { /* ignorar */ }
    },
    yt(func, args) { this.post({ event: 'command', func, args: args || [] }); },

    play(seconds) {
      if (this.kind === 'youtube') { this.yt('seekTo', [seconds, true]); this.yt('playVideo'); }
      else { if (seconds > 0.5) this.post({ command: 'seek', timestamp: seconds }); this.post({ command: 'resume' }); }
    },
    pause() {
      if (this.kind === 'youtube') this.yt('pauseVideo');
      else if (this.kind === 'spotify') this.post({ command: 'pause' });
    },

    time() {
      if (this.pos == null) return null;
      return this.paused ? this.pos : this.pos + (performance.now() - this.at) / 1000;
    },

    update(pos, duration, paused, uri, title) {
      const prevUri = this.uri, prevDur = this.duration, prevPos = this.time();
      this.gotMessage = true;
      if (pos != null) { this.pos = pos; this.at = performance.now(); }
      if (paused != null) this.paused = paused;
      if (duration) this.duration = duration;
      if (title) this.title = title;
      if (uri) this.uri = uri;
      // cambio de pista (listas de reproducción): otra canción → otro mundo
      const uriChanged = uri && prevUri && uri !== prevUri;
      const durChanged = !uri && prevDur && duration && Math.abs(duration - prevDur) > 1 && pos != null && prevPos != null && pos + 3 < prevPos;
      if (uriChanged || durChanged) this.listeners.forEach((fn) => fn({ uri: this.uri, duration: this.duration }));
    },

    onMessage(e) {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      let data = e.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (err) { return; } }
      if (!data) return;
      if (this.kind === 'youtube' && data.event === 'infoDelivery' && data.info) {
        const i = data.info;
        const paused = i.playerState != null ? i.playerState !== 1 : null;
        this.update(i.currentTime != null ? i.currentTime : null, i.duration || null, paused, null, i.videoData && i.videoData.title);
      } else if (this.kind === 'youtube' && data.event === 'onStateChange') {
        this.update(null, null, data.info !== 1);
      } else if (this.kind === 'spotify' && data.type === 'playback_update' && data.payload) {
        const p = data.payload;
        this.update(p.position != null ? p.position / 1000 : null, p.duration ? p.duration / 1000 : null,
          p.isPaused != null ? !!p.isPaused : null, p.playingURI || p.uri || null);
      }
    },
  };

  class EmbedSource {
    /** link: resultado de U.parseLink · opts: { bpm, offset } elegidos por el jugador */
    constructor(link, opts = {}) {
      this.link = link;
      this.kind = link.kind;
      this.opts = opts;
      this.key = link.key;
      this.seed = hash(link.key);
      this.started = false;
    }
    async prepare() {
      Embed.load(this.link);
      // esperar un momento por si el reproductor ya informa de la duración
      for (let i = 0; i < 10 && !Embed.duration; i++) await new Promise((r) => setTimeout(r, 150));
      return this.compose(Embed.duration, Embed.uri);
    }
    compose(duration, uri) {
      const seed = uri ? hash(this.key + '|' + uri) : duration && this.link.type !== 'track' && this.link.type !== 'video' ? hash(this.key + '|' + Math.round(duration)) : this.seed;
      const r = root.U.rng(seed);
      const bpm = this.opts.bpm || 92 + Math.floor(r() * 60);
      const dur = duration || 210;
      this.bpm = bpm;
      const song = composeSong(seed, { bpm, offset: this.opts.offset || 0, duration: dur });
      const name = this.kind === 'spotify' ? 'Spotify' : 'YouTube';
      return {
        candidates: songToCandidates(song), bpm, offset: this.opts.offset || 0, duration: dur, sections: song.sections, seed,
        title: `${Embed.title || name + ' · ' + this.link.type}${this.opts.bpm ? ' · ' + this.opts.bpm + ' BPM (tuyo)' : ' · ' + bpm + ' BPM (estimado)'}`,
      };
    }
    start(from = 0) { Embed.play(from); this.started = true; this.startedAt = performance.now(); this.fallback = from; }
    time() {
      if (!this.started) return null;
      const t = Embed.time();
      if (t != null && Embed.gotMessage) return Embed.paused && t < 0.05 ? null : t;
      // sin mensajes del reproductor: reloj local
      return performance.now() - this.startedAt > 1500 ? this.fallback + (performance.now() - this.startedAt - 1500) / 1000 : null;
    }
    pause() { const t = this.time(); Embed.pause(); this.started = false; return t; }
    stop() { Embed.pause(); this.started = false; }
    levels() { const t = this.time() || 0; return beatLevels(t, this.bpm || 120); }
  }

  root.Sources = { Hub, Embed, SynthSource, FileSource, EmbedSource, beatLevels, clamp };
})(window);
