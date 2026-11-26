import {gen, toID, type Dataset} from './data';
import {readTeamPreview, thumbDistance, decodeThumb, type Img, type SpriteIndex, type CardReading} from './vision';

export interface SlotGuess {
  /** mejor candidato */
  species: string;
  /** alternativas ordenadas (incluye la primera) */
  options: {species: string; score: number}[];
  /** 0..1, margen frente a la segunda opción */
  confidence: number;
  reading: CardReading;
}

let indexPromise: Promise<SpriteIndex> | null = null;
export function loadSpriteIndex(): Promise<SpriteIndex> {
  if (!indexPromise) {
    indexPromise = fetch('/data/sprite-index.json')
      .then(r => {
        if (!r.ok) throw new Error('No se pudo cargar el índice de sprites');
        return r.json() as Promise<{thumbs: Record<string, string>}>;
      })
      .then(j => Object.fromEntries(Object.entries(j.thumbs).map(([k, v]) => [k, decodeThumb(v)])));
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

/** Puntuación (menor = mejor) de que la tarjeta sea esa especie. */
export function scoreSpecies(reading: CardReading, species: string, thumb: Uint8Array, ds?: Dataset): number {
  if (!reading.thumb) return Infinity;
  let d = thumbDistance(reading.thumb, thumb);
  const {types, gender} = info(species);
  if (reading.types.length) {
    const miss = reading.types.filter(t => !types.includes(t)).length + types.filter(t => !reading.types.includes(t)).length;
    d += 0.3 * Math.min(2, miss);
  }
  if (reading.gender === 'M' && (gender === 'F' || gender === 'N')) d += 0.35;
  if (reading.gender === 'F' && (gender === 'M' || gender === 'N')) d += 0.35;
  if (!reading.gender && (gender === 'M' || gender === 'F')) d += 0.1;
  // ligera preferencia por lo que se usa en el meta
  if (ds && !ds.pokemon[species]) d += 0.04;
  return d;
}

export function guessSlots(readings: CardReading[], index: SpriteIndex, ds?: Dataset): SlotGuess[] {
  return readings.map(reading => {
    const scored = Object.entries(index)
      .map(([species, t]) => ({species, score: scoreSpecies(reading, species, t, ds)}))
      .sort((a, b) => a.score - b.score);
    const [a, b] = scored;
    const confidence = a && b && Number.isFinite(a.score) ? Math.max(0, Math.min(1, (b.score - a.score) / 0.3)) : 0;
    return {species: a?.species ?? '', options: scored.slice(0, 4), confidence, reading};
  });
}

export async function imageFromBlob(file: Blob): Promise<Img> {
  const bmp = await createImageBitmap(file);
  // las capturas grandes se reducen a ~2600 px de ancho: suficiente y más rápido
  const scale = Math.min(1, 2600 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', {willReadFrequently: true})!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Reconoce el equipo rival de una captura de la pantalla de selección. */
export async function recognizeRivalTeam(file: Blob, ds?: Dataset): Promise<{slots: SlotGuess[]; width: number}> {
  const [img, index] = await Promise.all([imageFromBlob(file), loadSpriteIndex()]);
  return {slots: guessSlots(readTeamPreview(img), index, ds), width: img.width};
}
