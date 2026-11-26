// Genera public/data/sprite-index.json: miniaturas 16×16 de los sprites de menú de
// Pokémon Champions, para reconocer el equipo rival en capturas de la pantalla de selección.
//
// Uso: node scripts/build-sprite-index.mjs [carpeta con los PNG] [--soft]
// Sin carpeta, descarga los PNG de https://github.com/KevinToodlepoot/pokemon-champions-sprites
// (carpeta sprites/, nombres al estilo Showdown) en una versión fijada. Las imágenes no se publican:
// solo las miniaturas. Con --soft, si falla la descarga se conserva el índice existente.
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {Generations} from '@smogon/calc';
import {refThumbnail, encodeThumb, THUMB} from '../src/lib/vision.ts';

const args = process.argv.slice(2);
const soft = args.includes('--soft');
const dir = args.find(a => !a.startsWith('--'));
const COMMIT = '4953be0b8f2eee5415255c4e0bb2bdec6065c75b';
const OUT = 'public/data/sprite-index.json';

async function readSprite(file) {
  if (dir) {
    const f = path.join(dir, `${file}.png`);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  }
  const url = `https://raw.githubusercontent.com/KevinToodlepoot/pokemon-champions-sprites/${COMMIT}/sprites/${file}.png`;
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
  'Aegislash-Shield': 'aegislash', 'Aegislash-Both': 'aegislash', 'Gourgeist-Super': 'gourgeist-jumbo',
  Maushold: 'maushold-three', 'Maushold-Four': 'maushold', 'Mimikyu-Busted': 'mimikyu',
  'Polteageist-Antique': 'polteageist', 'Sinistcha-Masterpiece': 'sinistcha',
};
// formas que en la vista previa son idénticas a otra: se omiten para no duplicar
const SKIP = new Set(['Aegislash-Blade', 'Aegislash-Both', 'Mimikyu-Busted', 'Polteageist-Antique', 'Sinistcha-Masterpiece', 'Palafin-Hero', 'Morpeko-Hangry']);

const thumbs = {};
const missing = [];
const todo = [...gen.species].filter(s => !/-Mega/.test(s.name) && !SKIP.has(s.name));
try {
  for (let i = 0; i < todo.length; i += 16) {
    await Promise.all(todo.slice(i, i + 16).map(async s => {
      const buf = await readSprite(FILE[s.name] ?? slug(s.name));
      if (!buf) { missing.push(s.name); return; }
      const t = refThumbnail(PNG.sync.read(buf));
      if (t) thumbs[s.name] = encodeThumb(t);
    }));
  }
} catch (e) {
  if (soft && fs.existsSync(OUT)) {
    console.warn(`Aviso: ${e.message}. Se mantiene el índice de sprites existente.`);
    process.exit(0);
  }
  throw e;
}
// orden estable para que el fichero no cambie sin motivo
const sorted = Object.fromEntries(Object.keys(thumbs).sort().map(k => [k, thumbs[k]]));
const out = {size: THUMB, source: `https://github.com/KevinToodlepoot/pokemon-champions-sprites/tree/${COMMIT}`, thumbs: sorted};
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${Object.keys(sorted).length} sprites indexados${missing.length ? `; sin sprite: ${missing.join(', ')}` : ''}`);
