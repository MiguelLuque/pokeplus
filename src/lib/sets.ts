import {gen, toID, speciesName, moveName, itemName, abilityName, type MonUsage, type Dataset} from './data';

export type StatID = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export const STATS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABEL: Record<StatID, string> = {
  hp: 'PS', atk: 'Ata', def: 'Def', spa: 'AtE', spd: 'DfE', spe: 'Vel',
};
export type StatTable = Record<StatID, number>;

/** Champions: máximo 32 SP por stat y 66 en total. */
export const SP_MAX = 32;
export const SP_TOTAL = 66;

export interface PokeSet {
  species: string;
  item: string;
  ability: string;
  nature: string;
  sp: StatTable;
  moves: string[];
  /** origen del set, para mostrar al usuario */
  origin?: 'usage' | 'paste' | 'manual';
}

export const emptySP = (): StatTable => ({hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0});

export function parseSpread(spread: string): {nature: string; sp: StatTable} {
  const [nature, nums] = spread.split(':');
  const v = (nums || '').split('/').map(n => parseInt(n, 10) || 0);
  const sp = emptySP();
  STATS.forEach((s, i) => (sp[s] = v[i] ?? 0));
  return {nature: nature || 'Serious', sp};
}

export function spreadLabel(spread: string) {
  const {nature, sp} = parseSpread(spread);
  const parts = STATS.filter(s => sp[s]).map(s => `${sp[s]} ${STAT_LABEL[s]}`);
  return `${nature} · ${parts.join(' / ') || 'sin SP'}`;
}

const isAttack = (m: string) => {
  const mv = gen.moves.get(toID(m) as never);
  return !!mv && mv.category !== 'Status';
};

export function defaultAbility(species: string) {
  const sp = gen.species.get(toID(species) as never);
  return (sp?.abilities as Record<string, string> | undefined)?.[0] ?? '';
}

/** Set más probable a partir de las estadísticas de uso. */
export function commonSet(species: string, u?: MonUsage): PokeSet {
  const name = speciesName(species) ?? species;
  if (!u) {
    return {
      species: name, item: '', ability: defaultAbility(name), nature: 'Serious',
      sp: emptySP(), moves: [], origin: 'usage',
    };
  }
  const {nature, sp} = u.spreads[0] ? parseSpread(u.spreads[0][0]) : {nature: 'Serious', sp: emptySP()};
  const item = u.items.find(i => i[0] !== 'nothing')?.[0];
  return {
    species: name,
    item: item ? itemName(item) : '',
    ability: u.abilities[0] ? abilityName(u.abilities[0][0]) : defaultAbility(name),
    nature,
    sp,
    moves: u.moves.filter(m => m[0] !== 'nothing').slice(0, 4).map(m => moveName(m[0])),
    origin: 'usage',
  };
}

/** Ataques ofensivos más usados (con su %), para cálculos de amenaza. */
export function commonAttacks(u: MonUsage | undefined, n = 6): [string, number][] {
  if (!u) return [];
  return u.moves.filter(m => isAttack(m[0])).slice(0, n).map(m => [moveName(m[0]), m[1]]);
}

export function attacksOf(set: PokeSet): string[] {
  return set.moves.filter(isAttack);
}

/** Si lleva su megapiedra, el Pokémon combate en su forma Mega. */
export function battleSpecies(set: PokeSet): string {
  const item = gen.items.get(toID(set.item) as never) as {megaStone?: Record<string, string>} | undefined;
  if (item?.megaStone) {
    const target = item.megaStone[set.species] ??
      Object.entries(item.megaStone).find(([from]) => toID(from) === toID(set.species))?.[1];
    if (target) return target;
  }
  return set.species;
}

export function battleAbility(set: PokeSet): string {
  const bs = battleSpecies(set);
  if (bs !== set.species) return defaultAbility(bs);
  return set.ability;
}

const STAT_ALIASES: Record<string, StatID> = {
  hp: 'hp', ps: 'hp', atk: 'atk', ata: 'atk', def: 'def', spa: 'spa', spatk: 'spa', ate: 'spa',
  spd: 'spd', spdef: 'spd', dfe: 'spd', spe: 'spe', vel: 'spe', speed: 'spe',
};

/**
 * Importa un equipo en formato de Showdown. Acepta "EVs:" o "SPs:"; si los
 * valores superan 32 se interpretan como EVs clásicos y se convierten (÷8).
 */
export function parsePaste(text: string): PokeSet[] {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out: PokeSet[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let [head, item = ''] = lines[0].split(' @ ');
    head = head.replace(/\((M|F)\)\s*$/, '').trim();
    // "Apodo (Especie)"
    const nick = /^(.*)\((.+)\)$/.exec(head);
    let species = nick ? nick[2].trim() : head;
    const resolved = speciesName(species);
    if (!resolved) continue;
    species = resolved;
    const set: PokeSet = {
      species, item: item.trim(), ability: defaultAbility(species), nature: 'Serious',
      sp: emptySP(), moves: [], origin: 'paste',
    };
    let raw: Partial<StatTable> = {};
    for (const line of lines.slice(1)) {
      if (/^ability:/i.test(line)) set.ability = line.split(':')[1].trim();
      else if (/^(evs|sps|stat points):/i.test(line)) {
        for (const part of line.split(':')[1].split('/')) {
          const m = /(\d+)\s*([a-z. ]+)/i.exec(part.trim());
          if (!m) continue;
          const st = STAT_ALIASES[toID(m[2])];
          if (st) raw[st] = parseInt(m[1], 10);
        }
      } else if (/nature$/i.test(line)) set.nature = line.replace(/nature/i, '').trim();
      else if (line.startsWith('-')) {
        const mv = line.slice(1).split('/')[0].trim();
        set.moves.push(gen.moves.get(toID(mv) as never)?.name ?? mv);
      }
    }
    const isEV = Object.values(raw).some(v => (v ?? 0) > SP_MAX);
    if (isEV) raw = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.min(SP_MAX, Math.floor(((v ?? 0) + 4) / 8))]));
    set.sp = {...emptySP(), ...raw};
    out.push(set);
  }
  return out;
}

export function exportSet(set: PokeSet): string {
  const sp = STATS.filter(s => set.sp[s]).map(s => `${set.sp[s]} ${{hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'}[s]}`);
  return [
    `${set.species}${set.item ? ` @ ${set.item}` : ''}`,
    `Ability: ${set.ability}`,
    sp.length ? `EVs: ${sp.join(' / ')}` : '',
    `${set.nature} Nature`,
    ...set.moves.map(m => `- ${m}`),
  ].filter(Boolean).join('\n');
}

/** Lista de nombres libre (una por línea o separados por comas). */
export function parseNameList(text: string): {found: string[]; unknown: string[]} {
  const parts = text.split(/[\n,;]+/).map(s => s.replace(/@.*/, '').trim()).filter(Boolean);
  const found: string[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const n = speciesName(p) ?? fuzzySpecies(p);
    if (n) { if (!found.includes(n)) found.push(n); } else unknown.push(p);
  }
  return {found, unknown};
}

export function levenshtein(a: string, b: string) {
  const dp = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

import {ALL_SPECIES} from './data';
const SPECIES_IDS = ALL_SPECIES.map(n => [toID(n), n] as const);

/** Mejor coincidencia aproximada (para OCR y erratas). */
export function fuzzySpecies(text: string, maxRatio = 0.34): string | undefined {
  const id = toID(text);
  if (id.length < 3) return undefined;
  let best: string | undefined;
  let bestScore = Infinity;
  for (const [sid, name] of SPECIES_IDS) {
    // las formas Mega solo si el texto las menciona
    if (/mega/.test(sid) && !/mega/.test(id)) continue;
    const d = levenshtein(id, sid) / Math.max(sid.length, id.length);
    if (d < bestScore) { bestScore = d; best = name; }
  }
  return bestScore <= maxRatio ? best : undefined;
}

export interface BattleMon {species: string; item: string}

/** Construye los sets de combate: tu set guardado si existe, si no el más usado, con el objeto de la captura. */
export function battleTeam(own: BattleMon[], myTeam: PokeSet[], ds: Dataset): PokeSet[] {
  return own.filter(o => o.species).map(o => {
    const mine = myTeam.find(s => toID(s.species) === toID(o.species));
    if (mine) return {...mine, item: o.item || mine.item};
    const stone = (gen.items.get(toID(o.item) as never) as {megaStone?: Record<string, string>} | undefined)?.megaStone;
    const mega = stone && Object.entries(stone).find(([from]) => toID(from) === toID(o.species))?.[1];
    const usage = (mega && ds.pokemon[mega]) || ds.pokemon[o.species];
    const set = commonSet(o.species, usage);
    return {...set, species: o.species, item: o.item || set.item};
  });
}

