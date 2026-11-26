import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildRival, plan} from '../src/lib/analysis';
import {battleTeam} from '../src/lib/sets';
import type {UsageFile} from '../src/lib/data';

const data = JSON.parse(readFileSync('public/data/usage.json', 'utf8')) as UsageFile;

const CASE_A = {
  rival: ['Archaludon', 'Indeedee-F', 'Swampert', 'Pelipper', 'Sableye', 'Basculegion'],
  own: [['Basculegion', 'Choice Scarf'], ['Garchomp', 'Life Orb'], ['Raichu', 'Raichunite X'], ['Pelipper', 'Focus Sash'], ['Archaludon', 'Leftovers'], ['Sneasler', 'Electric Seed']],
};
const CASE_B = {
  rival: ['Absol', 'Rillaboom', 'Incineroar', 'Gholdengo', 'Garchomp', 'Floette-Eternal'],
  own: [['Basculegion', 'Choice Scarf'], ['Rillaboom', 'Miracle Seed'], ['Garchomp', 'Garchompite Z'], ['Volcarona', 'Grassy Seed'], ['Kingambit', 'Focus Sash'], ['Milotic', 'Leftovers']],
};

function run(c: typeof CASE_A, key: string) {
  const ds = data.datasets[key];
  const rivals = c.rival.map(n => buildRival(n, ds));
  const my = battleTeam(c.own.map(([species, item]) => ({species, item})), [], ds);
  const p = plan(my, rivals, undefined, ds);
  const rn = (i: number) => rivals[i].set.species;
  const leads = p.prediction.leadPairs.map(l => l.pair.map(rn).sort().join(' + '));
  const bringOf = (name: string) => p.prediction.bring[rivals.findIndex(r => r.set.species === name)];
  const megaOf = (name: string) => p.prediction.mega.find(m => rn(m.index) === name)?.p ?? 0;
  return {p, my, rivals, leads, bringOf, megaOf, mine: (xs: number[]) => xs.map(i => my[i].species)};
}

for (const key of ['bo3', 'ladder']) {
  describe(`Predicción de leads (${key})`, () => {
    test('Caso A: lluvia, no Indeedee + Pelipper', () => {
      const {p, leads, bringOf, megaOf, mine} = run(CASE_A, key);
      expect(p.prediction.modes.primary).toBe('RAIN');
      expect(leads[0]).not.toBe('Indeedee-F + Pelipper');
      expect(p.prediction.leadPairs.find(l => l.pair.map(i => p.prediction.tags[i].species).sort().join(' + ') === 'Indeedee-F + Pelipper')!.p).toBeLessThan(0.05);
      // un colocador o beneficiario de lluvia en el lead más probable
      expect(leads[0]).toMatch(/Pelipper|Archaludon|Swampert/);
      expect(bringOf('Swampert-Mega')).toBeGreaterThan(bringOf('Sableye'));
      expect(megaOf('Swampert-Mega')).toBeGreaterThan(0.6);
      expect(mine(p.bring)).toContain('Pelipper');
    });
    test('Caso B: Fake Out + Floette-Mega, una sola Mega, Kingambit en tus 4', () => {
      const {p, leads, megaOf, mine, rivals} = run(CASE_B, key);
      expect(leads[0]).not.toBe('Incineroar + Rillaboom');
      expect(leads[0]).toMatch(/Floette-Mega/);
      expect(leads.slice(0, 3).filter(l => l.includes('Floette-Mega')).length).toBeGreaterThanOrEqual(2);
      expect(megaOf('Floette-Mega')).toBeGreaterThan(megaOf('Absol-Mega-Z'));
      expect(p.prediction.bring[rivals.findIndex(r => r.set.species === 'Absol-Mega-Z')]).toBeLessThan(0.4);
      expect(mine(p.bring)).toContain('Kingambit');
      // si Volcarona abre con Grassy Seed, alguien pone el campo de hierba
      if (mine(p.lead).includes('Volcarona')) expect(mine(p.lead)).toContain('Rillaboom');
    });
  });
}
