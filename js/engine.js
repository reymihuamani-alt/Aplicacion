/*
 * Pulso Cúbico — motor de física determinista.
 * Se usa tanto en el navegador como en Node (tools/solve.js) para verificar
 * que todos los niveles se pueden completar.
 *
 * Unidades: 1 = una casilla. El eje Y apunta hacia arriba y el suelo está en y = 0.
 */
(function (root) {
  'use strict';

  const PHYS = {
    FPS: 60,
    SUB: 4,            // subpasos por fotograma
    G: 100,            // gravedad (casillas/s²)
    JUMP: 21,          // velocidad de salto
    PAD: 28,           // plataforma de salto amarilla
    ORB: 19.5,         // orbe amarillo
    BLUE_ORB: 8,       // empuje del orbe azul (invierte gravedad)
    SHIP_UP: 62,       // aceleración de la nave al mantener pulsado
    SHIP_DOWN: 52,     // aceleración de la nave al soltar
    SHIP_MAX: 11,      // velocidad vertical máx. de la nave
    MAXV: 28,          // velocidad vertical máxima general
    CEIL: 11,          // techo (activo en modo nave o gravedad invertida)
    TOL: 0.3,          // tolerancia para "subir" a un bloque
  };

  const T = {
    BLOCK: 'block', SLAB: 'slab', SPIKE: 'spike', SPIKE_DOWN: 'spikeDown',
    PAD: 'pad', ORB: 'orb', ORB_BLUE: 'orbBlue',
    P_SHIP: 'portalShip', P_CUBE: 'portalCube', P_FLIP: 'portalFlip', P_NORMAL: 'portalNormal',
  };

  const CHAR_MAP = {
    '#': T.BLOCK, '=': T.SLAB, '^': T.SPIKE, 'v': T.SPIKE_DOWN,
    'p': T.PAD, 'o': T.ORB, 'b': T.ORB_BLUE,
    'S': T.P_SHIP, 'C': T.P_CUBE, 'G': T.P_FLIP, 'N': T.P_NORMAL,
  };

  /**
   * Un nivel se define como una lista de "trozos":
   *  - número: n columnas vacías
   *  - array de strings: filas de arriba hacia abajo; la última fila es y = 0.
   */
  function parseLevel(def) {
    const objects = [];
    let cursor = 0;
    let id = 0;
    for (const chunk of def.chunks) {
      if (typeof chunk === 'number') { cursor += chunk; continue; }
      const h = chunk.length;
      let w = 0;
      chunk.forEach((line, i) => {
        w = Math.max(w, line.length);
        const y = h - 1 - i;
        for (let j = 0; j < line.length; j++) {
          const type = CHAR_MAP[line[j]];
          if (!type) continue;
          const o = { id: id++, type, x: cursor + j, y, w: 1, h: 1 };
          if (type === T.SLAB) { o.y = y + 0.5; o.h = 0.5; }
          objects.push(o);
        }
      });
      cursor += w;
    }
    const finishX = cursor + 4;
    const length = finishX + 12;
    const buckets = [];
    for (const o of objects) {
      for (let c = Math.floor(o.x); c <= Math.floor(o.x + o.w); c++) {
        (buckets[c] || (buckets[c] = [])).push(o);
      }
    }
    return { ...def, objects, finishX, length, buckets };
  }

  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw - 1e-6 && ax + aw > bx + 1e-6 && ay < by + bh - 1e-6 && ay + ah > by + 1e-6;
  }

  function initialState(level) {
    return {
      x: 0, y: 0, vy: 0,
      mode: level.startMode || 'cube',
      grav: 1,
      onGround: true,
      held: false,
      buffer: false,   // pulsación "fresca" disponible para un orbe
      used: [],        // ids de orbes / plataformas / portales ya usados
      frame: 0,
      dead: false, won: false,
    };
  }

  class Sim {
    constructor(level) {
      this.level = level;
      this.events = [];
      this.reset();
    }

    reset(snapshot) {
      this.s = snapshot ? { ...snapshot } : initialState(this.level);
      this.s.dead = false; this.s.won = false;
    }

    snapshot() { return { ...this.s }; }

    nearby(x) {
      const out = [];
      const b = this.level.buckets;
      const c0 = Math.floor(x) - 1;
      for (let c = c0; c <= c0 + 3; c++) {
        const list = b[c];
        if (!list) continue;
        for (const o of list) if (out.indexOf(o) === -1) out.push(o);
      }
      return out;
    }

    /** Avanza un fotograma (1/60 s). `input` = botón pulsado. */
    step(input) {
      const s = this.s;
      if (s.dead || s.won) return;
      if (input && !s.held) s.buffer = true;
      if (!input) s.buffer = false;
      s.held = input;
      const dt = 1 / PHYS.FPS / PHYS.SUB;
      for (let k = 0; k < PHYS.SUB; k++) {
        this.sub(dt);
        if (s.dead || s.won) break;
      }
      s.frame++;
    }

    emit(type, extra) { this.events.push({ type, x: this.s.x, y: this.s.y, ...extra }); }

    die() { this.s.dead = true; this.emit('die'); }

    use(o) { this.s.used = this.s.used.concat(o.id); }

    sub(dt) {
      const s = this.s;
      const speed = this.level.speed;
      const near = this.nearby(s.x);

      // --- interacciones (orbes, plataformas, portales) ---
      for (const o of near) {
        if (s.used.indexOf(o.id) !== -1) continue;
        switch (o.type) {
          case T.ORB:
          case T.ORB_BLUE: {
            const dx = (s.x + 0.5) - (o.x + 0.5), dy = (s.y + 0.5) - (o.y + 0.5);
            if (dx * dx + dy * dy < 1.0 && s.held && s.buffer) {
              s.buffer = false;
              this.use(o);
              if (o.type === T.ORB) {
                s.vy = PHYS.ORB * s.grav;
              } else {
                s.grav = -s.grav;
                s.vy = -PHYS.BLUE_ORB * s.grav;
              }
              s.onGround = false;
              this.emit('orb', { obj: o });
            }
            break;
          }
          case T.PAD:
            if (overlap(s.x, s.y, 1, 1, o.x + 0.1, o.y, 0.8, 0.3)) {
              this.use(o);
              s.vy = PHYS.PAD * s.grav;
              s.onGround = false;
              this.emit('pad', { obj: o });
            }
            break;
          case T.P_SHIP: case T.P_CUBE: case T.P_FLIP: case T.P_NORMAL:
            if (s.x + 0.5 >= o.x + 0.5) {
              this.use(o);
              if (o.type === T.P_SHIP) s.mode = 'ship';
              if (o.type === T.P_CUBE) s.mode = 'cube';
              if (o.type === T.P_FLIP && s.grav !== -1) { s.grav = -1; s.vy *= 0.4; s.onGround = false; }
              if (o.type === T.P_NORMAL && s.grav !== 1) { s.grav = 1; s.vy *= 0.4; s.onGround = false; }
              this.emit('portal', { obj: o });
            }
            break;
        }
      }

      // --- movimiento ---
      const g = s.grav;
      if (s.mode === 'cube') {
        if (s.onGround && s.held) {
          s.vy = PHYS.JUMP * g;
          s.onGround = false;
          s.buffer = false;
          this.emit('jump');
        }
        s.vy -= PHYS.G * g * dt;
      } else {
        s.vy += (s.held ? PHYS.SHIP_UP : -PHYS.SHIP_DOWN) * g * dt;
        s.vy = Math.max(-PHYS.SHIP_MAX, Math.min(PHYS.SHIP_MAX, s.vy));
      }
      s.vy = Math.max(-PHYS.MAXV, Math.min(PHYS.MAXV, s.vy));

      const prevY = s.y;
      s.x += speed * dt;
      s.y += s.vy * dt;
      s.onGround = false;

      // suelo
      if (s.y < 0) { s.y = 0; if (s.vy < 0) s.vy = 0; if (g === 1) s.onGround = true; }
      // techo
      if ((s.mode === 'ship' || g === -1) && s.y + 1 > PHYS.CEIL) {
        s.y = PHYS.CEIL - 1; if (s.vy > 0) s.vy = 0; if (g === -1) s.onGround = true;
      }

      // --- bloques sólidos ---
      for (const o of near) {
        if (o.type !== T.BLOCK && o.type !== T.SLAB) continue;
        if (!overlap(s.x, s.y, 1, 1, o.x, o.y, o.w, o.h)) continue;
        const top = o.y + o.h, bot = o.y;
        const fromAbove = prevY >= top - PHYS.TOL;
        const fromBelow = prevY + 1 <= bot + PHYS.TOL;
        if (fromAbove && (s.mode === 'ship' || g === 1)) {
          s.y = top; if (s.vy < 0) s.vy = 0; if (g === 1) s.onGround = true;
        } else if (fromBelow && (s.mode === 'ship' || g === -1)) {
          s.y = bot - 1; if (s.vy > 0) s.vy = 0; if (g === -1) s.onGround = true;
        } else {
          this.die();
          return;
        }
      }

      // --- peligros ---
      const hx = s.x + 0.15, hy = s.y + 0.1;
      for (const o of near) {
        if (o.type === T.SPIKE) {
          if (overlap(hx, hy, 0.7, 0.8, o.x + 0.35, o.y, 0.3, 0.55)) { this.die(); return; }
        } else if (o.type === T.SPIKE_DOWN) {
          if (overlap(hx, hy, 0.7, 0.8, o.x + 0.35, o.y + 0.45, 0.3, 0.55)) { this.die(); return; }
        }
      }

      if (s.x >= this.level.finishX) { s.won = true; this.emit('win'); }
    }
  }

  const api = { PHYS, T, parseLevel, Sim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
