/**
 * Matriz completa de precisión del reconocimiento (tarda varios minutos: solo con MATRIX=1).
 *   MATRIX=1 npx vitest run tests/matrix.test.ts
 * El rival se reconoce solo por el sprite (sin tipos ni sexo): es el peor caso.
 * Escribe el resultado en MATRIX_OUT (por defecto matrix.json): aciertos por variante, por
 * hueco y por fondo, fallos concretos y confianza de aciertos/fallos.
 */
import {test} from 'vitest';
import {readFileSync, writeFileSync} from 'node:fs';
import {guessRival, guessOwn} from '../src/lib/screen';
import {readRivalCards, readOwnCards} from '../src/lib/vision';
import type {UsageFile} from '../src/lib/data';
import {BASES, VARIANTS, SPRITES, ITEMS, idx, compose, stoneOwner} from './synth';

const ds = (JSON.parse(readFileSync('public/data/usage.json', 'utf8')) as UsageFile).datasets.bo3;
const NS = SPRITES.names.length, NI = ITEMS.names.length;

interface Rec {ok: boolean; conf: number; score: number; want: string; got: string; slot: number; base: string}
interface Cell {rival: Rec[]; own: Rec[]; item: Rec[]; missingCards: number}

test.skipIf(!process.env.MATRIX)('matriz de precisión', () => {
  const out: Record<string, Cell> = {};
  for (const [vi, v] of VARIANTS.entries()) {
    const cell: Cell = {rival: [], own: [], item: [], missingCards: 0};
    // en la primera variante, cada especie pasa por los 6 huecos; en las demás, por uno (rotando)
    const rounds = vi === 0 ? 6 : 1;
    let shot = 0;
    for (let r = 0; r < rounds; r++) for (let k0 = 0; k0 < NS; k0 += 6, shot++) {
      const base = BASES[shot % BASES.length];
      const off = (r + vi) % 6;
      const rival = [0, 1, 2, 3, 4, 5].map(j => (k0 + ((j + off) % 6)) % NS);
      // objetos: todos van pasando; una megapiedra se la lleva su dueño
      const items = [0, 1, 2, 3, 4, 5].map(j => (shot * 6 + j + vi * 7) % NI);
      const own = items.map((it, j) => {
        const owner = stoneOwner(ITEMS.names[it]);
        return owner ? SPRITES.names.indexOf(owner) : (k0 + 3 + ((j + off) % 6)) % NS;
      });
      const img = v.f(compose(base, rival, own, items), shot + 1, base);
      // rival solo con el sprite: los iconos de tipo/sexo del fondo son los del Pokémon original
      // (en una captura real coinciden y ayudan, así que esto es el peor caso)
      const res = {
        rival: guessRival(readRivalCards(img).map(c => ({...c, types: [], gender: '' as const})), idx.sprites, ds),
        own: guessOwn(readOwnCards(img), idx, ds),
      };
      cell.missingCards += 12 - res.rival.length - res.own.length;
      res.rival.forEach((g, j) => cell.rival.push({ok: g.species === SPRITES.names[rival[j]], conf: g.confidence, score: g.fit, want: SPRITES.names[rival[j]], got: g.species, slot: j, base: base.name}));
      res.own.forEach((g, j) => {
        cell.own.push({ok: g.species === SPRITES.names[own[j]], conf: g.confidence, score: g.fit, want: SPRITES.names[own[j]], got: g.species, slot: j, base: base.name});
        cell.item.push({ok: g.item === ITEMS.names[items[j]], conf: g.itemConfidence, score: g.itemFit, want: ITEMS.names[items[j]], got: g.item, slot: j, base: base.name});
      });
    }
    out[v.name] = cell;
    const pct = (rs: Rec[]) => `${rs.filter(r => r.ok).length}/${rs.length}`;
    console.log(`${v.name}: rival ${pct(cell.rival)} · tuyos ${pct(cell.own)} · objetos ${pct(cell.item)} · tarjetas perdidas ${cell.missingCards}`);
  }
  writeFileSync(process.env.MATRIX_OUT ?? 'matrix.json', JSON.stringify(out));
}, 3_600_000);
