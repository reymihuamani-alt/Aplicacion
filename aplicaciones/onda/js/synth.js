/*
 * Compositor y sintetizador. Genera una canción completa (lista de notas con
 * secciones intro/verso/subida/drop/puente/final) a partir de una semilla.
 * Se usa para:
 *  - el modo "Generador" (la canción suena aquí mismo),
 *  - crear la estructura rítmica de canciones de Spotify/YouTube (no suena: solo sirve de partitura).
 */
(function (root) {
  'use strict';
  const { rng } = root.U;

  const SCALES = {
    menor: [0, 2, 3, 5, 7, 8, 10], dórica: [0, 2, 3, 5, 7, 9, 10], frigia: [0, 1, 3, 5, 7, 8, 10],
    mayor: [0, 2, 4, 5, 7, 9, 11], mixolidia: [0, 2, 4, 5, 7, 9, 10],
  };
  const PROGS = [[0, 5, 3, 4], [0, 3, 4, 4], [0, 6, 5, 4], [0, 4, 5, 3], [0, 2, 3, 4], [0, 5, 6, 4]];
  const PLAN = ['intro', 'verso', 'subida', 'drop', 'puente', 'verso', 'subida', 'drop'];
  const ENERGY = { intro: 0.3, verso: 0.5, subida: 0.7, drop: 1, puente: 0.35, final: 0.45 };
  const LAYERS = {
    intro: { kick: 'sparse', snare: 'sparse', hat: 1 },
    verso: { kick: 1, snare: 1, hat: 1, bass: 1 },
    subida: { kick: 1, snare: 'roll', hat: 2, bass: 1, arp: 1 },
    drop: { kick: 1, snare: 1, hat: 2, bass: 1, arp: 1, lead: 1 },
    puente: { arp: 1, lead: 'half', bass: 'long' },
    final: { kick: 1, arp: 1, lead: 'half' },
  };

  function composeSong(seed, opts = {}) {
    const r = rng(seed);
    const bpm = opts.bpm || 96 + Math.floor(r() * 56);
    const beat = 60 / bpm, step = beat / 4, barDur = beat * 4;
    const offset = opts.offset || 0;
    const bars = opts.duration ? Math.max(8, Math.floor((opts.duration - offset) / barDur)) : 48;
    const scaleNames = Object.keys(SCALES);
    const scaleName = scaleNames[Math.floor(r() * scaleNames.length)];
    const scale = SCALES[scaleName];
    const prog = PROGS[Math.floor(r() * PROGS.length)];
    const rootNote = 40 + Math.floor(r() * 8);
    const note = (deg, oct = 0) => rootNote + scale[((deg % 7) + 7) % 7] + 12 * (Math.floor(deg / 7) + oct);

    const fourFloor = r() < 0.5;
    const kick = Array.from({ length: 16 }, (_, i) => (fourFloor ? i % 4 === 0 : i === 0 || i === 8 || ((i === 6 || i === 10 || i === 14) && r() < 0.35)));
    const snare = Array.from({ length: 16 }, (_, i) => i === 4 || i === 12 || (i === 15 && r() < 0.3));
    const bassPat = Array.from({ length: 16 }, (_, i) => kick[i] || (i % 2 === 0 && r() < 0.35) || (i % 4 === 3 && r() < 0.2));
    const arpShape = [0, 2, 4, 7, 4, 2, 4, 9].map((v) => (r() < 0.2 ? v + 2 : v));
    const motif = [];
    for (let i = 0; i < 32; i++) motif.push(i % 2 === 0 && (r() < 0.4 || i % 8 === 0) ? [0, 2, 4, 5, 7][Math.floor(r() * 5)] : null);

    const events = [];
    const sections = [];
    const push = (bar, s, inst, midi, dur, vel) => events.push({ t: offset + bar * barDur + s * step, inst, midi, dur, vel });

    let lastType = null;
    for (let bar = 0; bar < bars; bar++) {
      const secIdx = Math.floor(bar / 8);
      let type = secIdx < PLAN.length ? PLAN[secIdx] : PLAN[1 + ((secIdx - 1) % (PLAN.length - 1))];
      if (bars >= 24 && bar >= bars - 4) type = 'final';
      if (type !== lastType || bar % 8 === 0) {
        sections.push({ t: offset + bar * barDur, type, energy: ENERGY[type] });
        lastType = type;
      }
      const L = LAYERS[type];
      const chord = prog[bar % 4];
      const lastBar = bar % 8 === 7;
      for (let s = 0; s < 16; s++) {
        if (L.kick && (L.kick === 'sparse' ? s === 0 || s === 8 : kick[s])) push(bar, s, 'kick', 0, 0.25, 1);
        if (L.snare) {
          if (L.snare === 'sparse') { if (s === 12) push(bar, s, 'snare', 0, 0.2, 0.8); }
          else if (snare[s]) push(bar, s, 'snare', 0, 0.2, 0.9);
          else if (L.snare === 'roll' && lastBar && (s >= 8 || s % 2 === 0)) push(bar, s, 'snare', 0, 0.12, 0.45);
        }
        if (L.hat && (L.hat === 2 || s % 2 === 1)) push(bar, s, 'hat', 0, 0.05, s % 2 ? 0.7 : 0.4);
        if (L.bass && (L.bass === 'long' ? s === 0 : bassPat[s])) push(bar, s, 'bass', note(chord, -1), L.bass === 'long' ? barDur * 0.9 : step * 1.6, 0.9);
        if (L.arp) push(bar, s, 'arp', note(chord + arpShape[s % 8], 1), step * 0.9, s % 4 === 0 ? 0.6 : 0.4);
        if (L.lead) {
          const m = motif[(bar % 2) * 16 + s];
          if (m !== null && (L.lead !== 'half' || s % 4 === 0)) push(bar, s, 'lead', note(chord + m, 1), step * 3, 0.8);
        }
      }
    }
    return { bpm, beat, offset, duration: offset + bars * barDur, events, sections, scaleName };
  }

  // Convierte los instrumentos en candidatos de obstáculo (misma lógica que el análisis de audio).
  const INST_LANE = { kick: [3, 1.0], snare: [0, 0.95], lead: [1, 0.8], arp: [2, 0.42], hat: [2, 0.33], bass: [3, 0.5] };
  function songToCandidates(song) {
    return song.events.map((e) => {
      const [lane, base] = INST_LANE[e.inst];
      return { t: e.t, lanes: [lane], strength: base * (0.7 + 0.3 * e.vel) };
    });
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class SynthPlayer {
    constructor(ctx, dest) {
      this.ctx = ctx;
      this.dest = dest;
      this.timer = null;
      this.bus = null;
      this.noise = null;
    }

    start(song, from = 0) {
      this.stop();
      const ctx = this.ctx;
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const bus = ctx.createGain();
      bus.gain.value = 0.8;
      bus.connect(this.dest);
      this.bus = bus;
      this.songStart = ctx.currentTime + 0.08 - from;
      let idx = song.events.findIndex((e) => e.t >= from);
      if (idx < 0) idx = song.events.length;
      const tick = () => {
        const horizon = ctx.currentTime + 0.15;
        while (idx < song.events.length && this.songStart + song.events[idx].t < horizon) {
          const e = song.events[idx++];
          const t = this.songStart + e.t;
          if (t >= ctx.currentTime - 0.02) this.play(e, t, bus);
        }
      };
      tick();
      this.timer = setInterval(tick, 25);
    }

    time() { return this.ctx.currentTime - this.songStart; }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.bus) {
        const b = this.bus;
        b.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
        setTimeout(() => b.disconnect(), 250);
      }
      this.bus = null;
    }

    play(e, t, dest) {
      switch (e.inst) {
        case 'kick': return this.kick(t, dest, e.vel);
        case 'snare': return this.noiseHit(t, dest, 0.38 * e.vel, 0.16, 'bandpass', 1800);
        case 'hat': return this.noiseHit(t, dest, 0.12 * e.vel, 0.04, 'highpass', 7500);
        case 'bass': return this.tone(t, mtof(e.midi), e.dur, 'sawtooth', 0.18, dest, 700);
        case 'arp': return this.tone(t, mtof(e.midi), e.dur, 'square', 0.04 * e.vel, dest, 2600);
        case 'lead':
          this.tone(t, mtof(e.midi), e.dur, 'triangle', 0.12, dest, 5000);
          return this.tone(t, mtof(e.midi) * 1.004, e.dur, 'sawtooth', 0.03, dest, 2200);
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
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, dur));
      o.connect(f); f.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur + 0.05);
    }

    kick(t, dest, vel) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.9 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
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
  }

  root.Synth = { composeSong, songToCandidates, SynthPlayer, mtof };
})(window);
