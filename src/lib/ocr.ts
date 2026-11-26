import {fuzzySpecies} from './sets';
import {speciesName, toID} from './data';

/** Prepara la imagen: escala x2, escala de grises y (opcional) invierte colores. */
async function preprocess(file: Blob, invert: boolean): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(3, Math.max(1, 2000 / Math.max(bmp.width, bmp.height)));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (invert) g = 255 - g;
    g = g > 150 ? 255 : g < 90 ? 0 : g; // aumenta contraste
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Busca nombres de Pokémon en un texto reconocido (tolerante a errores). */
export function extractSpecies(text: string): string[] {
  const found: string[] = [];
  const add = (n?: string) => { if (n && !found.includes(n)) found.push(n); };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/[|_[\]{}<>©®"'`~^*]/g, ' ').trim();
    if (!line) continue;
    const tokens = line.split(/[\s@/,.;:()]+/).filter(t => t.replace(/[^a-z]/gi, '').length >= 3);
    // primero coincidencias exactas de 2 palabras (p. ej. "Mr. Rime") y luego palabras sueltas
    for (let i = 0; i < tokens.length; i++) {
      const two = tokens[i + 1] ? `${tokens[i]} ${tokens[i + 1]}` : '';
      const exact2 = two && speciesName(two);
      if (exact2) { add(exact2); i++; continue; }
      const exact = speciesName(tokens[i]);
      if (exact) { add(exact); continue; }
      if (toID(tokens[i]).length >= 5) add(fuzzySpecies(tokens[i], 0.25));
    }
  }
  return found;
}

export async function recognizeTeam(file: Blob, onProgress?: (p: number, msg: string) => void) {
  const {createWorker} = await import('tesseract.js');
  onProgress?.(0.05, 'Cargando motor OCR…');
  const worker = await createWorker('eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    gzip: true,
    logger: (m: {status: string; progress: number}) => {
      if (m.status === 'recognizing text') onProgress?.(0.2 + 0.4 * m.progress, 'Leyendo texto…');
    },
  });
  try {
    const texts: string[] = [];
    for (const invert of [false, true]) {
      const canvas = await preprocess(file, invert);
      const {data} = await worker.recognize(canvas);
      texts.push(data.text);
      onProgress?.(invert ? 0.95 : 0.6, invert ? 'Comprobando…' : 'Segunda pasada…');
    }
    const species = extractSpecies(texts.join('\n'));
    onProgress?.(1, 'Listo');
    return {species, text: texts.join('\n---\n')};
  } finally {
    await worker.terminate();
  }
}
