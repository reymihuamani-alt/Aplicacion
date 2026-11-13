/*
 * Música y efectos generados en tiempo real con WebAudio (sin archivos de audio).
 * Cada nivel tiene su propia canción a partir de unos pocos parámetros.
 */
(function (root) {
  'use strict';

  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class Music {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.timer = null;
      this.bus = null;
    }

    ensure() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = this.muted ? 0 : 0.55;
        this.out.connect(this.ctx.destination);
        // ruido blanco reutilizable
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    setMuted(m) {
      this.muted = m;
      if (this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
    }

    /** Compone la canción (patrones de 4 compases de 16 pasos). */
    compose(cfg) {
      const r = rng(cfg.seed);
      const scale = SCALES[cfg.scale] || SCALES.minor;
      const note = (deg, oct = 0) => cfg.root + scale[((deg % 7) + 7) % 7] + 12 * (Math.floor(deg / 7) + oct);
      const bassRhythm = [];
      for (let i = 0; i < 16; i++) bassRhythm.push(i % 4 === 0 || (i % 2 === 0 && r() < 0.5) || (i % 4 === 3 && r() < 0.3));
      const arpShape = [0, 2, 4, 7, 4, 2, 0, 4].map((v) => (r() < 0.25 ? v + 2 : v));
      const melody = [];
      for (let bar = 0; bar < 4; bar++) {
        for (let i = 0; i < 16; i++) {
          if (i % 2 === 0 && r() < 0.42) melody.push(cfg.prog[bar] + [0, 2, 4, 6, 7][Math.floor(r() * 5)]);
          else melody.push(null);
        }
      }
      return { bpm: cfg.bpm, prog: cfg.prog, note, bassRhythm, arpShape, melody };
    }

    play(cfg, offset = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      this.stop();
      const song = this.compose(cfg);
      const bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(this.out);
      this.bus = bus;
      const stepDur = 60 / song.bpm / 4;
      const startTime = ctx.currentTime + 0.05 - offset;
      let step = Math.max(0, Math.ceil(offset / stepDur));
      const tick = () => {
        const horizon = ctx.currentTime + 0.12;
        while (startTime + step * stepDur < horizon) {
          const t = startTime + step * stepDur;
          if (t >= ctx.currentTime - 0.01) this.playStep(song, step, t, bus, stepDur);
          step++;
        }
      };
      tick();
      this.timer = setInterval(tick, 25);
    }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.bus && this.ctx) {
        const b = this.bus;
        b.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
        setTimeout(() => b.disconnect(), 300);
      }
      this.bus = null;
    }

    playStep(song, step, t, bus, sd) {
      const i = step % 16;
      const bar = Math.floor(step / 16) % 4;
      const section = Math.floor(step / 64) % 4; // va sumando capas
      const chord = song.prog[bar];

      if (i % 4 === 0) this.kick(t, bus);
      if (i === 4 || i === 12) this.snare(t, bus);
      if (i % 2 === 1 || section >= 2) this.hat(t, bus, i % 2 === 1 ? 0.12 : 0.05);
      if (song.bassRhythm[i]) this.tone(t, mtof(song.note(chord, -1)), sd * 1.8, 'sawtooth', 0.16, bus, 900);
      if (section >= 1 || step >= 32) {
        const deg = chord + song.arpShape[i % 8];
        this.tone(t, mtof(song.note(deg, 1)), sd * 0.9, 'square', 0.045, bus, 3000);
      }
      if (section >= 1) {
        const m = song.melody[(bar * 16) + i];
        if (m !== null) this.tone(t, mtof(song.note(m, 1)), sd * 3, 'triangle', 0.13, bus, 5000);
      }
    }

    tone(t, freq, dur, type, vol, dest, cutoff) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = type; o.frequency.value = freq;
      f.type = 'lowpass'; f.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur + 0.02);
    }

    kick(t, dest) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + 0.3);
    }

    noiseHit(t, dest, vol, dur, type, freq) {
      const ctx = this.ctx;
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest);
      s.start(t); s.stop(t + dur + 0.02);
    }

    snare(t, dest) { this.noiseHit(t, dest, 0.35, 0.16, 'bandpass', 1800); }
    hat(t, dest, v) { this.noiseHit(t, dest, v, 0.04, 'highpass', 7000); }

    sfxDeath() {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime;
      this.noiseHit(t, this.out, 0.6, 0.45, 'lowpass', 1200);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(320, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.35);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + 0.45);
    }

    sfxWin() {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime;
      [0, 4, 7, 12, 16].forEach((n, k) => this.tone(t + k * 0.09, mtof(72 + n), 0.5, 'triangle', 0.18, this.out, 6000));
    }
  }

  root.Music = Music;
})(typeof window !== 'undefined' ? window : globalThis);
