/*
 * Jam en línea: varias personas juegan la misma canción a la vez, cada una en
 * su dispositivo, y ven en directo a las demás (puntos, combo, forma) como
 * fantasmas en su cinta.
 *
 * Dos formas de conectarse, con la misma interfaz:
 *  - Dentro de Claude: la "sala" compartida de la página (capacidad `room`).
 *  - En un navegador normal: conexión directa entre navegadores (WebRTC con PeerJS);
 *    quien crea la sala hace de centro y reenvía el estado de todos.
 * Cada jugador publica su estado completo (nunca diferencias) unas 8 veces por segundo.
 */
(function (root) {
  'use strict';

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  // ¿Estamos dentro de Claude con la sala disponible? (null fuera de Claude)
  const roomPromise = root.claude && typeof root.claude.use === 'function'
    ? root.claude.use('room').catch(() => null)
    : Promise.resolve(null);

  // ---------- dentro de Claude ----------
  class RoomBackend {
    constructor(room) { this.room = room; this.kind = 'claude'; this.onChange = null; }
    async open(code) {
      try {
        this.g = await this.room.join('onda-' + code.toLowerCase());
      } catch (e) {
        throw new Error(e && e.code === 'not_permitted'
          ? 'Esta vista no puede usar salas. Pide que te compartan el juego con acceso.'
          : 'No pude abrir la sala. Inténtalo de nuevo en unos segundos.');
      }
      this.unsub = this.g.onPeers(() => this.onChange && this.onChange(), () => this.onChange && this.onChange());
    }
    push(state) { if (this.g) this.g.presence(state).catch(() => {}); }
    list() {
      if (!this.g) return [];
      return this.g.peers().filter((p) => p.kind === 'viewer').map((p) => ({ id: p.peer, me: p.sameTab, state: p.presence || {} }));
    }
    async close() { try { if (this.unsub) this.unsub(); if (this.g) await this.g.leave(); } catch (e) { /* ya fuera */ } this.g = null; }
  }

  // ---------- navegador normal: WebRTC ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => reject(new Error('No pude cargar la librería de conexión. ¿Hay internet?'));
      document.head.appendChild(s);
    });
  }

  class PeerBackend {
    constructor() { this.kind = 'p2p'; this.onChange = null; this.states = new Map(); this.conns = new Map(); this.list_ = []; }

    async open(code, host) {
      if (!root.Peer) await loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js');
      const roomId = 'pulso-onda-' + code.toLowerCase();
      const peer = new root.Peer(host ? roomId : undefined);
      this.peer = peer;
      this.myId = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('El servidor de conexión no responde.')), 10000);
        peer.on('open', (id) => { clearTimeout(t); resolve(id); });
        peer.on('error', (err) => {
          clearTimeout(t);
          if (err.type === 'unavailable-id') reject(new Error('Ya existe una sala con ese código. Crea otra.'));
          else if (err.type === 'peer-unavailable') reject(new Error('No encuentro esa sala. Revisa el código.'));
          else if (err.type === 'browser-incompatible') reject(new Error('Este navegador no permite conexiones directas.'));
          else reject(new Error('No se pudo conectar (' + err.type + ').'));
        });
      });
      this.isHost = host;
      if (host) {
        peer.on('connection', (conn) => {
          this.conns.set(conn.peer, conn);
          conn.on('data', (d) => { if (d && d.t === 'state') { this.states.set(conn.peer, d.s); this.dirty = true; } });
          conn.on('close', () => { this.conns.delete(conn.peer); this.states.delete(conn.peer); this.dirty = true; });
        });
        this.timer = setInterval(() => {
          if (!this.dirty) return;
          this.dirty = false;
          const list = [...this.states].map(([id, s]) => ({ id, state: s }));
          for (const c of this.conns.values()) if (c.open) c.send({ t: 'peers', list });
          if (this.onChange) this.onChange();
        }, 100);
      } else {
        const conn = peer.connect(roomId, { reliable: true });
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('No encuentro esa sala. Revisa el código.')), 9000);
          conn.on('open', () => { clearTimeout(t); resolve(); });
          peer.on('error', (err) => { clearTimeout(t); reject(new Error(err.type === 'peer-unavailable' ? 'No encuentro esa sala. Revisa el código.' : 'No se pudo conectar (' + err.type + ').')); });
        });
        conn.on('data', (d) => { if (d && d.t === 'peers') { this.list_ = d.list; if (this.onChange) this.onChange(); } });
        conn.on('close', () => { this.list_ = []; this.lost = true; if (this.onChange) this.onChange(); });
        this.conn = conn;
      }
    }

    push(state) {
      if (this.isHost) { this.states.set(this.myId, state); this.dirty = true; }
      else if (this.conn && this.conn.open) this.conn.send({ t: 'state', s: state });
    }

    list() {
      const src = this.isHost ? [...this.states].map(([id, s]) => ({ id, state: s })) : this.list_;
      return src.map((x) => ({ id: x.id, me: x.id === this.myId, state: x.state || {} }));
    }

    async close() {
      clearInterval(this.timer);
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ya cerrado */ }
    }
  }

  // ---------- gestor del Jam ----------
  const Jam = {
    backend: null, code: null, host: false, state: {}, active: false,
    lastRound: 0, hostSeen: false, fxSeen: new Map(),
    onStart: null, onFx: null, onUpdate: null,
    _pushT: 0, _pending: false,

    async canUseClaudeRoom() { return !!(await roomPromise); },

    async connect(code, host, nick) {
      await this.leave();
      const room = await roomPromise;
      const backend = room ? new RoomBackend(room) : new PeerBackend();
      await backend.open(code, host);
      this.backend = backend;
      this.code = code;
      this.host = host;
      this.active = true;
      this.lastRound = 0; this.hostSeen = false; this.fxSeen = new Map();
      this.state = { nick: (nick || 'Jugador').slice(0, 24), hue: Math.floor(Math.random() * 360), host, phase: 'lobby', round: 0, fx: 0, score: 0 };
      backend.onChange = () => this.handlePeers();
      this.flush();
      this.handlePeers();
    },

    create(nick) { return this.connect(newCode(), true, nick); },
    join(code, nick) {
      const c = cleanCode(code);
      if (c.length < 4) return Promise.reject(new Error('Escribe el código de la sala (5 letras).'));
      return this.connect(c, false, nick);
    },

    async leave() {
      if (this.backend) await this.backend.close();
      this.backend = null; this.active = false; this.code = null; this.host = false;
      if (this.onUpdate) this.onUpdate();
    },

    // Mezcla y envía (como mucho ~8 veces por segundo).
    set(patch) {
      if (!this.active) return;
      Object.assign(this.state, patch);
      const now = performance.now();
      if (now - this._pushT > 120) this.flush();
      else if (!this._pending) { this._pending = true; setTimeout(() => this.flush(), 130); }
    },
    flush() {
      this._pending = false;
      this._pushT = performance.now();
      if (this.backend) this.backend.push({ ...this.state });
    },

    peers() { return this.backend ? this.backend.list() : []; },
    others() { return this.peers().filter((p) => !p.me); },
    hostPeer() { return this.peers().find((p) => !p.me && p.state.host); },
    lost() { return !!(this.backend && this.backend.lost); },

    startRound(cfg) {
      this.state.round = (this.state.round || 0) + 1;
      this.state.cfg = cfg;
      this.state.phase = 'play';
      this.flush();
    },

    bumpFx() { if (this.active) { this.state.fx = (this.state.fx || 0) + 1; this.flush(); } },

    handlePeers() {
      if (!this.host) {
        const hp = this.hostPeer();
        if (hp) {
          const r = hp.state.round || 0;
          if (!this.hostSeen) { this.hostSeen = true; this.lastRound = r; }
          else if (r > this.lastRound) { this.lastRound = r; if (this.onStart && hp.state.cfg) this.onStart(String(hp.state.cfg)); }
        }
      }
      for (const p of this.others()) {
        const cur = Number(p.state.fx) || 0;
        const prev = this.fxSeen.get(p.id);
        if (prev !== undefined && cur > prev && this.onFx) this.onFx(p);
        this.fxSeen.set(p.id, cur);
      }
      if (this.onUpdate) this.onUpdate();
    },
  };

  root.Jam = Jam;
})(window);
