/**
 * Generalización: capturas sintéticas con TODOS los Pokémon del juego en el lado rival.
 *
 * Se parte de una captura real (fondo, tarjetas, rayos de luz), se borra el sprite de cada
 * tarjeta rival y se pinta encima el sprite original (120×120) de otra especie, en la
 * posición que usa el juego. Después se le aplican transformaciones de "otro móvil":
 * otra resolución, recorte 16:9, colores desplazados (como una captura Display P3) y ruido.
 * El reconocimiento tiene que acertar solo con el sprite (los tipos no se tocan, así que no
 * cuentan), igual que en una captura real.
 */
import {describe, expect, test} from 'vitest';
import {appendFileSync, readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import {readRivalCards, refsFromAtlas, RIVAL_SPRITE, type Img} from '../src/lib/vision';
import {guessRival} from '../src/lib/screen';

const load = (f: string): Img => PNG.sync.read(readFileSync(f));
const meta = JSON.parse(readFileSync('public/data/sprite-index.json', 'utf8'));
const refs = refsFromAtlas(load(`public/data/${meta.sprites.file}`), meta.sprites.names, meta.sprites.n, meta.sprites.cols);
const roster = load('tests/fixtures/roster.png');
const R = JSON.parse(readFileSync('tests/fixtures/roster.json', 'utf8')) as {n: number; cols: number; names: string[]};

test('el borde de las tarjetas rivales se detecta donde está', () => {
  for (const b of BASES) expect(readRivalCards(b.img).map(c => c.box.x)).toEqual(b.cards.map(c => c.x));
});

function clone(img: Img): Img {
  return {width: img.width, height: img.height, data: new Uint8Array(img.data)};
}

/** Muestra bilineal (alfa premultiplicado) del sprite k del roster en coordenadas fraccionarias. */
function rosterAt(k: number, u: number, v: number): [number, number, number, number] {
  const ox = (k % R.cols) * R.n, oy = Math.floor(k / R.cols) * R.n;
  const x = Math.min(R.n - 1, Math.max(0, u - 0.5)), y = Math.min(R.n - 1, Math.max(0, v - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(R.n - 1, x0 + 1), y1 = Math.min(R.n - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, out = [0, 0, 0, 0] as [number, number, number, number];
  for (const [xx, yy, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]]) {
    const i = ((oy + yy) * roster.width + ox + xx) * 4, a = roster.data[i + 3] / 255;
    out[0] += w * a * roster.data[i]; out[1] += w * a * roster.data[i + 1]; out[2] += w * a * roster.data[i + 2]; out[3] += w * a;
  }
  return out;
}

/** Sustituye los 6 sprites rivales de `base` por los de las especies `ks`. */
function withRivals(base: Img, cards: {x: number; y: number; h: number}[], ks: number[]): Img {
  const img = clone(base), {width: W, data} = img;
  cards.forEach(({x, y, h}, slot) => {
    const side = RIVAL_SPRITE.size * h;
    const sx = x + RIVAL_SPRITE.ox * h, sy = y + RIVAL_SPRITE.oy * h;
    // fondo de la tarjeta en cada fila: el del margen izquierdo, que es liso
    for (let py = Math.floor(sy); py < Math.ceil(sy + side); py++) {
      const bg = [0, 0, 0];
      let n = 0;
      for (let px = Math.round(x + 0.1 * h); px < Math.round(x + 0.4 * h); px++, n++)
        for (let c = 0; c < 3; c++) bg[c] += data[(py * W + px) * 4 + c];
      for (let px = Math.floor(sx); px < Math.ceil(sx + side); px++) {
        const u = ((px + 0.5 - sx) / side) * R.n, v = ((py + 0.5 - sy) / side) * R.n;
        const [r, g, b, a] = u >= 0 && v >= 0 && u < R.n && v < R.n ? rosterAt(ks[slot], u, v) : [0, 0, 0, 0];
        const i = (py * W + px) * 4;
        data[i] = r + (1 - a) * bg[0] / n; data[i + 1] = g + (1 - a) * bg[1] / n; data[i + 2] = b + (1 - a) * bg[2] / n;
      }
    }
  });
  return img;
}

/** Reescala a `w` de ancho (promedio de área, o bilineal al ampliar). */
function resize(img: Img, w: number): Img {
  const h = Math.round((img.height * w) / img.width), s = img.width / w, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xa = x * s, xb = xa + s, ya = y * s, yb = ya + s;
    const acc = [0, 0, 0];
    let t = 0;
    if (s >= 1) {
      for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) for (let xx = Math.floor(xa); xx < Math.ceil(xb); xx++) {
        const wt = (Math.min(yb, yy + 1) - Math.max(ya, yy)) * (Math.min(xb, xx + 1) - Math.max(xa, xx));
        const i = (Math.min(img.height - 1, yy) * img.width + Math.min(img.width - 1, xx)) * 4;
        for (let c = 0; c < 3; c++) acc[c] += wt * img.data[i + c];
        t += wt;
      }
    } else {
      const fx = Math.max(0, (x + 0.5) * s - 0.5), fy = Math.max(0, (y + 0.5) * s - 0.5);
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

/** Recorta los laterales (otra proporción de pantalla, p. ej. 16:9 en vez de 19.5:9). */
function cropSides(img: Img, w: number): Img {
  const x0 = (img.width - w) >> 1, data = new Uint8Array(w * img.height * 4);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray((y * img.width + x0) * 4, (y * img.width + x0 + w) * 4), y * w * 4);
  return {width: w, height: img.height, data};
}

/** Colores desplazados: más saturación y otra gamma (P3 → sRGB mal o bien convertido). */
function colorShift(img: Img, sat: number, gamma: number): Img {
  const out = clone(img), d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, 255 * ((l + sat * (d[i + c] - l)) / 255) ** gamma));
  }
  return out;
}

/** Ruido determinista ±amp (como compresión o un escalado de baja calidad). */
function noise(img: Img, amp: number): Img {
  const out = clone(img), d = out.data;
  let s = 12345;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i + c] = Math.max(0, Math.min(255, d[i + c] + ((s / 0x7fffffff) * 2 - 1) * amp));
  }
  return out;
}

const VARIANTS: [string, (img: Img) => Img][] = [
  ['captura de iPhone tal cual (1600 px)', img => img],
  ['móvil de baja resolución (1000 px)', img => resize(img, 1000)],
  ['captura grande sin reducir (2556 px)', img => resize(img, 2556)],
  ['pantalla 16:9', img => cropSides(img, 1312)],
  ['colores desplazados + ruido', img => noise(colorShift(img, 1.15, 0.92), 6)],
];

/**
 * Fondos reales. El borde izquierdo de las tarjetas rivales se fija a mano (medido en la
 * imagen): así el montaje no depende del detector que se está probando.
 */
const BASES = [
  {file: 'tests/fixtures/team-preview-3.png', x: 1210},
  {file: 'tests/fixtures/team-preview-1.png', x: 1210},
].map(b => {
  const img = load(b.file);
  return {img, cards: readRivalCards(img).map(c => ({x: b.x, y: c.box.y, h: c.box.h}))};
});

describe('Todos los Pokémon del juego, en capturas sintéticas', () => {
  for (const [label, transform] of VARIANTS) test(label, () => {
    const misses: string[] = [];
    let total = 0;
    // cada especie aparece una vez por variante, repartidas entre los fondos
    for (let k0 = 0, b = 0; k0 < R.names.length; k0 += 6, b++) {
      const base = BASES[b % BASES.length];
      const ks = [0, 1, 2, 3, 4, 5].map(j => (k0 + j) % R.names.length);
      const img = transform(withRivals(base.img, base.cards, ks));
      const cards = readRivalCards(img).map(r => ({...r, types: [], gender: '' as const}));
      expect(cards).toHaveLength(6);
      guessRival(cards, refs).forEach((g, j) => {
        total++;
        const want = R.names[ks[j]];
        if (g.species !== want) misses.push(`${want}→${g.species}`);
      });
    }
    // registro útil cuando algo falla
    if (process.env.ROSTER_LOG) appendFileSync(process.env.ROSTER_LOG, `${label}: ${misses.length}/${total} ${misses.join(', ')}\n`);
    expect(misses.length / total).toBeLessThanOrEqual(0.005);
  }, 60_000);
});
