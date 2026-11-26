import {gen, toID, type Dataset, type MonUsage, speciesName} from './data';
import {commonSet, commonAttacks, attacksOf, battleSpecies, type PokeSet} from './sets';
import {calcMove, effectiveSpeed, koLabel, type DamageSummary, type FieldOpts} from './damage';

/* ---------- Resolución de formas (Mega o no) a partir del uso ---------- */

export interface FormOption {species: string; prob: number; usage?: MonUsage}

export function baseOf(name: string) {
  const sp = gen.species.get(toID(name) as never);
  return sp?.baseSpecies ?? sp?.name ?? name;
}

/**
 * En la vista previa solo se ve la especie base: reparte la probabilidad
 * entre sus formas (p. ej. Charizard → Mega Y 85 %, Mega X 10 %…) según el uso.
 */
const MEGA_FROM: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const it of gen.items) {
    const ms = (it as {megaStone?: Record<string, string>}).megaStone;
    if (ms) for (const [from, to] of Object.entries(ms)) out[to] = from;
  }
  return out;
})();

/** ¿Puede `input` (lo que se ve en la vista previa) ser esta forma? */
export function canBeForm(input: string, form: string) {
  if (toID(input) === toID(form)) return true;
  const from = MEGA_FROM[form];
  if (!from) return false;
  if (toID(from) === toID(input)) return true;
  return false;
}

/**
 * En la vista previa solo se ve la especie base: reparte la probabilidad
 * entre sus formas (p. ej. Charizard → Mega Y 85 %, Mega X 10 %…) según el uso.
 */
export function resolveForms(input: string, ds: Dataset): FormOption[] {
  const name = speciesName(input) ?? input;
  if (/-Mega/.test(name)) return [{species: name, prob: 1, usage: ds.pokemon[name]}];
  const opts = Object.entries(ds.pokemon)
    .filter(([k]) => canBeForm(name, k))
    .map(([k, u]) => ({species: k, prob: u.usage, usage: u}));
  if (!opts.length) return [{species: name, prob: 1, usage: ds.pokemon[name]}];
  const total = opts.reduce((a, o) => a + o.prob, 0) || 1;
  return opts.map(o => ({...o, prob: o.prob / total})).sort((a, b) => b.prob - a.prob);
}

/* ---------- Matriz de enfrentamientos ---------- */

export interface Matchup {
  /** mejor ataque mío contra el rival */
  offense: DamageSummary | null;
  /** peor ataque probable del rival contra mí */
  threat: DamageSummary | null;
  threatMoveUsage: number;
  mySpeed: number;
  rivalSpeed: number;
  /** valores 0..1 */
  o: number;
  t: number;
}

export function koValue(d: DamageSummary | null): number {
  if (!d || !d.hits) return 0;
  if (d.hits === 1) return d.chance >= 1 ? 1 : 0.5 + 0.5 * d.chance;
  if (d.hits === 2) return d.chance >= 1 ? 0.5 : 0.3 + 0.2 * d.chance;
  if (d.hits === 3) return 0.2;
  return 0.05;
}

const better = (a: DamageSummary | null, b: DamageSummary | null) => {
  if (!a) return b;
  if (!b) return a;
  const va = koValue(a), vb = koValue(b);
  if (va !== vb) return va > vb ? a : b;
  return a.maxPct >= b.maxPct ? a : b;
};

export function bestAttack(att: PokeSet, def: PokeSet, moves: string[], field?: FieldOpts) {
  let best: DamageSummary | null = null;
  for (const m of moves) best = better(best, calcMove(att, def, m, field));
  return best;
}

export function matchup(my: PokeSet, rival: PokeSet, rivalUsage?: MonUsage, field?: FieldOpts): Matchup {
  const offense = bestAttack(my, rival, attacksOf(my), field);
  const rivalMoves = commonAttacks(rivalUsage, 6).filter(([, p]) => p >= 15);
  const moves = rivalMoves.length ? rivalMoves.map(m => m[0]) : attacksOf(rival);
  let threat: DamageSummary | null = null;
  for (const m of moves) threat = better(threat, calcMove(rival, my, m, field));
  const threatMoveUsage = rivalMoves.find(m => m[0] === threat?.move)?.[1] ?? 0;
  const mySpeed = effectiveSpeed(my, {weather: field?.weather});
  const rivalSpeed = effectiveSpeed(rival, {weather: field?.weather});
  const iFaster = mySpeed > rivalSpeed;
  const o = koValue(offense) * (iFaster ? 1 : 0.75);
  const t = koValue(threat) * (iFaster ? 0.75 : 1);
  return {offense, threat, threatMoveUsage, mySpeed, rivalSpeed, o, t};
}

/* ---------- Roles de apoyo ---------- */

const has = (set: PokeSet, ...moves: string[]) => set.moves.some(m => moves.includes(toID(m)));
const abil = (set: PokeSet) => toID(set.ability);

export interface Roles {
  fakeOut: boolean; tailwind: boolean; trickRoom: boolean; redirect: boolean;
  intimidate: boolean; weather: string; spreadAttacks: number; protect: boolean;
}

export function rolesOf(set: PokeSet): Roles {
  const ab = abil(set);
  const bs = toID(battleSpecies(set));
  let weather = '';
  if (ab === 'drought' || bs === 'charizardmegay') weather = 'Sun';
  if (ab === 'drizzle') weather = 'Rain';
  if (ab === 'sandstream' || bs === 'tyranitarmega') weather = 'Sand';
  if (ab === 'snowwarning') weather = 'Snow';
  return {
    fakeOut: has(set, 'fakeout'),
    tailwind: has(set, 'tailwind'),
    trickRoom: has(set, 'trickroom'),
    redirect: has(set, 'followme', 'ragepowder'),
    intimidate: ab === 'intimidate',
    weather,
    spreadAttacks: set.moves.filter(m => {
      const mv = gen.moves.get(toID(m) as never) as {target?: string; category?: string} | undefined;
      return mv && mv.category !== 'Status' && (mv.target === 'allAdjacentFoes' || mv.target === 'allAdjacent');
    }).length,
    protect: has(set, 'protect', 'detect', 'spikyshield', 'kingsshield', 'silktrap', 'banefulbunker', 'burningbulwark'),
  };
}

const WEATHER_ABUSERS: Record<string, string[]> = {
  Sun: ['chlorophyll', 'solarpower', 'protosynthesis', 'harvest', 'flowergift'],
  Rain: ['swiftswim', 'raindish', 'hydration'],
  Sand: ['sandrush', 'sandforce', 'sandveil'],
  Snow: ['slushrush', 'icebody', 'snowcloak'],
};

export function roleTags(r: Roles): string[] {
  const t: string[] = [];
  if (r.fakeOut) t.push('Fake Out');
  if (r.tailwind) t.push('Tailwind');
  if (r.trickRoom) t.push('Trick Room');
  if (r.redirect) t.push('Redirección');
  if (r.intimidate) t.push('Intimidación');
  if (r.weather) t.push({Sun: 'Sol', Rain: 'Lluvia', Sand: 'Arena', Snow: 'Nieve'}[r.weather] ?? r.weather);
  return t;
}

function pairSynergy(a: PokeSet, b: PokeSet): number {
  const ra = rolesOf(a), rb = rolesOf(b);
  let s = 0;
  if (ra.fakeOut !== rb.fakeOut) s += 0.15; // un Fake Out da un turno libre al compañero
  if (ra.fakeOut && rb.fakeOut) s += 0.05;
  if (ra.tailwind || rb.tailwind) s += 0.15;
  if (ra.trickRoom || rb.trickRoom) {
    const slow = [a, b].some(x => effectiveSpeed(x) < 70);
    s += slow ? 0.25 : 0.05;
  }
  if (ra.redirect || rb.redirect) s += 0.1;
  if (ra.intimidate || rb.intimidate) s += 0.08;
  for (const [x, y] of [[ra, b], [rb, a]] as const) {
    if (x.weather && WEATHER_ABUSERS[x.weather]?.includes(abil(y))) s += 0.3;
    if (x.weather === 'Sun' && y.moves.some(m => gen.moves.get(toID(m) as never)?.type === 'Fire')) s += 0.05;
    if (x.weather === 'Rain' && y.moves.some(m => gen.moves.get(toID(m) as never)?.type === 'Water')) s += 0.05;
  }
  s += 0.03 * (ra.spreadAttacks + rb.spreadAttacks);
  return s;
}

/* ---------- Predicción del rival ---------- */

export interface RivalMon {
  input: string;
  forms: FormOption[];
  set: PokeSet;
  usage?: MonUsage;
}

export function buildRival(input: string, ds: Dataset, chosenForm?: string): RivalMon {
  const forms = resolveForms(input, ds);
  const pick = forms.find(f => f.species === chosenForm) ?? forms[0];
  return {input, forms, set: commonSet(pick.species, pick.usage), usage: pick.usage};
}

/** Probabilidad (heurística) de que el rival lo traiga entre sus 4. */
export function bringWeights(rivals: RivalMon[]): number[] {
  const max = Math.max(1, ...rivals.map(r => r.usage?.usage ?? 1));
  return rivals.map(r => 0.55 + 0.45 * ((r.usage?.usage ?? 1) / max));
}

/** Probabilidad (heurística) de que salga de lead. */
export function leadWeights(rivals: RivalMon[]): number[] {
  const bw = bringWeights(rivals);
  const raw = rivals.map((r, i) => {
    const u = r.usage;
    const pct = (id: string) => u?.moves.find(m => m[0] === id)?.[1] ?? 0;
    const roles = rolesOf(r.set);
    let w = bw[i];
    w += 0.6 * (pct('fakeout') / 100);
    w += 0.45 * (Math.max(pct('tailwind'), pct('trickroom')) / 100);
    w += 0.3 * ((pct('followme') + pct('ragepowder')) / 100);
    if (roles.weather) w += 0.3;
    if (roles.intimidate) w += 0.15;
    return w;
  });
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map(w => (2 * w) / total); // suman 2 (dos huecos de lead)
}

export function predictRivalLead(rivals: RivalMon[]) {
  const lw = leadWeights(rivals);
  let best: [number, number] = [0, 1];
  let bestScore = -Infinity;
  for (let i = 0; i < rivals.length; i++) {
    for (let j = i + 1; j < rivals.length; j++) {
      const s = lw[i] + lw[j] + pairSynergy(rivals[i].set, rivals[j].set);
      if (s > bestScore) { bestScore = s; best = [i, j]; }
    }
  }
  return {pair: best, weights: lw};
}

/* ---------- Recomendación: traer 4 y lead ---------- */

export interface Plan {
  matrix: Matchup[][]; // [mio][rival]
  bring: number[];
  lead: [number, number];
  back: number[];
  bringScore: number;
  reasons: string[];
  rivalLead: [number, number];
  bringW: number[];
  leadW: number[];
  leadWeather: string;
}

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < n; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  return out;
}

export function plan(my: PokeSet[], rivals: RivalMon[], field?: FieldOpts): Plan {
  const matrix = my.map(m => rivals.map(r => matchup(m, r.set, r.usage, field)));
  const bw = bringWeights(rivals);
  const {pair: rivalLead, weights: lw} = predictRivalLead(rivals);
  const k = Math.min(4, my.length);

  const coverage = (sel: number[], weights: number[]) => rivals.reduce((acc, _, j) => {
    const off = Math.max(...sel.map(i => matrix[i][j].o));
    const def = Math.max(...sel.map(i => 1 - matrix[i][j].t));
    return acc + weights[j] * (0.6 * off + 0.4 * def);
  }, 0);

  let bring = combos(my.length, k)[0] ?? [];
  let bringScore = -Infinity;
  for (const c of combos(my.length, k)) {
    let s = coverage(c, bw);
    const roles = c.map(i => rolesOf(my[i]));
    if (roles.some(r => r.fakeOut)) s += 0.15;
    if (roles.some(r => r.tailwind || r.trickRoom)) s += 0.15;
    if (roles.some(r => r.intimidate)) s += 0.08;
    // sinergias internas (clima + beneficiario, Trick Room + lentos…)
    let syn = 0;
    for (const [x, y] of combos(c.length, 2)) syn = Math.max(syn, pairSynergy(my[c[x]], my[c[y]]));
    s += 0.5 * syn;
    // penaliza que varios caigan ante el mismo rival
    for (let j = 0; j < rivals.length; j++) {
      const weak = c.filter(i => matrix[i][j].t >= 0.75).length;
      if (weak >= 3) s -= 0.15 * bw[j];
    }
    if (s > bringScore) { bringScore = s; bring = c; }
  }

  // Matrices con el clima que pone mi propio equipo (lluvia, sol…)
  const weatherMatrix: Record<string, Matchup[][]> = {};
  const matrixFor = (w: string) => {
    if (!w) return matrix;
    weatherMatrix[w] ??= my.map(m => rivals.map(r => matchup(m, r.set, r.usage, {...field, weather: w as FieldOpts['weather']})));
    return weatherMatrix[w];
  };

  // Lead: presión sobre las leads probables del rival + sinergia.
  let lead: [number, number] = [bring[0], bring[1] ?? bring[0]];
  let leadScore = -Infinity;
  let leadWeather = '';
  for (const [a, b] of combos(bring.length, 2).map(p => [bring[p[0]], bring[p[1]]])) {
    const w = field?.weather || rolesOf(my[a]).weather || rolesOf(my[b]).weather;
    const M = matrixFor(w);
    let s = 0;
    for (let j = 0; j < rivals.length; j++) {
      const off = Math.max(M[a][j].o, M[b][j].o);
      const thr = Math.min(M[a][j].t, M[b][j].t) * 0.5 + Math.max(M[a][j].t, M[b][j].t) * 0.5;
      s += lw[j] * (off - 0.6 * thr);
    }
    s += pairSynergy(my[a], my[b]);
    if (s > leadScore) { leadScore = s; lead = [a, b]; leadWeather = w; }
  }
  const LM = matrixFor(leadWeather);
  const back = bring.filter(i => !lead.includes(i));

  const reasons: string[] = [];
  for (const i of lead) {
    const r = rolesOf(my[i]);
    const tags = roleTags(r);
    const kos = rivals.map((rv, j) => ({rv, m: LM[i][j]})).filter(x => x.m.offense && x.m.offense.hits <= 2);
    const parts: string[] = [];
    if (tags.length) parts.push(`aporta ${tags.join(', ')}`);
    if (kos.length) parts.push(`amenaza a ${kos.map(x => `${x.rv.set.species} (${koLabel(x.m.offense!)} con ${x.m.offense!.move})`).join(', ')}`);
    reasons.push(`${my[i].species}: ${parts.join('; ') || 'buen enfrentamiento general'}.`);
  }
  const syn = pairSynergy(my[lead[0]], my[lead[1]]);
  if (syn >= 0.3) reasons.push('Buena sinergia entre ambos (clima / control de velocidad / Fake Out).');
  if (leadWeather) reasons.push(`Daños de la lead calculados con ${{Sun: 'sol', Rain: 'lluvia', Sand: 'tormenta de arena', Snow: 'nieve'}[leadWeather] ?? leadWeather} activo.`);

  return {matrix, bring, lead, back, bringScore, reasons, rivalLead, bringW: bw, leadW: lw, leadWeather};
}

/* ---------- Sugerencias del meta contra un equipo rival ---------- */

export interface Suggestion {
  species: string;
  set: PokeSet;
  score: number;
  kos: {rival: string; d: DamageSummary}[];
  threatenedBy: {rival: string; d: DamageSummary}[];
}

export function suggest(rivals: RivalMon[], ds: Dataset, pool = 45, field?: FieldOpts): Suggestion[] {
  const bw = bringWeights(rivals);
  const rivalBases = new Set(rivals.map(r => baseOf(r.set.species)));
  const candidates = Object.entries(ds.pokemon)
    .sort((a, b) => a[1].rank - b[1].rank)
    .filter(([n]) => !rivalBases.has(baseOf(n)))
    .slice(0, pool);
  const out: Suggestion[] = [];
  for (const [name, u] of candidates) {
    const set = commonSet(name, u);
    let score = 0;
    const kos: Suggestion['kos'] = [];
    const threatenedBy: Suggestion['threatenedBy'] = [];
    rivals.forEach((r, j) => {
      const m = matchup(set, r.set, r.usage, field);
      score += bw[j] * (0.6 * m.o + 0.4 * (1 - m.t));
      if (m.offense && m.offense.hits && m.offense.hits <= 2) kos.push({rival: r.set.species, d: m.offense});
      if (m.threat && m.threat.hits === 1) threatenedBy.push({rival: r.set.species, d: m.threat});
    });
    // Datos reales de "checks and counters" de Smogon
    for (const r of rivals) {
      const c = r.usage?.checks.find(x => x[0] === name);
      if (c) score += 0.003 * Math.max(0, c[1]);
    }
    out.push({species: name, set, score, kos, threatenedBy});
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ---------- KO contra el meta ---------- */

export interface MetaRow {species: string; usage: number; set: PokeSet; results: DamageSummary[]; best: DamageSummary | null}

export function vsMeta(attacker: PokeSet, ds: Dataset, n = 40, field?: FieldOpts): MetaRow[] {
  return Object.entries(ds.pokemon)
    .sort((a, b) => a[1].rank - b[1].rank)
    .slice(0, n)
    .map(([name, u]) => {
      const set = commonSet(name, u);
      const results = attacksOf(attacker).map(m => calcMove(attacker, set, m, field)).filter((x): x is DamageSummary => !!x);
      let best: DamageSummary | null = null;
      for (const r of results) best = better(best, r);
      return {species: name, usage: u.usage, set, results, best};
    });
}

/** Lo contrario: qué amenazas del meta le hacen OHKO/2HKO a mi Pokémon. */
export function metaThreats(defender: PokeSet, ds: Dataset, n = 40, field?: FieldOpts): MetaRow[] {
  return Object.entries(ds.pokemon)
    .sort((a, b) => a[1].rank - b[1].rank)
    .slice(0, n)
    .map(([name, u]) => {
      const set = commonSet(name, u);
      const results = commonAttacks(u, 6).map(([m]) => calcMove(set, defender, m, field)).filter((x): x is DamageSummary => !!x);
      let best: DamageSummary | null = null;
      for (const r of results) best = better(best, r);
      return {species: name, usage: u.usage, set, results, best};
    });
}
