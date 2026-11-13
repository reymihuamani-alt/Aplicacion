/*
 * Niveles de Pulso Cúbico.
 *
 * Leyenda de caracteres (cada carácter = una casilla):
 *   #  bloque sólido         =  losa (media altura)
 *   ^  pincho                v  pincho hacia abajo
 *   p  plataforma de salto   o  orbe amarillo (pulsa dentro)   b  orbe azul (invierte gravedad)
 *   S  portal nave           C  portal cubo
 *   G  portal gravedad ↑     N  portal gravedad normal
 *
 * Un trozo es un array de filas (arriba → abajo; la última fila toca el suelo)
 * o un número de columnas vacías.
 */
(function (root) {
  'use strict';

  const ROWS = 11; // altura total hasta el techo

  // Rellena un trozo hasta ROWS filas (añade filas vacías arriba).
  function tall(rows) {
    const out = rows.slice();
    while (out.length < ROWS) out.unshift('');
    return out;
  }

  // Coloca un trozo "colgando" del techo (para tramos con gravedad invertida).
  function ceil(rows) {
    const swap = { '^': 'v', 'v': '^' };
    const flipped = rows.slice().reverse().map((r) => r.replace(/[\^v]/g, (c) => swap[c]));
    while (flipped.length < ROWS) flipped.push('');
    return flipped;
  }

  // Tramo de nave: cada puerta es [alturaAbajo, alturaArriba, ancho?].
  function ship(gates, spacing, spikes) {
    const cols = [];
    const empty = () => new Array(ROWS).fill(' ');
    for (let i = 0; i < spacing; i++) cols.push(empty());
    for (const [lo, hi, w = 2] of gates) {
      for (let k = 0; k < w; k++) {
        const c = empty();
        for (let y = 0; y < lo; y++) c[ROWS - 1 - y] = '#';
        for (let y = 0; y < hi; y++) c[y] = '#';
        if (spikes && lo > 0) c[ROWS - 1 - lo] = '^';
        if (spikes && hi > 0) c[hi] = 'v';
        cols.push(c);
      }
      for (let i = 0; i < spacing; i++) cols.push(empty());
    }
    const rows = [];
    for (let r = 0; r < ROWS; r++) rows.push(cols.map((c) => c[r]).join(''));
    return rows;
  }

  const LEVELS = [
    {
      id: 'latido',
      name: 'Primer Latido',
      difficulty: 'Fácil',
      stars: 1,
      speed: 10.4,
      colors: { bgTop: '#1b2a6b', bgBottom: '#3a1d6e', ground: '#24357f', line: '#7fd4ff', accent: '#5ee7ff' },
      music: { bpm: 128, root: 57, scale: 'minor', prog: [0, 5, 3, 4], seed: 3 },
      chunks: [
        18,
        ['^'], 11,
        ['^'], 9, ['^'], 11,
        ['^^'], 11,
        ['#'], 7, ['#'], 10,
        [' ##', '###'], 9,
        ['^^^'], 12,
        ['#    #    #'], 9,
        ['###^^###'], 10,
        ['    ######', '          ', 'p         '], 11,
        ['  o  ', '     ', '^^^^^'], 11,
        ['^', '#'], 11,
        ['##^^##^^##'], 11,
        ['      ####', '   ###    ', '###       '], 11,
        ['^^'], 5, ['^'], 11,
        ['  o   ', '       ', '^^^^^^'], 11,
        ['  ##  ##', '^^##^^##'], 11,
        ['p    p    p'], 12,
        ['^^^'], 8, ['^^'], 8, ['^'], 14,
      ],
    },
    {
      id: 'circuito',
      name: 'Circuito Nocturno',
      difficulty: 'Normal',
      stars: 3,
      speed: 11,
      colors: { bgTop: '#0d3b3a', bgBottom: '#10204a', ground: '#0f4a4a', line: '#6dffb8', accent: '#45ffa6' },
      music: { bpm: 140, root: 52, scale: 'dorian', prog: [0, 3, 6, 4], seed: 11 },
      chunks: [
        16,
        ['^^'], 10,
        ['  #', '^^#'], 10,
        ['^^^'], 9,
        ['  o    ', '       ', '^^^^^^^'], 10,
        ['   ##   ', '## ## ##', '##^##^##'], 10,
        tall(['S']), 4,
        ship([[2, 5], [0, 6], [3, 3], [1, 6], [4, 2], [2, 4]], 7),
        tall(['C']), 10,
        ['^'], 6, ['^^'], 10,
        ['G'], 10,
        ceil(['^']), 9,
        ceil(['^^']), 9,
        ceil(['#', '#']), 8,
        ceil(['^^^']), 10,
        ['N'], 14,
        ['     ###', '  ##    ', 'p^^^^^^^'], 10,
        ['   o   o   ', '           ', '^^^^^^^^^^^'], 12,
        ['^^'], 4, ['^^'], 12,
      ],
    },
    {
      id: 'tormenta',
      name: 'Tormenta Prisma',
      difficulty: 'Difícil',
      stars: 6,
      speed: 12,
      colors: { bgTop: '#4a0d2e', bgBottom: '#200c4a', ground: '#5a1240', line: '#ff8ad8', accent: '#ff5fb7' },
      music: { bpm: 150, root: 50, scale: 'phrygian', prog: [0, 1, 5, 4], seed: 29 },
      chunks: [
        16,
        ['^^^'], 9,
        ['  #', '^^#'], 10,
        ['   o   o   ', '           ', '^^^^^^^^^^^'], 10,
        ['    ##', ' ## ##', '^##^##'], 10,
        tall(['S']), 3,
        ship([[3, 5], [0, 7], [5, 2], [1, 6], [4, 3], [0, 7], [5, 3]], 6, true),
        tall(['C']), 10,
        ['   b   '], 6,
        ceil(['^']), 8,
        ceil(['^^']), 8,
        ceil(['##^^##']), 8,
        ['N'], 12,
        ['^^^'], 7, ['^^^'], 10,
        ['        ####', '    o       ', '            ', 'p^^^^^^^^^^^'], 12,
        ['   o   o   o   ', '               ', '^^^^^^^^^^^^^^^'], 12,
        tall(['S']), 3,
        ship([[2, 6], [5, 2], [0, 6], [4, 4, 3], [1, 7], [5, 2]], 6, true),
        tall(['C']), 10,
        ['^^'], 5, ['  #', '^^#'], 8, ['^^^'], 14,
      ],
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS;
  else root.LEVELS = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
