/*
 * Construye el mapa (obstáculos) y el mundo (paisaje, colores, nombre) de cada canción.
 */
(function (root) {
  'use strict';
  const { rng, noise1 } = root.U;

  const DIFF = {
    facil: { label: 'Fácil', minGap: 0.5, maxLanes: 1, minStrength: 0.5, pps: 380, hints: true },
    normal: { label: 'Normal', minGap: 0.3, maxLanes: 1, minStrength: 0.3, pps: 460, hints: true },
    dificil: { label: 'Difícil', minGap: 0.19, maxLanes: 2, minStrength: 0.2, pps: 560, hints: false },
  };

  /**
   * src: { candidates:[{t, lanes, strength}], bpm, offset, duration, sections }
   */
  function buildChart(src, diffName) {
    const d = DIFF[diffName] || DIFF.normal;
    const grid = 60 / src.bpm / 4;
    const beat = 60 / src.bpm;
    let cands = src.candidates
      .filter((c) => c.t > 1.8 && c.t < src.duration - 0.4)
      .map((c) => {
        const k = Math.round((c.t - src.offset) / grid);
        const snapped = src.offset + k * grid;
        const t = Math.abs(snapped - c.t) < 0.05 ? snapped : c.t;
        // los golpes que caen en el tiempo pesan más (más fáciles de sentir)
        const onBeat = Math.abs(((t - src.offset) / beat) - Math.round((t - src.offset) / beat)) < 0.08;
        const onHalf = Math.abs(((t - src.offset) / (beat / 2)) - Math.round((t - src.offset) / (beat / 2))) < 0.1;
        const w = onBeat ? 1.15 : onHalf ? 1 : diffName === 'dificil' ? 0.9 : 0.7;
        return { t, lanes: c.lanes.slice(), strength: c.strength * w };
      })
      .sort((a, b) => a.t - b.t);

    // unir golpes simultáneos
    const merged = [];
    for (const c of cands) {
      const last = merged[merged.length - 1];
      if (last && c.t - last.t < 0.03) {
        if (c.strength > last.strength) {
          last.lanes = c.lanes.concat(last.lanes.filter((l) => c.lanes.indexOf(l) === -1));
          last.strength = c.strength;
        } else {
          for (const l of c.lanes) if (last.lanes.indexOf(l) === -1) last.lanes.push(l);
        }
      } else {
        merged.push({ ...c });
      }
    }

    // escoger los golpes más fuertes respetando la separación mínima
    const accepted = [];
    const times = [];
    const tooClose = (t) => {
      let lo = 0, hi = times.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; }
      return (lo < times.length && times[lo] - t < d.minGap) || (lo > 0 && t - times[lo - 1] < d.minGap);
    };
    for (const c of merged.slice().sort((a, b) => b.strength - a.strength)) {
      if (c.strength < d.minStrength) break;
      if (tooClose(c.t)) continue;
      accepted.push(c);
      let lo = 0, hi = times.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < c.t) lo = m + 1; else hi = m; }
      times.splice(lo, 0, c.t);
    }
    accepted.sort((a, b) => a.t - b.t);

    const notes = accepted.map((c, i) => ({
      id: i,
      t: c.t,
      lanes: c.lanes.slice(0, c.strength > 0.9 ? d.maxLanes : 1),
    }));
    return {
      notes,
      bpm: src.bpm,
      offset: src.offset,
      duration: src.duration,
      sections: (src.sections && src.sections.length ? src.sections : [{ t: 0, energy: 0.6, type: 'verso' }]),
      diff: d,
      diffName,
    };
  }

  // ---------- mundos ----------
  const BIOMES = ['montanas', 'ciudad', 'tunel', 'oceano', 'cosmos'];
  const BIOME_NAMES = { montanas: 'Cordillera', ciudad: 'Metrópolis', tunel: 'Túnel', oceano: 'Mar de ondas', cosmos: 'Constelación' };
  const NOUNS = ['Valle', 'Delta', 'Bahía', 'Órbita', 'Ciudad', 'Cañón', 'Arrecife', 'Desierto', 'Bosque', 'Archipiélago', 'Faro', 'Glaciar'];
  const ADJS = ['de Cristal', 'de Neón', 'de Ecos', 'Fractal', 'Lunar', 'Abisal', 'Polar', 'Solar', 'de Vidrio', 'Celeste', 'de Ceniza', 'Austral', 'Binario', 'de Seda'];

  function makeWorld(seed) {
    const r = rng(seed ^ 0x9e3779b9);
    const order = BIOMES.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const hue = Math.floor(r() * 360);
    // los adjetivos terminados en -o solo concuerdan con nombres masculinos
    let adj = ADJS[Math.floor(r() * ADJS.length)];
    const noun = NOUNS[Math.floor(r() * NOUNS.length)];
    if (adj === 'Binario' && /a$|d$/.test(noun)) adj = 'Binaria';
    return {
      seed,
      name: `${noun} ${adj}`,
      hue,
      hue2: hue + 140 + Math.floor(r() * 80),
      hue3: hue + 60,
      order,
      sides: 3 + Math.floor(r() * 4),
      noise: noise1(seed),
      noise2: noise1(seed + 7),
      stars: Array.from({ length: 140 }, () => ({ x: r(), y: r(), s: 0.5 + r() * 1.6, p: r() * 6.28 })),
      buildings: Array.from({ length: 40 }, () => ({ w: 40 + r() * 70, h: 40 + r() * 170, rows: 2 + Math.floor(r() * 6), seed: r() })),
      biomeName: (b) => BIOME_NAMES[b],
    };
  }

  function sectionAt(chart, t) {
    let idx = 0;
    for (let i = 0; i < chart.sections.length; i++) if (chart.sections[i].t <= t) idx = i;
    return idx;
  }

  root.Chart = { DIFF, buildChart, makeWorld, sectionAt, BIOMES };
})(window);
