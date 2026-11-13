/*
 * Análisis de un archivo de audio en el navegador:
 *  1. separa graves / medios / agudos con filtros,
 *  2. detecta los golpes (onsets) de cada banda,
 *  3. estima el tempo (BPM) y la fase del compás,
 *  4. mide la energía por compás para dividir la canción en secciones.
 * Cada golpe se convierte en un candidato a obstáculo según la banda que domina.
 */
(function (root) {
  'use strict';

  const SR = 22050;
  const HOP = 256;

  function percentile(arr, p) {
    const step = Math.max(1, Math.floor(arr.length / 4000));
    const sample = [];
    for (let i = 0; i < arr.length; i += step) sample.push(arr[i]);
    sample.sort((a, b) => a - b);
    return sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] || 1e-6;
  }

  async function analyzeAudio(ctx, arrayBuffer, onProgress) {
    const say = (m) => onProgress && onProgress(m);
    say('Decodificando audio…');
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const len = Math.ceil(buffer.duration * SR);

    say('Separando graves, medios y agudos…');
    const off = new OfflineAudioContext(3, len, SR);
    const src = off.createBufferSource();
    src.buffer = buffer;
    const merger = off.createChannelMerger(3);
    const mk = (type, f, q) => { const b = off.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    const filters = [mk('lowpass', 150), mk('bandpass', 1500, 0.7), mk('highpass', 5000)];
    filters.forEach((f, i) => { src.connect(f); f.connect(merger, 0, i); });
    merger.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();

    say('Buscando los golpes de la canción…');
    await new Promise((r) => setTimeout(r, 0));
    const n = Math.floor(len / HOP);
    const fps = SR / HOP;
    const energy = [];   // energía lineal por banda
    const logE = [];
    for (let b = 0; b < 3; b++) {
      const d = rendered.getChannelData(b);
      const e = new Float32Array(n);
      const le = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        const o = i * HOP;
        for (let j = 0; j < HOP; j++) { const v = d[o + j] || 0; s += v * v; }
        e[i] = Math.sqrt(s / HOP);
      }
      // compresión relativa al nivel típico de la banda: así el silencio no exagera los saltos
      const ref = percentile(e, 0.95) + 1e-6;
      for (let i = 0; i < n; i++) le[i] = Math.log(1 + (20 * e[i]) / ref);
      energy.push(e);
      logE.push(le);
    }

    // flujo positivo por banda, normalizado
    const flux = logE.map((le) => {
      const f = new Float32Array(n);
      for (let i = 2; i < n; i++) f[i] = Math.max(0, le[i] - le[i - 2]);
      const p = percentile(f, 0.97);
      for (let i = 0; i < n; i++) f[i] /= p;
      return f;
    });
    const W = [1.0, 0.8, 0.6];
    const nov = new Float32Array(n);
    for (let i = 0; i < n; i++) nov[i] = W[0] * flux[0][i] + W[1] * flux[1][i] + W[2] * flux[2][i];

    // --- tempo por autocorrelación ---
    say('Calculando el tempo…');
    await new Promise((r) => setTimeout(r, 0));
    const minLag = Math.round((fps * 60) / 190), maxLag = Math.round((fps * 60) / 62);
    const scores = [];
    let bestLag = minLag, bestScore = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += nov[i] * nov[i - lag];
      s /= n - lag;
      const bpm = (60 * fps) / lag;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
      scores[lag] = s * w;
      if (scores[lag] > bestScore) { bestScore = scores[lag]; bestLag = lag; }
    }
    let lagF = bestLag;
    const a = scores[bestLag - 1], c = scores[bestLag + 1];
    if (a !== undefined && c !== undefined) {
      const denom = a - 2 * bestScore + c;
      if (denom !== 0) lagF = bestLag + (0.5 * (a - c)) / denom;
    }
    const bpm = Math.round(((60 * fps) / lagF) * 10) / 10;
    const period = (fps * 60) / bpm;

    // fase: dónde caen los tiempos
    let bestPhase = 0, bestSum = -1;
    for (let p = 0; p < period; p++) {
      let s = 0;
      for (let k = p; k < n; k += period) s += nov[Math.round(k)] || 0;
      if (s > bestSum) { bestSum = s; bestPhase = p; }
    }
    const offset = bestPhase / fps;

    // --- golpes (picos) ---
    const win = Math.round(fps * 0.35);
    const pre = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + nov[i];
    const globalMed = percentile(nov, 0.6);
    const novP = percentile(nov, 0.97);
    const candidates = [];
    const sus = Math.round(fps * 0.15), sus2 = Math.round(fps * 0.35);
    for (let i = 3; i < n - 3; i++) {
      const v = nov[i];
      if (v <= 0) continue;
      let isMax = true;
      for (let j = i - 4; j <= i + 4; j++) if (j !== i && nov[j] > v) { isMax = false; break; }
      if (!isMax) continue;
      const lo = Math.max(0, i - win), hi = Math.min(n, i + win);
      const mean = (pre[hi] - pre[lo]) / (hi - lo);
      if (v < mean * 1.35 || v < globalMed) continue;

      const bandVal = [0, 1, 2].map((b) => Math.max(flux[b][i], flux[b][i + 1] || 0, flux[b][i - 1] || 0));
      const order = [0, 1, 2].sort((x, y) => bandVal[y] - bandVal[x]);
      const toLane = (b) => {
        if (b === 0) return 3;
        if (b === 2) return 2;
        // medios: ¿golpe corto (caja) o nota sostenida (melodía)?
        const peak = energy[1][i] + 1e-6;
        let s = 0, cnt = 0;
        for (let k = i + sus; k < Math.min(n, i + sus2); k++) { s += energy[1][k]; cnt++; }
        return cnt && s / cnt / peak > 0.72 ? 1 : 0;
      };
      const lanes = [toLane(order[0])];
      if (bandVal[order[1]] >= 0.8 * bandVal[order[0]] && bandVal[order[1]] > 0.6) {
        const l2 = toLane(order[1]);
        if (l2 !== lanes[0]) lanes.push(l2);
      }
      candidates.push({ t: (i * HOP + HOP / 2) / SR, lanes, strength: Math.min(1.5, v / novP) });
    }

    // --- secciones por energía (bloques de 8 compases) ---
    const barFrames = period * 4;
    const blockFrames = barFrames * 8;
    const total = new Float32Array(n);
    for (let i = 0; i < n; i++) total[i] = energy[0][i] + energy[1][i] + energy[2][i];
    const blocks = [];
    for (let s = bestPhase; s < n; s += blockFrames) {
      let sum = 0, cnt = 0;
      for (let k = Math.floor(s); k < Math.min(n, s + blockFrames); k++) { sum += total[k]; cnt++; }
      blocks.push({ t: s / fps, e: cnt ? sum / cnt : 0 });
    }
    const maxE = Math.max(...blocks.map((b) => b.e), 1e-6);
    const sections = blocks.map((b) => ({ t: b.t, energy: b.e / maxE, type: b.e / maxE > 0.8 ? 'drop' : b.e / maxE > 0.55 ? 'verso' : 'puente' }));
    if (sections.length) sections[0].t = 0;

    say('¡Listo!');
    return { buffer, bpm, offset, duration: buffer.duration, candidates, sections };
  }

  root.Analysis = { analyzeAudio };
})(window);
