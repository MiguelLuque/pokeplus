# PokePlus

Asistente VGC para Pokémon Champions: estadísticas de uso reales (Smogon), calculadora de daño,
KOs contra el meta y, a partir de una captura de la pantalla de selección de equipo, qué traerá
y con qué abrirá el rival y qué 4 llevar tú.

En producción: https://pokeplus.vercel.app

## Desarrollo

```sh
npm install
npm run dev        # descarga estadísticas y sprites (prebuild) y arranca Vite
npm test           # pruebas (incluye reconocimiento con todo el roster, ~1-2 min)
MATRIX=1 npx vitest run tests/matrix.test.ts   # matriz completa de reconocimiento (~7 min)
```

- `scripts/fetch-usage.mjs`: estadísticas de Smogon → `public/data/usage.json`.
- `scripts/build-sprite-index.mjs`: atlas de sprites y objetos para el reconocimiento.
- `src/lib/vision.ts` / `screen.ts`: reconocimiento de capturas; `leads.ts`: predicción del rival;
  `analysis.ts`: recomendación de tus 4 y la lead.
