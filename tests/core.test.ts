import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import type {UsageFile} from '../src/lib/data';
import {commonSet, parsePaste, parseNameList, fuzzySpecies, type PokeSet} from '../src/lib/sets';
import {calcMove, statsOf, effectiveSpeed} from '../src/lib/damage';
import {plan, buildRival, resolveForms, suggest, vsMeta} from '../src/lib/analysis';

const data: UsageFile = JSON.parse(readFileSync('public/data/usage.json', 'utf8'));
const ds = Object.values(data.datasets)[0];

const set = (p: Partial<PokeSet> & {species: string}): PokeSet => ({
  item: '', ability: '', nature: 'Serious', moves: [], sp: {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0}, ...p,
});

describe('Fórmula de stats de Champions (nivel 50, Stat Points)', () => {
  test('PS = base + SP + 75; resto = floor(naturaleza × (base + SP + 20))', () => {
    const s = statsOf(set({species: 'Sneasler', nature: 'Adamant', sp: {hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32}}));
    // Sneasler: 80/130/60/40/80/120
    expect(s).toEqual({hp: 80 + 2 + 75, atk: Math.floor(1.1 * (130 + 32 + 20)), def: 80, spa: Math.floor(0.9 * 60), spd: 100, spe: 172});
  });
});

describe('Daño (mismo motor que la calculadora de Showdown)', () => {
  test('Sneasler Close Combat vs Incineroar coincide con la fórmula a mano', () => {
    const a = set({species: 'Sneasler', nature: 'Adamant', ability: 'Unburden', sp: {hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32}, moves: ['Close Combat']});
    const d = set({species: 'Incineroar', nature: 'Careful', ability: 'Intimidate', sp: {hp: 32, atk: 0, def: 2, spa: 0, spd: 32, spe: 0}});
    const r = calcMove(a, d, 'Close Combat')!;
    // base = floor(floor(22*120*200/112)/50)+2 = 96 → 81..96 → STAB ×1.5 → ×2 SE = 242..288
    expect([r.min, r.max]).toEqual([242, 288]);
    expect(r.hits).toBe(1);
    expect(r.chance).toBe(1);
  });
  test('ataques de área aplican ×0.75 y se pueden desactivar', () => {
    const a = set({species: 'Charizard-Mega-Y', nature: 'Modest', ability: 'Drought', sp: {hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32}});
    const d = set({species: 'Garchomp', sp: {hp: 2, atk: 0, def: 0, spa: 0, spd: 0, spe: 0}});
    const spread = calcMove(a, d, 'Heat Wave', {weather: 'Sun'})!;
    const single = calcMove(a, d, 'Heat Wave', {weather: 'Sun', spreadTargets: false})!;
    expect(spread.spread).toBe(true);
    expect(spread.max).toBeLessThan(single.max);
    expect(Math.abs(spread.max / single.max - 0.75)).toBeLessThan(0.03);
  });
  test('inmunidades devuelven 0 sin romper', () => {
    const r = calcMove(set({species: 'Sneasler', moves: []}), set({species: 'Gholdengo'}), 'Close Combat')!;
    expect(r.max).toBe(0);
    expect(r.hits).toBe(0);
  });
  test('la megapiedra transforma al Pokémon', () => {
    const base = set({species: 'Charizard', item: 'Charizardite Y', nature: 'Modest', sp: {hp: 0, atk: 0, def: 0, spa: 32, spd: 0, spe: 0}});
    expect(statsOf(base).spa).toBe(Math.floor(1.1 * (159 + 32 + 20)));
  });
  test('velocidad con Pañuelo y Nado Rápido', () => {
    const b = set({species: 'Basculegion', ability: 'Swift Swim', item: 'Choice Scarf', nature: 'Adamant', sp: {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 32}});
    expect(effectiveSpeed(b)).toBe(Math.floor(130 * 1.5));
    expect(effectiveSpeed(b, {weather: 'Rain'})).toBe(Math.floor(130 * 1.5) * 2);
  });
});

describe('Datos de uso', () => {
  test('formato de Champions con datos', () => {
    expect(data.format).toMatch(/^gen9championsvgc\d{4}reg/);
    expect(Object.keys(ds.pokemon).length).toBeGreaterThan(40);
    const s = ds.pokemon.Sneasler;
    expect(s.moves[0][1]).toBeGreaterThan(50);
    expect(s.spreads[0][0]).toMatch(/^[A-Z][a-z]+:\d+\/\d+\/\d+\/\d+\/\d+\/\d+$/);
  });
  test('formas Mega repartidas por uso', () => {
    const f = resolveForms('Garchomp', ds);
    expect(f.length).toBeGreaterThan(1);
    expect(f.reduce((a, b) => a + b.prob, 0)).toBeCloseTo(1, 5);
    expect(resolveForms('Floette', ds)[0].species).toBe('Floette-Mega');
  });
});

describe('Entrada', () => {
  test('lista de nombres con erratas', () => {
    const r = parseNameList('incineroar, Rilaboom\nsneasler; Kingambit, xxxx');
    expect(r.found).toEqual(['Incineroar', 'Rillaboom', 'Sneasler', 'Kingambit']);
    expect(r.unknown).toEqual(['xxxx']);
    expect(fuzzySpecies('Gholdenqo')).toBe('Gholdengo');
  });
  test('paste de Showdown (SP y EVs clásicos)', () => {
    const [a, b] = parsePaste(`Incineroar @ Sitrus Berry\nAbility: Intimidate\nEVs: 32 HP / 2 Atk / 32 SpD\nCareful Nature\n- Fake Out\n- Flare Blitz\n\nGarchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 4 Def / 252 Spe\nJolly Nature\n- Earthquake`);
    expect(a.sp).toEqual({hp: 32, atk: 2, def: 0, spa: 0, spd: 32, spe: 0});
    expect(a.moves).toEqual(['Fake Out', 'Flare Blitz']);
    expect(b.sp.atk).toBe(32);
    expect(b.sp.def).toBe(1);
  });
});

describe('Recomendaciones', () => {
  const rivals = ['Incineroar', 'Rillaboom', 'Sneasler', 'Kingambit', 'Charizard', 'Garchomp'].map(n => buildRival(n, ds));
  test('plan: 4 distintos, lead dentro de los 4', () => {
    const mine = ['Pelipper', 'Basculegion', 'Archaludon', 'Gholdengo', 'Farigiraf', 'Sinistcha']
      .map(n => commonSet(n, ds.pokemon[n]));
    mine[1] = {...mine[1], ability: 'Swift Swim'};
    const p = plan(mine, rivals);
    expect(new Set(p.bring).size).toBe(4);
    expect(p.lead.every(i => p.bring.includes(i))).toBe(true);
    expect(p.back.length).toBe(2);
    // lluvia: Pelipper + Basculegion con Nado Rápido
    expect(p.lead.map(i => mine[i].species).sort()).toEqual(['Basculegion', 'Pelipper']);
  });
  test('sugerencias y KO vs meta', () => {
    expect(suggest(rivals, ds).length).toBeGreaterThan(5);
    const rows = vsMeta(commonSet('Sneasler', ds.pokemon.Sneasler), ds, 20);
    expect(rows.find(r => r.species === 'Kingambit')!.best!.hits).toBe(1);
  });
});
