/* Pulso Onda — dibujo vectorial (líneas con brillo) del mundo, la cinta, la autopista y el personaje. */
(function (root) {
  'use strict';
  const { LANES, hsl, clamp } = root.U;

  const R = {};
  const TAU = Math.PI * 2;

  // ---------- trazo con brillo ----------
  function glowStroke(ctx, color, width, glow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.globalAlpha *= 0.18 * glow;
    ctx.lineWidth = width * 3.2;
    ctx.stroke();
    ctx.globalAlpha /= 0.18 * glow || 1;
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  R.glowStroke = glowStroke;

  // ---------- figuras de los obstáculos ----------
  // Añade al camino actual la figura de un carril, de (x - w/2, y) a (x + w/2, y).
  function laneShape(ctx, lane, x, y, w, a) {
    const h = w / 2;
    switch (lane) {
      case 0: // bloque
        ctx.lineTo(x - h, y); ctx.lineTo(x - h, y - a); ctx.lineTo(x + h, y - a); ctx.lineTo(x + h, y);
        break;
      case 1: { // bucle
        const r = Math.max(2, a * 0.55);
        ctx.lineTo(x, y);
        ctx.arc(x, y - r, r, Math.PI / 2, Math.PI / 2 + TAU);
        ctx.lineTo(x + h, y);
        break;
      }
      case 2: // onda
        ctx.lineTo(x - h, y);
        for (let k = 1; k < 8; k++) ctx.lineTo(x - h + (k * w) / 8, y + (k % 2 ? -1 : 1) * a * 0.42);
        ctx.lineTo(x + h, y);
        break;
      case 3: // foso
        ctx.lineTo(x - h, y); ctx.lineTo(x - h / 3, y + a * 0.9); ctx.lineTo(x + h / 3, y + a * 0.9); ctx.lineTo(x + h, y);
        break;
    }
  }
  R.laneShape = laneShape;

  // Icono suelto de un carril (para la autopista, la leyenda y los receptores).
  R.laneIcon = function (ctx, lane, x, y, size, color, glow = 1) {
    ctx.beginPath();
    ctx.moveTo(x - size / 2, y + size * 0.25);
    laneShape(ctx, lane, x, y + size * 0.25, size * 0.8, size * 0.6);
    ctx.lineTo(x + size / 2, y + size * 0.25);
    glowStroke(ctx, color, 2.5, glow);
  };

  // ---------- mundo de fondo ----------
  R.drawWorld = function (ctx, W, H, o) {
    // o: { world, biome, t, beatPh, lv, fever, horizon, alpha, energy, bpm }
    const { world, t, lv, fever, horizon } = o;
    const hue = world.hue + (fever ? t * 90 : 0);
    const pulse = Math.exp(-o.beatPh * 5);
    ctx.save();
    ctx.globalAlpha = o.alpha;
    switch (o.biome) {
      case 'montanas': drawMountains(ctx, W, H, o, hue, pulse); break;
      case 'ciudad': drawCity(ctx, W, H, o, hue, pulse); break;
      case 'tunel': drawTunnel(ctx, W, H, o, hue, pulse); break;
      case 'oceano': drawOcean(ctx, W, H, o, hue, pulse); break;
      default: drawCosmos(ctx, W, H, o, hue, pulse);
    }
    ctx.restore();
    // suelo con rejilla en perspectiva
    if (o.floor !== false) drawFloor(ctx, W, H, horizon, t, world.hue2 + (fever ? t * 90 : 0), lv, o.alpha, o.energy);
  };

  function drawSun(ctx, x, y, r, hue, lv) {
    ctx.beginPath();
    ctx.arc(x, y, r * (1 + lv.low * 0.25), 0, TAU);
    glowStroke(ctx, hsl(hue + 30, 100, 65, 0.9), 2.5, 1.2);
    for (let i = 1; i < 6; i++) {
      const yy = y + (i * r) / 6;
      const half = Math.sqrt(Math.max(0, r * r - (yy - y) ** 2));
      ctx.beginPath(); ctx.moveTo(x - half, yy); ctx.lineTo(x + half, yy);
      glowStroke(ctx, hsl(hue + 30, 100, 65, 0.45), 1.5, 0.6);
    }
  }

  function drawMountains(ctx, W, H, o, hue, pulse) {
    const { world, t, lv, horizon } = o;
    drawSun(ctx, W * 0.72, horizon - 150, 70, hue, lv);
    for (let k = 2; k >= 0; k--) {
      const speed = [12, 28, 60][k];
      const amp = [170, 120, 80][k] * (0.85 + 0.15 * pulse + lv.low * 0.15) * (0.6 + o.energy * 0.5);
      const scale = [260, 180, 120][k];
      const off = t * speed;
      const pts = [];
      for (let x = -20; x <= W + 20; x += 20) {
        const n = world.noise((x + off) / scale + k * 40) * 0.75 + world.noise2((x + off) / (scale * 0.35) + k * 9) * 0.25;
        pts.push([x, horizon - 6 - n * amp]);
      }
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      glowStroke(ctx, hsl(hue + k * 25, 90, 62 - k * 8, 0.85 - k * 0.2), 2, 1);
      // malla de alambre
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 3) {
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[i][0] + (pts[i][0] - W / 2) * 0.08, horizon);
      }
      ctx.strokeStyle = hsl(hue + k * 25, 90, 60, 0.12 + 0.05 * (2 - k));
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawCity(ctx, W, H, o, hue, pulse) {
    const { world, t, lv, horizon } = o;
    for (let layer = 1; layer >= 0; layer--) {
      const speed = layer ? 25 : 55;
      const sc = layer ? 0.7 : 1;
      const total = world.buildings.reduce((s, b) => s + b.w * sc + 14, 0);
      let x = -((t * speed) % total);
      let i = 0;
      while (x < W + 10) {
        const b = world.buildings[i % world.buildings.length];
        const bw = b.w * sc, bh = b.h * sc * (0.75 + o.energy * 0.4) * (1 + lv.low * 0.12 * (layer ? 0 : 1));
        if (x + bw > -5) {
          ctx.beginPath();
          ctx.rect(x, horizon - bh, bw, bh);
          glowStroke(ctx, hsl(hue + layer * 40, 85, 62, layer ? 0.4 : 0.85), layer ? 1.2 : 2, layer ? 0.5 : 1);
          if (!layer) {
            ctx.fillStyle = hsl(hue + 180, 100, 75, 0.85);
            const cols = Math.max(2, Math.floor(bw / 16));
            for (let r = 0; r < b.rows; r++) {
              for (let c = 0; c < cols; c++) {
                const on = Math.sin(b.seed * 100 + r * 3.1 + c * 1.7 + Math.floor(t * (o.bpm / 60))) > 0.2 - lv.high * 0.6;
                if (on) ctx.fillRect(x + 6 + c * ((bw - 12) / cols), horizon - bh + 10 + r * 16, 4, 4);
              }
            }
          }
        }
        x += bw + 14;
        i++;
      }
    }
    // antena que late
    ctx.beginPath();
    ctx.arc(W * 0.5, horizon - 230, 8 + pulse * 18, 0, TAU);
    glowStroke(ctx, hsl(hue + 180, 100, 70, 0.6 * pulse + 0.2), 2, 1);
  }

  function drawTunnel(ctx, W, H, o, hue, pulse) {
    const { world, t, lv, horizon } = o;
    const cx = W / 2, cy = horizon - 140;
    const N = 16;
    const speed = (o.bpm / 120) * 0.22;
    for (let i = 0; i < N; i++) {
      const p = (t * speed + i / N) % 1;
      const s = p * p * 900 + 6;
      const rot = t * 0.25 + p * 1.6;
      ctx.beginPath();
      for (let k = 0; k <= world.sides; k++) {
        const a = rot + (k / world.sides) * TAU;
        const x = cx + Math.cos(a) * s * (1 + lv.mid * 0.15), y = cy + Math.sin(a) * s * 0.6;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      glowStroke(ctx, hsl(hue + p * 120, 95, 62, Math.min(1, p * 1.6) * 0.8), 1 + p * 2.5, 1);
    }
    // radios
    ctx.beginPath();
    for (let k = 0; k < world.sides * 2; k++) {
      const a = t * 0.25 + (k / (world.sides * 2)) * TAU;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 1000, cy + Math.sin(a) * 600);
    }
    ctx.strokeStyle = hsl(hue, 90, 60, 0.08 + pulse * 0.06);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawOcean(ctx, W, H, o, hue, pulse) {
    const { t, lv, horizon } = o;
    drawSun(ctx, W * 0.62, horizon - 150, 60, hue + 160, lv);
    for (let j = 0; j < 11; j++) {
      const y0 = 70 + j * ((horizon - 110) / 11);
      const amp = (8 + lv.low * 30 + j * 2) * (0.6 + o.energy * 0.6);
      const freq = 0.006 + j * 0.0012;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 14) {
        const y = y0 + Math.sin(x * freq + t * (1 + j * 0.15)) * amp + Math.sin(x * 0.02 - t * 2) * lv.high * 10;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      glowStroke(ctx, hsl(hue + j * 9, 90, 62, 0.25 + 0.5 * (j / 11)), 1.5, 0.8);
    }
  }

  function drawCosmos(ctx, W, H, o, hue, pulse) {
    const { world, t, lv, horizon } = o;
    const pts = [];
    for (const s of world.stars) {
      const x = ((s.x * W * 1.5 - t * 18 * s.s) % (W * 1.5) + W * 1.5) % (W * 1.5) - W * 0.25;
      const y = s.y * (horizon - 30);
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + s.p);
      pts.push([x, y]);
      ctx.fillStyle = hsl(hue + s.p * 20, 80, 80, 0.3 + tw * 0.6);
      const r = s.s * (1 + lv.high * 1.5);
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    ctx.beginPath();
    for (let i = 0; i < pts.length - 1; i += 2) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (Math.hypot(x2 - x1, y2 - y1) < 140) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    }
    ctx.strokeStyle = hsl(hue, 80, 70, 0.18 + pulse * 0.15);
    ctx.lineWidth = 1;
    ctx.stroke();
    // planeta de anillos
    const px = W * 0.78, py = horizon - 180;
    ctx.beginPath(); ctx.arc(px, py, 46 + lv.low * 10, 0, TAU);
    glowStroke(ctx, hsl(hue + 60, 90, 65, 0.8), 2, 1);
    ctx.beginPath(); ctx.ellipse(px, py, 90, 20, -0.3, 0, TAU);
    glowStroke(ctx, hsl(hue + 100, 90, 65, 0.6), 1.5, 0.8);
  }

  function drawFloor(ctx, W, H, horizon, t, hue, lv, alpha, energy) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const vx = W / 2;
    ctx.beginPath();
    for (let i = -12; i <= 12; i++) {
      ctx.moveTo(vx + i * 30, horizon);
      ctx.lineTo(vx + i * 260, H);
    }
    const sp = (t * 0.9) % 1;
    for (let i = 0; i < 9; i++) {
      const p = (i + sp) / 9;
      const y = horizon + (H - horizon) * p * p;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.strokeStyle = hsl(hue, 90, 60, 0.1 + lv.low * 0.12 + energy * 0.05);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // ---------- cinta (el camino) ----------
  R.drawRibbon = function (ctx, W, o) {
    // o: { y, notes, now, pps, charX, color, t, lv, fever, hints, keySet, dim }
    const { y, now, pps, charX } = o;
    const w = 64, amp = 46;
    const wob = (x) => Math.sin(x * 0.018 + o.t * 3.2) * (1.5 + o.lv.mid * 5 + (o.fever ? 4 : 0) + (o.glitch ? 16 : 0))
      + (o.glitch ? (Math.random() - 0.5) * 8 : 0);
    const vis = [];
    for (const n of o.notes) {
      const x = charX + (n.t - now) * pps;
      if (x < -w) continue;
      if (x > W + w) break;
      vis.push([x, n]);
    }
    // tramos planos
    ctx.beginPath();
    let cursor = 0;
    ctx.moveTo(0, y + wob(0));
    for (const [x] of vis) {
      for (let px = cursor + 16; px < x - w / 2; px += 16) ctx.lineTo(px, y + wob(px));
      ctx.lineTo(x - w / 2, y);
      ctx.moveTo(x + w / 2, y);
      cursor = x + w / 2;
    }
    for (let px = cursor + 16; px <= W; px += 16) ctx.lineTo(px, y + wob(px));
    glowStroke(ctx, o.color, 3, 1);

    // obstáculos
    for (const [x, n] of vis) {
      let a = amp;
      let color = LANES[n.lanes[0]].color;
      let jitter = 0;
      if (n.state === 1) { a = amp * clamp(1 - (now - n.judgedAt) / 0.22, 0, 1); }
      else if (n.state === 2) { color = '#ff3355'; jitter = (Math.random() - 0.5) * 6; }
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y + jitter);
      if (a > 0.5) laneShape(ctx, n.lanes[0], x, y + jitter, w, a);
      else ctx.lineTo(x + w / 2, y);
      glowStroke(ctx, color, 3, n.state === 0 ? 1.3 : 0.6);
      // figuras dobles: la segunda flota encima
      for (let k = 1; k < n.lanes.length; k++) {
        if (n.state === 1) break;
        const yy = y - 78 - (k - 1) * 40;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.35, yy);
        laneShape(ctx, n.lanes[k], x, yy, w * 0.7, amp * 0.6);
        glowStroke(ctx, n.state === 2 ? '#ff3355' : LANES[n.lanes[k]].color, 2.5, 1);
      }
      // pista de tecla
      if (o.hints && n.state === 0 && x > charX + 10) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '600 14px "Space Grotesk", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.lanes.map((l) => o.keySet[l]).join('+'), x, y + 70);
      }
    }
  };

  // ---------- personaje (cambia de forma con la energía) ----------
  const FORMS = ['Chispa', 'Trazo', 'Estrella', 'Prisma'];
  R.FORMS = FORMS;
  R.formFor = (energy) => (energy < 25 ? 0 : energy < 50 ? 1 : energy < 80 ? 2 : 3);

  R.drawCharacter = function (ctx, x, y, o) {
    // o: { form, color, anim:{lane, t0, kind}, t, beatPh, hurt }
    const now = performance.now();
    let dx = 0, dy = 0, rot = 0, sc = 1;
    const a = o.anim;
    if (a) {
      const p = clamp((now - a.t0) / 280, 0, 1);
      if (a.kind === 'miss') { dx = (Math.random() - 0.5) * 10 * (1 - p); dy = (Math.random() - 0.5) * 10 * (1 - p); }
      else if (a.lane === 0) dy = -Math.sin(Math.PI * p) * 70;
      else if (a.lane === 1) { rot = p * TAU; dy = -Math.sin(Math.PI * p) * 40; }
      else if (a.lane === 2) { dy = Math.sin(p * TAU * 2) * 12 * (1 - p); sc = 1 + 0.2 * Math.sin(Math.PI * p); }
      else if (a.lane === 3) { dy = -Math.sin(Math.PI * p) * 46; dx = Math.sin(Math.PI * p) * 8; }
    }
    const bob = -Math.exp(-o.beatPh * 6) * 5;
    const cx = x + dx, cy = y - 24 + dy + bob;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    const col = o.hurt ? '#ff3355' : o.color;
    ctx.beginPath();
    switch (o.form) {
      case 0: // chispa
        ctx.arc(0, 0, 8, 0, TAU);
        for (let i = 0; i < 4; i++) {
          const ang = o.t * 3 + (i * TAU) / 4;
          ctx.moveTo(Math.cos(ang) * 12, Math.sin(ang) * 12);
          ctx.lineTo(Math.cos(ang) * 20, Math.sin(ang) * 20);
        }
        break;
      case 1: // trazo
        ctx.moveTo(-16, 16); ctx.lineTo(0, -18); ctx.lineTo(16, 16); ctx.closePath();
        ctx.moveTo(-3, 2); ctx.lineTo(-3, 7); ctx.moveTo(4, 2); ctx.lineTo(4, 7);
        break;
      case 2: // estrella
        for (let i = 0; i <= 10; i++) {
          const r = i % 2 ? 9 : 22;
          const ang = -Math.PI / 2 + (i * TAU) / 10;
          i ? ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r) : ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
        }
        ctx.moveTo(-4, -2); ctx.lineTo(-4, 4); ctx.moveTo(4, -2); ctx.lineTo(4, 4);
        break;
      default: { // prisma: cubo de alambre girando
        const s = 15, ry = o.t * 1.6, rx = 0.5;
        const P = [];
        for (const X of [-s, s]) for (const Y of [-s, s]) for (const Z of [-s, s]) {
          let x1 = X * Math.cos(ry) - Z * Math.sin(ry), z1 = X * Math.sin(ry) + Z * Math.cos(ry);
          const y1 = Y * Math.cos(rx) - z1 * Math.sin(rx);
          P.push([x1, y1]);
        }
        const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
        for (const [i, j] of E) { ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); }
      }
    }
    glowStroke(ctx, col, 2.5, 1.4);
    ctx.restore();
    return { x: cx, y: cy };
  };

  // ---------- autopista de 4 carriles (modo Fusión) ----------
  R.drawHighway = function (ctx, rect, o) {
    // rect: {x,y,w,h} · o: { notes, now, look, pressed:[bool x4], keySet, t, fever, hue }
    const { x, y, w, h } = rect;
    const cx = x + w / 2;
    const horizonY = y + 8, hitY = y + h - 46;
    const K = 4;
    const depth = (p) => 1 + p * K;
    const laneX = (lane, p) => cx + ((lane - 1.5) * (w / 4.6)) / depth(p);
    const rowY = (p) => horizonY + (hitY - horizonY) / depth(p);
    // bordes y separadores
    ctx.beginPath();
    for (let l = 0; l <= 4; l++) {
      const lx0 = cx + ((l - 2) * (w / 4.6)), lx1 = cx + ((l - 2) * (w / 4.6)) / depth(1);
      ctx.moveTo(lx0, hitY + 30); ctx.lineTo(lx1, rowY(1));
    }
    ctx.strokeStyle = hsl(o.hue, 80, 65, 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // líneas de compás que avanzan
    const beat = 60 / o.bpm;
    const firstBeat = Math.ceil((o.now - o.offset) / beat);
    ctx.beginPath();
    for (let b = firstBeat; ; b++) {
      const tb = o.offset + b * beat;
      const p = (tb - o.now) / o.look;
      if (p > 1) break;
      if (p < 0) continue;
      const yy = rowY(p), half = (w / 2.3) / depth(p);
      ctx.moveTo(cx - half, yy); ctx.lineTo(cx + half, yy);
    }
    ctx.strokeStyle = hsl(o.hue, 80, 65, 0.15);
    ctx.lineWidth = 1;
    ctx.stroke();
    // receptores
    for (let l = 0; l < 4; l++) {
      const lx = laneX(l, 0);
      const pressed = o.pressed[l];
      ctx.beginPath();
      ctx.arc(lx, hitY, 24 + (pressed ? 4 : 0), 0, TAU);
      glowStroke(ctx, pressed ? '#ffffff' : LANES[l].color, pressed ? 3 : 2, pressed ? 1.6 : 0.8);
      R.laneIcon(ctx, l, lx, hitY - 8, 26, LANES[l].color, 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '700 13px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.keySet[l], lx, hitY + 44);
    }
    // notas
    for (let i = o.notes.length - 1; i >= 0; i--) {
      const n = o.notes[i];
      const p = (n.t - o.now) / o.look;
      if (p > 1 || p < -0.15) continue;
      if (n.state === 1) continue;
      const pp = Math.max(0, p);
      const sz = 46 / depth(pp);
      for (const l of n.lanes) {
        const lx = laneX(l, pp), ly = rowY(pp);
        const col = n.state === 2 ? '#ff3355' : LANES[l].color;
        ctx.beginPath();
        ctx.ellipse(lx, ly, sz * 0.75, sz * 0.32, 0, 0, TAU);
        glowStroke(ctx, col, 2.5 / Math.sqrt(depth(pp)), 1.2);
        R.laneIcon(ctx, l, lx, ly - sz * 0.25, sz * 0.7, col, 0.8);
      }
      if (n.lanes.length > 1) {
        ctx.beginPath();
        ctx.moveTo(laneX(Math.min(...n.lanes), pp), rowY(pp));
        ctx.lineTo(laneX(Math.max(...n.lanes), pp), rowY(pp));
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  };

  // ---------- constelación del jugador ----------
  R.drawConstellation = function (ctx, stars, rect, hue, t) {
    if (!stars.length) return;
    const P = stars.map((s) => [rect.x + s.x * rect.w, rect.y + s.y * rect.h]);
    ctx.beginPath();
    for (let i = 1; i < P.length; i++) {
      if (Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) < rect.w * 0.12) {
        ctx.moveTo(P[i - 1][0], P[i - 1][1]);
        ctx.lineTo(P[i][0], P[i][1]);
      }
    }
    ctx.strokeStyle = hsl(hue, 90, 75, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    P.forEach(([x, y], i) => {
      const tw = 0.6 + 0.4 * Math.sin(t * 3 + i);
      ctx.fillStyle = hsl(hue + stars[i].lane * 40, 90, 80, tw);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    });
  };

  root.R = R;
})(window);
