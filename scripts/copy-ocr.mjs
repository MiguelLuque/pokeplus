// Copia el motor OCR (tesseract.js) a public/tesseract para servirlo desde
// nuestro propio dominio, sin depender de CDNs externos.
import {cpSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'tesseract');
mkdirSync(join(out, 'core'), {recursive: true});
mkdirSync(join(out, 'lang'), {recursive: true});
cpSync(join(nm, 'tesseract.js/dist/worker.min.js'), join(out, 'worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  cpSync(join(nm, 'tesseract.js-core', f), join(out, 'core', f));
}
cpSync(join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz'));
console.log('OCR copiado a public/tesseract');
