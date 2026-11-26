/**
 * Predicción de lead y de los 4 del rival (fase 0 del informe de investigación).
 *
 * 1. Etiquetas de rol *blandas* sacadas de los % de movimientos/habilidades de Smogon
 *    (un Indeedee-F con Trick Room al 72 % es colocador de TR con peso 0,72).
 * 2. Modos de equipo (lluvia, sol, Trick Room, Tailwind…) con un principal y un secundario.
 * 3. Las 90 opciones lead + atrás se puntúan con priors de Smogon (lead/equipo y Real/Raw),
 *    una tabla de compatibilidad de roles, el modo, la coherencia del cuatro y una sola Mega.
 * 4. softmax → marginales: parejas de lead, P(lo trae), P(Mega).
 */
import {gen, toID, type Dataset, type MonUsage} from './data';
import {battleSpecies, type PokeSet} from './sets';

export type Mode = 'RAIN' | 'SUN' | 'SAND' | 'SNOW' | 'TRICK_ROOM' | 'TAILWIND'
  | 'PSYCHIC_TERRAIN' | 'GRASSY_TERRAIN' | 'ELECTRIC_TERRAIN' | 'MISTY_TERRAIN';
export const ALL_MODES: Mode[] = ['RAIN', 'SUN', 'SAND', 'SNOW', 'TRICK_ROOM', 'TAILWIND',
  'PSYCHIC_TERRAIN', 'GRASSY_TERRAIN', 'ELECTRIC_TERRAIN', 'MISTY_TERRAIN'];
/** Modos incompatibles entre sí (no se abre con dos habilitadores de modos distintos). */
const EXCLUSIVE: Mode[] = ['RAIN', 'SUN', 'SAND', 'SNOW', 'TRICK_ROOM', 'PSYCHIC_TERRAIN', 'ELECTRIC_TERRAIN', 'MISTY_TERRAIN'];
/** El terreno de hierba de Rillaboom es una capa de apoyo omnipresente, no un arquetipo. */
const NOT_ARCHETYPE: Mode[] = ['GRASSY_TERRAIN'];

export const MODE_ES: Record<Mode, string> = {
  RAIN: 'lluvia', SUN: 'sol', SAND: 'arena', SNOW: 'nieve', TRICK_ROOM: 'Trick Room', TAILWIND: 'Tailwind',
  PSYCHIC_TERRAIN: 'campo psíquico', GRASSY_TERRAIN: 'campo de hierba', ELECTRIC_TERRAIN: 'campo eléctrico',
  MISTY_TERRAIN: 'campo de niebla',
};

export interface Tags {
  species: string;
  fakeOut: number; redirect: number; intimidate: number; pivot: number; screens: number; setup: number;
  sets: Partial<Record<Mode, number>>;
  abuses: Partial<Record<Mode, number>>;
  /** depende del modo para funcionar (Nado Rápido sin lluvia…) */
  dep: Partial<Record<Mode, number>>;
  offense: number;
  support: number;
  speed: number;
  /** lleva megapiedra (y la forma Mega es la que combate) */
  mega: boolean;
  physical: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const gate = (x: number, th: number) => clamp01((x - th + 0.15) / 0.3);

interface Src {m(id: string): number; a(id: string): number; it(id: string): number}

export function srcFromUsage(u: MonUsage | undefined): Src {
  const get = (list: [string, number][] | undefined, id: string) => (list?.find(x => x[0] === id)?.[1] ?? 0) / 100;
  return {m: id => get(u?.moves, id), a: id => get(u?.abilities, id), it: id => get(u?.items, id)};
}
export function srcFromSet(set: PokeSet): Src {
  const moves = new Set(set.moves.map(toID));
  return {m: id => (moves.has(id) ? 1 : 0), a: id => (toID(set.ability) === id ? 1 : 0), it: id => (toID(set.item) === id ? 1 : 0)};
}

interface MoveInfo {type?: string; category?: string; basePower?: number}
const moveInfo = (id: string) => gen.moves.get(id as never) as MoveInfo | undefined;

/** Fracción de ataques reales (sin Fake Out) entre los 4 movimientos, y de qué tipo. */
function attackProfile(moves: [string, number][]) {
  let atk = 0, phys = 0, water = 0, fire = 0;
  for (const [id, p] of moves) {
    if (id === 'fakeout') continue;
    const mv = moveInfo(id);
    if (!mv || mv.category === 'Status' || (mv.basePower ?? 0) < 40) continue;
    const w = p / 100;
    atk += w;
    if (mv.category === 'Physical') phys += w;
    if (mv.type === 'Water') water += w;
    if (mv.type === 'Fire') fire += w;
  }
  return {atk, phys, water, fire};
}

export function tagMon(set: PokeSet, src: Src, movePcts: [string, number][], pressure?: number): Tags {
  const {m, a, it} = src;
  const form = battleSpecies(set);
  const sp = gen.species.get(toID(form) as never) as {baseStats?: Record<string, number>} | undefined;
  const bs = sp?.baseStats ?? {atk: 80, spa: 80, spe: 80};
  const prof = attackProfile(movePcts);
  const mega = form !== set.species || /-Mega/.test(set.species);

  const t: Tags = {
    species: set.species,
    fakeOut: m('fakeout'),
    redirect: Math.max(m('followme'), m('ragepowder'), 0.5 * (a('lightningrod') + a('stormdrain'))),
    intimidate: a('intimidate'),
    pivot: Math.max(m('uturn'), m('flipturn'), m('partingshot'), m('voltswitch'), m('chillyreception')),
    screens: Math.max(m('lightscreen'), m('reflect'), m('auroraveil')),
    setup: Math.max(m('nastyplot'), m('calmmind'), m('swordsdance'), m('dragondance'), m('bellydrum'), m('quiverdance'), m('bulkup')),
    sets: {}, abuses: {}, dep: {}, offense: 0, support: 0, speed: bs.spe, mega, physical: prof.phys > prof.atk / 2,
  };
  const ab = toID(set.ability);
  const weatherForm = toID(form);
  t.sets.RAIN = Math.max(a('drizzle'), 0.6 * m('raindance'));
  t.sets.SUN = Math.max(a('drought'), weatherForm === 'charizardmegay' ? 1 : 0, 0.6 * m('sunnyday'));
  t.sets.SAND = Math.max(a('sandstream'), weatherForm === 'tyranitarmega' ? 1 : 0, 0.6 * m('sandstorm'));
  t.sets.SNOW = Math.max(a('snowwarning'), 0.6 * m('snowscape'));
  t.sets.TRICK_ROOM = m('trickroom');
  t.sets.TAILWIND = m('tailwind');
  t.sets.PSYCHIC_TERRAIN = a('psychicsurge');
  t.sets.GRASSY_TERRAIN = a('grassysurge');
  t.sets.ELECTRIC_TERRAIN = a('electricsurge');
  t.sets.MISTY_TERRAIN = a('mistysurge');
  // la habilidad de la forma Mega no aparece en el set base: si combate en Mega, la buscamos
  if (mega && ab) {
    if (ab === 'drought') t.sets.SUN = 1;
    if (ab === 'sandstream') t.sets.SAND = 1;
  }

  const statScore = clamp01((Math.max(bs.atk, bs.spa) - 70) / 60);
  const offBase = clamp01(0.5 * statScore + 0.5 * clamp01(prof.atk / 2.5) + 0.15 * t.setup + (mega ? 0.1 : 0));
  t.offense = pressure === undefined ? offBase : clamp01(0.5 * offBase + 0.5 * pressure);

  t.abuses.RAIN = clamp01(a('swiftswim') + m('electroshot') + 0.5 * (m('hurricane') + m('thunder')) + 0.3 * clamp01(prof.water));
  t.abuses.SUN = clamp01(a('chlorophyll') + a('solarpower') + a('protosynthesis') + m('solarbeam') + 0.3 * clamp01(prof.fire));
  t.abuses.SAND = clamp01(a('sandrush') + a('sandforce'));
  t.abuses.SNOW = clamp01(a('slushrush') + m('blizzard'));
  t.abuses.TRICK_ROOM = clamp01((70 - bs.spe) / 40) * t.offense;
  t.abuses.TAILWIND = clamp01((bs.spe - 55) / 45) * t.offense;
  t.abuses.PSYCHIC_TERRAIN = clamp01(m('expandingforce') + it('psychicseed'));
  t.abuses.GRASSY_TERRAIN = clamp01(m('grassyglide') + it('grassyseed'));
  t.abuses.ELECTRIC_TERRAIN = clamp01(m('risingvoltage') + it('electricseed') + a('quarkdrive'));
  t.abuses.MISTY_TERRAIN = clamp01(m('mistyexplosion') + it('mistyseed'));

  t.dep.RAIN = clamp01(a('swiftswim') + 0.3 * m('electroshot'));
  t.dep.SUN = clamp01(a('chlorophyll') + a('solarpower'));
  t.dep.SAND = a('sandrush');
  t.dep.SNOW = a('slushrush');

  const maxSet = Math.max(...EXCLUSIVE.map(x => t.sets[x] ?? 0), t.sets.TAILWIND ?? 0);
  t.support = clamp01(t.fakeOut + t.redirect + t.screens + maxSet + m('helpinghand') + m('encore'));
  return t;
}

export interface ModeInfo {strength: Partial<Record<Mode, number>>; primary?: Mode; secondary?: Mode}

export function detectModes(team: Tags[]): ModeInfo {
  const strength: Partial<Record<Mode, number>> = {};
  for (const mode of ALL_MODES) {
    const setter = Math.max(0, ...team.map(t => t.sets[mode] ?? 0));
    const abusers = team.reduce((acc, t) => acc + (t.abuses[mode] ?? 0) * (1 - (t.sets[mode] ?? 0) * 0.5), 0);
    strength[mode] = setter * (0.5 + abusers);
  }
  const ranked = (Object.entries(strength) as [Mode, number][])
    .filter(([k]) => !NOT_ARCHETYPE.includes(k))
    .sort((x, y) => y[1] - x[1]);
  const [p, s] = ranked;
  const primary = p && p[1] > 0.6 ? p[0] : undefined;
  const secondary = primary && s && s[1] >= 0.4 * p[1] && s[1] > 0.4 ? s[0] : undefined;
  return {strength, primary, secondary};
}

const maxExclusive = (t: Tags) => {
  let best: [Mode | '', number] = ['', 0];
  for (const m of EXCLUSIVE) if ((t.sets[m] ?? 0) > best[1]) best = [m, t.sets[m]!];
  return best;
};

/** Compatibilidad de roles de una pareja de lead (reglas L1-L9). */
export function roleCompat(a: Tags, b: Tags, modes: ModeInfo): {r: number; why: string[]} {
  let r = 0;
  const why: string[] = [];
  let bestSyn = 0, synMode: Mode | '' = '';
  for (const M of ALL_MODES) {
    const syn = Math.max((a.sets[M] ?? 0) * (b.abuses[M] ?? 0), (b.sets[M] ?? 0) * (a.abuses[M] ?? 0));
    if (syn > 0.2) { r += 1.2 * syn; if (syn > bestSyn) { bestSyn = syn; synMode = M; } }
  }
  if (synMode) why.push(`${MODE_ES[synMode]} + quien lo aprovecha`);

  const trA = a.sets.TRICK_ROOM ?? 0, trB = b.sets.TRICK_ROOM ?? 0;
  const twA = a.sets.TAILWIND ?? 0, twB = b.sets.TAILWIND ?? 0;
  const trSupport = Math.max(trA * Math.max(b.fakeOut, b.redirect), trB * Math.max(a.fakeOut, a.redirect));
  if (trSupport > 0.3) { r += 0.8 * trSupport; why.push('protege el Trick Room'); }

  const atk = (x: Tags) => Math.max(gate(x.offense, 0.6), x.setup);
  const fo = Math.max(a.fakeOut * atk(b), b.fakeOut * atk(a));
  if (fo > 0.3) { r += 0.8 * fo; why.push('Fake Out + atacante'); }
  const protect = (x: Tags) => Math.max(x.setup, x.mega ? 1 : 0, gate(x.offense, 0.7));
  const rd = Math.max(a.redirect * protect(b), b.redirect * protect(a));
  if (rd > 0.3) { r += 0.8 * rd; why.push('redirección protege al atacante'); }
  const it = Math.max(a.intimidate * gate(b.offense, 0.6), b.intimidate * gate(a.offense, 0.6));
  if (it > 0.3) { r += 0.4 * it; why.push('Intimidación + atacante'); }
  const pv = Math.max(a.pivot * maxExclusive(b)[1], b.pivot * maxExclusive(a)[1]);
  r += 0.3 * pv;

  if (Math.max(a.offense, b.offense) < 0.5) { r -= 1.5; why.push('dos apoyos sin atacante'); }
  const [ma, sa] = maxExclusive(a), [mb, sb] = maxExclusive(b);
  if (ma && mb && ma !== mb && sa >= 0.4 && sb >= 0.4 && (a.abuses[mb] ?? 0) < 0.3 && (b.abuses[ma] ?? 0) < 0.3) {
    r -= 1.5; why.push('habilitadores de modos distintos');
  }
  r -= 1.0 * Math.max(a.fakeOut * b.redirect, b.fakeOut * a.redirect);
  if (trA >= 0.4 && trB >= 0.4) r -= 1.5;
  if (Math.max(trA * twB, trB * twA) >= 0.16) r -= 1.0 * Math.max(trA * twB, trB * twA) / 0.5;
  if (a.fakeOut > 0.5 && b.fakeOut > 0.5 && Math.max(a.offense, b.offense) < 0.6) r -= 0.4;
  if (modes.primary === 'TRICK_ROOM' && trA + trB < 0.3) r -= 2.0;
  if ((modes.strength.TRICK_ROOM ?? 0) < 0.3 && a.speed < 50 && b.speed < 50) r -= 0.5;
  return {r, why};
}

/** Término de modo: la pareja ejecuta el modo principal / secundario. */
function modeTerm(a: Tags, b: Tags, modes: ModeInfo): {s: number; why?: string} {
  let s = 0, why: string | undefined;
  const {primary: P, secondary: S} = modes;
  if (P) {
    const set = Math.max(a.sets[P] ?? 0, b.sets[P] ?? 0);
    s += set;
    if (set >= 0.5) why = `abre con su ${MODE_ES[P]}`;
  }
  if (S) {
    const set = Math.max(a.sets[S] ?? 0, b.sets[S] ?? 0);
    s += 0.3 * set;
    // el colocador del modo secundario suele esperar atrás
    const onlySecondary = (x: Tags) => (x.sets[S] ?? 0) * (1 - (P ? x.sets[P] ?? 0 : 0));
    s -= 0.5 * Math.max(onlySecondary(a), onlySecondary(b));
  }
  return {s, why};
}

const logit = (p: number) => Math.log(p / (1 - p));

export interface Priors {lead: number[]; bring: number[]; leadN: number[]}

/** P(lead | en el seis) y P(lo trae | en el seis) de Smogon, suavizados hacia un prior de rol. */
export function priors(tags: Tags[], usages: (MonUsage | undefined)[], ds?: Dataset): Priors {
  const alpha = 20;
  const meanReal = ds?.totals ? ds.totals.real / ds.totals.raw : 0.461;
  const lead: number[] = [], bring: number[] = [], leadN: number[] = [];
  tags.forEach((t, i) => {
    const u = usages[i];
    const role = Math.max(t.fakeOut, t.redirect, maxExclusive(t)[1], t.sets.TAILWIND ?? 0);
    const mu = role >= 0.3 ? 0.25 + 0.3 * role : t.speed >= 90 ? 0.4 : 0.25 + 0.15 * clamp01((t.speed - 40) / 50);
    const teams = u?.teams ?? 0;
    const L = u?.lead != null && teams ? (Math.min(2 * u.lead, teams) + alpha * mu) / (teams + alpha) : mu;
    lead.push(Math.max(0.03, Math.min(0.9, L)));
    leadN.push(u?.lead != null ? teams : 0);
    const B = u?.real != null && teams ? (u.real / teams) * (0.667 / meanReal) : 0.6;
    bring.push(Math.max(0.05, Math.min(0.95, B)));
  });
  return {lead, bring, leadN};
}

export interface LeadPair {pair: [number, number]; p: number; why: string[]}
export interface RivalPrediction {
  leadPairs: LeadPair[];         // 15, ordenadas por p
  bring: number[];               // P(lo trae) por cada uno de los 6
  lead: number[];                // P(sale de lead) por cada uno
  mega: {index: number; p: number}[]; // P(megaevoluciona), solo los que llevan piedra
  back: {pair: [number, number]; p: number}[];
  modes: ModeInfo;
  tags: Tags[];
  confidence: 'alta' | 'media' | 'baja';
}

export interface RivalInput {set: PokeSet; usage?: MonUsage; pStone: number}

export function comb<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < arr.length; i++) rec(i + 1, [...acc, arr[i]]);
  };
  rec(0, []);
  return out;
}

/**
 * Predice qué trae y con qué abre el rival.
 * @param pressure 0..1 por rival: presión de daño sobre tu equipo (de la tabla de enfrentamientos)
 */
export function predictRival(rivals: RivalInput[], ds?: Dataset, pressure?: number[]): RivalPrediction {
  const tags = rivals.map((r, i) => tagMon(r.set, srcFromUsage(r.usage), r.usage?.moves ?? r.set.moves.map(m => [toID(m), 100]), pressure?.[i]));
  rivals.forEach((r, i) => { tags[i].mega = r.pStone >= 0.5; });
  const modes = detectModes(tags);
  const pri = priors(tags, rivals.map(r => r.usage), ds);
  const n = rivals.length;
  const idx = [...Array(n).keys()];

  // Prior de Mega del equipo: uso de cada forma Mega, normalizado entre sus piedras
  const stones = idx.filter(i => tags[i].mega);
  const stoneW = stones.map(i => (rivals[i].usage?.usage ?? 0.3) + 0.5);
  const stoneTot = stoneW.reduce((a, b) => a + b, 0) || 1;
  const pi = new Map(stones.map((i, k) => [i, stoneW[k] / stoneTot]));

  // Puntuación de cada pareja de lead (no depende del back)
  const leadScore = new Map<string, {s: number; why: string[]}>();
  for (const [a, b] of comb(idx, 2)) {
    const ta = tags[a], tb = tags[b];
    const R = roleCompat(ta, tb, modes);
    const A = modeTerm(ta, tb, modes);
    const T = pressure ? (pressure[a] + pressure[b]) / 2 : 0;
    const s = logit(pri.lead[a]) + logit(pri.lead[b]) + R.r + 0.8 * A.s + 0.3 * T;
    const why = [...(A.why ? [A.why] : []), ...R.why.filter(w => !/sin atacante|distintos/.test(w))];
    leadScore.set(`${a},${b}`, {s, why});
  }

  const options: {lead: [number, number]; back: [number, number]; s: number; mega: number}[] = [];
  const sec = modes.secondary;
  for (const four of comb(idx, Math.min(4, n))) {
    // coherencia: beneficiario que depende de un modo sin su habilitador
    let c = 0;
    for (const i of four) for (const M of ALL_MODES) {
      const d = tags[i].dep[M] ?? 0;
      if (d >= 0.3 && !four.some(j => (tags[j].sets[M] ?? 0) >= 0.25)) c -= 2 * d;
    }
    // una sola Mega por combate
    const st = four.filter(i => tags[i].mega);
    let mg = 0, megaIdx = -1;
    if (!st.length && stones.length) mg -= 0.7;
    if (st.length) {
      megaIdx = st.reduce((x, y) => (pi.get(y)! > pi.get(x)! ? y : x));
      mg += Math.log(pi.get(megaIdx)!) - 1.0 * (st.length - 1);
    }
    for (const lead of comb(four, 2) as [number, number][]) {
      const back = four.filter(i => !lead.includes(i)) as [number, number];
      const L = leadScore.get(`${lead[0]},${lead[1]}`)!;
      let sb = 0.7 * back.reduce((acc, i) => acc + logit(pri.bring[i]), 0);
      if (sec && back.some(i => (tags[i].sets[sec] ?? 0) >= 0.4)) sb += 0.5;
      let m2 = 0;
      if (megaIdx >= 0 && lead.includes(megaIdx)) {
        const mate = tags[lead[0] === megaIdx ? lead[1] : lead[0]];
        if (Math.max(mate.fakeOut, mate.redirect) >= 0.5) m2 += 0.3;
      }
      options.push({lead, back, s: L.s + sb + c + mg + m2, mega: megaIdx});
    }
  }
  const max = Math.max(...options.map(o => o.s));
  const ws = options.map(o => Math.exp(o.s - max));
  const Z = ws.reduce((a, b) => a + b, 0);

  const pairP = new Map<string, number>(), backP = new Map<string, number>();
  const bring = Array(n).fill(0), lead = Array(n).fill(0), megaP = Array(n).fill(0);
  options.forEach((o, k) => {
    const p = ws[k] / Z;
    const key = o.lead.join(',');
    pairP.set(key, (pairP.get(key) ?? 0) + p);
    backP.set(o.back.join(','), (backP.get(o.back.join(',')) ?? 0) + p);
    for (const i of o.lead) { lead[i] += p; bring[i] += p; }
    for (const i of o.back) bring[i] += p;
    if (o.mega >= 0) megaP[o.mega] += p;
  });
  const leadPairs: LeadPair[] = [...pairP.entries()].map(([k, p]) => {
    const pair = k.split(',').map(Number) as [number, number];
    return {pair, p, why: leadScore.get(k)!.why};
  }).sort((a, b) => b.p - a.p);
  const back = [...backP.entries()].map(([k, p]) => ({pair: k.split(',').map(Number) as [number, number], p})).sort((a, b) => b.p - a.p);
  const covered = pri.leadN.filter(x => x > 200).length;
  const top = leadPairs[0]?.p ?? 0;
  const confidence = top >= 0.3 && covered >= 5 ? 'alta' : top >= 0.18 && covered >= 4 ? 'media' : 'baja';
  return {
    leadPairs, bring, lead, back, modes, tags, confidence,
    mega: stones.map(i => ({index: i, p: megaP[i]})).sort((a, b) => b.p - a.p),
  };
}
