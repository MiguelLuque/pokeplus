import {gen, toID, type Dataset, type MonUsage, speciesName} from './data';
import {commonSet, commonAttacks, attacksOf, battleSpecies, type PokeSet} from './sets';
import {calcMove, effectiveSpeed, koLabel, type DamageSummary, type FieldOpts} from './damage';
import {predictRival, tagMon, srcFromSet, detectModes, roleCompat, comb, type RivalPrediction} from './leads';

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

/* ---------- Recomendación: traer 4 y lead ---------- */

export interface PlanOption {lead: [number, number]; back: number[]; score: number}

export interface Plan {
  matrix: Matchup[][]; // [mio][rival]
  bring: number[];
  lead: [number, number];
  back: number[];
  bringScore: number;
  reasons: string[];
  /** lead más probable del rival */
  rivalLead: [number, number];
  /** P(lo trae) y P(sale de lead) de cada rival */
  bringW: number[];
  leadW: number[];
  leadWeather: string;
  prediction: RivalPrediction;
  /** otras opciones propias buenas (lead distinto) */
  alternatives: PlanOption[];
}

/** Nivel de KO: OHKO = 1, 2HKO = 0,6, 3HKO = 0,3. */
function offLevel(d: DamageSummary | null): number {
  if (!d || !d.hits) return 0;
  if (d.hits === 1) return d.chance >= 1 ? 1 : 0.6 + 0.4 * d.chance;
  if (d.hits === 2) return d.chance >= 1 ? 0.6 : 0.45 + 0.15 * d.chance;
  if (d.hits === 3) return 0.3;
  return 0.1;
}

const isMegaSet = (s: PokeSet) => battleSpecies(s) !== s.species || /-Mega/.test(s.species);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function plan(my: PokeSet[], rivals: RivalMon[], field?: FieldOpts, ds?: Dataset): Plan {
  const matrix = my.map(m => rivals.map(r => matchup(m, r.set, r.usage, field)));
  const nR = rivals.length;

  // 1) Predicción del rival (con la presión que ejerce sobre tu equipo)
  const pressure = rivals.map((_, j) => Math.min(1, 1.3 * mean(my.map((_, i) => koValue(matrix[i][j].threat)))));
  const prediction = predictRival(rivals.map(r => ({set: r.set, usage: r.usage, pStone: isMegaSet(r.set) ? 1 : 0})), ds, pressure);
  const rivalLead = prediction.leadPairs[0]?.pair ?? [0, Math.min(1, nR - 1)];

  // 2) Tus etiquetas de rol a partir de tus sets
  const myTags = my.map((s, i) => {
    const t = tagMon(s, srcFromSet(s), s.moves.map(m => [toID(m), 100] as [string, number]),
      Math.min(1, 1.3 * mean(rivals.map((_, j) => koValue(matrix[i][j].offense)))));
    t.mega = isMegaSet(s);
    return t;
  });
  const myModes = detectModes(myTags);

  // 3) Matriz M[i][j] = off(i→j) − off(j→i) + 0,3·velocidad, con el clima que haya en el campo
  const trRival = prediction.modes.primary === 'TRICK_ROOM';
  // Intimidación probable del rival: −1 Ataque ≈ ×0,67 de daño a tus atacantes físicos
  // (Defiant/Competitive la castigan). Factor sobre el nivel de KO.
  const pInt = Math.max(0, ...prediction.tags.map((t, j) => (t.intimidate >= 0.5 ? prediction.bring[j] : 0)));
  const intimAdj = my.map((s, i) => {
    const ab = toID(s.ability);
    if (ab === 'defiant' || ab === 'competitive') return 1 + 0.1 * pInt;
    if (!myTags[i].physical || ['clearbody', 'innerfocus', 'owntempo', 'oblivious', 'scrappy', 'fullmetalbody', 'mirrorarmor', 'guarddog', 'hypercutter'].includes(ab)) return 1;
    return 1 - 0.35 * pInt;
  });
  const Ms: Record<string, number[][]> = {};
  const matrices: Record<string, Matchup[][]> = {'': matrix};
  const matrixFor = (w: string) => {
    if (!w || field?.weather) return matrix;
    matrices[w] ??= my.map(m => rivals.map(r => matchup(m, r.set, r.usage, {...field, weather: w as FieldOpts['weather']})));
    return matrices[w];
  };
  const MFor = (w: string) => {
    if (Ms[w]) return Ms[w];
    const mx = matrixFor(w);
    Ms[w] = mx.map((row, i) => row.map(m => {
      let spd = m.mySpeed > m.rivalSpeed ? 1 : m.mySpeed < m.rivalSpeed ? -1 : 0;
      if (trRival) spd = -0.5 * spd;
      return offLevel(m.offense) * intimAdj[i] - offLevel(m.threat) + 0.3 * spd;
    }));
    return Ms[w];
  };
  const myW = my.map(s => rolesOf(s).weather);
  const rvW = rivals.map(r => rolesOf(r.set).weather);
  const mySpe = my.map(s => effectiveSpeed(s));
  const rvSpe = rivals.map(r => effectiveSpeed(r.set));
  /** Clima con P vs Q: gana el colocador más lento (pone su clima después). */
  const weatherOf = (P: number[], Q: number[]) => {
    if (field?.weather) return field.weather;
    const mine = P.filter(i => myW[i]).sort((a, b) => mySpe[a] - mySpe[b])[0];
    const theirs = Q.filter(j => rvW[j]).sort((a, b) => rvSpe[a] - rvSpe[b])[0];
    if (mine !== undefined && theirs !== undefined) return mySpe[mine] <= rvSpe[theirs] ? myW[mine] : rvW[theirs];
    return mine !== undefined ? myW[mine] : theirs !== undefined ? rvW[theirs] : '';
  };

  const Rcache = new Map<string, number>();
  const Ruser = (P: [number, number]) => {
    const k = P.join(',');
    if (!Rcache.has(k)) Rcache.set(k, roleCompat(myTags[P[0]], myTags[P[1]], myModes).r);
    return Rcache.get(k)!;
  };
  const U = (P: [number, number], Q: [number, number]) => {
    const M = MFor(weatherOf(P, Q));
    let u = 0;
    for (const i of P) for (const j of Q) u += M[i][j];
    u /= 4;
    u += 0.5 * Ruser(P);
    return u;
  };

  const Qs = prediction.leadPairs;
  const Qlikely = Qs.filter(q => q.p > 0.08);
  if (!Qlikely.length && Qs[0]) Qlikely.push(Qs[0]);
  const pBring = prediction.bring;
  const idxMine = my.map((_, i) => i);
  const k = Math.min(4, my.length);
  const myStones = myTags.filter(t => t.mega).length;

  const options: PlanOption[] = [];
  for (const S of comb(idxMine, k)) {
    // valor del cuatro: dañar a los seis (B2)
    // y tener a alguien que aguante sus golpes
    let V = 0;
    for (let j = 0; j < nR; j++) {
      const best = Math.max(...S.map(i => offLevel(matrix[i][j].offense) * intimAdj[i]));
      V += pBring[j] * best;
      if (pBring[j] > 0.5 && best < 0.3) V -= 1.0;
      V += 0.3 * pBring[j] * Math.max(...S.map(i => 1 - offLevel(matrix[i][j].threat)));
    }
    // coherencia (beneficiario sin habilitador) y una sola Mega
    let C = 0;
    for (const i of S) for (const [M, d] of Object.entries(myTags[i].dep)) {
      if ((d ?? 0) >= 0.3 && !S.some(x => (myTags[x].sets[M as keyof typeof myTags[number]['sets']] ?? 0) >= 0.25)) C -= 2 * d!;
    }
    const st = S.filter(i => myTags[i].mega).length;
    if (st > 1) C -= 1.0 * (st - 1);
    if (!st && myStones) C -= 0.3;

    const pairs = comb(S, 2) as [number, number][];
    const Ucache = pairs.map(P => Qs.map(q => U(P, q.pair)));
    pairs.forEach((P, pi) => {
      const back = S.filter(i => !P.includes(i));
      const E = Qs.reduce((acc, q, qi) => acc + q.p * Ucache[pi][qi], 0);
      const worst = Math.min(...Qlikely.map(q => Ucache[pi][Qs.indexOf(q)]));
      // rescate: cuánto mejora un lead que incluya a alguno de atrás si este sale mal
      let Rb = 0;
      Qs.forEach((q, qi) => {
        let alt = -Infinity;
        pairs.forEach((P2, p2) => { if (p2 !== pi && P2.some(i => back.includes(i))) alt = Math.max(alt, Ucache[p2][qi]); });
        Rb += q.p * Math.max(0, alt - Ucache[pi][qi]);
      });
      const score = 0.6 * E + 0.4 * worst + 0.5 * V + 0.3 * Rb + C;
      options.push({lead: P, back, score});
    });
  }
  options.sort((a, b) => b.score - a.score);
  const best = options[0] ?? {lead: [0, Math.min(1, my.length - 1)] as [number, number], back: [], score: 0};
  const lead = best.lead;
  const back = best.back;
  const bring = [...lead, ...back];
  const seenLeads = new Set([lead.join(',')]);
  const alternatives: PlanOption[] = [];
  for (const o of options.slice(1)) {
    if (alternatives.length >= 2) break;
    const key = o.lead.join(',');
    if (seenLeads.has(key)) continue;
    seenLeads.add(key);
    alternatives.push(o);
  }

  const leadWeather = weatherOf(lead, rivalLead);
  const LM = matrixFor(leadWeather);
  const reasons: string[] = [];
  for (const i of lead) {
    const tags = roleTags(rolesOf(my[i]));
    const kos = rivals.map((rv, j) => ({rv, m: LM[i][j]})).filter(x => x.m.offense && x.m.offense.hits <= 2)
      .sort((a, b) => koValue(b.m.offense) - koValue(a.m.offense));
    const parts: string[] = [];
    if (tags.length) parts.push(tags.join(', '));
    if (kos.length) parts.push(kos.slice(0, 3).map(x => `${koLabel(x.m.offense!)} a ${x.rv.set.species} (${x.m.offense!.move})`).join(', ') +
      (kos.length > 3 ? ` y ${kos.length - 3} más` : ''));
    reasons.push(`${my[i].species}: ${parts.join(' · ') || 'buen enfrentamiento general'}.`);
  }
  const why = roleCompat(myTags[lead[0]], myTags[lead[1]], myModes).why.filter(w => !/sin atacante|distintos/.test(w));
  if (why.length) reasons.push(`Juntos: ${why.join(', ')}.`);
  // ¿a quién de los probables no responde nadie?
  const uncovered = rivals.map((r, j) => ({r, j})).filter(({j}) => pBring[j] > 0.5 && Math.max(...bring.map(i => offLevel(matrix[i][j].offense))) < 0.3);
  if (uncovered.length) reasons.push(`Ojo: nadie de tus 4 le hace mucho daño a ${uncovered.map(x => x.r.set.species).join(', ')}.`);
  if (leadWeather) reasons.push(`Daños de la lead calculados con ${{Sun: 'sol', Rain: 'lluvia', Sand: 'tormenta de arena', Snow: 'nieve'}[leadWeather] ?? leadWeather} activo.`);

  return {
    matrix, bring, lead, back, bringScore: best.score, reasons, rivalLead,
    bringW: prediction.bring, leadW: prediction.lead, leadWeather, prediction, alternatives,
  };
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
