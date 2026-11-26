import {gen, toID, type Dataset} from './data';
import {
  readRivalCards, readOwnCards, refsFromAtlas, matchPatch,
  type Img, type Ref, type CardReading, type OwnReading,
} from './vision';

export interface Option {name: string; score: number}

export interface SlotGuess {
  /** mejor candidato */
  species: string;
  /** alternativas ordenadas (incluye la primera) */
  options: Option[];
  /** 0..1, margen frente a la segunda opción */
  confidence: number;
  reading: CardReading;
}

export interface OwnGuess {
  species: string;
  options: Option[];
  confidence: number;
  item: string;
  itemOptions: Option[];
  itemConfidence: number;
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

function rank(opts: Option[]): {best: string; options: Option[]; confidence: number} {
  opts.sort((a, b) => a.score - b.score);
  const [a, b] = opts;
  const confidence = a && b && Number.isFinite(a.score) ? Math.max(0, Math.min(1, (b.score - a.score) / SURE)) : a ? 1 : 0;
  return {best: a?.name ?? '', options: opts.slice(0, 5), confidence};
}

export function guessRival(readings: CardReading[], refs: Ref[], ds?: Dataset): SlotGuess[] {
  return readings.map(reading => {
    const r = rank(refs.map(ref => ({name: ref.name, score: matchPatch(reading.sprite, ref) + rivalPenalty(reading, ref.name, ds)})));
    return {species: r.best, options: r.options, confidence: r.confidence, reading};
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
    const sp = rank(idx.sprites.map(ref => ({name: ref.name, score: matchPatch(reading.sprite, ref) + (ds && !ds.pokemon[ref.name] ? 0.01 : 0)})));
    const itemScores = idx.items.map(ref => ({name: ref.name, raw: matchPatch(reading.item, ref)}));
    const it = rank(itemScores.map(o => ({name: o.name, score: o.raw + itemPenalty(o.name, sp.best, ds)})));
    return {
      species: sp.best, options: sp.options, confidence: sp.confidence,
      item: it.best, itemOptions: it.options, itemConfidence: it.confidence, reading,
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
