#!/usr/bin/env node
/*
 * Verifica que cada nivel se puede completar.
 * Busca (DFS con memoria) una secuencia de pulsaciones donde la entrada solo
 * cambia cada GRAN fotogramas, para evitar soluciones "de fotograma perfecto".
 *
 *   node tools/solve.js [granularidad]
 */
'use strict';
const { parseLevel, Sim } = require('../js/engine.js');
const LEVELS = require('../js/levels.js');

const GRAN = Number(process.argv[2] || 4);

function key(s) {
  return [s.frame, s.mode, s.grav, s.onGround ? 1 : 0, s.held ? 1 : 0, s.buffer ? 1 : 0,
    Math.round(s.y * 20), Math.round(s.vy * 2), s.used.length].join(',');
}

function solve(level) {
  const sim = new Sim(level);
  const seen = new Set();
  let furthest = 0;
  const path = [];

  function dfs(state) {
    const k = key(state);
    if (seen.has(k)) return false;
    seen.add(k);
    furthest = Math.max(furthest, state.x);
    for (const input of [false, true]) {
      sim.reset(state);
      let ok = true;
      for (let i = 0; i < GRAN; i++) {
        sim.step(input);
        if (sim.s.dead) { ok = false; break; }
        if (sim.s.won) { path.push(input); return true; }
      }
      sim.events.length = 0;
      if (!ok) continue;
      path.push(input);
      if (dfs(sim.snapshot())) return true;
      path.pop();
    }
    return false;
  }

  const won = dfs(sim.snapshot());
  return { won, furthest, states: seen.size, presses: path.filter((v, i) => v && !path[i - 1]).length };
}

let allOk = true;
for (const def of LEVELS) {
  const level = parseLevel(def);
  const t0 = Date.now();
  const r = solve(level);
  const secs = (level.finishX / level.speed).toFixed(1);
  console.log(`${r.won ? 'OK  ' : 'FALLA'} ${def.name.padEnd(20)} largo=${level.finishX} (${secs}s) ` +
    `${r.won ? '' : `llegó a x=${r.furthest.toFixed(1)} `}estados=${r.states} pulsaciones=${r.presses} ${Date.now() - t0}ms`);
  if (!r.won) allOk = false;
}
process.exit(allOk ? 0 : 1);
