#!/usr/bin/env node
// Descarga las estadísticas de uso (chaos JSON) de Smogon para el formato VGC
// de Pokémon Champions más reciente y las condensa en public/data/usage.json.
//
// Uso: node scripts/fetch-usage.mjs [--month 2026-10] [--format gen9championsvgc2026regmc]
//      [--local <dir> (lee los chaos JSON de una carpeta, requiere --month y --format)]
//      [--soft (si falla la descarga conserva el usage.json existente y sale con 0)]
import {writeFileSync, mkdirSync, readFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Generations} from '@smogon/calc';

const BASE = 'https://www.smogon.com/stats/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'usage.json');
const CUTOFF = 1760;
const MIN_USAGE = 0.003; // 0.3 %

const args = process.argv.slice(2);
const arg = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function get(url, json = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {headers: {'user-agent': 'pokeplus-stats-bot'}});
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return json ? await res.json() : await res.text();
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// Compara identificadores de regulación: "regmc" < "regmd", "2026regmc" < "2027rega".
function formatKey(f) {
  const m = /^gen9championsvgc(\d{4})reg([a-z]+)$/.exec(f);
  return m ? `${m[1]}-${m[2].padStart(3, ' ')}` : '';
}

async function findLatest() {
  const index = await get(BASE);
  const months = [...index.matchAll(/href="(\d{4}-\d{2})\/"/g)].map(m => m[1]).sort().reverse();
  for (const month of months.slice(0, 4)) {
    if (arg('month') && month !== arg('month')) continue;
    const listing = await get(`${BASE}${month}/chaos/`);
    if (!listing) continue;
    const formats = new Set(
      [...listing.matchAll(/href="(gen9championsvgc\d{4}reg[a-z]+)(?:bo3)?-\d+\.json"/g)].map(m => m[1])
    );
    let list = [...formats].filter(f => formatKey(f)).sort((a, b) => formatKey(b).localeCompare(formatKey(a)));
    if (arg('format')) list = list.filter(f => f === arg('format'));
    if (list.length) return {month, format: list[0], listing};
  }
  throw new Error('No se encontró ningún formato gen9championsvgc en las estadísticas de Smogon');
}

// Smogon a veces usa un nombre que el calc no conoce (p. ej. "Aegislash" en vez de
// "Aegislash-Shield"): se traduce a la forma del calc con esa especie base, para que funcionen
// el cálculo de daño y el reconocimiento de capturas.
const calcGen = Generations.get(0);
const calcId = n => n.toLowerCase().replace(/[^a-z0-9]/g, '');
const renamed = new Map();
const ALIAS = {Aegislash: 'Aegislash-Shield'};
function calcName(name) {
  if (calcGen.species.get(calcId(name))) return name;
  // si no está en la tabla, la primera forma "Nombre-…" que no sea Mega (avisando en el log)
  const to = ALIAS[name] ?? [...calcGen.species].find(s => s.name.startsWith(`${name}-`) && !/-Mega/.test(s.name))?.name;
  renamed.set(name, to ?? null);
  return to ?? name;
}
function normalizeNames(pokemon) {
  const out = {};
  for (const [name, mon] of Object.entries(pokemon)) {
    for (const list of [mon.teammates, mon.checks]) for (const row of list ?? []) row[0] = calcName(row[0]);
    out[calcName(name)] = mon;
  }
  return out;
}

const pct = (v, total) => Math.round((v / total) * 10000) / 100; // % con 2 decimales

function top(obj, total, n, minPct = 0.5) {
  return Object.entries(obj || {})
    .map(([k, v]) => [k, pct(v, total)])
    .filter(([k, p]) => p >= minPct && k !== '' )
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// Ficheros de texto: uso (Raw / Real) y leads por especie.
//   | 1    | Sneasler   | 29.18886% | 962958 | 25.107% | 473392 | 26.762% |
function parseTable(txt) {
  const out = {};
  for (const line of (txt || '').split('\n')) {
    if (!/^\s*\| +\d/.test(line)) continue;
    const c = line.split('|').map(x => x.trim()).filter(Boolean);
    const nums = c.slice(2).filter(x => /^[\d.]+%?$/.test(x));
    const counts = nums.filter(x => !x.endsWith('%')).map(Number);
    out[c[1]] = counts;
  }
  return out;
}

function condense(chaos) {
  const out = {};
  const entries = Object.entries(chaos.data).sort((a, b) => b[1].usage - a[1].usage);
  let rank = 0;
  for (const [name, d] of entries) {
    if (d.usage < MIN_USAGE) continue;
    rank++;
    const total = Object.values(d.Abilities).reduce((a, b) => a + b, 0);
    if (!total) continue;
    const checks = Object.entries(d['Checks and Counters'] || {})
      .map(([k, v]) => [k, Math.round((v.p - 4 * v.d) * 1000) / 10, Math.round(v.n)])
      .filter(c => c[2] >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    out[name] = {
      rank,
      usage: Math.round(d.usage * 10000) / 100,
      raw: d['Raw count'],
      abilities: top(d.Abilities, total, 4, 0.5),
      items: top(d.Items, total, 8, 0.5),
      moves: top(d.Moves, total, 14, 1),
      spreads: top(d.Spreads, total, 8, 0.5),
      teammates: top(d.Teammates, total, 12, 1),
      checks,
    };
  }
  return out;
}

async function main() {
  const local = arg('local');
  const {month, format, listing} = local
    ? {month: arg('month'), format: arg('format'), listing: null}
    : await findLatest();
  console.log(`Mes ${month}, formato ${format}`);
  const datasets = {};
  for (const [key, id] of [['bo3', `${format}bo3`], ['ladder', format]]) {
    const file = `${id}-${CUTOFF}.json`;
    if (local ? !existsSync(join(local, file)) : !listing.includes(`"${file}"`)) {
      console.log(`  (sin ${file})`);
      continue;
    }
    const [usageTxt, leadsTxt] = local
      ? [join(local, `${id}-${CUTOFF}.txt`), join(local, 'leads', `${id}-${CUTOFF}.txt`)]
          .map(f => (existsSync(f) ? readFileSync(f, 'utf8') : null))
      : await Promise.all([
          get(`${BASE}${month}/${id}-${CUTOFF}.txt`).catch(() => null),
          get(`${BASE}${month}/leads/${id}-${CUTOFF}.txt`).catch(() => null),
        ]);
    const chaos = local
      ? JSON.parse(readFileSync(join(local, file), 'utf8'))
      : await get(`${BASE}${month}/chaos/${file}`, true);
    datasets[key] = {
      id,
      cutoff: CUTOFF,
      battles: chaos.info['number of battles'],
      source: `${BASE}${month}/chaos/${file}`,
      pokemon: condense(chaos),
    };
    // Real (veces que salió al campo) y leads por especie, para predecir qué trae y con qué abre
    const usageRows = parseTable(usageTxt), leadRows = parseTable(leadsTxt);
    const totals = {raw: 0, real: 0, lead: 0};
    for (const [, [raw, real]] of Object.entries(usageRows)) { totals.raw += raw || 0; totals.real += real || 0; }
    for (const [, [lead]] of Object.entries(leadRows)) totals.lead += lead || 0;
    for (const [name, mon] of Object.entries(datasets[key].pokemon)) {
      const u = usageRows[name], l = leadRows[name];
      if (u && u[1] != null) { mon.teams = u[0]; mon.real = u[1]; }
      if (l && l[0] != null) mon.lead = l[0];
    }
    if (totals.raw && totals.lead) datasets[key].totals = totals;
    datasets[key].pokemon = normalizeNames(datasets[key].pokemon);
    console.log(`    leads: ${Object.keys(leadRows).length} especies, uso real: ${Object.keys(usageRows).length}`);
    console.log(`  ${file}: ${chaos.info['number of battles']} combates, ${Object.keys(datasets[key].pokemon).length} Pokémon`);
  }
  const reg = /reg([a-z]+)$/.exec(format)[1].toUpperCase();
  const regulation = reg.length === 2 ? `${reg[0]}-${reg[1]}` : reg;
  const result = {
    generatedAt: new Date().toISOString(),
    month,
    format,
    regulation,
    datasets,
  };
  for (const [from, to] of renamed) console.log(to ? `  nombre traducido al del calc: ${from} → ${to}` : `  AVISO: el calc no conoce a ${from}`);
  mkdirSync(dirname(OUT), {recursive: true});
  writeFileSync(OUT, JSON.stringify(result));
  console.log(`Escrito ${OUT}`);
}

main().catch(e => {
  console.error(e);
  if (args.includes('--soft') && existsSync(OUT)) {
    console.warn('No se pudieron actualizar las estadísticas; se mantiene el usage.json existente.');
    process.exit(0);
  }
  process.exit(1);
});
