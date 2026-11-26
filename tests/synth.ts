/**
 * Capturas sintéticas de la pantalla de selección de equipo, para probar el reconocimiento
 * con cualquier Pokémon y objeto del juego, en cualquier hueco, y con distintos móviles.
 *
 * Se parte de capturas reales (fondos, tarjetas, rayos de luz), se borra el sprite (y el icono
 * del objeto) de cada tarjeta y se pinta encima el original del Pokémon/objeto que se quiera,
 * en la posición que usa el juego. Las posiciones de las tarjetas de los fondos se fijan a
 * mano (medidas en la imagen) para no depender del detector que se está probando.
 */
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import jpeg from 'jpeg-js';
import {readRivalCards, readOwnCards, refsFromAtlas, RIVAL_SPRITE, OWN_SPRITE, OWN_ITEM, type Img} from '../src/lib/vision';
import type {RefIndex} from '../src/lib/screen';
import {gen, toID} from '../src/lib/data';

export const load = (f: string): Img => PNG.sync.read(readFileSync(f));

const meta = JSON.parse(readFileSync('public/data/sprite-index.json', 'utf8'));
const atlas = (k: 'sprites' | 'items') => refsFromAtlas(load(`public/data/${meta[k].file}`), meta[k].names, meta[k].n, meta[k].cols);
export const idx: RefIndex = {sprites: atlas('sprites'), items: atlas('items')};

interface Sheet {img: Img; n: number; cols: number; names: string[]}
const sheet = (f: string): Sheet => ({img: load(`tests/fixtures/${f}.png`), ...JSON.parse(readFileSync(`tests/fixtures/${f}.json`, 'utf8'))});
export const SPRITES = sheet('roster');
export const ITEMS = sheet('roster-items');

/** Dueño de cada megapiedra (para no ponerle una a quien no le corresponde). */
export function stoneOwner(item: string): string | undefined {
  const it = gen.items.get(toID(item) as never) as {megaStone?: Record<string, string>} | undefined;
  const owner = it?.megaStone && Object.keys(it.megaStone)[0];
  return owner && SPRITES.names.includes(owner) ? owner : undefined;
}

/* ------------------------------------------------------------- fondos reales */

interface CardPos {x: number; y: number; h: number}
export interface Base {name: string; img: Img; rival: CardPos[]; own: CardPos[]}

/** Borde izquierdo real de las columnas (medido en las capturas, iguales en las tres). */
const RIVAL_X = 1210, OWN_X = 196;

export const BASES: Base[] = [1, 2, 3].flatMap(i => ['', '-raw'].map(v => {
  const name = `captura ${i}${v ? ' sin convertir color' : ''}`;
  const img = load(`tests/fixtures/team-preview-${i}${v}.png`);
  return {
    name, img,
    rival: readRivalCards(img).map(c => ({x: RIVAL_X, y: c.box.y, h: c.box.h})),
    own: readOwnCards(img).map(c => ({x: OWN_X, y: c.box.y, h: c.box.h})),
  };
}));

/* ---------------------------------------------------------------- pintado */

export function clone(img: Img): Img {
  return {width: img.width, height: img.height, data: new Uint8Array(img.data)};
}

/** Muestra bilineal (alfa premultiplicado) de la celda k de una hoja, en coordenadas de celda. */
function sheetAt(s: Sheet, k: number, u: number, v: number): [number, number, number, number] {
  const ox = (k % s.cols) * s.n, oy = Math.floor(k / s.cols) * s.n;
  const x = Math.min(s.n - 1, Math.max(0, u - 0.5)), y = Math.min(s.n - 1, Math.max(0, v - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(s.n - 1, x0 + 1), y1 = Math.min(s.n - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, out: [number, number, number, number] = [0, 0, 0, 0];
  for (const [xx, yy, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]]) {
    const i = ((oy + yy) * s.img.width + ox + xx) * 4, a = s.img.data[i + 3] / 255;
    out[0] += w * a * s.img.data[i]; out[1] += w * a * s.img.data[i + 1]; out[2] += w * a * s.img.data[i + 2]; out[3] += w * a;
  }
  return out;
}

/**
 * Borra el cuadrado (sx, sy, side) rellenando cada fila con el color medio de la franja
 * [bx0, bx1) de esa misma fila (fondo liso), y pinta encima la celda k de la hoja.
 */
function paint(img: Img, s: Sheet, k: number, sx: number, sy: number, side: number, bx0: number, bx1: number) {
  const {width: W, height: H, data} = img;
  for (let py = Math.max(0, Math.floor(sy)); py < Math.min(H, Math.ceil(sy + side)); py++) {
    const vals: number[][] = [[], [], []];
    for (let px = Math.round(bx0); px < Math.round(bx1); px++) for (let c = 0; c < 3; c++) vals[c].push(data[(py * W + px) * 4 + c]);
    const bg = vals.map(v => v.sort((a, b) => a - b)[v.length >> 1]);
    for (let px = Math.max(0, Math.floor(sx)); px < Math.min(W, Math.ceil(sx + side)); px++) {
      const u = ((px + 0.5 - sx) / side) * s.n, v = ((py + 0.5 - sy) / side) * s.n;
      const [r, g, b, a] = u >= 0 && v >= 0 && u < s.n && v < s.n ? sheetAt(s, k, u, v) : [0, 0, 0, 0];
      const i = (py * W + px) * 4;
      data[i] = r + (1 - a) * bg[0]; data[i + 1] = g + (1 - a) * bg[1]; data[i + 2] = b + (1 - a) * bg[2];
    }
  }
}

/** Monta una captura: especies rivales, especies propias y objetos propios (índices de las hojas). */
export function compose(base: Base, rival: number[], own: number[], items: number[]): Img {
  const img = clone(base.img);
  base.rival.forEach(({x, y, h}, i) => {
    const P = RIVAL_SPRITE;
    paint(img, SPRITES, rival[i], x + P.ox * h, y + P.oy * h, P.size * h, x + 0.1 * h, x + 0.4 * h);
  });
  base.own.forEach(({x, y, h}, i) => {
    let P = OWN_SPRITE;
    paint(img, SPRITES, own[i], x + P.ox * h, y + P.oy * h, P.size * h, x + 4.0 * h, x + 4.22 * h);
    P = OWN_ITEM;
    paint(img, ITEMS, items[i], x + P.ox * h, y + P.oy * h, P.size * h, x + 3.3 * h, x + 3.6 * h);
  });
  return img;
}

/* ------------------------------------------------------ transformaciones */

/** Reescala a w×h (promedio de área al reducir, bilineal al ampliar). */
export function resize(img: Img, w: number, h = Math.round((img.height * w) / img.width)): Img {
  const sx = img.width / w, sy = img.height / h, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0];
    let t = 0;
    if (sx >= 1 && sy >= 1) {
      const xa = x * sx, xb = xa + sx, ya = y * sy, yb = ya + sy;
      for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) for (let xx = Math.floor(xa); xx < Math.ceil(xb); xx++) {
        const wt = (Math.min(yb, yy + 1) - Math.max(ya, yy)) * (Math.min(xb, xx + 1) - Math.max(xa, xx));
        const i = (Math.min(img.height - 1, yy) * img.width + Math.min(img.width - 1, xx)) * 4;
        for (let c = 0; c < 3; c++) acc[c] += wt * img.data[i + c];
        t += wt;
      }
    } else {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5), fy = Math.max(0, (y + 0.5) * sy - 0.5);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
      for (const [xx, yy, wt] of [[x0, y0, (1 - fx + x0) * (1 - fy + y0)], [x1, y0, (fx - x0) * (1 - fy + y0)], [x0, y1, (1 - fx + x0) * (fy - y0)], [x1, y1, (fx - x0) * (fy - y0)]]) {
        const i = (yy * img.width + xx) * 4;
        for (let c = 0; c < 3; c++) acc[c] += wt * img.data[i + c];
        t += wt;
      }
    }
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) data[o + c] = acc[c] / t;
    data[o + 3] = 255;
  }
  return {width: w, height: h, data};
}

/** Recorte rectangular. */
export function crop(img: Img, x0: number, y0: number, w: number, h: number): Img {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return {width: w, height: h, data};
}

/** Añade márgenes laterales (pantalla más alargada), repitiendo el color del borde. */
export function padSides(img: Img, w: number): Img {
  const p = (w - img.width) >> 1, data = new Uint8Array(w * img.height * 4);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.max(0, x - p)), i = (y * img.width + sx) * 4, o = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) data[o + c] = img.data[i + c];
  }
  return {width: w, height: img.height, data};
}

/** Pasa por JPEG con la calidad indicada (capturas de Switch, imágenes reenviadas…). */
export function viaJpeg(img: Img, quality: number): Img {
  const enc = jpeg.encode({width: img.width, height: img.height, data: Buffer.from(img.data)}, quality);
  const dec = jpeg.decode(enc.data, {useTArray: true});
  return {width: dec.width, height: dec.height, data: dec.data};
}

/** Colores desplazados: más saturación y otra gamma. */
export function colorShift(img: Img, sat: number, gamma: number): Img {
  const out = clone(img), d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, 255 * ((l + sat * (d[i + c] - l)) / 255) ** gamma));
  }
  return out;
}

/** Ruido determinista ±amp. */
export function noise(img: Img, amp: number, seed = 12345): Img {
  const out = clone(img), d = out.data;
  let s = seed;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i + c] = Math.max(0, Math.min(255, d[i + c] + ((s / 0x7fffffff) * 2 - 1) * amp));
  }
  return out;
}

/**
 * Rayos de luz: líneas diagonales rosas y blancas semitransparentes que cruzan la pantalla
 * pegadas a las tarjetas, como en el estadio. En el juego pasan por detrás de las tarjetas,
 * así que no se pintan dentro de `behind` (las cajas de las tarjetas y sus sprites).
 */
export function beams(img: Img, seed: number, count = 7, behind: {x0: number; y0: number; x1: number; y1: number}[] = []): Img {
  const out = clone(img), {width: W, height: H, data} = out;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < count; k++) {
    // pasa por un punto al azar, con preferencia cerca de las columnas de tarjetas
    const cx = (k % 2 ? 0.74 + 0.06 * rnd() : 0.08 + 0.3 * rnd()) * W, cy = rnd() * H;
    const ang = (0.25 + 0.5 * rnd()) * Math.PI * (rnd() < 0.5 ? 1 : -1);
    const nx = -Math.sin(ang), ny = Math.cos(ang), width = 1 + 3 * rnd(), alpha = 0.35 + 0.4 * rnd();
    const col = rnd() < 0.6 ? [255, 70 + 80 * rnd(), 200] : [255, 255, 255];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.abs((x - cx) * nx + (y - cy) * ny);
      if (d > width + 1) continue;
      if (behind.some(b => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1)) continue;
      const a = alpha * Math.max(0, Math.min(1, width + 1 - d));
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - a) + col[c] * a;
    }
  }
  return out;
}

/**
 * Lo que hace la app con la imagen: reducirla a ≤1600 px de ancho (blobToImage). Todas las
 * variantes terminan así, porque es lo que llega de verdad al reconocimiento.
 */
export const appScale = (img: Img) => (img.width > 1600 ? resize(img, 1600) : img);

/** Distintos dispositivos y situaciones. La captura base es de iPhone (19.5:9, 1600×738). */
/** Cajas que tapan los rayos: tarjetas rivales, tarjetas propias y sus sprites (que sobresalen). */
export function cardAreas(base: Base) {
  return [
    ...base.rival.map(({x, y, h}) => ({x0: x, y0: y, x1: x + 2.72 * h, y1: y + h})),
    ...base.own.map(({x, y, h}) => ({x0: x, y0: y - 0.06 * h, x1: x + 5.42 * h, y1: y + h})),
  ];
}

export const VARIANTS: {name: string; f: (img: Img, seed: number, base: Base) => Img}[] = [
  {name: 'iPhone (P3 convertido / sin convertir)', f: img => img},
  {name: 'Android 20:9 (2400×1080)', f: img => appScale(resize(padSides(img, 1640), 2400, 1080))},
  {name: 'Switch 16:9 (1280×720, JPEG)', f: img => viaJpeg(resize(crop(img, 144, 0, 1312, 738), 1280, 720), 85)},
  {name: 'iPhone antiguo 16:9 (1334×750)', f: img => resize(crop(img, 144, 0, 1312, 738), 1334, 750)},
  {name: 'Captura recortada por los bordes', f: img => crop(img, 40, 30, img.width - 70, img.height - 50)},
  {name: 'Reenviada (JPEG calidad 50)', f: img => viaJpeg(img, 50)},
  {name: 'Más rayos de luz (detrás de las tarjetas)', f: (img, seed, base) => beams(img, seed, 9, cardAreas(base))},
  {name: 'Colores desplazados + ruido', f: (img, seed) => noise(colorShift(img, 1.15, 0.92), 6, seed)},
  {name: 'Baja resolución (960×443)', f: img => resize(img, 960)},
];
