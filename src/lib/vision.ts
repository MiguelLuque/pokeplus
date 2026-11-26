/**
 * Reconocimiento de la pantalla de selección de equipo de Pokémon Champions.
 *
 * El juego no muestra los nombres del rival: solo su sprite, sus tipos y su sexo
 * dentro de tarjetas rojas en la columna derecha. Aquí se localizan esas tarjetas,
 * se recorta el sprite y se compara con un índice de los sprites de menú del juego.
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

/** Lado de la miniatura que se compara (16×16 RGBA). */
export const THUMB = 16;
/** Lado del encuadre en múltiplos de √área del sprite. */
export const THUMB_SPAN = 2.2;

/* ------------------------------------------------------------------ tarjetas */

const isCardRed = (r: number, g: number, b: number) => r > 60 && r > 2 * g && r > 1.3 * b;

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

/** Localiza las tarjetas rojas del equipo rival (columna derecha). */
export function findRivalCards(img: Img): Box[] {
  const {width: W, height: H, data} = img;
  const xStart = Math.floor(W * 0.5);
  const colFrac: boolean[] = [];
  for (let x = xStart; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y += 2) {
      const i = (y * W + x) * 4;
      if (isCardRed(data[i], data[i + 1], data[i + 2])) n++;
    }
    colFrac.push(n / (H / 2) > 0.08);
  }
  // la columna de tarjetas es el tramo más ancho de columnas "rojas"
  const colRuns = runs(colFrac, Math.max(8, Math.floor(W * 0.04)));
  if (!colRuns.length) return [];
  const [c0, c1] = colRuns.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  const x0 = xStart + c0, x1 = xStart + c1, w = x1 - x0;

  // filas: se mira una franja a la izquierda de la tarjeta, donde solo hay fondo
  const sx0 = x0 + Math.floor(w * 0.02), sx1 = x0 + Math.max(Math.floor(w * 0.17), 3);
  const rowOn: boolean[] = [];
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = sx0; x < sx1; x++) {
      const i = (y * W + x) * 4;
      if (isCardRed(data[i], data[i + 1], data[i + 2])) n++;
    }
    rowOn.push(n / (sx1 - sx0) > 0.6);
  }
  let cards = runs(rowOn, Math.max(6, Math.floor(H * 0.05)));
  if (!cards.length) return [];
  // quedarse con las tarjetas de altura parecida a la mediana (descarta la cabecera, etc.)
  const hs = cards.map(([a, b]) => b - a).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)];
  cards = cards.filter(([a, b]) => Math.abs(b - a - med) <= med * 0.25);
  return cards.slice(0, 6).map(([a, b]) => ({x: x0, y: a, w, h: b - a}));
}

/* ------------------------------------------------------------------- sprite */

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, mx ? d / mx : 0, mx / 255];
}

/** Fondo de tarjeta rival: rojo oscuro saturado. */
function isRivalBg(r: number, g: number, b: number) {
  const [h, s, v] = rgbToHsv(r, g, b);
  return h >= 330 && h <= 354 && s > 0.66 && v < 0.62 && v > 0.12;
}

function erode(m: Uint8Array, w: number, h: number) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    o[i] = m[i] && (y === 0 || m[i - w]) && (y === h - 1 || m[i + w]) && (x === 0 || m[i - 1]) && (x === w - 1 || m[i + 1]) ? 1 : 0;
  }
  return o;
}
function dilate(m: Uint8Array, w: number, h: number) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    o[i] = m[i] || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) ? 1 : 0;
  }
  return o;
}

/** Quita líneas finas (rayos de luz del fondo) y manchas pequeñas de la máscara. */
export function cleanMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const opened = dilate(dilate(erode(erode(mask, w, h), w, h), w, h), w, h);
  const label = new Int32Array(mask.length);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let i = 0; i < opened.length; i++) {
    if (!opened[i] || label[i]) continue;
    const id = sizes.length;
    let n = 0;
    label[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const x = p % w, y = (p - x) / w;
      const nb = [y > 0 ? p - w : -1, y < h - 1 ? p + w : -1, x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1];
      for (const q of nb) if (q >= 0 && opened[q] && !label[q]) { label[q] = id; stack.push(q); }
    }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  const out = new Uint8Array(mask.length);
  if (!big) return mask;
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] && label[i] && sizes[label[i]] >= 0.12 * big ? 1 : 0;
  return out;
}

/**
 * Miniatura THUMB×THUMB: el objeto se encuadra en un cuadrado y se promedia
 * por celdas. Devuelve RGB (sin premultiplicar) + cobertura, valores 0..255.
 */
export function thumbnail(rgb: (i: number) => [number, number, number], mask: Uint8Array, w: number, h: number): Uint8Array | null {
  // se centra en el centroide y se escala por la raíz del área: así un resto de línea
  // pegado al sprite apenas mueve el encuadre (con la caja envolvente lo desplazaría)
  let n = 0, sx0 = 0, sy0 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { n++; sx0 += x; sy0 += y; }
  if (!n) return null;
  const side = Math.max(4, Math.round(THUMB_SPAN * Math.sqrt(n)));
  const left = Math.round(sx0 / n - side / 2), top = Math.round(sy0 / n - side / 2);
  const S = THUMB;
  const acc = new Float64Array(S * S * 4);
  const cnt = new Float64Array(S * S);
  for (let y = 0; y < side; y++) {
    const cy = Math.min(S - 1, Math.floor((y * S) / side));
    for (let x = 0; x < side; x++) {
      const cx = Math.min(S - 1, Math.floor((x * S) / side));
      const c = cy * S + cx;
      cnt[c]++;
      const sx = x + left, sy = y + top;
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      const i = sy * w + sx;
      if (!mask[i]) continue;
      const [r, g, b] = rgb(i);
      acc[c * 4] += r; acc[c * 4 + 1] += g; acc[c * 4 + 2] += b; acc[c * 4 + 3]++;
    }
  }
  const out = new Uint8Array(S * S * 4);
  for (let c = 0; c < S * S; c++) {
    const a = acc[c * 4 + 3];
    if (a) {
      out[c * 4] = Math.round(acc[c * 4] / a);
      out[c * 4 + 1] = Math.round(acc[c * 4 + 1] / a);
      out[c * 4 + 2] = Math.round(acc[c * 4 + 2] / a);
    }
    out[c * 4 + 3] = Math.round((255 * a) / Math.max(1, cnt[c]));
  }
  return out;
}

/** Miniatura de un sprite de referencia (PNG con transparencia). */
export function refThumbnail(img: Img): Uint8Array | null {
  const {width: w, height: h, data} = img;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return thumbnail(i => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], mask, w, h);
}

/** Miniatura del sprite dentro de una tarjeta rival. */
export function cardThumbnail(img: Img, card: Box): Uint8Array | null {
  const {width: W, data} = img;
  const x0 = card.x + Math.round(0.3 * card.h), x1 = Math.min(card.x + card.w, card.x + Math.round(1.62 * card.h));
  const y0 = card.y + 2, y1 = card.y + card.h - 2;
  const w = x1 - x0, h = y1 - y0;
  if (w <= 4 || h <= 4) return null;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * W + x0 + x) * 4;
    mask[y * w + x] = isRivalBg(data[i], data[i + 1], data[i + 2]) ? 0 : 1;
  }
  const clean = cleanMask(mask, w, h);
  return thumbnail(i => {
    const x = i % w, y = (i - x) / w;
    const j = ((y0 + y) * W + x0 + x) * 4;
    return [data[j], data[j + 1], data[j + 2]];
  }, clean, w, h);
}

/** Distancia entre miniaturas: (1 − IoU de silueta) + diferencia media de color. Admite espejo. */
export function thumbDistance(q: Uint8Array, r: Uint8Array): number {
  const S = THUMB;
  let best = Infinity;
  for (const mirror of [false, true]) {
    let inter = 0, union = 0, cd = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = (y * S + x) * 4, b = (y * S + (mirror ? S - 1 - x : x)) * 4;
      const qa = q[a + 3] / 255, ra = r[b + 3] / 255;
      const m = Math.min(qa, ra);
      inter += m; union += Math.max(qa, ra);
      if (m > 0) {
        const dr = q[a] - r[b], dg = q[a + 1] - r[b + 1], db = q[a + 2] - r[b + 2];
        cd += (m * Math.sqrt(dr * dr + dg * dg + db * db)) / 255;
      }
    }
    const d = (union ? 1 - inter / union : 1) + (inter ? cd / inter : 1);
    if (d < best) best = d;
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

/** Lee los iconos de tipo (1 o 2) de la tarjeta. Cadena vacía si no hay icono. */
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
    if (isRivalBg(c[0], c[1], c[2])) continue;
    let best = '', bd = Infinity;
    for (const [t, [r, g, b]] of Object.entries(TYPE_RGB)) {
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    if (bd < 70 ** 2) out.push(best);
  }
  return out;
}

/** Sexo según el icono ♂ (azul) / ♀ (rojo). '' si no aparece (sin sexo). */
export function cardGender(img: Img, card: Box): 'M' | 'F' | '' {
  const {x, y, h} = card;
  const px = regionPixels(img, x + 1.76 * h, y + 0.66 * h, x + 1.92 * h, y + 0.84 * h);
  const vivid = px.filter(([r, g, b]) => rgbToHsv(r, g, b)[1] > 0.5 && Math.max(r, g, b) > 170);
  if (vivid.length < px.length * 0.25) return '';
  const blue = vivid.filter(([r, , b]) => b > r + 60).length;
  const red = vivid.filter(([r, , b]) => r > b + 60).length;
  return blue > red * 2 ? 'M' : red > blue * 2 ? 'F' : '';
}

/* -------------------------------------------------------------- índice */

export type SpriteIndex = Record<string, Uint8Array>;

export function encodeThumb(t: Uint8Array): string {
  let s = '';
  for (const b of t) s += String.fromCharCode(b);
  return btoa(s);
}
export function decodeThumb(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface CardReading {
  box: Box;
  types: string[];
  gender: 'M' | 'F' | '';
  thumb: Uint8Array | null;
}

/** Lee todas las tarjetas del rival de una captura. */
export function readTeamPreview(img: Img): CardReading[] {
  return findRivalCards(img).map(box => ({
    box,
    types: cardTypes(img, box),
    gender: cardGender(img, box),
    thumb: cardThumbnail(img, box),
  }));
}
