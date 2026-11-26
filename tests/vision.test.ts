import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import {readRivalCards, readOwnCards, refsFromAtlas, type Img} from '../src/lib/vision';
import {analyzePreview, guessRival, guessOwn, type RefIndex} from '../src/lib/screen';
import type {UsageFile} from '../src/lib/data';

const data: UsageFile = JSON.parse(readFileSync('public/data/usage.json', 'utf8'));
const ds = data.datasets.bo3;
const load = (f: string): Img => PNG.sync.read(readFileSync(f));
const meta = JSON.parse(readFileSync('public/data/sprite-index.json', 'utf8'));
const atlas = (k: 'sprites' | 'items') => refsFromAtlas(load(`public/data/${meta[k].file}`), meta[k].names, meta[k].n, meta[k].cols);
const idx: RefIndex = {sprites: atlas('sprites'), items: atlas('items')};

/** Capturas reales de Miguel (nombres de usuario tapados), con lo que hay en pantalla. */
const SHOTS = [
  {
    file: 'tests/fixtures/team-preview-1.png',
    rival: ['Archaludon', 'Indeedee-F', 'Swampert', 'Pelipper', 'Sableye', 'Basculegion'],
    types: [['Steel', 'Dragon'], ['Psychic', 'Normal'], ['Water', 'Ground'], ['Water', 'Flying'], ['Dark', 'Ghost'], ['Water', 'Ghost']],
    gender: ['M', 'F', 'M', 'M', 'F', 'M'],
    own: ['Basculegion', 'Garchomp', 'Raichu', 'Pelipper', 'Archaludon', 'Sneasler'],
    items: ['Choice Scarf', 'Life Orb', 'Raichunite X', 'Focus Sash', 'Leftovers', 'Electric Seed'],
  },
  {
    file: 'tests/fixtures/team-preview-2.png',
    rival: ['Absol', 'Rillaboom', 'Incineroar', 'Gholdengo', 'Garchomp', 'Floette-Eternal'],
    types: [['Dark'], ['Grass'], ['Fire', 'Dark'], ['Steel', 'Ghost'], ['Dragon', 'Ground'], ['Fairy']],
    gender: ['M', 'M', 'M', '', 'M', 'F'],
    own: ['Basculegion', 'Rillaboom', 'Garchomp', 'Volcarona', 'Kingambit', 'Milotic'],
    items: ['Choice Scarf', 'Miracle Seed', 'Garchompite Z', 'Grassy Seed', 'Focus Sash', 'Leftovers'],
  },
];

/** Reduce la imagen a la mitad (promedio 2×2), como una captura de menos resolución. */
function half(img: Img): Img {
  const w = img.width >> 1, h = img.height >> 1, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const at = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + c];
    data[(y * w + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y + 1, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x + 1)) >> 2;
  }
  return {width: w, height: h, data};
}

for (const shot of SHOTS) {
  describe(`Captura ${shot.file.match(/\d/)![0]}`, () => {
    const img = load(shot.file);
    const rival = readRivalCards(img);
    const own = readOwnCards(img);

    test('encuentra las 6 tarjetas de cada equipo', () => {
      expect(rival).toHaveLength(6);
      expect(own).toHaveLength(6);
    });
    test('lee tipos y sexo del rival', () => {
      expect(rival.map(r => r.types)).toEqual(shot.types);
      expect(rival.map(r => r.gender)).toEqual(shot.gender);
    });
    test('identifica a los 6 del rival con seguridad', () => {
      const g = guessRival(rival, idx.sprites, ds);
      expect(g.map(s => s.species)).toEqual(shot.rival);
      for (const s of g) expect(s.confidence).toBeGreaterThan(0.5);
    });
    test('solo con el sprite (sin tipos ni sexo) también acierta los 6', () => {
      const g = guessRival(rival.map(r => ({...r, types: [], gender: '' as const})), idx.sprites);
      expect(g.map(s => s.species)).toEqual(shot.rival);
    });
    test('identifica tu equipo y sus objetos (incluidas megapiedras)', () => {
      const g = guessOwn(own, idx, ds);
      expect(g.map(s => s.species)).toEqual(shot.own);
      expect(g.map(s => s.item)).toEqual(shot.items);
    });
    test('a mitad de resolución sigue acertando', () => {
      const r = analyzePreview(half(img), idx, ds);
      expect(r.rival.map(s => s.species)).toEqual(shot.rival);
      expect(r.own.map(s => s.species)).toEqual(shot.own);
    });
  });
}

describe('Imagen que no es la pantalla de selección', () => {
  test('no inventa Pokémon', () => {
    const img = {width: 400, height: 300, data: new Uint8Array(400 * 300 * 4).fill(30)};
    const r = analyzePreview(img, idx, ds);
    expect(r.rival).toHaveLength(0);
    expect(r.own).toHaveLength(0);
  });
});
