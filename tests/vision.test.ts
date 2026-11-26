import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import {readTeamPreview, decodeThumb, type SpriteIndex} from '../src/lib/vision';
import {guessSlots} from '../src/lib/screen';
import type {UsageFile} from '../src/lib/data';

const data: UsageFile = JSON.parse(readFileSync('public/data/usage.json', 'utf8'));
const ds = data.datasets.bo3;
const index: SpriteIndex = Object.fromEntries(
  Object.entries((JSON.parse(readFileSync('public/data/sprite-index.json', 'utf8')) as {thumbs: Record<string, string>}).thumbs)
    .map(([k, v]) => [k, decodeThumb(v)])
);
const load = (f: string) => PNG.sync.read(readFileSync(f));

describe('Captura de la pantalla de selección (Champions, móvil)', () => {
  const img = load('tests/fixtures/team-preview-1.png');
  const readings = readTeamPreview(img);

  test('encuentra las 6 tarjetas del rival', () => {
    expect(readings).toHaveLength(6);
  });
  test('lee tipos y sexo de los iconos', () => {
    expect(readings.map(r => r.types)).toEqual([
      ['Steel', 'Dragon'], ['Psychic', 'Normal'], ['Water', 'Ground'], ['Water', 'Flying'], ['Dark', 'Ghost'], ['Water', 'Ghost'],
    ]);
    expect(readings.map(r => r.gender)).toEqual(['M', 'F', 'M', 'M', 'F', 'M']);
  });
  test('identifica los 6 Pokémon', () => {
    const g = guessSlots(readings, index, ds);
    expect(g.map(s => s.species)).toEqual(['Archaludon', 'Indeedee-F', 'Swampert', 'Pelipper', 'Sableye', 'Basculegion']);
    for (const s of g) expect(s.confidence).toBeGreaterThan(0.5);
  });
  test('sin tipos ni sexo, el sprite por sí solo acierta casi siempre', () => {
    const g = guessSlots(readings.map(r => ({...r, types: [], gender: '' as const})), index);
    const truth = ['Archaludon', 'Indeedee-F', 'Swampert', 'Pelipper', 'Sableye', 'Basculegion'];
    expect(g.filter((s, i) => s.species === truth[i]).length).toBeGreaterThanOrEqual(5);
    // y el correcto siempre está entre las alternativas que se ofrecen
    g.forEach((s, i) => expect(s.options.map(o => o.species)).toContain(truth[i]));
  });
});

/** Reduce la imagen a la mitad (promedio 2×2), como una captura de menos resolución. */
function half(img: {width: number; height: number; data: Uint8Array}) {
  const w = img.width >> 1, h = img.height >> 1, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const at = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + c];
    data[(y * w + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y + 1, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x + 1)) >> 2;
  }
  return {width: w, height: h, data};
}

describe('Captura a baja resolución (800 px de ancho)', () => {
  test('sigue identificando los 6', () => {
    const img = half(load('tests/fixtures/team-preview-1.png') as never);
    const g = guessSlots(readTeamPreview(img), index, ds);
    expect(g.map(s => s.species)).toEqual(['Archaludon', 'Indeedee-F', 'Swampert', 'Pelipper', 'Sableye', 'Basculegion']);
  });
});

describe('Imagen que no es la pantalla de selección', () => {
  test('no inventa Pokémon', () => {
    const img = {width: 400, height: 300, data: new Uint8Array(400 * 300 * 4).fill(30)};
    expect(readTeamPreview(img)).toHaveLength(0);
  });
});
