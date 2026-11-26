// Genera tests/fixtures/roster.png: los sprites originales (120×120) de todas las especies del
// atlas de reconocimiento, en el mismo orden que public/data/sprite-index.json. Lo usa
// tests/roster.test.ts para fabricar capturas sintéticas con cualquier Pokémon del juego.
//
// Uso: node scripts/build-test-roster.mjs <carpeta del repositorio pokemon-champions-sprites>
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';

const dir = process.argv[2];
if (!dir) throw new Error('Indica la carpeta del repositorio de sprites');
const meta = JSON.parse(fs.readFileSync('public/data/sprite-index.json', 'utf8'));
const slug = s => s.toLowerCase().replace(/[’'.:]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
const FILE = {
  'Indeedee-F': 'indeedee-female', 'Basculegion-F': 'basculegion-female', 'Meowstic-F': 'meowstic-female',
  'Aegislash-Shield': 'aegislash', 'Gourgeist-Super': 'gourgeist-jumbo',
  Maushold: 'maushold-three', 'Maushold-Four': 'maushold',
};
const N = 120, COLS = 16, names = meta.sprites.names;
const out = new PNG({width: COLS * N, height: Math.ceil(names.length / COLS) * N});
out.data.fill(0);
names.forEach((name, k) => {
  const src = PNG.sync.read(fs.readFileSync(path.join(dir, 'sprites', `${FILE[name] ?? slug(name)}.png`)));
  if (src.width !== N || src.height !== N) throw new Error(`${name}: ${src.width}×${src.height}`);
  const ox = (k % COLS) * N, oy = Math.floor(k / COLS) * N;
  for (let y = 0; y < N; y++) src.data.copy(out.data, ((oy + y) * out.width + ox) * 4, y * N * 4, (y + 1) * N * 4);
});
fs.writeFileSync('tests/fixtures/roster.png', PNG.sync.write(out, {colorType: 6}));
fs.writeFileSync('tests/fixtures/roster.json', JSON.stringify({n: N, cols: COLS, names}));
console.log(`${names.length} sprites`);
