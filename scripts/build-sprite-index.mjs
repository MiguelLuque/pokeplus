// Genera las referencias para reconocer capturas de la pantalla de selección de equipo:
//   public/data/sprites.png  atlas de sprites de menú de Pokémon Champions (40×40 cada uno)
//   public/data/items.png    atlas de iconos de objeto (24×24 cada uno)
//   public/data/sprite-index.json  nombres (del calc) en el orden del atlas
//
// Uso: node scripts/build-sprite-index.mjs [carpeta del repositorio de sprites] [--soft]
// Sin carpeta, descarga los PNG de https://github.com/KevinToodlepoot/pokemon-champions-sprites
// (carpetas sprites/ e items/, nombres al estilo Showdown) en una versión fijada.
// Con --soft, si falla la descarga se conserva el índice existente.
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {Generations} from '@smogon/calc';
import {downsampleRGBA, SPRITE_N, ITEM_N} from '../src/lib/vision.ts';

const args = process.argv.slice(2);
const soft = args.includes('--soft');
const dir = args.find(a => !a.startsWith('--'));
const COMMIT = '4953be0b8f2eee5415255c4e0bb2bdec6065c75b';
const OUT = 'public/data';
const COLS = 16;

async function readPng(sub, file) {
  if (dir) {
    const f = path.join(dir, sub, `${file}.png`);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  }
  const url = `https://raw.githubusercontent.com/KevinToodlepoot/pokemon-champions-sprites/${COMMIT}/${sub}/${file}.png`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* reintento */ }
    await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
  }
  throw new Error(`No se pudo descargar ${url}`);
}

const gen = Generations.get(0);
const slug = s => s.toLowerCase().replace(/[’'.:]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
// nombre del calc → fichero del repositorio de sprites
const FILE = {
  'Indeedee-F': 'indeedee-female', 'Basculegion-F': 'basculegion-female', 'Meowstic-F': 'meowstic-female',
  'Aegislash-Shield': 'aegislash', 'Gourgeist-Super': 'gourgeist-jumbo',
  Maushold: 'maushold-three', 'Maushold-Four': 'maushold',
};
// formas que en la vista previa son idénticas a otra: se omiten para no duplicar
const SKIP = new Set(['Aegislash-Blade', 'Aegislash-Both', 'Mimikyu-Busted', 'Polteageist-Antique', 'Sinistcha-Masterpiece', 'Palafin-Hero', 'Morpeko-Hangry']);

/** Descarga y reduce cada imagen; devuelve [nombre, RGBA n×n] en orden alfabético. */
async function collect(sub, entries, n) {
  const got = [];
  const missing = [];
  for (let i = 0; i < entries.length; i += 16) {
    await Promise.all(entries.slice(i, i + 16).map(async ([name, file]) => {
      const buf = await readPng(sub, file);
      if (!buf) { missing.push(name); return; }
      got.push([name, downsampleRGBA(PNG.sync.read(buf), n)]);
    }));
  }
  got.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {got, missing};
}

function writeAtlas(file, got, n) {
  const rows = Math.ceil(got.length / COLS);
  const png = new PNG({width: COLS * n, height: rows * n});
  png.data.fill(0);
  got.forEach(([, px], k) => {
    const ox = (k % COLS) * n, oy = Math.floor(k / COLS) * n;
    for (let y = 0; y < n; y++) {
      Buffer.from(px.buffer, px.byteOffset + y * n * 4, n * 4).copy(png.data, ((oy + y) * png.width + ox) * 4);
    }
  });
  fs.writeFileSync(path.join(OUT, file), PNG.sync.write(png, {colorType: 6}));
  return {n, cols: COLS, file, names: got.map(g => g[0])};
}

try {
  const species = [...gen.species].filter(s => !/-Mega/.test(s.name) && !SKIP.has(s.name)).map(s => [s.name, FILE[s.name] ?? slug(s.name)]);
  const items = [...gen.items].map(i => [i.name, slug(i.name)]);
  const sp = await collect('sprites', species, SPRITE_N);
  const it = await collect('items', items, ITEM_N);
  fs.mkdirSync(OUT, {recursive: true});
  const index = {
    source: `https://github.com/KevinToodlepoot/pokemon-champions-sprites/tree/${COMMIT}`,
    sprites: writeAtlas('sprites.png', sp.got, SPRITE_N),
    items: writeAtlas('items.png', it.got, ITEM_N),
  };
  fs.writeFileSync(path.join(OUT, 'sprite-index.json'), JSON.stringify(index));
  console.log(`${sp.got.length} sprites y ${it.got.length} objetos indexados` +
    (sp.missing.length ? `; sin sprite: ${sp.missing.join(', ')}` : '') + (it.missing.length ? `; sin icono: ${it.missing.join(', ')}` : ''));
} catch (e) {
  if (soft && fs.existsSync(path.join(OUT, 'sprite-index.json')) && fs.existsSync(path.join(OUT, 'sprites.png'))) {
    console.warn(`Aviso: ${e.message}. Se mantiene el índice de sprites existente.`);
    process.exit(0);
  }
  throw e;
}
