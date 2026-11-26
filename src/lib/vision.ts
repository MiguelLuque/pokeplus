/**
 * Reconocimiento de la pantalla de selección de equipo de Pokémon Champions.
 *
 * - Columna derecha (tarjetas rojas): el rival. El juego no muestra nombres, solo
 *   el sprite, los iconos de tipo y el sexo.
 * - Columna izquierda (tarjetas moradas): tu equipo, con sprite, nombre y objeto.
 *
 * El juego dibuja cada sprite en una posición y tamaño fijos dentro de la tarjeta,
 * así que se compara directamente el recorte con cada sprite de referencia
 * (con un pequeño margen de desplazamiento), igual para los iconos de objeto.
 *
 * Módulo sin dependencias (lo usa también scripts/build-sprite-index.mjs en Node).
 */

export interface Img {
  width: number;
  height: number;
  /** RGBA, 4 bytes por píxel */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Box {x: number; y: number; w: number; h: number}

/** Posición de un elemento dentro de la tarjeta, en múltiplos de la altura de la tarjeta. */
export interface Placement {size: number; ox: number; oy: number}

/** Sprite del rival: cuadrado de 0.94·h, a 0.54·h del borde izquierdo de la tarjeta. */
export const RIVAL_SPRITE: Placement = {size: 0.94, ox: 0.54, oy: 0.03};
/** Sprite propio: a la derecha de la tarjeta (sobresale un poco por arriba). */
export const OWN_SPRITE: Placement = {size: 1.1, ox: 4.31, oy: -0.05};
/** Icono del objeto propio, a la izquierda del nombre del objeto. */
export const OWN_ITEM: Placement = {size: 0.435, ox: 0.645, oy: 0.5};

/** Resolución de comparación: sprites 40×40, objetos 24×24, con ±2 celdas de holgura. */
export const SPRITE_N = 40;
export const ITEM_N = 24;
export const JITTER = 2;

/* ------------------------------------------------------------------ utilidades */

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, mx ? d / mx : 0, mx / 255];
}

function runs(values: boolean[], minLen: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= values.length; i++) {
    const v = i < values.length && values[i];
    if (v && s < 0) s = i;
    if (!v && s >= 0) { if (i - s >= minLen) out.push([s, i]); s = -1; }
  }
  return out;
}

/** Filas de tarjetas a partir de una franja vertical de fondo de tarjeta. */
function cardRows(img: Img, sx0: number, sx1: number, test: (r: number, g: number, b: number) => boolean): [number, number][] {
  const {width: W, height: H, data} = img;
  sx0 = Math.max(0, sx0); sx1 = Math.min(W, Math.max(sx1, sx0 + 2));
  const rowOn: boolean[] = [];
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = sx0; x < sx1; x++) {
      const i = (y * W + x) * 4;
      if (test(data[i], data[i + 1], data[i + 2])) n++;
    }
    rowOn.push(n / (sx1 - sx0) > 0.6);
  }
  let cards = runs(rowOn, Math.max(6, Math.floor(H * 0.05)));
  if (!cards.length) return [];
  // quedarse con las tarjetas de altura parecida a la mediana (descarta cabeceras, botones…)
  const hs = cards.map(([a, b]) => b - a).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)];
  cards = cards.filter(([a, b]) => Math.abs(b - a - med) <= med * 0.25);
  return cards.slice(0, 6);
}

/**
 * Las alturas medidas bailan ±1–2 px (bordes redondeados, reescalado), y todo se posiciona
 * en múltiplos de la altura. La separación entre tarjetas es mucho más estable: con 3 o
 * más tarjetas, la altura se deduce de ella (`ratio` = altura / separación en el juego).
 */
function normalizeHeights(rows: [number, number][], ratio: number): [number, number][] {
  if (rows.length < 3) return rows;
  const pitch = (rows[rows.length - 1][0] - rows[0][0]) / (rows.length - 1);
  const h = ratio * pitch;
  const med = rows.map(([a, b]) => b - a).sort((a, b) => a - b)[rows.length >> 1];
  if (Math.abs(h - med) > 0.15 * med) return rows; // separación irregular: falta una tarjeta
  return rows.map(([a]) => [a, a + h]);
}

/** Columnas (en [xa, xb)) donde más del 8 % de los píxeles cumplen `test`. */
function columnRuns(img: Img, xa: number, xb: number, test: (r: number, g: number, b: number) => boolean, minLen: number) {
  const {width: W, height: H, data} = img;
  const col: boolean[] = [];
  for (let x = xa; x < xb; x++) {
    let n = 0;
    for (let y = 0; y < H; y += 2) {
      const i = (y * W + x) * 4;
      if (test(data[i], data[i + 1], data[i + 2])) n++;
    }
    col.push(n / (H / 2) > 0.08);
  }
  return runs(col, minLen).map(([a, b]) => [a + xa, b + xa] as [number, number]);
}

/* ------------------------------------------------------------------ tarjetas */

const isCardRed = (r: number, g: number, b: number) => r > 60 && r > 2 * g && r > 1.3 * b;
/** Fondo morado de tus tarjetas (relleno y borde). */
const isOwnPurple = (r: number, g: number, b: number) => b > 150 && b > r + 50 && b > g + 60;

/**
 * Borde izquierdo exacto de la columna de tarjetas (todo se posiciona desde ahí).
 * La primera estimación (columnRuns) mira toda la altura de la pantalla y se ensancha si
 * hay algo del mismo color al lado: p. ej. los rayos de luz rosas, que en las capturas de
 * iPhone (Display P3, convertidas a sRGB por el navegador) pasan por "rojo de tarjeta".
 * Aquí solo cuentan las filas de las tarjetas: el borde es la primera columna desde la que
 * el margen izquierdo de la tarjeta (fondo liso) es de ese color en casi todas las filas.
 */
function refineLeft(img: Img, rows: [number, number][], x0: number, x1: number,
  test: (r: number, g: number, b: number) => boolean): number {
  if (!rows.length) return x0;
  const {width: W, data} = img;
  const h = median(rows.map(([a, b]) => b - a));
  const ys: number[] = [];
  for (const [a, b] of rows) for (let f = 0.15; f < 0.9; f += 0.1) ys.push(Math.round(a + f * (b - a)));
  const k = Math.max(3, Math.round(0.15 * h));
  const xa = Math.max(0, x0 - Math.round(0.5 * h)), xb = Math.min(x1, x0 + Math.round(0.4 * h));
  const on: boolean[] = [];
  for (let x = xa; x < xb + k; x++) {
    let n = 0;
    for (const y of ys) {
      const i = (y * W + x) * 4;
      if (test(data[i], data[i + 1], data[i + 2])) n++;
    }
    on.push(n / ys.length > 0.8);
  }
  for (let x = xa; x < xb; x++) {
    let ok = true;
    for (let j = 0; j < k && ok; j++) ok = on[x - xa + j];
    if (ok) return x;
  }
  return x0;
}

/** Localiza las tarjetas rojas del equipo rival (columna derecha). */
export function findRivalCards(img: Img): Box[] {
  const {width: W} = img;
  const cols = columnRuns(img, Math.floor(W * 0.5), W, isCardRed, Math.max(8, Math.floor(W * 0.04)));
  if (!cols.length) return [];
  // la columna de tarjetas es el tramo más ancho de columnas "rojas"
  const [x0, x1] = cols.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  const w = x1 - x0;
  // filas: franja a la izquierda de la tarjeta, donde solo hay fondo
  const rows = normalizeHeights(cardRows(img, x0 + Math.floor(w * 0.02), x0 + Math.max(Math.floor(w * 0.17), 3), isCardRed), 0.908);
  const rx = refineLeft(img, rows, x0, x1, isCardRed);
  return rows.map(([a, b]) => ({x: rx, y: a, w: x1 - rx, h: b - a}));
}

/** Localiza tus tarjetas moradas (columna izquierda). */
export function findOwnCards(img: Img): Box[] {
  const {width: W, height: H} = img;
  const cols = columnRuns(img, 0, Math.floor(W * 0.5), isOwnPurple, Math.max(8, Math.floor(W * 0.04)));
  if (!cols.length) return [];
  const [x0, x1] = cols.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  // franja junto al borde izquierdo, antes del texto del nombre
  const rows = normalizeHeights(cardRows(img, x0 + Math.round(0.025 * H), x0 + Math.round(0.048 * H), isOwnPurple), 0.769);
  return rows.map(([a, b]) => ({x: x0, y: a, w: x1 - x0, h: b - a}));
}

/* ------------------------------------------------------- muestreo y comparación */

/**
 * Recorte cuadrado de la imagen reducido a M×M por promedio de área
 * (admite coordenadas fraccionarias y también ampliar). Devuelve RGB en Float32.
 */
export function sampleSquare(img: Img, X: number, Y: number, side: number, M: number): Float32Array {
  const {width: W, height: H, data} = img;
  const axis = (start: number, limit: number) => {
    const cells: {p: number[]; w: number[]}[] = [];
    const step = side / M;
    for (let c = 0; c < M; c++) {
      const a = start + c * step, b = a + step;
      const p: number[] = [], w: number[] = [];
      for (let q = Math.floor(a); q < Math.ceil(b); q++) {
        const wt = Math.min(b, q + 1) - Math.max(a, q);
        if (wt <= 0) continue;
        p.push(Math.min(limit - 1, Math.max(0, q))); w.push(wt);
      }
      cells.push({p, w});
    }
    return cells;
  };
  const xs = axis(X, W), ys = axis(Y, H);
  const out = new Float32Array(M * M * 3);
  for (let cy = 0; cy < M; cy++) {
    const ry = ys[cy];
    for (let cx = 0; cx < M; cx++) {
      const rx = xs[cx];
      let r = 0, g = 0, b = 0, t = 0;
      for (let j = 0; j < ry.p.length; j++) {
        const row = ry.p[j] * W;
        for (let k = 0; k < rx.p.length; k++) {
          const wt = ry.w[j] * rx.w[k];
          const i = (row + rx.p[k]) * 4;
          r += wt * data[i]; g += wt * data[i + 1]; b += wt * data[i + 2]; t += wt;
        }
      }
      const o = (cy * M + cx) * 3;
      out[o] = r / t; out[o + 1] = g / t; out[o + 2] = b / t;
    }
  }
  return out;
}

/** Recorte preparado para comparar: (n+2·pad)² celdas RGB y máscara de "no es fondo". */
export interface Patch {n: number; pad: number; rgb: Float32Array; fg: Uint8Array}

export function samplePatch(img: Img, card: Box, at: Placement, n: number, pad: number,
  isBg: (r: number, g: number, b: number) => boolean): Patch {
  const side = at.size * card.h, cell = side / n, M = n + 2 * pad;
  const rgb = sampleSquare(img, card.x + at.ox * card.h - pad * cell, card.y + at.oy * card.h - pad * cell, M * cell, M);
  const fg = new Uint8Array(M * M);
  for (let i = 0; i < M * M; i++) fg[i] = isBg(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) ? 0 : 1;
  return {n, pad, rgb, fg};
}

/** Fondo de la tarjeta rival (rojo/magenta oscuro, también con rayos de luz encima). */
export function isRivalBg(r: number, g: number, b: number) {
  const [h, s, v] = rgbToHsv(r, g, b);
  return (h >= 325 || h <= 2) && s > 0.45 && v < 0.75;
}
export const isOwnBg = (r: number, g: number, b: number) => b > 120 && b > r + 40 && b > g + 50;
export const isItemBg = (r: number, g: number, b: number) => b > 90 && b > r + 15 && b > g + 25;

/** Imagen de referencia n×n: píxeles con alfa, listos para comparar rápido. */
export interface Ref {
  name: string;
  /** índices (y·n+x) de los píxeles con alfa > 0 */
  idx: Uint16Array;
  alpha: Float32Array;
  rgb: Float32Array;
  alphaSum: number;
}

/** Extrae las referencias de un atlas (cuadrícula de `cols` columnas de n×n). */
export function refsFromAtlas(atlas: Img, names: string[], n: number, cols: number): Ref[] {
  return names.map((name, k) => {
    const ox = (k % cols) * n, oy = Math.floor(k / cols) * n;
    const idx: number[] = [], alpha: number[] = [], rgb: number[] = [];
    let alphaSum = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = ((oy + y) * atlas.width + ox + x) * 4;
      const a = atlas.data[i + 3] / 255;
      if (a <= 0) continue;
      idx.push(y * n + x); alpha.push(a); alphaSum += a;
      rgb.push(atlas.data[i], atlas.data[i + 1], atlas.data[i + 2]);
    }
    return {name, idx: Uint16Array.from(idx), alpha: Float32Array.from(alpha), rgb: Float32Array.from(rgb), alphaSum};
  });
}

/**
 * Distancia (menor = mejor) entre el recorte y una referencia: diferencia media de color
 * bajo la silueta de la referencia + `wOut` × fracción del objeto del recorte que queda
 * fuera de esa silueta. Se toma el mejor desplazamiento dentro de ±pad celdas.
 */
export function matchPatch(p: Patch, ref: Ref, wOut = 0.3): number {
  const {n, pad, rgb, fg} = p, M = n + 2 * pad;
  if (!ref.alphaSum) return Infinity;
  let best = Infinity;
  for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) {
    const oy = pad + dy, ox = pad + dx;
    let fgTot = 0;
    for (let y = 0; y < n; y++) {
      const row = (oy + y) * M + ox;
      for (let x = 0; x < n; x++) fgTot += fg[row + x];
    }
    let diff = 0, fgIn = 0;
    for (let k = 0; k < ref.idx.length; k++) {
      const q = ref.idx[k], y = (q / n) | 0, x = q - y * n;
      const j = (oy + y) * M + ox + x, a = ref.alpha[k];
      const dr = Math.abs(rgb[j * 3] - ref.rgb[k * 3]);
      const dg = Math.abs(rgb[j * 3 + 1] - ref.rgb[k * 3 + 1]);
      const db = Math.abs(rgb[j * 3 + 2] - ref.rgb[k * 3 + 2]);
      diff += a * (dr + dg + db);
      fgIn += a * fg[j];
    }
    const s = diff / 3 / ref.alphaSum / 255 + wOut * (fgTot - fgIn) / Math.max(1, fgTot);
    if (s < best) best = s;
  }
  return best;
}

/* -------------------------------------------------------- tipos y sexo */

/** Colores oficiales de los iconos de tipo (los mismos que usa el juego). */
const TYPE_RGB: Record<string, [number, number, number]> = {
  Normal: [159, 161, 159], Fire: [230, 40, 41], Water: [41, 128, 239], Electric: [250, 192, 0], Grass: [63, 161, 41],
  Ice: [61, 206, 243], Fighting: [255, 128, 0], Poison: [145, 65, 203], Ground: [145, 81, 33], Flying: [129, 185, 239],
  Psychic: [239, 65, 121], Bug: [145, 161, 25], Rock: [175, 169, 129], Ghost: [112, 65, 112], Dragon: [80, 96, 225],
  Dark: [98, 77, 78], Steel: [96, 161, 184], Fairy: [239, 112, 239],
};

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function regionPixels(img: Img, x0: number, y0: number, x1: number, y1: number) {
  const out: [number, number, number][] = [];
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y1)); y++)
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x1)); x++) {
      const i = (y * img.width + x) * 4;
      out.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  return out;
}

/** Fondo de tarjeta rival para los iconos (más estricto que isRivalBg). */
function isRivalCardFill(r: number, g: number, b: number) {
  const [h, s, v] = rgbToHsv(r, g, b);
  return h >= 330 && h <= 354 && s > 0.66 && v < 0.62 && v > 0.12;
}

/** Lee los iconos de tipo (1 o 2) de la tarjeta rival. */
export function cardTypes(img: Img, card: Box): string[] {
  const {x, y, h} = card;
  const out: string[] = [];
  for (const [fx0, fx1] of [[1.68, 2.02], [2.13, 2.47]]) {
    const px = regionPixels(img, x + fx0 * h, y + 0.22 * h, x + fx1 * h, y + 0.46 * h);
    const white = px.filter(([r, g, b]) => Math.min(r, g, b) > 170);
    const fill = px.filter(([r, g, b]) => Math.min(r, g, b) <= 170);
    // sin glifo blanco = no hay icono (Pokémon de un solo tipo)
    if (!px.length || white.length / px.length < 0.04 || !fill.length) continue;
    const c = [0, 1, 2].map(k => median(fill.map(p => p[k])));
    if (isRivalCardFill(c[0], c[1], c[2])) continue;
    let best = '', bd = Infinity;
    for (const [t, [r, g, b]] of Object.entries(TYPE_RGB)) {
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    if (bd < 70 ** 2) out.push(best);
  }
  return out;
}

/** Sexo según el icono ♂ (azul) / ♀ (rojo) en la zona indicada. '' si no aparece. */
function genderAt(img: Img, x0: number, y0: number, x1: number, y1: number): 'M' | 'F' | '' {
  const px = regionPixels(img, x0, y0, x1, y1);
  const vivid = px.filter(([r, g, b]) => rgbToHsv(r, g, b)[1] > 0.5 && Math.max(r, g, b) > 170);
  if (vivid.length < px.length * 0.2) return '';
  const blue = vivid.filter(([r, , b]) => b > r + 60).length;
  const red = vivid.filter(([r, , b]) => r > b + 60).length;
  return blue > red * 2 ? 'M' : red > blue * 2 ? 'F' : '';
}

export function cardGender(img: Img, card: Box): 'M' | 'F' | '' {
  const {x, y, h} = card;
  return genderAt(img, x + 1.76 * h, y + 0.66 * h, x + 1.92 * h, y + 0.84 * h);
}

/** En tus tarjetas el ♂/♀ está arriba a la derecha, antes del sprite. */
export function ownGender(img: Img, card: Box): 'M' | 'F' | '' {
  const {x, y, h} = card;
  return genderAt(img, x + 3.76 * h, y + 0.1 * h, x + 3.98 * h, y + 0.34 * h);
}

/* -------------------------------------------------------------- lectura */

export interface CardReading {
  box: Box;
  types: string[];
  gender: 'M' | 'F' | '';
  sprite: Patch;
}

export interface OwnReading {
  box: Box;
  gender: 'M' | 'F' | '';
  sprite: Patch;
  item: Patch;
}

export function readRivalCards(img: Img): CardReading[] {
  return findRivalCards(img).map(box => ({
    box,
    types: cardTypes(img, box),
    gender: cardGender(img, box),
    sprite: samplePatch(img, box, RIVAL_SPRITE, SPRITE_N, JITTER, isRivalBg),
  }));
}

export function readOwnCards(img: Img): OwnReading[] {
  return findOwnCards(img).map(box => ({
    box,
    gender: ownGender(img, box),
    sprite: samplePatch(img, box, OWN_SPRITE, SPRITE_N, JITTER, isOwnBg),
    item: samplePatch(img, box, OWN_ITEM, ITEM_N, JITTER, isItemBg),
  }));
}

/* ------------------------------------------------- referencias (script de build) */

/**
 * Reduce una imagen RGBA a n×n por promedio de área con alfa premultiplicado
 * (los píxeles transparentes no tiñen el borde). Devuelve RGBA sin premultiplicar.
 */
export function downsampleRGBA(img: Img, n: number): Uint8Array {
  const {width: W, height: H, data} = img;
  const out = new Uint8Array(n * n * 4);
  const sx = W / n, sy = H / n;
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    let r = 0, g = 0, b = 0, a = 0, t = 0;
    const ya = cy * sy, yb = ya + sy, xa = cx * sx, xb = xa + sx;
    for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
      const wy = Math.min(yb, y + 1) - Math.max(ya, y);
      for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
        const w = wy * (Math.min(xb, x + 1) - Math.max(xa, x));
        const i = (y * W + x) * 4, al = data[i + 3] / 255;
        r += w * al * data[i]; g += w * al * data[i + 1]; b += w * al * data[i + 2]; a += w * al; t += w;
      }
    }
    const o = (cy * n + cx) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    out[o + 3] = Math.round((255 * a) / t);
  }
  return out;
}
