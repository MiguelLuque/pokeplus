/**
 * Generalización: capturas sintéticas (ver synth.ts) con TODOS los Pokémon y objetos del
 * juego, en todos los huecos, sobre fondos reales y con varios "móviles". Es la versión
 * rápida de tests/matrix.test.ts (la matriz completa se lanza con MATRIX=1).
 *
 * El rival se reconoce solo por el sprite: los iconos de tipo y sexo de los fondos son los
 * del Pokémon original de la captura (en una captura real coinciden y ayudan).
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {guessRival, guessOwn} from '../src/lib/screen';
import {readRivalCards, readOwnCards, samplePatch, RIVAL_SPRITE, SPRITE_N, WIDE, isRivalBg, type Img} from '../src/lib/vision';
import type {UsageFile} from '../src/lib/data';
import {BASES, VARIANTS, SPRITES, ITEMS, idx, compose, stoneOwner, type Base} from './synth';

const ds = (JSON.parse(readFileSync('public/data/usage.json', 'utf8')) as UsageFile).datasets.bo3;
const NS = SPRITES.names.length, NI = ITEMS.names.length;

test('el borde de las tarjetas se detecta donde está en todos los fondos', () => {
  for (const b of BASES) {
    expect(readRivalCards(b.img).map(c => c.box.x), b.name).toEqual(b.rival.map(c => c.x));
    expect(readOwnCards(b.img).map(c => c.box.x), b.name).toEqual(b.own.map(c => c.x));
  }
});

interface Tally {rival: string[]; own: string[]; item: string[]; total: number; items: number}

/**
 * Pasa `species` (índices) por las 6 tarjetas de cada lado, de 6 en 6, rotando fondos y
 * huecos, con los objetos `items` en tu equipo (una megapiedra la lleva su dueño).
 */
function run(species: number[], items: number[], transform: (img: Img, seed: number, base: Base) => Img): Tally {
  const t: Tally = {rival: [], own: [], item: [], total: 0, items: 0};
  for (let s = 0, shot = 0; s < Math.max(species.length, items.length); s += 6, shot++) {
    const base = BASES[shot % BASES.length];
    const rot = shot % 6;
    const rival = [0, 1, 2, 3, 4, 5].map(j => species[(s + ((j + rot) % 6)) % species.length]);
    const its = [0, 1, 2, 3, 4, 5].map(j => items[(s + j) % items.length]);
    const own = its.map((it, j) => {
      const owner = stoneOwner(ITEMS.names[it]);
      return owner ? SPRITES.names.indexOf(owner) : species[(s + 3 + ((j + rot) % 6)) % species.length];
    });
    const img = transform(compose(base, rival, own, its), shot + 1, base);
    const r = guessRival(readRivalCards(img).map(c => ({...c, types: [], gender: '' as const})), idx.sprites, ds);
    const o = guessOwn(readOwnCards(img), idx, ds);
    expect(r).toHaveLength(6);
    expect(o).toHaveLength(6);
    r.forEach((g, j) => { if (g.species !== SPRITES.names[rival[j]]) t.rival.push(`${SPRITES.names[rival[j]]}→${g.species}`); });
    o.forEach((g, j) => {
      if (g.species !== SPRITES.names[own[j]]) t.own.push(`${SPRITES.names[own[j]]}→${g.species}`);
      if (g.item !== ITEMS.names[its[j]]) t.item.push(`${ITEMS.names[its[j]]}→${g.item}`);
    });
    t.total += 6; t.items += 6;
  }
  return t;
}

const ALL = [...Array(NS).keys()], ALL_ITEMS = [...Array(NI).keys()];
const every = (xs: number[], k: number, off = 0) => xs.filter((_, i) => i % k === off);

describe('Todos los Pokémon y objetos del juego', () => {
  test('captura de iPhone: los 270 Pokémon en ambos lados y los 166 objetos, sin fallos', () => {
    const t = run(ALL, ALL_ITEMS, img => img);
    expect(t.rival).toEqual([]);
    expect(t.own).toEqual([]);
    expect(t.item).toEqual([]);
  }, 120_000);

  for (const name of ['Switch 16:9 (1280×720, JPEG)', 'Reenviada (JPEG calidad 50)', 'Baja resolución (960×443)']) {
    test(`${name}: muestra de 1 de cada 4`, () => {
      const v = VARIANTS.find(x => x.name === name)!;
      const t = run(every(ALL, 4, 1), every(ALL_ITEMS, 4, 2), v.f);
      // como mucho un fallo por cada 100 lecturas en cada lado
      expect(t.rival.length, t.rival.join(', ')).toBeLessThanOrEqual(t.total / 100);
      expect(t.own.length, t.own.join(', ')).toBeLessThanOrEqual(t.total / 100);
      expect(t.item.length, t.item.join(', ')).toBeLessThanOrEqual(t.items / 50);
    }, 120_000);
  }
});

describe('Cuando algo no cuadra', () => {
  const real = BASES.find(b => b.name === 'captura 3')!;
  const want = ['Gengar', 'Incineroar', 'Rillaboom', 'Pawmot', 'Sylveon', 'Salamence'];

  test('tarjetas mal situadas 15 px (el fallo de la captura 3): se corrige solo', () => {
    const shifted = readRivalCards(real.img).map(c => {
      const box = {...c.box, x: c.box.x - 15};
      return {...c, box, sprite: samplePatch(real.img, box, RIVAL_SPRITE, SPRITE_N, WIDE, isRivalBg)};
    });
    expect(guessRival(shifted, idx.sprites, ds).map(g => g.species)).toEqual(want);
  }, 30_000);

  test('un recorte sin Pokémon (fondo de la pantalla) sale como dudoso, no como acierto seguro', () => {
    const fake = readRivalCards(real.img).map(c => {
      const box = {...c.box, x: 650, y: c.box.y + 40}; // centro de la pantalla: texto y fondo
      return {...c, types: [], gender: '' as const, box, sprite: samplePatch(real.img, box, RIVAL_SPRITE, SPRITE_N, WIDE, isRivalBg)};
    });
    for (const g of guessRival(fake, idx.sprites, ds)) expect(g.confidence, g.species).toBeLessThan(0.5);
  }, 30_000);

  test('si los tipos leídos no son los de la especie elegida, sale como dudoso', () => {
    const cards = readRivalCards(real.img).map(c => ({...c, types: ['Bug', 'Steel']}));
    for (const g of guessRival(cards, idx.sprites, ds)) expect(g.confidence).toBeLessThan(0.5);
  }, 30_000);
});
