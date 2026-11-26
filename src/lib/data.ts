import {Generations} from '@smogon/calc';

/** Pokémon Champions en @smogon/calc es la "generación" 0. */
export const gen = Generations.get(0 as never);

export type Pair = [string, number];

export interface MonUsage {
  rank: number;
  usage: number; // % de equipos
  raw: number;
  abilities: Pair[];
  items: Pair[];
  moves: Pair[];
  spreads: Pair[]; // "Adamant:2/32/0/0/0/32"
  teammates: Pair[];
  checks: [string, number, number][]; // [nombre, score, n]
}

export interface Dataset {
  id: string;
  cutoff: number;
  battles: number;
  source: string;
  pokemon: Record<string, MonUsage>;
}

export interface UsageFile {
  generatedAt: string;
  month: string;
  format: string;
  regulation: string;
  datasets: Record<string, Dataset>;
}

export const toID = (s: string) => ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');

let cache: Promise<UsageFile> | null = null;
export function loadUsage(): Promise<UsageFile> {
  if (!cache) {
    cache = fetch('/data/usage.json').then(r => {
      if (!r.ok) throw new Error('No se pudieron cargar las estadísticas de uso');
      return r.json();
    });
  }
  return cache;
}

/** Todas las especies legales en Champions según el calc. */
export const ALL_SPECIES: string[] = (() => {
  const out: string[] = [];
  for (const s of gen.species) out.push(s.name);
  return out.sort();
})();

const speciesById = new Map(ALL_SPECIES.map(n => [toID(n), n]));
const ALIASES: Record<string, string> = {floette: 'Floette-Eternal', floetteeternal: 'Floette-Eternal'};
export const speciesName = (s: string) => {
  const id = toID(s);
  return speciesById.get(id) ?? (ALIASES[id] && speciesById.get(toID(ALIASES[id])));
};

export function moveName(id: string) {
  return gen.moves.get(toID(id) as never)?.name ?? id;
}
export function itemName(id: string) {
  if (id === 'nothing' || id === '') return 'Sin objeto';
  return gen.items.get(toID(id) as never)?.name ?? id;
}
export function abilityName(id: string) {
  return gen.abilities.get(toID(id) as never)?.name ?? id;
}

/** Nombre de sprite al estilo Showdown: "Charizard-Mega-Y" → "charizard-megay". */
export function spriteId(name: string) {
  const [head, ...rest] = name.split('-');
  return toID(head) + (rest.length ? '-' + toID(rest.join('')) : '');
}
export const spriteUrl = (name: string) => `https://play.pokemonshowdown.com/sprites/gen5/${spriteId(name)}.png`;
export const baseSpriteUrl = (name: string) => `https://play.pokemonshowdown.com/sprites/gen5/${toID(name.split('-')[0])}.png`;

export const TYPE_COLORS: Record<string, string> = {
  Normal: '#9fa19f', Fire: '#e62829', Water: '#2980ef', Electric: '#fac000', Grass: '#3fa129',
  Ice: '#3dcef3', Fighting: '#ff8000', Poison: '#9141cb', Ground: '#915121', Flying: '#81b9ef',
  Psychic: '#ef4179', Bug: '#91a119', Rock: '#afa981', Ghost: '#704170', Dragon: '#5060e1',
  Dark: '#624d4e', Steel: '#60a1b8', Fairy: '#ef70ef', Stellar: '#40b5a5', '???': '#68a090',
};

export const TYPE_ES: Record<string, string> = {
  Normal: 'Normal', Fire: 'Fuego', Water: 'Agua', Electric: 'Eléctrico', Grass: 'Planta', Ice: 'Hielo',
  Fighting: 'Lucha', Poison: 'Veneno', Ground: 'Tierra', Flying: 'Volador', Psychic: 'Psíquico',
  Bug: 'Bicho', Rock: 'Roca', Ghost: 'Fantasma', Dragon: 'Dragón', Dark: 'Siniestro', Steel: 'Acero',
  Fairy: 'Hada', Stellar: 'Astral', '???': '???',
};

export function typesOf(name: string): string[] {
  return (gen.species.get(toID(name) as never)?.types as string[] | undefined) ?? [];
}

/** Calendario oficial de regulaciones de Pokémon Champions (fuente: Victory Road). */
export const REGULATIONS = [
  {id: 'M-C', from: '2026-09-09', to: '2026-12-02'},
  {id: 'M-D', from: '2026-12-02', to: '2027-03-03'},
];
export function currentRegulation(now = new Date()) {
  const d = now.toISOString().slice(0, 10);
  return REGULATIONS.find(r => d >= r.from && d < r.to)?.id;
}
