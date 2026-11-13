/* Pulso Cúbico — bucle de juego, dibujo, entrada y menús. */
(function () {
  'use strict';

  const { PHYS, T, parseLevel, Sim } = window.Engine;
  const W = 1280, H = 720, TILE = 40, GROUND_Y = 600, PLAYER_SCREEN_X = 9.5;
  const STEP = 1 / PHYS.FPS;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  const music = new window.Music();
  const levels = window.LEVELS.map(parseLevel);

  // ---------- guardado ----------
  const SAVE_KEY = 'pulsoCubico.v1';
  const save = (() => {
    const def = { best: {}, practice: {}, attempts: {}, done: {}, c1: '#7dff5a', c2: '#2ae0ff', muted: false };
    try { return Object.assign(def, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { return def; }
  })();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* sin almacenamiento */ } }
  music.setMuted(save.muted);

  // ---------- estado del juego ----------
  const G = {
    screen: 'menu',      // menu | playing | paused | dying | complete
    levelIndex: 0,
    level: null,
    sim: null,
    practice: false,
    checkpoints: [],
    attempts: 0,
    jumps: 0,
    runFrames: 0,
    deathTimer: 0,
    rot: 0,
    particles: [],
    trail: [],
    shake: 0,
    flash: 0,
    lastAutoCp: 0,
    menuScroll: 0,
  };

  // ---------- entrada ----------
  const input = { held: false, tapped: false };
  function press() { if (!input.held) input.tapped = true; input.held = true; music.ensure(); }
  function release() { input.held = false; }
  const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);

  window.addEventListener('keydown', (e) => {
    if (JUMP_KEYS.has(e.code)) {
      if (G.screen === 'playing' || G.screen === 'dying') { e.preventDefault(); if (!e.repeat) press(); }
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (G.screen === 'playing' || G.screen === 'dying') pause();
      else if (G.screen === 'paused') resume();
    } else if (e.code === 'KeyR' && (G.screen === 'playing' || G.screen === 'paused' || G.screen === 'dying')) {
      restart(true);
    } else if (e.code === 'KeyZ' && G.practice && G.screen === 'playing') {
      addCheckpoint();
    } else if (e.code === 'KeyX' && G.practice && G.screen === 'playing') {
      G.checkpoints.pop();
    } else if (e.code === 'KeyM') {
      toggleMute();
    } else if (e.code === 'Enter' && G.screen === 'complete') {
      restart(true);
    }
  });
  window.addEventListener('keyup', (e) => { if (JUMP_KEYS.has(e.code)) release(); });

  canvas.addEventListener('pointerdown', (e) => {
    if (G.screen === 'playing' || G.screen === 'dying') { e.preventDefault(); press(); }
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', () => { release(); if (G.screen === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.screen === 'playing') pause(); });

  // ---------- flujo ----------
  function startLevel(index, practice) {
    G.levelIndex = index;
    G.level = levels[index];
    G.practice = practice;
    G.checkpoints = [];
    G.attempts = 0;
    G.jumps = 0;
    G.runFrames = 0;
    restart(false);
    showScreen(null);
  }

  function spawn(snapshot) {
    G.sim = new Sim(G.level);
    G.sim.reset(snapshot);
    G.rot = 0;
    G.trail = [];
    G.lastAutoCp = G.sim.s.frame;
    G.screen = 'playing';
    input.tapped = false;
    G.attempts++;
    save.attempts[G.level.id] = (save.attempts[G.level.id] || 0) + 1;
    persist();
    music.play(G.level.music, G.sim.s.frame / PHYS.FPS);
  }

  function restart(clearCheckpoints) {
    if (clearCheckpoints) G.checkpoints = [];
    const cp = G.practice && G.checkpoints.length ? G.checkpoints[G.checkpoints.length - 1] : null;
    if (!cp) G.runFrames = 0;
    G.particles = [];
    spawn(cp);
    showScreen(null);
  }

  function addCheckpoint() {
    const s = G.sim.s;
    if (s.dead || s.won) return;
    G.checkpoints.push(G.sim.snapshot());
    G.lastAutoCp = s.frame;
  }

  function pause() {
    if (G.screen !== 'playing' && G.screen !== 'dying') return;
    G.prevScreen = G.screen;
    G.screen = 'paused';
    music.stop();
    release();
    showScreen('pause');
  }

  function resume() {
    showScreen(null);
    G.screen = G.prevScreen || 'playing';
    if (G.screen === 'playing') music.play(G.level.music, G.sim.s.frame / PHYS.FPS);
  }

  function toMenu() {
    music.stop();
    G.screen = 'menu';
    G.level = null;
    renderMenu();
    showScreen('menu');
  }

  function progressPct() {
    if (!G.sim) return 0;
    return Math.max(0, Math.min(100, Math.floor((G.sim.s.x / G.level.finishX) * 100)));
  }

  function onDeath() {
    const pct = progressPct();
    const store = G.practice ? save.practice : save.best;
    if (pct > (store[G.level.id] || 0)) store[G.level.id] = pct;
    persist();
    music.stop();
    music.sfxDeath();
    G.screen = 'dying';
    G.deathTimer = 0.9;
    G.shake = 0.35;
    const s = G.sim.s;
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 9;
      G.particles.push({ x: s.x + 0.5, y: s.y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.6 + Math.random() * 0.5, max: 1.1, size: 0.12 + Math.random() * 0.2, color: Math.random() < 0.5 ? save.c1 : save.c2 });
    }
  }

  function onWin() {
    const id = G.level.id;
    const store = G.practice ? save.practice : save.best;
    store[id] = 100;
    if (!G.practice) save.done[id] = true;
    persist();
    music.stop();
    music.sfxWin();
    G.screen = 'complete';
    G.flash = 1;
    const secs = (G.sim.s.frame / PHYS.FPS).toFixed(1);
    document.getElementById('complete-title').textContent = G.practice ? '¡Práctica completada!' : '¡Nivel completado!';
    document.getElementById('complete-stats').innerHTML =
      `<div><span>Intentos</span><b>${G.attempts}</b></div>` +
      `<div><span>Saltos</span><b>${G.jumps}</b></div>` +
      `<div><span>Tiempo</span><b>${secs}s</b></div>`;
    document.getElementById('btn-next').style.display = G.levelIndex < levels.length - 1 ? '' : 'none';
    setTimeout(() => { if (G.screen === 'complete') showScreen('complete'); }, 900);
  }

  // ---------- simulación ----------
  function fixedUpdate() {
    const sim = G.sim;
    if (G.screen === 'playing') {
      const pressed = input.held || input.tapped;
      input.tapped = false;
      sim.step(pressed);
      G.runFrames++;
      for (const ev of sim.events) handleEvent(ev);
      sim.events.length = 0;
      const s = sim.s;
      if (s.dead) { onDeath(); return; }
      if (s.won) { onWin(); return; }
      if (G.practice && s.mode === 'cube' && s.onGround && s.frame - G.lastAutoCp > PHYS.FPS * 2.2) addCheckpoint();
      // estela
      if (G.runFrames % 2 === 0) {
        G.trail.push({ x: s.x + 0.1, y: s.y + 0.5 + (Math.random() - 0.5) * 0.3, life: 0.35 });
      }
      // rotación del icono
      if (s.mode === 'cube') {
        if (s.onGround) {
          const target = Math.round(G.rot / (Math.PI / 2)) * (Math.PI / 2);
          G.rot += (target - G.rot) * 0.45;
        } else {
          G.rot += 7.6 * STEP * s.grav;
        }
      } else {
        const target = -Math.atan2(s.vy, G.level.speed * 1.4);
        G.rot += (target - G.rot) * 0.3;
      }
    } else if (G.screen === 'dying') {
      G.deathTimer -= STEP;
      input.tapped = false;
      if (G.deathTimer <= 0) restart(false);
    }
  }

  function handleEvent(ev) {
    const burst = (n, color, spread) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        G.particles.push({ x: ev.x + 0.5, y: ev.y + 0.5, vx: Math.cos(a) * spread, vy: Math.sin(a) * spread,
          life: 0.4, max: 0.4, size: 0.1, color });
      }
    };
    if (ev.type === 'jump') G.jumps++;
    if (ev.type === 'orb') { G.jumps++; burst(10, ev.obj.type === T.ORB ? '#ffe45c' : '#5cc8ff', 5); }
    if (ev.type === 'pad') burst(10, '#ffe45c', 4);
    if (ev.type === 'portal') { G.flash = 0.35; burst(16, portalColor(ev.obj.type), 6); }
  }

  function updateParticles(dt) {
    for (const p of G.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 12 * dt; p.life -= dt; }
    G.particles = G.particles.filter((p) => p.life > 0);
    for (const t of G.trail) t.life -= dt;
    G.trail = G.trail.filter((t) => t.life > 0);
    G.shake = Math.max(0, G.shake - dt);
    G.flash = Math.max(0, G.flash - dt * 1.5);
  }

  // ---------- dibujo ----------
  function portalColor(type) {
    return { [T.P_SHIP]: '#ff4fd8', [T.P_CUBE]: '#5dff7a', [T.P_FLIP]: '#4fb3ff', [T.P_NORMAL]: '#ffa53d' }[type];
  }

  function beatPulse() {
    if (!G.sim) return 0;
    const beats = (G.sim.s.frame / PHYS.FPS) * G.level.music.bpm / 60;
    return Math.exp(-(beats % 1) * 5);
  }

  let camX = 0;
  function sx(x) { return (x - camX) * TILE; }
  function sy(y) { return GROUND_Y - y * TILE; }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function drawBackground(col, pulse) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, col.bgTop);
    g.addColorStop(1, col.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // capas de figuras con paralaje
    for (let layer = 0; layer < 2; layer++) {
      const par = layer === 0 ? 0.15 : 0.35;
      const size = layer === 0 ? 180 : 110;
      const spacing = layer === 0 ? 260 : 190;
      const off = (camX * TILE * par) % spacing;
      const first = Math.floor((camX * TILE * par) / spacing);
      ctx.save();
      for (let i = -1; i < W / spacing + 2; i++) {
        const idx = first + i;
        const h = Math.sin(idx * 12.9898 + layer * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        const x = i * spacing - off + r * 60;
        const y = 80 + r * 300 + layer * 90;
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4 + r);
        ctx.strokeStyle = hexA(col.line, (layer === 0 ? 0.08 : 0.12) + pulse * 0.06);
        ctx.lineWidth = 3;
        ctx.strokeRect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = hexA(col.bgTop, 0.25);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.restore();
    }
  }

  function drawGround(col, pulse) {
    ctx.fillStyle = col.ground;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = hexA(col.line, 0.18);
    ctx.lineWidth = 2;
    const step = TILE * 3;
    const off = (camX * TILE) % step;
    for (let x = -off; x < W; x += step) {
      ctx.strokeRect(x + 4, GROUND_Y + 4, step - 8, step - 8);
    }
    ctx.save();
    ctx.shadowColor = col.line;
    ctx.shadowBlur = 12 + pulse * 10;
    ctx.fillStyle = col.line;
    ctx.fillRect(0, GROUND_Y - 1, W, 3);
    ctx.restore();
  }

  function drawCeiling(col) {
    const s = G.sim.s;
    if (!(s.mode === 'ship' || s.grav === -1)) return;
    const y = sy(PHYS.CEIL);
    ctx.fillStyle = col.ground;
    ctx.fillRect(0, 0, W, y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, y);
    ctx.save();
    ctx.shadowColor = col.line;
    ctx.shadowBlur = 12;
    ctx.fillStyle = col.line;
    ctx.fillRect(0, y - 2, W, 3);
    ctx.restore();
  }

  function drawBlock(o, col) {
    const x = sx(o.x), y = sy(o.y + o.h), w = o.w * TILE, h = o.h * TILE;
    ctx.fillStyle = 'rgba(5,6,20,0.82)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (o.h === 1) {
      ctx.strokeStyle = hexA(col.line, 0.3);
      ctx.strokeRect(x + 9, y + 9, w - 18, h - 18);
    }
  }

  function drawSpike(o, col, down) {
    const x = sx(o.x), base = down ? sy(o.y + 1) : sy(o.y), tip = down ? sy(o.y) : sy(o.y + 1);
    ctx.beginPath();
    ctx.moveTo(x + 2, base);
    ctx.lineTo(x + TILE / 2, tip + (down ? -4 : 4));
    ctx.lineTo(x + TILE - 2, base);
    ctx.closePath();
    ctx.fillStyle = '#07070f';
    ctx.fill();
    ctx.strokeStyle = '#f2f4ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 12, base + (down ? 4 : -4));
    ctx.lineTo(x + TILE / 2, tip + (down ? -16 : 16));
    ctx.lineTo(x + TILE - 12, base + (down ? 4 : -4));
    ctx.strokeStyle = hexA(col.accent, 0.5);
    ctx.stroke();
  }

  function drawPad(o, used) {
    const x = sx(o.x), y = sy(o.y);
    ctx.save();
    ctx.shadowColor = '#ffe45c';
    ctx.shadowBlur = used ? 0 : 14;
    ctx.fillStyle = used ? '#a8923a' : '#ffe45c';
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y, TILE * 0.42, TILE * 0.22, 0, Math.PI, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawOrb(o, used, t) {
    const cx = sx(o.x + 0.5), cy = sy(o.y + 0.5);
    const color = o.type === T.ORB ? '#ffe45c' : '#5cc8ff';
    ctx.save();
    ctx.globalAlpha = used ? 0.35 : 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const r = TILE * (0.45 + 0.08 * Math.sin(t * 6));
    ctx.beginPath();
    ctx.arc(cx, cy, r, t * 3, t * 3 + Math.PI * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawPortal(o, t) {
    const color = portalColor(o.type);
    const cx = sx(o.x + 0.5), cy = sy(o.y + 1.5);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, TILE * 0.45, TILE * 1.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, TILE * 0.25, TILE * (1.1 + 0.1 * Math.sin(t * 5)), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // pequeño símbolo
    ctx.fillStyle = color;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = { [T.P_SHIP]: '▶', [T.P_CUBE]: '■', [T.P_FLIP]: '⇅', [T.P_NORMAL]: '⇵' }[o.type];
    ctx.fillText(label, cx, cy - TILE * 1.75);
  }

  function drawFinish(col) {
    const x = sx(G.level.finishX + 1);
    if (x > W + 50) return;
    const g = ctx.createLinearGradient(x, 0, x + 120, 0);
    g.addColorStop(0, hexA('#ffffff', 0.9));
    g.addColorStop(1, hexA(col.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 120, GROUND_Y);
  }

  function drawIcon(c, x, y, size, rot, mode, c1, c2) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    if (mode === 'ship') {
      // nave
      c.fillStyle = c1;
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-size * 0.75, size * 0.25);
      c.lineTo(size * 0.7, size * 0.2);
      c.lineTo(size * 0.2, -size * 0.1);
      c.lineTo(-size * 0.55, -size * 0.1);
      c.closePath();
      c.fill(); c.stroke();
      c.fillStyle = c2;
      c.fillRect(-size * 0.3, -size * 0.55, size * 0.45, size * 0.45);
      c.strokeRect(-size * 0.3, -size * 0.55, size * 0.45, size * 0.45);
    } else {
      const h = size / 2;
      c.fillStyle = c1;
      c.fillRect(-h, -h, size, size);
      c.strokeStyle = '#000';
      c.lineWidth = 2.5;
      c.strokeRect(-h, -h, size, size);
      c.fillStyle = c2;
      c.fillRect(-h * 0.55, -h * 0.55, size * 0.55, size * 0.55);
      c.strokeRect(-h * 0.55, -h * 0.55, size * 0.55, size * 0.55);
      // "ojos" del icono
      c.fillStyle = '#000';
      c.fillRect(-h * 0.35, -h * 0.3, h * 0.18, h * 0.3);
      c.fillRect(h * 0.05, -h * 0.3, h * 0.18, h * 0.3);
    }
    c.restore();
  }

  function drawPlayer() {
    const s = G.sim.s;
    for (const t of G.trail) {
      ctx.fillStyle = hexA(save.c2, Math.max(0, t.life / 0.35) * 0.5);
      const sz = 10 * (t.life / 0.35);
      ctx.fillRect(sx(t.x) - sz / 2, sy(t.y) - sz / 2, sz, sz);
    }
    if (G.screen === 'dying' || s.dead) return;
    ctx.save();
    ctx.shadowColor = save.c1;
    ctx.shadowBlur = 16;
    drawIcon(ctx, sx(s.x + 0.5), sy(s.y + 0.5), TILE, G.rot, s.mode, save.c1, save.c2);
    ctx.restore();
  }

  function drawWorld(t) {
    const col = G.level.colors;
    const s = G.sim.s;
    camX = s.x - PLAYER_SCREEN_X;
    const pulse = beatPulse();

    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 14 * G.shake, (Math.random() - 0.5) * 14 * G.shake);
    drawBackground(col, pulse);
    drawCeiling(col);

    const used = new Set(s.used);
    const seen = new Set();
    const c0 = Math.floor(camX) - 2, c1 = c0 + Math.ceil(W / TILE) + 4;
    const portals = [];
    for (let c = c0; c <= c1; c++) {
      const list = G.level.buckets[c];
      if (!list) continue;
      for (const o of list) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        switch (o.type) {
          case T.BLOCK: case T.SLAB: drawBlock(o, col); break;
          case T.SPIKE: drawSpike(o, col, false); break;
          case T.SPIKE_DOWN: drawSpike(o, col, true); break;
          case T.PAD: drawPad(o, used.has(o.id)); break;
          case T.ORB: case T.ORB_BLUE: drawOrb(o, used.has(o.id), t); break;
          default: portals.push(o);
        }
      }
    }
    drawFinish(col);
    // marcadores de punto de control
    if (G.practice) {
      for (const cp of G.checkpoints) {
        const x = sx(cp.x + 0.5), y = sy(cp.y + 0.5);
        if (x < -20 || x > W + 20) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#5dff7a';
        ctx.globalAlpha = 0.85;
        ctx.fillRect(-8, -8, 16, 16);
        ctx.restore();
      }
    }
    drawPlayer();
    for (const o of portals) drawPortal(o, t);
    for (const p of G.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      const sz = p.size * TILE;
      ctx.fillRect(sx(p.x) - sz / 2, sy(p.y) - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    drawGround(col, pulse);
    ctx.restore();

    if (G.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawHud(col);
  }

  function drawHud(col) {
    const pct = progressPct();
    const bw = 420, bh = 14, bx = (W - bw) / 2, by = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(bx - 3, by - 3, bw + 6, bh + 6, 10); ctx.fill();
    ctx.fillStyle = col.accent;
    roundRect(bx, by, Math.max(bh, (bw * pct) / 100), bh, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${pct}%`, bx + bw + 14, by + 13);

    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(`Intento ${G.attempts}`, 24, 34);
    if (G.practice) {
      ctx.fillStyle = '#5dff7a';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText('MODO PRÁCTICA · Z: punto de control · X: borrar', 24, 60);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // fondo animado del menú
  let menuX = 0;
  function drawMenuBackground(dt) {
    menuX += dt * 4;
    camX = menuX;
    const col = levels[G.levelIndex].colors;
    drawBackground(col, 0.3 + 0.3 * Math.sin(menuX));
    drawGround(col, 0.3);
  }

  // ---------- bucle principal ----------
  let last = performance.now(), acc = 0, clock = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    if (G.screen === 'menu') {
      drawMenuBackground(dt);
    } else {
      if (G.screen === 'playing' || G.screen === 'dying') {
        acc += dt;
        while (acc >= STEP) { fixedUpdate(); acc -= STEP; }
      } else {
        acc = 0;
      }
      if (G.screen !== 'paused') updateParticles(dt);
      if (G.level && G.sim) drawWorld(clock);
    }
    requestAnimationFrame(frame);
  }

  // ---------- interfaz (DOM) ----------
  const screens = ['menu', 'pause', 'complete'];
  function showScreen(name) {
    for (const s of screens) document.getElementById(s).classList.toggle('hidden', s !== name);
    const inGame = name === null;
    document.getElementById('touch-ui').classList.toggle('hidden', !inGame);
    document.getElementById('cp-buttons').classList.toggle('hidden', !(inGame && G.practice));
  }


  function renderMenu() {
    const list = document.getElementById('level-list');
    list.innerHTML = '';
    levels.forEach((lv, i) => {
      const best = save.best[lv.id] || 0;
      const prac = save.practice[lv.id] || 0;
      const card = document.createElement('div');
      card.className = 'level-card' + (save.done[lv.id] ? ' done' : '');
      card.style.setProperty('--c1', lv.colors.bgTop);
      card.style.setProperty('--c2', lv.colors.accent);
      card.innerHTML = `
        <div class="lv-head">
          <div>
            <div class="lv-name">${lv.name}</div>
            <div class="lv-diff">${lv.difficulty} · ${'★'.repeat(lv.stars)}</div>
          </div>
          ${save.done[lv.id] ? '<div class="lv-check" title="Completado">✔</div>' : ''}
        </div>
        <div class="lv-bar"><div style="width:${best}%"></div><span>Normal ${best}%</span></div>
        <div class="lv-bar practice"><div style="width:${prac}%"></div><span>Práctica ${prac}%</span></div>
        <div class="lv-meta">Intentos totales: ${save.attempts[lv.id] || 0}</div>
        <div class="lv-buttons">
          <button class="btn primary" data-play="${i}">▶ Jugar</button>
          <button class="btn" data-practice="${i}">◆ Práctica</button>
        </div>`;
      card.addEventListener('mouseenter', () => { G.levelIndex = i; });
      list.appendChild(card);
    });
    list.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => { music.ensure(); startLevel(+b.dataset.play, false); }));
    list.querySelectorAll('[data-practice]').forEach((b) => b.addEventListener('click', () => { music.ensure(); startLevel(+b.dataset.practice, true); }));
    renderColors();
    document.getElementById('btn-sound').textContent = save.muted ? '🔇 Sonido: no' : '🔊 Sonido: sí';
  }

  const PALETTE = ['#7dff5a', '#2ae0ff', '#ff4fd8', '#ffe45c', '#ff6a3d', '#a66bff', '#ffffff', '#3d6bff', '#ff3d6b', '#1d1d2b'];
  function renderColors() {
    for (const which of ['c1', 'c2']) {
      const row = document.getElementById('colors-' + which);
      row.innerHTML = '';
      for (const c of PALETTE) {
        const sw = document.createElement('button');
        sw.className = 'swatch' + (save[which] === c ? ' selected' : '');
        sw.style.background = c;
        sw.setAttribute('aria-label', 'Color ' + c);
        sw.addEventListener('click', () => { save[which] = c; persist(); renderColors(); });
        row.appendChild(sw);
      }
    }
    const pc = document.getElementById('icon-preview');
    const p = pc.getContext('2d');
    p.clearRect(0, 0, pc.width, pc.height);
    drawIcon(p, 40, 40, 48, 0, 'cube', save.c1, save.c2);
    drawIcon(p, 120, 44, 48, 0, 'ship', save.c1, save.c2);
  }

  function toggleMute() {
    save.muted = !save.muted;
    music.setMuted(save.muted);
    persist();
    document.getElementById('btn-sound').textContent = save.muted ? '🔇 Sonido: no' : '🔊 Sonido: sí';
  }

  document.getElementById('btn-sound').addEventListener('click', toggleMute);
  document.getElementById('btn-resume').addEventListener('click', resume);
  document.getElementById('btn-restart').addEventListener('click', () => restart(true));
  document.getElementById('btn-practice').addEventListener('click', () => {
    G.practice = !G.practice;
    G.checkpoints = [];
    G.attempts = 0;
    restart(true);
  });
  document.getElementById('btn-menu').addEventListener('click', toMenu);
  document.getElementById('btn-retry').addEventListener('click', () => { G.attempts = 0; G.jumps = 0; restart(true); });
  document.getElementById('btn-menu2').addEventListener('click', toMenu);
  document.getElementById('btn-next').addEventListener('click', () => startLevel(G.levelIndex + 1, false));
  document.getElementById('btn-pause').addEventListener('click', pause);
  document.getElementById('btn-cp-add').addEventListener('click', addCheckpoint);
  document.getElementById('btn-cp-del').addEventListener('click', () => G.checkpoints.pop());
  document.getElementById('btn-pause').addEventListener('pointerdown', (e) => e.stopPropagation());

  // texto del botón de práctica en pausa
  const observer = new MutationObserver(() => {
    document.getElementById('btn-practice').textContent = G.practice ? '◆ Salir de práctica' : '◆ Modo práctica';
  });
  observer.observe(document.getElementById('pause'), { attributes: true });

  if (/[?&]debug\b/.test(location.search)) window.__pulso = { G, levels, startLevel };

  renderMenu();
  showScreen('menu');
  requestAnimationFrame(frame);
})();
