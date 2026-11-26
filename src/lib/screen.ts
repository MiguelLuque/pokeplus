import {gen, toID, type Dataset} from './data';
import {
  readRivalCards, readOwnCards, refsFromAtlas, matchPatch, matchPatchAt, halfPatch, halfRef,
  SPRITE_N, ITEM_N, JITTER,
  type Img, type Ref, type Patch, type CardReading, type OwnReading,
} from './vision';

export interface Option {name: string; score: number}

export interface SlotGuess {
  /** mejor candidato */
  species: string;
  /** alternativas ordenadas (incluye la primera) */
  options: Option[];
  /** 0..1: margen frente a la segunda opción y lo bien que encaja (ver rank) */
  confidence: number;
  /** distancia del mejor candidato (sin penalizaciones): <0.15 encaja bien */
  fit: number;
  reading: CardReading;
}

export interface OwnGuess {
  species: string;
  options: Option[];
  confidence: number;
  fit: number;
  item: string;
  itemOptions: Option[];
  itemConfidence: number;
  itemFit: number;
  reading: OwnReading;
}

export interface RefIndex {sprites: Ref[]; items: Ref[]}

interface AtlasInfo {n: number; cols: number; file: string; names: string[]}

async function loadAtlas(info: AtlasInfo): Promise<Ref[]> {
  const r = await fetch(`/data/${info.file}`);
  if (!r.ok) throw new Error('No se pudieron cargar las imágenes de referencia');
  const img = await blobToImage(await r.blob(), Infinity, true);
  return refsFromAtlas(img, info.names, info.n, info.cols);
}

let indexPromise: Promise<RefIndex> | null = null;
/** Carga (una vez) las referencias de sprites y objetos. Conviene llamarla pronto para precargar. */
export function loadRefIndex(): Promise<RefIndex> {
  if (!indexPromise) {
    indexPromise = fetch('/data/sprite-index.json')
      .then(r => {
        if (!r.ok) throw new Error('No se pudo cargar el índice de sprites');
        return r.json() as Promise<{sprites: AtlasInfo; items: AtlasInfo}>;
      })
      .then(async j => {
        const [sprites, items] = await Promise.all([loadAtlas(j.sprites), loadAtlas(j.items)]);
        return {sprites, items};
      });
    indexPromise.catch(() => { indexPromise = null; });
  }
  return indexPromise;
}

interface SpeciesInfo {types: string[]; gender?: string}
const infoCache = new Map<string, SpeciesInfo>();
function info(name: string): SpeciesInfo {
  let i = infoCache.get(name);
  if (!i) {
    const s = gen.species.get(toID(name) as never) as {types?: string[]; gender?: string} | undefined;
    i = {types: s?.types ? [...s.types] : [], gender: s?.gender};
    infoCache.set(name, i);
  }
  return i;
}

/** Penalización (se suma a la distancia del sprite) por tipos y sexo incompatibles. */
export function rivalPenalty(reading: Pick<CardReading, 'types' | 'gender'>, species: string, ds?: Dataset): number {
  const {types, gender} = info(species);
  let d = 0;
  if (reading.types.length) {
    const miss = reading.types.filter(t => !types.includes(t)).length + types.filter(t => !reading.types.includes(t)).length;
    d += 0.15 * Math.min(2, miss);
  }
  if (reading.gender === 'M' && (gender === 'F' || gender === 'N')) d += 0.1;
  if (reading.gender === 'F' && (gender === 'M' || gender === 'N')) d += 0.1;
  if (!reading.gender && (gender === 'M' || gender === 'F')) d += 0.03;
  // ligerísima preferencia por lo que se usa en el meta
  if (ds && !ds.pokemon[species]) d += 0.01;
  return d;
}

/** Margen entre la 1ª y la 2ª opción que se considera "seguro". */
const SURE = 0.05;
/**
 * Distancia (sin penalizaciones) a partir de la cual el mejor candidato no "encaja": en las
 * pruebas con todo el roster y distintos móviles, los aciertos quedan por debajo de FIT_OK y
 * los recortes mal situados o de algo que no es un Pokémon, por encima de FIT_BAD.
 */
export const FIT_OK = 0.16, FIT_BAD = 0.22;
/** Si el mejor encaje es peor que esto, se busca con más desplazamiento (realign). */
const REALIGN = 0.12;

interface Scored extends Option {raw: number}

function rank(opts: Scored[]): {best: string; options: Option[]; confidence: number; fit: number} {
  opts.sort((a, b) => a.score - b.score);
  const [a, b] = opts;
  const margin = a && b && Number.isFinite(a.score) ? Math.max(0, Math.min(1, (b.score - a.score) / SURE)) : a ? 1 : 0;
  const fit = a ? a.raw : Infinity;
  // aunque destaque sobre el resto, si no encaja bien no es "seguro"
  const fits = Math.max(0, Math.min(1, (FIT_BAD - fit) / (FIT_BAD - FIT_OK)));
  return {best: a?.name ?? '', options: opts.slice(0, 5).map(({name, score}) => ({name, score})), confidence: Math.min(margin, fits), fit};
}

/**
 * Compara un recorte con todas las referencias. Normalmente con ±JITTER celdas de holgura;
 * si ni la mejor encaja bien (tarjeta desplazada unos píxeles por compresión, reescalado u
 * otra pantalla), se busca el desplazamiento en todo el margen del recorte: primero a mitad
 * de resolución con todas las referencias y luego fino con las 12 mejores.
 */
function scoreAll(patch: Patch, refs: Ref[], n: number, pen: (name: string) => number): Scored[] {
  const opts = refs.map(ref => {
    const raw = matchPatch(patch, ref);
    return {name: ref.name, raw, score: raw + pen(ref.name)};
  });
  const best = opts.reduce((m, o) => Math.min(m, o.raw), Infinity);
  if (!(best >= REALIGN) || patch.pad <= JITTER) return opts;
  const hp = halfPatch(patch);
  const coarse = refs.map((ref, i) => ({i, ...matchPatchAt(hp, halfRef(ref, n), 0, 0, hp.pad)}))
    .sort((a, b) => a.score + pen(refs[a.i].name) - b.score - pen(refs[b.i].name)).slice(0, 12);
  for (const c of coarse) {
    const m = matchPatchAt(patch, refs[c.i], 2 * c.dx, 2 * c.dy, 2);
    if (m.score < opts[c.i].raw) opts[c.i] = {...opts[c.i], raw: m.score, score: m.score + pen(refs[c.i].name)};
  }
  return opts;
}

export function guessRival(readings: CardReading[], refs: Ref[], ds?: Dataset): SlotGuess[] {
  return readings.map(reading => {
    const r = rank(scoreAll(reading.sprite, refs, SPRITE_N, name => rivalPenalty(reading, name, ds)));
    // comprobación independiente: si se leyeron los tipos y no son los de la especie elegida,
    // algo no cuadra (recorte desplazado, otra forma…): se marca como dudoso
    const types = info(r.best).types;
    const typesOk = !reading.types.length || (reading.types.length === types.length && reading.types.every(t => types.includes(t)));
    return {species: r.best, options: r.options, confidence: typesOk ? r.confidence : Math.min(r.confidence, 0.3), fit: r.fit, reading};
  });
}

/** Penalización de un objeto para una especie: megapiedra de otro Pokémon, objeto que nadie le pone… */
export function itemPenalty(item: string, species: string, ds?: Dataset): number {
  const it = gen.items.get(toID(item) as never) as {megaStone?: Record<string, string>} | undefined;
  let d = 0;
  if (it?.megaStone && !Object.keys(it.megaStone).some(k => toID(k) === toID(species))) d += 0.5;
  const used = ds?.pokemon[species]?.items;
  if (used && !used.some(([id, pct]) => id === toID(item) && pct >= 0.5)) d += 0.02;
  return d;
}

export function guessOwn(readings: OwnReading[], idx: RefIndex, ds?: Dataset): OwnGuess[] {
  return readings.map(reading => {
    const sp = rank(scoreAll(reading.sprite, idx.sprites, SPRITE_N, name => (ds && !ds.pokemon[name] ? 0.01 : 0)));
    const it = rank(scoreAll(reading.item, idx.items, ITEM_N, name => itemPenalty(name, sp.best, ds)));
    return {
      species: sp.best, options: sp.options, confidence: sp.confidence, fit: sp.fit,
      item: it.best, itemOptions: it.options, itemConfidence: it.confidence, itemFit: it.fit, reading,
    };
  });
}

/** Decodifica una imagen a RGBA. `exact` evita la conversión de color (para los atlas). */
export async function blobToImage(file: Blob, maxWidth = 2600, exact = false): Promise<Img> {
  const bmp = await createImageBitmap(file, exact ? {premultiplyAlpha: 'none', colorSpaceConversion: 'none'} : undefined);
  const scale = Math.min(1, maxWidth / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', {willReadFrequently: true})!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return ctx.getImageData(0, 0, c.width, c.height);
}

export interface TeamPreview {rival: SlotGuess[]; own: OwnGuess[]; width: number}

/** Analiza una imagen ya decodificada (también se usa en las pruebas). */
export function analyzePreview(img: Img, idx: RefIndex, ds?: Dataset): TeamPreview {
  return {
    rival: guessRival(readRivalCards(img), idx.sprites, ds),
    own: guessOwn(readOwnCards(img), idx, ds),
    width: img.width,
  };
}

/** Reconoce ambos equipos en una captura de la pantalla de selección. */
export async function recognizeTeamPreview(file: Blob, ds?: Dataset): Promise<TeamPreview> {
  // las capturas grandes se reducen a ~1600 px de ancho: de sobra para los sprites y más rápido
  const [img, idx] = await Promise.all([blobToImage(file, 1600), loadRefIndex()]);
  return analyzePreview(img, idx, ds);
}
