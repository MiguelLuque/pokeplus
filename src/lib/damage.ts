import {calculate, Pokemon, Move, Field, type Result} from '@smogon/calc';
import {gen, toID} from './data';
import {battleSpecies, battleAbility, type PokeSet, type StatTable, emptySP} from './sets';

export interface Boosts {atk: number; def: number; spa: number; spd: number; spe: number}
export const noBoosts = (): Boosts => ({atk: 0, def: 0, spa: 0, spd: 0, spe: 0});

export interface SideOpts {
  reflect?: boolean;
  lightScreen?: boolean;
  auroraVeil?: boolean;
  helpingHand?: boolean;
  friendGuard?: boolean;
  tailwind?: boolean;
}

export interface FieldOpts {
  weather?: '' | 'Sun' | 'Rain' | 'Sand' | 'Snow';
  terrain?: '' | 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  attacker?: SideOpts;
  defender?: SideOpts;
  /** false = el ataque de área golpea a un único objetivo */
  spreadTargets?: boolean;
}

export interface CalcOpts {
  attackerBoosts?: Partial<Boosts>;
  defenderBoosts?: Partial<Boosts>;
  crit?: boolean;
  /** % de PS actuales del defensor (100 = lleno) */
  defenderHP?: number;
  /** usar la forma Mega si lleva la piedra (por defecto sí) */
  mega?: boolean;
}

const cleanItem = (it: string) => (it && gen.items.get(toID(it) as never) ? it : undefined);
const cleanAbility = (ab: string) => (ab && gen.abilities.get(toID(ab) as never) ? ab : undefined);

export function makePokemon(set: PokeSet, boosts?: Partial<Boosts>, hpPct = 100, mega = true) {
  const species = mega ? battleSpecies(set) : set.species;
  const ability = mega ? battleAbility(set) : set.ability;
  const p = new Pokemon(gen, species, {
    item: cleanItem(set.item) as never,
    ability: cleanAbility(ability) as never,
    nature: set.nature as never,
    evs: {...emptySP(), ...set.sp},
    boosts: {...boosts},
  });
  if (hpPct < 100) p.originalCurHP = Math.max(1, Math.floor((p.maxHP() * hpPct) / 100));
  return p;
}

export function makeField(f: FieldOpts = {}) {
  return new Field({
    gameType: 'Doubles',
    weather: (f.weather || undefined) as never,
    terrain: (f.terrain || undefined) as never,
    attackerSide: {
      isReflect: f.attacker?.reflect, isLightScreen: f.attacker?.lightScreen, isAuroraVeil: f.attacker?.auroraVeil,
      isHelpingHand: f.attacker?.helpingHand, isFriendGuard: f.attacker?.friendGuard, isTailwind: f.attacker?.tailwind,
    },
    defenderSide: {
      isReflect: f.defender?.reflect, isLightScreen: f.defender?.lightScreen, isAuroraVeil: f.defender?.auroraVeil,
      isHelpingHand: f.defender?.helpingHand, isFriendGuard: f.defender?.friendGuard, isTailwind: f.defender?.tailwind,
    },
  });
}

export interface DamageSummary {
  move: string;
  type: string;
  category: string;
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  /** nº de golpes para KO (1 = OHKO); 0 si no hace daño */
  hits: number;
  /** probabilidad de KO en `hits` golpes */
  chance: number;
  koText: string;
  desc: string;
  spread: boolean;
}

/** Ataques de área que en dobles reciben el x0.75. */
export function isSpreadMove(name: string) {
  const mv = gen.moves.get(toID(name) as never) as {target?: string} | undefined;
  return mv?.target === 'allAdjacentFoes' || mv?.target === 'allAdjacent';
}

export function calcMove(
  attacker: PokeSet, defender: PokeSet, move: string, field: FieldOpts = {}, opts: CalcOpts = {}
): DamageSummary | null {
  const mv0 = gen.moves.get(toID(move) as never);
  if (!mv0 || mv0.category === 'Status') return null;
  const a = makePokemon(attacker, opts.attackerBoosts, 100, opts.mega !== false);
  const d = makePokemon(defender, opts.defenderBoosts, opts.defenderHP ?? 100, opts.mega !== false);
  const mv = new Move(gen, mv0.name, {
    isCrit: opts.crit, ability: a.ability, item: a.item, species: a.name,
    overrides: field.spreadTargets === false ? {target: 'normal'} : undefined,
  } as never);
  let r: Result;
  try {
    r = calculate(gen, a, d, mv, makeField(field));
  } catch {
    return null;
  }
  return summarize(r, mv0.name, d.maxHP());
}

function summarize(r: Result, move: string, maxHP: number): DamageSummary {
  const [min, max] = r.range();
  let hits = 0, chance = 0, koText = '';
  if (max > 0) {
    try {
      const ko = r.kochance(false);
      hits = ko.n || Math.ceil(r.defender.curHP() / Math.max(1, max));
      chance = ko.chance ?? 0;
      koText = ko.text;
    } catch {
      hits = Math.ceil(r.defender.curHP() / Math.max(1, max));
    }
    if (!hits) hits = Math.ceil(r.defender.curHP() / Math.max(1, max));
  }
  let desc = '';
  if (max > 0) { try { desc = r.fullDesc('%', false); } catch { desc = ''; } }
  else desc = `${r.attacker.name} ${move} → ${r.defender.name}: sin efecto`;
  return {
    move,
    type: r.move.type,
    category: r.move.category,
    min, max,
    minPct: Math.round((min / maxHP) * 1000) / 10,
    maxPct: Math.round((max / maxHP) * 1000) / 10,
    hits, chance, koText, desc,
    spread: isSpreadMove(move),
  };
}

export function statsOf(set: PokeSet, mega = true): StatTable {
  const p = makePokemon(set, undefined, 100, mega);
  return {...p.stats} as StatTable;
}

/** Velocidad efectiva con objeto/habilidad/clima/viento afín. */
export function effectiveSpeed(set: PokeSet, opts: {tailwind?: boolean; weather?: string; boost?: number} = {}) {
  const p = makePokemon(set, {spe: opts.boost ?? 0});
  let s = p.stats.spe;
  const b = opts.boost ?? 0;
  if (b) s = Math.floor(s * (b > 0 ? (2 + b) / 2 : 2 / (2 - b)));
  if (toID(set.item) === 'choicescarf') s = Math.floor(s * 1.5);
  const ab = toID(p.ability ?? '');
  const w = opts.weather;
  if ((ab === 'swiftswim' && w === 'Rain') || (ab === 'chlorophyll' && w === 'Sun') ||
      (ab === 'sandrush' && w === 'Sand') || (ab === 'slushrush' && w === 'Snow')) s *= 2;
  if (opts.tailwind) s *= 2;
  return s;
}

/** Etiqueta corta en castellano para el nº de golpes. */
export function koLabel(d: Pick<DamageSummary, 'hits' | 'chance'>) {
  if (!d.hits) return '—';
  const base = d.hits === 1 ? 'OHKO' : `${d.hits}HKO`;
  if (d.chance > 0 && Math.round(d.chance * 100) < 100) return `${Math.round(d.chance * 100)}% ${base}`;
  return base;
}
