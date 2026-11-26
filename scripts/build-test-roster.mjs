// Genera tests/fixtures/roster.png (sprites originales 120×120 de todas las especies del atlas)
// y tests/fixtures/roster-items.png (iconos originales reducidos a 64×64 de todos los objetos), en el mismo
// orden que public/data/sprite-index.json. Los usa tests/synth.ts para fabricar capturas
// sintéticas con cualquier Pokémon y objeto del juego.
//
// Uso: node scripts/build-test-roster.mjs <carpeta del repositorio pokemon-champions-sprites>
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {downsampleRGBA} from '../src/lib/vision.ts';

const dir = process.argv[2];
if (!dir) throw new Error('Indica la carpeta del repositorio de sprites');
const meta = JSON.parse(fs.readFileSync('public/data/sprite-index.json', 'utf8'));
const slug = s => s.toLowerCase().replace(/[’'.:]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
const FILE = {
  'Indeedee-F': 'indeedee-female', 'Basculegion-F': 'basculegion-female', 'Meowstic-F': 'meowstic-female',
  'Aegislash-Shield': 'aegislash', 'Gourgeist-Super': 'gourgeist-jumbo',
  Maushold: 'maushold-three', 'Maushold-Four': 'maushold',
};
const COLS = 16;
function sheet(sub, names, N, file, fname) {
  const out = new PNG({width: COLS * N, height: Math.ceil(names.length / COLS) * N});
  out.data.fill(0);
  names.forEach((name, k) => {
    let src = PNG.sync.read(fs.readFileSync(path.join(dir, sub, `${fname(name)}.png`)));
    if (src.width !== N || src.height !== N) src = {width: N, height: N, data: Buffer.from(downsampleRGBA(src, N))};
    const ox = (k % COLS) * N, oy = Math.floor(k / COLS) * N;
    for (let y = 0; y < N; y++) src.data.copy(out.data, ((oy + y) * out.width + ox) * 4, y * N * 4, (y + 1) * N * 4);
  });
  fs.writeFileSync(`tests/fixtures/${file}.png`, PNG.sync.write(out, {colorType: 6}));
  fs.writeFileSync(`tests/fixtures/${file}.json`, JSON.stringify({n: N, cols: COLS, names}));
  console.log(`${file}: ${names.length}`);
}
sheet('sprites', meta.sprites.names, 120, 'roster', name => FILE[name] ?? slug(name));
sheet('items', meta.items.names, 64, 'roster-items', slug);
