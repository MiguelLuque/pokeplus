# PokePlus · asistente VGC para Pokémon Champions

Web responsive para preparar combates de VGC (dobles, traes 6 y eliges 4) en la regulación actual de **Pokémon Champions**.

## Qué hace

- **Rival**: sube o pega una captura de la pantalla de selección de equipo y se reconocen los 6 del rival por su sprite, tipos y sexo (o escribe los nombres). Para cada uno muestra sus
  movimientos, objetos, habilidades y repartos de Stat Points más usados, con % reales, su velocidad y la probabilidad
  de cada forma Mega. Si has guardado tu equipo, recomienda **qué 4 llevar y la lead**, predice la lead del rival y
  muestra una matriz de enfrentamientos (quién hace OHKO/2HKO a quién y quién es más rápido). Sin equipo, sugiere
  Pokémon del meta que le ganan a ese equipo.
- **KO vs meta**: a qué Pokémon del top del meta haces OHKO/2HKO con cada ataque, o al revés, qué amenazas te los hacen a ti.
- **Calculadora**: calculadora de daño y stats completa (SP, naturaleza, objeto, habilidad, boosts, clima, campo,
  pantallas, Refuerzo, críticos, ataques de área).
- **Meta**: ranking de uso con el detalle de cada Pokémon (compañeros y checks/counters incluidos).
- **Mi equipo**: importa/exporta en formato Showdown o con una lista de nombres.

## Datos y cálculos

- Estadísticas de uso reales de [Smogon](https://www.smogon.com/stats/) (Pokémon Showdown), formato
  `gen9championsvgc<año>reg<x>` (Bo3 y ladder, rating ≥1760). `scripts/fetch-usage.mjs` detecta el mes y la regulación
  más recientes y genera `public/data/usage.json`.
- Se actualizan solas: en cada build de Vercel y con la GitHub Action `update-usage.yml` (los primeros días de cada mes).
- Daño con [`@smogon/calc`](https://github.com/smogon/damage-calc), el mismo motor que la calculadora de Showdown, con
  las mecánicas de Champions (nivel 50, 32 SP por stat, 66 en total, Megas).
- La recomendación de lead es una heurística: combina los cálculos de daño contra los sets más usados del rival,
  velocidad, roles (Fake Out, Tailwind, Trick Room, redirección, clima, Intimidación) y el uso real.

## Desarrollo

```bash
npm install
npm run data   # descarga las estadísticas más recientes
npm run dev
npm test
```

## Reconocimiento de capturas

En la pantalla “Selecciona 4 Pokémon para el combate” el juego no muestra los nombres del rival, solo su sprite, sus
iconos de tipo y su sexo. `src/lib/vision.ts` localiza las tarjetas rojas de la derecha, lee el color de los iconos de
tipo y el símbolo de sexo, recorta el sprite y lo compara con un índice de miniaturas 16×16 de los sprites de menú del
juego (`public/data/sprite-index.json`). Todo ocurre en el navegador; la imagen no se sube a ningún sitio.

Para regenerar el índice (p. ej. si llegan Pokémon nuevos con una regulación):

```bash
git clone --depth 1 https://github.com/KevinToodlepoot/pokemon-champions-sprites /tmp/champ-sprites
npm run sprites -- /tmp/champ-sprites/sprites
```
