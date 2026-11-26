import {expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {gen, toID, type UsageFile} from '../src/lib/data';

const usage: UsageFile = JSON.parse(readFileSync('public/data/usage.json', 'utf8'));
const sprites: string[] = JSON.parse(readFileSync('public/data/sprite-index.json', 'utf8')).sprites.names;
/** Forma Mega → la que se ve en la vista previa (la que lleva la megapiedra). */
const megaBase = new Map<string, string>();
for (const it of gen.items as Iterable<{megaStone?: Record<string, string>}>)
  for (const [from, to] of Object.entries(it.megaStone ?? {})) megaBase.set(to, from);

/**
 * Cada Pokémon de las estadísticas tiene que existir en el calc (si no, no hay cálculo de
 * daño) y tener sprite de referencia (si no, nunca se reconocería en una captura). Pasó con
 * "Aegislash", que Smogon llama así y el calc/atlas "Aegislash-Shield".
 */
test('todas las especies de las estadísticas existen en el calc y tienen sprite', () => {
  for (const [key, d] of Object.entries(usage.datasets)) for (const name of Object.keys(d.pokemon)) {
    expect(gen.species.get(toID(name) as never), `${key}: ${name} no está en el calc`).toBeTruthy();
    const base = megaBase.get(name) ?? name;
    expect(sprites, `${key}: ${name} no tiene sprite`).toContain(base);
  }
});
