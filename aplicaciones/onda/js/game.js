/* Pulso Onda — bucle de juego, juicio de pulsaciones, modos y estudio. */
(function () {
  'use strict';
  const { U, R, Chart, Sources, Jam } = window;
  const { LANES, clamp, hsl, store } = U;
  const { Hub, Embed, SynthSource, FileSource, EmbedSource } = Sources;

  const W = 1280, H = 720;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  const $ = (id) => document.getElementById(id);

  const PERFECT = 0.055, GOOD = 0.125;
  const KEYS_P1 = ['A', 'S', 'D', 'F'];
  const KEYS_P2 = ['J', 'K', 'L', 'Ñ'];
  const MAP_P1 = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
  const MAP_P2 = { KeyJ: 0, KeyK: 1, KeyL: 2, Semicolon: 3 };
  const MODES = {
    cinta: { label: 'Cinta', players: 1 },
    fusion: { label: 'Fusión', players: 1 },
    duelo: { label: 'Jam · Duelo', players: 2 },
    duo: { label: 'Jam · Dúo', players: 2 },
  };

  // ---------- ajustes guardados ----------
  const st = Object.assign({
    source: 'synth', seed: (Math.random() * 1e9) >>> 0, link: '', gira: '', mode: 'cinta', diff: 'normal',
    relax: false, latency: 0, volume: 0.9, bpm: null, phase: 0, tapKey: '',
  }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', st);
  const bests = store.get('bests', {});

  // ---------- estado de la partida ----------
  const S = {
    screen: 'studio', source: null, chart: null, world: null, input: null, players: [], file: null,
    queue: [], queueIdx: 0, banner: null, shake: 0, flash: 0, startTime: 0, pausedAt: 0, ended: false, waiting: false,
  };

  function newPlayer(i) {
    return {
      i, notes: [], idx: 0, score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, stray: 0,
      energy: 60, fever: 0, feverUntil: 0, anim: null, hurtUntil: 0, popups: [], stars: [], pressed: [false, false, false, false],
      dead: false, total: 0,
    };
  }

  function assignNotes() {
    const mode = st.mode;
    const base = S.chart.notes;
    S.players.forEach((p) => { p.notes = []; p.idx = 0; });
    for (const n of base) {
      if (mode === 'duo') {
        // dúo: graves y golpes para J1, melodía y agudos para J2
        const a = n.lanes.filter((l) => l === 0 || l === 3), b = n.lanes.filter((l) => l === 1 || l === 2);
        if (a.length) S.players[0].notes.push(mkNote(n, a));
        if (b.length) S.players[1].notes.push(mkNote(n, b));
      } else {
        for (const p of S.players) p.notes.push(mkNote(n, n.lanes));
      }
    }
    S.players.forEach((p) => { p.total += p.notes.length; });
  }
  const mkNote = (n, lanes) => ({ id: n.id, t: n.t, lanes: lanes.slice(), state: 0, hits: {}, judgedAt: 0 });

  // ---------- crear fuente según el estudio ----------
  function makeSource(entry) {
    if (entry) return new EmbedSource(entry, {});
    switch (st.source) {
      case 'file':
        if (!S.file) throw new Error('Elige primero un archivo de audio.');
        return new FileSource(S.file);
      case 'spotify':
      case 'youtube': {
        const link = U.parseLink(st.link);
        if (!link) throw new Error('Pega un enlace válido de Spotify o YouTube.');
        if (U.embedsBlocked) throw new Error('Dentro de Claude no se pueden cargar Spotify ni YouTube. Abre el juego en tu navegador o usa «Generador» o «Mi archivo».');
        const custom = st.tapKey === link.key && st.bpm ? { bpm: st.bpm, offset: st.phase } : {};
        return new EmbedSource(link, custom);
      }
      case 'gira':
        throw new Error('internal');
      default:
        return new SynthSource(st.seed);
    }
  }

  async function startGame(fromQueue) {
    const status = $('studio-status');
    try {
      Hub.get();
      Hub.setVolume(st.volume);
      let entry = null;
      if (st.source === 'gira' && !fromQueue) {
        S.queue = st.gira.split(/\s+/).map(U.parseLink).filter(Boolean);
        S.queueIdx = 0;
        if (!S.queue.length) throw new Error('Pega al menos un enlace de Spotify o YouTube (uno por línea).');
        if (U.embedsBlocked) throw new Error('Dentro de Claude no se pueden cargar Spotify ni YouTube. Abre el juego en tu navegador.');
      }
      if (st.source === 'gira') entry = S.queue[S.queueIdx];
      else S.queue = [];
      if (S.source) S.source.stop();
      status.textContent = 'Preparando la música…';
      status.className = 'status';
      $('btn-start').disabled = true;
      const source = makeSource(entry);
      const input = await source.prepare((m) => { status.textContent = m; });
      S.source = source;
      S.input = input;
      S.chart = Chart.buildChart(input, st.diff);
      S.world = Chart.makeWorld(input.seed);
      S.players = Array.from({ length: MODES[st.mode].players }, (_, i) => newPlayer(i));
      assignNotes();
      S.ended = false;
      S.lastNow = 0;
      S.banner = { text: S.world.name, sub: input.title, t0: performance.now() };
      showScreen('play');
      S.screen = 'play';
      S.waiting = source instanceof EmbedSource;
      source.start(0);
      status.textContent = '';
    } catch (e) {
      status.textContent = e.message === 'internal' ? 'Algo salió mal.' : e.message || String(e);
      status.className = 'status error';
      showScreen('studio');
    } finally {
      $('btn-start').disabled = false;
    }
  }

  // Cambio de canción dentro de una lista de Spotify: nuevo mundo sin parar.
  Embed.listeners.add((info) => {
    if (S.screen !== 'play' || !(S.source instanceof EmbedSource)) return;
    const input = S.source.compose(info.duration, info.uri);
    S.input = input;
    S.chart = Chart.buildChart(input, st.diff);
    S.world = Chart.makeWorld(input.seed);
    assignNotes();
    S.banner = { text: 'Nuevo mundo: ' + S.world.name, sub: input.title, t0: performance.now() };
  });

  // ---------- juicio ----------
  function songTime(eventStamp) {
    const t = S.source && S.source.time();
    if (t == null) return null;
    const lag = eventStamp ? Math.max(0, (performance.now() - eventStamp) / 1000) : 0;
    return t - lag - st.latency / 1000;
  }

  function press(pi, lane, stamp) {
    const p = S.players[pi];
    if (!p || S.screen !== 'play' || p.dead) return;
    p.pressed[lane] = true;
    const t = songTime(stamp);
    if (t == null) return;
    let best = null, bestD = Infinity;
    for (let k = p.idx; k < p.notes.length; k++) {
      const n = p.notes[k];
      if (n.t - t > GOOD) break;
      if (n.state !== 0 || n.lanes.indexOf(lane) === -1 || n.hits[lane] !== undefined) continue;
      const d = Math.abs(n.t - t);
      if (d <= GOOD && d < bestD) { best = n; bestD = d; }
    }
    if (!best) {
      p.stray++;
      p.energy = Math.max(st.relax ? 1 : 0, p.energy - 2);
      popup(p, '·', '#8890b0');
      return;
    }
    best.hits[lane] = t - best.t;
    if (best.lanes.every((l) => best.hits[l] !== undefined)) {
      const worst = Math.max(...best.lanes.map((l) => Math.abs(best.hits[l])));
      judge(p, best, worst <= PERFECT ? 'perfect' : 'good', lane);
    }
  }

  function release(pi, lane) { const p = S.players[pi]; if (p) p.pressed[lane] = false; }

  function judge(p, n, grade, lane) {
    n.state = grade === 'miss' ? 2 : 1;
    n.judgedAt = songTime() || n.t;
    const fever = performance.now() < p.feverUntil;
    if (grade === 'miss') {
      p.miss++;
      p.combo = 0;
      p.energy = Math.max(st.relax ? 1 : 0, p.energy - 10);
      p.hurtUntil = performance.now() + 300;
      p.anim = { kind: 'miss', t0: performance.now() };
      popup(p, 'FALLO', '#ff3355');
      S.shake = Math.max(S.shake, 0.25);
      if (p.energy <= 0 && !st.relax) p.dead = true;
      return;
    }
    p.combo++;
    p.maxCombo = Math.max(p.maxCombo, p.combo);
    const mult = (1 + Math.min(3, Math.floor(p.combo / 10))) * (fever ? 2 : 1);
    if (grade === 'perfect') {
      p.perfect++;
      p.score += 300 * mult * n.lanes.length;
      p.energy = Math.min(100, p.energy + 2.5);
      p.fever = Math.min(100, p.fever + 3.5);
      popup(p, 'PERFECTO', '#7dffb2');
      // cada acierto perfecto deja una estrella en tu constelación
      p.stars.push({ x: clamp(n.t / S.chart.duration, 0, 1), y: 0.1 + 0.8 * ((n.lanes[0] + ((n.id * 0.618) % 1)) / 4), lane: n.lanes[0] });
    } else {
      p.good++;
      p.score += 100 * mult * n.lanes.length;
      p.energy = Math.min(100, p.energy + 1);
      p.fever = Math.min(100, p.fever + 1.5);
      popup(p, 'BIEN', '#5ce1ff');
    }
    p.anim = { kind: 'hit', lane: lane != null ? lane : n.lanes[0], t0: performance.now() };
  }

  function popup(p, text, color) {
    p.lastJudge = text;
    p.judgeN = (p.judgeN || 0) + 1;
    p.popups.push({ text, color, t0: performance.now() });
    if (p.popups.length > 4) p.popups.shift();
  }

  function activateFever(pi) {
    const p = S.players[pi];
    if (!p || p.fever < 100 || S.screen !== 'play') return;
    p.fever = 0;
    p.feverUntil = performance.now() + 8000;
    if (Jam.active) Jam.bumpFx();
    S.flash = 0.6;
    popup(p, '¡RESONANCIA!', '#ffd35c');
  }

  // ---------- teclado y táctil ----------
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (S.screen === 'play') {
      const two = MODES[st.mode].players === 2;
      if (e.code in MAP_P1) { e.preventDefault(); if (!e.repeat) press(0, MAP_P1[e.code], e.timeStamp); return; }
      if (e.code in MAP_P2) { e.preventDefault(); if (!e.repeat) press(two ? 1 : 0, MAP_P2[e.code], e.timeStamp); return; }
      if (e.code === 'Space') { e.preventDefault(); activateFever(0); return; }
      if (e.code === 'Enter') { e.preventDefault(); activateFever(two ? 1 : 0); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { pause(); return; }
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        st.latency += e.code === 'BracketLeft' ? -10 : 10;
        saveSettings();
        S.banner = { text: `Ajuste de ritmo: ${st.latency} ms`, sub: '[ adelanta · ] retrasa', t0: performance.now(), short: true };
      }
    } else if (S.screen === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) {
      resume();
    } else if (S.screen === 'studio' && e.code === 'KeyT') {
      tap();
    }
  });
  window.addEventListener('keyup', (e) => {
    const two = MODES[st.mode].players === 2;
    if (e.code in MAP_P1) release(0, MAP_P1[e.code]);
    if (e.code in MAP_P2) release(two ? 1 : 0, MAP_P2[e.code]);
  });

  function buildTouchPad() {
    const pad = $('touch-pad');
    pad.innerHTML = '';
    const players = MODES[st.mode].players;
    for (let pi = 0; pi < players; pi++) {
      const group = document.createElement('div');
      group.className = 'pad-group';
      for (let l = 0; l < 4; l++) {
        const b = document.createElement('button');
        b.className = 'pad-btn';
        b.style.setProperty('--c', LANES[l].color);
        b.setAttribute('aria-label', `${LANES[l].name}${players > 1 ? ' jugador ' + (pi + 1) : ''}`);
        const c = document.createElement('canvas');
        c.width = 60; c.height = 40;
        const cx = c.getContext('2d');
        R.laneIcon(cx, l, 30, 14, 36, LANES[l].color, 0.6);
        b.appendChild(c);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(pi, l, e.timeStamp); });
        b.addEventListener('pointerup', () => release(pi, l));
        b.addEventListener('pointerleave', () => release(pi, l));
        group.appendChild(b);
      }
      const f = document.createElement('button');
      f.className = 'pad-btn fever';
      f.textContent = '✦';
      f.setAttribute('aria-label', 'Resonancia');
      f.addEventListener('pointerdown', (e) => { e.preventDefault(); activateFever(pi); });
      group.appendChild(f);
      pad.appendChild(group);
    }
  }

  // ---------- pausa / fin ----------
  function pause() {
    if (S.screen !== 'play') return;
    S.pausedAt = S.source.pause() || 0;
    S.screen = 'pause';
    showScreen('pause');
  }
  function resume() {
    showScreen('play');
    S.screen = 'play';
    S.source.start(S.pausedAt);
    S.waiting = S.source instanceof EmbedSource;
  }
  function quitToStudio() {
    if (S.source) S.source.stop();
    if (Jam.active) Jam.set({ phase: 'lobby' });
    S.screen = 'studio';
    showScreen('studio');
    renderStudio();
  }

  function grade(p) {
    const total = p.perfect + p.good + p.miss;
    if (!total) return { letter: '—', acc: 0 };
    const acc = (p.perfect + p.good * 0.6) / total;
    const letter = p.dead ? 'X' : acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
    return { letter, acc };
  }

  function finish(reason) {
    if (S.ended) return;
    S.ended = true;
    S.source.stop();
    S.screen = 'results';
    const key = `${S.source.key}|${st.mode}|${st.diff}`;
    const html = S.players.map((p, i) => {
      const g = grade(p);
      const prev = bests[key + '|' + i] || 0;
      const isBest = p.score > prev;
      if (isBest) bests[key + '|' + i] = p.score;
      return `<div class="res-player">
        ${S.players.length > 1 ? `<div class="res-who">Jugador ${i + 1}</div>` : ''}
        <div class="res-grade grade-${g.letter}">${g.letter}</div>
        <div class="res-score">${p.score.toLocaleString('es')}${isBest ? ' <span class="badge">récord</span>' : ''}</div>
        <dl class="res-stats">
          <div><dt>Precisión</dt><dd>${Math.round(g.acc * 100)}%</dd></div>
          <div><dt>Perfectos</dt><dd>${p.perfect}</dd></div>
          <div><dt>Bien</dt><dd>${p.good}</dd></div>
          <div><dt>Fallos</dt><dd>${p.miss}</dd></div>
          <div><dt>Combo máx.</dt><dd>${p.maxCombo}</dd></div>
          <div><dt>Forma final</dt><dd>${R.FORMS[R.formFor(p.energy)]}</dd></div>
        </dl>
      </div>`;
    }).join('');
    store.set('bests', bests);
    if (Jam.active) {
      const g0 = grade(S.players[0]);
      Jam.set({ phase: 'done', score: S.players[0].score, acc: Math.round(g0.acc * 100), grade: g0.letter, prog: 100 });
      Jam.flush();
    }
    let title = reason === 'dead' ? 'El mundo se apagó' : 'Canción completada';
    if (S.players.length === 2 && st.mode === 'duelo') {
      const [a, b] = S.players;
      title = a.score === b.score ? 'Empate' : `Gana el jugador ${a.score > b.score ? 1 : 2}`;
    }
    if (S.players.length === 2 && st.mode === 'duo') title = 'Dúo · ' + (S.players[0].score + S.players[1].score).toLocaleString('es') + ' puntos juntos';
    $('res-title').textContent = title;
    $('res-world').textContent = S.world.name + ' · ' + MODES[st.mode].label + ' · ' + S.chart.diff.label;
    $('res-players').innerHTML = html;
    $('btn-next-song').classList.toggle('hidden', !(S.queue.length && S.queueIdx < S.queue.length - 1));
    $('res-code').value = currentCode();
    showScreen('results');
    renderRoomBoard();
    drawResultsSky();
  }

  function drawResultsSky() {
    const c = $('res-sky');
    const x = c.getContext('2d');
    const t = performance.now() / 1000;
    x.fillStyle = '#05040f';
    x.fillRect(0, 0, c.width, c.height);
    const n = S.players.length;
    S.players.forEach((p, i) => {
      R.drawConstellation(x, p.stars, { x: 16 + (i * (c.width - 16)) / n, y: 16, w: (c.width - 32) / n - 8, h: c.height - 32 }, S.world.hue + i * 120, t);
    });
    if (S.screen === 'results') requestAnimationFrame(drawResultsSky);
  }

  // ---------- código de Jam ----------
  function currentCode() {
    const o = { v: 1, s: st.source, m: st.mode, d: st.diff };
    if (st.source === 'synth') o.seed = st.seed;
    if (st.source === 'spotify' || st.source === 'youtube') { o.l = st.link; if (st.bpm && st.tapKey === (U.parseLink(st.link) || {}).key) { o.b = st.bpm; o.p = st.phase; } }
    if (st.source === 'gira') o.g = st.gira;
    if (st.source === 'file' && S.file) o.f = S.file.name;
    return 'ONDA-' + U.encodeCode(o);
  }

  function loadCode(code) {
    const o = U.decodeCode(String(code).replace(/^ONDA-/, ''));
    if (!o || !o.s) return 'Ese código no es válido.';
    st.source = o.s; st.mode = o.m || st.mode; st.diff = o.d || st.diff;
    if (o.seed) st.seed = o.seed;
    if (o.l) { st.link = o.l; const lk = U.parseLink(o.l); if (o.b && lk) { st.bpm = o.b; st.phase = o.p || 0; st.tapKey = lk.key; } }
    if (o.g) st.gira = o.g;
    saveSettings();
    renderStudio();
    return o.f ? `Código cargado. Elige el archivo «${o.f}» para jugar el mismo mundo.` : 'Código cargado: mismo mundo, mismo mapa.';
  }

  // ---------- tap tempo ----------
  let taps = [];
  function tap() {
    const now = performance.now();
    const songT = Embed.time();
    if (taps.length && now - taps[taps.length - 1].real > 2000) taps = [];
    taps.push({ real: now, song: songT });
    const el = $('tap-status');
    if (taps.length < 4) { el.textContent = `Sigue tocando al ritmo… (${taps.length}/4)`; return; }
    const d = [];
    for (let i = 1; i < taps.length; i++) d.push(taps[i].real - taps[i - 1].real);
    d.sort((a, b) => a - b);
    let bpm = 60000 / d[Math.floor(d.length / 2)];
    while (bpm < 70) bpm *= 2;
    while (bpm > 190) bpm /= 2;
    bpm = Math.round(bpm);
    const period = 60 / bpm;
    let phase = 0;
    const withSong = taps.filter((x) => x.song != null);
    if (withSong.length >= 3) {
      let sx = 0, sy = 0;
      for (const x of withSong) { const a = ((x.song % period) / period) * Math.PI * 2; sx += Math.cos(a); sy += Math.sin(a); }
      phase = (((Math.atan2(sy, sx) / (Math.PI * 2)) + 1) % 1) * period;
    }
    const link = U.parseLink(st.link);
    st.bpm = bpm; st.phase = phase; st.tapKey = link ? link.key : '';
    saveSettings();
    $('bpm-input').value = bpm;
    el.textContent = withSong.length >= 3 ? `${bpm} BPM y compás sincronizados con la canción.` : `${bpm} BPM. Para sincronizar el compás, toca mientras suena en el reproductor.`;
  }

  // ---------- bucle principal ----------
  function update() {
    if (S.screen !== 'play') return;
    const now = songTime();
    if (now == null) { S.waiting = true; return; }
    S.waiting = false;
    for (const p of S.players) {
      while (p.idx < p.notes.length && p.notes[p.idx].state !== 0) p.idx++;
      for (let k = p.idx; k < p.notes.length; k++) {
        const n = p.notes[k];
        if (n.t > now - GOOD) break;
        if (n.state === 0) judge(p, n, 'miss');
      }
    }
    if (Jam.active) {
      const p0 = S.players[0];
      Jam.set({
        phase: 'play', score: p0.score, combo: p0.combo, energy: Math.round(p0.energy), form: R.formFor(p0.energy),
        judge: p0.lastJudge || '', judgeN: p0.judgeN || 0, prog: Math.round(clamp(now / S.chart.duration, 0, 1) * 100),
      });
    }
    const embedEnd = S.source instanceof EmbedSource && Embed.duration && now >= Embed.duration - 0.4;
    const fileEnd = S.source instanceof FileSource && S.source.ended;
    if (now >= S.chart.duration + 0.3 || embedEnd || fileEnd) {
      finish('end');
      return;
    }
    if (S.players.every((p) => p.dead)) finish('dead');
  }

  function layout() {
    switch (st.mode) {
      case 'fusion': return { horizon: 250, ribbons: [250], charX: 230, highway: { x: 360, y: 280, w: 560, h: 430 } };
      case 'duelo':
      case 'duo': return { horizon: 300, ribbons: [300, 590], charX: 230 };
      default: return { horizon: 470, ribbons: [470], charX: 260 };
    }
  }

  function draw() {
    const tNow = performance.now() / 1000;
    ctx.save();
    ctx.fillStyle = '#05040f';
    ctx.fillRect(0, 0, W, H);
    if (!S.chart) { ctx.restore(); return; }
    const live = S.screen === 'play' ? songTime() : null;
    if (live != null) S.lastNow = live;
    const now = live ?? S.lastNow ?? 0;
    const L = layout();
    if (S.shake > 0) ctx.translate((Math.random() - 0.5) * 16 * S.shake, (Math.random() - 0.5) * 16 * S.shake);
    const lv = S.source.levels() || Sources.beatLevels(now, S.chart.bpm);
    const beatPh = ((((now - S.chart.offset) * S.chart.bpm) / 60) % 1 + 1) % 1;
    const secIdx = Chart.sectionAt(S.chart, now);
    const sec = S.chart.sections[secIdx];
    const fever = S.players.some((p) => performance.now() < p.feverUntil);
    const biome = S.world.order[secIdx % S.world.order.length];
    const fade = clamp((now - sec.t) / 1.2, 0, 1);
    const common = { world: S.world, t: now, beatPh, lv, fever, horizon: L.horizon, energy: sec.energy, bpm: S.chart.bpm };
    if (fade < 1 && secIdx > 0) {
      R.drawWorld(ctx, W, H, { ...common, biome: S.world.order[(secIdx - 1) % S.world.order.length], alpha: 1 - fade, floor: false });
    }
    R.drawWorld(ctx, W, H, { ...common, biome, alpha: fade < 1 && secIdx > 0 ? fade : 1 });
    // la constelación que vas creando aparece en el cielo
    S.players.forEach((p, i) => R.drawConstellation(ctx, p.stars, { x: 40, y: 30 + i * 20, w: W - 80, h: L.horizon - 160 }, S.world.hue + 40 + i * 120, tNow));

    const ribbonColor = fever ? hsl(S.world.hue + tNow * 120, 100, 75) : hsl(S.world.hue2, 30, 92);
    S.players.forEach((p, i) => {
      const y = L.ribbons[i];
      const keys = MODES[st.mode].players === 2 && i === 1 ? KEYS_P2 : KEYS_P1;
      R.drawRibbon(ctx, W, {
        y, notes: p.notes, now, pps: S.chart.diff.pps, charX: L.charX, color: p.dead ? '#3a3550' : ribbonColor,
        t: now, lv, fever: performance.now() < p.feverUntil, glitch: S.interfereUntil > performance.now() ? 1 : 0, hints: S.chart.diff.hints && st.mode !== 'fusion' && !document.body.classList.contains('touch'), keySet: keys,
      });
      const pos = R.drawCharacter(ctx, L.charX, y, {
        form: R.formFor(p.energy), color: performance.now() < p.feverUntil ? hsl(tNow * 200, 100, 70) : hsl(S.world.hue + 180, 90, 72),
        anim: p.anim, t: tNow, beatPh, hurt: performance.now() < p.hurtUntil || p.dead,
      });
      drawPlayerHud(p, i, y, pos, keys);
    });

    if (Jam.active) drawGhosts(L, tNow, beatPh);

    if (L.highway) {
      const p = S.players[0];
      R.drawHighway(ctx, L.highway, {
        notes: p.notes, now, look: (W - L.charX) / S.chart.diff.pps, pressed: p.pressed, keySet: KEYS_P1, t: tNow,
        hue: S.world.hue2, bpm: S.chart.bpm, offset: S.chart.offset,
      });
    }
    ctx.restore();

    drawTopHud(now);
    if (S.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${S.flash * 0.25})`; ctx.fillRect(0, 0, W, H); }
    drawBanner();
    if (S.waiting && S.screen === 'play') drawWaiting();
  }

  // ---------- jam en línea: fantasmas y marcador ----------
  const ghostAnim = new Map();
  function drawGhosts(L, tNow, beatPh) {
    const others = Jam.others().filter((p) => p.state.phase === 'play' || p.state.phase === 'done').slice(0, 6);
    const y = L.ribbons[0];
    others.forEach((p, k) => {
      const s = p.state;
      let a = ghostAnim.get(p.id);
      if (!a || a.n !== s.judgeN) {
        a = { n: s.judgeN, t0: performance.now(), judge: s.judge };
        ghostAnim.set(p.id, a);
      }
      const hit = a.judge === 'PERFECTO' || a.judge === 'BIEN';
      const x = L.charX - 52 * (k + 1);
      ctx.save();
      ctx.globalAlpha = 0.5;
      R.drawCharacter(ctx, x, y, {
        form: Number(s.form) || 0, color: hsl(Number(s.hue) || 0, 90, 70), t: tNow, beatPh,
        anim: hit ? { kind: 'hit', lane: (a.n || 0) % 4, t0: a.t0 } : a.judge === 'FALLO' ? { kind: 'miss', t0: a.t0 } : null,
      });
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = hsl(Number(s.hue) || 0, 90, 75);
      ctx.font = '600 11px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(s.nick || '').slice(0, 10), x, y + 22);
      ctx.restore();
    });
    // marcador de la sala
    const me = S.players[0];
    const rows = [{ nick: (Jam.state.nick || 'Tú') + ' (tú)', score: me.score, combo: me.combo, hue: Jam.state.hue, judge: me.lastJudge, done: false }]
      .concat(Jam.others().map((p) => ({ nick: String(p.state.nick || 'Jugador'), score: Number(p.state.score) || 0, combo: Number(p.state.combo) || 0, hue: Number(p.state.hue) || 0, judge: p.state.judge, done: p.state.phase === 'done', lobby: p.state.phase === 'lobby' })))
      .sort((a, b) => b.score - a.score).slice(0, 7);
    const x0 = 20, y0 = 74;
    ctx.fillStyle = 'rgba(5,4,15,0.55)';
    ctx.fillRect(x0 - 8, y0 - 16, 250, rows.length * 22 + 12);
    rows.forEach((r, i) => {
      const yy = y0 + i * 22;
      ctx.fillStyle = hsl(r.hue || 0, 90, 70);
      ctx.fillRect(x0, yy - 9, 8, 8);
      ctx.font = '600 13px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = r.lobby ? 'rgba(255,255,255,0.4)' : '#fff';
      ctx.fillText(`${i + 1}. ${r.nick.slice(0, 14)}`, x0 + 14, yy);
      ctx.textAlign = 'right';
      ctx.fillText(r.lobby ? 'en el estudio' : r.done ? `${r.score.toLocaleString('es')} ✓` : r.score.toLocaleString('es'), x0 + 234, yy);
    });
    if (Jam.lost()) {
      ctx.fillStyle = '#ff6b85';
      ctx.textAlign = 'left';
      ctx.fillText('Se perdió la conexión con la sala.', x0, y0 + rows.length * 22 + 8);
    }
    // interferencia recibida
    if (S.interfereUntil > performance.now()) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = hsl(Math.random() * 360, 100, 60, 0.12);
        ctx.fillRect(0, Math.random() * H, W, 2 + Math.random() * 10);
      }
      ctx.restore();
    }
  }

  function renderRoomBoard() {
    const el = $('res-room');
    if (!Jam.active) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = '';
    const h = document.createElement('h3');
    h.textContent = 'Sala ' + Jam.code;
    el.appendChild(h);
    const rows = Jam.peers().map((p) => ({ me: p.me, nick: String(p.state.nick || 'Jugador'), score: Number(p.state.score) || 0, phase: p.state.phase, grade: p.state.grade, hue: Number(p.state.hue) || 0, prog: Number(p.state.prog) || 0 }))
      .sort((a, b) => b.score - a.score);
    const ol = document.createElement('ol');
    for (const r of rows) {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = hsl(r.hue, 90, 65);
      const name = document.createElement('span');
      name.textContent = r.nick + (r.me ? ' (tú)' : '');
      const val = document.createElement('b');
      val.textContent = r.phase === 'done' ? `${r.score.toLocaleString('es')} · ${r.grade || ''}` : r.phase === 'play' ? `jugando ${r.prog}% · ${r.score.toLocaleString('es')}` : 'en el estudio';
      li.append(dot, name, val);
      ol.appendChild(li);
    }
    el.appendChild(ol);
  }

  function drawTopHud(now) {
    const pct = clamp(now / S.chart.duration, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, W, 4);
    ctx.fillStyle = hsl(S.world.hue + 180, 90, 70);
    ctx.fillRect(0, 0, W * pct, 4);
    ctx.font = '600 15px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(S.world.name, 20, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '13px "Inter", system-ui, sans-serif';
    const biome = S.world.order[Chart.sectionAt(S.chart, now) % S.world.order.length];
    ctx.fillText(`${S.world.biomeName(biome)} · ${Math.round(S.chart.bpm)} BPM · ${MODES[st.mode].label}`, 20, 50);
  }

  function drawPlayerHud(p, i, y, pos, keys) {
    const two = S.players.length === 2;
    const x0 = W - 300;
    const top = two ? y - 120 : 22;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '700 30px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText(p.score.toLocaleString('es'), W - 24, top + 24);
    ctx.font = '12px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(two ? `JUGADOR ${i + 1} · ${keys.join(' ')}` : 'PUNTOS', W - 24, top + 42);
    // energía
    const bw = 220;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x0 + 56, top + 52, bw, 6);
    ctx.fillStyle = p.energy < 25 ? '#ff3355' : hsl(140 * (p.energy / 100), 90, 60);
    ctx.fillRect(x0 + 56, top + 52, (bw * p.energy) / 100, 6);
    // resonancia
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x0 + 56, top + 64, bw, 4);
    const fever = performance.now() < p.feverUntil;
    ctx.fillStyle = fever ? '#fff' : p.fever >= 100 ? hsl(performance.now() / 5, 100, 70) : '#ffd35c';
    ctx.fillRect(x0 + 56, top + 64, fever ? (bw * (p.feverUntil - performance.now())) / 8000 : (bw * p.fever) / 100, 4);
    ctx.textAlign = 'left';
    ctx.font = '11px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(R.FORMS[R.formFor(p.energy)].toUpperCase(), x0, top + 58);
    ctx.fillText(p.fever >= 100 && !fever ? (i === 0 ? 'ESPACIO' : 'ENTER') : 'RESON.', x0, top + 70);
    // combo y juicios junto al personaje
    if (p.combo >= 5) {
      ctx.textAlign = 'center';
      ctx.font = '700 22px "Space Grotesk", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(`${p.combo}`, pos.x, y + 52);
      ctx.font = '10px "Inter", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('COMBO', pos.x, y + 65);
    }
    const nowMs = performance.now();
    p.popups = p.popups.filter((q) => nowMs - q.t0 < 600);
    p.popups.forEach((q, k) => {
      const age = (nowMs - q.t0) / 600;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = q.color;
      ctx.textAlign = 'center';
      ctx.font = '700 18px "Space Grotesk", system-ui, sans-serif';
      ctx.fillText(q.text, pos.x + 40, pos.y - 46 - age * 30 - k * 4);
      ctx.globalAlpha = 1;
    });
    if (p.dead) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3355';
      ctx.font = '700 20px "Space Grotesk", system-ui, sans-serif';
      ctx.fillText('SIN ENERGÍA', W / 2, y - 30);
    }
  }

  function drawBanner() {
    const b = S.banner;
    if (!b) return;
    const age = (performance.now() - b.t0) / 1000;
    const life = b.short ? 1.4 : 3.2;
    if (age > life) { S.banner = null; return; }
    const a = Math.min(1, age * 3, (life - age) * 2);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${b.short ? 22 : 44}px "Space Grotesk", system-ui, sans-serif`;
    ctx.fillText(b.text, W / 2, 140);
    ctx.font = '15px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(b.sub || '', W / 2, 170);
    ctx.globalAlpha = 1;
  }

  function drawWaiting() {
    ctx.fillStyle = 'rgba(5,4,15,0.65)';
    ctx.fillRect(0, H / 2 - 70, W, 140);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 26px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText('Esperando a que empiece la música…', W / 2, H / 2 - 10);
    ctx.font = '15px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('Si no arranca sola, pulsa ▶ en el reproductor de la esquina inferior derecha.', W / 2, H / 2 + 22);
  }

  let last = performance.now();
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    S.shake = Math.max(0, S.shake - dt);
    S.flash = Math.max(0, S.flash - dt);
    document.body.classList.toggle('waiting', S.screen === 'play' && S.waiting);
    if (S.screen === 'play' || S.screen === 'pause') { update(); draw(); }
    else if (S.screen === 'studio') drawPreview(nowMs / 1000);
    requestAnimationFrame(frame);
  }

  // ---------- estudio (interfaz) ----------
  function showScreen(name) {
    for (const id of ['studio', 'pause', 'results']) $(id).classList.toggle('hidden', id !== name);
    if (name === 'play') buildTouchPad();
    document.body.classList.toggle('in-game', name === 'play' || name === 'pause');
    $('touch-pad').classList.toggle('hidden', name !== 'play');
  }

  function previewSeed() {
    if (st.source === 'synth') return st.seed;
    if (st.source === 'file' && S.file) return U.hash('file:' + S.file.name + ':' + S.file.size);
    const first = st.source === 'gira' ? st.gira.split(/\s+/).map(U.parseLink).filter(Boolean)[0] : U.parseLink(st.link);
    return first ? U.hash(first.key) : st.seed;
  }

  let previewWorld = null;
  function drawPreview(t) {
    const c = $('preview');
    const x = c.getContext('2d');
    const seed = previewSeed();
    if (!previewWorld || previewWorld.seed !== seed) {
      previewWorld = Chart.makeWorld(seed);
      $('world-name').textContent = previewWorld.name;
      $('world-route').textContent = 'Recorrido: ' + previewWorld.order.map((b) => previewWorld.biomeName(b)).join(' → ');
    }
    const idx = Math.floor(t / 4) % previewWorld.order.length;
    x.save();
    x.fillStyle = '#05040f';
    x.fillRect(0, 0, c.width, c.height);
    x.scale(c.width / W, c.height / H);
    const lv = Sources.beatLevels(t, 120);
    R.drawWorld(x, W, H, { world: previewWorld, biome: previewWorld.order[idx], t, beatPh: (t * 2) % 1, lv, fever: false, horizon: 480, alpha: 1, energy: 0.7, bpm: 120 });
    x.beginPath(); x.moveTo(0, 480); x.lineTo(W, 480);
    R.glowStroke(x, hsl(previewWorld.hue2, 30, 92), 4, 1);
    R.drawCharacter(x, 300, 480, { form: 3, color: hsl(previewWorld.hue + 180, 90, 72), t, beatPh: (t * 2) % 1 });
    x.restore();
  }

  function renderStudio() {
    document.querySelectorAll('[data-src]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.src === st.source)));
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)));
    document.querySelectorAll('[data-diff]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.diff === st.diff)));
    for (const id of ['opt-synth', 'opt-file', 'opt-link', 'opt-gira']) $(id).classList.add('hidden');
    const opt = { synth: 'opt-synth', file: 'opt-file', spotify: 'opt-link', youtube: 'opt-link', gira: 'opt-gira' }[st.source];
    $(opt).classList.remove('hidden');
    $('seed-input').value = st.seed;
    $('link-url').value = st.link;
    $('link-url').placeholder = st.source === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://open.spotify.com/track/… o /playlist/…';
    $('gira-list').value = st.gira;
    const link = U.parseLink(st.link);
    $('bpm-input').value = link && st.tapKey === link.key && st.bpm ? st.bpm : '';
    $('relax').checked = st.relax;
    $('latency').value = st.latency;
    $('latency-val').textContent = `${st.latency} ms`;
    $('volume').value = st.volume;
    $('file-name').textContent = S.file ? S.file.name : 'Ningún archivo elegido.';
    const needsEmbed = st.source === 'spotify' || st.source === 'youtube' || st.source === 'gira';
    $('embed-note').classList.toggle('hidden', !needsEmbed);
    $('embed-note').textContent = U.embedsBlocked
      ? 'Dentro de Claude no se pueden cargar Spotify ni YouTube. Descarga el repositorio y abre aplicaciones/onda/index.html con un servidor local para usarlos. Aquí puedes jugar con «Generador» o «Mi archivo».'
      : 'Spotify y YouTube no dejan analizar su audio: el mundo y el mapa se crean a partir de la canción (su enlace y duración) y del tempo que marques. Toca el ritmo para que encaje. Spotify suena completo solo si has iniciado sesión en ese navegador.';
    $('mode-help').textContent = {
      cinta: 'Recorre la cinta: cada figura se supera con su tecla justo cuando llega a tu personaje.',
      fusion: 'La cinta arriba y una autopista de 4 carriles abajo: ves las notas antes y tocas las mismas teclas.',
      duelo: 'Dos jugadores en el mismo teclado o pantalla, el mismo mapa. Gana quien tenga más puntos.',
      duo: 'Dos jugadores se reparten la canción: J1 toca graves y golpes, J2 melodía y agudos.',
    }[st.mode];
    $('code-out').value = currentCode();
  }

  // ---------- jam en línea: estudio ----------
  let jamRenderQueued = false;
  function renderJam() {
    if (jamRenderQueued) return;
    jamRenderQueued = true;
    requestAnimationFrame(() => {
      jamRenderQueued = false;
      $('jam-out').classList.toggle('hidden', Jam.active);
      $('jam-in').classList.toggle('hidden', !Jam.active);
      if (S.screen === 'results') renderRoomBoard();
      if (!Jam.active) return;
      $('jam-code').textContent = Jam.code;
      $('btn-jam-start').classList.toggle('hidden', !Jam.host);
      const hostHere = Jam.host || !!Jam.hostPeer();
      $('jam-wait').textContent = Jam.lost() ? 'Se perdió la conexión con quien creó la sala.'
        : Jam.host ? 'Elige la música y el modo arriba y pulsa «Empezar». Todos empezarán a la vez con el mismo mundo.'
        : hostHere ? 'Esperando a que quien creó la sala empiece la ronda…' : 'Conectado. Esperando a quien creó la sala…';
      const ul = $('jam-list');
      ul.textContent = '';
      for (const p of Jam.peers()) {
        const li = document.createElement('li');
        const dot = document.createElement('i');
        dot.style.background = hsl(Number(p.state.hue) || 0, 90, 65);
        const name = document.createElement('span');
        name.textContent = String(p.state.nick || 'Jugador') + (p.me ? ' (tú)' : '') + (p.state.host ? ' · anfitrión' : '');
        const info = document.createElement('small');
        const ph = p.state.phase;
        info.textContent = ph === 'play' ? `jugando ${Number(p.state.prog) || 0}%` : ph === 'done' ? `terminó · ${(Number(p.state.score) || 0).toLocaleString('es')}` : 'en el estudio';
        li.append(dot, name, info);
        ul.appendChild(li);
      }
    });
  }

  function jamError(e) {
    $('jam-status').textContent = e && e.message ? e.message : 'No se pudo conectar.';
    $('jam-status').className = 'status error';
  }

  function setupJam() {
    $('jam-nick').value = store.get('nick', '');
    $('jam-nick').addEventListener('change', (e) => store.set('nick', e.target.value.trim()));
    const nick = () => $('jam-nick').value.trim() || 'Jugador';
    $('btn-jam-create').addEventListener('click', async () => {
      $('jam-status').textContent = 'Creando la sala…'; $('jam-status').className = 'status';
      try { await Jam.create(nick()); $('jam-status').textContent = 'Sala creada. Pasa el código a tus amigos.'; $('jam-status').className = 'status ok'; }
      catch (e) { jamError(e); }
      renderJam();
    });
    $('btn-jam-join').addEventListener('click', async () => {
      $('jam-status').textContent = 'Entrando…'; $('jam-status').className = 'status';
      try { await Jam.join($('jam-code-in').value, nick()); $('jam-status').textContent = 'Dentro de la sala ' + Jam.code + '.'; $('jam-status').className = 'status ok'; }
      catch (e) { jamError(e); }
      renderJam();
    });
    $('btn-jam-leave').addEventListener('click', async () => { await Jam.leave(); $('jam-status').textContent = ''; renderJam(); });
    $('btn-jam-copy').addEventListener('click', () => {
      try { navigator.clipboard.writeText(Jam.code).then(() => { $('jam-status').textContent = 'Código copiado.'; $('jam-status').className = 'status ok'; }, () => {}); } catch (e) { /* visible igualmente */ }
    });
    $('btn-jam-start').addEventListener('click', () => {
      if (st.source === 'file' || st.source === 'gira') {
        jamError(new Error('Para jugar en sala usa «Generador», Spotify o YouTube: así todos tienen la misma música.'));
        return;
      }
      if (MODES[st.mode].players === 2) { st.mode = 'cinta'; saveSettings(); renderStudio(); }
      Jam.startRound(currentCode());
      startGame(false);
    });
    Jam.onUpdate = renderJam;
    Jam.onStart = (cfg) => {
      if (S.source) S.source.stop();
      loadCode(cfg);
      if (MODES[st.mode].players === 2) st.mode = 'cinta';
      S.ended = true;
      startGame(false);
    };
    Jam.onFx = (p) => {
      if (S.screen !== 'play') return;
      S.interfereUntil = performance.now() + 3000;
      S.shake = Math.max(S.shake, 0.3);
      S.banner = { text: '¡Interferencia!', sub: `${String(p.state.nick || 'Alguien').slice(0, 24)} activó su Resonancia`, t0: performance.now(), short: true };
    };
    Jam.canUseClaudeRoom().then((inClaude) => {
      $('jam-hint').textContent = inClaude
        ? 'Jugad a la vez, cada uno en su dispositivo, dentro de Claude. Comparte esta página con tus amigos (menú Compartir) y pásales el código de la sala.'
        : 'Jugad a la vez, cada uno en su navegador, con conexión directa. Pasa el código de la sala a tus amigos.';
    });
    renderJam();
  }

  function setupStudio() {
    setupJam();
    document.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
      st.source = b.dataset.src; saveSettings(); renderStudio();
      const link = U.parseLink(st.link);
      if ((st.source === 'spotify' || st.source === 'youtube') && link && !U.embedsBlocked) Embed.load(link);
    }));
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; saveSettings(); renderStudio(); }));
    document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { st.diff = b.dataset.diff; saveSettings(); renderStudio(); }));
    $('btn-dice').addEventListener('click', () => { st.seed = (Math.random() * 1e9) >>> 0; saveSettings(); renderStudio(); });
    $('seed-input').addEventListener('change', (e) => { st.seed = (Number(e.target.value) || 1) >>> 0; saveSettings(); renderStudio(); });
    $('audio-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) { S.file = f; st.source = 'file'; saveSettings(); renderStudio(); }
    });
    $('link-url').addEventListener('change', (e) => {
      st.link = e.target.value.trim();
      const link = U.parseLink(st.link);
      if (link) {
        st.source = link.kind;
        if (!U.embedsBlocked) Embed.load(link);
        $('studio-status').textContent = '';
      } else if (st.link) {
        $('studio-status').textContent = 'Ese enlace no es de Spotify ni de YouTube.';
        $('studio-status').className = 'status error';
      }
      saveSettings(); renderStudio();
    });
    $('gira-list').addEventListener('change', (e) => { st.gira = e.target.value; saveSettings(); renderStudio(); });
    $('bpm-input').addEventListener('change', (e) => {
      const v = Number(e.target.value);
      const link = U.parseLink(st.link);
      if (v >= 50 && v <= 220 && link) { st.bpm = Math.round(v); st.tapKey = link.key; st.phase = st.phase || 0; }
      else { st.bpm = null; }
      saveSettings();
    });
    $('btn-tap').addEventListener('click', tap);
    $('relax').addEventListener('change', (e) => { st.relax = e.target.checked; saveSettings(); });
    $('latency').addEventListener('input', (e) => { st.latency = Number(e.target.value); $('latency-val').textContent = `${st.latency} ms`; saveSettings(); });
    $('volume').addEventListener('input', (e) => { st.volume = Number(e.target.value); Hub.setVolume(st.volume); saveSettings(); });
    $('btn-start').addEventListener('click', () => startGame(false));
    $('btn-code-load').addEventListener('click', () => { const msg = loadCode($('code-in').value); $('studio-status').textContent = msg; $('studio-status').className = 'status'; });
    $('btn-code-copy').addEventListener('click', () => copy($('code-out')));
    $('btn-copy-res').addEventListener('click', () => copy($('res-code')));
    $('btn-resume').addEventListener('click', resume);
    $('btn-quit').addEventListener('click', quitToStudio);
    $('btn-retry').addEventListener('click', () => startGame(true));
    $('btn-studio').addEventListener('click', quitToStudio);
    $('btn-next-song').addEventListener('click', () => { S.queueIdx++; startGame(true); });
    $('btn-pause').addEventListener('click', pause);

    // leyenda de figuras
    const legend = $('legend');
    LANES.forEach((l, i) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const c = document.createElement('canvas');
      c.width = 72; c.height = 44;
      R.laneIcon(c.getContext('2d'), i, 36, 16, 48, l.color, 0.8);
      item.appendChild(c);
      const txt = document.createElement('div');
      txt.innerHTML = `<b>${l.name}</b> <kbd>${l.key}</kbd> <kbd>${l.alt}</kbd><span>${l.band}</span>`;
      item.appendChild(txt);
      legend.appendChild(item);
    });
  }

  function copy(input) {
    input.select();
    const ok = () => { $('studio-status').textContent = 'Código copiado.'; $('studio-status').className = 'status ok'; };
    try { navigator.clipboard.writeText(input.value).then(ok, () => {}); } catch (e) { /* queda seleccionado */ }
  }

  if (U.embedsBlocked) $('back-link').classList.add('hidden');

  // ---------- móvil: pantalla completa, instalación y modo sin conexión ----------
  const markTouch = () => document.body.classList.add('touch');
  if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) markTouch();
  window.addEventListener('touchstart', markTouch, { once: true, passive: true });
  $('btn-full').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch (e) { /* el navegador no lo permite (p. ej. iPhone): basta con girar el móvil */ }
  });
  if (!document.documentElement.requestFullscreen) $('btn-full').classList.add('hidden');
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('btn-install').classList.remove('hidden'); });
  $('btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('btn-install').classList.add('hidden');
  });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !U.embedsBlocked) {
    navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => {});
  }
  Embed.init($('embed-box'));
  setupStudio();
  renderStudio();
  showScreen('studio');
  if (/[?&]debug\b/.test(location.search)) window.__onda = { S, st, startGame, press, finish };
  requestAnimationFrame(frame);
})();
